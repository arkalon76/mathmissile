//! Juice (DESIGN §7): particles, freed faces, coins and lanterns flying to the
//! HUD, banners, popups, slashes, shards, ambient event effects. Every count
//! goes through `Sim::n` (effects scale and calm mode); every pool is capped.

use crate::config::{EventKind, RoundType};
use crate::facts::{Label, G_PLUS};
use crate::particles::{kind, Particle};
use crate::sim::{FlyKind, Flyer, Friend, Monster, Popup, Sim, Slash};
use crate::species::{icon, Rgb, TrailFx, BLADES, TRAILS};
use crate::tuning::*;
use crate::vec2::{v2, Vec2};

pub const CONFETTI: [Rgb; 6] = [
    [1.0, 0.42, 0.42],
    [1.0, 0.82, 0.3],
    [0.45, 0.9, 0.5],
    [0.35, 0.75, 1.0],
    [0.75, 0.5, 1.0],
    [1.0, 0.55, 0.85],
];

/// Blade glow per combo tier (§4.1): none, orange (Hot/Blazing), blue (Super),
/// rainbow (Mega).
pub fn tier_color(tier: u32, time: f32) -> Rgb {
    match tier {
        0 => [1.0, 1.0, 1.0],
        1 => [1.0, 0.62, 0.2],
        2 => [1.0, 0.48, 0.12],
        3 => [0.4, 0.7, 1.0],
        _ => hsv(time * 0.6, 0.7, 1.0),
    }
}

pub fn hsv(h: f32, s: f32, v: f32) -> Rgb {
    let h = h.rem_euclid(1.0) * 6.0;
    let f = |n: f32| {
        let k = (n + h).rem_euclid(6.0);
        v - v * s * (k.min(4.0 - k).clamp(0.0, 1.0))
    };
    [f(5.0), f(3.0), f(1.0)]
}

fn rgba(c: Rgb, a: f32) -> [f32; 4] {
    [c[0], c[1], c[2], a]
}

impl Sim {
    pub(crate) fn update_fx(&mut self, dt: f32) {
        self.particles.update(dt);
        let mut i = 0;
        while i < self.friends.len() {
            let f = &mut self.friends[i];
            f.life -= dt;
            if f.life <= 0.0 {
                self.friends.swap_remove(i);
                continue;
            }
            f.vel.y += 60.0 * dt;
            f.pos += f.vel * dt;
            i += 1;
        }
        let mut i = 0;
        while i < self.flyers.len() {
            let f = &mut self.flyers[i];
            if f.delay > 0.0 {
                f.delay -= dt;
                i += 1;
                continue;
            }
            f.t += dt;
            f.rot += dt * 6.0;
            if f.t >= f.dur {
                let f = self.flyers.swap_remove(i);
                if matches!(f.kind, FlyKind::Coin | FlyKind::Lantern) {
                    let n = self.n(4);
                    for _ in 0..n {
                        let a = self.fx.range(0.0, 6.283);
                        self.particles.spawn(Particle {
                            pos: f.to,
                            vel: Vec2::from_angle(a) * self.fx.range(60.0, 160.0),
                            life: 0.3,
                            max_life: 0.3,
                            size0: 14.0,
                            size1: 0.0,
                            kind: kind::STAR,
                            color: [1.0, 0.95, 0.6, 1.0],
                            ..Default::default()
                        });
                    }
                }
                continue;
            }
            i += 1;
        }
        self.banners.retain_mut(|b| {
            b.life -= dt;
            b.life > 0.0
        });
        self.popups.retain_mut(|p| {
            p.life -= dt;
            p.pos += p.vel * dt;
            p.vel = p.vel * (1.0 - 3.0 * dt).max(0.0);
            p.life > 0.0
        });
        self.slashes.retain_mut(|s| {
            s.life -= dt;
            s.life > 0.0
        });
        self.ambient_fx(dt);
    }

