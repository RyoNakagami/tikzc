//! Pseudocode syntax tree: one `algorithm` environment and its statements.

/// Provenance and explanation notes written as `% @...` comments.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Annotations {
    /// `paper=` locators, in source order.
    pub paper: Vec<String>,
    /// `impl=` locators (`path:line` or `path:start-end`), in source order.
    pub implementation: Vec<String>,
    /// `@ref` IDs shared with `ref=` nodes in a figure.
    pub refs: Vec<String>,
    pub explain: Option<String>,
    /// Source offset of the first annotation, for diagnostics.
    pub offset: Option<usize>,
}
impl Annotations {
    pub fn sourced(&self) -> bool {
        !self.paper.is_empty() || !self.implementation.is_empty()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Procedure,
    Function,
    If,
    ElsIf,
    Else,
    For,
    ForAll,
    While,
    Repeat,
    Until,
    Loop,
    /// `\ENDIF` etc.; the payload is the block it closes.
    End(Block),
    State,
    Return,
    Print,
    Break,
    Continue,
    Require,
    Ensure,
    Input,
    Output,
    /// A `\COMMENT` that is not attached to a statement.
    Comment,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Block {
    Procedure,
    Function,
    If,
    For,
    While,
    Loop,
}
impl Block {
    pub fn keyword(self) -> &'static str {
        match self {
            Block::Procedure => "procedure",
            Block::Function => "function",
            Block::If => "if",
            Block::For => "for",
            Block::While => "while",
            Block::Loop => "loop",
        }
    }
}

/// One rendered line of pseudocode.
#[derive(Clone, Debug)]
pub struct Line {
    pub kind: Kind,
    /// Indentation depth (0 at the top level of `algorithmic`).
    pub depth: usize,
    /// Procedure/function name.
    pub name: Option<String>,
    /// Condition, arguments or statement text (TeX).
    pub text: String,
    /// Trailing `\COMMENT{...}` text (TeX).
    pub comment: Option<String>,
    pub notes: Annotations,
    /// Source offset of the command that starts the line.
    pub offset: usize,
}
impl Line {
    /// Statements that receive a line number (`\REQUIRE` & co. do not).
    pub fn numbered(&self) -> bool {
        !matches!(
            self.kind,
            Kind::Require | Kind::Ensure | Kind::Input | Kind::Output
        )
    }
}

#[derive(Clone, Debug)]
pub struct Algorithm {
    /// `name=` from `\begin{algorithm}[name=...]`.
    pub name: Option<String>,
    pub caption: Option<String>,
    /// "Algorithm n": `number=`, else one more than the previous numbered
    /// algorithm; `None` for `number=none`.
    pub number: Option<usize>,
    pub lines: Vec<Line>,
    /// Source offset of `\begin{algorithm}`.
    pub offset: usize,
}
