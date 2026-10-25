//! Render orchestration: headers, scope state, command dispatch and SVG assembly.
mod coordinates;
mod diagram;
mod geometry;
mod glyph_path;
mod intersections;
mod label_svg;
mod markings;
mod nodes;
mod paint;
mod path_editing;
mod paths;
mod plot;
mod shading;

pub use diagram::Diagram;
use geometry::Bounds;
pub use geometry::{Node, Point};

use crate::options::{Styles, Values, number};
use crate::syntax::{Cursor, Diagnostic};
use crate::text::{Label, TextEngine};
use crate::transform::Matrix;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

const CM: f64 = 72. / 2.54;
const TRANSFORMS: &[&str] = &[
    "scale", "xscale", "yscale", "shift", "xshift", "yshift", "rotate",
];
#[derive(Clone, Default)]
struct State {
    options: Values,
    styles: Styles,
    clips: Vec<(String, Bounds)>,
    layer: Option<String>,
    canvas_shift: Point,
}
struct Engine<'a> {
    state: State,
    nodes: BTreeMap<String, Node>,
    text: &'a mut TextEngine,
    original: &'a str,
    expanded: &'a crate::expand::Expanded,
    editing: Vec<serde_json::Value>,
    objects: Vec<serde_json::Value>,
    path_endpoints: Vec<serde_json::Value>,
    path_points: Vec<serde_json::Value>,
    path_normalizations: Vec<serde_json::Value>,
    element_layers: Vec<String>,
    layers: Vec<String>,
    declared_layers: BTreeSet<String>,
    mainfont: String,
    elements: Vec<(bool, String)>,
    bbox: Bounds,
    label_id: usize,
    scale: f64,
    definitions: std::cell::RefCell<Vec<String>>,
    glyphs: label_svg::GlyphDefinitions,
    /// Offset (in the expanded text) a failure should be reported at, when it
    /// is more precise than the start of the command.
    error_at: std::cell::Cell<Option<usize>>,
    /// Where each option key of the current command was written.
    option_at: std::cell::RefCell<BTreeMap<String, usize>>,
    /// `name path` geometry: each original segment as a polyline.
    named_paths: BTreeMap<String, Vec<Vec<Point>>>,
    /// Macros defined while rendering (`total=\t`), local to one path.
    late: BTreeMap<String, String>,
    labels: Vec<String>,
    /// Rendering generated code (a marking), which has no editable source.
    synthetic: bool,
    /// Pseudocode of this source and its figure references.
    algo: crate::algo::Context,
}

pub fn compile(source: &str) -> Result<Diagram, Diagnostic> {
    compile_with_text(source, &mut TextEngine::new())
}

/// Reuse font and label caches across interactive renders. SVG output is unchanged.
pub fn compile_with_text(source: &str, text: &mut TextEngine) -> Result<Diagram, Diagnostic> {
    compile_at(source, text, None)
}

