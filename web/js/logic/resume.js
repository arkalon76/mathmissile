// Mid-round crash and reload safety (DESIGN §8). While a round runs, every
// answered monster is saved into profile.pendingRound. If the page reloads
// before the round ends, the next load re-plans the same round (same seed,
// choice, day and speed) and applies the answers given so far, so nothing the
// child did is lost. Pure functions; the caller saves the profile.

import { TUNING } from './tuning.js';

const KEEP = ['fact', 'slot', 'kind', 'special', 'species', 'shiny', 'ghost', 'mini', 'golden'];

/** Start tracking a round. */
export function beginPending(plan, { seed, today, choice, offset, now = new Date() }) {
  return {
    seed, roundIndex: plan.roundIndex, startedAt: now.toISOString(), today,
    choice: choice || {}, offset: Number.isFinite(offset) ? offset : null,
    results: [], score: 0, bestCombo: 0, fixed: 0, ms: 0,
  };
}

/**
 * Record one engine event into the pending round. Returns true when it changed
 * something worth saving (an answer, a fix).
 */
export function recordEvent(pending, ev, elapsedMs = 0) {
  if (!pending || !ev) return false;
  if (ev.type === 'fixed') { pending.fixed++; pending.score += ev.points | 0; return true; }
  if (ev.type !== 'correct' && ev.type !== 'wrong' && ev.type !== 'escaped') return false;
  if (pending.results.length >= TUNING.resumeMaxResults) return false;
  const r = { result: ev.type, graded: ev.graded !== false };
  for (const k of KEEP) if (ev[k] !== undefined) r[k] = ev[k];
  if (ev.type === 'correct') {
    r.rt_ms = ev.rt_ms ?? null;
    r.fast = !!ev.fast;
    pending.score += ev.points | 0;
    pending.bestCombo = Math.max(pending.bestCombo, ev.combo | 0);
  } else {
    r.rt_ms = null;
    r.fast = false;
  }
  r.given = ev.type === 'wrong' ? ev.given : null;
  pending.results.push(r);
  pending.ms = Math.max(pending.ms, elapsedMs | 0);
  return true;
}

/** True when a saved round has enough answers to be worth applying. */
export function canResume(pending) {
  if (!pending || !Array.isArray(pending.results)) return false;
  return pending.results.filter((r) => r.graded && !r.golden).length >= TUNING.resumeMinAnswers;
}

/**
 * Engine-shaped summary for the answers saved so far. Accuracy and the median
 * come from the results (applyRound works them out); the speed is left as it
 * was, because a cut-short round says little about pace.
 */
export function partialSummary(pending) {
  return {
    aborted: false, partial: true,
    accuracy: null, median_rt_ms: null,
    score: pending.score | 0, best_combo: pending.bestCombo | 0, fixed: pending.fixed | 0,
    offset_end: null, recent_end: null, boss_defeated: false,
    duration_ms: pending.ms | 0,
    results: pending.results,
  };
}
