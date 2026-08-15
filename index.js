/**
 * Host-half entry of @dshd/dshdesktop-client (thin).
 *
 * The cordis loader imports the package root on the HOST side; this file is
 * that entry. The browser-half lives in client.js (exported as "./client" and
 * injected into the dsh web page via the `dsh.client` manifest) where it
 * registers the sidebar.footer.action marketplace button.
 */
export const name = 'dshd-desktop-client'

export function apply() {
  // No host-side capabilities needed: the desktop shell owns the bridge
  // (chrome.webview.hostObjects.dshdesktop) and the marketplace window.
}