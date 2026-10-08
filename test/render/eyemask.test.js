// test/render/eyemask.test.js — 闭眼时眼球露出来的兜底 (GitHub #177: 「部分干员闭眼时眼球没有被完全遮住」).
//
// 作者的诊断 (issue #177 评论): 「场上带裁剪的骨架多时，眼球的裁剪会被关掉，倒地和眨眼时又没有另外藏起眼球」.
// 事实核对: 名单里那些模型的「眼睑」就是 Spine 的剪辑件 (clipping attachment) —— 它遮住绘制顺序在它之后的槽
// (Spine: 直到 endSlot), 多边形是眼睛的开口；眼睛一闭, 多边形塌缩/移开, 于是**遮住眼球的是遮罩而不是美术**。
// 客户端只在「高画质 + 场上只有一个带剪辑的骨架」时才开遮罩 (render/app.js pickClipping), 实战里几乎总是关的,
// 所以眼球从闭着的眼皮里露出来 —— 实测 (骨架数据): 佩佩倒地帧 75% 的眼睛像素仍是眼球, 仇白 61%。
//
// 现在 render/spine.js 在遮罩关掉时自己兜底: 被剪辑件遮住的槽, 只要它的几何中心跑出了剪辑多边形就藏起来 ——
// 官方遮罩在这些帧里正是把眼球几乎整个切掉 (佩佩倒地只剩 2%、仇白 0%, 而睁眼时可见 70–86%), 且睁眼时**什么都不做**,
// 所以不会误藏。这里既测纯助手, 也拿仓库里的**真实骨架**在每个关键帧上核对判定。

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipRanges, pointInPolygon } from '../../public/js/render/spine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const spineDir = (id) => path.join(ROOT, 'public', 'assets', 'spine', 'op', id, 'front');
const have = (id) => existsSync(path.join(spineDir(id), `${id}.skel`)) && existsSync(path.join(spineDir(id), `${id}.atlas`));

// ---- 纯助手 -------------------------------------------------------------------------------------------------

describe('clipRanges / pointInPolygon: 闭眼兜底用到的两个纯助手', () => {
  test('pointInPolygon: 内外判定（凸、凹、边界附近）', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    assert.equal(pointInPolygon(5, 5, square, 4), true);
    assert.equal(pointInPolygon(-1, 5, square, 4), false);
    assert.equal(pointInPolygon(11, 5, square, 4), false);
    assert.equal(pointInPolygon(5, -3, square, 4), false);
    const l = [0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10];   // L 形（凹）
    assert.equal(pointInPolygon(6, 6, l, 6), false, '凹口里');
    assert.equal(pointInPolygon(2, 6, l, 6), true);
    assert.equal(pointInPolygon(8, 2, l, 6), true);
  });

  test('clipRanges: 每个剪辑件的槽位与它遮到的槽（endSlot 缺失时按下一个剪辑件前推）', () => {
    const clip = (endSlot) => ({ type: 6, vertices: new Array(8).fill(0), endSlot, constructor: { name: 'ClippingAttachment' } });
    const slots = [0, 1, 2, 3, 4, 5].map((index) => ({ index, name: `s${index}`, attachment: null }));
    slots[1].attachment = clip({ index: 3 });
    slots[4].attachment = clip(null);                       // 没有 endSlot：到最后一个槽
    const data = { slots, defaultSkin: { getAttachment: () => null } };
    assert.deepEqual(clipRanges(data), [{ slot: 1, end: 3 }, { slot: 4, end: 5 }]);
    // 没有剪辑件的骨架给出空表
    assert.deepEqual(clipRanges({ slots: [{ index: 0, name: 'a', attachment: { type: 1 } }] }), []);
    assert.deepEqual(clipRanges(null), []);
    // 挂在默认皮肤里（运行时未套用的骨架）也能认出来
    const data2 = { slots: [{ index: 0, name: 'a', attachment: null }, { index: 1, name: 'b', attachment: null }],
      defaultSkin: { getAttachment: (i) => (i === 0 ? clip({ index: 1 }) : null) } };
    assert.deepEqual(clipRanges(data2), [{ slot: 0, end: 1 }]);
  });
});

