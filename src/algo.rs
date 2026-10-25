//! Pseudocode (`algorithm` environments, pseudocode.js syntax) rendered next
//! to or inside a TikZ figure, with `% @src` / `% @ref` / `% @explain` notes.
//!
//! The environments are cut out of the source (bytes replaced by spaces, so
//! every offset stays valid) before the TikZ expander sees it.
pub mod ast;
pub mod layout;
mod lexer;
pub use lexer::valid_id;
pub mod lint;
mod parser;
pub mod render;

use crate::options::number;
use crate::syntax::Diagnostic;
use ast::Algorithm;
use std::collections::BTreeMap;
use std::path::PathBuf;

pub use lint::{Lint, Severity};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Left,
    Right,
    Top,
    Bottom,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Align {
    Start,
    Center,
    End,
}

/// `#|` header settings for pseudocode and its placement next to a figure.
/// Placement lengths are CSS px (1/96 in), as on a 1600x900 slide.
#[derive(Clone, Debug)]
pub struct Settings {
    pub line_number: bool,
    pub line_number_punc: String,
    pub no_end: bool,
    pub scope_lines: bool,
    pub title_prefix: String,
    /// A Typst length (`1.2em`, `12pt`).
    pub indent_size: String,
    pub comment_delimiter: String,
    pub paper: Option<String>,
    /// `owner/repo@rev`.
    pub implementation: Option<String>,
    pub explain: bool,
    pub layout: Side,
    pub canvas: Option<(f64, f64)>,
    pub gap: f64,
    pub align: Align,
    pub at: Option<(f64, f64)>,
    pub anchor: String,
    pub shift: (f64, f64),
    pub scale: f64,
    /// Offsets of the headers given, for diagnostics.
    pub headers: BTreeMap<&'static str, usize>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            line_number: false,
            line_number_punc: ":".into(),
            no_end: false,
            scope_lines: false,
            title_prefix: "Algorithm".into(),
            indent_size: "1.2em".into(),
            comment_delimiter: "//".into(),
            paper: None,
            implementation: None,
            explain: true,
            layout: Side::Left,
            canvas: None,
            gap: 48.,
            align: Align::Center,
            at: None,
            anchor: "north west".into(),
            shift: (0., 0.),
            scale: 1.,
            headers: BTreeMap::new(),
        }
    }
}

pub const HEADERS: &[&str] = &[
    "line-number",
    "line-number-punc",
    "no-end",
    "scope-lines",
    "title-prefix",
    "indent-size",
    "comment-delimiter",
    "paper",
    "impl",
    "explain",
    "layout",
    "canvas",
    "gap",
    "align",
    "algo-at",
    "algo-anchor",
    "algo-shift",
    "algo-scale",
];

fn boolean(value: &str) -> Result<bool, String> {
    match value {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(format!("expected true or false, found '{value}'")),
    }
}
/// `(x, y)` in px.
fn pair(value: &str) -> Result<(f64, f64), String> {
    let inner = value
        .trim()
        .strip_prefix('(')
        .and_then(|v| v.strip_suffix(')'))
        .ok_or_else(|| format!("expected (x, y) in px, found '{value}'"))?;
    let (x, y) = inner
        .split_once(',')
        .ok_or_else(|| format!("expected (x, y) in px, found '{value}'"))?;
    let (x, y) = (px(x)?, px(y)?);
    Ok((x, y))
}
fn px(value: &str) -> Result<f64, String> {
    let value = value.trim();
    let n = number(value.strip_suffix("px").unwrap_or(value))?;
    if !n.is_finite() {
        return Err(format!("'{value}' is not a finite length"));
    }
    Ok(n)
}

