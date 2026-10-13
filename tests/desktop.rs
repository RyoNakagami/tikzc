//! Synthetic regressions for syntax found by the opt-in Desktop audit.
//! No private diagrams or installed fonts are required by this test suite.
use tikzc::compile;
const CM: f64 = 72. / 2.54;
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-6, "{a} != {b}");
}

#[test]
fn unbraced_nested_loops_counters_empty_fields_and_scope() {
    let d=compile(r"\def\i{9}\foreach\x/\label[count=\i from 3] in {1/A,2/,3/C} \node(n\i)at(\x,\i){\label};\foreach\a in{0,1}\foreach\b in{0,1}{\coordinate(p\a\b)at(\a,\b);}\coordinate(saved)at(\i,0);").unwrap();
    assert_eq!(d.nodes.len(), 8);
    near(d.nodes["n4"].center.x, 2. * CM);
    near(d.nodes["n4"].center.y, 4. * CM);
    near(d.nodes["p11"].center.y, CM);
    near(d.nodes["saved"].center.x, 9. * CM);
    // A semicolon inside a label is not the end of the loop body.
    assert_eq!(
        compile(r"\foreach\x in{1,2}\node(n\x)at(\x,0){A;B};")
            .unwrap()
            .nodes
            .len(),
        2
    );
}

#[test]
fn text_commands_math_bridge_and_table() {
    let d=compile(r"\node[draw,align=left,font=\small] {\textcolor{blue}{\textbf{日本語}}\enspace\textcircled{\scriptsize 1}\\[2pt]\hspace{1.2em}\texttt{a\^{}b\textless{}x\textgreater{}}\dots\\\phantom{hidden}\textbf{visible}\\$x\!+\text{label}+\texttt{mono}+\displaystyle\frac{1}{2}$\\$\bigl(\begin{smallmatrix}1&2\\3&4\end{smallmatrix}\bigr)$\\\begin{tabular}{l|r}name&value\\\hline A&$+1$\\B&$-2$\end{tabular}\\\faFolderOpen\ \faFileO};").unwrap();
    assert!(d.png(100.).unwrap().len() > 1000);
    assert!(d.svg.contains("#0000ff"));
    assert_eq!(d.svg,compile(r"\node[draw,align=left,font=\small] {\textcolor{blue}{\textbf{日本語}}\enspace\textcircled{\scriptsize 1}\\[2pt]\hspace{1.2em}\texttt{a\^{}b\textless{}x\textgreater{}}\dots\\\phantom{hidden}\textbf{visible}\\$x\!+\text{label}+\texttt{mono}+\displaystyle\frac{1}{2}$\\$\bigl(\begin{smallmatrix}1&2\\3&4\end{smallmatrix}\bigr)$\\\begin{tabular}{l|r}name&value\\\hline A&$+1$\\B&$-2$\end{tabular}\\\faFolderOpen\ \faFileO};").unwrap().svg);
}

#[test]
fn plot_controls_follow_pgf_tension_and_postfix_labels_end_at_endpoint() {
    let d=compile(r"\draw plot[smooth,tension=0.5]coordinates{(0bp,0bp)(10bp,10bp)(20bp,0bp)}node(end){};\draw(0,0)--node(mid){}(4,0)node(last){};\draw plot coordinates{(0,0)(1,1)};").unwrap();
    assert!(
        d.svg
            .contains("C 0.00000,-0.00000 7.22500,-10.00000 10.00000,-10.00000")
    );
    near(d.nodes["end"].center.x, 20.);
    near(d.nodes["last"].center.x, 4. * CM);
    near(d.nodes["mid"].center.x, 2. * CM);
    compile(r"\fill[blue!20]plot[smooth]coordinates{(0,0)(1,1)(2,0)}--plot[smooth]coordinates{(2,-1)(1,0)(0,-1)}--cycle;").unwrap();
}

#[test]
fn brace_direction_mirror_bounds_and_color() {
    let normal =
        compile(r"\draw[decorate,decoration={brace,amplitude=4bp},blue](0bp,0bp)--(100bp,0bp);")
            .unwrap();
    let mirror = compile(
        r"\draw[decorate,decoration={brace,amplitude=4bp,mirror},blue](0bp,0bp)--(100bp,0bp);",
    )
    .unwrap();
    assert!(normal.svg.contains("50.00000,-4.00000"));
    assert!(mirror.svg.contains("50.00000,4.00000"));
    near(normal.height, 4. + 4. * 72. / 72.27);
    assert!(normal.svg.contains("stroke=\"#0000ff\""));
    let d =
        compile(r"\fill[red](0,0)rectangle(1,1);\fill[color=blue](2,0)rectangle(3,1);").unwrap();
    assert!(d.svg.contains("fill=\"#ff0000\""));
    assert!(d.svg.contains("fill=\"#0000ff\""));
}

