import test from 'node:test';
import assert from 'node:assert/strict';
import { buyItem, availableSparks, addRealReward, editRealReward, removeRealReward, requestRedemption, confirmRedemption,
  declineRedemption, priceHelper, equip, setWish } from '../js/logic/shop.js';
import { shopItems } from '../js/logic/catalog.js';
import { owns } from '../js/logic/rewards.js';
import { TUNING } from '../js/logic/tuning.js';
import { newProfile, play } from './helpers.mjs';

const cheapest = () => shopItems().sort((a, b) => a.source.shop - b.source.shop)[0];

test('buying spends Sparks once and refuses when short or owned', () => {
  const p = newProfile();
  const it = cheapest();
  assert.equal(buyItem(p, it.id).reason, 'sparks');
  p.progress.sparks = it.source.shop + 5;
  setWish(p, it.id);
  assert.equal(buyItem(p, it.id).ok, true);
  assert.equal(p.progress.sparks, 5);
  assert.ok(owns(p, it.id));
  assert.equal(p.progress.wish, null);
  assert.equal(buyItem(p, it.id).reason, 'owned');
  assert.equal(buyItem(p, 'starter_wand').reason, 'not_for_sale');
});

test('equip only owned items; avatar items give Dress Up', () => {
  const p = newProfile();
  const hat = shopItems().find((i) => i.kind === 'avatar');
  assert.equal(equip(p, hat.id), false);
  p.progress.sparks = 1e5;
  buyItem(p, hat.id);
  assert.equal(equip(p, hat.id), true);
  assert.equal(p.avatar.equipped[hat.slot], hat.id);
  assert.ok(p.collection.badges.dress_up);
  equip(p, null, hat.slot);
  assert.equal(p.avatar.equipped[hat.slot], null);
});

test('real-life rewards: text is cleaned and the price clamped', () => {
  const p = newProfile();
  const r = addRealReward(p, { name: '  <b>Snickers</b>‮ bar ', price: '300.4' });
  assert.equal(r.name, '<b>Snickers</b> bar');
  assert.equal(r.price, 300);
  assert.equal(addRealReward(p, { name: '', price: 5 }), null);
  assert.equal(addRealReward(p, { name: 'x', price: 'abc' }), null);
  assert.equal(addRealReward(p, { name: 'Big', price: 1e12 }).price, TUNING.realRewardPriceMax);
  assert.equal(addRealReward(p, { name: 'Neg', price: -4 }).price, 1);
  assert.equal(addRealReward(p, { name: 'y'.repeat(200), price: 1 }).name.length, TUNING.realRewardNameMax);
  editRealReward(p, r.id, { price: 250 });
  assert.equal(p.rewards.real[0].price, 250);
});

test('redemption needs a parent: asking reserves Sparks, only confirm spends them', () => {
  const p = newProfile();
  const r = addRealReward(p, { name: 'Park trip', price: 100 });
  p.progress.sparks = 90;
  assert.equal(requestRedemption(p, r.id).reason, 'sparks');
  p.progress.sparks = 150;
  const q = requestRedemption(p, r.id);
  assert.equal(q.ok, true);
  assert.equal(p.progress.sparks, 150, 'not spent yet');
  assert.equal(availableSparks(p), 50, 'but reserved');
  assert.equal(requestRedemption(p, r.id).reason, 'pending');
  assert.equal(confirmRedemption(p, q.request.id).ok, true);
  assert.equal(p.progress.sparks, 50);
  assert.equal(p.rewards.redemptions[0].status, 'confirmed');
  assert.equal(confirmRedemption(p, q.request.id).ok, false, 'cannot confirm twice');
});

test('declining or removing a reward frees the reserved Sparks', () => {
  const p = newProfile();
  p.progress.sparks = 500;
  const r = addRealReward(p, { name: 'Ice cream', price: 200 });
  const q = requestRedemption(p, r.id);
  declineRedemption(p, q.request.id);
  assert.equal(availableSparks(p), 500);
  const q2 = requestRedemption(p, r.id);
  assert.equal(availableSparks(p), 300);
  removeRealReward(p, r.id);
  assert.equal(availableSparks(p), 500);
  assert.equal(p.rewards.redemptions.find((x) => x.id === q2.request.id).status, 'declined');
});

test('reserved Sparks cannot be spent in the Workshop', () => {
  const p = newProfile();
  const it = cheapest();
  p.progress.sparks = it.source.shop;
  const r = addRealReward(p, { name: 'Sticker book', price: 1 });
  requestRedemption(p, r.id);
  assert.equal(buyItem(p, it.id).reason, 'sparks');
});

test('price helper: design defaults for a new child', () => {
  const p = newProfile();
  const h = priceHelper(p, 300);
  assert.equal(h.usedDefaults, true);
  assert.equal(h.sparksPerRound, TUNING.defaultSparksPerRound);
  assert.equal(h.rounds, Math.ceil(300 / TUNING.defaultSparksPerRound));
  assert.equal(h.days, Math.ceil(h.rounds / TUNING.defaultRoundsPerDay));
});

test('price helper: uses the child\'s recent Sparks per round and rounds per day', () => {
  const p = newProfile();
  p.history = [];
  for (let i = 0; i < 12; i++) p.history.push({ round: i + 1, day: i < 6 ? '2026-11-01' : '2026-11-02', sparks: i < 2 ? 1000 : 20 });
  const h = priceHelper(p, 300);
  assert.equal(h.usedDefaults, false);
  assert.equal(h.sparksPerRound, 20, 'last 10 rounds only');
  assert.equal(h.roundsPerDay, 6);
  assert.equal(h.rounds, 15);
  assert.equal(h.days, 3);
  assert.equal(priceHelper(p, 0).rounds, 0);
});

test('price helper after real play stays sane', () => {
  const p = newProfile();
  play(p, 5);
  const h = priceHelper(p, 300);
  assert.ok(h.sparksPerRound > 0 && h.rounds > 0 && h.days >= 1);
});
