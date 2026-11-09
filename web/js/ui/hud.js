// In-round HUD: pause, charged number, combo, progress, boss hearts, combo
// shout-outs and praise. Speaks praise lines (rate-limited by audio.js).

import { h, clear } from './dom.js';

const PRAISE = ['vo_awesome', 'vo_great', 'vo_you_got_it', 'vo_wow', 'vo_brilliant'];

export function createHud(app) {
  const root = app.els.hud;
  clear(root);
  const pause = h('button', { type: 'button', class: 'hud-pause', 'aria-label': 'Pause', onclick: () => app.pauseRound() }, '⏸');
  const chargeVal = h('span', { class: 'charge-value' }, '?');
  const charge = h('div', { class: 'charge empty', 'aria-label': 'Charged number' }, h('span', { class: 'charge-blade', 'aria-hidden': 'true' }, '🗡️'), chargeVal);
  const combo = h('div', { class: 'hud-combo', 'data-tier': '0' });
  const dots = h('div', { class: 'hud-progress' });
  // Boss HP bar (one notch per sum; the boss's name above it).
  const hpFill = h('div', { class: 'hp-fill' });
  const hpName = h('div', { class: 'hp-name' }, '');
  const hearts = h('div', { class: 'hud-boss', hidden: true }, hpName, h('div', { class: 'hp-bar' }, hpFill));
  const shout = h('div', { class: 'hud-shout', 'aria-live': 'polite' });
  const score = h('div', { class: 'hud-score' }, '0');
  root.append(h('div', { class: 'hud-top' }, pause, h('div', { class: 'hud-mid' }, dots, hearts), h('div', { class: 'hud-right' }, combo, score)), charge, shout);

  let total = 0, done = 0, isBoss = false;

  // One dot per deck sum, filled in resolve order: gold = correct, purple = wrong,
  // grey ring = escaped (missed).
  const DOT = { correct: 'on', wrong: 'wrong', escaped: 'missed' };
  function markDot(result) {
    if (isBoss || done >= total) return;
    dots.children[done]?.classList.add(DOT[result]);
    done += 1;
  }

  function showShout(text, cls = '') {
    clear(shout);
    const el = h('div', { class: `shout ${cls}` }, text);
    shout.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  function setCombo(n, tier) {
    combo.textContent = n >= 2 ? `×${n}` : '';
    combo.dataset.tier = String(tier ?? 0);
    combo.classList.remove('bump'); void combo.offsetWidth; if (n >= 2) combo.classList.add('bump');
  }

  return {
    start(plan) {
      root.hidden = false;
      total = plan.config.deck.length;
      done = 0;
      isBoss = plan.type === 'boss';
      clear(dots);
      if (!isBoss) for (let i = 0; i < total; i++) dots.appendChild(h('i'));
      dots.hidden = isBoss;
      hearts.hidden = !isBoss;
      if (isBoss) {
        hpName.textContent = `×${plan.table} Boss`;
        hpFill.style.width = '100%';
        hearts.dataset.phase = '1';
      }
      setCombo(0, 0);
      score.textContent = '0';
      this.charge(null);
      if (plan.type === 'tutorial') showShout('Type, then swipe! ✍️ ➜ 👆', 'hint');
      // The engine speaks vo_boss_time itself.
      if (!isBoss) app.audio.voice(plan.type === 'tutorial' ? 'vo_type_then_swipe' : 'vo_ready_go');
    },
    stop() { root.hidden = true; clear(shout); },
    charge(n) {
      chargeVal.textContent = n == null ? '?' : String(n);
      charge.classList.toggle('empty', n == null);
      charge.classList.remove('bump'); void charge.offsetWidth;
      if (n != null) charge.classList.add('bump');
    },
    event(ev) {
      switch (ev.type) {
        // The engine speaks/plays combo, golden, fixed-it and boss cues and draws
        // the combo and "Fixed it!" banners and the special intro card itself.
        case 'correct':
          if (ev.graded !== false && !ev.golden && !ev.mini && ev.kind !== 'repeat') markDot('correct');
          score.textContent = String(app.engine.score ?? 0);
          if (ev.lantern) showShout('Lantern lit! 🏮', 'hint');
          else if (!ev.tricky_cleared) app.audio.voice(PRAISE[(Math.random() * PRAISE.length) | 0], { praise: true });
          break;
        case 'wrong':
          if (isBoss) showShout('Hee hee! 😜', 'boss');
          if (ev.graded !== false && !ev.golden && !ev.mini && ev.kind !== 'repeat') markDot(ev.type);
          break;
        case 'escaped':
          if (ev.graded !== false && !ev.golden && !ev.mini && ev.kind !== 'repeat') markDot(ev.type);
          break;
        case 'combo':
          setCombo(ev.n, ev.tier);
          break;
        case 'combo_break': setCombo(0, 0); break;
        case 'blade_broken': app.els.stage.classList.add('broken'); break;
        case 'blade_ready': app.els.stage.classList.remove('broken'); break;
        case 'boss_hit':
          hpFill.style.width = `${Math.round((100 * ev.hp) / Math.max(1, ev.max_hp))}%`;
          hearts.classList.remove('hit'); void hearts.offsetWidth; hearts.classList.add('hit');
          break;
        case 'boss_phase':
          hearts.dataset.phase = String(ev.phase);
          showShout(ev.phase >= 3 ? 'Almost there! 💥' : "He's mad! 😠", 'boss');
          break;
        case 'boss_defeated': showShout('You beat the Boss! 🏆', 'fixed'); break;
        default: break;
      }
    },
  };
}
