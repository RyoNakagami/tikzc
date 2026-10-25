//! Build [`Algorithm`]s from `algorithm` environments (pseudocode.js syntax).
use super::ast::{Algorithm, Annotations, Block, Kind, Line};
use super::lexer;
use crate::syntax::Cursor;

type Error = (usize, String);

/// What follows a line command.
enum Args {
    None,
    /// `{condition}`
    Condition,
    /// `{Name}{arguments}`
    Signature,
    /// Text up to the next line command.
    Text,
}

fn line_command(name: &str) -> Option<(Kind, Args)> {
    Some(match name {
        "PROCEDURE" => (Kind::Procedure, Args::Signature),
        "FUNCTION" => (Kind::Function, Args::Signature),
        "IF" => (Kind::If, Args::Condition),
        "ELSIF" => (Kind::ElsIf, Args::Condition),
        "ELSE" => (Kind::Else, Args::None),
        "FOR" => (Kind::For, Args::Condition),
        "FORALL" => (Kind::ForAll, Args::Condition),
        "WHILE" => (Kind::While, Args::Condition),
        "REPEAT" => (Kind::Repeat, Args::None),
        "UNTIL" => (Kind::Until, Args::Condition),
        "LOOP" => (Kind::Loop, Args::None),
        "ENDPROCEDURE" => (Kind::End(Block::Procedure), Args::None),
        "ENDFUNCTION" => (Kind::End(Block::Function), Args::None),
        "ENDIF" => (Kind::End(Block::If), Args::None),
        "ENDFOR" => (Kind::End(Block::For), Args::None),
        "ENDWHILE" => (Kind::End(Block::While), Args::None),
        "ENDLOOP" => (Kind::End(Block::Loop), Args::None),
        "STATE" => (Kind::State, Args::Text),
        "RETURN" => (Kind::Return, Args::Text),
        "PRINT" => (Kind::Print, Args::Text),
        "BREAK" => (Kind::Break, Args::None),
        "CONTINUE" => (Kind::Continue, Args::None),
        "REQUIRE" => (Kind::Require, Args::Text),
        "ENSURE" => (Kind::Ensure, Args::Text),
        "INPUT" => (Kind::Input, Args::Text),
        "OUTPUT" => (Kind::Output, Args::Text),
        "COMMENT" => (Kind::Comment, Args::Condition),
        _ => return None,
    })
}

/// Uppercase commands allowed inside statement text.
pub const INLINE: &[&str] = &["CALL", "TRUE", "FALSE", "AND", "OR", "NOT", "TO", "DOWNTO"];

#[derive(Clone, Copy, PartialEq)]
enum Open {
    Block(Block),
    Repeat,
}
impl Open {
    fn command(self) -> &'static str {
        match self {
            Open::Block(Block::Procedure) => "\\PROCEDURE",
            Open::Block(Block::Function) => "\\FUNCTION",
            Open::Block(Block::If) => "\\IF",
            Open::Block(Block::For) => "\\FOR",
            Open::Block(Block::While) => "\\WHILE",
            Open::Block(Block::Loop) => "\\LOOP",
            Open::Repeat => "\\REPEAT",
        }
    }
    fn close(self) -> &'static str {
        match self {
            Open::Block(Block::Procedure) => "\\ENDPROCEDURE",
            Open::Block(Block::Function) => "\\ENDFUNCTION",
            Open::Block(Block::If) => "\\ENDIF",
            Open::Block(Block::For) => "\\ENDFOR",
            Open::Block(Block::While) => "\\ENDWHILE",
            Open::Block(Block::Loop) => "\\ENDLOOP",
            Open::Repeat => "\\UNTIL{...}",
        }
    }
}

