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
entry in `Cargo.lock`, the root/extension npm manifests and lockfiles, and the
Claude Code / Codex plugin manifests.
It requires Bash and Node.js, with no TeX, Cargo invocation or network access.
`--check` checks source metadata; it does not check or rebuild existing binaries.
The CLI embeds Cargo's package version at build time, so rebuild after a bump.
See [versioning policy](VERSIONING_POLICY.md) for the managed files and exclusions.

### Native compatibility contract

- Nodes: rectangle, circle, ellipse, diamond with `aspect`, upright cylinder
  (`shape border rotate=90`); named anchors; minimum sizes, padding, `text width`,
  `align`, positioning (including point targets), `at`, `fit`, background scopes,
  and simple `label={[options]angle:text}` annotations. `node distance`
  (`<d>` or `<vertical> and <horizontal>`) and `on grid` (distances between
  centers) follow PGF, including the 1/√2 factor of a single distance on a
  diagonal such as `above right=of a`.
- Coordinates: cartesian/polar, named anchors, `+` / `++`, `|-` / `-|`,
  restricted `calc` addition/subtraction/interpolation. Numeric coordinates use
  cm; explicit cm/mm/pt/bp/in are accepted. Coordinate-local transforms such as
  `([yshift=4mm]a.north)` work. TeX pt is converted to 72/72.27 bp.
  `x=`, `y=` and `z=` redefine the unit vectors (a length or `{(x,y)}`), and
  `(x,y,z)` coordinates use them (default z is (-3.85mm,-3.85mm)). Components
  with a unit are not rescaled. Unitless circle/ellipse/arc radii follow
  axis-aligned x/y vectors.
- Paths: straight/orthogonal segments, rectangles, circles, ellipses, arcs,
  cubic Beziers, `to` bends; Latex/Stealth/Triangle tips, line widths, dashes,
  rounded corners, double lines, colors and opacity. Path labels refer to the
  most recent segment; postfix labels default to the end, infix labels to the
  middle; `sloped` and `auto` placement are supported. Grid paths (with
  `grid[step=...]`), explicit `plot [smooth,tension=...] coordinates {...}` and
  straight-segment brace decoration (`amplitude`, `aspect`, `mirror`) are
  supported.
- Plots: `plot (\x,{f(\x)})` with `domain` (default `-5:5`), `samples`
  (default 25, 2 to 10000), `variable` and `smooth`; marks `*`, `o`, `x`, `+`
  with `mark size` and `only marks`, on any plot. See [plots](#plots).
- Intersections: `name path`, and `name intersections` with `of`, `by`,
  `name` and `total`, for lines, polylines, plots and curves.
- Markings: `decoration={markings, mark=at position <p> with {...}}` under
  `postaction={decorate}` or `decorate`, where the code is `\arrow{tip}`,
  `\node ...;` or a `\fill` / `\draw` path, on one open path.
- Shadings: `\shade` / `\shadedraw` and `left color`/`right color`,
  `top color`/`bottom color` (with `middle color`) and
  `inner color`/`outer color`, as SVG gradients fitted to the path's
  bounding box.
- Styles: `/.style`, `/.append style`, one `#1` argument and `/.default`;
  `definecolor` (HTML/rgb/RGB/gray), color mixtures.
- Expansion: braced `\foreach` lists, ascending/descending numeric ranges,
  decimal steps, nested loops, empty slash-separated tuple fields, braced or
  semicolon-terminated bodies, and the loop options `count=\i from 1`,
  `evaluate=\v as \w using <expr>` and
  `remember=\v as \p (initially <value>)`. The list may be a macro
  (`\foreach \n in \layers`). `foreach` also works as a path operation with
  a braced body (`\draw (0,0) foreach \x in {1,2} { -- (\x,1) };`), without
  starting a new path. `\def`, `\newcommand`, `\renewcommand` with up to
  nine mandatory braced arguments. Definitions are local to groups/scopes
  and loop iterations.
- Scalar math: `\pgfmathsetmacro`, `\pgfmathtruncatemacro`, `\pgfmathparse`
  (`\pgfmathresult`), arithmetic, powers, `sqrt`, `sin`/`cos` (degrees),
  `exp`, `ln`, `log10`, `log2`, `abs`, `sign`, `min`, `max`, `mod`, `floor`,
  `ceil`, `round`, `int`, `frac`, `sinh`, `cosh`, `tanh`, `atan2`, `deg`,
  `rad`, the constants `pi` and `e`, and the radian suffix (`cos(\t r)`).
  Conditions: `<`, `>`, `<=`, `>=`, `==`, `!=`, `&&`, `||`, `!`, `c ? a : b`
  and `ifthenelse(c,a,b)`, with PGF's precedence. Coordinate expressions such
  as `({2*\i},0)` work after expansion. A quoted string may be the result of
  `?:` or `ifthenelse` (`\pgfmathsetmacro{\c}{\v>0 ? "red" : "blue"}`), not
  an operand.
- TeX conditionals: `\ifnum a<b`, `\ifodd n` and `\ifdim a<b` (`=`, `>`)
  with an optional `\else`, ended by `\fi`, nested and inside macros or
  loops. Operands are digits or one value macro (`\ifnum#1>0`, `\ifnum\i=\j`);
  `\ifnum` needs integers and `\ifdim` a unit (`pt`, `bp`, `cm`, `mm`,
  `in`). TeX's general number scanning is not reproduced.
- Numbers: `\pgfmathprintnumber` in PGF's default format (fixed for
  10⁻¹ ≤ |x| < 10⁵, otherwise `m·10^e`) and with `fixed`, `precision` and
  `zerofill`; the result is math, with `{,}` thousands separators.
