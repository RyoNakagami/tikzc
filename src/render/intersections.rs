//! `name path` / `name intersections`: intersections of flattened paths.
use super::geometry::Node;
use super::{Engine, Point};
use crate::syntax::{split_top, unbrace};

/// Line pieces a cubic is cut into before intersecting.
const CUBIC_PIECES: usize = 64;
/// Bound on bounding-box and piece-pair tests for one `name intersections`.
const MAX_WORK: usize = 5_000_000;
const MAX_INTERSECTIONS: usize = 1_000;

/// Each drawn segment (line, cubic, closing line) of an SVG path as a
/// polyline in diagram coordinates.
pub(super) fn flatten(d: &str) -> Result<Vec<Vec<Point>>, String> {
    let mut words = d
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|s| !s.is_empty());
    let point = |words: &mut dyn Iterator<Item = &str>| -> Result<Point, String> {
        let mut value = || {
            words
                .next()
                .and_then(|w| w.parse::<f64>().ok())
                .ok_or("Unsupported named path geometry")
        };
        let x = value()?;
        Ok(Point { x, y: -value()? })
    };
    let mut segments = Vec::new();
    let mut current = Point::default();
    let mut start = current;
    while let Some(command) = words.next() {
        match command {
            "M" => {
                current = point(&mut words)?;
                start = current;
            }
            "L" => {
                let end = point(&mut words)?;
                segments.push(vec![current, end]);
                current = end;
            }
            "C" => {
                let a = point(&mut words)?;
                let b = point(&mut words)?;
                let end = point(&mut words)?;
                segments.push(
                    (0..=CUBIC_PIECES)
                        .map(|i| {
                            let t = i as f64 / CUBIC_PIECES as f64;
                            let u = 1. - t;
                            current
                                .scale(u * u * u)
                                .add(a.scale(3. * u * u * t))
                                .add(b.scale(3. * u * t * t))
                                .add(end.scale(t * t * t))
                        })
                        .collect(),
                );
                current = end;
            }
            "Z" => {
                if current.sub(start).norm() > 1e-9 {
                    segments.push(vec![current, start]);
                }
                current = start;
            }
            _ => return Err("Unsupported named path geometry".into()),
        }
    }
    Ok(segments)
}

fn cross(a: Point, b: Point) -> f64 {
    a.x * b.y - a.y * b.x
}

/// Proper crossing of two line pieces: (parameter along `a`, point).
/// Parallel and overlapping pieces have no single intersection.
fn crossing(a: &[Point], b: &[Point]) -> Option<(f64, Point)> {
    let r = a[1].sub(a[0]);
    let s = b[1].sub(b[0]);
    let denominator = cross(r, s);
    if denominator.abs() <= 1e-12 * r.norm() * s.norm() {
        return None;
    }
    let offset = b[0].sub(a[0]);
    let t = cross(offset, s) / denominator;
    let u = cross(offset, r) / denominator;
    let inside = |v: f64| (-1e-9..=1. + 1e-9).contains(&v);
    (inside(t) && inside(u)).then(|| (t, a[0].add(r.scale(t))))
}

fn extent(points: &[Point]) -> (Point, Point) {
    let mut bounds = super::geometry::Bounds::default();
    for p in points {
        bounds.point(*p);
    }
    (bounds.min, bounds.max)
}

/// Intersections in PGF's order: segments of the first path, then segments
/// of the second, and along the first path's segment within one pair.
pub(super) fn intersect(a: &[Vec<Point>], b: &[Vec<Point>]) -> Result<Vec<Point>, String> {
    let b_extents: Vec<_> = b.iter().map(|s| extent(s)).collect();
    let mut work = 0usize;
    let mut found: Vec<Point> = Vec::new();
    for first in a {
        let (lo, hi) = extent(first);
        for (second, (min, max)) in b.iter().zip(&b_extents) {
            // Disjoint paths still require a quadratic number of box tests.
            work += 1;
            if work > MAX_WORK {
                return Err("named paths are too detailed to intersect".into());
            }
            let slack = 1e-6;
            if lo.x > max.x + slack
                || hi.x < min.x - slack
                || lo.y > max.y + slack
                || hi.y < min.y - slack
            {
                continue;
            }
            work += first.len() * second.len();
            if work > MAX_WORK {
                return Err("named paths are too detailed to intersect".into());
            }
            let mut pair = Vec::new();
            for (i, piece) in first.windows(2).enumerate() {
                for other in second.windows(2) {
                    if let Some((t, p)) = crossing(piece, other) {
                        pair.push((i as f64 + t, p));
                    }
                }
            }
            pair.sort_by(|x, y| x.0.total_cmp(&y.0));
            for (_, p) in pair {
                // A crossing at a shared vertex is found once per adjoining piece.
                if !found.iter().any(|q| q.sub(p).norm() < 1e-4) {
                    if found.len() >= MAX_INTERSECTIONS {
                        return Err(format!("more than {MAX_INTERSECTIONS} intersections"));
                    }
                    found.push(p);
                }
            }
        }
    }
    Ok(found)
}

