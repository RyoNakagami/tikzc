//! Reviewed native image baselines detect regressions, NOT TeX compatibility.
//! Update intentionally, then visually review the three PNGs before accepting.
use std::path::Path;
#[test]
fn reviewed_native_raster_baselines() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/visual-native");
    for name in ["typography", "curves-transforms", "clip-matrix-patterns"] {
        let source = std::fs::read_to_string(root.join(format!("{name}.tikz"))).unwrap();
        let png = tikzc::compile(&source).unwrap().png(150.).unwrap();
        let reference = root.join(format!("{name}.png"));
        if std::env::var("UPDATE_NATIVE_GOLDENS").as_deref() == Ok("1") {
            std::fs::write(&reference, &png).unwrap();
            continue;
        }
        let expected = resvg::tiny_skia::Pixmap::load_png(&reference)
            .expect("missing reviewed baseline; see docs/TESTING.md");
        let actual = resvg::tiny_skia::Pixmap::decode_png(&png).unwrap();
        assert_eq!(
            (expected.width(), expected.height()),
            (actual.width(), actual.height()),
            "{name}: canvas changed"
        );
        let changed = expected
            .data()
            .as_chunks::<4>()
            .0
            .iter()
            .zip(actual.data().as_chunks::<4>().0)
            .filter(|(a, b)| a.iter().zip(b.iter()).any(|(x, y)| x.abs_diff(*y) > 8))
            .count();
        let fraction = changed as f64 / (actual.width() as f64 * actual.height() as f64);
        assert!(
            fraction <= 0.001,
            "{name}: {:.3}% of pixels differ; review the image, do not blindly regenerate",
            fraction * 100.
        );
    }
}
