//! Id tables shared with the shell: species (DESIGN §5.3), blades and trails
//! (§5.5). Colours match `web/js/logic/catalog.js`. Shape numbers select the
//! drawing code in `shaders.rs` (`body()`), so keep the two in step.

pub type Rgb = [f32; 3];

const fn hex(c: u32) -> Rgb {
    [((c >> 16) & 255) as f32 / 255.0, ((c >> 8) & 255) as f32 / 255.0, (c & 255) as f32 / 255.0]
}

#[derive(Clone, Copy, Debug)]
pub struct Species {
    pub id: &'static str,
    pub name: &'static str,
    /// Shader shape id.
    pub shape: u8,
    pub color: Rgb,
    pub color2: Rgb,
}

const fn sp(id: &'static str, name: &'static str, shape: u8, c1: u32, c2: u32) -> Species {
    Species { id, name, shape, color: hex(c1), color2: hex(c2) }
}

/// 24 base species, then the 4 specials. Index = species number used in the sim.
pub const SPECIES: [Species; 28] = [
    sp("bloop", "Bloop", 0, 0x5ad1ff, 0x2a8fd6),
    sp("snibbet", "Snibbet", 1, 0xffd45a, 0xff9f43),
    sp("pebbit", "Pebbit", 2, 0x7bd88f, 0x3fa65a),
    sp("duodle", "Duodle", 3, 0xffa3d7, 0xe05fae),
    sp("fluffnik", "Fluffnik", 4, 0xf4f1ff, 0xb8b0e8),
    sp("tenzel", "Tenzel", 5, 0x9be15d, 0x4fb34a),
    sp("quillip", "Quillip", 6, 0xc79a6b, 0x8d6340),
    sp("fivvy", "Fivvy", 7, 0xff8a65, 0xe8553a),
    sp("mossnug", "Mossnug", 8, 0x8fcf5a, 0x5f9a35),
    sp("trillo", "Trillo", 9, 0xb388ff, 0x7c4dff),
    sp("zigglet", "Zigglet", 10, 0xff7eb6, 0xd94c8a),
    sp("puffwhirl", "Puffwhirl", 11, 0xfff59d, 0xf0c419),
    sp("glimmop", "Glimmop", 12, 0xffe082, 0xffb300),
    sp("quadbun", "Quadbun", 13, 0xf8bbd0, 0xec7fa9),
    sp("drizzlewing", "Drizzlewing", 14, 0x80deea, 0x3aa6b9),
    sp("ninoo", "Ninoo", 15, 0xbcaaa4, 0x8d6e63),
    sp("crumbit", "Crumbit", 16, 0xe0a96d, 0xa86b32),
    sp("wobblehorn", "Wobblehorn", 17, 0xce93d8, 0x9c4dcc),
    sp("gloomp", "Gloomp", 18, 0x7e7fd6, 0x4b4ca3),
    sp("ochtle", "Ochtle", 19, 0xff8a80, 0xe05252),
    sp("flutterknot", "Flutterknot", 20, 0x4dd0e1, 0xff80ab),
    sp("sevvle", "Sevvle", 21, 0xffab40, 0xe67e22),
    sp("grumblebun", "Grumblebun", 22, 0xd7b98e, 0xa3804f),
    sp("dozzle", "Dozzle", 23, 0x69f0ae, 0x22b573),
    sp("goldfluff", "Goldfluff", 24, 0xffd700, 0xffb300),
    sp("clonkshell", "Clonkshell", 25, 0x90a4ae, 0x546e7a),
    sp("splitsy", "Splitsy", 26, 0xb2ff59, 0x64dd17),
    sp("chillby", "Chillby", 27, 0xb3e5fc, 0x4fc3f7),
];

pub const SP_GOLDFLUFF: u8 = 24;
pub const SP_CLONKSHELL: u8 = 25;
pub const SP_SPLITSY: u8 = 26;
pub const SP_CHILLBY: u8 = 27;
pub const NUM_BASE: u8 = 24;

/// Species A of each island (the ones with a Grand form), path order is not
/// needed here: `grand_<id>` is valid for exactly these.
pub const GRAND_BASES: [&str; 12] =
    ["bloop", "pebbit", "fluffnik", "quillip", "mossnug", "zigglet", "glimmop", "drizzlewing", "crumbit", "gloomp", "flutterknot", "grumblebun"];

