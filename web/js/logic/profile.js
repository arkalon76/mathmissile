// Profiles and the versioned save (§8). Works with any Storage-like object
// (localStorage in the browser, a Map-backed fake in tests). Every storage
// call is wrapped: a full, blocked or corrupted store never crashes the game.

import { TUNING } from './tuning.js';
import { PATH, parseKey, blankFact } from './facts.js';
import { blankTable } from './tables.js';
import { clampTier } from './speed.js';
import { AVATARS, ITEMS_BY_ID, SPECIES_BY_ID, BADGES_BY_ID } from './catalog.js';
import { isDay } from './day.js';

export const SCHEMA = 2;
export const INDEX_KEY = 'mm.index';
export const DEVICE_KEY = 'mm.device';
export const profileKey = (id) => `mm.profile.${id}`;
export const BACKUP_PREFIX = 'mm.corrupt.';
const BACKUP_MAX = 3;
const BACKUP_MAX_CHARS = 2_000_000;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d, lo = -Infinity, hi = Infinity) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? clamp(Number(v), lo, hi) : d);
const int = (v, d, lo, hi) => Math.round(num(v, d, lo, hi));
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const str = (v, d) => (typeof v === 'string' ? v : d);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
/** Own-key lookup in a catalog map (so '__proto__', 'constructor' etc. never match). */
const has = (map, k) => typeof k === 'string' && Object.hasOwn(map, k);
/** A short saved string: type-checked and length-capped (ids, dates, titles). */
const sstr = (v, d, max = 64) => (typeof v === 'string' ? v.slice(0, max) : d);
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const sid = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : null);

/** Strip control characters, collapse spaces, trim and cut to `max` characters. */
export function cleanText(s, max) {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  return [...t].slice(0, max).join('');
}

export function bandForAge(age) {
  return age <= 7 ? 'little' : 'big';
}

export function newId(rand = Math.random) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'p_';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(rand() * chars.length)];
  return s;
}

/** A brand new profile. */
export function createProfile({ id, name, avatar, age, now = new Date() }) {
  const a = int(age, 7, 3, 18);
  const tier = TUNING.defaultTierByAge[clamp(a, 5, 10)] ?? 0;
  const p = {
    schema: SCHEMA,
    id: id || newId(),
    name: cleanText(name, TUNING.profileNameMax) || 'Player',
    age: a,
    ageBand: bandForAge(a),
    createdAt: now.toISOString(),
    avatar: { base: AVATARS.includes(avatar) ? avatar : AVATARS[0], colorSet: 'default',
      equipped: { hat: null, face: null, back: null }, blade: 'starter_wand', trail: 'plain' },
    settings: {
      baseTier: tier, targetMs: TUNING.targetMsByTier[tier], tableMode: 'guided', manualTables: [],
      calmEffects: false, numberPad: 'auto', breakMinutes: TUNING.breakMinutesDefault,
    },
    progress: {
      level: 1, xp: 0, sparks: 0, roundIndex: 0, starsTotal: 0, chestStars: 0,
      totalCorrect: 0, totalWrong: 0, totalEscapes: 0, timePlayedMs: 0,
      playDays: [], lastPlayDay: null, bestCombo: 0, bestScoreByTier: [0, 0, 0, 0, 0],
      title: '', featuresSeen: {}, placementDone: false, lastRoundType: null,
      lastRoundAccuracy: null, lastRoundStars: null, lastEvent: null, mixupOwed: false,
      wish: null, goldenTotal: 0, bossesBeaten: 0, purchases: 0,
    },
    speed: { offset: 0, lastRoundDay: null, recent: '' },
    facts: {},
    tables: {},
    collection: { dex: {}, blades: ['starter_wand'], trails: ['plain'], avatarItems: [], colorSets: ['default'],
      stickers: [], badges: {}, crowns: [] },
    history: [],
    rewards: { real: [], redemptions: [] },
    pendingRound: null,
  };
  for (const T of PATH) p.tables[T] = blankTable();
  p.tables[1].state = 'open';
  p.tables[1].openedRound = 0;
  return p;
}

// ---- migration -------------------------------------------------------------

/**
 * Bring any saved object up to the current schema, filling gaps and clamping
 * values. Never throws; returns null only for things that are not a profile.
 */