impl Settings {
    /// Apply one header; `None` if `key` is not a pseudocode header.
    pub fn header(&mut self, key: &str, value: &str, offset: usize) -> Option<Result<(), String>> {
        let name = *HEADERS.iter().find(|h| **h == key)?;
        self.headers.insert(name, offset);
        Some((|| {
            match name {
                "line-number" => self.line_number = boolean(value)?,
                "line-number-punc" => self.line_number_punc = value.into(),
                "no-end" => self.no_end = boolean(value)?,
                "scope-lines" => self.scope_lines = boolean(value)?,
                "title-prefix" => self.title_prefix = value.into(),
                "indent-size" => {
                    let unit = ["em", "pt"]
                        .into_iter()
                        .find(|u| value.ends_with(u))
                        .ok_or("indent-size must be in em or pt, e.g. 1.2em")?;
                    let n = number(&value[..value.len() - 2])?;
                    if !(0. ..=20.).contains(&n) {
                        return Err("indent-size must be in [0, 20]".into());
                    }
                    self.indent_size = format!("{n}{unit}");
                }
                "comment-delimiter" => self.comment_delimiter = value.into(),
                "paper" => self.paper = Some(value.into()).filter(|v: &String| !v.is_empty()),
                "impl" => {
                    match value.rsplit_once('@') {
                        Some((repo, rev))
                            if !repo.is_empty()
                                && !rev.is_empty()
                                && !rev.contains(char::is_whitespace) => {}
                        _ => {
                            return Err(format!(
                                "[impl-no-rev] impl needs a revision to pin line numbers: owner/repo@rev, e.g. '{}@a1b2c3d'",
                                value.split('@').next().unwrap_or(value)
                            ));
                        }
                    }
                    self.implementation = Some(value.into());
                }
                "explain" => {
                    self.explain = match value {
                        "below" => true,
                        "none" => false,
                        _ => return Err("explain must be below or none".into()),
                    }
                }
                "layout" => {
                    self.layout = match value {
                        "algo-left" => Side::Left,
                        "algo-right" => Side::Right,
                        "algo-top" => Side::Top,
                        "algo-bottom" => Side::Bottom,
                        _ => {
                            return Err(
                                "layout must be algo-left, algo-right, algo-top or algo-bottom"
                                    .into(),
                            );
                        }
                    }
                }
                "canvas" => {
                    let (w, h) = value
                        .split_once('x')
                        .ok_or("canvas must be WIDTHxHEIGHT in px, e.g. 1600x900")?;
                    let (w, h) = (px(w)?, px(h)?);
                    if !(1. ..=40000.).contains(&w) || !(1. ..=40000.).contains(&h) {
                        return Err("canvas sides must be in [1, 40000] px".into());
                    }
                    self.canvas = Some((w, h));
                }
                "gap" => {
                    self.gap = px(value)?;
                    if self.gap < 0. {
                        return Err("gap must not be negative".into());
                    }
                }
                "align" => {
                    self.align = match value {
                        "start" => Align::Start,
                        "center" => Align::Center,
                        "end" => Align::End,
                        _ => return Err("align must be start, center or end".into()),
                    }
                }
                "algo-at" => self.at = Some(pair(value)?),
                "algo-anchor" => {
                    render::anchor_offset(value, 1., 1.)?;
                    self.anchor = value.into();
                }
                "algo-shift" => self.shift = pair(value)?,
                "algo-scale" => {
                    self.scale = number(value)?;
                    if !(self.scale > 0. && self.scale <= 20.) {
                        return Err("algo-scale must be in (0, 20]".into());
                    }
                }
                _ => unreachable!(),
            }
            Ok(())
        })())
    }
}

/// An `algorithm` loaded through `algo=<path>`.
#[derive(Clone, Debug)]
pub struct External {
    pub path: PathBuf,
    pub algorithm: Algorithm,
}

/// Pseudocode of one compilation: the source's algorithms, the files they
/// reference and the figure-reference numbering shared with `ref=` nodes.
#[derive(Clone, Debug, Default)]
pub struct Context {
    pub settings: Settings,
    pub algorithms: Vec<Algorithm>,
    /// `algo=` values that name files, keyed by the value as written.
    pub external: BTreeMap<String, External>,
    /// `@ref` ID -> label of the line in TeX, shown before the text of the
    /// `ref=` node: its line number (`5:`) or, for a line without one, its
    /// circled marker.
    pub refs: BTreeMap<String, String>,
    /// Per algorithm (`algorithms`, then `external` in key order), the marker
    /// number of each line.
    markers: Vec<Vec<Option<usize>>>,
    /// `algo=` nodes placed while rendering: (value, source offset).
    pub placed: Vec<(String, usize)>,
    /// `ref=` nodes placed while rendering: (ID, source offset).
    pub figure_refs: Vec<(String, usize)>,
    /// `@ref` IDs used as line nodes in the figure source (`(A-<id>.west)`).
    pub line_refs: std::collections::BTreeSet<String>,
}

