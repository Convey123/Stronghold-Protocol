// Electron main process of the desktop client (docs/APP.md).
//
// The app is a thin shell around the bundled web client: it starts the local static server (serve.js) on a stable
// port, loads it in a window and lets the client talk to the game server named in 设置 → 服务器地址 (the bundle injects
// a default, the player can change it at runtime). Everything else — art, audio, the battle simulation — is local, so
// the server only sees JSON and the WebSocket.
//
// It also brings its own game server (runtime/, SP_WEB=0) on a random loopback port: choosing 离线游玩 on the title
// screen runs solo matches and AI teammates entirely on this machine, with no network at all (docs/APP.md §10). The
// preload publishes that port to the client; nothing of it is used while 联机 is selected.

const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { createClientServer } = require('./serve.js');

/** Preferred local port: remembered in userData so the page origin (and localStorage) is stable across launches. */
const PORT_FILE = path.join(app.getPath('userData'), 'client-port.json');
const DEFAULT_PORT = 45123;

function readPort() {
  try {
    const n = JSON.parse(fs.readFileSync(PORT_FILE, 'utf8')).port;
    if (Number.isInteger(n) && n > 1024 && n < 65536) return n;
  } catch { /* first run */ }
  return DEFAULT_PORT;
}

function writePort(port) {
  try { fs.mkdirSync(path.dirname(PORT_FILE), { recursive: true }); fs.writeFileSync(PORT_FILE, JSON.stringify({ port })); } catch { /* ignore */ }
}

/** The bundled client: ../build/client in a checkout, resources/client in a packaged app. */
function bundleDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'client')
    : path.resolve(__dirname, '..', 'build', 'client');
}

let server = null;
let win = null;
let localGame = null;      // in-process game server for 离线游玩 (runtime/server/index.js)
let localGamePort = 0;

/** Folder of the bundled game server: runtime/ next to the app in a packaged build, ../runtime in a checkout. */
function runtimeDir() {
  return app.isPackaged ? path.join(app.getAppPath(), 'runtime') : path.resolve(__dirname, 'runtime');
}

/**
 * Start the in-process game server (单人 / AI 队友，离线可玩). Failures are not fatal: the client then only offers 联机.
 * @returns {Promise<void>}
 */
async function startLocalGame() {
  try {
    const entry = path.join(runtimeDir(), 'server', 'index.js');
    if (!fs.existsSync(entry)) { console.log('[offline] runtime missing, 离线游玩 unavailable:', entry); return; }
    const mod = await import(pathToFileURL(entry).href);
    const srv = await mod.startServer({ port: 0, host: '127.0.0.1', quiet: true, web: false });
    localGame = srv;
    localGamePort = srv.port;
    console.log(`[offline] local game server on http://127.0.0.1:${localGamePort}/ws`);
  } catch (err) {
    console.log('[offline] local game server failed to start:', err && err.message);
    localGame = null;
    localGamePort = 0;
  }
}

ipcMain.on('sp:local-server', (e) => { e.returnValue = localGamePort || 0; });

async function openWindow() {
  await startLocalGame();
  let port = readPort();
  try {
    server = await createClientServer({ dir: bundleDir(), preferredPort: port, log: (m) => console.log(m) });
  } catch (err) {
    dialog.showErrorBox('卫戍协议：盟约 — 客户端资源缺失', `${err.message}\n\n请重新安装，或先用 tools/build-client-app.mjs 生成客户端包。`);
    app.quit();
    return;
  }
  if (server.port !== port) writePort(server.port);

  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0c0f0e',
    title: '卫戍协议：盟约',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // the battle is simulated in this renderer (DESIGN §14): never throttle its timers when the window is not focused
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  // links (guide, GitHub) open in the system browser, never in the app window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!server || !url.startsWith(server.url)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  await win.loadURL(server.url);
}

function buildMenu() {
  const send = (channel) => () => { win?.webContents.send(channel); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '游戏',
      submenu: [
        { label: '重新载入', accelerator: 'CmdOrCtrl+R', click: () => win?.reload() },
        {
          label: '游玩方式：联机 / 离线',
          click: () => win?.webContents.executeJavaScript(
            `import('/js/serverConfig.js').then((m) => { m.setOfflineMode(!m.offlineMode()); location.reload(); })`).catch(() => {}),
        },
        { label: '全屏', accelerator: 'F11', click: () => win?.setFullScreen(!win.isFullScreen()) },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', click: () => win?.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5) },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => win?.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5) },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', click: () => win?.webContents.setZoomLevel(0) },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'F12', click: () => win?.webContents.toggleDevTools() },
      ],
    },
    { label: '帮助', submenu: [{ label: '项目主页', click: () => shell.openExternal('https://github.com/sganggs/Stronghold-Protocol') }, { label: '玩法说明在游戏内（设置 → 玩法说明）', enabled: false }] },
  ]));
  void send;
}

// one instance only: a second launch focuses the running window (its local server holds the port)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    buildMenu();
    await openWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) openWindow(); });
  });
  app.on('window-all-closed', async () => {
    try { await server?.close(); } catch { /* ignore */ }
    try { await localGame?.close(); } catch { /* ignore */ }
    app.quit();
  });
}
