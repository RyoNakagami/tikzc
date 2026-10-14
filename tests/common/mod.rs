//! Helpers shared by the data-science (`ds_*`) suites.
#![allow(dead_code)]
use resvg::usvg::roxmltree::Document;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// bp per cm: diagram coordinates are bp, fixtures are written in cm.
pub const CM: f64 = 72. / 2.54;
/// TeX pt per cm, for reference values printed by TeX as `pt`.
pub const TEX_PT_PER_CM: f64 = 72.27 / 2.54;

pub fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

pub fn fixture_path(name: &str) -> PathBuf {
    fixtures().join(name)
}

pub fn fixture(name: &str) -> String {
    std::fs::read_to_string(fixture_path(name)).unwrap()
}

pub fn compile_fixture(name: &str) -> tikzc::Diagram {
    tikzc::compile(&fixture(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

pub fn tikzc() -> Command {
    Command::new(env!("CARGO_BIN_EXE_tikzc"))
}

pub fn check(path: &Path) -> Output {
    tikzc()
        .arg("check")
        .arg(path)
        .output()
        .expect("spawn tikzc")
}

pub fn near(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{actual} != {expected} (tolerance {tolerance})"
    );
}

/// The source fails as unsupported/invalid and the diagnostic points at
/// `line:column`; `needle` is part of the message.
pub fn assert_error_at(source: &str, line: usize, column: usize, needle: &str) {
    let error = match tikzc::compile(source) {
        Ok(_) => panic!("must be rejected: {source}"),
        Err(error) => error,
    };
    assert!(
        error.message.contains(needle),
        "{source}: message '{}' lacks '{needle}'",
        error.message
    );
    assert_eq!(
        (error.line, error.column),
        (line, column),
        "{source}: {error}"
    );
}

/// A private scratch directory, removed by the caller.
pub fn scratch(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("tikzc-ds-{label}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// One drawn path of the diagram (label glyphs are excluded).
pub struct Drawn {
    /// On-curve points in cm, y upwards: M/L targets and curve end points.
    pub points: Vec<(f64, f64)>,
    pub subpaths: usize,
    pub stroke: String,
    pub fill: String,
}

impl Drawn {
    pub fn x_range(&self) -> (f64, f64) {
        range(self.points.iter().map(|p| p.0))
    }
    pub fn y_range(&self) -> (f64, f64) {
        range(self.points.iter().map(|p| p.1))
    }
}

fn range(values: impl Iterator<Item = f64>) -> (f64, f64) {
    values.fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), v| {
        (lo.min(v), hi.max(v))
    })
}

/// Drawn paths in document order. Text is outlined inside nested `<svg>`
/// elements and shared `<defs>`, both skipped here.
pub fn drawn(svg: &str) -> Vec<Drawn> {
    let document = Document::parse(svg).unwrap();
    let root = document.root_element();
    document
        .descendants()
        .filter(|n| n.has_tag_name("path"))
        .filter(|n| {
            n.ancestors()
                .skip(1)
                .all(|a| a == root || a.has_tag_name("g") || a.is_root())
        })
        .map(|node| {
            let mut points = Vec::new();
            let mut subpaths = 0usize;
            let mut words = node
                .attribute("d")
                .unwrap_or("")
                .split(|c: char| c.is_whitespace() || c == ',')
                .filter(|s| !s.is_empty());
            let point = |words: &mut dyn Iterator<Item = &str>| {
                let x: f64 = words.next().unwrap().parse().unwrap();
                let y: f64 = words.next().unwrap().parse().unwrap();
                (x / CM, -y / CM)
            };
            // The renderer writes one command letter per segment.
            while let Some(word) = words.next() {
                let controls = match word {
                    "M" => {
                        subpaths += 1;
                        0
                    }
                    "L" => 0,
                    "Q" => 1,
                    "C" => 2,
                    "Z" => continue,
                    other => panic!("unexpected path data '{other}'"),
                };
                for _ in 0..controls {
                    point(&mut words);
                }
                points.push(point(&mut words));
            }
            Drawn {
                points,
                subpaths,
                stroke: node.attribute("stroke").unwrap_or("").to_owned(),
                fill: node.attribute("fill").unwrap_or("").to_owned(),
            }
        })
        .collect()
}

/// The single drawn path with this stroke colour.
pub fn stroked(svg: &str, stroke: &str) -> Drawn {
    let mut found: Vec<_> = drawn(svg)
        .into_iter()
        .filter(|p| p.stroke == stroke)
        .collect();
    assert_eq!(found.len(), 1, "paths stroked {stroke}");
    found.remove(0)
}

/// Every SVG id is unique and every reference resolves.
pub fn check_references(svg: &str) {
    let document = Document::parse(svg).unwrap();
    let mut ids = std::collections::BTreeSet::new();
    for id in document.descendants().filter_map(|n| n.attribute("id")) {
        assert!(ids.insert(id), "duplicate id: {id}");
    }
    for node in document.descendants() {
        for attribute in node.attributes() {
            if attribute.name() == "href" && attribute.value().starts_with('#') {
                assert!(ids.contains(&attribute.value()[1..]));
            }
            for part in attribute.value().split("url(#").skip(1) {
                let id = part.split(')').next().unwrap();
                assert!(ids.contains(id), "missing {id}");
            }
        }
    }
}

/// RGB of a rendered pixel at a diagram position (cm, y upwards).
pub struct Raster {
    pixmap: resvg::tiny_skia::Pixmap,
    origin: (f64, f64),
    scale: f64,
}

impl Raster {
    pub fn new(diagram: &tikzc::Diagram, dpi: f64) -> Self {
        let view = &diagram.editing["viewBox"];
        Self {
            pixmap: resvg::tiny_skia::Pixmap::decode_png(&diagram.png(dpi).unwrap()).unwrap(),
            origin: (view[0].as_f64().unwrap(), view[1].as_f64().unwrap()),
            scale: dpi / 72.,
        }
    }
    pub fn rgb(&self, x: f64, y: f64) -> [u8; 3] {
        let column = ((x * CM - self.origin.0) * self.scale) as u32;
        let row = ((-y * CM - self.origin.1) * self.scale) as u32;
        let pixel = self.pixmap.pixel(column, row).expect("inside the image");
        [pixel.red(), pixel.green(), pixel.blue()]
    }
}
