// Every tunable number from DESIGN.md in one place, so playtests can change
// values without touching logic. Section numbers refer to DESIGN.md.

export const TUNING = Object.freeze({
  // §1.1 path order (one island per table).
  path: [1, 2, 10, 5, 3, 11, 4, 9, 6, 8, 7, 12],
  stages: { A: [1, 2, 10, 5], B: [3, 11, 4], C: [9, 6, 8, 7], D: [12] },
  stageNames: { A: 'Sunny Shore', B: 'Mossy Hills', C: 'Cloud Peaks', D: 'Star Summit' },

  // §1.3 default fluency target per base tier (Snail..Rocket).
  targetMsByTier: [6000, 5000, 4000, 3500, 3000],
  targetMsMin: 1500,
  targetMsMax: 12000,

  // §1.5 table Known: >= knownMinBox3 facts at box >= 3 and none below knownFloorBox;
  // median rtEma <= speedFactor * target; speed kindness valve after N rounds;
  // accuracy kindness valve: after accuracyValveRounds rounds open, >= accuracyValveBox3 suffice.
  knownSpeedFactor: 1.5,
  kindnessValveRounds: 8,
  knownMinBox3: 10,
  knownFloorBox: 2,
  accuracyValveRounds: 8,
  accuracyValveBox3: 9,
  // §1.4 box drops on a wrong: -2, or -1 from box >= 3.
  wrongDrop: 2,
  wrongDropHigh: 1,

  // §1.7 age bands.
  ages: [5, 6, 7, 8, 9, 10],
  bands: {
    little: { newPerRound: 2, loadCap: 4, trickySlots: 2, sumsDelta: -3, sumsMin: 12, maxOnScreenCap: 3, reforgeS: 1.0, monsterScale: 1.12 },
    big: { newPerRound: 3, loadCap: 6, trickySlots: 3, sumsDelta: 0, sumsMin: 12, maxOnScreenCap: 4, reforgeS: 1.2, monsterScale: 1.0 },
  },
  defaultTierByAge: { 5: 0, 6: 0, 7: 1, 8: 2, 9: 2, 10: 3 },
  newPerRoundOverride: { 1: 6, 10: 4 },

  // §2.2 spacing.
  R: [0, 1, 2, 4, 8, 16],
  D: [0, 0, 0, 0, 1, 3],
  B: [8, 6, 4, 2, 1, 0.5],
  dueMulMax: 4,
  notDueMul: 0.25,
  trickyMul: 3,
  recentMul: 0.5,
  trickyNeed: 3,

  // §2.4 deck.
  warmupSlots: 2,
  reviewShare: 0.25,
  newGapMin: 3,
  newGapMax: 5,
  trickyMinGap: 3,
  focusMaxCopies: 2,
  focusMinGap: 4,
  fallbackMinGap: 3,
  lowAccuracyNoNew: 0.6,

  // §2.5 in-round repetition.
  wrongInsertBack: [3, 4],
  escapeInsertBack: 4,
  maxInsertsPerFact: 2,
  maxAppearancesPerFact: 4,
  lookahead: 4,

  // §2.7 response time.
  rtEntryMs: 400,
  rtMinMs: 300,
  rtEmaOld: 0.6,
  recentRtKeep: 5,
  recentKeep: 8,

  // §3.1 speed anchors, x = -1..5.
  tiers: [
    { x: -1, name: 'Sleepy Snail', animal: 'snail', flight: 13.0, interval: 5.5, maxOnScreen: 1, sums: 15 },
    { x: 0, name: 'Snail', animal: 'snail', flight: 11.0, interval: 4.5, maxOnScreen: 2, sums: 15 },
    { x: 1, name: 'Turtle', animal: 'turtle', flight: 9.0, interval: 3.8, maxOnScreen: 2, sums: 16 },
    { x: 2, name: 'Bunny', animal: 'bunny', flight: 7.5, interval: 3.2, maxOnScreen: 3, sums: 18 },
    { x: 3, name: 'Cheetah', animal: 'cheetah', flight: 6.0, interval: 2.6, maxOnScreen: 3, sums: 22 },
    { x: 4, name: 'Rocket', animal: 'rocket', flight: 5.0, interval: 2.1, maxOnScreen: 4, sums: 26 },
    { x: 5, name: 'Rocket+', animal: 'rocket', flight: 4.2, interval: 1.8, maxOnScreen: 4, sums: 28 },
  ],
  flightMul: { new: 1.3, tricky: 1.15, mini: 1.2, normal: 1.0 },
  apexMin: 0.6,
  apexMax: 0.78,

  // §3.3 adaptive.
  levelDriftPerLevel: 0.02,
  levelDriftMax: 0.5,
  xBelowBase: 1,
  xAboveBase: 1.5,
  dFastCorrect: 0.05,
  dCombo10: 0.05,
  dWrong: -0.1,
  dEscapeReady: -0.12,
  dEscapeReforge: -0.05,
  dEase: -0.15,
  easeWindow: 4,
  easeMisses: 2,
  gentleSpawns: 3,
  gentleIntervalMul: 1.3,
  riseGateWindow: 8,
  riseGateAccuracy: 0.75,
  roundCapUp: 0.35,
  roundCapDown: -0.8,
  decayRound: 0.8,
  decayNewDay: 0.5,
  newIslandOffset: -0.3,
  bossXDelta: -0.5,

  // §4.1 points.
  pointsBase: 100,
  pointsSpeedBonus: 50,
  comboSteps: [ // [minCombo, mult, name]
    [0, 1, ''], [5, 2, 'Hot!'], [10, 3, 'Blazing!'], [15, 4, 'Super!'], [25, 5, 'Mega!'],
  ],
  fixedItPoints: 25,

  // §4.2 stars.
  star2Acc: 0.7,
  star3Acc: 0.9,

  // §4.3 Sparks.
  sparksBase: 5,
  sparksPerStar: 2,
  sparksPerFiveCorrect: 1,
  sparksPerGolden: 5,

  // §4.4 XP.
  xp: {
    roundFinished: 20, correct: 10, fast: 5, firstEverCorrect: 10, trickyFixed: 15, fixedIt: 3,
    perStar: 10, perFiveCombo: 5, golden: 10, boss: 100, welcome: 50, stamp: 10, badge: 20,
  },
  maxLevel: 99,

  // §5.3 Monster Book.
  stampAt: { met: 1, friend: 25, best: 100 },
  stampSparks: 5,
  speciesBShare: 0.3,
  shinyFromRound: 10,
  shinyChance: 1 / 50,

  // §5.4 stickers.
  stickerPages: 12,
  stickersPerPage: 9,
  pageCompleteSparks: 30,

  // §5.6 chests.
  starsPerChest: 6,
  chestSparks: { star: [10, 20], hello: [10, 10], level: [20, 30], boss: [20, 30], crown: [20, 30] },
  chestItems: { star: 1, hello: 0, level: 2, boss: 2, crown: 2 },
  chestEmptyFallbackSparks: 30,

  // §5.7 badges.
  badgeSparks: 10,

  // §5.10.
  nothingNewSparks: 5,

  // §6.
  workshopRound: 4,
  mixupEvery: 5,
  mixupMinKnown: 2,
  eventFromRound: 20,
  eventChance: 0.15,
  tutorialSums: 10,

  // §4.4 / §5.2 levels after 20.
  sparksPerLevelAfter20: 20,

  // History.
  historyKeep: 50,

  // SPEC: break nudge and price helper defaults.
  breakMinutesDefault: 20,
  breakMinutesMax: 120,
  defaultSparksPerRound: 18,
  defaultRoundsPerDay: 8,
  priceHelperRounds: 10,
  realRewardsMax: 50,
  realRewardPriceMax: 100000,
  realRewardNameMax: 40,
  profileNameMax: 16,
  maxProfiles: 8,
});
