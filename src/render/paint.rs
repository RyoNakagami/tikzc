//! SVG stroke, fill and pattern styling.
use super::Engine;
use crate::options::{Values, dim, get, length};

impl Engine<'_> {
    pub(super) fn paint(&self, o: &Values, path: bool) -> Result<String, String> {
        let draw = if o.contains_key("draw") || path {
            let s = get(o, "draw", "");
            self.state.styles.color(if s.is_empty() {
                get(o, "draw color", "black")
            } else {
                s
            })?
        } else {
            "none".into()
        };
        let fill = if let Some(pattern) = o.get("pattern") {
            let motif = match pattern.as_str() {
                "north east lines" => "<path d=\"M -1,1 L 4,-4 M -1,4 L 4,-1 M -1,7 L 4,2\"/>",
                "north west lines" => "<path d=\"M -1,2 L 4,7 M -1,-1 L 4,4 M -1,-4 L 4,1\"/>",
                "horizontal lines" => "<path d=\"M 0,1.5 L 3,1.5\"/>",
                "vertical lines" => "<path d=\"M 1.5,0 L 1.5,3\"/>",
                "grid" => "<path d=\"M 1.5,0 L 1.5,3 M 0,1.5 L 3,1.5\"/>",
                "crosshatch" => {
                    "<path d=\"M -1,-1 L 4,4 M -1,2 L 4,7 M -1,-4 L 4,1 M -1,4 L 4,-1 M -1,1 L 4,-4 M -1,7 L 4,2\"/>"
                }
                "dots" => "<circle cx=\"1.5\" cy=\"1.5\" r=\"0.5\" stroke=\"none\"/>",
                _ => return Err(format!("Unsupported pattern '{pattern}'")),
            };
            let color = self.state.styles.color(get(o, "pattern color", "black"))?;
            let mut defs = self.definitions.borrow_mut();
            let id = format!("pattern-{}", defs.len());
            defs.push(format!("<pattern id=\"{id}\" patternUnits=\"userSpaceOnUse\" width=\"3\" height=\"3\"><g fill=\"{color}\" stroke=\"{color}\" stroke-width=\"0.4\">{motif}</g></pattern>"));
            format!("url(#{id})")
        } else if o.contains_key("fill") {
            let s = get(o, "fill", "");
            self.state.styles.color(if s.is_empty() {
                get(o, "draw color", "black")
            } else {
                s
            })?
        } else {
            "none".into()
        };
        let mut width = 0.4 * 72. / 72.27;
        for (k, v) in [
            ("ultra thin", 0.1),
            ("very thin", 0.2),
            ("thin", 0.4),
            ("semithick", 0.6),
            ("thick", 0.8),
            ("very thick", 1.2),
            ("ultra thick", 1.6),
        ] {
            if o.contains_key(k) {
                width = v * 72. / 72.27;
            }
        }
        width = dim(o, "line width", width)?;
        let mut dash = String::new();
        for (k, v) in [
            ("dashed", "3,3"),
            ("densely dashed", "3,2"),
            ("loosely dashed", "3,6"),
            ("dotted", "0.5,2"),
            ("densely dotted", "0.5,1"),
            ("loosely dotted", "0.5,4"),
        ] {
            if o.contains_key(k) {
                dash = format!(" stroke-dasharray=\"{v}\"");
            }
        }
        if o.contains_key("solid") {
            dash.clear();
        }
        if let Some(pattern) = o.get("dash pattern") {
            let parts: Vec<_> = pattern.split_whitespace().collect();
            let mut lengths = Vec::new();
            for pair in parts.chunks(2) {
                if pair.len() != 2 || !["on", "off"].contains(&pair[0]) {
                    return Err("invalid dash pattern".into());
                }
                lengths.push(length(pair[1], 1.)?.to_string());
            }
            dash = format!(" stroke-dasharray=\"{}\"", lengths.join(","));
        }
        let cap = match get(o, "line cap", "butt") {
            "butt" => "butt",
            "round" => "round",
            "rect" | "square" => "square",
            v => return Err(format!("Unsupported line cap '{v}'")),
        };
        let join = match get(o, "line join", "round") {
            "miter" => "miter",
            "round" => "round",
            "bevel" => "bevel",
            v => return Err(format!("Unsupported line join '{v}'")),
        };
        // Inherited defaults are established once on the root SVG. Scope
        // options are resolved per element; wrapper groups only transform/clip.
        let mut attributes = format!(
            "stroke=\"{draw}\" fill=\"{fill}\" stroke-width=\"{width}\" stroke-linejoin=\"{join}\"{dash}"
        );
        if cap != "butt" {
            attributes.push_str(&format!(" stroke-linecap=\"{cap}\""));
        }
        for (name, option) in [
            ("opacity", "opacity"),
            ("fill-opacity", "fill opacity"),
            ("stroke-opacity", "draw opacity"),
        ] {
            attributes.push_str(&opacity_attribute(name, dim(o, option, 1.)?));
        }
        if o.contains_key("even odd rule") {
            attributes.push_str(" fill-rule=\"evenodd\"");
        }
        Ok(attributes)
    }
}

pub(super) fn opacity_attribute(name: &str, value: f64) -> String {
    if value == 1. {
        String::new()
    } else {
        format!(" {name}=\"{value}\"")
    }
}

pub(super) fn line_width(o: &Values) -> Result<f64, String> {
    let mut width = 0.4;
    for (k, v) in [
        ("ultra thin", 0.1),
        ("very thin", 0.2),
        ("thin", 0.4),
        ("semithick", 0.6),
        ("thick", 0.8),
        ("very thick", 1.2),
        ("ultra thick", 1.6),
    ] {
        if o.contains_key(k) {
            width = v;
        }
    }
    dim(o, "line width", width * 72. / 72.27)
}