export function migrateProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const schema = int(raw.schema, 1, 0, 1e6);
  let p = raw;
  if (schema < 2) {
    // v1 (DESIGN §8 shape) → v2: real-life rewards, break minutes, owed Mix-Up.
    p = { ...p, rewards: p.rewards || { real: [], redemptions: [] } };
    p.settings = { breakMinutes: TUNING.breakMinutesDefault, ...obj(p.settings) };
  }
  return normalizeProfile(p, schema > SCHEMA ? schema : SCHEMA);
}

function normalizeFact(f) {
  const b = blankFact();
  const o = obj(f);
  const box = int(o.box, 0, 0, 5);
  const day = (d) => (isDay(d) ? d : null);
  return {
    ...b,
    introduced: bool(o.introduced, false),
    introducedRound: o.introducedRound == null ? null : int(o.introducedRound, 0, 0, 1e9),
    box, bestBox: Math.max(box, int(o.bestBox, 0, 0, 5)),
    seen: int(o.seen, 0, 0, 1e9), correct: int(o.correct, 0, 0, 1e9), wrong: int(o.wrong, 0, 0, 1e9), escapes: int(o.escapes, 0, 0, 1e9),
    tricky: bool(o.tricky, false), trickyNeed: int(o.trickyNeed, 0, 0, 9),
    lastSeenRound: o.lastSeenRound == null ? null : int(o.lastSeenRound, 0, 0, 1e9),
    lastSeenDay: day(o.lastSeenDay), lastBoxUpRound: o.lastBoxUpRound == null ? null : int(o.lastBoxUpRound, 0, 0, 1e9),
    dayReachedBox3: day(o.dayReachedBox3), dayReachedBox4: day(o.dayReachedBox4), dayReachedBox5: day(o.dayReachedBox5),
    rtEmaMs: o.rtEmaMs == null ? null : int(o.rtEmaMs, null, 0, 600000),
    recentRtMs: arr(o.recentRtMs).map(Number).filter(Number.isFinite).slice(-TUNING.recentRtKeep),
    recent: str(o.recent, '').replace(/[^CWE]/g, '').slice(-TUNING.recentKeep),
    orient: { ab: bool(obj(o.orient).ab, false), ba: bool(obj(o.orient).ba, false) },
    lastWrongRound: o.lastWrongRound == null ? null : int(o.lastWrongRound, 0, 0, 1e9),
    confusedWith: Object.fromEntries(Object.entries(obj(o.confusedWith)).filter(([k, v]) => /^\d{1,4}$/.test(k) && Number.isFinite(v)).slice(0, 40)),
  };
}

