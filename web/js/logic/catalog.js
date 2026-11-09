// Static content: species (§5.3), cosmetics (§5.5), level rewards and titles
// (§5.2), stickers (§5.4) and badges (§5.7). Names are original to this game.

import { PATH } from './facts.js';

// ---- species ---------------------------------------------------------------
// shape: blob | frog | sheep | spiky | slug | worm | mop | moth | cookie | bat | fish | loaf | bird | puff | lizard | star | bug | flower | bunny | owl | horn | crab | fox | dragon
const S = (id, name, island, kind, color, color2, shape) => ({ id, name, island, kind, color, color2, shape });

export const SPECIES = [
  S('bloop', 'Bloop', 1, 'A', '#5ad1ff', '#2a8fd6', 'blob'),
  S('snibbet', 'Snibbet', 1, 'B', '#ffd45a', '#ff9f43', 'bird'),
  S('pebbit', 'Pebbit', 2, 'A', '#7bd88f', '#3fa65a', 'frog'),
  S('duodle', 'Duodle', 2, 'B', '#ffa3d7', '#e05fae', 'puff'),
  S('fluffnik', 'Fluffnik', 10, 'A', '#f4f1ff', '#b8b0e8', 'sheep'),
  S('tenzel', 'Tenzel', 10, 'B', '#9be15d', '#4fb34a', 'lizard'),
  S('quillip', 'Quillip', 5, 'A', '#c79a6b', '#8d6340', 'spiky'),
  S('fivvy', 'Fivvy', 5, 'B', '#ff8a65', '#e8553a', 'star'),
  S('mossnug', 'Mossnug', 3, 'A', '#8fcf5a', '#5f9a35', 'slug'),
  S('trillo', 'Trillo', 3, 'B', '#b388ff', '#7c4dff', 'bug'),
  S('zigglet', 'Zigglet', 11, 'A', '#ff7eb6', '#d94c8a', 'worm'),
  S('puffwhirl', 'Puffwhirl', 11, 'B', '#fff59d', '#f0c419', 'flower'),
  S('glimmop', 'Glimmop', 4, 'A', '#ffe082', '#ffb300', 'mop'),
  S('quadbun', 'Quadbun', 4, 'B', '#f8bbd0', '#ec7fa9', 'bunny'),
  S('drizzlewing', 'Drizzlewing', 9, 'A', '#80deea', '#3aa6b9', 'moth'),
  S('ninoo', 'Ninoo', 9, 'B', '#bcaaa4', '#8d6e63', 'owl'),
  S('crumbit', 'Crumbit', 6, 'A', '#e0a96d', '#a86b32', 'cookie'),
  S('wobblehorn', 'Wobblehorn', 6, 'B', '#ce93d8', '#9c4dcc', 'horn'),
  S('gloomp', 'Gloomp', 8, 'A', '#7e7fd6', '#4b4ca3', 'bat'),
  S('ochtle', 'Ochtle', 8, 'B', '#ff8a80', '#e05252', 'crab'),
  S('flutterknot', 'Flutterknot', 7, 'A', '#4dd0e1', '#ff80ab', 'fish'),
  S('sevvle', 'Sevvle', 7, 'B', '#ffab40', '#e67e22', 'fox'),
  S('grumblebun', 'Grumblebun', 12, 'A', '#d7b98e', '#a3804f', 'loaf'),
  S('dozzle', 'Dozzle', 12, 'B', '#69f0ae', '#22b573', 'dragon'),
  S('goldfluff', 'Goldfluff', 0, 'special', '#ffd700', '#ffb300', 'sheep'),
  S('clonkshell', 'Clonkshell', 0, 'special', '#90a4ae', '#546e7a', 'blob'),
  S('splitsy', 'Splitsy', 0, 'special', '#b2ff59', '#64dd17', 'blob'),
  S('chillby', 'Chillby', 0, 'special', '#b3e5fc', '#4fc3f7', 'puff'),
];
for (const T of [...PATH].sort((a, b) => a - b)) {
  const a = SPECIES.find((s) => s.island === T && s.kind === 'A');
  SPECIES.push({ ...a, id: `grand_${a.id}`, name: `Grand ${a.name}`, kind: 'grand', base: a.id });
}
export const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));
export const BASE_SPECIES = SPECIES.filter((s) => s.kind === 'A' || s.kind === 'B');
export const speciesOfIsland = (T, kind) => SPECIES.find((s) => s.island === T && s.kind === kind);

