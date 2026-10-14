//! Linear (axis) and radial shadings as SVG gradients.
use super::Engine;
use crate::options::{Values, get};

const AXIS_KEYS: [&str; 4] = ["left color", "right color", "top color", "bottom color"];
const RADIAL_KEYS: [&str; 2] = ["inner color", "outer color"];

/// `\shade`, `\shadedraw`, the `shade` key, or any shading colour.
pub(super) fn requested(command: &str, o: &Values) -> bool {
    command == "shade"
        || command == "shadedraw"
        || (o.contains_key("shade") && get(o, "shade", "") != "false")
        || AXIS_KEYS
            .iter()
            .chain(&RADIAL_KEYS)
            .any(|k| o.contains_key(*k))
}

impl Engine<'_> {
    /// Define the gradient for a path and return its `url(#id)` paint.
    ///
    /// PGF fits a shading to the bounding box of the path: an axis shading
    /// runs linearly from one edge to the opposite one, and a radial shading
    /// reaches its outer colour at the middle of each edge. (Measured on
    /// lualatex/PGF 3.1.10 output; see `tests/ds_paint.rs`.)
    pub(super) fn shading(&self, d: &str, o: &Values) -> Result<Option<String>, String> {
        if o.contains_key("shading angle") {
            self.fail_at_option("shading angle");
            return Err("Unsupported shading angle (use left/right or top/bottom colors)".into());
        }
        let horizontal = o.contains_key("left color") || o.contains_key("right color");
        let vertical = o.contains_key("top color") || o.contains_key("bottom color");
        let mut radial = RADIAL_KEYS.iter().any(|k| o.contains_key(*k));
        if [horizontal, vertical, radial]
            .iter()
            .filter(|b| **b)
            .count()
            > 1
        {
            return Err(
                "Unsupported mix of left/right, top/bottom and inner/outer shading colors".into(),
            );
        }
        match get(o, "shading", "") {
            "" => {}
            "axis" if !radial => {}
            "radial" if !horizontal && !vertical => radial = true,
            name => {
                self.fail_at_option("shading");
                return Err(format!(
                    "Unsupported shading '{name}' (axis and radial with matching colors are supported)"
                ));
            }
        }
        if radial && o.contains_key("middle color") {
            self.fail_at_option("middle color");
            return Err("Unsupported middle color on a radial shading".into());
        }
        // TikZ's defaults: gray towards white.
        let (first, last) = if radial {
            ("inner color", "outer color")
        } else if horizontal {
            ("left color", "right color")
        } else {
            ("top color", "bottom color")
        };
        let color = |key: &str, default: &str| -> Result<String, String> {
            match self.state.styles.color(get(o, key, default)) {
                Ok(c) if c != "none" => Ok(c),
                Ok(_) => Err(format!("{key} must be a color")),
                Err(e) => Err(e),
            }
            .inspect_err(|_| self.fail_at_option(key))
        };
        let mut stops = vec![(0., color(first, "gray")?)];
        if o.contains_key("middle color") {
            stops.push((0.5, color("middle color", "white")?));
        }
        stops.push((1., color(last, "white")?));
        // Bounding box of the path including Bezier control points, as PGF.
        let numbers: Vec<f64> = d
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter_map(|w| w.parse().ok())
            .collect();
        let range = |offset: usize| {
            numbers
                .iter()
                .skip(offset)
                .step_by(2)
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), v| {
                    (lo.min(*v), hi.max(*v))
                })
        };
        let (left, right) = range(0);
        let (top, bottom) = range(1);
        if !(right - left > 1e-9 && bottom - top > 1e-9) {
            return Ok(None);
        }
        let stops: String = stops
            .iter()
            .map(|(offset, color)| format!("<stop offset=\"{offset}\" stop-color=\"{color}\"/>"))
            .collect();
        let mut defs = self.definitions.borrow_mut();
        let id = format!("shade-{}", defs.len());
        defs.push(if radial {
            format!(
                "<radialGradient id=\"{id}\" gradientUnits=\"userSpaceOnUse\" cx=\"0\" cy=\"0\" r=\"1\" gradientTransform=\"translate({:.5},{:.5}) scale({:.5},{:.5})\">{stops}</radialGradient>",
                (left + right) / 2.,
                (top + bottom) / 2.,
                (right - left) / 2.,
                (bottom - top) / 2.
            )
        } else if horizontal {
            format!(
                "<linearGradient id=\"{id}\" gradientUnits=\"userSpaceOnUse\" x1=\"{left:.5}\" y1=\"0\" x2=\"{right:.5}\" y2=\"0\">{stops}</linearGradient>"
            )
        } else {
            format!(
                "<linearGradient id=\"{id}\" gradientUnits=\"userSpaceOnUse\" x1=\"0\" y1=\"{top:.5}\" x2=\"0\" y2=\"{bottom:.5}\">{stops}</linearGradient>"
            )
        });
        Ok(Some(format!("url(#{id})")))
    }
}
