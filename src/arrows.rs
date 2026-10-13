use crate::options::{length, number};
use crate::syntax::{split_top, unbrace};
#[derive(Clone, Debug)]
pub struct Arrow {
    pub bar: bool,
    pub head: bool,
    pub stealth: bool,
    pub latex: bool,
    pub open: bool,
    pub length: f64,
    pub width: f64,
}
impl Arrow {
    pub fn parse(spec: &str) -> Result<Self, String> {
        let spec = unbrace(spec);
        let (name, parameters) = if let Some((name, rest)) = spec.split_once('[') {
            (
                name.trim(),
                rest.strip_suffix(']').ok_or("invalid arrow options")?,
            )
        } else {
            (spec.trim(), "")
        };
        if !["Latex", "latex", "Stealth", "stealth", "Triangle"].contains(&name) {
            return Err(format!("Unsupported arrow tip '{name}'"));
        }
        let mut len = 5.;
        let mut width = None;
        let mut scale = 1.;
        let mut open = false;
        for option in split_top(parameters, ',') {
            let (key, value) = option.split_once('=').unwrap_or((option, ""));
            match key.trim() {
                "length" => len = length(value, 1.)?,
                "width" => width = Some(length(value, 1.)?),
                "scale" => scale = number(value)?,
                "open" if value.is_empty() => open = true,
                key => return Err(format!("Unsupported arrow option '{key}'")),
            }
        }
        let width = width.unwrap_or(len * 0.6) * scale;
        len *= scale;
        if len <= 0. || width <= 0. || len > 1e5 || width > 1e5 {
            return Err("invalid arrow dimensions".into());
        }
        Ok(Self {
            bar: false,
            head: true,
            stealth: name.eq_ignore_ascii_case("stealth"),
            latex: name.eq_ignore_ascii_case("latex"),
            open,
            length: len,
            width,
        })
    }
}
pub fn pair(
    raw: &str,
    start_default: &str,
    end_default: &str,
) -> Result<(Option<Arrow>, Option<Arrow>), String> {
    if raw.is_empty() || raw == "-" {
        return Ok((None, None));
    }
    let parts = split_top(raw, '-');
    let (start, end) = if raw.starts_with('-') && parts.len() == 1 {
        ("", parts[0])
    } else if raw.ends_with('-') && parts.len() == 1 {
        (parts[0], "")
    } else if parts.len() == 2 {
        (parts[0], parts[1])
    } else {
        return Err("Unsupported arrow specification".into());
    };
    let parse = |spec: &str, default: &str| -> Result<Option<Arrow>, String> {
        if spec.is_empty() {
            Ok(None)
        } else {
            let bar = spec.contains('|');
            let spec = spec.trim_matches('|');
            let head = !spec.is_empty();
            let mut arrow = Arrow::parse(if spec == "<" || spec == ">" || spec.is_empty() {
                default
            } else {
                spec
            })?;
            arrow.bar = bar;
            arrow.head = head;
            Ok(Some(arrow))
        }
    };
    Ok((parse(start, start_default)?, parse(end, end_default)?))
}
