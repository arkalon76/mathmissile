//! GLSL ES 3.00 shaders. One program draws everything; `kind` selects the shape.
//! Kind ids must match `particles::kind`; monster shapes follow
//! `species::SPECIES` order (the `SP` table below); icon ids follow
//! `species::icon`; blade families follow `species::family`.
//!
//! Instance layout (28 floats, `draw::Inst`):
//! ps (pos.xy, half-size.xy) · rk (rot, kind, additive, sub) · col · p0 · p1 · p2 · p3

pub const VERT: &str = r#"#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 i_ps;
layout(location=2) in vec4 i_rk;
layout(location=3) in vec4 i_col;
layout(location=4) in vec4 i_p0;
layout(location=5) in vec4 i_p1;
layout(location=6) in vec4 i_p2;
layout(location=7) in vec4 i_p3;
uniform vec2 u_view;
uniform vec2 u_cam;
out vec2 v_local;
out vec2 v_world;
flat out vec4 v_col;
flat out vec4 v_p0;
flat out vec4 v_p1;
flat out vec4 v_p2;
flat out vec4 v_p3;
flat out vec2 v_size;
flat out vec3 v_kas;
void main() {
  float c = cos(i_rk.x), s = sin(i_rk.x);
  vec2 off = a_corner * i_ps.zw;
  vec2 world = i_ps.xy + vec2(off.x * c - off.y * s, off.x * s + off.y * c);
  v_local = a_corner;
  v_world = world;
  v_col = i_col; v_p0 = i_p0; v_p1 = i_p1; v_p2 = i_p2; v_p3 = i_p3;
  v_size = i_ps.zw; v_kas = i_rk.yzw;
  vec2 ndc = (world + u_cam) / u_view * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
}
"#;

