//! Pseudocode line layout as Typst markup, styled after pseudocode.js.
//!
//! Typst measures every run (keywords, math, Japanese text); this module only
//! decides structure: rules, caption, indentation, line numbers, scope lines,
//! figure-reference markers and the explanation list.
use super::Settings;
use super::ast::{Algorithm, Kind, Line};
use super::parser::INLINE;
use crate::options::Styles;
use crate::text::{markup, typst_string};

/// TeX's 10pt in SVG user units (bp), the size of node text.
pub const FONT_SIZE: f64 = 10. * 72. / 72.27;
/// pseudocode.js rules: thick above the caption and at the end, thin below it.
const THICK_RULE: &str = "0.8pt";
const THIN_RULE: &str = "0.4pt";
/// Vertical padding of one statement line and around the caption.
const LINE_INSET: &str = "0.17em";
const CAPTION_INSET: &str = "0.3em";
/// Gap between a line number and the statement.
const NUMBER_GAP: &str = "0.6em";
/// Scope lines sit slightly right of the enclosing keyword.
const SCOPE_OFFSET: &str = "0.35em";

/// Circled reference number of an annotated line without a line number
/// (`\REQUIRE`, ...); also used for `ref=` nodes pointing at one.
pub fn marker(number: &str) -> String {
    format!(
        "#box(baseline: 0.12em)[#circle(radius: 0.55em, inset: 0pt, stroke: 0.5pt)[#align(center + horizon)[#text(size: 0.72em)[{}]]]]",
        escape(number)
    )
}

fn escape(text: &str) -> String {
    format!("#{}", typst_string(text).replace('#', "\\#"))
}

/// Bold as MathJax sets `\textbf`: the Mathematical Bold letters and digits
/// of the bundled New Computer Modern Math (no text font is bundled for it).
fn bold(text: &str) -> String {
    text.chars()
        .map(|c| {
            let code = match c {
                'A'..='Z' => 0x1D400 + (c as u32 - 'A' as u32),
                'a'..='z' => 0x1D41A + (c as u32 - 'a' as u32),
                '0'..='9' => 0x1D7CE + (c as u32 - '0' as u32),
                _ => return c,
            };
            char::from_u32(code).unwrap_or(c)
        })
        .collect()
}

fn keyword(word: &str) -> String {
    format!("#text({})", typst_string(&bold(word)))
}

/// pseudocode.js synthesizes small capitals: lowercase letters become
/// uppercase at a reduced size (the math font has no `smcp` feature).
fn small_caps(text: &str) -> String {
    let mut out = String::new();
    let mut run = String::new();
    let mut lower = false;
    let flush = |run: &mut String, lower: bool, out: &mut String| {
        if !run.is_empty() {
            if lower {
                out.push_str(&format!("#text(size: 0.7em, {})", typst_string(run)));
            } else {
                out.push_str(&format!("#text({})", typst_string(run)));
            }
            run.clear();
        }
    };
    for c in text.chars() {
        let is_lower = c.is_lowercase();
        if is_lower != lower {
            flush(&mut run, lower, &mut out);
            lower = is_lower;
        }
        run.extend(if is_lower {
            c.to_uppercase().collect::<Vec<_>>()
        } else {
            vec![c]
        });
    }
    flush(&mut run, lower, &mut out);
    out
}

