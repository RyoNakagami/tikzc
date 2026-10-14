//! Decimal number formatting for expanded labels.
use crate::syntax::split_top;

/// `\pgfmathprintnumber` for PGF's default (`std`) format and `fixed`, with
/// `precision` and `zerofill`. The result is math, as in PGF.
pub(super) fn print_number(value: f64, options: &str) -> Result<String, String> {
    let mut fixed = false;
    let mut precision = 2usize;
    let mut zerofill = false;
    for option in split_top(options, ',') {
        let (key, argument) = option.split_once('=').unwrap_or((option, ""));
        match (key.trim(), argument.trim()) {
            ("fixed", "") => fixed = true,
            ("zerofill", "" | "true") => zerofill = true,
            ("zerofill", "false") => zerofill = false,
            ("precision", digits) => {
                precision = digits
                    .parse()
                    .ok()
                    .filter(|p| *p <= 12)
                    .ok_or("number format precision must be an integer in 0..12")?;
            }
            _ => {
                return Err(format!(
                    "Unsupported number format option '{option}' (fixed, precision and zerofill are supported)"
                ));
            }
        }
    }
    // Round the decimal representation half up. A relative floating-point
    // bias changes large integers and rounds values below a tie upwards.
    // u128 holds all digits of the evaluator's 1e12 bound at precision 12.
    let digits = |magnitude: f64| -> Result<(String, String, bool), String> {
        let decimal = magnitude.to_string();
        let (integer, fraction) = decimal.split_once('.').unwrap_or((&decimal, ""));
        let mut fractional = fraction.bytes().chain(std::iter::repeat(b'0'));
        let mut rounded = integer
            .parse::<u128>()
            .map_err(|_| "invalid number magnitude")?;
        for digit in fractional.by_ref().take(precision) {
            rounded = rounded * 10 + u128::from(digit - b'0');
        }
        if fractional.next().unwrap() >= b'5' {
            rounded += 1;
        }
        let all = format!("{rounded:0width$}", width = precision + 1);
        let (integer, fraction) = all.split_at(all.len() - precision);
        let fraction = if zerofill {
            fraction
        } else {
            fraction.trim_end_matches('0')
        };
        Ok((integer.to_owned(), fraction.to_owned(), rounded == 0))
    };
    let join = |integer: &str, fraction: &str| {
        if fraction.is_empty() {
            integer.to_owned()
        } else {
            format!("{integer}.{fraction}")
        }
    };
    let magnitude = value.abs();
    // Normalizing via 10.powi(exponent) underflows for subnormal inputs.
    let scientific = format!("{magnitude:e}");
    let (mantissa, exponent) = scientific
        .split_once('e')
        .ok_or("invalid number magnitude")?;
    let mantissa: f64 = mantissa.parse().map_err(|_| "invalid number magnitude")?;
    let exponent: i32 = exponent.parse().map_err(|_| "invalid number exponent")?;
    let body = if fixed || (-1..=4).contains(&exponent) {
        let (integer, fraction, zero) = digits(magnitude)?;
        let mut grouped = String::new();
        for (i, digit) in integer.chars().enumerate() {
            if i > 0 && (integer.len() - i) % 3 == 0 {
                grouped.push_str("{,}");
            }
            grouped.push(digit);
        }
        format!(
            "{}{}",
            if value < 0. && !zero { "-" } else { "" },
            join(&grouped, &fraction)
        )
    } else {
        let mut exponent = exponent;
        let (mut integer, mut fraction, _) = digits(mantissa)?;
        if integer.len() > 1 {
            exponent += 1;
            (integer, fraction, _) = digits(mantissa / 10.)?;
        }
        format!(
            "{}{}\\cdot 10^{{{exponent}}}",
            if value < 0. { "-" } else { "" },
            join(&integer, &fraction)
        )
    };
    Ok(format!("\\ensuremath{{{body}}}"))
}
#[cfg(test)]
mod tests {
    use super::print_number;
    #[test]
    fn decimal_rounding_handles_precision_limits_and_subnormals() {
        for (options, value, want) in [
            (
                "fixed,precision=12,zerofill",
                1e12,
                "1{,}000{,}000{,}000{,}000.000000000000",
            ),
            ("fixed,precision=2", 0.145, "0.15"),
            ("fixed,precision=2", -0.145, "-0.15"),
            ("fixed,precision=2", 0.14499999999999, "0.14"),
            ("fixed,precision=2", 9.999, "10"),
            ("", 999999., r"1\cdot 10^{6}"),
            ("", 5e-324, r"5\cdot 10^{-324}"),
            ("fixed,precision=12", 5e-324, "0"),
        ] {
            assert_eq!(
                print_number(value, options).unwrap(),
                format!(r"\ensuremath{{{want}}}")
            );
        }
    }
    // Expected strings are `\pgfmathprintnumberto[options]{value}{\macro}` under
    // lualatex with PGF 3.1.10, with `\pgfutilensuremath` written `\ensuremath`.
    #[test]
    #[allow(clippy::approx_constant)] // 3.14159 is the literal given to TeX
    fn print_number_matches_pgf() {
        for (options, value, want) in [
            ("fixed,precision=2", 0.85669, "0.86"),
            ("fixed,precision=3,zerofill", 0.5, "0.500"),
            ("", 1234567., r"1.23\cdot 10^{6}"),
            ("", 12345.678, "12{,}345.68"),
            ("", 0.5, "0.5"),
            ("", 3., "3"),
            ("", -1234.5, "-1{,}234.5"),
            ("", 0.00012, r"1.2\cdot 10^{-4}"),
            ("", 0.05, r"5\cdot 10^{-2}"),
            ("", 99999., "99{,}999"),
            ("", 100000., r"1\cdot 10^{5}"),
            ("", 9999.999, "10{,}000"),
            ("", 0., "0"),
            ("", -0.004, r"-4\cdot 10^{-3}"),
            ("", 1000., "1{,}000"),
            ("", 0.995, "1"),
            ("", 0.994, "0.99"),
            ("fixed,precision=1", -0.04, "0"),
            ("fixed,precision=1", -0.06, "-0.1"),
            ("fixed,precision=0", 2.5, "3"),
            ("fixed,precision=0", 3.5, "4"),
            ("fixed,precision=2", 0.125, "0.13"),
            ("fixed,precision=2", 0.135, "0.14"),
            ("fixed,zerofill", 2., "2.00"),
            ("fixed,precision=2", 1000., "1{,}000"),
            ("precision=3", 3.14159, "3.142"),
            ("zerofill", 0.5, "0.50"),
            ("fixed", 0.000012, "0"),
        ] {
            assert_eq!(
                print_number(value, options).unwrap(),
                format!("\\ensuremath{{{want}}}"),
                "[{options}]{{{value}}}"
            );
        }
        for options in [
            "sci",
            "std",
            "int detect",
            "precision=x",
            "precision=13",
            "1000 sep={.}",
        ] {
            assert!(print_number(1., options).is_err(), "{options}");
        }
    }
}
