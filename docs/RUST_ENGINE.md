# Rust engine: CLI and compatibility

```sh
cargo build --release --locked
target/release/tikzc notebook/native-subset.tikz -o target/example.svg
target/release/tikzc notebook/native-subset.tikz -o target/example.png
target/release/tikzc check notebook/native-subset.tikz
```

On Windows use `target/release/tikzc.exe`. To install the command on PATH:
`cargo install --path . --locked`.
The first build downloads Rust dependencies; rendering is entirely offline.
Rust 1.92+ is required. The initial build and embedded CJK fonts are substantial
(font assets alone are approximately 15 MiB).

Output format is inferred from `-o`, otherwise SVG. Use `-f both -o output-dir`
for both formats, `--dpi 150` for PNG resolution (150 by default), and
`-q` / `--quiet` to suppress progress output.
SVG preserves transparency; PNG has a white background. Glyphs are SVG paths,
so viewing an exported diagram does not require fonts installed on that machine.
Unsupported syntax fails with `file:line:column` diagnostics (exit code 3),
without a TeX fallback or replacement of existing outputs. Exit code 2 reports
usage and input errors (unknown option, invalid DPI, unreadable input, output
equal to the input); exit code 1 reports rasterization or write failures.
`tikzc check` compiles without writing output.

`tikzc --preview-server` is the interface used by the VSCode extension, not a
user command: it reads one JSON request per line on stdin (`source`, optional
`dpi`) and answers with `svg`, `png` and `editing` metadata, or `error`. It
writes no files and uses the same compiler and PNG path as the regular CLI.

The native crate follows the project version in [`VERSION`](../VERSION).
Use `target/release/tikzc --version` to inspect the built executable.
It does **not provide full TikZ/TeX compatibility**.
The fixtures and regression tests define the supported subset;
successful generation alone is not proof of visual compatibility.

### Updating the version

From the repository root:

```sh
devtools/bump-version.sh 1.0.1  # replace with the intended release version
devtools/bump-version.sh --check
cargo build --release --locked
target/release/tikzc --version
```

The script synchronizes `VERSION`, `Cargo.toml`, the local `tikzc`
entry in `Cargo.lock`, and the root/extension npm manifests and lockfiles.
It requires Bash and Node.js, with no TeX, Cargo invocation or network access.
`--check` checks source metadata; it does not check or rebuild existing binaries.
The CLI embeds Cargo's package version at build time, so rebuild after a bump.
See [versioning policy](VERSIONING_POLICY.md) for the managed files and exclusions.

### Native compatibility contract

- Nodes: rectangle, circle, ellipse, diamond with `aspect`, upright cylinder
  (`shape border rotate=90`); named anchors; minimum sizes, padding, `text width`,
  `align`, positioning (including point targets), `at`, `fit`, background scopes,
  and simple `label={[options]angle:text}` annotations.
- Coordinates: cartesian/polar, named anchors, `+` / `++`, `|-` / `-|`,
  restricted `calc` addition/subtraction/interpolation. Numeric coordinates use
  cm; explicit cm/mm/pt/bp/in are accepted. Coordinate-local transforms such as
  `([yshift=4mm]a.north)` work. TeX pt is converted to 72/72.27 bp.
- Paths: straight/orthogonal segments, rectangles, circles, ellipses, arcs,
  cubic Beziers, `to` bends; Latex/Stealth/Triangle tips, line widths, dashes,
  rounded corners, double lines, colors and opacity. Path labels refer to the
  most recent segment; postfix labels default to the end, infix labels to the
  middle; `sloped` and `auto` placement are supported. Grid paths, explicit
  `plot [smooth,tension=...] coordinates {...}` and straight-segment brace
  decoration (`amplitude`, `aspect`, `mirror`) are supported.
- Styles: `/.style`, `/.append style`, one `#1` argument and `/.default`;
  `definecolor` (HTML/rgb/RGB/gray), color mixtures.
- Expansion: braced `\foreach` lists, ascending/descending numeric ranges,
  decimal steps, nested loops, empty slash-separated tuple fields, braced or
  semicolon-terminated bodies and `[count=\i from 1]`; `\def`,
  `\newcommand`, `\renewcommand` with up to nine mandatory braced arguments.
  Definitions are local to groups/scopes and loop iterations.
