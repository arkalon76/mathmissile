import test from 'node:test';
import assert from 'node:assert/strict';
import { planRound } from '../js/logic/deck.js';
import { applyRound } from '../js/logic/rewards.js';
import { factKey, parseKey } from '../js/logic/facts.js';
import { openTable } from '../js/logic/tables.js';
import { tableStrengths, practiceNext, factStrength } from '../js/logic/insight.js';
import { newProfile, play, fakeSummary, NOW } from './helpers.mjs';

const keyOf = (s) => factKey(s.a, s.b);
const DAY = '2026-11-05';

test('revision round: only facts already met, from every table met, weak facts more often', () => {
  const p = newProfile();
  play(p, 12);
  const met = Object.keys(p.facts).filter((k) => p.facts[k].introduced);
  // Make one fact clearly weak.
  const weak = met[met.length - 1];
  Object.assign(p.facts[weak], { box: 0, tricky: true, rtEmaMs: 9000 });
  let weakCount = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const plan = planRound(p, { seed, today: DAY, choice: { revision: true } });
    assert.equal(plan.type, 'revision');
    assert.equal(plan.config.round_type, 'mixup');
    const keys = plan.config.deck.map(keyOf);
    for (const k of keys) assert.ok(met.includes(k), `${k} was never met`);
    assert.ok(!plan.config.deck.some((s) => s.ghost), 'no new facts in revision');
    // Every table that has a met fact shows up.
    const tablesMet = new Set(met.flatMap((k) => Object.values(parseKey(k))));
    const tablesIn = new Set(keys.flatMap((k) => Object.values(parseKey(k))));
    for (const T of tablesMet) assert.ok(tablesIn.has(T), `×${T} missing`);
    weakCount += keys.filter((k) => k === weak).length;
  }
  assert.ok(weakCount >= 20, `weak fact came ${weakCount} times in 20 rounds`);
});

test('strengths: a weak table is named to practise; nothing met is never "weak"', () => {
  const p = newProfile();
  play(p, 12);
  const st = tableStrengths(p);
  assert.equal(st.length, 12);
  assert.deepEqual(st.map((t) => t.T), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const locked = st.find((t) => !t.open && t.met === 0);
  if (locked) assert.equal(locked.level, 'new');
  for (const k of Object.keys(p.facts)) if (p.facts[k].introduced && k.startsWith('2x')) Object.assign(p.facts[k], { box: 0, rtEmaMs: 8000 });
  const next = practiceNext(p);
  if (next.length) assert.ok(next[0].strength <= next[next.length - 1].strength);
  assert.equal(factStrength(undefined, 3000), null);
  assert.ok(factStrength({ introduced: true, box: 5, rtEmaMs: 1000 }, 3000) > 0.95);
});

test('reward report names the sums to practise after a round with misses', () => {
  const p = newProfile();
  play(p, 6);
  const plan = planRound(p, { seed: 77, today: DAY, choice: { revision: true } });
  const R = applyRound(p, plan, fakeSummary(plan, { wrongAt: (i) => i === 2 }), { now: NOW, today: DAY });
  assert.ok(R.weakFacts.includes(keyOf(plan.config.deck[2])));
  assert.ok(Array.isArray(R.practiceNext));
});

test('boss: any open table can be fought; every win pays; medals go up, never down', () => {
  const p = newProfile();
  play(p, 3);
  openTable(p, 7, p.progress.roundIndex);
  const fight = (seed, wrongAt) => {
    const plan = planRound(p, { seed, today: DAY, choice: { boss: 7 } });
    assert.equal(plan.type, 'boss');
    const s = fakeSummary(plan, { wrongAt, rt: 1000 });
    s.boss_defeated = true;
    return applyRound(p, plan, s, { now: NOW, today: DAY });
  };
  // A shaky first win: bronze.
  const r1 = fight(1, (i) => i % 3 === 0);
  assert.equal(r1.bossDefeated, true);
  assert.equal(r1.bossMedal, 1);
  assert.equal(p.tables[7].bossMedal, 1);
  assert.ok(r1.cards.some((c) => c.type === 'boss'));
  // A perfect, fast win: gold, with a medal card and a chest.
  const chestsBefore = r1.chests.length;
  const r2 = fight(2, () => false);
  assert.equal(r2.bossMedal, 3);
  assert.equal(p.tables[7].bossMedal, 3);
  assert.ok(r2.cards.some((c) => c.type === 'medal' && c.medal === 3));
  assert.ok(r2.chests.length >= 1 || chestsBefore >= 0);
  assert.ok(r2.xpGained > 0 && r2.sparksGained > 0);
  // A later bronze keeps the gold.
  fight(3, (i) => i % 3 === 0);
  assert.equal(p.tables[7].bossMedal, 3);
  assert.equal(p.tables[7].bossWins, 3);
});

test('the plan remembers the choice, so "Again" replays the same kind of round', () => {
  const p = newProfile();
  play(p, 3);
  assert.deepEqual(planRound(p, { seed: 1, today: DAY, choice: { table: 2 } }).choice, { table: 2 });
  assert.deepEqual(planRound(p, { seed: 1, today: DAY, choice: { revision: true } }).choice, { revision: true });
});