/// Parse the environment `clean[range]`; `source` supplies the annotations.
pub fn algorithm(
    source: &str,
    clean: &str,
    range: std::ops::Range<usize>,
    number: Option<usize>,
) -> Result<Algorithm, Error> {
    let mut cur = Cursor::new(&clean[..range.end]);
    cur.pos = range.start + "\\begin{algorithm}".len();
    let mut algorithm = Algorithm {
        name: None,
        caption: None,
        number,
        lines: Vec::new(),
        offset: range.start,
    };
    if cur.rest().trim_start().starts_with('[') {
        let at = cur.pos;
        for option in crate::syntax::split_top(cur.group('[', ']').map_err(|m| (at, m))?, ',') {
            match option.split_once('=') {
                Some((key, value)) if key.trim() == "name" => {
                    let value = crate::syntax::unbrace(value.trim());
                    if !lexer::valid_id(value) {
                        return Err((
                            at,
                            format!(
                                "invalid algorithm name '{value}'; use letters, digits, '-', '_' or '.'"
                            ),
                        ));
                    }
                    algorithm.name = Some(value.into());
                }
                Some((key, value)) if key.trim() == "number" => {
                    let value = crate::syntax::unbrace(value.trim());
                    algorithm.number = match value {
                        "none" => None,
                        _ => Some(value.parse().ok().filter(|n| *n > 0).ok_or_else(|| {
                            (
                                at,
                                format!("algorithm number must be a positive integer or none, got '{value}'"),
                            )
                        })?),
                    };
                }
                Some((key, _)) => {
                    return Err((
                        at,
                        format!(
                            "Unsupported algorithm option '{}'; use name=... or number=...",
                            key.trim()
                        ),
                    ));
                }
                // Float placement (`[H]`, `[htbp]`) has no meaning for one figure.
                None => {}
            }
        }
    }
    let mut body = false;
    loop {
        cur.ws();
        let at = cur.pos;
        if cur.rest() == "\\end{algorithm}" {
            break;
        }
        if !cur.eat("\\") {
            return Err((
                at,
                format!(
                    "unexpected text in algorithm: '{}'; statements belong inside \\begin{{algorithmic}}",
                    cur.rest().chars().take(20).collect::<String>()
                ),
            ));
        }
        match cur.word_here() {
            "caption" => {
                algorithm.caption = Some(cur.group('{', '}').map_err(|m| (at, m))?.trim().into())
            }
            "label" => {
                cur.group('{', '}').map_err(|m| (at, m))?;
            }
            "begin" if cur.rest().starts_with("{algorithmic}") => {
                if body {
                    return Err((at, "an algorithm has one algorithmic environment".into()));
                }
                body = true;
                cur.pos += "{algorithmic}".len();
                if cur.rest().trim_start().starts_with('[') {
                    // algorithmic's `[1]` line-number argument; use `#| line-number:`.
                    cur.group('[', ']').map_err(|m| (at, m))?;
                }
                let start = cur.pos;
                let end = start
                    + cur.rest().find("\\end{algorithmic}").ok_or((
                        at,
                        "[algo-unbalanced] unclosed algorithmic environment; add \\end{algorithmic}".to_owned(),
                    ))?;
                algorithm.lines = lines(source, clean, start..end)?;
                cur.pos = end + "\\end{algorithmic}".len();
            }
            other => {
                return Err((
                    at,
                    format!(
                        "[algo-unknown-cmd] Unsupported command \\{other} in algorithm; use \\caption{{...}} and \\begin{{algorithmic}}"
                    ),
                ));
            }
        }
    }
    if !body {
        return Err((
            range.start,
            "algorithm needs \\begin{algorithmic}...\\end{algorithmic}".into(),
        ));
    }
    Ok(algorithm)
}