    /// Event-round ambience (§6.4): bubbles, fireflies, confetti sky.
    fn ambient_fx(&mut self, dt: f32) {
        // 0 bubbles, 1 fireflies, 2 mixup confetti.
        let which = match (self.cfg.event, self.cfg.round_type) {
            (Some(EventKind::BubbleBreeze), _) => 0,
            (Some(EventKind::NightGlow), _) => 1,
            (_, RoundType::Mixup) => 2,
            _ => return,
        };
        self.ambient_t += dt;
        let every = [0.35, 0.25, 0.3][which];
        if self.ambient_t < every {
            return;
        }
        self.ambient_t = 0.0;
        if self.n(1) == 0 {
            return;
        }
        let (w, h) = (self.view.x, self.view.y);
        let x = self.fx.range(0.0, w);
        let p = match which {
            0 => Particle {
                pos: v2(x, -30.0),
                vel: v2(self.fx.range(-20.0, 20.0), self.fx.range(60.0, 120.0)),
                life: 9.0,
                max_life: 9.0,
                size0: self.fx.range(16.0, 40.0),
                size1: self.fx.range(30.0, 50.0),
                kind: kind::ICON,
                sub: icon::BUBBLE,
                additive: false,
                color: [0.8, 0.95, 1.0, 0.45],
                ..Default::default()
            },
            1 => Particle {
                pos: v2(x, self.fx.range(0.1, 0.9) * h),
                vel: v2(self.fx.range(-25.0, 25.0), self.fx.range(-15.0, 15.0)),
                life: 3.5,
                max_life: 3.5,
                size0: 26.0,
                size1: 6.0,
                kind: kind::SOFT,
                color: [0.85, 1.0, 0.45, 0.8],
                ..Default::default()
            },
            _ => {
                let c = CONFETTI[self.fx.below(6) as usize];
                Particle {
                    pos: v2(x, h + 20.0),
                    vel: v2(self.fx.range(-30.0, 30.0), -self.fx.range(50.0, 90.0)),
                    life: 12.0,
                    max_life: 12.0,
                    size0: 12.0,
                    size1: 12.0,
                    aspect: 0.5,
                    spin: self.fx.range(-4.0, 4.0),
                    kind: kind::RRECT,
                    additive: false,
                    color: rgba(c, 0.55),
                    ..Default::default()
                }
            }
        };
        self.particles.spawn(p);
    }

    fn ring(&mut self, pos: Vec2, s0: f32, s1: f32, life: f32, color: [f32; 4]) {
        self.particles.spawn(Particle { pos, life, max_life: life, size0: s0, size1: s1, kind: kind::RING, color, ..Default::default() });
    }

    fn burst(&mut self, pos: Vec2, n: u32, kind_: u8, speed: (f32, f32), size: f32, life: f32, color: [f32; 4], gravity: f32) {
        for _ in 0..self.n(n) {
            let a = self.fx.range(0.0, 6.283);
            let l = life * self.fx.range(0.7, 1.2);
            self.particles.spawn(Particle {
                pos,
                vel: Vec2::from_angle(a) * self.fx.range(speed.0, speed.1),
                gravity,
                drag: 1.5,
                life: l,
                max_life: l,
                size0: size,
                size1: 0.0,
                rot: a,
                kind: kind_,
                color,
                ..Default::default()
            });
        }
    }

    pub(crate) fn launch_fx(&mut self, p0: Vec2, minion: bool) {
        let p = v2(p0.x, p0.y.max(0.0) + 10.0);
        let c = if minion { [0.85, 0.6, 1.0, 0.8] } else { [1.0, 1.0, 1.0, 0.6] };
        self.burst(p, 8, kind::SOFT, (80.0, 200.0), 22.0, 0.4, c, -300.0);
    }

    pub(crate) fn golden_sparkle_fx(&mut self, pos: Vec2, r: f32) {
        if self.fx.f32() > 0.25 || self.n(1) == 0 {
            return;
        }
        let off = Vec2::from_angle(self.fx.range(0.0, 6.283)) * (r * self.fx.range(0.5, 1.1));
        self.particles.spawn(Particle {
            pos: pos + off,
            vel: v2(0.0, -30.0),
            life: 0.6,
            max_life: 0.6,
            size0: 18.0,
            size1: 0.0,
            kind: kind::STAR,
            color: [1.0, 0.9, 0.4, 1.0],
            ..Default::default()
        });
    }

