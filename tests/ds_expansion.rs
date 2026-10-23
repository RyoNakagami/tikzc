//! Number printing (F2), loop options and list macros (F3), computed colour
//! mixes (F4), `foreach` inside a path (F9), conditional math (F12),
//! seeded random numbers (F14) and TeX conditionals with pgfmath strings. Reference values marked "TeX" were printed
//! by lualatex with PGF 3.1.10 and xcolor; no test runs TeX.
mod common;
use common::*;
use tikzc::compile;

#[test]
fn printnumber_fixture_matches_pgf() {
    let d = compile_fixture("ds-printnumber.tikz");
    // TeX: \pgfmathprintnumberto[...]{...}{\m}\meaning\m, e.g.
    //   [fixed,precision=2]{0.85669}      -> \pgfutilensuremath{0.86}
    //   [fixed,precision=3,zerofill]{0.5} -> \pgfutilensuremath{0.500}
    //   {1234567}                         -> \pgfutilensuremath{1.23\cdot 10^{6}}
    //   [fixed,precision=1]{-0.04}        -> \pgfutilensuremath{0}
    // The default format switches to scientific notation above 10^4, so the
    // plain call does not print 1,234,567; `fixed` does (with {,} separators).
    assert_eq!(
        d.labels,
        [
            r"\ensuremath{0.86}",
            r"\ensuremath{0.500}",
            r"\ensuremath{1.23\cdot 10^{6}}",
            r"\ensuremath{0}",
        ]
    );
    for name in ["a", "b", "c", "d"] {
        assert!(d.nodes[name].width > 0., "{name}");
    }
    let d = compile(
        r"\node {\pgfmathprintnumber[fixed]{1234567}};
          \node at (0,1) {$n = \pgfmathprintnumber{3}$};
          \def\v{2}\node at (0,2) {\pgfmathprintnumber[fixed,precision=1]{\v/3}};",
    )
    .unwrap();
    assert_eq!(
        d.labels,
        [
            r"\ensuremath{1{,}234{,}567}",
            r"$n = \ensuremath{3}$",
            r"\ensuremath{0.7}"
        ]
    );
}

#[test]
fn printnumber_rounds_without_changing_large_integers() {
    let d = compile(
        r"\node {\pgfmathprintnumber[fixed,precision=2]{1000000000000}};
          \node {\pgfmathprintnumber[fixed,precision=12]{1}};
          \node {\pgfmathprintnumber[fixed,precision=2]{0.145}};
          \node {\pgfmathprintnumber[fixed,precision=2]{0.14499999999999}};",
    )
    .unwrap();
    assert_eq!(
        d.labels,
        [
            r"\ensuremath{1{,}000{,}000{,}000{,}000}",
            r"\ensuremath{1}",
            r"\ensuremath{0.15}",
            r"\ensuremath{0.14}",
        ]
    );
}

#[test]
fn unsupported_number_formats_are_diagnostics() {
    for option in ["sci", "std", "int detect", "fixed,use comma"] {
        assert_error_at(
            &format!("\\node {{x}};\n\\node {{\\pgfmathprintnumber[{option}]{{1}}}};"),
            2,
            8,
            "Unsupported number format option",
        );
    }
    assert_error_at(r"\node {\pgfmathprintnumber{1/0}};", 1, 8, "non-finite");
}

fn filled(svg: &str) -> Vec<Drawn> {
    drawn(svg)
        .into_iter()
        .filter(|p| p.fill != "none")
        .collect()
}

#[test]
fn stacked_fixture_remembers_and_evaluates() {
    let d = compile_fixture("ds-stacked.tikz");
    let bars = filled(&d.svg);
    assert_eq!(bars.len(), 3);
    // TeX: prev=0 s=2.0, prev=2.0 s=3.0, prev=3.0 s=6.0
    for (bar, (low, high)) in bars.iter().zip([(0., 2.), (2., 3.), (3., 6.)]) {
        near(bar.y_range().0, low, 1e-6);
        near(bar.y_range().1, high, 1e-6);
        near(bar.x_range().1, 1., 1e-6);
    }
}

