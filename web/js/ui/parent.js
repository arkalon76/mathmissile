// Grown-ups area. Gate: hold 3 s, then answer an adult-level sum written in words.
// Every name here (child names, reward names) is rendered as text nodes via h();
// every number input is clamped before it is stored.

import { h, btn, clear } from './dom.js';
import { avatarArt, monsterArt } from './art.js';
import { TUNING } from '../logic/tuning.js';
import { PATH, TABLES, factKey, parseKey, ALL_FACT_KEYS, factState, homeTable } from '../logic/facts.js';
import { tableState, isOpenState, applyManualTables } from '../logic/tables.js';
import { TIER_NAMES } from '../logic/speed.js';
import { cleanText, bandForAge } from '../logic/profile.js';
import {
  addRealReward, editRealReward, removeRealReward, pendingRedemptions, confirmRedemption, declineRedemption,
  priceHelper, availableSparks, reservedSparks,
} from '../logic/shop.js';

export const clampInt = (v, lo, hi) => {
  if (v == null || String(v).trim() === '') return null; // a cleared field is not 0
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
};

// ---- gate ------------------------------------------------------------------------

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function numberWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${numberWords(n % 100)}` : ''}`;
}

/** 2-digit × 2-digit in words (a 13..29, no multiples of ten; b 11..19): outside the times tables. */
export function gateQuestion(rand = Math.random) {
  const A = [13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29];
  const a = A[Math.min(A.length - 1, Math.floor(rand() * A.length))];
  const b = 11 + Math.min(8, Math.floor(rand() * 9)); // 11..19
  return { text: `What is ${numberWords(a)} times ${numberWords(b)}?`, answer: a * b };
}

// Lockout: after GATE_MAX_FAILS wrong answers the gate is closed for GATE_LOCK_MS.
// State lives in device storage (app.device.gate) so a reload does not reset it.
export const GATE_MAX_FAILS = 2;
export const GATE_LOCK_MS = 60_000;
/** Seconds left on the lock (0 = open). */
export function gateLockLeft(gate, now = Date.now()) {
  const until = Number(gate?.lockUntil) || 0;
  // A lock further out than one lock came from a wrong clock or a tampered save: ignore it.
  return until > now && until - now <= GATE_LOCK_MS ? Math.ceil((until - now) / 1000) : 0;
}
/** Record a wrong answer; returns the new gate state. */
export function gateFail(gate, now = Date.now()) {
  const fails = (gateLockLeft(gate, now) ? 0 : Number(gate?.fails) || 0) + 1;
  return fails >= GATE_MAX_FAILS ? { fails: 0, lockUntil: now + GATE_LOCK_MS } : { fails, lockUntil: 0 };
}

export function parentGate(app, onPass) {
  const HOLD_MS = 3000;
  const dev = app.device || (app.device = {});
  const saveGate = (g) => { dev.gate = g; app.saveDevice?.(); };
  app.modal((close) => {
    const left = gateLockLeft(dev.gate);
    if (left) {
      return h('div', { class: 'gate' },
        h('div', { class: 'gate-title' }, 'Grown-ups only'),
        h('div', { class: 'gate-sub gate-locked' }, `Locked for a minute. Try again in ${left} s.`),
        btn({ icon: '✖', label: 'Close', onClick: close }));
    }
    const ring = h('div', { class: 'hold-fill' });
    const hold = h('button', { type: 'button', class: 'hold-btn', 'aria-label': 'Hold for 3 seconds' }, ring, h('span', { class: 'hold-icon' }, '🔒'));
    const body = h('div', { class: 'gate' },
      h('div', { class: 'gate-title' }, 'Grown-ups only'),
      h('div', { class: 'gate-sub' }, 'Press and hold the lock for 3 seconds.'),
      hold,
      btn({ icon: '✖', cls: 'round small', aria: 'Close', onClick: close }));
    let t0 = 0, raf = 0, done = false;
    const tick = () => {
      const f = Math.min(1, (performance.now() - t0) / HOLD_MS);
      ring.style.height = `${Math.round(f * 100)}%`;
      if (f >= 1) { done = true; ask(); return; }
      raf = requestAnimationFrame(tick);
    };
    const start = (e) => { e.preventDefault(); if (done || t0) return; t0 = performance.now(); raf = requestAnimationFrame(tick); };
    const stop = () => { if (done) return; cancelAnimationFrame(raf); t0 = 0; ring.style.height = '0%'; };
    hold.addEventListener('pointerdown', start);
    hold.addEventListener('pointerup', stop);
    hold.addEventListener('pointerleave', stop);
    hold.addEventListener('pointercancel', stop);
    hold.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start(e); });
    hold.addEventListener('keyup', stop);
    hold.addEventListener('contextmenu', (e) => e.preventDefault());

    function ask() {
      const q = gateQuestion();
      const input = h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 5, class: 'gate-input', 'aria-label': 'Answer', autocomplete: 'off' });
      const msg = h('div', { class: 'gate-msg' }, '');
      const submit = () => {
        const v = clampInt(String(input.value).replace(/\D/g, ''), 0, 99999);
        if (v === q.answer) { saveGate({ fails: 0, lockUntil: 0 }); close(); onPass(); return; }
        const g = gateFail(dev.gate);
        saveGate(g);
        msg.textContent = g.lockUntil ? 'Not quite. Locked for a minute.' : 'Not quite. Try again later.';
        input.disabled = true;
        setTimeout(close, 1200);
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      clear(body).append(
        h('div', { class: 'gate-title' }, 'Grown-ups only'),
        h('div', { class: 'gate-q', id: 'gate-q' }, q.text),
        input, msg,
        h('div', { class: 'row' }, btn({ icon: '✔', label: 'OK', cls: 'primary', onClick: submit }), btn({ icon: '✖', label: 'Cancel', onClick: close })));
      setTimeout(() => input.focus(), 30);
    }
    return body;
  }, { cls: 'gate-box' });
}

