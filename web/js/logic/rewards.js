// Applying a finished round to a profile: SRS, tables, XP/levels, Sparks,
// stickers, Monster Book, chests, badges and the "Next up" row (§4, §5).
// Pure apart from mutating the profile it is given; the caller clones first.

import { TUNING } from './tuning.js';
import { makeRng, hashSeed } from './rng.js';
import { factKey, PATH, tableFacts, ALL_FACT_KEYS, isSquare, sharedFactsOfTable } from './facts.js';
import { ensureFact, applyResolution } from './srs.js';
import { updateTableAfterRound, openTable, nextLockedAfter, knownTables, currentTable, isOpenState, tableRec } from './tables.js';
import { xpNeed, levelForXp, levelProgress, starsFor, roundSparks, accuracyOf } from './progression.js';
import { xEff, clampOffset } from './speed.js';
import { median } from './tables.js';
import { roundWeakFacts, practiceNext } from './insight.js';
import {
  ITEMS_BY_ID, LEVEL_ITEMS, titleForLevel, titleAt, STICKERS, BADGES, BADGES_BY_ID, BADGE_ITEMS, BUNDLE_ITEMS,
  chestOnly, levelPool, albumPool, SPECIES_BY_ID, BASE_SPECIES, speciesOfIsland,
} from './catalog.js';

// ---- ownership -------------------------------------------------------------

const listFor = (kind) => ({ blade: 'blades', trail: 'trails', avatar: 'avatarItems', color: 'colorSets' }[kind]);

export function owns(profile, id) {
  const it = ITEMS_BY_ID[id];
  return !!it && profile.collection[listFor(it.kind)].includes(id);
}

/** Give an item. Returns true when it was new. */
export function grantItem(profile, id) {
  const it = ITEMS_BY_ID[id];
  if (!it || owns(profile, id)) return false;
  profile.collection[listFor(it.kind)].push(id);
  return true;
}

// ---- stickers ------------------------------------------------------------------

/** Next sticker: random unowned on the lowest incomplete page (§5.4). */
export function nextSticker(profile, rng) {
  const owned = new Set(profile.collection.stickers);
  if (owned.size === 0) return 'p1_s1';
  for (let page = 1; page <= TUNING.stickerPages; page++) {
    const free = STICKERS.filter((s) => s.page === page && !owned.has(s.id));
    if (free.length) return rng.pick(free).id;
  }
  return null;
}

/** If the sticker `id` just finished its page: page Sparks, an album item and a PAGE DONE card. */
function checkPage(profile, id, rng, R) {
  const page = +id.slice(1, id.indexOf('_'));
  const owned = new Set(profile.collection.stickers);
  if (!STICKERS.filter((s) => s.page === page).every((s) => owned.has(s.id))) return false;
  addSparks(profile, R, TUNING.pageCompleteSparks, 'page');
  const free = albumPool().filter((i) => !owns(profile, i.id));
  const item = free.length ? rng.pick(free).id : null;
  if (item) grantItem(profile, item);
  R.cards.push({ type: 'page', page, item, sparks: TUNING.pageCompleteSparks });
  R.flags.pageDone = true;
  return true;
}

/** Give a sticker; returns {id, pageDone} or null when the album is full. */
function giveSticker(profile, rng, R) {
  const id = nextSticker(profile, rng);
  if (!id) { addSparks(profile, R, TUNING.pageCompleteSparks, 'album full'); return null; }
  profile.collection.stickers.push(id);
  R.cards.push({ type: 'sticker', id });
  return { id, pageDone: checkPage(profile, id, rng, R) };
}

function addSparks(profile, R, n, why) {
  if (!n) return;
  profile.progress.sparks += n;
  if (!R) return;
  R.sparksGained += n;
  R.sparksBreakdown.push({ why, n });
}

// ---- chests (§5.6) -------------------------------------------------------------