function normalizeProfile(raw, schema) {
  const base = createProfile({ id: sid(raw.id) || undefined, name: str(raw.name, 'Player'), avatar: obj(raw.avatar).base, age: raw.age });
  const p = base;
  p.schema = schema;
  p.createdAt = sstr(raw.createdAt, p.createdAt, 40);
  p.ageBand = raw.ageBand === 'little' || raw.ageBand === 'big' ? raw.ageBand : p.ageBand;

  const av = obj(raw.avatar);
  const eq = obj(av.equipped);
  const own = (id, kind) => (has(ITEMS_BY_ID, id) && ITEMS_BY_ID[id].kind === kind ? id : null);
  p.avatar = {
    base: AVATARS.includes(av.base) ? av.base : p.avatar.base,
    colorSet: own(av.colorSet, 'color') || 'default',
    equipped: { hat: own(eq.hat, 'avatar'), face: own(eq.face, 'avatar'), back: own(eq.back, 'avatar') },
    blade: own(av.blade, 'blade') || 'starter_wand',
    trail: own(av.trail, 'trail') || 'plain',
  };

  const s = obj(raw.settings);
  const tier = clampTier(s.baseTier ?? p.settings.baseTier);
  p.settings = {
    baseTier: tier,
    targetMs: Math.round(num(s.targetMs, TUNING.targetMsByTier[tier], TUNING.targetMsMin, TUNING.targetMsMax) / 500) * 500,
    tableMode: s.tableMode === 'manual' ? 'manual' : 'guided',
    manualTables: arr(s.manualTables).map(Number).filter((T) => PATH.includes(T)),
    calmEffects: bool(s.calmEffects, false),
    numberPad: ['auto', 'on', 'off'].includes(s.numberPad) ? s.numberPad : 'auto',
    breakMinutes: int(s.breakMinutes, TUNING.breakMinutesDefault, 0, TUNING.breakMinutesMax),
  };

  const g = obj(raw.progress);
  const P = p.progress;
  for (const k of ['level', 'xp', 'sparks', 'roundIndex', 'starsTotal', 'chestStars', 'totalCorrect', 'totalWrong', 'totalEscapes', 'timePlayedMs', 'bestCombo', 'goldenTotal', 'bossesBeaten', 'purchases']) {
    P[k] = int(g[k], P[k], 0, 1e12);
  }
  P.level = clamp(P.level, 1, TUNING.maxLevel);
  P.playDays = [...new Set(arr(g.playDays).filter(isDay))].sort();
  P.lastPlayDay = isDay(g.lastPlayDay) ? g.lastPlayDay : (P.playDays.at(-1) || null);
  P.bestScoreByTier = [0, 1, 2, 3, 4].map((i) => int(arr(g.bestScoreByTier)[i], 0, 0, 1e9));
  P.title = cleanText(sstr(g.title, '', 200), 40);
  P.featuresSeen = Object.fromEntries(Object.entries(obj(g.featuresSeen)).filter(([k, v]) => /^[a-z][a-z0-9_]{0,31}$/.test(k) && typeof v === 'boolean').slice(0, 64));
  P.placementDone = bool(g.placementDone, false);
  P.lastRoundType = ['normal', 'tutorial', 'boss', 'mixup', 'revision', 'quick_check'].includes(g.lastRoundType) ? g.lastRoundType : null;
  P.lastRoundAccuracy = g.lastRoundAccuracy == null ? null : num(g.lastRoundAccuracy, null, 0, 1);
  P.lastRoundStars = g.lastRoundStars == null ? null : int(g.lastRoundStars, null, 1, 4);
  P.lastEvent = typeof g.lastEvent === 'string' && /^[a-z_]{1,32}$/.test(g.lastEvent) ? g.lastEvent : null;
  P.mixupOwed = bool(g.mixupOwed, false);
  P.wish = has(ITEMS_BY_ID, g.wish) ? g.wish : null;

  const sp = obj(raw.speed);
  p.speed = { offset: num(sp.offset, 0, -3, 3), lastRoundDay: isDay(sp.lastRoundDay) ? sp.lastRoundDay : null,
    recent: str(sp.recent, '').replace(/[^CWE]/g, '').slice(-8) };

  p.facts = {};
  for (const [k, v] of Object.entries(obj(raw.facts))) if (parseKey(k)) p.facts[k] = normalizeFact(v);

  const tables = obj(raw.tables);
  for (const T of PATH) {
    const t = obj(tables[T]);
    const b = blankTable();
    p.tables[T] = {
      ...b,
      state: ['locked', 'open', 'known', 'mastered'].includes(t.state) ? t.state : (T === 1 ? 'open' : 'locked'),
      openedRound: t.openedRound == null ? (T === 1 ? 0 : null) : int(t.openedRound, 0, 0, 1e9),
      knownRound: t.knownRound == null ? null : int(t.knownRound, 0, 0, 1e9),
      bossBeaten: bool(t.bossBeaten, false), bossPending: bool(t.bossPending, false),
      masteredDay: isDay(t.masteredDay) ? t.masteredDay : null,
      roundsOpen: int(t.roundsOpen, 0, 0, 1e9), speedWaiverCount: int(t.speedWaiverCount, 0, 0, 1e9),
      bossMedal: int(t.bossMedal, 0, 0, 3), bossWins: int(t.bossWins, 0, 0, 1e9),
    };
  }

  const c = obj(raw.collection);
  const ids = (list, kind) => [...new Set(arr(list).filter((id) => has(ITEMS_BY_ID, id) && ITEMS_BY_ID[id].kind === kind))];
  p.collection = {
    dex: {},
    blades: [...new Set(['starter_wand', ...ids(c.blades, 'blade')])],
    trails: [...new Set(['plain', ...ids(c.trails, 'trail')])],
    avatarItems: ids(c.avatarItems, 'avatar'),
    colorSets: [...new Set(['default', ...ids(c.colorSets, 'color')])],
    stickers: [...new Set(arr(c.stickers).filter((s) => /^p\d{1,2}_s\d$/.test(s)))],
    badges: Object.fromEntries(Object.entries(obj(c.badges)).filter(([k, v]) => has(BADGES_BY_ID, k) && typeof v === 'string').map(([k, v]) => [k, v.slice(0, 40)])),
    crowns: [...new Set(arr(c.crowns).map(Number).filter((T) => PATH.includes(T)))],
  };
  for (const [id, d] of Object.entries(obj(c.dex))) {
    if (!has(SPECIES_BY_ID, id)) continue; // known species only (no '__proto__')
    const o = obj(d);
    p.collection.dex[id] = { met: bool(o.met, false), pops: int(o.pops, 0, 0, 1e9), shiny: bool(o.shiny, false),
      metRound: o.metRound == null ? null : int(o.metRound, 0, 0, 1e9), stamps: arr(o.stamps).filter((s) => ['met', 'friend', 'best'].includes(s)) };
  }
  // Equipped items must be owned.
  const A = p.avatar, C = p.collection;
  if (!C.blades.includes(A.blade)) A.blade = 'starter_wand';
  if (!C.trails.includes(A.trail)) A.trail = 'plain';
  if (!C.colorSets.includes(A.colorSet)) A.colorSet = 'default';
  for (const slot of ['hat', 'face', 'back']) if (A.equipped[slot] && !C.avatarItems.includes(A.equipped[slot])) A.equipped[slot] = null;

  p.history = arr(raw.history).filter((h) => h && typeof h === 'object').slice(-TUNING.historyKeep).map((h) => ({
    round: int(h.round, 0, 0, 1e9), at: sstr(h.at, '', 40), type: ['normal', 'tutorial', 'boss', 'mixup', 'revision', 'quick_check'].includes(h.type) ? h.type : 'normal', table: h.table == null ? null : int(h.table, null, 1, 12),
    sums: int(h.sums, 0, 0, 1e4), correct: int(h.correct, 0, 0, 1e4), wrong: int(h.wrong, 0, 0, 1e4), escapes: int(h.escapes, 0, 0, 1e4),
    stars: int(h.stars, 1, 0, 4), score: int(h.score, 0, 0, 1e9), xp: int(h.xp, 0, 0, 1e7), sparks: int(h.sparks, 0, 0, 1e7),
    medianRtMs: h.medianRtMs == null ? null : int(h.medianRtMs, null, 0, 6e5), xStart: num(h.xStart, 0, -1, 5), xEnd: num(h.xEnd, 0, -1, 5),
    bestCombo: int(h.bestCombo, 0, 0, 1e4), durationMs: int(h.durationMs, 0, 0, 36e5), seed: int(h.seed, 0, 0, 2 ** 32),
    day: isDay(h.day) ? h.day : (isDay(sstr(h.at, '').slice(0, 10)) ? h.at.slice(0, 10) : null),
  }));

  const r = obj(raw.rewards);
  p.rewards = {
    real: arr(r.real).filter((x) => x && typeof x === 'object').slice(0, 50).map((x) => ({
      id: sid(x.id) || newId(), name: cleanText(x.name, TUNING.realRewardNameMax) || 'Reward',
      price: int(x.price, 100, 1, TUNING.realRewardPriceMax), createdAt: sstr(x.createdAt, '', 40),
    })),
    redemptions: arr(r.redemptions).filter((x) => x && typeof x === 'object').slice(-200).map((x) => ({
      id: sid(x.id) || newId(), rewardId: sid(x.rewardId) || '', name: cleanText(x.name, TUNING.realRewardNameMax),
      price: int(x.price, 0, 0, TUNING.realRewardPriceMax),
      status: ['pending', 'confirmed', 'declined'].includes(x.status) ? x.status : 'declined',
      requestedAt: sstr(x.requestedAt, '', 40), resolvedAt: sstr(x.resolvedAt, null, 40),
    })),
  };
  const pr = raw.pendingRound && typeof raw.pendingRound === 'object' && !Array.isArray(raw.pendingRound) ? raw.pendingRound : null;
  p.pendingRound = pr ? cleanPending(pr) : null;
  return p;
}

