# Repository structure

For tikzc developers: what each directory is for, and where to edit for a given
kind of change. tikzc consists of two parts.

- **Rust CLI / renderer** (`src/`, with `Cargo.toml` at the root): turns `.tikz` into SVG / PNG without TeX.
- **VSCode extension** (`vscode-extension/`): preview with canvas editing, and export, both
  running the installed `tikzc`.

The root npm package holds development tooling only; it ships nothing.

## Overview

```text
tikzc/
├── src/                 Rust CLI and renderer
├── tests/               Rust integration tests, fixtures, image baselines, development tool tests
├── examples/            Rust benchmark
├── assets/fonts/        fonts embedded in the Rust binary
├── vscode-extension/    VSCode extension
├── devtools/            version bump and comparison tools
├── docs/                documentation
├── notebook/            working diagrams and a runnable example
├── .github/             CI, release and label configuration
└── .claude/             Claude Code skill
```

## Top-level directories

| Directory | Description |
| --- | --- |
| `src/` | Rust CLI and renderer. The repository root is the single Cargo package (`Cargo.toml`) |
| `tests/` | Rust integration tests (`*.rs`), the fixtures and image baselines they read, and the development tool tests (`devtools/`) |
| `examples/` | `benchmark.rs`: benchmark over eight fixed fixtures |
| `assets/fonts/` | Fonts embedded in the Rust binary (IPAex, New Computer Modern Math, Latin Modern Mono, FontAwesome) and their license documents. About 15 MiB |
| `vscode-extension/` | VSCode extension (`RyoNak.tikzc-preview`, display name TikZc Editor). Has its own `package.json` |
| `devtools/` | Development tools. Not part of any product build |
| `docs/` | Usage, compatibility, testing and project policy documents |
| `notebook/` | Working diagrams. Includes the runnable example `native-subset.tikz`; some files are read by Rust tests |
| `.github/` | GitHub Actions workflows, label definitions and repository metadata |
| `.claude/` | Claude Code skill (`skills/tikz-block-diagram/`). Everything else in it is untracked |

## `src/`: Rust implementation

| Path | Description |
| --- | --- |
| `main.rs` | CLI argument handling, diagnostic output, file writes, and `--preview-server` for the extension |
| `lib.rs` | Library entry point. Exposes `tikzc::compile`, `tikzc::Diagram` and `tikzc::render::*` |
| `syntax.rs`, `expand.rs`, `expr.rs` | Parsing, `\foreach` and macro expansion, math evaluation |
| `options.rs` | Validation of styles, keys and values |
| `render.rs` | Orchestrates rendering. The work is split across `render/` |
| `render/` | `coordinates.rs` (coordinates), `geometry.rs` (shapes and borders), `nodes.rs` (nodes), `paths.rs` (paths), `paint.rs` (color, stroke, fill), `diagram.rs` (SVG and PNG output), `label_svg.rs` and `glyph_path.rs` (label SVG and glyph sharing), `path_editing.rs` (metadata for canvas editing) |
| `transform.rs`, `curve.rs`, `arrows.rs` | Geometry of transforms, curves and arrows |
| `text.rs` | Fonts, glyphs, baselines, and typesetting through Typst |

## `vscode-extension/`: extension

| Path | Description |
| --- | --- |
| `src/extension.ts` | Activation. Registers the preview and export commands |
| `src/preview/` | Host side of the preview and export: starting the `tikzc` process (`renderer.ts`, `worker.ts`), preview update control (`preview.ts`, `preview-queue.ts`), panel HTML (`preview-html.ts`), source rewriting for canvas edits (`editing.ts`), UI language (`i18n.ts`) |
| `webview/` | Browser-side script of the preview panel: `native-preview.ts` (rendering and interaction) and `native-selection.ts` (selection) |
| `tests/` | Extension tests and fixtures |
| `language-configuration.json` | Comment and bracket rules for the `tikz` language |
| `scripts/` | `package.mjs` (writes the VSIX to `dist/packages/`) and `test-native-browser.mjs` (opt-in Chromium interaction test) |
| `images/` | Extension icon |

