// Where to improve: a strength score per fact and per table, used by Revision
// rounds (to pick the sums) and by the Revision screen and reward card (to
// point the child at the table that needs practice). Pure functions.
//
// Kindness (§0): this never counts wrong answers for the child. A fact's
// strength only goes up with practice; "needs practice" is the only label.

import { TABLES, tableFacts } from './facts.js';
import { tableState, isOpenState } from './tables.js';

/**
 * Strength of one fact in 0..1 (null = not met yet).
 * 70 % memory (Leitner box, 5 = full), 30 % speed (vs the child's target time).
 * A tricky fact counts a bit lower until it is fixed.
 */
export function factStrength(rec, targetMs) {
  if (!rec || !rec.introduced) return null;
  const box = Math.min(5, Math.max(0, rec.box ?? 0)) / 5;
  const rt = rec.rtEmaMs;
  const speed = rt == null || !(rt > 0) ? 0.5 : Math.min(1, targetMs / rt);
  let s = 0.7 * box + 0.3 * speed;
  if (rec.tricky) s -= 0.15;
  return Math.max(0, Math.min(1, s));
}

/** Level words for a strength (the screen shows these, never a number). */
export function strengthLevel(s) {
  if (s == null) return 'new';
  if (s >= 0.8) return 'strong';
  if (s >= 0.55) return 'good';
  return 'practice';
}

/**
 * Per-table view: { T, state, met, strength (mean over met facts, or null),
 * level, weakest: [keys, weakest first] }. Only facts already met count, so
 * opening a table never makes it look "weak".
 */
export function tableStrengths(profile) {
  const target = profile.settings.targetMs;
  return TABLES.map((T) => {
    const st = tableState(profile, T);
    const facts = tableFacts(T).map((k) => ({ k, s: factStrength(profile.facts[k], target) })).filter((f) => f.s != null);
    const strength = facts.length ? facts.reduce((a, f) => a + f.s, 0) / facts.length : null;
    const weakest = facts.filter((f) => f.s < 0.8).sort((a, b) => a.s - b.s).map((f) => f.k);
    return { T, state: st, open: isOpenState(st), met: facts.length, strength, level: strengthLevel(strength), weakest };
  });
}

/**
 * Tables to practise next, weakest first: open tables with at least 3 facts met
 * whose strength is below "strong". At most `n`.
 */
export function practiceNext(profile, n = 3) {
  return tableStrengths(profile)
    .filter((t) => t.open && t.met >= 3 && t.strength != null && t.strength < 0.8)
    .sort((a, b) => a.strength - b.strength)
    .slice(0, n);
}

/**
 * After a round: the facts from this round that need more practice (missed,
 * escaped or slow), as keys, most-needed first. Used by the reward card.
 */
export function roundWeakFacts(results, targetMs, factFromResult) {
  const score = {};
  for (const r of results || []) {
    if (r.graded === false || r.golden) continue;
    const f = factFromResult(r);
    if (!f) continue;
    const add = r.result === 'wrong' ? 3 : r.result === 'escaped' ? 2 : (r.rt_ms != null && r.rt_ms > targetMs * 1.5 ? 1 : 0);
    if (add) score[f.key] = (score[f.key] || 0) + add;
  }
  return Object.keys(score).sort((a, b) => score[b] - score[a]);
}
