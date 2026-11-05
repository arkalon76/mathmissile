// Monster pictures outside the round: PNG portraits drawn by the engine
// (engine.portrait), cached as data URLs so the art matches the game.

import { h } from './dom.js';
import { ITEMS_BY_ID } from '../logic/catalog.js';

let portraitFn = null;
const cache = new Map();

/** Set by main.js once the engine exists: (species, opts) => PNG data URL. */
export function setPortraitSource(fn) { portraitFn = fn; cache.clear(); }

// Avatar colour sets: the portrait has no palette option, so tint with CSS.
const COLOR_FILTERS = {
  sunset: 'hue-rotate(-35deg) saturate(1.3)',
  ocean: 'hue-rotate(170deg) saturate(1.2)',
  forest: 'hue-rotate(80deg) saturate(1.1)',
  candy: 'hue-rotate(290deg) saturate(1.3)',
};

function portraitUrl(id, size, opts) {
  if (!portraitFn) return null;
  const px = Math.min(512, Math.ceil(size * Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1))));
  const mood = opts.mood || 'happy';
  const key = `${id}|${px}|${opts.shiny ? 1 : 0}|${opts.silhouette ? 1 : 0}|${mood}`;
  let url = cache.get(key);
  if (url === undefined) {
    try { url = portraitFn(id, { size: px, shiny: !!opts.shiny, silhouette: !!opts.silhouette, mood }) || null; }
    catch (e) { console.warn('[art] portrait', id, e); url = null; }
    cache.set(key, url);
  }
  return url;
}

/** An element showing a monster: `{size, shiny, silhouette, mood}`. */
export function monsterArt(id, opts = {}) {
  const size = opts.size || 96;
  const url = portraitUrl(id, size, opts);
  if (url) return h('img', { class: 'monster-img', src: url, alt: '', width: size, height: size, draggable: 'false' });
  // No engine (should not happen after boot): an empty placeholder of the same size.
  return h('div', { class: 'monster-art', style: { width: `${size}px`, height: `${size}px` } });
}

/** Child's avatar: species + equipped hat/face/back emoji. */
export function avatarArt(profile, size = 96) {
  const A = profile.avatar;
  const wrap = h('div', { class: 'avatar', style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.34)}px` } });
  if (A.equipped.back) wrap.appendChild(h('span', { class: 'av-back', 'aria-hidden': 'true' }, ITEMS_BY_ID[A.equipped.back]?.icon || ''));
  const img = monsterArt(A.base, { size });
  if (COLOR_FILTERS[A.colorSet]) img.style.filter = COLOR_FILTERS[A.colorSet];
  wrap.appendChild(img);
  if (A.equipped.face) wrap.appendChild(h('span', { class: 'av-face', 'aria-hidden': 'true' }, ITEMS_BY_ID[A.equipped.face]?.icon || ''));
  if (A.equipped.hat) wrap.appendChild(h('span', { class: 'av-hat', 'aria-hidden': 'true' }, ITEMS_BY_ID[A.equipped.hat]?.icon || ''));
  return wrap;
}