/// Cut the `algorithm` environments out of `source` and parse them.
/// Returns the source with those bytes blanked and the algorithms.
pub fn extract(source: &str) -> Result<(String, Vec<Algorithm>), Diagnostic> {
    let clean = crate::syntax::clean(source);
    if !clean.contains("algorithm}") {
        return Ok((source.into(), Vec::new()));
    }
    let ranges = lexer::environments(&clean).map_err(|(at, m)| Diagnostic::at(source, at, m))?;
    let mut blanked = source.as_bytes().to_vec();
    let mut algorithms = Vec::new();
    // Like LaTeX's counter: `number=` sets it, later algorithms continue;
    // `number=none` (as `\caption*`) leaves it unchanged.
    let mut next = 1;
    for range in ranges {
        let algorithm = parser::algorithm(source, &clean, range.clone(), Some(next))
            .map_err(|(at, m)| Diagnostic::at(source, at, m))?;
        next = algorithm.number.map_or(next, |n| n + 1);
        if let Some(name) = &algorithm.name
            && algorithms
                .iter()
                .any(|a: &Algorithm| a.name.as_ref() == Some(name))
        {
            return Err(Diagnostic::at(
                source,
                algorithm.offset,
                format!("duplicate algorithm name '{name}'; names must be unique in a file"),
            ));
        }
        algorithms.push(algorithm);
        for b in &mut blanked[range] {
            if *b != b'\n' {
                *b = b' ';
            }
        }
    }
    let blanked = String::from_utf8(blanked).expect("environment bytes replaced by ASCII");
    Ok((blanked, algorithms))
}

/// `algo=` values written in a cleaned source, with their offsets. Found
/// before rendering so `ref=` markers are numbered before any node is drawn.
fn algo_keys(clean: &str) -> Vec<(String, usize)> {
    let mut keys = Vec::new();
    let bytes = clean.as_bytes();
    let mut from = 0;
    while let Some(i) = clean[from..].find("algo") {
        let at = from + i;
        from = at + 4;
        let before = clean[..at].trim_end();
        if !(before.ends_with('[') || before.ends_with(',')) {
            continue;
        }
        let rest = clean[from..].trim_start();
        let Some(value) = rest.strip_prefix('=') else {
            continue;
        };
        let start = clean.len() - value.len();
        let mut end = start;
        let mut depth = 0;
        while end < bytes.len() {
            match bytes[end] {
                b'{' => depth += 1,
                b'}' => depth -= 1,
                b',' | b']' if depth == 0 => break,
                _ => {}
            }
            end += 1;
        }
        let value = crate::syntax::unbrace(clean[start..end].trim());
        if !value.is_empty() {
            keys.push((value.to_owned(), at));
        }
    }
    keys
}

