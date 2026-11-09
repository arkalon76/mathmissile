# Math Missile — game mechanics design

Author: game-mechanics designer, 2026-11-05. Companion to `SPEC.md`. **SPEC.md wins**
wherever the two disagree.

This file covers progression, levelling, rewards, variety, pacing, adaptive speed and
spaced repetition, with enough numbers that an engineer can build it without asking.
Every section is tagged **[v1]** or **[Later]**. §9 has the summary list.

All numbers here are starting values. Put every one of them in a single tuning file
(for example `tuning.json` or a Rust `const` module) so they can be changed after
playtests without touching logic.

---

## 0. Glossary and ground rules

| Term | Meaning |
|---|---|
| **Fact** | An unordered pair `{a,b}` with 1 ≤ a ≤ b ≤ 12. There are **78 facts**. Key: `"3x4"` (smaller number first). |
| **Display form** | The way a fact is shown on a monster: `3×4` or `4×3`. |
| **Table T** | The 12 facts `{T,n}` for n = 1..12. A fact belongs to two tables (or one if it is a square). |
| **Home table** | The first table in path order (§1.1) that contains the fact. This is where the fact is *introduced*. |
| **Sum** | One monster carrying one fact during a round. |
| **Resolution** | What happens to a sum: `correct` (first try), `wrong` (blade broke on it), `escape` (left the screen unanswered). |
| **RT** | Response time for a correct slice, in ms (precise definition in §2.7). |
| **Box** | Spaced-repetition level of a fact, 0..5 (§2.2). |
| **Target** | The profile's fluency target, in ms (§1.3). |
| **Round** | One play session of N sums, about 60–90 s, ending in the reward screen. |
| **Day** | The device's local calendar date, `YYYY-MM-DD`. |

Kindness rules. These apply everywhere and the engineer should treat them as hard rules.
1. Nothing is ever taken away from the child: no lost XP, levels, items, stars, crowns,
   badges or dex entries. Points are never subtracted.
2. The child never sees a count of wrong answers. Wrong and tricky counts are shown only
   in the parent area.
3. No pay mechanics, no ads, no real money, no timers that say "come back in 3 hours".
4. No streak that can break. Play days are counted as a total, never as consecutive days.
   There is never a "you missed a day" message.
5. Random rewards never give duplicates and always contain something (§5.6).
6. Every round ends with at least 1 star and something new on the reward screen
   (§5.10 explains how this is guaranteed).

---

## 1. Table path and mastery  [v1]

### 1.1 Path order

The guided path has 12 **islands**, one per table, in this order:

| Step | Table | Stage | New facts it introduces (the facts not already in an earlier table) |
|---|---|---|---|
| 1 | **1** | A "Sunny Shore" | 12 (1×1 … 1×12) |
| 2 | **2** | A | 11 |
| 3 | **10** | A | 10 |
| 4 | **5** | A | 9 |
| 5 | **3** | B "Mossy Hills" | 8 |
| 6 | **11** | B | 7 |
| 7 | **4** | B | 6 |
| 8 | **9** | C "Cloud Peaks" | 5 |
| 9 | **6** | C | 4 (6×6, 6×7, 6×8, 6×12) |
| 10 | **8** | C | 3 (8×8, 8×7, 8×12) |
| 11 | **7** | C | 2 (7×7, 7×12) |
| 12 | **12** | D "Star Summit" | 1 (12×12) |

Total = 78. Because of commutativity, the harder tables later on the path bring fewer
new facts. This is deliberate: the child arrives at the 7s already knowing 10 of the 12.
The game says so out loud when an island opens: "You already know 10 of these!" (the
island's lanterns that are already lit glow one by one, see §7).

Order inside a table: when a table introduces its new facts, it takes them in the same
order as the path: multiplier 1, 2, 10, 5, 3, 11, 4, 9, 6, 8, 7, 12, skipping facts that
are already introduced. Example, table 3: 3×1, 3×2, 3×10, 3×5, 3×3, 3×11, 3×4, 3×9,
3×6, 3×8, 3×7, 3×12 (3×1, 3×2, 3×10 and 3×5 were already met on islands 1, 2, 10 and 5,
so the 3s island introduces 3×3, 3×11, 3×4, 3×9, 3×6, 3×8, 3×7, 3×12).

### 1.2 Fact states (per fact)

A fact's state is derived from its saved fields (§8). It is never stored separately.

| State | Rule | Child-facing look (lantern on the island map) |
|---|---|---|
| **Locked** | Home table not yet open | No lantern |
| **New** | Home table open, fact not yet introduced | Unlit lantern |
| **Learning** | introduced, box 0–1 | Lantern flickers |
| **Growing** | box 2 | Lantern half lit |
| **Known** | box 3–4 | Lantern lit (warm yellow) |
| **Mastered** | box 5 | Lantern gold, with a little crown |
| **Tricky** (flag, on top of the above) | `tricky == true` | Lantern has a small "sparkle needed" swirl. It never goes dark. |

Child-facing lanterns show the **highest state ever reached** (`bestBox`, §8) so a light
never goes out. A fact that turns tricky only gets the swirl, which is framed as a
chance ("Glow it up!"). Fact selection always uses the real current `box`.

### 1.3 Fluency target

`targetMs` is the RT a fluent child of this profile should reach. It defaults from the
base speed tier (§3.1) and the parent can change it in steps of 0.5 s:

| Base tier | Snail | Turtle | Bunny | Cheetah | Rocket |
|---|---|---|---|---|---|
| Default `targetMs` | 6000 | 5000 | 4000 | 3500 | 3000 |

RT includes typing the number and swiping (§2.7), so these targets are looser than pure
recall times. That is intended.

A correct answer is **fast** when `RT ≤ targetMs`.

### 1.4 Fact mastery: box rules

The box goes from 0 to 5. On each **first-try resolution** of a fact in a normal round:

| Event | Box change |
|---|---|
| Correct and fast | `box += 1` |
| Correct, not fast | `box = min(box + 1, 3)`. If box is already 3 or more, no change. |
| Wrong | `box = max(0, box − 2)`, or `box − 1` if box was 3 or more; `tricky = true`; `trickyNeed = 3` |
| Escape | No box change. The fact stays due and is re-queued in the round (§2.5). |

Limits on going up:
- **At most +1 box per fact per round.** Repeats in the same round still update stats
  and `trickyNeed`, but the box rises no more than once per round.
- **3 → 4 needs a new day**: allowed only if `today > dayReachedBox3`.
- **4 → 5 needs a new day** (`today > dayReachedBox4`) **and both display forms answered
  correctly at least once** (`orient.ab && orient.ba`; squares count as both). If only one
  form is missing, fact selection forces the missing form (§2.6).

What this means:
- **Known** (box 3) = correct in at least 3 different rounds. It can be reached in one day.
- **Mastered** (box 5) = Known, then correct *and fast* on 2 more later days, with both
  forms. In other words, fast recall on 3 different days.

Tricky flag: every correct answer (including repeats in the same round) does
`trickyNeed -= 1`. When `trickyNeed` reaches 0, `tricky = false` and the "Fixed it!"
moment plays (+15 XP, §4.4). A wrong answer resets `trickyNeed = 3`. This meets SPEC:
"comes back more often until answered right a few times".

### 1.5 Table mastery and unlocking

Table states: `locked → open → known → mastered`.

- **Open**: the island is reachable and its new facts are being introduced.
- **Known** (this unlocks the next island). All of these must hold:
  1. At least 10 of the table's 12 facts have box ≥ 3 and none is below box 2.
     **Accuracy kindness valve**: once the table has been in 8 rounds without becoming
     Known, at least 9 facts with box ≥ 3 is enough (no floor).
  2. The median `rtEmaMs` of the table's 12 facts is ≤ `1.5 × targetMs` (the speed part
     of "unlock by mastery and speed").
  3. **Kindness valve**: if condition 1 has held for 8 rounds that included this table
     but condition 2 still fails, condition 2 is dropped for this table. No child stays
     stuck on one island.
  A round "includes" a table (for both valves) only when at least 3 of its graded sums
  contain that number, so a stray 1×7 does not count toward ×1.

  When a table becomes Known, the **next round is its Boss round** (§6.3). After the
  boss is beaten (which always happens), the next island opens and the reward bundle
  in §5.9 is given.
- **Mastered**: all 12 facts have box 5. The island gets a gold crown, a big chest and
  the table's Crown badge. A crown, once earned, is permanent.

Only one island is "current" at a time: the earliest island in path order whose table
is open and not Known. Known islands feed review (§2.3).

**Parent override** (parent area):
- *Guided* (default): as above.
- *Choose tables*: the parent ticks any set of tables as open. The current table is the
  earliest ticked table in path order that is not Known. Unlocking via override never
  gives boss rewards by itself, but those islands' bosses can be played from the map at
  any time once the table is Known.
- *Reset a fact* or *Reset a table* (sets box 0, keeps history). Behind a confirm.

### 1.6 Mixed review

