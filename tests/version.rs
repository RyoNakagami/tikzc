use std::process::Command;

#[test]
fn cli_version_matches_canonical_version() {
    let canonical = include_str!("../VERSION").trim();
    assert_eq!(env!("CARGO_PKG_VERSION"), canonical);
    for flag in ["--version", "-V"] {
        let output = Command::new(env!("CARGO_BIN_EXE_tikzc"))
            .arg(flag)
            .output()
            .expect("run native CLI");
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap(),
            format!("tikzc {canonical}\n")
        );
        assert!(output.stderr.is_empty());
    }
}