fn lines(source: &str, clean: &str, range: std::ops::Range<usize>) -> Result<Vec<Line>, Error> {
    let mut cur = Cursor::new(&clean[..range.end]);
    cur.pos = range.start;
    let mut lines: Vec<Line> = Vec::new();
    let mut stack: Vec<(Open, usize, bool)> = Vec::new();
    loop {
        cur.ws();
        if cur.rest().is_empty() {
            break;
        }
        let at = cur.pos;
        if !cur.eat("\\") {
            return Err((
                at,
                format!(
                    "[algo-unknown-cmd] text outside a statement: '{}'; start the line with \\STATE",
                    cur.rest().chars().take(20).collect::<String>()
                ),
            ));
        }
        let name = cur.word_here();
        let Some((kind, args)) = line_command(name) else {
            return Err((
                at,
                format!(
                    "[algo-unknown-cmd] Unsupported pseudocode command \\{name}; supported: \\STATE, \\IF, \\FOR, \\WHILE, \\REPEAT, \\PROCEDURE, ... (pseudocode.js syntax)"
                ),
            ));
        };
        let mut line = Line {
            kind,
            depth: stack.len(),
            name: None,
            text: String::new(),
            comment: None,
            notes: Annotations::default(),
            offset: at,
        };
        match args {
            Args::None => {}
            Args::Condition => {
                line.text = cur.group('{', '}').map_err(|m| (cur.pos, m))?.trim().into()
            }
            Args::Signature => {
                line.name = Some(cur.group('{', '}').map_err(|m| (cur.pos, m))?.trim().into());
                line.text = cur.group('{', '}').map_err(|m| (cur.pos, m))?.trim().into();
            }
            Args::Text => {
                let (text, comment) = text(&mut cur)?;
                line.text = text;
                line.comment = comment;
            }
        }
        if !matches!(args, Args::Text) {
            let mut c = Cursor::new(cur.source);
            c.pos = cur.pos;
            if c.eat("\\COMMENT") && !c.rest().starts_with(|ch: char| ch.is_ascii_alphabetic()) {
                line.comment = Some(c.group('{', '}').map_err(|m| (c.pos, m))?.trim().into());
                cur.pos = c.pos;
            }
        }
        let unbalanced = |message: String| (at, format!("[algo-unbalanced] {message}"));
        match kind {
            Kind::Procedure => stack.push((Open::Block(Block::Procedure), at, false)),
            Kind::Function => stack.push((Open::Block(Block::Function), at, false)),
            Kind::If => stack.push((Open::Block(Block::If), at, false)),
            Kind::For | Kind::ForAll => stack.push((Open::Block(Block::For), at, false)),
            Kind::While => stack.push((Open::Block(Block::While), at, false)),
            Kind::Loop => stack.push((Open::Block(Block::Loop), at, false)),
            Kind::Repeat => stack.push((Open::Repeat, at, false)),
            Kind::ElsIf | Kind::Else => {
                let command = if kind == Kind::Else {
                    "\\ELSE"
                } else {
                    "\\ELSIF"
                };
                match stack.last_mut() {
                    Some((Open::Block(Block::If), _, has_else)) => {
                        if *has_else {
                            return Err(unbalanced(format!(
                                "{command} after \\ELSE; move \\ELSE last"
                            )));
                        }
                        *has_else = kind == Kind::Else;
                        line.depth -= 1;
                    }
                    open => {
                        return Err(unbalanced(match open {
                            Some((open, _, _)) => format!(
                                "{command} inside {}; close it with {} first",
                                open.command(),
                                open.close()
                            ),
                            None => format!("{command} without \\IF"),
                        }));
                    }
                }
            }
            Kind::End(_) | Kind::Until => {
                let expected = match kind {
                    Kind::End(block) => Open::Block(block),
                    _ => Open::Repeat,
                };
                let command = match kind {
                    Kind::End(_) => format!("\\{name}"),
                    _ => "\\UNTIL".into(),
                };
                match stack.last() {
                    Some((open, _, _)) if *open == expected => {
                        stack.pop();
                        line.depth -= 1;
                    }
                    Some((open, _, _)) => {
                        return Err(unbalanced(format!(
                            "{command} closes {} instead of {}; expected {}",
                            expected.command(),
                            open.command(),
                            open.close()
                        )));
                    }
                    None => {
                        return Err(unbalanced(format!(
                            "{command} without {}",
                            expected.command()
                        )));
                    }
                }
            }
            _ => {}
        }
        lines.push(line);
    }
    if let Some((open, at, _)) = stack.last() {
        return Err((
            *at,
            format!(
                "[algo-unbalanced] {} is never closed; add {}",
                open.command(),
                open.close()
            ),
        ));
    }
    for note in lexer::notes(source, range) {
        let line = lines
            .iter_mut()
            .rev()
            .find(|line| line.offset < note.offset)
            .ok_or((note.offset, "[src-bad-format] annotation before the first statement; write it after the statement it describes".to_owned()))?;
        lexer::annotate(&mut line.notes, &note)?;
    }
    Ok(lines)
}

