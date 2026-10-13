use std::path::Path;
use std::process::Command;

const CORPUS: &[&str] = &[
    "test",
    "test-jp",
    "nat",
    "tls",
    "ekf-data-assimilation",
    "in-retail-rdfs",
    "napt",
    "test-multirate-backup",
];
fn fixture(name: &str) -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("tests/fixtures/{name}.tikz")),
    )
    .unwrap()
}

#[test]
fn corpus_svg_png_and_determinism() {
    for name in CORPUS {
        let source = fixture(name);
        let diagram = tikzc::compile(&source).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(diagram.width > 0. && diagram.height > 0.);
        assert!(
            !diagram.svg.contains("<text"),
            "fonts must be outlined: {name}"
        );
        assert_eq!(diagram.svg, tikzc::compile(&source).unwrap().svg, "{name}");
        let png = diagram.png(72.).unwrap();
        let pix = resvg::tiny_skia::Pixmap::decode_png(&png).unwrap();
        assert_eq!(pix.width(), diagram.width.ceil() as u32);
        assert_eq!(pix.height(), diagram.height.ceil() as u32);
        assert!(
            pix.data()
                .as_chunks::<4>()
                .0
                .iter()
                .filter(|p| p[..3] != [255, 255, 255])
                .count()
                > 100,
            "blank image: {name}"
        );
    }
}

#[test]
fn unsupported_is_diagnostic() {
    for name in [
        "decorations",
        "graphs",
        "intersections",
        "pic",
        "shading",
        "shape",
    ] {
        let error = tikzc::compile(&fixture(&format!("unsupported-{name}")))
            .err()
            .expect(name);
        assert!(error.message.contains("Unsupported"), "{error}");
        assert!(error.line > 0 && error.column > 0);
    }
    for source in [
        r"\draw[unrecognized] (0,0)--(1,0);",
        r"\node {\input{secret}};",
        r"\node[draw] {unclosed;",
        r"\draw[-{Unknown}] (0,0)--(1,0);",
        r"\draw[shorten >=100cm] (0,0) to[bend left=30] (1,0);",
    ] {
        assert!(tikzc::compile(source).is_err(), "{source}");
    }
    let e = tikzc::compile("% 日本語\n\\unknown;").err().unwrap();
    assert_eq!((e.line, e.column), (2, 1));
}

#[test]
fn positioning_minimum_sizes_and_units() {
    let d=tikzc::compile(r"\tikzset{outer sep=0}\node[circle,minimum size=1cm,inner sep=0] (a) {}; \node[rectangle,minimum width=1cm,right=1cm of a] (b) {}; \coordinate (c) at (b.west);").unwrap();
    let a = &d.nodes["a"];
    let b = &d.nodes["b"];
    assert!((a.width - 72. / 2.54).abs() < 1e-6);
    assert!((b.center.x - b.width / 2. - (a.center.x + a.width / 2.) - 72. / 2.54).abs() < 1e-6);
    assert!((d.nodes["c"].center.x - b.center.x + b.width / 2.).abs() < 1e-6);
}

#[test]
fn segment_labels_relative_coordinates_and_slopes() {
    let d=tikzc::compile(r"\draw (0,0)--(4,0)--(4,2) node[midway] (label) {x}; \draw (0,0)-- +(1,0)-- +(2,0) coordinate[at end] (relative); \draw (0,0)-- ++(1,0)-- ++(2,0) coordinate[at end] (incremental); \draw (0,0)--node[sloped,above] {slope}(1,1);").unwrap();
    assert!((d.nodes["label"].center.x - 4. * 72. / 2.54).abs() < 1e-6);
    assert!((d.nodes["label"].center.y - 72. / 2.54).abs() < 1e-6);
    assert!((d.nodes["relative"].center.x - 2. * 72. / 2.54).abs() < 1e-6);
    assert!((d.nodes["incremental"].center.x - 3. * 72. / 2.54).abs() < 1e-6);
    assert!(d.svg.contains("matrix(0.707106"));
}

#[test]
fn nested_text_svg_uses_geometry_units() {
    let d = tikzc::compile(r"\node[draw] {日本語 $x^2$};").unwrap();
    let nested = d.svg.find("<svg viewBox").unwrap();
    let root = &d.svg[nested..nested + d.svg[nested..].find('>').unwrap()];
    assert!(!root.contains("pt\""));
    assert!(d.png(f64::NAN).is_err());
    assert!(d.png(1e9).is_err());
}

#[test]
fn arc_radius_is_in_coordinate_units_and_updates_relative_base() {
    let d=tikzc::compile(r"\draw (1,0) arc[start angle=0,end angle=180,radius=1] -- ++(0,1) coordinate[at end] (end);").unwrap();
    assert!((d.nodes["end"].center.x + 72. / 2.54).abs() < 1e-6);
    assert!((d.nodes["end"].center.y - 72. / 2.54).abs() < 1e-6);
    for source in [r"\node[scale=0]{x};", r"\draw[scale=0](0,0)--(1,0);"] {
        assert!(tikzc::compile(source).is_err(), "{source}");
    }
}

#[test]
fn cli_without_external_tools_and_no_output_on_error() {
    let dir = std::env::temp_dir().join(format!("tikzc-native-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("input.tikz");
    let output = dir.join("result.svg");
    std::fs::write(&input, fixture("test-jp")).unwrap();
    let cli = env!("CARGO_BIN_EXE_tikzc");
    let result = Command::new(cli)
        .env("PATH", "")
        .arg(&input)
        .args(["-o"])
        .arg(&output)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let original = std::fs::read(&output).unwrap();
    let alias = input.parent().unwrap().join(".").join("input.tikz");
    let result = Command::new(cli)
        .arg(&input)
        .arg("-f")
        .arg("svg")
        .arg("-o")
        .arg(&alias)
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(2));
    assert_eq!(std::fs::read_to_string(&input).unwrap(), fixture("test-jp"));
    std::fs::write(&input, r"\unknown;").unwrap();
    let result = Command::new(cli)
        .env("PATH", "")
        .arg(&input)
        .arg("-o")
        .arg(&output)
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(3));
    assert_eq!(original, std::fs::read(&output).unwrap());
    for file in [&input, &output] {
        std::fs::remove_file(file).unwrap();
    }
    std::fs::remove_dir(dir).unwrap();
}
