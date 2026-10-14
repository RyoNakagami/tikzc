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
/// Lehmer generator with PGF's multiplier and modulus. The sequence is
/// deterministic per seed but is NOT the sequence TeX produces.
const RANDOM_MODULUS: u64 = 2_147_483_647;
const DEFAULT_SEED: u64 = 42;
thread_local! {
    static RANDOM: std::cell::Cell<u64> = const { std::cell::Cell::new(DEFAULT_SEED) };
}
/// `\pgfmathsetseed`; `None` restores the fixed default at the start of a render.
pub(crate) fn seed(value: Option<f64>) -> Result<(), String> {
    let state = match value {
        None => DEFAULT_SEED,
        Some(v) if v.is_finite() && v.fract() == 0. && v.abs() <= 1e12 => {
            (v as i64).rem_euclid(RANDOM_MODULUS as i64 - 1) as u64 + 1
        }
        Some(_) => return Err("random seed must be an integer".into()),
    };
    RANDOM.with(|r| r.set(state));
    Ok(())
}
/// Uniform in the open interval (0, 1).
fn random() -> f64 {
    RANDOM.with(|r| {
        let next = r.get() * 69_621 % RANDOM_MODULUS;
        r.set(next);
        next as f64 / RANDOM_MODULUS as f64
    })
}
fn truth(value: bool) -> f64 {
    if value { 1. } else { 0. }
}
// Binding powers follow the order of PGF's operator table:
// ?: < && || < comparisons < + - < postfix r < * / < prefix - < ^ < prefix !.
const TERNARY: u8 = 1;
const LOGICAL: u8 = 10;
const COMPARISON: u8 = 20;
const ADDITIVE: u8 = 30;
const RADIANS: u8 = 35;
const MULTIPLICATIVE: u8 = 40;
const POWER: u8 = 60;
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
        self.ws();
        let mut left = if self.eat("+") {
            self.expression(MULTIPLICATIVE + 1)?
        } else if self.eat("-") {
            -self.expression(MULTIPLICATIVE + 1)?
        } else if self.input[self.pos..].starts_with('!')
            && !self.input[self.pos..].starts_with("!=")
        {
            self.pos += 1;
            truth(self.expression(POWER + 1)? == 0.)
        } else {
            self.atom()?
        };
        loop {
            self.ws();
            let rest = &self.input[self.pos..];
            // PGF's postfix `r` marks radians: the operand is converted to degrees.
            if rest.starts_with('r')
                && !rest[1..].starts_with(|c: char| c.is_ascii_alphanumeric() || c == '(')
            {
                if RADIANS < min {
                    break;
                }
                self.pos += 1;
                left = finite(left.to_degrees())?;
                continue;
            }
            if rest.starts_with('?') {
                if TERNARY < min {
                    break;
                }
                self.pos += 1;
                let yes = self.expression(TERNARY + 1)?;
                if !self.eat(":") {
                    return Err("math expected ':' after '?'".into());
                }
                let no = self.expression(TERNARY + 1)?;
                left = if left != 0. { yes } else { no };
                continue;
            }
            let Some((op, binding, right_binding)) = [
                ("==", COMPARISON, COMPARISON + 1),
                ("!=", COMPARISON, COMPARISON + 1),
                ("<=", COMPARISON, COMPARISON + 1),
                (">=", COMPARISON, COMPARISON + 1),
                ("&&", LOGICAL, LOGICAL + 1),
                ("||", LOGICAL, LOGICAL + 1),
                ("<", COMPARISON, COMPARISON + 1),
                (">", COMPARISON, COMPARISON + 1),
                ("+", ADDITIVE, ADDITIVE + 1),
                ("-", ADDITIVE, ADDITIVE + 1),
                ("*", MULTIPLICATIVE, MULTIPLICATIVE + 1),
                ("/", MULTIPLICATIVE, MULTIPLICATIVE + 1),
                ("%", MULTIPLICATIVE, MULTIPLICATIVE + 1),
                ("^", POWER, POWER),
            ]
            .into_iter()
            .find(|(op, _, _)| rest.starts_with(op)) else {
                break;
            };
            if binding < min {
                break;
            }
            self.pos += op.len();
            let right = self.expression(right_binding)?;
            left = finite(match op {
                "+" => left + right,
                "-" => left - right,
                "*" => left * right,
                "/" => left / right,
                "%" => left % right,
                "^" => left.powf(right),
                "==" => truth(left == right),
                "!=" => truth(left != right),
                "<=" => truth(left <= right),
                ">=" => truth(left >= right),
                "<" => truth(left < right),
                ">" => truth(left > right),
                "&&" => truth(left != 0. && right != 0.),
                "||" => truth(left != 0. || right != 0.),
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
        // Names may carry digits after the first letter (log10, atan2).
        if bytes.get(self.pos).is_some_and(u8::is_ascii_alphabetic) {
            while bytes.get(self.pos).is_some_and(u8::is_ascii_alphanumeric) {
                self.pos += 1;
            }
        }
        let name = &self.input[start..self.pos];
        self.ws();
        if !self.input[self.pos..].starts_with('(') {
            return match name {
                "pi" => Ok(std::f64::consts::PI),
                "e" => Ok(std::f64::consts::E),
                "true" => Ok(1.),
                "false" => Ok(0.),
                "rnd" => Ok(random()),
                "rand" => Ok(2. * random() - 1.),
                _ => Err(format!("Unsupported math symbol '{name}'")),
            };
        }
        self.pos += 1;
        let mut args = Vec::new();
        if !self.eat(")") {
            args.push(self.expression(0)?);
            while self.eat(",") {
                if args.len() >= 16 {
                    return Err("too many math arguments".into());
                }
                args.push(self.expression(0)?);
            }
            if !self.eat(")") {
                return Err("math expected ')'".into());
            }
        }
        let integer = |low: f64, high: f64| -> Result<f64, String> {
            if low.fract() != 0. || high.fract() != 0. {
                return Err("random bounds must be integers".into());
            }
            let (low, high) = (low.min(high), low.max(high));
            Ok(low + (random() * (high - low + 1.)).floor().min(high - low))
        };
        let value = match (name, args.as_slice()) {
            ("sin", [v]) => v.to_radians().sin(),
            ("cos", [v]) => v.to_radians().cos(),
            ("tan", [v]) => v.to_radians().tan(),
            ("asin", [v]) => v.asin().to_degrees(),
            ("acos", [v]) => v.acos().to_degrees(),
            ("atan", [v]) => v.atan().to_degrees(),
            ("atan2", [y, x]) => y.atan2(*x).to_degrees(),
            ("sinh", [v]) => v.sinh(),
            ("cosh", [v]) => v.cosh(),
            ("tanh", [v]) => v.tanh(),
            ("sqrt", [v]) => v.sqrt(),
            ("abs", [v]) => v.abs(),
            ("sign", [v]) => {
                if *v == 0. {
                    0.
                } else {
                    v.signum()
                }
            }
            ("exp", [v]) => v.exp(),
            ("ln", [v]) => v.ln(),
            ("log10", [v]) => v.log10(),
            ("log2", [v]) => v.log2(),
            ("floor", [v]) => v.floor(),
            ("ceil", [v]) => v.ceil(),
            ("round", [v]) => v.round(),
            ("int", [v]) => v.trunc(),
            ("frac", [v]) => v.fract(),
            ("rad", [v]) => v.to_radians(),
            ("deg", [v]) => v.to_degrees(),
            ("pow", [a, b]) => a.powf(*b),
            ("mod", [a, b]) => a % b,
            ("min", v @ [_, ..]) => v.iter().copied().fold(f64::INFINITY, f64::min),
            ("max", v @ [_, ..]) => v.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            ("ifthenelse", [c, a, b]) => {
                if *c != 0. {
                    *a
                } else {
                    *b
                }
            }
            ("equal", [a, b]) => truth(a == b),
            ("notequal", [a, b]) => truth(a != b),
            ("greater", [a, b]) => truth(a > b),
            ("less", [a, b]) => truth(a < b),
            ("notless", [a, b]) => truth(a >= b),
            ("notgreater", [a, b]) => truth(a <= b),
            ("and", [a, b]) => truth(*a != 0. && *b != 0.),
            ("or", [a, b]) => truth(*a != 0. || *b != 0.),
            ("not", [a]) => truth(*a == 0.),
            ("true", []) => 1.,
            ("false", []) => 0.,
            ("rnd", []) | ("random", []) => random(),
            ("rand", []) => 2. * random() - 1.,
            ("random", [high]) => integer(1., *high)?,
            ("random", [low, high]) => integer(*low, *high)?,
            _ => return Err(format!("Unsupported math function or arity '{name}'")),
        };
        finite(value)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn near(source: &str, want: f64) {
        let got = eval(source).unwrap_or_else(|e| panic!("{source}: {e}"));
        assert!((got - want).abs() < 1e-9, "{source}: {got} != {want}");
    }
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
            near(s, want);
        }
    }
    // Expected values agree with PGF 3.1.10 (`\pgfmathparse{...}\pgfmathresult`
    // under lualatex) to PGF's own five-digit precision.
    #[test]
    fn data_science_functions() {
        for (s, want) in [
            ("exp(1)", std::f64::consts::E),
            ("ln(e)", 1.),
            ("log10(1000)", 3.),
            ("log2(8)", 3.),
            ("abs(-2)", 2.),
            ("min(3,1,2)", 1.),
            ("max(3,1,2)", 3.),
            ("mod(7,3)", 1.),
            ("mod(-7,3)", -1.),
            ("floor(-2.5)", -3.),
            ("ceil(-2.5)", -2.),
            ("round(2.5)", 3.),
            ("round(-2.5)", -3.),
            ("tanh(1)", 1f64.tanh()),
            ("sinh(1)", 1f64.sinh()),
            ("cosh(1)", 1f64.cosh()),
            ("atan2(1,1)", 45.),
            ("deg(pi)", 180.),
            ("rad(180)", std::f64::consts::PI),
            ("sign(-3)", -1.),
            ("frac(2.7)", 0.7),
            ("pi", std::f64::consts::PI),
            ("e", std::f64::consts::E),
            ("1/(1+exp(-2*0))", 0.5),
            ("2.5*exp(-(0)*(0)/2)/sqrt(2*pi)", 0.997355701003582),
        ] {
            near(s, want);
        }
    }
    #[test]
    fn negative_values_substituted_for_a_variable() {
        // \x = -3 substituted textually, as PGF does for a plot variable.
        near("-(-3)*(-3)", -9.);
        near("--3*-3", -9.);
        near("-3*-3", 9.);
    }
    #[test]
    fn radians_suffix() {
        near("cos(pi r)", -1.);
        near("sin(1.5 r)", 1.5f64.sin());
        near("sin(pi/2 r)", 1.);
        near("2*pi r", 360.);
        near("90 r + 1", 90f64.to_degrees() + 1.);
        near("round(1.4)", 1.);
        near("rad(180)", std::f64::consts::PI);
    }
    #[test]
    fn conditionals_comparisons_and_logic() {
        for (s, want) in [
            ("ifthenelse(0.7>0.5,1,0)", 1.),
            ("ifthenelse(0.2>0.5,1,0)", 0.),
            ("0.7>0.5 ? 2 : 1", 2.),
            ("0.2>0.5 ? 2 : 1", 1.),
            ("1<2", 1.),
            ("2<1", 0.),
            ("2>1", 1.),
            ("1==1", 1.),
            ("1!=1", 0.),
            ("1<=1", 1.),
            ("2>=3", 0.),
            ("1<=1 && 2>=3", 0.),
            ("1<=1 || 2>=3", 1.),
            ("!1", 0.),
            ("!0", 1.),
            ("1+2<4", 1.),
            ("1<2 == 1", 1.),
            ("0 || 1 && 0", 0.),
            // PGF's ?: is left-associative.
            ("1 ? 2 : 0 ? 3 : 4", 3.),
            ("0 ? 2 : 0 ? 3 : 4", 4.),
            ("2 > 1 ? 3 + 1 : 5", 4.),
            ("true", 1.),
            ("false", 0.),
            ("and(1,0)", 0.),
            ("or(1,0)", 1.),
            ("not(1)", 0.),
            ("equal(1,1)", 1.),
            ("greater(2,1)", 1.),
            ("less(2,1)", 0.),
            ("notequal(2,1)", 1.),
            ("notless(2,1)", 1.),
            ("notgreater(2,1)", 0.),
        ] {
            near(s, want);
        }
        for v in ["0.2", "0.5", "0.7", "0.9"] {
            assert_eq!(
                eval(&format!("ifthenelse({v}>0.5,2,1)")).unwrap(),
                eval(&format!("{v}>0.5 ? 2 : 1")).unwrap()
            );
        }
    }
    #[test]
    fn random_numbers_are_seeded_bounded_and_repeatable() {
        seed(Some(7.)).unwrap();
        let first: Vec<f64> = (0..5).map(|_| eval("rnd").unwrap()).collect();
        seed(Some(7.)).unwrap();
        let second: Vec<f64> = (0..5).map(|_| eval("rnd").unwrap()).collect();
        assert_eq!(first, second);
        seed(Some(8.)).unwrap();
        assert_ne!(first[0], eval("rnd").unwrap());
        // No seed: the fixed default, not the clock.
        seed(None).unwrap();
        let default = eval("rnd").unwrap();
        seed(None).unwrap();
        assert_eq!(default, eval("rnd").unwrap());
        for _ in 0..10_000 {
            let v = eval("rnd").unwrap();
            assert!((0. ..1.).contains(&v), "{v}");
            let v = eval("rand").unwrap();
            assert!((-1. ..=1.).contains(&v), "{v}");
            let v = eval("random()").unwrap();
            assert!((0. ..1.).contains(&v), "{v}");
            let v = eval("random(6)").unwrap();
            assert!((1. ..=6.).contains(&v) && v.fract() == 0., "{v}");
            let v = eval("random(-2,3)").unwrap();
            assert!((-2. ..=3.).contains(&v) && v.fract() == 0., "{v}");
        }
        assert!(seed(Some(1.5)).is_err());
        assert!(eval("random(1.5)").is_err());
    }
    #[test]
    fn rejects() {
        for s in [
            "1/0",
            "sqrt(-1)",
            "ln(0)",
            "unknown(1)",
            "sin(1,2)",
            "2cm",
            "nan",
            "1 trailing",
            "2**3",
            "1 ? 2",
            "min()",
            "1 =< 2",
        ] {
            assert!(eval(s).is_err(), "{s}");
        }
        assert!(eval(&format!("{}1{}", "(".repeat(100), ")".repeat(100))).is_err());
    }
}