#[test]
fn foreach_options_follow_pgf() {
    // TeX: evaluate=\v as \w using \v*2 -> w=2.0, 4.0; count=\c from 0 -> 0, 1
    let d = compile(
        r"\foreach \v [evaluate=\v as \w using \v*2, count=\c from 0] in {1,2}
            \coordinate (p\c) at (\w,\v);",
    )
    .unwrap();
    near(d.nodes["p0"].center.x, 2. * CM, 1e-9);
    near(d.nodes["p1"].center.x, 4. * CM, 1e-9);
    near(d.nodes["p1"].center.y, 2. * CM, 1e-9);
    // TeX: evaluate=\v -> v=2.0, 6.0; evaluate=\v as \w keeps v=1+1 and w=2.0
    let d = compile(
        r"\foreach \v [evaluate=\v, count=\c] in {1+1,2*3} \coordinate (a\c) at (\v,0);
          \foreach \v [evaluate=\v as \w, count=\c] in {1+1,2*3} \coordinate (b\c) at (\w,\v);",
    )
    .unwrap();
    near(d.nodes["a2"].center.x, 6. * CM, 1e-9);
    near(d.nodes["b2"].center.x, 6. * CM, 1e-9);
    near(d.nodes["b2"].center.y, 6. * CM, 1e-9);
    // Options may precede the variables; remember without evaluate.
    let d = compile(
        r"\foreach [remember=\x as \last (initially 0), count=\c] \x in {1,3,6}
            \coordinate (r\c) at (\x,\last);",
    )
    .unwrap();
    near(d.nodes["r3"].center.x, 6. * CM, 1e-9);
    near(d.nodes["r3"].center.y, 3. * CM, 1e-9);
    // Loop macros do not leak.
    assert!(
        compile(r"\foreach \v [evaluate=\v as \w using \v*2] in {1} {} \node at (\w,0) {};")
            .is_err()
    );
}

#[test]
fn invalid_foreach_options_are_diagnostics() {
    // No `initially`: the first iteration reads an undefined macro.
    assert_error_at(
        "\\node {x};\n\\foreach \\v [remember=\\s as \\prev, evaluate=\\v as \\s using \\prev+\\v] in {2,1}\n  \\node {\\s};",
        2,
        1,
        "Unsupported math",
    );
    assert_error_at(
        r"\foreach \v [evaluate=\v as \s using 1/(\v-1)] in {1,2} \node {\s};",
        1,
        1,
        "non-finite",
    );
    for options in [
        "parse=true",
        r"var=\x",
        r"remember=\v",
        r"remember=\v as \p (until 3)",
        r"evaluate=\v as \draw",
        r"evaluate=\q",
    ] {
        assert_error_at(
            &format!(r"\foreach \v [{options}] in {{1,2}} \node {{\v}};"),
            1,
            1,
            "foreach",
        );
    }
}

#[test]
fn list_macro_fixture_builds_the_network() {
    let d = compile_fixture("ds-list-macro.tikz");
    // 3 + 5 + 2 nodes, 3*5 + 5*2 edges.
    assert_eq!(d.nodes.len(), 10);
    let edges = drawn(&d.svg)
        .into_iter()
        .filter(|p| p.stroke == "#808080")
        .count();
    assert_eq!(edges, 25);
    for (name, x, y) in [("n-2-3", 4., 0.), ("n-1-1", 2., -1.), ("n-3-2", 6., 0.5)] {
        near(d.nodes[name].center.x, x * CM, 1e-9);
        near(d.nodes[name].center.y, y * CM, 1e-9);
    }
    // The list macro is expanded before it is split, also in unbraced loops.
    let d = compile(
        r"\def\xs{1,...,3}\def\ys{0,2}
          \foreach \x in \xs \foreach \y in \ys \coordinate (g\x\y) at (\x,\y);",
    )
    .unwrap();
    assert_eq!(d.nodes.len(), 6);
    near(d.nodes["g32"].center.x, 3. * CM, 1e-9);
    assert_error_at(r"\foreach \x in \missing \node {\x};", 1, 1, "undefined");
    assert_error_at(
        r"\newcommand{\pair}[1]{#1,#1}\foreach \x in \pair \node {\x};",
        1,
        29,
        "takes arguments",
    );
}

