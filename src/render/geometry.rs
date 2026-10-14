//! Points, node anchors and bounds in diagram coordinates.
use crate::options::number;
use crate::transform::Matrix;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
impl Point {
    pub(super) fn pipe_node(self, node: &Node) -> Self {
        node.vector(self)
    }
    pub(super) fn rotated(self, degrees: f64) -> Self {
        let a = degrees.to_radians();
        Self {
            x: self.x * a.cos() - self.y * a.sin(),
            y: self.x * a.sin() + self.y * a.cos(),
        }
    }
    pub(super) fn add(self, b: Self) -> Self {
        Self {
            x: self.x + b.x,
            y: self.y + b.y,
        }
    }
    pub(super) fn sub(self, b: Self) -> Self {
        Self {
            x: self.x - b.x,
            y: self.y - b.y,
        }
    }
    pub(super) fn scale(self, k: f64) -> Self {
        Self {
            x: self.x * k,
            y: self.y * k,
        }
    }
    pub(super) fn norm(self) -> f64 {
        self.x.hypot(self.y)
    }
    pub(super) fn svg(self) -> String {
        format!("{:.5},{:.5}", self.x, -self.y)
    }
}
#[derive(Clone, Debug)]
pub struct Node {
    pub center: Point,
    pub width: f64,
    pub height: f64,
    pub shape: String,
    pub rotation: f64,
    pub cylinder_cap: f64,
    /// Baseline offset from the center, in local (upward-positive) coordinates.
    pub baseline: f64,
    pub outer_xsep: f64,
    pub outer_ysep: f64,
    pub transform: Matrix,
}
impl Node {
    /// A sizeless named point.
    pub(super) fn coordinate(center: Point) -> Self {
        Self {
            center,
            width: 0.,
            height: 0.,
            shape: "coordinate".into(),
            rotation: 0.,
            cylinder_cap: 0.,
            baseline: 0.,
            outer_xsep: 0.,
            outer_ysep: 0.,
            transform: Matrix::default(),
        }
    }
    pub(super) fn vector(&self, p: Point) -> Point {
        let [x, y] = self.transform.vector(p.x, p.y);
        Point { x, y }.rotated(self.rotation)
    }
    pub(super) fn anchor(&self, anchor: &str) -> Result<Point, String> {
        let (x, y) = match anchor {
            "" | "center" => (0., 0.),
            "north" => (0., 1.),
            "south" => (0., -1.),
            "east" => (1., 0.),
            "west" => (-1., 0.),
            "north east" => (1., 1.),
            "north west" => (-1., 1.),
            "south east" => (1., -1.),
            "south west" => (-1., -1.),
            "base" | "base west" | "base east" => {
                return Ok(self.center.add(
                    Point {
                        x: if anchor == "base west" {
                            -self.width / 2. - self.outer_xsep
                        } else if anchor == "base east" {
                            self.width / 2. + self.outer_xsep
                        } else {
                            0.
                        },
                        y: self.baseline,
                    }
                    .pipe_node(self),
                ));
            }
            _ => {
                let angle = number(anchor)?.to_radians();
                return Ok(self.border(
                    self.center.add(
                        Point {
                            x: angle.cos() * 100.,
                            y: angle.sin() * 100.,
                        }
                        .pipe_node(self),
                    ),
                ));
            }
        };
        let mut offset = Point {
            x: x * (self.width / 2. + self.outer_xsep),
            y: y * (self.height / 2. + self.outer_ysep),
        };
        if x != 0. && y != 0. && (self.shape == "circle" || self.shape == "ellipse") {
            offset = offset.scale(1. / 2f64.sqrt());
        }
        if x != 0. && y != 0. && self.shape == "diamond" {
            offset = offset.scale(0.5);
        }
        if x != 0. && y != 0. && self.shape == "cylinder" {
            return Ok(self.border(self.center.add(self.vector(offset))));
        }
        Ok(self.center.add(self.vector(offset)))
    }
    pub(super) fn border(&self, toward: Point) -> Point {
        let d = toward.sub(self.center).rotated(-self.rotation);
        let [x, y] = self.transform.inverse_point(d.x, d.y);
        let d = Point { x, y };
        let w = self.width / 2. + self.outer_xsep;
        let h = self.height / 2. + self.outer_ysep;
        if d.norm() < 1e-10 || w < 1e-10 || h < 1e-10 {
            return self.center;
        }
        let k = match self.shape.as_str() {
            "cylinder" => {
                let mut lo = 0.;
                let mut hi = (w / d.x.abs()).min(h / d.y.abs());
                for _ in 0..48 {
                    let t = (lo + hi) / 2.;
                    let x = d.x * t;
                    let y = d.y.abs() * t;
                    let edge = h - self.cylinder_cap
                        + self.cylinder_cap * (1. - (x / w).powi(2)).max(0.).sqrt();
                    if y <= edge {
                        lo = t;
                    } else {
                        hi = t;
                    }
                }
                lo
            }
            "ellipse" | "circle" => 1. / ((d.x / w).powi(2) + (d.y / h).powi(2)).sqrt(),
            "diamond" => 1. / (d.x.abs() / w + d.y.abs() / h),
            _ => (w / d.x.abs()).min(h / d.y.abs()),
        };
        self.center.add(self.vector(d.scale(k)))
    }
}
#[derive(Clone, Copy)]
pub(super) struct Bounds {
    pub(super) min: Point,
    pub(super) max: Point,
}
impl Default for Bounds {
    fn default() -> Self {
        Self {
            min: Point {
                x: f64::INFINITY,
                y: f64::INFINITY,
            },
            max: Point {
                x: f64::NEG_INFINITY,
                y: f64::NEG_INFINITY,
            },
        }
    }
}
impl Bounds {
    pub(super) fn cubic(&mut self, p: Point, a: Point, b: Point, q: Point) {
        // PGF includes the control polygon in the picture bounding box.
        self.point(p);
        self.point(a);
        self.point(b);
        self.point(q);
    }
    pub(super) fn point(&mut self, p: Point) {
        self.min.x = self.min.x.min(p.x);
        self.min.y = self.min.y.min(p.y);
        self.max.x = self.max.x.max(p.x);
        self.max.y = self.max.y.max(p.y);
    }
    pub(super) fn node(&mut self, n: &Node) {
        for x in [-n.width / 2., n.width / 2.] {
            for y in [-n.height / 2., n.height / 2.] {
                self.point(n.center.add(n.vector(Point { x, y })));
            }
        }
    }
}