Mixed review is built into every round once at least one table is Known:
- About 25 % of each normal round's slots are **Review** slots, drawn from Known tables
  by due date (§2.3).
- The 2 warm-up slots at the start of each round are easy Known facts.
- Every 5th round (once 2 or more tables are Known) is a **Mix-Up round** (§6.4) made
  only of review.
- Bosses review the whole table, not only the new facts.

### 1.7 How a 6-year-old and a 9-year-old differ

When a profile is created, the child taps "How old are you?" (big buttons 5 6 7 8 9 10).
Age sets the **age band** and the defaults. The parent can change all of them later.

| Setting | Little band (age 5–7) | Big band (age 8–10) |
|---|---|---|
| Default base tier | age 5–6: Snail, age 7: Turtle | age 8–9: Bunny, age 10: Cheetah |
| Start | Island 1, round 1 is the tutorial | Tutorial round, then the **Quick Check** offer (below) |
| New facts per round (`newPerRound`) | 2 | 3 |
| Learning-load cap (`loadCap`): max facts in box 0–1 before no more new ones are introduced | 4 | 6 |
| Tricky slots per round | max 2 | max 3 |
| Sums per round | tier N − 3 (min 12) | tier N (§3.1) |
| Max monsters on screen | tier value, capped at 3 | tier value |
| Ghost answer on a new fact's first appearance | yes | yes |
| Blade reforge time | 1.0 s | 1.2 s |
| Missing-number monsters (`?×4=20`) | never | from island 8 [Later] |

Table overrides for `newPerRound` (both bands): table 1 → 6, table 10 → 4. These are
pattern tables, so they can go faster.

**Quick Check (big band only, optional)**: after the tutorial, the game offers a
"Show what you know!" button or "Start at the beginning".
- A placement round has 20 sums at the base tier. The ghost answer is off and no stars
  are given (it shows a "Quick Check complete!" card and normal XP instead).
- Round 1 draws evenly from tables 1, 2, 10 and 5.
- A fact answered correctly *and fast* in a placement round gets box 3 straight away
  (`dayReachedBox3 = today`). Mastered still needs 2 more days, like everyone else.
- A wrong answer in placement does **not** set `tricky`. It only leaves the fact New.
- If placement accuracy is ≥ 85 %, a second placement round is offered for tables 3, 11
  and 4, then a third for 9, 6, 8, 7 and 12. Placement stops at the first round under
  85 %, or when the child taps "Play now".
- Any table that is Known after placement is marked Known straight away (boss skipped)
  and its island's rewards are given at once, **except** for the boss-only items. Those
  bosses wait on the map with a "Boss waiting!" flag so the child can beat them for fun
  and get the boss reward. Skipping ahead never costs the child a reward.

Worked example. Mia (6, Snail, target 6 s) spends her first week on islands 1, 2 and 10.
She sees 2 new facts a round, at most 2 monsters at a time, with 11 s flights. Leo (9,
Bunny, target 4 s) uses Quick Check, places through islands 1–5 in about 3 rounds, and
starts on the 11s. He gets 3 new facts a round, up to 3 monsters at a time, 7.5 s
flights, and Splitters early because of his path position.

---

## 2. Fact selection per round  [v1]

### 2.1 Overview

At round start the game builds a **deck**, which is an ordered queue of N fact slots.
During the round, monsters are launched from the front of the deck. Wrong answers and
escapes insert extra copies further back. The round ends when the deck is empty and no
monsters are left on screen.

### 2.2 Spacing intervals

A fact is **due** when both of these hold:
`roundsSince ≥ R[box]` and `daysSince ≥ D[box]`

| box | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| R (rounds since last seen) | 0 | 1 | 2 | 4 | 8 | 16 |
| D (days since last seen) | 0 | 0 | 0 | 0 | 1 | 3 |
| B (base weight) | 8 | 6 | 4 | 2 | 1 | 0.5 |

`roundsSince = profile.roundIndex − fact.lastSeenRound`. `roundIndex` counts all rounds
the profile has played. `daysSince` is the number of calendar days since
`fact.lastSeenDay`.

### 2.3 Weight formula

For each fact `f` that can go in a bucket:

```
overdue  = (roundsSince − R[box]) / max(1, R[box])
dueMul   = isDue ? clamp(1 + overdue, 1, 4) : 0.25
trickMul = tricky ? 3 : 1
recentMul= (appeared in the previous round && !tricky) ? 0.5 : 1
w(f)     = B[box] × dueMul × trickMul × recentMul
```

Draw from a bucket by weighted random sampling **without replacement**. Use a seeded
PRNG per round, with the seed saved in round history so a round can be replayed for
debugging.

### 2.4 Building the deck

Let C = the current table and N = the number of sums for this round (§3.1, §1.7).
Fill the slots in this order:

1. **Warm-up (slots 1–2)**: 2 facts from the **Easy** pool (box ≥ 3, not tricky). If the
   pool is empty, use the introduced facts with the highest box. In the very first
   round, use 1×1 and 1×2 as ghosted new facts.
2. **New**:
   ```
   k = newPerRound
   if count(facts with introduced && box ≤ 1) ≥ loadCap: k = 0
   if previous round first-try accuracy < 60%:          k = 0
   if this is a Mix-Up / Revision round:                 k = 0  (events never change this, §6.4)
   k = min(k, remaining un-introduced facts in C)
   ```
   Take the next k un-introduced facts of C in §1.1 order. Each new fact gets **2 slots**:
   the first at a random slot from 3 to N−4, the second 3–5 slots later. The first
   appearance is **ghosted**: the monster shows `3×4 = 12` with the answer at 40 %
   opacity. That first appearance sets `introduced = true` and counts toward stats, but
   it does **not** change the box. The second appearance is normal.
3. **Tricky**: up to 2 (little) or 3 (big) slots, filled with facts where `tricky`,
   most recent wrong first. No two copies of the same fact closer than 3 slots apart.
4. **Review**: once at least one table other than C is Known,
   `r = round(0.25 × N)` slots, weighted-sampled from facts whose home table is Known
   (not C), excluding facts already placed.
5. **Focus**: every remaining slot, weighted-sampled from C's introduced facts (any box).
   A fact may fill at most 2 Focus slots, and its 2 copies must be at least 4 slots apart.
6. **Fallback**: if Focus runs out, fill from Review. If Review runs out too, fill from
   Easy. If every pool is empty (for example, only a few facts introduced so far),
   repeat introduced facts, still keeping copies at least 3 slots apart.

Typical make-up of a 15-sum little-band round on island 2: 2 warm-up, 4 new (2 facts ×
2), 2 tricky, 4 review, 3 focus.

### 2.5 In-round repetition

- **Wrong**: insert one copy 3 slots behind the current deck front. Because the deck has
  a fixed length, it **replaces** the Focus, Review or Easy slot that is there (never a
  New or Tricky slot). If no such slot is left, the copy is appended.
  A second wrong on the same fact in the round inserts again, 4 slots back. Never more
  than 2 inserts per fact per round, and never more than 4 appearances of a fact per round.
- **Escape**: insert one copy 4 slots back, at most once per fact per round.
- The deck can grow by up to 4 appended slots (from the "appended" cases). After that,
  extra copies are dropped. Those facts are still due next round anyway.

### 2.6 Display form (3×4 or 4×3)

- A fact's **first two appearances ever** (ghosted plus repeat) show the home table's
  number **first**: on the 3s island, 3×7 (not 7×3).
- From box ≥ 2, the form is random 50/50.
- From box ≥ 3, if only one form has been answered correctly, always show the missing
  form, so that 4→5 can happen.
- Squares: one form only, and they count as both.
- The two forms share one fact state, so learning 4×3 helps 3×4. The **Armored** monster
  (§6.1) teaches this openly.

### 2.7 Response time

```
tStart = max(monster.spawnTime + 400 ms,         // entry animation
             lastCorrectSliceTime,               // when the child finished the previous monster
             bladeReadyTime)                     // after a reforge
RT     = clamp(sliceTime − tStart, 300 ms, monster.flightMs)
```

Store per fact:
`rtEmaMs = (rtEmaMs == null) ? RT : round(0.6 × rtEmaMs + 0.4 × RT)`, from correct
first tries only, and the last 5 correct RTs in `recentRtMs`.

### 2.8 Spawning and on-screen rules

When the spawn timer fires (§3.2), take the deck front and check it against every
monster currently on screen:
- Its answer must **not equal any on-screen answer** (this rules out 3×4 next to 2×6,
  4×3 next to 3×4, and 2×6 next to 6×2).
- It must not be the same fact as a monster on screen.

If the front fails, look ahead up to 4 slots for the first slot that passes and swap it
to the front. If none pass, wait 300 ms and try again.

This uniqueness rule is what lets the swipe rule below be both simple and kind.

**Swipe rule** (the mechanics part of input). Collect every monster the swipe path
touches.
- If any of them has `answer == charge`, that monster is sliced (correct). The rest are
  left alone.
