//! Linear and radial shadings (F11). Colour references were measured on
//! lualatex/PGF 3.1.10 output; no test runs TeX.
mod common;
use common::*;
use resvg::usvg::roxmltree::Document;
use tikzc::compile;

/// Reference colours from TeX, measured with
///   lualatex shade.tex && pdftoppm -r 720 -png shade.pdf shade
/// on a standalone picture holding the three shapes of the fixture (plus a
/// middle-colour bar), reading pixels at the listed positions. PGF fits a
/// shading to the bounding box of the path: an axis shading runs linearly
/// from edge to edge, a radial one reaches the outer colour at the edge.
/// Positions are (x, y) in cm in the fixture's coordinates.
const TEX_REFERENCE: &[((f64, f64), [u8; 3])] = &[
    // left color=blue, right color=white on (0,0) rectangle (4,1)
    ((0.43, 0.5), [27, 27, 255]),
    ((1.93, 0.5), [123, 123, 255]),
    ((3.43, 0.5), [219, 219, 255]),
    // top color=red, bottom color=yellow on (0,-2) rectangle (4,-1)
    ((1.93, -1.25), [255, 63, 0]),
    ((1.93, -1.5), [255, 127, 0]),
    ((1.93, -1.75), [255, 191, 0]),
    // inner color=white, outer color=black on (2,-4) circle (1)
    ((2.18, -4.), [210, 210, 210]),
    ((2.43, -4.), [146, 146, 146]),
    ((2.68, -4.), [82, 82, 82]),
];

#[test]
fn shading_fixture_matches_tex_colours() {
    let d = compile_fixture("ds-shading.tikz");
    let raster = Raster::new(&d, 300.);
    for ((x, y), expected) in TEX_REFERENCE {
        let actual = raster.rgb(*x, *y);
        for (a, e) in actual.iter().zip(expected) {
            assert!(a.abs_diff(*e) <= 8, "({x},{y}): {actual:?} != {expected:?}");
        }
    }
    // Left, middle and right of the horizontal bar, as the acceptance asks.
    assert!(raster.rgb(0.05, 0.5)[0] < 12);
    assert!(raster.rgb(3.95, 0.5)[0] > 243);
    // The shaded paths have no outline, and nothing leaks outside them.
    assert_eq!(raster.rgb(2., -0.5), [255, 255, 255]);
    assert_eq!(raster.rgb(2.9, -3.1), [255, 255, 255]);
    assert_eq!(d.svg, compile_fixture("ds-shading.tikz").svg);
}

#[test]
fn shadings_are_svg_gradients_with_unique_ids() {
    let d = compile_fixture("ds-shading.tikz");
    check_references(&d.svg);
    let document = Document::parse(&d.svg).unwrap();
    let count = |tag: &str| {
        document
            .descendants()
            .filter(|n| n.has_tag_name(tag))
            .count()
    };
    assert_eq!(count("linearGradient"), 2);
    assert_eq!(count("radialGradient"), 1);
    assert_eq!(count("stop"), 6);
    let fills: Vec<String> = drawn(&d.svg).into_iter().map(|p| p.fill).collect();
    assert_eq!(fills, ["url(#shade-0)", "url(#shade-1)", "url(#shade-2)"]);
    // Gradient, pattern and clip ids share one numbering and never collide.
    let d = compile(
        r"\begin{scope}\clip (0,0) rectangle (3,3);
            \shade[left color=red] (0,0) rectangle (3,1);
            \fill[pattern=dots] (0,1) rectangle (3,2);
            \shade[inner color=red] (1,2) rectangle (3,3);
          \end{scope}
          \shade[top color=blue!20] (4,0) rectangle (5,1) node {$x$};",
    )
    .unwrap();
    check_references(&d.svg);
    for id in ["clip-0", "shade-1", "pattern-2", "shade-3", "shade-4"] {
        assert!(d.svg.contains(&format!("id=\"{id}\"")), "{id}");
    }
    d.png(150.).unwrap();
    // The minimal shading fixture also renders a linear gradient.
    assert!(
        compile(&fixture("shading.tikz"))
            .unwrap()
            .svg
            .contains("linearGradient")
    );
}

