//! Grid positioning (F5), unit vectors and 3D coordinates (F7) and marks
//! along a path (F10). Reference values marked "TeX" were printed by
//! lualatex with PGF 3.1.10 (`\pgfpointanchor{name}{center}`, in TeX pt);
//! no test runs TeX.
mod common;
use common::*;
use tikzc::compile;

/// A TeX reference position in pt against a node centre in bp.
fn at_tex_pt(d: &tikzc::Diagram, name: &str, x: f64, y: f64) {
    let center = d.nodes[name].center;
    near(center.x, x * 72. / 72.27, 0.01);
    near(center.y, y * 72. / 72.27, 0.01);
}

#[test]
fn dag_fixture_places_centres_on_the_grid() {
    let d = compile_fixture("ds-dag.tikz");
    // TeX: X = (0,0), Y = (56.9055pt, 0), Z = (0, -56.9055pt): 2 cm between
    // centres, whatever the node sizes.
    near(d.nodes["X"].center.x, 0., 1e-9);
    near(d.nodes["Y"].center.x, 2. * CM, 1e-9);
    near(d.nodes["Y"].center.y, 0., 1e-9);
    near(d.nodes["Z"].center.x, 0., 1e-9);
    near(d.nodes["Z"].center.y, -2. * CM, 1e-9);
    at_tex_pt(&d, "Y", 56.9055, 0.);
    at_tex_pt(&d, "Z", 0., -56.9055);
    // Three arrows and the dashed bend, each with tips.
    assert_eq!(d.svg.matches("stroke-dasharray").count(), 1);
    assert!(d.svg.contains(" C "));
}

#[test]
fn on_grid_distances_and_diagonals_match_tex() {
    let d = compile(
        r"\begin{tikzpicture}[node distance=2cm, on grid,
                              var/.style={circle,draw,minimum size=8mm}]
          \node[var] (X) {$X$};
          \node[var, above right=of X] (D) {$D$};
          \node[var, below left=1cm and 3cm of X] (E) {$E$};
          \node[var, above left=1.5cm of X] (F) {$F$};
          \node[var, on grid=false, right=of X, inner sep=0, outer sep=0] (O) {};
        \end{tikzpicture}",
    )
    .unwrap();
    // TeX: D = (40.2383pt, 40.2383pt): one distance for a diagonal is
    // measured along it (2cm / sqrt 2 per axis).
    at_tex_pt(&d, "D", 40.2383, 40.2383);
    // TeX: E = (-85.35826pt, -28.45274pt): "vertical and horizontal".
    at_tex_pt(&d, "E", -85.35826, -28.45274);
    at_tex_pt(&d, "F", -30.17873, 30.17873);
    // Switched off again, the distance is between borders.
    let x = &d.nodes["X"];
    let o = &d.nodes["O"];
    near(
        (o.center.x - o.width / 2.) - (x.center.x + x.width / 2. + x.outer_xsep),
        2. * CM,
        1e-6,
    );
    // TeX: node distance=2cm and 1cm, on grid:
    // right = (28.45274pt, 0), below = (0, -56.9055pt), above right = (28.45274pt, 56.9055pt)
    let d = compile(
        r"\begin{tikzpicture}[node distance=2cm and 1cm, on grid]
          \node (X) {}; \node[right=of X] (Y) {}; \node[below=of X] (Z) {};
          \node[above right=of X] (D) {};
        \end{tikzpicture}",
    )
    .unwrap();
    at_tex_pt(&d, "Y", 28.45274, 0.);
    at_tex_pt(&d, "Z", 0., -56.9055);
    at_tex_pt(&d, "D", 28.45274, 56.9055);
}

