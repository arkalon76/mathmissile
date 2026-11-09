import test from 'node:test';
import assert from 'node:assert/strict';
import { planRound } from '../js/logic/deck.js';
import { applyRound, rollChest, grantItem } from '../js/logic/rewards.js';
import { equip } from '../js/logic/shop.js';
import { makeRng } from '../js/logic/rng.js';
import { ITEMS, STICKERS } from '../js/logic/catalog.js';
import { openTable } from '../js/logic/tables.js';
import { TUNING } from '../js/logic/tuning.js';
import { levelForXp } from '../js/logic/progression.js';
import { newProfile, play, fakeSummary, NOW } from './helpers.mjs';

const DAY = '2026-11-05';

test('a sticker page finished by a chest sticker still pays: page card, Sparks, Sticker Star', () => {
  const p = newProfile();
  play(p, 3);
  // Own every sticker on page 1 except one; empty the chest pool so the chest gives stickers.
  const page1 = STICKERS.filter((s) => s.page === 1).map((s) => s.id);
  p.collection.stickers = page1.slice(0, -1);
  for (const it of ITEMS) grantItem(p, it.id); // nothing left for chests: each slot gives a sticker
  const R = { cards: [], flags: {}, chests: [], sparksGained: 0, sparksBreakdown: [] };
  // A chest whose item pool is empty falls back to a sticker per missing item.
  const rng = makeRng(5);
  rollChest(p, 'star', rng, R);
  assert.ok(p.collection.stickers.includes(page1[page1.length - 1]));
  assert.ok(R.flags.pageDone, 'page done flagged');
  assert.ok(R.cards.some((c) => c.type === 'page' && c.page === 1));
});

test('Golden Hour still brings new facts (events never change learning)', () => {
  const p = newProfile();
  play(p, 1);
  p.progress.roundIndex = TUNING.eventFromRound; // events start here
  p.progress.lastEvent = null;
  let seen = 0;
  for (let seed = 1; seed <= 400 && !seen; seed++) {
    const plan = planRound(p, { seed, today: DAY });
    if (plan.event === 'golden_hour' && plan.type === 'normal') { seen++; assert.ok(plan.newKeys.length > 0, 'new facts in Golden Hour'); }
  }
  assert.ok(seen, 'found a Golden Hour round');
});

test('kindness valves: a table counts as practised only with 3+ of its sums in the round', () => {
  const p = newProfile();
  play(p, 2);
  openTable(p, 7, p.progress.roundIndex);
  const before = p.tables[7].roundsOpen;
  // A ×1 round with a single 1×7 in it must not count for ×7.
  const plan = planRound(p, { seed: 3, today: DAY, choice: { table: 1 } });
  const n7 = plan.config.deck.filter((s) => s.a === 7 || s.b === 7).length;
  applyRound(p, plan, fakeSummary(plan), { now: NOW, today: DAY });
  assert.equal(p.tables[7].roundsOpen, before + (n7 >= 3 ? 1 : 0));
});

test('Dress Up badge: its XP and level ups land at once, and are reported', () => {
  const p = newProfile();
  play(p, 3);
  const hat = ITEMS.find((i) => i.kind === 'avatar');
  grantItem(p, hat.id);
  assert.ok(!p.collection.badges.dress_up);
  p.progress.xp += 100000; // pretend a lot of XP is waiting: the badge must not leave levels unapplied
  const news = {};
  equip(p, hat.id, undefined, news);
  assert.equal(news.badge, 'dress_up');
  assert.equal(p.progress.level, levelForXp(p.progress.xp));
  assert.ok(news.levelUps.length > 0);
});

test('reload mid-round: saved answers re-apply to the same planned round', async () => {
  const { beginPending, recordEvent, canResume, partialSummary } = await import('../js/logic/resume.js');
  const p = newProfile();
  play(p, 3);
  const choice = { table: 2 };
  const plan = planRound(p, { seed: 4242, today: DAY, choice, offset: p.speed.offset });
  const pr = beginPending(plan, { seed: 4242, today: DAY, choice, offset: p.speed.offset });
  // The engine reports five answers, then the page closes.
  plan.config.deck.slice(0, 5).forEach((s, i) => {
    const ev = { type: i === 1 ? 'wrong' : 'correct', fact: { a: s.a, b: s.b }, slot: i, kind: s.kind, species: s.species,
      ghost: !!s.ghost, golden: false, mini: false, shiny: false, special: null, graded: true, rt_ms: 1400, fast: true, points: 100, combo: i, given: s.a * s.b + 1 };
    recordEvent(pr, ev, 1000 * i);
  });
  recordEvent(pr, { type: 'spawn' });
  assert.equal(pr.results.length, 5);
  assert.ok(canResume(JSON.parse(JSON.stringify(pr))));
  const again = planRound(p, { seed: pr.seed, today: pr.today, choice: pr.choice, offset: pr.offset });
  assert.deepEqual(again.config, plan.config, 'same round from the saved seed');
  const totalBefore = p.progress.totalCorrect;
  const R = applyRound(p, again, partialSummary(pr), { now: NOW, today: DAY });
  assert.equal(p.progress.totalCorrect, totalBefore + 4);
  assert.equal(R.roundIndex, pr.roundIndex);
  assert.ok(!canResume({ results: pr.results.slice(0, 2) }), 'too few answers is dropped');
});
