//! Checks applied to every data-science fixture through the built CLI:
//! `check`, deterministic output, located diagnostics with exit code 3,
//! protected outputs and independence from PATH.
mod common;
use common::*;

/// `ds-*.tikz` fixtures that render, and the `ds-unsupported-*` ones that
/// must fail at `line:column`.
fn fixtures_by_kind() -> (Vec<String>, Vec<String>) {
    let mut names: Vec<String> = std::fs::read_dir(fixtures())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .filter(|name| name.starts_with("ds-") && name.ends_with(".tikz"))
        .collect();
    names.sort();
    names
        .into_iter()
        .partition(|name| !name.starts_with("ds-unsupported-"))
}

const UNSUPPORTED: &[(&str, usize, usize)] = &[
    ("ds-unsupported-ifthenelse.tikz", 3, 5),
    ("ds-unsupported-markings.tikz", 3, 9),
    ("ds-unsupported-nested-markings.tikz", 3, 9),
    ("ds-unsupported-plot-file.tikz", 2, 29),
    ("ds-unsupported-plot-function.tikz", 3, 15),
    ("ds-unsupported-printnumber.tikz", 2, 19),
    ("ds-unsupported-samples.tikz", 3, 9),
    ("ds-unsupported-shading.tikz", 3, 24),
];

#[test]
fn every_supported_fixture_checks_and_renders_identically_twice() {
    let (supported, _) = fixtures_by_kind();
    assert_eq!(supported.len(), 17, "{supported:?}");
    let dir = scratch("determinism");
    for name in &supported {
        let result = check(&fixture_path(name));
        assert!(
            result.status.success(),
            "{name}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        let outputs = [dir.join("a.svg"), dir.join("b.svg")];
        for output in &outputs {
            let status = tikzc()
                .arg(fixture_path(name))
                .arg("-q")
                .arg("-o")
                .arg(output)
                .status()
                .unwrap();
            assert!(status.success(), "{name}");
        }
        let svg = std::fs::read(&outputs[0]).unwrap();
        assert_eq!(svg, std::fs::read(&outputs[1]).unwrap(), "{name}");
        // The CLI and the library agree, and fonts stay outlined.
        let diagram = compile_fixture(name);
        assert_eq!(String::from_utf8(svg).unwrap(), diagram.svg, "{name}");
        assert!(!diagram.svg.contains("<text"), "{name}");
        check_references(&diagram.svg);
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn unsupported_fixtures_exit_3_at_the_offending_token_and_keep_outputs() {
    let (_, unsupported) = fixtures_by_kind();
    let listed: Vec<&str> = UNSUPPORTED.iter().map(|(name, _, _)| *name).collect();
    assert_eq!(unsupported, listed);
    let dir = scratch("unsupported");
    let output = dir.join("kept.svg");
    for (name, line, column) in UNSUPPORTED {
        let result = check(&fixture_path(name));
        let stderr = String::from_utf8_lossy(&result.stderr);
        assert_eq!(result.status.code(), Some(3), "{name}: {stderr}");
        assert!(
            stderr.contains(&format!("{name}:{line}:{column}: ")),
            "{name}: {stderr}"
        );
        // An existing output survives the failed render, for both formats.
        for format in ["svg", "png"] {
            std::fs::write(&output, b"previous output").unwrap();
            let result = tikzc()
                .arg(fixture_path(name))
                .args(["-q", "-f", format, "-o"])
                .arg(&output)
                .output()
                .unwrap();
            assert_eq!(result.status.code(), Some(3), "{name}");
            assert_eq!(
                std::fs::read(&output).unwrap(),
                b"previous output",
                "{name}"
            );
        }
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn function_plot_renders_with_an_empty_path() {
    let dir = scratch("empty-path");
    for format in ["svg", "png"] {
        let output = dir.join(format!("gaussian.{format}"));
        let result = tikzc()
            .env("PATH", "")
            .arg(fixture_path("ds-gaussian.tikz"))
            .arg("-q")
            .arg("-o")
            .arg(&output)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(std::fs::metadata(&output).unwrap().len() > 1000);
    }
    std::fs::remove_dir_all(dir).unwrap();
}
