#!/usr/bin/env node
// app/desktop/build-runtime.mjs — assemble the desktop app's *runtime*: the game server the shell runs in-process for
// 离线游玩 (docs/APP.md §10).
//
// The client bundle (tools/build-client-app.mjs) carries what the browser needs (/data, /sim, /shared, the assets). The
// shell additionally needs the Node side to *be* a server: server/index.js + server/match + server/sim plus the data it
// reads and the shared modules it imports. They live in app/desktop/runtime/ with their own package.json
// (`"type": "module"`) so the CommonJS Electron main process can `import()` them.
//
// Usage: node app/desktop/build-runtime.mjs [--quiet]

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'runtime');
const quiet = process.argv.includes('--quiet');
const log = quiet ? () => {} : (m) => console.log(m);

/** Copy a tree (files only), keeping relative paths. */
async function copyTree(from, to) {
  await fsp.mkdir(to, { recursive: true });
  for (const e of await fsp.readdir(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) await copyTree(s, d);
    else if (e.isFile()) await fsp.copyFile(s, d);
  }
}

async function main() {
  await fsp.rm(OUT, { recursive: true, force: true });
  await copyTree(path.join(ROOT, 'server'), path.join(OUT, 'server'));
  await copyTree(path.join(ROOT, 'shared'), path.join(OUT, 'shared'));
  await copyTree(path.join(ROOT, 'data'), path.join(OUT, 'data'));
  // ESM for the imported entry: the Electron main process itself is CommonJS
  await fsp.writeFile(path.join(OUT, 'package.json'), `${JSON.stringify({ name: 'stronghold-runtime', private: true, type: 'module' }, null, 2)}\n`);
  let files = 0, bytes = 0;
  const walk = async (d) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else { files++; bytes += (await fsp.stat(p)).size; }
    }
  };
  await walk(OUT);
  log(`[runtime] ${path.relative(ROOT, OUT)}: ${files} files, ${(bytes / 1048576).toFixed(1)} MB ` +
    `(server + shared + data + package.json{\"type\":\"module\"})`);
  return 0;
}

main().then((c) => process.exit(c), (err) => { console.error(`[runtime] ${err.message}`); process.exit(1); });
