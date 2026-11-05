// Round-end reward screen: stars, score, XP bar with level-ups, Sparks,
// reveal cards, chests (tap to open), "Next up" and the way on.
// Tapping the background speeds the sequence up; nothing is skipped.

import { h, btn, bar, clear, countUp, burst } from './dom.js';
import { monsterArt } from './art.js';
import { levelProgress, xpNeed } from '../logic/progression.js';
import { ITEMS_BY_ID, SPECIES_BY_ID, STICKERS_BY_ID, BADGES_BY_ID } from '../logic/catalog.js';

const throttle = (fn, ms) => { let t = 0; return () => { const n = performance.now(); if (n - t >= ms) { t = n; fn(); } }; };

const STAMP_ICON = { met: '💌', friend: '🤝', best: '💖' };

export function showReward(app, { report: R, plan }) {
  const p = app.profile;
  let speed = 1;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms / speed));
  const root = h('div', { class: 'reward', onclick: () => { speed = 4; } });

  // --- header: stars
  const stars = h('div', { class: 'stars' }, ...[0, 1, 2].map(() => h('div', { class: 'star' }, '★')));
  const score = h('div', { class: 'score' }, '0');
  const best = h('div', { class: 'new-best', hidden: true }, '🏆 New best!');
  const xpLv = h('div', { class: 'xp-level' }, `⭐ ${R.levelBefore}`);
  const xpBar = bar(levelProgress(R.xpBefore).frac, 'xp big');
  const xpNum = h('div', { class: 'xp-num' }, '+0');
  const sparks = h('div', { class: 'pill sparks big' }, '✨ ', h('span', { class: 'sp-n' }, String(R.sparksBefore)));
  const sparksGain = h('div', { class: 'sparks-gain' }, '');
  const cards = h('div', { class: 'cards' });
  const next = h('div', { class: 'next-up', hidden: true });
  const buttons = h('div', { class: 'reward-buttons', hidden: true },
    btn({ icon: '🗺️', cls: 'big', aria: 'Map', onClick: () => app.afterReward(() => app.show('map')) }),
    btn({ icon: '▶', label: 'Again', cls: 'huge primary pulse', onClick: () => app.afterReward(() => app.play()) }));

  root.append(
    stars,
    h('div', { class: 'score-row' }, score, best),
    h('div', { class: 'xp-row' }, xpLv, xpBar, xpNum),
    h('div', { class: 'sparks-row' }, sparks, sparksGain),
    cards, next, buttons);

  (async () => {
    await wait(350);
    // stars
    const starEls = stars.children;
    for (let i = 0; i < 3; i++) {
      if (i < R.stars) {
        starEls[i].classList.add('on');
        app.audio.play(`sfx_star_${i + 1}`);
        burst(starEls[i], { n: 10, colors: ['#ffd23f', '#fff3a0', '#ff9f1c'] });
      } else starEls[i].classList.add('off');
      await wait(420);
    }
    if (R.sparkle) { stars.classList.add('sparkle'); app.audio.play('sfx_star_sparkle'); }
    if (R.stars === 3) app.audio.voice(R.sparkle ? 'vo_rainbow' : 'vo_three_stars', { force: true });
    else app.audio.voice('vo_great_job', { force: true });

    // score
    await countUp(score, 0, R.score || 0, 700 / speed, throttle(() => app.audio.play('sfx_count_tick', { volume: 0.4 }), 70));
    if (R.newBest) { best.hidden = false; best.classList.add('pop'); app.audio.voice('vo_new_best'); await wait(500); }

    // xp
    await fillXp();

    // sparks
    if (R.sparksGained) {
      sparksGain.textContent = `+${R.sparksGained}`;
      sparksGain.classList.add('pop');
      const n = sparks.querySelector('.sp-n');
      await countUp(n, R.sparksBefore, R.sparksAfter, 600 / speed, throttle(() => app.audio.play('sfx_coin_tinkle', { volume: 0.3 }), 110));
      burst(sparks, { n: 12, chars: ['✨'] });
    }

    // cards
    for (const c of R.cards) {
      const el = card(c);
      if (!el) continue;
      cards.appendChild(el);
      el.classList.add('in');
      el.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      cardSound(c);
      burst(el, { n: 14 });
      await wait(650);
    }
    // chests
    for (const ch of R.chests) {
      await chest(ch);
    }

    // next up
    if (R.nextUp?.length) {
      next.hidden = false;
      next.appendChild(h('div', { class: 'next-title' }, '👉'));
      for (const n of R.nextUp.slice(0, 3)) {
        next.appendChild(h('div', { class: 'next-item' },
          h('div', { class: 'next-icon' }, n.icon || '⭐'),
          h('div', { class: 'next-label' }, n.label || ''),
          bar(n.need ? Math.min(1, (n.have || 0) / n.need) : 0),
          h('div', { class: 'next-count' }, `${n.have ?? 0} / ${n.need ?? '?'}`)));
      }
    }
    buttons.hidden = false;
    buttons.classList.add('in');
    buttons.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
    root.onclick = null;
  })().catch((e) => console.error(e));

  async function fillXp() {
    let xp = R.xpBefore;
    const end = R.xpAfter;
    xpNum.textContent = `+${R.xpGained}`;
    let lv = levelProgress(xp).level;
    const step = Math.max(1, Math.round(R.xpGained / 30));
    let ticks = 0;
    while (xp < end) {
      xp = Math.min(end, xp + step);
      const lp = levelProgress(xp);
      xpBar.firstChild.style.width = `${Math.round(lp.frac * 100)}%`;
      if (++ticks % 3 === 0) app.audio.play('sfx_xp_fill', { volume: 0.25, semitones: Math.min(12, ticks / 3) });
      if (lp.level > lv) {
        lv = lp.level;
        xpLv.textContent = `⭐ ${lv}`;
        await levelUp(R.levelUps.find((u) => u.level === lv) || { level: lv, items: [] });
      }
      await wait(28);
    }
    app.audio.play('sfx_xp_ding');
    void xpNeed;
  }

  async function levelUp(up) {
    app.audio.play('sfx_level_up');
    app.audio.voice('vo_level_up', { force: true });
    burst(root, { n: 40, spread: 260 });
    const box = h('div', { class: 'level-up' },
      h('div', { class: 'lu-text' }, 'LEVEL UP!'),
      h('div', { class: 'lu-num' }, String(up.level)),
      up.title ? h('div', { class: 'lu-title' }, up.title) : null,
      h('div', { class: 'lu-items' }, ...(up.items || []).map((id) => h('div', { class: 'lu-item' }, ITEMS_BY_ID[id]?.icon || '🎁'))),
      up.sparks ? h('div', { class: 'lu-sparks' }, `✨ +${up.sparks}`) : null);
    root.appendChild(box);
    await wait(1500);
    box.classList.add('out');
    await wait(300);
    box.remove();
  }

  function cardSound(c) {
    const m = { species: 'sfx_dex_new', sticker: 'sfx_sticker_peel', page: 'sfx_badge', badge: 'sfx_badge', stamp: 'sfx_unlock',
      shiny: 'sfx_shiny', workshop: 'sfx_unlock', known: 'sfx_lantern_light', crown: 'sfx_crown', boss: 'sfx_boss_defeat',
      island: 'sfx_unlock', item: 'sfx_item_reveal' };
    if (m[c.type]) app.audio.play(m[c.type]);
    const v = { species: 'vo_new_monster', badge: 'vo_new_badge', crown: 'vo_crown', boss: 'vo_boss_defeated', island: 'vo_new_island', shiny: 'vo_wow' };
    if (v[c.type]) app.audio.voice(v[c.type], { force: true });
  }

  function card(c) {
    const C = (cls, art, label) => h('div', { class: `rcard rcard-${cls}` }, h('div', { class: 'rcard-art' }, art), label ? h('div', { class: 'rcard-label' }, label) : null);
    switch (c.type) {
      case 'species': return C('species', monsterArt(c.species, { size: 90 }), `NEW! ${SPECIES_BY_ID[c.species]?.name || ''}`);
      case 'shiny': return C('shiny', monsterArt(c.species, { size: 90, shiny: true }), '✨ Shiny!');
      case 'stamp': return C('stamp', h('span', null, monsterArt(c.species, { size: 60 }), STAMP_ICON[c.stamp] || '💌'), SPECIES_BY_ID[c.species]?.name);
      case 'sticker': return C('sticker', STICKERS_BY_ID[c.id]?.icon || '⭐', null);
      case 'page': return C('page', '📒⭐', `✨ +${c.sparks || 0}`);
      case 'badge': return C('badge', BADGES_BY_ID[c.id]?.icon || '🏅', BADGES_BY_ID[c.id]?.name);
      case 'workshop': return C('workshop', '🛠️', 'Workshop!');
      case 'known': return C('known', '🏮', `×${c.table} ⭐`);
      case 'crown': return C('crown', '👑', `×${c.table}`);
      case 'boss': return C('boss', monsterArt(c.species, { size: 90, mood: 'happy' }), '🤝');
      case 'island': return c.already ? null : C('island', '🏝️', `×${c.table}`);
      case 'item': return C('item', ITEMS_BY_ID[c.id]?.icon || '🎁', ITEMS_BY_ID[c.id]?.name);
      case 'nudge': return C('nudge', '💪', null);
      default: return null;
    }
  }

  function chest(ch) {
    return new Promise((resolve) => {
      const box = h('button', { type: 'button', class: ['chest', `chest-${ch.kind}`], 'aria-label': 'Open chest' }, '🎁');
      const wrap = h('div', { class: 'chest-wrap' }, box, h('div', { class: 'tap-hint' }, '👆'));
      cards.appendChild(wrap);
      app.audio.play('sfx_chest_shake');
      app.audio.voice('vo_treasure');
      let opened = false;
      const open = async (e) => {
        e?.stopPropagation();
        if (opened) return;
        opened = true;
        box.classList.add('open');
        app.audio.play('sfx_chest_open');
        burst(box, { n: 30, spread: 200 });
        await wait(350);
        clear(wrap);
        const loot = h('div', { class: 'loot' });
        wrap.appendChild(loot);
        const things = [
          ...ch.items.map((id) => [ITEMS_BY_ID[id]?.icon || '🎁', ITEMS_BY_ID[id]?.name]),
          ...ch.stickers.map((s) => [STICKERS_BY_ID[s.id || s]?.icon || '⭐', null]),
          ...(ch.sparks ? [['✨', `+${ch.sparks}`]] : []),
        ];
        for (const [icon, name] of things) {
          loot.appendChild(h('div', { class: 'loot-item in' }, h('div', { class: 'loot-icon' }, icon), name ? h('div', { class: 'loot-name' }, name) : null));
          app.audio.play('sfx_item_reveal');
          await wait(350);
        }
        resolve();
      };
      box.addEventListener('click', open);
      // Auto-open after a while so nobody gets stuck.
      setTimeout(() => open(), 6000 / speed);
    });
  }

  void plan; void p;
  return root;
}
