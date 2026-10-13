use tikzc::{compile, render::compile_with_text, text::TextEngine};

#[test]
fn reusable_text_cache_preserves_artifacts_and_source_ranges() {
    let source = "#| mainfont: IPAexGothic\n\\begin{tikzpicture}\\node[draw](a)at(1,2){日本語ABC};\\node at(3,2){DEF};\\end{tikzpicture}";
    let mut text = TextEngine::new();
    let a = compile_with_text(source, &mut text).unwrap();
    let b = compile_with_text(source, &mut text).unwrap();
    assert!(b.text_timings.cache_hits >= 2);
    assert_eq!(a.svg, b.svg);
    assert_eq!(a.svg, compile(source).unwrap().svg);
    for n in b.editing["nodes"].as_array().unwrap() {
        let start = n["labelStart"].as_u64().unwrap() as usize;
        let end = n["end"].as_u64().unwrap() as usize;
        assert!(source[start..end].starts_with('{'));
        assert!(source[start..end].ends_with('}'));
    }
    assert_eq!(b.editing["nodes"].as_array().unwrap().len(), 2);
}

#[test]
fn underline_and_italic_are_visible_for_japanese() {
    let source = "#| mainfont: IPAexGothic\n\\node{日本語ABC};";
    let plain = compile(source).unwrap();
    let underlined = compile(&source.replace("{日本語ABC}", r"{\underline{日本語ABC}}")).unwrap();
    let italic = compile(&source.replace("{日本語ABC}", r"[font=\itshape]{日本語ABC}")).unwrap();
    let plain_png = plain.png(150.).unwrap();
    assert!(
        plain_png != underlined.png(150.).unwrap(),
        "Japanese underline is not visible"
    );
    assert!(
        plain_png != italic.png(150.).unwrap(),
        "Japanese italic is not visible"
    );
}

#[test]
fn insertion_boundary_is_literal_and_respects_picture_scopes() {
    let source = "% 日本語\n\\begin{tikzpicture}\n\\begin{scope}\\node {A};\\end{scope}\n% \\end{tikzpicture}\n\\end{tikzpicture}% tail";
    let diagram = compile(source).unwrap();
    assert_eq!(
        diagram.editing["insertionOffset"].as_u64().unwrap() as usize,
        source.rfind("\\end{tikzpicture}").unwrap()
    );
    let bare = "\\node{日本語};% tail";
    assert_eq!(
        compile(bare).unwrap().editing["insertionOffset"],
        bare.len()
    );
    let generated = r"\def\picture{\begin{tikzpicture}\node{A};\end{tikzpicture}}\picture";
    assert!(compile(generated).unwrap().editing["insertionOffset"].is_null());
    let multiple = r"\begin{tikzpicture}\node{A};\end{tikzpicture}\begin{tikzpicture}\node{B};\end{tikzpicture}";
    assert!(compile(multiple).unwrap().editing["insertionOffset"].is_null());
}

#[test]
fn reset_cm_places_new_nodes_in_world_space_and_restores_parent_transform() {
    let source = r"\begin{tikzpicture}[scale=2,rotate=30,shift={(1,2)}]
        \node (before) at (1,2) {A};
        \begin{scope}[reset cm]
        \node[draw,rectangle,minimum width=30bp,minimum height=20bp,inner sep=0bp,outer sep=0bp] (added) at (20bp,30bp) {};
        \draw[->] (0bp,0bp) -- (40bp,30bp);
        \end{scope}
        \node (after) at (1,2) {A};
        \end{tikzpicture}";
    let diagram = compile(source).unwrap();
    let added = &diagram.nodes["added"];
    assert!((added.center.x - 20.).abs() < 1e-8);
    assert!((added.center.y - 30.).abs() < 1e-8);
    assert!((added.width - 30.).abs() < 1e-8);
    assert!((added.height - 20.).abs() < 1e-8);
    assert_eq!(
        diagram.nodes["before"].center,
        diagram.nodes["after"].center
    );
}

#[test]
fn empty_documents_offer_a_canvas_for_the_first_insertion() {
    for source in ["", "% 日本語", r"\begin{tikzpicture}\end{tikzpicture}"] {
        let diagram = compile(source).unwrap();
        assert!(diagram.width > 280. && diagram.height > 170.);
        assert!(diagram.editing["insertionOffset"].is_number());
        assert_eq!(diagram.editing["nodes"].as_array().unwrap().len(), 0);
        assert!(diagram.png(72.).is_ok());
    }
    assert!(compile(r"\begin{tikzpicture}").is_err());
    assert!(compile(r"\unsupportedcommand").is_err());
}

