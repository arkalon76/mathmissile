// Workshop (Sparks cosmetics), equipping, real-life rewards with parent-confirmed
// redemptions, and the parent price helper. Pure; mutates the given profile.

import { TUNING } from './tuning.js';
import { ITEMS_BY_ID, COLOR_SETS } from './catalog.js';
import { owns, grantItem, awardBadge, applyLevelUps } from './rewards.js';
import { makeRng, hashSeed } from './rng.js';
import { cleanText, newId } from './profile.js';
import { dayOf } from './day.js';

const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

/** Sparks held back by pending real-life requests. */
export function reservedSparks(profile) {
  return profile.rewards.redemptions.filter((r) => r.status === 'pending').reduce((s, r) => s + r.price, 0);
}

/** Sparks the child can spend now. */
export function availableSparks(profile) {
  return Math.max(0, profile.progress.sparks - reservedSparks(profile));
}

/** Buy a Workshop item. Returns {ok, reason?}. */
export function buyItem(profile, id) {
  const it = ITEMS_BY_ID[id];
  if (!it || !it.source.shop) return { ok: false, reason: 'not_for_sale' };
  if (owns(profile, id)) return { ok: false, reason: 'owned' };
  const price = it.source.shop;
  if (availableSparks(profile) < price) return { ok: false, reason: 'sparks' };
  profile.progress.sparks -= price;
  grantItem(profile, id);
  profile.progress.purchases += 1;
  if (profile.progress.wish === id) profile.progress.wish = null;
  return { ok: true, price };
}

/** Mark (or clear with null) the item the child is saving for. */
export function setWish(profile, id) {
  if (id == null) { profile.progress.wish = null; return true; }
  const it = ITEMS_BY_ID[id];
  if (!it || !it.source.shop || owns(profile, id)) return false;
  profile.progress.wish = id;
  return true;
}

/**
 * Equip an owned item (or null to take off an avatar slot). Gives Dress Up once.
 * The badge's XP is applied at once (level ups too), and reported in `news`
 * ({ badge, levelUps }) so the Workshop can show it, not the next reward screen.
 */
export function equip(profile, id, slot, news = {}) {
  const A = profile.avatar;
  if (id == null) {
    if (['hat', 'face', 'back'].includes(slot)) { A.equipped[slot] = null; return true; }
    return false;
  }
  const it = ITEMS_BY_ID[id];
  if (!it || !owns(profile, id)) return false;
  if (it.kind === 'blade') A.blade = id;
  else if (it.kind === 'trail') A.trail = id;
  else if (it.kind === 'color') A.colorSet = id;
  else if (it.kind === 'avatar') A.equipped[it.slot] = id;
  else return false;
  if (it.kind === 'avatar' && awardBadge(profile, 'dress_up', dayOf(new Date()), null)) {
    news.badge = 'dress_up';
    const rng = makeRng(hashSeed(profile.id, 'dress_up'));
    news.levelUps = applyLevelUps(profile, profile.progress.level, rng, null);
  }
  return true;
}

// ---- real-life rewards (parent area) --------------------------------------------

function cleanReward({ name, price }) {
  const n = cleanText(name, TUNING.realRewardNameMax);
  const p = clampInt(price, 1, TUNING.realRewardPriceMax);
  if (!n || p == null) return null;
  return { name: n, price: p };
}

export function addRealReward(profile, { name, price }, now = new Date()) {
  const c = cleanReward({ name, price });
  if (!c || profile.rewards.real.length >= TUNING.realRewardsMax) return null;
  const r = { id: newId(), ...c, createdAt: now.toISOString() };
  profile.rewards.real.push(r);
  return r;
}

export function editRealReward(profile, id, { name, price }) {
  const r = profile.rewards.real.find((x) => x.id === id);
  const c = r && cleanReward({ name: name ?? r.name, price: price ?? r.price });
  if (!c) return null;
  Object.assign(r, c);
  return r;
}

/** Remove a reward from the list. Pending requests for it are declined (Sparks freed). */
export function removeRealReward(profile, id, now = new Date()) {
  const i = profile.rewards.real.findIndex((x) => x.id === id);
  if (i < 0) return false;
  profile.rewards.real.splice(i, 1);
  for (const q of profile.rewards.redemptions) {
    if (q.rewardId === id && q.status === 'pending') { q.status = 'declined'; q.resolvedAt = now.toISOString(); }
  }
  return true;
}

/** Child taps "Ask for it". Sparks are reserved, not spent. */
export function requestRedemption(profile, rewardId, now = new Date()) {
  const r = profile.rewards.real.find((x) => x.id === rewardId);
  if (!r) return { ok: false, reason: 'missing' };
  if (profile.rewards.redemptions.some((q) => q.rewardId === rewardId && q.status === 'pending')) return { ok: false, reason: 'pending' };
  if (availableSparks(profile) < r.price) return { ok: false, reason: 'sparks' };
  const q = { id: newId(), rewardId, name: r.name, price: r.price, status: 'pending', requestedAt: now.toISOString(), resolvedAt: null };
  profile.rewards.redemptions.push(q);
  return { ok: true, request: q };
}

export const pendingRedemptions = (profile) => profile.rewards.redemptions.filter((q) => q.status === 'pending');

/** Parent confirms (behind the gate): now the Sparks are spent. */
export function confirmRedemption(profile, requestId, now = new Date()) {
  const q = profile.rewards.redemptions.find((x) => x.id === requestId && x.status === 'pending');
  if (!q) return { ok: false, reason: 'missing' };
  if (profile.progress.sparks < q.price) return { ok: false, reason: 'sparks' };
  profile.progress.sparks -= q.price;
  q.status = 'confirmed';
  q.resolvedAt = now.toISOString();
  return { ok: true };
}

export function declineRedemption(profile, requestId, now = new Date()) {
  const q = profile.rewards.redemptions.find((x) => x.id === requestId && x.status === 'pending');
  if (!q) return { ok: false, reason: 'missing' };
  q.status = 'declined';
  q.resolvedAt = now.toISOString();
  return { ok: true };
}

/**
 * How long a price takes to earn at this child's pace: average Sparks per round
 * over the last N rounds and rounds per play day; design defaults for a new child.
 */
export function priceHelper(profile, price) {
  const p = clampInt(price, 0, TUNING.realRewardPriceMax) ?? 0;
  const recent = profile.history.slice(-TUNING.priceHelperRounds);
  let usedDefaults = false;
  let sparksPerRound;
  if (recent.length >= 3) sparksPerRound = recent.reduce((s, h) => s + h.sparks, 0) / recent.length;
  else { sparksPerRound = TUNING.defaultSparksPerRound; usedDefaults = true; }
  const days = new Map();
  for (const h of profile.history) if (h.day) days.set(h.day, (days.get(h.day) || 0) + 1);
  let roundsPerDay;
  if (days.size >= 2) roundsPerDay = [...days.values()].reduce((a, b) => a + b, 0) / days.size;
  else { roundsPerDay = TUNING.defaultRoundsPerDay; usedDefaults = true; }
  sparksPerRound = Math.max(1, sparksPerRound);
  roundsPerDay = Math.max(1, roundsPerDay);
  const rounds = Math.ceil(p / sparksPerRound);
  const playDays = Math.max(rounds ? 1 : 0, Math.ceil(rounds / roundsPerDay));
  return { price: p, sparksPerRound: Math.round(sparksPerRound * 10) / 10, roundsPerDay: Math.round(roundsPerDay * 10) / 10, rounds, days: playDays, usedDefaults };
}

export { COLOR_SETS };
