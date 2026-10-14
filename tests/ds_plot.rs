//! Function plots (F1), path intersections (F8) and plot marks for
//! data-science diagrams; `plot file` (F13) is deliberately a diagnostic. Reference values marked "TeX" were printed by
//! lualatex with PGF 3.1.10; no test runs TeX.
mod common;
use common::*;
use tikzc::compile;

#[test]
fn gaussian_fixture_samples_endpoints_and_values() {
    let d = compile_fixture("ds-gaussian.tikz");
    // Without `smooth`: exactly `samples` points joined by lines.
    let sigmoid = stroked(&d.svg, "#ff0000");
    assert_eq!(sigmoid.points.len(), 61);
    near(sigmoid.points[0].0, -3., 1e-6);
    near(sigmoid.points[60].0, 3., 1e-6);
    near(sigmoid.points[30].1, 0.5, 1e-6);
    near(sigmoid.points[60].1, 1. / (1. + (-6f64).exp()), 1e-6);
    // `smooth` keeps the 121 samples as curve end points.
    let gaussian = stroked(&d.svg, "#0000ff");
    assert_eq!(gaussian.points.len(), 121);
    near(gaussian.points[0].0, -3., 1e-6);
    near(gaussian.points[120].0, 3., 1e-6);
    near(gaussian.points[60].0, 0., 1e-6);
    // 2.5/sqrt(2 pi); TeX: \pgfmathparse{2.5*exp(-(0)*(0)/2)/sqrt(2*pi)} = 0.99738
    near(gaussian.points[60].1, 0.99736, 0.01);
    // variable=\t with the radian suffix: a unit circle.
    let circle = stroked(&d.svg, "#008000");
    assert_eq!(circle.points.len(), 50);
    for (x, y) in &circle.points {
        near(x.hypot(*y), 1., 0.01);
    }
    near(circle.points[0].0, 1., 1e-6);
}

#[test]
fn plot_defaults_are_pgfs() {
    // tikz.code.tex: \def\tikz@plot@samples{25}, \def\tikz@plot@domain{-5:5}
    let d = compile(r"\draw[red] plot (\x,{\x/5});").unwrap();
    let line = stroked(&d.svg, "#ff0000");
    assert_eq!(line.points.len(), 25);
    near(line.points[0].0, -5., 1e-6);
    near(line.points[24].0, 5., 1e-6);
    near(line.points[24].1, 1., 1e-6);
    // Options on the plot itself, a polar expression and `--plot`.
    let d = compile(r"\draw[red] (0,0) -- plot[domain=0:90,samples=4] (\x:2);").unwrap();
    let arc = stroked(&d.svg, "#ff0000");
    assert_eq!(arc.points.len(), 5);
    near(arc.points[4].1, 2., 1e-6);
}

#[test]
fn negative_variable_values_keep_pgf_precedence() {
    // TeX: \pgfmathparse{--3*-3} = -9.0 and \pgfmathparse{-(-3)*(-3)} = -9.0,
    // which is what `-\x*\x` and `-(\x)*(\x)` become for \x = -3.
    for expression in [r"-\x*\x", r"-(\x)*(\x)"] {
        let d = compile(&format!(
            r"\draw[red,domain=-3:3,samples=3] plot (\x,{{{expression}}});"
        ))
        .unwrap();
        let curve = stroked(&d.svg, "#ff0000");
        near(curve.points[0].1, -9., 1e-6);
        near(curve.points[1].1, 0., 1e-6);
        near(curve.points[2].1, -9., 1e-6);
    }
}

#[test]
fn plot_limits_and_unsupported_variants_are_located() {
    // PGF raises samples=1 to 2 (max(2,#1)); a single sample is refused here.
    assert_error_at(r"\draw[samples=1] plot (\x,\x);", 1, 7, "samples");
    // Bounded expansion: the limit shared with loops and plot coordinates.
    assert_error_at(r"\draw[samples=100000] plot (\x,\x);", 1, 7, "10000");
    assert_error_at(r"\draw[samples=2.5] plot (\x,\x);", 1, 7, "integer");
    // ln(0) is not finite; the diagnostic points at the plot.
    assert_error_at(
        "\\draw[domain=0:1]\n  plot (\\x,{ln(\\x)});",
        2,
        3,
        "non-finite",
    );
    assert_error_at(r"\draw[domain=0] plot (\x,\x);", 1, 7, "domain");
    assert_error_at(r"\draw[variable=t] plot (\x,\x);", 1, 7, "variable");
    // gnuplot is never run.
    assert_error_at(r"\draw (0,0) -- plot function{x**2};", 1, 13, "gnuplot");
    assert_error_at(r"\draw plot[id=x] function{x};", 1, 12, "id");
}

