//! Affine coordinate transforms, composed in option order (parent * local).
use crate::options::{Values, length, number};
use crate::syntax::{split_top, unbrace};
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Matrix(pub [f64; 6]);
impl Default for Matrix {
    fn default() -> Self {
        Self([1., 0., 0., 1., 0., 0.])
    }
}
impl Matrix {
    pub fn from_options(o: &Values) -> Result<Self, String> {
        let Some(raw) = o.get("_matrix") else {
            return Ok(Self::default());
        };
        let v = raw
            .split(',')
            .map(str::parse::<f64>)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "invalid internal matrix")?;
        let a: [f64; 6] = v.try_into().map_err(|_| "invalid matrix size")?;
        Ok(Self(a))
    }
    pub fn point(self, x: f64, y: f64) -> [f64; 2] {
        let [a, b, c, d, e, f] = self.0;
        [a * x + c * y + e, b * x + d * y + f]
    }
    pub fn vector(self, x: f64, y: f64) -> [f64; 2] {
        let [a, b, c, d, _, _] = self.0;
        [a * x + c * y, b * x + d * y]
    }
    pub fn inverse_point(self, x: f64, y: f64) -> [f64; 2] {
        let [a, b, c, d, e, f] = self.0;
        let det = a * d - b * c;
        [
            (d * (x - e) - c * (y - f)) / det,
            (-b * (x - e) + a * (y - f)) / det,
        ]
    }
    pub fn then(self, rhs: Self) -> Result<Self, String> {
        let [a, b, c, d, e, f] = self.0;
        let [g, h, i, j, k, l] = rhs.0;
        let v = [
            a * g + c * h,
            b * g + d * h,
            a * i + c * j,
            b * i + d * j,
            a * k + c * l + e,
            b * k + d * l + f,
        ];
        let determinant = v[0] * v[3] - v[1] * v[2];
        if v.iter().any(|n| !n.is_finite() || n.abs() > 1e7) || determinant.abs() < 1e-12 {
            return Err("singular or excessive coordinate transform".into());
        }
        Ok(Self(v))
    }
    pub fn option(key: &str, value: &str) -> Result<Option<Self>, String> {
        let mut m = Self::default();
        match key {
            "scale" => {
                let n = number(value)?;
                m.0[0] = n;
                m.0[3] = n;
            }
            "xscale" => m.0[0] = number(value)?,
            "yscale" => m.0[3] = number(value)?,
            "rotate" => {
                let angle = number(value)?.to_radians();
                m.0 = [angle.cos(), angle.sin(), -angle.sin(), angle.cos(), 0., 0.];
            }
            "xshift" => m.0[4] = length(value, 1.)?,
            "yshift" => m.0[5] = length(value, 1.)?,
            "shift" => {
                let value = unbrace(value).trim();
                let value = value
                    .strip_prefix('(')
                    .and_then(|s| s.strip_suffix(')'))
                    .ok_or("shift requires (x,y)")?;
                let xy = split_top(value, ',');
                if xy.len() != 2 {
                    return Err("shift requires two coordinates".into());
                }
                m.0[4] = length(xy[0], 72. / 2.54)?;
                m.0[5] = length(xy[1], 72. / 2.54)?;
            }
            _ => return Ok(None),
        }
        Ok(Some(m))
    }
    pub fn store(self, o: &mut Values) {
        o.insert(
            "_matrix".into(),
            self.0
                .iter()
                .map(f64::to_string)
                .collect::<Vec<_>>()
                .join(","),
        );
    }
}
