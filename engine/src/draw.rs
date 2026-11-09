//! Builds the per-frame instance buffer from the simulation state.
//!
//! Every visible thing is one instanced quad with a `kind` the fragment shader
//! switches on. Colours are written straight; the shader premultiplies and the
//! `additive` flag zeroes output alpha, so alpha-blended and additive quads mix
//! in a single draw call with blendFunc(ONE, ONE_MINUS_SRC_ALPHA), in order.

use crate::config::{EventKind, RoundType, Special};
use crate::facts::{Label, G_EQUALS, G_SPACE};
use crate::fx::{hsv, tier_color};
use crate::glyphs::GlyphTable;
use crate::particles::kind;
use crate::sim::{FlyKind, MState, Monster, Sim, TRAIL_LIFE};
use crate::species::{icon, Rgb, SpeciesRef, BLADES, SP_CHILLBY, SP_CLONKSHELL, TRAILS};
use crate::tuning::{GHOST_ALPHA, INTRO_S};
use crate::vec2::{v2, Vec2};

pub const FLOATS_PER_INSTANCE: usize = 28;
pub const MAX_INSTANCES: usize = 16384;

/// Monster moods understood by the shader.
pub mod mood {
    pub const NORMAL: u8 = 0;
    pub const DIZZY: u8 = 1;
    pub const HAPPY: u8 = 2;
    pub const BONK: u8 = 3;
    pub const SLEEPY: u8 = 4;
    pub const WAVE: u8 = 5;
    pub const GRUMPY: u8 = 6;
    pub const DETERMINED: u8 = 7;

    pub fn by_name(s: &str) -> Option<u8> {
        Some(match s {
            "normal" => NORMAL,
            "dizzy" => DIZZY,
            "happy" => HAPPY,
            "bonk" => BONK,
            "sleepy" => SLEEPY,
            "wave" => WAVE,
            "grumpy" => GRUMPY,
            "determined" => DETERMINED,
            _ => return None,
        })
    }
}

/// Monster flag bits understood by the shader.
pub mod flag {
    pub const SHINY: u32 = 1;
    pub const BANDAGE: u32 = 2;
    pub const CROWN: u32 = 4;
    pub const BUBBLE: u32 = 8;
    pub const SHELL: u32 = 16;
    pub const SILHOUETTE: u32 = 32;
    pub const ICE: u32 = 64;
    pub const GOLD: u32 = 128;
    pub const CRACKED: u32 = 256;
}

#[derive(Clone, Copy)]
pub struct Inst {
    pub pos: Vec2,
    pub size: Vec2,
    pub rot: f32,
    pub kind: u8,
    pub additive: bool,
    /// Icon id (ICON) or blade family (BLADE).
    pub sub: u8,
    pub color: [f32; 4],
    pub p0: [f32; 4],
    pub p1: [f32; 4],
    pub p2: [f32; 4],
    pub p3: [f32; 4],
}

impl Default for Inst {
    fn default() -> Self {
        Inst {
            pos: v2(0.0, 0.0),
            size: v2(1.0, 1.0),
            rot: 0.0,
            kind: kind::SOLID,
            additive: false,
            sub: 0,
            color: [1.0; 4],
            p0: [0.0; 4],
            p1: [0.0; 4],
            p2: [0.0; 4],
            p3: [0.0; 4],
        }
    }
}

pub struct InstanceWriter {
    pub data: Vec<f32>,
    pub count: usize,
}

impl InstanceWriter {
    pub fn new() -> Self {
        InstanceWriter { data: Vec::with_capacity(MAX_INSTANCES * FLOATS_PER_INSTANCE), count: 0 }
    }

    pub fn clear(&mut self) {
        self.data.clear();
        self.count = 0;
    }

    #[inline]
    pub fn push(&mut self, i: &Inst) {
        if self.count >= MAX_INSTANCES {
            return;
        }
        self.data.extend_from_slice(&[
            i.pos.x,
            i.pos.y,
            i.size.x,
            i.size.y,
            i.rot,
            i.kind as f32,
            if i.additive { 1.0 } else { 0.0 },
            i.sub as f32,
        ]);
        self.data.extend_from_slice(&i.color);
        self.data.extend_from_slice(&i.p0);
        self.data.extend_from_slice(&i.p1);
        self.data.extend_from_slice(&i.p2);
        self.data.extend_from_slice(&i.p3);
        self.count += 1;
    }
}

