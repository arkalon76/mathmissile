import test from 'node:test';
import assert from 'node:assert/strict';
import { blankFact } from '../js/logic/facts.js';
import { applyResolution, nextBox, responseTime, factWeight } from '../js/logic/srs.js';

const ctx = (today = '2026-11-05', roundIndex = 5) => ({ roundIndex, today, boxUpThisRound: new Set() });
const hit = (rec, key, ev, c = ctx()) => applyResolution(rec, key, { a: 2, b: 3, given: null, ghost: false, rtMs: 1000, ...ev }, c);

test('correct answers move up one box per round, slow ones stop at 3', () => {
  const r = blankFact();
  hit(r, '2x3', { result: 'correct', fast: false });
  assert.equal(r.box, 1);
  hit(r, '2x3', { result: 'correct', fast: false }, ctx('2026-11-05', 6));
  hit(r, '2x3', { result: 'correct', fast: false }, ctx('2026-11-05', 7));
  assert.equal(r.box, 3);
  hit(r, '2x3', { result: 'correct', fast: false }, ctx('2026-11-08', 8));
  assert.equal(r.box, 3, 'slow never passes box 3');
});

test('only one box up per fact per round', () => {
  const r = blankFact();
  const c = ctx();
  hit(r, '2x3', { result: 'correct', fast: true }, c);
  hit(r, '2x3', { result: 'correct', fast: true }, c);
  assert.equal(r.box, 1);
});

test('day gates: box 4 needs a later day, box 5 needs both forms and a later day', () => {
  const r = { ...blankFact(), box: 3, bestBox: 3, dayReachedBox3: '2026-11-05' };
  assert.equal(nextBox(r, true, '2026-11-05'), 3);
  assert.equal(nextBox(r, true, '2026-11-06'), 4);
  const r4 = { ...blankFact(), box: 4, dayReachedBox4: '2026-11-05', orient: { ab: true, ba: false } };
  assert.equal(nextBox(r4, true, '2026-11-07'), 4, 'one form only');
  r4.orient.ba = true;
  assert.equal(nextBox(r4, true, '2026-11-05'), 4, 'same day');
  assert.equal(nextBox(r4, true, '2026-11-07'), 5);
});

test('wrong answer drops one box from box 3+, marks tricky and counts confusions', () => {
  const r = { ...blankFact(), box: 4, bestBox: 4 };
  hit(r, '2x3', { result: 'wrong', given: 8 });
  assert.equal(r.box, 3);
  assert.equal(r.tricky, true);
  assert.equal(r.trickyNeed, 3);
  assert.equal(r.confusedWith['8'], 1);
  assert.equal(r.bestBox, 4);
});

test('tricky clears after three correct answers', () => {
  const r = { ...blankFact(), tricky: true, trickyNeed: 3 };
  let fixed = false;
  for (let i = 0; i < 3; i++) fixed = hit(r, '2x3', { result: 'correct', fast: true }, ctx('2026-11-05', 10 + i)).fixed || fixed;
  assert.equal(r.tricky, false);
  assert.equal(fixed, true);
});

test('ghost answers introduce a fact without moving its box', () => {
  const r = blankFact();
  const out = hit(r, '2x3', { result: 'correct', fast: true, ghost: true });
  assert.equal(r.introduced, true);
  assert.equal(r.box, 0);
  assert.equal(out.firstCorrect, false);
});

test('escapes do not change the box', () => {
  const r = { ...blankFact(), box: 2 };
  hit(r, '2x3', { result: 'escape' });
  assert.equal(r.box, 2);
  assert.equal(r.escapes, 1);
});

test('response time starts at the latest of spawn+400, last correct and blade ready', () => {
  assert.equal(responseTime({ spawnAt: 1000, hitAt: 3000 }), 1600);
  assert.equal(responseTime({ spawnAt: 1000, hitAt: 3000, lastCorrectAt: 2000 }), 1000);
  assert.equal(responseTime({ spawnAt: 1000, hitAt: 3000, bladeReadyAt: 2500 }), 500);
});

test('tricky and low-box facts weigh more than mastered ones', () => {
  const low = { ...blankFact(), introduced: true, box: 1, lastSeenRound: 1 };
  const high = { ...blankFact(), introduced: true, box: 5, lastSeenRound: 1, lastSeenDay: '2026-11-04' };
  const tricky = { ...low, tricky: true, trickyNeed: 3 };
  const w = (r) => factWeight(r, 5, '2026-11-05');
  assert.ok(w(low) > w(high));
  assert.ok(w(tricky) > w(low));
});

test('wrong answer below box 3 drops two boxes (not below 0)', () => {
  const r = { ...blankFact(), box: 2, bestBox: 2 };
  hit(r, '2x3', { result: 'wrong', given: 7 });
  assert.equal(r.box, 0);
  const r3 = { ...blankFact(), box: 3, bestBox: 3 };
  hit(r3, '2x3', { result: 'wrong', given: 7 });
  assert.equal(r3.box, 2);
});
