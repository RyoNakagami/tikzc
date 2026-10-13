use tikzc::compile;

fn near(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-6, "{actual} != {expected}");
}

#[test]
fn orthogonal_positions_split_time_equally_between_legs() {
    for (operation, corner) in [("-|", (100., 0.)), ("|-", (0., 20.))] {
        // PGF's hvline/vhline timers put the corner at t=0.5 regardless
        // of leg lengths. Test both inline and postfix label syntax.
        for (pos, expected) in [
            (0., (0., 0.)),
            (0.25, (corner.0 / 2., corner.1 / 2.)),
            (0.5, corner),
            (0.75, ((corner.0 + 100.) / 2., (corner.1 + 20.) / 2.)),
            (1., (100., 20.)),
        ] {
            let d = compile(&format!(
                r"\draw(0bp,0bp){operation}node[pos={pos}](inline){{}}(100bp,20bp)
                  node[pos={pos}](postfix){{}}coordinate[pos={pos}](coord);"
            ))
            .unwrap();
            for name in ["inline", "postfix", "coord"] {
                near(d.nodes[name].center.x, expected.0);
                near(d.nodes[name].center.y, expected.1);
            }
        }
    }
}

#[test]
fn orthogonal_timing_handles_transforms_zero_legs_and_next_segment() {
    let d = compile(
        r"\begin{scope}[rotate=90,xscale=2]
          \draw(0bp,0bp)-|(100bp,20bp)node[near start](rotated){};
          \end{scope}
          \draw(0bp,0bp)-|(100bp,0bp)node[midway](corner){}
              node[near end](zero){} --(200bp,0bp)node[midway](straight){};
          \draw(0bp,0bp)|-(100bp,0bp)node[near start](firstzero){};
          \draw(100bp,20bp)-|(0bp,0bp)node[near start](reverse){};",
    )
    .unwrap();
    for (name, x, y) in [
        ("rotated", 0., 100.),
        ("corner", 100., 0.),
        ("zero", 100., 0.),
        ("straight", 150., 0.),
        ("firstzero", 0., 0.),
        ("reverse", 50., 20.),
    ] {
        near(d.nodes[name].center.x, x);
        near(d.nodes[name].center.y, y);
    }
}

#[test]
fn sloped_label_at_orthogonal_corner_follows_second_leg() {
    let d = compile(
        r"\draw(0bp,0bp)-|(100bp,20bp)
          node[pos=0.25,sloped](horizontal){X}
          node[midway,sloped](corner){X}
          node[pos=0.75,sloped](vertical){X};",
    )
    .unwrap();
    near(d.nodes["horizontal"].rotation, 0.);
    near(d.nodes["corner"].rotation, 90.);
    near(d.nodes["vertical"].rotation, 90.);
}

#[test]
fn reported_feedback_label_is_centered_over_horizontal_leg() {
    let source = include_str!("../notebook/test-jp.tikz");
    let named = source.replace(
        "node[pos=0.25, above, sig]",
        "node[pos=0.25, above, sig] (feedback)",
    );
    assert_ne!(source, named);
    let d = compile(&named).unwrap();
    near(
        d.nodes["feedback"].center.x,
        (d.nodes["robot"].center.x + d.nodes["route"].center.x) / 2.,
    );
}
