# Math Missile engine API (v2)

The Rust engine (`engine/`, built to `web/pkg/`) owns everything that happens
**inside a round**: spawning, the deck's in-round repetition, the swipe rule,
in-round adaptive speed, points and combo, special monsters, boss, event
visuals, juice and sound cues. The shell owns everything **between rounds**:
building the deck (DESIGN §2.4), SRS/box updates, stars, XP, Sparks, rewards,
saving, between-round speed decay (§3.3 "Between rounds"), audio playback.

The shell talks to the engine only through `web/js/engine.js` (`Engine`).

## Split of DESIGN.md between shell and engine

| DESIGN | Engine does | Shell does |
|---|---|---|
| §2.4 deck | plays the deck in order | builds it (buckets, ghost slots, display form, species, shiny, specials) |
| §2.5 in-round repetition | inserts copies after wrong/escape (or appends in boss rounds) | — |
| §2.7 RT | measures `rt_ms` per correct | stores rtEma, recent |
| §2.8 spawning + swipe rule | all of it | — |
| §1.4 boxes, tricky | reports results; tracks `trickyNeed` within the round to play "Fixed it!" | updates the saved fact state |
| §3.1–3.2 tiers, spawning | interpolates tiers from `x`; multipliers; lull; hard stop | picks N (= deck length) |
| §3.3 adaptive | in-round offset updates, gates, caps, ease trigger, gentle mode | between-round decay (×0.8 / ×0.5, island −0.3, tier change reset); saves the `offset_end` it gets back |
| §4.1 points, combo | all of it | personal bests |
| §4.2–4.4 stars, Sparks, XP | gives `accuracy`, `median_rt_ms`, counts | computes them |
| §6.1 specials | behaviour + visuals | decides which slots are special (chance, gating, intro) |
| §6.2–6.4 round types, boss, events | in-round behaviour + visuals | picks the round type/event |
| §7.1–7.5 | visuals + sfx events | plays sounds; key-tap/backspace come from `input.js` |

## Coordinates and time

- Pointer input is in CSS pixels relative to the canvas' top-left.
- Inside, the short side of the canvas is 1000 world units (y up).
- Fixed 120 Hz sim step. Hit-stop pauses the sim. A round is deterministic for a
  given `seed` and input.
- Shake sizes follow DESIGN (px at 1080p reference height, scaled to the screen).

## `Engine` (web/js/engine.js)

```js
import { Engine } from './engine.js';
const engine = await Engine.create(canvas, { onSfx: (id, opts) => audio.play(id, opts), font });
engine.on('correct', ev => {...});    // '*' = all events; returns an unsubscribe fn
engine.start();
engine.startRound(roundConfig);
```

| Member | Meaning |
|---|---|
| `Engine.create(canvas, {onSfx, font})` | Loads wasm. `onSfx(id, opts)` gets manifest ids (`sfx_*`, `vo_*`); `opts` may have `semitones`. |
| `on(type, fn)` / `pump()` | Events (below). `pump` runs after each frame and pointer call. |
| `start()` / `stop()` | RAF loop. |
| `startRound(cfg)` / `stopRound()` | Start a round / abort it (`round_end` with `aborted: true`). |
| `setCharged(n \| null)` | Charged number (the shell or `ChargeInput` owns typing). |
| `setPaused(b)` | Pause. Also auto-pauses when the page is hidden. |
| `setCalm(b)` | Calm effects (§7): shake × 0.25, no full-screen flashes, particles × 0.5. |
| `setCosmetics({blade, trail})` | Blade and trail ids (below). Either key may be left out. Can change any time, also mid-round. Unknown ids are ignored with a console warning. |
| `setAnchor(name, x, y)` | CSS px target for flying icons: `"sparks"` (coins), `"island"` (lanterns). Defaults: top-right, top-left. |
| `setSpeed(params)` | Live change of the speed input (same keys as the round config `speed`: `base`, `level`, `offset`, `recent`; keys left out keep their value), or a debug override `{x}` / `{flight_time, spawn_interval, max_on_screen}`. |
| `setEffectsScale(s)` | Extra particle multiplier 0..2. |
| `state`, `score`, `combo`, `roundTime`, `speedX` | Live numbers (`state`: `idle`, `playing`, `draining`, `ended`; `speedX` = current `x_eff`). |
| `fps` | Measured frames per second (debug overlay). |
| `contextLost` | True while the WebGL context is lost (see `context_lost`). |
| `pointerDown/Move/Up(x, y, t)`, `pointerCancel()` | Pointer input in CSS px (normally wired by `bindPointer`). Cancel drops a pending wrong. |
| `stats()` | Debug counters `{instances, particles, monsters, friends, flyers, x, offset, view_w, view_h, px_w, px_h}` (view in world units, px = backing store). |
| `monsters()` | On-screen monsters `[{id, x, y, r, answerable, state, species, shiny, golden, mini, minion, special, fact}]`, positions in CSS px (canvas top-left), `state` = `flying` / `revealed` / `popping`. |
| `speciesIds()`, `bladeIds()`, `trailIds()` | Lists of valid ids. |
| `portrait(species, {size, shiny, silhouette, mood, time})` | Returns a PNG data URL of that species drawn by the engine (Monster Book, avatar picker, intro cards). Synchronous. `size` px, default 256 (16–2048). `silhouette: true` = unknown entry. `mood`: `normal`, `happy` (default), `dizzy`, `bonk`, `sleepy`, `wave`, `grumpy`, `determined`. `time` (s) picks the animation frame. Transparent background. Uses one hidden canvas; cache the result. |

