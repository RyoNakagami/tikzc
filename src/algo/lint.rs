//! Pseudocode linter (`tikzc check`). Rules that make a document unrenderable
//! (`algo-unbalanced`, `src-bad-format`, ...) are compile errors instead.
use super::ast::{Algorithm, Kind};
use super::render::{PX, Placement};
use super::{Context, Settings};
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    Info,
    Warning,
    Error,
}
impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Severity::Info => "info",
            Severity::Warning => "warning",
            Severity::Error => "error",
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Lint {
    pub code: &'static str,
    pub severity: Severity,
    /// Byte offset in the source.
    pub offset: usize,
    /// What is wrong and how to fix it.
    pub message: String,
}
impl Lint {
    fn new(code: &'static str, severity: Severity, offset: usize, message: String) -> Self {
        Self {
            code,
            severity,
            offset,
            message,
        }
    }
}

/// `impl=` locators need a pinned revision, or their line numbers drift.
pub(super) fn provenance(
    settings: &Settings,
    algorithm: &Algorithm,
) -> Result<(), (usize, String)> {
    if settings.implementation.is_some() {
        return Ok(());
    }
    if let Some(line) = algorithm
        .lines
        .iter()
        .find(|l| !l.notes.implementation.is_empty())
    {
        return Err((
            line.notes.offset.unwrap_or(line.offset),
            "[impl-no-rev] impl= locators need the pinned repository revision; add a header such as '#| impl: owner/repo@a1b2c3d'".into(),
        ));
    }
    Ok(())
}

/// Lines that compute or decide: assignments, updates and conditions.
fn needs_source(kind: Kind, text: &str) -> bool {
    match kind {
        Kind::If | Kind::ElsIf | Kind::While | Kind::Until => true,
        Kind::State | Kind::Return => ["\\gets", "\\leftarrow", ":=", "="]
            .iter()
            .any(|op| text.contains(op)),
        _ => false,
    }
}

/// Rules over the algorithms drawn, the figure's `ref=` nodes and the
/// automatic placement. `figure` is false for pseudocode-only output.
pub fn check(
    context: &Context,
    drawn: &[&Algorithm],
    figure: bool,
    placement: Option<&Placement>,
) -> Vec<Lint> {
    let mut lints = Vec::new();
    let provenance = context.settings.paper.is_some()
        || context.settings.implementation.is_some()
        || context
            .all()
            .any(|a| a.lines.iter().any(|l| l.notes.sourced()));
    for algorithm in drawn {
        for line in &algorithm.lines {
            let notes = &line.notes;
            if provenance && !notes.sourced() && needs_source(line.kind, &line.text) {
                lints.push(Lint::new(
                    "src-unsourced",
                    Severity::Warning,
                    line.offset,
                    "this assignment/condition has no source; add '% @src paper=<eq> impl=<path:line>' at the end of the line".into(),
                ));
            }
            if !notes.refs.is_empty() && notes.explain.is_none() {
                lints.push(Lint::new(
                    "explain-missing",
                    Severity::Info,
                    notes.offset.unwrap_or(line.offset),
                    "line refers to the figure without an explanation; add '% @explain <one or two sentences>'".into(),
                ));
            }
            if figure {
                for id in &notes.refs {
                    if !context.figure_refs.iter().any(|(r, _)| r == id)
                        && !context.line_refs.contains(id)
                    {
                        lints.push(Lint::new(
                            "ref-dangling",
                            Severity::Error,
                            notes.offset.unwrap_or(line.offset),
                            format!("@ref {id} has no figure node; add \\node[ref={id}] ... or an arrow from (<algo node name>-{id}) to the tikzpicture, or remove the @ref"),
                        ));
                    }
                }
            }
        }
    }
    for (id, at) in &context.figure_refs {
        if !context.refs.contains_key(id) {
            lints.push(Lint::new(
                "ref-unused",
                Severity::Warning,
                *at,
                format!("ref={id} is not referenced by any pseudocode line; add '% @ref {id}' after a statement"),
            ));
        }
    }
    if !context.placed.is_empty() {
        for key in [
            "layout",
            "algo-at",
            "algo-shift",
            "algo-anchor",
            "algo-scale",
        ] {
            if let Some(at) = context.settings.headers.get(key) {
                lints.push(Lint::new(
                    "layout-conflict",
                    Severity::Warning,
                    *at,
                    format!("'#| {key}' is ignored because an \\node[algo=...] places the pseudocode; remove one of them"),
                ));
            }
        }
    }
    if let Some(p) = placement {
        let rect = |(x, y): (f64, f64), (w, h): (f64, f64)| (x, y, x + w, y + h);
        let a = rect(p.algo, p.algo_size);
        let f = rect(p.figure, p.figure_size);
        let at = context
            .settings
            .headers
            .get("algo-at")
            .or_else(|| context.settings.headers.get("algo-shift"))
            .or_else(|| context.settings.headers.get("layout"))
            .copied()
            .unwrap_or(drawn.first().map_or(0, |a| a.offset));
        let (ox, oy) = (a.2.min(f.2) - a.0.max(f.0), a.3.min(f.3) - a.1.max(f.1));
        if ox > 0.01 && oy > 0.01 {
            lints.push(Lint::new(
                "algo-overlap",
                Severity::Warning,
                at,
                format!("pseudocode overlaps the figure by {:.0}x{:.0} px; adjust algo-shift/algo-at or gap", ox / PX, oy / PX),
            ));
        }
        if context.settings.canvas.is_some() {
            let (cw, ch) = p.canvas;
            for (what, r) in [("pseudocode", a), ("figure", f)] {
                let over = [-r.0, -r.1, r.2 - cw, r.3 - ch]
                    .into_iter()
                    .fold(0f64, f64::max);
                if over > 0.01 {
                    lints.push(Lint::new(
                        "algo-out-of-canvas",
                        Severity::Error,
                        at,
                        format!("{what} extends {:.0} px beyond the {:.0}x{:.0} px canvas; adjust algo-shift/algo-at/algo-scale or canvas", over / PX, cw / PX, ch / PX),
                    ));
                }
            }
        }
    }
    for algorithm in &context.algorithms {
        if !drawn.iter().any(|d| std::ptr::eq(*d, algorithm)) {
            lints.push(Lint::new(
                "algo-unplaced",
                Severity::Warning,
                algorithm.offset,
                format!(
                    "{} is not drawn; reference it with \\node[algo={}] ... or move it to its own file",
                    algorithm.name.as_deref().map_or_else(|| algorithm.number.map_or("an unnamed algorithm".into(), |n| format!("algorithm {n}")), |n| format!("algorithm '{n}'")),
                    algorithm.name.as_deref().unwrap_or("<name>")
                ),
            ));
        }
    }
    lints.sort_by_key(|l| l.offset);
    lints
}
