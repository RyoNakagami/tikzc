# tikzc User Manual

tikzc renders `.tikz` files to SVG / PNG with a Rust-native engine. It needs no
TeX installation and no network access at runtime. This manual covers:

1. **`tikzc` CLI** — compiles a `.tikz` file to SVG / PNG.
2. **VSCode extension (`tikzc-preview` / "TikZc Editor")** — live preview with
   canvas editing, and SVG / PNG export that matches the CLI.

日本語版は [MANUAL-jp.md](MANUAL-jp.md) を参照してください。

## Table of contents

- [1. Overview](#1-overview)
- [2. Installation](#2-installation)
- [3. The `.tikz` source format](#3-the-tikz-source-format)
- [4. CLI reference](#4-cli-reference)
- [5. VSCode extension](#5-vscode-extension)
- [6. Troubleshooting](#6-troubleshooting)
- [7. Uninstalling](#7-uninstalling)
- [8. Development](#8-development)
- [9. License](#9-license)

## 1. Overview

```text
.tikz ──(parse, expand macros and loops)──▶ diagram
      ──(layout; text through Typst)──────▶ .svg   (glyphs as paths)
      └─(rasterize the same SVG)──────────▶ .png
```

- **A documented subset of TikZ.** tikzc does not run TeX. The supported
  syntax is listed in the [compatibility contract](RUST_ENGINE.md#native-compatibility-contract).
  Unsupported syntax fails with a `file:line:column` diagnostic; there is no
  fallback to another renderer.
- **Self-contained output.** Japanese, math and icon fonts are embedded in the
  executable, and glyphs are written as SVG paths, so the output looks the same
  on any machine.
- **Not pixel-identical to LaTeX.** Font metrics, line breaking and arrow
  shapes can differ from a lualatex rendering of the same source.

## 2. Installation

Install Rust 1.92 or later (on Windows, also the MSVC Build Tools), then:

```sh
cargo install --git https://github.com/RyoNakagami/tikzc tikzc --locked
# from a checkout: cargo install --path . --locked
tikzc --version        # tikzc <version>
```

The first build downloads Rust dependencies and embeds about 15 MiB of fonts.
See [section 5.1](#51-build-and-install) for the VSCode extension.

## 3. The `.tikz` source format

A `.tikz` file is TikZ code, optionally preceded by `#|` header lines.

### 3.1 Header options

```latex
#| mainfont: IPAexGothic
#| libraries: [arrows.meta, calc]
#| scale: 1.5
\begin{tikzpicture}
  \node[draw] (a) {入力};
  \node[draw, right=2cm of a] (b) {$y = f(x)$};
  \draw[->] (a) -- (b);
\end{tikzpicture}
```

| Header | Meaning |
| --- | --- |
| `mainfont` | Label font. Default: `IPAexMincho`. Bundled families need no installation; other families are read from installed system fonts and fail if missing |
| `scale` | Scales the whole picture. Must be in (0, 100] |
| `libraries` | TikZ libraries the diagram uses. Accepted: `arrows.meta`, `positioning`, `calc`, `shapes.geometric`, `backgrounds`, `fit`, `decorations.pathreplacing`, `patterns`, `matrix` |
| `packages` | Packages the diagram uses. Accepted: `amsmath`, `amssymb`, `fontawesome` |
| `filename`, `width`, `height` | Accepted for compatibility and ignored; they do not change the output size or destination |

Header lines must come first; parsing stops at the first line that is not a
header. An unknown header key, library or package is an error.

### 3.2 Option precedence

`#|` headers in the source override the VSCode settings (`tikzc.mainfont`,
`tikzc.extraPackages`, `tikzc.extraLibraries`). The CLI has no font or library
flags; use headers.

### 3.3 Bare TikZ code

A file may contain a complete `\begin{tikzpicture}…\end{tikzpicture}` or just
the drawing commands; a bare fragment is treated as one picture.

### 3.4 Pseudocode

`algorithm` environments in the pseudocode.js syntax render as pseudocode:
alone (a file without `tikzpicture`, such as an `ista.tikz` holding only `\begin{algorithm}`), inside a figure
(`\node[algo=<name or file>] {};`) or beside it (`#| layout: algo-left`).
`% @src`, `% @ref` and `% @explain` comments record sources, link lines to
`ref=` nodes and explain them; `tikzc check` lints them. See
[Pseudocode](PSEUDOCODE.md).

## 4. CLI reference

### 4.1 Synopsis

```sh
tikzc <file.tikz> [-o output.svg|output.png|directory] [-f svg|png|both]
tikzc check <file.tikz>
```

### 4.2 Options

| Option | Description |
| --- | --- |
| `-o`, `--output <path>` | Output file or directory |
| `-f`, `--format <format>` | `svg`, `png` or `both`. Default: inferred from the `-o` extension, otherwise `svg` |
| `--dpi <number>` | PNG resolution. Default: 150 |
| `-q`, `--quiet` | Suppress the progress line |
| `-V`, `--version` | Print the version |
| `-h`, `--help` | Print help |

`tikzc check` compiles the file and reports whether it is supported, without
writing output.

### 4.3 Output path resolution

- Without `-o`, the output is written next to the input with the format's
  extension (`diagram.tikz` → `diagram.svg`).
- If `-o` is an existing directory, ends with a path separator, or the format
  is `both`, it is treated as a directory and the input's file name is used.
- Otherwise `-o` is the output file. Missing parent directories are created.
- The output may not overwrite the input.

SVG keeps a transparent background; PNG has a white background. All
conversions finish before any file is written, so a failed run does not
replace existing output.

### 4.4 Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Rasterization or file write failed |
| 2 | Usage or input error: unknown option, invalid DPI or format, unreadable input, output equal to input |
| 3 | The source is invalid or uses unsupported syntax (`file:line:column: message`) |

## 5. VSCode extension

The extension (`RyoNak.tikzc-preview`, display name **TikZc Editor**) runs the
`tikzc` executable installed on your machine and shows its SVG or PNG. Export
writes the same artifact as the preview. The details of canvas editing are in
the [extension README](../vscode-extension/README.md).

### 5.1 Build and install

Install `tikzc` first ([section 2](#2-installation)); the VSIX does not contain it.

```sh
cd vscode-extension
npm ci
npm run package        # builds the extension and produces the .vsix
code --install-extension "dist/packages/tikzc-preview-$(cat ../VERSION).vsix"
```

> If the `code` command is missing on macOS, run "Shell Command: Install
> 'code' command in PATH" from the VSCode command palette.

The extension activates when a `.tikz` file is opened. It looks up `tikzc` on
PATH, or uses `tikzc.nativePath`. A warning appears when the executable's
major.minor version differs from the extension's.

### 5.2 Commands and keybindings

| Command palette entry | ID | Availability |
| --- | --- | --- |
| **TikZc Editor: Open to the Side** | `tikzc.showPreview` | active editor is a `.tikz` file; also as an icon in the editor title bar |
| **TikZc Editor: Export (SVG / PNG)** | `tikzc.export` | active editor is a `.tikz` file |

Default keybinding: `Ctrl+K V` (`Cmd+K V` on macOS) opens the preview beside
the current editor.

### 5.3 Everyday usage

1. Open a `.tikz` file in VSCode.
2. Open the preview via the title-bar icon or `Ctrl+K V`.
3. Edit either side:
   - Type TikZ code in the text editor → the unsaved buffer is recompiled
     after `tikzc.debounceMs`.
   - Edit on the canvas (labels, moving, ordering, adding shapes, arrow
     points) → the change is validated by compiling it, then applied to the
     buffer as one undoable edit.
4. **Save with `Ctrl+S` as usual.** Canvas edits only change the buffer.
5. Run **TikZc Editor: Export (SVG / PNG)** (or the preview's **Export…** button), choose SVG or PNG, and pick a save location (defaults to the workspace root).

The preview follows the active `.tikz` editor. Errors are shown with their
source position.

### 5.4 Settings

Settings live under **TikZc Editor (tikzc)** (`tikzc.*`) and apply to preview
and export alike:

| Setting | Type / default | Description |
| --- | --- | --- |
| `tikzc.nativePath` | string, `""` | path to the `tikzc` executable (empty = `tikzc` on PATH); machine-scoped |
| `tikzc.mainfont` | string, `""` | default label font (empty = `IPAexMincho`) |
| `tikzc.extraPackages` | string[], `[]` | additional packages; must be ones tikzc accepts |
| `tikzc.extraLibraries` | string[], `[]` | additional TikZ libraries; must be ones tikzc accepts |
| `tikzc.pngDpi` | number, `300` | resolution for PNG preview and export |
| `tikzc.debounceMs` | number, `400` | delay after the last keystroke before the preview recompiles |
| `tikzc.language` | `en` \| `ja`, `en` | language of the preview toolbar and messages; also switchable from the preview toolbar |

## 6. Troubleshooting

**`tikzc … is older than 1.0.0`**
The extension accepts every `tikzc` from 1.0.0 on. The one found on PATH is a
0.x build: an early Rust build or the TeX-based npm CLI. Remove the npm CLI if
present (`npm unlink -g tikzc`) and install the current Rust version
([section 2](#2-installation)), or set `tikzc.nativePath` to a 1.0.0 or newer
executable (for example `~/.cargo/bin/tikzc`).

**`Cannot run Rust tikzc`, or it works in a terminal but not from VSCode**
VSCode may not inherit your shell PATH (typical on macOS when launched from
the Dock). Set `tikzc.nativePath`, or launch VSCode from a terminal with `code`.

**`Unsupported …` or another `file:line:column` diagnostic**
The source uses syntax outside the supported subset. Check the
[compatibility contract](RUST_ENGINE.md#native-compatibility-contract) and
rewrite that part, or request the feature following the
[feature workflow](FEATURE_WORKFLOW.md).

**A font is reported missing**
A `mainfont` that is not bundled must be installed on the system. Use a
bundled family (IPAexMincho or IPAexGothic) for portable diagrams.
Noto Sans CJK Regular/Bold are not bundled; a diagram specifying
`mainfont: Noto Sans CJK JP` requires a system installation of that family.

**The warning about a version mismatch keeps appearing**
The installed `tikzc` and the extension differ in major.minor version.
Reinstall `tikzc` with the `cargo install` command above and rebuild the VSIX
from the same checkout.

## 7. Uninstalling

```sh
# VSCode extension (extension ID = publisher.name)
code --uninstall-extension RyoNak.tikzc-preview

# CLI installed with cargo install
cargo uninstall tikzc

# npm CLI from tikzc 0.x, if it is still linked
npm unlink -g tikzc
```

## 8. Development

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked            # renderer and CLI
cargo build --release --locked # needed by the extension tests

npm ci && npm run check && npm test   # development tool tests

cd vscode-extension
npm ci
npm run check          # type-check extension host, webview script and tests
npm test               # preview, export and canvas-editing tests
npm run package        # build + produce the .vsix
```

See also [TESTING.md](TESTING.md), [REPOSITORY_STRUCTURE.md](REPOSITORY_STRUCTURE.md)
and [BRANCH_STRATEGY.md](BRANCH_STRATEGY.md).

## 9. License

[MIT](../LICENSE). Notices for the embedded fonts are in
[`assets/fonts/`](../assets/fonts/README.md).