#[test]
fn intersections_fixture_matches_tex() {
    let d = compile_fixture("ds-intersections.tikz");
    // TeX: intersection-1 = (56.90549pt, 28.45274pt) = (2cm, 1cm). The second
    // computation reuses the name, so read the first from its red dot.
    let dot = drawn(&d.svg)
        .into_iter()
        .find(|p| p.fill == "#ff0000")
        .unwrap();
    near((dot.x_range().0 + dot.x_range().1) / 2. * CM, 2. * CM, 0.01);
    near((dot.y_range().0 + dot.y_range().1) / 2. * CM, CM, 0.01);
    assert_eq!(d.nodes["intersection-1"].center, d.nodes["p"].center);
    // TeX: p = (46.82611pt, 25.68816pt); exact x = sqrt(7) - 1.
    let p = d.nodes["p"].center;
    near(p.x / CM, 7f64.sqrt() - 1., 0.01);
    near(p.y / CM, 0.9028, 0.01);
    near(p.x / CM, 46.82611 / TEX_PT_PER_CM, 0.01);
    near(p.y / CM, 25.68816 / TEX_PT_PER_CM, 0.01);
    // The fixture written before the feature existed renders now.
    compile(&fixture("unsupported-intersections.tikz")).unwrap();
}

#[test]
fn intersection_total_names_and_order() {
    // `total` is usable in the labels and coordinates of the same path.
    let d = compile(
        r"\draw[name path=A] (0,0) -- (4,2);
          \draw[name path=B] (0,2) -- (4,0);
          \path[name intersections={of=A and B, total=\t, name=i, by={x}}]
            (i-1) node {\t} (\t,0) coordinate (c);",
    )
    .unwrap();
    assert_eq!(d.labels, ["1"]);
    near(d.nodes["x"].center.x, 2. * CM, 0.01);
    near(d.nodes["x"].center.y, CM, 0.01);
    near(d.nodes["c"].center.x, CM, 1e-6);
    // TeX order for a circle and a line, both ways round:
    // intersection-1 = (24.65pt, 14.22pt), intersection-2 = (-24.65pt, 14.22pt).
    for of in ["E and F", "F and E"] {
        let d = compile(&format!(
            r"\draw[name path=E] (0,0) circle (1);
              \draw[name path=F] (-2,0.5) -- (2,0.5);
              \path[name intersections={{of={of}}}];"
        ))
        .unwrap();
        near(
            d.nodes["intersection-1"].center.x / CM,
            0.75f64.sqrt(),
            0.01,
        );
        near(
            d.nodes["intersection-2"].center.x / CM,
            -(0.75f64.sqrt()),
            0.01,
        );
        near(d.nodes["intersection-2"].center.y / CM, 0.5, 0.01);
        assert!(!d.nodes.contains_key("intersection-3"));
    }
    // TeX order for a zigzag and a line drawn right to left: x = 0.5, 1.5, 2.5 cm.
    for of in ["G and H", "H and G"] {
        let d = compile(&format!(
            r"\draw[name path=G] (0,0) -- (1,2) -- (2,0) -- (3,2);
              \draw[name path=H] (3,1) -- (0,1);
              \path[name intersections={{of={of}}}];"
        ))
        .unwrap();
        for (i, x) in [0.5, 1.5, 2.5].into_iter().enumerate() {
            near(
                d.nodes[&format!("intersection-{}", i + 1)].center.x / CM,
                x,
                1e-4,
            );
        }
    }
    // Rectangles and closed paths take part with all four sides.
    let d = compile(
        r"\draw[name path=R] (0,0) rectangle (2,2);
          \draw[name path=L] (-1,1) -- (3,1);
          \path[name intersections={of=R and L, total=\n}] node {\n};",
    )
    .unwrap();
    assert_eq!(d.labels, ["2"]);
}

