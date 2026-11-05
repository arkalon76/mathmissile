import test from 'node:test';
import assert from 'node:assert/strict';
import { numberWords, gateQuestion, clampInt, gateFail, gateLockLeft, GATE_LOCK_MS } from '../js/ui/parent.js';
import { createStore, memoryStorage } from '../js/logic/profile.js';

test('numberWords spells numbers used by the parent gate', () => {
  assert.equal(numberWords(7), 'seven');
  assert.equal(numberWords(13), 'thirteen');
  assert.equal(numberWords(40), 'forty');
  assert.equal(numberWords(39), 'thirty-nine');
  assert.equal(numberWords(351), 'three hundred and fifty-one');
});

test('gate question is 2-digit x 2-digit in words, outside the times tables', () => {
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
    const q = gateQuestion(() => r);
    assert.match(q.text, /^What is [a-z-]+ times [a-z-]+\?$/);
    assert.ok(!/\d/.test(q.text), 'no digits in the question');
    const [, a, b] = q.text.match(/What is (\S+) times (\S+)\?/);
    assert.ok(!/^(ten|twenty|one|two|three|four|five|six|seven|eight|nine|eleven|twelve)$/.test(a), a);
    assert.ok(q.answer >= 13 * 11 && q.answer <= 29 * 19);
  }
});

test('gate locks for 60 s after two wrong answers, then opens again', () => {
  const t = 1_000_000;
  let g = gateFail({}, t);
  assert.equal(gateLockLeft(g, t), 0);
  g = gateFail(g, t + 1000);
  assert.equal(gateLockLeft(g, t + 1000), 60);
  assert.equal(gateLockLeft(g, t + 1000 + GATE_LOCK_MS - 1), 1);
  assert.equal(gateLockLeft(g, t + 1000 + GATE_LOCK_MS), 0);
  // a fail after the lock starts counting from zero again
  assert.equal(gateLockLeft(gateFail(g, t + 2000 + GATE_LOCK_MS), t + 2000 + GATE_LOCK_MS), 0);
});

test('gate lock survives a reload (device storage)', () => {
  const mem = memoryStorage();
  const st = createStore(mem);
  const d = st.loadDevice();
  d.gate = { fails: 0, lockUntil: 5e12 };
  st.saveDevice(d);
  assert.equal(createStore(mem).loadDevice().gate.lockUntil, 5e12);
});

test('clampInt clamps and rejects junk', () => {
  assert.equal(clampInt('999999999', 1, 100000), 100000);
  assert.equal(clampInt('-5', 1, 10), 1);
  assert.equal(clampInt('abc', 1, 10), null);
  assert.equal(clampInt('7.6', 1, 10), 8);
});

test('a lock further out than one lock (wrong clock, tampered save) is ignored', () => {
  const now = 1_000_000;
  assert.equal(gateLockLeft({ lockUntil: now + GATE_LOCK_MS }, now), 60);
  assert.equal(gateLockLeft({ lockUntil: now + 10 * GATE_LOCK_MS }, now), 0);
});

test('clampInt treats an empty field as no value', () => {
  assert.equal(clampInt('', 3, 18), null);
  assert.equal(clampInt('  ', 3, 18), null);
  assert.equal(clampInt('abc', 3, 18), null);
  assert.equal(clampInt('9', 3, 18), 9);
});
