// Math Missile shell: boots the engine, audio and save store, routes between
// screens and runs the round flow (plan → pre-round → round → apply → reward).

import { Engine } from './engine.js';
import { ChargeInput, bindPointer, wantsTouchPad } from './input.js';
import { createAudio } from './audio.js';
import { RoundRunner } from './round.js';
import { createStore, browserStorage, createProfile } from './logic/profile.js';
import { planRound } from './logic/deck.js';
import { applyRound } from './logic/rewards.js';
import { decayedOffset } from './logic/speed.js';
import { dayOf } from './logic/day.js';
import { createSession, addPlay, shouldNudge, markNudged } from './logic/session.js';
import { hashSeed } from './logic/rng.js';
import { beginPending, recordEvent, canResume, partialSummary } from './logic/resume.js';
import { h, btn, clear } from './ui/dom.js';
import { setPortraitSource } from './ui/art.js';
import { SCREENS } from './ui/screens.js';
import { showReward } from './ui/reward.js';
import { createHud } from './ui/hud.js';
import { parentGate, parentArea } from './ui/parent.js';

const params = new URLSearchParams(location.search);
// ?debug (window.mm, console traces) only on a local dev host.
const DEBUG = params.has('debug') && ['localhost', '127.0.0.1'].includes(location.hostname);
const $ = (id) => document.getElementById(id);

const MUSIC = {
  title: 'mus_menu', profiles: 'mus_menu', create: 'mus_menu', parent: 'mus_menu',
  map: 'mus_map', book: 'mus_map', stickers: 'mus_map', badges: 'mus_map', workshop: 'mus_map', settings: 'mus_map',
  reward: 'mus_reward',
};

const app = {
  store: null, audio: null, engine: null, runner: null, input: null, hud: null,
  profile: null, device: null, screen: null, session: null, inRound: false,
  els: {},
};
window.mm = DEBUG ? app : undefined;

// ---- saving ---------------------------------------------------------------------

app.save = () => {
  if (!app.profile) return;
  const ok = app.store.saveProfile(app.profile);
  if (!ok) toast('⚠️ Could not save');
};
app.saveDevice = () => app.store.saveDevice(app.device);

app.selectProfile = (entry) => {
  const { profile, recovered } = app.store.loadOrRecover(entry);
  if (!profile) { toast('⚠️'); return; }
  const pending = profile.pendingRound;
  profile.pendingRound = null;
  app.profile = profile;
  app.session = createSession({ breakMinutes: profile.settings.breakMinutes });
  const resumed = canResume(pending) ? resumeRound(profile, pending) : null;
  app.save();
  if (recovered) toast('🩹 Save repaired');
  app.applyCosmetics();
  if (resumed) {
    // The page closed mid-round: the answers given so far still count (§8).
    app.lastReport = resumed.report;
    app.show('reward', resumed);
    toast('💾 Your last round was saved!');
    return;
  }
  app.show('map');
};

/** Re-plan a round that was cut short and apply the answers saved so far. */
function resumeRound(profile, pending) {
  try {
    const today = pending.today || dayOf(new Date());
    const plan = planRound(profile, { seed: pending.seed, today, choice: pending.choice, offset: pending.offset ?? decayedOffset(profile.speed, today) });
    if (plan.roundIndex !== pending.roundIndex) return null;
    const report = applyRound(profile, plan, partialSummary(pending), { now: new Date(), today: dayOf(new Date()) });
    return { report, plan };
  } catch (err) {
    console.warn('[resume]', err);
    return null;
  }
}

app.createProfile = ({ name, avatar, age }) => {
  const p = createProfile({ name, avatar, age, now: new Date() });
  app.profile = p;
  app.session = createSession({ breakMinutes: p.settings.breakMinutes });
  app.save();
  app.applyCosmetics();
  return p;
};

app.applyCosmetics = () => {
  if (app.input) app.updatePad();
  document.body.classList.toggle('calm', !!app.profile?.settings.calmEffects);
  const e = app.engine, p = app.profile;
  if (!e || !p) return;
  if (typeof e.setCosmetics === 'function') {
    try { e.setCosmetics({ blade: p.avatar.blade, trail: p.avatar.trail }); } catch (err) { console.warn(err); }
  }
  if (typeof e.setCalm === 'function') e.setCalm(!!p.settings.calmEffects);
};

// ---- screens --------------------------------------------------------------------

