//! Pseudocode (`algorithm` environments): rendering alone, inside a figure
//! through `algo=`, automatic placement, `ref=` markers and the linter.
mod common;
use common::*;
use tikzc::algo::Severity;

fn codes(diagram: &tikzc::Diagram) -> Vec<&'static str> {
    diagram.lints.iter().map(|l| l.code).collect()
}

fn algorithm(body: &str) -> String {
    format!(
        "\\begin{{algorithm}}[name=a]\n\\begin{{algorithmic}}\n{body}\n\\end{{algorithmic}}\n\\end{{algorithm}}\n"
    )
}

#[test]
fn pseudocode_only_file_renders_outlined_glyphs() {
    let d = compile_fixture("algo-quicksort.tikz");
    assert!(!d.svg.contains("<text"));
    check_references(&d.svg);
    assert!(d.lints.is_empty(), "{:?}", d.lints);
    // Wider than tall: 18 numbered lines at the natural width of the longest.
    assert!(d.width > 150. && d.width < 300., "{}", d.width);
    assert!(d.height > d.width, "{}x{}", d.width, d.height);
    assert!(d.editing["insertionOffset"].is_null());
    assert!(d.png(72.).is_ok());
}

#[test]
fn options_change_the_layout() {
    let base = tikzc::compile(&algorithm("\\IF{$x$}\n\\STATE $y$\n\\ENDIF")).unwrap();
    let no_end = tikzc::compile(&format!(
        "#| no-end: true\n{}",
        algorithm("\\IF{$x$}\n\\STATE $y$\n\\ENDIF")
    ))
    .unwrap();
    assert!(no_end.height < base.height);
    let numbered = tikzc::compile(&format!(
        "#| line-number: true\n{}",
        algorithm("\\IF{$x$}\n\\STATE $y$\n\\ENDIF")
    ))
    .unwrap();
    assert!(numbered.width > base.width);
    let scaled =
        tikzc::compile(&format!("#| algo-scale: 2\n{}", algorithm("\\STATE $y$"))).unwrap();
    let single = tikzc::compile(&algorithm("\\STATE $y$")).unwrap();
    near(
        scaled.width - 4. * 72. / 72.27,
        2. * (single.width - 4. * 72. / 72.27),
        1e-6,
    );
}

#[test]
fn figure_embeds_pseudocode_and_numbers_references() {
    let d = compile_fixture("algo-lasso.tikz");
    assert!(d.lints.is_empty(), "{:?}", d.lints);
    check_references(&d.svg);
    // The figure label carries the marker of the @ref line.
    assert!(d.labels.iter().any(|l| l == "頂点で接する"));
    // The pseudocode node starts at x = 4.5cm, right of the figure (x >= -2cm).
    assert!(d.width > 6.5 * CM + 150., "{}", d.width);
}

