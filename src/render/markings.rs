//! `decorations.markings`: `mark=at position <p> with {<code>}`, where the
//! code is `\arrow{tip}`, `\node ... ;` or a `\fill`/`\draw` path.
use super::{Engine, Point};
use crate::options::{Values, get, has_unit, length, number};
use crate::syntax::{Cursor, split_top, unbrace};
use crate::transform::Matrix;

const MAX_MARKS: usize = 1_000;

impl Engine<'_> {
    /// Draw the marks of `decoration` along the path `d`. `options` are the
    /// decorated path's, `outer` those of the enclosing scope.
    pub(super) fn markings(
        &mut self,
        d: &str,
        decoration: &str,
        options: &Values,
        outer: &Values,
    ) -> Result<(), String> {
        self.fail_at_option("decoration");
        if self.synthetic {
            return Err("Unsupported nested markings".into());
        }
        let error_at = self.error_at.get();
        let path = crate::curve::Path::parse(d)
            .map_err(|_| "Unsupported markings on a closed, empty or multi-part path")?;
        let total = path.length();
        let mut marks = Vec::new();
        for part in split_top(decoration, ',').into_iter().skip(1) {
            let (key, value) = part.split_once('=').unwrap_or((part, ""));
            if key.trim() != "mark" {
                return Err(format!(
                    "Unsupported markings option '{}' (only mark=at position ... with {{...}})",
                    key.trim()
                ));
            }
            let (position, code) = value
                .trim()
                .strip_prefix("at position")
                .and_then(|rest| rest.split_once("with"))
                .ok_or("Unsupported mark (only 'at position <p> with {...}')")?;
            let code = code.trim();
            if !code.starts_with('{') || unbrace(code).len() == code.len() {
                return Err("mark code must be one braced group".into());
            }
            // A plain number is a fraction of the path, a length a distance;
            // negative values count back from the end.
            let position = position.trim();
            let mut distance = if has_unit(position) {
                length(position, 1.)?
            } else {
                number(position)? * total
            };
            if distance < 0. {
                distance += total;
            }
            if !(-1e-6..=total + 1e-6).contains(&distance) {
                return Err(format!("mark position '{position}' is outside the path"));
            }
            if marks.len() >= MAX_MARKS {
                return Err(format!("markings exceed {MAX_MARKS} marks"));
            }
            marks.push((distance, unbrace(code)));
        }
        if marks.is_empty() {
            return Err("markings needs at least one mark".into());
        }
        // Mark code starts from the scope's options, but the decorated path's
        // colour and line width stay in effect, as within its TeX group.
        let mut base = outer.clone();
        for key in [
            "draw color",
            "text",
            "line width",
            "ultra thin",
            "very thin",
            "thin",
            "semithick",
            "thick",
            "very thick",
            "ultra thick",
        ] {
            if let Some(value) = options.get(key) {
                base.insert(key.into(), value.clone());
            }
        }
        let saved = self.state.clone();
        let synthetic = std::mem::replace(&mut self.synthetic, true);
        let result = (|| -> Result<(), String> {
            for (distance, code) in marks {
                let (p, tangent) = path.at(distance);
                let point = Point { x: p.0, y: p.1 };
                let norm = tangent.0.hypot(tangent.1);
                if norm < 1e-10 {
                    return Err("cannot orient a mark on a degenerate path".into());
                }
                let (cos, sin) = (tangent.0 / norm, tangent.1 / norm);
                // The mark's coordinate system: origin on the path, x along
                // it. Enclosing scales do not apply, as in PGF.
                let mut local = base.clone();
                Matrix([cos, sin, -sin, cos, point.x, point.y]).store(&mut local);
                let mut cur = Cursor::new(code);
                loop {
                    cur.ws();
                    if cur.rest().is_empty() {
                        break;
                    }
                    if !cur.eat("\\") {
                        return Err("mark code must consist of commands".into());
                    }
                    match cur.word() {
                        "arrow" => {
                            cur.ws();
                            if cur.rest().starts_with('[') {
                                return Err("Unsupported options on \\arrow in a marking".into());
                            }
                            let spec = cur.group('{', '}')?.trim();
                            let arrow = crate::arrows::Arrow::parse(if spec == ">" {
                                get(options, ">", "Latex")
                            } else {
                                spec
                            })?;
                            // The tip of the arrow sits at the mark position.
                            let behind = point.sub(Point { x: cos, y: sin });
                            self.arrow(point, behind, options, &arrow)?;
                            cur.eat(";");
                        }
                        "node" => {
                            self.state.options = local.clone();
                            let pending = self.parse_node(&mut cur, true)?;
                            if pending.point.is_some() {
                                return Err("Unsupported 'at' on a node in a marking".into());
                            }
                            if !cur.eat(";") {
                                return Err("expected ';' after a node in a marking".into());
                            }
                            self.place_node(pending, Some(point))?;
                        }
                        command @ ("fill" | "draw" | "filldraw" | "path") => {
                            self.state.options = local.clone();
                            self.path(&mut cur, command)?;
                        }
                        command => {
                            return Err(format!(
                                "Unsupported command \\{command} in a marking (arrow, node, fill and draw are supported)"
                            ));
                        }
                    }
                }
            }
            Ok(())
        })();
        self.state = saved;
        self.synthetic = synthetic;
        if result.is_ok() {
            self.error_at.set(None);
        } else {
            self.error_at.set(error_at);
        }
        result
    }
}
