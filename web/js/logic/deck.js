// Round planning: round type and the deck (§2.4, §2.6, §6.1, §6.2).
// Pure: give it a profile, a seed and today; get back a plan whose `config`
// is the engine round config (engine/API.md v2).

import { TUNING } from './tuning.js';
import { makeRng, weightedSample } from './rng.js';
import { PATH, tableFacts, parseKey, homeTable, isSquare, answerOf, orient } from './facts.js';
import { factWeight, isDue } from './srs.js';
import { currentTable, knownTables, pendingBoss, tableState, isOpenState, factIsOpen } from './tables.js';
import { xEff, sumsFor } from './speed.js';
import { speciesOfIsland, SPECIES_BY_ID } from './catalog.js';

const bandCfg = (p) => TUNING.bands[p.ageBand] || TUNING.bands.big;

/** Decide the round type for the next round (§6.2). choice: {table?, boss?} from the map. */
export function pickRoundType(profile, rng, choice = {}) {
  const next = profile.progress.roundIndex + 1;
  if (profile.progress.roundIndex === 0) return { type: 'tutorial', table: 1 };
  if (choice.boss != null) return { type: 'boss', table: choice.boss, replay: !!profile.tables[choice.boss]?.bossBeaten };
  if (choice.table != null) return { type: 'normal', table: choice.table };
  const boss = pendingBoss(profile);
  if (boss != null) return { type: 'boss', table: boss };
  const known = knownTables(profile).length;
  const mixupSlot = next % TUNING.mixupEvery === 0 || profile.progress.mixupOwed;
  if (known >= TUNING.mixupMinKnown && mixupSlot) {
    if (profile.progress.lastRoundType === 'boss') return { type: 'normal', table: currentTable(profile), owesMixup: true };
    return { type: 'mixup', table: currentTable(profile) };
  }
  const C = currentTable(profile);
  if (next >= TUNING.eventFromRound && !profile.progress.lastEvent && rng.chance(TUNING.eventChance)) {
    const event = rng.pick(['golden_hour', 'bubble_breeze', 'night_glow', 'monster_parade', 'sticker_storm']);
    return { type: 'normal', table: C, event };
  }
  return { type: 'normal', table: C };
}

/** Species for a fact: home island species A, or B (30 %) once that boss is beaten (§5.3). */
function speciesFor(profile, key, rng) {
  const T = homeTable(key);
  const a = speciesOfIsland(T, 'A');
  if (profile.tables[T]?.bossBeaten && rng.chance(TUNING.speciesBShare)) return speciesOfIsland(T, 'B').id;
  return a.id;
}

/** Display form (§2.6). `shownBefore` counts appearances so far (saved seen + planned). */
export function displayForm(rec, key, shownBefore, firstTable, rng) {
  const { a, b } = parseKey(key);
  if (a === b) return { a, b };
  const box = rec ? rec.box : 0;
  if (box >= 3 && rec) {
    if (rec.orient.ab && !rec.orient.ba) return { a: b, b: a };
    if (rec.orient.ba && !rec.orient.ab) return { a, b };
  }
  if (shownBefore < 2 || box < 2) return orient(key, firstTable);
  return rng.chance(0.5) ? { a, b } : { a: b, b: a };
}

function introducedKeys(profile) {
  return Object.keys(profile.facts).filter((k) => profile.facts[k].introduced && factIsOpen(profile, k));
}

/** Can `key` go in slot i given the deck so far and a min gap to its other copies? */
function gapOk(deck, i, key, gap) {
  for (let j = Math.max(0, i - gap + 1); j < Math.min(deck.length, i + gap); j++) {
    if (j !== i && deck[j] && deck[j].key === key) return false;
  }
  return true;
}

function copies(deck, key) {
  return deck.reduce((n, s) => n + (s && s.key === key ? 1 : 0), 0);
}

/**
 * Fill free slots from a candidate pool. cands: [{key, w}].
 * Unused facts are strongly preferred (sampling without replacement first).
 */
