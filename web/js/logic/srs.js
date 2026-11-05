// Spaced repetition per fact (§1.4, §2.2, §2.3, §2.7).

import { TUNING } from './tuning.js';
import { blankFact, isSquare, formOf } from './facts.js';
import { daysBetween } from './day.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function getFact(profile, key) {
  return profile.facts[key] || null;
}

/** The saved record, created on demand. */
export function ensureFact(profile, key) {
  if (!profile.facts[key]) profile.facts[key] = blankFact();
  return profile.facts[key];
}

export function roundsSince(rec, roundIndex) {
  if (!rec || rec.lastSeenRound == null) return Infinity;
  return roundIndex - rec.lastSeenRound;
}

export function isDue(rec, roundIndex, today) {
  const box = rec ? rec.box : 0;
  const rs = roundsSince(rec, roundIndex);
  const ds = rec && rec.lastSeenDay ? daysBetween(rec.lastSeenDay, today) : Infinity;
  return rs >= TUNING.R[box] && ds >= TUNING.D[box];
}

/** Sampling weight w(f) (§2.3). `roundIndex` is the index of the round being built. */
export function factWeight(rec, roundIndex, today) {
  const box = rec ? rec.box : 0;
  const R = TUNING.R[box];
  const rs = roundsSince(rec, roundIndex);
  const due = isDue(rec, roundIndex, today);
  const overdue = (Math.min(rs, 1e6) - R) / Math.max(1, R);
  const dueMul = due ? clamp(1 + overdue, 1, TUNING.dueMulMax) : TUNING.notDueMul;
  const trickMul = rec && rec.tricky ? TUNING.trickyMul : 1;
  const recentMul = rec && rs === 1 && !rec.tricky ? TUNING.recentMul : 1;
  return TUNING.B[box] * dueMul * trickMul * recentMul;
}

/** RT for a correct slice (§2.7). Times in ms on one clock. */
export function responseTime({ spawnAt, hitAt, lastCorrectAt = -Infinity, bladeReadyAt = -Infinity, flightMs = Infinity }) {
  const tStart = Math.max(spawnAt + TUNING.rtEntryMs, lastCorrectAt, bladeReadyAt);
  return Math.round(clamp(hitAt - tStart, TUNING.rtMinMs, flightMs));
}

/**
 * Apply one first-try resolution to a fact record (mutates `rec`).
 * ev: { result: 'correct'|'wrong'|'escape', rtMs, fast, given, a, b, ghost }
 * ctx: { roundIndex, today, boxUpThisRound: Set }
 * Returns { boxUp, fixed, firstCorrect }.
 */
export function applyResolution(rec, key, ev, ctx) {
  const out = { boxUp: false, fixed: false, firstCorrect: false };
  const { roundIndex, today, boxUpThisRound } = ctx;
  rec.seen += 1;
  rec.lastSeenRound = roundIndex;
  rec.lastSeenDay = today;
  if (!rec.introduced) {
    rec.introduced = true;
    rec.introducedRound = roundIndex;
  }
  const letter = ev.result === 'correct' ? 'C' : ev.result === 'wrong' ? 'W' : 'E';
  rec.recent = (rec.recent + letter).slice(-TUNING.recentKeep);

  if (ev.result === 'correct') {
    const wasFirst = rec.correct === 0 && !ev.ghost;
    if (!ev.ghost) rec.correct += 1;
    out.firstCorrect = wasFirst;
    const form = formOf(ev.a, ev.b);
    if (form === 'both' || isSquare(key)) { rec.orient.ab = true; rec.orient.ba = true; }
    else rec.orient[form] = true;
    if (!ev.ghost && ev.rtMs != null) {
      rec.rtEmaMs = rec.rtEmaMs == null ? ev.rtMs : Math.round(TUNING.rtEmaOld * rec.rtEmaMs + (1 - TUNING.rtEmaOld) * ev.rtMs);
      rec.recentRtMs = [...rec.recentRtMs, ev.rtMs].slice(-TUNING.recentRtKeep);
    }
    if (rec.tricky) {
      rec.trickyNeed = Math.max(0, rec.trickyNeed - 1);
      if (rec.trickyNeed === 0) { rec.tricky = false; out.fixed = true; }
    }
    if (!ev.ghost && !boxUpThisRound.has(key)) {
      const next = nextBox(rec, !!ev.fast, today);
      if (next > rec.box) {
        rec.box = next;
        rec.lastBoxUpRound = roundIndex;
        boxUpThisRound.add(key);
        out.boxUp = true;
        if (next === 3) rec.dayReachedBox3 = today;
        if (next === 4) rec.dayReachedBox4 = today;
        if (next === 5) rec.dayReachedBox5 = today;
        rec.bestBox = Math.max(rec.bestBox || 0, rec.box);
      }
    }
  } else if (ev.result === 'wrong') {
    rec.wrong += 1;
    rec.box = Math.max(0, rec.box - (rec.box >= 3 ? TUNING.wrongDropHigh : TUNING.wrongDrop));
    rec.tricky = true;
    rec.trickyNeed = TUNING.trickyNeed;
    rec.lastWrongRound = roundIndex;
    if (ev.given != null && Number.isFinite(ev.given)) {
      const g = String(ev.given);
      rec.confusedWith[g] = (rec.confusedWith[g] || 0) + 1;
    }
  } else {
    rec.escapes += 1;
  }
  return out;
}

/** Box a correct answer would move to (§1.4 limits), without the once-per-round rule. */
export function nextBox(rec, fast, today) {
  const box = rec.box;
  if (!fast) return box < 3 ? Math.min(box + 1, 3) : box;
  if (box < 3) return box + 1;
  if (box === 3) return daysBetween(rec.dayReachedBox3, today) > 0 ? 4 : 3;
  if (box === 4) {
    const both = rec.orient.ab && rec.orient.ba;
    return both && daysBetween(rec.dayReachedBox4, today) > 0 ? 5 : 4;
  }
  return 5;
}
