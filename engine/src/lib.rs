//! Math Missile engine. Rust owns simulation and rendering; the JS shell owns
//! DOM, input capture, audio and storage. See `API.md` for the JS-facing API.

pub mod adaptive;
pub mod config;
pub mod deck;
pub mod draw;
pub mod events;
pub mod facts;
pub mod fx;
pub mod glyphs;
pub mod json;
pub mod particles;
pub mod rng;
pub mod sim;
pub mod species;
pub mod tuning;
pub mod vec2;

#[cfg(target_arch = "wasm32")]
mod gl;
#[cfg(target_arch = "wasm32")]
mod shaders;

#[cfg(target_arch = "wasm32")]
pub use wasm::{Game, Portrait};

/// JSON array of strings.
pub fn json_str_array<'a>(items: impl Iterator<Item = &'a str>) -> String {
    let mut out = String::from("[");
    for (i, s) in items.enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('"');
        out.push_str(s);
        out.push('"');
    }
    out.push(']');
    out
}

/// Parse `{"blade":"leaf_blade","trail":"hearts"}`. Unknown ids are returned
/// as warnings and leave that slot unchanged.
pub fn parse_cosmetics(json_src: &str) -> Result<(Option<u8>, Option<u8>, Vec<String>), String> {
    let v = json::parse(json_src)?;
    let mut warn = Vec::new();
    let blade = match v.get("blade").and_then(|b| b.as_str()) {
        Some(id) => {
            let r = species::blade_by_id(id);
            if r.is_none() {
                warn.push(format!("unknown blade id '{id}'"));
            }
            r
        }
        None => None,
    };
    let trail = match v.get("trail").and_then(|b| b.as_str()) {
        Some(id) => {
            let r = species::trail_by_id(id);
            if r.is_none() {
                warn.push(format!("unknown trail id '{id}'"));
            }
            r
        }
        None => None,
    };
    Ok((blade, trail, warn))
}

