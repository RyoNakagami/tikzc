use std::path::{Path, PathBuf};
use std::time::Instant;

fn main() {
    if let Err((code, message)) = run() {
        eprintln!("tikzc: {message}");
        std::process::exit(code);
    }
}
fn run() -> Result<(), (i32, String)> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args == ["--preview-server"] {
        return preview_server().map_err(|e| (1, e));
    }
    if args.iter().any(|s| s == "--version" || s == "-V") {
        println!("tikzc {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    if args.is_empty() || args.iter().any(|s| s == "--help" || s == "-h") {
        println!(
            "tikzc — Rust-native renderer for a practical subset of TikZ\n\nUsage: tikzc <file.tikz> [-o output.svg|output.png] [-f svg|png|both]\n       tikzc check <file.tikz>\n\nOptions:\n  -o, --output <path>      output file or directory\n  -f, --format <format>    svg, png, both (default: infer from output, else svg)\n      --dpi <number>       PNG resolution (default: 150)\n  -q, --quiet              suppress progress\n  -V, --version            show version\n  -h, --help               show help\n\nA file with only algorithm environments renders pseudocode (pseudocode.js syntax).\n`check` also lints pseudocode notes (% @src, % @ref, % @explain).\nUnsupported syntax produces a source-position diagnostic. No TeX subprocesses."
        );
        return if args.is_empty() {
            Err((2, "input file required".into()))
        } else {
            Ok(())
        };
    }
    let mut input = None;
    let mut output: Option<PathBuf> = None;
    let mut format: Option<String> = None;
    let mut dpi = 150.;
    let mut quiet = false;
    let mut check = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "check" if i == 0 => check = true,
            "-o" | "--output" | "-f" | "--format" | "--dpi" => {
                let key = &args[i];
                i += 1;
                let value = args
                    .get(i)
                    .ok_or_else(|| (2, format!("{key} requires a value")))?;
                match key.as_str() {
                    "-o" | "--output" => output = Some(PathBuf::from(value)),
                    "--dpi" => dpi = value.parse().map_err(|_| (2, "invalid DPI".into()))?,
                    _ => format = Some(value.clone()),
                }
            }
            "-q" | "--quiet" => quiet = true,
            value if value.starts_with('-') => {
                return Err((2, format!("unknown option '{value}'")));
            }
            value => {
                if input.replace(PathBuf::from(value)).is_some() {
                    return Err((2, "expected one input file".into()));
                }
            }
        }
        i += 1;
    }
    if !f64::is_finite(dpi) || dpi <= 0. {
        return Err((2, "DPI must be finite and positive".into()));
    }
    let input = input.ok_or_else(|| (2, "input file required".into()))?;
    let format = format.unwrap_or_else(|| {
        output
            .as_ref()
            .and_then(|p| p.extension())
            .and_then(|s| s.to_str())
            .unwrap_or("svg")
            .into()
    });
    if !["svg", "png", "both"].contains(&format.as_str()) {
        return Err((2, format!("unsupported output format '{format}'")));
    }
    let source =
        std::fs::read_to_string(&input).map_err(|e| (2, format!("{}: {e}", input.display())))?;
    let start = Instant::now();
    let base = input.parent().filter(|p| *p != Path::new(""));
    let diagram =
        tikzc::compile_at(&source, &mut tikzc::text::TextEngine::new(), base).map_err(|e| {
            (
                3,
                format!("{}:{}:{}: {}", input.display(), e.line, e.column, e.message),
            )
        })?;
    // `check` reports every lint; rendering reports warnings and errors.
    for lint in &diagram.lints {
        if check || (!quiet && lint.severity > tikzc::algo::Severity::Info) {
            let at = tikzc::Diagnostic::at(&source, lint.offset, "");
            eprintln!(
                "{}:{}:{}: {}[{}]: {}",
                input.display(),
                at.line,
                at.column,
                lint.severity,
                lint.code,
                lint.message
            );
        }
    }
    if check {
        if diagram
            .lints
            .iter()
            .any(|l| l.severity == tikzc::algo::Severity::Error)
        {
            return Err((3, format!("{}: lint errors", input.display())));
        }
        println!("{}: native supported", input.display());
        return Ok(());
    }
    let formats: Vec<_> = if format == "both" {
        vec!["svg", "png"]
    } else {
        vec![format.as_str()]
    };
    // Finish all conversions before writing any output.
    let png = if formats.contains(&"png") {
        Some(diagram.png(dpi).map_err(|e| (1, e))?)
    } else {
        None
    };
    let mut written = Vec::new();
    for extension in formats {
        let destination = match &output {
            None => input.with_extension(extension),
            Some(p)
                if p.is_dir()
                    || format == "both"
                    || p.to_string_lossy().ends_with(std::path::MAIN_SEPARATOR) =>
            {
                p.join(input.file_stem().unwrap_or_default())
                    .with_extension(extension)
            }
            Some(p) => p.clone(),
        };
        if destination == input
            || std::fs::canonicalize(&destination)
                .ok()
                .is_some_and(|p| Some(p) == std::fs::canonicalize(&input).ok())
        {
            return Err((2, "output must not overwrite input".into()));
        }
        if let Some(parent) = destination.parent().filter(|p| *p != Path::new("")) {
            std::fs::create_dir_all(parent).map_err(|e| (1, e.to_string()))?;
        }
        let bytes = if extension == "svg" {
            diagram.svg.as_bytes()
        } else {
            png.as_ref().unwrap().as_slice()
        };
        std::fs::write(&destination, bytes).map_err(|e| (1, e.to_string()))?;
        written.push(destination.display().to_string());
    }
    if !quiet {
        eprintln!(
            "tikzc: {} ({:.1}ms)",
            written.join(", "),
            start.elapsed().as_secs_f64() * 1000.
        );
    }
    Ok(())
}

