//! A bounded subset expander, not a TeX interpreter. Every output byte retains
//! its source origin; generated macro bodies point at the invocation site.
use crate::syntax::{Cursor, Diagnostic, clean, split_top, split_top_empty, unbrace};
use std::collections::BTreeMap;
const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_STEPS: usize = 200_000;
const MAX_ITERATIONS: usize = 10_000;
#[derive(Clone, Default)]
pub struct Expanded {
    pub text: String,
    origins: Vec<usize>,
}
impl Expanded {
    fn literal(s: &str, origin: usize) -> Self {
        Self {
            text: s.into(),
            origins: vec![origin; s.len()],
        }
    }
    fn slice(&self, start: usize, end: usize) -> Self {
        Self {
            text: self.text[start..end].into(),
            origins: self.origins[start..end].into(),
        }
    }
    pub fn origin(&self, offset: usize) -> usize {
        self.origins
            .get(offset)
            .copied()
            .or_else(|| self.origins.last().copied())
            .unwrap_or(0)
    }
    fn append(&mut self, other: Self) -> Result<(), String> {
        if self.text.len() + other.text.len() > MAX_BYTES {
            return Err("expanded source exceeds 2 MiB".into());
        }
        self.text.push_str(&other.text);
        self.origins.extend(other.origins);
        Ok(())
    }
}
#[derive(Clone)]
struct Macro {
    args: usize,
    body: String,
}
#[derive(Clone, Default)]
struct Environment {
    macros: BTreeMap<String, Macro>,
}
struct Expander<'a> {
    source: &'a str,
    steps: usize,
    iterations: usize,
}
pub fn expand(source: &str) -> Result<Expanded, Diagnostic> {
    if source.len() > MAX_BYTES {
        return Err(Diagnostic::at(source, 0, "source exceeds 2 MiB"));
    }
    let input = Expanded {
        text: clean(source),
        origins: (0..source.len()).collect(),
    };
    Expander {
        source,
        steps: 0,
        iterations: 0,
    }
    .run(&input, &mut Environment::default(), 0)
}
fn name(c: &mut Cursor<'_>) -> Result<String, String> {
    if !c.eat("\\") {
        return Err("expected a control sequence".into());
    }
    let start = c.pos;
    while c
        .rest()
        .chars()
        .next()
        .is_some_and(|ch| ch.is_ascii_alphabetic())
    {
        c.pos += 1;
    }
    if c.pos == start {
        return Err("macro names must contain ASCII letters".into());
    }
    Ok(c.source[start..c.pos].into())
}
fn reserved(name: &str) -> bool {
    [
        "begin",
        "end",
        "node",
        "coordinate",
        "draw",
        "path",
        "fill",
        "filldraw",
        "tikzset",
        "definecolor",
        "pgfdeclarelayer",
        "pgfsetlayers",
        "foreach",
        "def",
        "newcommand",
        "renewcommand",
        "pgfmathsetmacro",
        "pgfmathtruncatemacro",
        "pgfmathparse",
        "input",
        "include",
        "write",
        "openout",
        "catcode",
        "csname",
        "let",
        "edef",
        "gdef",
        "global",
    ]
    .contains(&name)
}
impl Expander<'_> {
    fn error(&self, input: &Expanded, at: usize, message: impl Into<String>) -> Diagnostic {
        Diagnostic::at(self.source, input.origin(at), message)
    }
    fn run(
        &mut self,
        input: &Expanded,
        env: &mut Environment,
        depth: usize,
    ) -> Result<Expanded, Diagnostic> {
        if depth > 64 {
            return Err(self.error(input, 0, "macro/group expansion exceeds 64 levels"));
        }
        let mut out = Expanded::default();
        let mut c = Cursor::new(&input.text);
        let mut scopes = Vec::new();
        while !c.rest().is_empty() {
            let at = c.pos;
            self.steps += 1;
            if self.steps > MAX_STEPS {
                return Err(self.error(input, at, "expansion work exceeds 200000 steps"));
            }
            let result = (|| -> Result<Expanded, Diagnostic> {
                if c.rest().starts_with('{') {
                    let group = c.group('{', '}').map_err(|m| self.error(input, at, m))?;
                    let start = c.pos - group.len() - 1;
                    let body =
                        self.run(&input.slice(start, c.pos - 1), &mut env.clone(), depth + 1)?;
                    let mut result = Expanded::literal("{", input.origin(at));
                    result.append(body).map_err(|m| self.error(input, at, m))?;
                    result
                        .append(Expanded::literal("}", input.origin(c.pos - 1)))
                        .map_err(|m| self.error(input, at, m))?;
                    return Ok(result);
                }
                if !c.rest().starts_with('\\') {
                    let ch = c.rest().chars().next().unwrap();
                    c.pos += ch.len_utf8();
                    return Ok(input.slice(at, c.pos));
                }
                c.pos += 1;
                let start = c.pos;
                while c
                    .rest()
                    .chars()
                    .next()
                    .is_some_and(|ch| ch.is_ascii_alphabetic())
                {
                    c.pos += 1;
                }
                if start == c.pos {
                    if let Some(ch) = c.rest().chars().next() {
                        c.pos += ch.len_utf8();
                    }
                    return Ok(input.slice(at, c.pos));
                }
                let cmd = &input.text[start..c.pos];
                let action = (|| -> Result<Option<Expanded>, String> {
                    match cmd {
                        "def" | "newcommand" | "renewcommand" => {
                            c.ws();
                            let macro_name = if cmd != "def" && c.rest().starts_with('{') {
                                let mut n = Cursor::new(c.group('{', '}')?);
                                let v = name(&mut n)?;
                                if !n.rest().trim().is_empty() {return Err("invalid macro name".into());}
                                v
                            } else {name(&mut c)?};
                            if reserved(&macro_name) {return Err(format!("cannot redefine native command \\{macro_name}"));}
                            let mut args = 0;
                            c.ws();
                            if cmd == "def" {
                                while c.eat("#") {
                                    args += 1;
                                    if args > 9 || !c.eat(&args.to_string()) {return Err("only sequential undelimited macro parameters #1..#9 are supported".into());}
                                }
                            } else if c.rest().starts_with('[') {
                                args = c.group('[', ']')?.parse().map_err(|_| "invalid macro arity")?;
                                if args > 9 {return Err("macro arity exceeds 9".into());}
                            }
                            c.ws();
                            if c.rest().starts_with('[') {return Err("Unsupported optional macro arguments".into());}
                            let body = c.group('{', '}')?.to_owned();
                            validate_parameters(&body, args)?;
                            if cmd == "newcommand" && env.macros.contains_key(&macro_name) {return Err(format!("macro \\{macro_name} already defined"));}
                            if cmd == "renewcommand" && !env.macros.contains_key(&macro_name) {return Err(format!("macro \\{macro_name} not defined"));}
                            env.macros.insert(macro_name, Macro {args, body});
                            Ok(Some(Expanded::default()))
                        }
                        "begin" | "end" => {
                            let kind = c.group('{', '}')?;
                            if kind == "scope" || kind == "tikzpicture" || kind == "pgfonlayer" {
                                if cmd == "begin" {scopes.push(env.clone());}
                                else if let Some(previous) = scopes.pop() {*env = previous;}
                                else if depth>0 {return Err("Unsupported scope crossing an expansion/group boundary".into());}
                            }
                            Ok(Some(input.slice(at, c.pos)))
                        }
                        _ => Ok(None)
                    }
                })().map_err(|m| self.error(input, at, m))?;
                if let Some(value) = action {
                    return Ok(value);
                }
                if ["pgfmathsetmacro", "pgfmathtruncatemacro", "pgfmathparse"].contains(&cmd) {
                    let target = if cmd == "pgfmathparse" {
                        "pgfmathresult".to_owned()
                    } else {
                        c.ws();
                        let group = c.group('{', '}').map_err(|m| self.error(input, at, m))?;
                        let mut n = Cursor::new(group);
                        let target = name(&mut n).map_err(|m| self.error(input, at, m))?;
                        if !n.rest().trim().is_empty() || reserved(&target) {
                            return Err(self.error(input, at, "invalid math macro target"));
                        }
                        target
                    };
                    let expression = c.group('{', '}').map_err(|m| self.error(input, at, m))?;
                    let expanded = self.run(
                        &Expanded::literal(expression, input.origin(at)),
                        &mut env.clone(),
                        depth + 1,
                    )?;
                    let mut value =
                        crate::expr::eval(&expanded.text).map_err(|m| self.error(input, at, m))?;
                    if cmd == "pgfmathtruncatemacro" {
                        value = value.trunc();
                    }
                    env.macros.insert(
                        target,
                        Macro {
                            args: 0,
                            body: value.to_string(),
                        },
                    );
                    return Ok(Expanded::default());
                }
                if cmd == "foreach" {
                    let mut names = vec![name(&mut c).map_err(|m| self.error(input, at, m))?];
                    while c.eat("/") {
                        names.push(name(&mut c).map_err(|m| self.error(input, at, m))?);
                    }
                    if names.iter().any(|n| reserved(n)) {
                        return Err(self.error(input, at, "reserved foreach variable"));
                    }
                    c.ws();
                    let mut counters = Vec::new();
                    if c.rest().starts_with('[') {
                        let opts = c.group('[', ']').map_err(|m| self.error(input, at, m))?;
                        for opt in split_top(opts, ',') {
                            let (key, value) = opt.split_once('=').ok_or_else(|| {
                                self.error(
                                    input,
                                    at,
                                    "Unsupported foreach option (only count is supported)",
                                )
                            })?;
                            if key.trim() != "count" {
                                return Err(self.error(
                                    input,
                                    at,
                                    "Unsupported foreach option (only count is supported)",
                                ));
                            }
                            let mut count = Cursor::new(value);
                            let n = name(&mut count).map_err(|m| self.error(input, at, m))?;
                            let initial = if count.eat("from") {
                                crate::expr::eval(count.rest())
                                    .map_err(|m| self.error(input, at, m))?
                            } else if count.rest().trim().is_empty() {
                                1.
                            } else {
                                return Err(self.error(input, at, "invalid foreach count"));
                            };
                            if reserved(&n) || names.contains(&n) || initial.fract() != 0. {
                                return Err(self.error(input, at, "invalid foreach counter"));
                            }
                            counters.push((n, initial));
                        }
                    }
                    if !c.eat("in") {
                        return Err(self.error(input, at, "foreach requires 'in'"));
                    }
                    let list = c.group('{', '}').map_err(|m| self.error(input, at, m))?;
                    let list = self.run(
                        &Expanded::literal(list, input.origin(at)),
                        &mut env.clone(),
                        depth + 1,
                    )?;
                    let entries = range_list(&list.text).map_err(|m| self.error(input, at, m))?;
                    let (start, end) =
                        loop_body(&mut c, 0).map_err(|m| self.error(input, at, m))?;
                    let body = input.slice(start, end);
                    let mut result = Expanded::default();
                    for (index, entry) in entries.into_iter().enumerate() {
                        self.iterations += 1;
                        if self.iterations > MAX_ITERATIONS {
                            return Err(self.error(
                                input,
                                at,
                                "foreach exceeds 10000 total iterations",
                            ));
                        }
                        let values = split_top_empty(&entry, '/');
                        if values.len() != names.len() {
                            return Err(self.error(
                                input,
                                at,
                                "foreach tuple arity must match variable count",
                            ));
                        }
                        let mut local = env.clone();
                        for (n, initial) in &counters {
                            local.macros.insert(
                                n.clone(),
                                Macro {
                                    args: 0,
                                    body: (initial + index as f64).to_string(),
                                },
                            );
                        }
                        for (n, v) in names.iter().zip(values) {
                            local.macros.insert(
                                n.clone(),
                                Macro {
                                    args: 0,
                                    body: unbrace(v).into(),
                                },
                            );
                        }
                        result
                            .append(Expanded::literal("\\begin{scope}", input.origin(at)))
                            .map_err(|m| self.error(input, at, m))?;
                        result
                            .append(self.run(&body, &mut local, depth + 1)?)
                            .map_err(|m| self.error(input, at, m))?;
                        result
                            .append(Expanded::literal("\\end{scope}", input.origin(at)))
                            .map_err(|m| self.error(input, at, m))?;
                    }
                    return Ok(result);
                }
                if let Some(mac) = env.macros.get(cmd).cloned() {
                    // Control-word delimiter whitespace is consumed before replacement.
                    c.ws();
                    let mut args = Vec::new();
                    for _ in 0..mac.args {
                        args.push(
                            c.group('{', '}')
                                .map_err(|m| self.error(input, at, m))?
                                .to_owned(),
                        );
                    }
                    let body =
                        substitute(&mac.body, &args).map_err(|m| self.error(input, at, m))?;
                    let mut result =
                        self.run(&Expanded::literal(&body, input.origin(at)), env, depth + 1)?;
                    if ends_control_word(&result.text)
                        && c.rest().starts_with(|ch: char| ch.is_ascii_alphabetic())
                    {
                        result
                            .append(Expanded::literal(" ", input.origin(at)))
                            .map_err(|m| self.error(input, at, m))?;
                    }
                    return Ok(result);
                }
                if [
                    "edef", "gdef", "xdef", "let", "global", "catcode", "csname", "input",
                    "include", "write", "openout", "loop", "ifnum",
                ]
                .contains(&cmd)
                {
                    return Err(self.error(input, at, format!("Unsupported TeX command \\{cmd}")));
                }
                Ok(input.slice(at, c.pos))
            })()?;
            out.append(result).map_err(|m| self.error(input, at, m))?;
        }
        if depth > 0 && !scopes.is_empty() {
            return Err(self.error(
                input,
                0,
                "Unsupported scope crossing an expansion/group boundary",
            ));
        }
        Ok(out)
    }
}
/// A loop body is either a group or one semicolon-terminated TikZ command.
/// Recursing through a following foreach also handles nested unbraced loops.
fn loop_body(c: &mut Cursor<'_>, depth: usize) -> Result<(usize, usize), String> {
    if depth > 64 {
        return Err("foreach body nesting exceeds 64 levels".into());
    }
    c.ws();
    let start = c.pos;
    if c.rest().starts_with('{') {
        let group = c.group('{', '}')?;
        return Ok((c.pos - group.len() - 1, c.pos - 1));
    }
    if c.eat("\\foreach") {
        name(c)?;
        while c.eat("/") {
            name(c)?;
        }
        c.ws();
        if c.rest().starts_with('[') {
            c.group('[', ']')?;
        }
        if !c.eat("in") {
            return Err("foreach requires 'in'".into());
        }
        c.group('{', '}')?;
        loop_body(c, depth + 1)?;
        return Ok((start, c.pos));
    }
    while !c.rest().is_empty() {
        let ch = c.rest().chars().next().unwrap();
        match ch {
            '{' => {
                c.group('{', '}')?;
            }
            '[' => {
                c.group('[', ']')?;
            }
            '(' => {
                c.group('(', ')')?;
            }
            ';' => {
                c.pos += 1;
                return Ok((start, c.pos));
            }
            '}' => return Err("unbraced foreach body requires ';'".into()),
            '\\' => {
                c.pos += 1;
                if let Some(ch) = c.rest().chars().next() {
                    c.pos += ch.len_utf8();
                }
            }
            _ => c.pos += ch.len_utf8(),
        }
    }
    Err("unbraced foreach body requires ';'".into())
}
fn validate_parameters(body: &str, args: usize) -> Result<(), String> {
    let mut chars = body.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            chars.next();
        } else if c == '#' {
            let n = chars
                .next()
                .and_then(|c| c.to_digit(10))
                .ok_or("invalid macro parameter")? as usize;
            if n == 0 || n > args {
                return Err("macro parameter outside declared arity".into());
            }
        }
    }
    Ok(())
}
fn substitute(body: &str, args: &[String]) -> Result<String, String> {
    if args.is_empty() {
        return Ok(body.to_owned());
    }
    let mut out = String::new();
    let mut chars = body.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            out.push(c);
            if let Some(next) = chars.next() {
                out.push(next);
            }
        } else if c == '#' {
            let n = chars.next().unwrap().to_digit(10).unwrap() as usize;
            if out.len() + args[n - 1].len() > MAX_BYTES {
                return Err("macro replacement exceeds 2 MiB".into());
            }
            let argument = &args[n - 1];
            if ends_control_word(&out) && argument.starts_with(|ch: char| ch.is_ascii_alphabetic())
            {
                out.push(' ');
            }
            out.push_str(argument);
            if ends_control_word(argument) && chars.peek().is_some_and(char::is_ascii_alphabetic) {
                out.push(' ');
            }
        } else {
            out.push(c);
        }
    }
    Ok(out)
}
fn ends_control_word(s: &str) -> bool {
    let letters = s.bytes().rev().take_while(u8::is_ascii_alphabetic).count();
    letters > 0
        && s[..s.len() - letters]
            .bytes()
            .rev()
            .take_while(|b| *b == b'\\')
            .count()
            % 2
            == 1
}
fn range_list(list: &str) -> Result<Vec<String>, String> {
    let parts = split_top(list, ',');
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < parts.len() {
        if parts[i] == "..." {
            if out.is_empty() || i + 1 >= parts.len() {
                return Err("invalid foreach numeric range".into());
            }
            let last = crate::expr::eval(out.last().unwrap())?;
            let end = crate::expr::eval(parts[i + 1])?;
            let step = if out.len() >= 2 {
                last - crate::expr::eval(&out[out.len() - 2])?
            } else if end < last {
                -1.
            } else {
                1.
            };
            if step.abs() < 1e-12 || (end - last) * step < 0. {
                return Err("invalid foreach range step/direction".into());
            }
            let count = ((end - last) / step + 1e-9).floor();
            if count > MAX_ITERATIONS as f64 {
                return Err("foreach range exceeds 10000 iterations".into());
            }
            for n in 1..=count as usize {
                out.push(
                    format!("{:.12}", last + n as f64 * step)
                        .trim_end_matches('0')
                        .trim_end_matches('.')
                        .to_owned(),
                );
            }
            i += 2;
        } else {
            out.push(parts[i].to_owned());
            i += 1;
        }
        if out.len() > MAX_ITERATIONS {
            return Err("foreach list exceeds 10000 entries".into());
        }
    }
    Ok(out)
}