#[test]
fn off_grid_distances_are_between_borders() {
    // Regression for the default: TeX with 8mm circles, inner/outer sep 0:
    // Y = (79.66768pt, 0), D = (56.3336pt, 56.3336pt),
    // E = (-101.45357pt, -44.54805pt), F = (-46.27403pt, 46.27403pt)
    let d = compile(
        r"\begin{tikzpicture}[node distance=2cm,
            var/.style={circle,draw,minimum size=8mm,inner sep=0,outer sep=0}]
          \node[var] (X) {};
          \node[var, right=of X] (Y) {};
          \node[var, above right=of X] (D) {};
          \node[var, below left=1cm and 3cm of X] (E) {};
          \node[var, above left=1.5cm of X] (F) {};
        \end{tikzpicture}",
    )
    .unwrap();
    at_tex_pt(&d, "Y", 79.66768, 0.);
    at_tex_pt(&d, "D", 56.3336, 56.3336);
    at_tex_pt(&d, "E", -101.45357, -44.54805);
    at_tex_pt(&d, "F", -46.27403, 46.27403);
}

#[test]
fn fit_on_grid_and_invalid_grid_options() {
    // TeX: a fit node is the same with or without on grid:
    // F.center = (28.45274pt, 0) for X at 0 and Y at 56.9055pt.
    let d = compile(
        r"\begin{tikzpicture}[node distance=2cm, on grid,
            every node/.style={draw,minimum size=8mm,inner sep=2pt,outer sep=0}]
          \node (X) {}; \node[right=of X] (Y) {}; \node[fit=(X)(Y)] (F) {};
        \end{tikzpicture}",
    )
    .unwrap();
    at_tex_pt(&d, "F", 28.45274, 0.);
    // Placing the fit node itself relative to another node on the grid is
    // a special case in PGF and is not implemented.
    assert_error_at(
        "\\begin{tikzpicture}[on grid]\n\\node (X) {}; \\node[right=of X] (Y) {};\n\\node[fit=(X)(Y), right=of Y] (G) {};\n\\end{tikzpicture}",
        3,
        7,
        "Unsupported fit",
    );
    assert_error_at(
        "\\begin{tikzpicture}[node distance=2cm,\n  on grids]\n\\end{tikzpicture}",
        2,
        3,
        "Unsupported option 'on grids'",
    );
}

/// The end point of the only drawn line, in cm.
fn line_end(source: &str) -> (f64, f64) {
    let d = compile(source).unwrap_or_else(|e| panic!("{source}: {e}"));
    *drawn(&d.svg)[0].points.last().unwrap()
}

#[test]
fn unit_vector_fixtures_match_tex() {
    // TeX: x=0.5cm, y=2cm: (4,1) = (56.90546pt, 56.9055pt) = (2cm, 2cm)
    let end = line_end(&fixture("ds-scale.tikz"));
    near(end.0, 2., 1e-6);
    near(end.1, 2., 1e-6);
    // TeX: default z: (0,0,1) = (-10.95415pt, -10.95415pt) = -3.85mm each
    let end = line_end(&fixture("ds-3d.tikz"));
    near(end.0, -0.385, 1e-6);
    near(end.1, -0.385, 1e-6);
    // TeX: z={(-0.5cm,-0.3cm)}: (1,1,1) = (14.22638pt, 19.91684pt)
    let end = line_end(&fixture("ds-3d-vectors.tikz"));
    near(end.0, 0.5, 1e-6);
    near(end.1, 0.7, 1e-6);
}

#[test]
fn unit_vectors_scale_only_unitless_components() {
    // TeX with x=0.5cm, y=2cm:
    //   (1cm,1cm) = (28.45274pt, 28.45274pt)   (30:2) = (24.64085pt, 56.9055pt)
    //   (1,1cm)   = (14.22636pt, 28.45274pt)
    let d = compile(
        r"\begin{tikzpicture}[x=0.5cm, y=2cm]
          \coordinate (b) at (1cm,1cm); \coordinate (c) at (30:2);
          \coordinate (d) at (1,1cm); \coordinate (e) at (30:1cm);
          \draw (0,0) -- ++(2,1) coordinate (r) circle (1);
          \begin{scope}[x=1cm] \coordinate (s) at (1,1); \end{scope}
          \coordinate (z) at (1,1,1);
        \end{tikzpicture}
        \begin{tikzpicture} \coordinate (after) at (1,1); \end{tikzpicture}",
    )
    .unwrap();
    at_tex_pt(&d, "b", 28.45274, 28.45274);
    at_tex_pt(&d, "c", 24.64085, 56.9055);
    at_tex_pt(&d, "d", 14.22636, 28.45274);
    near(d.nodes["e"].center.x, 30f64.to_radians().cos() * CM, 1e-9);
    // Relative moves follow the unit vectors; scopes restore them.
    near(d.nodes["r"].center.x, CM, 1e-9);
    near(d.nodes["r"].center.y, 2. * CM, 1e-9);
    near(d.nodes["s"].center.x, CM, 1e-9);
    near(d.nodes["s"].center.y, 2. * CM, 1e-9);
    near(d.nodes["z"].center.x, 0.5 * CM - 0.385 * CM, 1e-9);
    near(d.nodes["after"].center.x, CM, 1e-9);
    // A unitless circle radius follows both axes: an ellipse 1cm by 4cm.
    let circle = &drawn(&d.svg)[0];
    near(circle.x_range().1 - 1., 0.5, 1e-6);
    near(circle.y_range().1 - 2., 2., 1e-6);
    // z as a length is (z, z), as in PGF's \tikz@handle@z.
    near(line_end(r"\draw[z=1cm] (0,0,0) -- (0,0,2);").1, 2., 1e-6);
}