- If none matches and at least 1 was touched, the blade breaks on the **first** monster
  touched (wrong, recorded against that fact). Also store the confusion:
  `confusedWith[charge] += 1` on that fact.
- With no charge, the blade passes through harmlessly (a soft "whff" sound, no effect).

A wrong swipe that grazes a second monster on the way to the right one is never
punished.

---

## 3. Speed  [v1]

### 3.1 Tiers (parent sets the base)

Speed is one continuous **speed index x**. Each named tier is an anchor point:

| x | Tier (child name) | Flight time (s) | Spawn interval (s) | Max on screen | Sums per round N |
|---|---|---|---|---|---|
| −1 | Sleepy Snail (hidden, adaptive only) | 13.0 | 5.5 | 1 | 15 |
| 0 | **Snail** | 11.0 | 4.5 | 2 | 15 |
| 1 | **Turtle** | 9.0 | 3.8 | 2 | 16 |
| 2 | **Bunny** | 7.5 | 3.2 | 3 | 18 |
| 3 | **Cheetah** | 6.0 | 2.6 | 3 | 22 |
| 4 | **Rocket** | 5.0 | 2.1 | 4 | 26 |
| 5 | Rocket+ (hidden, adaptive only) | 4.2 | 1.8 | 4 | 28 |

- Flight time = total time a monster spends on screen from launch to exit.
- Between anchors, interpolate flight and interval linearly in x. Max on screen uses the
  value at `round(x)`. N uses the value at `floor(x)` of the round's starting x and is
  fixed for the round.
- Round duration is about N × interval + flight: roughly 60–80 s at every tier. The
  lull rule below makes good rounds shorter.
- Arc: launch from the bottom edge at x ∈ [15 %, 85 %] of width; apex at 22–40 % from
  the top; exit through the bottom edge (or the side edge for 20 % of launches, chosen at
  random). Each monster spends at least 60 % of its flight inside the central 70 % of
  the screen. Monster diameter is at least 15 % of screen height (17 % for the little
  band).

### 3.2 Spawning

- First spawn 1.0 s after "Go!".
- Spawn when `timeSinceLastSpawn ≥ interval` **and** `onScreen < maxOnScreen`.
- **Lull rule**: if `onScreen == 0` and `timeSinceLastSpawn ≥ 0.8 s`, spawn now. This
  rewards a quick child without making the game harder.
- After a wrong, the next spawn is delayed by an extra 1.0 s, so the child can read the
  correct fact.
- Hard stop: no spawns after 100 s of round time. Monsters still on screen then leave
  with no cost.

Per-monster flight multipliers (longer = slower):
- New fact: × 1.30
- Tricky fact: × 1.15
- Splitter minis: × 1.20
- Anything else: × 1.0

### 3.3 Adaptive formula

```
x_eff = clamp(base + levelDrift + offset,  max(−1, base − 1),  min(5, base + 1.5))
levelDrift = min(0.5, 0.02 × (level − 1))
```

`offset` is per profile and is saved. It is updated after every first-try resolution:

| Event | Δoffset |
|---|---|
| Correct, fast | +0.05 |
| Correct, not fast | 0 |
| Combo reaches 10 (once per round) | +0.05 |
| Wrong | −0.10 |
| Escape while the blade was ready | −0.12 |
| Escape during a reforge | −0.05 |
| **Ease trigger**: 2 or more misses (wrong or escape) in the last 4 resolutions | extra −0.15, and **gentle mode** for the next 3 spawns (interval × 1.3). Fires at most once every 4 resolutions. |

Gates and clamps:
- **Rise gate**: positive Δ applies only if first-try accuracy over the last 8
  resolutions is ≥ 75 %.
- **Per-round caps**: net change within one round is at most **+0.35** and at least
  **−0.80**. Speed eases off faster than it rises.
- A change applies to the **next** spawn only. A monster already in flight never changes
  speed.

Between rounds:
- At round start: `offset ×= 0.8` (a slight warm-up).
- First round of a new day: `offset ×= 0.5`, applied instead of the 0.8.
- When a new island opens: `offset −= 0.3`.
- Boss round: uses `x_eff − 0.5`, and the offset is not updated.
- Mix-Up round: normal.
- If the parent changes the base tier: `offset = 0`.

What this does: a child who answers fast keeps gaining about +0.3 a round, so roughly
one tier every 3 good rounds, capped at base + 1.5. Two misses close together ease
speed right away by about 0.35. The child sees no speed meter. The only visible sign is
a little speedometer on the reward screen whose needle moves to the current animal
(for example, it shows a Bunny with a sparkle when x went up). This is shown as praise,
never as a warning.

---

## 4. Scoring and XP  [v1]

### 4.1 Points (round score: juice and personal bests)

Per correct first-try sum:
```
points = 100 × comboMult + speedBonus
speedBonus = round(50 × clamp((1.5 × targetMs − RT) / (1.5 × targetMs), 0, 1))
```
- Golden monster: base 300 instead of 100.
- Boss minion: base 100. Hitting the boss itself: +500 at defeat.
- "Fixed it!" re-slice of a wrong monster (§7.3): 25 flat (no combo).
- Splitter mini: base 50.

Combo counts consecutive first-try correct sums. Wrong or escape resets combo to 0 (see
the note below). Golden and splitter-mini escapes do **not** reset combo.

| Combo | 0–4 | 5–9 | 10–14 | 15–24 | 25+ |
|---|---|---|---|---|---|
| Name shown | — | **Hot!** ×2 | **Blazing!** ×3 | **Super!** ×4 | **Mega!** ×5 |
| comboMult | 1 | 2 | 3 | 4 | 5 |

Note on combo: both wrong and escape reset it. If only escapes reset it, a child would
learn to guess at monsters that are about to leave. Nothing else is lost, and combo is
pure bonus.

Personal best: `bestScore[tier]` is kept per base tier, so a speed change doesn't make
old bests unfair. Beating it gives a "New best!" card.

### 4.2 Stars per round

| Stars | Condition |
|---|---|
| ★ | Round finished (always) |
| ★★ | First-try accuracy ≥ 70 % |
| ★★★ | First-try accuracy ≥ 90 % |
| ✦ Sparkle star (bonus 4th) | ★★★ and median RT ≤ targetMs |

`accuracy = correct / (correct + wrong + escapes)`, counting first-try resolutions of
deck sums only. Golden monsters and splitter minis count only if correct, so they can
only help.

### 4.3 Sparks (in-game currency, earned only, never bought)

Per round: `5 + 2 × stars + floor(correct / 5) + 5 × goldenSliced`. Chests: 10–20.
Typical round: about 18 Sparks. Spent in the Workshop (§5.5).

### 4.4 XP per round

