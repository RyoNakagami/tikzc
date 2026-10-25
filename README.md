# tikzc

A Rust-native renderer for a practical subset of TikZ, with a VSCode preview
that shares its SVG/PNG output. Rendering requires no TeX Live or network access.

## Installation

`tikzc` is built from source with Cargo. It needs Rust 1.92 or later; on
Windows, also the MSVC Build Tools.

```sh
# 1. Install Rust, if `cargo --version` does not work yet (Linux / macOS).
#    On Windows, use rustup-init.exe from https://rustup.rs instead.
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2. Install tikzc into ~/.cargo/bin
cargo install --git https://github.com/RyoNakagami/tikzc tikzc --locked

# 3. Verify
tikzc --version
```

To install from a checkout instead:

```sh
git clone https://github.com/RyoNakagami/tikzc.git
cd tikzc
cargo install --path . --locked
```

The first build downloads the Rust dependencies and embeds about 15 MiB of
fonts, so it takes a while. If `tikzc` is not found afterwards, add
`~/.cargo/bin` (Windows: `%USERPROFILE%\.cargo\bin`) to PATH. To update, run
the same `cargo install` command again.

Then render a diagram:

```sh
tikzc diagram.tikz -o diagram.svg     # format follows the -o extension
tikzc diagram.tikz -f both -o out/    # SVG and PNG into out/
tikzc check diagram.tikz              # compile only, write nothing
tikzc ista.tikz -o ista.png           # pseudocode (algorithm environment)
```

Files may also contain `algorithm` environments (pseudocode.js syntax), drawn
alone, inside a figure with `\node[algo=...]` or beside it; see
[Pseudocode](docs/PSEUDOCODE.md).

The preview extension is installed separately; see
[VSCode extension](#vscode-extension).

## Agent plugin

The `tikzc` plugin gives Claude Code and Codex the `tikz-drawing` skill: it
turns a system description or an algorithm into a `.tikz` block diagram or
pseudocode, compiles it with the installed `tikzc` and checks the PNG.
Install `tikzc` first ([Installation](#installation)).

```sh
# Claude Code (inside a session)
/plugin marketplace add RyoNakagami/tikzc
/plugin install tikzc@tikzc

# Codex
codex plugin marketplace add https://github.com/RyoNakagami/tikzc.git
codex plugin add tikzc@tikzc
```

The skill is in [plugins/tikzc/skills/tikz-drawing/](plugins/tikzc/skills/tikz-drawing/SKILL.md);
in a checkout, Claude Code also loads it as a project skill.

## Rust CLI

To build and run without installing:

```sh
cargo build --release --locked
target/release/tikzc notebook/native-subset.tikz -f both -o target/example
target/release/tikzc check notebook/native-subset.tikz
```

Use `tikzc.exe` on Windows. Building requires Rust 1.92+;
compiled binaries embed the Japanese/math fonts. Unsupported syntax produces
source-position diagnostics. See [native usage and compatibility](docs/RUST_ENGINE.md).

## VSCode extension

The extension runs the `tikzc` executable installed on your machine; the VSIX
does not contain it. Install `tikzc` first ([Installation](#installation)),
then build and install the extension from a checkout (needs Node.js):

```sh
cd vscode-extension
npm ci
npm run package
code --install-extension "dist/packages/tikzc-preview-$(cat ../VERSION).vsix"
```

The same VSIX works on Linux, macOS and Windows. Open a `.tikz` file and press
**Ctrl+K V** (macOS: **Cmd+K V**). Preview and SVG/PNG export share Rust's
path-based text layout, including mixed full-width and half-width labels.
The preview also supports canvas editing: labels, moving, ordering, adding
shapes and arrow points. If another `tikzc` comes first on PATH, set
`tikzc.nativePath` to the Rust executable (for example `~/.cargo/bin/tikzc`).
See [extension settings and usage](vscode-extension/README.md).

## Repository layout

| Path | Responsibility |
| --- | --- |
| `src/` | Rust CLI and renderer; `render.rs` orchestrates the modules in `render/`. `Cargo.toml` is at the root. |
| `vscode-extension/src/` | Extension activation; `preview/` hosts the preview, export and canvas-edit source patches. |
| `vscode-extension/webview/` | Browser-side script of the preview panel. |
| `vscode-extension/scripts/` | VSIX packaging and the opt-in Chromium interaction test. |
| `assets/fonts/` | Embedded fonts and redistribution notices. |
| `tests/`, `vscode-extension/tests/` | Rust integration tests, fixtures, visual baselines and extension suites. |
| `examples/` | Rust benchmark. |
| `devtools/` | Versioning and opt-in corpus comparison tools. |
| `docs/` | Usage, compatibility, testing and project policies. |
| `notebook/` | Working diagrams, including the runnable `native-subset.tikz` example; some are read by Rust tests. |
| `plugins/tikzc/` | Claude Code / Codex plugin with the `tikz-drawing` skill; the marketplaces are `.claude-plugin/` and `.agents/plugins/`. |

A per-directory breakdown is in [repository structure](docs/REPOSITORY_STRUCTURE.md).

Generated files belong in `target/` (Rust and comparison outputs) or
`vscode-extension/dist/` (extension builds). VSIX archives go in
`vscode-extension/dist/packages/` and are excluded from the VSIX itself.

Rust rendering responsibilities are split into `coordinates.rs`, `geometry.rs`,
`nodes.rs`, `paths.rs`, `paint.rs`, `diagram.rs`, `label_svg.rs`, `glyph_path.rs`,
and `path_editing.rs` (canvas editing metadata) under `src/render/`.
The public API remains `tikzc::compile`, `tikzc::Diagram`, and `tikzc::render::*`.

## Development

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --release --locked

npm ci
npm run check
npm test

npm --prefix vscode-extension ci
npm --prefix vscode-extension run check
npm --prefix vscode-extension test
npm --prefix vscode-extension run package
```

Build the Rust release binary before running extension tests. The root npm
package holds development tooling only (tests for `devtools/`). No test needs TeX.
Detailed commands and acceptance criteria are in [TESTING.md](docs/TESTING.md).

- [Rust CLI and compatibility](docs/RUST_ENGINE.md)
- [Feature workflow](docs/FEATURE_WORKFLOW.md) (Japanese)
- [Editor naming and rename procedure](docs/NAIMING.md) (Japanese)
- [User manual (English)](docs/MANUAL.md) / [日本語](docs/MANUAL-jp.md)
- [Design principles](docs/ARCHITRECTURE.md)
- [Versioning](docs/VERSIONING_POLICY.md), [branch strategy](docs/BRANCH_STRATEGY.md), [commit rules](docs/COMMITRULES.md)
- [Publishing](docs/PUBLISH.md) / [日本語](docs/PUBLISH-jp.md)

## Uninstalling

The steps depend on how tikzc was installed.

```sh
# Rust CLI installed with cargo install
cargo uninstall tikzc

# VSCode extension
code --uninstall-extension RyoNak.tikzc-preview

# Agent plugin (Claude Code session / Codex)
/plugin uninstall tikzc@tikzc
codex plugin remove tikzc@tikzc

# npm CLI from tikzc 0.x, if it is still linked
npm unlink -g tikzc
```

A binary built with `cargo build` only lives in `target/`; remove it with
`cargo clean`. npm dependencies stay inside the repository
(`node_modules`, `vscode-extension/node_modules`).

## License

[MIT](LICENSE). Embedded font notices are in [assets/fonts/](assets/fonts/README.md).