#[test]
fn radius_options_preserve_explicit_units_under_axis_scaling() {
    for axes in ["x=0.5cm,y=2cm", "x={(1cm,1cm)},y={(1cm,2cm)}"] {
        for (options, legacy) in [
            ("circle[radius=1cm]", "circle (1cm)"),
            (
                "ellipse[x radius=1cm,y radius=2cm]",
                "ellipse (1cm and 2cm)",
            ),
            (
                "arc[start angle=0,end angle=90,radius=1cm]",
                "arc (0:90:1cm)",
            ),
        ] {
            let source = |shape: &str| format!(r"\draw[{axes}] (0,0) {shape};");
            let a = compile(&source(options)).unwrap();
            let b = compile(&source(legacy)).unwrap();
            assert_eq!(drawn(&a.svg)[0].points, drawn(&b.svg)[0].points);
        }
    }
    let d = compile(r"\draw[x=0.5cm,y=2cm] (0,0) ellipse[radius=1cm,y radius=2];").unwrap();
    let p = &drawn(&d.svg)[0];
    near(p.x_range().1, 1., 1e-6);
    near(p.y_range().1, 4., 1e-6);
}

#[test]
fn unsupported_unit_vector_combinations_are_diagnostics() {
    assert_error_at(
        "\\begin{tikzpicture}[x={(1cm,1cm)}]\n\\draw (0,0) circle (1);\n\\end{tikzpicture}",
        2,
        13,
        "skewed",
    );
    assert_error_at(
        "\\begin{tikzpicture}[y=2cm]\n\\draw (0,0) grid (1,1);\n\\end{tikzpicture}",
        2,
        13,
        "Unsupported grid",
    );
    assert_error_at(r"\draw[x=2cm,shift={(1,1)}] (0,0) -- (1,0);", 1, 1, "shift");
    assert_error_at(r"\draw[x={(1cm)}] (0,0) -- (1,0);", 1, 7, "unit vector");
    assert_error_at(
        "\\begin{tikzpicture}[scale=2,\n  z=wide]\n\\end{tikzpicture}",
        2,
        3,
        "unit vector",
    );
    assert_error_at(r"\draw (0,0,1cm) -- (1,0);", 1, 7, "z coordinate");
    assert_error_at(r"\draw (0,0,0,0) -- (1,0);", 1, 7, "unknown coordinate");
}

/// Point at arc length `distance` (bp) on a cubic given in cm, by fine
/// sampling: independent of the renderer's own subdivision.
fn on_cubic(controls: [(f64, f64); 4], distance: f64) -> ((f64, f64), f64) {
    let at = |t: f64| {
        let u = 1. - t;
        let weights = [u * u * u, 3. * u * u * t, 3. * u * t * t, t * t * t];
        controls
            .iter()
            .zip(weights)
            .fold((0., 0.), |acc, (p, w)| (acc.0 + p.0 * w, acc.1 + p.1 * w))
    };
    let steps = 200_000;
    let mut travelled = 0.;
    let mut previous = at(0.);
    for i in 1..=steps {
        let point = at(i as f64 / steps as f64);
        let step = (point.0 - previous.0).hypot(point.1 - previous.1) * CM;
        if travelled + step >= distance {
            let angle = (point.1 - previous.1).atan2(point.0 - previous.0);
            return (point, angle.to_degrees());
        }
        travelled += step;
        previous = point;
    }
    panic!("distance beyond the curve");
}

