//! Node and matrix placement, including text anchors.
use super::geometry::Bounds;
use super::paint::{double_strokes, line_width, opacity_attribute};
use super::paths::PathTiming;
use super::{CM, Engine, Node, Pending, Point, TRANSFORMS};
use crate::options::{Values, dim, get, length, number};
use crate::syntax::{Cursor, unbrace};
use crate::transform::Matrix;

impl Engine<'_> {
    /// Limited rectangular matrix; unsupported cells and spans remain diagnostics.
    pub(super) fn matrix(&mut self, cur: &mut Cursor<'_>) -> Result<(), String> {
        let mut options = self.state.options.clone();
        let mut name = None;
        let mut at = None;
        loop {
            cur.ws();
            if cur.rest().starts_with('[') {
                options = self.state.styles.resolve(cur.group('[', ']')?, &options)?;
            } else if cur.eat("at") {
                at = Some(self.read_point(cur, Point::default())?.0);
            } else if cur.rest().starts_with('(') {
                name = Some(cur.group('(', ')')?.trim().to_owned());
            } else {
                break;
            }
        }
        if !options.contains_key("matrix of nodes") {
            return Err("Unsupported matrix (requires matrix of nodes)".into());
        }
        if TRANSFORMS
            .iter()
            .any(|k| options.get(*k) != self.state.options.get(*k))
            || options.contains_key("transform shape")
            || options.contains_key("fit")
        {
            return Err(
                "Unsupported transformed/fit matrix; place an untransformed matrix at a coordinate"
                    .into(),
            );
        }
        let body = cur.group('{', '}')?;
        if !cur.eat(";") {
            return Err("expected ';' after matrix".into());
        }
        let rows = matrix_rows(body)?;
        let cols = rows[0].len();
        let mut base = Values::new();
        for key in [
            "font",
            "text",
            "opacity",
            "text opacity",
            "on background layer",
        ] {
            if let Some(v) = options.get(key) {
                base.insert(key.into(), v.clone());
            }
        }
        base.insert("anchor".into(), "base".into());
        if let Some(every) = self.state.styles.definitions.get("every node").cloned() {
            base = self.state.styles.resolve(&every, &base)?;
        }
        if let Some(nodes) = options.get("nodes") {
            base = self.state.styles.resolve(nodes, &base)?;
        }
        let elements = self.elements.len();
        let bounds = self.bbox;
        let saved_nodes = self.nodes.clone();
        let defs = self.definitions.borrow().len();
        let glyphs = self.glyphs.checkpoint();
        let label_id = self.label_id;
        let editing = self.editing.len();
        let mut cells = Vec::new();
        let mut left = vec![0f64; cols];
        let mut right = left.clone();
        let mut top = vec![0f64; rows.len()];
        let mut bottom = top.clone();
        for (r, row) in rows.iter().enumerate() {
            for (c, text) in row.iter().enumerate() {
                let mut opts = base.clone();
                let mut content = Cursor::new(text);
                if content.eat("|") {
                    opts = self.state.styles.resolve(content.group('[', ']')?, &opts)?;
                    if !content.eat("|") {
                        return Err("expected closing | after matrix cell options".into());
                    }
                }
                if opts.contains_key("_matrix")
                    || opts.contains_key("fit")
                    || opts.keys().any(|k| k.starts_with("_label "))
                    || [
                        "above",
                        "below",
                        "left",
                        "right",
                        "above left",
                        "above right",
                        "below left",
                        "below right",
                        "at",
                        "name",
                    ]
                    .iter()
                    .any(|k| opts.contains_key(*k))
                {
                    return Err("Unsupported positioned/transformed/labeled matrix cell".into());
                }
                let cell_name = format!(
                    "{}-{}-{}",
                    name.as_deref().unwrap_or("matrix"),
                    r + 1,
                    c + 1
                );
                let pending = Pending {
                    edit_source: None,
                    move_matrix: [1., 0., 0., 1.],
                    lines: Vec::new(),
                    label: self.text.layout(
                        content.rest(),
                        &opts,
                        &self.state.styles,
                        &self.mainfont,
                    )?,
                    options: opts,
                    name: Some(cell_name.clone()),
                    point: Some(Point::default()),
                };
                self.place_node(pending.clone(), None)?;
                let n = &self.nodes[&cell_name];
                left[c] = left[c].max(n.width / 2. + n.outer_xsep - n.center.x);
                right[c] = right[c].max(n.width / 2. + n.outer_xsep + n.center.x);
                top[r] = top[r].max(n.height / 2. + n.outer_ysep + n.center.y);
                bottom[r] = bottom[r].max(n.height / 2. + n.outer_ysep - n.center.y);
                cells.push((r, c, pending));
            }
        }
        self.elements.truncate(elements);
        self.bbox = bounds;
        self.nodes = saved_nodes;
        self.definitions.borrow_mut().truncate(defs);
        self.glyphs.rollback(glyphs);
        self.label_id = label_id;
        self.editing.truncate(editing);
        let column_sep = dim(&options, "column sep", 0.)?;
        let row_sep = dim(&options, "row sep", 0.)?;
        if column_sep < 0. || row_sep < 0. {
            return Err("Unsupported negative matrix separation".into());
        }
        let mut xs = vec![0.; cols];
        let mut ys = vec![0.; rows.len()];
        let mut width = 0.;
        for c in 0..cols {
            xs[c] = width + left[c];
            width += left[c] + right[c] + if c + 1 < cols { column_sep } else { 0. };
        }
        let mut height = 0.;
        for r in 0..rows.len() {
            ys[r] = -height - top[r];
            height += top[r] + bottom[r] + if r + 1 < rows.len() { row_sep } else { 0. };
        }
        let mut outer = options.clone();
        for key in [
            "matrix of nodes",
            "nodes",
            "row sep",
            "column sep",
            "_matrix",
        ] {
            outer.remove(key);
        }
        let sep = crate::text::font_dim(
            &outer,
            "inner sep",
            crate::text::font_metrics(get(&outer, "font", ""))?.0 / 3.,
        )?;
        outer.insert(
            "minimum width".into(),
            format!("{}bp", width + 2. * dim(&outer, "inner xsep", sep)?),
        );
        outer.insert(
            "minimum height".into(),
            format!("{}bp", height + 2. * dim(&outer, "inner ysep", sep)?),
        );
        let outer_name = name.unwrap_or_else(|| format!("matrix-anonymous-{}", self.label_id));
        let label = self
            .text
            .layout("", &outer, &self.state.styles, &self.mainfont)?;
        self.place_node(
            Pending {
                edit_source: None,
                move_matrix: [1., 0., 0., 1.],
                lines: Vec::new(),
                options: outer,
                name: Some(outer_name.clone()),
                point: at,
                label,
            },
            None,
        )?;
        let center = self.nodes[&outer_name].center;
        for (r, c, mut pending) in cells {
            pending.point = Some(center.add(Point {
                x: xs[c] - width / 2.,
                y: ys[r] + height / 2.,
            }));
            self.place_node(pending, None)?;
        }
        Ok(())
    }
    pub(super) fn parse_node(
        &mut self,
        cur: &mut Cursor<'_>,
        path: bool,
    ) -> Result<Pending, String> {
        let edit_start = cur.pos;
        let mut options = self.state.options.clone();
        for key in TRANSFORMS {
            options.remove(*key);
        }
        options.remove("_matrix");
        // Pseudocode and figure references belong to one node, never a scope.
        for key in ["algo", "ref", "algo-focus", "algo-focus color"] {
            options.remove(key);
        }
        // Drawing attributes on the containing path do not imply a node border.
        if path {
            options.remove("draw");
            options.remove("fill");
        }
        if let Some(every) = self.state.styles.definitions.get("every node").cloned() {
            options = self.state.styles.resolve(&every, &options)?;
        }
        let mut name = None;
        let mut point = None;
        loop {
            cur.ws();
            if cur.rest().starts_with('[') {
                options = self.options(cur, &options)?;
            } else if cur.eat("at") {
                point = Some(self.read_point(cur, Point::default())?.0);
            } else if cur.rest().starts_with('(') {
                name = Some(cur.group('(', ')')?.trim().into());
            } else {
                break;
            }
        }
        if let Some(at) = options.get("at") {
            let mut c = Cursor::new(at);
            point = Some(self.read_point(&mut c, Point::default())?.0);
            if !c.rest().trim().is_empty() {
                return Err("invalid node at coordinate".into());
            }
        }
        cur.ws();
        let label_start = cur.pos;
        let label = cur.group('{', '}')?;
        let source_start = self.expanded.origin(edit_start);
        let source_label = self.expanded.origin(label_start);
        let source_end = self.expanded.origin(cur.pos - 1) + 1;
        // Generated macro bodies/expanded labels cannot be edited unambiguously.
        let edit_source = (!self.synthetic
            && self
                .original
                .get(source_start..source_end)
                .map(crate::syntax::clean)
                .as_deref()
                == Some(&cur.source[edit_start..cur.pos]))
        .then_some((source_start, source_label, source_end));
        let label = self.late_text(label);
        self.labels.push(label.trim().to_owned());
        if ["matrix of nodes", "nodes", "row sep", "column sep"]
            .iter()
            .any(|k| options.contains_key(*k))
        {
            return Err("Unsupported matrix keys on node; use the matrix command".into());
        }
        if !["", "true", "false"].contains(&get(&options, "transform shape", "")) {
            return Err("transform shape requires true or false".into());
        }
        let matrix = Matrix::from_options(&options)?;
        let parent = Matrix::from_options(&self.state.options)?;
        let [dx, dy] = parent.vector(matrix.0[4], matrix.0[5]);
        let mut shape_matrix = if options.contains_key("transform shape")
            && get(&options, "transform shape", "") != "false"
        {
            parent.then(matrix)?
        } else {
            matrix
        };
        shape_matrix.0[4] = 0.;
        shape_matrix.0[5] = 0.;
        shape_matrix.store(&mut options);
        options.insert("_node dx".into(), dx.to_string());
        options.insert("_node dy".into(), dy.to_string());
        let mut lines = Vec::new();
        let label = if let Some(value) = options.get("algo") {
            if !label.trim().is_empty() {
                return Err(
                    "a node with algo= draws the pseudocode; leave its text empty: {}".into(),
                );
            }
            let algorithm = self.algo.resolve(value).ok_or_else(|| {
                format!("[algo-name-missing] algo='{value}' is not an algorithm name or file")
            })?;
            // The node's `font=` sets the pseudocode size, as for node text.
            let font_size = crate::text::font_metrics(get(&options, "font", ""))?.0;
            let mut focus = crate::algo::layout::Focus {
                fill: self
                    .state
                    .styles
                    .color(get(&options, "algo-focus color", "orange!20"))?,
                ..Default::default()
            };
            for reference in crate::syntax::split_top(get(&options, "algo-focus", ""), ',') {
                let line = self.algo.line(algorithm, reference).ok_or_else(|| {
                    self.fail_at_option("algo-focus");
                    format!("algo-focus: no line '{reference}'; use a line number or an @ref ID")
                })?;
                focus.lines.insert(line);
            }
            let document = self.algo.focused(algorithm, &focus, font_size)?;
            let names = self.algo.line_names(algorithm);
            self.algo.placed.push((value.clone(), source_start));
            let label = self.text.layout_markup(&document)?;
            let mark = |key: String| label.marks.iter().find(|(k, _)| *k == key).map(|(_, y)| *y);
            // The ruled body starts at the 1pt page margin of the markup.
            let (left, right) =
                mark("body-width".into()).map_or((0., label.width), |w| (1., 1. + w));
            for (i, names) in names.into_iter().enumerate() {
                if let (Some(top), Some(bottom)) = (
                    mark(format!("line-{i}-top")),
                    mark(format!("line-{i}-bottom")),
                ) && !names.is_empty()
                {
                    lines.push((names, [top, bottom, left, right]));
                }
            }
            label
        } else {
            let label = match options.get("ref") {
                Some(id) => {
                    if !crate::algo::valid_id(id) {
                        return Err(format!(
                            "invalid ref ID '{id}'; use letters, digits, '-', '_' or '.'"
                        ));
                    }
                    self.algo.figure_refs.push((id.clone(), source_start));
                    let mark = self
                        .algo
                        .refs
                        .get(id)
                        .map_or("\\tikzcref{?}", String::as_str);
                    if label.trim().is_empty() {
                        mark.to_owned()
                    } else {
                        format!("{mark}\\;{label}")
                    }
                    .into()
                }
                None => label,
            };
            self.text
                .layout(&label, &options, &self.state.styles, &self.mainfont)?
        };
        if name.is_none() {
            name = options.get("name").cloned();
        }
        let move_transform = parent.then(matrix)?.0;
        Ok(Pending {
            lines,
            edit_source,
            move_matrix: [
                move_transform[0],
                move_transform[1],
                move_transform[2],
                move_transform[3],
            ],
            options,
            name,
            point,
            label,
        })
    }
    pub(super) fn place_node(
        &mut self,
        p: Pending,
        path_point: Option<Point>,
    ) -> Result<(), String> {
        let dim = crate::text::font_dim;
        let o = &p.options;
        let shape = get(o, "shape", "rectangle").to_owned();
        let sep = dim(
            o,
            "inner sep",
            crate::text::font_metrics(get(o, "font", ""))?.0 / 3.,
        )?;
        let mut width = p.label.width + 2. * dim(o, "inner xsep", sep)?;
        let mut height = p.label.height + 2. * dim(o, "inner ysep", sep)?;
        if shape == "circle" {
            let diameter = width.hypot(height);
            width = diameter;
            height = diameter;
        }
        if shape == "ellipse" {
            width *= 2f64.sqrt();
            height *= 2f64.sqrt();
        }
        if shape == "diamond" {
            let aspect = dim(o, "aspect", 1.)?;
            if aspect <= 0. {
                return Err("diamond aspect must be positive".into());
            }
            // The padded text rectangle must fit inside |x|/a+|y|/b=1.
            width += height * aspect;
            height = width / aspect;
        }
        width = width
            .max(dim(o, "minimum width", 0.)?)
            .max(dim(o, "minimum size", 0.)?);
        height = height
            .max(dim(o, "minimum height", 0.)?)
            .max(dim(o, "minimum size", 0.)?);
        if shape == "circle" {
            width = width.max(height);
            height = width;
        }
        if width < 0. || height < 0. {
            return Err("negative node dimensions".into());
        }
        if shape == "coordinate" {
            width = 0.;
            height = 0.;
        }
        let cylinder_cap = if shape == "cylinder" {
            if (dim(o, "shape border rotate", 0.)?.rem_euclid(360.) - 90.).abs() > 1e-8 {
                return Err(
                    "Unsupported cylinder orientation (requires shape border rotate=90)".into(),
                );
            }
            let aspect = dim(o, "aspect", 0.5)?;
            if !(0.0..=1.0).contains(&aspect) || aspect == 0. {
                return Err("cylinder aspect must be in (0, 1]".into());
            }
            let cap = width * aspect / 2.;
            height += 3. * cap;
            cap
        } else {
            0.
        };
        let mut center = p.point.or(path_point).unwrap_or_default();
        let mut anchor = get(o, "anchor", "center").to_owned();
        let mut placement = false;
        // `on grid`: distances run between centers, whatever the node sizes.
        let on_grid = o.contains_key("on grid") && get(o, "on grid", "") != "false";
        for (key, dx, dy) in [
            ("above", 0., 1.),
            ("below", 0., -1.),
            ("left", -1., 0.),
            ("right", 1., 0.),
            ("above left", -1., 1.),
            ("above right", 1., 1.),
            ("below left", -1., -1.),
            ("below right", 1., -1.),
        ] {
            if let Some(v) = o.get(key) {
                let direction = Point { x: dx, y: dy };
                if let Some((dist, target)) = v.split_once("of ") {
                    let dist = unbrace(dist.trim());
                    let d = if dist.is_empty() {
                        get(o, "node distance", "1cm")
                    } else {
                        dist
                    };
                    let ds: Vec<_> = d.split(" and ").collect();
                    // One distance for a diagonal is measured along the
                    // diagonal: PGF shifts each axis by 1/sqrt(2) of it.
                    let factor = if ds.len() == 1 && dx != 0. && dy != 0. {
                        std::f64::consts::FRAC_1_SQRT_2
                    } else {
                        1.
                    };
                    let vertical = length(ds[0], CM)? * factor;
                    let horizontal = length(ds.get(1).unwrap_or(&ds[0]), CM)? * factor;
                    if on_grid && o.contains_key("fit") {
                        self.fail_at_option("fit");
                        return Err(
                            "Unsupported fit with 'of' placement on grid (use on grid=false)"
                                .into(),
                        );
                    }
                    let (name, ref_anchor) =
                        target.trim().split_once('.').unwrap_or((target.trim(), ""));
                    center = if let Some(n) = self.nodes.get(name) {
                        if ref_anchor.is_empty() && on_grid {
                            n.center
                        } else if ref_anchor.is_empty() {
                            let direction = match (dx as i32, dy as i32) {
                                (0, 1) => "north",
                                (0, -1) => "south",
                                (1, 0) => "east",
                                (-1, 0) => "west",
                                (1, 1) => "north east",
                                (-1, 1) => "north west",
                                (1, -1) => "south east",
                                _ => "south west",
                            };
                            n.anchor(direction)?
                        } else {
                            n.anchor(ref_anchor)?
                        }
                    } else {
                        // Intersections and calc expressions are point targets,
                        // not node boxes with a near-edge anchor.
                        self.coordinate(unbrace(target.trim()))?.0
                    };
                    center = center.add(Point {
                        x: dx * horizontal,
                        y: dy * vertical,
                    });
                } else {
                    let distance = if v.is_empty() { 0. } else { length(v, CM)? };
                    center = center.add(direction.scale(distance));
                }
                if !o.contains_key("anchor") && on_grid && v.contains("of ") {
                    anchor = "center".into();
                } else if !o.contains_key("anchor") {
                    anchor = match (dx as i32, dy as i32) {
                        (0, 1) => "south",
                        (0, -1) => "north",
                        (-1, 0) => "east",
                        (1, 0) => "west",
                        (-1, 1) => "south east",
                        (1, 1) => "south west",
                        (-1, -1) => "north east",
                        _ => "north west",
                    }
                    .into();
                }
                placement = true;
                break;
            }
        }
        if let Some(fit) = o.get("fit") {
            let mut c = Cursor::new(fit);
            let mut bounds = Bounds::default();
            while !c.rest().trim().is_empty() {
                let s = c.group('(', ')')?;
                if let Some(node) = self.nodes.get(s.trim()) {
                    bounds.node(node);
                } else {
                    bounds.point(self.coordinate(s)?.0);
                }
            }
            if !bounds.min.x.is_finite() {
                return Err("empty fit list".into());
            }
            center = bounds.min.add(bounds.max).scale(0.5);
            width = width.max(bounds.max.x - bounds.min.x + 2. * sep);
            height = height.max(bounds.max.y - bounds.min.y + 2. * sep);
            center.x += dim(&self.state.options, "xshift", 0.)?;
            center.y += dim(&self.state.options, "yshift", 0.)?;
        } else if !placement && p.point.is_none() && path_point.is_none() {
            center = self.transform(center, &self.state.options)?;
        }
        center = center.add(Point {
            x: dim(o, "_node dx", 0.)?,
            y: dim(o, "_node dy", 0.)?,
        });
        let node_angle = dim(o, "_node rotation", 0.)?;
        let mut node = Node {
            center,
            width,
            height,
            shape: shape.clone(),
            rotation: node_angle,
            cylinder_cap,
            baseline: p.label.height / 2. - p.label.baseline,
            outer_xsep: if shape == "coordinate" {
                0.
            } else {
                dim(o, "outer xsep", dim(o, "outer sep", line_width(o)? / 2.)?)?
            },
            outer_ysep: if shape == "coordinate" {
                0.
            } else {
                dim(o, "outer ysep", dim(o, "outer sep", line_width(o)? / 2.)?)?
            },
            transform: Matrix::from_options(o)?,
        };
        node.center = node.center.sub(node.anchor(&anchor)?.sub(node.center));
        let path_angle = dim(o, "_path angle", 0.)?;
        let angle = path_angle + node_angle;
        if let Some(origin) = path_point.filter(|_| path_angle != 0.) {
            let d = node.center.sub(origin);
            let a = path_angle.to_radians();
            node.center = origin.add(Point {
                x: d.x * a.cos() - d.y * a.sin(),
                y: d.x * a.sin() + d.y * a.cos(),
            });
        }
        if path_point.is_some()
            && !placement
            && o.contains_key("auto")
            && get(o, "auto", "") != "false"
        {
            let a = dim(o, "_tangent", 0.)?.to_radians();
            let side = if o.contains_key("swap") || get(o, "auto", "") == "right" {
                -1.
            } else {
                1.
            };
            let normal = Point {
                x: -a.sin() * side,
                y: a.cos() * side,
            };
            let distance = normal.x.abs() * width / 2. + normal.y.abs() * height / 2.;
            node.center = node.center.add(normal.scale(distance));
        }
        node.rotation = angle;
        if let Some(name) = p.name {
            // Pseudocode lines become `<name>-<line number>` / `<name>-<@ref ID>`
            // nodes spanning the pseudocode width, for arrows into the figure.
            for (suffixes, [top, bottom, left, right]) in &p.lines {
                let line = Node {
                    center: Point {
                        x: node.center.x - p.label.width / 2. + (left + right) / 2.,
                        y: node.center.y + p.label.height / 2. - (top + bottom) / 2.,
                    },
                    width: right - left,
                    height: bottom - top,
                    shape: "rectangle".into(),
                    rotation: 0.,
                    cylinder_cap: 0.,
                    baseline: 0.,
                    outer_xsep: 0.,
                    outer_ysep: 0.,
                    transform: Matrix::default(),
                };
                for suffix in suffixes {
                    self.nodes.insert(format!("{name}-{suffix}"), line.clone());
                }
            }
            self.nodes.insert(name, node.clone());
        }
        self.bbox.node(&node);
        if let Some((start, label_start, end)) = p.edit_source {
            let mut bounds = Bounds::default();
            bounds.node(&node);
            let font = get(o, "font", "");
            // Path sloping rotates the displacement along with the label.
            let rotation = Matrix::option("rotate", &path_angle.to_string())?.unwrap();
            let [a, b, c, d] = p.move_matrix;
            let moved = rotation.then(Matrix([a, b, c, d, 0., 0.]))?.0;
            self.editing.push(serde_json::json!({
                "id": start, "start": start, "labelStart": label_start, "end": end,
                "bounds": [bounds.min.x, -bounds.max.y, bounds.max.x-bounds.min.x, bounds.max.y-bounds.min.y],
                "x": node.center.x, "y": node.center.y,
                "moveMatrix": [moved[0],moved[1],moved[2],moved[3]],
                "font": font, "fontSize": crate::text::font_metrics(font)?.0 * 72.27 / 72.,
            }));
        }
        let background = o.contains_key("on background layer");
        let element_start = self.elements.len();
        let x = node.center.x - node.width / 2.;
        let y = -node.center.y - node.height / 2.;
        // `double` only applies to a drawn border.
        let strokes = if o.contains_key("draw") {
            double_strokes(o)?
        } else {
            vec![o.clone()]
        };
        let mut shape = String::new();
        for o in &strokes {
            let attributes = self.paint(o, false)?;
            shape.push_str(&match node.shape.as_str() {
                "cylinder" => {
                    let rx = width / 2.;
                    let ry = cylinder_cap;
                    let top = y + ry;
                    let bottom = y + height - ry;
                    let right = x + width;
                    format!(
                        "<path d=\"M {x},{top} A {rx},{ry} 0 0 1 {right},{top} L {right},{bottom} A {rx},{ry} 0 0 1 {x},{bottom} Z\" {attributes}/><path d=\"M {x},{top} A {rx},{ry} 0 0 0 {right},{top}\" {}/>",
                        self.paint(
                            &{
                                let mut rim = o.clone();
                                rim.remove("fill");
                                rim
                            },
                            false
                        )?
                    )
                }
                "coordinate" => String::new(),
                "circle" | "ellipse" => format!(
                    "<ellipse cx=\"{}\" cy=\"{}\" rx=\"{}\" ry=\"{}\" {attributes}/>",
                    node.center.x,
                    -node.center.y,
                    width / 2.,
                    height / 2.
                ),
                "diamond" => format!(
                    "<path d=\"M {} L {} L {} L {} Z\" {attributes}/>",
                    node.center
                        .add(Point {
                            x: 0.,
                            y: height / 2.
                        })
                        .svg(),
                    node.center
                        .add(Point {
                            x: width / 2.,
                            y: 0.
                        })
                        .svg(),
                    node.center
                        .add(Point {
                            x: 0.,
                            y: -height / 2.
                        })
                        .svg(),
                    node.center
                        .add(Point {
                            x: -width / 2.,
                            y: 0.
                        })
                        .svg()
                ),
                _ => {
                    let r = if o.contains_key("rounded corners") && !o.contains_key("sharp corners") {
                        let v = get(o, "rounded corners", "4pt");
                        if v.is_empty() {
                            4. * 72. / 72.27
                        } else {
                            length(v, 1.)?
                        }
                    } else {
                        0.
                    };
                    // With no ry, omitting rx=0 preserves square corners.
                    let radius = if r == 0. {
                        String::new()
                    } else {
                        format!(" rx=\"{r:.5}\"")
                    };
                    format!(
                        "<rect x=\"{x:.5}\" y=\"{y:.5}\" width=\"{width:.5}\" height=\"{height:.5}\"{radius} {attributes}/>"
                    )
                }
            });
        }
        self.elements.push((background, shape));
        if !p.label.svg.is_empty() {
            let id = self.label_id;
            self.label_id += 1;
            let svg = self.glyphs.embed(&p.label.svg, id)?;
            let label_bounds = Node {
                center: node.center,
                width: p.label.width,
                height: p.label.height,
                shape: "rectangle".into(),
                rotation: angle,
                cylinder_cap: 0.,
                baseline: 0.,
                outer_xsep: 0.,
                outer_ysep: 0.,
                transform: node.transform,
            };
            self.bbox.node(&label_bounds);
            let opacity = dim(o, "text opacity", dim(o, "opacity", 1.)?)?;
            let opacity = opacity_attribute("opacity", opacity);
            self.elements.push((
                background,
                format!(
                    "<g transform=\"translate({:.5},{:.5})\"{opacity}>{svg}</g>",
                    node.center.x - p.label.width / 2.,
                    -node.center.y - p.label.height / 2.
                ),
            ));
        }
        if angle != 0. || node.transform != Matrix::default() {
            let content = self
                .elements
                .drain(element_start..)
                .map(|(_, s)| s)
                .collect::<String>();
            let rotation = Matrix::option("rotate", &angle.to_string())?.unwrap();
            let [a, b, c, d, _, _] = rotation.then(node.transform)?.0;
            let cx = node.center.x;
            let cy = -node.center.y;
            self.elements.push((
                background,
                format!(
                    "<g transform=\"matrix({a} {} {} {d} {} {})\">{content}</g>",
                    -b,
                    -c,
                    cx - a * cx + c * cy,
                    cy + b * cx - d * cy
                ),
            ));
        }
        for (_, spec) in o.iter().filter(|(k, _)| k.starts_with("_label ")) {
            let mut c = Cursor::new(spec);
            let mut opts = Values::new();
            for key in ["font", "text", "text opacity", "opacity", "label distance"] {
                if let Some(v) = o.get(key) {
                    opts.insert(key.into(), v.clone());
                }
            }
            if let Some(every) = self.state.styles.definitions.get("every label").cloned() {
                opts = self.state.styles.resolve(&every, &opts)?;
            }
            c.ws();
            if c.rest().starts_with('[') {
                opts = self.state.styles.resolve(c.group('[', ']')?, &opts)?;
            }
            if opts.keys().any(|k| k.starts_with("_label ")) {
                return Err("Unsupported nested node labels".into());
            }
            // `xshift`/`yshift` move the placed label; other transforms do not apply.
            let shift = Matrix::from_options(&opts)?.0;
            if shift[..4] != [1., 0., 0., 1.] {
                return Err("Unsupported transformed label (use a standalone node)".into());
            }
            opts.remove("_matrix");
            let pieces = split_top_empty_label(c.rest());
            let (position, text) = pieces.unwrap_or(("above", c.rest()));
            let angle = match position.trim() {
                "above" | "north" => 90.,
                "below" | "south" => 270.,
                "left" | "west" => 180.,
                "right" | "east" => 0.,
                "above left" | "north west" => 135.,
                "above right" | "north east" => 45.,
                "below left" | "south west" => 225.,
                "below right" | "south east" => 315.,
                value => number(value)?,
            }
            .rem_euclid(360.);
            let dir = Point {
                x: angle.to_radians().cos(),
                y: angle.to_radians().sin(),
            };
            let point = node
                .border(node.center.add(dir.scale(100.)))
                .add(dir.scale(dim(&opts, "label distance", 0.)?))
                .add(Point {
                    x: shift[4],
                    y: shift[5],
                });
            let anchor = match ((angle / 45.).round() as i32).rem_euclid(8) {
                0 => "west",
                1 => "south west",
                2 => "south",
                3 => "south east",
                4 => "east",
                5 => "north east",
                6 => "north",
                _ => "north west",
            };
            opts.entry("anchor".into()).or_insert(anchor.into());
            let label =
                self.text
                    .layout(unbrace(text), &opts, &self.state.styles, &self.mainfont)?;
            let name = opts.get("name").cloned();
            self.place_node(
                Pending {
                    edit_source: None,
                    move_matrix: [1., 0., 0., 1.],
                    lines: Vec::new(),
                    options: opts,
                    name,
                    point: Some(point),
                    label,
                },
                None,
            )?;
        }
        Ok(())
    }
    pub(super) fn place_path_node(
        &mut self,
        mut pending: Pending,
        points: &[Point],
        timing: PathTiming,
    ) -> Result<(), String> {
        let pos = node_pos(&pending.options)?;
        let (location, direction) = timing.sample(points, pos);
        let mut angle = direction.y.atan2(direction.x).to_degrees();
        pending.options.insert("_tangent".into(), angle.to_string());
        if pending.options.contains_key("sloped") {
            if angle > 90. {
                angle -= 180.;
            } else if angle < -90. {
                angle += 180.;
            }
            pending
                .options
                .insert("_path angle".into(), angle.to_string());
        }
        self.place_node(pending, Some(location))
    }
}