app.show = (name, args = {}) => {
  const root = app.els.screen;
  app.screen = name;
  root.hidden = false;
  clear(root);
  root.className = `screen screen-${name}`;
  const fn = name === 'parent' ? parentArea : SCREENS[name];
  if (!fn) throw new Error(`no screen ${name}`);
  root.appendChild(fn(app, args));
  root.scrollTop = 0;
  if (MUSIC[name]) app.audio.music(MUSIC[name]);
};

app.openParent = () => {
  parentGate(app, () => app.show('parent'));
};

app.modal = (content, { onClose, cls = '' } = {}) => {
  const m = app.els.modal;
  clear(m);
  m.hidden = false;
  const close = () => { m.hidden = true; clear(m); onClose?.(); };
  const box = h('div', { class: `modal-box ${cls}` });
  box.appendChild(typeof content === 'function' ? content(close) : content);
  m.appendChild(box);
  return close;
};

function toast(text) {
  const t = h('div', { class: 'toast' }, text);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}
app.toast = toast;

// ---- round flow ------------------------------------------------------------------

app.play = async (choice = {}) => {
  const p = app.profile;
  if (!p || app.inRound) return;
  const today = dayOf(new Date());
  const seed = hashSeed(p.id, p.progress.roundIndex + 1, Date.now()) >>> 0;
  // Decay into the plan only; applyRound commits it (§3.3).
  const offset = decayedOffset(p.speed, today);
  const plan = planRound(p, { seed, today, choice, offset });
  p.pendingRound = beginPending(plan, { seed, today, choice, offset });
  app.roundT0 = performance.now();
  app.save();
  app.inRound = true;
  let summary = null;
  try {
    await SCREENS.preround(app, plan);
    summary = await runRound(plan);
  } catch (err) {
    console.error('[round]', err);
    endRoundUi();
  } finally {
    app.inRound = false;
    p.pendingRound = null;
  }
  if (!summary || summary.aborted) { app.save(); app.show('map'); return; }
  const report = applyRound(p, plan, summary, { now: new Date(), today });
  app.save();
  addPlay(app.session, summary.duration_ms || 0);
  if (DEBUG) console.debug('[round]', plan, summary, report);
  app.lastReport = report;
  app.applyCosmetics();
  app.show('reward', { report, plan });
};

// Coins fly to the HUD score, lanterns to the progress dots (CSS px, canvas-relative).
app.setAnchors = () => {
  const c = app.els.canvas.getBoundingClientRect();
  const at = (sel, fx, fy) => {
    const el = app.els.hud.querySelector(sel);
    const r = el && el.getBoundingClientRect();
    return r && r.width ? [r.left - c.left + r.width / 2, r.top - c.top + r.height / 2] : [fx, fy];
  };
  app.engine.setAnchor('sparks', ...at('.hud-score', c.width - 40, 30));
  app.engine.setAnchor('island', ...at('.hud-progress', c.width / 2, 20));
};

async function runRound(plan) {
  const { engine, input } = app;
  app.els.screen.hidden = true;
  app.els.modal.hidden = true;
  app.els.stage.classList.add('playing');
  if (app.wantsPad) { app.els.pad.hidden = false; engine.resize(); }
  input.reset();
  input.enabled = true;
  engine.setCharged(null);
  app.hud.start(plan);
  app.setAnchors();
  const mus = plan.type === 'boss' ? 'mus_boss' : plan.event ? 'mus_event'
    : plan.type === 'tutorial' || app.profile.ageBand === 'little' ? 'mus_play_calm' : 'mus_play_upbeat';
  app.audio.music(mus);
  engine.setPaused?.(false);
  engine.start();
  app.roundLive = true;
  const summary = await app.runner.run(plan);
  endRoundUi();
  return summary;
}

/** Put the stage back after a round (also after a failed start). */
function endRoundUi() {
  const { engine, input } = app;
  app.roundLive = false;
  input.enabled = false;
  input.reset();
  app.audio.setHum(false);
  engine.setCharged(null);
  engine.setPaused?.(false);
  app.hud.stop();
  app.els.pad.hidden = true;
  app.els.stage.classList.remove('playing', 'broken');
  engine.resize();
  setTimeout(() => { if (!app.inRound) engine.stop(); }, 400);
}

app.pauseRound = () => {
  if (!app.inRound || !app.roundLive || !app.els.modal.hidden) return; // not during the countdown
  app.engine.setPaused(true);
  app.input.enabled = false; // no digits while paused
  app.modal((close) => h('div', { class: 'pause' },
    h('div', { class: 'big-icon' }, '⏸'),
    h('div', { class: 'row' },
      btn({ icon: '▶', label: 'Go on', cls: 'primary', onClick: () => { close(); } }),
      btn({ icon: '🏝️', label: 'Map', onClick: () => { close(); app.runner.abort(); } }))),
  { onClose: () => { app.engine.setPaused(false); if (app.inRound) app.input.enabled = true; } });
};