/// Local JSON-lines protocol: one request/response at a time, no filesystem
/// writes. The regular CLI and the worker use the same compiler and PNG path.
fn preview_server() -> Result<(), String> {
    use std::io::{BufRead, Read, Write};
    let mut engine = tikzc::text::TextEngine::new();
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    loop {
        let mut line = String::new();
        // Bound each line before deserializing, including malicious clients.
        let n = (&mut input)
            .take(16 * 1024 * 1024)
            .read_line(&mut line)
            .map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        if !line.ends_with('\n') {
            return Err("preview request exceeds limit or is incomplete".into());
        }
        let result = (|| -> Result<serde_json::Value, String> {
            let request: serde_json::Value =
                serde_json::from_str(&line).map_err(|e| e.to_string())?;
            let source = request["source"].as_str().ok_or("missing source")?;
            let dpi = request["dpi"].as_f64().unwrap_or(150.);
            // Optional document path: `algo=<file>` is read relative to it.
            let base = request["path"]
                .as_str()
                .and_then(|p| Path::new(p).parent())
                .filter(|p| *p != Path::new(""));
            let diagram = tikzc::render::compile_at(source, &mut engine, base)
                .map_err(|e| format!("document.tikz:{}:{}: {}", e.line, e.column, e.message))?;
            let png = diagram.png(dpi)?;
            let lints: Vec<_> = diagram
                .lints
                .iter()
                .map(|l| {
                    let at = tikzc::Diagnostic::at(source, l.offset, "");
                    serde_json::json!({"code": l.code, "severity": l.severity.to_string(),
                        "line": at.line, "column": at.column, "message": l.message})
                })
                .collect();
            Ok(
                serde_json::json!({"svg": diagram.svg, "png": png, "editing": diagram.editing, "lints": lints}),
            )
        })();
        let response = match result {
            Ok(v) => v,
            Err(e) => serde_json::json!({"error": e}),
        };
        serde_json::to_writer(&mut output, &response).map_err(|e| e.to_string())?;
        output.write_all(b"\n").map_err(|e| e.to_string())?;
        output.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}
