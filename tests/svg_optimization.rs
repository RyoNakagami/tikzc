use resvg::usvg::roxmltree::Document;
use std::collections::BTreeSet;
use tikzc::compile;

fn check_references(svg: &str) {
    let doc = Document::parse(svg).unwrap();
    let mut ids = BTreeSet::new();
    for id in doc.descendants().filter_map(|n| n.attribute("id")) {
        assert!(ids.insert(id), "duplicate id: {id}");
    }
    for node in doc.descendants() {
        for a in node.attributes() {
            if a.name() == "href" && a.value().starts_with('#') {
                assert!(ids.contains(&a.value()[1..]), "missing {}", a.value());
            }
            for part in a.value().split("url(#").skip(1) {
                let id = part.split(')').next().unwrap();
                assert!(ids.contains(id), "missing {id}");
            }
        }
    }
}

#[test]
fn repeated_glyphs_are_shared_across_labels() {
    let source = r"\node at(0,0){ABC日本語};\node at(2,0){ABC日本語};";
    let d = compile(source).unwrap();
    check_references(&d.svg);
    let doc = Document::parse(&d.svg).unwrap();
    let symbols: Vec<_> = doc
        .descendants()
        .filter(|n| n.has_tag_name("symbol"))
        .collect();
    assert_eq!(symbols.len(), 6);
    assert!(
        symbols
            .iter()
            .all(|n| n.parent().unwrap().parent() == Some(doc.root_element()))
    );
    assert_eq!(d.svg, compile(source).unwrap().svg);
    d.png(150.).unwrap();
}

#[test]
fn matrix_measurement_rollback_preserves_glyphs_and_other_definitions() {
    let source = r"\node{ABC};
      \begin{scope}\clip(-1,-1)rectangle(8,2);
      \matrix[matrix of nodes,nodes={pattern=dots,draw}]at(3,0){ABC&日本語\\DEF&ABC\\};
      \end{scope}\node at(7,0){DEF日本語};";
    let d = compile(source).unwrap();
    check_references(&d.svg);
    let doc = Document::parse(&d.svg).unwrap();
    assert_eq!(
        doc.descendants()
            .filter(|n| n.has_tag_name("pattern"))
            .count(),
        4
    );
    assert_eq!(
        doc.descendants()
            .filter(|n| n.has_tag_name("clipPath"))
            .count(),
        1
    );
    assert_eq!(d.svg, compile(source).unwrap().svg);
    d.png(150.).unwrap();
}

#[test]
fn notebook_svgs_have_unique_ids_valid_references_and_deterministic_output() {
    for name in [
        "test",
        "test-jp",
        "nat",
        "tls",
        "native-subset",
        "repository-before-after",
        "version-033-before-after",
    ] {
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("notebook/{name}.tikz"));
        let source = std::fs::read_to_string(path).unwrap();
        let d = compile(&source).unwrap();
        check_references(&d.svg);
        assert_eq!(d.svg, compile(&source).unwrap().svg, "{name}");
    }
}

#[test]
fn default_attributes_are_omitted_but_nondefaults_and_joins_remain() {
    let d = compile(r"\node[draw]{A};\draw[->](0,0)--(1,1);").unwrap();
    let doc = Document::parse(&d.svg).unwrap();
    for n in doc
        .descendants()
        .filter(|n| n.is_element() && *n != doc.root_element())
    {
        for (key, value) in [
            ("opacity", "1"),
            ("fill-opacity", "1"),
            ("stroke-opacity", "1"),
            ("stroke-linecap", "butt"),
            ("rx", "0"),
        ] {
            assert_ne!(n.attribute(key), Some(value), "redundant {key}");
        }
        if n.attribute("stroke-linejoin").is_some() {
            assert_eq!(n.attribute("stroke-linejoin"), Some("round"));
        }
    }
    let d = compile(r"\begin{scope}[opacity=.5,fill opacity=.4,draw opacity=.3,line cap=round,line join=bevel,even odd rule]
      \node[draw,fill=red,rounded corners=2bp]{A};
      \draw[->](0,0)--(1,1);
      \node[draw,opacity=1,fill opacity=1,draw opacity=1,line cap=butt]at(3,0){B};
      \end{scope}").unwrap();
    let doc = Document::parse(&d.svg).unwrap();
    let rects: Vec<_> = doc
        .descendants()
        .filter(|n| n.has_tag_name("rect"))
        .collect();
    for (key, expected) in [
        ("opacity", "0.5"),
        ("fill-opacity", "0.4"),
        ("stroke-opacity", "0.3"),
        ("stroke-linecap", "round"),
        ("stroke-linejoin", "bevel"),
        ("fill-rule", "evenodd"),
        ("rx", "2.00000"),
    ] {
        assert_eq!(rects[0].attribute(key), Some(expected));
    }
    for key in [
        "opacity",
        "fill-opacity",
        "stroke-opacity",
        "stroke-linecap",
        "rx",
    ] {
        assert!(rects[1].attribute(key).is_none(), "{key}");
    }
    assert!(
        doc.descendants()
            .any(|n| n.has_tag_name("path") && n.attribute("opacity") == Some("0.15"))
    );
    d.png(150.).unwrap();
}

#[test]
fn inherited_paint_from_embedding_parent_does_not_override_root_defaults() {
    let d = compile(r"\node[draw,fill=red]{ABC};\draw[->](0,0)--(2,1);").unwrap();
    let raster = |parent: &str| {
        let svg = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><g {parent}>{}</g></svg>"#,
            d.svg
        );
        let tree = resvg::usvg::Tree::from_str(&svg, &Default::default()).unwrap();
        let mut pixels = resvg::tiny_skia::Pixmap::new(500, 300).unwrap();
        resvg::render(
            &tree,
            resvg::tiny_skia::Transform::identity(),
            &mut pixels.as_mut(),
        );
        pixels.take()
    };
    assert_eq!(
        raster(""),
        raster(
            r#"style="fill-opacity:0.2;stroke-opacity:0.3;fill-rule:evenodd;stroke-linecap:round""#
        )
    );
}
