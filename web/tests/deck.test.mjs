import test from 'node:test';
import assert from 'node:assert/strict';
import { planRound } from '../js/logic/deck.js';
import { parseKey, factKey, tableFacts, ALL_FACT_KEYS, formOf } from '../js/logic/facts.js';
import { openTable } from '../js/logic/tables.js';
import { newProfile, play } from './helpers.mjs';

const keyOf = (s) => factKey(s.a, s.b);

test('78 facts, keyed small-first, commutative pairs share one key', () => {
  assert.equal(ALL_FACT_KEYS.length, 78);
  assert.equal(factKey(7, 3), '3x7');
  assert.equal(factKey(3, 7), '3x7');
  assert.deepEqual(parseKey('3x7'), { a: 3, b: 7 });
  assert.equal(formOf(3, 7), 'ab');
  assert.equal(formOf(7, 3), 'ba');
  assert.equal(formOf(4, 4), 'both');
  // A table's 12 facts include the shared ones: 2×1 is the same fact as 1×2.
  assert.ok(tableFacts(2).includes('1x2'));
  assert.equal(new Set(tableFacts(7)).size, 12);
});

test('first round is the tutorial: 1×1..1×5 ghosted then repeated', () => {
  const p = newProfile();
  const plan = planRound(p, { seed: 1, today: '2026-11-05' });
  assert.equal(plan.type, 'tutorial');
  assert.equal(plan.config.deck.length, 10);
  const ghosts = plan.config.deck.filter((s) => s.ghost).map(keyOf);
  assert.deepEqual(ghosts.sort(), ['1x1', '1x10', '1x2', '1x3', '1x5'].sort());
  for (const k of ghosts) assert.equal(plan.config.deck.filter((s) => keyOf(s) === k).length, 2);
});

test('normal deck: only open tables, new facts come as ghost then lantern 3-5 apart', () => {
  const p = newProfile();
  play(p, 1);
  const plan = planRound(p, { seed: 7, today: '2026-11-05' });
  assert.equal(plan.type, 'normal');
  const d = plan.config.deck;
  assert.ok(d.length >= 12);
  for (const s of d) assert.ok(s.a === 1 || s.b === 1, `only table 1 is open: ${s.a}x${s.b}`);
  assert.ok(plan.newKeys.length > 0 && plan.newKeys.length <= 6);
  for (const k of plan.newKeys) {
    const idx = d.map((s, i) => (keyOf(s) === k ? i : -1)).filter((i) => i >= 0);
    const g = idx.find((i) => d[i].ghost), l = idx.find((i) => d[i].lantern);
    assert.ok(g != null && l != null, `ghost and lantern for ${k}`);
    assert.ok(l - g >= 3 && l - g <= 5, `gap ${l - g}`);
  }
});

test('no fact appears twice in a row and the deck is deterministic per seed', () => {
  const p = newProfile();
  play(p, 4);
  const a = planRound(p, { seed: 42, today: '2026-11-05' });
  const b = planRound(p, { seed: 42, today: '2026-11-05' });
  assert.deepEqual(a.config, b.config);
  for (let i = 1; i < a.config.deck.length; i++) assert.notEqual(keyOf(a.config.deck[i]), keyOf(a.config.deck[i - 1]));
});

test('tricky facts are tagged and included', () => {
  const p = newProfile();
  play(p, 3);
  const k = Object.keys(p.facts)[0];
  Object.assign(p.facts[k], { tricky: true, trickyNeed: 3, lastWrongRound: p.progress.roundIndex, box: 1 });
  const plan = planRound(p, { seed: 3, today: '2026-11-05' });
  const t = plan.config.deck.filter((s) => keyOf(s) === k);
  assert.ok(t.length >= 1);
  assert.ok(t.some((s) => s.tricky && s.tricky_need === 3));
});

test('boss round: the 12 facts of the table, each once', () => {
  const p = newProfile();
  play(p, 2);
  const plan = planRound(p, { seed: 5, today: '2026-11-05', choice: { boss: 1 } });
  assert.equal(plan.type, 'boss');
  assert.deepEqual(plan.config.deck.map(keyOf).sort(), [...tableFacts(1)].sort());
  assert.equal(plan.config.boss.hp, 12);
});

test('little band plays fewer sums than big band at the same speed', () => {
  const little = newProfile({ age: 6 }), big = newProfile({ age: 9 });
  little.settings.baseTier = big.settings.baseTier = 2;
  play(little, 1); play(big, 1);
  openTable(little, 2, 1); openTable(big, 2, 1);
  const nl = planRound(little, { seed: 9, today: '2026-11-05' }).config.deck.length;
  const nb = planRound(big, { seed: 9, today: '2026-11-05' }).config.deck.length;
  assert.ok(nl < nb, `${nl} < ${nb}`);
});
