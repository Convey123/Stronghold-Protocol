// Which server a client talks to (public/js/serverConfig.js, docs/APP.md): a browser tab uses its own origin, a
// packaged app (Electron / Android) carries the client locally and names the server — window.__SP_APP__.server at
// build time, `?server=`, or the address saved in the settings screen.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeServerBase, serverBase, displayServer, wsUrlFor, setServerBase, appInfo, SERVER_KEY,
  localServer, offlineAvailable, offlineMode, setOfflineMode, OFFLINE_KEY,
} from '../../public/js/serverConfig.js';

/** Minimal window/storage doubles. */
const fakeWin = ({ app = null, href = 'http://127.0.0.1:41234/index.html', stored = null, offline = null, local = null } = {}) => {
  const store = new Map();
  if (stored != null) store.set(SERVER_KEY, stored);
  if (offline != null) store.set(OFFLINE_KEY, offline);
  return {
    __SP_APP__: app,
    __SP_LOCAL__: local == null ? undefined : { server: local, kind: 'desktop' },
    location: { href, origin: href.replace(/\/index\.html$/, ''), host: new URL(href).host, protocol: new URL(href).protocol },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      get _map() { return store; },
    },
  };
};

describe('server address of a client', () => {
  test('normalizeServerBase: origins only, bare host:port gets http, junk is dropped', () => {
    assert.equal(normalizeServerBase(''), '');
    assert.equal(normalizeServerBase(null), '');
    assert.equal(normalizeServerBase('http://example.com:3000'), 'http://example.com:3000');
    assert.equal(normalizeServerBase('http://example.com:3000/'), 'http://example.com:3000');
    assert.equal(normalizeServerBase('http://example.com:3000/ws'), 'http://example.com:3000', 'a path is dropped: the client uses /ws, /data/…');
    assert.equal(normalizeServerBase('example.com:3000'), 'http://example.com:3000', 'what players type');
    assert.equal(normalizeServerBase('  192.168.1.9:3000  '), 'http://192.168.1.9:3000');
    assert.equal(normalizeServerBase('https://game.example.com'), 'https://game.example.com');
    assert.equal(normalizeServerBase('ws://x:3000'), '', 'not an http origin');
    assert.equal(normalizeServerBase('ftp://x'), '');
    assert.equal(normalizeServerBase('nonsense value'), '');
  });

  test('serverBase: injected app config, then ?server=, then the saved address, else same origin', () => {
    assert.equal(serverBase({ win: fakeWin() }), '', 'a browser tab served by the server: same origin');
    assert.equal(serverBase({ win: fakeWin({ stored: 'http://10.0.0.5:3000' }) }), 'http://10.0.0.5:3000');
    const q = fakeWin({ stored: 'http://10.0.0.5:3000', href: 'http://127.0.0.1:41234/index.html?server=192.168.1.9:3000' });
    assert.equal(serverBase({ win: q }), 'http://192.168.1.9:3000', 'the query beats the saved address');
    const app = fakeWin({ app: { kind: 'android', server: 'http://example.com:3000' }, stored: 'http://10.0.0.5:3000', href: 'http://localhost/index.html?server=1.2.3.4:3000' });
    assert.equal(serverBase({ win: app }), 'http://example.com:3000', 'the build-time address beats everything');
    assert.equal(appInfo(app), app.__SP_APP__);
    assert.equal(appInfo(fakeWin()), null);
  });

  test('displayServer shows the saved/injected address, else the page origin', () => {
    assert.equal(displayServer({ win: fakeWin({ app: { server: 'http://a.b:3000' } }) }), 'http://a.b:3000');
    assert.equal(displayServer({ win: fakeWin() }), 'http://127.0.0.1:41234');
    assert.equal(displayServer({ win: { } }), '');
  });

  test('wsUrlFor: the server base wins, otherwise the page (http ⇒ ws, https ⇒ wss)', () => {
    assert.equal(wsUrlFor('http://example.com:3000'), 'ws://example.com:3000/ws');
    assert.equal(wsUrlFor('https://game.example.com'), 'wss://game.example.com/ws');
    assert.equal(wsUrlFor('', { protocol: 'http:', host: '192.168.1.9:3000' }), 'ws://192.168.1.9:3000/ws');
    assert.equal(wsUrlFor('', { protocol: 'https:', host: 'game.example.com' }), 'wss://game.example.com/ws');
    assert.equal(wsUrlFor('', null), 'ws://localhost:3000/ws');
    assert.equal(wsUrlFor('a bare host name', { protocol: 'http:', host: 'x:1' }), 'ws://x:1/ws', 'an unusable base falls back to the page');
    assert.equal(wsUrlFor('myserver:3000', { protocol: 'http:', host: 'x:1' }), 'ws://myserver:3000/ws', 'a LAN hostname is a real address');
  });

  test('setServerBase saves an origin and clears it for same origin', () => {
    const win = fakeWin();
    assert.equal(setServerBase('192.168.1.9:3000', { win }), 'http://192.168.1.9:3000');
    assert.equal(win.localStorage.getItem(SERVER_KEY), 'http://192.168.1.9:3000');
    assert.equal(setServerBase('', { win }), '');
    assert.equal(win.localStorage.getItem(SERVER_KEY), null);
    assert.equal(setServerBase('not a host', { win }), '', 'invalid input clears instead of storing junk');
  });
});