/** Monster buddies a child can pick as an avatar. */
export const AVATARS = ['bloop', 'pebbit', 'fluffnik', 'quillip', 'mossnug', 'zigglet', 'glimmop', 'crumbit', 'gloomp', 'flutterknot'];

// ---- cosmetics -------------------------------------------------------------
// source: {level:n} | {shop:price} | {chest:true} | {album:true} | {badge:id} | {bundle:table} | {default:true}
const I = (id, kind, name, icon, source, slot) => ({ id, kind, name, icon, source, slot: slot || kind });

export const ITEMS = [
  // blades
  I('starter_wand', 'blade', 'Starter Wand', '🪄', { default: true }),
  I('leaf_blade', 'blade', 'Leaf Blade', '🍃', { level: 4 }),
  I('candy_swirl', 'blade', 'Candy Swirl', '🍭', { level: 8 }),
  I('crystal', 'blade', 'Crystal', '💎', { level: 12 }),
  I('rainbow_ribbon', 'blade', 'Rainbow Ribbon', '🎀', { level: 16 }),
  I('starlight', 'blade', 'Starlight', '🌟', { level: 20 }),
  I('carrot_sword', 'blade', 'Carrot Sword', '🥕', { shop: 40 }),
  I('feather_quill', 'blade', 'Feather Quill', '🪶', { shop: 80 }),
  I('icicle', 'blade', 'Icicle', '🧊', { badge: 'chill_out' }),
  I('golden_blade', 'blade', 'Golden Blade', '🏆', { badge: 'gold_rush' }),
  I('lightning_rod', 'blade', 'Lightning Rod', '⚡', { shop: 150 }),
  I('summit_blade', 'blade', 'Summit Blade', '🏔️', { badge: 'times_table_legend' }),
  I('shore_saber', 'blade', 'Shore Saber', '🐚', { bundle: 5 }),
  // trails
  I('plain', 'trail', 'Plain', '〰️', { default: true }),
  I('sparkle', 'trail', 'Sparkle', '✨', { level: 2 }),
  I('bubbles', 'trail', 'Bubbles', '🫧', { level: 7 }),
  I('hearts', 'trail', 'Hearts', '💖', { level: 11 }),
  I('music_notes', 'trail', 'Music Notes', '🎵', { level: 14 }),
  I('comet_tail', 'trail', 'Comet Tail', '☄️', { level: 18 }),
  I('falling_leaves', 'trail', 'Falling Leaves', '🍂', { shop: 40 }),
  I('snowflakes', 'trail', 'Snowflakes', '❄️', { shop: 80 }),
  I('paw_prints', 'trail', 'Paw Prints', '🐾', { chest: true }),
  I('confetti', 'trail', 'Confetti', '🎊', { chest: true }),
  I('pixel_stars', 'trail', 'Pixel Stars', '⭐', { chest: true }),
  I('rainbow', 'trail', 'Rainbow', '🌈', { badge: 'rainbow_round' }),
  I('moss_glow', 'trail', 'Moss Glow', '🌿', { bundle: 4 }),
  // hats
  I('party_hat', 'avatar', 'Party Hat', '🥳', { level: 3 }, 'hat'),
  I('leaf_crown', 'avatar', 'Leaf Crown', '🌱', { level: 13 }, 'hat'),
  I('beanie', 'avatar', 'Beanie', '🧶', { shop: 40 }, 'hat'),
  I('pirate_hat', 'avatar', 'Pirate Hat', '🏴‍☠️', { shop: 80 }, 'hat'),
  I('wizard_hat', 'avatar', 'Wizard Hat', '🧙', { chest: true }, 'hat'),
  I('bunny_ears', 'avatar', 'Bunny Ears', '🐰', { chest: true }, 'hat'),
  I('chef_hat', 'avatar', 'Chef Hat', '👨‍🍳', { album: true }, 'hat'),
  I('space_helmet', 'avatar', 'Space Helmet', '🚀', { badge: 'times_table_legend' }, 'hat'),
  // faces
  I('star_specs', 'avatar', 'Star Specs', '🤩', { level: 6 }, 'face'),
  I('silly_moustache', 'avatar', 'Silly Moustache', '🥸', { level: 17 }, 'face'),
  I('rosy_cheeks', 'avatar', 'Rosy Cheeks', '😊', { shop: 40 }, 'face'),
  I('sunglasses', 'avatar', 'Sunglasses', '😎', { chest: true }, 'face'),
  I('monocle', 'avatar', 'Monocle', '🧐', { album: true }, 'face'),
  I('face_paint', 'avatar', 'Face Paint Stars', '🌠', { chest: true }, 'face'),
  // backs
  I('tiny_cape', 'avatar', 'Tiny Cape', '🦸', { level: 9 }, 'back'),
  I('bubble_jetpack', 'avatar', 'Bubble Jetpack', '🎈', { level: 19 }, 'back'),
  I('butterfly_wings', 'avatar', 'Butterfly Wings', '🦋', { shop: 80 }, 'back'),
  I('turtle_shell', 'avatar', 'Turtle Shell', '🐢', { album: true }, 'back'),
  I('dragon_wings', 'avatar', 'Dragon Wings', '🐉', { shop: 150 }, 'back'),
  I('backpack', 'avatar', 'Backpack', '🎒', { chest: true }, 'back'),
  I('cloud_cape', 'avatar', 'Cloud Cape', '☁️', { bundle: 7 }, 'back'),
  // colour sets
  I('default', 'color', 'Classic', '🎨', { default: true }),
  I('sunset', 'color', 'Sunset', '🌅', { level: 10 }),
  I('ocean', 'color', 'Ocean', '🌊', { shop: 40 }),
  I('forest', 'color', 'Forest', '🌲', { chest: true }),
  I('candy', 'color', 'Candy', '🍬', { album: true }),
];
export const ITEMS_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
export const COLOR_SETS = {
  default: null,
  sunset: ['#ff9a5a', '#e0533d'],
  ocean: ['#4fc3f7', '#1976d2'],
  forest: ['#66bb6a', '#2e7d32'],
  candy: ['#f48fb1', '#ba68c8'],
};