/// Like [`compile_with_text`]; `algo=<path>` files are read relative to `base`
/// (the input file's directory), or to the working directory without one.
pub fn compile_at(
    source: &str,
    text: &mut TextEngine,
    base: Option<&std::path::Path>,
) -> Result<Diagram, Diagnostic> {
    // Pseudocode environments are blanked out; offsets stay those of `source`.
    let (blanked, algorithms) = crate::algo::extract(source)?;
    let mut algo_settings = crate::algo::Settings::default();
    let expanded = crate::expand::expand(&blanked)?;
    // Math evaluated while rendering starts from the default seed as well.
    crate::expr::seed(None).expect("default seed");
    text.timings = Default::default();
    let mut e = Engine {
        state: State::default(),
        nodes: BTreeMap::new(),
        text,
        original: source,
        expanded: &expanded,
        editing: Vec::new(),
        objects: Vec::new(),
        path_endpoints: Vec::new(),
        path_points: Vec::new(),
        path_normalizations: Vec::new(),
        element_layers: Vec::new(),
        layers: vec!["background".into(), "main".into()],
        declared_layers: ["background".into(), "main".into()].into(),
        mainfont: "IPAexMincho".into(),
        elements: Vec::new(),
        bbox: Bounds::default(),
        label_id: 0,
        scale: 1.,
        definitions: Default::default(),
        glyphs: Default::default(),
        error_at: Default::default(),
        option_at: Default::default(),
        named_paths: BTreeMap::new(),
        late: BTreeMap::new(),
        labels: Vec::new(),
        synthetic: false,
        algo: Default::default(),
    };
    let mut offset = 0;
    for line in source.split_inclusive('\n') {
        let Some(header) = line.trim().strip_prefix("#|") else {
            break;
        };
        let (key, value) = header
            .split_once(':')
            .ok_or_else(|| Diagnostic::at(source, offset, "invalid source header"))?;
        let value = value.trim();
        match key.trim() {
            // Presentation metadata does not change standalone rendering or
            // override the CLI output path (same behavior as the legacy CLI).
            "filename" | "width" | "height" => {}
            "mainfont" => e.mainfont = value.into(),
            "scale" => e.scale = number(value).map_err(|m| Diagnostic::at(source, offset, m))?,
            "libraries" | "packages" => {
                let allowed = if key.trim() == "libraries" {
                    vec![
                        "arrows.meta",
                        "positioning",
                        "calc",
                        "shapes.geometric",
                        "backgrounds",
                        "fit",
                        "decorations.pathreplacing",
                        "decorations.markings",
                        "intersections",
                        "patterns",
                        "matrix",
                    ]
                } else {
                    vec!["amsmath", "amssymb", "fontawesome"]
                };
                for name in value
                    .trim_matches(['[', ']'])
                    .split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    if !allowed.contains(&name) {
                        return Err(Diagnostic::at(
                            source,
                            offset,
                            format!("Unsupported {} '{name}'", key.trim()),
                        ));
                    }
                }
            }
            key => match algo_settings.header(key, value, offset) {
                Some(result) => result.map_err(|m| Diagnostic::at(source, offset, m))?,
                None => {
                    return Err(Diagnostic::at(
                        source,
                        offset,
                        format!("Unsupported header '{key}'"),
                    ));
                }
            },
        }
        offset += line.len();
    }
    if e.scale <= 0. || e.scale > 100. {
        return Err(Diagnostic::at(source, 0, "scale must be in (0, 100]"));
    }
    e.algo = crate::algo::Context::new(source, &blanked, algo_settings, algorithms, base)?;
    // A file of only `algorithm` environments is drawn as pseudocode alone.
    if !e.algo.algorithms.is_empty() && crate::syntax::clean(&blanked).trim().is_empty() {
        return pseudocode_only(source, e.algo, e.text, e.scale);
    }
    let mut cur = Cursor::new(&expanded.text);
    let mut stack: Vec<(String, State)> = Vec::new();
    let mut pictures = 0;
    let mut insertion = None;
    loop {
        cur.ws();
        if cur.rest().is_empty() {
            break;
        }
        let at = cur.pos;
        let previous_bounds = e.bbox;
        e.bbox = Bounds::default();
        let first_element = e.elements.len();
        let first_node = e.editing.len();
        let mut object_kind = None;
        e.path_endpoints.clear();
        e.path_points.clear();
        e.path_normalizations.clear();
        e.error_at.set(None);
        e.option_at.borrow_mut().clear();
        e.late.clear();
        let result = (|| -> Result<(), String> {
            if !cur.eat("\\") {
                return Err(format!(
                    "Unsupported syntax '{}...'",
                    cur.rest().chars().take(30).collect::<String>()
                ));
            }
            let cmd = cur.word();
            match cmd {
                "begin" => {
                    let env = cur.group('{', '}')?;
                    if env != "tikzpicture" && env != "scope" && env != "pgfonlayer" {
                        return Err(format!("Unsupported environment '{env}'"));
                    }
                    if env == "tikzpicture" {
                        pictures += 1;
                    }
                    stack.push((env.into(), e.state.clone()));
                    if env == "pgfonlayer" {
                        let layer = cur.group('{', '}')?.trim();
                        if layer == "main" || !e.declared_layers.contains(layer) {
                            return Err(format!("unknown or invalid drawing layer '{layer}'"));
                        }
                        e.state.layer = Some(layer.into());
                    }
                    cur.ws();
                    if cur.rest().starts_with('[') {
                        let group_start = cur.pos + 1;
                        let opts = cur.group('[', ']')?;
                        e.locate_options(group_start, opts);
                        let mut regular = Vec::new();
                        for option in crate::syntax::split_top(opts, ',') {
                            if let Some((key, value)) = option.split_once('=')
                                && key.trim() == "transform canvas"
                            {
                                for shift in
                                    crate::syntax::split_top(crate::syntax::unbrace(value), ',')
                                {
                                    let (key, value) = shift
                                        .split_once('=')
                                        .ok_or("canvas translation requires a value")?;
                                    if !["shift", "xshift", "yshift"].contains(&key.trim()) {
                                        return Err(
                                            "Unsupported canvas transform (translations only)"
                                                .into(),
                                        );
                                    }
                                    let matrix = Matrix::option(key.trim(), value.trim())?.unwrap();
                                    e.state.canvas_shift = e.state.canvas_shift.add(Point {
                                        x: matrix.0[4],
                                        y: matrix.0[5],
                                    });
                                }
                            } else {
                                regular.push(option);
                            }
                        }
                        e.state.options = e
                            .state
                            .styles
                            .resolve(&regular.join(","), &e.state.options)
                            .map_err(|m| e.option_error(m))?;
                        e.basis(&e.state.options)?;
                    }
                }
                "end" => {
                    let env = cur.group('{', '}')?;
                    let (expected, state) = stack.pop().ok_or("unmatched end environment")?;
                    if env != expected {
                        return Err(format!("expected end of {expected}, found {env}"));
                    }
                    if env == "tikzpicture" && stack.is_empty() {
                        let start = expanded.origin(at);
                        let end = expanded.origin(cur.pos - 1) + 1;
                        // Only offer an insertion point in literal source, never
                        // inside a macro/loop expansion or a generated environment.
                        if source.get(start..end).map(crate::syntax::clean).as_deref()
                            == Some(&expanded.text[at..cur.pos])
                        {
                            insertion = Some(start);
                        }
                    }
                    e.state = state;
                }
                "definecolor" => {
                    let name = cur.group('{', '}')?;
                    let model = cur.group('{', '}')?;
                    let value = cur.group('{', '}')?;
                    e.state.styles.define_color(name, model, value)?;
                }
                "tikzset" => {
                    let options = cur.group('{', '}')?;
                    e.state.options = e.state.styles.resolve(options, &e.state.options)?;
                }
                "pgfdeclarelayer" => {
                    let name = cur.group('{', '}')?.trim();
                    if name.is_empty() || name.contains([',', '{', '}']) {
                        return Err("invalid layer name".into());
                    }
                    e.declared_layers.insert(name.into());
                }
                "pgfsetlayers" => {
                    let layers: Vec<String> = cur
                        .group('{', '}')?
                        .split(',')
                        .map(|s| s.trim().into())
                        .collect();
                    if !layers.iter().any(|s| s == "main")
                        || layers.iter().any(|s| !e.declared_layers.contains(s))
                        || layers.iter().collect::<BTreeSet<_>>().len() != layers.len()
                    {
                        return Err(
                            "layer order requires declared, unique layers including main".into(),
                        );
                    }
                    e.layers = layers;
                }
                "matrix" => {
                    object_kind = Some("matrix");
                    e.matrix(&mut cur)?;
                }
                "node" => {
                    object_kind = Some("node");
                    let pending = e.parse_node(&mut cur, false)?;
                    if !cur.eat(";") {
                        return Err("expected ';' after node".into());
                    }
                    e.place_node(pending, None)?;
                }
                "coordinate" => {
                    let name = cur.group('(', ')')?.trim().to_owned();
                    if !cur.eat("at") {
                        return Err("coordinate requires 'at'".into());
                    }
                    let point = e.read_point(&mut cur, Point::default())?.0;
                    if !cur.eat(";") {
                        return Err("expected ';' after coordinate".into());
                    }
                    e.nodes.insert(
                        name,
                        Node {
                            center: point,
                            width: 0.,
                            height: 0.,
                            shape: "coordinate".into(),
                            rotation: 0.,
                            cylinder_cap: 0.,
                            baseline: 0.,
                            outer_xsep: 0.,
                            outer_ysep: 0.,
                            transform: Matrix::default(),
                        },
                    );
                }
                "pgfmathsetseed" => {
                    crate::expr::seed(Some(number(cur.group('{', '}')?)?))?;
                }
                "draw" | "path" | "fill" | "filldraw" | "clip" | "shade" | "shadedraw" => {
                    if cmd != "clip" {
                        object_kind = Some("path");
                    }
                    let saved = e.state.clone();
                    let result = e.path(&mut cur, cmd);
                    let clips = e.state.clips.clone();
                    e.state = saved;
                    if cmd == "clip" {
                        e.state.clips = clips;
                    }
                    result?;
                }
                _ => return Err(format!("Unsupported command \\{cmd}")),
            }
            Ok(())
        })();
        if let Err(message) = result {
            let offset = e.error_at.take().unwrap_or(at);
            return Err(Diagnostic::at(source, expanded.origin(offset), message));
        }
        // Canvas translations move a whole path, including references to named
        // anchors and its labels, without rewriting its coordinate expressions.
        let shift = e.state.canvas_shift;
        if object_kind.is_some() && (shift.x != 0. || shift.y != 0.) {
            for (_, element) in &mut e.elements[first_element..] {
                *element = format!(
                    "<g transform=\"translate({:.5},{:.5})\">{element}</g>",
                    shift.x, -shift.y
                );
            }
            e.bbox.min = e.bbox.min.add(shift);
            e.bbox.max = e.bbox.max.add(shift);
            for node in &mut e.editing[first_node..] {
                for (key, delta) in [("x", shift.x), ("y", shift.y)] {
                    node[key] = (node[key].as_f64().unwrap() + delta).into();
                }
                node["bounds"][0] = (node["bounds"][0].as_f64().unwrap() + shift.x).into();
                node["bounds"][1] = (node["bounds"][1].as_f64().unwrap() - shift.y).into();
            }
        }
        for (id, bounds) in &e.state.clips {
            for (_, element) in &mut e.elements[first_element..] {
                *element = format!("<g clip-path=\"url(#{id})\">{element}</g>");
            }
            e.bbox.min.x = e.bbox.min.x.max(bounds.min.x);
            e.bbox.min.y = e.bbox.min.y.max(bounds.min.y);
            e.bbox.max.x = e.bbox.max.x.min(bounds.max.x);
            e.bbox.max.y = e.bbox.max.y.min(bounds.max.y);
        }
        for (background, _) in &e.elements[first_element..] {
            e.element_layers
                .push(e.state.layer.clone().unwrap_or_else(|| {
                    if *background {
                        "background".into()
                    } else {
                        "main".into()
                    }
                }));
        }
        if let Some(kind) = object_kind.filter(|_| e.elements.len() > first_element) {
            let start = expanded.origin(at);
            let end = expanded.origin(cur.pos - 1) + 1;
            let literal = source.get(start..end).map(crate::syntax::clean).as_deref()
                == Some(&expanded.text[at..cur.pos]);
            let layers = &e.element_layers[first_element..];
            let layer = &layers[0];
            for node in &mut e.editing[first_node..] {
                node["objectId"] = start.into();
            }
            e.objects.push(serde_json::json!({
                "id": start, "start": start, "end": end, "kind": kind,
                "editable": literal && layers.iter().all(|l| l == layer),
                "endpoints": if literal { e.path_endpoints.clone() } else { Vec::new() },
                "pathPoints": if literal { e.path_points.clone() } else { Vec::new() },
                "pathNormalizations": if literal { e.path_normalizations.clone() } else { Vec::new() },
                "layer": layer,
                "bounds": [e.bbox.min.x, -e.bbox.max.y, e.bbox.max.x-e.bbox.min.x, e.bbox.max.y-e.bbox.min.y],
            }));
        }
        let current_bounds = e.bbox;
        e.bbox = previous_bounds;
        if current_bounds.min.x <= current_bounds.max.x
            && current_bounds.min.y <= current_bounds.max.y
        {
            e.bbox.point(current_bounds.min);
            e.bbox.point(current_bounds.max);
        }
    }
    if let Some((env, _)) = stack.last() {
        return Err(Diagnostic::at(
            source,
            source.len(),
            format!("unclosed {env}"),
        ));
    }
    if !e.bbox.min.x.is_finite() {
        // An empty document is a usable canvas for the first GUI insertion.
        // Keep the same blank artifact for preview and CLI/export.
        e.bbox.point(Point::default());
        e.bbox.point(Point {
            x: 10. * CM,
            y: 6. * CM,
        });
    }
    let border = 2. * 72. / 72.27;
    let mut w = (e.bbox.max.x - e.bbox.min.x + 2. * border).max(1.);
    let mut h = (e.bbox.max.y - e.bbox.min.y + 2. * border).max(1.);
    let mut view = (e.bbox.min.x - border, -e.bbox.max.y - border);
    // Without an `algo=` node, the first algorithm goes beside the figure.
    let mut placement = None;
    // Output size in pt when a canvas or placement fixes it.
    let mut canvas = None;
    let mut drawn: Vec<usize> = Vec::new();
    let mut pseudocode = String::new();
    if e.algo.placed.is_empty() && !e.algo.algorithms.is_empty() {
        let algorithm = &e.algo.algorithms[0];
        let fail = |m: String| Diagnostic::at(source, algorithm.offset, m);
        let label = e
            .text
            .layout_markup(&e.algo.document(algorithm).map_err(fail)?)
            .map_err(fail)?;
        let p = crate::algo::render::place(&e.algo.settings, (label.width, label.height), (w, h))
            .map_err(|m| {
            let at = ["canvas", "algo-scale", "gap"]
                .iter()
                .find_map(|k| e.algo.settings.headers.get(k).copied())
                .unwrap_or(algorithm.offset);
            Diagnostic::at(source, at, m)
        })?;
        // Keep figure coordinates (the editor maps them through the viewBox):
        // scale the canvas and the pseudocode by the inverse figure scale.
        let s = p.figure_scale;
        let to_figure =
            |(x, y): (f64, f64)| (view.0 + (x - p.figure.0) / s, view.1 + (y - p.figure.1) / s);
        let (ax, ay) = to_figure(p.algo);
        let id = e.label_id;
        e.label_id += 1;
        let svg = e.glyphs.embed(&label.svg, id).map_err(fail)?;
        pseudocode = format!(
            "<g transform=\"translate({ax:.5},{ay:.5}) scale({:.6})\">{svg}</g>",
            p.algo_scale / s
        );
        view = to_figure((0., 0.));
        w = p.canvas.0 / s;
        h = p.canvas.1 / s;
        canvas = Some(p.canvas);
        placement = Some(p);
        drawn.push(0);
    } else if let Some((cw, ch)) = e.algo.settings.canvas.filter(|_| !e.algo.placed.is_empty()) {
        // With `algo=` nodes (and their arrows) the whole figure is scaled to
        // fit the canvas and centred, again in figure coordinates.
        let (cw, ch) = (cw * crate::algo::render::PX, ch * crate::algo::render::PX);
        let s = (cw / w).min(ch / h);
        view = (view.0 - (cw / s - w) / 2., view.1 - (ch / s - h) / 2.);
        w = cw / s;
        h = ch / s;
        canvas = Some((cw, ch));
    }
    let rank = |name: &str| e.layers.iter().position(|l| l == name);
    let mut elements: Vec<_> = e
        .elements
        .into_iter()
        .zip(&e.element_layers)
        .filter_map(|((_, svg), layer)| rank(layer).map(|r| (r, svg)))
        .collect();
    elements.sort_by_key(|(r, _)| *r);
    let mut order: Vec<usize> = (0..e.objects.len()).collect();
    order.sort_by_key(|i| rank(e.objects[*i]["layer"].as_str().unwrap()));
    for (position, i) in order.into_iter().enumerate() {
        e.objects[i]["order"] = position.into();
        e.objects[i]["visible"] = rank(e.objects[i]["layer"].as_str().unwrap())
            .is_some()
            .into();
    }
    let body = format!(
        "<defs>{}{}</defs>{}",
        e.definitions.into_inner().join(""),
        e.glyphs
            .svg()
            .map_err(|m| Diagnostic::at(source, source.len(), m))?,
        elements.into_iter().map(|(_, s)| s).collect::<String>() + &pseudocode
    );
    let width = w * e.scale;
    let height = h * e.scale;
    if !width.is_finite() || !height.is_finite() || width > 1e7 || height > 1e7 {
        return Err(Diagnostic::at(
            source,
            0,
            "diagram dimensions exceed native limits",
        ));
    }
    let width = canvas.map_or(width, |c| c.0 * e.scale);
    let height = canvas.map_or(height, |c| c.1 * e.scale);
    let svg = svg_root(width, height, view, (w, h), &body);
    let anchors: Vec<_> = e.nodes.iter().flat_map(|(name, node)| {
        ["center", "north", "south", "east", "west", "north east", "north west", "south east", "south west"]
            .into_iter().filter_map(move |anchor| node.anchor(anchor).ok().map(|point|
                serde_json::json!({"reference": format!("{name}.{anchor}"), "x": point.x, "y": point.y})))
    }).collect();
    let lints = {
        let mut algorithms: Vec<_> = drawn.iter().map(|i| &e.algo.algorithms[*i]).collect();
        for (value, _) in &e.algo.placed {
            if let Some(a) = e.algo.resolve(value)
                && !algorithms.iter().any(|d| std::ptr::eq(*d, a))
            {
                algorithms.push(a);
            }
        }
        crate::algo::lint::check(&e.algo, &algorithms, true, placement.as_ref())
    };
    Ok(Diagram {
        svg,
        width,
        height,
        nodes: e.nodes,
        labels: e.labels,
        lints,
        text_timings: e.text.timings,
        editing: serde_json::json!({
            "viewBox": [view.0, view.1, w, h],
            "nodes": e.editing,
            "objects": e.objects,
            "anchors": anchors,
            "layers": e.layers,
            "insertionOffset": if pictures == 0 { Some(source.len()) }
                else if pictures == 1 { insertion } else { None },
        }),
    })
}