// ---- 真实骨架：判定在关键帧上对不对 --------------------------------------------------------------------------

/** 用真实 TextureAtlas + AtlasAttachmentLoader 解一份官方骨架（贴图用桩，只做几何）。 */
let Skeleton, AnimationState, AnimationStateData;
async function loadReal(id) {
  const { SkeletonBinary, AtlasAttachmentLoader } = await import('@pixi-spine/runtime-3.8');
  if (!Skeleton) ({ Skeleton, AnimationState, AnimationStateData } = await import('@pixi-spine/runtime-3.8'));
  const { TextureAtlas } = await import('@pixi-spine/base');
  const emitter = () => ({ once() { return this; }, on() { return this; }, off() { return this; }, emit() { return this; } });
  const tex = () => ({ width: 316, height: 316, valid: true, baseTexture: { width: 316, height: 316, valid: true, ...emitter() },
    setSize() { return this; }, setRealSize() { return this; }, update() { return this; }, ...emitter() });
  const dir = spineDir(id);
  const atlas = new TextureAtlas(readFileSync(path.join(dir, `${id}.atlas`), 'utf8'), (l, cb) => cb(tex()));
  return new SkeletonBinary(new AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(readFileSync(path.join(dir, `${id}.skel`))));
}

/**
 * 兜底在时间 `t` 上藏了哪些槽。**每个时间点都用全新的 AnimationState**：pixi-spine 的 `state.update(dt)` 收的是增量，
 * 拿同一个 state 连跑绝对时间会把时间轴错位（这一步曾经把判定测歪）。
 */
async function hiddenAt({ data }, clip, t) {
  const { SpineActor } = await import('../../public/js/render/spine.js');
  const skel = new Skeleton(data);
  const state = new AnimationState(new AnimationStateData(data));
  for (const slot of skel.slots) slot.currentSprite = { visible: true };   // 真实渲染时每个槽有自己的 sprite
  state.setAnimation(0, clip, false);
  state.update(t); state.apply(skel); skel.updateWorldTransform();
  const self = Object.create(SpineActor.prototype);   // 真的用 SpineActor 的方法（_hideClipSlot 等都在原型上）
  Object.assign(self, {
    clipped: true, clipOn: false, clipRanges: clipRanges(data), spine: { skeleton: skel },
    _clipHidden: null, _clipPoly: null, _clipPoint: null,
  });
  self._eyeMaskFallback();
  return skel.slots.filter((s) => s.currentSprite.visible === false).map((s) => s.data.name);
}