app.afterReward = (next) => {
  if (app.session && shouldNudge(app.session)) {
    markNudged(app.session);
    SCREENS.breakNudge(app, next);
    return;
  }
  next();
};

// Number pad: the child's setting (auto | on | off); auto = touch devices only.
let padBuilt = false;
app.updatePad = () => {
  const pref = app.profile?.settings.numberPad || 'auto';
  app.wantsPad = pref === 'on' ? true : pref === 'off' ? false : wantsTouchPad();
  if (app.wantsPad && !padBuilt) { app.input.buildPad(app.els.pad); padBuilt = true; }
  app.els.app.classList.toggle('has-pad', app.wantsPad);
};

// ---- boot --------------------------------------------------------------------------

async function boot() {
  app.els = { app: $('app'), stage: $('stage'), canvas: $('game'), screen: $('screen'), modal: $('modal'), pad: $('pad'),
    hud: $('hud'), error: $('error') };
  app.store = createStore(browserStorage());
  app.device = app.store.loadDevice();
  app.audio = createAudio({ device: app.device.volume ? { ...app.device.volume, muted: app.device.muted } : {} });
  btn.onTap = () => app.audio.play('sfx_ui_tap');

  try {
    app.engine = await Engine.create(app.els.canvas, { onSfx: (id, opts) => app.audio.play(id, opts || {}) });
  } catch (err) {
    console.error(err);
    app.els.error.hidden = false;
    app.els.error.textContent = 'Could not start the game on this browser.';
    return;
  }
  setPortraitSource((id, o) => app.engine.portrait(id, o));
  window.addEventListener('resize', () => { if (app.inRound) app.setAnchors(); });

  let inputSfx = false;
  let lastLen = 0;
  app.input = new ChargeInput({
    onSfx: (id, opts) => { inputSfx = true; app.audio.play(id, opts || {}); },
    onChange: (n) => {
      const len = n == null ? 0 : String(n).length;
      if (!inputSfx) {
        if (n == null) app.audio.play('sfx_backspace');
        else app.audio.play('sfx_key_tap', { semitones: [0, 2, 4][Math.min(2, len - 1)] || 0 });
      }
      lastLen = len;
      app.engine.setCharged(n);
      app.audio.setHum(n != null && app.inRound);
      app.hud.charge(n);
    },
  });
  app.input.enabled = false;
  app.input.attachKeyboard();
  app.updatePad();
  bindPointer(app.els.canvas, app.engine);

  app.hud = createHud(app);
  app.runner = new RoundRunner(app.engine, { onEvent: (ev) => {
    app.hud.event(ev);
    // Save each answer as it happens, so a reload mid-round loses nothing.
    const pr = app.inRound && app.profile?.pendingRound;
    if (pr && recordEvent(pr, ev, performance.now() - (app.roundT0 || 0))) app.save();
  } });
  app.engine.on('charge_cleared', () => { app.input.reset(); app.audio.setHum(false); app.hud.charge(null); });

  // WebGL context loss: hold the round on the pause screen; if the engine cannot
  // rebuild, end the round (it is saved as aborted) and offer a reload.
  app.engine.on('context_lost', () => { if (app.inRound) app.pauseRound(); });
  app.engine.on('hidden', () => { if (app.inRound) app.pauseRound(); }); // back to a pause screen, not moving monsters
  app.engine.on('context_restore_failed', (ev) => {
    console.warn('[engine] context restore failed', ev.message);
    if (app.inRound) app.runner.abort();
    app.modal((close) => h('div', { class: 'pause' },
      h('div', { class: 'big-icon' }, '🌧️'),
      h('p', null, 'The game picture got stuck. Your progress is safe.'),
      h('div', { class: 'row' },
        btn({ icon: '🔄', label: 'Reload', cls: 'primary', onClick: () => location.reload() }),
        btn({ icon: '🏝️', label: 'Map', onClick: () => close() }))));
  });

  if (DEBUG) app.engine.on('*', (ev) => ev.type !== 'sfx' && console.debug('[engine]', ev));
  // Pause is the HUD button, or P. Escape is left to input.js (it clears the charge).
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'p' || e.key === 'P') && !e.repeat && app.inRound && app.els.modal.hidden) app.pauseRound();
  });

  const problems = app.store.problems || [];
  if (problems.length) console.warn('[store]', problems);
  app.show('title');
}

boot();