| Source | XP |
|---|---|
| Round finished | 20 |
| Each correct first try | 10 |
| Each fast correct | +5 |
| First-ever correct of a fact (not counting the ghosted one) | +10 |
| Tricky fact fixed (`trickyNeed` reaches 0) | +15 |
| "Fixed it!" re-slice | +3 |
| Stars | 10 × stars (sparkle star counts as 1) |
| Best combo | 5 × floor(bestCombo / 5) |
| Golden monster | +10 each |
| Boss defeated | +100 |
| Welcome bonus (profile's first round only) | +50 |
| Wrong or escape | 0 (never negative) |

Typical 15-sum round with 12 correct, 6 fast, 2 new facts and 2 stars: about 220 XP.

### 4.5 Player level curve

XP needed to go from level L to L+1:
```
need(L) = 4 × (L + 4)²          for L ≤ 30
need(L) = need(30) = 4624        for L > 30   (flat, so later levels still come)
```
Max level 99. XP is cumulative and never lost.

| Level | XP to next | Total XP to reach | ≈ rounds to reach (220 XP/round) |
|---|---|---|---|
| 1 | 100 | 0 | 0 |
| 2 | 144 | 100 | 1 (round 1 guarantees it) |
| 3 | 196 | 244 | 2 |
| 4 | 256 | 440 | 2–3 |
| 5 | 324 | 696 | 3–4 |
| 6 | 400 | 1020 | 5 |
| 7 | 484 | 1420 | 6–7 |
| 8 | 576 | 1904 | 9 |
| 9 | 676 | 2480 | 11 |
| 10 | 784 | 3156 | 14 |
| 11 | 900 | 3940 | 18 |
| 12 | 1024 | 4840 | 22 |
| 13 | 1156 | 5864 | 27 |
| 14 | 1296 | 7020 | 32 |
| 15 | 1444 | 8316 | 38 |
| 16 | 1600 | 9760 | 44 |
| 17 | 1764 | 11360 | 52 |
| 18 | 1936 | 13124 | 60 |
| 19 | 2116 | 15060 | 68 |
| 20 | 2304 | 17176 | 78 |

At about 8 rounds a day, level 10 comes on day 2 and level 20 in about 10 play days.

---

## 5. Rewards  [v1 unless marked]

### 5.1 Reward types at a glance

| Type | Where it lives | How it's earned |
|---|---|---|
| Stars | Reward screen, island map total | Every round (§4.2) |
| XP and levels | XP bar on profile | Every round (§4.4–4.5). Each level gives an item (§5.2). |
| Titles | Under the avatar name | Every 5 levels |
| **Monster Book** (collection) | Book button on the map | Popping species (§5.3) |
| Blade skins | Workshop / Locker | Levels, badges, shop, bosses |
| Blade trails | Locker | Levels, chests, shop, badges |
| Avatar items (hats, faces, backs, colours) | Locker | Levels, chests, shop, sticker pages |
| Stickers | Sticker Album, 12 pages × 9 | 1 per round (§5.4) |
| Badges | Badge wall | Conditions in §5.7 |
| Surprise chests | Reward screen | Chest meter (§5.6), level 5s, bosses, crowns |
| Lanterns and crowns | Island map | Fact and table mastery (§1.2, §1.5) |
| Play days | Sun calendar | A sun for each day played, total count only (§5.8) |
| Sparks | Counter | Every round, spent in the Workshop |

### 5.2 Level rewards (levels 2–20)

| Level | Reward | Title (every 5) |
|---|---|---|
| 2 | Trail: Sparkle | |
| 3 | Hat: Party Hat | |
| 4 | Blade: Leaf Blade | |
| 5 | **Level Chest** | Pop Pal |
| 6 | Face: Star Specs | |
| 7 | Trail: Bubbles | |
| 8 | Blade: Candy Swirl | |
| 9 | Back: Tiny Cape | |
| 10 | **Level Chest** + new avatar colour set | Blade Buddy |
| 11 | Trail: Hearts | |
| 12 | Blade: Crystal | |
| 13 | Hat: Leaf Crown | |
| 14 | Trail: Music Notes | |
| 15 | **Level Chest** | Monster Mate |
| 16 | Blade: Rainbow Ribbon | |
| 17 | Face: Silly Moustache | |
| 18 | Trail: Comet Tail | |
| 19 | Back: Bubble Jetpack | |
| 20 | **Big Level Chest** + Blade: Starlight | Times Tamer |

After level 20: every level gives +20 Sparks. Odd levels also give one unowned item from
the level pool (§5.5). Every 5th level gives a Level Chest and a title.
Titles from 25 on: Sum Sprinter (25), Lantern Keeper (30), Island Hopper (35), Fact
Wizard (40), Star Captain (45), Number Knight (50), then "Legend" plus a roman numeral
every 10 levels.

### 5.3 Monster Book

Each island has 2 native species. Species A appears as soon as the island opens.
Species B appears after that island's boss is beaten (a new friend as the boss reward).
A fact's monster is drawn from its home island's species: 70 % A and 30 % B once B
exists.

| Island | Species A | Species B | Boss (Grand form) |
|---|---|---|---|
| 1 | Bloop (round jelly) | Snibbet (tiny bird-blob) | Grand Bloop |
| 2 | Pebbit (pebble frog) | Duodle (two-headed puff, friendly) | Grand Pebbit |
| 10 | Fluffnik (cloud sheep) | Tenzel (ten-toed lizard) | Grand Fluffnik |
| 5 | Quillip (soft hedgehog) | Fivvy (starfish sprite) | Grand Quillip |
| 3 | Mossnug (moss slug) | Trillo (three-eyed bug) | Grand Mossnug |
| 11 | Zigglet (zigzag worm) | Puffwhirl (spinning dandelion) | Grand Zigglet |
| 4 | Glimmop (glowing mop-pup) | Quadbun (four-eared bunny) | Grand Glimmop |
| 9 | Drizzlewing (rain moth) | Ninoo (nine-spotted owl) | Grand Drizzlewing |
| 6 | Crumbit (cookie critter) | Wobblehorn (jelly unicorn-ish) | Grand Crumbit |
| 8 | Gloomp (sleepy bat) | Ochtle (eight-legged cuddly crab) | Grand Gloomp |
| 7 | Flutterknot (ribbon fish) | Sevvle (seven-tailed fox) | Grand Flutterknot |
| 12 | Grumblebun (grumpy-cute loaf) | Dozzle (dozen-dot dragonlet) | Grand Grumblebun |
| Special | Goldfluff (golden), Clonkshell (armored), Splitsy (splitter), Chillby (freeze) | | |

That makes 40 entries: 24 species, 4 specials and 12 Grands. The lead should run a quick
search on the names before art is made. They are meant to be original.

Each species card has 3 friendship stamps:
- **Met**: first pop. Plays the "New monster!" card on the reward screen.
- **Friend**: 25 pops.
- **Best Friend**: 100 pops.

Stamps give +10 XP and +5 Sparks, shown on the reward screen.

**Shiny** variants (24, one per base species): from round 10 on, a monster of a species
already Met has a 1-in-50 chance of being shiny (shimmering palette swap). Popping it
fills the shiny slot. Never more than 1 shiny per round. [v1]

### 5.4 Stickers

The Album has 12 pages (one per island theme) × 9 stickers = 108 stickers.
- Each round gives **1 sticker**, chosen at random from the unowned stickers of the
  lowest incomplete page, so pages fill in order.
- The first round always gives sticker 1 of page 1.
- Sticker Storm event: 2 stickers.
- Completing a page gives +30 Sparks and one avatar item from the "album" pool. The first
  completed page also gives a badge.

### 5.5 Cosmetics catalogue and the Workshop

**Blades (12 here + Shore Saber from §5.9 = 13)**: Starter Wand (default), Leaf Blade (L4), Candy Swirl (L8), Crystal
(L12), Rainbow Ribbon (L16), Starlight (L20), Carrot Sword (shop 40), Feather Quill
(shop 80), Icicle (badge Chill Out), Golden Blade (badge Gold Rush), Lightning Rod (shop
150), Summit Blade (all 12 tables Known).

**Trails (12 here + Moss Glow from §5.9 = 13)**: Plain (default), Sparkle (L2), Bubbles (L7), Hearts (L11), Music Notes
(L14), Comet Tail (L18), Falling Leaves (shop 40), Snowflakes (shop 80), Paw Prints
(chest), Confetti (chest), Pixel Stars (chest), Rainbow (badge Rainbow Round).

**Avatar items (24 here + Cloud Cape from §5.9 = 25)**:
- Hats: Party Hat (L3), Leaf Crown (L13), Beanie (shop 40), Pirate Hat (shop 80), Wizard
  Hat (chest), Bunny Ears (chest), Chef Hat (album), Space Helmet (Times Table Legend
  badge).
- Faces: Star Specs (L6), Silly Moustache (L17), Rosy Cheeks (shop 40), Sunglasses (chest),
  Monocle (album), Face Paint Stars (chest).
- Backs: Tiny Cape (L9), Bubble Jetpack (L19), Butterfly Wings (shop 80), Turtle Shell
  (album), Dragon Wings (shop 150), Backpack (chest).
- Colour sets: Sunset (L10), Ocean (shop 40), Forest (chest), Candy (album).

Pools: **level pool** = everything not tied to a fixed level or badge.
**Chest pool** = items marked chest, then anything in the level or shop pool that isn't
owned. **Album pool** = items marked album.

**Workshop** (shop) opens in round 4 with a "Workshop open!" card. Prices are fixed and
shown up front, and every item is visible with its price. There are no rotating stocks,
no limited-time offers and no discounts that pressure. The reward screen shows a goal
bar for the item the child picked as a "wish", if any: tap a shop item → "Wish for
this", and progress shows as Sparks / price.

### 5.6 Surprise chests

- **Chest meter**: fills with stars. **6 stars = 1 Star Chest**, and the extra carries
  over. A typical child earns a chest about every 3 rounds. The lowest possible rate is
  every 6 rounds (1 star a round).
- Other chests: Level Chests (levels 5, 10, 15 and so on), the **Boss Chest** on every
  boss defeat, the **Crown Chest** on every table Mastered, and the **First-of-day Hello
  Chest**. The Hello Chest is small (Sparks 10 plus 1 sticker), comes in the first round
  of each day, and has no streak logic.
- Opening: the child taps the chest 3 times. It wobbles, then bursts.
- Contents:
  - Star or Hello Chest: Sparks (random 10–20) plus 1 unowned item from the chest pool.
  - Level, Boss and Crown Chests: Sparks 20–30 plus **2** unowned items.
  - If the chest pool is empty: give a sticker and +30 Sparks instead of each missing
    item.
  - Never a duplicate.

### 5.7 Badges (36 rows, 52 badges)

Each badge is earned once and is permanent. It gives +20 XP and +10 Sparks and appears
as a card on the reward screen.

| # | Badge | Exact condition |
|---|---|---|
| 1 | First Pop | First correct slice ever |
| 2 | Fix-It Kid | First time a tricky fact becomes un-tricky |
| 3 | Hot Streak | Combo 5 in a round |
| 4 | Blazing Streak | Combo 10 in a round |
| 5 | Mega Streak | Combo 25 in a round |
| 6 | Three Stars | First ★★★ round |
| 7 | Rainbow Round | First ✦ sparkle-star round |
| 8 | Perfect Round | 100 % first-try accuracy, ≥ 12 deck sums |
| 9 | Golden Catch | First golden monster popped |
| 10 | Gold Rush | 25 golden monsters total |
| 11 | Shell Cracker | First armored monster fully popped |
| 12 | Split Second | First splitter popped |
| 13 | Chill Out | First freeze monster popped |
| 14 | Boss Basher | 3 bosses beaten |
| 15 | Island Hero ×12 (one per table, counts as 12 badges in the wall, 1 row here) | That table's boss beaten (or placed through) |
| 16 | Halfway Hero | 6 tables Known |
| 17 | Times Table Legend | All 12 tables Known |
| 18 | Golden Crown | First table Mastered |
| 19 | Crown Collector | 6 tables Mastered |
| 20 | Grand Master | All 78 facts Mastered |
| 21 | Square Dancer | All 12 square facts (1×1 … 12×12) box ≥ 3 |
| 22 | Speedy Fingers | 10 fast correct sums in one round |
| 23 | Lightning Brain | Round median RT ≤ 0.5 × targetMs with ≥ 12 correct |
| 24 | Speed Climber | x_eff reaches base + 1.0 |
| 25 | Comeback Kid | A ★★★ round straight after a ★ round |
| 26 | Monster Friend | 10 species Met |
| 27 | Monster Book Complete | All 24 base species Met |
| 28 | Best Friends | Any species reaches Best Friend |
| 29 | Shiny Spotter | First shiny popped |
| 30 | Sticker Star | First album page complete |
| 31 | Sunny Days 3 / 7 / 14 / 30 (4 badges, 1 row) | Total play days 3, 7, 14, 30 |
| 32 | Hundred Club / Thousand Club / Five Thousand (3 badges, 1 row) | Total correct 100 / 1000 / 5000 |
| 33 | Mix Master | ★★★ in a Mix-Up round |
| 34 | Dress Up | First avatar item equipped |
| 35 | Shopkeeper's Friend | First Workshop purchase |
| 36 | Show What You Know | Finish a Quick Check (big band) |

That makes 52 badges on the wall in total, counting the rows of 12, 4 and 3.

### 5.8 Play days (the kind version of "streak days")

- A day counts once a round is finished on that day. The calendar gets a sun sticker for
  that day.
- Only the **total** count matters (badges at 3, 7, 14 and 30). Gaps are never shown as
  missing. There is no streak counter and no "don't break your streak".
- The first round each day adds +1 ⭐ to the chest meter ("👋 welcome back!") and plays a
  "Welcome back!" voice line. (No daily chest: chests come from stars, levels and bosses.)

### 5.9 Island completion bundle (on boss defeat)

When a boss is beaten, the child gets all of the following:
- Island Hero badge
- Boss Chest (2 items)
- Grand form added to the Monster Book
- Species B of that island appears from now on
- +100 XP
- The next island rises on the map (unlock animation, §7.6)

Island-specific extras:
- Island 2 (2 tables Known): the **Armored** monster arrives.
- Island 4 (Stage A complete): Blade "Shore Saber" (a 13th blade, only from here).
- Island 7 (Stage B): Trail "Moss Glow".
- Island 11 (Stage C): Avatar back "Cloud Cape".
- Island 12: Summit Blade comes with Times Table Legend.

### 5.10 Cadence: there's always something close

The reward screen always ends with a **"Next up" row**: the 3 nearest goals, each with
a progress bar. Pick them from the candidates below, ranked by % complete. At most one
of each kind.
- Next level item
- Chest meter
- Wish item
- Nearest unearned badge with a numeric condition
- Nearest species stamp
- Lanterns left on the current island

Guaranteed new thing every round:
- Every round gives 1 sticker. That is the floor.
- If a round would otherwise show nothing besides stars, XP and the sticker, add +5
  Sparks and a "Monster Book progress" nudge card.

Planned cadence for an average child (Snail or Turtle, about 75 % accuracy):

| When | What the child gets |
|---|---|
| **Round 1** (tutorial: 10 sums from table 1, x capped at min(base, 0), with an animated hand hint for "type then swipe") | ★ or more; **Level 2** (Welcome bonus guarantees it) → Sparkle trail; **First Pop** badge; **Bloop** Met; sticker 1; Sparks; the first lanterns flicker on island 1 |
| **Round 2** | Level 3 → Party Hat (and a prompt "Put it on!" → Dress Up badge); sticker; chest meter about 4/6; Hello Chest if it's a new day |
| **Round 3** | **First Star Chest**; first **golden monster** (guaranteed spawn, see §6.1) → Golden Catch badge; Level 4 → Leaf Blade |
| **Round 4** | **Workshop opens** (enough Sparks for a 40-Spark item); likely Hot Streak badge; sticker |
| **Round 5–6** | Table 1 Known → **first Boss**: Grand Bloop; Island Hero (1); Boss Chest; Snibbet appears; island 2 rises; Level 5 Level Chest + "Pop Pal" title |
| **First hour** (about 20–25 rounds) | Levels 2–12; islands 1, 2 and 10 Known (3 bosses → Boss Basher); Armored monster (around round 8) and Freeze (round 12); first Mix-Up round (round 10 or later); 6–8 chests; 7–9 species Met; 8–10 badges; sticker page 1 complete plus most of page 2 (Sticker Star); 2–3 Workshop items; first shiny is possible |
| **First week** (about 5 play days × 8 rounds) | Levels 15–18; islands up to 5 or 3 Known; **first Golden Crown** around day 3 (table 1 Mastered → Crown Chest); Sunny Days 3; about 13 chests; Splitter (round 16) and events (round 20+); 3–4 album pages; Friend stamps on Bloop and Pebbit; Hundred Club |
| **Week 2 and later** | Each new island = boss, 2 species and a chest. Crowns arrive as spaced mastery completes. Shinies, Best Friend stamps, Sunny Days 14/30, levels 20+ with titles. Later stages bring missing-number monsters and new events [Later]. |

---

## 6. Variety  [v1 unless marked]

### 6.1 Special monsters

Introductions are gated by **round count OR path position, whichever comes first**, so
variety arrives even for a child who is slow on the path. The first appearance of each
special plays a 2-second intro card ("New friend: Goldfluff! Pop it for treasure!"),
with art and 3 words, and is guaranteed to appear in that round.

| Monster | Introduced | Frequency | Facts it carries | Behaviour |
|---|---|---|---|---|
| **Goldfluff** (golden) | Round 3 | 35 % chance of 1 per round; 2 in Golden Hour rounds | A Known fact (box ≥ 3), not from the deck (it's extra) | Glitters and trails sparkles. Pop: 300 points, +10 XP, +5 Sparks, gold coin shower. Escape: no cost, no combo reset. Never shown alongside a monster with the same answer (§2.8 applies). |
| **Clonkshell** (armored) | Island 2 open or round 8 | 1 per round, 50 % chance; uses a deck slot | A non-square fact with box ≥ 1 | Shell shows `3×4`. First correct swipe cracks the shell (the charge is **kept**). The creature inside shows the **other form**, `4×3`, and drifts 25 % slower. A second swipe with the same charge pops it. This teaches commutativity directly. SRS: only the first hit is graded. The second hit sets the orient flag for the second form. Escape after the crack: no combo reset. |
| **Chillby** (freeze) | Round 12 or island 10 Known | 25 % chance of 1 per round; uses a deck slot | Any due fact | Pop it: all other monsters slow to 50 % for 5 s with an ice shimmer, and the spawn timer pauses for 5 s. Little band: 35 % chance. |
| **Splitsy** (splitter) | Round 16 or island 3 open | 30 % chance of 1 per round; uses a deck slot | Focus fact | A correct pop splits it into **2 minis**, each with a new fact from the current table that has a distinct answer (from the Focus pool, without using deck slots). Minis are 70 % size, flight × 1.2, worth 50 points, and graded for SRS. Mini escapes don't reset combo. Max on screen is allowed to go 1 over while minis are alive. |
| **Comeback** (visual tag) | Always | Every tricky-fact monster | Tricky facts | A tiny bandage and a determined face. When popped it does a happy spin and shows "Fixed it!" if this pop clears the tricky flag. |
| **Puzzler** (missing number `?×4=20`, `5×?=20`) [Later] | Big band, island 8 open | 2 per round | Known facts | The child types the missing factor. |

### 6.2 Round types

| Round type | When | Rules |
|---|---|---|
| **Normal** | Default | §2.4 |
| **Tutorial** | Profile's round 1 | 10 sums from table 1 (1×1..1×6 ghosted then repeated); x = min(base, 0); max 1 on screen for the first 4 sums; hand hint until 3 correct |
| **Boss** | The round after a table becomes Known (or chosen from the map for a Known table whose boss is waiting or beaten, as a replay) | §6.3 |
| **Mix-Up** | Every 5th round (roundIndex % 5 == 0), once 2 or more tables are Known. Never right after a Boss (push it back one round). | Deck = 2 warm-up + all other slots from Review (weighted over all Known tables). No new facts. Confetti-sky background. +1 extra chest-meter star if ★★ or more. |
| **Event** | From round 20: 15 % chance per round. Never two in a row. Never on Tutorial, Boss or Mix-Up rounds. | §6.4 |
| **Quick Check** | Big band, after the tutorial (optional) | §1.7 |
| **Tricky Pond** [Later] | Map button, shown when ≥ 4 tricky facts | 10 sums, tricky facts only, x − 0.5, at least ★★ guaranteed |

### 6.3 Boss rounds

- The boss is a large (40 % of screen height) Grand form of island species A. It floats
  at the top centre and bobs.
- **Boss HP = 12** hearts, one per fact of the table.
- The boss throws minion monsters carrying the table's 12 facts, in random order with
  both forms mixed. Each minion fact appears once. Missed ones go to the back of the
  queue.
- Each correct pop sends a sparkle beam from the popped minion to the boss: −1 heart,
  the boss blinks and makes a goofy "bonk" face.
- Wrong or escape: no damage to anyone, and the fact returns later in the queue. The
  boss never attacks the child. There is no timer and no fail.
- At 0 hearts the boss is "tickled" (giggles), shrinks into a regular friend, waves,
  and joins the Monster Book. Big fireworks (§7.6).
- The boss uses `x_eff − 0.5` and spawns from the boss's position, arcing down and out.
- The boss round also grades SRS normally. It's a real review of the whole table.
- Replays from the map: same rules, no Boss Chest after the first win, but normal XP,
  Sparks and stickers.

### 6.4 Events (random rounds after round 20)

Pick uniformly from the unlocked events. Each event shows a banner at round start
("Golden Hour!") and changes only visuals and rewards, never the learning rules.

| Event | Effect |
|---|---|
| **Golden Hour** | Golden monster chance becomes 2 per round guaranteed. Sparks × 2. Warm sunset palette. New facts still allowed. |
| **Bubble Breeze** | Monsters float inside soap bubbles. Flight × 1.25, max on screen +1. A bubble-pop sound on slice. |
| **Night Glow** | Dark sky, glowing monsters, firefly particles. Purely visual. |
| **Monster Parade** | Every monster is the same species (the one with the most pops still under Friend or Best Friend). Pops count × 2 toward stamps. |
| **Sticker Storm** | 2 stickers on the reward screen. Sticker particles burst on every correct pop. |
| **Snow Day** [Later] | Gentle snowfall, monsters wear scarves, Chillby chance × 2. |

### 6.5 Island and map visuals

The island map (the hub between rounds) is a vertical path of 12 islands.
- Each island shows its 12 lanterns (§1.2), its crown if earned, and a "Boss waiting!"
  flag when one is.
- Tapping a Known island offers "Play this island" (a Normal round where C = that table)
  and "Boss again" (replay).
- The big Play button always plays the guided next round.

---

## 7. Feedback and juice  [v1]

Global limits:
- At most 800 live particles.
- Screen shake amplitude is given in px at 1080p reference height; scale it to the
  screen.
- Nothing flashes more than 3 times a second.
- **Calm effects** toggle in the parent area: shake × 0.25, no full-screen flashes,
  particles × 0.5.
- Hit-stop means the whole simulation pauses for the given ms. Music keeps playing.

### 7.1 Input and charge

| Moment | Visual | Sound |
|---|---|---|
| Digit typed | The number appears on the blade hilt and HUD, with a pop-in scale 1.3 → 1 over 120 ms. The blade glow brightens with each digit. | `sfx_key_tap` (pitch +2 semitones on the 2nd digit, +4 on the 3rd) |
| Charge held | The blade has a soft pulsing glow, and the number orbits faintly | `sfx_charge_hum` loop at −18 dB |
| Backspace / Clear | The number shrinks out | `sfx_backspace` |
| Swipe with no hit | Trail only | `sfx_swipe_whoosh` |
| Swipe with no charge | Thin grey trail, little puff | `sfx_swipe_empty` |

### 7.2 Correct pop

- Hit-stop 60 ms. A white slash line flashes along the swipe (100 ms).
- The monster squashes to 1.2 × 0.8, then **pops**: 40 confetti in the species colours,
  8 stars, and a little "freed" puff where the monster's tiny happy face floats up and
  waves (0.6 s). This keeps it cute, not violent.
- Floating text `+150` rises and fades (0.8 s), coloured by combo tier. Sparks coins (2–4
  sprites) fly to the HUD counter.
- Screen shake 4 px, 120 ms.
- Sound: `sfx_slice_correct` + `sfx_pop_confetti` + `sfx_coin_tinkle`.
- New-fact second appearance correct: a lantern icon flies to the island icon in the HUD.
- Tricky cleared: "Fixed it!" banner + `sfx_fixit` + voice `vo_fixed_it`.

### 7.3 Combo tiers

| Combo | Visual | Audio |
|---|---|---|
| 3 | Small combo counter appears by the blade | `sfx_combo_up_1` |
| 5 **Hot!** | Banner slides in (0.7 s). Blade glow turns orange, trail width × 1.5. | `sfx_combo_up_2` + voice `vo_hot` |
| 10 **Blazing!** | Banner, background hue pulse once, trail adds ember particles | `sfx_combo_up_3` + `vo_blazing` |
| 15 **Super!** | Banner, blade turns electric blue, star particles on every pop × 2 | `sfx_combo_up_4` + `vo_super` |
| 25 **Mega!** | Banner, rainbow blade, firework burst at the top of the screen | `sfx_combo_mega` + `vo_mega` |
| Combo ends (≥ 3) | Counter wobbles and deflates. No red. | `sfx_combo_break` (soft "bwoop", not sad) |

### 7.4 Wrong: the blade breaks

1. Hit-stop 150 ms. The blade cracks (spider-crack sprite, 80 ms), then **shatters**
   into 18–24 crystal shards with physics, gravity and spin. 12 px shake, 300 ms. A
   soft purple vignette pulse (never red).
2. The struck monster **freezes** where it is for 1.5 s and grows to 1.6× scale. Its sum
   turns into the full fact, `5×4 = 20`, with **20** in gold. All other monsters run at
   50 % speed during these 1.5 s. The child's wrong number is **not** shown.
3. **Reforge** (1.0 s little / 1.2 s big, or 2.0 s if 3 wrongs happened within 8 s, see
   below): the shards fly back together in a spiral, flash, and the blade is whole.
   While it reforges, swipes do nothing and the charge is cleared.
4. The monster then continues its arc, still labelled `5×4 = 20` with a soft glow. If
   the child types 20 and pops it: "Fixed it!" re-slice, 25 points, +3 XP, no combo,
   and the SRS grade is not changed (it was already graded wrong).
5. Sound: `sfx_blade_shatter`, then `sfx_wrong_reveal` (gentle two-note "here it is"),
   then `sfx_blade_reforge`. No voice line on wrong.
6. **Guessing guard**: if 3 wrongs happen within 8 s, the reforge takes 2.0 s and a
   picture hint (a thinking-cloud icon, no words) shows above the blade.

### 7.5 Escape

The monster waves goodbye as it leaves (0.3 s wave frame). A small "whoosh" at the edge.
If combo was ≥ 3, the combo-ends effect plays. No other penalty is shown.
Sound: `sfx_escape`.

### 7.6 Level up, unlocks and round end

- **XP during play**: the HUD XP bar fills smoothly. On level-up mid-round, only a small
  pulse and `sfx_xp_ding`. The full celebration waits for the reward screen, so the
  child isn't distracted.
- **Reward screen sequence**. Each step is skipped or sped up by tapping. The whole
  thing takes about 15 s if not tapped.
  1. Round-end whistle `sfx_round_end`. Remaining monsters fly off waving.
  2. Stars drop in one at a time (0.5 s each, `sfx_star_1/2/3`, sparkle star
     `sfx_star_sparkle`). Voice: `vo_three_stars` on ★★★, `vo_great_job` otherwise.
  3. Score counts up (`sfx_count_tick`), then "New best!" if earned.
  4. XP bar fills (`sfx_xp_fill`). On level up: full-screen ray burst, avatar jumps,
     confetti, `sfx_level_up` + `vo_level_up`, and the level item card flips over.
  5. Cards for new things, one at a time, each flipping in: species Met (`sfx_dex_new` +
     `vo_new_monster`), badge (`sfx_badge` + `vo_new_badge`), sticker (`sfx_sticker_peel`),
     stamps, "Fixed it" facts, and "New facts learned" (lanterns lighting,
     `sfx_lantern_light`).
  6. Chest if earned: the chest drops and wobbles (`sfx_chest_shake`), the child taps
     3 times, then it opens (`sfx_chest_open` + `vo_treasure`) and items pop out
     (`sfx_item_reveal`).
  7. "Next up" row (§5.10) and the speedometer animal.
  8. Big **Play again** button (pulsing) and a **Map** button.
- **Island unlock** (after a boss): the map camera pans to the new island, which rises
  out of the clouds (1.5 s). Its lanterns that are already known light one by one with
  rising pitch (`sfx_lantern_light`, + 1 semitone each). "You already know 8!"
  (number + lantern icon). `sfx_unlock` + `vo_new_island`.
- **Boss**: entrance has a screen-wide shadow, the boss drops in with a bounce,
  `sfx_boss_enter` + `vo_boss_time`, and `mus_boss`. Hit: `sfx_boss_hit` and the boss
  blinks white for 80 ms. Defeat: 3 firework bursts, the boss shrinks into a friend,
  `sfx_boss_defeat` + `vo_boss_defeated`.
- **Crown**: a gold crown drops onto the island with `sfx_crown` + `vo_crown`.

### 7.7 Audio asset list (for ElevenLabs)

General style for all SFX: "cartoony, soft, bright, child-friendly, no harsh high
frequencies, short clean tail". Normalise SFX to −16 LUFS short-term, music to −20 LUFS.

**Sound effects** (id — duration — ElevenLabs prompt):

| id | dur | Prompt |
|---|---|---|
| sfx_key_tap | 0.1 s | Soft bubbly pop tap, like pressing a squishy toy button, cartoon |
| sfx_charge_hum | 2 s loop | Gentle magical humming glow, warm and steady, seamless loop |
| sfx_backspace | 0.15 s | Quick soft reverse pop, tiny whoop downward |
| sfx_swipe_whoosh | 0.3 s | Light airy sword whoosh, cartoony and quick |
| sfx_swipe_empty | 0.25 s | Very soft breathy swish with a tiny puff, harmless |
| sfx_slice_correct | 0.3 s | Crisp bright magical slice with a sparkly shing |
| sfx_pop_confetti | 0.5 s | Happy balloon pop bursting into confetti and tiny bells |
| sfx_coin_tinkle | 0.4 s | Small cascade of tiny coins tinkling, light and cheerful |
| sfx_combo_up_1 | 0.3 s | Single rising chime note, cheerful |
| sfx_combo_up_2 | 0.4 s | Two quick rising chimes, excited |
| sfx_combo_up_3 | 0.5 s | Three fast rising chimes with sparkle shimmer |
| sfx_combo_up_4 | 0.6 s | Rising arpeggio of chimes with a whoosh, very excited |
| sfx_combo_mega | 1.0 s | Big triumphant chime arpeggio with a firework sparkle burst |
| sfx_combo_break | 0.4 s | Soft cartoon balloon deflating "bwoop", gentle and funny, not sad |
| sfx_blade_shatter | 0.8 s | Dramatic cartoon crystal shatter, many glass shards tinkling down, big but not scary |
| sfx_wrong_reveal | 0.6 s | Gentle two-note xylophone "here it is", warm and kind |
| sfx_blade_reforge | 1.0 s | Magical shimmering swirl that builds to a bright ting as a crystal reforms |
| sfx_fixit | 0.6 s | Cheerful bouncy "ta-da" on bells, proud |
| sfx_escape | 0.5 s | Playful slide whistle going away, fading |
| sfx_monster_launch_1..3 | 0.3 s | Three variants: springy boing launch / bubbly whoop / cork pop, cute |
| sfx_monster_giggle_1..3 | 0.5 s | Three variants: tiny high-pitched creature giggle, cute, non-human, no words |
| sfx_golden_appear | 0.6 s | Twinkling golden sparkle shimmer, magical |
| sfx_golden_pop | 0.8 s | Jackpot of bright bells and coins bursting, joyful |
| sfx_armor_crack | 0.4 s | Cartoon shell cracking with a hollow clonk |
| sfx_split | 0.4 s | Bubbly split, like a blob dividing in two with a boing |
| sfx_freeze | 0.8 s | Icy crystal swoosh freezing, sparkly and cool |
| sfx_unfreeze | 0.5 s | Gentle ice melting tinkle |
| sfx_boss_enter | 1.5 s | Big friendly cartoon monster rumble and silly roar, more goofy than scary |
| sfx_boss_hit | 0.3 s | Funny bonk on a big soft drum, boing |
| sfx_boss_defeat | 2.0 s | Giant happy pop followed by fireworks and a short cheer of tiny creatures |
| sfx_xp_ding | 0.3 s | Small bright level ding |
| sfx_xp_fill | 1.5 s loop | Rising sparkly tick sequence, building anticipation, loopable |
| sfx_count_tick | 0.05 s | Tiny soft tick for counting up a score |
| sfx_level_up | 2.0 s | Short triumphant fanfare sting with brass and sparkles, celebratory, kid-friendly |
| sfx_star_1 / _2 / _3 | 0.5 s | Star chime, three ascending pitches, each brighter |
| sfx_star_sparkle | 0.8 s | Extra-special rainbow sparkle chime, magical |
| sfx_chest_shake | 0.6 s | Wooden chest rattling with excitement, little jingles inside |
| sfx_chest_open | 1.0 s | Treasure chest bursting open with a choir "aah" and sparkles |
| sfx_item_reveal | 0.6 s | Pop-up reveal shimmer, ta-da |
| sfx_unlock | 1.5 s | Magical island rising from clouds, whoosh with harp glissando |
| sfx_lantern_light | 0.3 s | Soft warm lantern lighting, gentle chime puff |
| sfx_crown | 1.2 s | Royal little fanfare with a sparkling crown ding |
| sfx_badge | 0.8 s | Shiny medal clink with a sparkle |
| sfx_sticker_peel | 0.5 s | Sticker peel and slap onto paper, satisfying |
| sfx_dex_new | 0.8 s | Book page flip followed by a happy discovery chime |
| sfx_shiny | 1.0 s | Rare rainbow shimmer, glittering and special |
| sfx_purchase | 0.6 s | Cash-register-free happy "ka-ching" of bells and coins (no real money feel, toy-like) |
| sfx_ui_tap | 0.1 s | Soft round button click, toy-like |
| sfx_ui_back | 0.15 s | Soft lower-pitched button click |
| sfx_ui_toggle | 0.15 s | Little switch flick with a tiny pop |
| sfx_round_start | 1.2 s | Three soft countdown chimes then a bright go chime |
| sfx_round_end | 0.8 s | Friendly referee whistle, cheerful toot |

**Music** (loops, about 60–90 s, seamless):

| id | Prompt |
|---|---|
| mus_menu | Cheerful whimsical menu music for a kids game, marimba, ukulele and soft bells, 100 BPM, warm and inviting, seamless loop |
| mus_play_calm | Light bouncy gameplay music, plucked strings, kalimba and gentle percussion, 92 BPM, focused but happy, not distracting, seamless loop. Used when x_eff < 1.5. |
| mus_play_upbeat | Energetic playful gameplay music, synth bass, claps, glockenspiel melody, 124 BPM, exciting but friendly, seamless loop. Used when x_eff ≥ 1.5. |
| mus_boss | Goofy big-monster boss music, tuba and timpani with playful brass stabs, 110 BPM, dramatic but silly, not scary, seamless loop |
| mus_reward | Short celebratory loop, bright bells and strings, triumphant and warm, 16 bars |
| mus_map | Dreamy adventure map music, flute, harp and soft pads, sense of wonder, 85 BPM, seamless loop |
| mus_event | Shimmering golden festival music, steel drums and chimes, 112 BPM, seamless loop |

**Voice lines**. One narrator for everything: a warm, upbeat, friendly young-adult voice
with a bit of playful sparkle, clear diction, British or neutral English (the parent
should choose). Not childish, not shouty. Praise and menus only; sums are never read
aloud. ElevenLabs prompt for the voice design: "Warm, cheerful, encouraging narrator for
a children's maths game, friendly older-sibling energy, clear and bright, gentle
excitement".

| id | Line | Used when |
|---|---|---|
| vo_awesome | "Awesome!" | Random praise on correct (max 1 per 8 s, 20 % chance) |
| vo_great | "Great!" | same |
| vo_you_got_it | "You got it!" | same |
| vo_wow | "Wow!" | same |
| vo_brilliant | "Brilliant!" | same |
| vo_hot | "Hot streak!" | Combo 5 |
| vo_blazing | "Blazing!" | Combo 10 |
| vo_super | "Super combo!" | Combo 15 |
| vo_mega | "Mega combo!" | Combo 25 |
| vo_fixed_it | "You fixed it!" | Tricky cleared |
| vo_great_job | "Great job!" | Round end ★ or ★★ |
| vo_three_stars | "Three stars! Amazing!" | Round end ★★★ |
| vo_rainbow | "Rainbow star!" | Sparkle star |
| vo_level_up | "Level up!" | Level up |
| vo_new_monster | "A new monster friend!" | Species Met |
| vo_new_badge | "New badge!" | Badge |
| vo_treasure | "Treasure!" | Chest opens |
| vo_new_best | "New best score!" | Personal best |
| vo_boss_time | "Here comes a big one!" | Boss entrance |
| vo_boss_defeated | "You did it! Boss tickled!" | Boss defeat |
| vo_new_island | "A new island!" | Island unlock |
| vo_crown | "You earned a golden crown!" | Table Mastered |
| vo_golden | "Golden monster!" | First golden of a round appears |
| vo_ready_go | "Ready? Go!" | Round start |
| vo_lets_play | "Let's play!" | Title screen |
| vo_whos_playing | "Who's playing?" | Profile picker |
| vo_pick_avatar | "Pick your monster buddy!" | Avatar picker |
| vo_how_old | "How old are you?" | Profile creation |
| vo_welcome_back | "Welcome back!" | First round of the day |
| vo_workshop | "The workshop is open!" | Workshop unlock |
| vo_monster_book | "Your monster book!" | Opening the book |
| vo_sticker_book | "Your sticker album!" | Opening the album |
| vo_locker | "Dress up time!" | Opening the locker |
| vo_show_know | "Show what you know!" | Quick Check offer |
| vo_grownups | "Grown-ups only, please!" | Parent gate |
| vo_type_then_swipe | "Type the answer, then swipe!" | Tutorial hint (counts as a menu/instruction line) |

---

## 8. Data model (per-profile save)  [v1]

localStorage keys:
- `mm.index` = `{ "version": 1, "profiles": [ { "id": "p_ab12", "name": "Mia", "avatar": "pebbit" } ], "lastProfileId": "p_ab12" }`
- `mm.profile.<id>` = the object below

Save at round end, after the reward screen is committed, after any Locker, Workshop or
parent change, and on `visibilitychange` → hidden.

While a round runs, `pendingRound` holds its seed, day, choice and start speed, and
every answer is added to it and saved as it happens (`logic/resume.js`). It is cleared
once the rewards are applied. This makes a crash or reload safe: on load, if
`pendingRound` has at least 3 graded answers, the same round is re-planned from its
seed and the answers so far are applied (speed is left as it was), and the reward
screen shows. With fewer answers it is dropped. Leaving through the pause menu is a
deliberate stop, so nothing is applied.

```json
{
  "schema": 1,
  "id": "p_ab12",
  "name": "Mia",
  "age": 6,
  "ageBand": "little",
  "createdAt": "2026-11-05T17:40:00Z",

  "avatar": { "base": "pebbit", "colorSet": "default",
              "equipped": { "hat": "party_hat", "face": null, "back": null },
              "blade": "starter_wand", "trail": "sparkle" },

  "settings": {
    "baseTier": 0,
    "targetMs": 6000,
    "tableMode": "guided",
    "manualTables": [],
    "calmEffects": false,
    "sfx": true, "music": true, "voice": true,
    "numberPad": "auto"
  },

  "progress": {
    "level": 4, "xp": 612, "sparks": 37,
    "roundIndex": 7,
    "starsTotal": 15, "chestStars": 3,
    "totalCorrect": 92, "totalWrong": 11, "totalEscapes": 6,
    "timePlayedMs": 612000,
    "playDays": ["2026-11-05"],
    "lastPlayDay": "2026-11-05",
    "bestCombo": 9,
    "bestScoreByTier": [4210, 0, 0, 0, 0],
    "title": "pop_pal",
    "featuresSeen": { "golden": true, "armored": false, "freeze": false, "splitter": false,
                      "workshop": true, "mixup": false, "events": false },
    "placementDone": false,
    "lastRoundType": "normal",
    "lastRoundAccuracy": 0.8,
    "lastRoundStars": 2,
    "wish": "carrot_sword"
  },

  "speed": { "offset": 0.12, "lastRoundDay": "2026-11-05" },

  "facts": {
    "3x4": {
      "introduced": true, "introducedRound": 5,
      "box": 2, "bestBox": 2,
      "seen": 6, "correct": 4, "wrong": 1, "escapes": 1,
      "tricky": true, "trickyNeed": 2,
      "lastSeenRound": 7, "lastSeenDay": "2026-11-05",
      "lastBoxUpRound": 7,
      "dayReachedBox3": null, "dayReachedBox4": null, "dayReachedBox5": null,
      "rtEmaMs": 5200, "recentRtMs": [6100, 5400, 4800],
      "recent": "CCWCC",
      "orient": { "ab": true, "ba": false },
      "confusedWith": { "16": 1 }
    }
  },

  "tables": {
    "1": { "state": "known", "openedRound": 1, "knownRound": 5, "bossBeaten": true,
           "masteredDay": null, "roundsOpen": 5, "speedWaiverCount": 0 },
    "2": { "state": "open", "openedRound": 6, "knownRound": null, "bossBeaten": false,
           "masteredDay": null, "roundsOpen": 2, "speedWaiverCount": 0 }
  },

  "collection": {
    "dex": { "bloop": { "met": true, "pops": 31, "shiny": false, "metRound": 1,
                        "stamps": ["met", "friend"] } },
    "blades": ["starter_wand", "leaf_blade"],
    "trails": ["plain", "sparkle"],
    "avatarItems": ["party_hat"],
    "colorSets": ["default"],
    "stickers": ["p1_s1", "p1_s4"],
    "badges": { "first_pop": "2026-11-05", "golden_catch": "2026-11-05" },
    "crowns": []
  },

  "history": [
    { "round": 7, "at": "2026-11-05T18:02:11Z", "type": "normal", "table": 2,
      "seed": 918273, "sums": 15, "correct": 12, "wrong": 2, "escapes": 1,
      "stars": 2, "score": 3920, "xp": 230, "sparks": 18,
      "medianRtMs": 4900, "xStart": 0.10, "xEnd": 0.22, "bestCombo": 7,
      "durationMs": 74000 }
  ],

  "pendingRound": null
}
```

Notes:
- `facts` holds only facts that are introduced or in an open table. A missing key means
  New/Locked with defaults (box 0, all counts 0).
- `recent` holds the last 8 first-try results (`C`, `W`, `E`), newest last.
- `history` keeps the last 50 rounds (FIFO). The parent view uses it for time played
  and trends.
- Derived (not stored): fact state, table Known check, due status, `x_eff`.
- Parent view needs:
  - Mastered facts: box 5 list, plus a 12×12 grid coloured by state.
  - Tricky facts: the top 10 by `wrong` among those with `tricky` or recent W, with
    their `confusedWith`.
  - Time played: today, this week, total, from history and `timePlayedMs`.
- Design `facts` as keyed by a problem-source id so other maths can be added later:
  `facts` is really `sources.times.facts`. Wrap it as
  `"sources": { "times": { "facts": {...}, "tables": {...} } }` if the engineer
  prefers. The mechanics don't change.

---

## 9. Scope: v1 vs later

**v1 (build this)**
- Table path, fact states, box rules, table Known/Mastered, kindness valve, parent
  override (guided / choose tables / reset).
- Age bands, Quick Check placement (big band).
- Deck builder with warm-up, new, tricky, review and focus buckets; in-round
  repetition; display-form rules; unique answers on screen; kind swipe rule; ghost
  answer.
- 5 speed tiers plus 2 hidden ones, adaptive offset with gates, caps and decay;
  per-monster multipliers; lull rule.
- Points, combo tiers, stars plus sparkle star, Sparks, XP curve, levels 1–99 with
  titles.
- Monster Book (24 species + 4 specials + 12 Grands, stamps, shinies).
- 13 blades, 13 trails, 25 avatar items, 4 colour sets; Locker; Workshop with wish bar.
- Sticker Album (108 stickers).
- 52 badges (§5.7).
- Chests: Star, Level, Boss, Crown, Hello.
- Play-day sun calendar (totals only).
- Special monsters: Goldfluff, Clonkshell, Chillby, Splitsy, Comeback tag.
- Round types: Tutorial, Normal, Boss, Mix-Up, Quick Check.
- Events: Golden Hour, Bubble Breeze, Night Glow, Monster Parade, Sticker Storm.
- The full juice list in §7, all audio assets in §7.7, Calm effects toggle.
- Save model in §8, with `pendingRound` crash safety.

**Cut order if v1 runs long** (cut from the top first): shinies → events → Splitsy →
Workshop wish bar → Quick Check (big band then simply starts at island 1 with
`newPerRound` 3) → sticker album page rewards.

**Later**
- Puzzler (missing-number) monsters for the big band.
- Tricky Pond practice round.
- Snow Day and seasonal events.
- Sibling features: a shared "family lantern tree" that grows with total family play,
  where siblings never compete or see each other's scores.
- Monster habitat (place collected species in a little garden).
- Avatar emotes on the reward screen.
- Parent weekly summary card.
- Other problem sources (addition, division as "reverse" facts) reusing the deck and box
  logic.
- Optional "challenge" mode for the big band (beat your personal best at a chosen tier).