/** A round saved mid-play (logic/resume.js): only known fields, bounded sizes. */
function cleanPending(pr) {
  const ch = pr.choice && typeof pr.choice === 'object' && !Array.isArray(pr.choice) ? pr.choice : {};
  const choice = {};
  if (ch.table != null) choice.table = int(ch.table, 1, 1, 12);
  if (ch.boss != null) choice.boss = int(ch.boss, 1, 1, 12);
  if (ch.revision === true) choice.revision = true;
  const RES = ['correct', 'wrong', 'escaped'];
  const results = arr(pr.results).filter((r) => r && typeof r === 'object' && RES.includes(r.result)
    && r.fact && typeof r.fact === 'object').slice(0, TUNING.resumeMaxResults).map((r) => ({
    result: r.result, graded: bool(r.graded, true),
    fact: { a: int(r.fact.a, 1, 1, 12), b: int(r.fact.b, 1, 1, 12) },
    slot: r.slot == null ? null : int(r.slot, 0, 0, 999), kind: sstr(r.kind, 'focus', 16),
    special: sstr(r.special, null, 16), species: sstr(r.species, null, 32),
    shiny: bool(r.shiny, false), ghost: bool(r.ghost, false), mini: bool(r.mini, false), golden: bool(r.golden, false),
    rt_ms: r.rt_ms == null ? null : int(r.rt_ms, 0, 0, 600000), fast: bool(r.fast, false),
    given: r.given == null ? null : int(r.given, 0, -1, 99999),
  }));
  return {
    seed: int(pr.seed, 0, 0, 2 ** 32), roundIndex: int(pr.roundIndex, 0, 0, 1e9), startedAt: sstr(pr.startedAt, '', 40),
    today: sstr(pr.today, null, 10), choice, offset: Number.isFinite(pr.offset) ? num(pr.offset, 0, -10, 10) : null,
    results, score: int(pr.score, 0, 0, 1e7), bestCombo: int(pr.bestCombo, 0, 0, 1e4), fixed: int(pr.fixed, 0, 0, 1e4),
    ms: int(pr.ms, 0, 0, 36e5),
  };
}

