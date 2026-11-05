import test from 'node:test';
import assert from 'node:assert/strict';
import { tableFacts, PATH } from '../js/logic/facts.js';
import { updateTableAfterRound, pendingBoss, applyManualTables, openTables, nextLockedAfter, currentTable } from '../js/logic/tables.js';
import { planRound } from '../js/logic/deck.js';
import { applyRound } from '../js/logic/rewards.js';
import { newProfile, fakeSummary, NOW } from './helpers.mjs';

function makeKnown(p, T, rt = 1000) {
  for (const k of tableFacts(T)) {
    p.facts[k] = { ...(p.facts[k] || {}), introduced: true, box: 3, bestBox: 3, rtEmaMs: rt, orient: { ab: true, ba: true }, tricky: false, recentRtMs: [], recent: '', confusedWith: {}, seen: 3, correct: 3, wrong: 0, escapes: 0 };
  }
}

test('path order starts 1, 2, 10, 5 and only table 1 is open at first', () => {
  assert.deepEqual(PATH.slice(0, 4), [1, 2, 10, 5]);
  const p = newProfile();
  assert.deepEqual(openTables(p), [1]);
});

test('table becomes Known when all facts are box 3+ and fast enough, then a boss is pending', () => {
  const p = newProfile();
  makeKnown(p, 1);
  const ev = updateTableAfterRound(p, 1, 5, '2026-11-05');
  assert.deepEqual(ev, [{ table: 1, event: 'known' }]);
  assert.equal(pendingBoss(p), 1);
});

test('slow but accurate: the kindness valve opens Known after 8 rounds', () => {
  const p = newProfile();
  makeKnown(p, 1, 60000);
  for (let i = 0; i < 7; i++) assert.deepEqual(updateTableAfterRound(p, 1, i, '2026-11-05'), []);
  assert.equal(updateTableAfterRound(p, 1, 8, '2026-11-05')[0].event, 'known');
});

test('beating the boss opens the next island on the path (guided)', () => {
  const p = newProfile();
  p.progress.roundIndex = 5;
  makeKnown(p, 1);
  updateTableAfterRound(p, 1, 5, '2026-11-05');
  const plan = planRound(p, { seed: 1, today: '2026-11-05' });
  assert.equal(plan.type, 'boss');
  const R = applyRound(p, plan, fakeSummary(plan), { now: NOW, today: '2026-11-05' });
  assert.equal(R.bossDefeated, true);
  assert.equal(p.tables[2].state, 'open');
  assert.equal(currentTable(p), 2);
  assert.ok(p.collection.badges.island_hero_1);
  assert.ok(R.chests.some((c) => c.kind === 'boss'));
  assert.equal(nextLockedAfter(p, 2), 10);
});

test('losing the boss keeps the next island locked', () => {
  const p = newProfile();
  p.progress.roundIndex = 5;
  makeKnown(p, 1);
  updateTableAfterRound(p, 1, 5, '2026-11-05');
  const plan = planRound(p, { seed: 1, today: '2026-11-05' });
  const s = fakeSummary(plan, { wrongAt: (i) => i === 0 });
  s.boss_defeated = false;
  applyRound(p, plan, s, { now: NOW, today: '2026-11-05' });
  assert.equal(p.tables[2].state, 'locked');
  assert.equal(pendingBoss(p), 1);
});

test('parent manual unlock opens tables without closing any', () => {
  const p = newProfile();
  applyManualTables(p, [7, 12, 99], 0);
  assert.deepEqual(openTables(p).sort((a, b) => a - b), [1, 7, 12]);
  applyManualTables(p, [], 0);
  assert.ok(openTables(p).includes(7), 'progress is never closed');
});
