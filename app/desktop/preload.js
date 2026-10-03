// Preload of the desktop shell (docs/APP.md §10): publishes the in-process game server to the client.
//
// The main process starts the game server itself (`server/index.js`, SP_WEB=0) for 离线游玩, on a random loopback port.
// The client reads it through `window.__SP_LOCAL__.server` (public/js/serverConfig.js): choosing 离线游玩 on the title
// screen makes the whole client — socket, session, room — run against this machine instead of a remote server.
//
// Sandboxed preload: only `contextBridge` / `ipcRenderer` are used, nothing else is exposed.

const { contextBridge, ipcRenderer } = require('electron');

let local = null;
try {
  const port = ipcRenderer.sendSync('sp:local-server');
  if (Number.isInteger(port) && port > 0) local = { server: `http://127.0.0.1:${port}`, kind: 'desktop' };
} catch { /* no local server: the client just offers 联机 */ }

if (local) {
  try { contextBridge.exposeInMainWorld('__SP_LOCAL__', local); } catch { /* ignore */ }
}
