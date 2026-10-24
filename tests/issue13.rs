//! Regressions for GitHub issue #13: options and text commands that were
//! rejected or silently ignored in v1.2.0.
use tikzc::compile;

fn svg(body: &str) -> String {
    let source = format!("\\begin{{tikzpicture}}\n{body}\n\\end{{tikzpicture}}\n");
    compile(&source)
        .unwrap_or_else(|e| panic!("{body}: {e}"))
        .svg
}

/// Glyph ids in drawing order; grouping of runs may differ between inputs.
fn glyphs(body: &str) -> Vec<String> {
    svg(body)
        .split("xlink:href=\"#")
        .skip(1)
        .map(|s| s[..s.find('"').unwrap()].to_owned())
        .collect()
}

#[test]
fn double_node_border_draws_two_strokes() {
    let single = svg(r"\node[draw] {A};");
    let double = svg(r"\node[draw, double] {A};");
    assert_eq!(single.matches("<rect").count(), 1);
    assert_eq!(double.matches("<rect").count(), 2);
    assert!(double.contains("stroke=\"#ffffff\""));
    let colored = svg(r"\node[draw, circle, double=red, double distance=2pt] {A};");
    assert_eq!(colored.matches("<ellipse").count(), 2);
    assert!(colored.contains("stroke=\"#ff0000\" fill=\"none\""));
    // Without `draw` there is no border to double.
    assert_eq!(svg(r"\node[double] {A};").matches("<rect").count(), 1);
}

#[test]
fn label_accepts_anchor_names_inline_and_from_styles() {
    let numeric = svg(r"\node[draw, label={[red]45:X}] {A};");
    assert_eq!(svg(r"\node[draw, label={[red]north east:X}] {A};"), numeric);
    let styled = svg(r"\tikzset{tag/.style={label={[red]north east:X}}} \node[draw, tag] {A};");
    assert_eq!(styled, numeric);
    assert_eq!(
        svg(r"\node[draw, label=south west:X] {A};"),
        svg(r"\node[draw, label=below left:X] {A};")
    );
}

#[test]
fn label_shifts_move_the_label() {
    assert_eq!(
        svg(r"\node[draw, label={[yshift=2pt]above:X}] {A};"),
        svg(r"\node[draw, label={[label distance=2pt]above:X}] {A};")
    );
    assert_eq!(
        svg(r"\node[draw, label={[xshift=-3pt]left:X}] {A};"),
        svg(r"\node[draw, label={[label distance=3pt]left:X}] {A};")
    );
    let error = compile("\\begin{tikzpicture}\\node[label={[rotate=30]X}] {A};\\end{tikzpicture}")
        .err()
        .expect("must fail");
    assert!(error.message.contains("transformed label"), "{error}");
}

#[test]
fn named_dash_dot_styles() {
    for (style, pattern) in [
        ("dash dot", "3,2,0.5,2"),
        ("dashdotted", "3,2,0.5,2"),
        ("densely dash dot", "3,1,0.5,1"),
        ("loosely dashdotted", "3,4,0.5,4"),
        ("dash dot dot", "3,2,0.5,2,0.5,2"),
        ("densely dashdotdotted", "3,1,0.5,1,0.5,1"),
        ("loosely dash dot dot", "3,4,0.5,4,0.5,4"),
    ] {
        let out = svg(&format!(r"\draw[{style}] (0,0) -- (2,0);"));
        assert!(
            out.contains(&format!("stroke-dasharray=\"{pattern}\"")),
            "{style}"
        );
    }
}

#[test]
fn bare_arrow_tip_specs() {
    assert_eq!(
        svg(r"\draw[-Stealth] (0,0) -- (2,0);"),
        svg(r"\draw[->, >=Stealth] (0,0) -- (2,0);")
    );
    assert_eq!(
        svg(r"\draw[Stealth-] (0,0) -- (2,0);"),
        svg(r"\draw[<-, >=Stealth] (0,0) -- (2,0);")
    );
    assert_eq!(
        svg(r"\draw[Stealth-Stealth] (0,0) -- (2,0);"),
        svg(r"\draw[<->, >=Stealth] (0,0) -- (2,0);")
    );
    svg(r"\draw[-{Stealth[length=3pt]}] (0,0) -- (2,0);");
    svg(r"\draw[Latex-{Stealth[open]}] (0,0) -- (2,0);");
}

#[test]
fn typewriter_text_has_no_dash_ligatures() {
    assert_eq!(
        glyphs(r"\node {\texttt{--x}};"),
        glyphs(r"\node {\texttt{-{}-x}};")
    );
    assert_eq!(
        glyphs(r"\node {{\ttfamily --x}};"),
        glyphs(r"\node {{\ttfamily -{}-x}};")
    );
    // Ligatures resume after the typewriter group ends.
    assert_ne!(
        glyphs(r"\node {{\ttfamily x}--};"),
        glyphs(r"\node {{\ttfamily x}-{}-};")
    );
}

#[test]
fn verb_is_verbatim_typewriter_text() {
    assert_eq!(
        glyphs(r"\node {\verb|a_b|};"),
        glyphs(r"\node {\texttt{a\_b}};")
    );
    assert_eq!(
        glyphs(r"\node {\verb+x{y}+};"),
        glyphs(r"\node {\texttt{x\{y\}}};")
    );
    let error = compile("\\begin{tikzpicture}\\node {\\verb|a};\\end{tikzpicture}")
        .err()
        .expect("must fail");
    assert!(error.message.contains("unclosed \\verb"), "{error}");
}