/** Chest pool: chest items first, then any unowned level/shop item. */
export function chestCandidates(profile) {
  const first = chestOnly().filter((i) => !owns(profile, i.id));
  if (first.length) return first;
  return levelPool().filter((i) => !owns(profile, i.id));
}

/**
 * Roll a chest's contents and grant them. Never duplicates; an empty pool gives
 * a sticker and 30 Sparks instead of each missing item.
 */
export function rollChest(profile, kind, rng, R) {
  const [lo, hi] = TUNING.chestSparks[kind] || [10, 20];
  const chest = { kind, sparks: rng.int(lo, hi), items: [], stickers: [] };
  let n = TUNING.chestItems[kind] ?? 1;
  if (kind === 'level_big') n = 3;
  for (let i = 0; i < n; i++) {
    const pool = chestCandidates(profile);
    if (pool.length) {
      const it = rng.pick(pool);
      grantItem(profile, it.id);
      chest.items.push(it.id);
    } else {
      chest.sparks += TUNING.chestEmptyFallbackSparks;
      const st = giveStickerQuiet(profile, rng, R);
      if (st) chest.stickers.push(st);
    }
  }
  profile.progress.sparks += chest.sparks;
  if (R) { R.sparksGained += chest.sparks; R.chests.push(chest); }
  return chest;
}

/** A sticker inside a chest: no card of its own, but a page it finishes still counts. */
function giveStickerQuiet(profile, rng, R) {
  const id = nextSticker(profile, rng);
  if (!id) return null;
  profile.collection.stickers.push(id);
  checkPage(profile, id, rng, R || { cards: [], flags: {}, sparksGained: 0, sparksBreakdown: [] });
  return id;
}

// ---- badges -----------------------------------------------------------------------

export function badgeStats(profile) {
  const facts = profile.facts;
  const dex = profile.collection.dex;
  return {
    goldenTotal: profile.progress.goldenTotal,
    bosses: profile.progress.bossesBeaten,
    tablesKnown: knownTables(profile).length,
    crowns: profile.collection.crowns.length,
    factsMastered: ALL_FACT_KEYS.filter((k) => (facts[k]?.box ?? 0) >= 5).length,
    squaresKnown: ALL_FACT_KEYS.filter((k) => isSquare(k) && (facts[k]?.box ?? 0) >= 3).length,
    speciesMet: BASE_SPECIES.filter((s) => dex[s.id]?.met).length,
    playDays: profile.progress.playDays.length,
    totalCorrect: profile.progress.totalCorrect,
  };
}

/** Award a badge once; +20 XP, +10 Sparks and any badge item. Returns true if new. */
export function awardBadge(profile, id, today, R) {
  if (!BADGES_BY_ID[id] || profile.collection.badges[id]) return false;
  profile.collection.badges[id] = today;
  profile.progress.xp += TUNING.xp.badge;
  profile.progress.sparks += TUNING.badgeSparks;
  const items = (BADGE_ITEMS[id] || []).filter((it) => grantItem(profile, it));
  if (R) {
    R.xpBreakdown.push({ why: 'badge', xp: TUNING.xp.badge });
    R.xpGained += TUNING.xp.badge;
    R.sparksGained += TUNING.badgeSparks;
    R.cards.push({ type: 'badge', id, items });
  }
  return true;
}

function statBadges(profile, today, R) {
  const st = badgeStats(profile);
  for (const b of BADGES) {
    if (b.goal && b.stat && st[b.stat] >= b.goal) awardBadge(profile, b.id, today, R);
  }
}

// ---- level ups ---------------------------------------------------------------------