#[test]
fn shading_colours_defaults_and_outlines() {
    // TeX: a middle colour sits at the centre:
    // left=red, middle=green, right=blue at x = 0.93 of 4 cm -> (137,118,0)
    let d = compile(
        r"\shade[left color=red, right color=blue, middle color=green] (0,0) rectangle (4,1);",
    )
    .unwrap();
    let raster = Raster::new(&d, 300.);
    for ((x, y), expected) in [((0.93, 0.5), [137u8, 118, 0]), ((2.0, 0.5), [0, 255, 0])] {
        let actual = raster.rgb(x, y);
        for (a, e) in actual.iter().zip(expected) {
            assert!(a.abs_diff(e) <= 8, "({x},{y}): {actual:?}");
        }
    }
    // TeX: a radial shading on a 4 x 2 rectangle is elliptical: black at the
    // middle of each edge. Along x at 0.93 cm from the centre -> 137.
    let d =
        compile(r"\shade[inner color=white, outer color=black] (0,0) rectangle (4,2);").unwrap();
    let raster = Raster::new(&d, 300.);
    assert!(raster.rgb(2.93, 1.)[0].abs_diff(137) <= 8);
    assert!(raster.rgb(2., 1.5)[0].abs_diff(126) <= 8);
    assert!(raster.rgb(3.95, 1.95)[0] <= 8);
    // TikZ's defaults are gray towards white; \shadedraw and the colour keys
    // on \draw shade too, with an outline.
    let d = compile(
        r"\shade (0,0) rectangle (1,1);
          \shadedraw[inner color=red] (2,0) circle (0.5);
          \draw[top color=red, bottom color=blue] (4,0) rectangle (5,1);
          \fill[shade, left color=red] (6,0) rectangle (7,1);",
    )
    .unwrap();
    let paths = drawn(&d.svg);
    assert_eq!(paths.len(), 4);
    assert!(paths.iter().all(|p| p.fill.starts_with("url(#shade-")));
    let strokes: Vec<&str> = paths.iter().map(|p| p.stroke.as_str()).collect();
    assert_eq!(strokes, ["none", "#000000", "#000000", "none"]);
    assert!(d.svg.contains("stop-color=\"#808080\""));
    // A shading follows the bounding box of a transformed path.
    let d =
        compile(r"\shade[left color=black, right color=white, rotate=90] (0,0) rectangle (4,1);")
            .unwrap();
    let raster = Raster::new(&d, 300.);
    assert!(raster.rgb(-0.9, 2.)[0] < 40);
    assert!(raster.rgb(-0.1, 2.)[0] > 215);
}

#[test]
fn unsupported_shadings_are_diagnostics() {
    assert_error_at(
        "\\node {x};\n\\shade[ball color=red] (0,0) circle (1);",
        2,
        8,
        "Unsupported option 'ball color'",
    );
    assert_error_at(
        r"\shade[shading=ball] (0,0) circle (1);",
        1,
        8,
        "Unsupported shading 'ball'",
    );
    assert_error_at(
        r"\shade[left color=red, shading angle=45] (0,0) rectangle (1,1);",
        1,
        24,
        "Unsupported shading angle",
    );
    assert_error_at(
        r"\shade[left color=red, top color=blue] (0,0) rectangle (1,1);",
        1,
        1,
        "Unsupported mix",
    );
    assert_error_at(
        r"\shade[inner color=red, middle color=blue] (0,0) circle (1);",
        1,
        25,
        "middle color",
    );
    assert_error_at(
        r"\shade[shading=radial, left color=red] (0,0) circle (1);",
        1,
        8,
        "Unsupported shading",
    );
    assert_error_at(
        r"\shade[left color=nocolor] (0,0) rectangle (1,1);",
        1,
        8,
        "Unsupported color",
    );
    // A failed shading must not leave a half-written output.
    assert!(compile(r"\shade[shading=ball] (0,0) circle (1);").is_err());
}