#[test]
fn two_file_form_reads_relative_to_the_input() {
    let source = fixture("algo-two-file.tikz");
    let d = tikzc::compile_at(
        &source,
        &mut tikzc::text::TextEngine::new(),
        Some(&fixtures()),
    )
    .unwrap();
    assert!(d.lints.is_empty(), "{:?}", d.lints);
    let error = tikzc::compile_at(
        &source,
        &mut tikzc::text::TextEngine::new(),
        Some(&fixtures().join("missing")),
    )
    .err()
    .unwrap();
    assert!(
        error.message.starts_with("[algo-name-missing]"),
        "{}",
        error.message
    );
    assert_eq!((error.line, error.column), (6, 9));
    // Through the CLI, relative to the input file.
    let result = check(&fixture_path("algo-two-file.tikz"));
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn automatic_layout_fills_the_canvas() {
    let d = compile_fixture("algo-lasso-auto.tikz");
    assert!(d.lints.is_empty(), "{:?}", d.lints);
    near(d.width, 1200., 1e-6);
    near(d.height, 675., 1e-6);
    // 1600x900 px at 96 dpi.
    let png = d.png(96.).unwrap();
    let pixmap = resvg::tiny_skia::Pixmap::decode_png(&png).unwrap();
    assert_eq!((pixmap.width(), pixmap.height()), (1600, 900));
    // The editor maps figure coordinates through the viewBox.
    let view = &d.editing["viewBox"];
    near(
        view[2].as_f64().unwrap() / view[3].as_f64().unwrap(),
        1600. / 900.,
        1e-9,
    );
    for side in ["algo-right", "algo-top", "algo-bottom"] {
        let source = fixture("algo-lasso-auto.tikz").replace(
            "#| canvas: 1600x900",
            &format!("#| canvas: 1600x900\n#| layout: {side}"),
        );
        let d = tikzc::compile(&source).unwrap();
        assert!(d.lints.is_empty(), "{side}: {:?}", d.lints);
    }
}

#[test]
fn linter_reports_located_fixes() {
    let source = format!(
        "#| layout: algo-right\n#| canvas: 400x300\n#| algo-shift: (0, 500)\n#| paper: arXiv:1\n{}\\begin{{tikzpicture}}\n\\node[ref=nothing] at (0,0) {{x}};\n\\end{{tikzpicture}}\n",
        algorithm("\\STATE $x \\gets 1$\n\\IF{$x$} % @ref missing\n\\ENDIF")
    );
    let d = tikzc::compile(&source).unwrap();
    assert_eq!(
        codes(&d),
        [
            "algo-out-of-canvas",
            "src-unsourced",
            "src-unsourced",
            "explain-missing",
            "ref-dangling",
            "ref-unused"
        ]
    );
    let dangling = d.lints.iter().find(|l| l.code == "ref-dangling").unwrap();
    assert_eq!(dangling.severity, Severity::Error);
    assert!(dangling.message.contains("\\node[ref=missing]"));
    // `check` fails on lint errors and prints file:line:column.
    let dir = scratch("algo-lint");
    let path = dir.join("lint.tikz");
    std::fs::write(&path, &source).unwrap();
    let result = check(&path);
    assert_eq!(result.status.code(), Some(3));
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(
        stderr.contains("lint.tikz:8:12: error[ref-dangling]"),
        "{stderr}"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn overlap_conflict_and_unplaced_lints() {
    let figure = "\\begin{tikzpicture}\\draw (0,0) rectangle (3,3);\\end{tikzpicture}\n";
    let overlap = tikzc::compile(&format!(
        "#| algo-shift: (60, 0)\n{}{figure}",
        algorithm("\\STATE x")
    ))
    .unwrap();
    assert_eq!(codes(&overlap), ["algo-overlap"]);
    let conflict = tikzc::compile(&format!(
        "#| layout: algo-top\n{}{}\\begin{{tikzpicture}}\\node[algo=a] {{}};\\end{{tikzpicture}}",
        algorithm("\\STATE x"),
        algorithm("\\STATE y").replace("name=a", "name=b")
    ))
    .unwrap();
    assert_eq!(codes(&conflict), ["layout-conflict", "algo-unplaced"]);
}

#[test]
fn syntax_errors_point_at_the_source() {
    assert_error_at(
        &algorithm("\\IF{x}\n\\STATE y"),
        3,
        1,
        "[algo-unbalanced] \\IF is never closed",
    );
    assert_error_at(
        &algorithm("\\STATE y\n\\ENDFOR"),
        4,
        1,
        "[algo-unbalanced] \\ENDFOR without \\FOR",
    );
    assert_error_at(&algorithm("\\STATEX y"), 3, 1, "[algo-unknown-cmd]");
    assert_error_at(
        &algorithm("\\STATE y % @src impl=a.py"),
        3,
        12,
        "[src-bad-format]",
    );
    assert_error_at(
        &algorithm("\\STATE y % @src impl=a.py:3"),
        3,
        12,
        "[impl-no-rev]",
    );
    assert_error_at(
        &format!("#| impl: o/r\n{}", algorithm("\\STATE y")),
        1,
        1,
        "[impl-no-rev]",
    );
    assert_error_at(
        &format!("#| layout: middle\n{}", algorithm("\\STATE y")),
        1,
        1,
        "layout must be",
    );
    assert_error_at(
        "\\begin{tikzpicture}\\node[algo=zzz] {};\\end{tikzpicture}",
        1,
        26,
        "[algo-name-missing]",
    );
    assert_error_at(
        &algorithm("\\STATE \\unknowncommand"),
        1,
        1,
        "Unsupported text command",
    );
}

#[test]
fn files_without_pseudocode_are_unchanged() {
    // `algo`/`ref` are node keys only; scope options do not reach nodes.
    let d = tikzc::compile(
        "\\begin{tikzpicture}[every node/.style={ref=x}]\\node {a};\\end{tikzpicture}",
    )
    .unwrap();
    assert_eq!(codes(&d), ["ref-unused"]);
    let d = tikzc::compile("\\begin{tikzpicture}\\node {a};\\end{tikzpicture}").unwrap();
    assert!(d.lints.is_empty());
}

#[test]
fn algo_node_font_sets_the_pseudocode_size() {
    let width = |font: &str| {
        let source = format!(
            "{}\\begin{{tikzpicture}}\\node[algo=a{font}] {{}};\\end{{tikzpicture}}\n",
            algorithm("\\STATE $x \\gets 1$")
        );
        tikzc::compile(&source).unwrap().width
    };
    let normal = width("");
    let half = width(", font={\\fontsize{5}{6}\\selectfont}");
    // Padding and rules do not scale with the text.
    assert!((0.5..0.65).contains(&(half / normal)), "{half} / {normal}");
}

#[test]
fn pseudocode_lines_are_nodes_for_routed_arrows() {
    let source = format!(
        "{}\\begin{{tikzpicture}}\n\\coordinate (c) at (0,0);\n\\node[algo=a, algo-focus={{2,corner}}, anchor=north west] (A) at (3,2) {{}};\n\\draw[->, rounded corners] (A-corner.west) -| (c);\n\\draw[->] (A-1.west) to[bend right] (c);\n\\end{{tikzpicture}}\n",
        algorithm("\\STATE $a$\n\\STATE $b$\n\\STATE $c$ % @ref corner\n% @explain here")
    );
    let d = tikzc::compile(&source).unwrap();
    // Using the line node links the @ref line to the figure.
    assert!(d.lints.is_empty(), "{:?}", d.lints);
    let algo = &d.nodes["A"];
    let lines: Vec<_> = (1..=3).map(|n| &d.nodes[&format!("A-{n}")]).collect();
    // Lines span the pseudocode width, top to bottom, inside the node.
    for (i, line) in lines.iter().enumerate() {
        near(line.center.x, lines[0].center.x, 1e-9);
        assert!(line.center.x - line.width / 2. >= algo.center.x - algo.width / 2.);
        assert!(line.center.x + line.width / 2. <= algo.center.x + algo.width / 2.);
        assert!(line.height > 5. && line.height < 20., "{}", line.height);
        assert!(line.center.y < algo.center.y + algo.height / 2.);
        if i > 0 {
            near(lines[i - 1].center.y - line.center.y, line.height, 0.5);
        }
    }
    near(d.nodes["A-corner"].center.y, lines[2].center.y, 1e-9);
    // Focused lines are filled with the default focus colour (orange!20).
    assert_eq!(
        d.svg.matches("fill=\"#ffe6cc\"").count(),
        2,
        "{}",
        d.svg.len()
    );
    assert_error_at(
        &source.replace("algo-focus={2,corner}", "algo-focus={9}"),
        11,
        15,
        "algo-focus: no line '9'",
    );
}

#[test]
fn arrows_fixture_links_lines_to_the_figure() {
    let d = compile_fixture("algo-arrows.tikz");
    assert!(d.lints.is_empty(), "{:?}", d.lints);
    check_references(&d.svg);
    for name in ["A", "A-2", "A-5", "A-start", "A-sparse-corner"] {
        assert!(d.nodes.contains_key(name), "{name}");
    }
    near(d.nodes["A-start"].center.y, d.nodes["A-2"].center.y, 1e-9);
    near(
        d.nodes["A-sparse-corner"].center.y,
        d.nodes["A-5"].center.y,
        1e-9,
    );
}

#[test]
fn arrows_fixture_fits_a_canvas() {
    let natural = compile_fixture("algo-arrows.tikz");
    let d = compile_fixture("algo-arrows-canvas.tikz");
    // `canvas` with an `algo=` node is not a layout conflict.
    assert!(d.lints.is_empty(), "{:?}", d.lints);
    check_references(&d.svg);
    near(d.width, 1200., 1e-6);
    near(d.height, 675., 1e-6);
    let png = d.png(96.).unwrap();
    let pixmap = resvg::tiny_skia::Pixmap::decode_png(&png).unwrap();
    assert_eq!((pixmap.width(), pixmap.height()), (1600, 900));
    // Figure coordinates are kept (line nodes and all), only the view grows.
    for name in ["A", "A-2", "A-sparse-corner"] {
        near(d.nodes[name].center.x, natural.nodes[name].center.x, 1e-9);
        near(d.nodes[name].center.y, natural.nodes[name].center.y, 1e-9);
    }
    let view = &d.editing["viewBox"];
    let natural_view = &natural.editing["viewBox"];
    near(
        view[2].as_f64().unwrap() / view[3].as_f64().unwrap(),
        1600. / 900.,
        1e-9,
    );
    // Fitted to the height and centred horizontally around the figure.
    near(
        view[3].as_f64().unwrap(),
        natural_view[3].as_f64().unwrap(),
        1e-6,
    );
    let centre = |v: &serde_json::Value| v[0].as_f64().unwrap() + v[2].as_f64().unwrap() / 2.;
    near(centre(view), centre(natural_view), 1e-6);
}

#[test]
fn step_by_step_boxes_hold_one_algorithm_each() {
    let d = compile_fixture("algo-steps.tikz");
    assert!(d.lints.is_empty(), "{:?}", d.lints);
    check_references(&d.svg);
    let steps: Vec<_> = ["S1", "S2", "S3"].iter().map(|n| &d.nodes[*n]).collect();
    // Boxes left to right with tops aligned, 1.6cm apart.
    for pair in steps.windows(2) {
        let top = |n: &tikzc::render::Node| n.center.y + n.height / 2.;
        near(top(pair[0]), top(pair[1]), 1e-6);
        let gap = (pair[1].center.x - pair[1].width / 2.) - (pair[0].center.x + pair[0].width / 2.);
        // Anchors include the default outer sep (half the 0.4pt line width).
        near(gap, 1.6 * CM + 0.4 * 72. / 72.27, 1e-6);
    }
    // Line nodes lie inside their box and span the ruled body, which is
    // narrower than a box widened by its explanation list.
    for (step, lines) in [("S1", 6), ("S2", 7), ("S3", 5)] {
        let node = &d.nodes[step];
        for n in 1..=lines {
            let line = &d.nodes[&format!("{step}-{n}")];
            assert!(line.center.x - line.width / 2. > node.center.x - node.width / 2.);
            assert!(line.center.x + line.width / 2. < node.center.x + node.width / 2.);
            assert!((line.center.y - node.center.y).abs() < node.height / 2.);
        }
        assert!(!d.nodes.contains_key(&format!("{step}-{}", lines + 1)));
    }
    assert!(d.nodes["S1-1"].width < d.nodes["S1"].width - 20.);
    near(
        d.nodes["S1-scaled"].center.y,
        d.nodes["S1-5"].center.y,
        1e-9,
    );
    near(
        d.nodes["S2-support"].center.y,
        d.nodes["S2-6"].center.y,
        1e-9,
    );
}