    /// Correct pop: confetti, stars, a ring and the freed happy face.
    pub(crate) fn pop_fx(&mut self, m: &Monster) {
        let r = m.radius;
        let pos = m.pos;
        for _ in 0..self.n(POP_CONFETTI) {
            let c = CONFETTI[self.fx.below(6) as usize];
            let a = self.fx.range(0.0, 6.283);
            let l = self.fx.range(0.8, 1.4);
            self.particles.spawn(Particle {
                pos,
                vel: Vec2::from_angle(a) * self.fx.range(250.0, 650.0) + v2(0.0, 150.0),
                gravity: 900.0,
                drag: 1.2,
                life: l,
                max_life: l,
                size0: r * 0.16,
                size1: r * 0.12,
                aspect: 0.5,
                rot: a,
                spin: self.fx.range(-10.0, 10.0),
                kind: kind::RRECT,
                additive: false,
                color: rgba(c, 1.0),
                ..Default::default()
            });
        }
        let star = if m.golden { [1.0, 0.85, 0.3, 1.0] } else { [1.0, 0.97, 0.75, 1.0] };
        self.burst(pos, POP_STARS, kind::STAR, (200.0, 420.0), r * 0.3, 0.6, star, 0.0);
        self.burst(pos, 12, kind::DISC, (150.0, 420.0), r * 0.14, 0.5, rgba(m.color, 1.0), 700.0);
        self.ring(pos, r * 0.6, r * 2.0, 0.35, rgba(m.color, 0.9));
        if m.bubble {
            self.ring(pos, r * 0.9, r * 1.5, 0.25, [0.85, 0.97, 1.0, 0.9]);
        }
        if self.cfg.event == Some(EventKind::StickerStorm) {
            for _ in 0..self.n(3) {
                let a = self.fx.range(0.0, 6.283);
                self.particles.spawn(Particle {
                    pos,
                    vel: Vec2::from_angle(a) * self.fx.range(150.0, 350.0),
                    gravity: 500.0,
                    life: 1.3,
                    max_life: 1.3,
                    size0: r * 0.4,
                    size1: r * 0.3,
                    spin: self.fx.range(-3.0, 3.0),
                    kind: kind::ICON,
                    sub: icon::STICKER,
                    additive: false,
                    color: rgba(CONFETTI[self.fx.below(6) as usize], 1.0),
                    ..Default::default()
                });
            }
        }
        if self.friends.len() < self.friends.capacity() {
            self.friends.push(Friend {
                pos,
                vel: v2(self.fx.range(-40.0, 40.0), 160.0),
                life: 1.1,
                max_life: 1.1,
                species: m.species,
                color: m.color,
                color2: m.color2,
                radius: r * 0.75,
                shiny: m.slot.shiny,
                spin: m.tricky_cleared,
            });
        }
    }

    pub(crate) fn firework_fx(&mut self, p: Vec2) {
        let c = CONFETTI[self.fx.below(6) as usize];
        self.burst(p, 36, kind::SOFT, (250.0, 520.0), 20.0, 1.0, rgba(c, 1.0), 250.0);
        self.burst(p, 10, kind::STAR, (100.0, 300.0), 26.0, 0.9, [1.0, 1.0, 0.8, 1.0], 120.0);
        self.ring(p, 30.0, 260.0, 0.5, rgba(c, 0.8));
        self.sfx("sfx_pop_confetti");
    }

