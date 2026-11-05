//! High-throughput particle pool. Fixed capacity, no allocation after creation,
//! dead particles are swap-removed.

use crate::vec2::{v2, Vec2};

/// Render kinds shared by the instance writer and the fragment shader.
pub mod kind {
    pub const SOLID: u8 = 0;
    pub const SOFT: u8 = 1;
    pub const GLYPH: u8 = 2;
    pub const STAR: u8 = 3;
    pub const CAPSULE: u8 = 4;
    pub const MONSTER: u8 = 5;
    pub const SHARD: u8 = 6;
    pub const BG: u8 = 7;
    pub const RING: u8 = 8;
    pub const DISC: u8 = 9;
    pub const RRECT: u8 = 10;
    /// Small icon from `species::icon` (id in `Particle::sub`).
    pub const ICON: u8 = 11;
    pub const BLADE: u8 = 12;
}

#[derive(Clone, Copy, Debug)]
pub struct Particle {
    pub pos: Vec2,
    pub vel: Vec2,
    pub gravity: f32,
    /// Fraction of velocity lost per second.
    pub drag: f32,
    pub life: f32,
    pub max_life: f32,
    pub size0: f32,
    pub size1: f32,
    /// Width / height ratio of the quad (confetti, shards).
    pub aspect: f32,
    pub rot: f32,
    pub spin: f32,
    pub color: [f32; 4],
    pub kind: u8,
    pub additive: bool,
    /// >0: quad aligns with velocity and stretches with speed (sparks).
    pub stretch: f32,
    /// Icon id for `kind::ICON`.
    pub sub: u8,
}

impl Default for Particle {
    fn default() -> Self {
        Particle {
            pos: v2(0.0, 0.0),
            vel: v2(0.0, 0.0),
            gravity: 0.0,
            drag: 0.0,
            life: 1.0,
            max_life: 1.0,
            size0: 10.0,
            size1: 0.0,
            aspect: 1.0,
            rot: 0.0,
            spin: 0.0,
            color: [1.0; 4],
            kind: kind::SOFT,
            additive: true,
            stretch: 0.0,
            sub: 0,
        }
    }
}

impl Particle {
    /// 0 at birth → 1 at death.
    pub fn t(&self) -> f32 {
        1.0 - (self.life / self.max_life).clamp(0.0, 1.0)
    }
    pub fn size(&self) -> f32 {
        let t = self.t();
        self.size0 + (self.size1 - self.size0) * t
    }
}

pub struct Particles {
    pub items: Vec<Particle>,
    cap: usize,
}

impl Particles {
    pub fn with_capacity(cap: usize) -> Self {
        Particles { items: Vec::with_capacity(cap), cap }
    }

    pub fn capacity(&self) -> usize {
        self.cap
    }

    #[inline]
    pub fn spawn(&mut self, p: Particle) {
        if self.items.len() < self.cap {
            self.items.push(p);
        }
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }

    pub fn update(&mut self, dt: f32) {
        let mut i = 0;
        while i < self.items.len() {
            let p = &mut self.items[i];
            p.life -= dt;
            if p.life <= 0.0 {
                self.items.swap_remove(i);
                continue;
            }
            p.vel.y -= p.gravity * dt;
            if p.drag > 0.0 {
                let k = (1.0 - p.drag * dt).max(0.0);
                p.vel = p.vel * k;
            }
            p.pos += p.vel * dt;
            p.rot += p.spin * dt;
            i += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capacity_and_expiry() {
        let mut ps = Particles::with_capacity(100);
        for _ in 0..150 {
            ps.spawn(Particle { life: 0.5, max_life: 0.5, ..Default::default() });
        }
        assert_eq!(ps.items.len(), 100);
        let cap_before = ps.items.capacity();
        ps.update(0.3);
        assert_eq!(ps.items.len(), 100);
        ps.update(0.3);
        assert_eq!(ps.items.len(), 0);
        assert_eq!(ps.items.capacity(), cap_before);
    }
}