describe('闭眼兜底：在官方骨架上判定', { skip: !have('char_4058_pepe') && '需要 public/assets 里的角色 Spine（先跑 tools/fetch-assets.mjs）' }, () => {
  test('佩佩：倒地闭眼窗口（issue #177：Die 0.13→1.00s）藏住四个眼球件，之前一个都不藏', async () => {
    const real = { data: await loadReal('char_4058_pepe') };
    assert.deepEqual(await hiddenAt(real, 'Die', 0.0), [], 'Die 开场睁眼');
    assert.deepEqual(await hiddenAt(real, 'Die', 0.10), [], '闭眼之前');
    for (const t of [0.30, 0.52, 1.00]) {
      assert.deepEqual((await hiddenAt(real, 'Die', t)).sort(), ['F_L_Eye_B', 'F_L_Eye_C', 'F_R_Eye_B', 'F_R_Eye_C'], `t=${t}`);
    }
  });

  test('仇白：倒地闭眼窗口藏住两只眼球；她的闭眼件本身不在被遮范围内', async () => {
    const real = { data: await loadReal('char_4082_qiubai') };
    assert.deepEqual(await hiddenAt(real, 'Die', 0.0), [], '开场睁眼');
    assert.deepEqual(await hiddenAt(real, 'Die', 0.10), [], '闭眼之前');
    for (const t of [0.20, 0.52, 1.0]) {
      assert.deepEqual((await hiddenAt(real, 'Die', t)).sort(), ['F_L_Eyeball', 'F_R_Eyeball'], `t=${t}`);
    }
  });

  test('隐德来希 / 琳琅诗怀雅：眨眼窗口（Idle 2.13–2.37 / 2.90–3.00）藏，其它时间不藏', async () => {
    const etl = { data: await loadReal('char_4010_etlchi') };
    for (const t of [0.5, 1.9, 3.0]) assert.deepEqual(await hiddenAt(etl, 'Idle', t), [], `隐德来希 @${t} 睁眼`);
    for (const t of [2.13, 2.25, 2.37]) assert.ok((await hiddenAt(etl, 'Idle', t)).length >= 4, `隐德来希 @${t} 眨眼`);
    const sw = { data: await loadReal('char_1033_swire2') };
    for (const t of [0.5, 2.6, 3.2]) assert.deepEqual(await hiddenAt(sw, 'Idle', t), [], `琳琅诗怀雅 @${t} 睁眼`);
    for (const t of [2.90, 2.97, 3.00]) {
      assert.deepEqual((await hiddenAt(sw, 'Idle', t)).sort(), ['F_H_L_Eyeball', 'F_H_L_Eyew', 'F_H_R_Eyeball', 'F_H_R_Eyew'], `琳琅诗怀雅 @${t}`);
    }
  });

  test('不会误藏：四个模型各自动画逐帧扫一遍，藏的比例都是很低的（眨眼/倒地才有）', async () => {
    // [模型, 动画, 时长, 期望藏起来的帧占比下限, 上限] —— 眨眼只有零点几秒，倒地则长期闭眼
    const cases = [
      ['char_4058_pepe', 'Idle', 4.0, 0, 0],       // 待机不闭眼（她闭在 Die）
      ['char_4058_pepe', 'Die', 1.5, 0.5, 1],
      ['char_4082_qiubai', 'Idle', 4.0, 0, 0.35],
      ['char_4082_qiubai', 'Die', 1.0, 0.5, 1],
      ['char_4010_etlchi', 'Idle', 4.0, 0.02, 0.2],  // 待机里眨一次（2.13–2.37）
      ['char_1033_swire2', 'Idle', 4.0, 0.01, 0.2],  // 同上（2.90–3.00）
    ];
    for (const [id, clip, dur, lo, hi] of cases) {
      if (!have(id)) continue;
      const real = { data: await loadReal(id) };
      let hit = 0, frames = 0, most = 0;
      for (let t = 0; t <= dur; t += 1 / 30) {
        const n = (await hiddenAt(real, clip, t)).length;
        frames++; if (n) hit++; most = Math.max(most, n);
      }
      const frac = hit / frames;
      assert.ok(frac >= lo && frac <= hi, `${id} ${clip}: 藏起来的帧占 ${Math.round(frac * 100)}%（期望 ${Math.round(lo * 100)}–${Math.round(hi * 100)}%）`);
      assert.ok(most <= 8, `${id} ${clip}: 单帧最多藏 ${most} 个槽（不该把整张脸藏掉）`);
    }
  });

  test('遮罩重新打开时，把自己藏起来的槽放回去（交给 stencil）', async () => {
    const data = await loadReal('char_4058_pepe');
    const { SpineActor } = await import('../../public/js/render/spine.js');
    const skel = new Skeleton(data);
    const state = new AnimationState(new AnimationStateData(data));
    for (const slot of skel.slots) slot.currentSprite = { visible: true };
    state.setAnimation(0, 'Die', false);
    state.update(0.52); state.apply(skel); skel.updateWorldTransform();
    const self = Object.create(SpineActor.prototype);
    Object.assign(self, {
      clipped: true, clipOn: false, clipRanges: clipRanges(data), spine: { skeleton: skel },
      _clipHidden: null, _clipPoly: null, _clipPoint: null,
    });
    self._eyeMaskFallback();
    const hidden = skel.slots.filter((s) => s.currentSprite.visible === false);
    assert.ok(hidden.length > 0, '前提：倒地闭眼帧上藏了几个');
    self.setClipping(true);
    assert.equal(self.clipOn, true);
    assert.equal(self._clipHidden, null);
    assert.deepEqual(skel.slots.filter((s) => s.currentSprite.visible === false), [], '全部放回可见');
  });
});
