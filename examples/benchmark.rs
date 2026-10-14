//! Run with `cargo run --release --example benchmark -- target/release/tikzc`.
//! Five fresh processes per fixture; the first is not discarded. OS caches are
//! not flushed. Besides the eight corpus fixtures, two generated data-science
//! inputs (a 1,000-point scatter and a 1,000-sample function plot) are timed.
//! Library timings are measured separately in the current process.
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
    // Generated data-science workloads, sized near what a figure would use.
    // Timings are recorded, never asserted.
    let generated = [
        (
            "ds-scatter-1000",
            // 20 x 50 loop iterations, one circle each.
            r"\begin{tikzpicture}
  \foreach \i in {1,...,20} \foreach \j in {1,...,50} {
    \pgfmathsetmacro{\x}{8*rnd}
    \pgfmathsetmacro{\y}{5*rnd}
    \fill[blue] (\x,\y) circle (1pt);
  }
\end{tikzpicture}
",
        ),
        (
            "ds-plot-samples-1000",
            r"\begin{tikzpicture}
  \draw[blue,domain=-4:4,samples=1000] plot (\x,{2.5*exp(-(\x)*(\x)/2)/sqrt(2*pi)});
\end{tikzpicture}
",
        ),
    ];
    let mut inputs: Vec<(String, std::path::PathBuf)> = [
        "test",
        "test-jp",
        "nat",
        "tls",
        "ekf-data-assimilation",
        "in-retail-rdfs",
        "napt",
        "test-multirate-backup",
    ]
    .into_iter()
    .map(|name| {
        (
            name.to_owned(),
            Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("tests/fixtures/{name}.tikz")),
        )
    })
    .collect();
    for (name, source) in generated {
        let path = dir.join(format!("{name}.tikz"));
        std::fs::write(&path, source).unwrap();
        inputs.push((name.to_owned(), path));
    }
    println!("fixture,cli_svg_ms,cli_png_ms,font_init_ms,text_layout_svg_ms,labels,library_svg_ms");
    for (name, input) in &inputs {
        let mut cli_times = Vec::new();
        for format in ["svg", "png"] {
            let output = dir.join(format!("result.{format}"));
            let mut times = Vec::new();
            for _ in 0..5 {
                let t = Instant::now();
                let result = Command::new(&binary)
                    .env("PATH", "")
                    .arg(input)
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
    std::fs::remove_dir_all(dir).unwrap();
}