#[test]
fn markings_fixture_places_marks_by_arc_length() {
    let d = compile_fixture("ds-markings.tikz");
    let paths = drawn(&d.svg);
    // Line, its Stealth tip, the curve, its dot.
    assert_eq!(paths.len(), 4);
    // The tip of the arrow is at half of the 4 cm line and points along +x.
    let tip = &paths[1];
    near(tip.points[0].0, 2., 1e-6);
    near(tip.points[0].1, 0., 1e-6);
    assert!(tip.points[1..].iter().all(|p| p.0 < 2.));
    near(tip.points[1].1, -tip.points[3].1, 1e-6);
    // The dot is 1 cm along the curve. TeX: (26.28569pt, 36.4073pt).
    let curve = [(0., 1.), (1., 2.), (3., 0.), (4., 1.)];
    let (expected, _) = on_cubic(curve, CM);
    let dot = &paths[3];
    assert_eq!(dot.fill, "#000000");
    let center = (
        (dot.x_range().0 + dot.x_range().1) / 2.,
        (dot.y_range().0 + dot.y_range().1) / 2.,
    );
    near(center.0, expected.0, 0.01);
    near(center.1, expected.1, 0.01);
    near(center.0, 26.28569 / TEX_PT_PER_CM, 0.01);
    near(center.1, 36.4073 / TEX_PT_PER_CM, 0.01);
    // A circle of radius 1pt (its four on-curve points turn with the tangent).
    near(dot.x_range().1 - dot.x_range().0, 2. / TEX_PT_PER_CM, 1e-3);
}

#[test]
fn marks_follow_the_tangent_and_keep_their_own_size() {
    // TeX at position 0.5 of the fixture's curve: m = (56.917pt, 28.449pt),
    // one unit along the mark's x axis = (57.866pt, 28.133pt): -18.43 degrees.
    let d = compile(
        r"\begin{scope}[scale=2]
          \draw[red,postaction={decorate},decoration={markings,
              mark=at position 0.5 with {\node[coordinate] (m) {}; \node[coordinate,xshift=10bp] (mx) {};
                                         \draw (0,0) -- (0,5bp); \node[above] {$t$};},
              mark=at position -1cm with {\node[coordinate] (end) {};},
              mark=at position 0.25 with {\arrow{>}}}]
            (0,0.5) .. controls (0.5,1) and (1.5,0) .. (2,0.5);
          \end{scope}",
    )
    .unwrap();
    let curve = [(0., 1.), (1., 2.), (3., 0.), (4., 1.)];
    let m = d.nodes["m"].center;
    near(m.x / CM, 2., 0.01);
    near(m.y / CM, 1., 0.01);
    near(m.x / CM, 56.917 / TEX_PT_PER_CM, 0.01);
    let direction = (d.nodes["mx"].center.x - m.x, d.nodes["mx"].center.y - m.y);
    // Lengths in a mark are not scaled by the scope: 10bp stays 10bp.
    near(direction.0.hypot(direction.1), 10., 1e-6);
    near(direction.1.atan2(direction.0).to_degrees(), -18.43, 0.05);
    let total = {
        let steps = 20_000;
        (1..=steps)
            .map(|i| {
                let a = on_curve_point(curve, (i - 1) as f64 / steps as f64);
                let b = on_curve_point(curve, i as f64 / steps as f64);
                (b.0 - a.0).hypot(b.1 - a.1) * CM
            })
            .sum::<f64>()
    };
    let (expected, _) = on_cubic(curve, total - CM);
    near(d.nodes["end"].center.x / CM, expected.0, 0.01);
    near(d.nodes["end"].center.y / CM, expected.1, 0.01);
    // The mark's stroke inherits the path colour; `decorate` alone hides the path.
    assert!(d.labels.iter().any(|label| label == "$t$"));
    assert!(
        drawn(&d.svg)
            .iter()
            .filter(|p| p.stroke == "#ff0000")
            .count()
            >= 3
    );
    let d = compile(
        r"\draw[decorate,decoration={markings,mark=at position 0.5 with {\arrow{Stealth}}}] (0,0) -- (4,0);",
    )
    .unwrap();
    let paths = drawn(&d.svg);
    assert_eq!(paths.len(), 1);
    near(paths[0].points[0].0, 2., 1e-6);
}