/// Statement text up to the next line command; extracts `\COMMENT{...}`.
fn text(cur: &mut Cursor<'_>) -> Result<(String, Option<String>), Error> {
    let mut out = String::new();
    let mut comment = None;
    while let Some(c) = cur.rest().chars().next() {
        let at = cur.pos;
        match c {
            '{' => {
                let group = cur.group('{', '}').map_err(|m| (at, m))?;
                out.push('{');
                out.push_str(group);
                out.push('}');
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
                    .ok_or((at, "unclosed inline math".to_owned()))?;
                out.push_str(&cur.rest()[..end]);
                cur.pos += end;
            }
            '\\' => {
                let name: String = cur.rest()[1..]
                    .chars()
                    .take_while(|ch| ch.is_ascii_alphabetic())
                    .collect();
                if name == "COMMENT" {
                    cur.pos += 1 + name.len();
                    comment = Some(cur.group('{', '}').map_err(|m| (at, m))?.trim().to_owned());
                } else if line_command(&name).is_some()
                    || (!name.is_empty()
                        && name.chars().all(|ch| ch.is_ascii_uppercase())
                        && name.len() > 1
                        && !INLINE.contains(&name.as_str()))
                {
                    break;
                } else if name.is_empty() {
                    let next = cur.rest()[1..].chars().next().map_or(0, char::len_utf8);
                    out.push_str(&cur.rest()[..1 + next]);
                    cur.pos += 1 + next;
                } else {
                    out.push('\\');
                    out.push_str(&name);
                    cur.pos += 1 + name.len();
                }
            }
            _ => {
                out.push(c);
                cur.pos += c.len_utf8();
            }
        }
    }
    Ok((out.trim().to_owned(), comment))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(body: &str) -> Result<Vec<Line>, Error> {
        let source = format!(
            "\\begin{{algorithm}}\\begin{{algorithmic}}{body}\\end{{algorithmic}}\\end{{algorithm}}"
        );
        let clean = crate::syntax::clean(&source);
        algorithm(&source, &clean, 0..source.len(), Some(1)).map(|a| a.lines)
    }
    #[test]
    fn quicksort_structure() {
        let lines = parse(
            r"
\PROCEDURE{Quicksort}{$A, p, r$}
  \IF{$p < r$}
    \STATE $q = $ \CALL{Partition}{$A, p, r$} \COMMENT{pivot}
    \STATE \CALL{Quicksort}{$A, p, q - 1$}
  \ELSE
    \RETURN
  \ENDIF
\ENDPROCEDURE",
        )
        .unwrap();
        let depths: Vec<_> = lines.iter().map(|l| l.depth).collect();
        assert_eq!(depths, [0, 1, 2, 2, 1, 2, 1, 0]);
        assert_eq!(lines[0].name.as_deref(), Some("Quicksort"));
        assert_eq!(lines[2].text, r"$q = $ \CALL{Partition}{$A, p, r$}");
        assert_eq!(lines[2].comment.as_deref(), Some("pivot"));
        assert_eq!(lines[5].text, "");
    }
    #[test]
    fn annotation_attribution() {
        let lines = parse(
            "
\\STATE $a$ % @src paper=eq1
\\REPEAT
  \\STATE $b$
  % @src impl=x.py:3
  % @ref corner
  % @explain why
\\UNTIL{$c$} % @src impl=x.py:4-5
",
        )
        .unwrap();
        assert_eq!(lines[0].notes.paper, ["eq1"]);
        assert!(!lines[1].notes.sourced());
        assert_eq!(lines[2].notes.implementation, ["x.py:3"]);
        assert_eq!(lines[2].notes.refs, ["corner"]);
        assert_eq!(lines[2].notes.explain.as_deref(), Some("why"));
        assert_eq!(lines[3].notes.implementation, ["x.py:4-5"]);
    }
    #[test]
    fn unbalanced_blocks() {
        for (body, message) in [
            (r"\IF{x}\STATE y", "\\IF is never closed"),
            (r"\ENDIF", "\\ENDIF without \\IF"),
            (r"\FOR{x}\ENDWHILE", "expected \\ENDFOR"),
            (r"\REPEAT\ENDLOOP", "expected \\UNTIL"),
            (r"\IF{x}\ELSE\ELSIF{y}\ENDIF", "after \\ELSE"),
            (r"\ELSE", "without \\IF"),
        ] {
            let error = parse(body).unwrap_err().1;
            assert!(
                error.starts_with("[algo-unbalanced]") && error.contains(message),
                "{error}"
            );
        }
    }
    #[test]
    fn unknown_commands() {
        let error = parse(r"\STATE x \STATEX y").unwrap_err().1;
        assert!(
            error.starts_with("[algo-unknown-cmd]") && error.contains("\\STATEX"),
            "{error}"
        );
        assert!(parse("x").unwrap_err().1.contains("outside a statement"));
    }
}