function fillFrom(deck, cands, kind, rng, { maxCopies = 2, gap = 4, limit = Infinity } = {}) {
  let placed = 0;
  for (let i = 0; i < deck.length && placed < limit; i++) {
    if (deck[i]) continue;
    const ok = cands.filter((c) => c.w > 0 && copies(deck, c.key) < maxCopies && gapOk(deck, i, c.key, gap));
    if (!ok.length) continue;
    const fresh = ok.filter((c) => copies(deck, c.key) === 0);
    const [pick] = weightedSample(rng, fresh.length ? fresh : ok, 1);
    deck[i] = { key: pick.key, kind };
    placed++;
  }
  return placed;
}

/** Spread `n` picks into random free slots (used for tricky and review buckets). */
function scatter(deck, keys, kind, rng, gap) {
  let placed = 0;
  for (const key of keys) {
    const free = [];
    for (let i = 0; i < deck.length; i++) if (!deck[i] && gapOk(deck, i, key, gap)) free.push(i);
    if (!free.length) continue;
    deck[rng.pick(free)] = { key, kind };
    placed++;
  }
  return placed;
}

/**
 * Build the round plan.
 * opts: { seed, today, choice, offset } (offset: the decayed start offset, §3.3;
 *   defaults to the saved one)
 * Returns { type, table, event, seed, x, deck (internal slots), config (engine), specials, newKeys, ... }
 */
