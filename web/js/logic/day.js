// Local calendar days as YYYY-MM-DD strings.

const pad = (n) => String(n).padStart(2, '0');

export function dayOf(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Whole days from a to b (b later → positive). null/invalid a → Infinity. */
export function daysBetween(a, b) {
  if (!isDay(a) || !isDay(b)) return Infinity;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