/** Grant rewards for each level passed from `from` to the level of the current XP. */
export function applyLevelUps(profile, from, rng, R) {
  const to = levelForXp(profile.progress.xp);
  const ups = [];
  for (let L = from + 1; L <= to; L++) {
    const up = { level: L, items: [], title: titleAt(L), chest: null, sparks: 0 };
    if (L <= 20) {
      const it = LEVEL_ITEMS[L];
      if (it && grantItem(profile, it)) up.items.push(it);
      if (L % 5 === 0) up.chest = L === 20 ? 'level_big' : 'level';
    } else {
      up.sparks = TUNING.sparksPerLevelAfter20;
      profile.progress.sparks += up.sparks;
      if (R) R.sparksGained += up.sparks;
      if (L % 2 === 1) {
        const pool = levelPool().filter((i) => !owns(profile, i.id));
        if (pool.length) { const it = rng.pick(pool).id; grantItem(profile, it); up.items.push(it); }
      }
      if (L % 5 === 0) up.chest = 'level';
    }
    ups.push(up);
  }
  profile.progress.level = to;
  profile.progress.title = titleForLevel(to);
  for (const up of ups) if (up.chest) rollChest(profile, up.chest, rng, R);
  if (R) R.levelUps.push(...ups);
  return ups;
}

// ---- Monster Book -------------------------------------------------------------------

function popSpecies(profile, id, n, shiny, roundIndex, R) {
  if (!SPECIES_BY_ID[id]) return;
  const dex = profile.collection.dex;
  const d = dex[id] || (dex[id] = { met: false, pops: 0, shiny: false, metRound: null, stamps: [] });
  d.pops += n;
  const stamp = (name) => {
    if (d.stamps.includes(name)) return;
    d.stamps.push(name);
    profile.progress.xp += TUNING.xp.stamp;
    R.xpGained += TUNING.xp.stamp;
    R.xpBreakdown.push({ why: 'stamp', xp: TUNING.xp.stamp });
    addSparks(profile, R, TUNING.stampSparks, 'stamp');
    if (name !== 'met') R.cards.push({ type: 'stamp', species: id, stamp: name });
  };
  if (!d.met) {
    d.met = true;
    d.metRound = roundIndex;
    R.cards.push({ type: 'species', species: id });
    stamp('met');
  }
  if (d.pops >= TUNING.stampAt.friend) stamp('friend');
  if (d.pops >= TUNING.stampAt.best) stamp('best');
  if (shiny && !d.shiny) {
    d.shiny = true;
    R.cards.push({ type: 'shiny', species: id });
    R.flags.shiny = true;
  }
}

// ---- Next up (§5.10) ----------------------------------------------------------------

export function nextUp(profile) {
  const c = [];
  const P = profile.progress;
  const lp = levelProgress(P.xp);
  const nextLevelItem = (() => {
    for (let L = lp.level + 1; L <= 20; L++) if (LEVEL_ITEMS[L]) return { L, id: LEVEL_ITEMS[L] };
    return null;
  })();
  if (nextLevelItem) {
    // XP still to earn up to that level, counted level by level.
    let need = 0;
    for (let L = lp.level; L < nextLevelItem.L; L++) need += xpNeed(L);
    c.push({ kind: 'level', icon: ITEMS_BY_ID[nextLevelItem.id].icon, label: `Level ${nextLevelItem.L}: ${ITEMS_BY_ID[nextLevelItem.id].name}`, have: lp.into, need: Math.max(1, need), item: nextLevelItem.id });
  } else {
    c.push({ kind: 'level', icon: '⬆️', label: `Level ${lp.level + 1}`, have: lp.into, need: lp.need });
  }
  c.push({ kind: 'chest', icon: '🎁', label: 'Treasure chest', have: P.chestStars, need: TUNING.starsPerChest });
  if (P.wish && ITEMS_BY_ID[P.wish]?.source.shop && !owns(profile, P.wish)) {
    const it = ITEMS_BY_ID[P.wish];
    c.push({ kind: 'wish', icon: it.icon, label: it.name, have: Math.min(P.sparks, it.source.shop), need: it.source.shop, item: it.id });
  }
  const st = badgeStats(profile);
  let bestBadge = null;
  for (const b of BADGES) {
    if (!b.goal || profile.collection.badges[b.id]) continue;
    const f = st[b.stat] / b.goal;
    if (!bestBadge || f > bestBadge.f) bestBadge = { b, f };
  }
  if (bestBadge) c.push({ kind: 'badge', icon: bestBadge.b.icon, label: `Badge: ${bestBadge.b.name}`, have: st[bestBadge.b.stat], need: bestBadge.b.goal, badge: bestBadge.b.id });
  let bestSp = null;
  for (const [id, d] of Object.entries(profile.collection.dex)) {
    if (!d.met || !SPECIES_BY_ID[id] || SPECIES_BY_ID[id].kind === 'grand') continue;
    const goal = d.pops < TUNING.stampAt.friend ? TUNING.stampAt.friend : d.pops < TUNING.stampAt.best ? TUNING.stampAt.best : null;
    if (!goal) continue;
    const f = d.pops / goal;
    if (!bestSp || f > bestSp.f) bestSp = { id, f, have: d.pops, need: goal };
  }
  if (bestSp) c.push({ kind: 'stamp', icon: '💌', label: `Friends with ${SPECIES_BY_ID[bestSp.id].name}`, have: bestSp.have, need: bestSp.need, species: bestSp.id });
  const C = currentTable(profile);
  if (C != null) {
    const lit = tableFacts(C).filter((k) => Math.max(profile.facts[k]?.box ?? 0, profile.facts[k]?.bestBox ?? 0) >= 3).length;
    c.push({ kind: 'lanterns', icon: '🏮', label: `Light ×${C}`, have: lit, need: 12, table: C });
  }
  return c.filter((x) => x.have < x.need)
    .map((x) => ({ ...x, frac: x.need ? x.have / x.need : 0 }))
    .sort((a, b) => b.frac - a.frac)
    .slice(0, 3);
}