/// A species reference: index into `SPECIES` plus the Grand flag.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct SpeciesRef {
    pub idx: u8,
    pub grand: bool,
}

impl SpeciesRef {
    pub fn info(&self) -> &'static Species {
        &SPECIES[self.idx as usize % SPECIES.len()]
    }

    pub fn write_id(&self, out: &mut String) {
        if self.grand {
            out.push_str("grand_");
        }
        out.push_str(self.info().id);
    }
}

/// Parse a species id (`bloop`, `grand_bloop`, `goldfluff`, ...).
pub fn species_by_id(id: &str) -> Option<SpeciesRef> {
    if let Some(base) = id.strip_prefix("grand_") {
        if !GRAND_BASES.contains(&base) {
            return None;
        }
        let i = SPECIES.iter().position(|s| s.id == base)?;
        return Some(SpeciesRef { idx: i as u8, grand: true });
    }
    let i = SPECIES.iter().position(|s| s.id == id)?;
    Some(SpeciesRef { idx: i as u8, grand: false })
}

/// All valid species ids, comma-free list for the JS side.
pub fn all_species_ids() -> Vec<String> {
    let mut v: Vec<String> = SPECIES.iter().map(|s| s.id.to_string()).collect();
    v.extend(GRAND_BASES.iter().map(|b| format!("grand_{b}")));
    v
}

// ------------------------------------------------------------------ blades

/// Blade shape families drawn by the shader (`blade()`).
pub mod family {
    pub const WAND: u8 = 0;
    pub const SWORD: u8 = 1;
    pub const LEAF: u8 = 2;
    pub const FEATHER: u8 = 3;
    pub const CARROT: u8 = 4;
    pub const ICICLE: u8 = 5;
    pub const LIGHTNING: u8 = 6;
    pub const CRYSTAL: u8 = 7;
}

/// Blade patterns: 0 plain, 1 stripes, 2 rainbow, 3 sparkle.
#[derive(Clone, Copy, Debug)]
pub struct BladeSkin {
    pub id: &'static str,
    pub family: u8,
    pub pattern: u8,
    pub color: Rgb,
    pub color2: Rgb,
    /// Shard colour when the blade breaks.
    pub shard: Rgb,
}

const fn bl(id: &'static str, family: u8, pattern: u8, c1: u32, c2: u32, shard: u32) -> BladeSkin {
    BladeSkin { id, family, pattern, color: hex(c1), color2: hex(c2), shard: hex(shard) }
}

pub const BLADES: [BladeSkin; 13] = [
    bl("starter_wand", family::WAND, 0, 0xffe066, 0xa0703c, 0xcfe8ff),
    bl("leaf_blade", family::LEAF, 0, 0x7ed957, 0x3f8f2f, 0xb8f0a0),
    bl("candy_swirl", family::SWORD, 1, 0xff7eb6, 0xffffff, 0xffc2dc),
    bl("crystal", family::CRYSTAL, 3, 0x9be7ff, 0xe8fbff, 0xc8f2ff),
    bl("rainbow_ribbon", family::SWORD, 2, 0xff6b6b, 0xffffff, 0xffe3a0),
    bl("starlight", family::WAND, 3, 0xfff6c2, 0xd8d8ff, 0xfff6c2),
    bl("carrot_sword", family::CARROT, 0, 0xff9a3c, 0x5cc85a, 0xffc48a),
    bl("feather_quill", family::FEATHER, 0, 0xf4f7ff, 0x8fb8ff, 0xffffff),
    bl("icicle", family::ICICLE, 3, 0xcff4ff, 0x7fd4ff, 0xdff8ff),
    bl("golden_blade", family::SWORD, 3, 0xffd34d, 0xb8860b, 0xffe9a0),
    bl("lightning_rod", family::LIGHTNING, 0, 0xfff23d, 0xffffff, 0xfff7a0),
    bl("summit_blade", family::SWORD, 3, 0xe8f3ff, 0x6aa8ff, 0xffffff),
    bl("shore_saber", family::SWORD, 1, 0x4dd0e1, 0xffe0b2, 0xbff3f8),
];

// ------------------------------------------------------------------ trails