    pub(crate) fn slash_fx(&mut self, contact: Vec2, dir: Vec2, r: f32) {
        let d = if dir.len() > 0.0 { dir } else { v2(1.0, 0.0) };
        if self.slashes.len() < self.slashes.capacity() {
            self.slashes.push(Slash { a: contact - d * (r * 1.4), b: contact + d * (r * 1.4), life: 0.1, width: r * 0.12 });
        }
        let c = tier_color(self.tier, self.time);
        for _ in 0..self.n(14) {
            let a = d.y.atan2(d.x) + self.fx.range(-0.6, 0.6);
            self.particles.spawn(Particle {
                pos: contact,
                vel: Vec2::from_angle(a) * self.fx.range(400.0, 900.0),
                drag: 4.0,
                life: 0.25,
                max_life: 0.25,
                size0: 10.0,
                size1: 0.0,
                kind: kind::SOFT,
                stretch: 0.02,
                color: rgba(c, 1.0),
                ..Default::default()
            });
        }
    }

    pub(crate) fn popup(&mut self, pos: Vec2, points: u32) {
        if self.popups.len() >= self.popups.capacity() {
            self.popups.remove(0);
        }
        let size = if points >= 300 { 1.3 } else { 1.0 };
        self.popups.push(Popup {
            pos: pos + v2(0.0, 40.0),
            vel: v2(0.0, 220.0),
            life: 0.9,
            max_life: 0.9,
            label: Label::from_int(Some(G_PLUS), points as i32),
            color: if points >= 300 { [1.0, 0.85, 0.3] } else { [1.0, 1.0, 1.0] },
            size,
        });
    }

    fn fly(&mut self, kind_: FlyKind, from: Vec2, to: Vec2, delay: f32, dur: f32, size: f32, color: [f32; 4]) {
        if self.flyers.len() >= self.flyers.capacity() {
            return;
        }
        let bend = self.fx.range(-0.25, 0.25) * (to - from).len();
        let rot = self.fx.range(0.0, 6.283);
        self.flyers.push(Flyer { kind: kind_, from, to, bend, delay, t: 0.0, dur, size, color, rot });
    }

    /// Coins (Sparks) fly to the sparks counter.
    pub(crate) fn coins(&mut self, pos: Vec2, n: u32) {
        let to = self.anchor(true);
        for k in 0..n.min(self.n(n).max(1)) {
            let from = pos + v2(self.fx.range(-30.0, 30.0), self.fx.range(-30.0, 30.0));
            let dur = self.fx.range(0.55, 0.8);
            self.fly(FlyKind::Coin, from, to, 0.05 * k as f32, dur, 30.0, [1.0, 0.85, 0.3, 1.0]);
        }
    }

    pub(crate) fn coin_shower(&mut self, pos: Vec2) {
        let to = self.anchor(true);
        for k in 0..self.n(10).max(8) {
            let from = pos + Vec2::from_angle(self.fx.range(0.0, 6.283)) * self.fx.range(20.0, 90.0);
            let dur = self.fx.range(0.7, 1.1);
            self.fly(FlyKind::Coin, from, to, 0.04 * k as f32, dur, 34.0, [1.0, 0.85, 0.3, 1.0]);
        }
        self.burst(pos, 20, kind::STAR, (200.0, 500.0), 24.0, 0.8, [1.0, 0.85, 0.3, 1.0], 300.0);
    }

    /// Lantern (a new fact learnt) floats to the island.
    pub(crate) fn lantern(&mut self, pos: Vec2) {
        let to = self.anchor(false);
        self.fly(FlyKind::Lantern, pos, to, 0.15, 1.2, 46.0, [1.0, 0.75, 0.35, 1.0]);
        self.sfx("sfx_lantern_light");
    }

    pub(crate) fn crack_fx(&mut self, m: &Monster) {
        let r = m.radius;
        self.burst(m.pos, 14, kind::SHARD, (250.0, 550.0), r * 0.18, 0.7, rgba(m.color2, 1.0), 900.0);
        self.ring(m.pos, r * 0.8, r * 1.6, 0.25, [1.0, 1.0, 1.0, 0.8]);
    }

