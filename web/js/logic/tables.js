// Table states, unlocking and the current island (§1.5).

import { TUNING } from './tuning.js';
import { PATH, tableFacts, pathIndex } from './facts.js';

export function blankTable() {
  return { state: 'locked', openedRound: null, knownRound: null, bossBeaten: false, bossPending: false,
    masteredDay: null, roundsOpen: 0, speedWaiverCount: 0, bossMedal: 0, bossWins: 0 };
}

export function tableRec(profile, T) {
  if (!profile.tables[T]) profile.tables[T] = blankTable();
  return profile.tables[T];
}

export const isOpenState = (s) => s === 'open' || s === 'known' || s === 'mastered';
export const isKnownState = (s) => s === 'known' || s === 'mastered';

export function tableState(profile, T) {
  return profile.tables[T]?.state || 'locked';
}

/** Tables open for play, respecting the parent override. */
export function openTables(profile) {
  return PATH.filter((T) => isOpenState(tableState(profile, T)));
}

export function knownTables(profile) {
  return PATH.filter((T) => isKnownState(tableState(profile, T)));
}

/** A fact is playable when any of its tables is open. */
export function factIsOpen(profile, key) {
  const [a, b] = key.split('x').map(Number);
  return isOpenState(tableState(profile, a)) || isOpenState(tableState(profile, b));
}

/** Current island: the earliest open-not-known table in path order, or null. */
export function currentTable(profile) {
  for (const T of PATH) if (tableState(profile, T) === 'open') return T;
  return null;
}

export function median(xs) {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Condition checks for Known (§1.5). */
export function knownChecks(profile, T) {
  const recs = tableFacts(T).map((k) => profile.facts[k]);
  const tr = profile.tables[T];
  const introduced = recs.every((r) => r && r.introduced);
  const n3 = recs.filter((r) => r && r.box >= 3).length;
  const floorOk = recs.every((r) => r && r.box >= TUNING.knownFloorBox);
  const strict = introduced && floorOk && n3 >= TUNING.knownMinBox3;
  // Accuracy kindness valve: a table open for N rounds needs fewer box-3 facts.
  const valve = introduced && (tr?.roundsOpen ?? 0) >= TUNING.accuracyValveRounds && n3 >= TUNING.accuracyValveBox3;
  const boxesOk = strict || valve;
  const rts = recs.map((r) => r?.rtEmaMs ?? null);
  const med = rts.some((x) => x == null) ? null : median(rts);
  const fastEnough = med != null && med <= TUNING.knownSpeedFactor * profile.settings.targetMs;
  return { boxesOk, strict, valve, box3Count: n3, fastEnough, medianRt: med };
}

export function allMastered(profile, T) {
  return tableFacts(T).every((k) => (profile.facts[k]?.box ?? 0) >= 5);
}

/**
 * After a round that included table T: update Known/Mastered state.
 * Returns list of events: {table, event: 'known'|'mastered'}.
 */
export function updateTableAfterRound(profile, T, roundIndex, today, includedThisRound = true) {
  const rec = tableRec(profile, T);
  const events = [];
  if (!isOpenState(rec.state)) return events;
  if (includedThisRound) rec.roundsOpen += 1;
  if (rec.state === 'open') {
    const c = knownChecks(profile, T);
    if (c.boxesOk && !c.fastEnough && includedThisRound) rec.speedWaiverCount += 1;
    if (c.boxesOk && (c.fastEnough || rec.speedWaiverCount >= TUNING.kindnessValveRounds)) {
      rec.state = 'known';
      rec.knownRound = roundIndex;
      if (!rec.bossBeaten) rec.bossPending = true;
      events.push({ table: T, event: 'known' });
    }
  }
  if (rec.state === 'known' && allMastered(profile, T)) {
    rec.state = 'mastered';
    rec.masteredDay = today;
    events.push({ table: T, event: 'mastered' });
  }
  return events;
}

export function openTable(profile, T, roundIndex) {
  const rec = tableRec(profile, T);
  if (rec.state === 'locked') {
    rec.state = 'open';
    rec.openedRound = roundIndex;
    return true;
  }
  return false;
}

/** Next island in path order after T that is still locked (guided mode). */
export function nextLockedAfter(profile, T) {
  for (let i = pathIndex(T) + 1; i < PATH.length; i++) {
    if (tableState(profile, PATH[i]) === 'locked') return PATH[i];
  }
  return null;
}

/** Parent override: open exactly the ticked tables (never closes a table with progress). */
export function applyManualTables(profile, tables, roundIndex) {
  const set = new Set(tables.filter((T) => PATH.includes(T)));
  profile.settings.manualTables = [...set].sort((a, b) => pathIndex(a) - pathIndex(b));
  for (const T of set) openTable(profile, T, roundIndex);
  return profile.settings.manualTables;
}

/** Pending boss: earliest known table whose boss has not been beaten and is pending. */
export function pendingBoss(profile) {
  for (const T of PATH) {
    const r = profile.tables[T];
    if (r && isKnownState(r.state) && r.bossPending && !r.bossBeaten) return T;
  }
  return null;
}
