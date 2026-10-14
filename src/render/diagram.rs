//! Public render artifact and rasterization of its SVG.
use super::Node;
use std::collections::BTreeMap;

pub struct Diagram {
    pub svg: String,
    pub width: f64,
    pub height: f64,
    pub nodes: BTreeMap<String, Node>,
    /// Label source of every `node`, in document order (after expansion).
    pub labels: Vec<String>,
    pub editing: serde_json::Value,
    pub text_timings: crate::text::TextTimings,
}
impl Diagram {
    pub fn png(&self, dpi: f64) -> Result<Vec<u8>, String> {
        if !dpi.is_finite() || dpi <= 0. {
            return Err("DPI must be finite and positive".into());
        }
        let scale = dpi / 72.;
        let w = (self.width * scale).ceil();
        let h = (self.height * scale).ceil();
        if w * h > 100_000_000. || w > 32768. || h > 32768. {
            return Err("PNG exceeds 100 megapixels or 32768 pixels per axis".into());
        }
        let tree = resvg::usvg::Tree::from_str(&self.svg, &Default::default())
            .map_err(|e| e.to_string())?;
        let mut pixmap = resvg::tiny_skia::Pixmap::new(w.max(1.) as u32, h.max(1.) as u32)
            .ok_or("cannot allocate PNG")?;
        pixmap.fill(resvg::tiny_skia::Color::WHITE);
        resvg::render(
            &tree,
            resvg::tiny_skia::Transform::from_scale((dpi / 96.) as f32, (dpi / 96.) as f32),
            &mut pixmap.as_mut(),
        );
        pixmap.encode_png().map_err(|e| e.to_string())
    }
}
