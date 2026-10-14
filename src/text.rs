use crate::options::{Styles, Values, dim, get, length};
use crate::syntax::Cursor;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_layout::PagedDocument;

#[derive(Clone, Debug)]
pub struct Label {
    pub width: f64,
    pub height: f64,
    /// Baseline measured downwards from the top of the label box.
    pub baseline: f64,
    pub svg: String,
}
struct TextWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    source: Source,
}
impl World for TextWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }
    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }
    fn main(&self) -> FileId {
        self.source.id()
    }
    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main() {
            Ok(self.source.clone())
        } else {
            Err(FileError::AccessDenied)
        }
    }
    fn file(&self, _: FileId) -> FileResult<Bytes> {
        Err(FileError::AccessDenied)
    }
    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }
    fn today(&self, _: Option<Duration>) -> Option<Datetime> {
        None
    }
}
pub struct TextEngine {
    world: TextWorld,
    cache: HashMap<String, Arc<Label>>,
    pub timings: TextTimings,
    system_fonts_checked: HashSet<String>,
}
/// CPU wall times within one diagram; cache hits skip Typst layout.
#[derive(Clone, Copy, Debug, Default)]
pub struct TextTimings {
    pub font_init_ms: f64,
    pub layout_svg_ms: f64,
    pub labels: usize,
    pub cache_hits: usize,
}
impl Default for TextEngine {
    fn default() -> Self {
        Self::new()
    }
}
impl TextEngine {
    pub fn new() -> Self {
        let started = Instant::now();
        let data: [&'static [u8]; 6] = [
            include_bytes!("../assets/fonts/ipaexm.ttf"),
            include_bytes!("../assets/fonts/ipaexg.ttf"),
            include_bytes!("../assets/fonts/NewCMMath-Regular.otf"),
            include_bytes!("../assets/fonts/FontAwesome.otf"),
            include_bytes!("../assets/fonts/lmmono10-regular.otf"),
            include_bytes!("../assets/fonts/lmmono10-italic.otf"),
        ];
        let fonts: Vec<_> = data
            .iter()
            .map(|data| Font::new(Bytes::new(*data), 0).expect("bundled font is valid"))
            .collect();
        let id = FileId::new(RootedPath::new(
            VirtualRoot::Project,
            VirtualPath::new("label.typ").unwrap(),
        ));
        Self {
            world: TextWorld {
                library: LazyHash::new(Library::default()),
                book: LazyHash::new(FontBook::from_fonts(&fonts)),
                fonts,
                source: Source::new(id, String::new()),
            },
            cache: HashMap::new(),
            system_fonts_checked: HashSet::new(),
            timings: TextTimings {
                font_init_ms: started.elapsed().as_secs_f64() * 1000.,
                ..Default::default()
            },
        }
    }
    pub fn layout(
        &mut self,
        text: &str,
        options: &Values,
        styles: &Styles,
        mainfont: &str,
    ) -> Result<Arc<Label>, String> {
        let family = mainfont.to_lowercase();
        if self.world.book.select_family(&family).next().is_none() {
            // Only search installed fonts for an explicitly requested family.
            // Bundled-font diagrams remain deterministic and skip this scan.
            if self.system_fonts_checked.insert(family.clone()) {
                let started = Instant::now();
                let mut db = fontdb::Database::new();
                db.load_system_fonts();
                let faces: Vec<_> = db
                    .faces()
                    .filter(|face| {
                        face.families
                            .iter()
                            .any(|(name, _)| name.eq_ignore_ascii_case(mainfont))
                    })
                    .map(|face| face.id)
                    .collect();
                for id in faces {
                    if let Some(Some(font)) = db.with_face_data(id, |data, index| {
                        Font::new(Bytes::new(data.to_vec()), index)
                    }) {
                        self.world.fonts.push(font);
                    }
                }
                self.world.book = LazyHash::new(FontBook::from_fonts(&self.world.fonts));
                self.timings.font_init_ms += started.elapsed().as_secs_f64() * 1000.;
            }
            if self.world.book.select_family(&family).next().is_none() {
                return Err(format!(
                    "font not bundled or installed: '{mainfont}' (IPAexMincho, IPAexGothic are bundled)"
                ));
            }
        }
        if text.trim().is_empty() {
            return Ok(Arc::new(Label {
                width: 0.,
                height: 0.,
                baseline: 0.,
                svg: String::new(),
            }));
        }
        let width = font_dim(options, "text width", 0.)?;
        let color = styles.color(get(options, "text", "black"))?;
        let (font_size, baseline_skip) = font_metrics(get(options, "font", ""))?;
        let top_edge = font_size * 0.8;
        let bottom_edge = -font_size * 0.2;
        let leading = baseline_skip - font_size;
        let mut c = Converter {
            styles,
            strut: font_size,
        };
        let switches = c.convert(get(options, "font", ""))?;
        let content = c.convert(text)?;
        let alignment = match get(options, "align", if width > 0. { "left" } else { "center" }) {
            "left" => "left",
            "right" => "right",
            _ => "center",
        };
        let width = if width > 0. {
            format!("{width}pt")
        } else {
            "auto".into()
        };
        let source = format!(
            "#set page(width: {width}, height: auto, margin: 0pt, fill: none)\n#set text(font: {}, size: {}pt, fill: rgb(\"{color}\"), top-edge: {top_edge}pt, bottom-edge: {bottom_edge}pt, overhang: false)\n#show math.equation: set text(font: \"New Computer Modern Math\")\n#set par(leading: {leading}pt, spacing: 0pt, justify: {})\n#set align({alignment})\n{switches}{content}",
            quote(mainfont),
            10. * 72. / 72.27,
            get(options, "align", "") == "justify"
        );
        if let Some(label) = self.cache.get(&source) {
            self.timings.cache_hits += 1;
            return Ok(label.clone());
        }
        let started = Instant::now();
        let helpers = "#let negthinspace = h(-0.166667em)\n#let textmath(body) = box(body)\n#let texttt(body) = text(font: (\"Latin Modern Mono\", \"IPAexGothic\"), ligatures: false, body)\n#let mitexdisplay = math.display\n#let mitextext = math.inline\n#let big(body) = math.lr(body, size: 120%)\n#let Big(body) = math.lr(body, size: 180%)\n#let bigg(body) = math.lr(body, size: 240%)\n#let Bigg(body) = math.lr(body, size: 300%)\n#let mitexmathbf(body) = math.bold(math.upright(body))\n#let operatorname(body) = math.op(math.upright(body))\n#let diff = math.partial\n#let pmatrix(..cells) = math.mat(delim: \"(\", ..cells)\n#let bmatrix(..cells) = math.mat(delim: \"[\", ..cells)\n#let mitexunderbrace(body) = math.underbrace(body)\n#let mitexoverbrace(body) = math.overbrace(body)\n#let operatornamewithlimits(body) = math.op(limits: true, math.upright(body))\n#let underset(below, body) = math.attach(math.limits(body), b: below)\n#let overset(above, body) = math.attach(math.limits(body), t: above)\n#let mitexsqrt(..args) = if args.pos().len() == 1 { math.sqrt(args.pos().at(0)) } else { let index = args.pos().at(0); math.root(if index.has(\"children\") { index.children.filter(it => it != [\\[] and it != [\\]]).sum() } else { index }, args.pos().at(1)) }\n";
        // Typst exposes a single font as a string and fallback fonts as an
        // array; named weights are strings, while custom weights are numbers.
        // Normalize these values before matching synthetic font styles.
        let font_styles = r#"#show text: body => context {
 let family = if type(text.font) == str { text.font } else { text.font.first() }
 let bold = if type(text.weight) == str {
   text.weight in ("semibold", "bold", "extrabold", "black")
 } else { text.weight >= 600 }
 let body = if family in ("ipaexmincho", "ipaexgothic") and bold {
   box(inset: 0.01em, text(stroke: (paint: text.fill, thickness: 0.02em), body))
 } else { body }
 if family in ("ipaexmincho", "ipaexgothic", "noto sans cjk jp", "noto sans mono cjk jp") and text.style != "normal" {
   skew(ax: -12deg, reflow: true, body)
 } else { body }
}"#;
        self.world.source = Source::new(
            self.world.main(),
            format!(
                "{helpers}#let smallmatrix(..rows) = math.script(math.mat(delim: none, ..rows))\n#set text(lang: \"ja\")\n{font_styles}\n{source}"
            ),
        );
        let result = typst::compile::<PagedDocument>(&self.world);
        // A missing glyph or font must not silently turn into a broken label.
        if let Some(w) = result
            .warnings
            .iter()
            .find(|w| w.message.contains("font") || w.message.contains("glyph"))
        {
            return Err(format!("text: {}", w.message));
        }
        let doc = result.output.map_err(|errors| {
            errors
                .iter()
                .map(|e| e.message.to_string())
                .collect::<Vec<_>>()
                .join("; ")
        })?;
        if doc.pages().len() != 1 {
            return Err("text layout unexpectedly produced multiple pages".into());
        }
        let page = &doc.pages()[0];
        let (top, bottom, baselines) = frame_metrics(&page.frame)?;
        let trim = top.is_finite()
            && bottom > top
            && !text.contains("phantom")
            && !text.contains("vspace");
        let top = if trim { top } else { 0. };
        let height = if trim {
            bottom - top
        } else {
            page.frame.height().to_pt()
        };
        let baseline = if dim(options, "text width", 0.)? > 0. {
            baselines.iter().copied().reduce(f64::min)
        } else {
            baselines.iter().copied().reduce(f64::max)
        }
        .unwrap_or(page.frame.baseline().to_pt())
            - top;
        let mut svg = typst_svg::svg(page, &Default::default());
        // Nested SVG dimensions must be user units (bp), not CSS pt (4/3 px).
        let root_end = svg.find('>').ok_or("invalid text SVG")?;
        let root = format!(
            "<svg viewBox=\"0 {top} {} {height}\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"{}\" height=\"{height}\"",
            page.frame.width().to_pt(),
            page.frame.width().to_pt()
        );
        svg.replace_range(..root_end, &root);
        let label = Arc::new(Label {
            width: page.frame.width().to_pt(),
            height,
            baseline,
            svg,
        });
        self.timings.labels += 1;
        self.timings.layout_svg_ms += started.elapsed().as_secs_f64() * 1000.;
        // Bound a long-lived preview worker's cache. Large individual labels
        // still render correctly without retaining them between requests.
        if self.cache.len() >= 256
            || self.cache.values().map(|v| v.svg.len()).sum::<usize>() > 16 * 1024 * 1024
        {
            self.cache.clear();
        }
        if label.svg.len() <= 1024 * 1024 {
            self.cache.insert(source, label.clone());
        }
        Ok(label)
    }
}