/// What a trail emits besides its ribbon.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrailFx {
    None,
    Sparkle,
    /// An icon (ids in `icon`), with fall speed behaviour.
    Icon(u8),
    Confetti,
    Embers,
    Motes,
}

#[derive(Clone, Copy, Debug)]
pub struct TrailSkin {
    pub id: &'static str,
    pub color: Rgb,
    /// Ribbon width multiplier.
    pub width: f32,
    pub rainbow: bool,
    pub fx: TrailFx,
}

/// Icon ids drawn by the shader's ICON kind.
pub mod icon {
    pub const HEART: u8 = 0;
    pub const COIN: u8 = 1;
    pub const LANTERN: u8 = 2;
    pub const NOTE: u8 = 3;
    pub const LEAF: u8 = 4;
    pub const SNOWFLAKE: u8 = 5;
    pub const PAW: u8 = 6;
    pub const BUBBLE: u8 = 7;
    pub const HAND: u8 = 8;
    pub const CLOUD: u8 = 9;
    pub const PIXEL_STAR: u8 = 10;
    pub const STICKER: u8 = 11;
    pub const CRACK: u8 = 12;
    pub const SPARKLE: u8 = 13;
    pub const HEART_EMPTY: u8 = 14;
    pub const SNOWFLAKE_BIG: u8 = 15;
}

const fn tr(id: &'static str, c: u32, width: f32, rainbow: bool, fx: TrailFx) -> TrailSkin {
    TrailSkin { id, color: hex(c), width, rainbow, fx }
}

pub const TRAILS: [TrailSkin; 13] = [
    tr("plain", 0x8cd9ff, 1.0, false, TrailFx::None),
    tr("sparkle", 0xffe680, 1.0, false, TrailFx::Sparkle),
    tr("bubbles", 0x9fe8ff, 1.0, false, TrailFx::Icon(icon::BUBBLE)),
    tr("hearts", 0xff8fc8, 1.0, false, TrailFx::Icon(icon::HEART)),
    tr("music_notes", 0xc59bff, 1.0, false, TrailFx::Icon(icon::NOTE)),
    tr("comet_tail", 0xffa24d, 1.6, false, TrailFx::Embers),
    tr("falling_leaves", 0x9ad66b, 1.0, false, TrailFx::Icon(icon::LEAF)),
    tr("snowflakes", 0xd6f4ff, 1.0, false, TrailFx::Icon(icon::SNOWFLAKE)),
    tr("paw_prints", 0xf2c6a0, 1.0, false, TrailFx::Icon(icon::PAW)),
    tr("confetti", 0xffd166, 1.0, false, TrailFx::Confetti),
    tr("pixel_stars", 0x7df9ff, 1.0, false, TrailFx::Icon(icon::PIXEL_STAR)),
    tr("rainbow", 0xffffff, 1.3, true, TrailFx::Sparkle),
    tr("moss_glow", 0x7dff8a, 1.3, false, TrailFx::Motes),
];

pub fn blade_by_id(id: &str) -> Option<u8> {
    BLADES.iter().position(|b| b.id == id).map(|i| i as u8)
}

pub fn trail_by_id(id: &str) -> Option<u8> {
    TRAILS.iter().position(|t| t.id == id).map(|i| i as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_resolve() {
        assert_eq!(species_by_id("bloop"), Some(SpeciesRef { idx: 0, grand: false }));
        assert_eq!(species_by_id("grand_gloomp").map(|s| (s.info().id, s.grand)), Some(("gloomp", true)));
        assert_eq!(species_by_id("grand_snibbet"), None, "only species A have a Grand form");
        assert_eq!(species_by_id("chillby").map(|s| s.idx), Some(SP_CHILLBY));
        assert_eq!(all_species_ids().len(), 40);
        assert_eq!(blade_by_id("shore_saber"), Some(12));
        assert_eq!(trail_by_id("moss_glow"), Some(12));
        assert_eq!(blade_by_id("nope"), None);
        let mut s = String::new();
        species_by_id("grand_bloop").unwrap().write_id(&mut s);
        assert_eq!(s, "grand_bloop");
        for (i, s) in SPECIES.iter().enumerate() {
            assert_eq!(s.shape as usize, i, "shape ids follow table order");
        }
    }
}
