//! 2D vector math and swipe-vs-monster collision.

use std::ops::{Add, AddAssign, Mul, Neg, Sub};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

pub const fn v2(x: f32, y: f32) -> Vec2 {
    Vec2 { x, y }
}

impl Vec2 {
    pub fn dot(self, o: Vec2) -> f32 {
        self.x * o.x + self.y * o.y
    }
    pub fn len_sq(self) -> f32 {
        self.dot(self)
    }
    pub fn len(self) -> f32 {
        self.len_sq().sqrt()
    }
    pub fn norm(self) -> Vec2 {
        let l = self.len();
        if l > 1e-6 {
            v2(self.x / l, self.y / l)
        } else {
            v2(0.0, 0.0)
        }
    }
    pub fn perp(self) -> Vec2 {
        v2(-self.y, self.x)
    }
    pub fn rotate(self, a: f32) -> Vec2 {
        let (s, c) = a.sin_cos();
        v2(self.x * c - self.y * s, self.x * s + self.y * c)
    }
    pub fn from_angle(a: f32) -> Vec2 {
        let (s, c) = a.sin_cos();
        v2(c, s)
    }
    pub fn lerp(self, o: Vec2, t: f32) -> Vec2 {
        self + (o - self) * t
    }
}

impl Add for Vec2 {
    type Output = Vec2;
    fn add(self, o: Vec2) -> Vec2 {
        v2(self.x + o.x, self.y + o.y)
    }
}
impl AddAssign for Vec2 {
    fn add_assign(&mut self, o: Vec2) {
        self.x += o.x;
        self.y += o.y;
    }
}
impl Sub for Vec2 {
    type Output = Vec2;
    fn sub(self, o: Vec2) -> Vec2 {
        v2(self.x - o.x, self.y - o.y)
    }
}
impl Mul<f32> for Vec2 {
    type Output = Vec2;
    fn mul(self, s: f32) -> Vec2 {
        v2(self.x * s, self.y * s)
    }
}
impl Neg for Vec2 {
    type Output = Vec2;
    fn neg(self) -> Vec2 {
        v2(-self.x, -self.y)
    }
}

/// If segment a→b passes within `r` of `c`, returns the parameter t in [0,1]
/// of the closest point on the segment (used to pick the first monster hit).
pub fn segment_hits_circle(a: Vec2, b: Vec2, c: Vec2, r: f32) -> Option<f32> {
    let ab = b - a;
    let l2 = ab.len_sq();
    let t = if l2 < 1e-9 { 0.0 } else { ((c - a).dot(ab) / l2).clamp(0.0, 1.0) };
    let p = a + ab * t;
    if (c - p).len_sq() <= r * r {
        Some(t)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_through_circle_hits() {
        assert!(segment_hits_circle(v2(-10.0, 0.0), v2(10.0, 0.0), v2(0.0, 0.0), 1.0).is_some());
        // passes just inside the edge
        assert!(segment_hits_circle(v2(-10.0, 0.9), v2(10.0, 0.9), v2(0.0, 0.0), 1.0).is_some());
    }

    #[test]
    fn segment_missing_circle() {
        assert!(segment_hits_circle(v2(-10.0, 1.5), v2(10.0, 1.5), v2(0.0, 0.0), 1.0).is_none());
        // stops short of the circle
        assert!(segment_hits_circle(v2(-10.0, 0.0), v2(-2.0, 0.0), v2(0.0, 0.0), 1.0).is_none());
    }

    #[test]
    fn segment_ending_inside_and_degenerate() {
        assert!(segment_hits_circle(v2(-10.0, 0.0), v2(-0.5, 0.0), v2(0.0, 0.0), 1.0).is_some());
        assert!(segment_hits_circle(v2(0.2, 0.2), v2(0.2, 0.2), v2(0.0, 0.0), 1.0).is_some());
        assert!(segment_hits_circle(v2(3.0, 3.0), v2(3.0, 3.0), v2(0.0, 0.0), 1.0).is_none());
    }

    #[test]
    fn closest_t_orders_hits() {
        let a = v2(0.0, 0.0);
        let b = v2(10.0, 0.0);
        let t1 = segment_hits_circle(a, b, v2(2.0, 0.0), 1.0).unwrap();
        let t2 = segment_hits_circle(a, b, v2(8.0, 0.0), 1.0).unwrap();
        assert!(t1 < t2);
    }
}
