//! Coordinate parsing and transformation.
use super::{CM, Engine, Point, TRANSFORMS};
use crate::options::{Values, get, has_unit, length, number};
use crate::syntax::{Cursor, split_top, unbrace};
use crate::transform::Matrix;

impl Engine<'_> {
    pub(super) fn coordinate(&self, expression: &str) -> Result<(Point, Option<String>), String> {
        let expression = self.late_text(expression);
        let expr = unbrace(&expression);
        if expr.starts_with('[') {
            let mut c = Cursor::new(expr);
            let raw = c.group('[', ']')?;
            let opts = self.state.styles.clone().resolve(raw, &Values::new())?;
            if opts
                .keys()
                .any(|k| k != "_matrix" && !TRANSFORMS.contains(&k.as_str()))
            {
                return Err("Unsupported coordinate option (expected a transform)".into());
            }
            let (p, _) = self.coordinate(c.rest())?;
            let matrix = Matrix::from_options(&self.state.options)?;
            let [x, y] = matrix.inverse_point(p.x, p.y);
            let [x, y] = Matrix::from_options(&opts)?.point(x, y);
            let [x, y] = matrix.point(x, y);
            return Ok((Point { x, y }, None));
        }
        if let Some(inner) = expr.strip_prefix('$').and_then(|s| s.strip_suffix('$')) {
            return Ok((self.calc(inner)?, None));
        }
        if let Some((a, b)) = expr.split_once("|-") {
            let a = self.coordinate(a)?.0;
            let b = self.coordinate(b)?.0;
            return Ok((Point { x: a.x, y: b.y }, None));
        }
        if let Some((a, b)) = expr.split_once("-|") {
            let a = self.coordinate(a)?.0;
            let b = self.coordinate(b)?.0;
            return Ok((Point { x: b.x, y: a.y }, None));
        }
        let parts = split_top(expr, ',');
        if parts.len() == 2 || parts.len() == 3 {
            // A component without a unit counts along its unit vector; one
            // with a unit is a plain length on the canvas x or y axis.
            let basis = self.basis(&self.state.options)?;
            let mut p = Point::default();
            for (i, part) in parts.iter().enumerate() {
                p = p.add(if !has_unit(part) {
                    basis[i].scale(number(part)?)
                } else if i == 0 {
                    Point {
                        x: length(part, CM)?,
                        y: 0.,
                    }
                } else if i == 1 {
                    Point {
                        x: 0.,
                        y: length(part, CM)?,
                    }
                } else {
                    return Err("Unsupported unit on a z coordinate".into());
                });
            }
            return Ok((self.transform(p, &self.state.options)?, None));
        }
        if let Some((angle, r)) = expr.split_once(':') {
            let a = number(angle)?.to_radians();
            let p = if has_unit(r) {
                let r = length(r, CM)?;
                Point {
                    x: r * a.cos(),
                    y: r * a.sin(),
                }
            } else {
                let basis = self.basis(&self.state.options)?;
                let r = number(r)?;
                basis[0].scale(r * a.cos()).add(basis[1].scale(r * a.sin()))
            };
            return Ok((self.transform(p, &self.state.options)?, None));
        }
        let (name, anchor) = expr.split_once('.').unwrap_or((expr, "center"));
        let n = self
            .nodes
            .get(name.trim())
            .ok_or_else(|| format!("unknown coordinate or node '{name}'"))?;
        Ok((
            n.anchor(anchor.trim())?,
            if anchor == "center" && !expr.contains('.') {
                Some(name.into())
            } else {
                None
            },
        ))
    }
    /// The x, y and z unit vectors (`x=`, `y=`, `z=`), in bp.
    pub(super) fn basis(&self, options: &Values) -> Result<[Point; 3], String> {
        let mut basis = [
            Point { x: CM, y: 0. },
            Point { x: 0., y: CM },
            // PGF's default z vector is (-3.85mm, -3.85mm).
            Point {
                x: -3.85 * CM / 10.,
                y: -3.85 * CM / 10.,
            },
        ];
        for (i, key) in ["x", "y", "z"].into_iter().enumerate() {
            let Some(value) = options.get(key) else {
                continue;
            };
            let fail = |m: String| {
                self.fail_at_option(key);
                format!("invalid {key} unit vector: {m}")
            };
            let value = unbrace(value).trim();
            basis[i] =
                if let Some(point) = value.strip_prefix('(').and_then(|v| v.strip_suffix(')')) {
                    let xy = split_top(point, ',');
                    if xy.len() != 2 {
                        return Err(fail("expected (x,y)".into()));
                    }
                    Point {
                        x: length(xy[0], CM).map_err(fail)?,
                        y: length(xy[1], CM).map_err(fail)?,
                    }
                } else {
                    let v = length(value, CM).map_err(fail)?;
                    match i {
                        0 => Point { x: v, y: 0. },
                        1 => Point { x: 0., y: v },
                        _ => Point { x: v, y: v },
                    }
                };
        }
        Ok(basis)
    }
    /// Factors for unitless x and y radii. Skewed unit vectors are refused
    /// rather than drawn as an axis-aligned ellipse.
    pub(super) fn radius_scale(&self) -> Result<(f64, f64), String> {
        let o = &self.state.options;
        if !o.contains_key("x") && !o.contains_key("y") {
            return Ok((1., 1.));
        }
        let basis = self.basis(o)?;
        if basis[0].y.abs() > 1e-9 || basis[1].x.abs() > 1e-9 {
            return Err("Unsupported radius with skewed x/y unit vectors (give a unit)".into());
        }
        Ok((basis[0].x.abs() / CM, basis[1].y.abs() / CM))
    }
    /// A radius in bp; `axis` picks the unit vector a unitless value follows.
    pub(super) fn radius_length(&self, value: &str, axis: usize) -> Result<f64, String> {
        let scale = if has_unit(value) {
            1.
        } else {
            let (x, y) = self.radius_scale()?;
            if axis == 0 { x } else { y }
        };
        Ok(length(value, CM)? * scale)
    }
    /// Resolve radius defaults before converting units, so an explicit unit
    /// stays independent of x/y vectors in both bracket and legacy syntax.
    pub(super) fn radii(&self, options: &Values) -> Result<(f64, f64), String> {
        let radius = get(options, "radius", "1");
        Ok((
            self.radius_length(get(options, "x radius", radius), 0)?,
            self.radius_length(get(options, "y radius", radius), 1)?,
        ))
    }
    pub(super) fn uses_unit_vectors(&self) -> bool {
        ["x", "y"]
            .iter()
            .any(|k| !get(&self.state.options, k, "").is_empty())
    }
    pub(super) fn calc(&self, expr: &str) -> Result<Point, String> {
        let mut c = Cursor::new(expr);
        let mut coefficient = 1.;
        c.ws();
        if !c.rest().starts_with('(') {
            let (k, rest) = c
                .rest()
                .split_once('*')
                .ok_or("Unsupported calc expression")?;
            coefficient = number(k)?;
            c.pos = expr.len() - rest.len();
        }
        let first = c.group('(', ')')?;
        let mut result = self.coordinate(first)?.0.scale(coefficient);
        loop {
            c.ws();
            if c.rest().is_empty() {
                break;
            }
            if c.eat("+") {
                let s = c.group('(', ')')?;
                result = result.add(self.coordinate(s)?.0);
            } else if c.eat("-") {
                let s = c.group('(', ')')?;
                result = result.sub(self.coordinate(s)?.0);
            } else if c.eat("!") {
                let end = c.rest().find('!').ok_or("unclosed calc interpolation")?;
                let fraction = &c.rest()[..end];
                c.pos += end + 1;
                let target = self.coordinate(c.group('(', ')')?)?.0;
                let t = match fraction.parse::<f64>() {
                    Ok(t) => t,
                    Err(_) => length(fraction, 1.)? / target.sub(result).norm(),
                };
                result = result.add(target.sub(result).scale(t));
            } else {
                return Err(format!("Unsupported calc remainder '{}'", c.rest()));
            }
        }
        Ok(result)
    }
    pub(super) fn transform(&self, p: Point, options: &Values) -> Result<Point, String> {
        let [x, y] = Matrix::from_options(options)?.point(p.x, p.y);
        Ok(Point { x, y })
    }
    pub(super) fn read_point(
        &self,
        cur: &mut Cursor<'_>,
        origin: Point,
    ) -> Result<(Point, Option<String>), String> {
        let relative = cur.eat("++") || cur.eat("+");
        let s = cur.group('(', ')')?;
        let (p, name) = self.coordinate(s)?;
        let point = if relative {
            origin.add(p.sub(self.transform(Point::default(), &self.state.options)?))
        } else {
            p
        };
        if !point.x.is_finite() || !point.y.is_finite() {
            return Err("non-finite coordinate".into());
        }
        Ok((point, name))
    }
}
