//! Round simulation: deck play, spawning, arcs, the swipe rule, resolution,
//! points and combo, specials, boss, adaptive speed and the event queue.
//! Pure Rust, no web dependencies (unit-tested). Visual effects are in
//! `fx.rs`, JSON in `events.rs`. Numbers live in `tuning.rs`.

use crate::adaptive::{tier_lerp, tier_max_on_screen, Adaptive, Mode, Res};
use crate::config::{Band, EventKind, RoundConfig, RoundType, Slot, SlotKind, SpeedInput, Special};
use crate::deck::Deck;
use crate::events::{Event, MInfo, Outcome, ResultRec};
use crate::facts::{Fact, Label};
use crate::particles::Particles;
use crate::rng::Rng;
use crate::species::{self, Rgb, SpeciesRef, BLADES, NUM_BASE, TRAILS};
use crate::tuning::*;
use crate::vec2::{segment_hits_circle, v2, Vec2};

/// Fixed simulation step (seconds).
pub const STEP: f32 = 1.0 / 120.0;
const MAX_STEPS_PER_FRAME: u32 = 12;
/// Smallest monster radius in world units (the short screen side is 1000).
pub const MIN_RADIUS: f32 = 118.0;
pub const TRAIL_CAP: usize = 48;
pub const TRAIL_LIFE: f32 = 0.18;
const STROKE_CAP: usize = 8;
const GIGGLES: [&str; 3] = ["sfx_monster_giggle_1", "sfx_monster_giggle_2", "sfx_monster_giggle_3"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MState {
    /// In the air and answerable.
    Flying,
    /// Answered wrongly: shows the full fact; only the right charge does anything.
    Revealed,
    /// Correct: squashing for a moment before the pop.
    Popping,
}

#[derive(Clone, Copy, Debug)]
pub struct Monster {
    pub id: u32,
    pub slot: Slot,
    /// Current fact (the inner form after an armored crack).
    pub fact: Fact,
    pub label: Label,
    pub full: Label,
    pub species: SpeciesRef,
    pub color: Rgb,
    pub color2: Rgb,
    pub pos: Vec2,
    pub vel: Vec2,
    pub gravity: f32,
    pub radius: f32,
    pub flight: f32,
    pub time_scale: f32,
    pub rot: f32,
    pub rot_amp: f32,
    pub rot_speed: f32,
    pub phase: f32,
    pub age: f32,
    /// Round time at launch (for RT).
    pub spawn_rt: f32,
    pub blink_timer: f32,
    pub blink_t: f32,
    pub look: Vec2,
    pub state: MState,
    /// Seconds of the wrong-answer freeze left.
    pub reveal: f32,
    /// 0..1: growth to 1.6× while frozen.
    pub grow: f32,
    pub squash: f32,
    pub pop_t: f32,
    /// 0 none, 1 shell intact, 2 cracked (inner showing).
    pub armor: u8,
    /// The next resolution of this monster is graded (first try).
    pub graded: bool,
    pub mini: bool,
    pub golden: bool,
    pub minion: bool,
    pub ghost: bool,
    pub bubble: bool,
    pub hit_flash: f32,
    /// Crack flash after the shell breaks / happy spin after "Fixed it!".
    pub crack_t: f32,
    pub tricky_cleared: bool,
    /// Shown for the first time this round (faint answer hint).
    pub first_showing: bool,
}

impl Monster {
    /// 0 = eyes open, 1 = fully closed.
    pub fn blink_amount(&self) -> f32 {
        if self.blink_t < 0.0 {
            0.0
        } else {
            (self.blink_t * std::f32::consts::PI).sin()
        }
    }
    pub fn info(&self) -> MInfo {
        MInfo {
            id: self.id,
            fact: self.fact,
            slot: self.slot.index,
            kind: self.slot.kind,
            special: self.slot.special,
            species: self.species,
            shiny: self.slot.shiny,
            ghost: self.ghost,
            mini: self.mini,
            golden: self.golden,
            minion: self.minion,
        }
    }
    /// Deck-origin (not golden, not a mini).
    pub fn from_deck(&self) -> bool {
        !self.golden && !self.mini
    }
}

/// The happy face that floats up out of a pop.
#[derive(Clone, Copy, Debug)]
pub struct Friend {
    pub pos: Vec2,
    pub vel: Vec2,
    pub life: f32,
    pub max_life: f32,
    pub species: SpeciesRef,
    pub color: Rgb,
    pub color2: Rgb,
    pub radius: f32,
    pub shiny: bool,
    /// Extra happy spin (tricky cleared).
    pub spin: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FlyKind {
    Coin,
    Lantern,
    /// Sparkle beam from a minion to the boss.
    Beam,
    /// Blade shard spiralling back during the reforge.
    Shard,
}

#[derive(Clone, Copy, Debug)]
pub struct Flyer {
    pub kind: FlyKind,
    pub from: Vec2,
    pub to: Vec2,
    /// Sideways bulge of the path (world units, signed).
    pub bend: f32,
    pub delay: f32,
    pub t: f32,
    pub dur: f32,
    pub size: f32,
    pub color: [f32; 4],
    pub rot: f32,
}

impl Flyer {
    pub fn k(&self) -> f32 {
        (self.t / self.dur).clamp(0.0, 1.0)
    }
    pub fn pos(&self) -> Vec2 {
        let k = self.k();
        let e = if self.kind == FlyKind::Shard { 1.0 - (1.0 - k) * (1.0 - k) } else { k * k * (3.0 - 2.0 * k) };
        let d = self.to - self.from;
        let n = d.perp().norm();
        let wob = if self.kind == FlyKind::Shard { (1.0 - e) * (k * 9.0 + self.rot).sin() } else { 1.0 };
        self.from + d * e + n * (self.bend * (std::f32::consts::PI * e).sin() * wob)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Banner {
    pub label: Label,
    pub color: Rgb,
    pub life: f32,
    pub max_life: f32,
    pub size: f32,
    /// Fraction of view height.
    pub y: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct Popup {
    pub pos: Vec2,
    pub vel: Vec2,
    pub life: f32,
    pub max_life: f32,
    pub label: Label,
    pub color: Rgb,
    pub size: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct Slash {
    pub a: Vec2,
    pub b: Vec2,
    pub life: f32,
    pub width: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct TrailPt {
    pub pos: Vec2,
    pub time: f32,
    /// Distance along the stroke (for rainbow hue).
    pub dist: f32,
}

/// One finger-down-to-up swipe (§2.8 swipe rule).
#[derive(Clone, Copy, Debug, Default)]
pub struct Stroke {
    /// Non-matching monsters touched, in order.
    touched: [u32; STROKE_CAP],
    n: usize,
    /// Sim time of the first touch of a non-matching monster.
    first_touch: f32,
    /// A right answer landed: nothing in this stroke can be wrong.
    scored: bool,
    /// Monsters cracked in this stroke (their inner needs a new stroke).
    ignore: [u32; 4],
    ni: usize,
}

pub struct Blade {
    pub down: bool,
    pub pos: Vec2,
    pub has_pos: bool,
    pub trail: Vec<TrailPt>,
    /// Seconds of reforge left (>0 = broken, swipes do nothing).
    pub broken: f32,
    pub reforge_total: f32,
    pub guard: bool,
    pub swipe_len: f32,
    pub swoosh_played: bool,
    pub last_move: f32,
    pub fx_dist: f32,
    pub stroke: Stroke,
    pub shards_called: bool,
    /// Where the blade broke (shards fly back from around here).
    pub broke_at: Vec2,
}

#[derive(Clone, Copy, Debug)]
pub struct Boss {
    pub species: SpeciesRef,
    pub hp: u32,
    pub max_hp: u32,
    pub pos: Vec2,
    pub radius: f32,
    /// 0 → 1 during the entry.
    pub enter: f32,
    pub hit_flash: f32,
    pub bonk: f32,
    /// Seconds into the defeat sequence (None = still playing).
    pub defeat: Option<f32>,
    pub fireworks: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Pending {
    Deck,
    Golden,
}

#[derive(Clone, Copy, Debug)]
pub struct Intro {
    pub t: f32,
    pub special: Special,
    pub species: SpeciesRef,
    pub name: Label,
    pub line: Label,
    pending: Pending,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoundState {
    Idle,
    Playing,
    /// No more spawns; waiting for the remaining monsters to leave.
    Draining,
    Ended,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Stats {
    /// Config deck slots played.
    pub sums: u32,
    pub correct: u32,
    pub wrong: u32,
    pub escaped: u32,
    pub golden: u32,
    pub minis: u32,
    pub fixed: u32,
}

#[derive(Clone, Copy, Debug)]
enum Launch {
    Bottom { side: bool, right: bool },
    Boss,
    /// Splitsy minis hop out of the pop point (direction ±1).
    Hop(Vec2, f32),
}

pub struct Sim {
    /// Play-area size in world units.
    pub view: Vec2,
    pub cfg: RoundConfig,
    pub rng: Rng,
    pub fx: Rng,
    pub time: f32,
    accumulator: f32,
    pub paused: bool,
    pub effects_scale: f32,
    pub calm: bool,
    calm_user: bool,
    pub blade_skin: u8,
    pub trail_skin: u8,
    anchor_sparks: Option<Vec2>,
    anchor_island: Option<Vec2>,

    pub round: RoundState,
    pub round_time: f32,
    pub aborted: bool,
    pub hard_stopped: bool,
    pub unplayed: u32,
    pub deck: Deck,
    pub adaptive: Adaptive,
    pub x_start: f32,
    since_spawn: f32,
    spawn_block: f32,
    first_spawn: bool,
    deck_taken: u32,
    golden_at: Vec<u32>,
    golden_next: usize,
    intros_done: u8,
    pub intro: Option<Intro>,
    next_id: u32,
    pub tutorial_correct: u32,
    tricky_need: Vec<((i32, i32, u8), u8)>,
    pub tricky_cleared: Vec<Fact>,
    /// Facts already shown this round (first-showing answer hint).
    seen: Vec<(i32, i32, u8)>,
    wrong_times: [f32; GUARD_WRONGS],
    wrong_n: usize,
    last_correct_rt: f32,
    blade_ready_rt: f32,

    pub monsters: Vec<Monster>,
    pub friends: Vec<Friend>,
    pub flyers: Vec<Flyer>,
    pub banners: Vec<Banner>,
    pub popups: Vec<Popup>,
    pub slashes: Vec<Slash>,
    pub particles: Particles,
    pub blade: Blade,
    pub boss: Option<Boss>,
    pub charged: Option<i32>,
    /// 1 → 0 after the charge changes (pop-in 1.3 → 1 over 120 ms).
    pub charge_pop: f32,

    pub combo: u32,
    pub best_combo: u32,
    pub tier: u32,
    /// >0 while the combo counter deflates after a break.
    pub combo_break_anim: f32,
    pub combo_was: u32,
    /// 1 → 0 bump when the combo grows.
    pub combo_bump: f32,
    pub score: u32,
    pub stats: Stats,
    pub results: Vec<ResultRec>,

    pub hitstop: f32,
    pub shake_amp: f32,
    pub shake_t: f32,
    pub shake_dur: f32,
    pub shake_offset: Vec2,
    pub flash: [f32; 4],
    pub last_flash: f32,
    pub vignette: f32,
    pub hue_pulse: f32,
    pub chill: f32,
    /// Seconds others run at half speed after a wrong, and who is frozen.
    pub wrong_slow: f32,
    wrong_id: u32,
    pub guard_hint: f32,
    pub ambient_t: f32,

    pub events: Vec<Event>,
}

/// Arc for a launch: start, end, apex height, flight time → velocity, gravity.
pub fn solve_arc(p0: Vec2, p_end: Vec2, apex_y: f32, t: f32) -> (Vec2, f32) {
    let a = (apex_y - p0.y).max(1.0);
    let b = (apex_y - p_end.y).max(1.0);
    let s = (2.0 * a).sqrt() + (2.0 * b).sqrt();
    let g = (s / t) * (s / t);
    let vy = (2.0 * g * a).sqrt();
    (v2((p_end.x - p0.x) / t, vy), g)
}

impl Sim {
    pub fn new(seed: u64) -> Sim {
        Sim {
            view: v2(1600.0, 1000.0),
            cfg: RoundConfig::default(),
            rng: Rng::new(seed),
            fx: Rng::new(seed ^ 0x9e37_79b9_7f4a_7c15),
            time: 0.0,
            accumulator: 0.0,
            paused: false,
            effects_scale: 1.0,
            calm: false,
            calm_user: false,
            blade_skin: 0,
            trail_skin: 0,
            anchor_sparks: None,
            anchor_island: None,
            round: RoundState::Idle,
            round_time: 0.0,
            aborted: false,
            hard_stopped: false,
            unplayed: 0,
            deck: Deck::new(),
            adaptive: Adaptive::new(),
            x_start: 0.0,
            since_spawn: 0.0,
            spawn_block: 0.0,
            first_spawn: true,
            deck_taken: 0,
            golden_at: Vec::with_capacity(8),
            golden_next: 0,
            intros_done: 0,
            intro: None,
            next_id: 1,
            tutorial_correct: 0,
            tricky_need: Vec::with_capacity(64),
            tricky_cleared: Vec::with_capacity(16),
            seen: Vec::with_capacity(64),
            wrong_times: [-100.0; GUARD_WRONGS],
            wrong_n: 0,
            last_correct_rt: 0.0,
            blade_ready_rt: 0.0,
            monsters: Vec::with_capacity(16),
            friends: Vec::with_capacity(16),
            flyers: Vec::with_capacity(64),
            banners: Vec::with_capacity(8),
            popups: Vec::with_capacity(16),
            slashes: Vec::with_capacity(8),
            particles: Particles::with_capacity(MAX_PARTICLES),
            blade: Blade {
                down: false,
                pos: v2(0.0, 0.0),
                has_pos: false,
                trail: Vec::with_capacity(TRAIL_CAP),
                broken: 0.0,
                reforge_total: 1.0,
                guard: false,
                swipe_len: 0.0,
                swoosh_played: false,
                last_move: -10.0,
                fx_dist: 0.0,
                stroke: Stroke::default(),
                shards_called: true,
                broke_at: v2(0.0, 0.0),
            },
            boss: None,
            charged: None,
            charge_pop: 0.0,
            combo: 0,
            best_combo: 0,
            tier: 0,
            combo_break_anim: 0.0,
            combo_was: 0,
            combo_bump: 0.0,
            score: 0,
            stats: Stats::default(),
            results: Vec::with_capacity(256),
            hitstop: 0.0,
            shake_amp: 0.0,
            shake_t: 0.0,
            shake_dur: 1.0,
            shake_offset: v2(0.0, 0.0),
            flash: [0.0; 4],
            last_flash: -10.0,
            vignette: 0.0,
            hue_pulse: 0.0,
            chill: 0.0,
            wrong_slow: 0.0,
            wrong_id: 0,
            guard_hint: 0.0,
            ambient_t: 0.0,
            events: Vec::with_capacity(256),
        }
    }

    // ------------------------------------------------------------- settings

    /// Set play-area size in world units. Monsters in the air are rescaled so a
    /// rotation/resize never makes them "escape" unfairly.
    pub fn set_view(&mut self, w: f32, h: f32) {
        let (ow, oh) = (self.view.x, self.view.y);
        if ow > 0.0 && oh > 0.0 && (ow != w || oh != h) {
            let (sx, sy) = (w / ow, h / oh);
            for m in &mut self.monsters {
                m.pos.x *= sx;
                m.vel.x *= sx;
                m.pos.y = (m.pos.y + m.radius * 1.2) * sy - m.radius * 1.2;
                m.vel.y *= sy;
                m.gravity *= sy;
            }
            if let Some(b) = &mut self.boss {
                b.pos = v2(w * 0.5, h * 0.76);
                b.radius = BOSS_DIAMETER_H * 0.5 * h;
            }
        }
        self.view = v2(w, h);
    }

    pub fn set_anchor(&mut self, name: &str, p: Vec2) {
        match name {
            "sparks" => self.anchor_sparks = Some(p),
            "island" => self.anchor_island = Some(p),
            _ => {}
        }
    }

    /// Where coins (sparks) and lanterns (island) fly to, in world units.
    pub fn anchor(&self, sparks: bool) -> Vec2 {
        let (w, h) = (self.view.x, self.view.y);
        if sparks {
            self.anchor_sparks.unwrap_or(v2(w - 90.0, h - 60.0))
        } else {
            self.anchor_island.unwrap_or(v2(90.0, h - 60.0))
        }
    }

    pub fn set_calm(&mut self, calm: bool) {
        self.calm_user = calm;
        self.calm = calm || self.cfg.calm.unwrap_or(false);
    }

    pub fn set_cosmetics(&mut self, blade: Option<u8>, trail: Option<u8>) {
        if let Some(b) = blade {
            self.blade_skin = b.min(BLADES.len() as u8 - 1);
        }
        if let Some(t) = trail {
            self.trail_skin = t.min(TRAILS.len() as u8 - 1);
        }
    }

    pub fn set_charged(&mut self, n: Option<i32>) {
        if n != self.charged && n.is_some() {
            self.charge_pop = 1.0;
        }
        self.charged = n;
    }

    /// Live override (debug): `{x}` fixes x; `flight_time` etc. override.
    pub fn set_speed(&mut self, s: SpeedInput) {
        if let Some(x) = s.fixed_x {
            self.adaptive.fix(x);
        }
        self.cfg.speed = s;
    }

    // ---------------------------------------------------------------- round

    pub fn start_round(&mut self, cfg: RoundConfig) {
        self.rng = Rng::new(cfg.seed);
        self.fx = Rng::new(cfg.seed ^ 0x9e37_79b9_7f4a_7c15);
        self.adaptive.start(&cfg.speed, cfg.round_type);
        self.x_start = self.adaptive.x();
        let boss_round = cfg.round_type == RoundType::Boss;
        self.deck.load(&cfg.deck, boss_round);
        self.golden_at.clear();
        let n = cfg.deck.len() as f32;
        for _ in cfg.golden.iter().take(8) {
            let at = self.rng.range(GOLDEN_WINDOW.0 * n, GOLDEN_WINDOW.1 * n).floor() as u32;
            self.golden_at.push(at);
        }
        self.golden_at.sort_unstable();
        self.golden_next = 0;
        self.tricky_need.clear();
        for s in &cfg.deck {
            if s.tricky {
                let key = s.fact.key();
                if !self.tricky_need.iter().any(|(k, _)| *k == key) && self.tricky_need.len() < self.tricky_need.capacity() {
                    self.tricky_need.push((key, s.tricky_need.unwrap_or(3).max(1)));
                }
            }
        }
        self.tricky_cleared.clear();
        self.seen.clear();
        let (w, h) = (self.view.x, self.view.y);
        self.boss = cfg.boss.filter(|_| boss_round).map(|b| Boss {
            species: b.species,
            hp: b.hp.max(1),
            max_hp: b.hp.max(1),
            pos: v2(w * 0.5, h * 0.76),
            radius: BOSS_DIAMETER_H * 0.5 * h,
            enter: 0.0,
            hit_flash: 0.0,
            bonk: 0.0,
            defeat: None,
            fireworks: 0,
        });
        self.cfg = cfg;
        self.calm = self.calm_user || self.cfg.calm.unwrap_or(false);
        self.round = RoundState::Playing;
        self.round_time = 0.0;
        self.aborted = false;
        self.hard_stopped = false;
        self.unplayed = 0;
        self.since_spawn = 0.0;
        self.spawn_block = if boss_round { BOSS_ENTER_S + 0.3 } else { FIRST_SPAWN_S };
        self.first_spawn = true;
        self.deck_taken = 0;
        self.intros_done = 0;
        self.intro = None;
        self.tutorial_correct = 0;
        self.wrong_times = [-100.0; GUARD_WRONGS];
        self.wrong_n = 0;
        self.last_correct_rt = 0.0;
        self.blade_ready_rt = 0.0;
        self.monsters.clear();
        self.friends.clear();
        self.flyers.clear();
        self.banners.clear();
        self.popups.clear();
        self.slashes.clear();
        self.particles.clear();
        self.charged = None;
        self.blade.broken = 0.0;
        self.blade.guard = false;
        self.blade.trail.clear();
        self.blade.stroke = Stroke::default();
        self.blade.shards_called = true;
        self.combo = 0;
        self.best_combo = 0;
        self.tier = 0;
        self.combo_break_anim = 0.0;
        self.combo_bump = 0.0;
        self.score = 0;
        self.stats = Stats::default();
        self.results.clear();
        self.hitstop = 0.0;
        self.chill = 0.0;
        self.wrong_slow = 0.0;
        self.guard_hint = 0.0;
        self.vignette = 0.0;
        self.hue_pulse = 0.0;
        self.events.push(Event::RoundStart);
        for i in 0..self.cfg.warnings.len().min(32) {
            self.events.push(Event::Warning(i as u16));
        }
        self.sfx("sfx_round_start");
        if let Some(e) = self.cfg.event {
            self.banner(e.title(), [1.0, 0.86, 0.4], 1.1, 0.6);
        }
        if boss_round {
            self.sfx("sfx_boss_enter");
            self.sfx("vo_boss_time");
        }
    }

    /// End the round now (e.g. player quit). Emits `round_end` with `aborted: true`.
    pub fn stop_round(&mut self) {
        if matches!(self.round, RoundState::Playing | RoundState::Draining) {
            self.aborted = true;
            self.unplayed = self.deck.remaining() as u32;
            self.monsters.clear();
            self.intro = None;
            self.end_round();
        }
    }

    fn end_round(&mut self) {
        self.round = RoundState::Ended;
        self.sfx("sfx_round_end");
        self.events.push(Event::RoundEnd);
    }

    pub fn boss_round(&self) -> bool {
        self.cfg.round_type == RoundType::Boss && self.boss.is_some()
    }

    // ----------------------------------------------------------------- speed

    pub fn x(&self) -> f32 {
        self.adaptive.x()
    }

    pub fn flight_base(&self) -> f32 {
        self.cfg.speed.flight_time.unwrap_or_else(|| tier_lerp(&TIER_FLIGHT_S, self.x()))
    }

    pub fn interval(&self) -> f32 {
        let i = self.cfg.speed.spawn_interval.unwrap_or_else(|| tier_lerp(&TIER_INTERVAL_S, self.x()));
        if self.adaptive.gentle_left > 0 {
            i * GENTLE_INTERVAL_MUL
        } else {
            i
        }
    }

    pub fn max_on_screen(&self) -> u32 {
        let mut m = self.cfg.speed.max_on_screen.unwrap_or_else(|| tier_max_on_screen(self.x()));
        if self.cfg.speed.max_on_screen.is_none() {
            if self.cfg.band == Band::Little {
                m = m.min(LITTLE_MAX_ON_SCREEN_CAP);
            }
            if self.cfg.round_type == RoundType::Tutorial && self.deck_taken < TUTORIAL_SINGLE_FOR {
                m = 1;
            }
            if self.cfg.event == Some(EventKind::BubbleBreeze) {
                m += 1;
            }
        }
        if self.monsters.iter().any(|m| m.mini && m.state != MState::Popping) {
            m += 1;
        }
        m.max(1)
    }

    fn on_screen(&self) -> u32 {
        self.monsters.iter().filter(|m| m.state != MState::Popping).count() as u32
    }

    fn reforge_s(&self) -> f32 {
        self.cfg.reforge_s.unwrap_or(match self.cfg.band {
            Band::Little => REFORGE_LITTLE_S,
            Band::Big => REFORGE_BIG_S,
        })
    }

    /// Monster radius: the minimum diameter for the band, at least 118 units,
    /// at most 34 % of the width.
    pub fn radius(&self) -> f32 {
        let (w, h) = (self.view.x, self.view.y);
        let d = match self.cfg.band {
            Band::Little => MIN_DIAMETER_LITTLE,
            Band::Big => MIN_DIAMETER_BIG,
        };
        (d * h * 0.5).max(MIN_RADIUS).min(MAX_DIAMETER_W * w * 0.5)
    }

    // ------------------------------------------------------------------ time

    /// Advance by a frame of `dt` seconds using fixed steps.
    pub fn advance(&mut self, dt: f32) {
        if self.paused {
            return;
        }
        self.accumulator += dt.clamp(0.0, 0.1);
        let mut steps = 0;
        while self.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME {
            self.step(STEP);
            self.accumulator -= STEP;
            steps += 1;
        }
        if steps == MAX_STEPS_PER_FRAME {
            self.accumulator = 0.0;
        }
    }

    pub fn step(&mut self, dt: f32) {
        // Hit-stop pauses the whole world, timers included.
        if self.hitstop > 0.0 {
            self.hitstop -= dt;
            return;
        }
        self.time += dt;
        self.update_blade(dt);
        self.check_stroke_timeout();

        if let Some(intro) = &mut self.intro {
            intro.t += dt;
            if intro.t >= INTRO_S {
                let pending = intro.pending;
                self.intro = None;
                self.spawn_pending(pending);
            }
        } else {
            self.update_round(dt);
            self.update_monsters(dt);
            self.update_boss(dt);
            for i in 0..self.monsters.len() {
                let m = &self.monsters[i];
                if m.golden && m.state == MState::Flying {
                    let (p, r) = (m.pos, m.radius);
                    self.golden_sparkle_fx(p, r);
                }
            }
        }
        self.update_fx(dt);
        self.update_timers(dt);
        self.check_end();
    }

    fn update_timers(&mut self, dt: f32) {
        if self.chill > 0.0 {
            self.chill -= dt;
            if self.chill <= 0.0 {
                self.chill = 0.0;
                self.events.push(Event::Unfreeze);
                self.sfx("sfx_unfreeze");
            }
        }
        self.wrong_slow = (self.wrong_slow - dt).max(0.0);
        self.guard_hint = (self.guard_hint - dt).max(0.0);
        self.charge_pop = (self.charge_pop - dt / 0.12).max(0.0);
        self.combo_break_anim = (self.combo_break_anim - dt).max(0.0);
        self.combo_bump = (self.combo_bump - dt / 0.2).max(0.0);
        self.vignette = (self.vignette - dt / 0.6).max(0.0);
        self.hue_pulse = (self.hue_pulse - dt / 0.8).max(0.0);
        self.flash[3] *= (-9.0 * dt).exp();
        self.shake_t = (self.shake_t - dt).max(0.0);
        let k = if self.shake_dur > 0.0 { self.shake_t / self.shake_dur } else { 0.0 };
        let s = self.shake_amp * k * k;
        if s > 0.01 {
            self.shake_offset = v2(self.fx.range(-s, s), self.fx.range(-s, s));
        } else {
            self.shake_offset = v2(0.0, 0.0);
            self.shake_amp = 0.0;
        }
    }

    fn update_blade(&mut self, dt: f32) {
        let now = self.time;
        self.blade.trail.retain(|t| now - t.time < TRAIL_LIFE);
        if self.blade.broken > 0.0 {
            self.blade.broken -= dt;
            if !self.blade.shards_called && self.blade.broken < 0.45 {
                self.blade.shards_called = true;
                self.reforge_fx();
            }
            if self.blade.broken <= 0.0 {
                self.blade.broken = 0.0;
                self.blade.guard = false;
                self.blade_ready_rt = self.round_time;
                self.events.push(Event::BladeReady);
                self.sfx("sfx_blade_reforge");
                self.blade_ready_fx();
            }
        }
    }

    fn update_round(&mut self, dt: f32) {
        if self.round == RoundState::Draining {
            // A wrong or escape on the last sum can append a copy (§2.5):
            // go back to playing so that copy still appears.
            let defeated = self.boss.map_or(false, |b| b.defeat.is_some());
            if self.hard_stopped || defeated || self.deck.is_empty() {
                self.round_time += dt;
                return;
            }
            self.round = RoundState::Playing;
        }
        if self.round != RoundState::Playing {
            return;
        }
        self.round_time += dt;
        let boss = self.boss_round();
        if !boss && self.round_time >= HARD_STOP_S {
            self.hard_stopped = true;
            self.unplayed = self.deck.remaining() as u32;
            self.round = RoundState::Draining;
            return;
        }
        if self.deck.is_empty() && self.golden_next >= self.golden_at.len() {
            self.round = RoundState::Draining;
            return;
        }
        if self.boss.map_or(false, |b| b.defeat.is_some()) {
            return;
        }
        // Chillby: spawning pauses while the world is chilled.
        if self.chill > 0.0 {
            return;
        }
        self.since_spawn += dt;
        if self.spawn_block > 0.0 {
            self.spawn_block -= dt;
            if self.spawn_block > 0.0 {
                return;
            }
        }
        let on = self.on_screen();
        let ready = self.first_spawn || self.since_spawn >= self.interval() || (on == 0 && self.since_spawn >= LULL_S);
        if !ready || on >= self.max_on_screen() {
            return;
        }
        if !self.try_spawn() {
            self.spawn_block = RETRY_S;
        }
    }

    /// Uniqueness (§2.8): no shared answer or fact with anything on screen.
    fn unique(monsters: &[Monster], f: &Fact) -> bool {
        monsters.iter().all(|m| m.state == MState::Popping || (m.fact.answer != f.answer && m.fact.key() != f.key()))
    }

    fn golden_due(&self) -> bool {
        self.golden_next < self.golden_at.len() && (self.deck_taken >= self.golden_at[self.golden_next] || self.deck.is_empty())
    }

    fn intro_bit(s: Special) -> u8 {
        match s {
            Special::Armored => 1,
            Special::Freeze => 2,
            Special::Splitter => 4,
            Special::Golden => 8,
            Special::None => 0,
        }
    }

    /// One spawn opportunity. False when nothing passes uniqueness.
    fn try_spawn(&mut self) -> bool {
        if self.golden_due() {
            let g = self.cfg.golden[self.golden_next];
            if Self::unique(&self.monsters, &g.fact) {
                if g.intro && self.intros_done & 8 == 0 {
                    let sp = self.slot_species(&g);
                    self.start_intro(Special::Golden, sp, Pending::Golden);
                } else {
                    self.spawn_pending(Pending::Golden);
                }
                return true;
            }
            if self.deck.is_empty() {
                return false;
            }
        }
        let mons = &self.monsters;
        let Some(i) = self.deck.next_index(|s| Self::unique(mons, &s.fact)) else {
            return false;
        };
        let s = self.deck.slots[i];
        if s.intro && s.special != Special::None && self.intros_done & Self::intro_bit(s.special) == 0 {
            let sp = self.slot_species(&s);
            self.start_intro(s.special, sp, Pending::Deck);
            return true;
        }
        self.spawn_pending(Pending::Deck);
        true
    }

    fn start_intro(&mut self, special: Special, species: SpeciesRef, pending: Pending) {
        self.intros_done |= Self::intro_bit(special);
        let line = match special {
            Special::Golden => "Pop for treasure!",
            Special::Armored => "Crack, then pop!",
            Special::Freeze => "Pop to freeze!",
            Special::Splitter => "Pop, then pop!",
            Special::None => "",
        };
        self.intro = Some(Intro {
            t: 0.0,
            special,
            species,
            name: Label::text(species.info().name),
            line: Label::text(line),
            pending,
        });
        self.events.push(Event::SpecialIntro { special, species });
        self.sfx("sfx_item_reveal");
    }

    fn spawn_pending(&mut self, p: Pending) {
        match p {
            Pending::Golden => {
                if self.golden_next < self.cfg.golden.len() {
                    let g = self.cfg.golden[self.golden_next];
                    let from = self.bottom_launch();
                    if self.launch(g, from).is_some() {
                        self.golden_next += 1;
                        self.sfx("sfx_golden_appear");
                    }
                }
            }
            Pending::Deck => {
                if self.monsters.len() >= self.monsters.capacity() {
                    // Keep the slot in the deck; the spawn timer retries.
                    return;
                }
                let mons = &self.monsters;
                if let Some(s) = self.deck.take_next(|s| Self::unique(mons, &s.fact)) {
                    self.deck_taken += 1;
                    if s.index.is_some() {
                        self.stats.sums += 1;
                    }
                    if self.adaptive.gentle_left > 0 {
                        self.adaptive.gentle_left -= 1;
                    }
                    let from = if self.boss_round() { Launch::Boss } else { self.bottom_launch() };
                    self.launch(s, from);
                }
            }
        }
        self.since_spawn = 0.0;
        self.first_spawn = false;
    }

    fn slot_species(&mut self, s: &Slot) -> SpeciesRef {
        if let Some(sp) = s.species {
            return sp;
        }
        if let Some(sp) = s.special.default_species().and_then(species::species_by_id) {
            return sp;
        }
        SpeciesRef { idx: self.rng.below(NUM_BASE as u32) as u8, grand: false }
    }

    fn bottom_launch(&mut self) -> Launch {
        let side = self.rng.f32() < SIDE_EXIT_CHANCE;
        Launch::Bottom { side, right: self.rng.f32() < 0.5 }
    }

    /// Put a monster in the air.
    /// Launch a monster. Returns `None` (no monster, no `spawn` event, no sound)
    /// when the monster list is at capacity.
    fn launch(&mut self, s: Slot, from: Launch) -> Option<u32> {
        if self.monsters.len() >= self.monsters.capacity() {
            return None;
        }
        let (w, h) = (self.view.x, self.view.y);
        let species = self.slot_species(&s);
        let mini = s.kind == SlotKind::Mini;
        let golden = s.special == Special::Golden;
        let minion = matches!(from, Launch::Boss);
        let mut r = self.radius();
        if mini {
            r *= MINI_SCALE;
        }
        let mut t = self.flight_base();
        if s.was_new {
            t *= FLIGHT_MUL_NEW;
        }
        if s.tricky {
            t *= FLIGHT_MUL_TRICKY;
        }
        if mini {
            t *= FLIGHT_MUL_MINI;
        }
        if self.cfg.event == Some(EventKind::BubbleBreeze) {
            t *= FLIGHT_MUL_BUBBLE;
        }
        if matches!(from, Launch::Hop(..)) {
            t *= 0.8; // the hop starts mid-air
        }
        let (lo, hi) = (w * LAUNCH_X.0, w * LAUNCH_X.1);
        let y_end = -r * 1.2;
        let (p0, p_end, apex) = match from {
            Launch::Bottom { side, right } => {
                let apex = (h * self.rng.range(APEX_Y.0, APEX_Y.1)).min(h - r * 1.1).max(r * 2.0);
                let y0 = -r * 1.2;
                let side_range = if side {
                    let xe = if right { w + r * 1.3 } else { -r * 1.3 };
                    // ≥ 60 % of the flight inside the central 70 %.
                    let (a, b) = if right {
                        (lo, ((0.85 * w - 0.6 * xe) / 0.4).min(hi))
                    } else {
                        (((0.15 * w - 0.6 * xe) / 0.4).max(lo), hi)
                    };
                    if a < b {
                        Some((a, b, xe))
                    } else {
                        None
                    }
                } else {
                    None
                };
                if let Some((a, b, xe)) = side_range {
                    let ye = (h * self.rng.range(SIDE_EXIT_Y.0, SIDE_EXIT_Y.1)).min(apex - r);
                    let x0 = self.spread_x(a, b);
                    (v2(x0, y0), v2(xe, ye), apex)
                } else {
                    let x0 = self.spread_x(lo, hi);
                    let xe = (x0 + self.rng.range(-0.35, 0.35) * w).clamp(lo, hi);
                    (v2(x0, y0), v2(xe, y_end), apex)
                }
            }
            Launch::Boss => {
                let b = self.boss.map(|b| b.pos).unwrap_or(v2(w * 0.5, h * 0.76));
                let p0 = b + v2(self.rng.range(-0.3, 0.3) * r, -r * 0.6);
                let apex = (p0.y + h * 0.06).min(h - r * 1.1).max(p0.y + 1.0);
                let dir = self.rng.sign();
                let xe = (w * 0.5 + dir * self.rng.range(0.12, 0.36) * w).clamp(lo, hi);
                (p0, v2(xe, y_end), apex)
            }
            Launch::Hop(p, dir) => {
                let apex = (p.y + h * 0.12).min(h - r * 1.1).max(p.y + 10.0);
                let xe = (p.x + dir * self.rng.range(0.12, 0.25) * w).clamp(lo, hi);
                (p, v2(xe, y_end), apex)
            }
        };
        let (vel, gravity) = solve_arc(p0, p_end, apex, t);
        let id = self.next_id;
        self.next_id += 1;
        let info = species.info();
        let fact = s.fact;
        let key = fact.key();
        let first_showing = s.kind == SlotKind::New && !self.seen.contains(&key);
        if !self.seen.contains(&key) && self.seen.len() < self.seen.capacity() {
            self.seen.push(key);
        }
        let m = Monster {
            id,
            slot: s,
            fact,
            label: fact.question_label(),
            full: fact.full_label(),
            species,
            color: info.color,
            color2: info.color2,
            pos: p0,
            vel,
            gravity,
            radius: r,
            flight: t,
            time_scale: 1.0,
            rot: 0.0,
            rot_amp: self.rng.range(0.06, 0.16),
            rot_speed: self.rng.range(1.2, 2.2),
            phase: self.rng.range(0.0, 6.283),
            age: 0.0,
            spawn_rt: self.round_time,
            blink_timer: self.fx.range(0.8, 3.5),
            blink_t: -1.0,
            look: v2(0.0, 0.0),
            state: MState::Flying,
            reveal: 0.0,
            grow: 0.0,
            squash: 0.5,
            pop_t: 0.0,
            armor: if s.special == Special::Armored { 1 } else { 0 },
            graded: s.kind != SlotKind::Repeat,
            mini,
            golden,
            minion,
            ghost: s.ghost,
            bubble: self.cfg.event == Some(EventKind::BubbleBreeze),
            hit_flash: 0.0,
            crack_t: 0.0,
            tricky_cleared: false,
            first_showing,
        };
        let info_ev = m.info();
        self.monsters.push(m);
        self.events.push(Event::Spawn(info_ev));
        let n = self.fx.below(3) as usize;
        self.sfx(["sfx_monster_launch_1", "sfx_monster_launch_2", "sfx_monster_launch_3"][n]);
        self.launch_fx(p0, minion);
        Some(id)
    }

    /// A launch x away from the monsters already up (best of 4).
    fn spread_x(&mut self, lo: f32, hi: f32) -> f32 {
        let mut best_x = self.rng.range(lo, hi);
        let mut best_d = -1.0;
        for _ in 0..4 {
            let x = self.rng.range(lo, hi);
            let d = self.monsters.iter().map(|m| (m.pos.x - x).abs()).fold(f32::MAX, f32::min);
            if d > best_d {
                best_d = d;
                best_x = x;
            }
        }
        best_x
    }

    fn update_monsters(&mut self, dt: f32) {
        let blade_pos = self.blade.pos;
        let has_blade = self.blade.has_pos;
        let w = self.view.x;
        let look_k = 1.0 - (-10.0 * dt).exp();
        let global = if self.chill > 0.0 { CHILL_SPEED } else { 1.0 };
        let wrong_slow = self.wrong_slow > 0.0;
        let wrong_id = self.wrong_id;
        let mut i = 0;
        while i < self.monsters.len() {
            let m = &mut self.monsters[i];
            m.age += dt;
            m.hit_flash = (m.hit_flash - dt).max(0.0);
            m.crack_t = (m.crack_t - dt).max(0.0);
            m.squash = (m.squash - dt * 2.5).max(0.0);
            if m.state == MState::Popping {
                m.pop_t += dt;
                if m.pop_t >= POP_SQUASH_S {
                    let m = self.monsters.remove(i);
                    self.pop_fx(&m);
                    continue;
                }
                i += 1;
                continue;
            }
            let mut ts = m.time_scale * global;
            if wrong_slow && m.id != wrong_id {
                ts *= WRONG_OTHERS_SPEED;
            }
            if m.state == MState::Revealed {
                if m.reveal > 0.0 {
                    m.reveal -= dt;
                    m.grow = (m.grow + dt / 0.18).min(1.0);
                    ts = 0.0;
                } else {
                    m.grow = (m.grow - dt / 0.3).max(0.0);
                }
            }
            m.vel.y -= m.gravity * dt * ts;
            m.pos += m.vel * (dt * ts);
            m.rot = m.rot_amp * (m.phase + m.age * m.rot_speed).sin();
            if m.blink_t >= 0.0 {
                m.blink_t += dt / 0.14;
                if m.blink_t >= 1.0 {
                    m.blink_t = -1.0;
                    m.blink_timer = self.fx.range(1.5, 4.5);
                }
            } else {
                m.blink_timer -= dt;
                if m.blink_timer <= 0.0 {
                    m.blink_t = 0.0;
                }
            }
            let target = if has_blade {
                let d = blade_pos - m.pos;
                d.norm() * (d.len() / (m.radius * 3.0)).min(1.0)
            } else {
                v2(0.0, -0.3)
            };
            m.look = m.look.lerp(target.rotate(-m.rot), look_k);

            let r = m.radius;
            let gone = (m.vel.y < 0.0 && m.pos.y < -r * 1.3) || m.pos.x < -r * 1.35 || m.pos.x > w + r * 1.35;
            if gone {
                let m = self.monsters.remove(i);
                self.on_escape(&m);
                continue;
            }
            i += 1;
        }
    }

    fn update_boss(&mut self, dt: f32) {
        let Some(mut b) = self.boss else { return };
        b.enter = (b.enter + dt / BOSS_ENTER_S).min(1.0);
        b.hit_flash = (b.hit_flash - dt).max(0.0);
        b.bonk = (b.bonk - dt).max(0.0);
        let mut fw: [Option<Vec2>; 3] = [None; 3];
        if let Some(t) = b.defeat {
            let t = t + dt;
            b.defeat = Some(t);
            const AT: [f32; 3] = [0.5, 1.1, 1.7];
            while (b.fireworks as usize) < AT.len() && t >= AT[b.fireworks as usize] {
                let k = b.fireworks as usize;
                fw[k] = Some(v2(self.view.x * (0.25 + 0.25 * k as f32), self.view.y * (0.62 + 0.1 * (k % 2) as f32)));
                b.fireworks += 1;
            }
        }
        self.boss = Some(b);
        for p in fw.into_iter().flatten() {
            self.firework_fx(p);
        }
    }

    fn check_end(&mut self) {
        if !matches!(self.round, RoundState::Draining | RoundState::Playing) {
            return;
        }
        if let Some(t) = self.boss.and_then(|b| b.defeat) {
            if t >= BOSS_DEFEAT_S && self.monsters.is_empty() {
                self.end_round();
            }
            return;
        }
        if self.round == RoundState::Draining && self.monsters.is_empty() && self.intro.is_none() {
            self.end_round();
        }
    }

    // -------------------------------------------------------------- scoring

    pub fn combo_tier(combo: u32) -> u32 {
        COMBO_TIERS.iter().filter(|&&t| combo >= t).count() as u32
    }

    fn break_combo(&mut self, reason: &'static str) {
        if self.combo > 0 {
            self.events.push(Event::ComboBreak { was: self.combo, reason });
            if self.combo >= COMBO_COUNTER_FROM {
                self.sfx("sfx_combo_break");
                self.combo_was = self.combo;
                self.combo_break_anim = 0.6;
            }
        }
        self.combo = 0;
        self.tier = 0;
    }

    fn bump_combo(&mut self) {
        self.combo += 1;
        self.combo_bump = 1.0;
        self.best_combo = self.best_combo.max(self.combo);
        let tier = Self::combo_tier(self.combo);
        let tier_up = tier > self.tier;
        self.tier = tier;
        self.events.push(Event::Combo { n: self.combo, tier, tier_up });
        if self.combo == COMBO_COUNTER_FROM {
            self.sfx("sfx_combo_up_1");
        }
        if tier_up {
            let (s, vo) = match tier {
                1 => ("sfx_combo_up_2", "vo_hot"),
                2 => ("sfx_combo_up_3", "vo_blazing"),
                3 => ("sfx_combo_up_4", "vo_super"),
                _ => ("sfx_combo_mega", "vo_mega"),
            };
            self.sfx(s);
            self.sfx(vo);
            let c = crate::fx::tier_color(tier, self.time);
            self.banner(COMBO_NAMES[tier as usize], c, 1.25, 0.66);
        }
        if self.combo == 10 {
            self.hue_pulse = 1.0;
            if self.adaptive.combo10() {
                self.speed_event();
            }
        }
        if self.combo == 25 {
            let p = v2(self.view.x * 0.5, self.view.y * 0.86);
            self.firework_fx(p);
        }
    }

    fn speed_event(&mut self) {
        self.events.push(Event::Speed { x: self.adaptive.x(), offset: self.adaptive.offset });
    }

    /// `round(50 × clamp((1.5T − RT) / 1.5T, 0, 1))`.
    pub fn speed_bonus(&self, rt_s: f32) -> u32 {
        let t = self.cfg.target_ms / 1000.0 * 1.5;
        (SPEED_BONUS_MAX * ((t - rt_s) / t).clamp(0.0, 1.0)).round() as u32
    }

    /// Response time: from the later of launch + 0.4 s, the previous correct
    /// and the blade becoming ready; clamped to [0.3 s, flight].
    fn rt(&self, m: &Monster) -> f32 {
        let start = (m.spawn_rt + 0.4).max(self.last_correct_rt).max(self.blade_ready_rt);
        (self.round_time - start).clamp(0.3, m.flight.max(0.3))
    }

    /// Correct answers lower `trickyNeed`; true when this one cleared it.
    fn tricky_tick(&mut self, f: Fact) -> bool {
        let key = f.key();
        if let Some(e) = self.tricky_need.iter_mut().find(|(k, _)| *k == key) {
            if e.1 > 0 {
                e.1 -= 1;
                if e.1 == 0 {
                    if self.tricky_cleared.len() < self.tricky_cleared.capacity() {
                        self.tricky_cleared.push(f);
                    }
                    return true;
                }
            }
        }
        false
    }

    fn tricky_wrong(&mut self, f: Fact) {
        let key = f.key();
        if let Some(e) = self.tricky_need.iter_mut().find(|(k, _)| *k == key) {
            e.1 = 3;
        } else if self.tricky_need.len() < self.tricky_need.capacity() {
            self.tricky_need.push((key, 3));
        }
        self.tricky_cleared.retain(|c| c.key() != key);
    }

    fn push_result(&mut self, r: ResultRec) {
        if self.results.len() < self.results.capacity() {
            self.results.push(r);
        }
    }

    // ------------------------------------------------------------ resolution

    /// Correct swipe on monster `idx`.
    fn on_correct(&mut self, idx: usize, contact: Vec2, dir: Vec2) {
        let m = self.monsters[idx];
        let rt_s = self.rt(&m);
        let rt_ms = (rt_s * 1000.0).round() as u32;
        let fast = rt_ms as f32 <= self.cfg.target_ms;
        self.slash_fx(contact, dir, m.radius);
        self.hitstop = self.hitstop.max(HITSTOP_CORRECT_S);
        self.shake(SHAKE_CORRECT.0, SHAKE_CORRECT.1);
        self.last_correct_rt = self.round_time;

        // Second hit on a cracked Clonkshell: ungraded pop, combo unchanged.
        if m.armor == 2 {
            let mult = self.tier + 1;
            let points = POINTS_ARMOR_INNER * mult;
            self.score += points;
            self.clear_charge();
            let mm = &mut self.monsters[idx];
            mm.state = MState::Popping;
            mm.squash = 1.0;
            self.push_result(ResultRec { outcome: Outcome::Correct, graded: false, rt_ms, fast, given: Some(m.fact.answer), info: m.info() });
            self.events.push(Event::Correct { info: m.info(), rt_ms, fast, points, combo: self.combo, mult, graded: false, tricky_cleared: false, lantern: false });
            self.correct_sfx(&m);
            self.popup(m.pos, points);
            self.coins(m.pos, 2);
            return;
        }

        let graded = m.graded;
        if graded {
            self.bump_combo();
        }
        let mult = self.tier + 1;
        let base = if m.golden {
            POINTS_GOLDEN
        } else if m.mini {
            POINTS_MINI
        } else {
            POINTS_BASE
        };
        let points = base * mult + self.speed_bonus(rt_s);
        self.score += points;
        // Only graded results count, like the shell's SRS (repeat copies don't).
        let tricky_cleared = graded && self.tricky_tick(m.fact);
        if graded {
            if m.golden {
                self.stats.golden += 1;
            } else if m.mini {
                self.stats.minis += 1;
            } else {
                self.stats.correct += 1;
                if self.adaptive.record(Res::Correct, fast, true) {
                    self.speed_event();
                }
            }
        }
        if self.cfg.round_type == RoundType::Tutorial {
            self.tutorial_correct += 1;
        }
        let lantern = m.slot.lantern && m.armor == 0;
        self.push_result(ResultRec { outcome: Outcome::Correct, graded, rt_ms, fast, given: Some(m.fact.answer), info: m.info() });
        self.events.push(Event::Correct { info: m.info(), rt_ms, fast, points, combo: self.combo, mult, graded, tricky_cleared, lantern });
        self.popup(m.pos, points);

        if m.armor == 1 {
            // Crack: the charge is kept; the inner shows the other form.
            let inner = m.fact.swapped();
            {
                let mm = &mut self.monsters[idx];
                mm.armor = 2;
                mm.graded = false;
                mm.fact = inner;
                mm.label = inner.question_label();
                mm.full = inner.full_label();
                mm.time_scale = ARMOR_INNER_TIME_SCALE;
                mm.squash = 1.0;
                mm.crack_t = 0.4;
            }
            self.events.push(Event::ArmorCrack { id: m.id, fact: m.fact, inner });
            self.sfx("sfx_armor_crack");
            self.crack_fx(&m);
            self.coins(m.pos, 2);
            let st = &mut self.blade.stroke;
            if st.ni < st.ignore.len() {
                st.ignore[st.ni] = m.id;
                st.ni += 1;
            }
            return;
        }

        self.clear_charge();
        {
            let mm = &mut self.monsters[idx];
            mm.state = MState::Popping;
            mm.squash = 1.0;
            mm.graded = false;
            mm.tricky_cleared = tricky_cleared;
        }
        self.correct_sfx(&m);
        let n_coins = if m.golden { 4 } else { 2 + self.fx.below(2) };
        self.coins(m.pos, n_coins);
        if lantern {
            self.lantern(m.pos);
        }
        if tricky_cleared {
            self.banner("Fixed it!", [0.55, 1.0, 0.6], 1.15, 0.52);
            self.sfx("sfx_fixit");
            self.sfx("vo_fixed_it");
            let g = self.fx.below(3) as usize;
            self.sfx(GIGGLES[g]);
        }
        if m.golden {
            self.sfx("sfx_golden_pop");
            self.sfx("vo_golden");
            self.coin_shower(m.pos);
        }
        if m.slot.shiny {
            self.sfx("sfx_shiny");
        }
        match m.slot.special {
            Special::Freeze => {
                if self.chill <= 0.0 {
                    self.events.push(Event::Freeze);
                }
                self.chill = CHILL_S;
                self.sfx("sfx_freeze");
                self.freeze_fx(m.pos);
            }
            Special::Splitter => self.split(&m),
            _ => {}
        }
        if m.minion {
            self.boss_hit(m.pos);
        }
    }

    fn correct_sfx(&mut self, m: &Monster) {
        self.sfx("sfx_slice_correct");
        self.sfx("sfx_pop_confetti");
        self.sfx("sfx_coin_tinkle");
        if m.bubble {
            self.sfx_pitch("sfx_pop_confetti", 5);
        }
    }

    fn clear_charge(&mut self) {
        if self.charged.is_some() {
            self.charged = None;
            self.events.push(Event::ChargeCleared);
        }
    }

    /// Re-slice of a revealed monster: "Fixed it!", 25 points, no combo.
    fn on_fixed(&mut self, idx: usize, contact: Vec2, dir: Vec2) {
        let m = self.monsters[idx];
        self.clear_charge();
        self.score += POINTS_FIXED;
        self.stats.fixed += 1;
        self.hitstop = self.hitstop.max(HITSTOP_CORRECT_S);
        self.slash_fx(contact, dir, m.radius);
        {
            let mm = &mut self.monsters[idx];
            mm.state = MState::Popping;
            mm.squash = 1.0;
        }
        self.events.push(Event::Fixed { id: m.id, fact: m.fact, points: POINTS_FIXED });
        self.banner("Fixed it!", [0.55, 1.0, 0.6], 1.0, 0.52);
        self.sfx("sfx_fixit");
        self.sfx("sfx_pop_confetti");
        self.popup(m.pos, POINTS_FIXED);
    }

    /// The blade breaks on monster `idx`.
    fn on_wrong(&mut self, idx: usize, given: i32, contact: Vec2, dir: Vec2) {
        let m = self.monsters[idx];
        let graded = m.graded;
        let deck_origin = m.from_deck();
        let inner = m.armor == 2;
        {
            let mm = &mut self.monsters[idx];
            mm.state = MState::Revealed;
            mm.reveal = WRONG_FREEZE_S;
            mm.graded = false;
            mm.squash = 1.0;
            mm.ghost = false;
        }
        self.wrong_slow = WRONG_FREEZE_S;
        self.wrong_id = m.id;
        if graded && deck_origin {
            self.stats.wrong += 1;
            if self.adaptive.record(Res::Wrong, false, true) {
                self.speed_event();
            }
        }
        if deck_origin && !inner {
            let mut s = m.slot;
            s.fact = m.fact;
            s.tricky = true;
            self.deck.on_wrong(&s);
        }
        if graded {
            self.tricky_wrong(m.fact);
        }
        let rt_ms = ((self.round_time - m.spawn_rt).max(0.0) * 1000.0).round() as u32;
        self.push_result(ResultRec { outcome: Outcome::Wrong, graded, rt_ms, fast: false, given: Some(given), info: m.info() });
        self.events.push(Event::Wrong { info: m.info(), given, graded });
        self.break_combo("wrong");
        self.clear_charge();

        // Guessing guard: 3 wrongs within 8 s.
        self.wrong_times[self.wrong_n % GUARD_WRONGS] = self.time;
        self.wrong_n += 1;
        let guard = self.wrong_n >= GUARD_WRONGS && self.wrong_times.iter().all(|&t| self.time - t <= GUARD_WINDOW_S);
        if guard {
            self.wrong_n = 0;
            self.wrong_times = [-100.0; GUARD_WRONGS];
        }
        let reforge = if guard { REFORGE_GUARD_S } else { self.reforge_s() };
        self.blade.broken = reforge;
        self.blade.reforge_total = reforge;
        self.blade.guard = guard;
        self.blade.shards_called = false;
        self.blade.broke_at = contact;
        self.blade.trail.clear();
        if guard {
            self.guard_hint = reforge;
        }
        self.events.push(Event::BladeBroken { reforge_s: reforge, guard });
        self.since_spawn -= AFTER_WRONG_DELAY_S;
        self.hitstop = self.hitstop.max(HITSTOP_WRONG_S);
        self.shake(SHAKE_WRONG.0, SHAKE_WRONG.1);
        self.sfx("sfx_blade_shatter");
        self.sfx("sfx_wrong_reveal");
        self.shatter_fx(contact, dir);
    }

    fn on_escape(&mut self, m: &Monster) {
        if m.state != MState::Flying {
            return; // a revealed monster just leaves
        }
        let hard = self.hard_stopped;
        let free = hard || m.golden || m.mini || m.armor == 2;
        let graded = m.graded && !hard && !m.golden;
        let ready = self.blade.broken <= 0.0;
        if graded && m.from_deck() {
            self.stats.escaped += 1;
            if self.adaptive.record(Res::Escape, false, ready) {
                self.speed_event();
            }
        }
        if !hard && m.from_deck() && m.armor != 2 {
            let mut s = m.slot;
            s.fact = m.fact;
            self.deck.on_escape(&s);
        }
        self.push_result(ResultRec { outcome: Outcome::Escaped, graded, rt_ms: 0, fast: false, given: None, info: m.info() });
        self.events.push(Event::Escaped { info: m.info(), graded, blade_ready: ready });
        if !free {
            self.break_combo("escaped");
        }
        self.sfx("sfx_escape");
        self.escape_fx(m);
    }

    /// Splitsy: two minis with answers distinct from each other and the screen.
    fn split(&mut self, m: &Monster) {
        let mut picks: [Option<Fact>; 2] = [None, None];
        let mut n = 0;
        let ok = |f: &Fact, monsters: &[Monster], picks: &[Option<Fact>; 2]| {
            f.key() != m.fact.key()
                && f.answer != m.fact.answer
                && Self::unique(monsters, f)
                && picks.iter().flatten().all(|p| p.answer != f.answer && p.key() != f.key())
        };
        let pool_len = self.cfg.mini_pool.len();
        let start = if pool_len > 0 { self.rng.below(pool_len as u32) as usize } else { 0 };
        for k in 0..pool_len {
            if n == 2 {
                break;
            }
            let f = self.cfg.mini_pool[(start + k) % pool_len];
            if ok(&f, &self.monsters, &picks) {
                picks[n] = Some(f);
                n += 1;
            }
        }
        // Fallback: facts still to come in the deck.
        let mut j = self.deck.front;
        while n < 2 && j < self.deck.slots.len() {
            let f = self.deck.slots[j].fact;
            if ok(&f, &self.monsters, &picks) {
                picks[n] = Some(f);
                n += 1;
            }
            j += 1;
        }
        self.events.push(Event::Split { id: m.id, minis: picks });
        self.sfx("sfx_split");
        for (k, f) in picks.iter().enumerate() {
            if let Some(f) = f {
                let mut s = Slot::plain(*f, SlotKind::Mini);
                s.species = Some(m.species);
                let dir = if k == 0 { -1.0 } else { 1.0 };
                self.launch(s, Launch::Hop(m.pos, dir));
            }
        }
    }

    fn boss_hit(&mut self, from: Vec2) {
        let Some(mut b) = self.boss else { return };
        if b.hp == 0 {
            return;
        }
        b.hp -= 1;
        b.hit_flash = 0.1;
        b.bonk = 0.6;
        self.boss = Some(b);
        self.beam(from, b.pos);
        self.events.push(Event::BossHit { hp: b.hp, max_hp: b.max_hp });
        self.sfx("sfx_boss_hit");
        if b.hp == 0 {
            b.defeat = Some(0.0);
            self.boss = Some(b);
            self.score += POINTS_BOSS_DEFEAT;
            self.events.push(Event::BossDefeated { species: b.species });
            self.sfx("sfx_boss_defeat");
            self.sfx("vo_boss_defeated");
            let g = self.fx.below(3) as usize;
            self.sfx(GIGGLES[g]);
            self.popup(b.pos, POINTS_BOSS_DEFEAT);
            self.round = RoundState::Draining;
            // The remaining minions wave and pop away (no results).
            for m in &mut self.monsters {
                if m.state != MState::Popping {
                    m.state = MState::Popping;
                    m.pop_t = -0.4;
                }
            }
        }
    }

    pub fn tutorial_hint(&self) -> bool {
        self.cfg.round_type == RoundType::Tutorial && self.tutorial_correct < 3 && self.round == RoundState::Playing
    }

    pub fn adaptive_mode(&self) -> Mode {
        self.adaptive.mode
    }

    // ----------------------------------------------------------------- input

    pub fn pointer_down(&mut self, p: Vec2) {
        if self.blade.stroke.n > 0 {
            self.resolve_stroke();
        }
        self.blade.down = true;
        self.blade.pos = p;
        self.blade.has_pos = true;
        self.blade.trail.clear();
        self.blade.swipe_len = 0.0;
        self.blade.swoosh_played = false;
        self.blade.fx_dist = 0.0;
        self.blade.stroke = Stroke::default();
        self.blade.last_move = self.time;
        self.blade.trail.push(TrailPt { pos: p, time: self.time, dist: 0.0 });
    }

    pub fn pointer_up(&mut self, p: Vec2) {
        self.pointer_move(p);
        self.blade.down = false;
        self.resolve_stroke();
    }

    /// The OS took the pointer: a pending wrong is dropped.
    pub fn pointer_cancel(&mut self) {
        self.blade.down = false;
        self.blade.stroke = Stroke::default();
    }

    fn check_stroke_timeout(&mut self) {
        let s = &self.blade.stroke;
        if s.n > 0 && !s.scored && self.time - s.first_touch >= SWIPE_RESOLVE_S {
            self.resolve_stroke();
        }
    }

    /// End of the collection window: the right one if any touched monster
    /// matches now, else the blade breaks on the first touched one still flying.
    fn resolve_stroke(&mut self) {
        let st = self.blade.stroke;
        self.blade.stroke.n = 0;
        if st.n == 0 || st.scored || self.blade.broken > 0.0 {
            return;
        }
        let Some(c) = self.charged else { return };
        let dir = (self.blade.pos - self.blade.trail.first().map_or(self.blade.pos, |t| t.pos)).norm();
        for &id in &st.touched[..st.n] {
            if let Some(i) = self.monsters.iter().position(|m| m.id == id && m.state == MState::Flying && m.fact.answer == c) {
                let at = self.monsters[i].pos;
                self.on_correct(i, at, dir);
                self.blade.stroke.scored = true;
                return;
            }
        }
        for &id in &st.touched[..st.n] {
            if st.ignore[..st.ni].contains(&id) {
                continue;
            }
            if let Some(i) = self.monsters.iter().position(|m| m.id == id && m.state == MState::Flying) {
                let at = self.monsters[i].pos;
                self.on_wrong(i, c, at, dir);
                return;
            }
        }
    }

    /// Hover (button up) only moves the eyes' target; with the button down
    /// the segment from the previous position is a blade stroke.
    pub fn pointer_move(&mut self, p: Vec2) {
        let prev = self.blade.pos;
        self.blade.pos = p;
        self.blade.has_pos = true;
        self.blade.last_move = self.time;
        if !self.blade.down {
            return;
        }
        let seg = p - prev;
        let seg_len = seg.len();
        if seg_len < 0.5 {
            return;
        }
        let dist = self.blade.trail.last().map_or(0.0, |t| t.dist) + seg_len;
        if self.blade.trail.len() >= TRAIL_CAP {
            self.blade.trail.remove(0);
        }
        self.blade.trail.push(TrailPt { pos: p, time: self.time, dist });
        self.blade.swipe_len += seg_len;
        let ready = self.blade.broken <= 0.0;
        if !self.blade.swoosh_played && self.blade.swipe_len > 220.0 {
            self.blade.swoosh_played = true;
            // A stroke that already scored has had its slice sound; stay quiet.
            if !self.blade.stroke.scored {
                self.sfx(if self.charged.is_some() && ready { "sfx_swipe_whoosh" } else { "sfx_swipe_empty" });
            }
        }
        self.trail_fx(prev, p, seg_len);
        if !ready {
            return;
        }
        let dir = seg.norm();
        for i in 0..self.monsters.len() {
            let Some(c) = self.charged else { return };
            let (state, id, pos, r, answer) = {
                let m = &self.monsters[i];
                (m.state, m.id, m.pos, m.radius, m.fact.answer)
            };
            if state == MState::Popping {
                continue;
            }
            let Some(t) = segment_hits_circle(prev, p, pos, r * HIT_SCALE) else { continue };
            if self.blade.stroke.ignore[..self.blade.stroke.ni].contains(&id) {
                continue;
            }
            let contact = prev + seg * t;
            if state == MState::Revealed {
                // Only the right charge does anything; never breaks the blade.
                if answer == c {
                    self.on_fixed(i, contact, dir);
                    self.blade.stroke.scored = true;
                }
                continue;
            }
            if answer == c {
                self.on_correct(i, contact, dir);
                self.blade.stroke.scored = true;
                continue;
            }
            let now = self.time;
            let st = &mut self.blade.stroke;
            if !st.scored && !st.touched[..st.n].contains(&id) && st.n < STROKE_CAP {
                if st.n == 0 {
                    st.first_touch = now;
                }
                st.touched[st.n] = id;
                st.n += 1;
            }
        }
    }

    // ------------------------------------------------------------- helpers

    pub fn sfx(&mut self, name: &'static str) {
        self.events.push(Event::Sfx { name, semitones: 0 });
    }

    pub fn sfx_pitch(&mut self, name: &'static str, semitones: i8) {
        self.events.push(Event::Sfx { name, semitones });
    }

    pub fn banner(&mut self, text: &str, color: Rgb, size: f32, y: f32) {
        if self.banners.len() >= self.banners.capacity() {
            self.banners.remove(0);
        }
        let max_life = BANNER_S + 0.2 * size;
        self.banners.push(Banner { label: Label::text(text), color, life: max_life, max_life, size, y });
    }

    /// Screen shake in px at the 1080 reference height.
    pub fn shake(&mut self, px: f32, dur: f32) {
        let k = if self.calm { CALM_SHAKE } else { 1.0 };
        let amp = px * k * self.view.y / SHAKE_REF_H;
        let cur = self.shake_amp * (self.shake_t / self.shake_dur.max(0.001));
        if amp >= cur {
            self.shake_amp = amp;
            self.shake_t = dur;
            self.shake_dur = dur;
        }
    }

    /// Full-screen flash, never in calm mode and never more than ~3 a second.
    pub fn try_flash(&mut self, c: [f32; 4]) -> bool {
        if self.calm || self.time - self.last_flash < MIN_FLASH_GAP_S {
            return false;
        }
        self.last_flash = self.time;
        self.flash = c;
        true
    }

    /// Particle count after the effects and calm multipliers.
    pub fn n(&self, k: u32) -> u32 {
        let s = self.effects_scale * if self.calm { CALM_PARTICLES } else { 1.0 };
        ((k as f32) * s).round() as u32
    }
}

// ===================================================================== tests

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json;

    fn deck_json(facts: &[(i32, i32)]) -> String {
        let v: Vec<String> = facts.iter().map(|(a, b)| format!("{{\"a\":{a},\"b\":{b},\"kind\":\"focus\",\"species\":\"bloop\"}}")).collect();
        format!("[{}]", v.join(","))
    }

    fn sim_src(src: &str) -> Sim {
        let mut s = Sim::new(7);
        s.set_view(1600.0, 1000.0);
        s.start_round(RoundConfig::from_json_str(src).unwrap());
        s
    }

    fn sim_cfg(extra: &str, facts: &[(i32, i32)]) -> Sim {
        sim_src(&format!("{{\"seed\":3,\"deck\":{}{}}}", deck_json(facts), extra))
    }

    fn take(s: &mut Sim) -> Vec<Event> {
        std::mem::take(&mut s.events)
    }

    fn run(s: &mut Sim, secs: f32) {
        for _ in 0..(secs / STEP).round() as u32 {
            s.step(STEP);
        }
    }

    fn run_until(s: &mut Sim, max_s: f32, f: impl Fn(&Sim) -> bool) -> bool {
        for _ in 0..(max_s / STEP) as u32 {
            if f(s) {
                return true;
            }
            s.step(STEP);
        }
        f(s)
    }

    fn flying(s: &Sim) -> Vec<usize> {
        (0..s.monsters.len()).filter(|&i| s.monsters[i].state == MState::Flying).collect()
    }

    /// Swipe horizontally through monster `i` (one stroke).
    fn swipe_through(s: &mut Sim, i: usize) {
        let m = s.monsters[i];
        s.pointer_down(m.pos - v2(m.radius * 2.0, 0.0));
        s.pointer_move(m.pos);
        s.pointer_up(m.pos + v2(m.radius * 2.0, 0.0));
    }

    fn count(evs: &[Event], f: impl Fn(&Event) -> bool) -> usize {
        evs.iter().filter(|e| f(e)).count()
    }

    fn sfx(name: &'static str) -> Event {
        Event::Sfx { name, semitones: 0 }
    }

    #[test]
    fn spawns_flies_and_escapes_in_flight_time() {
        let mut s = sim_cfg(r#","speed":{"x":0}"#, &[(2, 3)]);
        assert!(run_until(&mut s, 2.0, |s| !s.monsters.is_empty()));
        let m0 = s.monsters[0];
        assert!((m0.flight - 11.0).abs() < 1e-3);
        let (w, h) = (s.view.x, s.view.y);
        let mut max_y: f32 = -1e9;
        let mut t = 0.0;
        while !s.monsters.is_empty() {
            let m = s.monsters[0];
            max_y = max_y.max(m.pos.y);
            assert!(m.pos.x > -m.radius * 1.4 && m.pos.x < w + m.radius * 1.4);
            s.step(STEP);
            t += STEP;
            assert!(t < 20.0);
        }
        assert!(max_y <= h - m0.radius * 1.05, "apex stays on screen");
        assert!(max_y >= h * 0.5);
        assert!(t <= 11.1, "flight about 11 s, got {t}");
        let evs = take(&mut s);
        assert_eq!(count(&evs, |e| matches!(e, Event::Escaped { graded: true, .. })), 1);
        assert!(evs.contains(&sfx("sfx_escape")));
    }

    #[test]
    fn arc_solver_hits_end_point_and_apex() {
        let (v, g) = solve_arc(v2(100.0, -50.0), v2(900.0, -50.0), 700.0, 6.0);
        let t: f32 = 6.0;
        let x = 100.0 + v.x * t;
        let y = -50.0 + v.y * t - 0.5 * g * t * t;
        assert!((x - 900.0).abs() < 0.01 && (y + 50.0).abs() < 0.5, "{x} {y}");
        let ta = v.y / g;
        let apex = -50.0 + v.y * ta - 0.5 * g * ta * ta;
        assert!((apex - 700.0).abs() < 0.5);
    }

    #[test]
    fn uniqueness_never_two_same_answers_or_facts() {
        let facts = [(3, 4), (2, 6), (4, 3), (6, 2), (1, 12), (2, 5), (5, 3), (2, 7), (1, 10)];
        let mut s = sim_cfg(r#","speed":{"x":4,"max_on_screen":6}"#, &facts);
        let mut most = 0;
        for _ in 0..(60.0 / STEP) as u32 {
            s.step(STEP);
            let live: Vec<&Monster> = s.monsters.iter().filter(|m| m.state != MState::Popping).collect();
            most = most.max(live.len());
            for (i, a) in live.iter().enumerate() {
                for b in &live[i + 1..] {
                    assert_ne!(a.fact.answer, b.fact.answer);
                    assert_ne!(a.fact.key(), b.fact.key());
                }
            }
        }
        assert!(most >= 2);
    }

    #[test]
    fn swipe_without_charge_does_nothing() {
        let mut s = sim_cfg("", &[(2, 3)]);
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        take(&mut s);
        swipe_through(&mut s, 0);
        run(&mut s, 1.0);
        let evs = take(&mut s);
        assert_eq!(count(&evs, |e| matches!(e, Event::Correct { .. } | Event::Wrong { .. })), 0);
        assert!(evs.contains(&sfx("sfx_swipe_empty")));
    }

    #[test]
    fn correct_scores_points_and_clears_charge() {
        let mut s = sim_cfg(r#","target_ms":6000"#, &[(2, 3), (2, 4)]);
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        run(&mut s, 0.5);
        take(&mut s);
        s.set_charged(Some(6));
        swipe_through(&mut s, 0);
        let evs = take(&mut s);
        let c = evs.iter().find_map(|e| match e {
            Event::Correct { points, combo, mult, graded, rt_ms, .. } => Some((*points, *combo, *mult, *graded, *rt_ms)),
            _ => None,
        });
        let (points, combo, mult, graded, rt) = c.expect("correct event");
        assert!(graded);
        assert_eq!((combo, mult), (1, 1));
        // RT ≈ 0.5 − 0.4 → clamped to 0.3 s: bonus = round(50 × (9 − 0.3) / 9) = 48.
        assert_eq!(rt, 300);
        assert_eq!(points, 100 + 48);
        assert_eq!(s.charged, None);
        assert!(evs.contains(&Event::ChargeCleared));
        assert!(evs.contains(&sfx("sfx_slice_correct")));
        assert!(s.hitstop > 0.0);
        run(&mut s, 0.3);
        assert!(s.monsters.iter().all(|m| m.state != MState::Popping), "popped after the squash");
        assert!(!s.friends.is_empty(), "freed face floats up");
        assert!(s.flyers.iter().any(|f| f.kind == FlyKind::Coin));
    }

    fn two_flying() -> (Sim, usize, usize) {
        let mut s = sim_cfg(r#","speed":{"x":4,"max_on_screen":4}"#, &[(2, 3), (2, 4), (2, 5)]);
        assert!(run_until(&mut s, 20.0, |s| flying(s).len() >= 2 && s.monsters.iter().all(|m| m.age > 0.6)));
        let f = flying(&s);
        (s, f[0], f[1])
    }

    #[test]
    fn graze_wrong_then_hit_right_is_not_wrong() {
        let (mut s, a, b) = two_flying();
        let right = s.monsters[b].fact.answer;
        s.set_charged(Some(right));
        take(&mut s);
        let (pa, pb) = (s.monsters[a].pos, s.monsters[b].pos);
        let d = (pb - pa).norm();
        s.pointer_down(pa - d * 300.0);
        s.pointer_move(pa); // graze the wrong one first
        s.pointer_move(pb); // then the right one
        s.pointer_up(pb + d * 300.0);
        run(&mut s, 1.0);
        let evs = take(&mut s);
        assert_eq!(count(&evs, |e| matches!(e, Event::Correct { .. })), 1);
        assert_eq!(count(&evs, |e| matches!(e, Event::Wrong { .. })), 0, "grazing is never punished");
        assert_eq!(s.blade.broken, 0.0);
    }

    #[test]
    fn graze_then_type_right_charge_before_resolve_counts_correct() {
        let (mut s, a, _) = two_flying();
        let ans = s.monsters[a].fact.answer;
        s.set_charged(Some(ans + 100));
        let m = s.monsters[a];
        s.pointer_down(m.pos - v2(m.radius * 2.0, 0.0));
        s.pointer_move(m.pos);
        s.set_charged(Some(ans));
        s.pointer_up(m.pos + v2(m.radius * 2.0, 0.0));
        let evs = take(&mut s);
        assert_eq!(count(&evs, |e| matches!(e, Event::Correct { .. })), 1);
        assert_eq!(count(&evs, |e| matches!(e, Event::Wrong { .. })), 0);
    }

    #[test]
    fn wrong_only_resolves_at_stroke_end_on_first_touched() {
        let (mut s, a, b) = two_flying();
        let id_a = s.monsters[a].id;
        s.set_charged(Some(99));
        take(&mut s);
        let (pa, pb) = (s.monsters[a].pos, s.monsters[b].pos);
        let d = (pb - pa).norm();
        s.pointer_down(pa - d * 300.0);
        s.pointer_move(pa);
        s.pointer_move(pb);
        assert_eq!(count(&s.events, |e| matches!(e, Event::Wrong { .. })), 0, "not until the stroke ends");
        s.pointer_up(pb + d * 300.0);
        let evs = take(&mut s);
        let wrongs: Vec<u32> = evs.iter().filter_map(|e| if let Event::Wrong { info, .. } = e { Some(info.id) } else { None }).collect();
        assert_eq!(wrongs, vec![id_a], "one wrong, on the first touched");
        assert!(s.blade.broken > 0.0);
        assert_eq!(s.charged, None);
        assert!(evs.iter().any(|e| matches!(e, Event::BladeBroken { guard: false, .. })));
        assert!(evs.contains(&sfx("sfx_blade_shatter")));
        assert!(evs.iter().any(|e| matches!(e, Event::ComboBreak { .. })) || s.combo == 0);
    }

    #[test]
    fn wrong_times_out_while_finger_stays_down() {
        let mut s = sim_cfg("", &[(2, 3)]);
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        s.set_charged(Some(7));
        let m = s.monsters[0];
        s.pointer_down(m.pos - v2(m.radius * 2.0, 0.0));
        s.pointer_move(m.pos);
        run(&mut s, 0.5);
        assert_eq!(count(&s.events, |e| matches!(e, Event::Wrong { .. })), 0);
        run(&mut s, 0.2);
        assert_eq!(count(&s.events, |e| matches!(e, Event::Wrong { .. })), 1);
    }

    #[test]
    fn pointer_cancel_drops_pending_wrong() {
        let mut s = sim_cfg("", &[(2, 3)]);
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        s.set_charged(Some(7));
        let m = s.monsters[0];
        s.pointer_down(m.pos - v2(m.radius * 2.0, 0.0));
        s.pointer_move(m.pos);
        s.pointer_cancel();
        run(&mut s, 1.0);
        assert_eq!(count(&s.events, |e| matches!(e, Event::Wrong { .. })), 0);
    }

    #[test]
    fn wrong_freezes_reveals_and_fixed_it_reslice() {
        let mut s = sim_cfg("", &[(2, 3), (2, 4), (2, 5), (2, 6), (2, 7), (2, 8)]);
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        s.set_charged(Some(7));
        swipe_through(&mut s, 0);
        let evs = take(&mut s);
        assert!(evs.iter().any(|e| matches!(e, Event::Wrong { given: 7, graded: true, .. })));
        assert_eq!(s.monsters[0].state, MState::Revealed);
        assert_eq!(s.stats.wrong, 1);
        run(&mut s, 0.2);
        let p = s.monsters[0].pos;
        run(&mut s, 1.0);
        assert!((s.monsters[0].pos - p).len() < 0.01, "frozen for 1.5 s");
        run(&mut s, 0.4);
        assert!(s.blade.broken <= 0.0, "little band reforges in 1.0 s");
        assert!(take(&mut s).contains(&Event::BladeReady));
        // Repetition: a copy 3 back (index front + 2 = 3).
        assert_eq!(s.deck.slots[3].kind, SlotKind::Repeat);
        assert_eq!(s.deck.slots[3].fact, Fact::mul(2, 3));
        s.set_charged(Some(6));
        let idx = s.monsters.iter().position(|m| m.state == MState::Revealed).unwrap();
        swipe_through(&mut s, idx);
        let evs = take(&mut s);
        assert!(evs.iter().any(|e| matches!(e, Event::Fixed { points: 25, .. })));
        assert_eq!(s.combo, 0, "no combo for a re-slice");
        assert_eq!(s.stats.fixed, 1);
    }

    #[test]
    fn revealed_monster_never_breaks_the_blade() {
        let mut s = sim_cfg("", &[(2, 3), (2, 4)]);
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        s.set_charged(Some(7));
        swipe_through(&mut s, 0);
        run(&mut s, 2.0);
        take(&mut s);
        s.set_charged(Some(9));
        let idx = s.monsters.iter().position(|m| m.state == MState::Revealed).unwrap();
        swipe_through(&mut s, idx);
        let evs = take(&mut s);
        assert_eq!(count(&evs, |e| matches!(e, Event::Wrong { .. })), 0);
        assert_eq!(s.charged, Some(9));
    }

    #[test]
    fn guessing_guard_after_three_quick_wrongs() {
        let facts: Vec<(i32, i32)> = (1..=9).map(|b| (2, b)).collect();
        let mut s = sim_cfg(r#","speed":{"x":3,"max_on_screen":4}"#, &facts);
        let mut guards = 0;
        for _ in 0..3 {
            assert!(run_until(&mut s, 10.0, |s| s.blade.broken <= 0.0 && !flying(s).is_empty()));
            let i = flying(&s)[0];
            s.set_charged(Some(999));
            swipe_through(&mut s, i);
            for e in take(&mut s) {
                if let Event::BladeBroken { guard: true, reforge_s } = e {
                    assert_eq!(reforge_s, REFORGE_GUARD_S);
                    guards += 1;
                }
            }
        }
        assert_eq!(guards, 1);
    }

    #[test]
    fn combo_mult_and_tiers() {
        assert_eq!(Sim::combo_tier(4), 0);
        assert_eq!(Sim::combo_tier(5), 1);
        assert_eq!(Sim::combo_tier(14), 2);
        assert_eq!(Sim::combo_tier(15), 3);
        assert_eq!(Sim::combo_tier(25), 4);
        let facts: Vec<(i32, i32)> = (1..=12).map(|b| (3, b)).collect();
        let mut s = sim_cfg(r#","speed":{"x":0}"#, &facts);
        let mut mults = vec![];
        let mut all = vec![];
        for _ in 0..6 {
            assert!(run_until(&mut s, 12.0, |s| !flying(s).is_empty()));
            let i = flying(&s)[0];
            s.set_charged(Some(s.monsters[i].fact.answer));
            swipe_through(&mut s, i);
            for e in take(&mut s) {
                if let Event::Correct { mult, points, .. } = e {
                    mults.push(mult);
                    assert!(points >= 100 * mult && points <= 100 * mult + 50);
                }
                all.push(e);
            }
            run(&mut s, 0.2);
        }
        assert_eq!(mults, vec![1, 1, 1, 1, 2, 2]);
        assert_eq!(s.combo, 6);
        assert!(all.contains(&sfx("sfx_combo_up_1")));
        assert!(all.contains(&sfx("sfx_combo_up_2")));
        assert!(all.contains(&sfx("vo_hot")));
        assert!(all.iter().any(|e| matches!(e, Event::Combo { n: 5, tier: 1, tier_up: true })));
        // An escape breaks it.
        take(&mut s);
        assert!(run_until(&mut s, 30.0, |s| s.events.iter().any(|e| matches!(e, Event::Escaped { .. }))));
        assert!(s.events.iter().any(|e| matches!(e, Event::ComboBreak { was: 6, reason: "escaped" })));
        assert!(s.events.contains(&sfx("sfx_combo_break")));
    }

    #[test]
    fn speed_bonus_formula() {
        let s = sim_cfg(r#","target_ms":4000"#, &[(2, 3)]);
        assert_eq!(s.speed_bonus(0.0), 50);
        assert_eq!(s.speed_bonus(3.0), 25);
        assert_eq!(s.speed_bonus(6.0), 0);
        assert_eq!(s.speed_bonus(9.0), 0);
    }

    #[test]
    fn armored_crack_keeps_charge_then_new_stroke_pops() {
        let mut s = sim_src(r#"{"seed":3,"deck":[{"a":3,"b":4,"kind":"focus","special":"armored"}]}"#);
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        assert_eq!(s.monsters[0].armor, 1);
        assert_eq!(s.monsters[0].species.info().id, "clonkshell");
        take(&mut s);
        s.set_charged(Some(12));
        swipe_through(&mut s, 0);
        let evs = take(&mut s);
        assert!(evs.iter().any(|e| matches!(e, Event::Correct { graded: true, .. })));
        assert!(evs.iter().any(|e| matches!(e, Event::ArmorCrack { inner, .. } if inner.a == 4 && inner.b == 3)));
        assert!(evs.contains(&sfx("sfx_armor_crack")));
        assert_eq!(s.charged, Some(12), "charge kept");
        assert_eq!(s.combo, 1);
        assert_eq!(s.monsters[0].armor, 2);
        assert_eq!(s.monsters[0].time_scale, ARMOR_INNER_TIME_SCALE);
        assert_eq!(count(&evs, |e| matches!(e, Event::Wrong { .. })), 0, "same stroke cannot pop the inner");
        run(&mut s, 0.2);
        swipe_through(&mut s, 0);
        let evs = take(&mut s);
        let c = evs.iter().find_map(|e| if let Event::Correct { graded, points, .. } = e { Some((*graded, *points)) } else { None });
        assert_eq!(c, Some((false, 50)));
        assert_eq!(s.combo, 1, "inner pop leaves combo alone");
        assert_eq!(s.charged, None);
        assert_eq!(s.stats.correct, 1);
    }

    #[test]
    fn freeze_slows_others_and_pauses_spawns() {
        let mut s = sim_src(
            r#"{"seed":3,"speed":{"x":3,"max_on_screen":4},"deck":[
            {"a":2,"b":3,"special":"freeze"},{"a":2,"b":4},{"a":2,"b":5},{"a":2,"b":7},{"a":2,"b":8},{"a":2,"b":9}]}"#,
        );
        assert!(run_until(&mut s, 10.0, |s| flying(s).len() >= 2));
        let i = s.monsters.iter().position(|m| m.fact.answer == 6).expect("chillby up");
        assert_eq!(s.monsters[i].species.info().id, "chillby");
        s.set_charged(Some(6));
        take(&mut s);
        swipe_through(&mut s, i);
        run(&mut s, 0.2);
        let evs = take(&mut s);
        assert!(evs.contains(&Event::Freeze));
        assert!(evs.contains(&sfx("sfx_freeze")));
        assert!(s.chill > 4.0);
        let n = s.monsters.len();
        let other = s.monsters.iter().position(|m| m.state == MState::Flying).unwrap();
        let (p, v) = (s.monsters[other].pos, s.monsters[other].vel);
        s.step(STEP);
        let moved = (s.monsters[other].pos - p).len();
        assert!((moved - v.len() * STEP * CHILL_SPEED).abs() < 0.5, "half speed: {moved}");
        run(&mut s, 4.5);
        assert!(s.monsters.len() <= n, "no spawns while chilled");
        run(&mut s, 0.6);
        let evs = take(&mut s);
        assert!(evs.contains(&Event::Unfreeze));
        assert!(evs.contains(&sfx("sfx_unfreeze")));
    }

    #[test]
    fn splitter_spawns_two_minis_with_distinct_answers() {
        let mut s = sim_src(
            r#"{"seed":3,"deck":[{"a":2,"b":9,"special":"splitter"},{"a":2,"b":4}],
            "mini_pool":[{"a":2,"b":9},{"a":2,"b":3},{"a":3,"b":2},{"a":2,"b":7}]}"#,
        );
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        s.set_charged(Some(18));
        take(&mut s);
        swipe_through(&mut s, 0);
        let evs = take(&mut s);
        let minis = evs.iter().find_map(|e| if let Event::Split { minis, .. } = e { Some(*minis) } else { None }).unwrap();
        let (a, b) = (minis[0].unwrap(), minis[1].unwrap());
        assert_ne!(a.answer, b.answer);
        assert_ne!(a.answer, 18);
        assert_ne!(b.answer, 18);
        assert!(evs.contains(&sfx("sfx_split")));
        let mini_ms: Vec<&Monster> = s.monsters.iter().filter(|m| m.mini).collect();
        assert_eq!(mini_ms.len(), 2);
        assert!((mini_ms[0].radius - s.radius() * MINI_SCALE).abs() < 0.01);
        assert!(s.max_on_screen() >= 3, "max on screen +1 while minis live");
        // Mini escapes are free (no combo break).
        assert!(s.combo >= 1);
        assert!(run_until(&mut s, 20.0, |s| !s.monsters.iter().any(|m| m.mini)));
        assert!(!s.events.iter().any(|e| matches!(e, Event::ComboBreak { .. })), "mini escapes are free");
    }

    #[test]
    fn mini_correct_scores_fifty_and_counts() {
        let mut s = sim_src(r#"{"seed":3,"deck":[{"a":2,"b":9,"special":"splitter"}],"mini_pool":[{"a":2,"b":3},{"a":2,"b":7}]}"#);
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        s.set_charged(Some(18));
        swipe_through(&mut s, 0);
        run(&mut s, 0.5);
        let i = s.monsters.iter().position(|m| m.mini).unwrap();
        s.set_charged(Some(s.monsters[i].fact.answer));
        take(&mut s);
        swipe_through(&mut s, i);
        let evs = take(&mut s);
        let p = evs.iter().find_map(|e| if let Event::Correct { points, mult, info, .. } = e { Some((*points, *mult, info.mini, info.slot)) } else { None });
        let (points, mult, mini, slot) = p.unwrap();
        assert!(mini && slot.is_none());
        assert_eq!(mult, 1);
        assert!(points >= 50 && points <= 100);
        assert_eq!(s.stats.minis, 1);
        assert_eq!(s.stats.correct, 1);
    }

    #[test]
    fn golden_is_extra_and_free_to_miss() {
        let mut s = sim_src(
            r#"{"seed":5,"deck":[{"a":2,"b":3},{"a":2,"b":4},{"a":2,"b":5},{"a":2,"b":6},{"a":2,"b":7}],
            "golden":[{"a":1,"b":7}],"speed":{"x":2}}"#,
        );
        let mut evs = vec![];
        assert!(run_until(&mut s, 200.0, |s| s.round == RoundState::Ended));
        evs.extend(take(&mut s));
        assert_eq!(count(&evs, |e| matches!(e, Event::Spawn(m) if m.golden && m.slot.is_none())), 1);
        assert!(evs.contains(&sfx("sfx_golden_appear")));
        assert!(evs.iter().any(|e| matches!(e, Event::Escaped { info, graded: false, .. } if info.golden)));
        assert_eq!(s.stats.golden, 0);
        assert_eq!(s.stats.sums, 5, "golden is not a deck slot");
    }

    #[test]
    fn golden_pop_scores_300_with_coin_shower() {
        let mut s = sim_src(r#"{"seed":5,"deck":[{"a":2,"b":3}],"golden":[{"a":1,"b":7}],"speed":{"x":2}}"#);
        assert!(run_until(&mut s, 60.0, |s| s.monsters.iter().any(|m| m.golden && m.age > 0.6)));
        let i = s.monsters.iter().position(|m| m.golden).unwrap();
        s.set_charged(Some(7));
        take(&mut s);
        swipe_through(&mut s, i);
        let evs = take(&mut s);
        let pts = evs.iter().find_map(|e| if let Event::Correct { points, .. } = e { Some(*points) } else { None }).unwrap();
        assert!(pts >= 300 && pts <= 350, "{pts}");
        assert!(evs.contains(&sfx("sfx_golden_pop")));
        assert!(evs.contains(&sfx("vo_golden")));
        assert!(s.flyers.iter().filter(|f| f.kind == FlyKind::Coin).count() >= 8);
        assert_eq!(s.stats.golden, 1);
    }

    #[test]
    fn intro_card_freezes_for_two_seconds() {
        let mut s = sim_src(r#"{"seed":5,"deck":[{"a":2,"b":3,"special":"freeze","intro":true}]}"#);
        run(&mut s, 1.1);
        assert!(s.intro.is_some());
        assert!(s.monsters.is_empty());
        assert!(take(&mut s).iter().any(|e| matches!(e, Event::SpecialIntro { special: Special::Freeze, .. })));
        run(&mut s, 2.0);
        assert!(s.intro.is_none());
        assert_eq!(s.monsters.len(), 1);
        assert_eq!(s.monsters[0].species.info().id, "chillby");
    }

    #[test]
    fn boss_round_hearts_minions_and_defeat() {
        let facts: Vec<String> = (1..=3).map(|b| format!("{{\"a\":4,\"b\":{b}}}")).collect();
        let src = format!(r#"{{"seed":5,"round_type":"boss","boss":{{"species":"bloop","hp":3}},"speed":{{"base":2}},"deck":[{}]}}"#, facts.join(","));
        let mut s = sim_src(&src);
        assert!((s.x() - 1.5).abs() < 1e-5, "boss uses x − 0.5");
        let evs = take(&mut s);
        assert!(evs.contains(&sfx("vo_boss_time")));
        assert!(evs.contains(&sfx("sfx_boss_enter")));
        let boss = s.boss.unwrap();
        assert!(boss.species.grand);
        let mut wrong_done = false;
        let mut all = vec![];
        for _ in 0..12 {
            if !run_until(&mut s, 30.0, |s| s.blade.broken <= 0.0 && flying(s).iter().any(|&i| s.monsters[i].age > 0.3)) {
                break;
            }
            let i = *flying(&s).iter().find(|&&i| s.monsters[i].age > 0.3).unwrap();
            assert!(s.monsters[i].minion);
            let ans = s.monsters[i].fact.answer;
            if !wrong_done {
                wrong_done = true;
                s.set_charged(Some(ans + 1));
            } else {
                s.set_charged(Some(ans));
            }
            swipe_through(&mut s, i);
            run(&mut s, 0.3);
            all.extend(take(&mut s));
            if s.boss.unwrap().hp == 0 {
                break;
            }
        }
        assert_eq!(s.boss.unwrap().hp, 0);
        assert_eq!(count(&all, |e| matches!(e, Event::BossHit { .. })), 3);
        assert!(all.iter().any(|e| matches!(e, Event::BossDefeated { .. })));
        assert!(all.contains(&sfx("vo_boss_defeated")));
        assert!(s.deck.slots.len() >= 4, "the missed fact went to the back");
        assert!(run_until(&mut s, 10.0, |s| s.round == RoundState::Ended));
        let mut out = String::new();
        s.write_summary(&mut out);
        let v = json::parse(&out).unwrap();
        assert_eq!(v.get("boss_defeated").and_then(|b| b.as_bool()), Some(true));
        assert_eq!(v.get("offset_end").and_then(|b| b.as_f64()), Some(0.0), "boss rounds keep the offset");
    }

    #[test]
    fn tricky_cleared_plays_fixed_it() {
        let mut s = sim_src(r#"{"seed":5,"deck":[{"a":3,"b":4,"kind":"tricky","tricky":true,"tricky_need":1}]}"#);
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        assert!((s.monsters[0].flight - 11.0 * FLIGHT_MUL_TRICKY).abs() < 1e-3);
        s.set_charged(Some(12));
        take(&mut s);
        swipe_through(&mut s, 0);
        let evs = take(&mut s);
        assert!(evs.iter().any(|e| matches!(e, Event::Correct { tricky_cleared: true, .. })));
        assert!(evs.contains(&sfx("vo_fixed_it")));
        assert!(evs.contains(&sfx("sfx_fixit")));
        assert_eq!(s.tricky_cleared, vec![Fact::mul(3, 4)]);
    }

    #[test]
    fn ungraded_copy_does_not_tick_tricky() {
        let mut s = sim_src(r#"{"seed":5,"deck":[{"a":3,"b":4,"kind":"tricky","tricky":true,"tricky_need":1}]}"#);
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        // Pretend this is an engine-inserted repeat copy.
        s.monsters[0].graded = false;
        s.set_charged(Some(12));
        take(&mut s);
        swipe_through(&mut s, 0);
        let evs = take(&mut s);
        assert!(evs.iter().any(|e| matches!(e, Event::Correct { graded: false, tricky_cleared: false, .. })));
        assert!(!evs.contains(&sfx("vo_fixed_it")));
        assert!(s.tricky_cleared.is_empty());
        assert_eq!(s.tricky_need.iter().find(|(k, _)| *k == Fact::mul(3, 4).key()).map(|e| e.1), Some(1));
    }

    #[test]
    fn launch_at_capacity_emits_nothing() {
        let mut s = sim_cfg("", &[(2, 3), (2, 4)]);
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        let m = s.monsters[0];
        while s.monsters.len() < s.monsters.capacity() {
            s.monsters.push(m);
        }
        let cap = s.monsters.capacity();
        take(&mut s);
        let slot = Slot::plain(Fact::mul(5, 5), SlotKind::Focus);
        let from = s.bottom_launch();
        assert_eq!(s.launch(slot, from), None);
        let evs = take(&mut s);
        assert_eq!(count(&evs, |e| matches!(e, Event::Spawn(_))), 0);
        assert_eq!(count(&evs, |e| matches!(e, Event::Sfx { .. })), 0);
        assert_eq!(s.monsters.len(), cap, "no growth past capacity");
        // A deck spawn at capacity keeps the slot for later.
        let left = s.deck.remaining();
        s.spawn_pending(Pending::Deck);
        assert_eq!(s.deck.remaining(), left);
    }

    #[test]
    fn new_fact_flies_slower_and_shows_hint_once() {
        let mut s = sim_src(r#"{"seed":5,"deck":[{"a":3,"b":7,"kind":"new","ghost":true}]}"#);
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        let m = s.monsters[0];
        assert!((m.flight - 11.0 * FLIGHT_MUL_NEW).abs() < 1e-3);
        assert!(m.first_showing && m.ghost);
    }

    #[test]
    fn hard_stop_at_100s_and_free_escapes() {
        let facts: Vec<(i32, i32)> = (1..=40).map(|b| (b, 1)).collect();
        let mut s = sim_cfg(r#","speed":{"x":-1}"#, &facts);
        assert!(run_until(&mut s, 200.0, |s| s.round == RoundState::Ended));
        assert!(s.hard_stopped);
        assert!(s.unplayed > 0);
        assert!(s.round_time >= HARD_STOP_S);
    }

    #[test]
    fn adaptive_moves_offset_in_round() {
        let facts: Vec<(i32, i32)> = (1..=8).map(|b| (2, b)).collect();
        let mut s = sim_cfg(r#","speed":{"base":2,"offset":0}"#, &facts);
        let mut speed_events = 0;
        while s.round != RoundState::Ended {
            s.step(STEP);
            speed_events += count(&take(&mut s), |e| matches!(e, Event::Speed { .. }));
            assert!(s.round_time < 200.0);
        }
        assert!(speed_events > 0, "escapes ease speed");
        assert!(s.adaptive.offset < 0.0);
        assert!(s.adaptive.offset >= ROUND_CAP_DOWN - 1e-5);
    }

    #[test]
    fn round_ends_with_valid_summary_and_events() {
        let mut s = sim_cfg(r#","speed":{"x":3}"#, &[(2, 3), (3, 3)]);
        let mut all = String::new();
        for _ in 0..(80.0 / STEP) as u32 {
            s.step(STEP);
            if let Some(i) = flying(&s).first().copied() {
                if s.monsters[i].age > 1.0 && s.blade.broken <= 0.0 {
                    let a = s.monsters[i].fact.answer;
                    s.set_charged(Some(if s.monsters[i].fact.a == 3 { a + 1 } else { a }));
                    swipe_through(&mut s, i);
                }
            }
            let j = s.drain_events_json();
            if !j.is_empty() {
                let v = json::parse(&j).expect("valid events json");
                assert!(v.as_arr().is_some());
                all.push_str(&j);
            }
            if s.round == RoundState::Ended {
                break;
            }
        }
        assert_eq!(s.round, RoundState::Ended);
        assert!(all.contains("\"type\":\"round_end\""));
        assert!(all.contains("\"name\":\"sfx_round_end\""));
        let mut out = String::new();
        s.write_summary(&mut out);
        let v = json::parse(&out).unwrap();
        assert_eq!(v.get("sums").and_then(|x| x.as_f64()), Some(2.0));
        assert_eq!(v.get("correct").and_then(|x| x.as_f64()), Some(1.0));
        assert_eq!(v.get("wrong").and_then(|x| x.as_f64()), Some(1.0));
        assert!(v.get("results").and_then(|x| x.as_arr()).unwrap().len() >= 3, "{out}");
    }

    #[test]
    fn resize_keeps_monsters_on_screen() {
        let mut s = sim_cfg("", &[(2, 3)]);
        run_until(&mut s, 3.0, |s| !s.monsters.is_empty());
        run(&mut s, 2.0);
        s.set_view(1000.0, 1600.0);
        let m = s.monsters[0];
        assert!(m.pos.x > 0.0 && m.pos.x < 1000.0);
    }

    #[test]
    fn calm_mode_softens_shake_and_skips_flash() {
        let mut s = sim_cfg("", &[(2, 3)]);
        s.set_calm(true);
        s.shake(12.0, 0.3);
        assert!((s.shake_amp - 12.0 * CALM_SHAKE * 1000.0 / SHAKE_REF_H).abs() < 1e-3);
        assert!(!s.try_flash([1.0; 4]));
        assert_eq!(s.n(40), 20);
    }

    #[test]
    fn no_allocation_growth_in_steady_state() {
        let facts: Vec<(i32, i32)> = (1..=12).map(|b| (3, b)).collect();
        let mut s = sim_cfg(r#","speed":{"x":5},"event":"bubble_breeze""#, &facts);
        let caps = |s: &Sim| {
            (
                s.monsters.capacity(),
                s.particles.items.capacity(),
                s.friends.capacity(),
                s.flyers.capacity(),
                s.results.capacity(),
                s.events.capacity(),
                s.deck.slots.capacity(),
                s.blade.trail.capacity(),
                s.banners.capacity(),
                s.popups.capacity(),
                s.slashes.capacity(),
            )
        };
        let before = caps(&s);
        let mut k = 0u32;
        for _ in 0..(90.0 / STEP) as u32 {
            s.step(STEP);
            k += 1;
            if k % 60 == 0 {
                if let Some(i) = flying(&s).first().copied() {
                    let a = s.monsters[i].fact.answer;
                    s.set_charged(Some(if k % 120 == 0 { a } else { a + 1 }));
                    swipe_through(&mut s, i);
                }
            }
            s.events.clear();
        }
        assert_eq!(caps(&s), before);
    }
}
