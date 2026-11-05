import test from 'node:test';
import assert from 'node:assert/strict';
import { xpNeed, xpToReach, levelForXp, levelProgress, starsFor, roundSparks, comboMult } from '../js/logic/progression.js';
import { xEff, clampOffset, decayAtRoundStart, clampTier, sumsFor } from '../js/logic/speed.js';
import { TUNING } from '../js/logic/tuning.js';
import { newProfile, play, fakeSummary, NOW } from './helpers.mjs';
import { planRound } from '../js/logic/deck.js';
import { applyRound } from '../js/logic/rewards.js';

test('XP curve: need(L) = 4(L+4)², capped at L30', () => {
  assert.equal(xpNeed(1), 100);
  assert.equal(xpNeed(2), 144);
  assert.equal(xpNeed(30), xpNeed(31));
  assert.equal(xpNeed(40), 4 * 34 * 34);
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(99), 1);
  assert.equal(levelForXp(100), 2);
  assert.equal(levelForXp(244), 3);
  assert.equal(xpToReach(3), 244);
  const lp = levelProgress(150);
  assert.deepEqual([lp.level, lp.into, lp.need], [2, 50, 144]);
});

test('first round always reaches level 2', () => {
  const p = newProfile();
  const [R] = play(p, 1, { wrongAt: (i) => i % 2 === 0, rt: 9000 });
  assert.ok(R.levelAfter >= 2);
  assert.ok(R.levelUps.some((u) => u.level === 2));
});

test('stars at 70 / 90 % accuracy, sparkle when fast too', () => {
  assert.equal(starsFor(0.5, 9999, 4000).stars, 1);
  assert.equal(starsFor(0.7, 9999, 4000).stars, 2);
  assert.equal(starsFor(0.9, 9999, 4000).stars, 3);
  assert.equal(starsFor(0.9, 9999, 4000).sparkle, false);
  const s = starsFor(0.95, 2000, 4000);
  assert.equal(s.sparkle, true);
  assert.equal(s.total, 4);
});

test('Sparks per round: 5 + 2×stars + correct/5 + 5×golden, doubled in Golden Hour', () => {
  assert.equal(roundSparks({ starsTotal: 3, correct: 14, golden: 1 }), 5 + 6 + 2 + 5);
  assert.equal(roundSparks({ starsTotal: 3, correct: 14, golden: 1, goldenHour: true }), 2 * (5 + 6 + 2 + 5));
});

test('combo multiplier grows and caps', () => {
  assert.equal(comboMult(0), 1);
  assert.ok(comboMult(10) > comboMult(3));
  assert.equal(comboMult(1000), comboMult(500));
});

test('adaptive speed: x_eff is clamped around the base tier', () => {
  assert.equal(xEff(2, 1, 0), 2);
  assert.equal(xEff(2, 1, 99), Math.min(5, 2 + TUNING.xAboveBase));
  assert.equal(xEff(2, 1, -99), Math.max(-1, 2 - TUNING.xBelowBase));
  assert.equal(xEff(0, 1, -99), Math.max(-1, 0 - TUNING.xBelowBase));
  const o = clampOffset(50, 2, 1);
  assert.ok(o < 3);
  assert.equal(clampOffset(NaN, 2, 1), 0);
  assert.equal(clampTier(9), 4);
  assert.equal(clampTier(-3), 0);
  assert.equal(clampTier('x'), 0);
});

test('between-round decay: ×0.8 same day, ×0.5 on a new day', () => {
  const sp = { offset: 1, lastRoundDay: '2026-11-05' };
  decayAtRoundStart(sp, '2026-11-05');
  assert.equal(sp.offset, 0.8);
  decayAtRoundStart(sp, '2026-11-06');
  assert.equal(sp.offset, 0.4);
});

test('engine offset_end and recent_end are saved (clamped) after a normal round', () => {
  const p = newProfile();
  play(p, 1);
  const plan = planRound(p, { seed: 3, today: '2026-11-05' });
  const s = fakeSummary(plan);
  s.offset_end = 0.4; s.recent_end = 'CCWxE';
  applyRound(p, plan, s, { now: NOW, today: '2026-11-05' });
  assert.equal(p.speed.offset, 0.4);
  assert.equal(p.speed.recent, 'CCWE');
  const plan2 = planRound(p, { seed: 4, today: '2026-11-05' });
  const s2 = fakeSummary(plan2);
  s2.offset_end = 1e9;
  applyRound(p, plan2, s2, { now: NOW, today: '2026-11-05' });
  assert.ok(xEff(p.settings.baseTier, p.progress.level, p.speed.offset) <= p.settings.baseTier + TUNING.xAboveBase);
  assert.ok(sumsFor(-1, 'little') >= TUNING.bands.little.sumsMin);
});
