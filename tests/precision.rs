use tikzc::{
    compile,
    options::{Styles, Values},
    text::TextEngine,
};
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-4, "{a} != {b}");
}
#[test]
fn actual_baselines_and_baseline_skip() {
    let d=compile(r"\node[anchor=base](a){Ag};\node[anchor=base,font=\Large](b)at(3,0){日本語};\coordinate(ba)at(a.base);\coordinate(bb)at(b.base);").unwrap();
    near(d.nodes["ba"].center.y, 0.);
    near(d.nodes["bb"].center.y, 0.);
    let mut t = TextEngine::new();
    let s = Styles::default();
    let one = t.layout("Ag", &Values::new(), &s, "IPAexMincho").unwrap();
    let two = t
        .layout(r"Ag\\Ag", &Values::new(), &s, "IPAexMincho")
        .unwrap();
    near(two.height - one.height, 12. * 72. / 72.27);
    near(two.baseline - one.baseline, two.height - one.height);
    let mixed = t
        .layout(r"Ag\\\scriptsize Ag", &Values::new(), &s, "IPAexMincho")
        .unwrap();
    near(mixed.baseline - one.baseline, 12. * 72. / 72.27);
    let mut opts = Values::new();
    opts.insert("font".into(), r"\fontsize{10}{18}\selectfont".into());
    let larger = t.layout(r"Ag\\Ag", &opts, &s, "IPAexMincho").unwrap();
    near(larger.height - one.height, 18. * 72. / 72.27);
    opts.insert("text width".into(), "3cm".into());
    let first = t.layout(r"Ag\\Ag", &opts, &s, "IPAexMincho").unwrap();
    near(first.baseline, one.baseline);
    let circled = t
        .layout(
            r"\textcircled{\scriptsize 1}",
            &Values::new(),
            &s,
            "IPAexMincho",
        )
        .unwrap();
    assert!(
        circled.height < 12. && circled.width < 12.,
        "circled digits must not grow with the paragraph strut"
    );
}
#[test]
fn latin_modern_mono_advances_and_japanese_fallback() {
    let mut t = TextEngine::new();
    let s = Styles::default();
    let o = Values::new();
    let narrow = t.layout(r"\texttt{iiii}", &o, &s, "IPAexMincho").unwrap();
    let wide = t.layout(r"\texttt{WWWW}", &o, &s, "IPAexMincho").unwrap();
    near(narrow.width, wide.width);
    near(wide.width, 4. * 5.25 * 72. / 72.27);
    let jp = t
        .layout(r"\texttt{A日本語B}", &o, &s, "IPAexMincho")
        .unwrap();
    assert!(jp.width > wide.width);
}
#[test]
fn outer_sep_changes_connections_not_shape_size() {
    let d=compile(r"\node[minimum width=20bp,minimum height=10bp,line width=2bp,inner sep=0](a){};\coordinate(e)at(a.east);\node[minimum width=20bp,minimum height=10bp,inner sep=0,outer xsep=3bp,outer ysep=4bp](b)at(50bp,0){};\coordinate(be)at(b.east);\coordinate(bn)at(b.north);").unwrap();
    near(d.nodes["a"].width, 20.);
    near(d.nodes["e"].center.x, 11.);
    near(d.nodes["be"].center.x, 63.);
    near(d.nodes["bn"].center.y, 9.);
}
#[test]
fn inherited_and_local_shape_transforms_and_disable() {
    let d=compile(r"\tikzset{minimum width=20bp,minimum height=10bp,inner sep=0,outer sep=0}\begin{scope}[scale=2,rotate=90]\node(a)at(1,0){};\node[transform shape](b)at(2,0){};\node[transform shape=false,scale=3](c)at(3,0){};\end{scope}\coordinate(ae)at(a.east);\coordinate(be)at(b.east);\coordinate(ce)at(c.east);\node[xscale=-2](r){};\coordinate(re)at(r.east);").unwrap();
    near(d.nodes["ae"].center.x, 10.);
    near(d.nodes["be"].center.x, 0.);
    near(d.nodes["be"].center.y - d.nodes["b"].center.y, 20.);
    near(d.nodes["ce"].center.x, 30.);
    near(d.nodes["re"].center.x, -20.);
}
#[test]
fn curved_shortening_and_open_tips_keep_curves() {
    for tip in ["Latex", "Latex[open]", "Stealth", "Triangle"] {
        let s = format!(
            r"\draw[-{{{tip}}},shorten >=3bp,shorten <=2bp](0,0)..controls(0,2)and(3,2)..(3,0);"
        );
        let d = compile(&s).unwrap();
        assert!(d.svg.contains(" C "));
        assert!(d.png(100.).unwrap().len() > 100);
    }
    assert!(compile(r"\draw[shorten >=2bp](0,0)--(1,0)--cycle;").is_err());
    // Initial coordinate moves are not extra drawn subpaths.
    compile(r"\node(a){A};\draw[->](a.south)++(-0.6,0)--(0,-2);").unwrap();
    let d=compile(r"\tikzset{outer sep=0}\node[minimum size=20bp,inner sep=0](a){};\node[minimum size=20bp,inner sep=0](b)at(100bp,0){};\draw(a)to[out=90,in=90](b);").unwrap();
    assert!(d.svg.contains("M 0.00000,-10.00000"));
    assert!(d.svg.contains("100.00000,-10.00000"));
}
#[test]
fn clip_scope_intersection_and_restoration() {
    let d=compile(r"\begin{scope}\clip(0,0)rectangle(1,1);\clip(0.5,0)rectangle(2,2);\fill[red](-2,-2)rectangle(3,3);\end{scope}\fill[blue](2,0)rectangle(3,1);").unwrap();
    assert_eq!(d.svg.matches("<clipPath ").count(), 2);
    assert_eq!(d.svg.matches("<g clip-path=").count(), 2);
    near(d.width, 2.5 * 72. / 2.54 + 4. * 72. / 72.27);
    assert!(compile(r"\clip(0,0)node{x}--(1,0);").is_err());
}
#[test]
fn matrix_named_cells_spacing_styles_and_patterns() {
    let d=compile(r"\matrix(m)[matrix of nodes,nodes={draw,minimum size=10bp,inner sep=0,outer sep=0},column sep=5bp,row sep=7bp]{A&B\\C&|[fill=blue!10]|D\\};\draw[->](m-1-1)--(m-2-2);\fill[pattern=north east lines,pattern color=red](3,0)rectangle(4,1);").unwrap();
    assert!(d.nodes.contains_key("m-2-2"));
    near(d.nodes["m-1-2"].center.x - d.nodes["m-1-1"].center.x, 15.);
    assert!(d.nodes["m-1-1"].center.y > d.nodes["m-2-1"].center.y);
    assert!(d.svg.contains("<pattern "));
    for bad in [
        r"\matrix[matrix of nodes]{A&B\\C\\};",
        r"\fill[pattern=unknown](0,0)rectangle(1,1);",
        r"\matrix[matrix of nodes,nodes={rotate=30}]{A\\};",
    ] {
        assert!(compile(bad).is_err());
    }
}
