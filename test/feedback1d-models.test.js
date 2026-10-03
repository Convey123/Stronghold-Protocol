// test/feedback1d-models.test.js — community report D3 after 0.1.0 ("所有特殊源石虫的模型全表现为普通源石虫"): 灼热源石虫 /
// 炽焰源石虫 (enemy_1305_mhslim / _2, the ELEMENT faction's slugs — up to 10 a round) were drawn with the plain 源石虫
// skeleton because no dump carried their models (Ark-Models lists them with an empty assetList — registered, never
// uploaded) and the asset plan aliased them to enemy_1007_slime. They now have their OWN web model: the *mobile*
// build's, which PRTS mirrors at enemy_spine/<enemyId>/<enemyId>.{skel,atlas,png} (plan.mjs ENEMY_SPINE_MOBILE /
// prtsModel). Its atlases carry no pma: true line — straight alpha, unlike the PC build's premultiplied pages — so the
// manifest entries say pma: false.
// The official model is also what tools/local-extract/extract.py ENEMY_SPINES writes to
// public/assets/local/spine/enemy/<id>/ (optional and git-ignored), and that stays an OVERLAY: data/assets.json holds
// the web model (`spine`) beside `spineLocal` (file names in the data/local-assets.json group + the parsed metadata,
// from the committed tools/assets/local-enemy-spines.json — never from the disk, so the manifest is the same with or
// without the extraction). The client (assets.js spineEntry) draws the extraction when data/local-assets.json lists
// every one of its files and falls back to the web model when it fails to load (DESIGN §13: local art is optional).
// Both sources are the same official model — the metadata below is asserted equal to the extraction's — so an install
// without the extraction draws the real slug now and needs no alias tint (render/units.js ALIAS_TINT is empty).
// 高能 / 冰爆 / 简饲源石虫 and “庞贝” always had their own models (checked in headless Chrome).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, ENEMY_SPINE_MOBILE } from '../tools/assets/plan.mjs';
import { RAW } from '../tools/assets/sources.mjs';
import { resolveTemplate, collectLeaves } from '../tools/assets/manifest.mjs';
import { findLocalEnemyModels, localEnemySpineMeta, loadLocalEnemySpines, LOCAL_ENEMY_SPINES_FILE, localEnemySpineGroup } from '../tools/assets/spine.mjs';
import { indexAudio } from '../tools/assets/audio.mjs';
import { createAssets, spineEntry, validSpine } from '../public/js/assets.js';
import { installFakePixi, fakeViewCtx } from './render/fakepixi.js';
import { presetCamera } from '../public/js/render/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public/assets');
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const SLUGS = ['enemy_1305_mhslim', 'enemy_1305_mhslim_2'];
const COMMITTED = readJson(LOCAL_ENEMY_SPINES_FILE).models;
const MANIFEST = readJson('data/assets.json');

/** The real research inputs; Ark-Models carries the plain slug only (its index lists the special ones empty). */
function plan(localEnemySpines) {
  const modelsData = { data: { '1007_slime': { assetList: { '.skel': 'enemy_1007_slime.skel', '.atlas': 'enemy_1007_slime.atlas', '.png': 'enemy_1007_slime.png' } },
    '1305_mhslim': { assetList: {} }, '1305_mhslim_2': { assetList: {} } } };
  return buildPlan({
    assets07: readJson('docs/research/07-assets.json'), ops03: readJson('docs/research/03-operators.json'),
    enemies05: readJson('docs/research/05-enemies.json'), maps05: readJson('docs/research/05-maps.json'),
    audio: indexAudio({}), modelsData, extraEnemyIds: SLUGS, localEnemySpines,
  });
}

/** A data/local-assets.json listing the extracted files of `ids` (extract.py's group layout). */
function localManifest(ids, drop = null) {
  const groups = {};
  for (const id of ids) {
    const g = groups[localEnemySpineGroup(id)] = {};
    const m = COMMITTED[id];
    for (const f of [m.skel, m.atlas, ...m.textures]) if (f !== drop) g[f] = { path: `/assets/local/spine/enemy/${id}/${f}`, kind: f.endsWith('.png') ? 'Texture2D' : 'TextAsset' };
  }
  return { version: 1, source: 'local-client', groups };
}

