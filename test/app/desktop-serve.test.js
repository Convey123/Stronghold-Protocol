// The desktop client's local static server (app/desktop/serve.js, docs/APP.md): a packaged app cannot use file://
// (the client fetches /js/…, /assets/…, /data/… absolutely), so the Electron shell serves the bundle over
// http://127.0.0.1:<port>/ — this is the part that can be tested without Electron.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClientServer, resolveInside, mimeOf } = require('../../app/desktop/serve.js');

let dir = null;
let server = null;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sp-client-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>客户端</title>');
  writeFileSync(join(dir, 'data.js'), 'export const x = 1;\n');
  mkdirSync(join(dir, 'js'), { recursive: true });
  writeFileSync(join(dir, 'js', 'boot.js'), 'console.log(1)\n');
  mkdirSync(join(dir, 'assets', 'audio'), { recursive: true });
  writeFileSync(join(dir, 'assets', 'audio', 'a.mp3'), Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6]));
  mkdirSync(join(dir, 'sim', 'content'), { recursive: true });
  writeFileSync(join(dir, 'sim', 'content', 'support.js'), 'export {};\n');
  writeFileSync(join(dir, '.hidden'), 'no');
  server = await createClientServer({ dir });
});

after(async () => {
  try { await server?.close(); } catch { /* ignore */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('desktop client server', () => {
  test('it listens on loopback only and serves index.html at /', async () => {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const res = await fetch(server.url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /客户端/);
    assert.equal((await fetch(`${server.url}sim/content/`)).status, 404, 'a directory without index.html is a 404, not a listing');
  });

  test('it serves the client trees with the right types and cache policy', async () => {
    const js = await fetch(`${server.url}js/boot.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /text\/javascript/);
    assert.equal(js.headers.get('cache-control'), 'no-cache', 'code revalidates: an app update is picked up');
    const mp3 = await fetch(`${server.url}assets/audio/a.mp3`);
    assert.equal(mp3.status, 200);
    assert.match(mp3.headers.get('content-type'), /audio\/mpeg/);
    assert.equal(mp3.headers.get('cache-control'), 'public, max-age=86400');
    assert.equal((await fetch(`${server.url}sim/content/support.js`)).status, 200);
    assert.equal((await fetch(`${server.url}data.js`)).status, 200);
  });

  test('HEAD, ranges (audio seeking) and 404s', async () => {
    const head = await fetch(`${server.url}js/boot.js`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const range = await fetch(`${server.url}assets/audio/a.mp3`, { headers: { range: 'bytes=2-5' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal((await range.arrayBuffer()).byteLength, 4);
    assert.equal((await fetch(`${server.url}nope.js`)).status, 404);
    const bad = await fetch(`${server.url}assets/audio/a.mp3`, { headers: { range: 'bytes=99-' } });
    assert.equal(bad.status, 416);
  });

  test('traversal and dotfiles never leave the bundle', async () => {
    assert.equal((await fetch(`${server.url}../../etc/passwd`)).status, 404);
    assert.equal((await fetch(`${server.url}%2e%2e%2f%2e%2e%2fetc%2fpasswd`)).status, 403);
    assert.equal((await fetch(`${server.url}.hidden`)).status, 403);
    // platform-neutral: path.resolve on Windows prefixes the cwd's drive, so never compare against a literal '/…'
    const root = join(tmpdir(), 'sp-root');
    assert.equal(resolveInside(root, '/a/b'), join(root, 'a', 'b'), 'normal segments resolve');
    assert.equal(resolveInside(root, '/a/../b'), null, 'a .. segment is rejected outright, never normalized');
    assert.equal(resolveInside(root, '/../x'), null);
    assert.equal(resolveInside(root, '/%00'), null);
  });

  test('a missing bundle or index.html fails loudly', async () => {
    await assert.rejects(() => createClientServer({ dir: join(dir, 'nope') }), /not found/);
    const empty = join(dir, 'empty');
    mkdirSync(empty, { recursive: true });
    await assert.rejects(() => createClientServer({ dir: empty }), /index\.html/);
    assert.equal(mimeOf('x.skel'), 'application/octet-stream');
    assert.equal(mimeOf('x.unknown'), 'application/octet-stream');
  });
});
