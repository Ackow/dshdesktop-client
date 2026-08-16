# dshdesktop-client

![dshdesktop-client](assets/social-preview.png)

<p align="center">
  <a href="README.md">简体中文</a> | <strong>English</strong>
</p>

<p align="center">
  <strong>The official DSH Desktop client plugin: brings the "Plugin Marketplace" and "DSH Desktop Settings" into the dsh web sidebar.</strong><br>
  Discover, install, update, enable and disable plugins in one place — and the settings panel shares the same host bridge as the desktop app.
</p>

`dshdesktop-client` injects two entry points through the official dsh slots mechanism:

- A **"Plugin Marketplace" button above the sidebar settings button** (`sidebar.footer.action`) — opens the in-page marketplace panel;
- A new **"DSH Desktop" section in the dsh settings panel** (`settings.section`) — shows the app intro and dshd configuration.

All capabilities communicate with the DSH Desktop main window through `chrome.webview.hostObjects.dshdesktop` (GitHub discovery, `dsh plugin` installs, and environment/config read/write all happen on the host side) — **the browser side performs no privileged operations**.

## Marketplace panel

![Marketplace panel: search + category cards on the Discover tab + detail sidebar](assets/market-discover.png)

> ⚠️ **Installation is still being polished — stay tuned.** The Discover tab supports browsing, searching and viewing details; install / update / enable-disable flows are still being refined, and some plugins (e.g. git-hosted installs, packages with build scripts) may not install cleanly yet. We recommend starting with the official plugins (`@dshd/dshdesktop-client`, `@dshd/dsh-usage`) to experience the full flow.

### Discover

- **Sources**: GitHub topic search (default `dsh-plugin` / `dsh-plugins`, configurable) + community seed catalog, sorted by stars, deduplicated, cached locally (24h, falls back to cache when offline)
- **Filtering**: only repos tagged with `dsh-plugin`/`dsh-plugins` are kept — non-plugin projects found via broad topics (e.g. `deepseek-harness`) never show up
- **Search**: real-time filtering by name / description / repo / tags
- **Details**: repo / stars / license / source / trust / archived + tags; the install command is **auto-extracted from the repo README** (`dsh plugin --profile web add <pkg>`), editable by hand

### Installed

![Installed tab: list + check for updates + restart now](assets/market-installed.png)

- Lists installed plugins: version / activation method (bundle startup / client patch) / enabled state
- **Enable / Disable / Remove** (persisted via `dsh plugin`, takes effect after restarting dsh)
- **Check for updates**: queries the npm registry per plugin and compares versions; shows "update available vX" with an update button when a newer version exists
- **Restart now**: kills the old dsh process and relaunches it with the latest config (activation changes take effect immediately)
- Installations show a **live progress bar** (resolve dependencies → download → write to disk); closing the panel keeps the install running in the background, with a tray bubble notification when it finishes

## DSH Desktop settings section

![Settings: app intro + dshd config](assets/settings.png)

- **App intro**: version (with a "check for updates" action), author, GitHub repository link
- **dshd config**: port / DSH_HOME / dsh entry / node / npx fallback / data directory / log directory / download proxy — all editable in one "Edit config" dialog; changing the data directory **auto-migrates old data**

## Mechanics & data

- **Bridge**: `chrome.webview.hostObjects.dshdesktop` (host object, must be injected before navigation); the marketplace catalog, plugin lifecycle and config read/write all live on the host side
- **Activation**: dsh plugin system — packages declaring `dsh.bundle` go through `dsh.profile.bundles`, pure `dsh.client` packages use the DSH Desktop activation patch; **packages without dsh markers are not activated** (dsh refuses to load bundles lacking `dsh.bundle` and crashes on startup)
- **git installs**: after installing `github:owner/repo`, the real package name is resolved from the package's own `package.json` `name`; bundles/patch files record the real name, not the `github:` prefix
- **Download proxy**: direct connection by default (same as the terminal); when the network is restricted, fill in a proxy in the config (e.g. `http://127.0.0.1:7890`), which is passed to pnpm via the `HTTP(S)_PROXY` environment variables

## Installation

```sh
dsh plugin --profile web add @dshd/dshdesktop-client
# After restarting dsh web, the "Plugin Marketplace" button appears above the settings button,
# and "DSH Desktop" appears in the settings panel.
```

DSH Desktop auto-installs this plugin on first launch (`EntryInstaller`: installs it + writes the activation patch + adds it to `patchFiles`).

## Development

```sh
# Install from a local directory (skips npm)
mkdir -p ~/.dsh/profiles/web/node_modules/@dshd/dshdesktop-client
cp package.json index.js client.js ~/.dsh/profiles/web/node_modules/@dshd/dshdesktop-client/
# Add @dshd/dshdesktop-client to the dependencies of ~/.dsh/profiles/web/package.json
# and to the DSH Desktop activation patch
# After changes, re-cp and restart dsh web to apply
```

- `client.js` — dsh client plugin entry (ESM, `apply`/`inject`; marketplace panel + settings section)
- `index.js` — thin host-side entry (no host logic; the bridge is injected by the desktop app)
- `publish.ps1` — one-command publish to the public npm registry (run after `npm login`)

## Configuration

| Item | Description | Default |
|---|---|---|
| `marketplaceTopics` | GitHub discovery topic list | `dsh-plugin`, `dsh-plugins` |
| `marketplaceCacheHours` | Marketplace cache hours | `24` |
| `githubToken` | GitHub token (raises rate limits), or `GH_TOKEN` | — |
| `proxyUrl` | Download proxy (leave empty for direct connection) | — |

## License

[MIT](LICENSE) — Copyright (c) 2026 Ackow.