`input.js`: `new ChargeInput({onChange, onSfx})` calls
`onSfx('sfx_key_tap', {semitones: 0|2|4})` per digit and `onSfx('sfx_backspace')`
on clear. `attachKeyboard()`: digits charge; **Backspace, Delete and Escape clear
the charge** (SPEC) and call `preventDefault()`. Escape never pauses — pause
belongs to the shell's pause button. Keys with Ctrl/Meta/Alt and keys typed into
text inputs are ignored. `bindPointer`: `pointercancel` and `lostpointercapture`
both call `pointerCancel()` (no wrong is judged for that stroke). `bindPointer(canvas, engine)` unchanged. `wantsTouchPad()` unchanged.

## Round config

```json
{
  "seed": 918273,
  "round_type": "normal",
  "event": null,
  "band": "little",
  "target_ms": 6000,
  "speed": { "base": 0, "level": 4, "offset": 0.12, "recent": "CCWCCECC" },
  "deck": [
    { "a": 1, "b": 3, "kind": "warmup", "species": "bloop" },
    { "a": 2, "b": 4, "kind": "new", "ghost": true, "species": "pebbit" },
    { "a": 3, "b": 2, "kind": "tricky", "tricky": true, "tricky_need": 2, "species": "pebbit" },
    { "a": 4, "b": 2, "kind": "focus", "special": "armored", "species": "clonkshell" },
    { "a": 2, "b": 9, "kind": "focus", "special": "splitter", "intro": true },
    { "a": 2, "b": 5, "kind": "review", "special": "freeze", "species": "chillby" },
    { "a": 2, "b": 6, "kind": "new", "lantern": true, "species": "pebbit", "shiny": true }
  ],
  "golden": [ { "a": 1, "b": 7 } ],
  "mini_pool": [ { "a": 2, "b": 3 }, { "a": 2, "b": 7 }, { "a": 2, "b": 8 } ],
  "boss": null
}
```

| Key | Default | Meaning |
|---|---|---|
| `seed` | 1 | Seeds positions, arcs, species fallback, golden timing. |
| `round_type` | `"normal"` | `normal`, `tutorial`, `boss`, `mixup`, `quick_check`. |
| `event` | null | `golden_hour`, `bubble_breeze`, `night_glow`, `monster_parade`, `sticker_storm`. |
| `band` | `"little"` | `little` (reforge 1.0 s, max on screen capped at 3, monster ≥ 17 % of height) or `big` (1.2 s, 15 %). |
| `target_ms` | 6000 | Fluency target: "fast" means `rt_ms ≤ target_ms`; speed bonus uses it. |
| `speed` | `{base:0}` | Adaptive input (below). Or `{x: 2.3}` to fix x (no adaptation). Explicit `flight_time`, `spawn_interval`, `max_on_screen` override (debug). |
| `deck` | required | Ordered slots (below). N = deck length. |
| `golden` | [] | Extra Goldfluff monsters (not in the deck), `{a, b, species?, intro?}`. The engine launches each at a random point between 20 % and 80 % of the deck. |
| `mini_pool` | [] | Facts Splitsy minis can use (Focus pool of the current table). |
| `boss` | null | For `round_type: "boss"`: `{ "species": "bloop", "hp": 12 }`. |
| `reforge_s` | from band | Override. |
| `calm` | false | Same as `setCalm`. |