export function planRound(profile, { seed, today, choice = {}, offset = profile.speed.offset } = {}) {
  const rng = makeRng(seed);
  const band = profile.ageBand === 'little' ? 'little' : 'big';
  const bc = bandCfg(profile);
  const roundIndex = profile.progress.roundIndex + 1;
  const picked = pickRoundType(profile, rng, choice);
  const { type } = picked;
  const C = picked.table ?? currentTable(profile);
  const event = picked.event || null;
  const base = profile.settings.baseTier;
  const level = profile.progress.level;
  const x = xEff(base, level, offset);
  const prog = profile.progress;
  const rec = (k) => profile.facts[k];
  const w = (k) => factWeight(rec(k), roundIndex, today);
  const intro = introducedKeys(profile);

  let deck = [];
  const newKeys = [];

  if (type === 'tutorial') {
    // 1×1..1×5 ghosted, each repeated two slots later (§6.2): 10 sums.
    const keys = tableFacts(1).slice(0, 5);
    const order = [[0, 'g'], [1, 'g'], [0, 'r'], [2, 'g'], [1, 'r'], [3, 'g'], [2, 'r'], [4, 'g'], [3, 'r'], [4, 'r']];
    deck = order.map(([i, t]) => ({ key: keys[i], kind: 'new', ghost: t === 'g', lantern: t === 'r' }));
    newKeys.push(...keys);
  } else if (type === 'boss') {
    deck = rng.shuffle(tableFacts(C)).map((key) => ({ key, kind: 'focus', randomForm: true }));
  } else {
    const N = sumsFor(x, band);
    deck = new Array(N).fill(null);
    const easy = intro.filter((k) => rec(k).box >= 3 && !rec(k).tricky);
    // 1. warm-up
    let warm = weightedSample(rng, easy.map((key) => ({ key, w: w(key) + 0.01 })), TUNING.warmupSlots).map((c) => c.key);
    if (warm.length < TUNING.warmupSlots) {
      const byBox = intro.filter((k) => !warm.includes(k)).sort((a, b) => rec(b).box - rec(a).box || w(b) - w(a));
      warm = warm.concat(byBox.slice(0, TUNING.warmupSlots - warm.length));
    }
    warm.forEach((key, i) => { deck[i] = { key, kind: 'warmup' }; });

    // 2. new
    if (C != null && type === 'normal' && event !== 'golden_hour') {
      let k = TUNING.newPerRoundOverride[C] ?? bc.newPerRound;
      const load = intro.filter((key) => rec(key).box <= 1).length;
      if (load >= bc.loadCap) k = 0;
      if (prog.lastRoundAccuracy != null && prog.lastRoundAccuracy < TUNING.lowAccuracyNoNew) k = 0;
      const fresh = tableFacts(C).filter((key) => !rec(key)?.introduced);
      for (const key of fresh.slice(0, k)) {
        const firsts = [];
        for (let i = 2; i <= N - 5; i++) if (!deck[i]) firsts.push(i);
        const opts = [];
        for (const f of firsts) for (let g = TUNING.newGapMin; g <= TUNING.newGapMax; g++) if (f + g < N && !deck[f + g]) opts.push([f, f + g]);
        if (!opts.length) break;
        const [f, s] = rng.pick(opts);
        deck[f] = { key, kind: 'new', ghost: true };
        deck[s] = { key, kind: 'new', lantern: true };
        newKeys.push(key);
      }
    }

    // 3. tricky
    if (type !== 'mixup') {
      const tricky = intro.filter((k) => rec(k).tricky && !deck.some((s) => s && s.key === k))
        .sort((a, b) => (rec(b).lastWrongRound ?? 0) - (rec(a).lastWrongRound ?? 0))
        .slice(0, bc.trickySlots);
      scatter(deck, tricky, 'tricky', rng, TUNING.trickyMinGap);
    }

    // 4. review (and Mix-Up: everything is review)
    const knownSet = new Set(knownTables(profile));
    const reviewKeys = intro.filter((k) => knownSet.has(homeTable(k)) && (type === 'mixup' || homeTable(k) !== C));
    const reviewCands = () => reviewKeys.filter((k) => !deck.some((s) => s && s.key === k)).map((key) => ({ key, w: w(key) }));
    if (type === 'mixup') {
      fillFrom(deck, reviewKeys.map((key) => ({ key, w: w(key) })), 'review', rng, { gap: 4 });
    } else if ([...knownSet].some((T) => T !== C)) {
      const r = Math.round(TUNING.reviewShare * N);
      const picks = weightedSample(rng, reviewCands(), r).map((c) => c.key);
      scatter(deck, picks, 'review', rng, TUNING.trickyMinGap);
    }

    // 5. focus
    if (C != null && type !== 'mixup') {
      const focus = tableFacts(C).filter((k) => rec(k)?.introduced).map((key) => ({ key, w: w(key) + 0.05 }));
      fillFrom(deck, focus, 'focus', rng, { maxCopies: TUNING.focusMaxCopies, gap: TUNING.focusMinGap });
    }
    // 6. fallback: review, easy, then any introduced (gap 3), then relax.
    fillFrom(deck, reviewKeys.map((key) => ({ key, w: w(key) + 0.05 })), 'review', rng, { gap: TUNING.fallbackMinGap });
    fillFrom(deck, easy.map((key) => ({ key, w: w(key) + 0.05 })), 'easy', rng, { gap: TUNING.fallbackMinGap });
    const anyIntro = intro.map((key) => ({ key, w: w(key) + 0.05 }));
    fillFrom(deck, anyIntro, 'focus', rng, { maxCopies: 3, gap: TUNING.fallbackMinGap });
    fillFrom(deck, anyIntro, 'focus', rng, { maxCopies: 4, gap: 2 });
    fillFrom(deck, anyIntro, 'focus', rng, { maxCopies: 99, gap: 1 });
    deck = deck.filter(Boolean);
  }

  // Display forms, species, tricky tags.
  const shown = {};
  const firstTableOf = (key) => {
    const { a, b } = parseKey(key);
    if (C === a || C === b) return C;
    return homeTable(key);
  };
  let parade = null;
  if (event === 'monster_parade') parade = paradeSpecies(profile);
  for (const s of deck) {
    const r = rec(s.key);
    const before = (r?.seen || 0) + (shown[s.key] || 0);
    shown[s.key] = (shown[s.key] || 0) + 1;
    const form = s.randomForm && !isSquare(s.key)
      ? (rng.chance(0.5) ? parseKey(s.key) : orient(s.key, parseKey(s.key).b))
      : displayForm(r, s.key, before, firstTableOf(s.key), rng);
    s.a = form.a; s.b = form.b;
    s.species = parade || speciesFor(profile, s.key, rng);
    if (r?.tricky && s.kind !== 'new') { s.tricky = true; s.trickyNeed = r.trickyNeed; }
  }

  // Specials (§6.1).
  const specials = { golden: [], armored: false, freeze: false, splitter: false, intros: [] };
  const seen = prog.featuresSeen || {};
  const roundsOk = (n) => roundIndex >= n;
  const littleBand = band === 'little';
  if (type !== 'tutorial' && type !== 'boss') {
    // Goldfluff: extra, a Known fact.
    const goldCands = intro.filter((k) => rec(k).box >= 3);
    const goldPool = goldCands.length ? goldCands : intro;
    let golds = 0;
    if (roundsOk(3) && goldPool.length) {
      if (event === 'golden_hour') golds = 2;
      else if (!seen.golden) golds = 1;
      else if (rng.chance(0.35)) golds = 1;
    }
    for (let i = 0; i < golds; i++) {
      const key = rng.pick(goldPool);
      const { a, b } = rng.chance(0.5) || isSquare(key) ? parseKey(key) : orient(key, parseKey(key).b);
      specials.golden.push({ a, b, key });
    }
    if (golds && !seen.golden) specials.intros.push('golden');

    const slotFor = (pred) => {
      const idx = deck.map((s, i) => i).filter((i) => i >= 2 && !deck[i].special && !deck[i].ghost && deck[i].kind !== 'new' && pred(deck[i]));
      return idx.length ? rng.pick(idx) : -1;
    };
    const tryAdd = (name, unlocked, chance, pred, speciesId) => {
      if (!unlocked) return;
      const first = !seen[name];
      if (!first && !rng.chance(chance)) return;
      const i = slotFor(pred);
      if (i < 0) return;
      deck[i].special = name;
      deck[i].species = speciesId;
      if (first) { deck[i].intro = true; specials.intros.push(name); }
      specials[name] = true;
    };
    tryAdd('armored', isOpenState(tableState(profile, 2)) || roundsOk(8), 0.5,
      (s) => !isSquare(s.key) && (rec(s.key)?.box ?? 0) >= 1, 'clonkshell');
    tryAdd('freeze', roundsOk(12) || ['known', 'mastered'].includes(tableState(profile, 10)), littleBand ? 0.35 : 0.25,
      (s) => isDue(rec(s.key), roundIndex, today), 'chillby');
    tryAdd('splitter', roundsOk(16) || isOpenState(tableState(profile, 3)), 0.3,
      (s) => s.kind === 'focus', 'splitsy');
  }

  // Shiny: from round 10, a Met species, 1 in 50, at most one per round (§5.3).
  if (roundIndex >= TUNING.shinyFromRound) {
    for (const s of deck) {
      if (!s.special && profile.collection.dex[s.species]?.met && rng.chance(TUNING.shinyChance)) { s.shiny = true; break; }
    }
  }

  const miniPool = C != null
    ? tableFacts(C).filter((k) => rec(k)?.introduced).map((k) => orient(k, C))
    : [];

  const config = {
    seed,
    round_type: type,
    event,
    band,
    target_ms: profile.settings.targetMs,
    speed: { base, level, offset, recent: profile.speed.recent || '' },
    deck: deck.map((s) => {
      const o = { a: s.a, b: s.b, kind: s.kind, species: s.species };
      if (s.ghost) o.ghost = true;
      if (s.lantern) o.lantern = true;
      if (s.tricky) { o.tricky = true; o.tricky_need = s.trickyNeed; }
      if (s.special) o.special = s.special;
      if (s.intro) o.intro = true;
      if (s.shiny) o.shiny = true;
      return o;
    }),
    golden: specials.golden.map(({ a, b }) => ({ a, b })),
    mini_pool: specials.splitter ? miniPool : [],
    boss: type === 'boss' ? { species: speciesOfIsland(C, 'A').id, hp: 12 } : null,
    calm: !!profile.settings.calmEffects,
  };

  return {
    type, table: C, event, seed, roundIndex, today, x, replay: !!picked.replay, owesMixup: !!picked.owesMixup,
    deck, specials, newKeys, config,
  };
}

/** Monster Parade species: the most-popped species still under Best Friend (§6.4). */
function paradeSpecies(profile) {
  const dex = profile.collection.dex;
  let best = null, n = -1;
  for (const [id, d] of Object.entries(dex)) {
    const sp = SPECIES_BY_ID[id];
    if (!sp || (sp.kind !== 'A' && sp.kind !== 'B')) continue;
    if (d.pops < TUNING.stampAt.best && d.pops > n) { best = id; n = d.pops; }
  }
  return best || 'bloop';
}

/** Sanity helper for tests: answer of a deck slot. */
export const slotAnswer = (s) => s.a * s.b;
export { answerOf };
