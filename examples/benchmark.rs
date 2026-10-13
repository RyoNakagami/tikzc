//! Run with `cargo run --release --example benchmark -- target/release/tikzc`.
//! Five fresh processes per fixture; the first is not discarded. OS caches are
//! not flushed. Library timings are measured separately in the current process.
use std::{path::Path, process::Command, time::Instant};
fn median(v: &mut [f64]) -> f64 {
    v.sort_by(f64::total_cmp);
    v[v.len() / 2]
}
fn main() {
    let binary = std::env::args().nth(1).expect("path to built tikzc CLI");
    let binary = std::fs::canonicalize(binary).unwrap();
    let dir = std::env::temp_dir().join(format!("tikzc-bench-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    println!("fixture,cli_svg_ms,cli_png_ms,font_init_ms,text_layout_svg_ms,labels,library_svg_ms");
    for name in [
        "test",
        "test-jp",
        "nat",
        "tls",
        "ekf-data-assimilation",
        "in-retail-rdfs",
        "napt",
        "test-multirate-backup",
    ] {
        let input =
            Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("tests/fixtures/{name}.tikz"));
        let mut cli_times = Vec::new();
        for format in ["svg", "png"] {
            let output = dir.join(format!("result.{format}"));
            let mut times = Vec::new();
            for _ in 0..5 {
                let t = Instant::now();
                let result = Command::new(&binary)
                    .env("PATH", "")
                    .arg(&input)
                    .arg("-o")
                    .arg(&output)
                    .arg("-q")
                    .output()
                    .unwrap();
                assert!(
                    result.status.success(),
                    "{}",
                    String::from_utf8_lossy(&result.stderr)
                );
                times.push(t.elapsed().as_secs_f64() * 1000.);
            }
            cli_times.push(median(&mut times));
            std::fs::remove_file(output).unwrap();
        }
        let source = std::fs::read_to_string(input).unwrap();
        let t = Instant::now();
        let d = tikzc::compile(&source).unwrap();
        let total = t.elapsed().as_secs_f64() * 1000.;
        println!(
            "{name},{:.2},{:.2},{:.2},{:.2},{},{total:.2}",
            cli_times[0],
            cli_times[1],
            d.text_timings.font_init_ms,
            d.text_timings.layout_svg_ms,
            d.text_timings.labels
        );
    }
    std::fs::remove_dir(dir).unwrap();
}