#[test]
fn confusion_fixture_mixes_colours_from_computed_values() {
    let d = compile_fixture("ds-confusion.tikz");
    let cells = filled(&d.svg);
    assert_eq!(cells.len(), 9);
    assert_eq!(d.labels.iter().filter(|l| !l.is_empty()).count(), 9);
    assert_eq!(d.labels[0], "50");
    // TeX: \colorlet{c}{blue!100!white} -> rgb 0,0,1; blue!4!white -> rgb 0.96,0.96,1
    assert_eq!(cells[0].fill, "#0000ff");
    assert_eq!(cells[2].fill, "#f5f5ff");
    near(cells[2].x_range().0, 2., 1e-6);
    near(cells[2].y_range().1, 0., 1e-6);
    // The grid with its own options: the start point, then 4 + 4 lines.
    assert_eq!(stroked(&d.svg, "#000000").subpaths, 9);
}

fn rgb(hex: &str) -> [i32; 3] {
    [1, 3, 5].map(|i| i32::from_str_radix(&hex[i..i + 2], 16).unwrap())
}

#[test]
fn fractional_and_out_of_range_colour_percentages() {
    // TeX: blue!33.3333!white -> rgb 0.66667,0.66667,1
    let d = compile(r"\fill[blue!33.3333!white] (0,0) rectangle (1,1);").unwrap();
    for (channel, expected) in rgb(&filled(&d.svg)[0].fill)
        .into_iter()
        .zip([170, 170, 255])
    {
        assert!((channel - expected).abs() <= 1);
    }
    let d = compile(r"\def\p{12.5}\fill[red!\p!blue] (0,0) rectangle (1,1);").unwrap();
    for (channel, expected) in rgb(&filled(&d.svg)[0].fill).into_iter().zip([32, 0, 223]) {
        assert!((channel - expected).abs() <= 1);
    }
    // TeX: xcolor clamps without a message (blue!150!white -> rgb 0,0,1,
    // blue!-20!white -> rgb 1,1,1). A percentage outside 0..100 is almost
    // always a scaling mistake in a heat map, so it is refused instead.
    for percentage in ["150", "-20", "100.5"] {
        assert_error_at(
            &format!("\\fill[blue!{percentage}!white] (0,0) rectangle (1,1);"),
            1,
            1,
            "color percentage outside 0..100",
        );
    }
}

#[test]
fn inline_foreach_fixture_is_one_path() {
    let d = compile_fixture("ds-inline-foreach.tikz");
    let line = stroked(&d.svg, "#0000ff");
    assert_eq!(line.subpaths, 1);
    assert_eq!(line.points.len(), 4);
    for (point, (x, y)) in line
        .points
        .iter()
        .zip([(0., 0.), (1., 0.5), (2., 1.8), (3., 1.2)])
    {
        near(point.0, x, 1e-6);
        near(point.1, y, 1e-6);
    }
    assert_eq!(d.labels, ["0", "1", "2", "3"]);
}

#[test]
fn inline_foreach_scoping_nesting_and_options() {
    // The loop variable is restored after the loop, as for \foreach.
    let d =
        compile(r"\def\x{9}\draw[red] (0,0) foreach \x in {1,2} { -- (\x,1) } -- (\x,0);").unwrap();
    let line = stroked(&d.svg, "#ff0000");
    assert_eq!(line.points.len(), 4);
    near(line.points[3].0, 9., 1e-6);
    // Nested, with loop options, still one path; `foreach` in a label is text.
    let d = compile(
        r"\draw[red] (0,0) foreach \i [count=\c, evaluate=\i as \y using \i*\i] in {1,2}
            { foreach \j in {0,0.5} { -- (\c+\j,\y) } } node {foreach of};",
    )
    .unwrap();
    let line = stroked(&d.svg, "#ff0000");
    assert_eq!((line.subpaths, line.points.len()), (1, 5));
    near(line.points[4].0, 2.5, 1e-6);
    near(line.points[4].1, 4., 1e-6);
    assert_eq!(d.labels, ["foreach of"]);
    // Nodes in a loop, and a list macro.
    let d = compile(r"\def\xs{0,1,2}\path foreach \i in \xs { (\i,0) node (n\i) {\i} };").unwrap();
    near(d.nodes["n2"].center.x, 2. * CM, 1e-9);
    assert_error_at(
        "\\draw (0,0)\n  foreach \\x in {1,2} -- (\\x,0);",
        2,
        3,
        "braced body",
    );
    assert_error_at(
        r"\draw (0,0) foreach \x in {1,...,10001} { -- (\x,0) };",
        1,
        13,
        "10000",
    );
}