#[test]
fn missing_intersections_and_unsupported_options_are_diagnostics() {
    // No intersection: the reference fails where it is written.
    assert_error_at(
        "\\draw[name path=A] (0,0) -- (1,0);\n\\draw[name path=B] (0,1) -- (1,1);\n\\fill[name intersections={of=A and B}]\n  (intersection-1) circle (2pt);",
        4,
        3,
        "intersection-1",
    );
    // A name left by an earlier computation is not reused silently.
    assert!(
        compile(
            r"\draw[name path=A] (0,0) -- (2,2);
              \draw[name path=B] (0,2) -- (2,0);
              \draw[name path=C] (0,5) -- (2,5);
              \path[name intersections={of=A and B}];
              \path[name intersections={of=A and C}];
              \fill (intersection-1) circle (2pt);"
        )
        .is_err()
    );
    let paths = "\\draw[name path=A] (0,0) -- (1,1);\n\\draw[name path=B] (0,1) -- (1,0);\n";
    assert_error_at(
        &format!("{paths}\\path[name intersections={{of=A and B, sort by=A}}];"),
        3,
        7,
        "sort by",
    );
    assert_error_at(
        &format!("{paths}\\path[name intersections={{of=A and Z}}];"),
        3,
        7,
        "unknown named path 'Z'",
    );
    assert_error_at(
        &format!("{paths}\\path[name intersections={{by=p}}];"),
        3,
        7,
        "requires of",
    );
}

/// The `*` mark is a circle of `mark size` (2pt) starting at its east point.
const MARK: f64 = 2. * 72. / 72.27;

#[test]
fn plot_marks_subset() {
    let d = compile(
        r"\draw[red,mark=*] plot coordinates {(0,0) (1,1)};
          \draw[only marks,mark=o] plot coordinates {(0,0)};
          \draw[only marks,mark=x,mark size=4bp] plot coordinates {(0,0) (1,0)};
          \draw[only marks,mark=+] plot[domain=0:1,samples=3] (\x,0);",
    )
    .unwrap();
    let paths = drawn(&d.svg);
    assert_eq!(paths.len(), 5);
    // The line, then its marks, filled with the path colour.
    assert_eq!(paths[0].points.len(), 2);
    assert_eq!((paths[1].subpaths, paths[1].fill.as_str()), (2, "#ff0000"));
    assert_eq!((paths[2].subpaths, paths[2].fill.as_str()), (1, "none"));
    // pgflibraryplothandlers: the x mark spans 0.7071 * mark size diagonally.
    assert_eq!(paths[3].subpaths, 4);
    near(paths[3].points[0].0 * CM, -4. * 0.5f64.sqrt(), 1e-4);
    assert_eq!(paths[4].subpaths, 6);
    near(paths[4].points[0].0 * CM, -MARK, 1e-4);
    assert_error_at(
        r"\draw[only marks,mark=square*] plot coordinates {(0,0)};",
        1,
        18,
        "Unsupported plot mark",
    );
    assert_error_at(
        r"\draw[only marks] plot coordinates {(0,0)};",
        1,
        7,
        "only marks needs a mark",
    );
}

#[test]
fn plot_file_is_refused_without_reading_anything() {
    // A diagram never reads other files (ARCHITRECTURE.md, Article 3), so
    // `plot file` is a diagnostic whether or not the file exists.
    let dir = scratch("plotfile");
    std::fs::write(dir.join("data.dat"), "0 0\n1 1\n").unwrap();
    let input = dir.join("input.tikz");
    for file in ["data.dat", "missing.dat", "/etc/hostname"] {
        std::fs::write(
            &input,
            format!("\\begin{{tikzpicture}}\n  \\draw[only marks, mark=*] plot file {{{file}}};\n\\end{{tikzpicture}}\n"),
        )
        .unwrap();
        let result = check(&input);
        let stderr = String::from_utf8_lossy(&result.stderr);
        assert_eq!(result.status.code(), Some(3), "{file}: {stderr}");
        assert!(
            stderr.contains("input.tikz:2:29: Unsupported plot file"),
            "{stderr}"
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}
