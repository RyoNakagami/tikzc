# TikZ Editor (tikzc)

WYSIWYG editing of `.tikz` files (based on
[tikz-editor](https://github.com/DominikPeters/tikz-editor)) plus SVG / PNG
export via lualatex.

- Open a `.tikz` file and open the **TikZ Editor** to the side via the icon in the
  editor's top-right (or `Ctrl+K V`).
- The panel is canvas-only (you edit code in VSCode's text editor).
- Shape operations on the canvas are written back to VSCode's buffer
  automatically (save to disk with `Ctrl+S`). Edits in the text editor are
  reflected in the canvas instantly.
- Rendering uses tikz-editor's TikZ parser (no LaTeX needed, instant). When you
  need accurate output, export via lualatex.
- Command palette: `TikZ: Export as SVG` / `TikZ: Export as PNG`
  (lualatex + dvisvgm / pdftoppm).

**Export requires a local TeX environment (not bundled with this extension).**
`lualatex` (TeX Live etc. with TikZ/PGF and fontspec), `dvisvgm`, and `pdftoppm`
must be on your PATH. WYSIWYG editing itself works without a TeX environment.

On export, options can be set via `#|` headers at the top of the source:

```text
#| packages: [circuitikz, pgfplots]
#| libraries: [arrows.meta, calc]
#| scale: 1.5
#| mainfont: IPAexGothic
```

License: MIT. The bundled [tikz-editor](https://github.com/DominikPeters/tikz-editor)
(by Dominik Peters and others) is also MIT-licensed.
