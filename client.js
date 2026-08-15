/**
 * DSH Desktop — dsh client plugin bundle (official form).
 *
 * Two official-slot contributions:
 *   1. `sidebar.footer.action` — a "插件市场" button above the Settings seat
 *      that toggles an in-page marketplace panel (like the settings panel,
 *      not a separate window).
 *   2. `settings.section` — a "DSH Desktop" settings page showing the
 *      environment report and shell buttons, via the `dshdesktop` host object.
 *
 * The marketplace panel renders in-page with React (react-dom/client is in
 * the dsh module seed) and pulls its catalog through the `dshdesktop` host
 * object (catalog/config/openExternal). The icon comes from assets/market.svg.
 *
 * Bundle contract: `window.__ModuleLoader__.load({ id, factory })`; factory is
 * CJS-style; `require(...)` resolves against the platform seed table.
 *
 * NOTE on the JSX helpers: react/jsx-runtime's `jsx(type, props, key)` treats
 * the THIRD argument as the React key, NOT children. Children must live in
 * `props.children`. This file uses `el(type, props, children)` everywhere,
 * which places children correctly — do not "simplify" calls back to bare
 * `jsx(type, props, childArray)`.
 */
window.__ModuleLoader__.load({
  id: '@dshd/dshdesktop-client',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var reactJsxRuntime = require('react/jsx-runtime')
    var jsx = reactJsxRuntime.jsx
    var React = require('react')
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef
    var createRoot = require('react-dom/client').createRoot

    // Services this plugin waits for before activating.
    var inject = ['slots']

    var LOG = function (msg) {
      try { console.log('[dshdesktop] ' + msg) } catch (e) { /* noop */ }
    }

    // children-safe element factory: puts `children` into props.children.
    function el(type, props, children) {
      if (children === undefined) return jsx(type, props)
      var p = {}
      for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k)) p[k] = props[k]
      p.children = children
      return jsx(type, p)
    }

    // ---------------------------------------------------------------- bridge

    function bridge() {
      try {
        var b = window.chrome && window.chrome.webview &&
          window.chrome.webview.hostObjects && window.chrome.webview.hostObjects.dshdesktop
        return b || null
      } catch (e) { return null }
    }

    // Sync host-object call: returns the raw return value (string or Promise)
    // unchanged. Used where the caller handles the shape itself (env report,
    // void shell actions).
    // IMPORTANT: a COM host-object method invoked as `b.method(undefined)`
    // fails with DISP_E_BADPARAMCOUNT (0x8002000E) — undefined is marshalled
    // as one argument. Pass NO argument for parameterless methods.
    function call(method, arg) {
      var b = bridge()
      if (!b || !b[method]) {
        LOG('bridge method unavailable: ' + method)
        return null
      }
      try { return arg === undefined ? b[method]() : b[method](arg) } catch (e) {
        LOG('bridge call failed: ' + method + ' ' + e)
        return null
      }
    }

    // Promise-ified host-object call that JSON-parses string results.
    // Normalizes sync/async host-object shapes and never throws; resolves the
    // parsed object, or null on any failure. Every failure mode is logged so
    // the app.log shows exactly where a call broke. Parameterless methods are
    // invoked with no argument (see call() note); 4s timeout guards against a
    // call that never settles.
    function callJson(method, arg) {
      var b = bridge()
      if (!b || !b[method]) { LOG('bridge missing: ' + method); return Promise.resolve(null) }
      return new Promise(function (resolve) {
        var done = false
        var finish = function (v) { if (!done) { done = true; resolve(v) } }
        var settle = function (v) {
          if (typeof v === 'string') {
            try { finish(JSON.parse(v)) } catch (e) {
              LOG('bridge parse fail: ' + method + ' :: ' + String(v).slice(0, 160))
              finish(null)
            }
            return
          }
          if (v == null) { LOG('bridge null return: ' + method); finish(null); return }
          finish(v)
        }
        try {
          var r = arg === undefined ? b[method]() : b[method](arg)
          if (r && typeof r.then === 'function') {
            r.then(settle, function (e) { LOG('bridge reject: ' + method + ' :: ' + String(e)); finish(null) })
          } else {
            settle(r)
          }
        } catch (e) {
          LOG('bridge throw: ' + method + ' :: ' + e)
          finish(null)
        }
        setTimeout(function () {
          if (!done) { LOG('bridge timeout: ' + method); finish(null) }
        }, 4000)
      })
    }

    // Resolve a host-object method to a plain value (sync or promise), JSON-
    // parsing string results. Never throws; always resolves.
    function bridgeCall(method, arg) {
      var b = bridge()
      if (!b || !b[method]) return Promise.resolve(null)
      var settle = function (v) {
        if (typeof v === 'string') {
          try { return JSON.parse(v) } catch (e) { return { plugins: [], errors: [String(e)] } }
        }
        return v
      }
      // Timeout so a hung host-object call (e.g. a slow plugin install) cannot
      // leave `busy` stuck true — which disabled every button in the panel.
      return new Promise(function (resolve) {
        var done = false
        var finish = function (v) { if (!done) { done = true; resolve(v) } }
        try {
          var r = arg === undefined ? b[method]() : b[method](arg)
          if (r && typeof r.then === 'function') {
            r.then(function (v) { finish(settle(v)) }, function (e) { finish({ plugins: [], errors: [String(e)] }) })
          } else {
            finish(settle(r))
          }
        } catch (e) { finish({ plugins: [], errors: [String(e)] }) }
        setTimeout(function () {
          if (!done) { LOG('bridgeCall timeout: ' + method); finish({ plugins: [], errors: ['操作超时'] }) }
        }, 30000)
      })
    }

    // ------------------------------------------------------- market panel store

    var marketState = { open: false }
    var marketListeners = new Set()
    function getMarketOpen() { return marketState.open }
    function subscribeMarket(fn) { marketListeners.add(fn); return function () { marketListeners.delete(fn) } }
    function setMarketOpen(v) {
      if (marketState.open === v) return
      marketState.open = v
      marketListeners.forEach(function (fn) { fn() })
    }

    // ------------------------------------------------------------ marketplace icon

    // assets/market.svg (1024x1024 storefront glyph), two fill paths.
    var MARKET_PATHS = [
      'M936.026112 65.519616c-6.11328-18.722816-15.499264-46.956544-56.131584-46.956544H149.225472c-41.193472 0-50.393088 28.90752-55.332864 44.437504L20.77696 401.068032c-2.965504 22.091776 4.446208 35.844096 11.173888 43.454464 10.375168 11.784192 26.062848 17.616896 46.37696 17.616896 2.226176 2.048 4.560896 4.02432 6.979584 5.9392V948.67456c0 31.363072 25.628672 56.895488 57.184256 56.895488H885.76c31.555584 0 57.243648-25.532416 57.243648-56.895488V466.239488a128.09216 128.09216 0 0 0 4.878336-4.163584h1.112064c13.953024 0 26.427392-3.44064 36.186112-10.00448 10.620928-7.059456 23.277568-21.174272 22.786048-52.7872L936.026112 65.519616z m-39.335936 883.152896c0 5.953536-4.876288 10.862592-10.928128 10.862592H142.491648a10.862592 10.862592 0 0 1-10.866688-10.862592V492.730368c16.979968 5.71392 35.20512 8.871936 53.291008 8.871936 35.633152 0 77.871104-13.871104 105.908224-33.447936 28.407808 19.7632 74.723328 36.70016 120.111104 36.70016 41.930752 0 91.273216-24.487936 115.664896-38.295552 25.628672 18.900992 67.743744 34.981888 117.950464 34.981888 47.982592-0.120832 84.045824-19.39456 103.806976-33.263616 26.058752 18.655232 63.172608 30.441472 98.8672 30.441472 17.22368 0 33.927168-2.646016 49.465344-7.64928v457.603072z m62.6176-534.595584c-1.978368 1.349632-5.926912 2.08896-15.5648 1.783808l-12.720128-2.58048-8.892416 9.51296c-17.354752 18.784256-45.326336 30.01344-74.907648 30.01344-35.135488 0-67.434496-15.097856-81.266688-30.01344l-16.365568-17.494016-17.108992 16.760832c-0.3072 0.305152-34.459648 33.325056-88.80128 33.509376-43.966464 0-82.317312-16.508928-97.445888-32.899072l-13.217792-14.297088-16.427008 10.55744c-17.227776 11.046912-69.779456 39.829504-105.658368 39.829504-44.771328 0-89.419776-21.417984-103.129088-36.272128l-16.979968-18.35008-17.102848 18.35008c-14.514176 15.652864-54.593536 33.081344-88.805376 33.081344-35.817472 0-66.076672-16.265216-80.091136-32.407552l-8.769536-9.756672-12.845056 2.207744c-0.555008 0.12288-3.024896 0.493568-6.23616 0.493568-6.729728 0-9.754624-1.533952-10.123264-1.845248 0 0-0.927744-1.779712-0.497664-5.337088L135.886848 83.314688l2.097152-6.443008c1.236992-3.803136 3.211264-10.129408 4.571136-11.169792 0.3072-0.249856 2.347008-0.923648 6.6048-0.923648h730.673152c4.569088 0 6.17472 0.673792 6.23616 0.673792 1.667072 1.599488 4.261888 9.455616 6.299648 15.286272L962.1504 404.258816c0 3.618816-0.497664 8.28416-2.842624 9.818112z',
      'M228.352 857.088h126.976v40.96h-126.976zM439.296 857.088h395.264v40.96h-395.264z'
    ]

    function MarketGlyph(props) {
      var size = props.size || 16
      return el('svg', {
        viewBox: '0 0 1024 1024', width: size, height: size,
        fill: 'currentColor', 'aria-hidden': 'true',
      }, MARKET_PATHS.map(function (d, i) {
        return el('path', { key: 'p' + i, d: d })
      }))
    }

    // ---------------------------------------------------------- footer action

    // Native listener bound via ref as a fallback in case the synthetic
    // event is swallowed; lastClick dedupes so only one path actually fires.
    var footerLastClick = 0
    function fireFooter(ev) {
      if (ev) {
        try { ev.preventDefault(); ev.stopPropagation() } catch (e) { /* noop */ }
      }
      var now = Date.now()
      if (now - footerLastClick < 400) return
      footerLastClick = now
      LOG('footer toggle market -> ' + !getMarketOpen())
      setMarketOpen(!getMarketOpen())
    }

    function bindNativeClick(el0, fn) {
      if (!el0 || el0.__dshdBound) return
      el0.__dshdBound = true
      el0.addEventListener('click', fn)
    }

    function FooterEntry(props) {
      var [hover, setHover] = useState(false)
      var wide = !props || props.wide !== false   // collapsed rail → false
      var label = '插件市场'
      return el('button', {
        ref: function (el0) { bindNativeClick(el0, fireFooter) },
        onClick: fireFooter,
        onMouseEnter: function () { setHover(true) },
        onMouseLeave: function () { setHover(false) },
        type: 'button',
        className: 'dshdesktop-client-entry',
        title: label,
        'aria-label': label,
        style: {
          // Mirrors the dsh settings trigger: 34px wide row, or the 36px
          // rail circle (icon only) when the sidebar is collapsed.
          boxSizing: 'border-box',
          cursor: 'pointer',
          flex: '0 0 auto',
          width: wide ? 'calc(100% + 8px)' : '36px',
          height: wide ? '34px' : '36px',
          margin: wide ? '4px -4px' : '8px 0 10px',
          padding: wide ? '6px 2px 6px 10px' : '0',
          alignItems: 'center',
          justifyContent: wide ? 'flex-start' : 'center',
          gap: wide ? '8px' : '0',
          border: 'none',
          borderRadius: wide ? '12px' : '50%',
          color: 'var(--dsw-alias-label-primary, #222)',
          background: hover ? 'var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%))' : 'transparent',
          font: 'inherit',
          textAlign: 'left',
          display: 'flex',
          overflow: 'hidden',
        },
      }, [
        el(MarketGlyph, { key: 'g', size: wide ? 14 : 18 }),
        wide ? el('span', {
          key: 'l',
          style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto', minWidth: '0' },
        }, label) : null,
      ])
    }

    // ----------------------------------------------------------- market panel

    var MUTED = { color: 'var(--dsw-alias-label-tertiary, #6b7684)' }
    var PILL = {
      display: 'inline-block', padding: '1px 8px', borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-default, #e5e7eb)',
      color: 'var(--dsw-alias-label-secondary, #4b5563)', fontSize: '11px',
      marginRight: '4px', marginTop: '4px', flex: '0 0 auto',
    }
    var BTN = {
      minHeight: '28px', padding: '0 12px',
      border: '1px solid var(--dsw-alias-border-default, #d8dde3)',
      borderRadius: '8px', background: 'transparent',
      color: 'var(--dsw-alias-label-primary, #1f2329)',
      cursor: 'pointer', font: 'inherit', fontSize: '12px',
    }

    function MarketCard(props) {
      var p = props.p
      var [hover, setHover] = useState(false)
      return el('button', {
        type: 'button',
        onClick: function () { props.onSelect(p) },
        onMouseEnter: function () { setHover(true) },
        onMouseLeave: function () { setHover(false) },
        style: {
          textAlign: 'left', width: '100%', boxSizing: 'border-box',
          border: props.selected
            ? '1px solid var(--dsw-alias-border-strong, #b0b7c3)'
            : '1px solid var(--dsw-alias-border-default, #e5e7eb)',
          borderRadius: '10px', padding: '10px 12px', cursor: 'pointer',
          background: hover ? 'var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 4%))' : 'transparent',
          color: 'inherit', font: 'inherit',
        },
      }, [
        el('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          el('strong', { key: 't', style: { fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto', minWidth: '0' } },
            p.title || p.repository),
          el('span', { key: 's', style: Object.assign({}, MUTED, { flex: '0 0 auto', fontSize: '12px' }) },
            '★ ' + String(p.stars == null ? 0 : p.stars)),
        ]),
        p.description ? el('p', { key: 'd', style: { margin: '4px 0 0', color: 'var(--dsw-alias-label-secondary, #4b5563)', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, p.description) : null,
        el('div', { key: 'c', style: { marginTop: '4px', display: 'flex', flexWrap: 'wrap' } }, [
          el('span', { key: 'cat', style: Object.assign({}, PILL, { borderColor: 'var(--dsw-alias-border-strong, #b0b7c3)' }) }, p.category || 'other'),
          props.status ? el('span', { key: 'st', style: Object.assign({}, PILL, props.status.enabled
            ? { color: '#1f9d55', borderColor: 'rgba(31,157,85,.45)' }
            : { color: '#b45409', borderColor: 'rgba(180,84,9,.45)' }) },
            props.status.enabled ? '已装 · 启用' : '已装 · 禁用') : null,
          p.archived ? el('span', { key: 'arc', style: Object.assign({}, PILL, { color: '#b45409' }) }, '已归档') : null,
        ]),
      ])
    }

    function MarketDetail(props) {
      var p = props.p
      var facts = [
        ['仓库', p.repository || '-'],
        ['Star', String(p.stars == null ? 0 : p.stars)],
        ['License', p.license || '-'],
        ['来源', p.source || '-'],
        ['信任', p.trust || '-'],
        ['归档', p.archived ? '是' : '否'],
      ]
      return el('aside', {
        style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '0', minHeight: '0', flex: '0 0 280px', overflowY: 'auto', borderLeft: '1px solid var(--dsw-alias-border-default, #e8e8e8)', paddingLeft: '16px' },
      }, [
        el('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          el('button', { key: 'b', type: 'button', onClick: props.onBack, style: BTN }, '← 返回'),
          el('strong', { key: 't', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.title || p.repository),
        ]),
        el('div', { key: 'facts', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          facts.map(function (f) {
            return el('div', { key: f[0], style: { display: 'flex', gap: '8px' } }, [
              el('span', { key: 'k', style: Object.assign({}, MUTED, { flex: '0 0 64px' }) }, f[0]),
              el('span', { key: 'v', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f[1]),
            ])
          })),
        p.description ? el('p', { key: 'd', style: { margin: '0', color: 'var(--dsw-alias-label-secondary, #4b5563)' } }, p.description) : null,
        (p.tags && p.tags.length) ? el('div', { key: 'tags', style: { display: 'flex', flexWrap: 'wrap' } },
          p.tags.map(function (t) { return el('span', { key: t, style: PILL }, t) })) : null,
        props.opMsg ? el('div', { key: 'msg', style: Object.assign({}, MUTED, { fontSize: '12px' }) }, props.opMsg) : null,
        el('div', { key: 'btns', style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px', alignItems: 'center' } }, [
          props.installed
            ? [
                el('span', { key: 'ver', style: Object.assign({}, PILL, { marginTop: '0' }) }, '已装 v' + (props.installed.version || '')),
                el('span', { key: 'act', style: Object.assign({}, PILL, { marginTop: '0' }, props.installed.enabled ? { color: '#1f9d55' } : { color: '#b45409' }) }, props.installed.enabled ? '已启用' : '已禁用'),
                el('span', { key: 'actm', style: Object.assign({}, PILL, { marginTop: '0' }) }, props.installed.activation === 'bundle' ? 'bundle 启动' : props.installed.activation === 'client-patch' ? 'client patch' : '未激活'),
                el('button', { key: 'tgl', type: 'button', disabled: props.busy, onClick: function () { props.onToggle(props.installed.name, !props.installed.enabled) }, style: BTN }, props.installed.enabled ? '禁用' : '启用'),
                el('button', { key: 'rm', type: 'button', disabled: props.busy, onClick: function () { props.onRemove(props.installed.name) }, style: Object.assign({}, BTN, { color: '#b45409' }) }, '移除'),
              ]
            : [
                el('input', { key: 'pkg', type: 'text', value: props.installPkg, placeholder: 'dsh plugin --profile web add <包名>',
                  onChange: function (e) { props.onInstallPkg(e.target.value) },
                  style: { flex: '1 1 180px', minWidth: '160px', border: '1px solid var(--dsw-alias-border-default, #d8dde3)', borderRadius: '8px', padding: '4px 8px', background: 'transparent', color: 'inherit', font: 'inherit' } }),
                el('button', { key: 'install', type: 'button', disabled: props.busy, onClick: function () { props.onInstall(props.installPkg) }, style: { minHeight: '28px', padding: '0 12px', border: '1px solid #1f9d55', borderRadius: '8px', background: '#1f9d55', color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: '12px' } }, props.busy ? '处理中…' : '安装'),
              ],
          el('button', { key: 'repo', type: 'button', onClick: function () { openExternalRepo(p.url) }, style: BTN }, '打开仓库'),
        ]),
        !props.installed ? el('div', { key: 'hint', style: Object.assign({}, MUTED, { fontSize: '11px', marginTop: '4px' }) },
          '执行 dsh plugin --profile web add，安装到本机 web profile。scoped 包（@scope/name）请手动填写包名。') : null,
      ])
    }

    function openExternalRepo(url) {
      if (!url) return
      var b = bridge()
      if (b && typeof b.openExternal === 'function') { try { b.openExternal(url) } catch (e) { LOG('openExternal failed ' + e) } }
      else { try { window.open(url, '_blank') } catch (e) { /* noop */ } }
    }

    // Installed-plugin row for the 已安装 tab: name / version / activation
    // mode / enabled pill + update pill + enable-toggle, update, and remove.
    function InstalledRow(props) {
      var p = props.p
      var act = p.activation === 'bundle' ? 'bundle 启动'
        : p.activation === 'client-patch' ? 'client patch'
        : (p.activation || '未激活')
      var upd = props.updates && props.updates[p.name]
      return el('div', {
        key: p.name,
        style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', border: '1px solid var(--dsw-alias-border-default, #e5e7eb)', borderRadius: '10px' },
      }, [
        el('div', { key: 'info', style: { flex: '1 1 auto', minWidth: '0', overflow: 'hidden' } }, [
          el('div', { key: 'n', style: { fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, p.name),
          el('div', { key: 'sub', style: Object.assign({}, MUTED, { fontSize: '11px', marginTop: '2px' }) },
            (p.version ? 'v' + p.version : '') + ' · ' + act),
        ]),
        el('span', { key: 'st', style: Object.assign({}, PILL, p.enabled ? { color: '#1f9d55', borderColor: 'rgba(31,157,85,.45)' } : { color: '#b45409', borderColor: 'rgba(180,84,9,.45)' }) },
          p.enabled ? '已启用' : '已禁用'),
        upd && upd.hasUpdate ? el('span', { key: 'upd', style: Object.assign({}, PILL, { color: '#b45409', borderColor: 'rgba(180,84,9,.45)' }) },
          '有更新 v' + upd.latest) : null,
        upd && upd.hasUpdate ? el('button', { key: 'u', type: 'button', disabled: props.busy, onClick: function () { props.onUpdate(p.name) }, style: Object.assign({}, BTN, { color: '#1f9d55' }) }, '更新') : null,
        // A package with no dsh.bundle/dsh.client marker cannot be activated by
        // dsh — show a muted disabled button with a hint instead of a button
        // that errors on click.
        (!p.enabled && !p.activation)
          ? el('span', { key: 'nodsh', title: '该包没有 dsh.bundle/dsh.client 标记，dsh 无法激活它', style: Object.assign({}, MUTED, { fontSize: '11px' }) }, '无 dsh 标记，无法启用')
          : el('button', { key: 'tgl', type: 'button', disabled: props.busy, onClick: function () { props.onToggle(p.name, !p.enabled) }, style: BTN }, p.enabled ? '禁用' : '启用'),
        el('button', { key: 'rm', type: 'button', disabled: props.busy, onClick: function () { props.onRemove(p.name) }, style: Object.assign({}, BTN, { color: '#b45409' }) }, '移除'),
      ])
    }

    // cacheSavedAt arrives as UTC ISO ("...T08:14:22Z"); show it in the
    // computer's local time as 年月日 时分秒.
    function formatCacheTime(iso) {
      try {
        var d = new Date(iso)
        if (isNaN(d.getTime())) return iso
        var p = function (n) { return (n < 10 ? '0' : '') + n }
        return d.getFullYear() + '年' + p(d.getMonth() + 1) + '月' + p(d.getDate()) + '日 ' +
          p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
      } catch (e) { return iso }
    }

    function MarketPanel(props) {
      var [state, setState] = useState(null)   // {plugins, fromCache, cacheSavedAt, errors}
      var [configInfo, setConfigInfo] = useState(null)
      var [loading, setLoading] = useState(false)
      var [search, setSearch] = useState('')
      var [selected, setSelected] = useState(null)
      var [installed, setInstalled] = useState([])  // [{name, version, enabled, activation}]
      var [updates, setUpdates] = useState(null)    // {name: {hasUpdate, latest}}
      var [busy, setBusy] = useState(false)
      var [installPkg, setInstallPkg] = useState('')
      var [opMsg, setOpMsg] = useState('')
      var [viewTab, setViewTab] = useState('discover')
      var [installProg, setInstallProg] = useState(null) // {package, phase, resolved, added, message}
      var lastActRef = useRef(null)   // ms timestamp of last progress change
      var [staleSec, setStaleSec] = useState(0)

      // Poll C# install progress while an install runs; stop when it settles.
      // `onDone(phase, message)` fires once with the final phase — install
      // completion is judged HERE, not from pluginInstall's promise (that can
      // resolve early/never: the C# install runs up to ~4 min, the bridge call
      // times out after 30s, and the pnpm process may still be running).
      // Also tracks "activity": when resolved/message stop changing, that tells
      // the user the download is slow/stuck rather than silently sitting.
      function startProgressPoll(onDone) {
        var stopped = false
        var prev = null
        lastActRef.current = Date.now()
        setStaleSec(0)
        var timer = setInterval(function () {
          bridgeCall('installProgress').then(function (v) {
            if (stopped) return
            if (!v || !v.phase || v.phase === 'done' || v.phase === 'error') {
              var final = (v && (v.phase === 'done' || v.phase === 'error')) ? v : null
              setInstallProg(final)
              setStaleSec(0)
              clearInterval(timer); stopped = true
              if (final && onDone) onDone(final.phase, final.message)
            } else {
              var changed = !prev || prev.resolved !== v.resolved || prev.added !== v.added || prev.message !== v.message
              if (changed) lastActRef.current = Date.now()
              prev = v
              setInstallProg(v)
              setStaleSec(Math.floor((Date.now() - lastActRef.current) / 1000))
            }
          })
        }, 700)
        return function () { stopped = true; clearInterval(timer) }
      }

      function load(refresh) {
        setLoading(true)
        bridgeCall('catalog', refresh ? 1 : 0).then(function (result) {
          setState(result || { plugins: [], errors: [] })
          setLoading(false)
        })
        bridgeCall('config').then(function (c) { if (c) setConfigInfo(c) })
      }
      function loadInstalled() {
        bridgeCall('pluginStatus').then(function (r) {
          if (r && r.ok && Array.isArray(r.plugins)) setInstalled(r.plugins)
        })
      }
      useEffect(function () { load(false); loadInstalled() }, [])

      // Reopening the market while an install is still running in the background
      // (panel was closed mid-download): pick up the live progress and resume
      // polling so the bar shows again.
      useEffect(function () {
        bridgeCall('installProgress').then(function (v) {
          if (v && v.phase && (v.phase === 'resolving' || v.phase === 'installing')) {
            setInstallProg(v)
            startProgressPoll()
          }
        })
      }, [])

      // Bare repo basename (owner/repo → repo), lowercased — used ONLY for
      // matching against installed package names. Do NOT reuse pkgNameFor here:
      // that returns a full install command for the install box, which would
      // never match a package name.
      function barePkgName(repo) {
        var s = String(repo || '').trim()
        if (!s) return ''
        var parts = s.split('/')
        return (parts[parts.length - 1] || '').toLowerCase()
      }
      // Full install command (README may give the real package name; fallback
      // to the repo basename) — shown in and edited from the install box.
      function pkgNameFor(repo) {
        var base = barePkgName(repo)
        return base ? 'dsh plugin --profile web add ' + base : ''
      }
      function installedFor(repo) {
        var guess = barePkgName(repo)
        if (!guess) return null
        for (var i = 0; i < installed.length; i++) {
          var n = String(installed[i].name || '').toLowerCase()
          if (n === guess || n.indexOf('/' + guess) >= 0) return installed[i]
        }
        return null
      }
      function afterOp(msg) {
        setBusy(false)
        setOpMsg(msg || '')
        loadInstalled()
      }
      function actionInstall(cmd) {
        // The install box holds the FULL command (`dsh plugin --profile web add
        // <pkg>`, editable by the user). Extract the package argument — if the
        // user typed a bare package name, use it directly.
        cmd = String(cmd || '').trim()
        var pkg = cmd
        var m = /dsh\s+plugin\s+--profile\s+web\s+add\s+(\S+)/i.exec(cmd)
        if (m) pkg = m[1].trim()
        pkg = String(pkg || '').trim()
        if (!pkg) { setOpMsg('请先填写安装命令或包名'); return }
        try { if (!window.confirm('将执行安装命令「' + cmd + '」\n安装 npm 包「' + pkg + '」到 web profile，并自动激活。继续？')) return } catch (e) { /* noop */ }
        setBusy(true); setOpMsg('安装中…（可能需联网下载）')
        // Completion comes from the progress poll (done/error), not from the
        // pluginInstall promise — that resolves via a 30s bridge timeout while
        // the real install can still be running in the background.
        startProgressPoll(function (phase, msg) {
          setBusy(false)
          if (phase === 'done') {
            setOpMsg('已安装，重启 dsh 后生效')
            loadInstalled()
          } else {
            setOpMsg('安装失败：' + (msg || '未知错误'))
          }
          setTimeout(function () { setInstallProg(null) }, 1500)
        })
        bridgeCall('pluginInstall', pkg)
      }
      function actionRemove(pkg) {
        try { if (!window.confirm('将从 web profile 移除「' + pkg + '」并解除激活。继续？')) return } catch (e) { /* noop */ }
        setBusy(true); setOpMsg('移除中…')
        bridgeCall('pluginRemove', pkg).then(function (r) {
          afterOp((r && r.message) || '已移除，重启 dsh 后生效')
        })
      }
      function actionToggle(pkg, enableTo) {
        setBusy(true); setOpMsg(enableTo ? '启用中…' : '禁用中…')
        bridgeCall(enableTo ? 'pluginEnable' : 'pluginDisable', pkg).then(function (r) {
          afterOp((r && r.message) || '已切换，重启 dsh 后生效')
        })
      }
      function actionUpdate(pkg) {
        try { if (!window.confirm('将把「' + pkg + '」更新到最新版本。继续？')) return } catch (e) { /* noop */ }
        setBusy(true); setOpMsg('更新中…（可能需联网下载）')
        startProgressPoll(function (phase, msg) {
          setBusy(false)
          if (phase === 'done') {
            setOpMsg('已更新，重启 dsh 后生效')
            loadInstalled()
            checkUpdates()
          } else {
            setOpMsg('更新失败：' + (msg || '未知错误'))
          }
          setTimeout(function () { setInstallProg(null) }, 1500)
        })
        bridgeCall('pluginInstall', pkg)
      }
      function checkUpdates() {
        setOpMsg('检查更新中…')
        bridgeCall('pluginUpdates').then(function (r) {
          var map = {}
          if (r && Array.isArray(r.updates)) {
            r.updates.forEach(function (u) { if (u && u.name) map[u.name] = u })
          }
          setUpdates(map)
          var any = Object.keys(map).filter(function (k) { return map[k].hasUpdate }).length
          setOpMsg(any ? '发现 ' + any + ' 个插件有更新' : '所有插件均为最新')
        })
      }
      function restartServer() {
        setBusy(true); setOpMsg('正在重启本地服务…')
        bridgeCall('restart').then(function (v) {
          setBusy(false)
          setOpMsg(v === 'ok' ? '已重启，正在重新加载…' : '重启失败：' + ((v && v.error) || '未知'))
        })
      }

      var plugins = (state && state.plugins) || []
      var q = search.trim().toLowerCase()
      var rows = plugins.filter(function (p) {
        if (installedFor(p.repository)) return false  // installed plugins move to the 已安装 tab
        if (!q) return true
        var hay = [p.title, p.description, p.repository, (p.tags || []).join(' ')].join(' ').toLowerCase()
        return hay.indexOf(q) >= 0
      })
      var errs = (state && state.errors) || []
      var detail = selected ? plugins.filter(function (p) { return p === selected || p.repository === selected || p.id === selected })[0] || null : null

      // When a plugin detail opens, fetch the repo's README and extract the
      // real npm package name (`dsh plugin --profile web add <pkg>`) — the
      // repo name is not the package name, so we stop guessing.
      useEffect(function () {
        if (!detail) return
        if (installedFor(detail.repository)) return
        bridgeCall('readmeInstall', detail.repository).then(function (names) {
          if (names && names.length && names[0]) {
            LOG('readme install pkg: ' + names[0])
            setInstallPkg(names[0])
          } else {
            // README fetch failed (network / no command in README): do NOT leave
            // a guessed bare package name — that misleads (repo name ≠ package
            // name, e.g. dsh-ads vs @dsh-external/dsh-ads). Clear it and hint.
            LOG('readme install: no command found for ' + detail.repository)
            setInstallPkg('')
            setOpMsg('未能从 README 提取安装命令，请手动输入（可到仓库 README 查看）')
          }
        })
      }, [detail ? detail.repository : ''])

      return el('div', {
        style: {
          // Centered modal panel, mirroring the dsh settings modal.
          position: 'relative', zIndex: '1',
          width: '820px', height: 'min(720px, calc(100vh - 48px))',
          maxWidth: 'calc(100vw - 48px)',
          boxSizing: 'border-box', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          borderRadius: '24px',
          background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
          boxShadow: 'var(--dsw-shadow-lv3, 0 8px 40px rgba(0,0,0,0.25))',
          color: 'var(--dsw-alias-label-primary, #202124)',
          font: 'inherit', fontSize: '13px', lineHeight: '20px',
        },
        role: 'dialog', 'aria-modal': 'true', 'aria-label': '插件市场',
      }, [
        el('header', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderBottom: '1px solid var(--dsw-alias-border-default, #e8e8e8)' } }, [
          el(MarketGlyph, { key: 'g', size: 18 }),
          el('div', { key: 't', style: { flex: '1 1 auto', minWidth: '0' } }, [
            el('div', { key: 't1', style: { fontWeight: 600, fontSize: '14px' } }, '插件市场'),
            el('div', { key: 't2', style: Object.assign({}, MUTED, { fontSize: '11px' }) },
              (state && state.fromCache ? '离线缓存' : 'GitHub 发现') +
              (state && state.cacheSavedAt ? ' · ' + formatCacheTime(state.cacheSavedAt) : '')),
          ]),
          el('button', { key: 'r', type: 'button', onClick: function () { load(true) }, style: BTN, disabled: loading }, loading ? '加载中…' : '刷新'),
          el('button', { key: 'x', type: 'button', onClick: props.onClose, style: Object.assign({}, BTN, { minWidth: '28px', padding: '0 8px' }) }, '✕'),
        ]),
        el('div', { key: 'tabs', style: { display: 'flex', gap: '4px', padding: '0 16px', borderBottom: '1px solid var(--dsw-alias-border-default, #e8e8e8)' } }, [
          el('button', { key: 'd', type: 'button', onClick: function () { setViewTab('discover'); setSelected(null) },
            style: { padding: '10px 12px', border: 'none', borderBottom: '2px solid ' + (viewTab === 'discover' ? 'var(--dsw-alias-accent-strong, #4d6bfe)' : 'transparent'), background: 'transparent', cursor: 'pointer', font: 'inherit', fontSize: '13px', color: viewTab === 'discover' ? 'var(--dsw-alias-accent-strong, #4d6bfe)' : 'var(--dsw-alias-label-secondary, #4b5563)', fontWeight: viewTab === 'discover' ? 600 : 400 } }, '发现'),
          el('button', { key: 'i', type: 'button', onClick: function () { setViewTab('installed'); setSelected(null) },
            style: { padding: '10px 12px', border: 'none', borderBottom: '2px solid ' + (viewTab === 'installed' ? 'var(--dsw-alias-accent-strong, #4d6bfe)' : 'transparent'), background: 'transparent', cursor: 'pointer', font: 'inherit', fontSize: '13px', color: viewTab === 'installed' ? 'var(--dsw-alias-accent-strong, #4d6bfe)' : 'var(--dsw-alias-label-secondary, #4b5563)', fontWeight: viewTab === 'installed' ? 600 : 400 } },
            '已安装 (' + installed.length + ')'),
        ]),
        viewTab === 'discover' ? el('div', { key: 'tb', style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--dsw-alias-border-default, #e8e8e8)' } }, [
          el('input', { key: 's', type: 'text', placeholder: '搜索名称 / 描述 / 仓库 / 标签…', value: search,
            onChange: function (e) { setSearch(e.target.value) },
            style: { flex: '1 1 auto', minWidth: '0', border: '1px solid var(--dsw-alias-border-default, #d8dde3)', borderRadius: '8px', padding: '6px 10px', background: 'transparent', color: 'inherit', font: 'inherit' } }),
          el('span', { key: 'n', style: Object.assign({}, MUTED, { flex: '0 0 auto' }) }, rows.length + ' / ' + plugins.length),
        ]) : null,
        errs.length ? el('div', { key: 'err', style: { padding: '8px 16px', color: '#b45409', background: 'var(--dsw-alias-warning-bg, #fff7e6)', borderBottom: '1px solid var(--dsw-alias-border-default, #e8e8e8)', fontSize: '12px' } },
          errs.map(function (e, i) { return el('div', { key: i }, '⚠ ' + e) })) : null,
        el('div', { key: 'body', style: { flex: '1 1 auto', minHeight: '0', display: 'flex', gap: '12px', padding: '12px 16px', overflow: 'hidden' } },
          viewTab === 'installed'
            ? el('div', { key: 'instwrap', style: { flex: '1 1 auto', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '0' } }, [
                el('div', { key: 'actions', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
                  el('button', { key: 'chk', type: 'button', disabled: busy, onClick: checkUpdates, style: BTN }, '检查更新'),
                  el('button', { key: 'restart', type: 'button', disabled: busy, onClick: restartServer, style: Object.assign({}, BTN, { borderColor: 'var(--dsw-alias-border-strong, #b0b7c3)' }) }, '立即重启'),
                ]),
                el('div', { key: 'instlist', style: { flex: '1 1 auto', minWidth: '0', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' } },
                  installed.length
                    ? installed.map(function (p) {
                        return el(InstalledRow, { key: p.name, p: p, busy: busy, updates: updates, onToggle: actionToggle, onRemove: actionRemove, onUpdate: actionUpdate })
                      })
                    : el('div', { key: 'empty', style: Object.assign({}, MUTED, { padding: '32px 0', textAlign: 'center' }) }, '还没有已安装插件，去「发现」标签安装')),
              ])
            : [
              el('div', { key: 'list', style: { flex: '1 1 auto', minWidth: '0', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' } },
                loading && !plugins.length ? el('div', { key: 'loading', style: Object.assign({}, MUTED, { padding: '32px 0', textAlign: 'center' }) }, '正在加载插件目录…')
                  : !plugins.length ? el('div', { key: 'empty', style: Object.assign({}, MUTED, { padding: '32px 0', textAlign: 'center' }) }, '未获取到插件：网络不可用或本地缓存为空，可点击右上角「刷新」重试')
                  : !rows.length ? el('div', { key: 'no', style: Object.assign({}, MUTED, { padding: '32px 0', textAlign: 'center' }) }, '没有匹配的插件')
                  : rows.map(function (p) {
                    return el(MarketCard, { key: (p.repository || p.id), p: p, status: installedFor(p.repository), selected: detail === p,
                      onSelect: function () { setSelected(detail === p ? null : p); setInstallPkg(pkgNameFor(p.repository)); setOpMsg('') } })
                  })),
              detail ? el(MarketDetail, { key: 'detail', p: detail, installed: installedFor(detail.repository),
                busy: busy, installPkg: installPkg, opMsg: opMsg,
                onInstallPkg: function (v) { setInstallPkg(v) },
                onInstall: actionInstall, onRemove: actionRemove, onToggle: actionToggle,
                onBack: function () { setSelected(null) } }) : null,
            ]),
        el('footer', { key: 'f', style: Object.assign({}, MUTED, { padding: '8px 16px', borderTop: '1px solid var(--dsw-alias-border-default, #e8e8e8)', fontSize: '11px' }) },
          '插件为 dsh profile 层插件：安装/移除/启用/禁用经 dsh plugin 命令落地，重启 dsh 后生效'),
        (installProg && installProg.phase && installProg.phase !== 'done' && installProg.phase !== 'error')
          ? el('div', { key: 'prog', style: { padding: '10px 16px', borderTop: '1px solid var(--dsw-alias-border-default, #e8e8e8)', display: 'flex', flexDirection: 'column', gap: '8px' } }, [
              el('div', { key: 'bar', style: { position: 'relative', height: '4px', borderRadius: '2px', overflow: 'hidden', background: 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))' } },
                // pnpm reports `added` only at the very end, so while added==0
                // (still resolving/downloading) show the sliding animation — a
                // determinate fill would sit frozen at 0% and look stuck.
                (installProg.added || 0) > 0
                  ? el('div', { key: 'fill', style: { position: 'absolute', top: '0', left: '0', height: '100%', width: String(Math.min(100, Math.round(100 * (installProg.added || 0) / Math.max(1, installProg.resolved)))) + '%', borderRadius: '2px', background: 'var(--dsw-alias-accent-strong, #4d6bfe)', transition: 'width .3s' } })
                  : el('div', { key: 'slide', className: 'dshd-progress' })),
              el('div', { key: 'txt', style: Object.assign({}, MUTED, { fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '2px' }) }, [
                (installProg.added || 0) > 0
                  ? el('div', { key: 't1' }, '正在安装…（已下载 ' + (installProg.added || 0) + ' / ' + (installProg.resolved || 0) + ' 个包）')
                  : el('div', { key: 't1' },
                      '正在下载 ' + (installProg.package || '插件') + '…（共 ' + (installProg.resolved || 1) + ' 个依赖）'),
                staleSec > 15
                  ? el('div', { key: 'stale', style: { color: '#b45409' } }, '已 ' + staleSec + ' 秒无新进度，网络可能较慢或已中断，请耐心或关闭后重试')
                  : null,
              ]),
            ])
          : null,
      ])
    }

    // Error boundary: any render/effect crash inside the panel shows the
    // message inline instead of blanking the page.
    var PanelBoundary = (function (React) {
      function PB(props) {
        React.Component.call(this, props)
        this.state = { err: null }
      }
      PB.prototype = Object.create(React.Component.prototype)
      PB.prototype.constructor = PB
      PB.getDerivedStateFromError = function (err) { return { err: err } }
      PB.prototype.componentDidCatch = function (err) {
        try { console.log('[dshdesktop] panel error: ' + ((err && err.stack) || err)) } catch (e) { /* noop */ }
      }
      PB.prototype.render = function () {
        if (this.state.err) {
          return el('div', {
            style: { position: 'absolute', inset: '0', zIndex: '1200', background: 'var(--dsw-alias-bg-base, #fff)',
                     color: '#b45409', padding: '24px', font: 'inherit', fontSize: '13px', whiteSpace: 'pre-wrap' },
          }, '插件市场面板错误：\n' + String((this.state.err && this.state.err.stack) || this.state.err))
        }
        return this.props.children
      }
      return PB
    })(React)

    function MarketOverlay() {
      var [open, setOpen] = useState(getMarketOpen())
      useEffect(function () {
        return subscribeMarket(function () { setOpen(getMarketOpen()) })
      }, [])
      // Escape closes (mounted only while open, so the listener is the panel's lifetime).
      useEffect(function () {
        if (!open) return
        function onKey(e) { if (e.key === 'Escape') setMarketOpen(false) }
        document.addEventListener('keydown', onKey)
        return function () { document.removeEventListener('keydown', onKey) }
      }, [open])
      if (!open) return null
      // Full-viewport mask + centered panel, mirroring the dsh settings modal.
      return el('div', { style: { position: 'fixed', inset: '0', zIndex: '1200', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, [
        el('div', { key: 'mask', onClick: function () { setMarketOpen(false) },
          style: { position: 'absolute', inset: '0', background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.24))', backdropFilter: 'var(--dsw-mask-blur, blur(2px))' } }),
        el(PanelBoundary, { key: 'b' }, el(MarketPanel, { onClose: function () { setMarketOpen(false) } })),
      ])
    }

    var overlayRoot = null
    function ensureOverlay() {
      try {
        if (overlayRoot) return
        var el0 = document.createElement('div')
        el0.id = 'dshdesktop-market-overlay'
        document.body.appendChild(el0)
        overlayRoot = createRoot(el0)
        overlayRoot.render(el(MarketOverlay, {}))
      } catch (e) { LOG('overlay mount failed ' + e) }
    }

    // Injected once: modern indeterminate progress bar (accent slide) plus the
    // sidebar footer-action stacking fix shared with @dshd/dsh-usage — the
    // sidebar.footer.action container is a flex row, so multiple full-width
    // entries (插件市场 + 用量) would sit side by side and overlap; stack them.
    function ensureStyles() {
      try {
        if (document.getElementById('dshd-client-styles')) return
        var st = document.createElement('style')
        st.id = 'dshd-client-styles'
        st.textContent =
          '.dshd-progress{position:relative;height:4px;border-radius:2px;overflow:hidden;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}' +
          '.dshd-progress::after{content:"";position:absolute;top:0;left:0;height:100%;width:38%;border-radius:2px;background:var(--dsw-alias-accent-strong,#4d6bfe);animation:dshd-slide 1.1s ease-in-out infinite}' +
          '@keyframes dshd-slide{0%{left:-40%}100%{left:102%}}' +
          '[class*="footerActions"]{flex-direction:column}'
        document.head.appendChild(st)
      } catch (e) { /* best effort */ }
    }

    // ------------------------------------------------------ settings section

    var BTN2 = {
      minHeight: '28px', padding: '0 12px',
      border: '1px solid var(--dsw-alias-border-default, #d8dde3)',
      borderRadius: '8px', background: 'transparent',
      color: 'var(--dsw-alias-label-primary, #1f2329)',
      cursor: 'pointer', font: 'inherit', fontSize: '13px',
    }
    var MUTED2 = { color: 'var(--dsw-alias-label-tertiary, #6b7684)', fontSize: '12px' }

    function KV(props) {
      return el('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline', minHeight: '20px' } }, [
        el('span', { key: 'k', style: Object.assign({}, MUTED2, { flex: '0 0 88px' }) }, props.k),
        el('span', { key: 'v', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: '0', flex: '1 1 auto' } }, props.v),
      ])
    }

    function Block(props) {
      return el('div', { style: { border: '1px solid var(--dsw-alias-border-default, #e5e7eb)', borderRadius: '12px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' } }, [
        el('div', { key: 't', style: { fontWeight: 600, fontSize: '13px', marginBottom: '2px' } }, props.title),
        props.children,
      ])
    }

    function Field(props) {
      return el('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' } }, [
        el('span', { key: 'l', style: Object.assign({}, MUTED2, { fontSize: '11px' }) }, props.label),
        props.children,
      ])
    }

    function Input(props) {
      return el('input', Object.assign({
        style: { border: '1px solid var(--dsw-alias-border-default, #d8dde3)', borderRadius: '8px', padding: '6px 10px', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: '13px', width: '100%', boxSizing: 'border-box' },
      }, props))
    }

    function DesktopSection() {
      var hooksOk = true
      var about = null, setAbout = null
      var config = null, setConfig = null
      var upd = null, setUpd = null
      var updLoading = false, setUpdLoading = null
      var editing = false, setEditing = null
      var form = null, setForm = null
      var saveMsg = null, setSaveMsg = null
      try {
        var a = useState(null); about = a[0]; setAbout = a[1]
        var c = useState(null); config = c[0]; setConfig = c[1]
        var u = useState(null); upd = u[0]; setUpd = u[1]
        var ul = useState(false); updLoading = ul[0]; setUpdLoading = ul[1]
        var ed = useState(false); editing = ed[0]; setEditing = ed[1]
        var fm = useState(null); form = fm[0]; setForm = fm[1]
        var sm = useState(null); saveMsg = sm[0]; setSaveMsg = sm[1]
      } catch (e) {
        hooksOk = false
        LOG('hooks unavailable: ' + e)
      }

      if (hooksOk) {
        useEffect(function () {
          LOG('section mounted, loading about/config')
          callJson('getAbout').then(function (v) { setAbout(v) })
          callJson('getConfig').then(function (v) { setConfig(v) })
        }, [])
        // Escape closes the config modal
        useEffect(function () {
          if (!editing) return
          function onKey(e) { if (e.key === 'Escape') setEditing(false) }
          document.addEventListener('keydown', onKey)
          return function () { document.removeEventListener('keydown', onKey) }
        }, [editing])
      }

      function checkUpdate() {
        if (!hooksOk) return
        setUpdLoading(true)
        callJson('checkUpdate').then(function (v) {
          setUpdLoading(false)
          if (v) setUpd(v)
          else setUpd({ error: '无响应' })
        })
      }

      function openUrl(url) {
        if (!url) return
        var b = bridge()
        if (b && typeof b.openExternal === 'function') { try { b.openExternal(url) } catch (e) { /* noop */ } }
        else { try { window.open(url, '_blank') } catch (e) { /* noop */ } }
      }

      function startEdit() {
        setForm({
          port: config && config.port != null ? String(config.port) : '',
          dshHome: (config && config.dshHome) || '',
          dshBin: (config && config.dshBin) || '',
          nodePath: (config && config.nodePath) || '',
          useNpxFallback: !config || config.useNpxFallback !== false,
          dataDir: (config && config.dataDir) || '',
          logsDir: (config && config.logsDir) || '',
          proxyUrl: (config && config.proxyUrl) || '',
        })
        setSaveMsg(null)
        setEditing(true)
      }

      function saveConfig() {
        if (!form) return
        setSaveMsg('保存中…')
        callJson('saveConfig', JSON.stringify(form)).then(function (v) {
          if (v === 'ok') {
            setEditing(false)
            setSaveMsg('已保存')
            callJson('getConfig').then(function (nv) { if (nv) setConfig(nv) })
          } else {
            setSaveMsg('保存失败：' + ((v && v.error) || '未知错误'))
          }
        })
      }

      function setField(k) {
        return function (e) {
          var v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
          var f = Object.assign({}, form, {})
          f[k] = v
          setForm(f)
        }
      }

      var updateArea
      if (updLoading) {
        updateArea = el('span', { key: 'ul', style: MUTED2 }, '检查中…')
      } else if (upd && upd.error) {
        updateArea = el('span', { key: 'ue', style: { color: '#b45409', fontSize: '12px' } }, '更新检查失败')
      } else if (upd && upd.hasUpdate) {
        updateArea = el('span', { key: 'un', style: { display: 'inline-flex', gap: '8px', alignItems: 'center' } }, [
          el('span', { key: 'txt', style: { fontSize: '12px' } }, '发现新版本 ' + (upd.latest || '')),
          el('button', { key: 'go', type: 'button', style: BTN2, onClick: function () { openUrl(upd.releasesUrl) } }, '去下载'),
        ])
      } else if (upd) {
        updateArea = el('span', { key: 'ok', style: MUTED2 }, '已是最新')
      } else {
        updateArea = el('button', { key: 'chk', type: 'button', style: BTN2, onClick: checkUpdate }, '检查更新')
      }

      var configBody = config
        ? el('div', { key: 'rows', style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, [
            el(KV, { key: 'p', k: '端口', v: String(config.port == null ? '-' : config.port) }),
            el(KV, { key: 'h', k: 'DSH_HOME', v: config.dshHome || '-' }),
            el(KV, { key: 'b', k: 'dsh 入口', v: config.dshBin || '自动探测' }),
            el(KV, { key: 'n', k: 'node', v: config.nodePath || '自动探测' }),
            el(KV, { key: 'x', k: 'npx 回退', v: config.useNpxFallback ? '开启' : '关闭' }),
            el(KV, { key: 'd', k: '数据目录', v: config.dataDir || '-' }),
            el(KV, { key: 'l', k: '日志目录', v: config.effectiveLogsDir || config.logsDir || '-' }),
            el(KV, { key: 'p', k: '下载代理', v: config.proxyUrl || '系统代理' }),
          ])
        : el('div', { key: 'loading', style: MUTED2 }, '配置加载中…')

      // dshd 配置编辑弹窗（统一弹窗编辑所有配置项）
      var configModal = (editing && form)
        ? el('div', { key: 'modal', style: { position: 'fixed', inset: '0', zIndex: '1300', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, [
            el('div', { key: 'mask', onClick: function () { setEditing(false) },
              style: { position: 'absolute', inset: '0', background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.24))', backdropFilter: 'var(--dsw-mask-blur, blur(2px))' } }),
            el('div', { key: 'panel', style: { position: 'relative', zIndex: '1', width: '480px', maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', borderRadius: '16px', background: 'var(--dsw-alias-bg-layer-2, #fff)', boxShadow: 'var(--dsw-shadow-lv3, 0 8px 40px rgba(0,0,0,0.25))', padding: '18px 20px', font: 'inherit', fontSize: '13px' } }, [
              el('div', { key: 'head', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' } }, [
                el('strong', { key: 't', style: { fontSize: '15px' } }, '编辑 dshd 配置'),
                el('button', { key: 'x', type: 'button', style: Object.assign({}, BTN2, { minWidth: '28px', padding: '0 8px' }), onClick: function () { setEditing(false) } }, '✕'),
              ]),
              el('div', { key: 'body', style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
                el(Field, { key: 'port', label: '服务端口' }, el(Input, { type: 'number', value: form.port, onChange: setField('port'), min: '1', max: '65535' })),
                el(Field, { key: 'dsh', label: 'dsh 入口（bin.js 路径，留空 = 自动探测）' }, el(Input, { type: 'text', value: form.dshBin, onChange: setField('dshBin'), placeholder: '自动探测' })),
                el(Field, { key: 'node', label: 'node.exe 路径（留空 = 自动探测）' }, el(Input, { type: 'text', value: form.nodePath, onChange: setField('nodePath'), placeholder: '自动探测' })),
                el(Field, { key: 'home', label: 'DSH_HOME（留空 = ~/.dsh）' }, el(Input, { type: 'text', value: form.dshHome, onChange: setField('dshHome'), placeholder: '~/.dsh' })),
                el(Field, { key: 'data', label: '数据目录（留空 = 默认 %LOCALAPPDATA%\\DSHDesktop，重启生效）' }, el(Input, { type: 'text', value: form.dataDir, onChange: setField('dataDir'), placeholder: (config && config.dataDir) || '' })),
                el(Field, { key: 'log', label: '日志目录（留空 = 数据目录\\logs）' }, el(Input, { type: 'text', value: form.logsDir, onChange: setField('logsDir'), placeholder: (config && config.effectiveLogsDir) || '' })),
                el(Field, { key: 'proxy', label: '下载代理（如 http://127.0.0.1:7890，留空 = 系统代理环境变量）' }, el(Input, { type: 'text', value: form.proxyUrl, onChange: setField('proxyUrl'), placeholder: 'http://127.0.0.1:7890' })),
                el('label', { key: 'npx', style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' } }, [
                  el('input', { type: 'checkbox', checked: form.useNpxFallback, onChange: setField('useNpxFallback') }),
                  '允许 npx 在线下载 dsh（首次联网）',
                ]),
              ]),
              saveMsg ? el('div', { key: 'msg', style: Object.assign({}, MUTED2, { fontSize: '12px', marginTop: '8px' }) }, saveMsg) : null,
              el('div', { key: 'btns', style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px' } }, [
                el('button', { key: 'cancel', type: 'button', style: BTN2, onClick: function () { setEditing(false); setSaveMsg(null) } }, '取消'),
                el('button', { key: 'ok', type: 'button', style: Object.assign({}, BTN2, { borderColor: 'var(--dsw-alias-border-strong, #b0b7c3)' }), onClick: saveConfig }, '保存'),
              ]),
            ]),
          ])
        : null

      return el('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 0 12px' },
      }, [
        el('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          el(MarketGlyph, { key: 'i', size: 16 }),
          el('strong', { key: 't' }, 'DSH Desktop'),
        ]),
        el(Block, { key: 'about', title: '软件介绍' }, [
          el('div', { key: 'verrow', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
            el('span', { key: 'vk', style: Object.assign({}, MUTED2, { flex: '0 0 88px' }) }, '版本'),
            el('span', { key: 'vv', style: { fontWeight: 600 } }, (about && about.version) ? about.version : '…'),
            updateArea,
          ]),
          el('div', { key: 'auth', style: { display: 'flex', gap: '8px', alignItems: 'baseline' } }, [
            el('span', { key: 'k', style: Object.assign({}, MUTED2, { flex: '0 0 88px' }) }, '作者'),
            el('span', { key: 'v' }, 'Ackow'),
          ]),
          el('div', { key: 'ghrow', style: { display: 'flex', gap: '8px', alignItems: 'baseline' } }, [
            el('span', { key: 'k', style: Object.assign({}, MUTED2, { flex: '0 0 88px' }) }, 'GitHub 仓库'),
            el('a', { key: 'v', href: (about && about.repoUrl) || '#', target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-accent-strong, #4d6bfe)', cursor: 'pointer', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: '0', flex: '1 1 auto' } },
              (about && about.repoUrl) || '…'),
          ]),
        ]),
        el(Block, { key: 'cfg', title: 'dshd 配置' }, [
          configBody,
          el('div', { key: 'btns', style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '2px', alignItems: 'center' } }, [
            el('button', { key: 'edit', type: 'button', style: BTN2, onClick: startEdit }, '编辑配置'),
            el('button', { key: 'logdir', type: 'button', style: BTN2, onClick: function () { call('openLogsFolder') } }, '打开日志目录'),
          ]),
          saveMsg ? el('div', { key: 'msg', style: Object.assign({}, MUTED2, { fontSize: '12px' }) }, saveMsg) : null,
        ]),
        configModal,
      ])
    }

    // ---------------------------------------------------------------- apply

    function apply(ctx) {
      var slots = ctx.slots
      LOG('apply: slots=' + (!!slots))
      ensureOverlay()
      ensureStyles()

      ctx.effect(function () {
        slots.inject('sidebar.footer.action', function () {
          LOG('footer.action declared, registering')
          return slots.register({
            name: 'sidebar.footer.action',
            id: 'dshdesktop-marketplace',
            order: 80,
          }, FooterEntry)
        })
      }, 'dshdesktop: footer entry')

      ctx.effect(function () {
        slots.inject('settings.section', function () {
          LOG('settings.section declared, registering')
          return slots.register({
            name: 'settings.section',
            id: 'dshd-desktop',
            order: 200,
            label: 'DSH Desktop',
          }, DesktopSection)
        })
      }, 'dshdesktop: settings section')
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