- Random numbers: `rnd`, `rand`, `random()`, `random(n)`, `random(a,b)` and
  `\pgfmathsetseed{n}`. See [random numbers](#random-numbers).
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
  LaTeX math through mitex/Typst, including text and small matrices. The
  notation pinned by `tests/ds_text.rs` covers `\mathbf`, `\boldsymbol`,
  `\mathbb`, `\mathcal`, `\operatorname` (and `*`), `\sqrt[n]{}`,
  `\underset`/`\overset`, `\odot`/`\otimes`/`\oplus`, `\cap`,
  `\langle`/`\rangle`, `pmatrix`/`bmatrix` and `\underbrace`.
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
general decorations (`snake`, `mark=between positions`, `reset marks`),
arbitrary matrix cells/spans, graphs, `plot function` (gnuplot), `plot file`,
`pgfplots`
(`axis`), custom/meta patterns, `shading=ball`, `shading angle`, custom
shapes, `outer sep=auto`, intersection `sort by`, and number formats other
than the default and `fixed` (`sci`, `std=`, `int detect`) remain
unsupported. Expansion is bounded and does not support arbitrary TeX,
optional/delimited arguments, TeX conditionals other than `\ifnum`, `\ifodd`
and `\ifdim` (`\ifx`, `\ifthenelse` of the ifthen package), other loop
options (`parse`, `var`, `expand list`) or PGF's full math language.
The old Phase 0 “supported” fixture
classification is not a promise that all those features are implemented.

#### Deliberate differences from TeX

These are fixed by tests and are diagnostics or documented behavior, not
silent approximations.

- `samples=1` is an error; PGF raises it to 2 without a message.
- A colour mix percentage outside 0..100 (`blue!150!white`) is an error;
  xcolor clamps it without a message.
- `\pgfmathsetmacro` stores `2`, where PGF stores `2.0`. This only shows when
  the macro is printed as text; use `\pgfmathprintnumber` or
  `\pgfmathtruncatemacro` for labels.
- Intersections are ordered by the segments of the first path, then of the
  second, then along the first path's segment. This matches PGF for lines and
  polylines; PGF's order for several crossings of one pair of curves is not
  specified. Curves are cut into 64 line pieces before intersecting.
  A computation is limited to 5,000,000 work units, counting both segment
  bounding-box comparisons and candidate line-piece comparisons.
  Computing intersections removes earlier `<name>-<n>` coordinates, so a
  reference beyond the new count fails instead of using a stale point.
- `total=\t` is available in coordinates and node labels of the path that
  carries `name intersections`, not in later commands or in loop lists.
- A plot variable is substituted while the plot is sampled. A macro of the
  same name defined outside the plot (for example an enclosing
  `\foreach \x`) is expanded first and so takes precedence.
- `fit` together with `of` placement under `on grid` is an error. A plain
  `fit` node under `on grid` is supported and is the same as without it.
- `shift=` is not rescaled by `x=`/`y=` and is refused together with them;
  so is `grid`, and a unitless radius under skewed unit vectors.
- In marks, an enclosing `scale` does not apply, as in PGF; `at` on a mark's
  node is not supported. Mark paths do not repeat inherited decoration
  actions. Explicit nested markings are unsupported and report a diagnostic
  at the enclosing decoration instead of recursively rendering it.
- Three consecutive `\!` in math narrow by one thin space, not three: Typst
  merges adjacent spacing. `\perp\!\!\!\perp` is therefore wider than in TeX.

#### Plots

`plot file {name}` is a diagnostic, by design: a diagram source never reads
other files ([ARCHITRECTURE.md](ARCHITRECTURE.md), Article 3). Put the points
in the source with `plot coordinates {...}` or a `\foreach` list.

Sampling is bounded like loops: `samples` and explicit coordinates are
limited to 10000 points, and a non-finite sample (`ln(0)`) is a diagnostic at
the `plot`. `pgfplots` and its `axis` environment are out of scope: draw
axes-heavy data plots with a plotting library and keep tikzc for concept
diagrams and light function plots.

#### Random numbers

`rnd` is uniform in [0,1), `rand` in [-1,1]; `random(n)` and `random(a,b)`
are integers. Output is deterministic: the same seed gives the same diagram,
and without `\pgfmathsetseed` a fixed default seed is used, so a preview does
not change from one render to the next. **The numbers are not the ones TeX
produces**: PGF's generator is not reproduced, so a scatter of random points
is equally distributed but not point-for-point the same as under TeX. Math in
`\pgfmath...` macros and loop options is evaluated during expansion, math in
coordinates while rendering; each of the two draws its own sequence, and
`\pgfmathsetseed` reseeds both at the place it is written.

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
output and native visual baselines. The `ds_*` suites cover the data-science
features (plots, intersections, loop options, number printing, colour mixes,
grid positioning, unit vectors, markings, shadings and math notation)
against reference values taken from TeX.
See [testing instructions](TESTING.md) for the test suites and visual baselines.

For new TikZ feature requests, follow the [feature workflow](FEATURE_WORKFLOW.md)
for scope, minimal reproductions, reference comparisons, tests and acceptance criteria.

