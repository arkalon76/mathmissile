// Child-facing screens. All user text (names, reward names) goes through h()
// as text nodes; nothing is assigned with innerHTML.

import { h, btn, bar, clear, wait, burst } from './dom.js';
import { monsterArt, avatarArt } from './art.js';
import { showReward } from './reward.js';
import { TABLES, tableFacts, homeTable, factKey } from '../logic/facts.js';
import { tableState, currentTable, pendingBoss, isOpenState } from '../logic/tables.js';
import { tableStrengths, practiceNext } from '../logic/insight.js';
import { levelProgress } from '../logic/progression.js';
import { AVATARS, SPECIES, SPECIES_BY_ID, ITEMS, ITEMS_BY_ID, STICKERS, BADGES, BADGES_BY_ID } from '../logic/catalog.js';
import { TUNING } from '../logic/tuning.js';
import { badgeStats, owns } from '../logic/rewards.js';
import { buyItem, setWish, equip, availableSparks, reservedSparks, requestRedemption } from '../logic/shop.js';
import { cleanText } from '../logic/profile.js';
import { wantsTouchPad } from '../input.js';


const topBar = (app, { back = 'map', title = null } = {}) => h('div', { class: 'topbar' },
  btn({ icon: '⬅', cls: 'round', aria: 'Back', onClick: () => { app.audio.play('sfx_ui_back'); app.show(back); }, sfx: false }),
  title ? h('div', { class: 'topbar-title' }, title) : h('div'),
  app.profile ? sparksPill(app) : h('div'));

function sparksPill(app) {
  const p = app.profile;
  const reserved = reservedSparks(p);
  return h('div', { class: 'pill sparks', id: 'sparks-pill', 'aria-label': 'Sparks' }, '✨ ', String(availableSparks(p)),
    reserved ? h('span', { class: 'pill-sub' }, ` (+${reserved} ⏳)`) : null);
}

// ---- title ---------------------------------------------------------------------

function title(app) {
  const go = () => { app.audio.unlock(); app.audio.voice('vo_lets_play'); app.show('profiles'); };
  return h('div', { class: 'title-screen' },
    h('div', { class: 'title-monsters', 'aria-hidden': 'true' },
      monsterArt('bloop', { size: 110 }), monsterArt('pebbit', { size: 90 }), monsterArt('fluffnik', { size: 100 })),
    h('h1', { class: 'logo' }, 'Math ', h('span', null, 'Missile')),
    btn({ icon: '▶', label: 'Play', cls: 'huge primary pulse', onClick: go }));
}

// ---- profiles -------------------------------------------------------------------

function profiles(app) {
  app.audio.voice('vo_whos_playing');
  const idx = app.store.loadIndex();
  const grid = h('div', { class: 'profile-grid' });
  for (const e of idx.profiles) {
    const p = app.store.loadProfile(e.id);
    const card = h('button', { type: 'button', class: 'profile-card', 'aria-label': e.name, onclick: () => { app.audio.play('sfx_ui_tap'); app.selectProfile(e); } },
      p ? avatarArt(p, 96) : monsterArt(e.avatar, { size: 96 }),
      h('div', { class: 'profile-name' }, e.name),
      p ? h('div', { class: 'profile-level' }, `⭐ ${p.progress.level}`) : null);
    grid.appendChild(card);
  }
  if (idx.profiles.length < TUNING.maxProfiles) {
    grid.appendChild(h('button', { type: 'button', class: 'profile-card add', 'aria-label': 'New player', onclick: () => { app.audio.play('sfx_ui_tap'); app.show('create'); } },
      h('div', { class: 'plus' }, '+')));
  }
  return h('div', { class: 'profiles' },
    h('div', { class: 'topbar' }, h('div'), h('div', { class: 'topbar-title' }, '👋 ❓'),
      btn({ icon: '🔒', cls: 'round small', aria: 'Grown-ups', onClick: () => app.openParent() })),
    grid);
}