/// Ink extents and actual line baselines from Typst's shaped frame tree, not
/// a fraction of node height. Keep horizontal advances for TeX-like boxes.
fn frame_metrics(frame: &typst::layout::Frame) -> Result<(f64, f64, Vec<f64>), String> {
    use crate::transform::Matrix;
    use typst::layout::FrameItem;
    fn walk(
        frame: &typst::layout::Frame,
        m: Matrix,
        collect: bool,
        top: &mut f64,
        bottom: &mut f64,
        baselines: &mut Vec<f64>,
    ) -> Result<(), String> {
        let collect = if collect && frame.has_baseline() {
            baselines.push(m.point(0., frame.baseline().to_pt())[1]);
            false
        } else {
            collect
        };
        for (pos, item) in frame.items() {
            let p = m.then(Matrix([1., 0., 0., 1., pos.x.to_pt(), pos.y.to_pt()]))?;
            let bbox = match item {
                FrameItem::Text(text) => {
                    if collect {
                        baselines.push(p.point(0., 0.)[1]);
                    }
                    Some(text.bbox())
                }
                FrameItem::Shape(shape, _) => Some(shape.bbox(true)),
                FrameItem::Group(group) => {
                    let t = group.transform;
                    let next = p.then(Matrix([
                        t.sx.get(),
                        t.ky.get(),
                        t.kx.get(),
                        t.sy.get(),
                        t.tx.to_pt(),
                        t.ty.to_pt(),
                    ]))?;
                    walk(&group.frame, next, collect, top, bottom, baselines)?;
                    None
                }
                _ => None,
            };
            if let Some(bbox) = bbox {
                for x in [bbox.min.x.to_pt(), bbox.max.x.to_pt()] {
                    for y in [bbox.min.y.to_pt(), bbox.max.y.to_pt()] {
                        let y = p.point(x, y)[1];
                        if y.is_finite() {
                            *top = top.min(y);
                            *bottom = bottom.max(y);
                        }
                    }
                }
            }
        }
        Ok(())
    }
    let mut top = f64::INFINITY;
    let mut bottom = f64::NEG_INFINITY;
    let mut baselines = Vec::new();
    walk(
        frame,
        Matrix::default(),
        true,
        &mut top,
        &mut bottom,
        &mut baselines,
    )?;
    Ok((top, bottom, baselines))
}

