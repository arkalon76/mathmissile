import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryStorage, migrateProfile, SCHEMA, profileKey, INDEX_KEY, cleanText, bandForAge } from '../js/logic/profile.js';
import { newProfile, play } from './helpers.mjs';

test('save and load round-trips a profile', () => {
  const st = createStore(memoryStorage());
  const p = newProfile();
  play(p, 3);
  st.saveProfile(p);
  const idx = st.loadIndex();
  assert.equal(idx.profiles.length, 1);
  const back = st.loadProfile(p.id);
  assert.equal(back.schema, SCHEMA);
  assert.equal(back.progress.xp, p.progress.xp);
  assert.deepEqual(back.facts, p.facts);
  assert.deepEqual(back.collection.stickers, p.collection.stickers);
});

test('missing data gives an empty index, not an error', () => {
  const st = createStore(memoryStorage());
  assert.deepEqual(st.loadIndex().profiles, []);
  assert.equal(st.loadProfile('nope'), null);
});

test('corrupt profile JSON is backed up and reported, never thrown', () => {
  const mem = memoryStorage();
  const st = createStore(mem);
  const p = newProfile();
  st.saveProfile(p);
  mem.setItem(profileKey(p.id), '{not json');
  assert.equal(st.loadProfile(p.id), null);
  assert.ok([...mem._map.keys()].some((k) => k.startsWith('mm.corrupt.')));
  const r = st.loadOrRecover(st.loadIndex().profiles[0]);
  assert.ok(r.profile && r.recovered);
  assert.equal(r.profile.id, p.id);
});

test('corrupt index is rebuilt from saved profiles', () => {
  const mem = memoryStorage();
  const st = createStore(mem);
  const a = newProfile({ name: 'A' }), b = newProfile({ name: 'B' });
  st.saveProfile(a); st.saveProfile(b);
  mem.setItem(INDEX_KEY, '[[[');
  const idx = st.loadIndex();
  assert.deepEqual(idx.profiles.map((x) => x.id).sort(), [a.id, b.id].sort());
});

test('migrates a v1 (DESIGN §8) save and clamps bad values', () => {
  const v1 = { schema: 1, id: 'abc', name: 'Zed<script>', avatar: 'blobbo', age: 99,
    settings: { baseTier: 9, targetMs: -5 }, progress: { xp: -10, sparks: 'lots', level: 500, playDays: ['2026-11-01', 'bad'] },
    facts: { '2x3': { box: 9, orient: { ab: true } }, 'zz': {} }, tables: { 1: { state: 'weird' } },
    collection: { blades: ['nope', 'starter_wand'], stickers: ['p1_s1', '<img>'] }, avatar: { blade: 'nope' } };
  const p = migrateProfile(v1);
  assert.equal(p.schema, SCHEMA);
  assert.deepEqual(p.rewards, { real: [], redemptions: [] });
  assert.equal(p.settings.breakMinutes, 20);
  assert.equal(p.settings.baseTier, 4);
  assert.ok(p.settings.targetMs >= 1000);
  assert.equal(p.progress.xp, 0);
  assert.equal(p.progress.sparks, 0);
  assert.deepEqual(p.progress.playDays, ['2026-11-01']);
  assert.equal(p.facts['2x3'].box, 5);
  assert.ok(!('zz' in p.facts));
  assert.equal(p.tables[1].state, 'open');
  assert.deepEqual(p.collection.blades, ['starter_wand']);
  assert.deepEqual(p.collection.stickers, ['p1_s1']);
  assert.equal(p.avatar.blade, 'starter_wand');
  assert.ok(p.age <= 18);
});

test('migrate rejects non-objects', () => {
  for (const x of [null, 3, 'x', [1]]) assert.equal(migrateProfile(x), null);
});

test('cleanText strips control and bidi characters and cuts length', () => {
  assert.equal(cleanText('  a\u0000b‮c  d ', 10), 'abc d');
  assert.equal(cleanText('x'.repeat(50), 16).length, 16);
  assert.equal(bandForAge(6), 'little');
  assert.equal(bandForAge(9), 'big');
});
