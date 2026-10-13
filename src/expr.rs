//! Bounded, deterministic PGF-style scalar expressions. Trigonometry is in degrees.
//! This is intentionally not a TeX evaluator or the complete PGF math language.
pub fn eval(source: &str) -> Result<f64, String> {
    if source.len() > 4096 {
        return Err("math expression exceeds 4096 bytes".into());
    }
    let mut parser = Parser {
        input: source,
        pos: 0,
        depth: 0,
    };
    let result = parser.expression(0)?;
    parser.ws();
    if parser.pos != source.len() {
        return Err(format!("Unsupported math near '{}'", &source[parser.pos..]));
    }
    finite(result)
}
fn finite(value: f64) -> Result<f64, String> {
    if value.is_finite() && value.abs() <= 1e12 {
        Ok(value)
    } else {
        Err("math result is non-finite or exceeds 1e12".into())
    }
}
struct Parser<'a> {
    input: &'a str,
    pos: usize,
    depth: usize,
}
impl Parser<'_> {
    fn ws(&mut self) {
        self.pos += self.input[self.pos..].len() - self.input[self.pos..].trim_start().len();
    }
    fn eat(&mut self, s: &str) -> bool {
        self.ws();
        if self.input[self.pos..].starts_with(s) {
            self.pos += s.len();
            true
        } else {
            false
        }
    }
    fn expression(&mut self, min: u8) -> Result<f64, String> {
        self.depth += 1;
        if self.depth > 64 {
            return Err("math nesting exceeds 64 levels".into());
        }
        let mut left = if self.eat("+") {
            self.expression(3)?
        } else if self.eat("-") {
            -self.expression(3)?
        } else {
            self.atom()?
        };
        loop {
            self.ws();
            let op = self.input[self.pos..].chars().next();
            let (binding, right_binding) = match op {
                Some('+') | Some('-') => (1, 2),
                Some('*') | Some('/') | Some('%') => (2, 3),
                Some('^') => (4, 4),
                _ => (0, 0),
            };
            if binding == 0 || binding < min {
                break;
            }
            self.pos += 1;
            let right = self.expression(right_binding)?;
            left = finite(match op.unwrap() {
                '+' => left + right,
                '-' => left - right,
                '*' => left * right,
                '/' => left / right,
                '%' => left % right,
                '^' => left.powf(right),
                _ => unreachable!(),
            })?;
        }
        self.depth -= 1;
        finite(left)
    }
    fn atom(&mut self) -> Result<f64, String> {
        self.ws();
        for (open, close) in [("(", ")"), ("{", "}")] {
            if self.eat(open) {
                let value = self.expression(0)?;
                if !self.eat(close) {
                    return Err(format!("math expected '{close}'"));
                }
                return Ok(value);
            }
        }
        let start = self.pos;
        let bytes = self.input.as_bytes();
        if bytes
            .get(self.pos)
            .is_some_and(|b| b.is_ascii_digit() || *b == b'.')
        {
            while bytes
                .get(self.pos)
                .is_some_and(|b| b.is_ascii_digit() || *b == b'.')
            {
                self.pos += 1;
            }
            if bytes
                .get(self.pos)
                .is_some_and(|b| *b == b'e' || *b == b'E')
            {
                self.pos += 1;
                if bytes
                    .get(self.pos)
                    .is_some_and(|b| *b == b'+' || *b == b'-')
                {
                    self.pos += 1;
                }
                while bytes.get(self.pos).is_some_and(u8::is_ascii_digit) {
                    self.pos += 1;
                }
            }
            return self.input[start..self.pos]
                .parse()
                .map_err(|_| "invalid math number".into());
        }
        while bytes.get(self.pos).is_some_and(u8::is_ascii_alphabetic) {
            self.pos += 1;
        }
        let name = &self.input[start..self.pos];
        if name == "pi" {
            return Ok(std::f64::consts::PI);
        }
        if name == "e" {
            return Ok(std::f64::consts::E);
        }
        if name.is_empty() || !self.eat("(") {
            return Err(format!("Unsupported math symbol '{name}'"));
        }
        let mut args = vec![self.expression(0)?];
        while self.eat(",") {
            if args.len() >= 16 {
                return Err("too many math arguments".into());
            }
            args.push(self.expression(0)?);
        }
        if !self.eat(")") {
            return Err("math expected ')'".into());
        }
        let value = match (name, args.as_slice()) {
            ("sin", [v]) => v.to_radians().sin(),
            ("cos", [v]) => v.to_radians().cos(),
            ("tan", [v]) => v.to_radians().tan(),
            ("asin", [v]) => v.asin().to_degrees(),
            ("acos", [v]) => v.acos().to_degrees(),
            ("atan", [v]) => v.atan().to_degrees(),
            ("atan2", [y, x]) => y.atan2(*x).to_degrees(),
            ("sqrt", [v]) => v.sqrt(),
            ("abs", [v]) => v.abs(),
            ("exp", [v]) => v.exp(),
            ("ln", [v]) => v.ln(),
            ("log10", [v]) => v.log10(),
            ("floor", [v]) => v.floor(),
            ("ceil", [v]) => v.ceil(),
            ("round", [v]) => v.round(),
            ("int", [v]) => v.trunc(),
            ("rad", [v]) => v.to_radians(),
            ("deg", [v]) => v.to_degrees(),
            ("pow", [a, b]) => a.powf(*b),
            ("mod", [a, b]) => a % b,
            ("min", v) => v.iter().copied().fold(f64::INFINITY, f64::min),
            ("max", v) => v.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            _ => return Err(format!("Unsupported math function or arity '{name}'")),
        };
        finite(value)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn arithmetic() {
        for (s, want) in [
            ("sqrt(4)+sin(30)", 2.5),
            ("-2^2", -4.),
            ("2^3^2", 512.),
            ("max(1,2*3)", 6.),
            ("{2+3}/2", 2.5),
            ("cos(180)", -1.),
            ("int(-2.7)", -2.),
        ] {
            assert!((eval(s).unwrap() - want).abs() < 1e-9, "{s}");
        }
    }
    #[test]
    fn rejects() {
        for s in [
            "1/0",
            "sqrt(-1)",
            "unknown(1)",
            "sin(1,2)",
            "2cm",
            "nan",
            "1 trailing",
            "2**3",
        ] {
            assert!(eval(s).is_err(), "{s}");
        }
        assert!(eval(&format!("{}1{}", "(".repeat(100), ")".repeat(100))).is_err());
    }
}
