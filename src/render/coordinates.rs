//! Coordinate parsing and transformation.
use super::{CM, Engine, Point, TRANSFORMS};
use crate::options::{Values, length, number};
use crate::syntax::{Cursor, split_top, unbrace};
use crate::transform::Matrix;

impl Engine<'_> {
    pub(super) fn coordinate(&self, expression: &str) -> Result<(Point, Option<String>), String> {
        let expr = unbrace(expression);
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
        if parts.len() == 2 {
            return Ok((
                self.transform(
                    Point {
                        x: length(parts[0], CM)?,
                        y: length(parts[1], CM)?,
                    },
                    &self.state.options,
                )?,
                None,
            ));
        }
        if let Some((angle, r)) = expr.split_once(':') {
            let a = number(angle)?.to_radians();
            let r = length(r, CM)?;
            return Ok((
                self.transform(
                    Point {
                        x: r * a.cos(),
                        y: r * a.sin(),
                    },
                    &self.state.options,
                )?,
                None,
            ));
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
