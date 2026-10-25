//! Locate `algorithm` environments and extract `% @...` annotations.
use super::ast::Annotations;

/// A `% @...` comment inside an `algorithmic` body.
#[derive(Clone, Debug)]
pub struct Note {
    /// Offset of the `@`.
    pub offset: usize,
    /// Text after `@`, e.g. `src paper=eq3.4`.
    pub text: String,
}

/// Byte ranges `\begin{algorithm}`..`\end{algorithm}` of a cleaned source.
pub fn environments(clean: &str) -> Result<Vec<std::ops::Range<usize>>, (usize, String)> {
    const BEGIN: &str = "\\begin{algorithm}";
    const END: &str = "\\end{algorithm}";
    let mut ranges = Vec::new();
    let mut from = 0;
    while let Some(i) = clean[from..].find(BEGIN) {
        let start = from + i;
        let end = clean[start + BEGIN.len()..]
            .find(END)
            .map(|j| start + BEGIN.len() + j + END.len())
            .ok_or((
                start,
                "[algo-unbalanced] unclosed algorithm environment; add \\end{algorithm}".to_owned(),
            ))?;
        if let Some(j) = clean[start + BEGIN.len()..end - END.len()].find(BEGIN) {
            return Err((
                start + BEGIN.len() + j,
                "[algo-unbalanced] algorithm environments cannot be nested".into(),
            ));
        }
        ranges.push(start..end);
        from = end;
    }
    if let Some(i) = clean[from..].find(END) {
        return Err((
            from + i,
            "[algo-unbalanced] \\end{algorithm} without \\begin{algorithm}".into(),
        ));
    }
    Ok(ranges)
}

/// `% @...` comments of `source[range]`, in source order. Ordinary comments
/// are ignored, as in LaTeX.
pub fn notes(source: &str, range: std::ops::Range<usize>) -> Vec<Note> {
    let mut notes = Vec::new();
    let mut offset = range.start;
    for line in source[range].split_inclusive('\n') {
        let mut escaped = false;
        for (i, b) in line.bytes().enumerate() {
            if b == b'%' && !escaped {
                let comment = &line[i + 1..];
                let trimmed = comment.trim_start();
                if let Some(text) = trimmed.strip_prefix('@') {
                    notes.push(Note {
                        offset: offset + i + 1 + (comment.len() - trimmed.len()),
                        text: text.trim_end().to_owned(),
                    });
                }
                break;
            }
            escaped = b == b'\\' && !escaped;
        }
        offset += line.len();
    }
    notes
}

/// Merge one note into a statement's annotations.
pub fn annotate(notes: &mut Annotations, note: &Note) -> Result<(), (usize, String)> {
    let (directive, rest) = note
        .text
        .split_once(char::is_whitespace)
        .unwrap_or((note.text.as_str(), ""));
    let rest = rest.trim();
    notes.offset.get_or_insert(note.offset);
    match directive {
        "src" => {
            if rest.is_empty() {
                return Err((
                    note.offset,
                    "[src-bad-format] @src needs paper=... or impl=...; e.g. % @src paper=eq3.4 impl=est.py:131".into(),
                ));
            }
            for item in rest.split_whitespace() {
                match item.split_once('=') {
                    Some(("paper", v)) if !v.is_empty() => notes.paper.push(v.into()),
                    Some(("impl", v)) => {
                        if !valid_location(v) {
                            return Err((
                                note.offset,
                                format!(
                                    "[src-bad-format] impl='{v}' must be path:line or path:start-end; e.g. impl=est.py:131 or impl=est.py:120-131"
                                ),
                            ));
                        }
                        notes.implementation.push(v.into());
                    }
                    _ => {
                        return Err((
                            note.offset,
                            format!(
                                "[src-bad-format] unknown @src item '{item}'; use paper=<id> or impl=<path:line>"
                            ),
                        ));
                    }
                }
            }
        }
        "ref" => {
            if rest.is_empty() || rest.split_whitespace().any(|id| !valid_id(id)) {
                return Err((
                    note.offset,
                    "[src-bad-format] @ref needs IDs of letters, digits, '-', '_' or '.'; e.g. % @ref sparse-corner".into(),
                ));
            }
            for id in rest.split_whitespace() {
                if !notes.refs.iter().any(|r| r == id) {
                    notes.refs.push(id.into());
                }
            }
        }
        "explain" => {
            if rest.is_empty() {
                return Err((
                    note.offset,
                    "[src-bad-format] @explain needs text; e.g. % @explain shrink coefficients toward 0".into(),
                ));
            }
            match &mut notes.explain {
                Some(text) => {
                    text.push(' ');
                    text.push_str(rest);
                }
                None => notes.explain = Some(rest.into()),
            }
        }
        _ => {
            return Err((
                note.offset,
                format!(
                    "[algo-unknown-cmd] unknown annotation '@{directive}'; use @src, @ref or @explain"
                ),
            ));
        }
    }
    Ok(())
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// `path:line` or `path:start-end` with positive, ordered line numbers.
pub fn valid_location(value: &str) -> bool {
    let Some((path, lines)) = value.rsplit_once(':') else {
        return false;
    };
    let number = |s: &str| {
        !s.is_empty()
            && s.bytes().all(|b| b.is_ascii_digit())
            && s.parse::<u64>().is_ok_and(|n| n > 0)
    };
    !path.is_empty()
        && match lines.split_once('-') {
            Some((a, b)) => {
                number(a) && number(b) && a.parse::<u64>().unwrap() <= b.parse::<u64>().unwrap()
            }
            None => number(lines),
        }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn locations() {
        assert!(valid_location("est.py:131"));
        assert!(valid_location("src/a.py:120-131"));
        assert!(!valid_location("est.py"));
        assert!(!valid_location("est.py:0"));
        assert!(!valid_location("est.py:9-3"));
        assert!(!valid_location(":3"));
    }
    #[test]
    fn notes_skip_plain_and_escaped_comments() {
        let s = "a \\% b % plain\n\\STATE x % @src paper=eq1\n  % @ref c\n";
        let n = notes(s, 0..s.len());
        assert_eq!(n.len(), 2);
        assert_eq!(n[0].text, "src paper=eq1");
        assert_eq!(&s[n[1].offset..n[1].offset + 5], "@ref ");
    }
    #[test]
    fn annotations_merge() {
        let mut a = Annotations::default();
        for text in [
            "src paper=eq3.4 impl=est.py:131",
            "ref x",
            "explain one",
            "explain two",
        ] {
            annotate(
                &mut a,
                &Note {
                    offset: 0,
                    text: text.into(),
                },
            )
            .unwrap();
        }
        assert_eq!(a.paper, ["eq3.4"]);
        assert_eq!(a.implementation, ["est.py:131"]);
        assert_eq!(a.refs, ["x"]);
        assert_eq!(a.explain.as_deref(), Some("one two"));
        assert!(
            annotate(
                &mut a,
                &Note {
                    offset: 0,
                    text: "src impl=est.py".into()
                }
            )
            .is_err()
        );
        assert!(
            annotate(
                &mut a,
                &Note {
                    offset: 0,
                    text: "bogus".into()
                }
            )
            .is_err()
        );
    }
}