// ---- area ------------------------------------------------------------------------

const fmtMin = (ms) => {
  if (ms > 0 && ms < 60000) return 'under 1 min';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return ''; } };

export function parentArea(app, { childId = null, tab = 'progress' } = {}) {
  const idx = app.store.loadIndex();
  const entries = idx.profiles;
  let cur = childId || app.profile?.id || entries[0]?.id || null;
  let curTab = tab;
  const root = h('div', { class: 'parent' });

  const load = (id) => (app.profile && app.profile.id === id ? app.profile : app.store.loadProfile(id));
  const save = (p) => {
    if (app.profile && app.profile.id === p.id) { app.profile = p; app.save(); }
    else if (!app.store.saveProfile(p)) app.toast('⚠️ Could not save');
  };

  const render = () => {
    clear(root);
    root.appendChild(h('div', { class: 'parent-top' },
      h('h1', null, 'Grown-ups'),
      btn({ icon: '✖', label: 'Close', cls: 'small', onClick: () => app.show(app.profile ? 'map' : 'profiles') })));
    if (!entries.length) { root.appendChild(h('p', null, 'No players yet.')); return; }
    const kids = h('div', { class: 'kid-tabs' });
    for (const e of entries) {
      const p = load(e.id);
      const pend = p ? pendingRedemptions(p).length : 0;
      kids.appendChild(h('button', { type: 'button', class: ['kid-tab', e.id === cur ? 'on' : ''], onclick: () => { cur = e.id; render(); } },
        p ? avatarArt(p, 40) : monsterArt(e.avatar, { size: 40 }), h('span', null, e.name), pend ? h('span', { class: 'badge-count' }, String(pend)) : null));
    }
    root.appendChild(kids);
    const p = load(cur);
    if (!p) { root.appendChild(h('p', null, 'This profile could not be loaded.')); return; }
    const pend = pendingRedemptions(p).length;
    const TABS = [['progress', 'Progress'], ['settings', 'Settings'], ['rewards', pend ? `Rewards (${pend})` : 'Rewards'], ['profile', 'Profile']];
    root.appendChild(h('div', { class: 'ptabs' }, ...TABS.map(([k, label]) =>
      h('button', { type: 'button', class: ['ptab', k === curTab ? 'on' : ''], 'data-tab': k, onclick: () => { curTab = k; render(); } }, label))));
    const body = h('div', { class: 'pbody' });
    root.appendChild(body);
    ({ progress, settings, rewards, profile: profileTab })[curTab](body, p);
  };

  // ---- progress
  function progress(body, p) {
    const states = {};
    for (const k of ALL_FACT_KEYS) states[k] = factState(p.facts[k], isOpenState(tableState(p, homeTable(k))));
    const grid = h('table', { class: 'fact-grid', 'aria-label': 'Facts 1 to 12' });
    const head = h('tr', null, h('th', null, '×'), ...TABLES.map((b) => h('th', null, String(b))));
    grid.appendChild(head);
    for (const a of TABLES) {
      const row = h('tr', null, h('th', null, String(a)));
      for (const b of TABLES) {
        const k = factKey(a, b);
        const rec = p.facts[k];
        const st = states[k];
        row.appendChild(h('td', { class: [`fs-${st}`, rec?.tricky ? 'tricky' : ''], title: `${a}×${b}: ${st}` }, rec?.tricky ? '!' : ''));
      }
      grid.appendChild(row);
    }
    const label = (k) => { const f = parseKey(k); return f ? `${f.a}×${f.b}` : k; };
    const mastered = ALL_FACT_KEYS.filter((k) => states[k] === 'mastered');
    const known = ALL_FACT_KEYS.filter((k) => states[k] === 'known');
    const tricky = ALL_FACT_KEYS.filter((k) => p.facts[k]?.tricky || ((p.facts[k]?.wrong || 0) >= 2 && (p.facts[k]?.box ?? 0) < 3))
      .sort((x, y) => (p.facts[y].wrong || 0) - (p.facts[x].wrong || 0));
    const P = p.progress;
    const days = new Set(p.history.map((r) => r.day)).size;
    body.append(
      h('div', { class: 'stat-row' },
        stat('Time played', fmtMin(P.timePlayedMs)), stat('Rounds', String(P.roundIndex)), stat('Play days', String(days)),
        stat('Level', String(P.level)), stat('Sparks', `${availableSparks(p)}${reservedSparks(p) ? ` (+${reservedSparks(p)} reserved)` : ''}`),
        stat('Accuracy', P.totalCorrect + P.totalWrong ? `${Math.round((100 * P.totalCorrect) / (P.totalCorrect + P.totalWrong))}%` : '–')),
      h('div', { class: 'legend' }, ...['new', 'learning', 'growing', 'known', 'mastered', 'locked'].map((s) => h('span', { class: `lg fs-${s}` }, s)), h('span', { class: 'lg tricky' }, '! tricky')),
      grid,
      h('h3', null, `Mastered (${mastered.length})`), h('p', { class: 'fact-list' }, mastered.map(label).join('  ') || '–'),
      h('h3', null, `Known (${known.length})`), h('p', { class: 'fact-list' }, known.map(label).join('  ') || '–'),
      h('h3', null, `Tricky (${tricky.length})`), h('p', { class: 'fact-list tricky-list' }, tricky.map(label).join('  ') || '–'),
      h('h3', null, 'Tables'),
      h('div', { class: 'table-states' }, ...PATH.map((T) => h('span', { class: `ts ts-${tableState(p, T)}` }, `×${T}: ${tableState(p, T)}`))));
  }
  const stat = (k, v) => h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, v), h('div', { class: 'stat-k' }, k));

  // ---- settings
  function settings(body, p) {
    const S = p.settings;
    const tierRow = h('div', { class: 'seg' }, ...TIER_NAMES.map((n, i) => h('button', { type: 'button', class: ['seg-btn', S.baseTier === i ? 'on' : ''], 'data-tier': i,
      onclick: () => {
        S.baseTier = clampInt(i, 0, TIER_NAMES.length - 1);
        S.targetMs = TUNING.targetMsByTier[S.baseTier];
        p.speed.offset = 0;
        p.speed.recent = '';
        save(p); render();
      } }, n)));
    const modeRow = h('div', { class: 'seg' }, ...[['guided', 'Guided path'], ['manual', 'Pick tables']].map(([m, label]) =>
      h('button', { type: 'button', class: ['seg-btn', S.tableMode === m ? 'on' : ''], onclick: () => { S.tableMode = m; save(p); render(); } }, label)));
    const tableBoxes = h('div', { class: 'table-picks' }, ...PATH.map((T) => {
      const open = isOpenState(tableState(p, T));
      const cb = h('input', { type: 'checkbox', checked: open || S.manualTables.includes(T), disabled: open && !S.manualTables.includes(T), value: T });
      return h('label', { class: 'table-pick' }, cb, ` ×${T}`);
    }));
    const applyTables = btn({ label: 'Open ticked tables', cls: 'small', onClick: () => {
      const picked = [...tableBoxes.querySelectorAll('input:checked')].map((c) => clampInt(c.value, 1, 12)).filter((T) => T != null);
      applyManualTables(p, picked, p.progress.roundIndex);
      save(p); render(); app.toast('Tables updated');
    } });
    const minutes = h('input', { type: 'number', min: 5, max: TUNING.breakMinutesMax, step: 5, value: S.breakMinutes || TUNING.breakMinutesDefault, class: 'num', 'aria-label': 'Minutes', disabled: !S.breakMinutes });
    const breakOn = h('input', { type: 'checkbox', checked: !!S.breakMinutes, 'aria-label': 'Break reminder on' });
    const saveBreak = () => {
      S.breakMinutes = breakOn.checked ? (clampInt(minutes.value, 5, TUNING.breakMinutesMax) ?? TUNING.breakMinutesDefault) : 0;
      minutes.disabled = !breakOn.checked;
      if (breakOn.checked) minutes.value = S.breakMinutes;
      if (app.profile?.id === p.id && app.session) app.session.breakMinutes = S.breakMinutes;
      save(p);
    };
    breakOn.addEventListener('change', saveBreak);
    minutes.addEventListener('change', saveBreak);
    body.append(
      h('h3', null, 'Base speed'), h('p', { class: 'hint' }, 'The game still adapts up and down from here. Changing it resets the adaptive part.'), tierRow,
      h('h3', null, 'Tables'), modeRow,
      h('p', { class: 'hint' }, S.tableMode === 'guided' ? 'New tables open as the child masters the earlier ones. You can also open tables now:' : 'Only tables you open are used for new facts; the guided path does not open more.'),
      tableBoxes, applyTables,
      h('h3', null, 'Break reminder'),
      h('div', { class: 'row left' }, h('label', { class: 'check' }, breakOn, ' Suggest a break after'), minutes, h('span', null, ' minutes of play')),
      h('p', { class: 'hint' }, 'A friendly monster suggests a break. It is never forced.'));
  }

  // ---- rewards
  function rewards(body, p) {
    const pend = pendingRedemptions(p);
    if (pend.length) {
      body.appendChild(h('h3', null, 'Waiting for you'));
      for (const q of pend) {
        body.appendChild(h('div', { class: 'req' },
          h('div', { class: 'req-name' }, q.name), h('div', { class: 'req-price' }, `${q.price} Sparks`), h('div', { class: 'req-when' }, fmtDate(q.requestedAt)),
          btn({ label: 'Give it', cls: 'primary small', onClick: () => {
            const r = confirmRedemption(p, q.id);
            if (!r.ok) app.toast(r.reason === 'sparks' ? 'Not enough Sparks' : 'Could not confirm');
            else { app.audio.play('sfx_purchase'); save(p); }
            render();
          } }),
          btn({ label: 'Not now', cls: 'small', onClick: () => { declineRedemption(p, q.id); save(p); render(); } })));
      }
    }
    body.appendChild(h('h3', null, 'Real-life rewards'));
    body.appendChild(h('p', { class: 'hint' }, `Sparks: ${availableSparks(p)} free${reservedSparks(p) ? `, ${reservedSparks(p)} reserved for requests` : ''}.`));
    const list = h('div', { class: 'real-list' });
    for (const r of p.rewards.real) list.appendChild(rewardRow(p, r));
    body.appendChild(list);

    // add form
    const name = h('input', { type: 'text', maxlength: TUNING.realRewardNameMax, placeholder: 'e.g. Trip to the park', class: 'txt', 'aria-label': 'Reward name', id: 'rr-name' });
    const price = h('input', { type: 'number', min: 1, max: TUNING.realRewardPriceMax, step: 10, value: 300, class: 'num', 'aria-label': 'Price in Sparks', id: 'rr-price' });
    const help = h('div', { class: 'price-help', id: 'rr-help' });
    const upd = () => renderHelp(help, p, price.value);
    price.addEventListener('input', upd);
    upd();
    const add = btn({ label: 'Add reward', cls: 'primary small', onClick: () => {
      const v = clampInt(price.value, 1, TUNING.realRewardPriceMax);
      const n = cleanText(name.value, TUNING.realRewardNameMax);
      if (!n || v == null) { app.toast('Add a name and a price'); return; }
      if (p.rewards.real.length >= TUNING.realRewardsMax) { app.toast('That is the most rewards for now'); return; }
      const r = addRealReward(p, { name: n, price: v });
      if (!r) { app.toast('Could not add'); return; }
      save(p); render();
    } });
    add.id = 'rr-add';
    body.append(h('div', { class: 'add-form' }, name, price, h('span', null, 'Sparks'), add), help);

    const log = p.rewards.redemptions.filter((q) => q.status !== 'pending').slice().reverse();
    body.appendChild(h('h3', null, 'Log'));
    if (!log.length) body.appendChild(h('p', { class: 'hint' }, 'Nothing yet.'));
    else {
      const t = h('table', { class: 'log' }, h('tr', null, h('th', null, 'Reward'), h('th', null, 'Sparks'), h('th', null, 'Asked'), h('th', null, 'Result')));
      for (const q of log.slice(0, 50)) t.appendChild(h('tr', null, h('td', null, q.name), h('td', null, String(q.price)), h('td', null, fmtDate(q.requestedAt)),
        h('td', null, `${q.status === 'confirmed' ? 'Given' : q.status === 'declined' ? 'Not now' : q.status} ${fmtDate(q.resolvedAt)}`)));
      body.appendChild(t);
    }
  }

  function renderHelp(el, p, priceVal) {
    const v = clampInt(priceVal, 1, TUNING.realRewardPriceMax);
    clear(el);
    if (v == null) return;
    const ph = priceHelper(p, v);
    el.append(h('strong', null, `≈ ${ph.rounds} round${ph.rounds === 1 ? '' : 's'} / ≈ ${ph.days} play day${ph.days === 1 ? '' : 's'}`),
      h('span', null, ` (about ${ph.sparksPerRound} Sparks a round, ${ph.roundsPerDay} rounds a day${ph.usedDefaults ? ', starting guess' : ''})`));
  }

  function rewardRow(p, r) {
    const name = h('input', { type: 'text', maxlength: TUNING.realRewardNameMax, value: r.name, class: 'txt', 'aria-label': 'Reward name' });
    const price = h('input', { type: 'number', min: 1, max: TUNING.realRewardPriceMax, value: r.price, class: 'num', 'aria-label': 'Price' });
    const help = h('div', { class: 'price-help' });
    renderHelp(help, p, r.price);
    price.addEventListener('input', () => renderHelp(help, p, price.value));
    const commit = () => {
      const res = editRealReward(p, r.id, { name: name.value, price: clampInt(price.value, 1, TUNING.realRewardPriceMax) });
      if (!res) { name.value = r.name; price.value = r.price; return; }
      save(p);
    };
    name.addEventListener('change', commit);
    price.addEventListener('change', commit);
    return h('div', { class: 'real-row' }, name, price, h('span', null, 'Sparks'),
      btn({ label: 'Remove', cls: 'small', onClick: () => { if (window.confirm('Remove this reward?')) { removeRealReward(p, r.id); save(p); render(); } } }), help);
  }

  // ---- profile
  function profileTab(body, p) {
    const age = h('input', { type: 'number', min: 3, max: 18, value: p.age, class: 'num', 'aria-label': 'Age' });
    age.addEventListener('change', () => { const a = clampInt(age.value, 3, 18); if (a != null) { p.age = a; p.ageBand = bandForAge(a); age.value = a; save(p); } });
    const name = h('input', { type: 'text', maxlength: TUNING.profileNameMax, value: p.name, class: 'txt', 'aria-label': 'Name' });
    name.addEventListener('change', () => {
      const n = cleanText(name.value, TUNING.profileNameMax);
      if (!n) { name.value = p.name; return; }
      p.name = n; save(p);
      const ix = app.store.loadIndex();
      const e = ix.profiles.find((x) => x.id === p.id);
      if (e) { e.name = n; app.store.saveIndex(ix); }
      render();
    });
    const confirmBox = h('input', { type: 'text', class: 'txt', placeholder: 'Type DELETE', 'aria-label': 'Type DELETE to confirm' });
    const del = btn({ label: 'Delete this player', cls: 'danger small', onClick: () => {
      if (confirmBox.value.trim().toUpperCase() !== 'DELETE') { app.toast('Type DELETE first'); return; }
      app.store.deleteProfile(p.id);
      if (app.profile?.id === p.id) app.profile = null;
      const i = entries.findIndex((e) => e.id === p.id);
      if (i >= 0) entries.splice(i, 1);
      cur = entries[0]?.id || null;
      render();
    } });
    body.append(
      h('h3', null, 'Name'), name,
      h('h3', null, 'Age'), age,
      h('p', { class: 'hint' }, 'Saved only in this browser.'),
      h('h3', null, 'Delete'),
      h('p', { class: 'hint' }, 'This removes all progress for this player on this device. It cannot be undone.'),
      h('div', { class: 'row left' }, confirmBox, del));
  }

  render();
  return root;
}