pub const FRAG: &str = r#"#version 300 es
precision highp float;
in vec2 v_local;
in vec2 v_world;
flat in vec4 v_col;
flat in vec4 v_p0;
flat in vec4 v_p1;
flat in vec4 v_p2;
flat in vec4 v_p3;
flat in vec2 v_size;
flat in vec3 v_kas;
uniform sampler2D u_atlas;
uniform float u_time;
out vec4 o;

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float dot2(vec2 v) { return dot(v, v); }
float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdEllipse(vec2 p, vec2 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-4);
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float sdSeg(vec2 p, vec2 a, vec2 b) { return sdCapsule(p, a, b, 0.0); }
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0, 1);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float fill(float d) { float w = max(fwidth(d), 1e-4); return clamp(0.5 - d / w, 0.0, 1.0); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
vec4 over(vec4 dst, vec3 c, float a) { return vec4(mix(dst.rgb, c, a), dst.a + a * (1.0 - dst.a)); }

// ---------------------------------------------------------------- monsters
// Per species (SPECIES order): body, appendage, eye count, pattern.
// body: 0 round 1 wide 2 tall 3 cloud 4 spiky 5 star 6 bean 7 worm 8 slug 9 two heads
// appendage: 0 none 1 antenna 2 floppy ears 3 four ears 4 horns 5 crab legs 6 wings
//   7 feet 8 tails fan 9 tuft+beak 10 unicorn horn 11 dandelion 12 fins 13 shell nubs
//   14 bat wings 15 mop fringe 16 owl tufts 17 lizard tail
// pattern: 0 none 1 spots 2 stripes 3 chips 4 moss 5 sparkle 6 split line
const ivec4 SP[28] = ivec4[28](
  ivec4(0, 1, 2, 0),  ivec4(0, 9, 2, 0),  ivec4(1, 7, 2, 1),  ivec4(9, 0, 2, 0),
  ivec4(3, 4, 2, 0),  ivec4(6, 17, 2, 2), ivec4(4, 0, 2, 0),  ivec4(5, 0, 2, 1),
  ivec4(8, 1, 2, 4),  ivec4(0, 6, 3, 2),  ivec4(7, 0, 2, 2),  ivec4(0, 11, 2, 0),
  ivec4(0, 15, 2, 5), ivec4(0, 3, 2, 0),  ivec4(0, 6, 2, 1),  ivec4(2, 16, 2, 1),
  ivec4(0, 0, 2, 3),  ivec4(0, 10, 2, 0), ivec4(0, 14, 2, 0), ivec4(1, 5, 2, 0),
  ivec4(1, 12, 2, 2), ivec4(0, 8, 2, 0),  ivec4(1, 2, 2, 0),  ivec4(6, 14, 2, 1),
  ivec4(3, 0, 2, 5),  ivec4(0, 13, 2, 0), ivec4(0, 1, 2, 6),  ivec4(0, 4, 2, 5)
);

float bodyBase(vec2 p, int b, float t) {
  if (b == 1) return sdEllipse(p, vec2(1.12, 0.84));
  if (b == 2) return sdEllipse(p, vec2(0.86, 1.05));
  if (b == 3) {
    float d = sdCircle(p, 0.84);
    for (int i = 0; i < 8; i++) {
      float a = float(i) / 8.0 * 6.2832 + 0.2;
      d = smin(d, sdCircle(p - 0.76 * vec2(cos(a), sin(a)), 0.3 + 0.02 * sin(t * 3.0 + float(i))), 0.14);
    }
    return d;
  }
  if (b == 4) {
    float a = atan(p.y, p.x);
    return (length(p) - (0.9 + 0.11 * cos(9.0 * a + t * 0.6))) * 0.8;
  }
  if (b == 5) return smin(sdStar5(rot2(0.06 * sin(t * 2.0)) * p, 1.08, 0.55) - 0.06, sdCircle(p, 0.62), 0.2);
  if (b == 6) return sdEllipse(p, vec2(1.06, 0.88));
  if (b == 7) {
    float w = 0.12 * sin(t * 4.0);
    float d = sdCapsule(p, vec2(-0.95, -0.35 + w), vec2(-0.35, 0.25 - w), 0.36);
    d = smin(d, sdCapsule(p, vec2(-0.35, 0.25 - w), vec2(0.35, -0.25 + w), 0.36), 0.1);
    d = smin(d, sdCapsule(p, vec2(0.35, -0.25 + w), vec2(0.95, 0.35 - w), 0.36), 0.1);
    return smin(d, sdCircle(p, 0.72), 0.2);
  }
  if (b == 8) return smin(sdEllipse(p - vec2(0.0, -0.12), vec2(1.15, 0.72)), sdCircle(p - vec2(0.35, 0.25), 0.62), 0.25);
  if (b == 9) return smin(sdCircle(p - vec2(-0.48, 0.0), 0.7), sdCircle(p - vec2(0.48, 0.0), 0.7), 0.2);
  return sdCircle(p, 1.0);
}

float appendage(vec2 p, int ap, float t) {
  vec2 q = vec2(abs(p.x), p.y);
  if (ap == 1) {
    float sw = 0.1 * sin(t * 3.0);
    return min(sdCapsule(p, vec2(0.0, 0.8), vec2(sw, 1.2), 0.06), sdCircle(p - vec2(sw, 1.3), 0.15));
  }
  if (ap == 2) {
    float wig = 0.1 * sin(t * 2.5);
    return sdEllipse(rot2(0.3 + wig) * (q - vec2(0.45, 1.0)), vec2(0.19, 0.46));
  }
  if (ap == 3) {
    float wig = 0.08 * sin(t * 3.0);
    float a = sdEllipse(rot2(0.15 + wig) * (q - vec2(0.25, 1.05)), vec2(0.13, 0.36));
    float b = sdEllipse(rot2(0.7 - wig) * (q - vec2(0.62, 0.88)), vec2(0.12, 0.32));
    return min(a, b);
  }
  if (ap == 4) return sdCapsule(q, vec2(0.38, 0.8), vec2(0.62, 1.18), 0.1) - 0.05 * (1.18 - q.y);
  if (ap == 5) {
    float d = 1e9;
    for (int i = 0; i < 4; i++) {
      float y = -0.15 - 0.17 * float(i);
      float w = 0.08 * sin(t * 6.0 + float(i) * 1.3);
      d = min(d, sdCapsule(q, vec2(0.85, y), vec2(1.3, y - 0.25 + w), 0.07));
    }
    return d;
  }
  if (ap == 6) {
    float fl = 0.35 * sin(t * 9.0);
    return sdEllipse(rot2(-0.45 + fl) * (q - vec2(0.98, 0.3)), vec2(0.45, 0.22));
  }
  if (ap == 7) return sdEllipse(q - vec2(0.5, -0.84 + 0.04 * sin(t * 6.0 + p.x)), vec2(0.27, 0.15));
  if (ap == 8) {
    float d = 1e9;
    for (int i = 0; i < 7; i++) {
      float a = -2.2 + 0.25 * float(i) + 0.05 * sin(t * 3.0 + float(i));
      vec2 dir = vec2(cos(a), sin(a));
      d = min(d, sdCapsule(p, dir * 0.6, dir * 1.3, 0.11));
    }
    return d;
  }
  if (ap == 9) return min(sdCircle(p - vec2(0.0, 1.02), 0.12), min(sdCircle(p - vec2(-0.16, 0.98), 0.1), sdCircle(p - vec2(0.16, 0.98), 0.1)));
  if (ap == 10) return sdTri(p, vec2(-0.13, 0.85), vec2(0.13, 0.85), vec2(0.0, 1.45)) - 0.03;
  if (ap == 11) {
    float a = atan(p.y, p.x) + t * 0.4;
    float spoke = abs(fract(a / 6.2832 * 14.0) - 0.5) * length(p) * 0.45;
    float r = length(p);
    return max(min(spoke - 0.025, abs(r - 1.28) - 0.07), max(0.95 - r, r - 1.35));
  }
  if (ap == 12) {
    float side = sdTri(q, vec2(0.85, 0.25), vec2(0.85, -0.25), vec2(1.35, 0.05 + 0.1 * sin(t * 5.0)));
    float top = sdTri(p, vec2(-0.3, 0.75), vec2(0.3, 0.75), vec2(0.0, 1.25));
    return min(side - 0.03, top - 0.03);
  }
  if (ap == 13) return 1e9;
  if (ap == 14) {
    float fl = 0.25 * sin(t * 6.0);
    vec2 w = rot2(-0.2 + fl) * (q - vec2(0.8, 0.25));
    return sdTri(w, vec2(0.0, 0.3), vec2(0.0, -0.3), vec2(0.75, 0.25)) - 0.04;
  }
  if (ap == 15) {
    float strand = abs(fract(p.x * 4.0 + 0.5) - 0.5) / 4.0;
    float len = 0.25 + 0.05 * sin(p.x * 9.0 + t * 4.0);
    return max(strand - 0.07, max(-0.75 - p.y, p.y + 0.75 - len - 0.6));
  }
  if (ap == 16) return sdTri(q, vec2(0.35, 0.85), vec2(0.7, 0.7), vec2(0.62, 1.25)) - 0.03;
  if (ap == 17) {
    float w = 0.15 * sin(t * 3.0);
    return sdCapsule(p, vec2(0.8, -0.35), vec2(1.35, -0.1 + w), 0.12 - 0.04);
  }
  return 1e9;
}

vec3 g_outline;

void drawEye(inout vec3 col, vec2 p, vec2 c, float r, vec2 look, float blink, int mood) {
  vec2 q = p - c;
  if (mood == 2 || mood == 5 || mood == 4) {
    // happy ^ ^ arcs, or sleepy lids
    float arc = mood == 4 ? abs(q.y + 0.02) - 0.03 : abs(length(q + vec2(0.0, r * 0.6)) - r * 0.85) - 0.035;
    if (mood == 4) arc = max(arc, abs(q.x) - r);
    else arc = max(arc, -(q.y + r * 0.1));
    col = mix(col, g_outline, fill(arc));
    return;
  }
  if (mood == 3) {
    // bonk: > <
    float s = c.x < 0.0 ? 1.0 : -1.0;
    float d = min(sdSeg(q, vec2(-r * s, r * 0.7), vec2(r * 0.6 * s, 0.0)), sdSeg(q, vec2(-r * s, -r * 0.7), vec2(r * 0.6 * s, 0.0))) - 0.035;
    col = mix(col, g_outline, fill(d));
    return;
  }
  float open = max(1.0 - blink, 0.1);
  float de = sdEllipse(q, vec2(r, r * open));
  col = mix(col, g_outline, fill(de - 0.04));
  float m = fill(de);
  col = mix(col, vec3(1.0), m);
  if (mood == 1) {
    float a = atan(q.y, q.x);
    float rr = length(q) / r;
    float sw = abs(fract(rr * 2.2 - a / 6.2832 + u_time * 1.5) - 0.5);
    col = mix(col, g_outline, m * smoothstep(0.22, 0.12, sw) * step(rr, 0.85));
  } else if (open > 0.35) {
    vec2 pc = look * r * 0.42;
    col = mix(col, vec3(0.1, 0.06, 0.18), fill(sdCircle(q - pc, r * 0.55)) * m);
    col = mix(col, vec3(1.0), fill(sdCircle(q - pc - vec2(-0.2, 0.22) * r, r * 0.17)) * m);
  }
  if (mood == 6 || mood == 7) {
    // brows: grumpy slant in, determined slant down
    float s = c.x < 0.0 ? 1.0 : -1.0;
    float tilt = mood == 6 ? 0.35 : 0.2;
    vec2 b0 = c + vec2(-r * 1.0 * s, r * 1.25 + tilt * r);
    vec2 b1 = c + vec2(r * 0.8 * s, r * 1.15 - tilt * r * 0.4);
    col = mix(col, g_outline, fill(sdSeg(p, b0, b1) - 0.04));
  }
}

vec4 monster(vec2 lp) {
  int shape = int(v_p0.x + 0.5);
  ivec4 sp = SP[clamp(shape, 0, 27)];
  vec2 look = v_p0.yz;
  float blink = v_p0.w;
  int mood = int(v_p1.x + 0.5);
  int flags = int(v_p1.y + 0.5);
  float crackT = v_p1.z;
  float grand = v_p1.w;
  float t = v_p2.x;
  float squash = v_p2.y;
  float age = v_p2.z;
  float white = v_p2.w;
  vec3 col2 = v_p3.rgb;
  float glow = v_p3.w;
  bool shiny = (flags & 1) != 0;
  bool silhouette = (flags & 32) != 0;
  bool shell = (flags & 16) != 0;

  vec2 p = lp * 1.6;
  float wob = 0.035 * sin(t * 3.1) + squash * 0.16 * sin(age * 28.0);
  p.y *= 1.0 + wob;
  p.x *= 1.0 - wob;

  float d = bodyBase(p, sp.x, t);
  float dap = appendage(p, sp.y, t);
  d = smin(d, dap, 0.1);
  float a = fill(d);

  vec4 res = vec4(0.0);
  // outer glow (night glow, revealed fact)
  if (glow > 0.0) {
    float g = exp(-max(d, 0.0) * 5.0) * glow * 0.6;
    res = vec4(v_col.rgb * 0.8 + 0.2, g);
  }
  vec3 base = v_col.rgb;
  if (shiny) base = mix(base, hsv(p.x * 0.25 + p.y * 0.15 + u_time * 0.3, 0.45, 1.0), 0.35);
  if ((flags & 128) != 0) base = mix(base, vec3(1.0, 0.82, 0.3), 0.4);
  g_outline = base * 0.3 + vec3(0.06, 0.03, 0.14);

  if (a > 0.0) {
    vec3 col = base * (0.9 + 0.14 * p.y);
    if (silhouette) {
      col = vec3(0.22, 0.19, 0.34);
      col = mix(g_outline * 0.6, col, fill(d + 0.055));
    } else {
      // pattern
      int pat = sp.w;
      if (pat == 1) {
        float s = 1e9;
        for (int i = 0; i < 6; i++) {
          vec2 c = vec2(hash(vec2(float(i), 1.3)) * 1.4 - 0.7, hash(vec2(float(i), 7.9)) * 1.2 - 0.55);
          s = min(s, sdCircle(p - c, 0.11 + 0.04 * hash(vec2(float(i), 3.0))));
        }
        col = mix(col, col2, 0.8 * fill(s) * step(p.y, 0.25));
      } else if (pat == 2) {
        float st = abs(fract(p.y * 2.6 + 0.3) - 0.5) - 0.16;
        col = mix(col, col2, 0.55 * fill(st / 2.6) * step(p.y, 0.15));
      } else if (pat == 3) {
        float s = 1e9;
        for (int i = 0; i < 7; i++) {
          vec2 c = vec2(hash(vec2(float(i), 2.1)) * 1.5 - 0.75, hash(vec2(float(i), 5.3)) * 1.5 - 0.8);
          s = min(s, sdRoundBox(rot2(float(i)) * (p - c), vec2(0.07, 0.05), 0.03));
        }
        col = mix(col, vec3(0.35, 0.2, 0.1), fill(s));
      } else if (pat == 4) {
        float n = hash(floor(p * 9.0));
        col = mix(col, col2, 0.5 * step(0.55, n) * smoothstep(0.1, 0.5, p.y));
      } else if (pat == 5) {
        vec2 cell = floor(p * 5.0);
        float h = hash(cell);
        float tw = 0.5 + 0.5 * sin(u_time * 4.0 + h * 30.0);
        float sd = length(fract(p * 5.0) - 0.5);
        col = mix(col, vec3(1.0), step(0.8, h) * tw * smoothstep(0.18, 0.0, sd));
      } else if (pat == 6) {
        float z = abs(p.x - 0.08 * sin(p.y * 12.0)) - 0.035;
        col = mix(col, col2, fill(z));
      }
      // appendages a touch darker
      col = mix(col, col2, 0.45 * fill(dap + 0.02) * step(-0.0, dap - bodyBase(p, sp.x, t)));
      // belly
      col = mix(col, min(base * 1.18 + 0.08, vec3(1.0)), 0.55 * fill(sdEllipse(p - vec2(0.0, -0.3), vec2(0.72, 0.5))));
      col *= mix(0.78, 1.0, smoothstep(0.0, -0.22, d));
      col = mix(col, vec3(1.0), 0.45 * fill(sdEllipse(rot2(0.5) * (p - vec2(-0.45, 0.55)), vec2(0.24, 0.13))));
      vec2 q = vec2(abs(p.x), p.y);
      col = mix(col, vec3(1.0, 0.45, 0.55), 0.35 * smoothstep(0.16, 0.0, length(q - vec2(0.62, 0.2))));
      // face
      int eyes = sp.z;
      float er = grand > 0.5 ? 0.15 : 0.17;
      if (sp.x == 9) {
        drawEye(col, p, vec2(-0.62, 0.32), 0.14, look, blink, mood);
        drawEye(col, p, vec2(-0.34, 0.32), 0.14, look, blink, mood);
        drawEye(col, p, vec2(0.34, 0.32), 0.14, look, blink, mood);
        drawEye(col, p, vec2(0.62, 0.32), 0.14, look, blink, mood);
      } else if (eyes == 1) {
        drawEye(col, p, vec2(0.0, 0.43), 0.3, look, blink, mood);
      } else {
        drawEye(col, p, vec2(-0.34, 0.45), er, look, blink, mood);
        drawEye(col, p, vec2(0.34, 0.45), er, look, blink, mood);
        if (eyes == 3) drawEye(col, p, vec2(0.0, 0.68), er * 0.85, look, blink, mood);
      }
      // beak for the bird-blob
      if (sp.y == 9) col = mix(col, vec3(1.0, 0.6, 0.2), fill(sdTri(p, vec2(-0.1, 0.3), vec2(0.1, 0.3), vec2(0.0, 0.16)) - 0.02));
      // mouth
      vec2 mq = p - vec2(0.0, 0.2);
      if (mood == 1) {
        col = mix(col, g_outline, fill(sdEllipse(mq, vec2(0.07, 0.09))));
      } else if (mood == 3) {
        float wv = abs(mq.y - 0.03 * sin(mq.x * 40.0)) - 0.022;
        col = mix(col, g_outline, fill(max(wv, abs(mq.x) - 0.14)));
      } else if (mood == 6) {
        float ring = abs(length(mq - vec2(0.0, -0.12)) - 0.12) - 0.025;
        col = mix(col, g_outline, fill(max(ring, -(mq.y + 0.04))));
      } else if (mood == 2 || mood == 5) {
        float big = sdEllipse(mq - vec2(0.0, 0.02), vec2(0.16, 0.12));
        col = mix(col, g_outline, fill(max(big, mq.y - 0.02)));
        col = mix(col, vec3(1.0, 0.45, 0.5), fill(max(sdEllipse(mq - vec2(0.0, -0.07), vec2(0.08, 0.05)), big)));
      } else {
        float ring = abs(length(mq - vec2(0.0, 0.1)) - 0.12) - 0.025;
        col = mix(col, g_outline, fill(max(ring, mq.y - 0.04)));
      }
      // bandage (Comeback tag)
      if ((flags & 2) != 0) {
        vec2 bq = rot2(0.6) * (p - vec2(0.55, 0.72));
        float b = sdRoundBox(bq, vec2(0.22, 0.07), 0.05);
        col = mix(col, vec3(1.0, 0.92, 0.8), fill(b));
        col = mix(col, vec3(0.9, 0.7, 0.6), fill(sdRoundBox(bq, vec2(0.06, 0.05), 0.02)) * fill(b));
      }
      // ice
      if ((flags & 64) != 0) {
        col = mix(col, vec3(0.8, 0.95, 1.0), 0.35);
        col = mix(col, vec3(1.0), 0.6 * step(0.92, hash(floor(p * 14.0))));
      }
      col = mix(g_outline, col, fill(d + 0.055));
    }
    if (white > 0.0) col = mix(col, vec3(1.0), white);
    res = over(res, col, a);
  }
  if (!silhouette) {
    // Clonkshell's shell (intact) or its broken remnant.
    if (shell || (flags & 256) != 0) {
      float sh = max(sdCircle(p - vec2(0.0, -0.05), 1.08), shell ? -(p.y - 0.35 + 0.05 * sin(p.x * 18.0)) : p.y + 0.45);
      float plates = abs(fract(p.x * 2.5 + 0.5) - 0.5) - 0.04;
      vec3 sc = mix(col2, col2 * 0.7, fill(plates / 2.5));
      sc = mix(vec3(0.15, 0.15, 0.2), sc, fill(sh + 0.06));
      if (crackT > 0.0) sc = mix(sc, vec3(1.0), crackT * 2.0);
      res = over(res, sc, fill(sh));
    }
    if ((flags & 4) != 0) {
      // crown
      vec2 cq = p - vec2(0.0, 1.15);
      float cr = sdRoundBox(cq + vec2(0.0, 0.08), vec2(0.36, 0.1), 0.02);
      cr = min(cr, sdTri(cq, vec2(-0.36, -0.05), vec2(-0.12, -0.05), vec2(-0.3, 0.3)));
      cr = min(cr, sdTri(cq, vec2(-0.14, -0.05), vec2(0.14, -0.05), vec2(0.0, 0.36)));
      cr = min(cr, sdTri(cq, vec2(0.12, -0.05), vec2(0.36, -0.05), vec2(0.3, 0.3)));
      vec3 cc = mix(vec3(0.6, 0.4, 0.05), vec3(1.0, 0.85, 0.25), fill(cr + 0.04));
      res = over(res, cc, fill(cr));
    }
    if ((flags & 8) != 0) {
      // soap bubble
      float r = length(lp);
      float rim = abs(r - 0.93) - 0.025;
      vec3 bc = hsv(atan(lp.y, lp.x) * 0.16 + u_time * 0.1, 0.35, 1.0);
      float ba = 0.12 * step(r, 0.93) + 0.7 * fill(rim);
      ba += 0.6 * fill(sdEllipse(rot2(0.6) * (lp - vec2(-0.45, 0.5)), vec2(0.14, 0.06)));
      res = over(res, bc, clamp(ba, 0.0, 1.0));
    }
  }
  res.a *= v_col.a;
  res.rgb *= res.a;
  return res;
}

// -------------------------------------------------------------------- icons
float iconSd(int id, vec2 p, out vec3 tint, out float shade) {
  tint = vec3(1.0); shade = 0.0;
  if (id == 0 || id == 14) {
    float d = sdHeart(p * 1.15 + vec2(0.0, 0.55)) / 1.15;
    if (id == 14) d = abs(d + 0.06) - 0.06;
    shade = fill(sdCircle(p - vec2(-0.3, 0.25), 0.14));
    return d;
  }
  if (id == 1) {
    float d = sdCircle(p, 0.85);
    tint = mix(vec3(0.75), vec3(1.0), fill(abs(length(p) - 0.62) - 0.06) + 0.0);
    shade = fill(sdEllipse(rot2(0.6) * (p - vec2(-0.3, 0.35)), vec2(0.2, 0.08)));
    return d;
  }
  if (id == 2) {
    float body = sdRoundBox(p - vec2(0.0, -0.1), vec2(0.42, 0.55), 0.3);
    float cap = sdRoundBox(p - vec2(0.0, 0.58), vec2(0.28, 0.1), 0.04);
    float ring = abs(sdCircle(p - vec2(0.0, 0.78), 0.14)) - 0.04;
    tint = mix(vec3(0.75), vec3(1.0), fill(body)) ;
    shade = 0.6 * fill(sdEllipse(p - vec2(0.0, -0.1), vec2(0.2, 0.32)));
    return min(body, min(cap, ring));
  }
  if (id == 3) {
    float head = sdEllipse(rot2(0.4) * (p - vec2(-0.25, -0.5)), vec2(0.3, 0.22));
    float stem = sdRoundBox(p - vec2(0.03, 0.15), vec2(0.06, 0.65), 0.03);
    float flag = sdCapsule(p, vec2(0.05, 0.78), vec2(0.45, 0.35), 0.08);
    return min(head, min(stem, flag));
  }
  if (id == 4) {
    vec2 q = rot2(0.6) * p;
    float d = max(sdCircle(q - vec2(0.5, 0.0), 0.82), sdCircle(q + vec2(0.5, 0.0), 0.82));
    tint = mix(vec3(1.0), vec3(0.7), fill(abs(q.y) - 0.03) * step(abs(q.x), 0.25));
    return min(d, sdCapsule(q, vec2(-0.3, 0.0), vec2(-0.85, 0.0), 0.04));
  }
  if (id == 5 || id == 15) {
    float th = id == 15 ? 0.1 : 0.07;
    float d = 1e9;
    for (int i = 0; i < 6; i++) {
      vec2 dir = vec2(cos(float(i) * 1.0472 + 0.52), sin(float(i) * 1.0472 + 0.52));
      d = min(d, sdCapsule(p, vec2(0.0), dir * 0.85, th));
      vec2 m = dir * 0.5;
      vec2 n = vec2(-dir.y, dir.x);
      d = min(d, sdCapsule(p, m, m + (dir + n) * 0.22, th * 0.8));
      d = min(d, sdCapsule(p, m, m + (dir - n) * 0.22, th * 0.8));
    }
    return d;
  }
  if (id == 6) {
    float d = sdEllipse(p - vec2(0.0, -0.3), vec2(0.42, 0.34));
    d = min(d, sdEllipse(p - vec2(-0.55, 0.15), vec2(0.17, 0.22)));
    d = min(d, sdEllipse(p - vec2(-0.2, 0.5), vec2(0.17, 0.22)));
    d = min(d, sdEllipse(p - vec2(0.2, 0.5), vec2(0.17, 0.22)));
    d = min(d, sdEllipse(p - vec2(0.55, 0.15), vec2(0.17, 0.22)));
    return d;
  }
  if (id == 7) {
    float r = length(p);
    shade = fill(sdEllipse(rot2(0.6) * (p - vec2(-0.35, 0.4)), vec2(0.18, 0.08)));
    tint = vec3(1.0);
    return max(r - 0.85, -(r - 0.72)) ;
  }
  if (id == 8) {
    // pointing hand (tutorial hint)
    float palm = sdRoundBox(p - vec2(0.0, -0.35), vec2(0.36, 0.34), 0.18);
    float finger = sdCapsule(p, vec2(-0.12, -0.1), vec2(-0.12, 0.8), 0.13);
    float f2 = sdCapsule(p, vec2(0.12, -0.15), vec2(0.15, 0.15), 0.12);
    float f3 = sdCapsule(p, vec2(0.3, -0.2), vec2(0.33, 0.05), 0.11);
    float th = sdCapsule(p, vec2(-0.3, -0.35), vec2(-0.55, -0.05), 0.11);
    return min(min(palm, finger), min(min(f2, f3), th));
  }
  if (id == 9) {
    float d = sdCircle(p - vec2(-0.25, 0.2), 0.38);
    d = min(d, sdCircle(p - vec2(0.2, 0.3), 0.42));
    d = min(d, sdCircle(p - vec2(0.45, 0.05), 0.3));
    d = min(d, sdCircle(p - vec2(-0.5, -0.02), 0.25));
    d = smin(d, sdRoundBox(p - vec2(0.0, -0.02), vec2(0.6, 0.15), 0.12), 0.1);
    d = min(d, sdCircle(p - vec2(-0.45, -0.5), 0.12));
    d = min(d, sdCircle(p - vec2(-0.7, -0.75), 0.07));
    return d;
  }
  if (id == 10) {
    vec2 q = floor(abs(p) * 4.0);
    float on = (q.x + q.y < 3.0 && (q.x < 1.0 || q.y < 1.0 || (q.x < 2.0 && q.y < 2.0))) ? -1.0 : 1.0;
    return on * 0.05;
  }
  if (id == 11) {
    float box = sdRoundBox(p, vec2(0.8), 0.2);
    float st = sdStar5(p * 1.2 + vec2(0.0, 0.05), 0.7, 0.45) / 1.2;
    tint = mix(vec3(1.0), vec3(1.0, 1.0, 1.0), 1.0);
    shade = 0.0;
    tint = vec3(1.0) - (1.0 - fill(st)) * 0.0;
    return box + 0.0 * st;
  }
  if (id == 12) {
    float d = 1e9;
    for (int i = 0; i < 5; i++) {
      float a = float(i) * 1.2566 + 0.3;
      vec2 dir = vec2(cos(a), sin(a));
      vec2 n = vec2(-dir.y, dir.x);
      vec2 m = dir * 0.45 + n * 0.08;
      d = min(d, min(sdSeg(p, vec2(0.0), m), sdSeg(p, m, dir * 0.9)));
    }
    return d - 0.03;
  }
  if (id == 13) {
    vec2 q = abs(p);
    float d = (pow(q.x, 0.5) + pow(q.y, 0.5) - 0.9) * 0.6;
    return d;
  }
  return sdCircle(p, 0.8);
}

vec4 icon(vec2 lp) {
  int id = int(v_kas.z + 0.5);
  vec3 tint; float shade;
  float d = iconSd(id, lp, tint, shade);
  float a = fill(d);
  vec3 c = v_col.rgb * tint;
  // dark outline for readability
  vec3 ol = v_col.rgb * 0.35;
  float oa = fill(d - 0.07);
  vec3 col = mix(ol, c, a);
  col = mix(col, vec3(1.0), shade * 0.7 * a);
  if (id == 11) {
    float st = sdStar5(lp * 1.2 + vec2(0.0, 0.05), 0.7, 0.45) / 1.2;
    col = mix(vec3(1.0), v_col.rgb, fill(st));
  }
  float al = max(a, oa) * v_col.a;
  if (id == 7 || id == 13 || id == 10) al = a * v_col.a;
  return vec4(col * al, al);
}

// -------------------------------------------------------------------- blade
// Local space: x ∈ [-0.4, 0.4], y ∈ [-1, 1]; hilt below y = -0.3, tip at 0.95.
float bladeSd(int fam, vec2 q, out float isHilt) {
  isHilt = 0.0;
  float hilt = sdRoundBox(q - vec2(0.0, -0.66), vec2(0.07, 0.3), 0.05);
  float d;
  if (fam == 0) {           // wand + star
    d = min(sdCapsule(q, vec2(0.0, -0.3), vec2(0.0, 0.55), 0.045), sdStar5(q - vec2(0.0, 0.72), 0.24, 0.45));
  } else if (fam == 1) {    // sword
    d = sdTri(q, vec2(-0.12, -0.3), vec2(0.12, -0.3), vec2(0.0, 0.97)) - 0.02;
    hilt = min(hilt, sdRoundBox(q - vec2(0.0, -0.33), vec2(0.26, 0.04), 0.03));
  } else if (fam == 2) {    // leaf
    d = max(sdCircle(q - vec2(0.45, 0.32), 0.62), sdCircle(q - vec2(-0.45, 0.32), 0.62));
  } else if (fam == 3) {    // feather
    d = sdEllipse(rot2(0.08) * (q - vec2(0.02, 0.35)), vec2(0.2, 0.62));
    d = min(d, sdCapsule(q, vec2(0.0, -0.3), vec2(0.03, 0.9), 0.02));
  } else if (fam == 4) {    // carrot
    d = sdTri(q, vec2(-0.16, -0.25), vec2(0.16, -0.25), vec2(0.0, 0.95)) - 0.04;
    hilt = min(hilt, min(sdEllipse(rot2(0.4) * (q - vec2(-0.08, -0.4)), vec2(0.05, 0.16)), sdEllipse(rot2(-0.4) * (q - vec2(0.08, -0.4)), vec2(0.05, 0.16))));
  } else if (fam == 5) {    // icicle
    d = sdTri(q, vec2(-0.1, -0.3), vec2(0.1, -0.3), vec2(0.02, 0.98)) - 0.01;
  } else if (fam == 6) {    // lightning bolt
    d = sdTri(q, vec2(-0.05, -0.3), vec2(0.16, 0.3), vec2(-0.02, 0.28));
    d = min(d, sdTri(q, vec2(0.12, 0.25), vec2(-0.14, 0.38), vec2(0.06, 0.98)));
    d -= 0.03;
  } else {                  // crystal
    vec2 a = abs(q - vec2(0.0, 0.33));
    d = max(a.x * 1.0 + a.y * 0.2 - 0.17, a.y - 0.64);
  }
  if (hilt < d) isHilt = 1.0;
  return min(d, hilt);
}

vec4 blade(vec2 lp) {
  int fam = int(v_kas.z + 0.5);
  float pattern = v_p0.x;
  float glowAmt = v_p0.y;
  float t = v_p0.z;
  vec3 c1 = v_col.rgb;
  vec3 c2 = v_p1.rgb;
  vec3 gc = v_p2.rgb;
  vec2 q = lp * vec2(0.4, 1.0);
  float isHilt;
  float d = bladeSd(fam, q, isHilt);
  float a = fill(d / 2.5);
  vec3 col = c1 * (0.85 + 0.3 * q.x * 3.0);
  if (pattern > 0.5 && pattern < 1.5) col = mix(col, c2, step(0.5, fract((q.y + q.x) * 6.0)));
  if (pattern > 1.5 && pattern < 2.5) col = hsv(q.y * 0.6 + t * 0.3, 0.6, 1.0);
  if (pattern > 2.5) {
    float h = hash(floor(q * 18.0));
    col = mix(col, vec3(1.0), step(0.85, h) * (0.5 + 0.5 * sin(t * 6.0 + h * 40.0)));
  }
  if (isHilt > 0.5) col = fam == 4 ? vec3(0.35, 0.8, 0.3) : c2 * 0.7;
  col = mix(col * 0.4, col, fill(d / 2.5 + 0.02));
  float g = exp(-max(d, 0.0) * 14.0) * glowAmt;
  float al = clamp(a + g * (1.0 - a), 0.0, 1.0) * v_col.a;
  vec3 outc = mix(gc, col, a / max(a + g * (1.0 - a), 1e-4));
  return vec4(outc * al, al);
}

// --------------------------------------------------------------- background
vec4 background() {
  float t = v_p0.x;
  float tier = v_p0.y;
  float pulse = v_p0.z;
  float vh = v_p0.w;
  int ev = int(v_p1.y + 0.5);
  float chill = v_p1.z;
  vec2 w = v_world;
  float y = clamp(w.y / vh, 0.0, 1.0);
  vec3 top = vec3(0.10, 0.07, 0.26), bot = vec3(0.30, 0.18, 0.52);
  vec3 hill1 = vec3(0.16, 0.13, 0.36), hill2 = vec3(0.10, 0.08, 0.24);
  float stars = 1.0;
  if (ev == 1) { top = vec3(0.35, 0.16, 0.38); bot = vec3(1.0, 0.55, 0.3); hill1 = vec3(0.45, 0.2, 0.3); hill2 = vec3(0.3, 0.12, 0.25); stars = 0.3; }
  else if (ev == 2) { top = vec3(0.12, 0.3, 0.5); bot = vec3(0.35, 0.7, 0.85); hill1 = vec3(0.15, 0.4, 0.5); hill2 = vec3(0.1, 0.28, 0.4); stars = 0.2; }
  else if (ev == 3) { top = vec3(0.02, 0.02, 0.08); bot = vec3(0.06, 0.06, 0.18); hill1 = vec3(0.04, 0.06, 0.1); hill2 = vec3(0.02, 0.03, 0.06); stars = 1.6; }
  else if (ev == 6) { top = vec3(0.3, 0.35, 0.7); bot = vec3(0.65, 0.5, 0.85); hill1 = vec3(0.35, 0.3, 0.6); hill2 = vec3(0.25, 0.2, 0.45); stars = 0.4; }
  else if (ev == 7) { top = vec3(0.12, 0.04, 0.2); bot = vec3(0.4, 0.12, 0.4); }
  vec3 col = mix(bot, top, y);
  col += v_col.rgb * (0.05 * tier) * (1.0 - y);
  if (pulse > 0.0) col = mix(col, hsv(t * 0.5 + y * 0.3, 0.5, 0.8), 0.35 * pulse);
  vec2 cell = floor(w / 70.0);
  float h = hash(cell);
  if (h > 0.93) {
    vec2 c = (cell + 0.25 + 0.5 * vec2(hash(cell + 3.1), hash(cell + 7.7))) * 70.0;
    float tw = 0.5 + 0.5 * sin(t * (1.0 + h * 3.0) + h * 40.0);
    col += vec3(0.9, 0.9, 1.0) * smoothstep(4.5, 0.0, length(w - c)) * tw * (0.4 + 0.6 * y) * stars;
  }
  float h1 = vh * 0.13 + 30.0 * sin(w.x * 0.004 + 1.0) + 18.0 * sin(w.x * 0.011 + t * 0.15);
  float h2 = vh * 0.07 + 24.0 * sin(w.x * 0.006 + 4.0) + 12.0 * sin(w.x * 0.017);
  col = mix(col, hill1, smoothstep(1.5, -1.5, w.y - h1));
  col = mix(col, hill2, smoothstep(1.5, -1.5, w.y - h2));
  if (chill > 0.0) {
    col = mix(col, vec3(0.75, 0.92, 1.0), 0.18 * chill);
    float frost = smoothstep(0.75, 1.0, max(abs(v_local.x), abs(v_local.y)));
    col = mix(col, vec3(0.9, 0.97, 1.0), 0.35 * frost * chill);
  }
  return vec4(col, 1.0);
}

void main() {
  int k = int(v_kas.x + 0.5);
  vec4 c = vec4(0.0);
  vec2 lp = v_local;
  if (k == 0) {            // SOLID; p0.x = 1 → purple vignette
    if (v_p0.x > 0.5) {
      float e = smoothstep(0.55, 1.15, length(lp * vec2(1.0, 0.85)));
      float a = e * v_col.a;
      c = vec4(v_col.rgb * a, a);
    } else {
      c = vec4(v_col.rgb * v_col.a, v_col.a);
    }
  } else if (k == 1) {     // SOFT glow
    float a = pow(max(1.0 - length(lp), 0.0), 2.0) * v_col.a;
    c = vec4(v_col.rgb * a, a);
  } else if (k == 2) {     // GLYPH
    vec2 uv = vec2(mix(v_p0.x, v_p0.z, lp.x * 0.5 + 0.5), mix(v_p0.w, v_p0.y, lp.y * 0.5 + 0.5));
    vec2 tx = texture(u_atlas, uv).rg;
    float a; vec3 col;
    if (v_p1.w < 1.5) { a = max(tx.r, tx.g); col = v_p1.rgb; }
    else { a = tx.r; col = v_col.rgb; }
    a *= v_col.a;
    c = vec4(col * a, a);
  } else if (k == 3) {     // STAR
    float d = sdStar5(lp, 0.75, 0.45);
    float a = fill(d);
    float g = 0.5 * pow(max(1.0 - length(lp), 0.0), 2.0);
    vec3 col = mix(v_col.rgb, vec3(1.0), 0.35 * fill(d + 0.25));
    float al = max(a, g) * v_col.a;
    c = vec4(col * al, al);
  } else if (k == 4) {     // CAPSULE (trail, slash, beam)
    vec2 q = lp * v_size;
    float L = v_p0.x, r = v_p0.y;
    float d = length(vec2(max(abs(q.x) - L, 0.0), q.y)) / r;
    float core = smoothstep(0.55, 0.25, d);
    float glow = exp(-d * d * 0.6) * 0.7;
    vec3 col = mix(v_col.rgb, vec3(1.0), core * (1.0 - v_p0.z));
    float a = max(core, glow) * v_col.a;
    c = vec4(col * a, a);
  } else if (k == 5) {
    c = monster(lp);
  } else if (k == 6) {     // SHARD
    float d = sdTri(lp, vec2(-0.9, -0.8), vec2(0.95, -0.35), vec2(0.1, 0.95));
    float a = fill(d) * v_col.a;
    vec3 col = v_col.rgb * (0.85 + 0.3 * lp.y);
    col = mix(col, vec3(1.0), 0.6 * fill(d + 0.3) * step(0.1, lp.x - lp.y * 0.3));
    c = vec4(col * a, a);
  } else if (k == 7) {
    c = background();
  } else if (k == 8) {     // RING
    float d = abs(length(lp) - 0.86) - 0.07;
    float a = fill(d) * v_col.a + 0.25 * exp(-pow((length(lp) - 0.86) * 8.0, 2.0)) * v_col.a;
    c = vec4(v_col.rgb * a, a);
  } else if (k == 9) {     // DISC
    float a = fill(length(lp) - 0.92) * v_col.a;
    vec3 col = mix(v_col.rgb, vec3(1.0), 0.4 * fill(length(lp - vec2(-0.3, 0.3)) - 0.25));
    c = vec4(col * a, a);
  } else if (k == 10) {    // RRECT; p0.x = corner radius fraction, p0.y = border
    vec2 q = lp * v_size;
    float r = min(v_size.x, v_size.y) * clamp(v_p0.x, 0.0, 1.0);
    float d = sdRoundBox(q, v_size * 0.92, r * 0.92);
    float a = fill(d) * v_col.a;
    vec3 col = v_col.rgb;
    if (v_p0.y > 0.0) col = mix(v_p1.rgb, col, fill(d + v_p0.y));
    c = vec4(col * a, a);
  } else if (k == 11) {
    c = icon(lp);
  } else if (k == 12) {
    c = blade(lp);
  }
  if (v_kas.y > 0.5) c.a = 0.0;
  o = c;
}
"#;