export const shopItems = () => ITEMS.filter((i) => i.source.shop);
export const levelPool = () => ITEMS.filter((i) => i.source.shop || i.source.chest || i.source.album);
export const chestOnly = () => ITEMS.filter((i) => i.source.chest);
export const albumPool = () => ITEMS.filter((i) => i.source.album);

// ---- levels and titles (§5.2) ---------------------------------------------
export const LEVEL_ITEMS = Object.fromEntries(ITEMS.filter((i) => i.source.level).map((i) => [i.source.level, i.id]));

export const TITLES = { 5: 'Pop Pal', 10: 'Blade Buddy', 15: 'Monster Mate', 20: 'Times Tamer', 25: 'Sum Sprinter', 30: 'Lantern Keeper', 35: 'Island Hopper', 40: 'Fact Wizard', 45: 'Star Captain', 50: 'Number Knight' };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export function titleForLevel(level) {
  if (level >= 60) return `Legend ${ROMAN[Math.min(10, Math.floor((level - 50) / 10))]}`;
  let t = '';
  for (const [lv, name] of Object.entries(TITLES)) if (level >= +lv) t = name;
  return t;
}
export const titleAt = (level) => (level >= 60 && level % 10 === 0 ? titleForLevel(level) : TITLES[level] || null);

// ---- stickers (§5.4) -------------------------------------------------------
const PAGE_ART = [
  ['🐚', '🌊', '🦀', '🐠', '🌴', '🐬', '⛱️', '🦑', '🏝️'],
  ['🐸', '🪨', '🌸', '🐞', '🍄', '🌼', '🐝', '🦔', '🌻'],
  ['☁️', '🐑', '🌈', '🪁', '🎈', '🌤️', '🕊️', '🪶', '⭐'],
  ['🦔', '⭐', '🌟', '🍎', '🍓', '🍒', '🍑', '🥝', '🍉'],
  ['🐌', '🌿', '🍀', '🐛', '🌲', '🦋', '🐜', '🌳', '🌱'],
  ['🌀', '🌼', '🌬️', '🍃', '🪻', '🌷', '🌺', '💐', '🪷'],
  ['🐶', '🐰', '🧽', '🧸', '🪀', '🎾', '🦴', '🐕', '🏠'],
  ['🦉', '🌧️', '☔', '🌙', '🦇', '🌌', '💧', '🌫️', '⛅'],
  ['🍪', '🧁', '🍩', '🎂', '🍰', '🍫', '🥞', '🍦', '🦄'],
  ['🦇', '🦀', '🌑', '🔭', '🕯️', '🪐', '🌠', '🌛', '🧭'],
  ['🐟', '🦊', '🎏', '🐡', '🐙', '🪸', '🎐', '🫧', '🐳'],
  ['🍞', '🐉', '🏔️', '👑', '🏆', '🎆', '🚀', '🌋', '💫'],
];
export const STICKERS = PAGE_ART.flatMap((art, p) => art.map((icon, s) => ({ id: `p${p + 1}_s${s + 1}`, page: p + 1, icon })));
export const STICKERS_BY_ID = Object.fromEntries(STICKERS.map((s) => [s.id, s]));

