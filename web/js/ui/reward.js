// Round-end reward screen: stars, points, XP bar with level-ups, Sparks,
// reveal cards, chests (tap to open), "Practise next", goals and the way on.
// Tapping the background speeds the sequence up; nothing is skipped.
//
// Layout: a scrolling body and a footer with the buttons that is always on
// screen (iPad landscape is only ~690px tall in Safari).
// Every card says what it is (a ribbon) and where it went or what it is for.

import { h, btn, bar, clear, countUp, burst } from './dom.js';
import { monsterArt } from './art.js';
import { levelProgress } from '../logic/progression.js';
import { ITEMS_BY_ID, SPECIES_BY_ID, STICKERS_BY_ID, BADGES_BY_ID } from '../logic/catalog.js';
import { TUNING } from '../logic/tuning.js';
import { pendingBoss } from '../logic/tables.js';
import { parseKey } from '../logic/facts.js';

const throttle = (fn, ms) => { let t = 0; return () => { const n = performance.now(); if (n - t >= ms) { t = n; fn(); } }; };

const STAMP_ICON = { met: '💌', friend: '🤝', best: '💖' };
const STAMP_WORD = { met: 'Hello!', friend: 'Friends!', best: 'Best friends!' };
const MEDAL = ['', '🥉', '🥈', '🥇'];
const MEDAL_WORD = ['', 'Bronze', 'Silver', 'Gold'];