Deck slot keys: `a`, `b` (display form: `a×b` is shown as written), `kind`
(`warmup`, `new`, `tricky`, `review`, `focus`, `easy`; copies the engine inserts
are `repeat`), `ghost` (first appearance of a new fact: shows `a×b = c` with the
answer at 40 %), `tricky` (Comeback tag: bandage, flight × 1.15), `tricky_need`
(remaining correct answers to clear tricky; the engine plays "Fixed it!" when a
graded correct brings it to 0; ungraded repeat copies don't count, and only a
graded wrong resets it), `lantern` (second appearance of a new fact: a lantern
flies to the `island` anchor on a correct), `special` (`armored`, `freeze`,
`splitter`; golden comes from `golden`), `intro` (first ever appearance of this
special: 2 s intro card before it launches), `species` (id below; default: a
species picked from the seed), `shiny`.

Inserted copies (§2.5) never replace a slot with `intro: true`, so every intro
the shell planned is shown (the copy goes further back or is appended).

Unknown ids or values in the config are replaced by defaults and reported as
`warning` events (also logged by `engine.js`); a missing or malformed `deck`
makes `startRound` throw.

Flight multipliers the engine applies: `new` × 1.30, `tricky` × 1.15, minis × 1.20,
Bubble Breeze × 1.25.

### Speed input (`speed`)

`{ "base": 0..4, "level": 1.., "offset": 0.0, "recent": "CWE..." }` (`recent` = last up
to 8 first-try results across rounds, newest last, `C`/`W`/`E`.)

The engine computes `x_eff = clamp(base + min(0.5, 0.02(level−1)) + offset, max(−1, base−1), min(5, base+1.5))`,
and updates `offset` after each first-try resolution of a deck sum by the §3.3 table
(fast correct +0.05, combo 10 +0.05 once, wrong −0.10, escape −0.12 / −0.05 during
reforge, ease trigger −0.15 + gentle mode), with the rise gate (≥ 75 % over the last
8) and per-round caps (+0.35 / −0.80). Changes apply to the next spawn.
Boss rounds use `x_eff − 0.5` and do not update `offset`. Tutorial uses
`min(x_eff, 0)` and does not update `offset`. Golden monsters and Splitsy minis do
not affect `offset` or `recent`.

The shell applies the between-round rules to `offset` before passing it in, and
saves `offset_end` and `recent_end` from the summary.

## Rules the engine applies (DESIGN refs)

- **Spawning (§2.8, §3.2)**: first spawn 1.0 s after start; spawn when
  `sinceLast ≥ interval` and `onScreen < maxOnScreen`; lull rule (nothing on screen and
  ≥ 0.8 s → spawn now); +1.0 s after a wrong; no spawns after 100 s (not in boss
  rounds); the deck front must not share an answer or fact with anything on screen,
  else look ahead 4 slots and swap, else retry in 300 ms. Tutorial: max 1 on screen
  for the first 4 sums.
- **Swipe rule (§2.8)**: every monster the stroke touches is collected. If one has
  `answer == charge`, it is sliced and the rest are left alone. If none matched by the
  end of the stroke (pointer up, or 0.6 s after the first touch), the blade breaks
  on the first one touched. Grazing a wrong monster on the way to the right one is
  never punished. No charge: harmless. Blade broken: harmless.
- **In-round repetition (§2.5)**: wrong → copy 3 slots behind the front (replacing a
  focus/review/easy/warmup slot from there on; else appended), second wrong 4 back,
  ≤ 2 inserts and ≤ 4 appearances per fact; escape → copy 4 back, once per fact; at
  most 4 appended slots. Boss rounds: wrong/escape → copy to the back, no limits.
- **Wrong (§7.4)**: hit-stop 150 ms, shatter, purple vignette, monster freezes 1.5 s
  at 1.6× showing `a×b = c` (c in gold), others at 50 % speed; then it continues
  with the fact and a soft glow and can be re-sliced ("Fixed it!", 25 points, no
  combo, not graded). Reforge 1.0/1.2 s, or 2.0 s with a thinking-cloud hint after 3
  wrongs within 8 s. Charge cleared.
- **Correct (§7.2)**: hit-stop 60 ms, slash flash, squash, pop with confetti in
  species colours, stars, freed face, `+points` in combo colour, coins to the
  `sparks` anchor, 4 px shake.
- **Points (§4.1)**: `base × comboMult + speedBonus`, base 100 (golden 300, mini 50,
  armored inner pop 50), boss defeat +500, re-slice 25 flat. Combo tiers 5/10/15/25 →
  ×2/×3/×4/×5. Golden, mini and cracked-armored escapes don't reset combo.
