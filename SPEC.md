# Math Missile — game spec (v1: times tables)

Agreed with Kenth on 2026-11-05. This is what we are building. The detailed
progression and reward design comes from the game-mechanics designer and goes in
`DESIGN.md`; where the two disagree, this file wins until we change it.

## Players
- Mixed ages (siblings). Each child has a **profile** (pick an avatar), with its own
  progress, tables, speed and rewards. Saved in the browser only (localStorage).
- English only.
- Plays equally on **tablet (touch)** and **computer (mouse + keyboard)**.

## Theme
- Cute **monsters / creatures** fly up across the screen (arcing throws, like a
  slicing game, but our own look). Each monster carries a sum, e.g. `5×4`.
- Must not copy any existing game's art, names, sounds or levels.

## Core loop
1. Monsters with sums fly up and arc across the screen.
2. The child **types a number** — this *charges the blade* with that number
   (shown glowing on the blade/HUD). The charged number stays until used or changed.
   - Computer: physical keyboard digits (Backspace clears).
   - Touch devices: big on-screen 0–9 pad (only shown on touch).
3. The child **swipes the monster** they think it answers.
   - Right: big, juicy slice — monster pops into confetti, stars, coins, XP.
   - Wrong: **the blade breaks** dramatically (shatter, shake, sound), takes a
     moment to reforge. The monster flashes the right fact (`5×4 = 20`), and that
     fact **comes back more often** until answered right a few times.
   - Swiping with no number charged does nothing.
4. Monsters that fly off unanswered: **small cost** — breaks the combo streak and a
   little less XP. No lives lost.
- **No game over.** Mistakes are dramatic but gentle.

## Tables and progression
- Tables **1 to 12** (up to 12×12).
- **Guided path**, felt as levelling up: easy tables first (1, 2, 5, 10, then 3, 4,
  11, then 6–9, 12 — exact order from the designer). New tables unlock by mastery
  and speed. Parent can override.
- **Many kinds of rewards and level-ups** so the child keeps earning things as
  they get better and faster (designer's job: XP/levels, unlockables, collections,
  surprises, bosses, etc.).

## Sessions
- **Short rounds**: ~60–90 s or ~15 sums, then a big reward screen
  (stars, XP, loot).

## Speed
- **Base speed** set per child in the **parent area** (e.g. Snail → Rocket).
- **Adaptive speed**, up and down: rises with level and streaks, quietly eases off
  after a few misses, to keep the child in the "just right" zone.

## Parent area
- Behind a simple parent gate.
- Per child: base speed, table override, and a simple progress view (mastered facts,
  tricky facts, time played).

## Look and feel
- Very rewarding: lots of visual effects (particles, screen shake, combos, trails,
  confetti, level-up fanfare).
- Big targets and very little text, readable by young children.

## Audio
- Sound effects and music generated with **ElevenLabs** (Kenth provides
  `ELEVENLABS_API_KEY`). Files are generated once and committed; the game never
  calls ElevenLabs at runtime and the key never ships in the site.
- Voice for **praise and menus only** (e.g. "Awesome!", "Level up!"), not every sum.

## Tech
- Game engine in **Rust → WebAssembly**, rendering with **WebGL**; thin JS/HTML shell
  for input, audio and storage.
- Static site, deployed to **GitHub Pages**.
- Designed so other maths (addition, division …) can be added later as new
  "problem sources" without rewriting the game.

## Acceptance criteria (v1)
1. A child can create a profile, pick an avatar and play a round on both a touch
   tablet and a computer.
2. Monsters show `a×b` sums for the unlocked tables; typing then swiping a correct
   monster slices it; a wrong one breaks the blade and shows the correct fact.
3. Missed facts reappear more often until answered correctly several times.
4. Base speed is adjustable in the parent area and adaptive speed moves up and down.
5. Rounds end in a reward screen; XP, levels, unlocks and table progression persist
   per profile across reloads.
6. Parent area shows mastered and tricky facts per child.
7. Runs smoothly (target 60 fps) on a mid-range tablet browser.
8. Builds to a static site that runs from GitHub Pages.

## Decisions after DESIGN.md (2026-11-05)
- Narrator voice: neutral English, warm, friendly and supportive.
- **Sparks shop stays** (earned only, never bought). In addition, **real-life
  rewards**: in the parent area a parent adds custom rewards as free text plus a
  Sparks price (e.g. "Snickers bar — 300 Sparks"). The parent area helps set the price:
  it shows how long that price takes to earn at this child's current pace (rounds and
  play days, from their recent average Sparks per round; design defaults for a new
  child). The child sees these in the shop and taps "Ask for it"; the Sparks are only
  spent after a parent confirms through the parent gate. Redemptions are logged.
- **Gentle break nudge** after ~20 minutes of play (a friendly monster suggests a
  break, never forced); parent can change the minutes or turn it off.
- Profile setup asks the child's age (stored locally) for young/older defaults.
  **No placement check**; parent can unlock tables manually.

## Open items
- ElevenLabs API key (Kenth).
- GitHub repo for Pages (GitHub not yet connected here).
- Rust toolchain to install on this Mac (rustup, wasm32 target, wasm-pack).