impl Context {
    /// Resolve `algo=` files and number the figure references. `base` is the
    /// directory relative `algo=` paths are read from.
    pub fn new(
        source: &str,
        blanked: &str,
        settings: Settings,
        algorithms: Vec<Algorithm>,
        base: Option<&std::path::Path>,
    ) -> Result<Self, Diagnostic> {
        let mut context = Self {
            settings,
            algorithms,
            ..Default::default()
        };
        let clean = crate::syntax::clean(blanked);
        for (value, at) in algo_keys(&clean) {
            if context.named(&value).is_some() || context.external.contains_key(&value) {
                continue;
            }
            let path = base.map_or_else(|| PathBuf::from(&value), |b| b.join(&value));
            let missing = |detail: String| {
                let names: Vec<_> = context
                    .algorithms
                    .iter()
                    .filter_map(|a| a.name.clone())
                    .collect();
                Diagnostic::at(
                    source,
                    at,
                    format!(
                        "[algo-name-missing] algo='{value}' is neither an algorithm name in this file{} nor a readable file ({detail}); use \\begin{{algorithm}}[name={value}] or a path relative to this file",
                        if names.is_empty() {
                            String::new()
                        } else {
                            format!(" (names: {})", names.join(", "))
                        }
                    ),
                )
            };
            let text = std::fs::read_to_string(&path)
                .map_err(|e| missing(format!("{}: {e}", path.display())))?;
            let (_, algorithms) = extract(&text).map_err(|d| {
                Diagnostic::at(
                    source,
                    at,
                    format!("{}:{}:{}: {}", path.display(), d.line, d.column, d.message),
                )
            })?;
            let algorithm = algorithms.into_iter().next().ok_or_else(|| {
                missing(format!("{} has no algorithm environment", path.display()))
            })?;
            context.external.insert(value, External { path, algorithm });
        }
        // Annotated lines are referred to by line number (numbering is then
        // forced); only lines without one (`\REQUIRE`, ...) get a marker.
        let mut next = 0;
        let mut markers = Vec::new();
        let mut refs = BTreeMap::new();
        for algorithm in context.all() {
            let numbers = layout::line_numbers(algorithm, &context.settings);
            let mut lines = Vec::new();
            for (line, number) in algorithm.lines.iter().zip(numbers) {
                let notes = &line.notes;
                let label = match number {
                    Some(n) => {
                        lines.push(None);
                        format!("{n}{}", context.settings.line_number_punc)
                    }
                    None if notes.refs.is_empty() && notes.explain.is_none() => {
                        lines.push(None);
                        continue;
                    }
                    None => {
                        next += 1;
                        lines.push(Some(next));
                        format!("\\tikzcref{{{next}}}")
                    }
                };
                for id in &notes.refs {
                    refs.entry(id.clone()).or_insert_with(|| label.clone());
                }
            }
            markers.push(lines);
        }
        context.markers = markers;
        // An arrow from `(<name>-<id>)` also links the line to the figure.
        context.line_refs = refs
            .keys()
            .filter(|id| {
                [")", ".", " "]
                    .iter()
                    .any(|end| clean.contains(&format!("-{id}{end}")))
            })
            .cloned()
            .collect();
        context.refs = refs;
        for algorithm in context.all() {
            lint::provenance(&context.settings, algorithm)
                .map_err(|(at, m)| Diagnostic::at(source, at, m))?;
        }
        Ok(context)
    }
    /// Every algorithm, in marker-numbering order.
    pub fn all(&self) -> impl Iterator<Item = &Algorithm> {
        self.algorithms
            .iter()
            .chain(self.external.values().map(|e| &e.algorithm))
    }
    pub fn named(&self, name: &str) -> Option<&Algorithm> {
        self.algorithms
            .iter()
            .find(|a| a.name.as_deref() == Some(name))
    }
    /// `algo=` lookup: an algorithm name in this file, then a file path.
    pub fn resolve(&self, value: &str) -> Option<&Algorithm> {
        self.named(value)
            .or_else(|| self.external.get(value).map(|e| &e.algorithm))
    }
    /// Line index of a line reference: a displayed line number or an `@ref` ID.
    pub fn line(&self, algorithm: &Algorithm, reference: &str) -> Option<usize> {
        let numbers = layout::line_numbers(algorithm, &self.settings);
        reference
            .parse::<usize>()
            .ok()
            .and_then(|n| numbers.iter().position(|m| *m == Some(n)))
            .or_else(|| {
                algorithm
                    .lines
                    .iter()
                    .position(|l| l.notes.refs.iter().any(|r| r == reference))
            })
    }
    /// Names of the line nodes of each line (`5`, `sparse-corner`, ...).
    pub fn line_names(&self, algorithm: &Algorithm) -> Vec<Vec<String>> {
        let numbers = layout::line_numbers(algorithm, &self.settings);
        algorithm
            .lines
            .iter()
            .zip(numbers)
            .map(|(line, number)| {
                number
                    .map(|n| n.to_string())
                    .into_iter()
                    .chain(line.notes.refs.iter().cloned())
                    .collect()
            })
            .collect()
    }
    pub fn markers(&self, algorithm: &Algorithm) -> &[Option<usize>] {
        let index = self
            .all()
            .position(|a| std::ptr::eq(a, algorithm))
            .expect("algorithm belongs to this context");
        &self.markers[index]
    }
    /// Typst markup of one algorithm.
    pub fn document(&self, algorithm: &Algorithm) -> Result<String, String> {
        self.focused(algorithm, &layout::Focus::default(), layout::FONT_SIZE)
    }
    /// Typst markup of one algorithm set at `font_size` (bp), e.g. the
    /// `font=` of an `algo=` node.
    pub fn sized(&self, algorithm: &Algorithm, font_size: f64) -> Result<String, String> {
        self.focused(algorithm, &layout::Focus::default(), font_size)
    }
    /// Typst markup of one algorithm with highlighted lines.
    pub fn focused(
        &self,
        algorithm: &Algorithm,
        focus: &layout::Focus,
        font_size: f64,
    ) -> Result<String, String> {
        layout::document(
            algorithm,
            &self.settings,
            self.markers(algorithm),
            focus,
            font_size,
            &crate::options::Styles::default(),
        )
    }
}
