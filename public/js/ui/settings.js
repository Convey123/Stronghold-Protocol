// Player settings (BGM/SFX volume, mute, damage numbers, render quality): a tiny observable store
// persisted in localStorage (`sp.pref.settings`), applied to the audio manager on every change, plus
// the settings modal. The packaged apps (docs/APP.md) also show the game server address here — their client is
// local, so the server is the one thing the player may need to point elsewhere (`sp.server`).

import { useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon, MicroLabel } from './components.js';
import { createStore, useStore, loadPref, savePref } from '../store.js';
import { sanitizeSettings } from './gameLogic.js';
import { audio } from '../audio.js';
import { appInfo, displayServer, serverBase, setServerBase, normalizeServerBase, offlineAvailable, offlineMode, setOfflineMode, localServer } from '../serverConfig.js';
import { openGuide } from './guide.js';
import { detectFeatures } from './device.js';

/** Settings store: { bgm, sfx, muted, damageNumbers, quality }. */
export const settingsStore = createStore(sanitizeSettings(loadPref('settings', null)));

settingsStore.subscribe((s) => {
  savePref('settings', sanitizeSettings(s));
  audio.setVolumes(s);
});
audio.setVolumes(settingsStore.get());

/** @param {Partial<ReturnType<typeof sanitizeSettings>>} patch */
export function updateSettings(patch) {
  settingsStore.set(sanitizeSettings({ ...settingsStore.get(), ...patch }));
}

/** Preact hook: current settings. */
export const useSettings = () => useStore((s) => s, Object.is, settingsStore);

function Slider({ label, micro, value, onInput, icon }) {
  const pct = Math.round(value * 100);
  return html`<label class="set-row">
    <span class="set-row__label"><${Icon} name=${icon} />${label}<${MicroLabel}>${micro}<//></span>
    <input class="set-range" type="range" min="0" max="100" step="5" value=${pct} style=${`--pct:${pct}%`}
      onInput=${(e) => onInput(Number(e.currentTarget.value) / 100)} />
    <span class="set-row__val num">${pct}</span>
  </label>`;
}

function Toggle({ label, micro, value, onChange }) {
  return html`<div class="set-row">
    <span class="set-row__label">${label}<${MicroLabel}>${micro}<//></span>
    <button type="button" class=${`set-toggle${value ? ' is-on' : ''}`} role="switch" aria-checked=${value ? 'true' : 'false'}
      onClick=${() => onChange(!value)}><i></i><span>${value ? '开启' : '关闭'}</span></button>
  </div>`;
}

const QUALITY = [['high', '高'], ['medium', '中'], ['low', '低']];

/**
 * Settings modal.
 * @param {{ open: boolean, onClose: Function }} props
 */
/**
 * 联机 / 离线游玩 (packaged desktop apps: the Electron shell runs the game server in-process, docs/APP.md §10).
 * Switching reloads: the socket, the session and the room all belong to one server.
 */