fn quote(s: &str) -> String {
    format!(
        "\"{}\"",
        s.replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "")
    )
}
/// Node font determines the line strut and baseline skip, independent of
/// smaller inline runs (TikZ's multiline alignment must not collapse them).
pub fn font_dim(options: &Values, key: &str, default: f64) -> Result<f64, String> {
    if let Some(value) = options.get(key) {
        for (suffix, scale) in [("em", 1.), ("ex", 0.43)] {
            if let Some(n) = value.trim().strip_suffix(suffix) {
                return length(n, font_metrics(get(options, "font", ""))?.0 * scale);
            }
        }
    }
    dim(options, key, default)
}
pub fn font_metrics(font: &str) -> Result<(f64, f64), String> {
    let mut cur = Cursor::new(font);
    let mut metrics = (10. * 72. / 72.27, 12. * 72. / 72.27);
    while !cur.rest().is_empty() {
        if cur.eat("\\") {
            let cmd = cur.word();
            if cmd == "fontsize" {
                metrics = (
                    length(cur.group('{', '}')?, 72. / 72.27)?,
                    length(cur.group('{', '}')?, 72. / 72.27)?,
                );
            } else if let Some((s, b)) = preset_size(cmd) {
                metrics = (s * 72. / 72.27, b * 72. / 72.27);
            }
        } else if let Some(c) = cur.rest().chars().next() {
            cur.pos += c.len_utf8();
        }
    }
    if metrics.0 <= 0. || metrics.1 <= 0. {
        return Err("font size and baseline skip must be positive".into());
    }
    Ok(metrics)
}
fn preset_size(cmd: &str) -> Option<(f64, f64)> {
    Some(match cmd {
        "tiny" => (5., 6.),
        "scriptsize" => (7., 8.),
        "footnotesize" => (8., 9.5),
        "small" => (9., 11.),
        "normalsize" => (10., 12.),
        "large" => (12., 14.),
        "Large" => (14.4, 18.),
        "LARGE" => (17.28, 22.),
        "huge" => (20.74, 25.),
        "Huge" => (24.88, 30.),
        _ => return None,
    })
}
/// mitex emits symbol names of an older Typst; rename the ones the bundled
/// Typst no longer accepts. Quoted text is left untouched.
fn current_symbols(math: &str) -> String {
    const RENAMED: &[(&str, &str)] = &[
        ("dot.circle", "dot.o"),
        ("times.circle", "times.o"),
        ("plus.circle", "plus.o"),
        ("minus.circle", "minus.o"),
        ("dot.circle.big", "dot.o.big"),
        ("times.circle.big", "times.o.big"),
        ("plus.circle.big", "plus.o.big"),
        ("sect", "inter"),
        ("sect.big", "inter.big"),
        ("dots.h.c", "dots.c"),
        ("angle.l", "chevron.l"),
        ("angle.r", "chevron.r"),
    ];
    let mut out = String::with_capacity(math.len());
    let mut chars = math.char_indices().peekable();
    let mut quoted = false;
    while let Some((start, ch)) = chars.next() {
        if ch == '\\' {
            out.push(ch);
            if let Some((_, next)) = chars.next() {
                out.push(next);
            }
        } else if ch == '"' {
            quoted = !quoted;
            out.push(ch);
        } else if !quoted && ch.is_ascii_alphabetic() {
            let mut end = start + 1;
            while let Some((i, c)) = chars.peek().copied() {
                if c.is_ascii_alphanumeric() || c == '.' {
                    end = i + 1;
                    chars.next();
                } else {
                    break;
                }
            }
            let word = &math[start..end];
            out.push_str(
                RENAMED
                    .iter()
                    .find(|(old, _)| *old == word)
                    .map_or(word, |(_, new)| new),
            );
        } else {
            out.push(ch);
        }
    }
    out
}
struct Converter<'a> {
    styles: &'a Styles,
    strut: f64,
}
impl Converter<'_> {
    fn convert(&mut self, input: &str) -> Result<String, String> {
        let mut cursor = Cursor::new(input);
        let mut output = String::new();
        let mut plain = String::new();
        fn flush(plain: &mut String, out: &mut String) {
            if !plain.is_empty() {
                out.push_str(&format!("#text({})", quote(plain)));
                plain.clear();
            }
        }
        while !cursor.rest().is_empty() {
            let ch = cursor.rest().chars().next().unwrap();
            match ch {
                '{' => {
                    flush(&mut plain, &mut output);
                    let group = cursor.group('{', '}')?;
                    output.push_str(&format!("#[{}]", self.convert(group)?));
                }
                '}' => return Err("unmatched text group".into()),
                '$' => {
                    flush(&mut plain, &mut output);
                    cursor.pos += 1;
                    let start = cursor.pos;
                    let mut end = None;
                    let mut escape = false;
                    for (i, c) in cursor.rest().char_indices() {
                        if c == '$' && !escape {
                            end = Some(start + i);
                            break;
                        }
                        escape = c == '\\' && !escape;
                    }
                    let end = end.ok_or("unclosed inline math")?;
                    output.push_str(&Self::math(&input[start..end])?);
                    cursor.pos = end + 1;
                }
                '\\' => {
                    flush(&mut plain, &mut output);
                    cursor.pos += 1;
                    if cursor.rest().is_empty() {
                        return Err("incomplete text command".into());
                    }
                    let c = cursor.rest().chars().next().unwrap();
                    if !c.is_ascii_alphabetic() {
                        cursor.pos += c.len_utf8();
                        match c {
                            '\\' => {
                                output.push_str("#linebreak()");
                                // TeX ignores source indentation after an explicit
                                // line break. Emitting it as #text(" ") instead
                                // gives the next line a visible leading space.
                                Self::skip_line_indent(&mut cursor);
                                if cursor.rest().starts_with('[') {
                                    let v = cursor.group('[', ']')?;
                                    output.push_str(&format!("#v({}pt)", length(v, 1.)?));
                                    Self::skip_line_indent(&mut cursor);
                                }
                            }
                            '_' | '%' | '&' | '#' | '$' | '{' | '}' => {
                                output.push_str(&format!("#text({})", quote(&c.to_string())))
                            }
                            ',' => output.push_str("#h(0.16667em)"),
                            '!' => output.push_str("#h(-0.16667em)"),
                            ';' => output.push_str("#h(0.27778em)"),
                            ':' => output.push_str("#h(0.22222em)"),
                            '^' | '~' => {
                                let group = cursor.group('{', '}')?;
                                if !group.is_empty() {
                                    return Err("Unsupported text accent (only empty \\^{} and \\~{} are supported)".into());
                                }
                                output.push_str(&format!("#text({})", quote(&c.to_string())));
                            }
                            ' ' => output.push_str("#h(0.333em)"),
                            _ => return Err(format!("Unsupported text command \\{c}")),
                        }
                        continue;
                    }
                    let cmd = cursor.word();
                    if let Some((size, _)) = preset_size(cmd) {
                        let strut = self.strut.max(size * 72. / 72.27);
                        output.push_str(&format!(
                            "#set text(size: {}pt, top-edge: {}pt, bottom-edge: {}pt)\n",
                            size * 72. / 72.27,
                            strut * 0.8,
                            -strut * 0.2
                        ));
                        cursor.ws();
                        continue;
                    }
                    match cmd {
                        "begin" => {
                            if cursor.group('{', '}')? != "tabular" {
                                return Err(
                                    "Unsupported text environment (only tabular is supported)"
                                        .into(),
                                );
                            }
                            let columns = cursor.group('{', '}')?;
                            let end = cursor
                                .rest()
                                .find("\\end{tabular}")
                                .ok_or("unclosed tabular")?;
                            let body = &cursor.rest()[..end];
                            output.push_str(&self.tabular(columns, body)?);
                            cursor.pos += end + "\\end{tabular}".len();
                            continue;
                        }
                        "bfseries" => output.push_str("#set text(weight: \"bold\")\n"),
                        "mdseries" => output.push_str("#set text(weight: \"regular\")\n"),
                        "itshape" => output.push_str("#set text(style: \"italic\")\n"),
                        "upshape" => output.push_str("#set text(style: \"normal\")\n"),
                        "selectfont" => {}
                        "fontsize" => {
                            let a = cursor.group('{', '}')?;
                            let b = cursor.group('{', '}')?;
                            let size = length(a,72./72.27)?;
                            let baseline = length(b,72./72.27)?;
                            if size <= 0. || baseline <= 0. { return Err("font size and baseline skip must be positive".into()); }
                            output.push_str(&format!(
                                "#set text(size: {size}pt, top-edge: {}pt, bottom-edge: {}pt)\n",
                                self.strut.max(size)*0.8,-self.strut.max(size)*0.2
                            ));
                        }
                        "color" => {
                            let color = self.styles.color(cursor.group('{', '}')?)?;
                            output.push_str(&format!("#set text(fill: rgb(\"{color}\"))\n"));
                        }
                        // Math whether or not the surrounding text already is.
                        "ensuremath" => {
                            output.push_str(&Self::math(cursor.group('{', '}')?)?);
                            continue;
                        }
                        "underline" => {
                            let content = self.convert(cursor.group('{', '}')?)?;
                            output.push_str(&format!("#underline[{content}]"));
                            continue;
                        }
                        "textcolor" => {
                            let color = self.styles.color(cursor.group('{', '}')?)?;
                            let content = self.convert(cursor.group('{', '}')?)?;
                            output.push_str(&format!("#text(fill: rgb(\"{color}\"))[{content}]"));
                            continue;
                        }
                        "hspace" | "vspace" => {
                            cursor.eat("*");
                            let value = cursor.group('{', '}')?;
                            let dimension = if let Some(n) = value.trim().strip_suffix("em") {
                                format!("{}em", crate::expr::eval(n)?)
                            } else if let Some(n) = value.trim().strip_suffix("ex") {
                                format!("{}em", crate::expr::eval(n)? * 0.43)
                            } else {
                                format!("{}pt", length(value, 72. / 72.27)?)
                            };
                            output.push_str(&format!(
                                "#{}({dimension})",
                                if cmd == "hspace" { "h" } else { "v" }
                            ));
                            continue;
                        }
                        "phantom" | "hphantom" | "vphantom" => {
                            let content = self.convert(cursor.group('{', '}')?)?;
                            let sizing = match cmd {
                                "hphantom" => "height: 0pt,",
                                "vphantom" => "width: 0pt,",
                                _ => "",
                            };
                            output.push_str(&format!("#box({sizing})[#hide[{content}]]"));
                            continue;
                        }
                        "textcircled" => {
                            let content = self.convert(cursor.group('{', '}')?)?;
                            output.push_str(&format!(
                                "#box(baseline: 15%)[#circle(radius: 0.5em, inset: 0pt, stroke: 0.4pt)[#align(center + horizon)[{content}]]]"
                            ));
                            continue;
                        }
                        "dots" | "ldots" | "textellipsis" => output.push_str("#text(\"…\")"),
                        "textbackslash" => output.push_str("#text(\"\\\\\")"),
                        "textasciicircum" => output.push_str("#text(\"^\")"),
                        "textasciitilde" => output.push_str("#text(\"~\")"),
                        "textless" => output.push_str("#text(\"<\")"),
                        "textgreater" => output.push_str("#text(\">\")"),
                        "textbf" | "textit" | "emph" | "texttt" | "textsf" | "textrm" | "mbox" => {
                            let group = cursor.group('{', '}')?;
                            let content = self.convert(group)?;
                            let style = match cmd {
                                "textbf" => "weight: \"bold\"",
                                "textit" | "emph" => "style: \"italic\"",
                                "texttt" => "font: (\"Latin Modern Mono\", \"IPAexGothic\"), ligatures: false",
                                "textsf" => "font: \"IPAexGothic\"",
                                _ => "font: \"IPAexMincho\"",
                            };
                            output.push_str(&format!("#text({style})[{content}]"));
                            continue;
                        }
                        "ttfamily" => {
                            output.push_str("#set text(font: (\"Latin Modern Mono\", \"IPAexGothic\"), ligatures: false)\n")
                        }
                        "sffamily" => output.push_str("#set text(font: \"IPAexGothic\")\n"),
                        "rmfamily" => output.push_str("#set text(font: \"IPAexMincho\")\n"),
                        "quad" => output.push_str("#h(1em)"),
                        "enspace" | "enskip" => output.push_str("#h(0.5em)"),
                        "qquad" => output.push_str("#h(2em)"),
                        "faGlobe" => output.push_str("#text(font: \"FontAwesome\")[\u{f0ac}]"),
                        "faSitemap" => output.push_str("#text(font: \"FontAwesome\")[\u{f0e8}]"),
                        "faFolderOpen" => output.push_str("#text(font: \"FontAwesome\")[\u{f07c}]"),
                        "faFileO" => output.push_str("#text(font: \"FontAwesome\")[\u{f016}]"),
                        _ => return Err(format!("Unsupported text command \\{cmd}")),
                    }
                    cursor.ws();
                }
                '~' => {
                    plain.push('\u{a0}');
                    cursor.pos += 1;
                }
                _ => {
                    if cursor.rest().starts_with("---") {
                        plain.push('—');
                        cursor.pos += 3;
                    } else if cursor.rest().starts_with("--") {
                        plain.push('–');
                        cursor.pos += 2;
                    } else if ch.is_whitespace() {
                        if !plain.ends_with(' ') {
                            plain.push(' ');
                        }
                        cursor.pos += ch.len_utf8();
                    } else {
                        plain.push(ch);
                        cursor.pos += ch.len_utf8();
                    }
                }
            }
        }
        flush(&mut plain, &mut output);
        Ok(output)
    }

    fn math(source: &str) -> Result<String, String> {
        // Inside math `\ensuremath{x}` is just `{x}`.
        let math = mitex::convert_math(&source.replace("\\ensuremath", ""), None)
            .map_err(|e| format!("Unsupported math: {e}"))?;
        Ok(format!(
            "#math.equation(block: false, ${}$)",
            current_symbols(&math)
        ))
    }

    fn skip_line_indent(cursor: &mut Cursor<'_>) {
        // Only source whitespace: keep explicit spacing commands, NBSP and
        // full-width spaces available for intentional indentation.
        cursor.pos += cursor.rest().len()
            - cursor
                .rest()
                .trim_start_matches([' ', '\t', '\r', '\n'])
                .len();
    }

    fn tabular(&mut self, spec: &str, body: &str) -> Result<String, String> {
        let mut aligns = Vec::new();
        let mut rules = Vec::new();
        for ch in spec.chars().filter(|ch| !ch.is_whitespace()) {
            match ch {
                'l' => aligns.push("left"),
                'c' => aligns.push("center"),
                'r' => aligns.push("right"),
                '|' => rules.push(aligns.len()),
                _ => {
                    return Err("Unsupported tabular column (only l/c/r and single | rules)".into());
                }
            }
        }
        if aligns.is_empty() || aligns.len() > 32 || rules.windows(2).any(|w| w[0] == w[1]) {
            return Err("invalid/unsupported tabular columns".into());
        }
        let mut rows = Vec::new();
        let mut c = Cursor::new(body);
        let mut start = 0;
        while !c.rest().is_empty() {
            if c.rest().starts_with("\\\\") {
                rows.push(&body[start..c.pos]);
                c.pos += 2;
                start = c.pos;
            } else if c.rest().starts_with('{') {
                c.group('{', '}')?;
            } else if c.rest().starts_with('\\') {
                c.pos += 1;
                if let Some(ch) = c.rest().chars().next() {
                    c.pos += ch.len_utf8();
                }
            } else {
                c.pos += c.rest().chars().next().unwrap().len_utf8();
            }
        }
        rows.push(&body[start..]);
        if rows.len() > 1000 {
            return Err("tabular exceeds 1000 rows".into());
        }
        let mut cells = String::new();
        for rule in rules {
            cells.push_str(&format!("grid.vline(x: {rule}, stroke: 0.4pt),"));
        }
        for row in rows {
            let mut row = row.trim();
            while let Some(rest) = row.strip_prefix("\\hline") {
                cells.push_str("grid.hline(stroke: 0.4pt),");
                row = rest.trim_start();
            }
            if row.is_empty() {
                continue;
            }
            let values = crate::syntax::split_top_empty(row, '&');
            if values.len() != aligns.len() {
                return Err("tabular row/column count mismatch".into());
            }
            for value in values {
                cells.push_str(&format!("[{}],", self.convert(value.trim())?));
            }
        }
        Ok(format!(
            "#box[#grid(columns: {}, align: ({}), inset: (x: 0.6em, y: 0.15em), {cells})]",
            aligns.len(),
            aligns.iter().map(|a| format!("{a},")).collect::<String>()
        ))
    }
}