impl Default for InstanceWriter {
    fn default() -> Self {
        Self::new()
    }
}

/// Quad half-extent of a monster relative to its body radius (room for ears,
/// horns, tentacles and wings). The shader scales local space by the same 1.6.
pub const MONSTER_QUAD: f32 = 1.6;
const OUTLINE: [f32; 3] = [0.10, 0.06, 0.22];
const GOLD_TEXT: [f32; 4] = [1.0, 0.86, 0.3, 1.0];
/// Blade length (world units, tip to pommel / 2).
const BLADE_L: f32 = 96.0;
const BLADE_ROT: f32 = -0.55;

/// Draw a label centred at `center`, rotated by `rot`. Outlines are drawn in a
/// first pass so they never cover a neighbouring glyph's fill. `alphas`
/// optionally gives a per-glyph alpha multiplier from glyph index `from`.
#[allow(clippy::too_many_arguments)]
pub fn draw_label_ex(
    w: &mut InstanceWriter,
    g: &GlyphTable,
    label: &Label,
    center: Vec2,
    font: f32,
    rot: f32,
    fill: [f32; 4],
    outline: [f32; 3],
    tail: Option<(usize, [f32; 4])>,
) {
    let total = g.width(label, font);
    for mode in [1.0f32, 2.0] {
        let mut pen = -total * 0.5;
        for (k, &gid) in label.as_slice().iter().enumerate() {
            let gi = &g.glyphs[gid as usize % g.glyphs.len()];
            let adv = gi.advance * font;
            if gid != G_SPACE {
                let off = v2(pen + adv * 0.5, 0.0).rotate(rot);
                let col = match tail {
                    Some((from, c)) if k >= from => c,
                    _ => fill,
                };
                let ol_a = col[3];
                w.push(&Inst {
                    pos: center + off,
                    size: v2(gi.box_w * font * 0.5, g.cell_h * font * 0.5),
                    rot,
                    kind: kind::GLYPH,
                    color: [col[0], col[1], col[2], ol_a],
                    p0: gi.uv,
                    p1: [outline[0], outline[1], outline[2], mode],
                    ..Default::default()
                });
            }
            pen += adv;
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn draw_label(w: &mut InstanceWriter, g: &GlyphTable, label: &Label, center: Vec2, font: f32, rot: f32, fill: [f32; 4], outline: [f32; 3]) {
    draw_label_ex(w, g, label, center, font, rot, fill, outline, None);
}

/// Parameters for one monster body instance.
#[derive(Clone, Copy)]
pub struct MonsterLook {
    pub species: SpeciesRef,
    pub color: Rgb,
    pub color2: Rgb,
    pub pos: Vec2,
    pub radius: f32,
    pub rot: f32,
    pub look: Vec2,
    pub blink: f32,
    pub mood: u8,
    pub flags: u32,
    pub crack: f32,
    pub t: f32,
    pub squash: f32,
    pub age: f32,
    pub white: f32,
    pub glow: f32,
    pub alpha: f32,
    /// Extra non-uniform scale (pop squash), x and y.
    pub scale: Vec2,
}

impl MonsterLook {
    pub fn new(species: SpeciesRef, pos: Vec2, radius: f32) -> Self {
        let info = species.info();
        MonsterLook {
            species,
            color: info.color,
            color2: info.color2,
            pos,
            radius,
            rot: 0.0,
            look: v2(0.0, 0.0),
            blink: 0.0,
            mood: mood::NORMAL,
            flags: if species.grand { flag::CROWN } else { 0 },
            crack: 0.0,
            t: 0.0,
            squash: 0.0,
            age: 0.0,
            white: 0.0,
            glow: 0.0,
            alpha: 1.0,
            scale: v2(1.0, 1.0),
        }
    }
}

pub fn push_monster(w: &mut InstanceWriter, m: &MonsterLook) {
    let q = m.radius * MONSTER_QUAD;
    w.push(&Inst {
        pos: m.pos,
        size: v2(q * m.scale.x, q * m.scale.y),
        rot: m.rot,
        kind: kind::MONSTER,
        color: [m.color[0], m.color[1], m.color[2], m.alpha],
        p0: [m.species.idx as f32, m.look.x, m.look.y, m.blink],
        p1: [m.mood as f32, m.flags as f32, m.crack, if m.species.grand { 1.0 } else { 0.0 }],
        p2: [m.t, m.squash, m.age, m.white],
        p3: [m.color2[0], m.color2[1], m.color2[2], m.glow],
        ..Default::default()
    });
}

fn icon_inst(w: &mut InstanceWriter, id: u8, pos: Vec2, size: f32, rot: f32, color: [f32; 4]) {
    w.push(&Inst { pos, size: v2(size, size), rot, kind: kind::ICON, sub: id, color, ..Default::default() });
}

fn rgba(c: Rgb, a: f32) -> [f32; 4] {
    [c[0], c[1], c[2], a]
}

/// Background event / round-type id for the shader.
fn bg_id(sim: &Sim) -> f32 {
    match (sim.cfg.event, sim.cfg.round_type) {
        (Some(EventKind::GoldenHour), _) => 1.0,
        (Some(EventKind::BubbleBreeze), _) => 2.0,
        (Some(EventKind::NightGlow), _) => 3.0,
        (Some(EventKind::MonsterParade), _) => 4.0,
        (Some(EventKind::StickerStorm), _) => 5.0,
        (None, RoundType::Mixup) => 6.0,
        (None, RoundType::Boss) => 7.0,
        _ => 0.0,
    }
}

fn monster_look(sim: &Sim, m: &Monster) -> MonsterLook {
    let t = sim.time;
    let mut l = MonsterLook::new(m.species, m.pos, m.radius);
    l.color = m.color;
    l.color2 = m.color2;
    l.rot = m.rot;
    l.look = m.look;
    l.blink = m.blink_amount();
    l.t = m.phase + t;
    l.squash = m.squash;
    l.age = m.age;
    l.white = (m.hit_flash / 0.1).clamp(0.0, 1.0);
    if m.slot.shiny {
        l.flags |= flag::SHINY;
    }
    if m.slot.tricky {
        l.flags |= flag::BANDAGE;
    }
    if m.bubble {
        l.flags |= flag::BUBBLE;
    }
    if m.golden {
        l.flags |= flag::GOLD;
    }
    if m.species.idx == SP_CHILLBY {
        l.flags |= flag::ICE;
    }
    if m.species.idx == SP_CLONKSHELL || m.slot.special == Special::Armored {
        match m.armor {
            1 => l.flags |= flag::SHELL,
            2 => l.flags |= flag::CRACKED,
            _ => {}
        }
    }
    l.crack = (m.crack_t / 0.4).clamp(0.0, 1.0);
    // Mood.
    let leaving = m.age > m.flight - 0.35;
    l.mood = match m.state {
        MState::Popping => mood::HAPPY,
        MState::Revealed if m.reveal > 0.0 => mood::DIZZY,
        MState::Revealed => mood::NORMAL,
        MState::Flying if m.crack_t > 0.0 && m.tricky_cleared => mood::HAPPY,
        MState::Flying if leaving => mood::WAVE,
        MState::Flying if m.minion => mood::DETERMINED,
        MState::Flying if m.species.idx == 18 => mood::SLEEPY,
        MState::Flying => mood::NORMAL,
    };
    if m.state == MState::Revealed {
        l.glow = 0.6 + 0.2 * (t * 4.0).sin();
    } else if sim.cfg.event == Some(EventKind::NightGlow) {
        l.glow = 0.55;
    }
    // Wrong freeze grows to 1.6×; the pop squashes to 1.2 × 0.8.
    let grow = 1.0 + 0.6 * m.grow;
    l.radius *= grow;
    if m.state == MState::Popping && m.pop_t >= 0.0 {
        l.scale = v2(1.2, 0.8);
    }
    l
}

pub fn build(sim: &Sim, g: &GlyphTable, w: &mut InstanceWriter) {
    w.clear();
    let (vw, vh) = (sim.view.x, sim.view.y);
    let t = sim.time;
    let tier = sim.tier;
    let tc = tier_color(tier, t);
    let full = v2(vw * 0.5 + 60.0, vh * 0.5 + 60.0);
    let center = v2(vw * 0.5, vh * 0.5);

    // Background (slightly oversized to hide screen-shake edges).
    w.push(&Inst {
        pos: center,
        size: full,
        kind: kind::BG,
        color: rgba(tc, 1.0),
        p0: [t, tier as f32, sim.hue_pulse, vh],
        p1: [vw, bg_id(sim), (sim.chill / 1.0).min(1.0), 0.0],
        ..Default::default()
    });

    // Boss behind everything else.
    if let Some(b) = sim.boss {
        let e = b.enter;
        let ease = 1.0 - (1.0 - e) * (1.0 - e);
        let mut pos = b.pos + v2(0.0, (1.0 - ease) * b.radius * 2.5);
        let mut alpha = 1.0;
        let mut l = MonsterLook::new(b.species, pos, b.radius);
        l.t = t;
        l.age = t;
        l.mood = if b.phase >= 2 { mood::DETERMINED } else { mood::GRUMPY };
        l.look = v2((t * 0.7).sin() * 0.5, -0.3);
        if b.phase >= 2 && b.defeat.is_none() {
            // Angrier tint, with a pulse in the last stand.
            let k = if b.phase >= 3 { 0.35 + 0.15 * (t * 6.0).sin() } else { 0.22 };
            let red = [1.0, 0.3, 0.3];
            for c in 0..3 {
                l.color[c] += (red[c] - l.color[c]) * k;
            }
            l.glow = if b.phase >= 3 { 0.6 } else { 0.3 };
        }
        if b.laugh > 0.0 {
            l.mood = mood::HAPPY;
            pos.y += (b.laugh * 30.0).sin() * 6.0;
        }
        l.white = (b.hit_flash / 0.1).clamp(0.0, 1.0);
        if b.bonk > 0.0 {
            l.mood = mood::BONK;
            l.squash = b.bonk;
            pos.x += (b.bonk * 40.0).sin() * 10.0 * b.bonk;
        }
        if let Some(d) = b.defeat {
            l.mood = mood::HAPPY;
            pos.y += d * 60.0;
            alpha = (1.0 - (d - 2.0).max(0.0)).clamp(0.0, 1.0);
        }
        l.pos = pos;
        l.alpha = alpha;
        push_monster(w, &l);
        // Hit points are shown by the shell's HP bar.
    }

    // Freed friends floating up.
    for f in &sim.friends {
        let k = f.life / f.max_life;
        let mut l = MonsterLook::new(f.species, f.pos, f.radius);
        l.color = f.color;
        l.color2 = f.color2;
        l.mood = if (k * 10.0) as i32 % 2 == 0 { mood::HAPPY } else { mood::WAVE };
        l.t = t;
        l.age = 1.0 - k;
        l.alpha = (k / 0.3).min(1.0);
        l.rot = if f.spin { (1.0 - k) * 6.283 } else { (t * 6.0).sin() * 0.2 };
        if f.shiny {
            l.flags |= flag::SHINY;
        }
        push_monster(w, &l);
    }

    // Monsters, each followed by its label so overlaps stay correct.
    for m in &sim.monsters {
        let l = monster_look(sim, m);
        if m.state == MState::Popping && m.pop_t < 0.0 {
            // Boss-defeat wave before popping.
            let mut l2 = l;
            l2.mood = mood::WAVE;
            push_monster(w, &l2);
            continue;
        }
        push_monster(w, &l);
        if m.state == MState::Popping {
            continue;
        }
        let r = l.radius;
        if m.state == MState::Revealed {
            // The full fact upright on a dark pill, the answer in gold.
            let font = r * 0.5;
            let tw = g.width(&m.full, font);
            let c = m.pos + v2(0.0, -r * 0.15);
            w.push(&Inst {
                pos: c,
                size: v2(tw * 0.5 + font * 0.35, font * 0.62),
                kind: kind::RRECT,
                color: [0.12, 0.08, 0.25, 0.86],
                p0: [1.0, 0.0, 0.0, 0.0],
                ..Default::default()
            });
            let eq = m.full.as_slice().iter().position(|&x| x == G_EQUALS).map_or(m.full.len as usize, |p| p + 1);
            draw_label_ex(w, g, &m.full, c, font, 0.0, [1.0, 1.0, 1.0, 1.0], OUTLINE, Some((eq, GOLD_TEXT)));
        } else if m.ghost {
            // Ghosted first appearance: "3×4 = 12" with the answer faint.
            let font = r * 0.48;
            let c = m.pos + v2(0.0, -r * 0.22).rotate(m.rot);
            let eq = m.full.as_slice().iter().position(|&x| x == G_EQUALS).map_or(m.full.len as usize, |p| p + 1);
            draw_label_ex(w, g, &m.full, c, font, m.rot, [1.0, 1.0, 1.0, 1.0], OUTLINE, Some((eq, [1.0, 1.0, 1.0, GHOST_ALPHA])));
        } else {
            let em = g.width(&m.label, 1.0).max(0.01);
            let font = (r * 0.8).min(r * 1.5 / em);
            let c = m.pos + v2(0.0, -r * 0.22).rotate(m.rot);
            draw_label(w, g, &m.label, c, font, m.rot, [1.0, 1.0, 1.0, 1.0], OUTLINE);
        }
    }

    // Particles.
    for p in &sim.particles.items {
        let s = p.size();
        if s <= 0.01 {
            continue;
        }
        let fade = if p.kind == kind::RING || p.kind == kind::SOFT || p.kind == kind::STAR {
            1.0 - p.t()
        } else {
            (p.life / 0.25).min(1.0)
        };
        let (rot, size) = if p.stretch > 0.0 {
            let sp = p.vel.len();
            (p.vel.y.atan2(p.vel.x), v2(s * (1.0 + sp * p.stretch), s))
        } else {
            (p.rot, v2(s, s * p.aspect.max(0.05)))
        };
        w.push(&Inst {
            pos: p.pos,
            size,
            rot,
            kind: p.kind,
            additive: p.additive,
            sub: p.sub,
            color: [p.color[0], p.color[1], p.color[2], p.color[3] * fade],
            p0: [if p.kind == kind::RRECT { 0.3 } else { 0.0 }, 0.0, 0.0, 0.0],
            ..Default::default()
        });
    }

    // Flyers: coins, lanterns, boss beams, reforge shards.
    for f in &sim.flyers {
        if f.delay > 0.0 {
            continue;
        }
        let p = f.pos();
        let k = f.k();
        match f.kind {
            FlyKind::Coin => {
                let sc = 1.0 - 0.35 * k;
                let squish = (t * 9.0 + f.rot).cos().abs().max(0.25);
                w.push(&Inst {
                    pos: p,
                    size: v2(f.size * sc * squish, f.size * sc),
                    kind: kind::ICON,
                    sub: icon::COIN,
                    color: f.color,
                    ..Default::default()
                });
            }
            FlyKind::Lantern => {
                w.push(&Inst { pos: p, size: v2(f.size * 2.2, f.size * 2.2), kind: kind::SOFT, additive: true, color: [1.0, 0.7, 0.3, 0.6], ..Default::default() });
                icon_inst(w, icon::LANTERN, p, f.size, (t * 3.0).sin() * 0.15, f.color);
            }
            FlyKind::Beam => {
                let tail = f.from.lerp(p, 0.6);
                let d = p - tail;
                let half = d.len() * 0.5;
                if half > 0.5 {
                    w.push(&Inst {
                        pos: (p + tail) * 0.5,
                        size: v2(half + f.size, f.size),
                        rot: d.y.atan2(d.x),
                        kind: kind::CAPSULE,
                        additive: true,
                        color: f.color,
                        p0: [half, f.size * 0.4, 0.0, 0.0],
                        ..Default::default()
                    });
                }
                w.push(&Inst { pos: p, size: v2(f.size * 1.2, f.size * 1.2), rot: t * 4.0, kind: kind::STAR, additive: true, color: f.color, ..Default::default() });
            }
            FlyKind::Shard => {
                w.push(&Inst {
                    pos: p,
                    size: v2(f.size, f.size * 0.6),
                    rot: f.rot + k * 9.0,
                    kind: kind::SHARD,
                    color: f.color,
                    ..Default::default()
                });
            }
        }
    }

    // Correct-slice flashes.
    for s in &sim.slashes {
        let d = s.b - s.a;
        let half = d.len() * 0.5;
        if half < 0.5 {
            continue;
        }
        let a = (s.life / 0.1).clamp(0.0, 1.0);
        w.push(&Inst {
            pos: (s.a + s.b) * 0.5,
            size: v2(half + s.width * 2.0, s.width * 2.0),
            rot: d.y.atan2(d.x),
            kind: kind::CAPSULE,
            additive: true,
            color: [1.0, 1.0, 1.0, a],
            p0: [half, s.width, 0.0, 0.0],
            ..Default::default()
        });
    }

    // Blade trail: glowing capsules between recent samples.
    let charged = sim.charged.is_some() && sim.blade.broken <= 0.0;
    let skin = TRAILS[sim.trail_skin as usize % TRAILS.len()];
    let width_mul = skin.width * if tier >= 1 { 1.5 } else { 1.0 };
    let base_w = if charged { 13.0 * width_mul } else { 5.0 };
    let trail = &sim.blade.trail;
    for i in 1..trail.len() {
        let (a, b) = (trail[i - 1], trail[i]);
        let age = t - b.time;
        let f = (1.0 - age / TRAIL_LIFE).clamp(0.0, 1.0);
        if f <= 0.0 {
            continue;
        }
        let r = base_w * (0.25 + 0.75 * f) * (0.4 + 0.6 * (i as f32 / trail.len() as f32));
        let d = b.pos - a.pos;
        let half = d.len() * 0.5;
        if half < 0.01 {
            continue;
        }
        let col = if !charged {
            [0.72, 0.74, 0.82, 0.5]
        } else if skin.rainbow || tier >= 4 {
            rgba(hsv(b.dist * 0.0015 + t * 0.3, 0.65, 1.0), 1.0)
        } else if tier >= 1 {
            rgba(tc, 1.0)
        } else {
            rgba(skin.color, 1.0)
        };
        w.push(&Inst {
            pos: (a.pos + b.pos) * 0.5,
            size: v2(half + r * 2.5, r * 2.5),
            rot: d.y.atan2(d.x),
            kind: kind::CAPSULE,
            additive: true,
            color: [col[0], col[1], col[2], col[3] * f],
            p0: [half, r, 0.0, 0.0],
            ..Default::default()
        });
    }

    // The blade, its charged number and the combo counter.
    if sim.blade.has_pos && sim.round != crate::sim::RoundState::Idle {
        let bs = BLADES[sim.blade_skin as usize % BLADES.len()];
        let up = v2(-BLADE_ROT.sin(), BLADE_ROT.cos());
        let tip = sim.blade.pos;
        let bc = tip - up * (BLADE_L * 0.95);
        let hilt = bc - up * (BLADE_L * 0.66);
        if sim.blade.broken <= 0.0 {
            let pulse = 0.5 + 0.5 * (t * 5.0).sin();
            let (glow_amt, glow_col) = if charged {
                (0.6 + 0.25 * pulse + 0.1 * sim.charged.map_or(0.0, |n| if n.abs() >= 100 { 3.0 } else if n.abs() >= 10 { 2.0 } else { 1.0 }), if tier >= 1 { tc } else { bs.color })
            } else {
                (0.15, bs.color)
            };
            let pattern = if tier >= 4 { 2.0 } else { bs.pattern as f32 };
            let (c1, c2) = if tier == 3 { ([0.5, 0.85, 1.0], [0.9, 0.98, 1.0]) } else { (bs.color, bs.color2) };
            w.push(&Inst {
                pos: bc,
                size: v2(BLADE_L * 0.4, BLADE_L),
                rot: BLADE_ROT,
                kind: kind::BLADE,
                sub: bs.family,
                color: rgba(c1, 1.0),
                p0: [pattern, glow_amt, t, 0.0],
                p1: rgba(c2, 1.0),
                p2: rgba(glow_col, 1.0),
                ..Default::default()
            });
        }
        if let Some(n) = sim.charged {
            if sim.blade.broken <= 0.0 {
                let label = Label::from_int(None, n);
                let sc = 1.0 + 0.3 * sim.charge_pop;
                let p = hilt + v2(-48.0, -18.0);
                w.push(&Inst { pos: p, size: v2(70.0 * sc, 70.0 * sc), kind: kind::SOFT, additive: true, color: rgba(if tier >= 1 { tc } else { bs.color }, 0.45), ..Default::default() });
                draw_label(w, g, &label, p, 54.0 * sc, 0.0, [1.0, 1.0, 1.0, 1.0], OUTLINE);
            }
        }
        // Combo counter by the blade (from 3), deflating when broken.
        let show = sim.combo >= crate::tuning::COMBO_COUNTER_FROM;
        if show || sim.combo_break_anim > 0.0 {
            let (n, sc, a) = if show {
                (sim.combo, 1.0 + 0.35 * sim.combo_bump, 1.0)
            } else {
                let k = sim.combo_break_anim / 0.6;
                (sim.combo_was, 0.4 + 0.6 * k + 0.1 * (k * 30.0).sin(), k)
            };
            let mut lb = Label::from_int(None, n as i32);
            lb.push(crate::facts::glyph_for('x').unwrap_or(G_SPACE));
            let p = tip + v2(70.0, 40.0);
            let col = if tier >= 1 { tc } else { [1.0, 1.0, 1.0] };
            draw_label(w, g, &lb, p, 40.0 * sc, 0.12, rgba(col, a), OUTLINE);
        }
        // Guessing guard: thinking cloud above the blade.
        if sim.guard_hint > 0.0 {
            let a = (sim.guard_hint / 0.3).min(1.0);
            let p = tip + v2(0.0, 120.0 + 6.0 * (t * 3.0).sin());
            icon_inst(w, icon::CLOUD, p, 62.0, 0.0, [1.0, 1.0, 1.0, 0.92 * a]);
        }
    }

    // Tutorial hand: "type then swipe" over the first flying monster.
    if sim.tutorial_hint() {
        if let Some(m) = sim.monsters.iter().find(|m| m.state == MState::Flying) {
            let k = (t * 0.8).fract();
            let sweep = v2(-1.0, 0.4).norm() * ((k - 0.5) * m.radius * 2.4);
            let p = m.pos + v2(m.radius * 0.6, -m.radius * 0.9) + sweep;
            let a = (k * 6.0).min(1.0) * ((1.0 - k) * 6.0).min(1.0);
            icon_inst(w, icon::HAND, p, 56.0, 0.3, [1.0, 0.95, 0.88, a]);
        }
    }

    // Score popups.
    for p in &sim.popups {
        let k = p.life / p.max_life;
        let pop = if k > 0.85 { 1.0 + (k - 0.85) * 3.0 } else { 1.0 };
        let a = (k / 0.3).min(1.0);
        draw_label(w, g, &p.label, p.pos, p.size * pop, 0.0, rgba(p.color, a), OUTLINE);
    }

    // Banners slide in from the side.
    for b in &sim.banners {
        let age = b.max_life - b.life;
        let slide = (age / 0.18).min(1.0);
        let ease = 1.0 - (1.0 - slide).powi(3);
        let out = (b.life / 0.25).min(1.0);
        let x = vw * 0.5 + (1.0 - ease) * vw * 0.6 - (1.0 - out) * vw * 0.1;
        let font = 120.0 * b.size * (1.0 + 0.08 * (1.0 - slide));
        draw_label(w, g, &b.label, v2(x, vh * b.y), font, -0.04, rgba(b.color, out), OUTLINE);
    }

    // Special intro card (game frozen for INTRO_S).
    if let Some(intro) = &sim.intro {
        let k = intro.t / INTRO_S;
        let a = (intro.t / 0.2).min(1.0) * ((INTRO_S - intro.t) / 0.25).clamp(0.0, 1.0);
        w.push(&Inst { pos: center, size: full, kind: kind::SOLID, color: [0.05, 0.03, 0.14, 0.55 * a], ..Default::default() });
        let cw = (vw * 0.42).min(520.0);
        let ch = cw * 1.05;
        let cpos = center + v2(0.0, (1.0 - (intro.t / 0.25).min(1.0)) * -80.0);
        w.push(&Inst {
            pos: cpos,
            size: v2(cw * 0.5, ch * 0.5),
            kind: kind::RRECT,
            color: [0.98, 0.95, 1.0, a],
            p0: [0.18, 6.0, 0.0, 0.0],
            p1: [0.55, 0.42, 0.9, 1.0],
            ..Default::default()
        });
        let r = cw * 0.22;
        let mut l = MonsterLook::new(intro.species, cpos + v2(0.0, ch * 0.1), r);
        l.mood = mood::HAPPY;
        l.t = t;
        l.age = k;
        l.alpha = a;
        l.rot = (t * 3.0).sin() * 0.08;
        if intro.special == Special::Armored {
            l.flags |= flag::SHELL;
        }
        if intro.special == Special::Freeze {
            l.flags |= flag::ICE;
        }
        if intro.special == Special::Golden {
            l.flags |= flag::GOLD;
        }
        push_monster(w, &l);
        draw_label(w, g, &intro.name, cpos + v2(0.0, -ch * 0.22), cw * 0.13, 0.0, [0.35, 0.2, 0.7, a], [1.0, 1.0, 1.0]);
        draw_label(w, g, &intro.line, cpos + v2(0.0, -ch * 0.36), (cw * 0.07).min(cw * 0.95 / g.width(&intro.line, 1.0).max(0.01)), 0.0, [0.25, 0.2, 0.4, a], [1.0, 1.0, 1.0]);
    }

    // Soft purple vignette on a wrong (never red).
    if sim.vignette > 0.004 {
        w.push(&Inst { pos: center, size: full, kind: kind::SOLID, color: [0.45, 0.2, 0.7, 0.55 * sim.vignette], p0: [1.0, 0.0, 0.0, 0.0], ..Default::default() });
    }

    // Screen flash.
    if sim.flash[3] > 0.004 {
        w.push(&Inst { pos: center, size: full, kind: kind::SOLID, color: sim.flash, ..Default::default() });
    }
}

/// Options for `build_portrait`.
#[derive(Clone, Copy, Debug)]
pub struct PortraitOpts {
    pub species: SpeciesRef,
    pub shiny: bool,
    pub silhouette: bool,
    pub mood: u8,
    pub time: f32,
}

/// A single monster centred in a `size × size` world, for Monster Book cards.
pub fn build_portrait(o: &PortraitOpts, size: f32, w: &mut InstanceWriter) {
    w.clear();
    let r = size * 0.5 / MONSTER_QUAD * 0.92;
    let mut l = MonsterLook::new(o.species, v2(size * 0.5, size * 0.5 - r * 0.05), r);
    l.mood = o.mood;
    l.t = o.time;
    if o.shiny {
        l.flags |= flag::SHINY;
    }
    if o.silhouette {
        l.flags |= flag::SILHOUETTE;
    }
    match o.species.idx {
        SP_CHILLBY => l.flags |= flag::ICE,
        SP_CLONKSHELL => l.flags |= flag::SHELL,
        24 => l.flags |= flag::GOLD,
        _ => {}
    }
    push_monster(w, &l);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::RoundConfig;
    use crate::sim::STEP;
    use crate::species::SPECIES;

    const CFG: &str = r#"{"seed":3,"speed":{"x":3},"deck":[
        {"a":3,"b":4,"kind":"focus","species":"bloop"},
        {"a":2,"b":2,"kind":"new","ghost":true},
        {"a":5,"b":4,"kind":"focus","special":"armored"},
        {"a":6,"b":4,"kind":"focus"},
        {"a":7,"b":4,"kind":"focus"}]}"#;

    #[test]
    fn builds_instances_without_growing() {
        let mut s = Sim::new(1);
        s.set_view(1600.0, 1000.0);
        s.start_round(RoundConfig::from_json_str(CFG).unwrap());
        s.set_charged(Some(12));
        let g = GlyphTable::monospace();
        let mut w = InstanceWriter::new();
        let cap = w.data.capacity();
        s.pointer_down(v2(100.0, 100.0));
        for i in 0..2400 {
            s.pointer_move(v2(100.0 + (i % 200) as f32 * 7.0, 300.0 + (i as f32 * 0.1).sin() * 200.0));
            s.step(STEP);
            build(&s, &g, &mut w);
            assert_eq!(w.data.len(), w.count * FLOATS_PER_INSTANCE);
        }
        assert!(w.count > 1);
        assert_eq!(w.data.capacity(), cap);
    }

    #[test]
    fn portrait_is_one_monster_per_species() {
        let mut w = InstanceWriter::new();
        for (i, _) in SPECIES.iter().enumerate() {
            let o = PortraitOpts { species: SpeciesRef { idx: i as u8, grand: false }, shiny: false, silhouette: true, mood: mood::HAPPY, time: 0.0 };
            build_portrait(&o, 256.0, &mut w);
            assert_eq!(w.count, 1);
            assert_eq!(w.data[5], kind::MONSTER as f32);
            assert_eq!(w.data[12], i as f32, "shape id = species index");
            assert_eq!(w.data[17] as u32 & flag::SILHOUETTE, flag::SILHOUETTE);
        }
        assert_eq!(mood::by_name("sleepy"), Some(mood::SLEEPY));
    }
}
