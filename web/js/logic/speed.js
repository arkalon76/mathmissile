// Speed tiers and the between-round half of adaptive speed (§3.1, §3.3).
// The in-round offset updates run in the engine; the shell decays the saved
// offset into the round's start value and saves offset_end/recent_end afterwards.

import { TUNING } from './tuning.js';
import { daysBetween } from './day.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const TIER_NAMES = TUNING.tiers.filter((t) => t.x >= 0 && t.x <= 4).map((t) => t.name);

export function clampTier(t) {
  const n = Math.round(Number(t));
  return Number.isFinite(n) ? clamp(n, 0, 4) : 0;
}

export function levelDrift(level) {
  return Math.min(TUNING.levelDriftMax, TUNING.levelDriftPerLevel * (Math.max(1, level) - 1));
}

/** x_eff (§3.3). */
export function xEff(base, level, offset) {
  const lo = Math.max(-1, base - TUNING.xBelowBase);
  const hi = Math.min(5, base + TUNING.xAboveBase);
  return clamp(base + levelDrift(level) + (Number(offset) || 0), lo, hi);
}

/** Clamp a saved offset so x_eff stays inside its band (no runaway values). */
export function clampOffset(offset, base, level) {
  const o = Number(offset);
  if (!Number.isFinite(o)) return 0;
  const lo = Math.max(-1, base - TUNING.xBelowBase) - base - levelDrift(level);
  const hi = Math.min(5, base + TUNING.xAboveBase) - base - levelDrift(level);
  return clamp(o, lo - 0.5, hi + 0.5);
}

export function tierAt(x) {
  const tiers = TUNING.tiers;
  const xi = clamp(Math.round(x), -1, 5);
  return tiers.find((t) => t.x === xi);
}

/** Sums per round N at the round's starting x (§3.1, §1.7). */
export function sumsFor(x, band) {
  const tiers = TUNING.tiers;
  const xi = clamp(Math.floor(x), -1, 5);
  const n = tiers.find((t) => t.x === xi).sums;
  const b = TUNING.bands[band] || TUNING.bands.big;
  return Math.max(b.sumsMin, n + b.sumsDelta);
}

/**
 * Between-round decay at round start (§3.3): the offset a round starts from.
 * First round of a new day ×0.5, otherwise ×0.8. Pure: the profile only takes the
 * new offset in applyRound, so an aborted or reloaded round does not decay it.
 */
export function decayedOffset(speed, today) {
  const newDay = !speed.lastRoundDay || daysBetween(speed.lastRoundDay, today) > 0;
  return +((Number(speed.offset) || 0) * (newDay ? TUNING.decayNewDay : TUNING.decayRound)).toFixed(4);
}

/** Mutating form (tests and the simulator): applies the decay to `speed`. */
export function decayAtRoundStart(speed, today) {
  speed.offset = decayedOffset(speed, today);
  return speed;
}

/** Child-facing animal for a speed index. */
export function animalAt(x) {
  return tierAt(x);
}