#[test]
fn coordinate_options_intersections_and_node_at() {
    let d=compile(r"\tikzset{outer sep=0}\begin{scope}[scale=2]\node(a)at(1,1){};\coordinate(b)at([xshift=1cm]a);\end{scope}\node[at={(a.north)}](top){};\node[below=1cm of a -| b,inner sep=0](below){};\coordinate(c)at(3,{0} |- {$(a)+(0,1)$});").unwrap();
    near(d.nodes["b"].center.x, 4. * CM);
    near(
        d.nodes["top"].center.y,
        d.nodes["a"].center.y + d.nodes["a"].height / 2.,
    );
    near(d.nodes["below"].center.x, 4. * CM);
    near(d.nodes["below"].center.y, CM);
    near(d.nodes["c"].center.y, 3. * CM);
}

#[test]
fn bezier_relative_second_control_uses_destination() {
    let d = compile(r"\draw(0bp,0bp)..controls +(10bp,10bp)and+(-10bp,10bp)..(40bp,0bp);").unwrap();
    assert!(
        d.svg
            .contains("C 10.00000,-10.00000 30.00000,-10.00000 40.00000,-0.00000")
    );
    let d = compile(r"\tikzset{outer sep=0}\node[draw,minimum size=20bp,inner sep=0](a){};\node[draw,minimum size=20bp,inner sep=0](b)at(100bp,0bp){};\draw(a)..controls +(0bp,40bp)and+(0bp,40bp)..(b);").unwrap();
    assert!(d.svg.contains("M 0.00000,-10.00000"));
    assert!(d.svg.contains("100.00000,-10.00000"));
}

#[test]
fn diamond_cylinder_grid_labels_and_bar_tips() {
    let d=compile(r"\node[diamond,aspect=2,draw](diamond){Yes?};\node[cylinder,shape border rotate=90,aspect=.1,draw,below=1cm of diamond](db){DB};\draw[|<->|](0,-3)--(3,-3);\draw[step=5mm](0,-4)grid(2,-5);\node[draw,label={[red,name=lab]45:Label},label=below:Bottom](n)at(4,0){A};").unwrap();
    near(d.nodes["diamond"].width / d.nodes["diamond"].height, 2.);
    assert!(d.nodes["db"].cylinder_cap > 0.);
    assert!(d.nodes["lab"].center.x > d.nodes["n"].center.x);
    assert!(d.nodes["lab"].center.y > d.nodes["n"].center.y);
    assert!(d.svg.contains("#ff0000"));
    assert!(d.png(100.).unwrap().len() > 1000);
    for name in ["grid", "node-label", "unsupported-plot"] {
        let source = std::fs::read_to_string(format!(
            "{}/tests/fixtures/{name}.tikz",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap();
        compile(&source).unwrap();
    }
}

#[test]
fn ignored_presentation_metadata_does_not_change_rendering() {
    let raw = r"\node{A};";
    let headers = format!("#| filename: elsewhere\n#| width: 50%\n#| height: 20cm\n{raw}");
    assert_eq!(compile(raw).unwrap().svg, compile(&headers).unwrap().svg);
}

#[test]
fn japanese_question_mark_keeps_full_advance() {
    // GB punctuation rules compress a Japanese full-width question mark as if
    // it were left aligned, clipping its right half in a nested SVG viewport.
    let d=compile(r"\node[font=\normalsize,inner sep=0](q){何？};\node[font=\normalsize,inner sep=0](a){何何};").unwrap();
    near(d.nodes["q"].width, d.nodes["a"].width);
}

#[test]
fn unsupported_variants_remain_explicit_and_bounded() {
    let nested = format!("{}\\node{{A}};", r"\foreach\x in{1}".repeat(100));
    assert!(compile(&nested).err().unwrap().message.contains("64"));
    for raw in [
        r"\foreach\x[evaluate=\x]in{1}\node{\x};",
        r"\foreach\x[count=\node]in{1}\node{\x};",
        r"\foreach\x in{1,2}\node{A}",
        r"\node{\begin{tabular}{p{2cm}}A\end{tabular}};",
        r"\node{\begin{tabular}{c|r}A\end{tabular}};",
        r"\draw plot[domain=0:1](\x,\x);",
        r"\draw[decorate,decoration={snake}](0,0)--(1,0);",
        r"\draw[decorate,decoration={brace}](0,0)to[bend left](1,0);",
        r"\draw[step=0](0,0)grid(1,1);",
        r"\draw[step=0.000001](0,0)grid(1,1);",
        r"\node[cylinder]{A};",
        r"\node[diamond,aspect=0]{A};",
        r"\node[label={[scale=2]above:A}]{B};",
    ] {
        assert!(compile(raw).is_err(), "must reject {raw}");
    }
}
