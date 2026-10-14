//! Sampled function plots and plot marks.
use super::geometry::Bounds;
use super::paint::{line_width, opacity_attribute};
use super::paths::ellipse_curve;
use super::{Engine, Point};
use crate::options::{Values, dim, get, number};
use crate::syntax::unbrace;
use crate::transform::Matrix;

/// Shared bound for samples and explicit plot coordinates.
pub(super) const MAX_POINTS: usize = 10_000;

/// Replace the control word `\name` by `value`, leaving longer names alone.
pub(super) fn substitute(text: &str, name: &str, value: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('\\') {
        out.push_str(&rest[..at]);
        let after = &rest[at + 1..];
        let letters = after.bytes().take_while(u8::is_ascii_alphabetic).count();
        if letters == 0 {
            // A control symbol: keep the backslash and the character it escapes.
            let width = after.chars().next().map_or(0, char::len_utf8);
            out.push_str(&rest[at..at + 1 + width]);
            rest = &after[width..];
        } else {
            if &after[..letters] == name {
                out.push_str(value);
            } else {
                out.push_str(&rest[at..at + 1 + letters]);
            }
            rest = &after[letters..];
        }
    }
    out.push_str(rest);
    out
}

impl Engine<'_> {
    /// `plot (\x,{f(\x)})`: `samples` points, evenly spaced over `domain`.
    pub(super) fn plot_function(
        &self,
        expression: &str,
        opts: &Values,
    ) -> Result<Vec<Point>, String> {
        let variable = get(opts, "variable", "\\x").trim();
        let name = variable
            .strip_prefix('\\')
            .filter(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_alphabetic()))
            .ok_or_else(|| {
                self.fail_at_option("variable");
                "plot variable must be a macro name such as \\x".to_owned()
            })?;
        let domain = unbrace(get(opts, "domain", "-5:5"));
        let (start, end) = domain
            .split_once(':')
            .ok_or_else(|| "plot domain requires start:end".to_owned())
            .and_then(|(a, b)| Ok((number(a)?, number(b)?)))
            .inspect_err(|_| self.fail_at_option("domain"))?;
        let samples = number(get(opts, "samples", "25")).inspect_err(|_| {
            self.fail_at_option("samples");
        })?;
        // PGF silently raises samples=1 to 2; a single sample is refused here.
        if samples.fract() != 0. || samples < 2. || samples > MAX_POINTS as f64 {
            self.fail_at_option("samples");
            return Err(format!(
                "plot samples must be an integer from 2 to {MAX_POINTS}"
            ));
        }
        let samples = samples as usize;
        let mut points = Vec::with_capacity(samples);
        for i in 0..samples {
            // Both ends of the domain are hit exactly.
            let value = if i + 1 == samples {
                end
            } else {
                start + (end - start) * i as f64 / (samples - 1) as f64
            };
            let point = self
                .coordinate(&substitute(expression, name, &value.to_string()))
                .map_err(|e| format!("plot: {e} (at {variable} = {value})"))?
                .0;
            points.push(point);
        }
        Ok(points)
    }

    /// One SVG element holding a mark at every plot point. Marks keep their
    /// size and orientation under coordinate transforms, as in PGF.
    pub(super) fn plot_marks(&mut self, points: &[Point], o: &Values) -> Result<String, String> {
        let mark = get(o, "mark", "").trim();
        let size = dim(o, "mark size", 2. * 72. / 72.27)?;
        if size <= 0. || size > 1e4 {
            self.fail_at_option("mark size");
            return Err("mark size must be positive".into());
        }
        let mut d = String::new();
        let mut bounds = Bounds::default();
        for p in points {
            let at = |x: f64, y: f64| p.add(Point { x, y }).svg();
            match mark {
                "*" | "o" => {
                    d.push_str(&format!("M {} ", at(size, 0.)));
                    for (_, a, b, end) in ellipse_curve(*p, size, size, 0., 360., Matrix::default())
                    {
                        d.push_str(&format!("C {} {} {} ", a.svg(), b.svg(), end.svg()));
                    }
                    d.push_str("Z ");
                }
                "x" => {
                    let k = size * std::f64::consts::FRAC_1_SQRT_2;
                    d.push_str(&format!(
                        "M {} L {} M {} L {} ",
                        at(-k, -k),
                        at(k, k),
                        at(-k, k),
                        at(k, -k)
                    ));
                }
                "+" => d.push_str(&format!(
                    "M {} L {} M {} L {} ",
                    at(-size, 0.),
                    at(size, 0.),
                    at(0., -size),
                    at(0., size)
                )),
                _ => {
                    self.fail_at_option("mark");
                    return Err(format!(
                        "Unsupported plot mark '{mark}' (*, o, x and + are supported)"
                    ));
                }
            }
            for (x, y) in [(-size, -size), (size, size)] {
                bounds.point(p.add(Point { x, y }));
            }
        }
        self.bbox.point(bounds.min);
        self.bbox.point(bounds.max);
        let color = get(o, "draw color", "black");
        let stroke = self.state.styles.color(match get(o, "draw", "") {
            "" => color,
            draw => draw,
        })?;
        let fill = if mark == "*" {
            self.state.styles.color(match get(o, "fill", "") {
                "" => color,
                fill => fill,
            })?
        } else {
            "none".into()
        };
        Ok(format!(
            "<path d=\"{}\" stroke=\"{stroke}\" fill=\"{fill}\" stroke-width=\"{}\"{}/>",
            d.trim_end(),
            line_width(o)?,
            opacity_attribute("opacity", dim(o, "opacity", 1.)?)
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::substitute;
    #[test]
    fn substitutes_whole_control_words_only() {
        assert_eq!(substitute(r"\x*\xx+\x r", "x", "-3"), r"-3*\xx+-3 r");
        assert_eq!(substitute(r"\\x \%\t", "t", "1"), r"\\x \%1");
        assert_eq!(substitute("plain", "x", "1"), "plain");
    }
}