- Scalar math: `\pgfmathsetmacro`, `\pgfmathtruncatemacro`, `\pgfmathparse`
  (`\pgfmathresult`), arithmetic, powers, `sqrt`, `sin`/`cos` (degrees),
  and other documented functions. Coordinate expressions such as `({2*\i},0)`
  work after expansion.
- Transforms: ordered and nested scope/path shifts, scales and rotations;
  transformed rectangles, circles, ellipses and arcs. Node-local rotation,
  scale/reflection and shifts update named anchors and border intersections.
  Scope transforms affect node shapes only with `transform shape` (disable with
  `transform shape=false`); local node transforms always affect the shape.
- Arrows: independent start/end tip specifications, bar tips such as `|<->|`,
  and `shorten <` / `shorten >`
  on a single open line/cubic path, including arcs. Cubics retain their geometry
  when shortened; tips follow analytic endpoint tangents. Negative shortening
  extends along the tangent. Shafts stop behind filled/open tips.
- Text: bundled IPAexMincho, IPAexGothic, New Computer Modern
  Math, Latin Modern Mono (with IPAexGothic for Japanese glyphs), and `\faGlobe` /
  `\faSitemap` / `\faFolderOpen` / `\faFileO`.
  IPAex uses a synthetic stroke for `\bfseries` / `\textbf`.
  Noto Sans CJK Regular/Bold are not bundled; explicitly selecting a Noto
  `mainfont` requires that family to be installed on the system.
  Size/family/style switches, line breaks, `textcolor`, `hspace`, `phantom`,
  `textcircled`, simple `tabular` (`l/c/r`, single rules, `hline`) and restricted
  LaTeX math through mitex/Typst, including text and small matrices.
  Explicitly requested non-bundled `mainfont` families are read from installed
  system fonts using Rust (no fontconfig process). Missing families fail; they
  are not silently substituted. These diagrams need that font installed and
  incur a discovery cost; bundled-font diagrams remain self-contained.
- Layout: measured text baselines (`base`, `base west/east`), node-font line
  struts and `font=\fontsize{size}{baseline skip}\selectfont`, font-relative
  padding, `outer sep` / `outer xsep` / `outer ysep` (default half line width).
  Outer separation changes anchors, not the painted shape.
- Limited additions: scoped `\clip` paths (including even-odd holes), rectangular
  `\matrix[matrix of nodes]` with named cells, `nodes`, cell `|[options]|`,
  row/column separation, and seven basic line/grid/crosshatch/dot patterns.
  See the limitations below and [regression tests](TESTING.md) for coverage.
- Headers: presentation-only `filename`, `width`, `height` are accepted but do
  not change standalone sizing or override CLI output destinations.

Native layout is not pixel-identical to TeX: font metrics, line breaking,
baseline details, curve-label positioning, arrow profiles and shape padding
can differ. General PGF transforms, multiple-subpath/closed-path shortening,
general decorations, arbitrary matrix cells/spans, graphs, function/file plots,
custom/meta patterns, shadings, custom shapes, `outer sep=auto` and `on grid`
remain unsupported. Expansion is bounded and
does not support arbitrary TeX, optional/delimited arguments, conditionals,
loop options other than `count`, inline path loops or PGF's full math language.
The old Phase 0 “supported” fixture
classification is not a promise that all those features are implemented.

Try the parameterized pipeline example:

```sh
target/release/tikzc notebook/native-subset.tikz -f both -o target/output
```

For reproducible before/after comparisons over your own diagrams, use the
[local corpus comparison workflow](TESTING.md#opt-in-local-corpus-comparison).

### Native verification

```sh
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo run --release --example benchmark -- target/release/tikzc
```

Tests cover all eight corpus diagrams, deterministic SVG, PNG dimensions and
nonempty pixels, geometry, diagnostics and a CLI process with an empty PATH.
Additional tests cover ten formerly unsupported feature fixtures, expansion
scoping/limits, source locations, transform order and rotated anchors. Synthetic
Desktop regressions cover loops, labels, plots, braces, tables, colors and
relative Bezier controls without depending on private input files. Further
suites cover layout precision, `-|` / `|-` label timing, bold faces, source
whitespace, SVG size optimization, canvas editing metadata, the `--version`
output and native visual baselines.
See [testing instructions](TESTING.md) for the test suites and visual baselines.

For new TikZ feature requests, follow the [feature workflow](FEATURE_WORKFLOW.md)
for scope, minimal reproductions, reference comparisons, tests and acceptance criteria.