fn svg_root(width: f64, height: f64, view: (f64, f64), (w, h): (f64, f64), body: &str) -> String {
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"{width:.5}pt\" height=\"{height:.5}pt\" viewBox=\"{:.5} {:.5} {w:.5} {h:.5}\" fill-opacity=\"1\" stroke-opacity=\"1\" fill-rule=\"nonzero\" stroke-linecap=\"butt\">{body}</svg>\n",
        view.0, view.1
    )
}

/// The first algorithm of a source without a figure, with the figure border.
fn pseudocode_only(
    source: &str,
    algo: crate::algo::Context,
    text: &mut TextEngine,
    scale: f64,
) -> Result<Diagram, Diagnostic> {
    let algorithm = &algo.algorithms[0];
    let fail = |m: String| Diagnostic::at(source, algorithm.offset, m);
    let label = text
        .layout_markup(&algo.document(algorithm).map_err(fail)?)
        .map_err(fail)?;
    let mut glyphs = label_svg::GlyphDefinitions::default();
    let svg = glyphs.embed(&label.svg, 0).map_err(fail)?;
    let k = algo.settings.scale;
    let border = 2. * 72. / 72.27;
    let (w, h) = (
        label.width * k + 2. * border,
        label.height * k + 2. * border,
    );
    let body = format!(
        "<defs>{}</defs><g transform=\"translate({border:.5},{border:.5}) scale({k:.6})\">{svg}</g>",
        glyphs.svg().map_err(fail)?
    );
    let (width, height) = (w * scale, h * scale);
    let lints = crate::algo::lint::check(&algo, &[algorithm], false, None);
    Ok(Diagram {
        svg: svg_root(width, height, (0., 0.), (w, h), &body),
        width,
        height,
        nodes: BTreeMap::new(),
        labels: Vec::new(),
        lints,
        text_timings: text.timings,
        editing: serde_json::json!({
            "viewBox": [0., 0., w, h],
            "nodes": [],
            "objects": [],
            "anchors": [],
            "layers": ["background", "main"],
            "insertionOffset": null,
        }),
    })
}