/// Statement text: TeX via the node-label converter, plus the pseudocode
/// commands `\CALL`, `\TRUE`, `\AND`, ... and `\textsc` at the top level.
pub fn inline(text: &str, styles: &Styles) -> Result<String, String> {
    let mut out = String::new();
    let mut tex = String::new();
    let mut cur = crate::syntax::Cursor::new(text);
    let flush = |tex: &mut String, out: &mut String| -> Result<(), String> {
        if !tex.is_empty() {
            out.push_str(&markup(tex, styles)?);
            tex.clear();
        }
        Ok(())
    };
    while let Some(c) = cur.rest().chars().next() {
        match c {
            '{' => {
                let group = cur.group('{', '}')?;
                tex.push('{');
                tex.push_str(group);
                tex.push('}');
            }
            '$' => {
                let mut escaped = false;
                let end = cur.rest()[1..]
                    .char_indices()
                    .find(|&(_, ch)| {
                        let found = ch == '$' && !escaped;
                        escaped = ch == '\\' && !escaped;
                        found
                    })
                    .map(|(i, _)| i + 2)
                    .ok_or("unclosed inline math")?;
                tex.push_str(&cur.rest()[..end]);
                cur.pos += end;
            }
            '\\' => {
                let name: String = cur.rest()[1..]
                    .chars()
                    .take_while(|ch| ch.is_ascii_alphabetic())
                    .collect();
                if INLINE.contains(&name.as_str()) || name == "textsc" {
                    flush(&mut tex, &mut out)?;
                    cur.pos += 1 + name.len();
                    match name.as_str() {
                        "CALL" => {
                            let callee = cur.group('{', '}')?;
                            let args = cur.group('{', '}')?;
                            out.push_str(&small_caps(callee.trim()));
                            out.push_str("#text(\"(\")");
                            out.push_str(&inline(args, styles)?);
                            out.push_str("#text(\")\")");
                        }
                        "textsc" => out.push_str(&small_caps(cur.group('{', '}')?)),
                        "TRUE" => out.push_str(&small_caps("true")),
                        "FALSE" => out.push_str(&small_caps("false")),
                        word => out.push_str(&keyword(&word.to_lowercase())),
                    }
                    // A control word swallows the following spaces, as in TeX;
                    // keep one so `\AND y` stays two words.
                    if !matches!(name.as_str(), "CALL" | "textsc")
                        && cur.rest().starts_with(char::is_whitespace)
                    {
                        cur.ws();
                        if !cur.rest().is_empty() {
                            out.push_str("#text(\" \")");
                        }
                    }
                } else if name.is_empty() {
                    let next = cur.rest()[1..].chars().next().map_or(0, char::len_utf8);
                    tex.push_str(&cur.rest()[..1 + next]);
                    cur.pos += 1 + next;
                } else {
                    tex.push('\\');
                    tex.push_str(&name);
                    cur.pos += 1 + name.len();
                }
            }
            _ => {
                tex.push(c);
                cur.pos += c.len_utf8();
            }
        }
    }
    flush(&mut tex, &mut out)?;
    Ok(out)
}

fn join(parts: Vec<String>) -> String {
    parts
        .into_iter()
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("#text(\" \")")
}

fn content(line: &Line, settings: &Settings, styles: &Styles) -> Result<String, String> {
    let text = || inline(&line.text, styles);
    let condition = |head: &str, tail: Option<&str>| -> Result<String, String> {
        let mut parts = vec![keyword(head), text()?];
        if let Some(tail) = tail {
            parts.push(keyword(tail));
        }
        Ok(join(parts))
    };
    let signature = |head: &str| -> Result<String, String> {
        Ok(format!(
            "{}#text(\" \"){}#text(\"(\"){}#text(\")\")",
            keyword(head),
            small_caps(line.name.as_deref().unwrap_or_default()),
            text()?
        ))
    };
    let mut out = match line.kind {
        Kind::Procedure => signature("procedure")?,
        Kind::Function => signature("function")?,
        Kind::If => condition("if", Some("then"))?,
        Kind::ElsIf => condition("else if", Some("then"))?,
        Kind::Else => keyword("else"),
        Kind::For => condition("for", Some("do"))?,
        Kind::ForAll => condition("for all", Some("do"))?,
        Kind::While => condition("while", Some("do"))?,
        Kind::Repeat => keyword("repeat"),
        Kind::Until => condition("until", None)?,
        Kind::Loop => keyword("loop"),
        Kind::End(block) => keyword(&format!("end {}", block.keyword())),
        Kind::State => text()?,
        Kind::Return => condition("return", None)?,
        Kind::Print => condition("print", None)?,
        Kind::Break => keyword("break"),
        Kind::Continue => keyword("continue"),
        Kind::Require => condition("Require:", None)?,
        Kind::Ensure => condition("Ensure:", None)?,
        Kind::Input => condition("Input:", None)?,
        Kind::Output => condition("Output:", None)?,
        Kind::Comment => format!(
            "#text({})#text(\" \"){}",
            typst_string(&settings.comment_delimiter),
            text()?
        ),
    };
    if let Some(comment) = &line.comment {
        out.push_str(&format!(
            "#h(1em)#text({})#text(\" \"){}",
            typst_string(&settings.comment_delimiter),
            inline(comment, styles)?
        ));
    }
    Ok(out)
}

/// Lines (indices in `Algorithm::lines`) highlighted with `fill` (`#rrggbb`).
#[derive(Clone, Debug, Default)]
pub struct Focus {
    pub lines: std::collections::BTreeSet<usize>,
    pub fill: String,
}

/// A rendered line: its number (if any) and its marker.
pub struct Row<'a> {
    /// Index in `Algorithm::lines`.
    pub index: usize,
    pub line: &'a Line,
    pub number: Option<usize>,
    pub marker: Option<usize>,
}

/// Whether statements are numbered: `line-number`, or forced when lines are
/// referred to by number (`@ref` from the figure, the `@explain` list).
pub fn numbered(algorithm: &Algorithm, settings: &Settings) -> bool {
    settings.line_number
        || algorithm
            .lines
            .iter()
            .any(|l| !l.notes.refs.is_empty() || (settings.explain && l.notes.explain.is_some()))
}

