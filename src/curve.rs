//! Open path geometry. Shortening retains cubic segments, using arc length
//! and de Casteljau subdivision; arrow directions use analytic endpoint tangents.
#[derive(Clone, Copy, Debug)]
pub(crate) struct P(pub f64, pub f64);
impl P {
    fn add(self, p: Self) -> Self {
        Self(self.0 + p.0, self.1 + p.1)
    }
    fn sub(self, p: Self) -> Self {
        Self(self.0 - p.0, self.1 - p.1)
    }
    fn mul(self, k: f64) -> Self {
        Self(self.0 * k, self.1 * k)
    }
    fn norm(self) -> f64 {
        self.0.hypot(self.1)
    }
    fn mix(self, p: Self, t: f64) -> Self {
        self.mul(1. - t).add(p.mul(t))
    }
}
#[derive(Clone, Debug)]
enum Segment {
    Line(P, P),
    Cubic([P; 4]),
}
impl Segment {
    fn start(&self) -> P {
        match self {
            Self::Line(a, _) => *a,
            Self::Cubic(p) => p[0],
        }
    }
    fn end(&self) -> P {
        match self {
            Self::Line(_, b) => *b,
            Self::Cubic(p) => p[3],
        }
    }
    fn tangent(&self, end: bool) -> P {
        let pairs = match self {
            Self::Line(a, b) => vec![(*a, *b)],
            Self::Cubic(p) if end => vec![(p[2], p[3]), (p[1], p[3]), (p[0], p[3])],
            Self::Cubic(p) => vec![(p[0], p[1]), (p[0], p[2]), (p[0], p[3])],
        };
        pairs
            .into_iter()
            .map(|(a, b)| b.sub(a))
            .find(|v| v.norm() > 1e-10)
            .unwrap_or(P(0., 0.))
    }
    fn split(&self, t: f64) -> (Self, Self) {
        match self {
            Self::Line(a, b) => {
                let p = a.mix(*b, t);
                (Self::Line(*a, p), Self::Line(p, *b))
            }
            Self::Cubic([a, b, c, d]) => {
                let ab = a.mix(*b, t);
                let bc = b.mix(*c, t);
                let cd = c.mix(*d, t);
                let abc = ab.mix(bc, t);
                let bcd = bc.mix(cd, t);
                let p = abc.mix(bcd, t);
                (Self::Cubic([*a, ab, abc, p]), Self::Cubic([p, bcd, cd, *d]))
            }
        }
    }
    fn length(&self) -> f64 {
        fn recurse(s: &Segment, depth: u8, tolerance: f64) -> f64 {
            match s {
                Segment::Line(a, b) => b.sub(*a).norm(),
                Segment::Cubic(p) => {
                    let chord = p[3].sub(p[0]).norm();
                    let polygon = p.windows(2).map(|v| v[1].sub(v[0]).norm()).sum::<f64>();
                    if depth == 0 || polygon - chord < tolerance {
                        (polygon + chord) / 2.
                    } else {
                        let (a, b) = s.split(0.5);
                        recurse(&a, depth - 1, tolerance / 2.)
                            + recurse(&b, depth - 1, tolerance / 2.)
                    }
                }
            }
        }
        recurse(self, 16, 1e-5)
    }
    fn at_length(&self, length: f64) -> f64 {
        let mut lo = 0.;
        let mut hi = 1.;
        for _ in 0..32 {
            let t = (lo + hi) / 2.;
            if self.split(t).0.length() < length {
                lo = t;
            } else {
                hi = t;
            }
        }
        (lo + hi) / 2.
    }
}
pub(crate) struct Path {
    segments: Vec<Segment>,
}
impl Path {
    pub fn parse(svg: &str) -> Result<Self, String> {
        let mut words = svg
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter(|s| !s.is_empty());
        let point = |words: &mut dyn Iterator<Item = &str>| -> Result<P, String> {
            let x = words
                .next()
                .ok_or("missing path x")?
                .parse::<f64>()
                .map_err(|_| "invalid path x")?;
            let y = words
                .next()
                .ok_or("missing path y")?
                .parse::<f64>()
                .map_err(|_| "invalid path y")?;
            Ok(P(x, -y))
        };
        if words.next() != Some("M") {
            return Err("arrow/shortening requires an open path".into());
        }
        let mut current = point(&mut words)?;
        let mut segments = Vec::new();
        while let Some(cmd) = words.next() {
            // Consecutive moves (e.g. (node) ++(offset)) have no drawn subpath.
            if cmd == "M" && segments.is_empty() {
                current = point(&mut words)?;
                continue;
            }
            let segment = match cmd {
                "L" => Segment::Line(current, point(&mut words)?),
                "C" => Segment::Cubic([
                    current,
                    point(&mut words)?,
                    point(&mut words)?,
                    point(&mut words)?,
                ]),
                _ => {
                    return Err(
                        "Unsupported arrows/shortening on closed or multiple subpaths".into(),
                    );
                }
            };
            current = segment.end();
            segments.push(segment);
        }
        if segments.is_empty() {
            return Err("arrow/shortening requires a nonempty segment".into());
        }
        Ok(Self { segments })
    }
    pub fn endpoints(&self) -> [(P, P); 2] {
        let first = &self.segments[0];
        let last = self.segments.last().unwrap();
        // (tip, point behind tip), in renderer coordinates.
        [
            (first.start(), first.start().add(first.tangent(false))),
            (last.end(), last.end().sub(last.tangent(true))),
        ]
    }
    pub fn length(&self) -> f64 {
        self.segments.iter().map(Segment::length).sum()
    }
    /// Point and (unnormalized) tangent at an arc length from the start.
    pub fn at(&self, distance: f64) -> (P, P) {
        let mut remaining = distance.max(0.);
        for (i, segment) in self.segments.iter().enumerate() {
            let length = segment.length();
            if remaining <= length || i + 1 == self.segments.len() {
                let t = if length > 0. {
                    segment.at_length(remaining.min(length))
                } else {
                    0.
                };
                let point = segment.split(t).0.end();
                let tangent = match segment {
                    Segment::Line(a, b) => b.sub(*a),
                    Segment::Cubic([a, b, c, d]) => {
                        let u = 1. - t;
                        b.sub(*a)
                            .mul(3. * u * u)
                            .add(c.sub(*b).mul(6. * u * t))
                            .add(d.sub(*c).mul(3. * t * t))
                    }
                };
                let tangent = if tangent.norm() > 1e-10 {
                    tangent
                } else {
                    segment.tangent(t > 0.5)
                };
                return (point, tangent);
            }
            remaining -= length;
        }
        unreachable!("a parsed path has at least one segment")
    }
    pub fn vertices(&self) -> Vec<P> {
        std::iter::once(self.segments[0].start())
            .chain(self.segments.iter().map(Segment::end))
            .collect()
    }
    pub fn shorten(&mut self, start: f64, end: f64) -> Result<(), String> {
        let length = self.segments.iter().map(Segment::length).sum::<f64>();
        if start.max(0.) + end.max(0.) >= length - 1e-9 {
            return Err("shortening consumes the entire path".into());
        }
        for (distance, from_end) in [(end, true), (start, false)] {
            if distance < 0. {
                let s = if from_end {
                    self.segments.last().unwrap()
                } else {
                    &self.segments[0]
                };
                let p = if from_end { s.end() } else { s.start() };
                let tangent = s.tangent(from_end);
                let n = tangent.norm();
                if n < 1e-10 {
                    return Err("cannot extend a degenerate path".into());
                }
                let far = p.add(tangent.mul(if from_end {
                    -distance / n
                } else {
                    distance / n
                }));
                if from_end {
                    self.segments.push(Segment::Line(p, far));
                } else {
                    self.segments.insert(0, Segment::Line(far, p));
                }
                continue;
            }
            let mut remaining = distance;
            while remaining > 1e-9 {
                let i = if from_end { self.segments.len() - 1 } else { 0 };
                let s = &self.segments[i];
                let len = s.length();
                if remaining >= len {
                    remaining -= len;
                    self.segments.remove(i);
                } else {
                    let t = s.at_length(if from_end { len - remaining } else { remaining });
                    let (a, b) = s.split(t);
                    self.segments[i] = if from_end { a } else { b };
                    break;
                }
            }
        }
        Ok(())
    }
    pub fn svg(&self) -> String {
        let p = self.segments[0].start();
        let mut d = format!(" M {:.5},{:.5} ", p.0, -p.1);
        for segment in &self.segments {
            match segment {
                Segment::Line(_, p) => d.push_str(&format!(" L {:.5},{:.5} ", p.0, -p.1)),
                Segment::Cubic(p) => d.push_str(&format!(
                    " C {:.5},{:.5} {:.5},{:.5} {:.5},{:.5} ",
                    p[1].0, -p[1].1, p[2].0, -p[2].1, p[3].0, -p[3].1
                )),
            }
        }
        d
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cubic_length_tangent_and_trim() {
        let mut p = Path::parse("M 0,0 C 0,-100 100,-100 100,0").unwrap();
        assert!((p.segments[0].length() - 200.).abs() < 1e-4);
        assert_eq!(p.endpoints()[1].1.0, 100.);
        p.shorten(20., 30.).unwrap();
        assert!((p.segments[0].length() - 150.).abs() < 1e-4);
        assert!(p.svg().contains(" C "));
        assert!(p.endpoints()[0].0.1 > 0.);
    }
    #[test]
    fn position_and_tangent_by_arc_length() {
        let p = Path::parse("M 0,0 L 10,0 C 10,-10 20,-10 20,0").unwrap();
        let (point, tangent) = p.at(4.);
        assert!((point.0 - 4.).abs() < 1e-9 && point.1.abs() < 1e-9);
        assert!(tangent.0 > 0. && tangent.1.abs() < 1e-9);
        // The cubic is symmetric: half of its length is its apex.
        let cubic = p.length() - 10.;
        let (point, tangent) = p.at(10. + cubic / 2.);
        assert!((point.0 - 15.).abs() < 1e-4 && (point.1 - 7.5).abs() < 1e-4);
        assert!(tangent.0 > 0. && tangent.1.abs() < 1e-4);
        assert!((p.at(1e9).0.0 - 20.).abs() < 1e-6);
    }
    #[test]
    fn trim_across_segments_and_extend() {
        let mut p = Path::parse("M 0,0 L 1,0 L 10,0 L 11,0").unwrap();
        p.shorten(2., 3.).unwrap();
        assert!((p.endpoints()[0].0.0 - 2.).abs() < 1e-6);
        assert!((p.endpoints()[1].0.0 - 8.).abs() < 1e-6);
        p.shorten(-2., -3.).unwrap();
        assert!(p.endpoints()[0].0.0.abs() < 1e-6);
        assert!((p.endpoints()[1].0.0 - 11.).abs() < 1e-6);
        assert!(p.shorten(20., 0.).is_err());
    }
}
