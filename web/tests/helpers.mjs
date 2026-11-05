import { createProfile } from '../js/logic/profile.js';
import { planRound } from '../js/logic/deck.js';
import { applyRound } from '../js/logic/rewards.js';

export const NOW = new Date('2026-11-05T10:00:00');
export const newProfile = (o = {}) => createProfile({ name: 'Ann', avatar: 'blobbo', age: 8, now: NOW, ...o });

/**
 * Fake a v2 engine summary for a plan. `wrongAt(i, slot)` → true makes slot i wrong.
 * `extra`: more result entries (ungraded pops, golden, minis) appended after the deck.
 */
export function fakeSummary(plan, { wrongAt = () => false, rt = 1500, escapeAt = () => false, extra = [] } = {}) {
  const results = plan.config.deck.map((s, i) => {
    const res = wrongAt(i, s) ? 'wrong' : escapeAt(i, s) ? 'escaped' : 'correct';
    return { result: res, graded: true, rt_ms: res === 'correct' ? rt : null, fast: res === 'correct' && rt <= plan.config.target_ms,
      given: res === 'wrong' ? s.a * s.b + 1 : res === 'correct' ? s.a * s.b : null, fact: { a: s.a, b: s.b }, slot: i, kind: s.kind,
      special: s.special || null, species: s.species, shiny: !!s.shiny, ghost: !!s.ghost, golden: false, mini: false };
  });
  for (const x of extra) {
    results.push({ result: 'correct', graded: true, rt_ms: rt, fast: true, given: x.a * x.b, fact: { a: x.a, b: x.b }, slot: -1, kind: 'focus',
      special: null, species: 'bloop', shiny: false, ghost: false, golden: false, mini: false, ...x, a: undefined, b: undefined });
  }
  const c = results.filter((r) => r.result === 'correct').length;
  return { accuracy: c / results.length, median_rt_ms: rt, score: 100 * c, best_combo: c, fixed: 0, offset_end: plan.config.speed.offset,
    recent_end: 'CCC', boss_defeated: plan.type === 'boss' && c === results.length, duration_ms: 60000, results };
}

/** Play n rounds on given days. */
export function play(p, n, { day = '2026-11-05', seed = 1, ...o } = {}) {
  const reports = [];
  for (let i = 0; i < n; i++) {
    const d = typeof day === 'function' ? day(i) : day;
    const plan = planRound(p, { seed: seed + i, today: d });
    reports.push(applyRound(p, plan, fakeSummary(plan, o), { now: NOW, today: d }));
  }
  return reports;
}