function ModeRow() {
  const offline = offlineMode();
  const pick = (want) => {
    if (want === offline) return;
    setOfflineMode(want);
    try { globalThis.location.reload(); } catch { /* ignore */ }
  };
  return html`<div class="set-row set-row--mode">
    <span class="set-row__label">游玩方式<${MicroLabel}>MODE<//></span>
    <div class="set-seg" role="radiogroup">
      <button type="button" role="radio" aria-checked=${offline ? 'false' : 'true'} class=${offline ? '' : 'is-on'}
        onClick=${() => pick(false)}>联机</button>
      <button type="button" role="radio" aria-checked=${offline ? 'true' : 'false'} class=${offline ? 'is-on' : ''}
        onClick=${() => pick(true)}>离线游玩</button>
    </div>
    <span class="set-note">${offline ? `本机对局 · ${localServer().replace(/^https?:\/\//, '')}` : '连接下面的服务器地址'}</span>
  </div>`;
}

/**
 * Game server address (packaged apps only): where this client connects. Saving reloads the page, because the socket,
 * the session and the whole room are bound to one server (docs/APP.md).
 */
function ServerRow() {
  const [value, setValue] = useState(() => displayServer());
  const [note, setNote] = useState('');
  const current = serverBase();
  const save = () => {
    const base = normalizeServerBase(value);
    if (!base) { setNote('地址无效：例 http://192.168.1.9:3000'); return; }
    if (base === current) { setNote('已经是这个地址'); return; }
    setServerBase(base);
    setNote(`已保存 ${base}，正在重连…`);
    setTimeout(() => { try { globalThis.location.reload(); } catch { /* ignore */ } }, 600);
  };
  return html`<div class="set-row set-row--server">
    <span class="set-row__label">服务器地址<${MicroLabel}>SERVER<//></span>
    <input class="set-input" type="url" inputmode="url" spellcheck="false" placeholder="http://192.168.1.9:3000"
      value=${value} onInput=${(e) => { setValue(e.currentTarget.value); setNote(''); }} />
    <${Button} size="sm" variant="primary" icon="link" onClick=${save}>连接<//>
    ${note ? html`<span class="set-note">${note}</span>` : null}
  </div>`;
}

export function SettingsModal({ open, onClose }) {
  const s = useSettings();
  const [tested, setTested] = useState(false);
  const [touchUi] = useState(() => detectFeatures().coarse && !detectFeatures().fine);
  return html`<${Modal} open=${open} onClose=${onClose} title="设置" micro="SETTINGS" width="7.4rem"
    actions=${html`<${Button} variant="secondary" icon="book" class="set-guide" onClick=${() => openGuide(0)}>玩法说明<//>
      <${Button} variant="primary" icon="check" onClick=${onClose}>完成<//>`}>
    <div class="set-list">
      <${Slider} label="背景音乐" micro="BGM" icon="play" value=${s.bgm} onInput=${(v) => updateSettings({ bgm: v })} />
      <${Slider} label="音效" micro="SFX" icon="signal" value=${s.sfx}
        onInput=${(v) => { updateSettings({ sfx: v }); if (!tested) { setTested(true); setTimeout(() => setTested(false), 400); audio.sfx('click'); } }} />
      <${Toggle} label="静音" micro="MUTE" value=${s.muted} onChange=${(v) => updateSettings({ muted: v })} />
      <${Toggle} label="显示伤害数字" micro="DAMAGE NUMBERS" value=${s.damageNumbers} onChange=${(v) => updateSettings({ damageNumbers: v })} />
      <div class="set-row">
        <span class="set-row__label">画面质量<${MicroLabel}>QUALITY<//></span>
        <div class="set-seg" role="radiogroup">
          ${QUALITY.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${s.quality === id ? 'true' : 'false'}
            class=${s.quality === id ? 'is-on' : ''} onClick=${() => updateSettings({ quality: id })}>${label}</button>`)}
        </div>
      </div>
      ${offlineAvailable() ? html`<${ModeRow} />` : null}
      ${appInfo() && !offlineMode()
        ? html`<${ServerRow} />`
        : null}
      ${appInfo() && offlineMode()
        ? html`<p class="set-hint">离线游玩：由本机客户端自己运行对局（单人 / AI 队友），不需要网络。想联机请切回上面的「联机」。</p>`
        : null}
      ${touchUi
        ? html`<p class="set-hint">触屏操作：点击单位选中（撤退 / 出售）· 长按单位或卡牌查看详情 · 拖动部署后滑动选择朝向</p>`
        : html`<p class="set-hint">快捷键：<kbd>R</kbd> 刷新 · <kbd>F</kbd> 冻结 · <kbd>D</kbd> 升级 · <kbd>Space</kbd> 准备就绪 · <kbd>Esc</kbd> 关闭弹窗 · 右键查看详情</p>`}
    </div>
  <//>`;
}