// ---- badges (§5.7) ---------------------------------------------------------
// Quick Check ("Show What You Know") is not built: SPEC says no placement check.
const B = (id, name, icon, extra = {}) => ({ id, name, icon, ...extra });
export const BADGES = [
  B('first_pop', 'First Pop', '🎉'),
  B('fix_it_kid', 'Fix-It Kid', '🩹'),
  B('hot_streak', 'Hot Streak', '🔥'),
  B('blazing_streak', 'Blazing Streak', '☄️'),
  B('mega_streak', 'Mega Streak', '🌋'),
  B('three_stars', 'Three Stars', '⭐'),
  B('rainbow_round', 'Rainbow Round', '🌈'),
  B('perfect_round', 'Perfect Round', '💯'),
  B('golden_catch', 'Golden Catch', '🪙'),
  B('gold_rush', 'Gold Rush', '💰', { goal: 25, stat: 'goldenTotal' }),
  B('shell_cracker', 'Shell Cracker', '🐢'),
  B('split_second', 'Split Second', '✂️'),
  B('chill_out', 'Chill Out', '🧊'),
  B('boss_basher', 'Boss Basher', '👊', { goal: 3, stat: 'bosses' }),
  ...[...PATH].sort((a, b) => a - b).map((T) => B(`island_hero_${T}`, `Island Hero ${T}`, '🏝️', { table: T })),
  B('halfway_hero', 'Halfway Hero', '🌗', { goal: 6, stat: 'tablesKnown' }),
  B('times_table_legend', 'Times Table Legend', '🏅', { goal: 12, stat: 'tablesKnown' }),
  B('golden_crown', 'Golden Crown', '👑'),
  B('crown_collector', 'Crown Collector', '👑', { goal: 6, stat: 'crowns' }),
  B('grand_master', 'Grand Master', '🧠', { goal: 78, stat: 'factsMastered' }),
  B('square_dancer', 'Square Dancer', '🟪', { goal: 12, stat: 'squaresKnown' }),
  B('speedy_fingers', 'Speedy Fingers', '⚡'),
  B('lightning_brain', 'Lightning Brain', '🌩️'),
  B('speed_climber', 'Speed Climber', '🧗'),
  B('comeback_kid', 'Comeback Kid', '💪'),
  B('monster_friend', 'Monster Friend', '🤝', { goal: 10, stat: 'speciesMet' }),
  B('monster_book_complete', 'Monster Book Complete', '📗', { goal: 24, stat: 'speciesMet' }),
  B('best_friends', 'Best Friends', '💞'),
  B('shiny_spotter', 'Shiny Spotter', '✨'),
  B('sticker_star', 'Sticker Star', '📒'),
  B('sunny_days_3', 'Sunny Days 3', '☀️', { goal: 3, stat: 'playDays' }),
  B('sunny_days_7', 'Sunny Days 7', '☀️', { goal: 7, stat: 'playDays' }),
  B('sunny_days_14', 'Sunny Days 14', '🌞', { goal: 14, stat: 'playDays' }),
  B('sunny_days_30', 'Sunny Days 30', '🌞', { goal: 30, stat: 'playDays' }),
  B('hundred_club', 'Hundred Club', '💯', { goal: 100, stat: 'totalCorrect' }),
  B('thousand_club', 'Thousand Club', '🎖️', { goal: 1000, stat: 'totalCorrect' }),
  B('five_thousand', 'Five Thousand', '🏆', { goal: 5000, stat: 'totalCorrect' }),
  B('mix_master', 'Mix Master', '🎨'),
  B('dress_up', 'Dress Up', '👗'),
  B('shopkeepers_friend', "Shopkeeper's Friend", '🛍️'),
];
export const BADGES_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]));

/** Items given by a badge (§5.5). */
export const BADGE_ITEMS = ITEMS.filter((i) => i.source.badge).reduce((m, i) => ((m[i.source.badge] ||= []).push(i.id), m), {});

/** Items given on a boss defeat by table (§5.9 island extras). */
export const BUNDLE_ITEMS = ITEMS.filter((i) => i.source.bundle).reduce((m, i) => ((m[i.source.bundle] ||= []).push(i.id), m), {});