#[test]
fn pgf_layers_change_paint_order_without_changing_reference_or_scope_resolution() {
    let source = r"\pgfdeclarelayer{front}\pgfdeclarelayer{back}
        \begin{tikzpicture}[rotate=15]
        \begin{scope}[xshift=10bp]
        \begin{pgfonlayer}{front}
        \node[fill=red,minimum width=40bp,minimum height=20bp] (a) at (0,0) {};
        \end{pgfonlayer}
        \begin{pgfonlayer}{back}
        \node[fill=blue,minimum width=40bp,minimum height=20bp] (b) at (a.center) {};
        \end{pgfonlayer}
        \end{scope}
        \pgfsetlayers{back,main,front}
        \end{tikzpicture}";
    let red = compile(source).unwrap();
    let blue = compile(&source.replace("{back,main,front}", "{front,main,back}")).unwrap();
    assert_eq!(red.nodes["a"].center, blue.nodes["a"].center);
    assert_eq!(red.nodes["a"].center, blue.nodes["b"].center);
    for (diagram, expected) in [(&red, [255, 0, 0, 255]), (&blue, [0, 0, 255, 255])] {
        let png = diagram.png(72.).unwrap();
        let pixels = resvg::tiny_skia::Pixmap::decode_png(&png).unwrap();
        let offset = ((pixels.height() / 2 * pixels.width() + pixels.width() / 2) * 4) as usize;
        assert_eq!(&pixels.data()[offset..offset + 4], &expected);
    }
    let objects = red.editing["objects"].as_array().unwrap();
    assert_eq!(objects.len(), 2);
    assert_eq!(objects[0]["order"], 1);
    assert_eq!(objects[1]["order"], 0);
    for object in objects {
        let start = object["start"].as_u64().unwrap() as usize;
        let end = object["end"].as_u64().unwrap() as usize;
        assert!(source[start..end].starts_with(r"\node"));
        assert!(source[start..end].ends_with(';'));
        assert_eq!(object["editable"], true);
    }
    assert_eq!(red.editing["nodes"][0]["objectId"], objects[0]["id"]);
    assert!(compile(r"\pgfsetlayers{unknown,main}\node{A};").is_err());
    assert!(compile(r"\begin{pgfonlayer}{main}\node{A};\end{pgfonlayer}").is_err());
}

#[test]
fn generated_objects_and_mixed_path_layers_are_not_independently_orderable() {
    let diagram = compile(r"\def\box{\node{A};}\box\box\draw (0,0)--(1,1);").unwrap();
    let objects = diagram.editing["objects"].as_array().unwrap();
    assert_eq!(objects.len(), 3);
    assert_eq!(objects[0]["editable"], false);
    assert_eq!(objects[2]["kind"], "path");
    assert_eq!(objects[2]["editable"], true);
}

#[test]
fn path_endpoint_ranges_follow_geometry_and_exclude_unsafe_source() {
    for operation in [
        "--",
        "|-",
        "-|",
        "to[bend left]",
        ".. controls (1,2) and (2,2) ..",
    ] {
        let source = format!(
            "% 日本語\n\\node[draw] (a) at (0,0) {{A}};\\node[draw] (b) at (3,0) {{B}};\\draw[->] (a.east) {operation} (b.west);"
        );
        let diagram = compile(&source).unwrap();
        let ends = diagram.editing["objects"][2]["endpoints"]
            .as_array()
            .unwrap();
        assert_eq!(ends.len(), 2);
        for (endpoint, reference) in ends.iter().zip(["(a.east)", "(b.west)"]) {
            let start = endpoint["start"].as_u64().unwrap() as usize;
            let end = endpoint["end"].as_u64().unwrap() as usize;
            assert_eq!(&source[start..end], reference);
        }
        assert!(
            diagram.editing["anchors"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a["reference"] == "b.north")
        );
    }
    for source in [
        r"\draw (0,0) rectangle (1,1);",
        r"\draw (0,0)--(1,1)--cycle;",
        r"\draw (0,0)--(1,1) (2,2)--(3,3);",
        r"\def\arrow{\draw (0,0)--(1,1);}\arrow",
    ] {
        assert_eq!(
            compile(source).unwrap().editing["objects"][0]["endpoints"],
            serde_json::json!([])
        );
    }
    let source = r"\begin{scope}[rotate=90,scale=2,transform canvas={xshift=5bp,yshift=7bp}]\draw (0bp,0bp)--(10bp,0bp);\end{scope}";
    let diagram = compile(source).unwrap();
    let end = &diagram.editing["objects"][0]["endpoints"][1];
    assert!((end["x"].as_f64().unwrap() - 5.).abs() < 1e-8);
    assert!((end["y"].as_f64().unwrap() - 27.).abs() < 1e-8);
    assert_eq!(end["canvasShift"], serde_json::json!([5., 7.]));
}

#[test]
fn gui_path_points_include_relative_vertices_corners_and_curve_controls() {
    let source = r"\draw[->] (0,0) -- ++(1,0) |- (3,2);";
    let diagram = compile(source).unwrap();
    let object = &diagram.editing["objects"][0];
    let handles = object["pathPoints"].as_array().unwrap();
    assert_eq!(
        handles
            .iter()
            .map(|h| h["kind"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["start", "bend", "bend", "end"]
    );
    assert_eq!(handles[2]["replacement"], "corner");
    assert_eq!(object["endpoints"].as_array().unwrap().len(), 2);
    let normalization = &object["pathNormalizations"][0];
    let start = normalization["start"].as_u64().unwrap() as usize;
    let end = normalization["end"].as_u64().unwrap() as usize;
    assert_eq!(&source[start..end], "++(1,0)");
    for operation in ["to[bend left]", ".. controls +(1,2) and +(-1,2) .."] {
        let source = format!("\\draw[->] (0,0) {operation} node[midway]{{Label}} (3,0);");
        let diagram = compile(&source).unwrap();
        let handles = diagram.editing["objects"][0]["pathPoints"]
            .as_array()
            .unwrap();
        assert_eq!(handles.iter().filter(|h| h["kind"] == "control").count(), 2);
        assert_eq!(handles.len(), 4);
        let start = handles[1]["start"].as_u64().unwrap() as usize;
        let end = handles[1]["end"].as_u64().unwrap() as usize;
        assert_eq!(&source[start..end], operation);
    }
}
