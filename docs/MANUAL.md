# tikzc User Manual

This manual covers the two components of this repository in detail:

1. **`tikzc` CLI** — compiles `.tikz` files to SVG / PNG through a local
   LuaLaTeX toolchain.
2. **VSCode extension (`tikzc-preview` / "TikZc Editor")** — a WYSIWYG TikZ
   editor embedded in a webview, plus accurate SVG / PNG export using the same
   pipeline as the CLI.

日本語版は [MANUAL-jp.md](MANUAL-jp.md) を参照してください。

---

## Table of contents

- [1. Overview and architecture](#1-overview-and-architecture)
- [2. Prerequisites (TeX toolchain)](#2-prerequisites-tex-toolchain)
- [3. The `.tikz` source format](#3-the-tikz-source-format)
- [4. CLI reference](#4-cli-reference)
- [5. VSCode extension](#5-vscode-extension)
- [6. Troubleshooting](#6-troubleshooting)
- [7. Uninstalling](#7-uninstalling)
- [8. Development](#8-development)
- [9. License](#9-license)

---

## 1. Overview and architecture

Both the CLI and the extension's export commands share a single compile
pipeline, implemented in [`src/core.ts`](../src/core.ts) (a port of the
`quarto_tikz.lua` Quarto filter):

```text
.tikz ──(assemble standalone .tex)──▶ .tex
      ──(lualatex)──────────────────▶ .pdf
      ──(dvisvgm --pdf --no-fonts)──▶ .svg
      └─(pdftoppm -png)─────────────▶ .png
```

Key properties of the pipeline:

- **LuaLaTeX + fontspec**: Japanese / CJK labels render with system fonts
  as-is — no font setup inside the TikZ source is required.
- **`dvisvgm --no-fonts`**: glyphs are embedded as SVG paths, so the resulting
  SVG displays identically everywhere without shipping font files.
- **Temporary directories**: each compile runs in a fresh
  `tikzc-*` directory under the OS temp dir and is removed afterwards
  (pass `--keep-tex` to the CLI to keep a copy of the generated `.tex`).

The VSCode extension additionally embeds the WYSIWYG editor from
[DominikPeters/tikz-editor](https://github.com/DominikPeters/tikz-editor)
(MIT), whose **built-in TikZ parser renders previews instantly without any
LaTeX installation**. LaTeX is only needed when you export.

---

## 2. Prerequisites (TeX toolchain)

> **Important:** neither the CLI nor the extension bundles a TeX environment.
> They invoke your locally installed toolchain as external commands. Without
> it, compilation and export fail (WYSIWYG editing in VSCode still works).

Required external commands (must be on your `PATH`):

| Command | Used for | Where it comes from |
|---|---|---|
| `lualatex` | `.tex` → `.pdf` | TeX Live / MacTeX / MiKTeX (with TikZ/PGF and fontspec) |
| `dvisvgm` | `.pdf` → `.svg` | bundled with TeX Live |
| `pdftoppm` | `.pdf` → `.png` (PNG output only) | poppler / poppler-utils |
| `node` (18+) | running the CLI / building | [nodejs.org](https://nodejs.org/) or your package manager |

### Linux (Ubuntu / Debian)

```sh
sudo apt install texlive-luatex texlive-pictures texlive-latex-extra poppler-utils
```

### macOS

```sh
# MacTeX (includes lualatex + dvisvgm + TikZ); -no-gui is enough without the GUI apps
brew install --cask mactex-no-gui

# pdftoppm (only if you use PNG output)
brew install poppler
```

Reopen your terminal after installing so `/Library/TeX/texbin` is on your
PATH. If it is not picked up, run `eval "$(/usr/libexec/path_helper)"`.

### Windows

- **TeX Live**: install via [tug.org/texlive](https://tug.org/texlive/)
  (includes `lualatex` / `dvisvgm`; scheme-full recommended).
  [MiKTeX](https://miktex.org/) also works (missing packages install on the fly).
- **poppler** (PNG output only): `scoop install poppler` or
  `choco install poppler`, or extract
  [poppler-windows](https://github.com/oschwartz10612/poppler-windows/releases)
  and add `Library\bin` to your PATH.

Everything runs natively in PowerShell / Command Prompt — WSL is not required.

### Verify the installation

```sh
lualatex --version && dvisvgm --version && pdftoppm -v && node --version
```

### Japanese / CJK fonts

The default main font is **`IPAexMincho`**, which ships with the full TeX Live
/ MacTeX distribution. If fontspec cannot find it, point to an OS font
instead, via a `#| mainfont:` header, the `--mainfont` CLI flag, or the
VSCode setting `tikzc.mainfont`:

- macOS: e.g. `Hiragino Mincho ProN`
- Windows: e.g. `Yu Mincho`, `MS Mincho`

---

## 3. The `.tikz` source format

A `.tikz` file contains TikZ code, optionally preceded by `#|` header lines.

### 3.1 Header options

Header lines use the same `#| key: value` notation as the `quarto_tikz` Lua
filter. They must appear at the **top of the file** — the header block ends at
the first line that is not a `#|` option.

```text
#| packages: [circuitikz, pgfplots]   -- extra \usepackage
#| libraries: [arrows.meta, calc]     -- extra \usetikzlibrary
#| scale: 1.5                         -- wrap the picture in \scalebox
#| mainfont: IPAexGothic              -- fontspec main font
\begin{tikzpicture}
  ...
\end{tikzpicture}
```

| Key | Value | Effect |
|---|---|---|
| `packages` | list (`[a, b]` or `a, b`) | extra `\usepackage{...}` lines |
| `libraries` | list | extra `\usetikzlibrary{...}` entries |
| `scale` | number | wraps the content in `\scalebox{n}{...}` |
| `mainfont` | font name | `\setmainfont{...}` (fontspec) |

List values accept both `[a, b, c]` and bare `a, b` forms; surrounding double
quotes on items are stripped.

### 3.2 Option precedence

For each option, the effective value is resolved as (highest first):

1. `#|` header in the source file
2. CLI flag (`--mainfont`, `--packages`, …) or VSCode setting
   (`tikzc.mainfont`, `tikzc.extraPackages`, …)
3. Built-in default

For the list options (`packages`, `libraries`) the levels are **merged**
(defaults + CLI/settings + header, duplicates removed) rather than replaced.

### 3.3 Built-in defaults

Always loaded, no configuration needed:

- Packages: `amsmath`, `amssymb`
- TikZ libraries: `arrows.meta`, `positioning`, `calc`, `shapes.geometric`,
  `backgrounds`, `fit`
- Main font: `IPAexMincho`

### 3.4 Bare TikZ code

If the body does not contain `\begin{tikzpicture}`, it is wrapped in a
`tikzpicture` environment automatically. This is valid as a complete file:

```text
\draw[->] (0,0) -- (2,1) node[right] {ラベル};
```

### 3.5 Generated document

The assembled standalone document has this shape:

```latex
\documentclass[border=2pt]{standalone}
\usepackage{fontspec}
\setmainfont{<mainfont>}
\usepackage{tikz}
\usepackage{<each extra package>}
\usetikzlibrary{<all libraries, comma-joined>}
\begin{document}
<body, wrapped in tikzpicture and/or \scalebox as needed>
\end{document}
```

TikZ is loaded as a package (not as the `standalone` class's `tikz` option)
so that `\scalebox` works.

---

## 4. CLI reference

### 4.1 Installation

```sh
npm install
npm run build          # produces dist/tikzc.cjs
npm link               # optional: install the `tikzc` command globally
```

Without `npm link` you can run it as `node dist/tikzc.cjs`.

### 4.2 Synopsis

```text
tikzc [options] <file.tikz>
```

Examples:

```sh
tikzc test.tikz                    # -> test.svg (next to the input)
tikzc test.tikz -f png --dpi 600   # -> test.png at 600 dpi
tikzc test.tikz -f both -o out/    # -> out/test.svg and out/test.png
tikzc test.tikz --watch            # recompile on every save
tikzc --help
```

### 4.3 Options

| Option | Default | Description |
|---|---|---|
| `-f, --format <svg\|png\|both>` | `svg` | output format(s) |
| `-o, --output <path>` | next to input | output file **or** directory |
| `--dpi <n>` | `300` | PNG resolution (positive number) |
| `--mainfont <font>` | `IPAexMincho` | fontspec main font |
| `--packages <a,b>` | — | extra `\usepackage` (comma-separated) |
| `--libraries <a,b>` | — | extra `\usetikzlibrary` (comma-separated) |
| `--scale <n>` | — | wrap in `\scalebox{n}` |
| `--keep-tex` | off | also write the generated `.tex` next to the outputs |
| `-w, --watch` | off | watch the input file and recompile on change |
| `-q, --quiet` | off | suppress the progress line on stderr |
| `-h, --help` | — | show help and exit |

Remember that `#|` headers in the source **override** these flags
(see [3.2](#32-option-precedence)).

### 4.4 Output path resolution

The output base name is always the input file name with its extension
replaced (`figure.tikz` → `figure.svg` / `figure.png` / `figure.tex`).

- **No `-o`**: outputs are written next to the input file.
- **`-o` is an existing directory** (or ends with a path separator): outputs
  go into that directory (created if needed).
- **`-o` is a file path** and a single format was requested: that exact path
  is used.
- **`-f both`**: `-o` is always treated as a directory (two files cannot share
  one path).

### 4.5 Watch mode

`--watch` compiles once, then watches the input file and recompiles on each
change. Change events are debounced by 200 ms (editors typically fire several
events per save), and if a change arrives while a compile is running, one more
compile runs afterwards. Compile errors are printed but do not terminate the
watcher. Stop with `Ctrl+C`.

### 4.6 Exit codes and errors

| Code | Meaning |
|---|---|
| `0` | success (in watch mode: the process keeps running) |
| `1` | compilation failed |
| `2` | usage error (bad flags, unreadable input, no input file) |

On a LaTeX failure, the first `! ...` error block from the LaTeX log is
printed to stderr, e.g.:

```text
tikzc: lualatex compilation failed:
! Undefined control sequence.
l.12 \drow
```

Progress output (`tikzc: test.svg (1234ms)`) goes to **stderr**, so stdout
stays clean for scripting.

---

## 5. VSCode extension

### 5.1 What it is

The extension (`RyoNak.tikzc-preview`, display name **TikZc Editor**) embeds
the WYSIWYG editor from
[DominikPeters/tikz-editor](https://github.com/DominikPeters/tikz-editor)
into a VSCode webview panel:

- The **canvas renders instantly** using tikz-editor's own TikZ parser — no
  LaTeX needed for editing.
- **Shape operations on the canvas** (moving nodes, drawing, etc.) are
  written back into VSCode's text buffer automatically.
- **Text edits in VSCode** appear on the canvas immediately.
- **Export commands** produce accurate output through the real
  lualatex + dvisvgm / pdftoppm pipeline (CJK labels render correctly).

### 5.2 Build and install

```sh
cd vscode-extension
npm install
npm run package        # builds webview (Vite) + extension host, produces the .vsix
code --install-extension tikzc-preview-0.1.0.vsix
```

> If the `code` command is missing on macOS, run "Shell Command: Install
> 'code' command in PATH" from the VSCode command palette.

The extension activates when a file with language id `tikz` (extension
`.tikz`) is opened.

### 5.3 Commands and keybindings

| Command palette entry | ID | Availability |
|---|---|---|
| **TikZ: Open Editor to the Side** | `tikzc.showPreview` | active editor is a `.tikz` file; also as an icon in the editor title bar |
| **TikZ: Export as SVG** | `tikzc.exportSvg` | active editor is a `.tikz` file |
| **TikZ: Export as PNG** | `tikzc.exportPng` | active editor is a `.tikz` file |

Default keybinding: `Ctrl+K V` (`Cmd+K V` on macOS) opens the editor panel
beside the current editor.

### 5.4 Everyday usage

1. Open a `.tikz` file in VSCode.
2. Open the **Local TikZ Editor** panel via the title-bar icon or `Ctrl+K V`.
3. Edit either side:
   - Type TikZ code in VSCode's text editor → the canvas updates instantly.
   - Manipulate shapes on the canvas → the change is written back to the
     VSCode buffer (debounced by ~600 ms).
4. **Save with `Ctrl+S` as usual.** Canvas write-back only edits the buffer;
   persisting to disk stays your decision. The panel title shows `●` while
   there are unwritten canvas changes.
5. When you need publication-quality output, run **TikZ: Export as SVG / PNG**
   from the command palette and pick a save location. Export runs the full
   lualatex pipeline with a progress notification.

**Single-document mode**: the panel always mirrors exactly the `.tikz` file
currently open in VSCode. There is no tab strip; running the open command
while another `.tikz` file is active switches the panel to that file, and
documents restored from a previous session are closed. Files changed on disk
outside VSCode are also picked up via a file watcher.

### 5.5 Settings

Settings live under **TikZ Preview (tikzc)** (`tikzc.*`) and are applied to
the **export** pipeline:

| Setting | Type / default | Description |
|---|---|---|
| `tikzc.mainfont` | string, `""` | fontspec main font for CJK labels (empty = `IPAexMincho`) |
| `tikzc.extraPackages` | string[], `[]` | extra `\usepackage` applied to every diagram |
| `tikzc.extraLibraries` | string[], `[]` | extra `\usetikzlibrary` applied to every diagram |
| `tikzc.pngDpi` | number, `300` | resolution for PNG export |
| `tikzc.debounceMs` | number, `400` | *declared but unused in the current version* (left over from the earlier preview-based extension) |

`#|` headers in the source override these settings, same as with the CLI.

### 5.6 Rendering engine and its limits

The instant canvas preview uses tikz-editor's TikZ parser, which supports a
**subset of TikZ**: decorations / graphs / plots are partially supported, and
external packages (e.g. `circuitikz`) are not rendered. The canvas is a
fast, interactive approximation — **exports are always accurate**, because
they compile with real lualatex. When the canvas and lualatex disagree, trust
the export.

Math in labels is rendered with MathJax inside the webview.

### 5.7 Logs and diagnostics

- Output channel **"TikZ Editor (tikzc)"** (View → Output) shows extension
  and webview log lines, including RPC failures.
- The same log is appended to `tikzc-webview.log` in the OS temp directory.
- The last lualatex log is kept in memory and served to the editor's
  "view log" feature after an export/compile from the webview.
- Export failures surface the extracted LaTeX error in a VSCode error
  notification.

### 5.8 Architecture (for the curious)

```text
vscode-extension/
├── tikzc-editor/      vendored tikz-editor (the WYSIWYG editor; MIT, unmodified)
├── webview/           bootstrap that runs the tikz-editor App in the webview +
│                      an EditorPlatform adapter (file sync, dialogs, clipboard,
│                      lualatex bridge)
├── src/extension.ts   extension host: RPC with the webview, two-way sync with
│                      the .tikz TextDocument, lualatex export (shares ../src/core.ts)
└── vite.config.ts     builds the webview bundle (resolves tikz-editor sources via
                       aliases + build-time stubs for features unused in VSCode)
```

- The webview and the extension host talk over a small RPC protocol
  (`rpc` / `notify` / `rpc-result` messages). The host implements linked-file
  read/write (mapped onto the `.tikz` TextDocument), file dialogs, clipboard,
  message boxes, persistence (VSCode `globalState`), and the
  `latex.check` / `latex.compile` bridge to `src/core.ts`.
- Canvas write-back goes through `linked.write`: if the document is open in
  VSCode it becomes a WorkspaceEdit on the buffer (never a silent disk
  write); otherwise the file is written directly.
- The vendored tikz-editor sources are **unmodified**; `vite.config.ts` swaps
  in build-time stubs for parts the VSCode single-document, canvas-only mode
  doesn't use (the CodeMirror source panel, tab strip, AI assistant panel,
  thumbnail Web Worker, PowerPoint / IPE import, hover docs). See
  `tikzc-editor/UPSTREAM.md` for the upstream commit; update the vendored
  copy with `./scripts/update-tikz-editor.sh`.

---

## 6. Troubleshooting

**`lualatex compilation failed: ! LaTeX Error: File 'xxx.sty' not found`**
The package is missing from your TeX installation. Install it via
`tlmgr install <package>` (TeX Live) — MiKTeX installs missing packages
automatically.

**`fontspec` cannot find `IPAexMincho`**
Your TeX distribution is a minimal scheme without the IPAex fonts. Either
install them, or set an OS font with `#| mainfont:` / `--mainfont` /
`tikzc.mainfont` (see [section 2](#japanese--cjk-fonts)).

**`cannot read <file>` (exit code 2)**
The input path does not exist or is not readable.

**Export works in a terminal but fails from VSCode**
VSCode may not inherit your shell PATH (typical on macOS when launched from
the Dock). Launch VSCode from a terminal with `code`, or make the TeX bin
directory available to GUI apps.

**The canvas renders my diagram wrong / not at all**
The instant preview supports only a TikZ subset ([5.6](#56-rendering-engine-and-its-limits)).
Run **TikZ: Export as SVG** to check with real lualatex; if the export is
fine, the source is fine.

**Where did my temp files go?**
Compiles run in disposable temp dirs. Use `--keep-tex` (CLI) to keep the
generated `.tex`, and check the output channel / `tikzc-webview.log`
([5.7](#57-logs-and-diagnostics)) for extension issues.

---

## 7. Uninstalling

```sh
# VSCode extension (extension ID = publisher.name)
code --uninstall-extension RyoNak.tikzc-preview

# CLI (only if you ran npm link)
npm unlink -g tikzc

# dependencies are contained in the repository
rm -rf node_modules vscode-extension/node_modules
# Windows (PowerShell): Remove-Item -Recurse -Force node_modules, vscode-extension/node_modules
```

---

## 8. Development

```sh
npm run check          # type-check (root and vscode-extension separately)
npm run build          # build the CLI (dist/tikzc.cjs)
npm test               # run tests (tsx --test tests/*.test.ts)

cd vscode-extension
npm run check          # type-check extension host + webview
npm run build          # build extension host (esbuild) + webview (Vite)
npm run package        # build + produce the .vsix
```

See also [TESTING.md](TESTING.md) and [BRANCH_STRATEGY.md](BRANCH_STRATEGY.md).

---

## 9. License

[MIT](../LICENSE). The vendored
[tikz-editor](https://github.com/DominikPeters/tikz-editor)
(`vscode-extension/tikzc-editor/`, by Dominik Peters and others) is also
MIT-licensed.