## `tests/`: Rust tests, fixtures and tooling test

| Path | Description |
| --- | --- |
| `*.rs` | Rust integration tests, run by `cargo test`. See [TESTING.md](TESTING.md) |
| `devtools/*.test.ts` | Tests for the scripts in `devtools/` (version bump, corpus comparison), run by the root `npm test` |
| `fixtures/*.tikz` | Per-feature inputs, read by Rust tests and the benchmark. The `unsupported-*` names are historical; some of those features are now supported |
| `visual-native/` | Reviewed native output PNGs and their inputs. Regression baselines for `tests/visual.rs` |

## `devtools/`: development tools

Usage and options of each script are described in [HOW-TO-USE-devtools.md](HOW-TO-USE-devtools.md).

| Path | Description |
| --- | --- |
| `bump-version.sh`, `bump-version.mjs` | Synchronize and check the version across `VERSION`, manifests and lockfiles |
| `compare-desktop.mjs` | Compares two `tikzc` builds (reference and under test) over a local set of diagrams. Results go to `target/` |

## `.github/`: CI and release

| Path | Description |
| --- | --- |
| `workflows/native-rust.yml` | Rust checks and tests, the extension's `check` and tests, and VSIX packaging. Started manually |
| `workflows/guard-main-branch.yml` | Restricts PRs into `main` to `develop` and `hotfix/*` |
| `workflows/release-to-main.yml` | Creates the tag and GitHub Release when a PR labeled `release` is merged |
| `workflows/manually-create-release-tag.yml` | Creates the tag and GitHub Release on demand |
| `workflows/label-generator.yml`, `workflows/config/label_master.yml` | Label definitions and their synchronization |
| `repository_metadata/gh_repo.yml` | Repository description and topics |

## Top-level files

| File | Description |
| --- | --- |
| `VERSION` | Canonical project version. Other files are synchronized with `devtools/bump-version.sh` |
| `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` | Cargo package manifest, lockfile and Rust toolchain configuration |
| `package.json`, `package-lock.json`, `tsconfig.json` | Private npm package for development tooling: runs the root tests |
| `CHANGELOG.md` | Change history. The release workflows extract release notes from it |
| `README.md`, `LICENSE` | Overview and license |

## Generated and untracked directories

These are covered by `.gitignore` and are not committed.

| Directory | Description |
| --- | --- |
| `target/` | Rust build output, and output of the comparison tool and tests |
| `vscode-extension/dist/` | Extension build. VSIX archives are written to `dist/packages/` |
| `node_modules/`, `vscode-extension/node_modules/` | npm dependencies |
| `dist/` | Leftover build of the removed npm CLI, if present; safe to delete |
| `sandbox/`, `tmp/` | Personal scratch space |

## Where to edit

| Goal | Edit | Read |
| --- | --- | --- |
| Change how the tool is used or documented for users | `docs/MANUAL.md`, `docs/MANUAL-jp.md` | [RUST_ENGINE.md](RUST_ENGINE.md) |
| Add TikZ syntax support or fix rendering | `src/`, `tests/*.rs` | [FEATURE_WORKFLOW.md](FEATURE_WORKFLOW.md) (Japanese), [RUST_ENGINE.md](RUST_ENGINE.md) |
| Change the preview panel or canvas editing | `vscode-extension/src/preview/`, `vscode-extension/webview/` | [Extension README](../vscode-extension/README.md) |
| Change the extension's display name or wording | `vscode-extension/package.json` and others | [NAIMING.md](NAIMING.md) (Japanese) |
| Bump the version or release | `VERSION` (through `devtools/bump-version.sh`), `CHANGELOG.md` | [VERSIONING_POLICY.md](VERSIONING_POLICY.md), [PUBLISH.md](PUBLISH.md) |
| Add or run tests | each `tests/` directory | [TESTING.md](TESTING.md) |
