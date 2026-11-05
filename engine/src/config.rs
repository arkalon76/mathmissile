//! Round configuration, parsed from the JSON the shell builds (API.md "Round
//! config"). The shell decides *what* is in the round; tuning numbers live in
//! `tuning.rs`.

use crate::facts::{Fact, Op};
use crate::json::{self, Value};
use crate::species::{species_by_id, SpeciesRef};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoundType {
    Normal,
    Tutorial,
    Boss,
    Mixup,
    QuickCheck,
}

impl RoundType {
    pub fn name(self) -> &'static str {
        match self {
            RoundType::Normal => "normal",
            RoundType::Tutorial => "tutorial",
            RoundType::Boss => "boss",
            RoundType::Mixup => "mixup",
            RoundType::QuickCheck => "quick_check",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventKind {
    GoldenHour,
    BubbleBreeze,
    NightGlow,
    MonsterParade,
    StickerStorm,
}

impl EventKind {
    pub fn name(self) -> &'static str {
        match self {
            EventKind::GoldenHour => "golden_hour",
            EventKind::BubbleBreeze => "bubble_breeze",
            EventKind::NightGlow => "night_glow",
            EventKind::MonsterParade => "monster_parade",
            EventKind::StickerStorm => "sticker_storm",
        }
    }
    pub fn title(self) -> &'static str {
        match self {
            EventKind::GoldenHour => "Golden Hour!",
            EventKind::BubbleBreeze => "Bubble Breeze!",
            EventKind::NightGlow => "Night Glow!",
            EventKind::MonsterParade => "Monster Parade!",
            EventKind::StickerStorm => "Sticker Storm!",
        }
    }
    fn parse(s: &str) -> Option<EventKind> {
        Some(match s {
            "golden_hour" => EventKind::GoldenHour,
            "bubble_breeze" => EventKind::BubbleBreeze,
            "night_glow" => EventKind::NightGlow,
            "monster_parade" => EventKind::MonsterParade,
            "sticker_storm" => EventKind::StickerStorm,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Band {
    Little,
    Big,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlotKind {
    Warmup,
    New,
    Tricky,
    Review,
    Focus,
    Easy,
    /// A copy the engine inserted (§2.5).
    Repeat,
    /// Goldfluff from `golden` (not a deck slot).
    Golden,
    /// Splitsy mini (not a deck slot).
    Mini,
}

impl SlotKind {
    pub fn name(self) -> &'static str {
        match self {
            SlotKind::Warmup => "warmup",
            SlotKind::New => "new",
            SlotKind::Tricky => "tricky",
            SlotKind::Review => "review",
            SlotKind::Focus => "focus",
            SlotKind::Easy => "easy",
            SlotKind::Repeat => "repeat",
            SlotKind::Golden => "golden",
            SlotKind::Mini => "mini",
        }
    }
    fn parse(s: &str) -> Option<SlotKind> {
        Some(match s {
            "warmup" => SlotKind::Warmup,
            "new" => SlotKind::New,
            "tricky" => SlotKind::Tricky,
            "review" => SlotKind::Review,
            "focus" => SlotKind::Focus,
            "easy" => SlotKind::Easy,
            "repeat" => SlotKind::Repeat,
            _ => return None,
        })
    }
    /// A wrong-answer copy may overwrite this slot (§2.5: never New or Tricky).
    pub fn replaceable(self) -> bool {
        matches!(self, SlotKind::Focus | SlotKind::Review | SlotKind::Easy | SlotKind::Warmup)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Special {
    None,
    Armored,
    Freeze,
    Splitter,
    Golden,
}

impl Special {
    pub fn name(self) -> Option<&'static str> {
        match self {
            Special::None => None,
            Special::Armored => Some("armored"),
            Special::Freeze => Some("freeze"),
            Special::Splitter => Some("splitter"),
            Special::Golden => Some("golden"),
        }
    }
    fn parse(s: &str) -> Option<Special> {
        Some(match s {
            "armored" => Special::Armored,
            "freeze" => Special::Freeze,
            "splitter" => Special::Splitter,
            "golden" => Special::Golden,
            _ => return None,
        })
    }
    /// Species drawn when the shell does not name one.
    pub fn default_species(self) -> Option<&'static str> {
        match self {
            Special::Armored => Some("clonkshell"),
            Special::Freeze => Some("chillby"),
            Special::Splitter => Some("splitsy"),
            Special::Golden => Some("goldfluff"),
            Special::None => None,
        }
    }
}

/// One sum to play: a deck slot, an inserted copy, a golden or a mini.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Slot {
    /// Display form as given.
    pub fact: Fact,
    pub kind: SlotKind,
    pub ghost: bool,
    pub lantern: bool,
    pub tricky: bool,
    pub tricky_need: Option<u8>,
    pub special: Special,
    pub intro: bool,
    pub species: Option<SpeciesRef>,
    pub shiny: bool,
    /// Index in the config deck; None for copies, golden and minis.
    pub index: Option<u16>,
    /// Flight multiplier inherited by copies (`new` keeps × 1.30).
    pub was_new: bool,
}

impl Slot {
    pub fn plain(fact: Fact, kind: SlotKind) -> Slot {
        Slot {
            fact,
            kind,
            ghost: false,
            lantern: false,
            tricky: false,
            tricky_need: None,
            special: Special::None,
            intro: false,
            species: None,
            shiny: false,
            index: None,
            was_new: kind == SlotKind::New,
        }
    }

    /// The copy §2.5 inserts: same display form and tricky tag, no extras.
    pub fn repeat_copy(&self) -> Slot {
        Slot {
            kind: SlotKind::Repeat,
            ghost: false,
            lantern: false,
            special: Special::None,
            intro: false,
            shiny: false,
            index: None,
            species: if self.special == Special::None { self.species } else { None },
            ..*self
        }
    }
}

/// Adaptive speed input (§3.3).
#[derive(Clone, Debug, PartialEq)]
pub struct SpeedInput {
    pub base: f32,
    pub level: u32,
    pub offset: f32,
    /// Oldest first, `b'C' | b'W' | b'E'`, at most 8.
    pub recent: Vec<u8>,
    /// `{x}` fixes the speed index (no adaptation).
    pub fixed_x: Option<f32>,
    pub flight_time: Option<f32>,
    pub spawn_interval: Option<f32>,
    pub max_on_screen: Option<u32>,
}

impl Default for SpeedInput {
    fn default() -> Self {
        SpeedInput { base: 0.0, level: 1, offset: 0.0, recent: Vec::new(), fixed_x: None, flight_time: None, spawn_interval: None, max_on_screen: None }
    }
}

impl SpeedInput {
    pub fn apply_json(&mut self, v: &Value) {
        if let Some(b) = v.get("base").and_then(Value::as_f64) {
            self.base = (b as f32).clamp(-1.0, 5.0);
        }
        if let Some(l) = v.get("level").and_then(Value::as_f64) {
            self.level = l.max(1.0) as u32;
        }
        if let Some(o) = v.get("offset").and_then(Value::as_f64) {
            self.offset = (o as f32).clamp(-6.0, 6.0);
        }
        if let Some(r) = v.get("recent").and_then(Value::as_str) {
            self.recent = r.bytes().filter(|c| matches!(c, b'C' | b'W' | b'E')).collect();
            let n = self.recent.len();
            if n > 8 {
                self.recent.drain(..n - 8);
            }
        }
        if let Some(x) = v.get("x") {
            self.fixed_x = x.as_f64().map(|x| (x as f32).clamp(-1.0, 5.0));
        }
        if let Some(f) = v.get("flight_time") {
            self.flight_time = f.as_f64().map(|f| (f as f32).clamp(1.0, 30.0));
        }
        if let Some(f) = v.get("spawn_interval") {
            self.spawn_interval = f.as_f64().map(|f| (f as f32).clamp(0.2, 30.0));
        }
        if let Some(f) = v.get("max_on_screen") {
            self.max_on_screen = f.as_f64().map(|f| (f as u32).clamp(1, 12));
        }
    }

    pub fn from_json_str(s: &str, base: &SpeedInput) -> Result<SpeedInput, String> {
        let v = json::parse(s)?;
        let mut p = base.clone();
        p.apply_json(&v);
        Ok(p)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BossConfig {
    pub species: SpeciesRef,
    pub hp: u32,
}

#[derive(Clone, Debug)]
pub struct RoundConfig {
    pub seed: u64,
    pub round_type: RoundType,
    pub event: Option<EventKind>,
    pub band: Band,
    pub target_ms: f32,
    pub speed: SpeedInput,
    pub deck: Vec<Slot>,
    pub golden: Vec<Slot>,
    pub mini_pool: Vec<Fact>,
    pub boss: Option<BossConfig>,
    pub calm: Option<bool>,
    pub reforge_s: Option<f32>,
    /// Non-fatal problems (unknown ids); the sim reports them as `warning` events.
    pub warnings: Vec<String>,
}

impl Default for RoundConfig {
    fn default() -> Self {
        RoundConfig {
            seed: 1,
            round_type: RoundType::Normal,
            event: None,
            band: Band::Little,
            target_ms: 6000.0,
            speed: SpeedInput::default(),
            deck: Vec::new(),
            golden: Vec::new(),
            mini_pool: Vec::new(),
            boss: None,
            calm: None,
            reforge_s: None,
            warnings: Vec::new(),
        }
    }
}

fn parse_fact(v: &Value) -> Result<Fact, String> {
    let a = v.get("a").and_then(Value::as_f64).ok_or("fact needs a")?;
    let b = v.get("b").and_then(Value::as_f64).ok_or("fact needs b")?;
    let op = match v.get("op").and_then(Value::as_str) {
        Some(s) => Op::parse(s).ok_or_else(|| format!("unknown op {s:?}"))?,
        None => Op::Mul,
    };
    // Check before casting: a huge f64 saturates to i32::MIN, whose abs() overflows.
    if !(a.abs() <= 9999.0) || !(b.abs() <= 9999.0) || a.fract() != 0.0 || b.fract() != 0.0 {
        return Err("fact numbers out of range".into());
    }
    let (a, b) = (a as i32, b as i32);
    Fact::new(a, b, op).ok_or_else(|| format!("bad fact {a},{b}"))
}

fn species_field(v: &Value, warnings: &mut Vec<String>) -> Option<SpeciesRef> {
    let id = v.get("species").and_then(Value::as_str)?;
    match species_by_id(id) {
        Some(s) => Some(s),
        None => {
            warnings.push(format!("unknown species {id:?}"));
            None
        }
    }
}

fn parse_slot(v: &Value, index: u16, warnings: &mut Vec<String>) -> Result<Slot, String> {
    let fact = parse_fact(v)?;
    let kind = match v.get("kind").and_then(Value::as_str) {
        Some(k) => SlotKind::parse(k).unwrap_or_else(|| {
            warnings.push(format!("unknown slot kind {k:?}"));
            SlotKind::Focus
        }),
        None => SlotKind::Focus,
    };
    let flag = |k: &str| v.get(k).and_then(Value::as_bool).unwrap_or(false);
    let special = match v.get("special").and_then(Value::as_str) {
        Some(s) => Special::parse(s).unwrap_or_else(|| {
            warnings.push(format!("unknown special {s:?}"));
            Special::None
        }),
        None => Special::None,
    };
    let tricky = flag("tricky") || kind == SlotKind::Tricky;
    let tricky_need = v.get("tricky_need").and_then(Value::as_f64).map(|n| n.clamp(0.0, 9.0) as u8);
    let mut s = Slot::plain(fact, kind);
    s.ghost = flag("ghost");
    s.lantern = flag("lantern");
    s.tricky = tricky;
    s.tricky_need = tricky_need;
    s.special = special;
    s.intro = flag("intro") && special != Special::None;
    s.species = species_field(v, warnings);
    s.shiny = flag("shiny");
    s.index = Some(index);
    Ok(s)
}

impl RoundConfig {
    pub fn from_json_str(s: &str) -> Result<RoundConfig, String> {
        let v = json::parse(s)?;
        let mut c = RoundConfig::default();
        let w = &mut c.warnings;
        c.seed = v.num_or("seed", 1.0).max(0.0) as u64;
        c.round_type = match v.get("round_type").and_then(Value::as_str).unwrap_or("normal") {
            "normal" => RoundType::Normal,
            "tutorial" => RoundType::Tutorial,
            "boss" => RoundType::Boss,
            "mixup" => RoundType::Mixup,
            "quick_check" => RoundType::QuickCheck,
            other => {
                w.push(format!("unknown round_type {other:?}"));
                RoundType::Normal
            }
        };
        c.event = match v.get("event").and_then(Value::as_str) {
            Some(e) => {
                let k = EventKind::parse(e);
                if k.is_none() {
                    w.push(format!("unknown event {e:?}"));
                }
                k
            }
            None => None,
        };
        c.band = match v.get("band").and_then(Value::as_str) {
            Some("big") => Band::Big,
            _ => Band::Little,
        };
        c.target_ms = (v.num_or("target_ms", 6000.0) as f32).clamp(500.0, 60000.0);
        if let Some(sp) = v.get("speed") {
            c.speed.apply_json(sp);
        }
        let deck = v.get("deck").and_then(Value::as_arr).ok_or("round config needs deck")?;
        for (i, d) in deck.iter().enumerate() {
            c.deck.push(parse_slot(d, i as u16, w)?);
        }
        if let Some(g) = v.get("golden").and_then(Value::as_arr) {
            for d in g {
                let mut s = Slot::plain(parse_fact(d)?, SlotKind::Golden);
                s.special = Special::Golden;
                s.intro = d.get("intro").and_then(Value::as_bool).unwrap_or(false);
                s.species = species_field(d, w);
                c.golden.push(s);
            }
        }
        if let Some(m) = v.get("mini_pool").and_then(Value::as_arr) {
            for d in m {
                c.mini_pool.push(parse_fact(d)?);
            }
        }
        if let Some(b) = v.get("boss") {
            if let Value::Obj(_) = b {
                let species = species_field(b, w).unwrap_or_default();
                let hp = b.num_or("hp", 12.0).clamp(1.0, 99.0) as u32;
                c.boss = Some(BossConfig { species: SpeciesRef { grand: true, ..species }, hp });
            }
        }
        if c.round_type == RoundType::Boss && c.boss.is_none() {
            c.boss = Some(BossConfig { species: SpeciesRef { idx: 0, grand: true }, hp: 12 });
        }
        if c.deck.is_empty() && c.golden.is_empty() {
            return Err("deck is empty".into());
        }
        c.calm = v.get("calm").and_then(Value::as_bool);
        c.reforge_s = v.get("reforge_s").and_then(Value::as_f64).map(|r| (r as f32).clamp(0.0, 10.0));
        Ok(c)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn huge_or_fractional_fact_numbers_do_not_panic() {
        for d in [r#"{"a":-1e10,"b":-1,"op":"div"}"#, r#"{"a":1e300,"b":2}"#, r#"{"a":2.5,"b":2}"#] {
            let s = format!(r#"{{"seed":1,"round_type":"normal","deck":[{d}]}}"#);
            let _ = RoundConfig::from_json_str(&s); // Err or a skipped fact, never a panic
        }
    }

    #[test]
    fn parses_round_config() {
        let c = RoundConfig::from_json_str(
            r#"{"seed":9,"round_type":"normal","event":"night_glow","band":"big","target_ms":4000,
               "speed":{"base":2,"level":5,"offset":0.1,"recent":"CCWEXC"},
               "deck":[{"a":3,"b":4,"kind":"new","ghost":true,"species":"pebbit"},
                       {"a":2,"b":6,"kind":"tricky","tricky_need":2,"special":"armored","intro":true,"species":"nope"}],
               "golden":[{"a":1,"b":7}],"mini_pool":[{"a":2,"b":3}],"boss":null,"calm":true}"#,
        )
        .unwrap();
        assert_eq!(c.seed, 9);
        assert_eq!(c.event, Some(EventKind::NightGlow));
        assert_eq!(c.band, Band::Big);
        assert_eq!(c.speed.recent, b"CCWEC".to_vec());
        assert_eq!(c.speed.base, 2.0);
        assert_eq!(c.deck.len(), 2);
        assert!(c.deck[0].ghost && c.deck[0].was_new && c.deck[0].species.is_some());
        assert_eq!(c.deck[1].special, Special::Armored);
        assert!(c.deck[1].tricky && c.deck[1].intro);
        assert_eq!(c.deck[1].tricky_need, Some(2));
        assert_eq!(c.deck[1].index, Some(1));
        assert_eq!(c.deck[1].species, None);
        assert_eq!(c.warnings.len(), 1);
        assert_eq!(c.golden[0].special, Special::Golden);
        assert_eq!(c.mini_pool.len(), 1);
        assert!(c.boss.is_none());
        assert_eq!(c.calm, Some(true));
    }

    #[test]
    fn boss_and_fixed_speed() {
        let c = RoundConfig::from_json_str(
            r#"{"round_type":"boss","speed":{"x":2.5},"deck":[{"a":2,"b":2}],"boss":{"species":"gloomp","hp":12}}"#,
        )
        .unwrap();
        let b = c.boss.unwrap();
        assert!(b.species.grand);
        assert_eq!(b.species.info().id, "gloomp");
        assert_eq!(c.speed.fixed_x, Some(2.5));
        assert!(RoundConfig::from_json_str(r#"{"deck":[]}"#).is_err());
        assert!(RoundConfig::from_json_str(r#"{"seed":1}"#).is_err());
    }

    #[test]
    fn repeat_copy_drops_extras() {
        let mut s = Slot::plain(Fact::mul(3, 4), SlotKind::New);
        s.ghost = true;
        s.lantern = true;
        s.tricky = true;
        s.index = Some(4);
        let r = s.repeat_copy();
        assert_eq!(r.kind, SlotKind::Repeat);
        assert!(!r.ghost && !r.lantern && r.tricky && r.was_new);
        assert_eq!(r.index, None);
        assert_eq!(r.fact, s.fact);
    }
}