- **Specials (§6.1)**: Goldfluff (sparkles, 300 pts, coin shower); Clonkshell (first
  correct cracks the shell, graded; the charge is kept; the inside shows the other
  form and drifts 25 % slower; a new swipe with the same charge pops it, not graded);
  Chillby (pop → everything else 50 % for 5 s, spawn timer paused 5 s); Splitsy (pop →
  2 minis from `mini_pool` with distinct answers, 70 % size, max on screen +1 while
  they live).
- **Boss (§6.3)**: Grand form at top centre (40 % of height), `hp` hearts; minions
  launch from the boss and arc down and out; each correct → sparkle beam, −1 heart,
  bonk face; at 0 → tickled, shrinks, fireworks ×3, round ends. No fail, no timer.
- **Events (§6.4)**: golden_hour (sunset palette), bubble_breeze (bubbles, flight ×
  1.25, max on screen +1), night_glow (dark sky, glowing monsters, fireflies),
  sticker_storm (sticker bursts on pops), monster_parade (visual only; the shell sets
  the species). Mix-Up rounds get a confetti sky.
- Limits: ≤ 800 live particles, ≤ 3 flashes a second.

## Events

Every event has `type`. Facts are `{"a":3,"b":4,"op":"mul","answer":12}` with `a`,`b`
as displayed.

| type | Fields |
|---|---|
| `round_start` | `round_type`, `event`, `sums`, `x` |
| `spawn` | monster fields* |
| `special_intro` | `special`, `species` (the 2 s card is showing) |
| `correct` | monster fields*, `rt_ms`, `fast`, `points`, `combo`, `mult`, `graded`, `tricky_cleared`, `lantern` |
| `armor_crack` | `id`, `fact` (the graded `correct` comes with it), `inner` (the other form) |
| `fixed` | `id`, `fact`, `points` (re-slice after a wrong) |
| `wrong` | monster fields*, `given`, `graded` |
| `escaped` | monster fields*, `graded`, `blade_ready` |
| `combo` | `n`, `tier` (0–4), `name` (`""`, `"Hot!"`, `"Blazing!"`, `"Super!"`, `"Mega!"`), `tier_up` |
| `combo_break` | `was`, `reason` (`wrong` / `escaped`) |
| `charge_cleared` | — |
| `blade_broken` | `reforge_s`, `guard` (true when the guessing guard made it 2.0 s) |
| `blade_ready` | — |
| `freeze` / `unfreeze` | — |
| `split` | `id`, `minis` (facts) |
| `boss_hit` | `hp`, `max_hp` |
| `boss_defeated` | `species` |
| `speed` | `x`, `offset` (after an in-round change) |
| `sfx` | `name` (manifest id), `semitones?` — also sent to `onSfx` |
| `warning` | `message` (bad config value; also `console.warn`) |
| `round_end` | `summary` |
| `context_lost` | — (from `engine.js`, not the wasm queue). The WebGL context is gone: the sim is held (no time passes, the current stroke is dropped) and the canvas shows nothing. The shell should pause the round (show its pause screen). |
| `context_restored` | — Program, buffers and the glyph atlas were rebuilt; the sim runs again (unless the shell paused it with `setPaused`). |
| `context_restore_failed` | `message` — rebuilding failed; the shell may offer a reload. |

\* Monster fields: `id`, `fact`, `slot` (deck index, null for golden/minis/minions),
`kind`, `special`, `species`, `shiny`, `ghost`, `mini`, `golden`, `boss_minion`.

### Summary

```json
{
  "aborted": false, "round_type": "normal", "event": null, "seed": 918273,
  "sums": 15, "correct": 12, "wrong": 2, "escaped": 1,
  "accuracy": 0.8, "median_rt_ms": 4100,
  "score": 3920, "best_combo": 7, "golden_sliced": 1, "minis_correct": 2,
  "fixed": 1, "tricky_cleared": [{"a":3,"b":2}],
  "x_start": 0.10, "x_end": 0.22, "offset_start": 0.12, "offset_end": 0.24, "recent_end": "CCWCCECC",
  "boss_defeated": false, "hard_stopped": false, "unplayed": 0, "duration_ms": 74000,
  "results": [
    {"result":"correct","graded":true,"rt_ms":3100,"fast":true,"given":12,"fact":{...},
     "slot":0,"kind":"warmup","special":null,"species":"bloop","shiny":false,"mini":false,"golden":false,"ghost":false}
  ]
}
```

