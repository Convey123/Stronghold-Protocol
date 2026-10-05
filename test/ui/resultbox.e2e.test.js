// Browser checks of the settlement result box (ResultDialog; user request "联防成功/失败要跳一个大框出来" and
// "每一把结束以后都有一个成功"), on the in-match mock harness (public/dev/game-mock.html):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/resultbox.e2e.test.js   → screenshots in test/e2e/out/resultbox-*.png
//
// The box prints the OFFICIAL round result dialog's own words (user request "选择官方文案", ui/gameLogic.roundResultBox):
// 作战结束 + 全员无伤！, or + 生命值减少 −N when the round cost the viewer LP. Asserted: `?phase=SETTLE&variant=unite`
// pops it for a leaker the helpers saved (losses.p1 = 0 → 全员无伤！) and `unite,through` for the same leaker charged 3
// (→ 生命值减少 −3, NOT the helpers' 0), driving the harness' own COMBAT → SETTLE switcher pops the round's own battle's
// box, the box is centred and click-through, it closes by itself (and really leaves the DOM), and no scenario logs a
// console error. The words themselves are unit-tested in test/ui/gameLogic.test.js (roundResultBox / uniteResultBox /
// battleResultBox) and the per-player loss behind them server-side in test/match/playtest6-matchflow.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('settlement result box in the browser', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  async function open(url, { w = 1920, h = 1080 } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.goto(`${base}${url}`, { waitUntil: 'networkidle0' });
    return { page, problems };
  }

  /** The box as the player sees it: words + where it sits + how it behaves. */
  const boxState = (page) => page.evaluate(() => {
    const el = document.querySelector('.rdialog');
    if (!el) return null;
    const b = el.querySelector('.rdialog__box').getBoundingClientRect();
    const s = getComputedStyle(el.querySelector('.rdialog__box'));
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    return {
      classes: el.className,
      title: el.querySelector('.rdialog__title').textContent,
      sub: el.querySelector('.rdialog__sub')?.textContent ?? '',
      micro: el.querySelector('.rdialog__micro')?.textContent ?? '',
      chevrons: el.querySelectorAll('.rdialog__chev').length,
      ticks: el.querySelectorAll('.rdialog__tick').length,
      titlePx: parseFloat(getComputedStyle(el.querySelector('.rdialog__title')).fontSize),
      border: s.borderTopColor,
      pointerEvents: getComputedStyle(el).pointerEvents,
      centerX: Math.round(b.left + b.width / 2 - vw / 2),
      centerY: Math.round(b.top + b.height / 2 - vh / 2),
      visible: b.width > 300 && b.height > 90,
      hasText: !!el.textContent.trim(),
    };
  });

  test('the official dialog: 作战结束 + 全员无伤！ for the helper, 生命值减少 −3 for the leaker', async () => {
    const { page, problems } = await open('/dev/game-mock.html?shot=1&render=fallback&phase=SETTLE&variant=unite');
    await page.waitForSelector('.rdialog', { timeout: 10000 });
    const ok = await boxState(page);
    // the mock's local player is p1, a leaker whose enemies the helpers all stopped → charged nothing (losses.p1 = 0)
    assert.match(ok.title, /^作战结束$/, JSON.stringify(ok));
    assert.equal(ok.sub, '全员无伤！');
    assert.match(ok.micro, /BATTLE OVER/);
    assert.ok(ok.classes.includes('rdialog--mint'), `the no-loss tone: ${ok.classes}`);
    assert.equal(ok.chevrons, 2); assert.equal(ok.ticks, 4);
    assert.ok(ok.titlePx >= 40, `a BIG box, not a line of small print (title ${ok.titlePx}px)`);
    assert.ok(ok.visible, 'a real plate, not a hairline');
    assert.ok(Math.abs(ok.centerX) <= 2 && Math.abs(ok.centerY) <= 2, `centred (off by ${ok.centerX},${ok.centerY})`);
    assert.equal(ok.pointerEvents, 'none', 'settlement stays clickable under it');
    await page.screenshot({ path: path.join(OUT, 'resultbox-unite-success.png') });
    assert.deepEqual(problems, []);
    await page.close();

    // the same 联防, but 3 got through: the local leaker (p1) is charged 3 and reads its OWN loss, not the helpers' 0
    const t = await open('/dev/game-mock.html?shot=1&render=fallback&phase=SETTLE&variant=unite,through');
    await t.page.waitForSelector('.rdialog', { timeout: 10000 });
    const bad = await boxState(t.page);
    assert.equal(bad.title, '作战结束');
    assert.equal(bad.sub, '生命值减少 −3', 'the LP the round charged this player, from the manifest view');
    assert.ok(bad.classes.includes('rdialog--red'), `the loss tone: ${bad.classes}`);
    await t.page.screenshot({ path: path.join(OUT, 'resultbox-unite-through.png') });
    assert.deepEqual(t.problems, []);
    await t.page.close();
  });

  test('every battle gets one: COMBAT → SETTLE through the harness switcher pops the official dialog', async () => {
    const { page, problems } = await open('/dev/game-mock.html?render=fallback&phase=COMBAT');
    await sleep(600);
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('#mockbar button')].find((b) => b.textContent.trim() === 'SETTLE');
      if (!btn) return false;
      btn.click();
      return true;
    });
    assert.ok(clicked, 'the switcher has a SETTLE button');
    await page.waitForSelector('.rdialog', { timeout: 8000 });
    const own = await boxState(page);
    assert.equal(own.title, '作战结束', `the round\'s own battle, no 联防: ${JSON.stringify(own)}`);
    assert.equal(own.sub, '全员无伤！');
    assert.ok(own.classes.includes('rdialog--mint'));
    await page.screenshot({ path: path.join(OUT, 'resultbox-own-success.png') });
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('it closes by itself: leaving, then gone (it never blocks the next phase)', async () => {
    const { page, problems } = await open('/dev/game-mock.html?shot=1&render=fallback&phase=SETTLE&variant=unite');
    await page.waitForSelector('.rdialog', { timeout: 10000 });
    assert.ok(await page.$('.rdialog'), 'up at first');
    await page.waitForFunction(() => !document.querySelector('.rdialog'), { timeout: 8000 });
    assert.equal(await page.$('.rdialog'), null, 'and it leaves the DOM after ~2.8 s');
    assert.deepEqual(problems, []);
    await page.close();
  });
});
