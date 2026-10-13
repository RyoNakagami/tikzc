//! Strict SVG path tokenization for outline-only precision reduction.
pub(super) fn round_path(data: &str, places: usize) -> Result<String, String> {
    if places > 9 {
        return Err("unsupported glyph precision".into());
    }
    let bytes = data.as_bytes();
    let mut at = 0;
    let mut out = String::with_capacity(data.len());
    let mut command = None;
    let mut count = 0;
    let mut arity = 0;
    let mut previous_flag = false;
    while at < bytes.len() {
        let start = at;
        while at < bytes.len() && bytes[at].is_ascii_whitespace() {
            at += 1;
        }
        let mut separated = at != start;
        if at == bytes.len() {
            break;
        }
        if bytes[at] == b',' {
            if count == 0 || arity == 0 {
                return Err("unexpected comma in glyph path".into());
            }
            at += 1;
            while at < bytes.len() && bytes[at].is_ascii_whitespace() {
                at += 1;
            }
            if at == bytes.len() || bytes[at] == b',' || bytes[at].is_ascii_alphabetic() {
                return Err("missing number after glyph path comma".into());
            }
            separated = true;
        }
        if bytes[at].is_ascii_alphabetic() {
            if arity != 0 && (count == 0 || count % arity != 0) {
                return Err("incomplete glyph path command".into());
            }
            let c = bytes[at];
            if command.is_none() && !matches!(c, b'M' | b'm') {
                return Err("glyph path must begin with moveto".into());
            }
            arity = match c.to_ascii_uppercase() {
                b'M' | b'L' | b'T' => 2,
                b'H' | b'V' => 1,
                b'C' => 6,
                b'S' | b'Q' => 4,
                b'A' => 7,
                b'Z' => 0,
                _ => return Err("unknown glyph path command".into()),
            };
            command = Some(c);
            count = 0;
            previous_flag = false;
            out.push(c as char);
            at += 1;
            continue;
        }
        if arity == 0 {
            return Err("unexpected number in glyph path".into());
        }
        if count > 0 && !separated && !previous_flag && !matches!(bytes[at], b'+' | b'-' | b'.') {
            return Err("missing glyph path number separator".into());
        }
        let arc = command.unwrap().eq_ignore_ascii_case(&b'A');
        let flag = arc && matches!(count % arity, 3 | 4);
        let begin = at;
        if flag {
            if !matches!(bytes[at], b'0' | b'1') {
                return Err("invalid glyph arc flag".into());
            }
            at += 1;
        } else {
            if matches!(bytes[at], b'+' | b'-') {
                at += 1;
            }
            let mut digits = 0;
            while at < bytes.len() && bytes[at].is_ascii_digit() {
                digits += 1;
                at += 1;
            }
            if at < bytes.len() && bytes[at] == b'.' {
                at += 1;
                while at < bytes.len() && bytes[at].is_ascii_digit() {
                    digits += 1;
                    at += 1;
                }
            }
            if digits == 0 {
                return Err("invalid glyph path number".into());
            }
            if at < bytes.len() && matches!(bytes[at], b'e' | b'E') {
                at += 1;
                if at < bytes.len() && matches!(bytes[at], b'+' | b'-') {
                    at += 1;
                }
                let exponent = at;
                while at < bytes.len() && bytes[at].is_ascii_digit() {
                    at += 1;
                }
                if at == exponent {
                    return Err("invalid glyph path exponent".into());
                }
            }
        }
        let number: f64 = data[begin..at]
            .parse()
            .map_err(|_| "invalid glyph path number")?;
        if !number.is_finite() || (arc && count % arity < 2 && number < 0.) {
            return Err("invalid glyph path coordinate".into());
        }
        let mut rounded = format!("{number:.places$}");
        if rounded.contains('.') {
            rounded.truncate(rounded.trim_end_matches('0').trim_end_matches('.').len());
        }
        if rounded == "-0" {
            rounded = "0".into();
        }
        // Always separate consecutive numbers: rounding may remove a sign or
        // decimal point that served as an implicit separator in the input.
        if count > 0 {
            out.push(' ');
        }
        out.push_str(&rounded);
        count += 1;
        previous_flag = flag;
    }
    if arity != 0 && (count == 0 || count % arity != 0) {
        return Err("incomplete glyph path command".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decimals_exponents_adjacent_numbers_flags_and_negative_zero() {
        for (input, expected) in [
            ("M10.123456789 20.987654321", "M10.1235 20.9877"),
            (
                "M0 0l-0.123456789 0.500000000h1.000000000v-0.000000001",
                "M0 0l-0.1235 0.5h1v0",
            ),
            ("M1e-5 2.5e+1", "M0 25"),
            ("M10-5", "M10 -5"),
            ("M.5.6L1-0.000000001", "M0.5 0.6L1 0"),
            ("m+1,2 3,4z", "m1 2 3 4z"),
            ("M0 0A10 20 30 0110 20", "M0 0A10 20 30 0 1 10 20"),
            (
                "M0 0C1 2 3 4 5 6s1 2 3 4Q1 2 3 4t1 2Z",
                "M0 0C1 2 3 4 5 6s1 2 3 4Q1 2 3 4t1 2Z",
            ),
        ] {
            let result = round_path(input, 4).unwrap();
            assert_eq!(result, expected);
            let svg = format!(
                r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="{result}"/></svg>"#
            );
            resvg::usvg::Tree::from_str(&svg, &Default::default()).unwrap();
        }
    }
    #[test]
    fn malformed_paths_fail() {
        for input in [
            "L0 0",
            "M",
            "M0",
            "M0 0L",
            "M0 0L1e 2",
            "M1e999 0",
            "M. 0",
            "M0,,0",
            "M0 0,",
            "M0 0,L1 2",
            "M0 0X1",
            "M0 0Z1 2",
            "M0 0A1 2 0 2 0 3 4",
            "M0 0A-1 2 0 0 0 3 4",
            "M0 0LNaN 2",
        ] {
            assert!(round_path(input, 4).is_err(), "{input}");
        }
    }
}