/// Parse portrait options: `{"species":"bloop","shiny":false,"silhouette":false,"mood":"happy"}`.
pub fn parse_portrait(json_src: &str) -> Result<draw::PortraitOpts, String> {
    let v = json::parse(json_src)?;
    let id = v.get("species").and_then(|s| s.as_str()).ok_or("portrait: species missing")?;
    let species = species::species_by_id(id).ok_or_else(|| format!("portrait: unknown species '{id}'"))?;
    let mood = match v.get("mood").and_then(|m| m.as_str()) {
        Some(m) => draw::mood::by_name(m).ok_or_else(|| format!("portrait: unknown mood '{m}'"))?,
        None => draw::mood::HAPPY,
    };
    Ok(draw::PortraitOpts {
        species,
        shiny: v.get("shiny").and_then(|b| b.as_bool()).unwrap_or(false),
        silhouette: v.get("silhouette").and_then(|b| b.as_bool()).unwrap_or(false),
        mood,
        time: v.get("time").and_then(|t| t.as_f64()).unwrap_or(0.0) as f32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosmetics_and_portrait_parse() {
        let (b, t, w) = parse_cosmetics(r#"{"blade":"icicle","trail":"nope"}"#).unwrap();
        assert_eq!(b, Some(8));
        assert_eq!(t, None);
        assert_eq!(w.len(), 1);
        let p = parse_portrait(r#"{"species":"grand_gloomp","silhouette":true,"mood":"sleepy"}"#).unwrap();
        assert!(p.species.grand && p.silhouette && p.mood == draw::mood::SLEEPY);
        assert!(parse_portrait(r#"{"species":"nobody"}"#).is_err());
        assert_eq!(json_str_array(["a", "b"].into_iter()), r#"["a","b"]"#);
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use wasm_bindgen::prelude::*;
    use web_sys::HtmlCanvasElement;

    use crate::config::{RoundConfig, SpeedInput};
    use crate::draw::{self, InstanceWriter};
    use crate::gl::Renderer;
    use crate::glyphs::{build_atlas, GlyphTable};
    use crate::sim::{MState, Sim};
    use crate::species::{all_species_ids, BLADES, TRAILS};
    use crate::vec2::v2;

    const DEFAULT_FONT: &str = "'Arial Rounded MT Bold', 'Nunito', 'Varela Round', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
    /// The short side of the play area is this many world units.
    const SHORT_SIDE_UNITS: f32 = 1000.0;

    fn warn(msg: &str) {
        web_sys::console::warn_1(&JsValue::from_str(msg));
    }

    #[wasm_bindgen]
    pub struct Game {
        sim: Sim,
        renderer: Renderer,
        glyphs: GlyphTable,
        writer: InstanceWriter,
        canvas: HtmlCanvasElement,
        css_w: f32,
        css_h: f32,
        dpr: f32,
        /// World units per CSS pixel.
        unit: f32,
        /// WebGL context lost: the sim is held (no time passes) until restored.
        gl_lost: bool,
    }

    #[wasm_bindgen]
    impl Game {
        /// Create the engine on a canvas. `font` optionally overrides the CSS
        /// font-family used for the glyph atlas.
        #[wasm_bindgen(constructor)]
        pub fn new(canvas: HtmlCanvasElement, font: Option<String>) -> Result<Game, JsValue> {
            let mut renderer = Renderer::new(&canvas, false)?;
            let (atlas, glyphs) = build_atlas(font.as_deref().unwrap_or(DEFAULT_FONT))?;
            renderer.set_atlas(&atlas)?;
            let seed = (js_sys::Math::random() * 4_294_967_296.0) as u64;
            let mut g = Game {
                sim: Sim::new(seed),
                renderer,
                glyphs,
                writer: InstanceWriter::new(),
                canvas,
                css_w: 0.0,
                css_h: 0.0,
                dpr: 1.0,
                unit: 1.0,
                gl_lost: false,
            };
            let (w, h) = (g.canvas.client_width().max(1) as f32, g.canvas.client_height().max(1) as f32);
            g.resize(w, h, 1.0);
            Ok(g)
        }

        /// Call on load and whenever the canvas' CSS size or devicePixelRatio
        /// changes. Sets the drawing-buffer size to css * dpr.
        pub fn resize(&mut self, css_w: f32, css_h: f32, dpr: f32) {
            let css_w = css_w.max(1.0);
            let css_h = css_h.max(1.0);
            let dpr = dpr.clamp(0.5, 4.0);
            self.css_w = css_w;
            self.css_h = css_h;
            self.dpr = dpr;
            self.canvas.set_width((css_w * dpr).round() as u32);
            self.canvas.set_height((css_h * dpr).round() as u32);
            self.unit = SHORT_SIDE_UNITS / css_w.min(css_h);
            self.sim.set_view(css_w * self.unit, css_h * self.unit);
        }

        /// Start a round. See API.md for the config schema. Config warnings
        /// arrive as `warning` events.
        pub fn start_round(&mut self, config_json: &str) -> Result<(), JsValue> {
            let cfg = RoundConfig::from_json_str(config_json).map_err(|e| JsValue::from_str(&e))?;
            self.sim.start_round(cfg);
            Ok(())
        }

        /// End the current round early; emits `round_end` with `aborted: true`.
        pub fn stop_round(&mut self) {
            self.sim.stop_round();
        }

        /// Change speed inputs live (keys not given keep their value).
        /// `{"x": 2.5}` fixes the speed index (debug).
        pub fn set_speed_params(&mut self, json: &str) -> Result<(), JsValue> {
            let s = SpeedInput::from_json_str(json, &self.sim.cfg.speed).map_err(|e| JsValue::from_str(&e))?;
            self.sim.set_speed(s);
            Ok(())
        }

        /// Set the charged number (`undefined`/`null` = none).
        pub fn set_charged(&mut self, n: Option<i32>) {
            self.sim.set_charged(n);
        }

        pub fn charged(&self) -> Option<i32> {
            self.sim.charged
        }

        /// Calm effects: shake × 0.25, no full-screen flashes, particles × 0.5.
        pub fn set_calm(&mut self, calm: bool) {
            self.sim.set_calm(calm);
        }

        /// `{"blade":"<id>","trail":"<id>"}`; either key optional. Unknown ids
        /// are ignored with a console warning.
        pub fn set_cosmetics(&mut self, json: &str) -> Result<(), JsValue> {
            let (b, t, w) = crate::parse_cosmetics(json).map_err(|e| JsValue::from_str(&e))?;
            for m in w {
                warn(&format!("mathmissile: {m}"));
            }
            self.sim.set_cosmetics(b, t);
            Ok(())
        }

        /// Fly-to targets in CSS px relative to the canvas: "sparks", "island".
        pub fn set_anchor(&mut self, name: &str, x: f32, y: f32) {
            let p = self.to_world(x, y);
            self.sim.set_anchor(name, p);
        }

        pub fn species_ids(&self) -> String {
            let ids = all_species_ids();
            crate::json_str_array(ids.iter().map(|s| s.as_str()))
        }

        pub fn blade_ids(&self) -> String {
            crate::json_str_array(BLADES.iter().map(|b| b.id))
        }

        pub fn trail_ids(&self) -> String {
            crate::json_str_array(TRAILS.iter().map(|t| t.id))
        }

        /// Pointer coordinates are CSS pixels relative to the canvas' top-left.
        /// `t` (event.timeStamp) is accepted for future use.
        pub fn pointer_down(&mut self, x: f32, y: f32, _t: f64) {
            let p = self.to_world(x, y);
            self.sim.pointer_down(p);
        }

        pub fn pointer_move(&mut self, x: f32, y: f32, _t: f64) {
            let p = self.to_world(x, y);
            self.sim.pointer_move(p);
        }

        pub fn pointer_up(&mut self, x: f32, y: f32, _t: f64) {
            let p = self.to_world(x, y);
            self.sim.pointer_up(p);
        }

        pub fn pointer_cancel(&mut self) {
            self.sim.pointer_cancel();
        }

        /// Advance by `dt_ms` (fixed 120 Hz steps inside) and render.
        /// While the WebGL context is lost nothing advances, so monsters can't
        /// escape off a black screen.
        pub fn frame(&mut self, dt_ms: f64) {
            if self.gl_lost || self.renderer.is_context_lost() {
                return;
            }
            self.sim.advance((dt_ms / 1000.0) as f32);
            draw::build(&self.sim, &self.glyphs, &mut self.writer);
            let cam = self.sim.shake_offset;
            self.renderer.draw(
                &self.writer,
                self.canvas.width() as i32,
                self.canvas.height() as i32,
                (self.sim.view.x, self.sim.view.y),
                (cam.x, cam.y),
                self.sim.time,
                [0.08, 0.06, 0.2, 1.0],
            );
        }

        /// Call from `webglcontextlost` (after `preventDefault()`): holds the
        /// sim and drops the current stroke.
        pub fn context_lost(&mut self) {
            self.gl_lost = true;
            self.sim.pointer_cancel();
        }

        /// Call from `webglcontextrestored`: rebuilds program, buffers and the
        /// glyph atlas, then lets the sim run again. Throws if the rebuild fails.
        pub fn context_restored(&mut self) -> Result<(), JsValue> {
            self.renderer.restore()?;
            self.gl_lost = false;
            Ok(())
        }

        pub fn is_context_lost(&self) -> bool {
            self.gl_lost || self.renderer.is_context_lost()
        }

        /// Pending events as a JSON array string; "" when there are none.
        pub fn drain_events(&mut self) -> String {
            self.sim.drain_events_json()
        }

        pub fn set_paused(&mut self, paused: bool) {
            self.sim.paused = paused;
        }

        /// Particle-count multiplier (e.g. 0.5 on slow devices). 0..2.
        pub fn set_effects_scale(&mut self, s: f32) {
            self.sim.effects_scale = s.clamp(0.0, 2.0);
        }

        /// "idle" | "playing" | "draining" | "ended"
        pub fn round_state(&self) -> String {
            use crate::sim::RoundState::*;
            match self.sim.round {
                Idle => "idle",
                Playing => "playing",
                Draining => "draining",
                Ended => "ended",
            }
            .into()
        }

        pub fn score(&self) -> u32 {
            self.sim.score
        }

        pub fn combo(&self) -> u32 {
            self.sim.combo
        }

        /// Seconds of round time elapsed.
        pub fn round_time(&self) -> f32 {
            self.sim.round_time
        }

        /// Current speed index x.
        pub fn speed_x(&self) -> f32 {
            self.sim.x()
        }

        /// Debug counters as JSON.
        pub fn stats(&self) -> String {
            format!(
                "{{\"instances\":{},\"particles\":{},\"monsters\":{},\"friends\":{},\"flyers\":{},\"x\":{:.3},\"offset\":{:.3},\"view_w\":{},\"view_h\":{},\"px_w\":{},\"px_h\":{}}}",
                self.writer.count,
                self.sim.particles.items.len(),
                self.sim.monsters.len(),
                self.sim.friends.len(),
                self.sim.flyers.len(),
                self.sim.x(),
                self.sim.adaptive.offset,
                self.sim.view.x,
                self.sim.view.y,
                self.canvas.width(),
                self.canvas.height()
            )
        }

        /// Monsters on screen as JSON (positions in CSS px, for tests/tutorials):
        /// `[{"id":1,"x":..,"y":..,"r":..,"answerable":true,"state":"flying",
        ///    "species":"bloop","shiny":false,"special":null,"fact":{..}}]`
        pub fn monsters(&self) -> String {
            use std::fmt::Write;
            let mut out = String::from("[");
            for (i, m) in self.sim.monsters.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                let state = match m.state {
                    MState::Flying => "flying",
                    MState::Revealed => "revealed",
                    MState::Popping => "popping",
                };
                let _ = write!(
                    out,
                    "{{\"id\":{},\"x\":{:.1},\"y\":{:.1},\"r\":{:.1},\"answerable\":{},\"state\":\"{}\",\"species\":\"",
                    m.id,
                    m.pos.x / self.unit,
                    self.css_h - m.pos.y / self.unit,
                    m.radius / self.unit,
                    m.state != MState::Popping,
                    state
                );
                m.species.write_id(&mut out);
                let _ = write!(out, "\",\"shiny\":{},\"golden\":{},\"mini\":{},\"minion\":{},\"special\":", m.slot.shiny, m.golden, m.mini, m.minion);
                match m.slot.special.name() {
                    Some(s) => {
                        let _ = write!(out, "\"{s}\"");
                    }
                    None => out.push_str("null"),
                }
                out.push_str(",\"fact\":");
                m.fact.write_json(&mut out);
                out.push('}');
            }
            out.push(']');
            out
        }

        /// Debug/benchmark: burst `n` particles at the screen centre.
        pub fn debug_burst(&mut self, n: u32) {
            use crate::particles::{kind, Particle};
            use crate::vec2::Vec2;
            let c = v2(self.sim.view.x * 0.5, self.sim.view.y * 0.5);
            for i in 0..n {
                let a = i as f32 * 2.399;
                let sp = 200.0 + (i % 97) as f32 * 9.0;
                self.sim.particles.spawn(Particle {
                    pos: c,
                    vel: Vec2::from_angle(a) * sp,
                    gravity: 600.0,
                    drag: 0.5,
                    life: 2.5,
                    max_life: 2.5,
                    size0: 14.0,
                    size1: 2.0,
                    color: [1.0, 0.7 + 0.3 * (a.sin()), 0.4, 0.9],
                    kind: if i % 3 == 0 { kind::STAR } else { kind::SOFT },
                    additive: true,
                    rot: a,
                    spin: 3.0,
                    ..Default::default()
                });
            }
        }
    }

    impl Game {
        fn to_world(&self, x: f32, y: f32) -> crate::vec2::Vec2 {
            v2(x * self.unit, (self.css_h - y) * self.unit)
        }
    }

    /// Draws Monster Book portraits onto its own (offscreen) canvas.
    #[wasm_bindgen]
    pub struct Portrait {
        renderer: Renderer,
        writer: InstanceWriter,
        canvas: HtmlCanvasElement,
    }

    #[wasm_bindgen]
    impl Portrait {
        #[wasm_bindgen(constructor)]
        pub fn new(canvas: HtmlCanvasElement) -> Result<Portrait, JsValue> {
            let renderer = Renderer::new(&canvas, true)?;
            Ok(Portrait { renderer, writer: InstanceWriter::new(), canvas })
        }

        /// Draw one species and return a PNG data URL. Options JSON:
        /// `{"species":"bloop","size":256,"shiny":false,"silhouette":false,"mood":"happy"}`.
        pub fn draw(&mut self, json: &str) -> Result<String, JsValue> {
            let o = crate::parse_portrait(json).map_err(|e| JsValue::from_str(&e))?;
            let size = crate::json::parse(json).ok().and_then(|v| v.get("size").and_then(|s| s.as_f64())).unwrap_or(256.0).clamp(16.0, 2048.0) as u32;
            if self.canvas.width() != size || self.canvas.height() != size {
                self.canvas.set_width(size);
                self.canvas.set_height(size);
            }
            if self.renderer.is_context_lost() {
                // engine.js makes a fresh Portrait (new canvas) on this error.
                return Err(JsValue::from_str("WebGL context lost"));
            }
            let world = 512.0;
            draw::build_portrait(&o, world, &mut self.writer);
            self.renderer.draw(&self.writer, size as i32, size as i32, (world, world), (0.0, 0.0), o.time, [0.0, 0.0, 0.0, 0.0]);
            self.canvas.to_data_url()
        }
    }
}
