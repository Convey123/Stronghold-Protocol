// Which game server this client talks to (docs/APP.md).
//
// In a browser the client is served *by* the game server, so "same origin" is always right and nothing here matters.
// A packaged app (Electron / Android) carries the whole client and its assets locally, so the WebSocket — the only
// thing that still needs the server (rooms, rounds, economy; battles are simulated in the client, DESIGN §14) — has to
// name the server explicitly.
//
// Packaged desktop clients can also play **offline**: the Electron shell runs the game server in-process (a local
// 127.0.0.1 port) for solo matches and AI teammates, and the player picks 离线游玩 on the title screen. That choice is
// stored in localStorage (`sp.offline`) and `serverBase()` then returns the wrapper's local server instead — the
// wrapper publishes it as `window.__SP_LOCAL__ = { server }` (app/desktop/preload.js).
//
// Resolution order (first non-empty wins):
//   1. the wrapper's local server — 离线游玩 (window.__SP_LOCAL__.server, desktop only, app/desktop/preload.js)
//   2. `window.__SP_APP__.server`  — injected by the bundle at build time (tools/build-client-app.mjs) or by a wrapper
//   3. `?server=http://host:3000`  — a link that points a client at another server
//   4. localStorage `sp.server`    — what the settings screen (设定 → 服务器地址) saved
//   5. the page's own origin       — a browser tab served by the game server
//
// A base is either '' (same origin) or an absolute http(s) origin such as 'http://localhost:3000' (no path: the
// client uses /ws, /data/… absolute paths, so the server must live at the root of its origin — docs/DEPLOY.md §2.4).

/** localStorage key of the server address chosen in the settings. */
export const SERVER_KEY = 'sp.server';
/** localStorage key of the mode switch: '1' = 离线游玩 (the desktop wrapper's own server), absent = 联机. */
export const OFFLINE_KEY = 'sp.offline';

/**
 * Normalize a user- or build-supplied server address.
 * @param {any} v
 * @returns {string} '' (same origin) or 'http(s)://host[:port]' without a trailing slash
 */
export function normalizeServerBase(v) {
  if (typeof v !== 'string') return '';
  let s = v.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) {
    // a bare 'host:port' (or 'host') is what players type: assume http
    if (/^[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(s)) s = `http://${s}`;
    else return '';
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `${u.protocol}//${u.host}`;
  } catch { return ''; }
}

/**
 * The wrapper's own game server, when it runs one (Electron starts it in-process for offline play, docs/APP.md §10).
 * @param {{ win?: any }} [o]
 * @returns {string} '' when this client has no local server (browser, Android)
 */
export function localServer(o = {}) {
  const win = o.win ?? globalThis;
  return normalizeServerBase(win?.__SP_LOCAL__?.server);
}

/** Can this client play offline at all (a wrapper that brought its own server)? */
export function offlineAvailable(o = {}) {
  return !!localServer(o);
}

/** Is 离线游玩 currently selected (and still possible)? */
export function offlineMode(o = {}) {
  const win = o.win ?? globalThis;
  if (!localServer(o)) return false;
  try {
    const st = (o.storage ?? win?.localStorage)?.getItem?.(OFFLINE_KEY);
    return st === '1' || st === 'true';
  } catch { return false; }
}

/**
 * Switch 联机 / 离线游玩. Stored in localStorage and applied on the next load (the socket, the session and the whole
 * room belong to one server, so the settings screen reloads after switching).
 * @param {boolean} on
 * @param {{ win?: any }} [o]
 * @returns {boolean} the stored state
 */
export function setOfflineMode(on, o = {}) {
  const win = o.win ?? globalThis;
  const want = !!on && offlineAvailable(o);
  try {
    if (want) win.localStorage?.setItem?.(OFFLINE_KEY, '1');
    else win.localStorage?.removeItem?.(OFFLINE_KEY);
  } catch { /* ignore */ }
  return want;
}

/** Is this client a packaged app (wrapper injected `window.__SP_APP__`)? */
export function appInfo(win = globalThis) {
  const a = win?.__SP_APP__;
  return a && typeof a === 'object' ? a : null;
}

/**
 * The server base for this client ('' = same origin).
 * @param {{ win?: any, storage?: any }} [o]
 * @returns {string}
 */
export function serverBase(o = {}) {
  const win = o.win ?? globalThis;
  // 离线游玩：用外壳自己起的本机服务器（单人 + AI 队友），不碰任何远端地址
  if (offlineMode(o)) return localServer(o);
  const fromApp = normalizeServerBase(appInfo(win)?.server);
  if (fromApp) return fromApp;
  try {
    const href = win?.location?.href;
    if (typeof href === 'string') {
      const q = new URL(href).searchParams.get('server');
      const fromQuery = normalizeServerBase(q);
      if (fromQuery) return fromQuery;
    }
  } catch { /* ignore */ }
  try {
    const st = o.storage ?? win?.localStorage;
    const fromStore = normalizeServerBase(st?.getItem?.(SERVER_KEY));
    if (fromStore) return fromStore;
  } catch { /* ignore */ }
  return '';
}

/** The address to show in the settings: the saved/injected one, else the page's own origin. */
export function displayServer(o = {}) {
  const win = o.win ?? globalThis;
  if (offlineMode(o)) return localServer(o);
  const base = serverBase(o);
  if (base) return base;
  try { return typeof win?.location?.origin === 'string' ? win.location.origin : ''; } catch { return ''; }
}

/**
 * WebSocket URL of the game server's `/ws` for a base ('' = the page's own origin).
 * @param {string} base
 * @param {{ protocol?: string, host?: string }} [loc]
 * @returns {string}
 */
export function wsUrlFor(base, loc = globalThis.location) {
  const b = normalizeServerBase(base);
  if (b) return `${b.replace(/^http/i, 'ws')}/ws`;
  if (!loc || !loc.host) return 'ws://localhost:3000/ws';
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

/**
 * Save the server address ('' clears it → same origin) and reconnect by reloading the page.
 * @param {string} v
 * @param {{ win?: any }} [o]
 * @returns {string} the stored value
 */
export function setServerBase(v, o = {}) {
  const win = o.win ?? globalThis;
  const base = normalizeServerBase(v);
  try {
    if (base) win.localStorage?.setItem?.(SERVER_KEY, base);
    else win.localStorage?.removeItem?.(SERVER_KEY);
  } catch { /* ignore */ }
  return base;
}