    pub(crate) fn freeze_fx(&mut self, pos: Vec2) {
        for _ in 0..self.n(16) {
            let a = self.fx.range(0.0, 6.283);
            self.particles.spawn(Particle {
                pos,
                vel: Vec2::from_angle(a) * self.fx.range(200.0, 600.0),
                drag: 1.5,
                life: 1.0,
                max_life: 1.0,
                size0: 34.0,
                size1: 10.0,
                spin: self.fx.range(-3.0, 3.0),
                kind: kind::ICON,
                sub: icon::SNOWFLAKE,
                additive: false,
                color: [0.85, 0.97, 1.0, 1.0],
                ..Default::default()
            });
        }
        let big = self.view.x.max(self.view.y);
        self.ring(pos, 40.0, big, 0.6, [0.7, 0.92, 1.0, 0.6]);
        self.try_flash([0.7, 0.9, 1.0, 0.25]);
    }

    /// Shards spiral back to the blade over the last moments of the reforge.
    pub(crate) fn reforge_fx(&mut self) {
        let to = self.blade.pos;
        let c = BLADES[self.blade_skin as usize].shard;
        let at = self.blade.broke_at;
        for k in 0..self.n(10).max(4) {
            let from = at + Vec2::from_angle(self.fx.range(0.0, 6.283)) * self.fx.range(80.0, 220.0);
            self.fly(FlyKind::Shard, from, to, 0.02 * k as f32, 0.38, 18.0, rgba(c, 1.0));
        }
    }

    pub(crate) fn blade_ready_fx(&mut self) {
        let c = BLADES[self.blade_skin as usize].color;
        let p = self.blade.pos;
        self.ring(p, 20.0, 140.0, 0.3, rgba(c, 0.9));
        self.burst(p, 8, kind::STAR, (120.0, 260.0), 18.0, 0.4, rgba(c, 1.0), 0.0);
    }

    /// The blade shatters on a wrong: shards in the skin's colour, a crack
    /// icon, a red-purple vignette and (not in calm) a soft flash.
    pub(crate) fn shatter_fx(&mut self, contact: Vec2, dir: Vec2) {
        let skin = BLADES[self.blade_skin as usize];
        let n = 18 + self.fx.below(7);
        for _ in 0..self.n(n) {
            let a = dir.y.atan2(dir.x) + self.fx.range(-1.6, 1.6);
            let l = self.fx.range(0.6, 1.0);
            let c = if self.fx.f32() < 0.6 { skin.shard } else { skin.color };
            self.particles.spawn(Particle {
                pos: contact,
                vel: Vec2::from_angle(a) * self.fx.range(250.0, 750.0),
                gravity: 1200.0,
                drag: 0.8,
                life: l,
                max_life: l,
                size0: self.fx.range(14.0, 30.0),
                size1: 4.0,
                aspect: 0.45,
                rot: a,
                spin: self.fx.range(-14.0, 14.0),
                kind: kind::SHARD,
                additive: false,
                color: rgba(c, 1.0),
                ..Default::default()
            });
        }
        self.burst(contact, 12, kind::SOFT, (300.0, 700.0), 12.0, 0.3, [0.85, 0.5, 1.0, 1.0], 0.0);
        self.particles.spawn(Particle {
            pos: contact,
            life: 0.5,
            max_life: 0.5,
            size0: 90.0,
            size1: 110.0,
            kind: kind::ICON,
            sub: icon::CRACK,
            additive: false,
            color: [1.0, 1.0, 1.0, 0.9],
            ..Default::default()
        });
        self.ring(contact, 30.0, 220.0, 0.3, [0.8, 0.45, 1.0, 0.8]);
        self.vignette = 1.0;
        self.try_flash([0.6, 0.3, 0.9, 0.18]);
    }

    /// Soft puff where a monster leaves the screen.
    pub(crate) fn escape_fx(&mut self, m: &Monster) {
        let (w, h) = (self.view.x, self.view.y);
        let p = v2(m.pos.x.clamp(10.0, w - 10.0), m.pos.y.clamp(10.0, h - 10.0));
        self.burst(p, 8, kind::SOFT, (60.0, 160.0), 30.0, 0.5, [0.85, 0.85, 0.95, 0.4], -100.0);
    }