// ---- create ----------------------------------------------------------------------

function create(app) {
  let avatar = null, age = null;
  app.audio.voice('vo_pick_avatar');
  const avGrid = h('div', { class: 'avatar-grid' });
  for (const id of AVATARS) {
    const b = h('button', { type: 'button', class: 'avatar-pick', 'aria-label': SPECIES_BY_ID[id].name, onclick: () => {
      avatar = id;
      for (const c of avGrid.children) c.classList.toggle('picked', c === b);
      app.audio.play('sfx_ui_tap');
      update();
    } }, monsterArt(id, { size: 76 }));
    avGrid.appendChild(b);
  }
  const name = h('input', { class: 'name-input', type: 'text', maxlength: TUNING.profileNameMax, autocomplete: 'off', autocapitalize: 'words',
    spellcheck: 'false', placeholder: '✏️ Name', 'aria-label': 'Name', oninput: () => update() });
  const ageRow = h('div', { class: 'age-row' });
  for (const a of [4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const b = h('button', { type: 'button', class: 'age-pick', onclick: () => {
      age = a;
      for (const c of ageRow.children) c.classList.toggle('picked', c === b);
      app.audio.play('sfx_ui_tap');
      update();
    } }, a === 12 ? '12+' : String(a));
    ageRow.appendChild(b);
  }
  const go = btn({ icon: '✔', label: 'Go!', cls: 'huge primary', disabled: true, onClick: () => {
    const n = cleanText(name.value, TUNING.profileNameMax);
    if (!avatar || !n || !age) return;
    app.createProfile({ name: n, avatar, age });
    app.audio.play('sfx_unlock');
    app.show('map');
  } });
  function update() {
    go.disabled = !(avatar && cleanText(name.value, TUNING.profileNameMax) && age);
  }
  return h('div', { class: 'create' },
    topBar(app, { back: 'profiles' }),
    h('div', { class: 'step' }, h('div', { class: 'step-icon' }, '1'), avGrid),
    h('div', { class: 'step' }, h('div', { class: 'step-icon' }, '2'), name),
    h('div', { class: 'step', onclick: () => {} }, h('div', { class: 'step-icon' }, '🎂'), ageRow),
    go);
}

// ---- map -------------------------------------------------------------------------

function islandInfo(p, T) {
  const st = tableState(p, T);
  const lit = tableFacts(T).filter((k) => Math.max(p.facts[k]?.box ?? 0, p.facts[k]?.bestBox ?? 0) >= 3).length;
  return { st, lit, boss: !!p.tables[T]?.bossPending && !p.tables[T]?.bossBeaten, crown: p.collection.crowns.includes(T) };
}

function map(app) {
  const p = app.profile;
  const lp = levelProgress(p.progress.xp);
  const C = currentTable(p);
  const path = h('div', { class: 'island-path' });
  // Islands are shown 1..12 in number order; the next one to learn is outlined.
  TABLES.forEach((T, i) => {
    const inf = islandInfo(p, T);
    const open = inf.st !== 'locked';
    const isl = h('button', { type: 'button', class: ['island', `st-${inf.st}`, T === C ? 'current' : '', inf.boss ? 'has-boss' : ''],
      'aria-label': `Island ${T}${open ? '' : ' locked'}`, style: { '--i': i },
      onclick: () => {
        if (!open) { isl.classList.remove('shake'); void isl.offsetWidth; isl.classList.add('shake'); app.audio.play('sfx_ui_back'); return; }
        app.audio.play('sfx_ui_tap');
        islandSheet(app, T);
      } },
      h('div', { class: 'island-num' }, `×${T}`),
      open ? null : h('div', { class: 'island-lock', 'aria-hidden': 'true' }, '🔒'),
      open ? h('div', { class: 'lanterns', 'aria-label': `${inf.lit} of 12` }, ...Array.from({ length: 12 }, (_, k) => h('i', { class: k < inf.lit ? 'lit' : '' }))) : null,
      p.tables[T]?.bossMedal ? h('div', { class: 'island-medal', 'aria-label': 'Boss medal' }, MEDALS[p.tables[T].bossMedal]) : null,
      inf.crown ? h('div', { class: 'island-badge crown' }, '👑') : inf.boss ? h('div', { class: 'island-badge boss' }, monsterArt(`grand_${islandA(T)}`, { size: 40 })) : inf.st === 'known' ? h('div', { class: 'island-badge' }, '⭐') : null);
    path.appendChild(isl);
  });
  const workshopOpen = p.progress.featuresSeen.workshop || p.progress.roundIndex >= TUNING.workshopRound || p.rewards.real.length > 0;
  const nav = h('div', { class: 'nav' },
    btn({ icon: '📖', label: 'Monsters', onClick: () => { app.audio.voice('vo_monster_book'); app.show('book'); } }),
    btn({ icon: '📒', label: 'Stickers', onClick: () => { app.audio.voice('vo_sticker_book'); app.show('stickers'); } }),
    btn({ icon: '🏅', label: 'Badges', onClick: () => app.show('badges') }),
    btn({ icon: workshopOpen ? '🛠️' : '🔒', label: 'Workshop', cls: workshopOpen ? '' : 'locked', onClick: () => {
      if (!workshopOpen) { app.toast(`🔒 Play ${TUNING.workshopRound - p.progress.roundIndex} more rounds`); return; }
      app.show('workshop');
    } }));
  return h('div', { class: 'map' },
    h('div', { class: 'topbar' },
      h('button', { type: 'button', class: 'me', 'aria-label': 'Me', onclick: () => (workshopOpen ? app.show('workshop', { tab: 'avatar' }) : null) },
        avatarArt(p, 58),
        h('div', { class: 'me-text' },
          h('div', { class: 'me-name' }, p.name),
          h('div', { class: 'me-level' }, h('span', { class: 'lv' }, `⭐ ${lp.level}`), bar(lp.frac, 'xp')))),
      sparksPill(app),
      h('div', { class: 'row' },
        btn({ icon: '⚙️', cls: 'round small', aria: 'Settings', onClick: () => app.show('settings') }),
        btn({ icon: '👥', cls: 'round small', aria: 'Switch player', onClick: () => app.show('profiles') }))),
    path,
    h('div', { class: 'play-row' },
      btn({ icon: pendingBoss(p) != null ? '⚔️' : '▶', label: pendingBoss(p) != null ? `Boss ×${pendingBoss(p)}!` : 'Play', cls: 'huge primary pulse', onClick: () => app.play() }),
      canRevise(p) ? btn({ icon: '🔁', label: 'Revision', cls: 'big revise-btn', onClick: () => app.show('revision') }) : null),
    nav);
}

const MEDALS = ['', '🥉', '🥈', '🥇'];

/** Revision needs a few facts from at least 2 tables. */
function canRevise(p) {
  return tableStrengths(p).filter((t) => t.met >= 3).length >= 2;
}

/**
 * Island sheet: what you can do on this island. "Practise ×T" plays only T's
 * sums; "Boss" fights the island's boss (any open island; again any time).
 */
function islandSheet(app, T) {
  const p = app.profile;
  const t = p.tables[T] || {};
  const info = tableStrengths(p).find((x) => x.T === T);
  const medal = t.bossMedal || 0;
  const level = { strong: '💪 Strong', good: '👍 Good', practice: '🌱 Needs practice', new: '✨ New' }[info.level];
  app.modal((close) => h('div', { class: 'island-sheet' },
    h('div', { class: 'is-head' },
      monsterArt(`grand_${islandA(T)}`, { size: 110, silhouette: !t.bossBeaten }),
      h('div', null,
        h('div', { class: 'is-title' }, `×${T} Island`),
        h('div', { class: 'is-level' }, level),
        h('div', { class: 'is-medals', 'aria-label': `Boss medal: ${['none', 'bronze', 'silver', 'gold'][medal]}` },
          ...[1, 2, 3].map((m) => h('span', { class: m <= medal ? 'won' : 'not' }, MEDALS[m]))))),
    h('div', { class: 'is-buttons' },
      btn({ icon: '▶', label: `Practise ×${T}`, cls: 'big primary', onClick: () => { close(); app.play({ table: T }); } }),
      btn({ icon: '⚔️', label: t.bossBeaten ? 'Boss again' : 'Fight the Boss', cls: 'big boss-btn', onClick: () => { close(); app.play({ boss: T }); } })),
    h('div', { class: 'is-note' }, `▶ only ×${T} sums  ·  ⚔️ all 12 of ×${T}`),
    btn({ icon: '✖', cls: 'round small', aria: 'Close', onClick: close })));
}

// ---- revision -----------------------------------------------------------------------

/**
 * Revision: every table the child has met, strongest to weakest as colours,
 * and the tables that need practice first. "Revise everything" plays a mixed
 * round weighted to the weak facts; a table button plays just that table.
 */
function revision(app) {
  const p = app.profile;
  const st = tableStrengths(p);
  const nextUp = practiceNext(p, 3);
  const grid = h('div', { class: 'rev-grid' }, ...st.map((t) => {
    const pct = t.strength == null ? 0 : Math.round(t.strength * 100);
    return h('button', { type: 'button', class: ['rev-cell', `lv-${t.level}`, t.open ? '' : 'locked'], disabled: !t.open,
      'aria-label': `×${t.T}: ${t.level}`, onclick: () => { app.audio.play('sfx_ui_tap'); app.play({ table: t.T }); } },
    h('div', { class: 'rev-num' }, `×${t.T}`),
    t.open ? bar(pct / 100, 'rev-bar') : h('div', { class: 'rev-lock' }, '🔒'),
    h('div', { class: 'rev-word' }, t.open ? { strong: '💪', good: '👍', practice: '🌱', new: '✨' }[t.level] : ''));
  }));
  return h('div', { class: 'revision' },
    topBar(app, { title: '🔁 Revision' }),
    h('div', { class: 'rev-intro' }, 'Practise all your numbers!'),
    btn({ icon: '▶', label: 'Revise everything', cls: 'huge primary pulse', onClick: () => app.play({ revision: true }) }),
    nextUp.length ? h('div', { class: 'practice-next' },
      h('div', { class: 'pn-title' }, '🌱 Needs practice'),
      h('div', { class: 'pn-tables' }, ...nextUp.map((t) => h('div', { class: 'pn-table' },
        btn({ icon: '▶', label: `×${t.T}`, cls: 'big', onClick: () => app.play({ table: t.T }) }),
        h('div', { class: 'pn-facts' }, ...t.weakest.slice(0, 3).map((k) => {
          const [a, b] = k.split('x');
          return h('span', { class: 'chip' }, `${a}×${b}`);
        })))))) : h('div', { class: 'rev-allgood' }, '💪 Everything you know is strong!'),
    grid,
    h('div', { class: 'rev-key' }, '💪 strong  ·  👍 good  ·  🌱 needs practice  ·  ✨ new'));
}

const islandA = (T) => SPECIES.find((s) => s.island === T && s.kind === 'A')?.id || 'bloop';

// ---- pre-round --------------------------------------------------------------------

async function preround(app, plan) {
  const root = app.els.screen;
  root.hidden = false;
  clear(root);
  root.className = 'screen screen-preround';
  const icon = plan.type === 'boss' ? monsterArt(`grand_${islandA(plan.table)}`, { size: 150 })
    : plan.type === 'tutorial' ? monsterArt('bloop', { size: 130 })
      : h('div', { class: 'pre-icon' }, plan.type === 'revision' ? '🔁' : plan.type === 'mixup' ? '🔀' : { golden_hour: '🌅', bubble_breeze: '🫧', night_glow: '🌙', monster_parade: '🎉', sticker_storm: '🌈' }[plan.event] || `×${plan.table ?? '?'}`);
  const count = h('div', { class: 'countdown' }, '');
  root.appendChild(h('div', { class: 'preround' }, icon, roundContents(plan),
    plan.type === 'tutorial' ? h('div', { class: 'pre-hint' }, '⌨️ 3  ➜  👆 ', h('span', { class: 'hint-fact' }, '1×3')) : null,
    count));
  if (plan.type === 'boss') app.audio.play('sfx_boss_enter');
  app.audio.play('sfx_round_start');
  for (const n of ['3', '2', '1']) {
    count.textContent = n;
    count.classList.remove('pop'); void count.offsetWidth; count.classList.add('pop');
    app.audio.play('sfx_count_tick');
    await wait(plan.type === 'tutorial' ? 700 : 520);
  }
  count.textContent = 'Go!';
  await wait(250);
  root.hidden = true;
  clear(root);
}

/**
 * "What is in this round" line under the pre-round icon, so extra tables never
 * come as a surprise: "Only ×7", or "×3  +  🔁 ×1 ×2" for practice of old tables.
 */
function roundContents(plan) {
  if (plan.type === 'tutorial') return null;
  const T = plan.table;
  const others = new Set();
  for (const s of plan.deck || []) {
    if (T != null && (s.a === T || s.b === T)) continue;
    others.add(homeTable(factKey(s.a, s.b)));
  }
  const chips = [...others].sort((x, y) => x - y).map((n) => h('span', { class: 'chip' }, `×${n}`));
  if (plan.type === 'boss') return h('div', { class: 'pre-contents' }, h('span', { class: 'chip main' }, `×${T}`), h('span', null, ' Boss!'));
  if (plan.type === 'revision') return h('div', { class: 'pre-contents' }, h('span', null, 'Revision '), ...chips);
  if (T == null || plan.type === 'mixup') return h('div', { class: 'pre-contents' }, h('span', null, '🔁 '), ...chips);
  if (!chips.length) return h('div', { class: 'pre-contents' }, h('span', null, 'Only '), h('span', { class: 'chip main' }, `×${T}`));
  return h('div', { class: 'pre-contents' }, h('span', { class: 'chip main' }, `×${T}`), h('span', null, ' + 🔁 '), ...chips);
}

// ---- Monster Book ------------------------------------------------------------------

function book(app) {
  const p = app.profile;
  const dex = p.collection.dex;
  const grid = h('div', { class: 'dex-grid' });
  const KIND = { A: 0, B: 1, grand: 2 };
  const bookOrder = [...SPECIES].sort((x, y) => (x.island || 99) - (y.island || 99) || (KIND[x.kind] ?? 3) - (KIND[y.kind] ?? 3));
  for (const sp of bookOrder) {
    const d = dex[sp.id];
    const met = !!d?.met;
    const cell = h('button', { type: 'button', class: ['dex-cell', met ? 'met' : 'unknown', sp.kind === 'grand' ? 'grand' : ''],
      'aria-label': met ? sp.name : 'Unknown', onclick: () => {
        if (!met) return;
        app.audio.play('sfx_ui_tap');
        app.modal((close) => h('div', { class: 'dex-detail' },
          monsterArt(sp.id, { size: 180, shiny: d.shiny }),
          h('h2', null, sp.name),
          h('div', { class: 'stamps big' }, stampRow(d)),
          h('div', { class: 'pops' }, `💥 ${d.pops}`),
          d.shiny ? h('div', { class: 'shiny-tag' }, '✨ Shiny!') : null,
          btn({ icon: '✔', cls: 'primary', onClick: close })));
      } },
      monsterArt(sp.id, { size: 72, silhouette: !met, shiny: d?.shiny }),
      met ? h('div', { class: 'dex-name' }, sp.name) : h('div', { class: 'dex-name' }, '?'),
      met ? h('div', { class: 'stamps' }, stampRow(d)) : null);
    grid.appendChild(cell);
  }
  const metN = SPECIES.filter((s) => dex[s.id]?.met).length;
  return h('div', { class: 'book' }, topBar(app, { title: `📖 ${metN} / ${SPECIES.length}` }), grid);
}

function stampRow(d) {
  return [['met', '💌'], ['friend', '🤝'], ['best', '💖']].map(([k, icon]) => h('span', { class: d.stamps.includes(k) ? 'stamp on' : 'stamp' }, icon));
}

// ---- stickers ------------------------------------------------------------------------

function stickers(app, { page = null } = {}) {
  const p = app.profile;
  const owned = new Set(p.collection.stickers);
  const pages = TUNING.stickerPages;
  let cur = page ?? Math.min(pages, Math.max(1, ...p.collection.stickers.map((id) => +id.slice(1, id.indexOf('_'))), 1));
  const tabs = h('div', { class: 'page-tabs' });
  const grid = h('div', { class: 'sticker-grid' });
  const render = () => {
    clear(tabs); clear(grid);
    for (let i = 1; i <= pages; i++) {
      const n = STICKERS.filter((s) => s.page === i && owned.has(s.id)).length;
      tabs.appendChild(h('button', { type: 'button', class: ['page-tab', i === cur ? 'on' : '', n === 9 ? 'done' : ''], onclick: () => { cur = i; app.audio.play('sfx_sticker_peel'); render(); } },
        n === 9 ? '⭐' : String(i)));
    }
    for (const st of STICKERS.filter((s) => s.page === cur)) {
      grid.appendChild(h('div', { class: ['sticker', owned.has(st.id) ? 'have' : 'empty'] }, owned.has(st.id) ? st.icon : ''));
    }
  };
  render();
  return h('div', { class: 'stickers' }, topBar(app, { title: `📒 ${owned.size} / ${STICKERS.length}` }), tabs, grid);
}

// ---- badges --------------------------------------------------------------------------

function badges(app) {
  const p = app.profile;
  const st = badgeStats(p);
  const grid = h('div', { class: 'badge-grid' });
  for (const b of BADGES) {
    const got = !!p.collection.badges[b.id];
    grid.appendChild(h('div', { class: ['badge', got ? 'got' : 'not'], title: b.name },
      h('div', { class: 'badge-icon' }, got ? b.icon : b.icon),
      h('div', { class: 'badge-name' }, got ? b.name : (b.goal ? b.name : '?')),
      !got && b.goal ? bar(Math.min(1, (st[b.stat] || 0) / b.goal)) : null));
  }
  const n = Object.keys(p.collection.badges).length;
  return h('div', { class: 'badges' }, topBar(app, { title: `🏅 ${n} / ${BADGES.length}` }), grid);
}

// ---- workshop --------------------------------------------------------------------------

function sourceHint(it) {
  const s = it.source;
  if (s.level) return `🔒 Level ${s.level}`;
  if (s.shop) return `✨ ${s.shop}`;
  if (s.chest) return '🎁';
  if (s.album) return '📒';
  if (s.badge) return '🏅';
  if (s.bundle) return `🏝️ ×${s.bundle}`;
  return '';
}

function workshop(app, { tab = null } = {}) {
  const p = app.profile;
  if (!p.progress.featuresSeen.workshopVisited) { p.progress.featuresSeen.workshopVisited = true; app.audio.voice('vo_workshop'); app.save(); }
  const TABS = [['blade', '🗡️'], ['trail', '💫'], ['avatar', '🎩'], ['color', '🎨'], ['real', '🎁']];
  let cur = tab || 'blade';
  const tabs = h('div', { class: 'tabs' });
  const body = h('div', { class: 'shop-grid' });
  const top = h('div');
  const render = () => {
    clear(top).appendChild(topBar(app, { title: '🛠️' }));
    clear(tabs);
    for (const [k, icon] of TABS) {
      const pending = k === 'real' && p.rewards.redemptions.some((q) => q.status === 'pending');
      tabs.appendChild(h('button', { type: 'button', class: ['tab', k === cur ? 'on' : ''], 'aria-label': k, onclick: () => { cur = k; app.audio.play('sfx_ui_toggle'); render(); } },
        icon, pending ? h('span', { class: 'dot' }) : null));
    }
    clear(body);
    if (cur === 'real') return renderReal();
    if (cur === 'avatar') body.appendChild(avatarArt(p, 120));
    for (const it of ITEMS.filter((i) => i.kind === cur)) body.appendChild(itemCard(it));
  };
  const equipped = (it) => (it.kind === 'blade' ? p.avatar.blade === it.id : it.kind === 'trail' ? p.avatar.trail === it.id
    : it.kind === 'color' ? p.avatar.colorSet === it.id : p.avatar.equipped[it.slot] === it.id);
  // Dress Up badge (and any level it passes) shown right here, where it was earned.
  function dressNews(news) {
    if (!news.badge) return;
    app.audio.play('sfx_badge');
    const lv = news.levelUps?.length ? `  ⭐ Level ${news.levelUps[news.levelUps.length - 1].level}!` : '';
    app.toast(`🏅 Badge: ${BADGES_BY_ID[news.badge]?.name || 'Dress Up'}!${lv}`);
  }
  function itemCard(it) {
    const have = owns(p, it.id);
    const isOn = have && equipped(it);
    const avail = availableSparks(p);
    const actions = [];
    if (have) {
      actions.push(btn({ icon: isOn ? '✔' : '👆', cls: isOn ? 'on small' : 'small', aria: isOn ? 'On' : 'Use', onClick: () => {
        const news = {};
        if (isOn && it.kind === 'avatar') equip(p, null, it.slot); else equip(p, it.id, undefined, news);
        app.audio.play('sfx_ui_toggle'); app.save(); app.applyCosmetics(); render(); dressNews(news);
      } }));
    } else if (it.source.shop) {
      const can = avail >= it.source.shop;
      actions.push(btn({ icon: '✨', label: String(it.source.shop), cls: can ? 'primary small' : 'small dim', disabled: !can, onClick: () => {
        const r = buyItem(p, it.id);
        if (r.ok) {
          app.audio.play('sfx_purchase'); app.save();
          burst(body, { n: 20 });
          const news = {};
          equip(p, it.id, undefined, news); app.applyCosmetics(); app.save();
          render(); dressNews(news);
        }
      } }));
      actions.push(btn({ icon: p.progress.wish === it.id ? '💖' : '🤍', cls: 'small', aria: 'Wish', onClick: () => {
        setWish(p, p.progress.wish === it.id ? null : it.id); app.save(); app.audio.play('sfx_ui_toggle'); render();
      } }));
    }
    return h('div', { class: ['item', have ? 'have' : 'locked', isOn ? 'equipped' : ''] },
      h('div', { class: 'item-icon' }, it.icon),
      h('div', { class: 'item-name' }, it.name),
      have ? null : h('div', { class: 'item-src' }, sourceHint(it)),
      h('div', { class: 'item-actions' }, actions));
  }
  function renderReal() {
    if (!p.rewards.real.length) {
      body.appendChild(h('div', { class: 'empty-note' }, '🎁 ❓ 👨‍👩‍👧'));
      return;
    }
    const avail = availableSparks(p);
    for (const r of p.rewards.real) {
      const pending = p.rewards.redemptions.some((q) => q.rewardId === r.id && q.status === 'pending');
      const can = avail >= r.price;
      body.appendChild(h('div', { class: ['item', 'real', pending ? 'pending' : ''] },
        h('div', { class: 'item-icon' }, '🎁'),
        h('div', { class: 'item-name' }, r.name),
        h('div', { class: 'item-src' }, `✨ ${r.price}`),
        pending ? h('div', { class: 'item-actions' }, h('div', { class: 'waiting' }, '⏳ 👨‍👩‍👧'))
          : can ? h('div', { class: 'item-actions' }, btn({ icon: '🙋', label: 'Ask for it', cls: 'primary small', onClick: () => {
            const res = requestRedemption(p, r.id);
            if (res.ok) { app.audio.play('sfx_unlock'); app.save(); app.toast('🙋 ⏳ 👨‍👩‍👧'); render(); }
          } }))
            : h('div', { class: 'item-actions' }, bar(avail / r.price))));
    }
  }
  render();
  return h('div', { class: 'workshop' }, top, tabs, body);
}

// ---- settings ----------------------------------------------------------------------------

function settings(app) {
  const d = app.device, p = app.profile;
  const slider = (key, icon) => h('label', { class: 'slider' }, h('span', { class: 'slider-icon' }, icon),
    h('input', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(d.volume[key] * 100), 'aria-label': key,
      oninput: (e) => {
        d.volume[key] = Math.max(0, Math.min(1, Number(e.target.value) / 100 || 0));
        app.audio.setSettings({ [key]: d.volume[key] });
      },
      onchange: () => { app.saveDevice(); app.audio.play('sfx_ui_toggle'); } }));
  const toggle = (on, icon, label, fn) => h('button', { type: 'button', class: ['toggle', on ? 'on' : ''], 'aria-pressed': on ? 'true' : 'false',
    onclick: () => { fn(); app.audio.play('sfx_ui_toggle'); app.show('settings'); } }, h('span', null, icon), h('span', { class: 'toggle-label' }, label));
  const padOpts = ['auto', 'on', 'off'];
  return h('div', { class: 'settings' }, topBar(app, { title: '⚙️' }),
    h('div', { class: 'panel' },
      slider('master', '🔊'), slider('music', '🎵'), slider('sfx', '💥'), slider('voice', '🗣️'),
      toggle(d.muted, d.muted ? '🔇' : '🔈', 'Mute', () => { d.muted = !d.muted; app.audio.setSettings({ muted: d.muted }); app.saveDevice(); })),
    p ? h('div', { class: 'panel' },
      toggle(p.settings.calmEffects, '🌙', 'Calm', () => { p.settings.calmEffects = !p.settings.calmEffects; app.save(); app.applyCosmetics(); }),
      h('div', { class: 'seg' }, h('span', null, '🔢'), ...padOpts.map((o) => h('button', { type: 'button', class: ['seg-btn', p.settings.numberPad === o ? 'on' : ''],
        onclick: () => { p.settings.numberPad = o; app.save(); app.updatePad?.(); app.show('settings'); } }, o === 'auto' ? 'Auto' : o === 'on' ? 'On' : 'Off')))) : null,
    btn({ icon: '🔒', label: 'Grown-ups', cls: 'wide', onClick: () => app.openParent() }));
}

// ---- break nudge ---------------------------------------------------------------------------

function breakNudge(app, next) {
  app.modal((close) => h('div', { class: 'nudge' },
    monsterArt('fluffnik', { size: 140, mood: 'happy' }),
    h('div', { class: 'nudge-text' }, '🧃 🤸 💤 ?'),
    h('div', { class: 'nudge-sub' }, 'Time for a little break?'),
    h('div', { class: 'row' },
      btn({ icon: '🛑', label: 'Break', cls: 'primary', onClick: () => { close(); app.show('title'); } }),
      btn({ icon: '▶', label: 'One more', onClick: () => { close(); next(); } }))), { cls: 'nudge-box' });
}

function reward(app, args) { return showReward(app, args); }

export const SCREENS = { title, profiles, create, map, preround, revision, book, stickers, badges, workshop, settings, breakNudge, reward };
export { wantsTouchPad };
