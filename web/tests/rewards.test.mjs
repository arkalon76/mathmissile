import test from 'node:test';
import assert from 'node:assert/strict';
import { rollChest, nextSticker, awardBadge, chestCandidates, owns } from '../js/logic/rewards.js';
import { makeRng } from '../js/logic/rng.js';
import { ITEMS } from '../js/logic/catalog.js';
import { newProfile, play } from './helpers.mjs';

test('chests never give an item twice, and fall back to sticker + Sparks when empty', () => {
  const p = newProfile();
  const rng = makeRng(1);
  const got = [];
  for (let i = 0; i < 80; i++) got.push(...rollChest(p, 'star', rng).items);
  assert.equal(new Set(got).size, got.length);
  assert.equal(chestCandidates(p).length, 0);
  const sparks = p.progress.sparks;
  const c = rollChest(p, 'star', rng);
  assert.equal(c.items.length, 0);
  assert.equal(c.stickers.length, 1);
  assert.ok(p.progress.sparks - sparks >= 30);
});

test('chest rolls are seeded', () => {
  const a = newProfile({ id: 'same' }), b = newProfile({ id: 'same' });
  assert.deepEqual(rollChest(a, 'level', makeRng(9)), rollChest(b, 'level', makeRng(9)));
});

test('stickers fill the lowest page first, first sticker is p1_s1', () => {
  const p = newProfile();
  assert.equal(nextSticker(p, makeRng(1)), 'p1_s1');
  p.collection.stickers = ['p1_s1', 'p1_s2', 'p1_s3', 'p1_s4', 'p1_s5', 'p1_s6', 'p1_s7', 'p1_s8'];
  assert.equal(nextSticker(p, makeRng(1)), 'p1_s9');
});

test('badges are awarded once with +20 XP and +10 Sparks', () => {
  const p = newProfile();
  assert.equal(awardBadge(p, 'hot_streak', '2026-11-05'), true);
  assert.equal(awardBadge(p, 'hot_streak', '2026-11-05'), false);
  assert.equal(awardBadge(p, 'no_such_badge', '2026-11-05'), false);
  assert.equal(p.progress.xp, 20);
  assert.equal(p.progress.sparks, 10);
});

test('a round report has stars, XP, Sparks, a sticker and up to 3 Next-up goals', () => {
  const p = newProfile();
  const [R1, R2] = play(p, 2);
  for (const R of [R1, R2]) {
    assert.ok(R.stars >= 1 && R.stars <= 3);
    assert.ok(R.xpGained > 0 && R.sparksGained > 0);
    assert.ok(R.cards.some((c) => c.type === 'sticker'));
    assert.ok(R.nextUp.length >= 1 && R.nextUp.length <= 3);
    for (const n of R.nextUp) assert.ok(n.have < n.need);
  }
  assert.equal(p.history.length, 2);
  assert.equal(p.progress.roundIndex, 2);
});

test('first round of a new day: +1 welcome-back star on the chest meter, no daily chest', () => {
  const p = newProfile();
  const R = play(p, 3, { day: (i) => (i < 2 ? '2026-11-05' : '2026-11-06') });
  assert.equal(R[0].welcomeStars, 0);
  assert.equal(R[1].welcomeStars, 0);
  assert.equal(R[2].welcomeStars, 1);
  for (const r of R) assert.ok(!r.chests.some((c) => c.kind === 'hello'));
});

test('chest meter: a Star chest every 6 stars, remainder carries over', () => {
  const p = newProfile();
  const R = play(p, 4);
  const stars = R.reduce((s, r) => s + r.starsTotal, 0);
  const chests = R.reduce((s, r) => s + r.chests.filter((c) => c.kind === 'star').length, 0);
  assert.equal(chests, Math.floor(stars / 6));
  assert.equal(p.progress.chestStars, stars % 6);
});

test('owned items are recognised', () => {
  const p = newProfile();
  assert.ok(owns(p, 'starter_wand'));
  assert.ok(!owns(p, ITEMS.find((i) => i.source.shop).id));
});