#[test]
fn conditional_fixture_highlights_by_threshold() {
    let d = compile_fixture("ds-conditional.tikz");
    // TeX: v=0.2 hl=0, v=0.7 hl=1, v=0.4 hl=0, v=0.9 hl=1
    assert_eq!(d.labels, ["0", "1", "0", "1"]);
    // \h = \v>0.5 ? 60 : 20 picks the tint (blue!60 / blue!20).
    let fills: Vec<String> = filled(&d.svg).into_iter().map(|p| p.fill).collect();
    assert_eq!(fills, ["#ccccff", "#6666ff", "#ccccff", "#6666ff"]);
}

#[test]
fn tex_conditional_fixture_picks_shape_and_colour() {
    let d = compile_fixture("ds-tex-conditional.tikz");
    assert_eq!(d.labels, ["1", "2", "3", "4"]);
    // v=0 outline; odd x a square, even x a circle; "red" above 50 (TeX:
    // blue!30 = #b3b3ff, red!80 = #ff3333, red!100 = #ff0000).
    let fills: Vec<String> = filled(&d.svg).into_iter().map(|p| p.fill).collect();
    assert_eq!(fills, ["#b3b3ff", "#ff3333", "#ff0000"]);
}

#[test]
fn tex_conditionals_choose_a_branch() {
    let labels = |source: &str| compile(source).unwrap().labels;
    assert_eq!(
        labels(
            r"\foreach \v in {1,2,3}{\ifnum\v>1 \node at (\v,0) {y};\else\node at (\v,0) {n};\fi}"
        ),
        ["n", "y", "y"]
    );
    assert_eq!(
        labels(r"\foreach \v in {1,...,4}{\ifodd\v \node at (\v,0) {o};\fi}"),
        ["o", "o"]
    );
    // Nested, with the inner \else and \fi skipped while choosing the outer branch.
    assert_eq!(
        labels(
            r"\foreach \i in {0,1}{\ifnum\i=0 \ifnum 1<2 \node at (\i,0) {a};\else\node{b};\fi\else\node at (\i,0) {c};\fi}"
        ),
        ["a", "c"]
    );
    assert_eq!(labels(r"\ifnum -2<-1 \node {neg};\fi"), ["neg"]);
    assert_eq!(
        labels(r"\newcommand{\at}[1]{\ifdim#1pt>1.5pt \node at (#1,0) {#1};\fi}\at{1}\at{2}"),
        ["2"]
    );
    // A branch may be part of a path.
    let d = compile(r"\draw (0,0) \ifnum 1=2 -- (0,1) \else -- (1,0) \fi;").unwrap();
    assert!(d.svg.contains("L 28.34646,-0.00000"), "{}", d.svg);
}

#[test]
fn tex_conditional_diagnostics() {
    assert_error_at(
        "\\node {a};\n\\ifnum 1>0 \\node {b};",
        2,
        1,
        "missing its \\fi",
    );
    assert_error_at("\\node {a};\n\\fi", 2, 1, "\\fi without \\ifnum");
    assert_error_at(
        r"\pgfmathsetmacro{\x}{1.5}\ifnum\x>1 \fi",
        1,
        26,
        "not an integer",
    );
    assert_error_at(r"\ifnum\nope>1 \fi", 1, 1, "not a defined value macro");
    assert_error_at(r"\ifnum 1 ~ 0 \fi", 1, 1, "expects '<', '=' or '>'");
    assert_error_at(r"\ifdim 1>0pt \fi", 1, 1, "need a unit");
    assert_error_at(r"\ifnum 1=1 \else \else \fi", 1, 1, "two \\else");
    assert_error_at(r"\def\fi{x}", 1, 1, "cannot redefine native command \\fi");
    // Other TeX conditionals stay unsupported.
    assert_error_at(
        r"\ifthenelse{1>0}{\node{a};}{}",
        1,
        1,
        "Unsupported command \\ifthenelse",
    );
    assert_error_at(r"\pgfmathsetmacro{\a}{1 > 0 ? 2}", 1, 1, "expected ':'");
}