describe('D3: the slugs’ own model is the web model, the local extraction an overlay of it', () => {
  test('plan: their own model from the mobile build (PRTS, pma off); spineLocal comes from the committed metadata as it is', () => {
    const before = plan(undefined);
    assert.deepEqual(ENEMY_SPINE_MOBILE, SLUGS, 'the enemies the mobile build covers');
    for (const id of SLUGS) {
      const t = before.template.enemies[id];
      assert.deepEqual(t.spine, { model: `enemy:${id}` }, `${id}: their own model, not an alias`);
      assert.equal(t.spineAliasOf, undefined, `${id}: nothing is borrowed`);
      assert.equal(t.spineLocal, undefined, 'no metadata → no overlay');
      const m = before.models.get(`enemy:${id}`);
      assert.equal(m.pma, false, `${id}: the mobile build’s pages are straight-alpha`);
      assert.deepEqual([m.skel.urls[0], m.atlas.urls[0], m.pngs[0].urls[0]], [
        `${RAW.prts}enemy_spine/${id}/${id}.skel`, `${RAW.prts}enemy_spine/${id}/${id}.atlas`, `${RAW.prts}enemy_spine/${id}/${id}.png`,
      ], `${id}: PRTS' mobile-build layout`);
      assert.deepEqual([m.skel.rel, m.atlas.rel, m.pngs[0].rel],
        ['skel', 'atlas', 'png'].map((e) => `spine/enemy/${id}/${id}.${e}`), `${id}: the usual public/assets path`);
      assert.equal(m.atlas.mutable, true, 'the atlas is normalized in place (size: line added)');
    }
    assert.ok(before.notes.some((n) => /enemy_1305_mhslim: Spine from the mobile build \(PRTS, pma off\)/.test(n)));
    assert.ok(!before.notes.some((n) => /aliased/.test(n)), 'neither slug borrows another enemy’s skeleton any more');
    const p = plan(COMMITTED);
    const own = (id) => ({ skel: `/assets/spine/enemy/${id}/${id}.skel`, atlas: `/assets/spine/enemy/${id}/${id}.atlas`, textures: [`/assets/spine/enemy/${id}/${id}.png`], pma: false, anims: {}, animations: {} });
    const tmp = mkdtempSync(path.join(tmpdir(), 'sp-plan-'));
    try {
      const { value } = resolveTemplate({ enemies: Object.fromEntries(SLUGS.map((id) => [id, p.template.enemies[id]])) },
        { root: tmp, spine: new Map(SLUGS.map((id) => [`enemy:${id}`, own(id)])) });
      for (const id of SLUGS) {
        const e = value.enemies[id];
        assert.equal(e.spineAliasOf, undefined, `${id}: the web model is their own (works without the local client)`);
        assert.deepEqual(e.spine, own(id));
        assert.deepEqual(e.spineLocal, { group: `spine/enemy/${id}`, ...COMMITTED[id] }, `${id}: the overlay, null fields kept`);
        assert.equal(e.spineLocal.anims.attack.begin, null);
      }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
    assert.ok(!collectLeaves(p.template).some((l) => /spineLocal/.test(l.path)), 'the overlay is no file to download');
    assert.ok(p.notes.some((n) => /enemy_1305_mhslim: official Spine from the local client/.test(n)));
  });

  test('the committed metadata: both ELEMENT slugs, file names of their extract.py group, roles resolved', () => {
    assert.deepEqual(Object.keys(COMMITTED).sort(), SLUGS);
    for (const id of SLUGS) {
      const m = COMMITTED[id];
      assert.equal(m.skel, `${id}.skel`);
      assert.equal(m.atlas, `${id}.atlas`, 'next to the skeleton (pixi-spine finds the atlas by its name)');
      assert.deepEqual(m.textures, [`${id}.png`]);
      assert.equal(m.pma, true, 'premultiplied pages (extract.py merge_alpha)');
      for (const role of ['idle', 'die']) assert.ok(m.anims[role] in m.animations, `${id} ${role}`);
      assert.ok(m.anims.move.loop in m.animations && m.anims.attack.loop in m.animations, `${id} move / attack`);
      assert.ok(m.hits.Attack?.length, `${id}: the OnAttack frame`);
    }
  });

  test('the web model and the extraction are the same official model (metadata equal, alpha convention differs)', () => {
    for (const id of SLUGS) {
      const web = MANIFEST.enemies[id].spine, loc = COMMITTED[id];
      for (const k of ['anims', 'animations', 'events', 'hits', 'bounds']) assert.deepEqual(web[k], loc[k], `${id}: ${k}`);
      assert.equal(web.pma, false, 'the mobile build ships straight-alpha pages');
      assert.equal(loc.pma, true, 'the extraction premultiplies them (extract.py merge_alpha)');
    }
  });

  test('data/assets.json never depends on the local extraction (no /assets/local/ URL; the web model always there)', () => {
    const urls = [];
    const walk = (n) => { if (typeof n === 'string') { if (n.includes('/assets/local/')) urls.push(n); } else if (n && typeof n === 'object') Object.values(n).forEach(walk); };
    walk(MANIFEST);
    assert.deepEqual(urls, [], 'setup / doctor / the manifest tests count every /assets/ URL as required');
    for (const [id, e] of Object.entries(MANIFEST.enemies)) {
      if (!e.spineLocal) continue;
      assert.ok(SLUGS.includes(id), id);
      assert.deepEqual(e.spineLocal, { group: `spine/enemy/${id}`, ...COMMITTED[id] }, `${id}: the committed metadata`);
      assert.ok(validSpine(spineEntry(MANIFEST, id)), `${id}: a web model without the local client`);
      assert.equal(e.spineAliasOf, undefined, `${id}: no alias any more`);
      assert.equal(spineEntry(MANIFEST, id), e.spine);
      assert.equal(e.spine.skel, `/assets/spine/enemy/${id}/${id}.skel`, `${id}: their own skeleton on the web`);
      assert.equal(e.spine.pma, false, `${id}: straight-alpha entry for a mobile-build atlas`);
      assert.notDeepEqual(e.spine, MANIFEST.enemies.enemy_1007_slime.spine, `${id}: not the plain 源石虫`);
    }
    for (const id of SLUGS) assert.ok(MANIFEST.enemies[id].spineLocal, `${id} has its overlay`);
    const aliased = Object.entries(MANIFEST.enemies).filter(([, e]) => e.spineAliasOf).map(([id]) => id);
    assert.deepEqual(aliased.filter((id) => SLUGS.includes(id)), [], 'the aliases of the other enemies are untouched');
  });

  test('the committed metadata is what the extracted models parse to', { skip: !SLUGS.every((id) => existsSync(path.join(ASSETS, 'local/spine/enemy', id))) && 'enemy models not extracted (tools/local-extract)' }, async () => {
    const found = await findLocalEnemyModels(ASSETS);
    const { meta, problems } = await localEnemySpineMeta(ASSETS, found);
    assert.deepEqual(problems, []);
    for (const id of SLUGS) assert.deepEqual(meta[id], COMMITTED[id], `${id}: re-run node tools/fetch-assets.mjs --local-spines`);
  });

  test('localEnemySpineMeta parses an extracted model like the pipeline and writes nothing', { skip: !existsSync(path.join(ASSETS, 'spine/enemy/enemy_1007_slime')) && 'public/assets not downloaded' }, async () => {
    // the plain slug's fetched files stand in for an extraction (same layout: <id>.skel / .atlas / page PNGs)
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-meta-'));
    try {
      const src = path.join(ASSETS, 'spine/enemy/enemy_1007_slime');
      const dst = path.join(dir, 'local/spine/enemy/enemy_9999_slime');
      mkdirSync(dst, { recursive: true });
      for (const f of ['enemy_1007_slime.skel', 'enemy_1007_slime.atlas', 'enemy_1007_slime.png']) copyFileSync(path.join(src, f), path.join(dst, f));
      const atlasBefore = readFileSync(path.join(dst, 'enemy_1007_slime.atlas'));
      const mtime = statSync(path.join(dst, 'enemy_1007_slime.atlas')).mtimeMs;
      const { meta, problems } = await localEnemySpineMeta(dir, await findLocalEnemyModels(dir));
      assert.deepEqual(problems, []);
      const web = MANIFEST.enemies.enemy_1007_slime.spine;
      assert.deepEqual(meta.enemy_9999_slime, {
        skel: 'enemy_1007_slime.skel', atlas: 'enemy_1007_slime.atlas', textures: ['enemy_1007_slime.png'], pma: true,
        anims: web.anims, animations: web.animations, events: web.events, hits: web.hits, bounds: web.bounds,
      });
      assert.ok(readFileSync(path.join(dst, 'enemy_1007_slime.atlas')).equals(atlasBefore), 'read only');
      assert.equal(statSync(path.join(dst, 'enemy_1007_slime.atlas')).mtimeMs, mtime);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('loadLocalEnemySpines: the models of the committed file, {} when it is missing or bad', async () => {
    assert.deepEqual(await loadLocalEnemySpines(path.join(ROOT, LOCAL_ENEMY_SPINES_FILE)), COMMITTED);
    assert.deepEqual(await loadLocalEnemySpines(path.join(ROOT, 'no-such-file.json')), {});
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-lse-'));
    try {
      writeFileSync(path.join(dir, 'a.json'), '{"models":[1]}');
      assert.deepEqual(await loadLocalEnemySpines(path.join(dir, 'a.json')), {});
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('findLocalEnemyModels: skeleton + same-stem atlas + page PNGs under local/spine/enemy/<id>/', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-local-'));
    try {
      const put = (rel, body = 'x') => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), body); };
      put('local/spine/enemy/enemy_1305_mhslim/enemy_1305_mhslim.skel');
      put('local/spine/enemy/enemy_1305_mhslim/enemy_1305_mhslim.atlas');
      put('local/spine/enemy/enemy_1305_mhslim/enemy_1305_mhslim.png');
      put('local/spine/enemy/enemy_1305_mhslim/enemy_1305_mhslim_2.png');
      put('local/spine/enemy/enemy_x_noatlas/enemy_x_noatlas.skel');
      put('local/spine/enemy/enemy_x_nopng/enemy_x_nopng.skel');
      put('local/spine/enemy/enemy_x_nopng/enemy_x_nopng.atlas');
      put('local/spine/enemy/not-an-enemy/a.skel');
      const found = await findLocalEnemyModels(dir);
      assert.deepEqual(Object.keys(found), ['enemy_1305_mhslim']);
      assert.deepEqual(found.enemy_1305_mhslim, {
        dir: 'local/spine/enemy/enemy_1305_mhslim/', skel: 'local/spine/enemy/enemy_1305_mhslim/enemy_1305_mhslim.skel',
        atlas: 'local/spine/enemy/enemy_1305_mhslim/enemy_1305_mhslim.atlas',
        pngs: ['local/spine/enemy/enemy_1305_mhslim/enemy_1305_mhslim.png', 'local/spine/enemy/enemy_1305_mhslim/enemy_1305_mhslim_2.png'],
      });
      assert.deepEqual(await findLocalEnemyModels(path.join(dir, 'missing')), {});
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('D3 client: the extraction when data/local-assets.json lists it, else their own web model', () => {
  const webOf = (id) => MANIFEST.enemies[id].spine;   // their own model (the mobile build, plan.mjs ENEMY_SPINE_MOBILE)

  test('assets.js spineEntry: every file listed → the official model (web fallback); anything missing → the web model', () => {
    const local = localManifest(SLUGS);
    for (const id of SLUGS) {
      const web = webOf(id);
      const e = spineEntry(MANIFEST, id, { local });
      assert.equal(e.skel, `/assets/local/spine/enemy/${id}/${id}.skel`);
      assert.equal(e.atlas, `/assets/local/spine/enemy/${id}/${id}.atlas`);
      assert.deepEqual(e.textures, [`/assets/local/spine/enemy/${id}/${id}.png`]);
      assert.equal(e.pma, true);
      assert.deepEqual(e.anims, COMMITTED[id].anims);
      assert.deepEqual(e.hits, COMMITTED[id].hits);
      assert.equal(e.fallback, web, 'their own web model if the extracted one fails to load');
      assert.equal(spineEntry(MANIFEST, id, { local }), e, 'one entry object per manifest pair');
      assert.equal(spineEntry(MANIFEST, id), web, 'no local manifest → the web model');
      assert.equal(spineEntry(MANIFEST, id, { local: localManifest([]) }), web, 'not extracted → the web model');
      assert.equal(spineEntry(MANIFEST, id, { local: localManifest([id], `${id}.png`) }), web, 'a page missing → the web model');
      assert.equal(spineEntry(MANIFEST, id, { local: localManifest([id], `${id}.atlas`) }), web, 'the atlas missing → the web model');
    }
    assert.equal(spineEntry(MANIFEST, 'enemy_1007_slime', { local }), webOf('enemy_1007_slime'), 'other enemies unchanged');
    // the store hands the local manifest over once local() has it
    const store = createAssets({ manifest: MANIFEST, localManifest: local });
    assert.equal(store.spineEntry(SLUGS[0]).skel, `/assets/local/spine/enemy/${SLUGS[0]}/${SLUGS[0]}.skel`);
    assert.equal(createAssets({ manifest: MANIFEST }).spineEntry(SLUGS[0]), webOf(SLUGS[0]), 'before / without local(): the web model');
  });

  test('render/app.js waits for the local manifest with the asset manifest before building unit views', () => {
    const src = readFileSync(path.join(ROOT, 'public/js/render/app.js'), 'utf8');
    assert.match(src, /await withTimeout\(Promise\.all\(\[assets\.ready \? assets\.ready\(\) : null, assets\.local \? assets\.local\(\) : null\]/);
  });

  describe('UnitView', () => {
    let fake, UnitView;
    let ALIAS_TINT, UF;
    before(async () => {
      fake = installFakePixi();
      ({ UnitView, ALIAS_TINT } = await import('../public/js/render/units.js'));
      ({ UF } = await import('../shared/constants.js'));
    });
    after(() => fake.restore());
    const tick = () => new Promise((r) => setImmediate(r));
    const cam = () => presetCamera('normal', { width: 1280, height: 720 });
    const info = (id) => ({ id: 3, side: 'enemy', kind: 'enemy', defId: id, spine: id, tier: 1, x: 6, y: 10, maxHp: 1000 });

    test('an official model that fails to load falls back to the web model (never the icon diamond)', async () => {
      const local = localManifest(SLUGS);
      const asked = [], released = [];
      const store = (fail) => ({
        picture: () => null, image: async () => null,
        spineEntry: (id) => spineEntry(MANIFEST, id, { local }),
        spine: {
          acquire: async (e) => { asked.push(e.skel); if (fail(e)) throw new Error('404'); return { animations: Object.keys(e.animations).map((name) => ({ name })) }; },
          release: (e) => released.push(e.skel),
        },
      });
      const id = SLUGS[0];
      const web = webOf(id);
      const ok = new UnitView(fakeViewCtx(fake.P, { assets: store(() => false), cam }), info(id));
      await tick(); await tick();
      assert.equal(ok.actor?.entry.skel, `/assets/local/spine/enemy/${id}/${id}.skel`, 'the official model');
      assert.equal(ok.actor.entry.anims.move.loop, 'Move', 'with its own clips');
      asked.length = 0;
      const bad = new UnitView(fakeViewCtx(fake.P, { assets: store((e) => e.local), cam }), info(id));
      await tick(); await tick(); await tick();
      assert.deepEqual(asked, [`/assets/local/spine/enemy/${id}/${id}.skel`, web.skel], 'the official model, then the web one');
      assert.ok(released.includes(`/assets/local/spine/enemy/${id}/${id}.skel`), 'the failed acquire is released');
      assert.equal(bad.actor?.entry, web, 'drawn with the web model');
      assert.equal(bad.entry, web);
    });

    test('their own web model and the extracted one are drawn as they are; a status tint still wins', async () => {
      const store = (local, fail = () => false) => ({
        picture: () => null, image: async () => null,
        spineEntry: (id) => spineEntry(MANIFEST, id, local ? { local } : undefined),
        spine: { acquire: async (e) => { if (fail(e)) throw new Error('404'); return { animations: Object.keys(e.animations).map((name) => ({ name })) }; }, release() {} },
      });
      const local = localManifest(SLUGS);
      const mk = (id, st) => new UnitView(fakeViewCtx(fake.P, { assets: st, cam }), info(id));
      const web0 = mk(SLUGS[0], store(null)), web1 = mk(SLUGS[1], store(null));
      const official = mk(SLUGS[0], store(local)), failed = mk(SLUGS[1], store(local, (e) => e.local));
      const plain = mk('enemy_1007_slime', store(local));
      for (let i = 0; i < 4; i++) await tick();
      const all = [web0, web1, official, failed, plain];
      for (const v of all) v.update(1 / 60, cam(), 0);
      // the real slug art is never tinted (D3 used to draw them as a tinted plain 源石虫; ALIAS_TINT is empty now)
      assert.deepEqual(Object.keys(ALIAS_TINT), [], 'no enemy is drawn with another enemy’s model any more');
      assert.equal(web0.actor.entry, webOf(SLUGS[0]), 'not extracted: their own model');
      assert.equal(web1.actor.entry, webOf(SLUGS[1]));
      assert.notEqual(web0.actor.entry, plain.actor.entry, 'and not the plain 源石虫’s');
      assert.equal(web0.actor.spine.tint, 0xffffff, '灼热源石虫 as it is');
      assert.equal(web1.actor.spine.tint, 0xffffff, '炽焰源石虫 as it is');
      assert.ok(official.actor.entry.local);
      assert.equal(official.actor.spine.tint, 0xffffff, 'the extracted model as it is');
      assert.equal(failed.actor.entry, webOf(SLUGS[1]));
      assert.equal(failed.actor.spine.tint, 0xffffff, 'the web fallback of a failed local model too');
      assert.equal(plain.actor.spine.tint, 0xffffff, 'the plain 源石虫 itself');
      web0.flags = UF.FROZEN;
      web0.update(1 / 60, cam(), 1 / 60);
      assert.equal(web0.actor.spine.tint, 0x9fd4ff, 'a status tint wins (frozen)');
      for (const v of all) v.destroy?.();
    });
  });
});

const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);
describe('D3: tools/local-extract/extract.py enemy Spine job (no UnityPy needed)', { skip: !PY && 'no python3' }, () => {
  const TOOL = path.join(ROOT, 'tools/local-extract');
  const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
  const py = (body) => {
    const o = spawnSync(PY, ['-c', `import sys, json\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport extract as e\n${body}`], { encoding: 'utf8', env: ENV });
    assert.equal(o.status, 0, o.stderr);
    return JSON.parse(o.stdout);
  };

  test('--print-jobs lists the enemy models; container matching and --only selection', () => {
    const r = spawnSync(PY, [path.join(TOOL, 'extract.py'), '--print-jobs'], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).enemySpines, { bundles: 'refs/arts/enm_art_*.ab', sub: 'spine/enemy', ids: SLUGS });
    const out = py(`W = set(e.ENEMY_SPINES)\n`
      + `print(json.dumps([e.enemy_spine_id('Assets/Torappu/Arts/Enemies/Spines/enemy_1305_mhslim/2/enemy_1305_mhslim_2_SkeletonData.asset', W),`
      + ` e.enemy_spine_id('Assets/Torappu/Arts/Enemies/Spines/enemy_1305_mhslim/1/enemy_1305_mhslim_SkeletonData.asset', W),`
      + ` e.enemy_spine_id('Assets/Torappu/Arts/Enemies/Spines/enemy_1007_slime/enemy_1007_slime_SkeletonData.asset', W),`
      + ` e.enemy_spine_id('Assets/Torappu/Arts/Enemies/Spines/enemy_1305_mhslim/1/enemy_1305_mhslim_Material.mat', W),`
      + ` [e.wants_sub(o, 'spine/enemy') for o in ([], ['spine'], ['spine/enemy'], ['spine/enemy/enemy_1305_mhslim'], ['spine/token_x'], ['map'])]]))`);
    assert.deepEqual(out, ['enemy_1305_mhslim_2', 'enemy_1305_mhslim', null, null, [true, true, true, true, false, false]]);
  });

  test('normalize_atlas: the real page size and pma: true, like the fetched enemy atlases (the client loads it as is)', async () => {
    const { normalizeAtlas } = await import('../tools/assets/atlas.mjs');
    // the client's atlas text of 灼热源石虫 (leading blank line, size, no pma), shortened
    const raw = '\nenemy_1305_mhslim.png\nsize: 256,256\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nC_Body_1\n  rotate: false\n  xy: 2, 159\n  size: 55, 64\n  orig: 55, 64\n  offset: 0, 0\n  index: -1\n';
    const sized = py(`print(json.dumps(e.normalize_atlas(${JSON.stringify(raw)}, {'enemy_1305_mhslim.png': (256, 256)})))`);
    assert.equal(sized, normalizeAtlas(raw, { pageSize: () => ({ width: 256, height: 256 }), pma: true }).text, 'the same text as tools/assets/atlas.mjs');
    assert.match(sized, /repeat: none\npma: true\nC_Body_1\n {2}rotate: false\n {2}xy: 2, 159\n {2}size: 55, 64/, 'region fields untouched');
    const noSize = raw.replace('size: 256,256\n', '');
    const fixed = py(`print(json.dumps(e.normalize_atlas(${JSON.stringify(noSize)}, {'enemy_1305_mhslim.png': (512, 256)})))`);
    assert.match(fixed, /\nenemy_1305_mhslim\.png\nsize: 512,256\nformat: RGBA8888/);
    assert.equal(py(`print(json.dumps(e.normalize_atlas(${JSON.stringify(sized)}, {'enemy_1305_mhslim.png': (256, 256)})))`), sized, 'idempotent');
  });
});