fn hidden(line: &Line, settings: &Settings) -> bool {
    settings.no_end && matches!(line.kind, Kind::End(_))
}

/// The number of each line of `algorithm`. `\END...` lines disappear with
/// `no-end`; numbering skips them as pseudocode.js does.
pub fn line_numbers(algorithm: &Algorithm, settings: &Settings) -> Vec<Option<usize>> {
    let numbered = numbered(algorithm, settings);
    let mut number = 0;
    algorithm
        .lines
        .iter()
        .map(|line| {
            (numbered && line.numbered() && !hidden(line, settings)).then(|| {
                number += 1;
                number
            })
        })
        .collect()
}

/// Lines that are drawn, with their numbers and markers.
pub fn rows<'a>(
    algorithm: &'a Algorithm,
    settings: &Settings,
    markers: &[Option<usize>],
) -> Vec<Row<'a>> {
    algorithm
        .lines
        .iter()
        .enumerate()
        .zip(markers)
        .zip(line_numbers(algorithm, settings))
        .filter(|(((_, line), _), _)| !hidden(line, settings))
        .map(|(((index, line), marker), number)| Row {
            index,
            line,
            number,
            marker: *marker,
        })
        .collect()
}

/// Typst document of one algorithm. `markers[i]` is the circled marker of
/// `algorithm.lines[i]`, for annotated lines without a number.
pub fn document(
    algorithm: &Algorithm,
    settings: &Settings,
    markers: &[Option<usize>],
    focus: &Focus,
    font_size: f64,
    styles: &Styles,
) -> Result<String, String> {
    let rows = rows(algorithm, settings, markers);
    let digits = rows
        .iter()
        .filter_map(|r| r.number)
        .max()
        .map_or(0, |n| n.to_string().len());
    let number_width = if digits > 0 {
        format!(
            "{}em",
            0.5 * digits as f64 + 0.3 * settings.line_number_punc.chars().count() as f64
        )
    } else {
        "0em".into()
    };
    let indent = &settings.indent_size;
    let left = if digits > 0 {
        format!("{number_width} + {NUMBER_GAP} + 0.2em")
    } else {
        "0.2em".into()
    };
    let mut body = String::new();
    let mut depth = 0;
    for row in &rows {
        let line = row.line;
        while depth < line.depth {
            if settings.scope_lines {
                body.push_str(&format!(
                    "#pad(left: {SCOPE_OFFSET})[#block(stroke: (left: {THIN_RULE}), inset: (left: {indent} - {SCOPE_OFFSET}))["
                ));
            } else {
                body.push_str(&format!("#block(inset: (left: {indent}))["));
            }
            depth += 1;
        }
        while depth > line.depth {
            body.push_str(if settings.scope_lines { "]]\n" } else { "]\n" });
            depth -= 1;
        }
        let mut text = String::new();
        if let Some(number) = row.number {
            text.push_str(&format!(
                "#box(width: 0pt)[#move(dx: -({indent} * {} + {number_width} + {NUMBER_GAP}))[#box(width: {number_width})[#align(right)[#text(size: 0.9em, {})]]]]",
                line.depth,
                typst_string(&format!("{number}{}", settings.line_number_punc))
            ));
        }
        text.push_str(
            &content(line, settings, styles).map_err(|m| format!("{m} (pseudocode line)"))?,
        );
        if let Some(n) = row.marker {
            text.push_str("#h(0.6em)");
            text.push_str(&marker(&n.to_string()));
        }
        // A focused line is highlighted across the whole pseudocode width.
        let fill = if focus.lines.contains(&row.index) {
            format!(
                ", width: 100%, fill: rgb(\"{}\"), outset: (left: {indent} * {} + {left}, right: 0.2em)",
                focus.fill, line.depth
            )
        } else {
            String::new()
        };
        // An empty statement still occupies a line. The `tikzc-line-*`
        // labels record its vertical extent for `<name>-<line>` nodes.
        let i = row.index;
        body.push_str(&format!(
            "#metadata(none) <tikzc-line-{i}-top>\n#block(inset: (y: {LINE_INSET}){fill})[#box(height: 0.8em)[]{text}]\n#metadata(none) <tikzc-line-{i}-bottom>\n"
        ));
    }
    while depth > 0 {
        body.push_str(if settings.scope_lines { "]]\n" } else { "]\n" });
        depth -= 1;
    }
    let mut cells = vec![format!("grid.hline(stroke: {THICK_RULE})")];
    if let Some(caption) = &algorithm.caption {
        let number = algorithm.number.map_or(String::new(), |n| n.to_string());
        let title = format!("{} {number}", settings.title_prefix);
        let title = match title.trim() {
            "" => String::new(),
            title => format!("{}#text(\" \")", keyword(title)),
        };
        cells.push(format!(
            "pad(x: 0.2em, y: {CAPTION_INSET})[{title}{}]",
            inline(caption, styles).map_err(|m| format!("{m} (caption)"))?
        ));
        cells.push(format!("grid.hline(stroke: {THIN_RULE})"));
    }
    cells.push(format!(
        "pad(left: {left}, right: 0.2em, y: {CAPTION_INSET})[\n{body}]"
    ));
    cells.push(format!("grid.hline(stroke: {THICK_RULE})"));
    // The width of the ruled body (not of the explanation list below it)
    // bounds the `<name>-<line>` nodes.
    let mut document = format!(
        "#let tikzcbody = grid(columns: 1, {})\n#context [#metadata(measure(tikzcbody).width) <tikzc-body-width>]\n#tikzcbody",
        cells.join(",\n")
    );
    if settings.explain {
        // Each explanation is labelled with its line number, or with the
        // marker of an unnumbered line (`\REQUIRE`, ...).
        let mut explained = Vec::new();
        for row in &rows {
            let Some(text) = &row.line.notes.explain else {
                continue;
            };
            let label = match (row.number, row.marker) {
                (Some(n), _) => format!(
                    "#text(size: 0.9em, {})",
                    typst_string(&format!("{n}{}", settings.line_number_punc))
                ),
                (None, Some(n)) => marker(&n.to_string()),
                (None, None) => continue,
            };
            explained.push((label, text));
        }
        if !explained.is_empty() {
            let mut cells = Vec::new();
            for (label, text) in explained {
                cells.push(format!("[#align(right)[{label}]]"));
                cells.push(format!(
                    "[{}]",
                    inline(text, styles).map_err(|m| format!("{m} (@explain)"))?
                ));
            }
            document = format!(
                "#stack(dir: ttb, spacing: 0.7em, [{document}], pad(x: 0.2em)[#grid(columns: 2, column-gutter: 0.5em, row-gutter: 0.5em, {})])",
                cells.join(", ")
            );
        }
    }
    Ok(format!(
        "#set page(width: auto, height: auto, margin: 1pt, fill: none)\n#set text(font: (\"New Computer Modern Math\", \"IPAexMincho\"), size: {font_size}pt, top-edge: {}pt, bottom-edge: {}pt, overhang: false)\n#show math.equation: set text(font: \"New Computer Modern Math\")\n#set par(leading: 0.4em, spacing: 0pt, justify: false)\n#set block(spacing: 0pt)\n#set align(left)\n{document}",
        font_size * 0.8,
        -font_size * 0.2,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explain_forces_line_numbers_and_labels_by_line() {
        let source = "\\begin{algorithm}\\begin{algorithmic}\n\\REQUIRE $x$ % @explain input\n\\STATE a\n\\STATE b % @explain why\n\\end{algorithmic}\\end{algorithm}";
        let (_, algorithms) = crate::algo::extract(source).unwrap();
        let context =
            crate::algo::Context::new(source, "", Settings::default(), algorithms, None).unwrap();
        let algorithm = &context.algorithms[0];
        // Only the unnumbered \REQUIRE line needs a marker.
        assert_eq!(context.markers(algorithm), [Some(1), None, None]);
        let markup = context.document(algorithm).unwrap();
        assert!(markup.contains("\"2:\""), "{markup}");
        let hidden = Settings {
            explain: false,
            ..Default::default()
        };
        assert!(!numbered(algorithm, &hidden));
    }
    #[test]
    fn small_caps_runs() {
        assert_eq!(
            small_caps("Ista"),
            "#text(\"I\")#text(size: 0.7em, \"STA\")"
        );
    }
    #[test]
    fn inline_commands() {
        let styles = Styles::default();
        let out = inline(r"$x$ \AND \CALL{Swap}{$a$}", &styles).unwrap();
        assert!(out.contains("#text(\"𝐚𝐧𝐝\")"), "{out}");
        assert!(
            out.contains("#text(\"S\")#text(size: 0.7em, \"WAP\")"),
            "{out}"
        );
        assert!(inline(r"\unknowncommand", &styles).is_err());
    }
    #[test]
    fn number_sets_the_caption_counter() {
        let env = |opts: &str| {
            format!(
                "\\begin{{algorithm}}{opts}\\caption{{c}}\\begin{{algorithmic}}\\STATE a\\end{{algorithmic}}\\end{{algorithm}}\n"
            )
        };
        let source = [env("[number=3]"), env(""), env("[number=none]"), env("[H]")].concat();
        let (_, algorithms) = crate::algo::extract(&source).unwrap();
        let numbers: Vec<_> = algorithms.iter().map(|a| a.number).collect();
        assert_eq!(numbers, [Some(3), Some(4), None, Some(5)]);
        assert!(crate::algo::extract(&env("[number=0]")).is_err());
    }
}