impl Engine<'_> {
    /// `name intersections={of=A and B, by={...}, name=prefix, total=\macro}`.
    pub(super) fn name_intersections(&mut self, spec: &str) -> Result<(), String> {
        self.fail_at_option("name intersections");
        let mut of = None;
        let mut by = Vec::new();
        let mut prefix = "intersection".to_owned();
        let mut total = None;
        for part in split_top(unbrace(spec), ',') {
            let (key, value) = part.split_once('=').unwrap_or((part, ""));
            let value = unbrace(value).trim();
            match key.trim() {
                "of" => of = value.split_once(" and "),
                "by" => by = split_top(value, ','),
                "name" if !value.is_empty() => prefix = value.to_owned(),
                "total" => {
                    total = Some(
                        value
                            .strip_prefix('\\')
                            .filter(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_alphabetic()))
                            .ok_or("intersections total requires a macro name")?,
                    );
                }
                key => {
                    return Err(format!(
                        "Unsupported name intersections option '{key}' (of, by, name and total are supported)"
                    ));
                }
            }
        }
        let (first, second) = of.ok_or("name intersections requires of=<path> and <path>")?;
        let path = |name: &str| {
            self.named_paths
                .get(name.trim())
                .ok_or_else(|| format!("unknown named path '{}'", name.trim()))
        };
        let points = intersect(path(first)?, path(second)?)?;
        // Names from an earlier computation must not outlive it: a reference
        // beyond the new count is an error, not a stale point.
        let numbered = |name: &str| {
            name.strip_prefix(prefix.as_str())
                .and_then(|n| n.strip_prefix('-'))
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        };
        self.nodes.retain(|name, _| !numbered(name));
        for alias in &by {
            if alias.starts_with('[') {
                return Err("Unsupported options in intersections by=".into());
            }
        }
        for (i, point) in points.iter().enumerate() {
            self.nodes
                .insert(format!("{prefix}-{}", i + 1), Node::coordinate(*point));
            if let Some(alias) = by.get(i) {
                self.nodes
                    .insert(alias.trim().to_owned(), Node::coordinate(*point));
            }
        }
        if let Some(name) = total {
            self.late.insert(name.to_owned(), points.len().to_string());
        }
        self.error_at.set(None);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(x: f64, y: f64) -> Point {
        Point { x, y }
    }
    #[test]
    fn order_follows_segments_of_the_first_then_second_path() {
        let zigzag = flatten("M 0,0 L 1,-2 L 2,0 L 3,-2").unwrap();
        let line = flatten("M 3,-1 L 0,-1").unwrap();
        for found in [
            intersect(&zigzag, &line).unwrap(),
            intersect(&line, &zigzag).unwrap(),
        ] {
            let xs: Vec<f64> = found.iter().map(|q| q.x).collect();
            assert_eq!(xs.len(), 3);
            for (x, want) in xs.iter().zip([0.5, 1.5, 2.5]) {
                assert!((x - want).abs() < 1e-9, "{xs:?}");
            }
        }
    }
    #[test]
    fn degenerate_cases() {
        let a = vec![vec![p(0., 0.), p(2., 0.)]];
        // Parallel, collinear overlap and disjoint: no intersection.
        for b in [
            vec![vec![p(0., 1.), p(2., 1.)]],
            vec![vec![p(1., 0.), p(3., 0.)]],
            vec![vec![p(5., -1.), p(5., 1.)]],
        ] {
            assert!(intersect(&a, &b).unwrap().is_empty());
        }
        // Touching at an endpoint counts once, also across a shared vertex.
        let touch = vec![vec![p(2., 0.), p(2., 1.)]];
        assert_eq!(intersect(&a, &touch).unwrap().len(), 1);
        let bent = vec![vec![p(0., -1.), p(1., 0.)], vec![p(1., 0.), p(2., -1.)]];
        assert_eq!(intersect(&bent, &a).unwrap().len(), 1);
    }
    #[test]
    fn disjoint_paths_are_also_bounded() {
        let a = vec![vec![p(0., 0.), p(1., 0.)]; 2250];
        let b = vec![vec![p(0., 1.), p(1., 1.)]; 2250];
        assert_eq!(
            intersect(&a, &b).unwrap_err(),
            "named paths are too detailed to intersect"
        );
    }
    #[test]
    fn closed_path_gets_its_closing_segment() {
        let square = flatten("M 0,0 L 2,0 L 2,-2 L 0,-2 Z").unwrap();
        assert_eq!(square.len(), 4);
        let line = vec![vec![p(-1., 1.), p(1., 1.)]];
        assert_eq!(intersect(&square, &line).unwrap().len(), 1);
    }
}
