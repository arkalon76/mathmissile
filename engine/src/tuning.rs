//! Every in-round number from DESIGN.md in one place, so playtest tuning never
//! touches logic. Section references are to DESIGN.md.

// ---------------------------------------------------------------- §3.1 tiers
/// Speed-index anchors x = -1..5 (index = x + 1).
pub const TIER_FLIGHT_S: [f32; 7] = [13.0, 11.0, 9.0, 7.5, 6.0, 5.0, 4.2];
pub const TIER_INTERVAL_S: [f32; 7] = [5.5, 4.5, 3.8, 3.2, 2.6, 2.1, 1.8];
pub const TIER_MAX_ON_SCREEN: [u32; 7] = [1, 2, 2, 3, 3, 4, 4];
pub const X_MIN: f32 = -1.0;
pub const X_MAX: f32 = 5.0;

/// Launch x range (fraction of width) and apex (fraction of height from the bottom;
/// DESIGN: 22–40 % from the top).
pub const LAUNCH_X: (f32, f32) = (0.15, 0.85);
pub const APEX_Y: (f32, f32) = (0.60, 0.78);
/// Share of launches that leave through a side edge.
pub const SIDE_EXIT_CHANCE: f32 = 0.2;
/// Height band (fraction of height) where side exits cross the edge.
pub const SIDE_EXIT_Y: (f32, f32) = (0.30, 0.55);
/// Minimum monster diameter as a fraction of screen height.
pub const MIN_DIAMETER_LITTLE: f32 = 0.17;
pub const MIN_DIAMETER_BIG: f32 = 0.15;
/// Never wider than this fraction of the screen width (very tall phones).
pub const MAX_DIAMETER_W: f32 = 0.34;
pub const LITTLE_MAX_ON_SCREEN_CAP: u32 = 3;

// -------------------------------------------------------------- §3.2 spawning
pub const FIRST_SPAWN_S: f32 = 1.0;
pub const LULL_S: f32 = 0.8;
pub const AFTER_WRONG_DELAY_S: f32 = 1.0;
pub const RETRY_S: f32 = 0.3;
pub const HARD_STOP_S: f32 = 100.0;
pub const LOOKAHEAD: usize = 4;
pub const FLIGHT_MUL_NEW: f32 = 1.30;
pub const FLIGHT_MUL_TRICKY: f32 = 1.15;
pub const FLIGHT_MUL_MINI: f32 = 1.20;
pub const FLIGHT_MUL_BUBBLE: f32 = 1.25;
pub const TUTORIAL_SINGLE_FOR: u32 = 4;

// ----------------------------------------------------------- §3.3 adaptive
pub const LEVEL_DRIFT_PER_LEVEL: f32 = 0.02;
pub const LEVEL_DRIFT_MAX: f32 = 0.5;
pub const D_FAST: f32 = 0.05;
pub const D_COMBO10: f32 = 0.05;
pub const D_WRONG: f32 = -0.10;
pub const D_ESCAPE_READY: f32 = -0.12;
pub const D_ESCAPE_REFORGE: f32 = -0.05;
pub const D_EASE: f32 = -0.15;
pub const EASE_WINDOW: usize = 4;
pub const EASE_MISSES: usize = 2;
pub const GENTLE_SPAWNS: u32 = 3;
pub const GENTLE_INTERVAL_MUL: f32 = 1.3;
pub const RISE_GATE_WINDOW: usize = 8;
pub const RISE_GATE_ACC: f32 = 0.75;
pub const ROUND_CAP_UP: f32 = 0.35;
pub const ROUND_CAP_DOWN: f32 = -0.80;
pub const BOSS_X_OFFSET: f32 = -0.5;

// ------------------------------------------------------------- §2.5 repeats
pub const WRONG_INSERT_1: usize = 3;
pub const WRONG_INSERT_2: usize = 4;
pub const ESCAPE_INSERT: usize = 4;
pub const MAX_WRONG_INSERTS: u8 = 2;
pub const MAX_APPEARANCES: u8 = 4;
pub const MAX_APPENDED: u8 = 4;

// --------------------------------------------------------------- §4.1 points
pub const POINTS_BASE: u32 = 100;
pub const POINTS_GOLDEN: u32 = 300;
pub const POINTS_MINI: u32 = 50;
/// Not in DESIGN: the second hit on a cracked Clonkshell.
pub const POINTS_ARMOR_INNER: u32 = 50;
pub const POINTS_BOSS_DEFEAT: u32 = 500;
pub const POINTS_FIXED: u32 = 25;
pub const SPEED_BONUS_MAX: f32 = 50.0;
/// Combo thresholds for multipliers ×2..×5 and their names.
pub const COMBO_TIERS: [u32; 4] = [5, 10, 15, 25];
pub const COMBO_NAMES: [&str; 5] = ["", "Hot!", "Blazing!", "Super!", "Mega!"];
pub const COMBO_COUNTER_FROM: u32 = 3;

// ------------------------------------------------------------- §6 specials
pub const ARMOR_INNER_TIME_SCALE: f32 = 0.75;
pub const CHILL_S: f32 = 5.0;
pub const CHILL_SPEED: f32 = 0.5;
pub const MINI_SCALE: f32 = 0.7;
pub const INTRO_S: f32 = 2.0;
pub const GOLDEN_WINDOW: (f32, f32) = (0.2, 0.8);
pub const BOSS_DIAMETER_H: f32 = 0.40;
pub const BOSS_ENTER_S: f32 = 1.4;
pub const BOSS_DEFEAT_S: f32 = 3.2;
pub const BOSS_BEAM_S: f32 = 0.35;

// ----------------------------------------------------------- §7 feedback
pub const MAX_PARTICLES: usize = 800;
pub const SHAKE_REF_H: f32 = 1080.0;
pub const MIN_FLASH_GAP_S: f32 = 0.34;
pub const CALM_SHAKE: f32 = 0.25;
pub const CALM_PARTICLES: f32 = 0.5;
pub const HITSTOP_CORRECT_S: f32 = 0.06;
pub const HITSTOP_WRONG_S: f32 = 0.15;
pub const SHAKE_CORRECT: (f32, f32) = (4.0, 0.12);
pub const SHAKE_WRONG: (f32, f32) = (12.0, 0.30);
pub const POP_SQUASH_S: f32 = 0.07;
pub const POP_CONFETTI: u32 = 40;
pub const POP_STARS: u32 = 8;
pub const WRONG_FREEZE_S: f32 = 1.5;
pub const WRONG_SCALE: f32 = 1.6;
pub const WRONG_OTHERS_SPEED: f32 = 0.5;
pub const REFORGE_LITTLE_S: f32 = 1.0;
pub const REFORGE_BIG_S: f32 = 1.2;
pub const REFORGE_GUARD_S: f32 = 2.0;
pub const GUARD_WRONGS: usize = 3;
pub const GUARD_WINDOW_S: f32 = 8.0;
/// A stroke that touched only wrong monsters resolves this long after the
/// first touch even if the finger stays down.
pub const SWIPE_RESOLVE_S: f32 = 0.6;
pub const HIT_SCALE: f32 = 1.12;
pub const GHOST_ALPHA: f32 = 0.4;
pub const BANNER_S: f32 = 1.2;
