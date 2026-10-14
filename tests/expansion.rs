use tikzc::compile;
const CM: f64 = 72. / 2.54;
fn near(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-6, "{actual} != {expected}");
}
#[test]
fn original_fixtures_now_render() {
    let example = include_str!("../notebook/native-subset.tikz");
    assert!(compile(example).unwrap().png(100.).unwrap().len() > 100);
    for name in [
        "foreach-list",
        "foreach-range",
        "macro-def",
        "macro-newcommand",
        "math-functions",
        "scope-transform",
        "rotate",
        "arrow-meta",
        "arrow-shortening",
        "coord-anchor",
        "clip",
        "matrix",
        "pattern",
        "plot",
        "shading",
    ] {
        let source = std::fs::read_to_string(format!(
            "{}/tests/fixtures/{name}.tikz",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap();
        let diagram = compile(&source).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(diagram.svg, compile(&source).unwrap().svg, "{name}");
        assert!(diagram.png(100.).unwrap().len() > 100);
    }
}
#[test]
fn foreach_nested_tuples_and_decimal_ranges() {
    let d=compile(r"\foreach \x in {0,0.1,...,0.3}{\foreach \y/\label in {0/A,1/B}{\node (n\x\label) at (\x,\y) {\label};}} \foreach \z in {3,2,...,0}{\node (d\z) at (\z,-1) {};}").unwrap();
    assert_eq!(d.nodes.len(), 12);
    near(d.nodes["n0.3B"].center.x, 0.3 * CM);
    near(d.nodes["n0.3B"].center.y, CM);
    near(d.nodes["d0"].center.x, 0.);
}
#[test]
fn macro_parameters_late_binding_and_scope() {
    let d=compile(r"\def\value{1}\newcommand{\boxat}[2]{\node (#1) at (#2,0) {$#2$};}\def\late{\value}\boxat{a}{\late}\begin{scope}\def\value{2}\boxat{b}{\late}\end{scope}\foreach \value in {3,4}{\boxat{n\value}{\value}}\boxat{c}{\late}").unwrap();
    for (name, x) in [("a", 1.), ("b", 2.), ("c", 1.), ("n3", 3.), ("n4", 4.)] {
        near(d.nodes[name].center.x, x * CM);
    }
    compile(r"\def\switch{\bfseries}\node {\switch Bold};\newcommand{\join}[1]{#1x}\node at (2,0){$\join{\alpha}$};").unwrap();
    compile(r"\def\a{A}\renewcommand{\a}{B}\node {\a};").unwrap();
}
#[test]
fn math_and_coordinate_expressions() {
    let d=compile(r"\pgfmathsetmacro{\r}{sqrt(4)+sin(30)}\pgfmathtruncatemacro{\n}{2.9}\pgfmathparse{cos(60)*4}\node (a) at ({\r*2},{\n+\pgfmathresult}) {$x$};\draw(0,0)circle(\r cm);").unwrap();
    near(d.nodes["a"].center.x, 5. * CM);
    near(d.nodes["a"].center.y, 4. * CM);
}
#[test]
fn transform_order_nested_paths_and_restore() {
    let d=compile(r"\begin{scope}[shift={(1,2)},rotate=90]\begin{scope}[xscale=2]\node(a) at (1,0) {};\end{scope}\node(b) at (1,0) {};\end{scope}\node(c) at (1,0) {};\draw[shift={(2,0)},scale=2](0,0)--(1,0) coordinate[at end](p);\node(d)at(1,0){};\begin{scope}[scale=2,shift={(1,0)}]\node(e)at(1,0){};\end{scope}").unwrap();
    near(d.nodes["a"].center.x, CM);
    near(d.nodes["a"].center.y, 4. * CM);
    near(d.nodes["b"].center.y, 3. * CM);
    near(d.nodes["c"].center.x, CM);
    near(d.nodes["p"].center.x, 4. * CM);
    near(d.nodes["d"].center.x, CM);
    near(d.nodes["e"].center.x, 4. * CM);
}
#[test]
fn rotated_anchors_and_border() {
    let d=compile(r"\node[draw,rotate=90,minimum width=2cm,minimum height=1cm,inner sep=0,outer sep=0](a){};\coordinate(e)at(a.east);\coordinate(n)at(a.north);\coordinate(angle)at(a.0);\draw[->](a)--(3,0);").unwrap();
    near(d.nodes["e"].center.x, 0.);
    near(d.nodes["e"].center.y, CM);
    near(d.nodes["n"].center.x, -CM / 2.);
    near(d.nodes["angle"].center.y, CM);
    assert!(d.svg.contains("M 14.17323,"));
}
#[test]
fn transformed_circle_and_arc_geometry() {
    let d=compile(r"\begin{scope}[shift={(1,1)},xscale=2,yscale=.5]\draw(0,0)circle(1cm);\draw(1,0)arc[start angle=0,end angle=180,radius=1] coordinate[at end](end);\end{scope}").unwrap();
    near(d.nodes["end"].center.x, -CM);
    near(d.nodes["end"].center.y, CM);
    near(d.width, 4. * CM + 4. * 72. / 72.27);
    near(d.height, CM + 4. * 72. / 72.27);
    let d = compile(r"\draw[rotate=90](0,0)rectangle(2,1);").unwrap();
    near(d.width, CM + 4. * 72. / 72.27);
    near(d.height, 2. * CM + 4. * 72. / 72.27);
}
#[test]
fn shortening_and_arrow_ends() {
    let d=compile(r"\draw[arrows={Stealth[length=4bp]}-{Latex[length=5bp]},shorten <=4bp,shorten >=5bp](0,0)--(100bp,0);").unwrap();
    assert!(d.svg.contains("M 4.00000,-0.00000"));
    assert!(d.svg.contains("M 95.00000,-0.00000"));
    assert!(d.svg.contains("L 91.50000,-0.00000")); // shaft stops behind the tip
    let d = compile(r"\draw[-{Stealth[length=10bp,open]}](0,0)--(100bp,0);").unwrap();
    assert!(d.svg.contains("L 90.00000,-0.00000"));
    assert!(d.svg.contains("M 100.00000,-0.00000"));
}
#[test]
fn invalid_expansion_is_bounded_and_has_original_location() {
    for source in [
        r"\def\a{\a}\node{\a};",
        r"\foreach\x in{0,0,...,2}{\node{\x};}",
        r"\foreach\x in{0,0.0000000000001,...,0.0000000000002}{\node{\x};}",
        r"\foreach\x in{1,...,10001}{\node{\x};}",
        r"\newcommand{\a}[1][x]{#1}\node{\a};",
        r"\def\a#2{#2}",
        r"\newcommand{\a}{A}\newcommand{\a}{B}",
        r"\pgfmathparse{1/0}",
        r"\pgfmathparse{sqrt(-1)}",
        r"\pgfmathparse{random(1.5)}",
        r"\input{secret}",
        r"\def\draw{bad}",
        r"\def\start{\begin{scope}}\start\node{A};\end{scope}",
    ] {
        assert!(compile(source).is_err(), "{source}");
    }
    let error = compile("\\def\\bad{\\unknown;}\n% 日本語\n\\bad")
        .err()
        .unwrap();
    assert_eq!((error.line, error.column), (3, 1));
    let error = compile("\\foreach\\x in {1,2}{\n  \\unknown;\n}")
        .err()
        .unwrap();
    assert_eq!((error.line, error.column), (2, 3));
    // Literal # in a loop variable must never become an unchecked macro argument index.
    assert!(std::panic::catch_unwind(|| compile(r"\foreach\x in{#9}{\node{\x};}")).is_ok());
}
