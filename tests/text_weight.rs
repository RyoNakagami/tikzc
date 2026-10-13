use tikzc::{
    compile,
    options::{Styles, Values},
    text::TextEngine,
};

#[test]
fn bundled_japanese_italic_is_visible_and_upright_can_be_restored() {
    let mut engine = TextEngine::new();
    let styles = Styles::default();
    let options = Values::new();
    let italic_options = Values::from([("font".into(), r"\itshape".into())]);
    for family in ["IPAexMincho", "IPAexGothic"] {
        let regular = engine
            .layout("日本語ABC", &options, &styles, family)
            .unwrap();
        let italic = engine
            .layout("日本語ABC", &italic_options, &styles, family)
            .unwrap();
        assert!(
            regular.svg != italic.svg,
            "{family}: italic fell back to upright"
        );
        for text in [
            r"\itshape 日本語ABC",
            r"\textit{日本語ABC}",
            r"\emph{日本語ABC}",
        ] {
            assert_eq!(
                italic.svg,
                engine.layout(text, &options, &styles, family).unwrap().svg,
                "{family}: inconsistent italic command {text}"
            );
        }
        assert_eq!(
            regular.svg,
            engine
                .layout(r"\itshape\upshape 日本語ABC", &options, &styles, family)
                .unwrap()
                .svg,
            "{family}: upright was not restored"
        );
    }
}

#[test]
fn ipa_synthetic_bold_is_visible_and_regular_can_be_restored() {
    let mut engine = TextEngine::new();
    let styles = Styles::default();
    let options = Values::new();
    for family in ["IPAexMincho", "IPAexGothic"] {
        let mut layout = |s| engine.layout(s, &options, &styles, family).unwrap();
        let regular = layout("日本語ABC");
        let bold = layout(r"\bfseries 日本語ABC");
        assert!(
            regular.svg != bold.svg,
            "{family}: synthetic bold fell back to regular"
        );
        assert_eq!(bold.svg, layout(r"\textbf{日本語ABC}").svg);
        assert_eq!(regular.svg, layout(r"\bfseries\mdseries 日本語ABC").svg);
    }
}

#[test]
fn font_fallback_list_preserves_real_italic_face() {
    let mut engine = TextEngine::new();
    let styles = Styles::default();
    let options = Values::new();
    let regular = engine
        .layout("Latin ABC", &options, &styles, "Latin Modern Mono")
        .unwrap();
    let italic = engine
        .layout(
            r"\itshape Latin ABC",
            &options,
            &styles,
            "Latin Modern Mono",
        )
        .unwrap();
    let fallback = engine
        .layout(
            r"\ttfamily\itshape Latin ABC",
            &options,
            &styles,
            "IPAexMincho",
        )
        .unwrap();
    assert!(
        regular.svg != italic.svg,
        "real italic face was not selected"
    );
    assert_eq!(
        italic.svg, fallback.svg,
        "font fallback list changed real italic glyphs"
    );
}

#[test]
fn typewriter_japanese_uses_bundled_gothic_in_text_and_math() {
    let mut engine = TextEngine::new();
    let styles = Styles::default();
    let options = Values::new();
    let gothic = engine
        .layout("日本語", &options, &styles, "IPAexGothic")
        .unwrap();
    for source in [r"\texttt{日本語}", r"\ttfamily 日本語"] {
        assert_eq!(
            gothic.svg,
            engine
                .layout(source, &options, &styles, "IPAexMincho")
                .unwrap()
                .svg,
            "typewriter Japanese did not use the bundled Gothic fallback: {source}"
        );
    }
    // Exercise all three conversion paths with mixed Latin/CJK characters,
    // including the separate texttt helper used inside math.
    for label in [
        r"\texttt{A日本語B}",
        r"\ttfamily A日本語B",
        r"$\texttt{A日本語B}$",
    ] {
        let diagram = compile(&format!(r"\node {{{label}}};")).unwrap();
        assert!(!diagram.svg.contains("<text"));
        assert!(diagram.svg.contains("<path"));
        assert!(diagram.png(150.).is_ok());
    }
}

#[test]
fn zlabel_style_renders_bold_in_svg_and_png() {
    let source = r"#| mainfont: IPAexGothic
\begin{tikzpicture}[
  zlabel/.style={anchor=south, font=\bfseries, text=#1!45!black}]
  \node[zlabel=blue] at (0,0) {オフライン学習（事前構築）};
\end{tikzpicture}";
    let bold = compile(source).unwrap();
    let regular = compile(&source.replace(r"\bfseries", r"\mdseries")).unwrap();
    assert!(bold.svg != regular.svg, "zlabel lost its bold font style");
    assert_ne!(bold.png(150.).unwrap(), regular.png(150.).unwrap());
}