#[derive(Clone)]
struct Pending {
    options: Values,
    name: Option<String>,
    point: Option<Point>,
    label: Arc<Label>,
    edit_source: Option<(usize, usize, usize)>,
    move_matrix: [f64; 4],
    /// Pseudocode line nodes (`algo=`): name suffixes, the top/bottom of the
    /// line measured down from the top of the label, and the left/right of
    /// the ruled body measured from the left of the label.
    lines: Vec<(Vec<String>, [f64; 4])>,
}

impl Engine<'_> {
    /// Remember where each top-level key of an option group was written.
    fn locate_options(&self, start: usize, raw: &str) {
        // A marking's cursor is local to generated code, not expanded.text.
        if self.synthetic {
            return;
        }
        let mut positions = self.option_at.borrow_mut();
        for part in crate::syntax::split_top(raw, ',') {
            let key = part.split('=').next().unwrap_or(part).trim();
            positions.insert(
                key.to_owned(),
                start + (part.as_ptr() as usize - raw.as_ptr() as usize),
            );
        }
    }
    /// Report a failure at the key it is about, when that key is in the source.
    fn fail_at_option(&self, key: &str) {
        if let Some(offset) = self.option_at.borrow().get(key) {
            self.error_at.set(Some(*offset));
        }
    }
    fn option_error(&self, message: String) -> String {
        if let Some(key) = message
            .strip_prefix("Unsupported option '")
            .and_then(|m| m.strip_suffix('\''))
        {
            self.fail_at_option(key);
        }
        message
    }
    /// Read a `[...]` group and resolve it on top of `base`.
    fn options(&mut self, cur: &mut Cursor<'_>, base: &Values) -> Result<Values, String> {
        cur.ws();
        let start = cur.pos + 1;
        let raw = cur.group('[', ']')?;
        self.locate_options(start, raw);
        self.state
            .styles
            .resolve(raw, base)
            .map_err(|m| self.option_error(m))
    }
    /// Replace macros defined while rendering; a no-op for most diagrams.
    fn late_text<'t>(&self, text: &'t str) -> std::borrow::Cow<'t, str> {
        if self.late.is_empty() || !text.contains('\\') {
            return text.into();
        }
        let mut result = text.to_owned();
        for (name, value) in &self.late {
            result = plot::substitute(&result, name, value);
        }
        result.into()
    }
}