`median_rt_ms` is null when there is no graded correct. Each `results` entry
carries the monster fields* plus `result`, `graded`, `rt_ms` (also for wrongs:
time from spawn to the wrong), `fast`, `given` (null for escapes).

`correct`/`wrong`/`escaped`/`accuracy` count first-try graded deck sums only (golden and
minis count only when correct, per §4.2). `results` lists every resolution in order,
including ungraded ones (`graded: false`: armored inner pops, re-slices are not
listed — see `fixed`).

## Sound ids the engine emits

From `web/assets/audio/manifest.json`: `sfx_swipe_whoosh`, `sfx_swipe_empty`,
`sfx_slice_correct`, `sfx_pop_confetti`, `sfx_coin_tinkle`, `sfx_combo_up_1..4`,
`sfx_combo_mega`, `sfx_combo_break`, `sfx_blade_shatter`, `sfx_wrong_reveal`,
`sfx_blade_reforge`, `sfx_fixit`, `sfx_escape`, `sfx_monster_launch_1..3`,
`sfx_monster_giggle_1..3`, `sfx_golden_appear`, `sfx_golden_pop`, `sfx_armor_crack`,
`sfx_split`, `sfx_freeze`, `sfx_unfreeze`, `sfx_boss_enter`, `sfx_boss_hit`,
`sfx_boss_defeat`, `sfx_shiny`, `sfx_item_reveal` (special intro card),
`sfx_lantern_light` (lantern reaches the island), `sfx_round_start`, `sfx_round_end`, and voices
`vo_hot`, `vo_blazing`, `vo_super`, `vo_mega`, `vo_fixed_it`, `vo_golden`,
`vo_boss_time`, `vo_boss_defeated`.
`input.js` emits `sfx_key_tap` (with `semitones`) and `sfx_backspace`.
The shell owns `sfx_charge_hum` (play while `charge != null`).

## Ids

Species (DESIGN §5.3; lowercase, `grand_` prefix for Grand forms):
`bloop snibbet pebbit duodle fluffnik tenzel quillip fivvy mossnug trillo zigglet
puffwhirl glimmop quadbun drizzlewing ninoo crumbit wobblehorn gloomp ochtle
flutterknot sevvle grumblebun dozzle`, specials `goldfluff clonkshell splitsy chillby`,
Grands `grand_bloop grand_pebbit grand_fluffnik grand_quillip grand_mossnug
grand_zigglet grand_glimmop grand_drizzlewing grand_crumbit grand_gloomp
grand_flutterknot grand_grumblebun`.

Blades (§5.5): `starter_wand leaf_blade candy_swirl crystal rainbow_ribbon starlight
carrot_sword feather_quill icicle golden_blade lightning_rod summit_blade shore_saber`.

Trails (§5.5): `plain sparkle bubbles hearts music_notes comet_tail falling_leaves
snowflakes paw_prints confetti pixel_stars rainbow moss_glow`.

Unknown ids fall back to the default (`bloop` / `starter_wand` / `plain`) with a
console warning.

## Raw `Game` (wasm)

`engine.js` is the supported surface; for reference the wasm class has
`new Game(canvas, font)`, `resize(css_w, css_h, dpr)`, `start_round(json)`, `stop_round()`,
`set_speed_params(json)`, `set_charged(n?)`, `charged()`, `set_calm(b)`,
`set_cosmetics(json)`, `set_anchor(name, x, y)`, `species_ids()`, `blade_ids()`,
`trail_ids()` (JSON arrays), `pointer_down/move/up(x, y, t)`, `pointer_cancel()`,
`frame(dt_ms)`, `drain_events()` (JSON array or `""`), `set_paused(b)`,
`set_effects_scale(s)`, `round_state()`, `score()`, `combo()`, `round_time()`,
`speed_x()`, `stats()`, `monsters()`, `debug_burst(n)`. `set_facts` is gone (the deck
carries the facts).

A separate `Portrait` class (`new Portrait(canvas)`, `draw(json) -> PNG data URL`,
json = `{species, size, shiny, silhouette, mood, time}`) backs `Engine.portrait`.
JSON-taking methods throw a string on bad input, including input over 256 KB
or nested deeper than 32 levels. `context_lost()`, `context_restored()` (throws on
failure) and `is_context_lost()` back the context-loss handling in `engine.js`.
`Portrait.draw` throws `"WebGL context lost"` when its canvas lost the context;
`Engine.portrait` then retries once on a fresh canvas.
