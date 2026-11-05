// Times-table facts (§0, §1.1, §1.2). A fact is an unordered pair {a,b},
// 1 <= a <= b <= 12, keyed "axb" with the smaller number first. 78 in all.
// This is the "times" problem source; other maths can add sibling modules.

import { TUNING } from './tuning.js';

export const PATH = TUNING.path;
export const TABLES = [...PATH].sort((x, y) => x - y);

export function factKey(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return `${lo}x${hi}`;
}

export function parseKey(key) {
  const m = /^(\d{1,2})x(\d{1,2})$/.exec(key);
  if (!m) return null;
  const a = +m[1], b = +m[2];
  if (a < 1 || b > 12 || a > b) return null;
  return { a, b };
}

export const ALL_FACT_KEYS = (() => {
  const out = [];
  for (let a = 1; a <= 12; a++) for (let b = a; b <= 12; b++) out.push(`${a}x${b}`);
  return out;
})();

export function isSquare(key) {
  const f = parseKey(key);
  return !!f && f.a === f.b;
}

export function answerOf(key) {
  const f = parseKey(key);
  return f ? f.a * f.b : NaN;
}

/** Path index (0-based) of a table. */
export function pathIndex(table) {
  return PATH.indexOf(table);
}

/** Home table: the first table in path order containing the fact. */
export function homeTable(key) {
  const { a, b } = parseKey(key);
  return pathIndex(a) <= pathIndex(b) ? a : b;
}

/** The 12 fact keys of table T, in path order of the multiplier (§1.1). */
export function tableFacts(table) {
  return PATH.map((m) => factKey(table, m));
}

/** Facts whose home table is T, in introduction order (§1.1). */
export function newFactsOfTable(table) {
  return tableFacts(table).filter((k) => homeTable(k) === table);
}

/** Facts of table T that belong to an earlier island ("you already know"). */
export function sharedFactsOfTable(table) {
  return tableFacts(table).filter((k) => homeTable(k) !== table);
}

/** Display operands for a fact with `first` shown first (if it is a factor). */
export function orient(key, first) {
  const { a, b } = parseKey(key);
  if (first === b) return { a: b, b: a };
  return { a, b };
}

/** Whether display {a,b} is the "ab" (small first) form of the fact. Squares are both. */
export function formOf(a, b) {
  if (a === b) return 'both';
  return a < b ? 'ab' : 'ba';
}

/** A blank saved fact record (§8). */
export function blankFact() {
  return {
    introduced: false, introducedRound: null,
    box: 0, bestBox: 0,
    seen: 0, correct: 0, wrong: 0, escapes: 0,
    tricky: false, trickyNeed: 0,
    lastSeenRound: null, lastSeenDay: null, lastBoxUpRound: null,
    dayReachedBox3: null, dayReachedBox4: null, dayReachedBox5: null,
    rtEmaMs: null, recentRtMs: [], recent: '',
    orient: { ab: false, ba: false },
    confusedWith: {}, lastWrongRound: null,
  };
}

/**
 * Derived child-facing state (§1.2): locked | new | learning | growing | known | mastered.
 * `useBest` uses bestBox (lanterns never go dark); otherwise real box.
 */
export function factState(rec, homeOpen, useBest = false) {
  if (!homeOpen && !(rec && rec.introduced)) return 'locked';
  if (!rec || !rec.introduced) return 'new';
  const box = useBest ? Math.max(rec.box, rec.bestBox || 0) : rec.box;
  if (box >= 5) return 'mastered';
  if (box >= 3) return 'known';
  if (box === 2) return 'growing';
  return 'learning';
}
