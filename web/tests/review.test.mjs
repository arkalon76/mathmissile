// Fixes from the independent reviews: Known rules and valves, ungraded / golden /
// mini results, speed decay commit, corrupt-save backups, normalize hardening.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tableFacts } from '../js/logic/facts.js';
import { updateTableAfterRound, knownChecks } from '../js/logic/tables.js';
import { planRound } from '../js/logic/deck.js';
import { applyRound } from '../js/logic/rewards.js';
import { decayedOffset } from '../js/logic/speed.js';
import { createStore, memoryStorage, migrateProfile, profileKey } from '../js/logic/profile.js';
import { newProfile, fakeSummary, play, NOW } from './helpers.mjs';

function setBoxes(p, T, boxes, rt = 1000) {
  tableFacts(T).forEach((k, i) => {
    p.facts[k] = { ...(p.facts[k] || {}), introduced: true, box: boxes[i], bestBox: boxes[i], rtEmaMs: rt, orient: { ab: true, ba: true },
      tricky: false, recentRtMs: [], recent: '', confusedWith: {}, seen: 3, correct: 3, wrong: 0, escapes: 0 };
  });
}
const B = (n3, rest) => [...Array(n3).fill(3), ...Array(12 - n3).fill(rest)];

test('Known: 10 of 12 facts at box 3+ and none below box 2 is enough', () => {
  const p = newProfile();
  setBoxes(p, 1, B(10, 2));
  assert.equal(knownChecks(p, 1).boxesOk, true);
  assert.equal(updateTableAfterRound(p, 1, 3, '2026-11-05')[0]?.event, 'known');
});

test('Known: a fact below box 2 blocks it, and 9 of 12 is not enough early', () => {
  const p = newProfile();
  setBoxes(p, 1, [...B(11, 3).slice(0, 11), 1]);
  assert.equal(knownChecks(p, 1).boxesOk, false);
  const q = newProfile();
  setBoxes(q, 1, B(9, 2));
  assert.equal(knownChecks(q, 1).boxesOk, false);
});

test('accuracy kindness valve: after 8 rounds on the table, 9 facts at box 3+ suffice', () => {
  const p = newProfile();
  setBoxes(p, 1, B(9, 0));
  for (let i = 1; i <= 7; i++) assert.deepEqual(updateTableAfterRound(p, 1, i, '2026-11-05'), [], `round ${i}`);
  assert.equal(updateTableAfterRound(p, 1, 8, '2026-11-05')[0]?.event, 'known');
  assert.equal(knownChecks(p, 1).valve, true);
});

test('the accuracy valve still needs the speed check (or the speed valve)', () => {
  const p = newProfile();
  setBoxes(p, 1, B(9, 0), 60000);
  for (let i = 1; i <= 8; i++) assert.deepEqual(updateTableAfterRound(p, 1, i, '2026-11-05'), []);
  // Speed waivers only count once the boxes are fine (from round 8 on).
  for (let i = 9; i <= 14; i++) updateTableAfterRound(p, 1, i, '2026-11-05');
  assert.equal(updateTableAfterRound(p, 1, 15, '2026-11-05')[0]?.event, 'known');
});

test('an 80% child gets table 1 Known within 25 rounds', () => {
  const p = newProfile();
  let x = 12345;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let knownAt = null;
  for (let i = 0; i < 40 && knownAt == null; i++) {
    const day = `2026-11-${String(5 + Math.floor(i / 8)).padStart(2, '0')}`;
    const plan = planRound(p, { seed: 100 + i, today: day, offset: decayedOffset(p.speed, day) });
    applyRound(p, plan, fakeSummary(plan, { wrongAt: () => rnd() >= 0.8, rt: 3000 }), { now: NOW, today: day });
    if (p.tables[1].state !== 'open') knownAt = i + 1;
  }
  assert.ok(knownAt != null && knownAt <= 25, `known at ${knownAt}`);
});

test('ungraded and golden results never move SRS or the round counters', () => {
  const p = newProfile();
  play(p, 2);
  const plan = planRound(p, { seed: 9, today: '2026-11-05' });
  const key = '1x2';
  const before = JSON.stringify(p.facts[key]);
  const s = fakeSummary(plan, {
    extra: [
      { a: 1, b: 2, result: 'wrong', graded: false, rt_ms: null, given: 3 },
      { a: 1, b: 2, result: 'wrong', golden: true, given: 3 },
      { a: 2, b: 1, result: 'escaped', golden: true, given: null },
    ],
  });
  // Only the deck slots (all correct) may change 1x2; drop those to isolate the extras.
  s.results = s.results.filter((r) => r.slot === -1 || !(r.fact.a * r.fact.b === 2));
  const R = applyRound(p, plan, s, { now: NOW, today: '2026-11-05' });
  assert.equal(JSON.stringify(p.facts[key]), before, '1x2 untouched by extras');
  assert.equal(R.wrong, 0);
  assert.equal(R.escapes, 0);
  assert.equal(R.correct, s.results.filter((r) => r.slot !== -1).length);
});

test('Splitsy minis are graded for SRS (DESIGN §6.1)', () => {
  const p = newProfile();
  play(p, 2);
  const plan = planRound(p, { seed: 9, today: '2026-11-05' });
  const key = '1x2';
  const boxBefore = p.facts[key].box;
  const wrongBefore = p.facts[key].wrong;
  const s = fakeSummary(plan, { extra: [{ a: 2, b: 1, result: 'wrong', mini: true, given: 3 }] });
  s.results = s.results.filter((r) => r.slot === -1 || !(r.fact.a * r.fact.b === 2));
  const R = applyRound(p, plan, s, { now: NOW, today: '2026-11-05' });
  assert.equal(p.facts[key].wrong, wrongBefore + 1);
  assert.equal(p.facts[key].tricky, true);
  assert.ok(p.facts[key].box <= boxBefore);
  assert.equal(R.wrong, 1);
});

