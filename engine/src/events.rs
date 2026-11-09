//! Engine → shell events and the round summary, serialised to JSON
//! (API.md "Events"). Hand-written so the hot path never allocates beyond the
//! output string.

use std::fmt::Write;

use crate::config::{SlotKind, Special};
use crate::facts::Fact;
use crate::json;
use crate::sim::Sim;
use crate::species::SpeciesRef;

/// What the events say about a monster.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MInfo {
    pub id: u32,
    pub fact: Fact,
    pub slot: Option<u16>,
    pub kind: SlotKind,
    pub special: Special,
    pub species: SpeciesRef,
    pub shiny: bool,
    pub ghost: bool,
    pub mini: bool,
    pub golden: bool,
    pub minion: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Correct,
    Wrong,
    Escaped,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ResultRec {
    pub outcome: Outcome,
    pub graded: bool,
    pub rt_ms: u32,
    pub fast: bool,
    pub given: Option<i32>,
    pub info: MInfo,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    RoundStart,
    Spawn(MInfo),
    SpecialIntro { special: Special, species: SpeciesRef },
    Correct { info: MInfo, rt_ms: u32, fast: bool, points: u32, combo: u32, mult: u32, graded: bool, tricky_cleared: bool, lantern: bool },
    ArmorCrack { id: u32, fact: Fact, inner: Fact },
    Fixed { id: u32, fact: Fact, points: u32 },
    Wrong { info: MInfo, given: i32, graded: bool },
    Escaped { info: MInfo, graded: bool, blade_ready: bool },
    Combo { n: u32, tier: u32, tier_up: bool },
    ComboBreak { was: u32, reason: &'static str },
    ChargeCleared,
    BladeBroken { reforge_s: f32, guard: bool },
    BladeReady,
    Freeze,
    Unfreeze,
    Split { id: u32, minis: [Option<Fact>; 2] },
    BossHit { hp: u32, max_hp: u32 },
    BossPhase { phase: u8 },
    BossDefeated { species: SpeciesRef },
    Speed { x: f32, offset: f32 },
    Sfx { name: &'static str, semitones: i8 },
    /// Index into `cfg.warnings`.
    Warning(u16),
    RoundEnd,
}

fn opt_str(out: &mut String, s: Option<&str>) {
    match s {
        Some(s) => {
            out.push('"');
            out.push_str(s);
            out.push('"');
        }
        None => out.push_str("null"),
    }
}

fn opt_u16(out: &mut String, n: Option<u16>) {
    match n {
        Some(n) => {
            let _ = write!(out, "{n}");
        }
        None => out.push_str("null"),
    }
}

fn species(out: &mut String, s: SpeciesRef) {
    out.push('"');
    s.write_id(out);
    out.push('"');
}

/// Writes `"id":..,"fact":..,"slot":..,...` (no braces).
fn info_fields(out: &mut String, m: &MInfo) {
    let _ = write!(out, "\"id\":{},\"fact\":", m.id);
    m.fact.write_json(out);
    out.push_str(",\"slot\":");
    opt_u16(out, m.slot);
    let _ = write!(out, ",\"kind\":\"{}\",\"special\":", m.kind.name());
    opt_str(out, m.special.name());
    out.push_str(",\"species\":");
    species(out, m.species);
    let _ = write!(
        out,
        ",\"shiny\":{},\"ghost\":{},\"mini\":{},\"golden\":{},\"boss_minion\":{}",
        m.shiny, m.ghost, m.mini, m.golden, m.minion
    );
}

fn f3(x: f32) -> f32 {
    (x * 1000.0).round() / 1000.0
}

impl Sim {
    /// Serialise and clear the event queue as a JSON array. Empty string when
    /// there is nothing to report (cheap to poll every frame).
    pub fn drain_events_json(&mut self) -> String {
        if self.events.is_empty() {
            return String::new();
        }
        let mut out = String::with_capacity(160 * self.events.len());
        out.push('[');
        let events = std::mem::take(&mut self.events);
        for (i, e) in events.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            self.write_event(&mut out, e);
        }
        out.push(']');
        self.events = events;
        self.events.clear();
        out
    }

    pub fn write_event(&self, out: &mut String, e: &Event) {
        match *e {
            Event::RoundStart => {
                let _ = write!(out, "{{\"type\":\"round_start\",\"round_type\":\"{}\",\"event\":", self.cfg.round_type.name());
                opt_str(out, self.cfg.event.map(|e| e.name()));
                let _ = write!(out, ",\"sums\":{},\"x\":{}}}", self.cfg.deck.len(), f3(self.x_start));
            }
            Event::Spawn(ref m) => {
                out.push_str("{\"type\":\"spawn\",");
                info_fields(out, m);
                out.push('}');
            }
            Event::SpecialIntro { special, species: s } => {
                out.push_str("{\"type\":\"special_intro\",\"special\":");
                opt_str(out, special.name());
                out.push_str(",\"species\":");
                species(out, s);
                out.push('}');
            }
            Event::Correct { ref info, rt_ms, fast, points, combo, mult, graded, tricky_cleared, lantern } => {
                out.push_str("{\"type\":\"correct\",");
                info_fields(out, info);
                let _ = write!(
                    out,
                    ",\"rt_ms\":{rt_ms},\"fast\":{fast},\"points\":{points},\"combo\":{combo},\"mult\":{mult},\"graded\":{graded},\"tricky_cleared\":{tricky_cleared},\"lantern\":{lantern}}}"
                );
            }
            Event::ArmorCrack { id, fact, inner } => {
                let _ = write!(out, "{{\"type\":\"armor_crack\",\"id\":{id},\"fact\":");
                fact.write_json(out);
                out.push_str(",\"inner\":");
                inner.write_json(out);
                out.push('}');
            }
            Event::Fixed { id, fact, points } => {
                let _ = write!(out, "{{\"type\":\"fixed\",\"id\":{id},\"points\":{points},\"fact\":");
                fact.write_json(out);
                out.push('}');
            }
            Event::Wrong { ref info, given, graded } => {
                out.push_str("{\"type\":\"wrong\",");
                info_fields(out, info);
                let _ = write!(out, ",\"given\":{given},\"graded\":{graded}}}");
            }
            Event::Escaped { ref info, graded, blade_ready } => {
                out.push_str("{\"type\":\"escaped\",");
                info_fields(out, info);
                let _ = write!(out, ",\"graded\":{graded},\"blade_ready\":{blade_ready}}}");
            }
            Event::Combo { n, tier, tier_up } => {
                let name = crate::tuning::COMBO_NAMES[tier.min(4) as usize];
                let _ = write!(out, "{{\"type\":\"combo\",\"n\":{n},\"tier\":{tier},\"name\":\"{name}\",\"tier_up\":{tier_up}}}");
            }
            Event::ComboBreak { was, reason } => {
                let _ = write!(out, "{{\"type\":\"combo_break\",\"was\":{was},\"reason\":\"{reason}\"}}");
            }
            Event::ChargeCleared => out.push_str("{\"type\":\"charge_cleared\"}"),
            Event::BladeBroken { reforge_s, guard } => {
                let _ = write!(out, "{{\"type\":\"blade_broken\",\"reforge_s\":{},\"guard\":{guard}}}", f3(reforge_s));
            }
            Event::BladeReady => out.push_str("{\"type\":\"blade_ready\"}"),
            Event::Freeze => out.push_str("{\"type\":\"freeze\"}"),
            Event::Unfreeze => out.push_str("{\"type\":\"unfreeze\"}"),
            Event::Split { id, minis } => {
                let _ = write!(out, "{{\"type\":\"split\",\"id\":{id},\"minis\":[");
                let mut first = true;
                for f in minis.iter().flatten() {
                    if !first {
                        out.push(',');
                    }
                    first = false;
                    f.write_json(out);
                }
                out.push_str("]}");
            }
            Event::BossHit { hp, max_hp } => {
                let _ = write!(out, "{{\"type\":\"boss_hit\",\"hp\":{hp},\"max_hp\":{max_hp}}}");
            }
            Event::BossPhase { phase } => {
                let _ = write!(out, "{{\"type\":\"boss_phase\",\"phase\":{phase}}}");
            }
            Event::BossDefeated { species: s } => {
                out.push_str("{\"type\":\"boss_defeated\",\"species\":");
                species(out, s);
                out.push('}');
            }
            Event::Speed { x, offset } => {
                let _ = write!(out, "{{\"type\":\"speed\",\"x\":{},\"offset\":{}}}", f3(x), f3(offset));
            }
            Event::Sfx { name, semitones } => {
                if semitones != 0 {
                    let _ = write!(out, "{{\"type\":\"sfx\",\"name\":\"{name}\",\"semitones\":{semitones}}}");
                } else {
                    let _ = write!(out, "{{\"type\":\"sfx\",\"name\":\"{name}\"}}");
                }
            }
            Event::Warning(i) => {
                out.push_str("{\"type\":\"warning\",\"message\":");
                json::write_str(out, self.cfg.warnings.get(i as usize).map(String::as_str).unwrap_or(""));
                out.push('}');
            }
            Event::RoundEnd => {
                out.push_str("{\"type\":\"round_end\",\"summary\":");
                self.write_summary(out);
                out.push('}');
            }
        }
    }

    pub fn write_summary(&self, out: &mut String) {
        let st = &self.stats;
        let denom = st.correct + st.wrong + st.escaped + st.golden + st.minis;
        let acc = if denom > 0 { (st.correct + st.golden + st.minis) as f32 / denom as f32 } else { 0.0 };
        let _ = write!(out, "{{\"aborted\":{},\"round_type\":\"{}\",\"event\":", self.aborted, self.cfg.round_type.name());
        opt_str(out, self.cfg.event.map(|e| e.name()));
        let _ = write!(
            out,
            ",\"seed\":{},\"sums\":{},\"correct\":{},\"wrong\":{},\"escaped\":{},\"accuracy\":{},\"median_rt_ms\":",
            self.cfg.seed, st.sums, st.correct, st.wrong, st.escaped, f3(acc)
        );
        match self.median_rt_ms() {
            Some(m) => {
                let _ = write!(out, "{m}");
            }
            None => out.push_str("null"),
        }
        let _ = write!(
            out,
            ",\"score\":{},\"best_combo\":{},\"golden_sliced\":{},\"minis_correct\":{},\"fixed\":{},\"tricky_cleared\":[",
            self.score, self.best_combo, st.golden, st.minis, st.fixed
        );
        for (i, f) in self.tricky_cleared.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            let _ = write!(out, "{{\"a\":{},\"b\":{}}}", f.a, f.b);
        }
        let _ = write!(
            out,
            "],\"x_start\":{},\"x_end\":{},\"offset_start\":{},\"offset_end\":{},\"recent_end\":\"",
            f3(self.x_start),
            f3(self.adaptive.x()),
            f3(self.adaptive.offset_start),
            f3(self.adaptive.offset)
        );
        self.adaptive.recent_string(out);
        let _ = write!(
            out,
            "\",\"boss_defeated\":{},\"hard_stopped\":{},\"unplayed\":{},\"duration_ms\":{},\"results\":[",
            self.boss.as_ref().map_or(false, |b| b.hp == 0),
            self.hard_stopped,
            self.unplayed,
            (self.round_time * 1000.0) as u32
        );
        for (i, r) in self.results.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            let res = match r.outcome {
                Outcome::Correct => "correct",
                Outcome::Wrong => "wrong",
                Outcome::Escaped => "escaped",
            };
            let _ = write!(out, "{{\"result\":\"{res}\",\"graded\":{},\"rt_ms\":{},\"fast\":{},\"given\":", r.graded, r.rt_ms, r.fast);
            match r.given {
                Some(g) => {
                    let _ = write!(out, "{g}");
                }
                None => out.push_str("null"),
            }
            out.push(',');
            info_fields(out, &r.info);
            out.push('}');
        }
        out.push_str("]}");
    }

    fn median_rt_ms(&self) -> Option<u32> {
        let mut v: Vec<u32> = self
            .results
            .iter()
            .filter(|r| r.outcome == Outcome::Correct && r.graded && !r.info.golden && !r.info.mini)
            .map(|r| r.rt_ms)
            .collect();
        if v.is_empty() {
            return None;
        }
        v.sort_unstable();
        let n = v.len();
        Some(if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2 })
    }
}