export function showReward(app, { report: R, plan }) {
  const p = app.profile;
  let speed = 1;
  let done = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms / speed));
  const body = h('div', { class: 'reward-body' });
  const root = h('div', { class: 'reward', onclick: () => { if (!done) speed = 4; } }, body);

  // --- header: stars
  const stars = h('div', { class: 'stars' }, ...[0, 1, 2].map(() => h('div', { class: 'star' }, '★')));
  const score = h('div', { class: 'score' }, '0');
  const best = h('div', { class: 'new-best', hidden: true }, '🏆 New best!');
  const xpLv = h('div', { class: 'xp-level' }, `⭐ ${R.levelBefore}`);
  const xpBar = bar(levelProgress(R.xpBefore).frac, 'xp big');
  const xpNum = h('div', { class: 'xp-num' }, '+0');
  const sparks = h('div', { class: 'pill sparks big' }, '✨ ', h('span', { class: 'sp-n' }, String(R.sparksBefore)));
  const sparksGain = h('div', { class: 'sparks-gain' }, '');
  const sparksFor = h('div', { class: 'sparks-for' }, '→ 🛠️ Workshop');
  const chestNow = Math.min(p.progress.chestStars, TUNING.starsPerChest);
  const meter = h('div', { class: 'chest-meter', 'aria-label': `${chestNow} of ${TUNING.starsPerChest} stars to the next chest` },
    h('span', null, `⭐ ${chestNow}/${TUNING.starsPerChest}`), bar(chestNow / TUNING.starsPerChest), h('span', null, '🎁'));
  const cards = h('div', { class: 'cards' });
  const guide = h('div', { class: 'practice-next', hidden: true });
  const next = h('div', { class: 'next-up', hidden: true });

  // Buttons: always in the footer, shown once the sequence is done.
  const again = plan.choice || {};
  const boss = pendingBoss(p);
  const buttons = h('div', { class: 'reward-buttons' },
    btn({ icon: '🗺️', label: 'Map', cls: 'big', onClick: () => app.afterReward(() => app.show('map')) }),
    boss != null && plan.type !== 'boss'
      ? btn({ icon: '⚔️', label: `Boss ×${boss}`, cls: 'big boss-btn', onClick: () => app.afterReward(() => app.play({ boss })) })
      : null,
    btn({ icon: '▶', label: againLabel(plan), cls: 'huge primary pulse', onClick: () => app.afterReward(() => app.play(again)) }));
  const footer = h('div', { class: 'reward-footer' }, buttons);
  buttons.style.visibility = 'hidden';
  root.appendChild(footer);

  body.append(
    stars,
    h('div', { class: 'score-row' }, h('div', { class: 'score-label' }, 'Points'), score, best),
    h('div', { class: 'xp-row' }, xpLv, xpBar, xpNum),
    h('div', { class: 'sparks-row' }, sparks, sparksGain, sparksFor),
    meter,
    cards, guide, next);

  const toEnd = () => { body.scrollTop = body.scrollHeight; };

  (async () => {
    await wait(350);
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

    await countUp(score, 0, R.score || 0, 700 / speed, throttle(() => app.audio.play('sfx_count_tick', { volume: 0.4 }), 70));
    if (R.newBest) { best.hidden = false; best.classList.add('pop'); app.audio.voice('vo_new_best'); await wait(500); }

    await fillXp();

    if (R.sparksGained) {
      sparksGain.textContent = `+${R.sparksGained}`;
      sparksGain.classList.add('pop');
      const n = sparks.querySelector('.sp-n');
      await countUp(n, R.sparksBefore, R.sparksAfter, 600 / speed, throttle(() => app.audio.play('sfx_coin_tinkle', { volume: 0.3 }), 110));
      burst(sparks, { n: 12, chars: ['✨'] });
    }

    for (const c of R.cards) {
      const el = card(c);
      if (!el) continue;
      cards.appendChild(el);
      el.classList.add('in');
      toEnd();
      cardSound(c);
      burst(el, { n: 14 });
      await wait(650);
    }
    for (const ch of R.chests) {
      await chest(ch);
      toEnd();
    }

    showGuide();
    showGoals();
    done = true;
    buttons.style.visibility = '';
    buttons.classList.add('in');
    toEnd();
  })().catch((e) => { console.error(e); buttons.style.visibility = ''; });

  // "Practise next": this round's sums that need work, and the tables to practise.
  function showGuide() {
    const weak = R.weakFacts || [];
    const tables = (R.practiceNext || []).filter((t) => plan.type !== 'normal' || t.table !== plan.table || weak.length);
    if (!weak.length && !tables.length) return;
    guide.hidden = false;
    guide.appendChild(h('div', { class: 'pn-title' }, '💪 Practise next'));
    if (weak.length) {
      guide.appendChild(h('div', { class: 'pn-facts' }, ...weak.map((k) => {
        const { a, b } = parseKey(k);
        return h('span', { class: 'chip' }, `${a}×${b}`);
      })));
    }
    if (tables.length) {
      guide.appendChild(h('div', { class: 'pn-tables' }, ...tables.map((t) =>
        btn({ icon: '▶', label: `×${t.table}`, cls: 'pn-go', aria: `Practise ×${t.table}`,
          onClick: () => app.afterReward(() => app.play({ table: t.table })) }))));
    }
  }

  function showGoals() {
    if (!R.nextUp?.length) return;
    next.hidden = false;
    next.appendChild(h('div', { class: 'next-title' }, '🎯 Next goals'));
    for (const n of R.nextUp.slice(0, 3)) {
      next.appendChild(h('div', { class: 'next-item' },
        h('div', { class: 'next-icon' }, n.icon || '⭐'),
        h('div', { class: 'next-label' }, n.label || ''),
        bar(n.need ? Math.min(1, (n.have || 0) / n.need) : 0),
        h('div', { class: 'next-count' }, `${n.have ?? 0}/${n.need ?? '?'}`)));
    }
  }

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
  }

  // Level-up overlay: stays until tapped (or 4 s), and names what was unlocked.
  async function levelUp(up) {
    app.audio.play('sfx_level_up');
    app.audio.voice('vo_level_up', { force: true });
    burst(root, { n: 40, spread: 260 });
    let close;
    const closed = new Promise((r) => { close = r; });
    const box = h('div', { class: 'level-up', onclick: (e) => { e.stopPropagation(); close(); } },
      h('div', { class: 'lu-text' }, 'LEVEL UP!'),
      h('div', { class: 'lu-num' }, String(up.level)),
      up.title ? h('div', { class: 'lu-title' }, up.title) : null,
      h('div', { class: 'lu-items' }, ...(up.items || []).map((id) => h('div', { class: 'lu-item' },
        h('div', { class: 'lu-icon' }, ITEMS_BY_ID[id]?.icon || '🎁'),
        h('div', { class: 'lu-name' }, ITEMS_BY_ID[id]?.name || '')))),
      (up.items || []).length ? h('div', { class: 'lu-where' }, '→ 🛠️ Workshop') : null,
      up.sparks ? h('div', { class: 'lu-sparks' }, `✨ +${up.sparks}`) : null,
      h('div', { class: 'tap-hint' }, '👆'));
    root.appendChild(box);
    await Promise.race([closed, new Promise((r) => setTimeout(r, (up.items || []).length ? 4000 : 1800))]);
    box.classList.add('out');
    await new Promise((r) => setTimeout(r, 300));
    box.remove();
  }

  function cardSound(c) {
    const m = { species: 'sfx_dex_new', sticker: 'sfx_sticker_peel', page: 'sfx_badge', badge: 'sfx_badge', stamp: 'sfx_unlock',
      shiny: 'sfx_shiny', workshop: 'sfx_unlock', known: 'sfx_lantern_light', crown: 'sfx_crown', boss: 'sfx_boss_defeat',
      island: 'sfx_unlock', item: 'sfx_item_reveal', medal: 'sfx_badge' };
    if (m[c.type]) app.audio.play(m[c.type]);
    const v = { species: 'vo_new_monster', badge: 'vo_new_badge', crown: 'vo_crown', boss: 'vo_boss_defeated', island: 'vo_new_island', shiny: 'vo_wow' };
    if (v[c.type]) app.audio.voice(v[c.type], { force: true });
  }

  /**
   * A card: ribbon (what it is), art, name, and where it went / what it is for.
   * Tapping a card after the sequence opens that place.
   */
  function card(c) {
    const C = (cls, ribbon, art, label, where, go) => h('div', {
      class: ['rcard', `rcard-${cls}`, go ? 'can-go' : ''],
      onclick: go ? (e) => { if (!done) return; e.stopPropagation(); app.afterReward(() => app.show(go)); } : null,
    },
    h('div', { class: 'rcard-ribbon' }, ribbon),
    h('div', { class: 'rcard-art' }, art),
    label ? h('div', { class: 'rcard-label' }, label) : null,
    where ? h('div', { class: 'rcard-where' }, where) : null);
    const sp = (id) => SPECIES_BY_ID[id]?.name || '';
    switch (c.type) {
      case 'species': return C('species', 'NEW MONSTER', monsterArt(c.species, { size: 84 }), sp(c.species), '→ 📖 Monster Book', 'book');
      case 'shiny': return C('shiny', 'SHINY!', monsterArt(c.species, { size: 84, shiny: true }), sp(c.species), '→ 📖 Monster Book', 'book');
      case 'stamp': return C('stamp', 'FRIENDSHIP', h('span', null, monsterArt(c.species, { size: 56 }), STAMP_ICON[c.stamp] || '💌'), `${sp(c.species)}: ${STAMP_WORD[c.stamp] || ''}`, '→ 📖 Monster Book', 'book');
      case 'sticker': return C('sticker', 'STICKER', STICKERS_BY_ID[c.id]?.icon || '⭐', null, '→ 📒 Sticker Book', 'stickers');
      case 'page': return C('page', 'PAGE DONE!', '📒⭐', `✨ +${c.sparks || 0}`, c.item ? `+ ${ITEMS_BY_ID[c.item]?.icon || ''} ${ITEMS_BY_ID[c.item]?.name || ''}` : null, 'stickers');
      case 'badge': return C('badge', 'BADGE', BADGES_BY_ID[c.id]?.icon || '🏅', BADGES_BY_ID[c.id]?.name, '→ 🏅 Badges', 'badges');
      case 'workshop': return C('workshop', 'WORKSHOP OPEN', '🛠️', 'Spend ✨ on outfits!', null, 'workshop');
      case 'known': return C('known', 'TABLE LEARNED', '🏮', `×${c.table} ⭐`, '⚔️ Boss is ready!');
      case 'crown': return C('crown', 'MASTERED', '👑', `×${c.table}`, null);
      case 'boss': return C('boss', 'BOSS BEATEN', monsterArt(c.species, { size: 84, mood: 'happy' }), sp(c.species),
        c.newFriend ? `New friend: ${sp(c.newFriend)}` : null, 'book');
      case 'medal': return C('medal', `${MEDAL_WORD[c.medal]} MEDAL`, MEDAL[c.medal], `×${c.table} Boss`, c.medal < 3 ? `Next: ${MEDAL[c.medal + 1]}` : null);
      case 'island': return C('island', 'NEW ISLAND', '🏝️', `×${c.table}`, c.already ? `You know ${c.already} already!` : null);
      case 'item': return C('item', 'NEW ITEM', ITEMS_BY_ID[c.id]?.icon || '🎁', ITEMS_BY_ID[c.id]?.name, '→ 🛠️ Workshop', 'workshop');
      case 'nudge': return C('nudge', 'KEEP GOING', '💪', 'Bonus ✨', null);
      default: return null;
    }
  }

  function chest(ch) {
    return new Promise((resolve) => {
      const box = h('button', { type: 'button', class: ['chest', `chest-${ch.kind}`], 'aria-label': 'Open chest' }, '🎁');
      const wrap = h('div', { class: 'chest-wrap' }, h('div', { class: 'rcard-ribbon' }, ch.kind === 'boss' ? 'BOSS CHEST' : 'TREASURE CHEST'), box, h('div', { class: 'tap-hint' }, '👆'));
      cards.appendChild(wrap);
      toEnd();
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
          ...ch.items.map((id) => [ITEMS_BY_ID[id]?.icon || '🎁', ITEMS_BY_ID[id]?.name, '🛠️']),
          ...ch.stickers.map((s) => [STICKERS_BY_ID[s.id || s]?.icon || '⭐', 'Sticker', '📒']),
          ...(ch.sparks ? [['✨', `+${ch.sparks}`, '🛠️']] : []),
        ];
        for (const [icon, name, where] of things) {
          loot.appendChild(h('div', { class: 'loot-item in' }, h('div', { class: 'loot-icon' }, icon),
            name ? h('div', { class: 'loot-name' }, name) : null, h('div', { class: 'loot-where' }, `→ ${where}`)));
          app.audio.play('sfx_item_reveal');
          toEnd();
          await wait(350);
        }
        resolve();
      };
      box.addEventListener('click', open);
      // Auto-open after a while so nobody gets stuck.
      setTimeout(() => open(), 6000 / speed);
    });
  }

  return root;
}

function againLabel(plan) {
  const c = plan.choice || {};
  if (c.revision) return 'Revise again';
  if (c.boss != null) return 'Boss again';
  if (c.table != null) return `×${c.table} again`;
  return 'Play';
}
