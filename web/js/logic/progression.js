// Points, stars, Sparks, XP and the level curve (§4).

import { TUNING } from './tuning.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** XP needed to go from level L to L+1 (§4.5). */
export function xpNeed(L) {
  const l = Math.min(L, 30);
  return 4 * (l + 4) ** 2;
}

/** Total XP to reach level L from 0. */
export function xpToReach(L) {
  let t = 0;
  for (let l = 1; l < L; l++) t += xpNeed(l);
  return t;
}

/** Level for a cumulative XP total (1..99). */
export function levelForXp(xp) {
  let L = 1, t = 0;
  while (L < TUNING.maxLevel && t + xpNeed(L) <= xp) { t += xpNeed(L); L++; }
  return L;
}

/** {level, into, need, frac} for an XP total. */
export function levelProgress(xp) {
  const level = levelForXp(xp);
  const into = xp - xpToReach(level);
  const need = level >= TUNING.maxLevel ? 1 : xpNeed(level);
  return { level, into, need, frac: level >= TUNING.maxLevel ? 1 : clamp(into / need, 0, 1) };
}

export function comboMult(combo) {
  let m = 1;
  for (const [min, mult] of TUNING.comboSteps) if (combo >= min) m = mult;
  return m;
}

export function comboName(combo) {
  let n = '';
  for (const [min, , name] of TUNING.comboSteps) if (combo >= min) n = name;
  return n;
}

/** Points for a correct first-try sum (§4.1). */
export function points({ combo, rtMs, targetMs, base = TUNING.pointsBase }) {
  const t15 = 1.5 * targetMs;
  const speedBonus = Math.round(TUNING.pointsSpeedBonus * clamp((t15 - rtMs) / t15, 0, 1));
  return base * comboMult(combo) + speedBonus;
}

/** Stars 1..3 plus sparkle (§4.2). */
export function starsFor(accuracy, medianRtMs, targetMs) {
  const acc = Number.isFinite(accuracy) ? accuracy : 0;
  let stars = 1;
  if (acc >= TUNING.star2Acc) stars = 2;
  if (acc >= TUNING.star3Acc) stars = 3;
  const sparkle = stars === 3 && medianRtMs != null && medianRtMs <= targetMs;
  return { stars, sparkle, total: stars + (sparkle ? 1 : 0) };
}

/** Sparks for a round (§4.3). */
export function roundSparks({ starsTotal, correct, golden = 0, goldenHour = false }) {
  const s = TUNING.sparksBase + TUNING.sparksPerStar * starsTotal + Math.floor(correct / 5) * TUNING.sparksPerFiveCorrect + TUNING.sparksPerGolden * golden;
  return goldenHour ? s * 2 : s;
}

/** Accuracy over first-try graded resolutions. */
export function accuracyOf(results) {
  let c = 0, n = 0;
  for (const r of results) {
    if (!r.graded) continue;
    if (r.golden || r.mini) { if (r.result === 'correct') { c++; n++; } continue; }
    n++;
    if (r.result === 'correct') c++;
  }
  return n ? c / n : 0;
}