// ---- store -----------------------------------------------------------------

/** A Map-backed Storage, for tests and when localStorage is unavailable. */
export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _map: m,
  };
}

export function createStore(storage) {
  let store = storage;
  const problems = [];
  const safe = (fn, fallback) => {
    try { return fn(); } catch (e) { problems.push(String(e?.message || e)); return fallback; }
  };
  if (!store) store = memoryStorage();

  const readJson = (key) => {
    const s = safe(() => store.getItem(key), null);
    if (s == null) return { ok: true, value: null };
    try { return { ok: true, value: JSON.parse(s), raw: s }; } catch { return { ok: false, raw: s }; }
  };
  const writeJson = (key, v) => safe(() => { store.setItem(key, JSON.stringify(v)); return true; }, false);

  function allKeys() {
    return safe(() => { const out = []; for (let i = 0; i < store.length; i++) out.push(store.key(i)); return out; }, []);
  }

  // Corrupt-save backups: `mm.corrupt.<key>.<ms>`, at most one per key and
  // BACKUP_MAX in total (oldest dropped). Same content is not copied again.
  const backupKeys = (key) => allKeys().filter((k) => k && k.startsWith(key ? `${BACKUP_PREFIX}${key}.` : BACKUP_PREFIX));
  const removeBackups = (key) => { for (const k of backupKeys(key)) safe(() => store.removeItem(k), null); };
  function backup(key, raw) {
    if (raw == null) return;
    const mine = backupKeys(key);
    if (mine.length === 1 && safe(() => store.getItem(mine[0]), null) === raw) return;
    removeBackups(key);
    safe(() => store.setItem(`${BACKUP_PREFIX}${key}.${Date.now()}`, String(raw).slice(0, BACKUP_MAX_CHARS)), null);
    const all = backupKeys(null).sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop()));
    while (all.length > BACKUP_MAX) safe(() => store.removeItem(all.shift()), null);
  }

  function loadIndex() {
    const r = readJson(INDEX_KEY);
    let idx = r.ok ? r.value : null;
    if (!r.ok) backup(INDEX_KEY, r.raw);
    if (!idx || typeof idx !== 'object' || !Array.isArray(idx.profiles)) {
      // Rebuild from the profile keys that exist.
      const profiles = [];
      for (const k of allKeys()) {
        if (!k || !k.startsWith('mm.profile.')) continue;
        const p = loadProfile(k.slice('mm.profile.'.length));
        if (p) profiles.push({ id: p.id, name: p.name, avatar: p.avatar.base });
      }
      idx = { version: 1, profiles, lastProfileId: profiles[0]?.id || null };
      if (profiles.length || !r.ok) writeJson(INDEX_KEY, idx);
    }
    idx.profiles = idx.profiles.filter((e) => e && typeof e.id === 'string').map((e) => ({
      id: e.id, name: cleanText(e.name, TUNING.profileNameMax) || 'Player', avatar: AVATARS.includes(e.avatar) ? e.avatar : AVATARS[0],
    }));
    if (!idx.profiles.some((e) => e.id === idx.lastProfileId)) idx.lastProfileId = idx.profiles[0]?.id || null;
    return idx;
  }

  function saveIndex(idx) { return writeJson(INDEX_KEY, idx); }

  function loadProfile(id) {
    const r = readJson(profileKey(id));
    if (!r.ok) {
      backup(profileKey(id), r.raw);
      return null;
    }
    const p = migrateProfile(r.value);
    if (p) p.id = id;
    else if (r.raw != null) backup(profileKey(id), r.raw); // valid JSON but not a profile (null, [], 5)
    return p;
  }

  /**
   * Load a listed profile. A corrupted save is backed up and replaced by a fresh
   * profile with the same name and avatar, so the child can keep playing.
   */
  function loadOrRecover(entry) {
    const p = loadProfile(entry.id);
    if (p) return { profile: p, recovered: false };
    const fresh = createProfile({ id: entry.id, name: entry.name, avatar: entry.avatar, age: 7 });
    writeJson(profileKey(entry.id), fresh);
    return { profile: fresh, recovered: true };
  }

  function saveProfile(p) {
    const ok = writeJson(profileKey(p.id), p);
    const idx = loadIndex();
    const e = { id: p.id, name: p.name, avatar: p.avatar.base };
    const i = idx.profiles.findIndex((x) => x.id === p.id);
    if (i >= 0) idx.profiles[i] = e; else idx.profiles.push(e);
    idx.lastProfileId = p.id;
    saveIndex(idx);
    return ok;
  }

  function deleteProfile(id) {
    safe(() => store.removeItem(profileKey(id)), null);
    removeBackups(profileKey(id)); // a backup holds the child's name and age too
    const idx = loadIndex();
    idx.profiles = idx.profiles.filter((e) => e.id !== id);
    if (idx.lastProfileId === id) idx.lastProfileId = idx.profiles[0]?.id || null;
    saveIndex(idx);
  }

  function loadDevice() {
    const r = readJson(DEVICE_KEY);
    const d = obj(r.ok ? r.value : null);
    const v = obj(d.volume);
    return {
      volume: { master: num(v.master, 0.9, 0, 1), music: num(v.music, 0.6, 0, 1), sfx: num(v.sfx, 0.9, 0, 1), voice: num(v.voice, 1, 0, 1) },
      muted: bool(d.muted, false),
      gate: { fails: int(obj(d.gate).fails, 0, 0, 10), lockUntil: int(obj(d.gate).lockUntil, 0, 0, 1e15) },
    };
  }
  const saveDevice = (d) => writeJson(DEVICE_KEY, d);

  return { loadIndex, saveIndex, loadProfile, loadOrRecover, saveProfile, deleteProfile, loadDevice, saveDevice, problems, storage: store };
}

/** localStorage if usable, otherwise memory (private mode, blocked storage). */
export function browserStorage() {
  try {
    const ls = globalThis.localStorage;
    const k = 'mm.__probe';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch {
    return memoryStorage();
  }
}
