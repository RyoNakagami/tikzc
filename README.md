# tikzc

A CLI that compiles `.tikz` files to SVG / PNG, plus a VSCode extension for
WYSIWYG editing based on [tikz-editor](https://github.com/DominikPeters/tikz-editor).
It shares the same pipeline as the [quarto_tikz](https://github.com/ryonakagami) Lua filter:

```text
.tikz → standalone .tex → lualatex → .pdf → dvisvgm → .svg
                                          └→ pdftoppm → .png
```

Because it goes through lualatex + fontspec, Japanese (CJK) labels render with
system fonts as-is.

## Requirements

> [!IMPORTANT]
> **This tool does not bundle a TeX environment.** It invokes your locally
> installed TeX toolchain (LuaLaTeX + TikZ/PGF + fontspec) as external commands,
> so you must set up TeX Live (or equivalent) beforehand. Without a TeX
> environment, compilation fails.

- `lualatex` (included in TeX Live; install with the TikZ/PGF and fontspec packages)
- `dvisvgm` (SVG output; bundled with TeX Live)
- `pdftoppm` (poppler; only needed for PNG output)
- Node.js 18+ (from [nodejs.org](https://nodejs.org/) or your package manager)

### Linux (Ubuntu / Debian)

```sh
sudo apt install texlive-luatex texlive-pictures texlive-latex-extra poppler-utils
```

### macOS

```sh
# MacTeX (includes lualatex + dvisvgm + TikZ). The -no-gui build is enough if you don't need the GUI apps.
brew install --cask mactex-no-gui

# pdftoppm (only if you use PNG output)
brew install poppler
```

After installing, reopen your terminal so `/Library/TeX/texbin` is on your PATH.
If it isn't picked up, run `eval "$(/usr/libexec/path_helper)"`.

### Windows

- **TeX Live**: install via the [tug.org/texlive](https://tug.org/texlive/)
  installer (includes `lualatex` / `dvisvgm`; scheme-full recommended).
  [MiKTeX](https://miktex.org/) also works (missing packages are installed on the fly).
- **poppler** (only if you use PNG output): `scoop install poppler` or
  `choco install poppler`. To install manually, extract
  [poppler-windows](https://github.com/oschwartz10612/poppler-windows/releases)
  and add `Library\bin` to your PATH.

The commands run as-is in PowerShell / Command Prompt (WSL is not required).

### Verifying the installation

```sh
lualatex --version && dvisvgm --version && pdftoppm -v && node --version
```

### About Japanese fonts

The default font `IPAexMincho` ships with the full TeX Live / MacTeX
distribution. If it isn't found, specify an OS font with a `#| mainfont:` header
or the VSCode setting `tikzc.mainfont`:

- macOS: e.g. `Hiragino Mincho ProN`
- Windows: e.g. `Yu Mincho`, `MS Mincho`

## CLI

```sh
npm install
npm run build          # produces dist/tikzc.cjs
npm link               # optional: install the tikzc command globally

tikzc test.tikz                    # -> test.svg
tikzc test.tikz -f png --dpi 600   # -> test.png
tikzc test.tikz -f both -o out/    # -> out/test.svg, out/test.png
tikzc test.tikz --watch            # recompile on every save
tikzc --help
```

## Header options in `.tikz` sources

Uses the same `#|` notation as quarto_tikz. These take precedence over CLI flags
and VSCode settings.

```text
#| packages: [circuitikz, pgfplots]   -- extra \usepackage
#| libraries: [arrows.meta, calc]     -- extra \usetikzlibrary
#| scale: 1.5                         -- wrap in \scalebox
#| mainfont: IPAexGothic              -- fontspec main font (default: IPAexMincho)
```

Bare TikZ code without `\begin{tikzpicture}` is wrapped automatically.

## VSCode extension (vscode-extension/)

A TikZ editor that embeds the WYSIWYG editor from
[DominikPeters/tikz-editor](https://github.com/DominikPeters/tikz-editor) (MIT)
into a webview. Only the parts needed to build it (sources and assets under
`packages/`) are vendored, unmodified, into `vscode-extension/tikzc-editor/`
(see `UPSTREAM.md` in that directory for the origin and commit; update with
`./scripts/update-tikz-editor.sh`).

```sh
cd vscode-extension
npm install
npm run package        # build the webview (Vite) + extension host and produce the .vsix
code --install-extension tikzc-preview-0.1.0.vsix
```

> [!NOTE]
> If the `code` command isn't found on macOS, run "Shell Command: Install 'code'
> command in PATH" from the VSCode command palette.

### Usage

- Open a `.tikz` file and open the **Local TikZ Editor** to the side via the icon
  in the editor's top-right or `Ctrl+K V`.
- The panel is a canvas-only layout (you edit code in VSCode's own text editor).
  Rendering uses tikz-editor's TikZ parser for instant previews (no LaTeX needed).
- Single-document mode: the panel only ever shows the `.tikz` file currently open
  in VSCode (no tabs; running the command again on another `.tikz` switches to it).
- Edits in the VSCode text editor are reflected in the canvas instantly, and shape
  operations on the canvas are written back to VSCode's buffer automatically
  (save to disk with `Ctrl+S` as usual).
- Command palette: `TikZ: Export as SVG` / `TikZ: Export as PNG` (these use the
  usual accurate lualatex + dvisvgm / pdftoppm compilation; CJK labels render
  correctly in exports).
- Settings: `tikzc.mainfont` / `tikzc.extraPackages` / `tikzc.extraLibraries` /
  `tikzc.pngDpi` (applied on export).

### Layout

```text
vscode-extension/
├── tikzc-editor/      vendored tikz-editor (the WYSIWYG editor itself; MIT, unmodified)
├── webview/           bootstrap that runs the tikz-editor App in a VSCode webview +
│                      an EditorPlatform adapter (file sync, dialogs, clipboard, lualatex bridge)
├── src/extension.ts   extension host: RPC with the webview, two-way sync with the
│                      .tikz TextDocument, lualatex export (shares ../src/core.ts)
└── vite.config.ts     builds the webview bundle (resolves tikz-editor sources directly
                       via aliases + build-time stubs for features unused in the VSCode build)
```

tikz-editor's rendering supports a subset of TikZ (decorations / graphs / plots
are partially supported; external packages are not). When you need accurate
output, use the export commands (lualatex).

### Slim build

The vendored sources stay unmodified; `vite.config.ts` swaps in build-time stubs
for features that the VSCode single-document, canvas-only mode doesn't use:

- Source panel (the whole CodeMirror stack), tab strip, AI assistant panel
- The thumbnail Web Worker (it double-bundles core + MathJax + fonts; falls back
  to main-thread rendering instead)
- PowerPoint / IPE import (new documents can't be opened in the tab-less
  single-document mode)
- Source-panel-only hover docs (`public/docs/`, also excluded from the vendor extraction)

## Uninstalling

```sh
# VSCode extension (the extension ID is publisher.name)
code --uninstall-extension RyoNak.tikzc-preview

# CLI (only if you ran npm link)
npm unlink -g tikzc

# Dependencies are contained within the repository
rm -rf node_modules vscode-extension/node_modules
# Windows (PowerShell): Remove-Item -Recurse -Force node_modules, vscode-extension/node_modules
```

## Development

```sh
npm run check          # type-check (root and vscode-extension separately)
npm run build
```

## License

[MIT](LICENSE). The vendored [tikz-editor](https://github.com/DominikPeters/tikz-editor)
(`vscode-extension/tikzc-editor/`, by Dominik Peters and others) is also MIT-licensed.
