use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub struct Diagnostic {
    pub message: String,
    pub offset: usize,
    pub line: usize,
    pub column: usize,
}

impl Diagnostic {
    pub fn at(source: &str, offset: usize, message: impl Into<String>) -> Self {
        let mut offset = offset.min(source.len());
        while !source.is_char_boundary(offset) {
            offset -= 1;
        }
        let prefix = &source[..offset];
        Self {
            message: message.into(),
            offset,
            line: prefix.bytes().filter(|b| *b == b'\n').count() + 1,
            column: prefix.rsplit('\n').next().unwrap_or("").chars().count() + 1,
        }
    }
}
impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} at {}:{}", self.message, self.line, self.column)
    }
}
impl std::error::Error for Diagnostic {}

/// Preserve byte offsets while discarding TeX comments and source headers.
pub fn clean(source: &str) -> String {
    let mut result = source.as_bytes().to_vec();
    let mut comment = false;
    let mut escaped = false;
    for (i, b) in source.bytes().enumerate() {
        if b == b'\n' {
            comment = false;
            escaped = false;
            continue;
        }
        if b == b'%' && !escaped {
            comment = true;
        }
        if comment {
            result[i] = b' ';
        }
        escaped = b == b'\\' && !escaped;
    }
    let mut start = 0;
    for line in source.split_inclusive('\n') {
        if line.trim_start().starts_with("#|") {
            for byte in &mut result[start..start + line.len()] {
                if *byte != b'\n' {
                    *byte = b' ';
                }
            }
        } else {
            break;
        }
        start += line.len();
    }
    String::from_utf8(result).expect("comments replaced by ASCII spaces")
}

/// Split only at top level; option values may contain nested comma lists.
pub fn split_top(input: &str, delimiter: char) -> Vec<&str> {
    split_top_empty(input, delimiter)
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect()
}

/// Like split_top, but retain empty tuple fields (e.g. foreach `2/`).
pub fn split_top_empty(input: &str, delimiter: char) -> Vec<&str> {
    let mut stack = Vec::new();
    let mut result = Vec::new();
    let mut start = 0;
    let mut escaped = false;
    for (i, c) in input.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if c == '\\' {
            escaped = true;
            continue;
        }
        match c {
            '{' => stack.push('}'),
            '[' => stack.push(']'),
            '(' => stack.push(')'),
            '}' | ']' | ')' if stack.last() == Some(&c) => {
                stack.pop();
            }
            _ => {}
        }
        if c == delimiter && stack.is_empty() {
            result.push(input[start..i].trim());
            start = i + c.len_utf8();
        }
    }
    result.push(input[start..].trim());
    result
}

pub fn unbrace(s: &str) -> &str {
    let s = s.trim();
    if s.starts_with('{') && s.ends_with('}') {
        let mut c = Cursor::new(s);
        if let Ok(inner) = c.group('{', '}')
            && c.pos == s.len()
        {
            return inner;
        }
    }
    s
}

pub struct Cursor<'a> {
    pub source: &'a str,
    pub pos: usize,
}
impl<'a> Cursor<'a> {
    pub fn new(source: &'a str) -> Self {
        Self { source, pos: 0 }
    }
    pub fn rest(&self) -> &'a str {
        &self.source[self.pos..]
    }
    pub fn ws(&mut self) {
        self.pos += self.rest().len() - self.rest().trim_start().len();
    }
    pub fn eat(&mut self, s: &str) -> bool {
        self.ws();
        if self.rest().starts_with(s) {
            self.pos += s.len();
            true
        } else {
            false
        }
    }
    pub fn group(&mut self, open: char, close: char) -> Result<&'a str, String> {
        self.ws();
        if !self.rest().starts_with(open) {
            return Err(format!("expected '{open}'"));
        }
        self.pos += open.len_utf8();
        let start = self.pos;
        let mut level = 1;
        let mut escaped = false;
        for (i, c) in self.source[start..].char_indices() {
            if escaped {
                escaped = false;
                continue;
            }
            if c == '\\' {
                escaped = true;
                continue;
            }
            if c == open {
                level += 1;
            }
            if c == close {
                level -= 1;
                if level == 0 {
                    self.pos = start + i + c.len_utf8();
                    return Ok(&self.source[start..start + i]);
                }
            }
        }
        Err(format!("unclosed '{open}'"))
    }
    pub fn word(&mut self) -> &'a str {
        self.ws();
        let start = self.pos;
        while self
            .rest()
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
        {
            self.pos += 1;
        }
        &self.source[start..self.pos]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nested_options() {
        assert_eq!(
            split_top("x={a,b},y=[a,b],z=(1,2)", ','),
            vec!["x={a,b}", "y=[a,b]", "z=(1,2)"]
        );
    }
    #[test]
    fn comments_preserve_offsets() {
        let s = "日本語 %消す\n\\% visible";
        let c = clean(s);
        assert_eq!(c.len(), s.len());
        assert!(c.ends_with("\\% visible"));
    }
    #[test]
    fn location_unicode() {
        let e = Diagnostic::at("日本\nx", 7, "error");
        assert_eq!((e.line, e.column), (2, 1));
    }
}
