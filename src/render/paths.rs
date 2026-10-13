//! Path construction, curves, decorations and arrow placement.
use super::geometry::Bounds;
use super::nodes::node_pos;
use super::paint::opacity_attribute;
use super::{CM, Engine, Node, Pending, Point};
use crate::options::{Values, dim, get, length, number};
use crate::syntax::{Cursor, split_top};
use crate::transform::Matrix;

impl Engine<'_> {
    pub(super) fn path(&mut self, cur: &mut Cursor<'_>, command: &str) -> Result<(), String> {
        let element_start = self.elements.len();
        let mut last_segment = 0;
        let mut timing = PathTiming::Distance;
        let mut options = self.state.options.clone();
        if let Some(style) = self.state.styles.definitions.get("every path").cloned() {
            options = self.state.styles.resolve(&style, &options)?;
        }
        cur.ws();
        if cur.rest().starts_with('[') {
            let s = cur.group('[', ']')?;
            options = self.state.styles.resolve(s, &options)?;
        }
        if command == "fill" || command == "filldraw" {
            options.entry("fill".into()).or_default();
        }
        self.state.options = options.clone();
        let draw = command == "draw" || command == "filldraw";
        let mut points: Vec<Point> = Vec::new();
        let mut d = String::new();
        let mut current = Point::default();
        let mut relative_base = Point::default();
        let mut previous_name: Option<String> = None;
        let mut deferred: Vec<Pending> = Vec::new();
        let mut closed = false;
        let mut editable_endpoints = true;
        let mut endpoint_ranges = Vec::new();
        let mut ends_with_coordinate = true;
        let mut vertices = Vec::new();
        let mut extra_handles = Vec::new();
        let mut normalizations = Vec::new();
        loop {
            cur.ws();
            if cur.eat(";") {
                break;
            }
            if cur.rest().is_empty() {
                return Err("expected ';' after path".into());
            }
            if cur.eat("node") {
                if command == "clip" {
                    return Err("Unsupported node on clip path".into());
                }
                let mut p = self.parse_node(cur, true)?;
                if ![
                    "pos",
                    "midway",
                    "near start",
                    "near end",
                    "at start",
                    "at end",
                ]
                .iter()
                .any(|key| p.options.contains_key(*key))
                {
                    p.options.insert("pos".into(), "1".into());
                }
                if points.len() < 2 {
                    self.place_node(p, Some(current))?;
                } else {
                    self.place_path_node(p, &points[last_segment..], timing)?;
                }
                continue;
            }
            if cur.eat("coordinate") {
                if command == "clip" {
                    return Err("Unsupported coordinate declaration on clip path".into());
                }
                let mut pos = 1.;
                cur.ws();
                if cur.rest().starts_with('[') {
                    let o = self
                        .state
                        .styles
                        .resolve(cur.group('[', ']')?, &Values::new())?;
                    pos = node_pos(&o)?;
                }
                let name = cur.group('(', ')')?;
                let center = if points.len() > 1 {
                    timing.sample(&points[last_segment..], pos).0
                } else {
                    current
                };
                self.nodes.insert(
                    name.into(),
                    Node {
                        center,
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
                continue;
            }
            if cur.eat("cycle") {
                d.push_str(" Z ");
                closed = true;
                continue;
            }
            if cur.rest().starts_with('(') || cur.rest().starts_with('+') {
                if !endpoint_ranges.is_empty() { editable_endpoints = false; }
                let coordinate_start = cur.pos;
                let relative = cur.rest().starts_with('+');
                let keep_base = cur.rest().starts_with('+') && !cur.rest().starts_with("++");
                let (p, name) = self.read_point(cur, relative_base)?;
                endpoint_ranges.push((coordinate_start, cur.pos));
                vertices.push(p);
                if relative { normalizations.push(self.path_coordinate_edit(coordinate_start, cur.pos, p)?); }
                if !keep_base {
                    relative_base = p;
                }
                current = p;
                previous_name = name;
                d.push_str(&format!(" M {} ", p.svg()));
                points.push(p);
                timing = PathTiming::Distance;
                continue;
            }
            let operation_start = cur.pos;
            let operation = if cur.eat("--") {
                if cur.eat("plot") { "plot line" } else { "line" }
            } else if cur.eat("|-") {
                "vertical"
            } else if cur.eat("-|") {
                "horizontal"
            } else if cur.eat("..") {
                "bezier"
            } else {
                cur.word()
            };
            timing = PathTiming::Distance;
            if !["line", "vertical", "horizontal", "to", "bezier", "arc"].contains(&operation) { editable_endpoints = false; }
            match operation {
                "grid" => {
                    let end = self.read_point(cur, current)?.0;
                    let matrix = Matrix::from_options(&self.state.options)?;
                    let [sx, sy] = matrix.inverse_point(current.x, current.y);
                    let [ex, ey] = matrix.inverse_point(end.x, end.y);
                    let step = length(get(&options, "step", "1cm"), CM)?;
                    let dx = length(get(&options, "xstep", ""), CM).or_else(|_| {
                        if options.contains_key("xstep") {
                            Err("invalid xstep")
                        } else {
                            Ok(step)
                        }
                    })?;
                    let dy = length(get(&options, "ystep", ""), CM).or_else(|_| {
                        if options.contains_key("ystep") {
                            Err("invalid ystep")
                        } else {
                            Ok(step)
                        }
                    })?;
                    if dx <= 0. || dy <= 0. || (ex - sx).abs() / dx + (ey - sy).abs() / dy > 10000.
                    {
                        return Err("grid requires positive steps and at most 10000 lines".into());
                    }
                    for (lo, hi, step, vertical) in [
                        (sx.min(ex), sx.max(ex), dx, true),
                        (sy.min(ey), sy.max(ey), dy, false),
                    ] {
                        let first = (lo / step - 1e-10).ceil() as i64;
                        let last = (hi / step + 1e-10).floor() as i64;
                        for i in first..=last {
                            let a = if vertical {
                                Point {
                                    x: i as f64 * step,
                                    y: sy,
                                }
                            } else {
                                Point {
                                    x: sx,
                                    y: i as f64 * step,
                                }
                            };
                            let b = if vertical {
                                Point {
                                    x: i as f64 * step,
                                    y: ey,
                                }
                            } else {
                                Point {
                                    x: ex,
                                    y: i as f64 * step,
                                }
                            };
                            let a = self.transform(a, &self.state.options)?;
                            let b = self.transform(b, &self.state.options)?;
                            d.push_str(&format!(" M {} L {} ", a.svg(), b.svg()));
                            points.extend([a, b]);
                        }
                    }
                    current = end;
                    relative_base = end;
                    previous_name = None;
                }
                "plot" | "plot line" => {
                    let mut opts = options.clone();
                    cur.ws();
                    if cur.rest().starts_with('[') {
                        opts = self.state.styles.resolve(cur.group('[', ']')?, &opts)?;
                    }
                    if !cur.eat("coordinates") {
                        return Err(
                            "Unsupported plot (only explicit coordinates are supported)".into()
                        );
                    }
                    let mut coords = Cursor::new(cur.group('{', '}')?);
                    let mut samples = Vec::new();
                    while !coords.rest().trim().is_empty() {
                        if samples.len() >= 10000 {
                            return Err("plot exceeds 10000 coordinates".into());
                        }
                        samples.push(self.read_point(&mut coords, Point::default())?.0);
                    }
                    if samples.len() < 2 {
                        return Err("plot needs at least two coordinates".into());
                    }
                    last_segment = points.len();
                    if operation == "plot line" && !points.is_empty() {
                        d.push_str(&format!(" L {} ", samples[0].svg()));
                    } else {
                        d.push_str(&format!(" M {} ", samples[0].svg()));
                    }
                    points.push(samples[0]);
                    if opts.contains_key("smooth") && get(&opts, "smooth", "") != "false" {
                        // PGF's open smooth plot handler: endpoint tangents are
                        // zero; each interior tangent is .2775*tension*(next-prev).
                        let tension = dim(&opts, "tension", 0.5)? * 0.2775;
                        if !(0.0..=10.).contains(&tension) {
                            return Err("invalid plot tension".into());
                        }
                        for i in 0..samples.len() - 1 {
                            let a = if i == 0 {
                                samples[i]
                            } else {
                                samples[i].add(samples[i + 1].sub(samples[i - 1]).scale(tension))
                            };
                            let b = if i + 2 == samples.len() {
                                samples[i + 1]
                            } else {
                                samples[i + 1].sub(samples[i + 2].sub(samples[i]).scale(tension))
                            };
                            self.append_curve(
                                &mut d,
                                &mut points,
                                samples[i],
                                a,
                                b,
                                samples[i + 1],
                            );
                        }
                    } else {
                        for p in &samples[1..] {
                            d.push_str(&format!(" L {} ", p.svg()));
                            points.push(*p);
                        }
                    }
                    current = *samples.last().unwrap();
                    relative_base = current;
                    previous_name = None;
                }
                "line" | "vertical" | "horizontal" | "to" | "bezier" => {
                    let mut curve = options.clone();
                    let mut controls = None;
                    let mut relative_controls = false;
                    if operation == "to" {
                        cur.ws();
                        if cur.rest().starts_with('[') {
                            curve = self.state.styles.resolve(cur.group('[', ']')?, &curve)?;
                        }
                    }
                    if operation == "bezier" {
                        if !cur.eat("controls") {
                            return Err("expected controls in Bezier path".into());
                        }
                        relative_controls = cur.rest().trim_start().starts_with('+');
                        let a = self.read_point(cur, current)?.0;
                        let (b, end_relative) = if cur.eat("and") {
                            let relative = cur.rest().trim_start().starts_with('+');
                            relative_controls |= relative;
                            (self.read_point(cur, current)?.0, relative)
                        } else {
                            (a, false)
                        };
                        if !cur.eat("..") {
                            return Err("expected '..' after controls".into());
                        }
                        controls = Some((a, b, end_relative));
                    }
                    let operation_end = cur.pos;
                    while cur.eat("node") {
                        deferred.push(self.parse_node(cur, true)?);
                    }
                    if cur.eat("cycle") {
                        d.push_str(" Z ");
                        closed = true;
                        continue;
                    }
                    cur.ws();
                    let coordinate_start = cur.pos;
                    let relative = cur.rest().starts_with('+');
                    let keep_base = cur.rest().starts_with('+') && !cur.rest().starts_with("++");
                    let (mut p, name) = self.read_point(cur, relative_base)?;
                    endpoint_ranges.push((coordinate_start, cur.pos));
                    if relative { normalizations.push(self.path_coordinate_edit(coordinate_start, cur.pos, p)?); }
                    if !keep_base {
                        relative_base = p;
                    }
                    let mut start = current;
                    let matrix = Matrix::from_options(&self.state.options)?;
                    let controls = controls.map(|(a, b, relative)| {
                        (a, if relative { b.add(p.sub(current)) } else { b })
                    });
                    let border_controls = if operation == "to" {
                        let [sx, sy] = matrix.inverse_point(current.x, current.y);
                        let [ex, ey] = matrix.inverse_point(p.x, p.y);
                        let angle = (ey - sy).atan2(ex - sx).to_degrees();
                        let bend = |k| -> Result<f64, String> {
                            match curve.get(k) {
                                Some(v) if v.is_empty() => Ok(30.),
                                Some(v) => number(v),
                                None => Ok(0.),
                            }
                        };
                        let bend = bend("bend left")? - bend("bend right")?;
                        let out = dim(&curve, "out", angle + bend)?.to_radians();
                        let into = dim(&curve, "in", angle + 180. - bend)?.to_radians();
                        let [x, y] = matrix.vector(out.cos() * 100., out.sin() * 100.);
                        let a = current.add(Point { x, y });
                        let [x, y] = matrix.vector(into.cos() * 100., into.sin() * 100.);
                        Some((a, p.add(Point { x, y })))
                    } else {
                        controls
                    };
                    if points.len() == 1
                        && let Some(n) = previous_name.as_ref().and_then(|n| self.nodes.get(n))
                    {
                        let toward = match operation {
                            "vertical" => orthogonal_corner(matrix, current, p, true),
                            "horizontal" => orthogonal_corner(matrix, current, p, false),
                            "bezier" | "to" => border_controls.map_or(p, |c| c.0),
                            _ => p,
                        };
                        start = n.border(toward);
                        points[0] = start;
                        vertices[0] = start;
                        d = format!(" M {} ", start.svg());
                    }
                    if let Some(n) = name.as_ref().and_then(|n| self.nodes.get(n)) {
                        let toward = match operation {
                            "vertical" => orthogonal_corner(matrix, start, p, true),
                            "horizontal" => orthogonal_corner(matrix, start, p, false),
                            "bezier" | "to" => border_controls.map_or(start, |c| c.1),
                            _ => start,
                        };
                        p = n.border(toward);
                    }
                    vertices.push(p);
                    ends_with_coordinate = true;
                    let segment_start = points.len().saturating_sub(1);
                    last_segment = segment_start;
                    if operation == "vertical" || operation == "horizontal" {
                        timing = PathTiming::Orthogonal;
                    }
                    match operation {
                        "vertical" => {
                            let corner = orthogonal_corner(matrix, start, p, true);
                            let mut handle = self.path_handle(operation_start, operation_start+2, corner, "bend")?;
                            handle["replacement"] = "corner".into();
                            extra_handles.push(handle);
                            d.push_str(&format!(" L {} L {} ", corner.svg(), p.svg()));
                            points.push(corner);
                            points.push(p);
                        }
                        "horizontal" => {
                            let corner = orthogonal_corner(matrix, start, p, false);
                            let mut handle = self.path_handle(operation_start, operation_start+2, corner, "bend")?;
                            handle["replacement"] = "corner".into();
                            extra_handles.push(handle);
                            d.push_str(&format!(" L {} L {} ", corner.svg(), p.svg()));
                            points.push(corner);
                            points.push(p);
                        }
                        "bezier" | "to" => {
                            let (a, b) = if let Some(controls) = controls {
                                controls
                            } else {
                                let [sx, sy] = matrix.inverse_point(start.x, start.y);
                                let [px, py] = matrix.inverse_point(p.x, p.y);
                                let chord = Point {
                                    x: px - sx,
                                    y: py - sy,
                                };
                                let angle = chord.y.atan2(chord.x);
                                let bend_value = |key| -> Result<f64, String> {
                                    match curve.get(key) {
                                        Some(v) if v.is_empty() => Ok(30.),
                                        Some(v) => number(v),
                                        None => Ok(0.),
                                    }
                                };
                                let bend = bend_value("bend left")? - bend_value("bend right")?;
                                let out = if curve.contains_key("out") {
                                    dim(&curve, "out", 0.)?.to_radians()
                                } else {
                                    angle + bend.to_radians()
                                };
                                let into = if curve.contains_key("in") {
                                    dim(&curve, "in", 180.)?.to_radians()
                                } else {
                                    angle + std::f64::consts::PI - bend.to_radians()
                                };
                                let distance =
                                    chord.norm() * 0.3915 * dim(&curve, "looseness", 1.)?;
                                let [ax, ay] =
                                    matrix.vector(out.cos() * distance, out.sin() * distance);
                                let [bx, by] =
                                    matrix.vector(into.cos() * distance, into.sin() * distance);
                                (
                                    start.add(Point { x: ax, y: ay }),
                                    p.add(Point { x: bx, y: by }),
                                )
                            };
                            for (index, point) in [a,b].into_iter().enumerate() {
                                let mut handle = self.path_handle(operation_start, operation_end, point, "control")?;
                                handle["replacement"] = "curve".into();
                                handle["controlIndex"] = index.into();
                                let shift = self.state.canvas_shift;
                                handle["controls"] = serde_json::json!([[a.x+shift.x,a.y+shift.y],[b.x+shift.x,b.y+shift.y]]);
                                extra_handles.push(handle);
                            }
                            if relative_controls {
                                normalizations.push(serde_json::json!({
                                    "start": self.expanded.origin(operation_start),
                                    "end": self.expanded.origin(operation_end-1)+1,
                                    "text": format!(".. controls {} and {} ..", self.path_local_coordinate(a)?, self.path_local_coordinate(b)?),
                                }));
                            }
                            self.bbox.cubic(start, a, b, p);
                            d.push_str(&format!(" C {} {} {} ", a.svg(), b.svg(), p.svg()));
                            for i in 1..=32 {
                                let t = i as f64 / 32.;
                                let u = 1. - t;
                                points.push(
                                    start
                                        .scale(u * u * u)
                                        .add(a.scale(3. * u * u * t))
                                        .add(b.scale(3. * u * t * t))
                                        .add(p.scale(t * t * t)),
                                );
                            }
                        }
                        _ => {
                            d.push_str(&format!(" L {} ", p.svg()));
                            points.push(p);
                        }
                    }
                    for pending in deferred.drain(..) {
                        self.place_path_node(pending, &points[segment_start..], timing)?;
                    }
                    current = p;
                    previous_name = name;
                }
                "rectangle" => {
                    let p = self.read_point(cur, current)?.0;
                    let matrix = Matrix::from_options(&self.state.options)?;
                    let a = orthogonal_corner(matrix, current, p, true);
                    let b = orthogonal_corner(matrix, current, p, false);
                    d.push_str(&format!(" L {} L {} L {} Z ", a.svg(), p.svg(), b.svg()));
                    points.extend([a, p, b]);
                    closed = true;
                }
                "circle" | "ellipse" => {
                    cur.ws();
                    let (rx, ry) = if cur.rest().starts_with('[') {
                        let o = self
                            .state
                            .styles
                            .resolve(cur.group('[', ']')?, &Values::new())?;
                        let r = radius(&o, "radius", CM)?;
                        (radius(&o, "x radius", r)?, radius(&o, "y radius", r)?)
                    } else {
                        let radius = cur.group('(', ')')?;
                        let (r1, r2) = radius.split_once(" and ").unwrap_or((radius, radius));
                        (length(r1, CM)?, length(r2, CM)?)
                    };
                    if rx <= 0. || ry <= 0. {
                        return Err("radius must be positive".into());
                    }
                    let matrix = Matrix::from_options(&self.state.options)?;
                    let [x, y] = matrix.vector(rx, 0.);
                    let first = current.add(Point { x, y });
                    d.push_str(&format!(" M {} ", first.svg()));
                    let curve = ellipse_curve(current, rx, ry, 0., 360., matrix);
                    for (start, a, b, end) in curve {
                        self.append_curve(&mut d, &mut points, start, a, b, end);
                    }
                    d.push_str(" Z ");
                    closed = true;
                }
                "arc" => {
                    ends_with_coordinate = false;
                    cur.ws();
                    let (start, end, rx, ry) = if cur.rest().starts_with('[') {
                        let o = self
                            .state
                            .styles
                            .resolve(cur.group('[', ']')?, &Values::new())?;
                        let r = radius(&o, "radius", CM)?;
                        (
                            dim(&o, "start angle", 0.)?,
                            dim(&o, "end angle", 90.)?,
                            radius(&o, "x radius", r)?,
                            radius(&o, "y radius", r)?,
                        )
                    } else {
                        let s = cur.group('(', ')')?;
                        let v: Vec<_> = s.split(':').collect();
                        if v.len() != 3 {
                            return Err("arc requires (start:end:radius)".into());
                        }
                        let r = length(v[2], CM)?;
                        (number(v[0])?, number(v[1])?, r, r)
                    };
                    let a = start.to_radians();
                    if rx <= 0. || ry <= 0. || (end - start).abs() >= 360. {
                        return Err(
                            "arc requires positive radii and a sweep less than 360 degrees".into(),
                        );
                    }
                    let matrix = Matrix::from_options(&self.state.options)?;
                    let [x, y] = matrix.vector(rx * a.cos(), ry * a.sin());
                    let center = current.sub(Point { x, y });
                    let [x, y] =
                        matrix.vector(rx * end.to_radians().cos(), ry * end.to_radians().sin());
                    let target = center.add(Point { x, y });
                    last_segment = points.len().saturating_sub(1);
                    for (s, a, b, e) in ellipse_curve(center, rx, ry, start, end, matrix) {
                        self.append_curve(&mut d, &mut points, s, a, b, e);
                    }
                    current = target;
                    relative_base = target;
                }
                _ => {
                    return Err(format!(
                        "Unsupported path operation '{operation}' near '{}'",
                        cur.rest().chars().take(30).collect::<String>()
                    ));
                }
            }
        }
        if !deferred.is_empty() {
            return Err("path node has no segment".into());
        }
        if points.is_empty() && self.elements.len() == element_start {
            return Err("empty path".into());
        }
        // Source ranges come from the parser, never from searching label text.
        // Materialize relative coordinates when editing so other vertices stay put.
        if editable_endpoints && ends_with_coordinate && !closed && endpoint_ranges.len() >= 2 {
            for (index, (&range, &point)) in endpoint_ranges.iter().zip(&vertices).enumerate() {
                let kind = if index == 0 { "start" } else if index+1 == vertices.len() { "end" } else { "bend" };
                let handle = self.path_handle(range.0, range.1, point, kind)?;
                if kind != "bend" { self.path_endpoints.push(handle.clone()); }
                self.path_points.push(handle);
            }
            self.path_points.extend(extra_handles);
            self.path_points.sort_by_key(|h| h["start"].as_u64().unwrap());
            self.path_normalizations = normalizations;
        }
        let (start_arrow, end_arrow) = crate::arrows::pair(
            get(&options, "arrows", ""),
            get(&options, "<", get(&options, ">", "Latex")),
            get(&options, ">", "Latex"),
        )?;
        let short_start = dim(&options, "shorten <", 0.)?;
        let short_end = dim(&options, "shorten >", 0.)?;
        if command == "clip" {
            if start_arrow.is_some()
                || end_arrow.is_some()
                || short_start != 0.
                || short_end != 0.
                || options.contains_key("decorate")
                || options.contains_key("rounded corners")
            {
                return Err(
                    "Unsupported arrows, shortening, rounded corners or decoration on clip path"
                        .into(),
                );
            }
            for p in &points {
                self.bbox.point(*p);
            }
            let mut defs = self.definitions.borrow_mut();
            let id = format!("clip-{}", defs.len());
            let rule = if options.contains_key("even odd rule") {
                "evenodd"
            } else {
                "nonzero"
            };
            defs.push(format!("<clipPath id=\"{id}\" clipPathUnits=\"userSpaceOnUse\"><path d=\"{d}\" clip-rule=\"{rule}\"/></clipPath>"));
            self.state.clips.push((id, self.bbox));
            self.bbox = Bounds::default();
            return Ok(());
        }
        let polyline = !closed && !d.contains(" C ") && d.matches(" M ").count() == 1;
        if options.contains_key("decorate") && get(&options, "decorate", "") != "false" {
            if !polyline
                || points.len() != 2
                || start_arrow.is_some()
                || end_arrow.is_some()
                || short_start != 0.
                || short_end != 0.
            {
                return Err("Unsupported decoration path (brace requires one straight, unshortened segment without arrows)".into());
            }
            d = self.brace(points[0], points[1], get(&options, "decoration", ""))?;
        }
        let mut tips = None;
        if short_start != 0.
            || short_end != 0.
            || (!closed && (start_arrow.is_some() || end_arrow.is_some()))
        {
            let mut geometry = crate::curve::Path::parse(&d)?;
            geometry.shorten(short_start, short_end)?;
            for p in geometry.vertices() {
                self.bbox.point(Point { x: p.0, y: p.1 });
            }
            tips = Some(geometry.endpoints());
            let clearance = |a: &Option<crate::arrows::Arrow>| {
                a.as_ref()
                    .filter(|a| a.head)
                    .map_or(0., |a| a.length * if a.open { 1. } else { 0.7 })
            };
            if geometry
                .shorten(clearance(&start_arrow), clearance(&end_arrow))
                .is_ok()
            {
                d = geometry.svg();
                if polyline {
                    points = geometry
                        .vertices()
                        .into_iter()
                        .map(|p| Point { x: p.0, y: p.1 })
                        .collect();
                }
            } else {
                d.clear();
            }
        }
        for p in &points {
            self.bbox.point(*p);
        }
        let background = options.contains_key("on background layer");
        let labels = self.elements.split_off(element_start);
        let paint = self.paint(&options, draw)?;
        // Rounded corners for a polyline; curves already carry their own geometry.
        if options.contains_key("rounded corners")
            && !options.contains_key("sharp corners")
            && !d.contains(" C ")
            && !d.contains(" A ")
            && !closed
            && points.len() > 2
            && !d.is_empty()
        {
            let v = get(&options, "rounded corners", "");
            let radius = if v.is_empty() { 4. } else { length(v, 1.)? };
            d = rounded_path(&points, radius);
        }
        if options.contains_key("double") || options.contains_key("double distance") {
            let width = dim(&options, "line width", 0.4)?;
            let gap = dim(&options, "double distance", 1.)?;
            let mut outside = options.clone();
            outside.insert("line width".into(), format!("{}bp", 2. * width + gap));
            self.elements.push((
                background,
                format!("<path d=\"{d}\" {}/>", self.paint(&outside, true)?),
            ));
            let mut inside = options.clone();
            inside.insert("line width".into(), format!("{gap}bp"));
            inside.insert("draw".into(), get(&options, "double", "white").to_owned());
            if get(&inside, "draw", "").is_empty() {
                inside.insert("draw".into(), "white".into());
            }
            self.elements.push((
                background,
                format!("<path d=\"{d}\" {}/>", self.paint(&inside, true)?),
            ));
        } else {
            self.elements
                .push((background, format!("<path d=\"{d}\" {paint}/>")));
        }
        if let Some(tips) = tips {
            let point = |p: crate::curve::P| Point { x: p.0, y: p.1 };
            if let Some(arrow) = end_arrow {
                self.arrow(point(tips[1].0), point(tips[1].1), &options, &arrow)?;
            }
            if let Some(arrow) = start_arrow {
                self.arrow(point(tips[0].0), point(tips[0].1), &options, &arrow)?;
            }
        }
        self.elements.extend(labels);
        Ok(())
    }
    pub(super) fn arrow(
        &mut self,
        tip: Point,
        from: Point,
        options: &Values,
        arrow: &crate::arrows::Arrow,
    ) -> Result<(), String> {
        let len = arrow.length;
        let width = arrow.width;
        let direction = tip.sub(from);
        if direction.norm() < 1e-10 {
            return Ok(());
        }
        let u = direction.scale(1. / direction.norm());
        let normal = Point { x: -u.y, y: u.x };
        let base = tip.sub(u.scale(len));
        let left = base.add(normal.scale(width / 2.));
        let right = base.sub(normal.scale(width / 2.));
        let color = self
            .state
            .styles
            .color(get(options, "draw", get(options, "draw color", "black")).trim())
            .or_else(|_| self.state.styles.color("black"))?;
        let open = arrow.open;
        let fill = if open { "none" } else { &color };
        if arrow.bar {
            let a = tip.add(normal.scale(width));
            let b = tip.sub(normal.scale(width));
            self.bbox.point(a);
            self.bbox.point(b);
            let mut paint = options.clone();
            paint.remove("fill");
            self.elements.push((
                options.contains_key("on background layer"),
                format!(
                    "<path d=\"M {} L {}\" {}/>",
                    a.svg(),
                    b.svg(),
                    self.paint(&paint, true)?
                ),
            ));
        }
        if !arrow.head {
            return Ok(());
        }
        if len <= 0. || width <= 0. {
            return Err("arrow dimensions must be positive".into());
        }
        let notch = tip.sub(u.scale(len * 0.7));
        let d = if arrow.stealth {
            format!(
                "M {} L {} L {} L {} Z",
                tip.svg(),
                left.svg(),
                notch.svg(),
                right.svg()
            )
        } else if arrow.latex {
            let control = tip.sub(u.scale(len * 0.45));
            format!(
                "M {} Q {} {} Q {} {} Q {} {} Z",
                tip.svg(),
                control.svg(),
                left.svg(),
                base.add(u.scale(len * 0.15)).svg(),
                right.svg(),
                control.svg(),
                tip.svg()
            )
        } else {
            format!("M {} L {} L {} Z", tip.svg(), left.svg(), right.svg())
        };
        self.bbox.point(left);
        self.bbox.point(right);
        self.bbox.point(tip);
        self.elements.push((
            options.contains_key("on background layer"),
            format!(
                "<path d=\"{d}\" fill=\"{fill}\" stroke=\"{color}\" stroke-width=\"0.4\"{}/>",
                opacity_attribute(
                    "opacity",
                    dim(options, "opacity", 1.)? * dim(options, "draw opacity", 1.)?
                )
            ),
        ));
        Ok(())
    }
    pub(super) fn brace(&mut self, start: Point, end: Point, spec: &str) -> Result<String, String> {
        let mut amplitude = 2.5 * 72. / 72.27;
        let mut aspect = 0.5;
        let mut mirror = false;
        let mut brace = false;
        for opt in split_top(spec, ',') {
            let (key, value) = opt.split_once('=').unwrap_or((opt, ""));
            match key.trim() {
                "brace" if value.is_empty() => brace = true,
                "mirror" if value.is_empty() || value == "true" => mirror = true,
                "amplitude" => amplitude = length(value, 1.)?,
                "aspect" => aspect = number(value)?,
                _ => return Err(format!("Unsupported brace option '{opt}'")),
            }
        }
        if !brace || amplitude <= 0. || !(0.0..=1.0).contains(&aspect) {
            return Err("decoration requires brace, positive amplitude, aspect in 0..1".into());
        }
        let delta = end.sub(start);
        let len = delta.norm();
        if len < 1e-10 {
            return Err("brace needs a nonzero segment".into());
        }
        let u = delta.scale(1. / len);
        let n = Point { x: -u.y, y: u.x }.scale(if mirror { -1. } else { 1. });
        let mut p = |x: f64, y: f64| {
            let p = start.add(u.scale(x)).add(n.scale(y * amplitude));
            self.bbox.point(p);
            p.svg()
        };
        let m = aspect * len;
        let a = amplitude.min(m / 2.);
        let b = amplitude.min((len - m) / 2.);
        Ok(format!(
            " M {} C {} {} {} L {} C {} {} {} C {} {} {} L {} C {} {} {} ",
            p(0., 0.),
            p(0.15 * a, 0.3),
            p(0.5 * a, 0.5),
            p(a, 0.5),
            p(m - a, 0.5),
            p(m - 0.5 * a, 0.5),
            p(m - 0.15 * a, 0.7),
            p(m, 1.),
            p(m + 0.15 * b, 0.7),
            p(m + 0.5 * b, 0.5),
            p(m + b, 0.5),
            p(len - b, 0.5),
            p(len - 0.5 * b, 0.5),
            p(len - 0.15 * b, 0.3),
            p(len, 0.)
        ))
    }
    pub(super) fn append_curve(
        &mut self,
        d: &mut String,
        points: &mut Vec<Point>,
        start: Point,
        a: Point,
        b: Point,
        end: Point,
    ) {
        d.push_str(&format!(" C {} {} {} ", a.svg(), b.svg(), end.svg()));
        self.bbox.cubic(start, a, b, end);
        for i in 1..=32 {
            let t = i as f64 / 32.;
            let u = 1. - t;
            points.push(
                start
                    .scale(u * u * u)
                    .add(a.scale(3. * u * u * t))
                    .add(b.scale(3. * u * t * t))
                    .add(end.scale(t * t * t)),
            );
        }
    }
}

pub(super) fn orthogonal_corner(matrix: Matrix, start: Point, end: Point, vertical: bool) -> Point {
    let [sx, sy] = matrix.inverse_point(start.x, start.y);
    let [ex, ey] = matrix.inverse_point(end.x, end.y);
    let [x, y] = if vertical {
        matrix.point(sx, ey)
    } else {
        matrix.point(ex, sy)
    };
    Point { x, y }
}

pub(super) fn ellipse_curve(
    center: Point,
    rx: f64,
    ry: f64,
    start: f64,
    end: f64,
    matrix: Matrix,
) -> Vec<(Point, Point, Point, Point)> {
    let count = ((end - start).abs() / 90.).ceil().max(1.) as usize;
    let step = (end - start).to_radians() / count as f64;
    let point = |angle: f64| {
        let [x, y] = matrix.vector(rx * angle.cos(), ry * angle.sin());
        center.add(Point { x, y })
    };
    let tangent = |angle: f64| {
        let [x, y] = matrix.vector(-rx * angle.sin(), ry * angle.cos());
        Point { x, y }
    };
    (0..count)
        .map(|i| {
            let a = start.to_radians() + i as f64 * step;
            let b = a + step;
            let k = 4. / 3. * (step / 4.).tan();
            (
                point(a),
                point(a).add(tangent(a).scale(k)),
                point(b).sub(tangent(b).scale(k)),
                point(b),
            )
        })
        .collect()
}

pub(super) fn radius(o: &Values, key: &str, default: f64) -> Result<f64, String> {
    o.get(key).map(|v| length(v, CM)).unwrap_or(Ok(default))
}

#[derive(Clone, Copy)]
pub(super) enum PathTiming {
    Distance,
    Orthogonal,
}

impl PathTiming {
    pub(super) fn sample(self, points: &[Point], fraction: f64) -> (Point, Point) {
        if matches!(self, Self::Orthogonal) {
            // TikZ's hvline/vhline timers reserve half the time for each
            // leg, independent of length (including zero-length legs).
            // At t=0.5 the tangent belongs to the second leg.
            let t = fraction.clamp(0., 1.) * 2.;
            let (leg, local) = if t < 1. { (0, t) } else { (1, t - 1.) };
            let direction = points[leg + 1].sub(points[leg]);
            return (points[leg].add(direction.scale(local)), direction);
        }
        let location = path_location(points, fraction);
        let direction = path_location(points, (fraction + 0.001).min(1.))
            .sub(path_location(points, (fraction - 0.001).max(0.)));
        (location, direction)
    }
}

fn path_location(points: &[Point], fraction: f64) -> Point {
    if points.len() < 2 {
        return points.first().copied().unwrap_or_default();
    }
    let total: f64 = points.windows(2).map(|p| p[1].sub(p[0]).norm()).sum();
    let mut remaining = total * fraction.clamp(0., 1.);
    for pair in points.windows(2) {
        let d = pair[1].sub(pair[0]);
        let len = d.norm();
        if remaining <= len && len > 0. {
            return pair[0].add(d.scale(remaining / len));
        }
        remaining -= len;
    }
    *points.last().unwrap()
}

pub(super) fn rounded_path(points: &[Point], radius: f64) -> String {
    let mut d = format!("M {} ", points[0].svg());
    for triple in points.windows(3) {
        let a = triple[0];
        let b = triple[1];
        let c = triple[2];
        let ba = a.sub(b);
        let bc = c.sub(b);
        let r = radius.min(ba.norm() / 2.).min(bc.norm() / 2.);
        if r <= 0. {
            continue;
        }
        let entry = b.add(ba.scale(r / ba.norm()));
        let exit = b.add(bc.scale(r / bc.norm()));
        d.push_str(&format!("L {} Q {} {} ", entry.svg(), b.svg(), exit.svg()));
    }
    d.push_str(&format!("L {}", points.last().unwrap().svg()));
    d
}
