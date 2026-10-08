// test/render/negbar.test.js — 业火 我执 的**红条**在客户端画出来了吗 (community report: 「血量低于自身血量时的显示方式，
// 游戏中是绿条被打空以后受到伤害就会涨红条，这里看不到红条」).
//
// 斩业星熊 (char_1044_hsgma2) 的 T1 业火: 致命一击不再击倒她，超出的伤害进入**负生命值池** (上限 max_minus_hp_ratio × 最大生命)；
// 之后每一次伤害都记进这个池，池满才倒下。官方 UI 把池画成**红条**——她的绿条已经见底，于是那根条改由红条填充。
// The whole path is checked here (headless fake PIXI, test/render/fakepixi.js): the kit publishes `unit.negHp` →
// Battle.snapshot()'s `neg` side list → render/interp.js SnapshotBuffer → sample().neg → render/units.js UnitView's bar.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { SnapshotBuffer } from '../../public/js/render/interp.js';

let fake, UnitView, COLORS;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
  ({ COLORS } = await import('../../public/js/render/style.js'));
});
after(() => fake.restore());

const cam = () => presetCamera('normal', { width: 1280, height: 720 });
/** A snapshot of one unit: the base tuple, plus the optional `neg` list when given. */
const snap = (t, { neg = null, hp = 1, maxHp = 600 } = {}) => ({
  fieldId: 'f', t, units: [[7, 5, 10, hp, maxHp, 0, 0, 0, 0]], dp: 0, killed: 0, total: 0,
  ...(neg == null ? {} : { neg: [[7, neg]] }),
});
/** One frame through the client path: push → sample → UnitView.sync. */
function view(info, states, opts = {}) {
  const v = new UnitView(fakeViewCtx(fake.P, { cam }), info, opts);
  const buf = new SnapshotBuffer({ delay: 0.034, rate: 2, maxRate: 8 });
  const out = new Map();
  let now = 0;
  for (const s of states) {
    now += 1 / 60;
    buf.push({ ...s, gt: s.t }, now);
    const rt = buf.update(now);
    buf.sample(rt, out);
    const o = out.get(7);
    if (o) v.sync(o, rt);
    v.update(1 / 60, cam(), now);
  }
  return v;
}

test('the pool rides the snapshot to the client: interp hands out `neg`, and 0 for every other unit', () => {
  const buf = new SnapshotBuffer({ delay: 0, rate: 2, maxRate: 8 });
  const out = new Map();
  buf.push({ ...snap(0, { neg: 0.42 }), gt: 0 }, 0);
  buf.sample(buf.update(0), out);
  assert.equal(out.get(7).neg, 0.42, 'the share of the cap');
  // a unit the sim sent no `neg` for (and a snapshot from before the field existed) reads as 0
  const buf2 = new SnapshotBuffer({ delay: 0, rate: 2, maxRate: 8 });
  const out2 = new Map();
  buf2.push({ ...snap(0), gt: 0 }, 0);
  buf2.sample(buf2.update(0), out2);
  assert.equal(out2.get(7).neg, 0);
});

test('UnitView draws the red bar over the drained HP bar and hides it again when the pool is gone', () => {
  const info = { id: 7, side: 'ally', kind: 'op', defId: 'char_1044_hsgma2', tier: 6, x: 5, y: 10, maxHp: 600 };
  const v = view(info, [snap(0, { hp: 300 }), snap(1, { hp: 300 })]);
  assert.equal(v.negFill.visible, false, 'no pool, no red bar');
  assert.equal(v.negFill.tint, COLORS.hpNeg, 'the bar is the pool red');

  const half = view(info, [snap(0, { hp: 300 }), snap(1, { hp: 300 }), snap(2, { hp: 1, neg: 0.5 }), snap(3, { hp: 1, neg: 0.5 })]);
  assert.equal(half.negFill.visible, true, 'in 我执 the red bar shows');
  const bw = half.hpBg.width - 2;                    // the HP bar's own span
  assert.ok(Math.abs(half.negFill.width - bw * 0.5) < 1, `half the pool ⇒ half the bar (${half.negFill.width} of ${bw})`);
  assert.ok(Math.abs(half.negFill.position.x - half.hpFill.position.x) < 1e-6, 'it fills the bar in place, from the left');
  assert.ok(half.negFill.height > 0 && half.negFill.height <= half.hpBg.height, 'inside the bar');

  const full = view(info, [snap(0, { hp: 1, neg: 0.5 }), snap(1, { hp: 1, neg: 1 }), snap(2, { hp: 1, neg: 1 })]);
  assert.ok(Math.abs(full.negFill.width - (full.hpBg.width - 2)) < 1, 'a full pool fills the bar');
  // …and she leaves 我执 (or the field): the bar is gone again
  const out = view(info, [snap(0, { hp: 1, neg: 1 }), snap(1, { hp: 1, neg: 1 }), snap(2, { hp: 300 }), snap(3, { hp: 300 })]);
  assert.equal(out.negFill.visible, false, 'pool cleared ⇒ no red bar');
});

test('no other unit grows a red bar; the prep view and a knocked-out operator show none either', () => {
  const info = { id: 7, side: 'ally', kind: 'op', defId: 'char_x', tier: 3, x: 5, y: 10, maxHp: 600 };
  const v = view(info, [snap(0), snap(1)]);
  assert.equal(v.negFill.visible, false);
  // the prep board draws no bars at all (only the tier chip and the portrait)
  const prep = view(info, [snap(0, { neg: 0.6 }), snap(1, { neg: 0.6 })], { prep: true });
  assert.equal(prep.negFill.visible, false, 'prep: no bars, so no red bar');
  // knocked out (the client's own `die`, as the sim's die event drives it): the HUD goes with her
  const down = view(info, [snap(0, { hp: 1, neg: 1 }), snap(1, { hp: 1, neg: 1 }), snap(2, { hp: 0, neg: 1 }), snap(3, { hp: 0, neg: 1 })]);
  down.die();
  for (let i = 0; i < 300; i++) down.update(1 / 60, cam(), 4 + i / 60);   // let the fall finish
  assert.equal(down.alive, false, 'she is gone');
  assert.equal(down.negFill.visible, false, 'no bars for a knocked-out operator');
});
