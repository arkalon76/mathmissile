import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, addPlay, shouldNudge, markNudged } from '../js/logic/session.js';

test('break nudge after the set minutes of play, then again after as many more', () => {
  const s = createSession({ breakMinutes: 20, now: 0 });
  let t = 0;
  for (let i = 0; i < 15; i++) { t += 80000; addPlay(s, 75000, t); }
  assert.equal(shouldNudge(s), false);
  for (let i = 0; i < 2; i++) { t += 80000; addPlay(s, 75000, t); }
  assert.equal(shouldNudge(s), true);
  markNudged(s);
  assert.equal(shouldNudge(s), false);
});

test('0 minutes turns the nudge off; a long pause resets the clock', () => {
  const off = createSession({ breakMinutes: 0, now: 0 });
  addPlay(off, 36e5, 1);
  assert.equal(shouldNudge(off), false);
  const s = createSession({ breakMinutes: 1, now: 0 });
  addPlay(s, 50000, 50000);
  addPlay(s, 20000, 50000 + 3600000);
  assert.equal(s.playedMs, 20000);
});
