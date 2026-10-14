use crate::syntax::{split_top, unbrace};
use std::collections::BTreeMap;

pub type Values = BTreeMap<String, String>;
#[derive(Clone, Default)]
pub struct Styles {
    pub definitions: Values,
    pub defaults: Values,
    pub colors: BTreeMap<String, [f64; 3]>,
}

pub fn length(value: &str, unit: f64) -> Result<f64, String> {
    let v = unbrace(value).trim();
    let units = [
        ("cm", 72.0 / 2.54),
        ("mm", 72.0 / 25.4),
        ("pt", 72.0 / 72.27),
        ("bp", 1.0),
        ("in", 72.0),
        ("em", 10.0),
        ("ex", 4.3),
    ];
    let (n, scale) = units
        .iter()
        .find_map(|(suffix, scale)| v.strip_suffix(suffix).map(|n| (n, *scale)))
        .unwrap_or((v, unit));
    let n = crate::expr::eval(n.trim())?;
    let result = n * scale;
    if !result.is_finite() || result.abs() > 1e7 {
        return Err(format!("invalid length '{value}'"));
    }
    Ok(result)
}
/// Whether a coordinate component carries its own unit (and so ignores `x=`/`y=`).
pub fn has_unit(value: &str) -> bool {
    let v = unbrace(value).trim();
    ["cm", "mm", "pt", "bp", "in", "em", "ex"]
        .iter()
        .any(|suffix| v.ends_with(suffix))
}
pub fn number(value: &str) -> Result<f64, String> {
    length(value, 1.0)
}