fn on_curve_point(controls: [(f64, f64); 4], t: f64) -> (f64, f64) {
    let u = 1. - t;
    let weights = [u * u * u, 3. * u * u * t, 3. * u * t * t, t * t * t];
    controls
        .iter()
        .zip(weights)
        .fold((0., 0.), |acc, (p, w)| (acc.0 + p.0 * w, acc.1 + p.1 * w))
}

#[test]
fn marking_paths_do_not_repeat_inherited_decoration_actions() {
    let decoration = r"postaction={decorate},decoration={markings,
        mark=at position 0.5 with {\draw (0,0) -- (1pt,0);}}";
    for options in [
        decoration.to_owned(),
        format!("every path/.style={{{decoration}}}"),
    ] {
        let d = compile(&format!(
            r"\begin{{tikzpicture}}[{options}]
              \draw (0,0) -- (2,0);
              \draw (0,1) -- (2,1);
              \end{{tikzpicture}}"
        ))
        .unwrap();
        let paths = drawn(&d.svg);
        assert_eq!(paths.len(), 4);
        for (i, y) in [(1, 0.), (3, 1.)] {
            near(paths[i].points[0].0, 1., 1e-6);
            near(paths[i].points[0].1, y, 1e-6);
            near(paths[i].points[1].0, 1. + 1. / TEX_PT_PER_CM, 1e-6);
        }
    }
}

#[test]
fn marking_errors_use_the_enclosing_source_location() {
    for code in [
        r"\draw[unknown] (0,0) -- (1,0);",
        r"\draw[decorate] (0,0) -- (1,0);",
        r"\draw[red] (missing) -- (1,0);",
    ] {
        let source = format!(
            "\\draw[postaction={{decorate}},\n  decoration={{markings,mark=at position 0.5 with {{{code}}}}}] (0,0) -- (2,0);"
        );
        let error = compile(&source).err().unwrap_or_else(|| panic!("{source}"));
        assert_eq!((error.line, error.column), (2, 3), "{error}");
    }
}

#[test]
fn unsupported_markings_are_diagnostics() {
    let draw = |decoration: &str| {
        format!("\\draw[postaction={{decorate}},\n  decoration={{{decoration}}}] (0,0) -- (4,0);")
    };
    for (decoration, needle) in [
        (
            r"markings, mark=between positions 0 and 1 step 5mm with {\arrow{>}}",
            "Unsupported mark",
        ),
        (
            r"markings, reset marks, mark=at position 0.5 with {\arrow{>}}",
            "reset marks",
        ),
        (
            r"markings, mark=at position 2 with {\arrow{>}}",
            "outside the path",
        ),
        (r"markings, mark=at position 0.5 with {\pic{x};}", r"\pic"),
        (
            r"markings, mark=at position 0.5 with {\arrow[red]{>}}",
            "options on",
        ),
        (
            r"markings, mark=at position 0.5 with \arrow{>}",
            "braced group",
        ),
        ("markings", "at least one mark"),
        (r"snake", "Unsupported postaction"),
    ] {
        let source = draw(decoration);
        let error = compile(&source).err().unwrap_or_else(|| panic!("{source}"));
        assert!(error.message.contains(needle), "{source}: {error}");
        assert_eq!(
            error.line,
            if decoration == "snake" { 1 } else { 2 },
            "{error}"
        );
    }
    assert_error_at(
        &draw("markings, mark=at position 0.5 with {\\arrow{>}}")
            .replace("(4,0)", "(4,0) -- cycle"),
        2,
        3,
        "closed",
    );
    assert_error_at(
        r"\draw[postaction={draw,red}] (0,0) -- (1,0);",
        1,
        7,
        "Unsupported postaction",
    );
    // The snake decoration itself is still unsupported.
    assert!(compile(&fixture("unsupported-decorations.tikz")).is_err());
}