    pub(crate) fn beam(&mut self, from: Vec2, to: Vec2) {
        self.fly(FlyKind::Beam, from, to, 0.0, BOSS_BEAM_S, 40.0, [1.0, 0.9, 0.5, 1.0]);
    }

    /// Ribbon extras along the stroke, per trail skin, plus combo embers.
    pub(crate) fn trail_fx(&mut self, prev: Vec2, p: Vec2, seg_len: f32) {
        self.blade.fx_dist += seg_len;
        let skin = TRAILS[self.trail_skin as usize];
        let every: f32 = match skin.fx {
            TrailFx::None => 1e9,
            TrailFx::Icon(_) => 70.0,
            _ => 40.0,
        };
        let embers = self.tier >= 1;
        let step = every.min(if embers { 45.0 } else { 1e9 });
        while self.blade.fx_dist >= step {
            self.blade.fx_dist -= step;
            if self.n(1) == 0 {
                continue;
            }
            let k = self.fx.f32();
            let at = prev.lerp(p, k);
            let jitter = v2(self.fx.range(-40.0, 40.0), self.fx.range(-40.0, 40.0));
            let c = if skin.rainbow { hsv(self.time * 0.8 + k, 0.6, 1.0) } else { skin.color };
            let part = match skin.fx {
                TrailFx::None => None,
                TrailFx::Sparkle => Some(Particle {
                    pos: at,
                    vel: jitter,
                    life: 0.4,
                    max_life: 0.4,
                    size0: 18.0,
                    size1: 0.0,
                    kind: kind::STAR,
                    color: rgba(c, 1.0),
                    ..Default::default()
                }),
                TrailFx::Icon(id) => Some(Particle {
                    pos: at,
                    vel: jitter + v2(0.0, if id == icon::BUBBLE { 60.0 } else { -60.0 }),
                    gravity: if id == icon::LEAF || id == icon::SNOWFLAKE { 80.0 } else { 0.0 },
                    life: 0.8,
                    max_life: 0.8,
                    size0: 28.0,
                    size1: 14.0,
                    spin: self.fx.range(-2.0, 2.0),
                    kind: kind::ICON,
                    sub: id,
                    additive: false,
                    color: rgba(c, 1.0),
                    ..Default::default()
                }),
                TrailFx::Confetti => Some(Particle {
                    pos: at,
                    vel: jitter,
                    gravity: 500.0,
                    life: 0.7,
                    max_life: 0.7,
                    size0: 12.0,
                    size1: 10.0,
                    aspect: 0.5,
                    spin: self.fx.range(-8.0, 8.0),
                    kind: kind::RRECT,
                    additive: false,
                    color: rgba(CONFETTI[self.fx.below(6) as usize], 1.0),
                    ..Default::default()
                }),
                TrailFx::Embers => Some(Particle {
                    pos: at,
                    vel: jitter * 0.5 + v2(0.0, 60.0),
                    life: 0.5,
                    max_life: 0.5,
                    size0: 20.0,
                    size1: 0.0,
                    kind: kind::SOFT,
                    color: [1.0, 0.6, 0.2, 1.0],
                    ..Default::default()
                }),
                TrailFx::Motes => Some(Particle {
                    pos: at,
                    vel: jitter * 0.3 + v2(0.0, 30.0),
                    life: 0.9,
                    max_life: 0.9,
                    size0: 14.0,
                    size1: 0.0,
                    kind: kind::SOFT,
                    color: rgba(c, 0.9),
                    ..Default::default()
                }),
            };
            if let Some(pp) = part {
                self.particles.spawn(pp);
            }
            if embers {
                let tc = tier_color(self.tier, self.time);
                self.particles.spawn(Particle {
                    pos: at,
                    vel: jitter * 0.6 + v2(0.0, 40.0),
                    life: 0.35,
                    max_life: 0.35,
                    size0: 16.0,
                    size1: 0.0,
                    kind: kind::SOFT,
                    color: rgba(tc, 1.0),
                    ..Default::default()
                });
            }
        }
    }
}