impl Styles {
    pub fn resolve(&mut self, input: &str, base: &Values) -> Result<Values, String> {
        let mut result = base.clone();
        self.expand(input, &mut result, 0)?;
        Ok(result)
    }
    fn expand(&mut self, input: &str, output: &mut Values, depth: usize) -> Result<(), String> {
        if depth > 32 {
            return Err("recursive style expansion exceeds 32 levels".into());
        }
        for part in split_top(input, ',') {
            let pieces = split_top(part, '=');
            let key = pieces.first().copied().unwrap_or("");
            let value = if pieces.len() > 1 {
                &part[part.find('=').unwrap() + 1..]
            } else {
                ""
            };
            let key = key.trim();
            let value = unbrace(value);
            if let Some(name) = key.strip_suffix("/.style") {
                self.definitions.insert(name.into(), value.into());
                continue;
            }
            if let Some(name) = key.strip_suffix("/.append style") {
                let entry = self.definitions.entry(name.into()).or_default();
                entry.push(',');
                entry.push_str(value);
                continue;
            }
            if let Some(name) = key.strip_suffix("/.default") {
                self.defaults.insert(name.into(), value.into());
                continue;
            }
            if let Some(style) = self.definitions.get(key).cloned() {
                let argument = if value.is_empty() {
                    self.defaults.get(key).map(String::as_str).unwrap_or("")
                } else {
                    value
                };
                self.expand(&style.replace("#1", argument), output, depth + 1)?;
                continue;
            }
            if key.is_empty() {
                continue;
            }
            if key == "reset cm" {
                crate::transform::Matrix::default().store(output);
                continue;
            }
            if key == "label" {
                let i = output.keys().filter(|k| k.starts_with("_label ")).count();
                output.insert(format!("_label {i}"), value.into());
                continue;
            }
            if key == "color" {
                self.color(value)?;
                output.insert("draw color".into(), value.into());
                output.insert("text".into(), value.into());
                continue;
            }
            if self.color(key).is_ok() && value.is_empty() {
                output.insert("draw color".into(), key.into());
                output.insert("text".into(), key.into());
                continue;
            }
            // A colour mix that fails is reported as such, not as an unknown key.
            if value.is_empty()
                && key.contains('!')
                && self.rgb(key.split('!').next().unwrap().trim()).is_ok()
            {
                self.color(key)?;
            }
            if [
                "rectangle",
                "circle",
                "ellipse",
                "diamond",
                "coordinate",
                "cylinder",
            ]
            .contains(&key)
            {
                output.insert("shape".into(), key.into());
                continue;
            }
            let key = if key == "'" { "swap" } else { key };
            if ["->", "<-", "<->", "-", "|<->|", "|-|", "|->", "<-|"].contains(&key)
                || key.starts_with("-{")
                || (key.starts_with('{') && key.contains("}-"))
            {
                output.insert("arrows".into(), key.into());
                continue;
            }
            const KEYS: &[&str] = &[
                "draw",
                "fill",
                "pattern",
                "pattern color",
                "matrix of nodes",
                "nodes",
                "row sep",
                "column sep",
                "even odd rule",
                "nonzero rule",
                "text",
                "line width",
                "ultra thin",
                "very thin",
                "thin",
                "semithick",
                "thick",
                "very thick",
                "ultra thick",
                "dashed",
                "dotted",
                "densely dashed",
                "loosely dashed",
                "densely dotted",
                "loosely dotted",
                "solid",
                "dash pattern",
                "rounded corners",
                "sharp corners",
                "double",
                "double distance",
                "line cap",
                "line join",
                "opacity",
                "fill opacity",
                "draw opacity",
                "text opacity",
                "shape",
                "aspect",
                "at",
                "decorate",
                "decoration",
                "smooth",
                "tension",
                "shape border rotate",
                "step",
                "xstep",
                "ystep",
                "label",
                "label distance",
                "inner sep",
                "inner xsep",
                "inner ysep",
                "outer sep",
                "outer xsep",
                "outer ysep",
                "transform shape",
                "minimum width",
                "minimum height",
                "minimum size",
                "text width",
                "align",
                "anchor",
                "font",
                "name",
                "shift",
                "xshift",
                "yshift",
                "scale",
                "xscale",
                "yscale",
                "rotate",
                "node distance",
                "on background layer",
                "fit",
                "above",
                "below",
                "left",
                "right",
                "above left",
                "above right",
                "below left",
                "below right",
                "auto",
                "swap",
                "pos",
                "midway",
                "near start",
                "near end",
                "at start",
                "at end",
                "sloped",
                ">",
                "<",
                "shorten <",
                "shorten >",
                "arrows",
                "out",
                "in",
                "bend left",
                "bend right",
                "looseness",
                "start angle",
                "end angle",
                "radius",
                "x radius",
                "y radius",
                "x",
                "y",
                "z",
                "on grid",
                "domain",
                "samples",
                "variable",
                "mark",
                "mark size",
                "only marks",
                "name path",
                "name path global",
                "name intersections",
                "postaction",
                "shade",
                "shading",
                "shading angle",
                "left color",
                "right color",
                "top color",
                "bottom color",
                "middle color",
                "inner color",
                "outer color",
            ];
            if !KEYS.contains(&key) {
                return Err(format!("Unsupported option '{key}'"));
            }
            // `shift` is read in cm; it does not follow redefined unit vectors.
            if key == "shift" && (output.contains_key("x") || output.contains_key("y")) {
                return Err("Unsupported shift together with x/y unit vectors".into());
            }
            if let Some(local) = crate::transform::Matrix::option(key, value)? {
                crate::transform::Matrix::from_options(output)?
                    .then(local)?
                    .store(output);
            }
            if key == "shape"
                && ![
                    "rectangle",
                    "circle",
                    "ellipse",
                    "diamond",
                    "coordinate",
                    "cylinder",
                ]
                .contains(&value)
            {
                return Err(format!("Unsupported shape '{value}'"));
            }
            if key == "align" && !["left", "right", "center", "justify"].contains(&value) {
                return Err(format!("Unsupported alignment '{value}'"));
            }
            output.insert(key.into(), value.into());
        }
        Ok(())
    }
    pub fn define_color(&mut self, name: &str, model: &str, value: &str) -> Result<(), String> {
        let rgb = match model {
            "HTML" if value.len() == 6 => {
                let n = u32::from_str_radix(value, 16).map_err(|_| "invalid HTML color")?;
                [
                    ((n >> 16) & 255) as f64,
                    ((n >> 8) & 255) as f64,
                    (n & 255) as f64,
                ]
            }
            "rgb" | "RGB" => {
                let n: Vec<f64> = value.split(',').map(number).collect::<Result<_, _>>()?;
                if n.len() != 3 {
                    return Err("color needs three channels".into());
                }
                let m = if model == "rgb" { 255.0 } else { 1.0 };
                [n[0] * m, n[1] * m, n[2] * m]
            }
            "gray" => [number(value)? * 255.0; 3],
            _ => return Err(format!("Unsupported color model '{model}'")),
        };
        self.colors.insert(name.into(), rgb);
        Ok(())
    }
    fn rgb(&self, name: &str) -> Result<[f64; 3], String> {
        if let Some(c) = self.colors.get(name) {
            return Ok(*c);
        }
        Ok(match name {
            "black" => [0., 0., 0.],
            "white" => [255., 255., 255.],
            "red" => [255., 0., 0.],
            "green" => [0., 255., 0.],
            "blue" => [0., 0., 255.],
            "gray" => [128.; 3],
            "lightgray" => [191.; 3],
            "darkgray" => [64.; 3],
            "yellow" => [255., 255., 0.],
            "orange" => [255., 128., 0.],
            "teal" => [0., 128., 128.],
            "cyan" => [0., 255., 255.],
            "magenta" => [255., 0., 255.],
            "purple" => [191., 0., 64.],
            "brown" => [191., 128., 64.],
            "violet" => [128., 0., 128.],
            "pink" => [255., 191., 191.],
            "lime" => [191., 255., 0.],
            "olive" => [128., 128., 0.],
            _ => return Err(format!("Unsupported color '{name}'")),
        })
    }
    pub fn color(&self, expression: &str) -> Result<String, String> {
        let expression = unbrace(expression);
        if expression == "none" {
            return Ok("none".into());
        }
        let pieces: Vec<_> = expression.split('!').collect();
        let mut c = self.rgb(pieces[0].trim())?;
        let mut i = 1;
        while i < pieces.len() {
            let ratio = number(pieces[i])? / 100.;
            if !(0.0..=1.0).contains(&ratio) {
                return Err("color percentage outside 0..100".into());
            }
            let other = self.rgb(pieces.get(i + 1).unwrap_or(&"white").trim())?;
            for j in 0..3 {
                c[j] = c[j] * ratio + other[j] * (1. - ratio);
            }
            i += 2;
        }
        Ok(format!(
            "#{:02x}{:02x}{:02x}",
            c[0].round() as u8,
            c[1].round() as u8,
            c[2].round() as u8
        ))
    }
}

pub fn get<'a>(opts: &'a Values, key: &str, default: &'a str) -> &'a str {
    opts.get(key).map(String::as_str).unwrap_or(default)
}
pub fn dim(opts: &Values, key: &str, default: f64) -> Result<f64, String> {
    opts.get(key).map(|v| length(v, 1.)).unwrap_or(Ok(default))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn styles_and_recursion() {
        let mut s = Styles::default();
        let o = s
            .resolve("box/.style={draw=#1,fill=white},box=red", &Values::new())
            .unwrap();
        assert_eq!(o["draw"], "red");
        assert!(s.resolve("x/.style={x},x", &Values::new()).is_err());
    }
    #[test]
    fn units() {
        assert!((length("1in", 1.).unwrap() - length("72.27pt", 1.).unwrap()).abs() < 1e-8);
        assert!(length("NaN", 1.).is_err());
    }
    #[test]
    fn mixed_color() {
        assert_eq!(Styles::default().color("red!50!blue").unwrap(), "#800080");
    }
}