#[test]
fn pgfmath_strings_choose_colours() {
    let fills = |source: &str| -> Vec<String> {
        filled(&compile(source).unwrap().svg)
            .into_iter()
            .map(|p| p.fill)
            .collect()
    };
    assert_eq!(
        fills(
            r#"\foreach \v in {0,1}{\pgfmathsetmacro{\c}{\v==1 ? "red" : "blue"}\fill[\c] (\v,0) circle (1);}"#
        ),
        ["#0000ff", "#ff0000"]
    );
    assert_eq!(
        fills(
            r#"\pgfmathparse{ifthenelse(0,"red","green!50!black")}\fill[\pgfmathresult] (0,0) circle (1);"#
        ),
        ["#008000"]
    );
    assert_error_at(
        r#"\pgfmathsetmacro{\a}{1+"x"}"#,
        1,
        1,
        "math string \"x\" used as a number",
    );
    assert_error_at(
        r#"\pgfmathtruncatemacro{\a}{1 ? "x" : "y"}"#,
        1,
        1,
        "used as a number",
    );
    assert_error_at(
        r#"\draw ({1 ? "a" : "b"},0) -- (1,1);"#,
        1,
        7,
        "used as a number",
    );
    assert_error_at(
        r#"\pgfmathsetmacro{\a}{1 ? "x}"#,
        1,
        1,
        "missing its closing",
    );
    // An unknown character is named instead of an empty symbol.
    assert_error_at(
        r"\pgfmathsetmacro{\a}{1 ? @ : 2}",
        1,
        1,
        "Unsupported math near '@ : 2'",
    );
}

#[test]
fn random_fixture_is_deterministic_per_seed() {
    let source = fixture("ds-random.tikz");
    let d = compile(&source).unwrap();
    assert_eq!(d.svg, compile(&source).unwrap().svg);
    let dots = filled(&d.svg);
    assert_eq!(dots.len(), 20);
    for dot in &dots {
        // 3*rnd in [0,3), rand in [-1,1], drawn with a 1pt radius.
        assert!(dot.x_range().0 > -0.05 && dot.x_range().1 < 3.05);
        assert!(dot.y_range().0 > -1.05 && dot.y_range().1 < 1.05);
    }
    let other = compile(&source.replace("{42}", "{43}")).unwrap();
    assert_ne!(d.svg, other.svg);
    // No seed: a fixed default, so a preview does not change on every render.
    let unseeded = source.replace(r"\pgfmathsetseed{42}", "");
    assert_eq!(
        compile(&unseeded).unwrap().svg,
        compile(&unseeded).unwrap().svg
    );
    // Reseeding replays the sequence, for math in coordinates as well.
    let d = compile(
        r"\pgfmathsetseed{7}\coordinate (a) at (rnd,rand);
          \pgfmathsetmacro{\u}{rnd}
          \pgfmathsetseed{7}\coordinate (b) at (rnd,rand);
          \pgfmathsetmacro{\v}{rnd}\coordinate (u) at (\u,0);\coordinate (v) at (\v,0);
          \coordinate (c) at ({random(3,5)},{random(2)});",
    )
    .unwrap();
    assert_eq!(d.nodes["a"].center, d.nodes["b"].center);
    assert_ne!(d.nodes["a"].center.x, d.nodes["a"].center.y);
    assert_eq!(d.nodes["u"].center, d.nodes["v"].center);
    let c = d.nodes["c"].center.x / CM;
    assert!((3. ..=5.).contains(&c.round()) && (c - c.round()).abs() < 1e-9);
    assert_error_at(r"\pgfmathsetseed{1.5}", 1, 1, "integer");
}
