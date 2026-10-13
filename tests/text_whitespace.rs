use tikzc::{
    compile,
    options::{Styles, Values},
    text::TextEngine,
};

#[test]
fn source_indentation_after_line_breaks_does_not_change_layout() {
    let mut engine = TextEngine::new();
    let styles = Styles::default();
    for align in ["left", "center", "right"] {
        for width in [None, Some("8cm")] {
            let mut options = Values::new();
            options.insert("align".into(), align.into());
            if let Some(width) = width {
                options.insert("text width".into(), width.into());
            }
            for (compact, indented) in [
                (r"ABC\\ABC", "ABC\\\\\n     ABC"),
                (r"日本語ABC\\日本語ABC", "日本語ABC\\\\\r\n\t  日本語ABC"),
                (
                    r"\texttt{crates/tikzc/}：Rust CLI\\\texttt{assets/fonts/}：組版用フォント",
                    "\\texttt{crates/tikzc/}：Rust CLI\\\\\n     \\texttt{assets/fonts/}：組版用フォント",
                ),
                (r"\texttt{ABC\\ABC}", "\\texttt{ABC\\\\\n   ABC}"),
                (r"$x_i$\\$x_i$", "$x_i$\\\\\n   $x_i$"),
                (r"A\\[2pt]B", "A\\\\[2pt]\n   B"),
                (r"A\\[2pt]B", "A\\\\ \n  [2pt]\n   B"),
                (r"A\\\hspace{1em}B", "A\\\\\n  \\hspace{1em}B"),
                (r"A\\\quad B", "A\\\\\n  \\quad B"),
                (r"A\\\ B", "A\\\\\n  \\ B"),
            ] {
                let expected = engine
                    .layout(compact, &options, &styles, "IPAexGothic")
                    .unwrap();
                let actual = engine
                    .layout(indented, &options, &styles, "IPAexGothic")
                    .unwrap();
                assert_eq!(
                    actual.width, expected.width,
                    "{align}, {width:?}: {indented:?}"
                );
                assert_eq!(
                    actual.height, expected.height,
                    "{align}, {width:?}: {indented:?}"
                );
                assert_eq!(
                    actual.baseline, expected.baseline,
                    "{align}, {width:?}: {indented:?}"
                );
                assert_eq!(actual.svg, expected.svg, "{align}, {width:?}: {indented:?}");
            }
        }
    }
}

#[test]
fn ordinary_word_spaces_and_explicit_indentation_remain_visible() {
    let mut engine = TextEngine::new();
    let styles = Styles::default();
    let options = Values::new();
    let mut layout = |text| {
        engine
            .layout(text, &options, &styles, "IPAexGothic")
            .unwrap()
    };
    assert_eq!(layout("ABC DEF").svg, layout("ABC\n    DEF").svg);
    assert!(layout("ABC DEF").width > layout("ABCDEF").width);
    let plain = layout(r"A\\B");
    for text in [
        r"A\\\hspace{1em}B",
        r"A\\\quad B",
        r"A\\\ B",
        r"A\\~B",
        "A\\\\\u{3000}B",
        "A\\\\\u{a0}B",
    ] {
        assert!(
            layout(text).width > plain.width,
            "explicit spacing lost: {text}"
        );
    }
}

#[test]
fn mixed_width_diagram_ignores_line_break_indentation() {
    let source = include_str!("../tests/fixtures/text-linebreak-indentation.tikz");
    let compact = source.replace("\\\\\n     ", "\\\\");
    assert_ne!(
        source, compact,
        "fixture must include the reported indentation"
    );
    let expected = compile(&compact).unwrap();
    let actual = compile(source).unwrap();
    assert!(
        actual.svg == expected.svg,
        "source indentation changed SVG geometry"
    );
    assert_eq!(actual.png(96.).unwrap(), expected.png(96.).unwrap());
}