pub(super) fn split_top_empty_label(input: &str) -> Option<(&str, &str)> {
    let parts = crate::syntax::split_top_empty(input, ':');
    if parts.len() < 2 {
        None
    } else {
        let at = input.len() - input.trim_start().len() + parts[0].len();
        let colon = input[at..].find(':')? + at;
        Some((&input[..colon], &input[colon + 1..]))
    }
}

pub(super) fn node_pos(o: &Values) -> Result<f64, String> {
    if o.contains_key("at start") {
        return Ok(0.);
    }
    if o.contains_key("at end") {
        return Ok(1.);
    }
    if o.contains_key("near start") {
        return Ok(0.25);
    }
    if o.contains_key("near end") {
        return Ok(0.75);
    }
    dim(o, "pos", 0.5)
}

pub(super) fn matrix_rows(body: &str) -> Result<Vec<Vec<&str>>, String> {
    let mut rows = Vec::new();
    let mut start = 0;
    let mut depth = 0usize;
    let mut chars = body.char_indices().peekable();
    while let Some((i, ch)) = chars.next() {
        if ch == '\\' {
            if let Some((_, next)) = chars.next()
                && next == '\\'
                && depth == 0
            {
                rows.push(crate::syntax::split_top_empty(&body[start..i], '&'));
                start = i + 2;
            }
        } else if ch == '{' || ch == '[' {
            depth += 1;
        } else if ch == '}' || ch == ']' {
            depth = depth.saturating_sub(1);
        }
    }
    if !body[start..].trim().is_empty() {
        rows.push(crate::syntax::split_top_empty(&body[start..], '&'));
    }
    if rows.is_empty() || rows.iter().map(Vec::len).sum::<usize>() > 256 {
        return Err("matrix requires 1..256 cells".into());
    }
    if rows.iter().any(|r| r.len() != rows[0].len()) {
        return Err("Unsupported ragged matrix; provide explicit empty cells".into());
    }
    Ok(rows)
}