// ---- the round ------------------------------------------------------------------------

function factFromResult(r) {
  const f = r.fact || {};
  const a = Number(f.a), b = Number(f.b);
  if (!(a >= 1 && a <= 12 && b >= 1 && b <= 12)) return null;
  return { key: factKey(a, b), a, b };
}

/**
 * Apply a round. `plan` from planRound, `summary` from the engine (v2 shape).
 * Returns the reward report for the reward screen.
 */
export function applyRound(profile, plan, summary, { now = new Date(), today } = {}) {
  const P = profile.progress;
  const rng = makeRng(hashSeed(plan.seed, profile.id, 'rewards'));
  const roundIndex = plan.roundIndex;
  const day = today || plan.today;
  const R = {
    roundIndex, type: plan.type, event: plan.event, table: plan.table,
    stars: 1, sparkle: false, starsTotal: 1, accuracy: 0, score: summary.score | 0, newBest: false,
    xpBefore: P.xp, levelBefore: P.level, xpGained: 0, xpBreakdown: [], levelUps: [],
    sparksBefore: P.sparks, sparksGained: 0, sparksBreakdown: [],
    cards: [], chests: [], nextUp: [], flags: {}, speedFrom: plan.x, speedTo: plan.x,
    bossDefeated: false, fixed: [], learned: [], introduced: [], tableEvents: [], welcomeBack: false,
  };
  const isNewDay = !P.playDays.includes(day);
  R.welcomeBack = isNewDay && P.roundIndex > 0;
  P.roundIndex = roundIndex;

  // 1. Facts (graded results only).
  const results = Array.isArray(summary.results) ? summary.results : [];
  const boxUp = new Set();
  const ctx = { roundIndex, today: day, boxUpThisRound: boxUp };
  let correct = 0, wrong = 0, escapes = 0, fast = 0, firstEver = 0, golden = 0;
  const rts = [];
  const target = profile.settings.targetMs;
  const before = {};
  for (const r of results) {
    const f = factFromResult(r);
    if (!f) continue;
    if (r.golden && r.result === 'correct') golden++;
    if (r.graded === false) {
      // Armored inner pop: the other form counts for orientation only (§6.1).
      if (r.result === 'correct') {
        const rec = ensureFact(profile, f.key);
        if (f.a === f.b) { rec.orient.ab = rec.orient.ba = true; } else rec.orient[f.a < f.b ? 'ab' : 'ba'] = true;
      }
      continue;
    }
    // Golden monsters are extra: rewards only, never SRS or the round's counters.
    // Splitsy minis are graded for SRS (DESIGN §6.1).
    if (r.golden) continue;
    const rec = ensureFact(profile, f.key);
    if (!(f.key in before)) before[f.key] = { introduced: rec.introduced, best: Math.max(rec.box, rec.bestBox || 0) };
    const isFast = r.result === 'correct' && (r.fast ?? (r.rt_ms != null && r.rt_ms <= target));
    const out = applyResolution(rec, f.key, { result: r.result === 'escaped' ? 'escape' : r.result, rtMs: r.rt_ms ?? null, fast: isFast, given: r.given, a: f.a, b: f.b, ghost: !!r.ghost }, ctx);
    if (r.result === 'correct') {
      correct++;
      if (isFast) fast++;
      if (r.rt_ms != null && !r.ghost) rts.push(r.rt_ms);
      if (out.firstCorrect) firstEver++;
      if (out.fixed && !R.fixed.includes(f.key)) R.fixed.push(f.key);
    } else if (r.result === 'wrong') wrong++;
    else if (!r.mini) escapes++; // a mini escape still updates SRS, but is not a round escape
  }
  for (const [key, b] of Object.entries(before)) {
    const rec = profile.facts[key];
    if (!b.introduced && rec.introduced) R.introduced.push(key);
    if (b.best < 3 && rec.bestBox >= 3) R.learned.push(key);
  }

  const accuracy = summary.accuracy != null ? summary.accuracy : accuracyOf(results);
  const medRt = summary.median_rt_ms ?? median(rts);
  const st = starsFor(accuracy, medRt, target);
  Object.assign(R, { stars: st.stars, sparkle: st.sparkle, starsTotal: st.total, accuracy, medianRtMs: medRt, correct, wrong, escapes, fast });

  P.totalCorrect += correct; P.totalWrong += wrong; P.totalEscapes += escapes;
  P.goldenTotal += golden;
  P.starsTotal += st.total;
  P.timePlayedMs += Math.max(0, summary.duration_ms | 0);
  P.bestCombo = Math.max(P.bestCombo, summary.best_combo | 0);
  if (isNewDay) P.playDays.push(day);
  P.lastPlayDay = day;
  const tierIdx = profile.settings.baseTier;
  if (R.score > (P.bestScoreByTier[tierIdx] || 0) && P.roundIndex > 1 && R.score > 0) {
    R.newBest = P.bestScoreByTier[tierIdx] > 0;
    P.bestScoreByTier[tierIdx] = R.score;
  } else if (R.score > (P.bestScoreByTier[tierIdx] || 0)) P.bestScoreByTier[tierIdx] = R.score;

  // 2. Monster Book.
  const pops = {};
  let shinyDone = false;
  const parade = plan.event === 'monster_parade' ? 2 : 1;
  for (const r of results) {
    if (r.result !== 'correct') continue;
    const id = r.species || null;
    if (!id) continue;
    pops[id] = pops[id] || { n: 0, shiny: false };
    pops[id].n += parade;
    if (r.shiny && !shinyDone) { pops[id].shiny = true; shinyDone = true; }
    if (r.special === 'armored' && r.result === 'correct' && r.graded === false) R.flags.armored = true;
    if (r.special === 'splitter') R.flags.splitter = true;
    if (r.special === 'freeze') R.flags.freeze = true;
  }
  if (golden) R.flags.golden = true;
  for (const [id, { n, shiny }] of Object.entries(pops)) popSpecies(profile, id, n, shiny, roundIndex, R);

  // 3. Features seen (intro cards are shown once).
  const seen = P.featuresSeen;
  for (const name of plan.specials?.intros || []) seen[name] = true;
  if (!seen.workshop && roundIndex >= TUNING.workshopRound) { seen.workshop = true; R.cards.push({ type: 'workshop' }); }
  if (plan.type === 'mixup') seen.mixup = true;

  // 4. Tables.
  // A table counts as practised only when the round really had its sums: a stray
  // 1×7 must not move ×1's kindness valves (§1.4).
  const perTable = {};
  for (const r of results) {
    if (r.graded === false || r.golden) continue;
    const f = factFromResult(r);
    if (!f) continue;
    for (const T of new Set([f.a, f.b])) perTable[T] = (perTable[T] || 0) + 1;
  }
  const playedTables = new Set(Object.keys(perTable).filter((T) => perTable[T] >= TUNING.valveMinSums).map(Number));
  let newIsland = false;
  for (const T of [...PATH].sort((a, b) => a - b)) {
    const evs = updateTableAfterRound(profile, T, roundIndex, day, playedTables.has(T));
    for (const e of evs) R.tableEvents.push(e);
  }
  if (plan.type === 'boss' && summary.boss_defeated && !summary.aborted) {
    R.bossDefeated = true;
    const T = plan.table;
    const t = tableRec(profile, T);
    const first = !t.bossBeaten;
    const wasPending = t.bossPending;
    t.bossBeaten = true;
    t.bossPending = false;
    t.bossWins = (t.bossWins || 0) + 1;
    // Every win pays a little; the first win pays a lot.
    P.xp += TUNING.bossWin.xp; R.xpGained += TUNING.bossWin.xp; R.xpBreakdown.push({ why: 'boss', xp: TUNING.bossWin.xp });
    addSparks(profile, R, TUNING.bossWin.sparks, 'boss');
    // Medal: 1 bronze (a win), 2 silver (accuracy), 3 gold (accuracy + speed).
    const [, silver, gold] = TUNING.bossMedalAcc;
    const fastOk = medRt != null && medRt <= target;
    const medal = accuracy >= gold && fastOk ? 3 : accuracy >= silver ? 2 : 1;
    R.bossMedal = medal;
    R.bossMedalBefore = t.bossMedal || 0;
    if (medal > (t.bossMedal || 0)) {
      t.bossMedal = medal;
      R.cards.push({ type: 'medal', table: T, medal });
      if (!first) rollChest(profile, 'boss', rng, R);
    }
    if (first) {
      P.bossesBeaten += 1;
      P.xp += TUNING.xp.boss; R.xpGained += TUNING.xp.boss; R.xpBreakdown.push({ why: 'boss', xp: TUNING.xp.boss });
      awardBadge(profile, `island_hero_${T}`, day, R);
      const grand = `grand_${speciesOfIsland(T, 'A').id}`;
      popSpecies(profile, grand, 1, false, roundIndex, R);
      const sb = speciesOfIsland(T, 'B');
      R.cards.push({ type: 'boss', table: T, species: grand, newFriend: sb.id });
      for (const it of BUNDLE_ITEMS[T] || []) if (grantItem(profile, it)) R.cards.push({ type: 'item', id: it });
      rollChest(profile, 'boss', rng, R);
      // Guided mode: beating the island's boss (after learning it) opens the
      // earliest island still locked, so no island is skipped.
      if (profile.settings.tableMode === 'guided' && (wasPending || ['known', 'mastered'].includes(t.state))) {
        const next = PATH.find((U) => profile.tables[U]?.state === 'locked' || !profile.tables[U]);
        if (next != null && openTable(profile, next, roundIndex)) {
          newIsland = true;
          const already = sharedFactsOfTable(next).filter((k) => (profile.facts[k]?.bestBox ?? 0) >= 3).length;
          R.cards.push({ type: 'island', table: next, already });
          R.tableEvents.push({ table: next, event: 'opened' });
        }
      }
    }
  }
  for (const e of R.tableEvents) {
    if (e.event === 'known') R.cards.push({ type: 'known', table: e.table });
    if (e.event === 'mastered' && !profile.collection.crowns.includes(e.table)) {
      profile.collection.crowns.push(e.table);
      R.cards.push({ type: 'crown', table: e.table });
      rollChest(profile, 'crown', rng, R);
    }
  }
  // Guided mode safety: if nothing is open and not known, open the next island.
  if (profile.settings.tableMode === 'guided' && currentTable(profile) == null) {
    for (const T of PATH) {
      const t = profile.tables[T];
      if (t.state === 'locked') {
        const prevKnownAndBeaten = PATH.slice(0, PATH.indexOf(T)).every((U) => profile.tables[U].bossBeaten || !isOpenState(profile.tables[U].state));
        if (prevKnownAndBeaten && !PATH.slice(0, PATH.indexOf(T)).some((U) => profile.tables[U].bossPending)) {
          openTable(profile, T, roundIndex); newIsland = true;
          R.tableEvents.push({ table: T, event: 'opened' });
        }
        break;
      }
    }
  }

  // 5. Speed (between-round half): save what the engine reports.
  const sp = profile.speed;
  // The decayed start offset is committed only now (an aborted round leaves it alone).
  const startOffset = Number(plan.config?.speed?.offset);
  if (Number.isFinite(startOffset)) sp.offset = startOffset;
  if (plan.type !== 'boss' && plan.type !== 'tutorial' && summary.offset_end != null && Number.isFinite(summary.offset_end)) {
    sp.offset = summary.offset_end;
  }
  if (typeof summary.recent_end === 'string') sp.recent = summary.recent_end.replace(/[^CWE]/g, '').slice(-8);
  if (newIsland) sp.offset += TUNING.newIslandOffset;
  sp.offset = +clampOffset(sp.offset, profile.settings.baseTier, P.level).toFixed(4);
  sp.lastRoundDay = day;
  R.speedFrom = summary.x_start ?? plan.x;
  R.speedTo = summary.x_end ?? xEff(profile.settings.baseTier, P.level, sp.offset);

  // 6. XP (§4.4).
  const X = TUNING.xp;
  const add = (why, xp) => { if (xp > 0) { R.xpBreakdown.push({ why, xp }); R.xpGained += xp; P.xp += xp; } };
  add('round', X.roundFinished);
  add('correct', X.correct * correct);
  add('fast', X.fast * fast);
  add('first', X.firstEverCorrect * firstEver);
  add('fixed', X.trickyFixed * R.fixed.length);
  add('fixit', X.fixedIt * (summary.fixed | 0));
  add('stars', X.perStar * st.total);
  add('combo', X.perFiveCombo * Math.floor((summary.best_combo | 0) / 5));
  add('golden', X.golden * golden);
  if (roundIndex === 1) {
    // Welcome bonus; the first round always reaches level 2 (§5.10).
    const toL2 = Math.max(0, xpNeed(1) - P.xp);
    add('welcome', Math.max(X.welcome, toL2));
  }

  // 7. Sparks (§4.3).
  addSparks(profile, R, roundSparks({ starsTotal: st.total, correct, golden, goldenHour: plan.event === 'golden_hour' }), 'round');

  // 8. Stickers.
  giveSticker(profile, rng, R);
  if (plan.event === 'sticker_storm') giveSticker(profile, rng, R);

  // 9. Chest meter. The first round of a new day adds a welcome-back star (it
  // used to be a whole chest every day, which made chests feel like nothing).
  R.welcomeStars = R.welcomeBack ? TUNING.welcomeBackStars : 0;
  let meter = st.total + ((plan.type === 'mixup' || plan.type === 'revision') && st.stars >= 2 ? 1 : 0) + R.welcomeStars;
  P.chestStars += meter;
  while (P.chestStars >= TUNING.starsPerChest) {
    P.chestStars -= TUNING.starsPerChest;
    rollChest(profile, 'star', rng, R);
  }

  // 10. Round badges.
  const b = (id, cond) => { if (cond) awardBadge(profile, id, day, R); };
  b('first_pop', P.totalCorrect > 0);
  b('fix_it_kid', R.fixed.length > 0);
  const bc = summary.best_combo | 0;
  b('hot_streak', bc >= 5); b('blazing_streak', bc >= 10); b('mega_streak', bc >= 25);
  b('three_stars', st.stars >= 3);
  b('rainbow_round', st.sparkle);
  const deckSums = correct + wrong + escapes;
  b('perfect_round', deckSums >= 12 && wrong === 0 && escapes === 0);
  b('golden_catch', golden > 0);
  b('shell_cracker', !!R.flags.armored || results.some((r) => r.special === 'armored' && r.result === 'correct' && r.graded === false));
  b('split_second', results.some((r) => r.special === 'splitter' && r.result === 'correct'));
  b('chill_out', results.some((r) => r.special === 'freeze' && r.result === 'correct'));
  b('golden_crown', profile.collection.crowns.length > 0);
  b('speedy_fingers', fast >= 10);
  b('lightning_brain', correct >= 12 && medRt != null && medRt <= 0.5 * target);
  b('speed_climber', Math.max(R.speedTo, summary.x_max ?? -9) >= profile.settings.baseTier + 1.0);
  b('comeback_kid', st.stars >= 3 && P.lastRoundStars === 1);
  b('best_friends', Object.values(profile.collection.dex).some((d) => d.stamps.includes('best')));
  b('shiny_spotter', Object.values(profile.collection.dex).some((d) => d.shiny));
  b('sticker_star', !!R.flags.pageDone);  // (a page finished by a level chest is checked after step 11)
  b('mix_master', (plan.type === 'mixup' || plan.type === 'revision') && st.stars >= 3);
  statBadges(profile, day, R);

  // 11. Level ups (after all XP, including badges and stamps).
  applyLevelUps(profile, R.levelBefore, rng, R);
  // A level chest can finish a sticker page too; its badge XP may pass another level.
  if (R.flags.pageDone && awardBadge(profile, 'sticker_star', day, R)) applyLevelUps(profile, P.level, rng, R);
  for (const up of R.levelUps) for (const it of up.items) if (it === 'party_hat') R.flags.putItOn = 'party_hat';

  // 12. Guaranteed something new (§5.10).
  if (!R.cards.some((c) => c.type !== 'sticker') && !R.levelUps.length && !R.chests.length) {
    addSparks(profile, R, TUNING.nothingNewSparks, 'bonus');
    R.cards.push({ type: 'nudge' });
  }

  // 12b. Where to improve: this round's sums that need more practice, and the
  // tables to practise next (shown on the reward screen; never a wrong count).
  R.weakFacts = roundWeakFacts(results, target, factFromResult).slice(0, 4);
  R.practiceNext = practiceNext(profile, 3).map((t) => ({ table: t.T, level: t.level, weakest: t.weakest.slice(0, 3) }));

  // 13. Bookkeeping.
  P.lastRoundType = plan.type;
  P.lastRoundAccuracy = accuracy;
  P.lastRoundStars = st.total;
  P.lastEvent = plan.event || null;
  if (plan.owesMixup) P.mixupOwed = true;
  else if (plan.type === 'mixup' || plan.type === 'revision') P.mixupOwed = false;
  profile.history.push({
    round: roundIndex, at: now.toISOString(), day, type: plan.type, table: plan.table, seed: plan.seed,
    sums: results.length, correct, wrong, escapes, stars: st.total, score: R.score, xp: R.xpGained, sparks: R.sparksGained,
    medianRtMs: medRt == null ? null : Math.round(medRt), xStart: R.speedFrom, xEnd: R.speedTo, bestCombo: bc,
    durationMs: Math.max(0, summary.duration_ms | 0),
  });
  if (profile.history.length > TUNING.historyKeep) profile.history.splice(0, profile.history.length - TUNING.historyKeep);

  R.xpAfter = P.xp;
  R.levelAfter = P.level;
  R.sparksAfter = P.sparks;
  R.nextUp = nextUp(profile);
  return R;
}
