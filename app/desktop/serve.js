// Local static server of the desktop client (docs/APP.md).
//
// A packaged app cannot load the bundle over `file://`: the client uses absolute URLs (/js/…, /assets/…, /data/…,
// /sim/…), which only resolve against a real origin. So the Electron main process serves the bundle from
// http://127.0.0.1:<port>/ and loads that — the WebSocket still goes to the game server named in the settings
// (public/js/serverConfig.js), which is why the app keeps working when the server moves.
//
// The port is stable across launches (it is remembered in the app's userData), so the page origin — and with it
// localStorage: player name, session token, server address, settings — survives a restart.
//
// Dependency-free on purpose: it is plain Node, unit-tested in test/app/desktop-serve.test.js without Electron.

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/** Content types the client needs (the game server's MIME table, kept minimal here). */
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.atlas': 'text/plain; charset=utf-8',
  '.skel': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
});

const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

/**
 * Resolve a request path inside the bundle (traversal- and dotfile-safe).
 * @param {string} dir bundle root
 * @param {string} urlPath decoded path, e.g. '/js/net.js'
 * @returns {string|null} absolute file path, or null when it escapes the bundle
 */
function resolveInside(dir, urlPath) {
  let p = String(urlPath || '/').split('?')[0];
  try { p = decodeURIComponent(p); } catch { return null; }
  if (p.includes('\0')) return null;
  const segments = p.split('/').filter((s) => s && s !== '.');
  if (segments.some((s) => s === '..' || s.startsWith('.'))) return null;
  const abs = path.resolve(dir, ...segments);
  const root = path.resolve(dir);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

/**
 * Start the local server.
 * @param {{ dir: string, preferredPort?: number|null, log?: (m: string) => void }} o
 * @returns {Promise<{ url: string, port: number, address: string, close: () => Promise<void> }>}
 */
async function createClientServer({ dir, preferredPort = null, log = () => {} }) {
  const root = path.resolve(dir);
  const st = await fsp.stat(root).catch(() => null);
  if (!st || !st.isDirectory()) throw new Error(`client bundle not found: ${root} (build it with tools/build-client-app.mjs)`);
  const index = await fsp.stat(path.join(root, 'index.html')).catch(() => null);
  if (!index) throw new Error(`client bundle has no index.html: ${root}`);

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end('method not allowed'); return; }
      let file = resolveInside(root, req.url || '/');
      if (!file) { res.writeHead(403).end('forbidden'); return; }
      let stat = await fsp.stat(file).catch(() => null);
      if (stat && stat.isDirectory()) { file = path.join(file, 'index.html'); stat = await fsp.stat(file).catch(() => null); }
      if (!stat || !stat.isFile()) { res.writeHead(404).end('not found'); return; }
      const headers = {
        'content-type': mimeOf(file),
        'content-length': String(stat.size),
        // assets never change without a rebuild; code/data must revalidate so an app update is picked up
        'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=86400' : 'no-cache',
        'accept-ranges': 'bytes',
      };
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
        if (!(start <= end) || start >= stat.size) { res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end(); return; }
        res.writeHead(206, { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${stat.size}` });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      try { res.writeHead(500).end('internal error'); } catch { /* ignore */ }
      log(`[client] ${req.url} failed: ${err.message}`);
    }
  });

  const port = await listen(server, preferredPort);
  const address = `127.0.0.1:${port}`;
  log(`[client] serving ${root} at http://${address}/`);
  return {
    url: `http://${address}/`,
    port,
    address,
    close: () => new Promise((resolve) => { try { server.close(() => resolve()); } catch { resolve(); } }),
  };
}

/** Listen on `preferredPort` when it is free, else on any free port. */
function listen(server, preferredPort) {
  return new Promise((resolve, reject) => {
    const attempts = [];
    if (Number.isInteger(preferredPort) && preferredPort > 0 && preferredPort < 65536) attempts.push(preferredPort);
    attempts.push(0); // 0 = any free port
    const tryNext = () => {
      const port = attempts.shift();
      if (port === undefined) { reject(new Error('no free port for the client server')); return; }
      const onError = (err) => {
        server.removeListener('listening', onOk);
        if (err && err.code === 'EADDRINUSE') tryNext();
        else reject(err);
      };
      const onOk = () => {
        server.removeListener('error', onError);
        resolve(server.address().port);
      };
      server.once('error', onError);
      server.once('listening', onOk);
      server.listen(port, '127.0.0.1');
    };
    tryNext();
  });
}

module.exports = { createClientServer, resolveInside, mimeOf, MIME };
