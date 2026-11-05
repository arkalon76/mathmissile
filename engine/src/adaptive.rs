//! Speed tiers and the in-round adaptive formula (DESIGN §3.1, §3.3).
//! Between-round rules (decay, island change, tier reset) are the shell's.

use crate::config::{RoundType, SpeedInput};
use crate::tuning::*;

/// Linear interpolation of a tier table at speed index `x`.
pub fn tier_lerp(t: &[f32; 7], x: f32) -> f32 {
    let f = (x - X_MIN).clamp(0.0, 6.0);
    let i = (f.floor() as usize).min(5);
    let k = f - i as f32;
    t[i] + (t[i + 1] - t[i]) * k
}

/// Max on screen uses the value at `round(x)`.
pub fn tier_max_on_screen(x: f32) -> u32 {
    let i = ((x.round() - X_MIN) as i32).clamp(0, 6) as usize;
    TIER_MAX_ON_SCREEN[i]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Adaptive,
    /// `{x}` given: no changes.
    Fixed,
    /// x − 0.5, offset frozen.
    Boss,
    /// min(x, 0), offset frozen.
    Tutorial,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Res {
    Correct,
    Wrong,
    Escape,
}

impl Res {
    fn code(self) -> u8 {
        match self {
            Res::Correct => b'C',
            Res::Wrong => b'W',
            Res::Escape => b'E',
        }
    }
}

pub struct Adaptive {
    pub mode: Mode,
    base: f32,
    drift: f32,
    fixed_x: f32,
    pub offset_start: f32,
    pub offset: f32,
    /// Oldest first, at most 8 (carried across rounds).
    pub recent: Vec<u8>,
    /// This round's resolutions, newest last (ease-trigger window).
    window: [u8; EASE_WINDOW],
    window_n: usize,
    since_ease: usize,
    pub gentle_left: u32,
    combo10_done: bool,
}

impl Adaptive {
    pub fn new() -> Adaptive {
        Adaptive {
            mode: Mode::Adaptive,
            base: 0.0,
            drift: 0.0,
            fixed_x: 0.0,
            offset_start: 0.0,
            offset: 0.0,
            recent: Vec::with_capacity(RISE_GATE_WINDOW + 1),
            window: [0; EASE_WINDOW],
            window_n: 0,
            since_ease: EASE_WINDOW,
            gentle_left: 0,
            combo10_done: false,
        }
    }

    pub fn start(&mut self, s: &SpeedInput, round: RoundType) {
        self.base = s.base;
        self.drift = (LEVEL_DRIFT_PER_LEVEL * (s.level.max(1) - 1) as f32).min(LEVEL_DRIFT_MAX);
        self.offset_start = s.offset;
        self.offset = s.offset;
        self.recent.clear();
        self.recent.extend_from_slice(&s.recent[s.recent.len().saturating_sub(RISE_GATE_WINDOW)..]);
        self.window_n = 0;
        self.since_ease = EASE_WINDOW;
        self.gentle_left = 0;
        self.combo10_done = false;
        self.mode = match (s.fixed_x, round) {
            (Some(x), _) => {
                self.fixed_x = x;
                Mode::Fixed
            }
            (None, RoundType::Boss) => Mode::Boss,
            (None, RoundType::Tutorial) => Mode::Tutorial,
            _ => Mode::Adaptive,
        };
    }

    /// Debug override from `setSpeed({x})`.
    pub fn fix(&mut self, x: f32) {
        self.fixed_x = x.clamp(X_MIN, X_MAX);
        self.mode = Mode::Fixed;
    }

    pub fn x(&self) -> f32 {
        let lo = (self.base - 1.0).max(X_MIN);
        let hi = (self.base + 1.5).min(X_MAX);
        let x = (self.base + self.drift + self.offset).clamp(lo, hi);
        match self.mode {
            Mode::Fixed => self.fixed_x,
            Mode::Adaptive => x,
            Mode::Boss => (x + BOSS_X_OFFSET).max(X_MIN),
            Mode::Tutorial => x.min(0.0),
        }
    }

    fn updates_offset(&self) -> bool {
        self.mode == Mode::Adaptive
    }

    fn gate_open(&self) -> bool {
        let n = self.recent.len();
        if n == 0 {
            return true;
        }
        let c = self.recent.iter().filter(|&&r| r == b'C').count();
        c as f32 / n as f32 >= RISE_GATE_ACC
    }

    fn apply(&mut self, d: f32) -> bool {
        if d == 0.0 || !self.updates_offset() {
            return false;
        }
        if d > 0.0 && !self.gate_open() {
            return false;
        }
        let net = (self.offset - self.offset_start + d).clamp(ROUND_CAP_DOWN, ROUND_CAP_UP);
        let new = self.offset_start + net;
        let changed = (new - self.offset).abs() > 1e-6;
        self.offset = new;
        changed
    }

    /// A graded first-try deck resolution. Returns true when `offset` changed.
    pub fn record(&mut self, r: Res, fast: bool, blade_ready: bool) -> bool {
        self.recent.push(r.code());
        if self.recent.len() > RISE_GATE_WINDOW {
            self.recent.remove(0);
        }
        if self.window_n == EASE_WINDOW {
            self.window.copy_within(1.., 0);
            self.window_n -= 1;
        }
        self.window[self.window_n] = r.code();
        self.window_n += 1;
        self.since_ease += 1;

        let d = match r {
            Res::Correct if fast => D_FAST,
            Res::Correct => 0.0,
            Res::Wrong => D_WRONG,
            Res::Escape if blade_ready => D_ESCAPE_READY,
            Res::Escape => D_ESCAPE_REFORGE,
        };
        let mut changed = self.apply(d);
        if r != Res::Correct && self.updates_offset() {
            let misses = self.window[..self.window_n].iter().filter(|&&c| c != b'C').count();
            if misses >= EASE_MISSES && self.since_ease >= EASE_WINDOW {
                self.since_ease = 0;
                self.gentle_left = GENTLE_SPAWNS;
                changed |= self.apply(D_EASE);
            }
        }
        changed
    }

    /// Combo reached 10: +0.05 once per round.
    pub fn combo10(&mut self) -> bool {
        if self.combo10_done {
            return false;
        }
        self.combo10_done = true;
        self.apply(D_COMBO10)
    }

    pub fn recent_string(&self, out: &mut String) {
        for &c in &self.recent {
            out.push(c as char);
        }
    }
}

impl Default for Adaptive {
    fn default() -> Self {
        Adaptive::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adaptive(base: f32, offset: f32, recent: &str) -> Adaptive {
        let mut a = Adaptive::new();
        let s = SpeedInput { base, level: 1, offset, recent: recent.bytes().collect(), ..SpeedInput::default() };
        a.start(&s, RoundType::Normal);
        a
    }

    #[test]
    fn tiers_interpolate() {
        assert_eq!(tier_lerp(&TIER_FLIGHT_S, 0.0), 11.0);
        assert!((tier_lerp(&TIER_FLIGHT_S, 2.5) - 6.75).abs() < 1e-5);
        assert_eq!(tier_lerp(&TIER_FLIGHT_S, 9.0), 4.2);
        assert_eq!(tier_max_on_screen(1.6), 3);
        assert_eq!(tier_max_on_screen(-1.0), 1);
    }

    #[test]
    fn x_eff_clamps_and_drift() {
        let mut a = Adaptive::new();
        a.start(&SpeedInput { base: 2.0, level: 40, offset: 3.0, ..SpeedInput::default() }, RoundType::Normal);
        assert_eq!(a.x(), 3.5, "capped at base + 1.5");
        a.start(&SpeedInput { base: 0.0, level: 11, offset: -5.0, ..SpeedInput::default() }, RoundType::Normal);
        assert_eq!(a.x(), -1.0);
        a.start(&SpeedInput { base: 2.0, level: 11, offset: 0.0, ..SpeedInput::default() }, RoundType::Boss);
        assert!((a.x() - 1.7).abs() < 1e-5);
        a.start(&SpeedInput { base: 2.0, ..SpeedInput::default() }, RoundType::Tutorial);
        assert_eq!(a.x(), 0.0);
    }

    #[test]
    fn fast_correct_rises_with_gate_and_cap() {
        let mut a = adaptive(1.0, 0.0, "");
        for _ in 0..20 {
            a.record(Res::Correct, true, true);
        }
        assert!((a.offset - ROUND_CAP_UP).abs() < 1e-5, "capped at +0.35, got {}", a.offset);

        // Rise gate: 6/8 = 75 % passes, 5/8 does not.
        let mut a = adaptive(1.0, 0.0, "WWCCCCC");
        assert!(a.record(Res::Correct, true, true), "6 of 8 correct");
        let mut a = adaptive(1.0, 0.0, "WWWCCCC");
        assert!(!a.record(Res::Correct, true, true), "5 of 8 correct: gate closed");
    }

    #[test]
    fn misses_ease_and_gentle_mode() {
        let mut a = adaptive(2.0, 0.0, "CCCCCCCC");
        a.record(Res::Wrong, false, true);
        assert!((a.offset - -0.10).abs() < 1e-5);
        a.record(Res::Escape, false, true);
        // −0.10 −0.12 −0.15 (ease)
        assert!((a.offset - -0.37).abs() < 1e-5, "{}", a.offset);
        assert_eq!(a.gentle_left, GENTLE_SPAWNS);
        a.gentle_left = 0;
        // Ease fires at most once every 4 resolutions.
        a.record(Res::Escape, false, false);
        assert_eq!(a.gentle_left, 0);
        assert!((a.offset - -0.42).abs() < 1e-5, "{}", a.offset);
        for _ in 0..10 {
            a.record(Res::Wrong, false, true);
        }
        assert!((a.offset - ROUND_CAP_DOWN).abs() < 1e-5, "floor −0.80, got {}", a.offset);
        assert_eq!(a.recent.len(), 8);
    }

    #[test]
    fn frozen_modes_keep_offset_but_track_recent() {
        let mut a = Adaptive::new();
        a.start(&SpeedInput { base: 2.0, offset: 0.2, ..SpeedInput::default() }, RoundType::Boss);
        a.record(Res::Wrong, false, true);
        a.record(Res::Wrong, false, true);
        assert_eq!(a.offset, 0.2);
        assert_eq!(a.recent, b"WW".to_vec());
        assert!(!a.combo10());
    }
}