describe('离线游玩 (packaged desktop apps bring their own server)', () => {
  test('the wrapper publishes its in-process server, nothing else does', () => {
    assert.equal(localServer({ win: fakeWin() }), '', 'a browser has no local server');
    assert.equal(offlineAvailable({ win: fakeWin() }), false);
    assert.equal(localServer({ win: fakeWin({ local: 'http://127.0.0.1:45829' }) }), 'http://127.0.0.1:45829');
    assert.equal(offlineAvailable({ win: fakeWin({ local: 'http://127.0.0.1:45829' }) }), true);
    assert.equal(localServer({ win: fakeWin({ local: 'garbage value' }) }), '', 'a broken value is ignored');
  });

  test('offlineMode needs both the local server and the saved choice', () => {
    const local = { local: 'http://127.0.0.1:45829' };
    assert.equal(offlineMode({ win: fakeWin(local) }), false, 'default is 联机');
    assert.equal(offlineMode({ win: fakeWin({ ...local, offline: '1' }) }), true);
    assert.equal(offlineMode({ win: fakeWin({ ...local, offline: 'true' }) }), true);
    assert.equal(offlineMode({ win: fakeWin({ ...local, offline: '0' }) }), false);
    assert.equal(offlineMode({ win: fakeWin({ offline: '1' }) }), false, 'a browser never plays offline');
  });

  test('the local server wins over every configured address while offline', () => {
    const win = fakeWin({
      app: { kind: 'desktop', server: 'http://example.com:3000' },
      href: 'http://127.0.0.1:41234/index.html?server=10.0.0.5:3000',
      stored: 'http://192.168.1.9:3000',
      local: 'http://127.0.0.1:45829',
      offline: '1',
    });
    assert.equal(serverBase({ win }), 'http://127.0.0.1:45829');
    assert.equal(displayServer({ win }), 'http://127.0.0.1:45829');
    assert.equal(wsUrlFor(serverBase({ win })), 'ws://127.0.0.1:45829/ws');
    // back to 联机: the injected address wins again
    assert.equal(setOfflineMode(false, { win }), false);
    assert.equal(offlineMode({ win }), false);
    assert.equal(serverBase({ win }), 'http://example.com:3000');
  });

  test('setOfflineMode stores the choice, and refuses it without a local server', () => {
    const win = fakeWin({ local: 'http://127.0.0.1:45829' });
    assert.equal(setOfflineMode(true, { win }), true);
    assert.equal(win.localStorage.getItem(OFFLINE_KEY), '1');
    assert.equal(setOfflineMode(false, { win }), false);
    assert.equal(win.localStorage.getItem(OFFLINE_KEY), null);
    const browser = fakeWin();
    assert.equal(setOfflineMode(true, { win: browser }), false, 'nothing to switch to in a browser');
    assert.equal(browser.localStorage.getItem(OFFLINE_KEY), null);
  });
});