test('speed decay is only committed by applyRound (aborted rounds do not decay)', () => {
  const p = newProfile();
  p.speed.offset = 1;
  p.speed.lastRoundDay = '2026-11-05';
  const off = decayedOffset(p.speed, '2026-11-05');
  assert.equal(off, 0.8);
  const plan = planRound(p, { seed: 1, today: '2026-11-05', offset: off });
  assert.equal(plan.config.speed.offset, 0.8);
  assert.equal(p.speed.offset, 1, 'planning does not touch the profile');
  // Tutorial/boss rounds keep the decayed start offset.
  const s = fakeSummary(plan);
  s.offset_end = 0.5;
  applyRound(p, plan, s, { now: NOW, today: '2026-11-05' });
  assert.equal(p.speed.offset, plan.type === 'tutorial' || plan.type === 'boss' ? 0.8 : 0.5);
});

test('valid-JSON non-profile saves (null, []) are backed up before recovery', () => {
  for (const raw of ['null', '[]', '5']) {
    const mem = memoryStorage();
    const st = createStore(mem);
    const p = newProfile();
    st.saveProfile(p);
    mem.setItem(profileKey(p.id), raw);
    const r = st.loadOrRecover({ id: p.id, name: p.name, avatar: p.avatar.base });
    assert.ok(r.recovered);
    const backups = [...mem._map.keys()].filter((k) => k.startsWith(`mm.corrupt.${profileKey(p.id)}.`));
    assert.equal(backups.length, 1, raw);
    assert.equal(mem.getItem(backups[0]), raw);
  }
});

test('corrupt backups: one per key, at most 3 in total, removed with the profile', () => {
  const mem = memoryStorage();
  const st = createStore(mem);
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const p = newProfile({ id: `p_test${i}` });
    st.saveProfile(p);
    ids.push(p.id);
    mem.setItem(profileKey(p.id), '{broken');
  }
  const count = () => [...mem._map.keys()].filter((k) => k.startsWith('mm.corrupt.')).length;
  st.loadProfile(ids[4]); st.loadProfile(ids[4]); st.loadProfile(ids[4]);
  assert.equal(count(), 1, 'repeated reads do not add copies');
  mem.setItem(profileKey(ids[4]), '{broken again');
  st.loadProfile(ids[4]);
  assert.equal(count(), 1, 'one per key');
  for (const id of ids) st.loadProfile(id);
  assert.ok(count() <= 3, `capped: ${count()}`);
  const kept = [...mem._map.keys()].filter((k) => k.startsWith('mm.corrupt.'));
  const owner = ids.find((id) => kept.some((k) => k.startsWith(`mm.corrupt.${profileKey(id)}.`)));
  st.deleteProfile(owner);
  assert.ok(![...mem._map.keys()].some((k) => k.startsWith(`mm.corrupt.${profileKey(owner)}.`)), 'deleted with the profile');
});

test('normalize: unknown or prototype keys are dropped and strings capped', () => {
  const p = newProfile();
  const raw = JSON.parse(JSON.stringify(p));
  raw.collection.dex = JSON.parse('{"__proto__": {"met": true}, "constructor": {"met": true}, "bloop": {"met": true}, "nosuch": {"met": true}}');
  raw.collection.badges = JSON.parse('{"__proto__": "x", "first_pop": "2026-11-05", "fake_badge": "x"}');
  raw.progress.wish = 'constructor';
  raw.progress.title = 'T'.repeat(5000);
  raw.progress.lastEvent = 'x'.repeat(500);
  raw.id = 'x'.repeat(5000);
  raw.rewards.real = [{ id: 'y'.repeat(999), name: 'ok', price: 5, createdAt: 'z'.repeat(999) }];
  raw.pendingRound = { seed: 1, roundIndex: 2, startedAt: 'now', junk: 'q'.repeat(999) };
  const q = migrateProfile(raw);
  assert.deepEqual(Object.keys(q.collection.dex), ['bloop']);
  assert.equal(Object.getPrototypeOf(q.collection.dex), Object.prototype);
  assert.deepEqual(Object.keys(q.collection.badges), ['first_pop']);
  assert.equal(q.progress.wish, null);
  assert.ok(q.progress.title.length <= 40);
  assert.equal(q.progress.lastEvent, null);
  assert.ok(q.id.length <= 40);
  assert.ok(q.rewards.real[0].id.length <= 40 && q.rewards.real[0].createdAt.length <= 40);
  assert.deepEqual(Object.keys(q.pendingRound), ['seed', 'roundIndex', 'startedAt', 'today', 'choice', 'offset', 'results', 'score', 'bestCombo', 'fixed', 'ms']);
  assert.ok(!('junk' in q.pendingRound));
  assert.equal({}.met, undefined, 'Object.prototype not polluted');
});

test('round 2: an escaped Splitsy mini updates SRS but is not a round escape', () => {
  const p = newProfile();
  const plan = planRound(p, { seed: 7, today: '2026-11-05' });
  const s = plan.config.deck[0];
  const sum = fakeSummary(plan, { extra: [{ a: s.a, b: s.b, mini: true, result: 'escaped', rt_ms: null, fast: false, given: null }] });
  const r = applyRound(p, plan, sum, { now: NOW, today: '2026-11-05' });
  assert.equal(r.escapes, 0);
  assert.equal(p.progress.totalEscapes, 0);
});
