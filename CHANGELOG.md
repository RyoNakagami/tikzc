# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-10-20

### Added

- TeX conditionals `\ifnum`, `\ifodd` and `\ifdim` with `\else` / `\fi`,
  nested and inside macros or loops (`\ifnum#3=0 ... \else ... \fi`).
  Operands are digits or one value macro; `\ifx` and `\ifthenelse` stay
  unsupported.
- Math: a quoted string as the result of `?:` or `ifthenelse`
  (`\pgfmathsetmacro{\c}{\v>50 ? "red" : "blue"}`), for choosing a colour
  or style name.
- VSCode extension: preview zoom and pan. Ctrl+wheel (Cmd+wheel or pinch on
  macOS) zooms around the cursor, from 10% to 800%; Space-drag or
  middle-button drag pans. **Fit / 100%** returns from a zoom to Fit.

### Fixed

- An unexpected character in math (`"`, `@`) is reported as
  `Unsupported math near '…'` instead of `Unsupported math symbol ''`.

## [1.1.1] - 2026-10-15

### Changed

- VSCode extension: the separate SVG / PNG export commands and preview buttons
  are merged into one **TikZc Editor: Export (SVG / PNG)** command
  (`tikzc.export`) and one **Export…** button. The format is chosen from a
  quick pick; the preview's current view (SVG / PNG) is offered first.
- VSCode extension: the export save dialog now opens at the workspace root
  (the folder that contains the `.tikz` file, else the first one) instead of
  the `.tikz` file's folder. Without a workspace it still uses the file's
  folder.

### Removed

- VSCode extension: command IDs `tikzc.exportSvg` and `tikzc.exportPng`.
  Rebind custom keybindings to `tikzc.export`.

## [1.1.0] - 2026-10-14

### Added

- Function plots: `plot (\x,{f(\x)})` with `domain`, `samples`, `variable`
  and `smooth`, and plot marks `*`, `o`, `x`, `+` with `only marks` and
  `mark size`.
- Math: `exp`, `ln`, `log10`, `log2`, `sign`, `frac`, `sinh`, `cosh`, `tanh`,
  the radian suffix `r`, comparisons, `&&`, `||`, `!`, `c ? a : b`,
  `ifthenelse`, and `rnd` / `rand` / `random` with `\pgfmathsetseed`.
  Random output is deterministic per seed and is not TeX's sequence.
- `\pgfmathprintnumber` in PGF's default format and with `fixed`,
  `precision` and `zerofill`.
- `\foreach` options `evaluate` and `remember`, lists held in a macro, and
  `foreach` as an operation inside a path.
- `on grid`, `x=` / `y=` / `z=` unit vectors and `(x,y,z)` coordinates,
  `grid[step=...]`.
- `name path` and `name intersections` (`of`, `by`, `name`, `total`).
- `decorations.markings` with `mark=at position ... with {...}` for arrows,
  nodes and `\fill` / `\draw` paths.
- `\shade` / `\shadedraw` with left/right, top/bottom (and middle) and
  inner/outer colours.
- Math notation: `\mathbf`, `\operatorname`, `\partial`, `\sqrt`,
  `\underset` / `\overset`, `\odot` / `\otimes` / `\oplus`, `\cap`,
  `\langle` / `\rangle`, `pmatrix` / `bmatrix`, `\underbrace`.
- `Diagram::labels` in the library API.
- Test suites `tests/ds_*.rs` for data-science diagrams, with fixtures
  `tests/fixtures/ds-*.tikz` and reference values taken from TeX.

### Changed

- A single distance on a diagonal placement (`above right=1cm of a`) now
  moves 1/√2 of it on each axis, as PGF does; it used to move the full
  distance on both.
- A path that starts with an operation (`\draw circle (1);`) starts at the
  origin of the current coordinate system instead of the canvas origin.
- Path diagnostics point at the operation or option they are about instead
  of the start of the command.
- Renamed the supported clip, matrix, pattern, coordinate-plot and shading
  fixtures to remove the `unsupported-` prefix. Updated test references and
  documentation, and included all five in SVG determinism and PNG rendering
  checks.
- VSCode extension: source offset conversion and node/object ID checks now use
  linear scans to reduce editing-metadata overhead on large diagrams.

### Fixed

- Number formatting preserves large integers and rounds decimal ties without
  a magnitude-dependent floating-point bias.
- Removed unnecessary closure borrows in foreach error handling that caused
  Clippy's `needless_borrows_for_generic_args` lint to fail CI with warnings
  treated as errors.
- Unit-bearing circle, ellipse and arc radius options ignore axis unit vectors,
  consistently with the parenthesized radius syntax.
- Marking paths no longer recurse through inherited decoration actions; errors
  inside marks point to the enclosing decoration, and explicit nesting is refused.
- Intersection limits count disjoint segment pairs as well as overlapping ones.
- `log10` and `atan2` were listed as math functions but could not be parsed.
- VSCode extension: closing the preview cancels its version check and queued
  renders; late completions and idle timers cannot start or stop a worker after
  the preview is reopened.
- VSCode extension: the `tikzc` executable is now accepted or refused by its
  reported version. Every version from 1.0.0 on is accepted; a 0.x build gets
  a `tikzc … is older than 1.0.0` message instead of being misreported as
  "not the Rust tikzc".

## [1.0.0] - 2026-10-13

### Added

- Rust-native CLI: documented diagram-oriented TikZ subset,
  outlined SVG and Rust-rasterized PNG, embedded Japanese/math/icon fonts,
  source diagnostics, corpus and empty-PATH integration tests, benchmarks and
  cross-platform Rust CI. No TeX, Poppler or Node runtime dependency on this path.
- Native arrow start/end, intermediate vertex, orthogonal corner and Bézier
  control-point editing through draggable handles, keyboard nudges and numeric
  coordinates. Endpoints can reconnect to named anchors; relative `+` / `++`
  routes are materialized in one undoable edit to preserve other explicit
  vertices. Selecting an inline label also exposes its parent path's handles.
- English/Japanese preview toolbar and message selection through the toolbar
  or `tikzc.language` (English by default).
- Real Chromium pointer/hit-testing coverage for start/end/bend dragging,
  inline-label selection and numeric path-point editing.
- Developer documentation for the Rust engine, feature workflow and editor
  naming/rename procedure (`docs/RUST_ENGINE.md`, `docs/FEATURE_WORKFLOW.md`
  and `docs/NAIMING.md`).
- Native arrow/path selection and translation by dragging or center coordinates,
  plus object and inline-label deletion through the toolbar or Delete/Backspace.
  Invalid deletions that would break named references preserve the source.
- Native canvas object picker, Tab/Alt-click overlap selection, and forward,
  backward, front and back ordering using PGF layers without moving source
  declarations across scopes. GUI updates reuse their validated render and swap
  decoded images while retaining the viewport and selection, eliminating the
  intermediate blank preview and duplicate refresh.
- Rust preview canvas label editing with TeX/Japanese input, and text,
  rectangle, ellipse, circle, line and arrow insertion. Operations validate
  before applying one undoable source edit; empty diagrams provide a blank
  canvas, and `reset cm` scopes preserve world-space insertion coordinates.
- SVG/PNG preview selection, native executable configuration, coalesced live
  compilation, and suppression of stale images/results on edits and errors.
- A single platform-independent VSIX. It does not bundle the Rust executable:
  install `tikzc` separately with `cargo install`. The extension resolves
  `tikzc` on PATH (or `tikzc.nativePath`) and warns when the executable's
  major.minor version differs from its own.
- CLI/artifact byte-parity tests for mixed-width multiline alignment at three
  DPIs, plus host, webview and update-race regression checks in native CI.
- Native layout precision: measured baselines and fixed node-font line struts,
  bundled Latin Modern Mono, font-relative padding and outer separation;
  node-local scaling/reflection and inherited `transform shape`; cubic
  arc-length shortening and analytic arrow tangents. Scoped clipping, limited
  rectangular matrices of nodes, seven basic patterns, geometry regressions
  and three reviewed native PNG baselines were added.
- Desktop-driven native compatibility: unbraced/nested foreach with count and
  empty tuple fields; explicit/smooth coordinate plots; brace decoration; grid,
  node labels, diamond aspect and upright cylinders; shifted coordinates and
  point-target positioning; bar arrows; text color/spacing/phantom/circled text,
  simple tabular and additional math/icon commands. Explicit non-bundled fonts
  can be loaded from installed system fonts without external commands.
- Opt-in read-only Desktop comparison harness with content deduplication,
  source-hash verification, cached reference results and side-by-side SVG/PNG gallery.
- Native subset expansion: bounded foreach lists/ranges/tuples, parameterized
  def/newcommand/renewcommand, scalar PGF math and coordinate expressions with
  source-mapped diagnostics. Added a parameterized pipeline example and feature
  regression tests.
- Ordered affine scope/path transforms, transformed circle/ellipse/arc paths,
  rotated/shifted nodes and rotated anchors/border intersections; independent
  arrow endpoints, open-tip shaft clearance and single-polyline shortening.

### Changed

- Removed the bundled Noto Sans CJK Regular/Bold fonts, reducing embedded
  font assets from about 52 MiB to 15 MiB. Japanese typewriter text falls back
  to IPAexGothic; test fixtures use bundled IPAex fonts. Explicit Noto
  `mainfont` requests use installed system fonts and fail if unavailable.
- VSCode's default preview and SVG/PNG export now share the Rust-native renderer
  and its path-based text layout. Mixed-width labels no longer pass through a
  separate MathJax layout in the standard preview.
- Renamed the extension display name, editor tab/header, commands and settings
  group to **TikZc Editor**. The extension ID `RyoNak.tikzc-preview`, command
  IDs and `tikzc.*` settings remain compatible with existing installations.
- SVG labels share verified self-contained Typst glyph symbols across the
  diagram, with deterministic ordering, collision checks and matrix rollback.
- Shared glyph outlines use four decimal places; regular diagram paths retain
  their precision. Redundant default attributes are omitted from generated
  elements, inherited defaults are set on the root, and node coordinates use
  five decimal places. Nested label viewports and line joins are preserved.
- Refactored Rust rendering into coordinate, geometry, node, path, paint and
  artifact modules while preserving the public API and rendering behavior.
- Organized the extension around the Rust-native host and webview; activation
  is now a small entry point. Developer corpus comparison lives under
  `devtools/`, VSIX archives under `vscode-extension/dist/packages/`, and
  detailed usage under `docs/`.
- Defined the native compatibility contract around practical diagram syntax,
  with documented limits for arbitrary TeX execution and pixel parity. See
  [Rust engine compatibility](docs/RUST_ENGINE.md) for the supported subset.
- Aligned the Rust crate version with the canonical `VERSION` (1.0.0).
- The Rust crate moved from `crates/tikzc/` to the repository root (`src/`,
  `tests/*.rs`, `examples/`), replacing the Cargo workspace with a single
  package. Install from a checkout with `cargo install --path . --locked`.
- `tikzc --version` prints `tikzc <version>` without the `(Rust native)` suffix.
- `devtools/compare-desktop.mjs` compares two `tikzc` builds: `--legacy` and
  `--reuse-legacy` are now `--reference` and `--reuse-reference`, and result
  keys use `reference`.
- Design principles ([ARCHITRECTURE.md](docs/ARCHITRECTURE.md)) were rewritten
  for a single Rust renderer; the articles on the legacy editor were removed.
- The user manuals describe the Rust CLI and extension.

### Removed

- **Breaking:** the TypeScript / LuaLaTeX CLI (`src/cli.ts`, `src/core.ts`,
  the npm `tikzc` bin and its tests). `tikzc` is now the Rust executable only;
  install it with `cargo install` and remove an old link with
  `npm unlink -g tikzc`. The root npm package is private development tooling.
- **Breaking:** the legacy WYSIWYG editor: the `tikzc.showLegacyEditor`
  command, the vendored tikz-editor, the MathJax canvas, the lualatex text
  fallback, and the Vite webview build. The extension now consists of the Rust
  preview with canvas editing and SVG/PNG export, and the VSIX shrinks from
  about 9.7 MB to about 65 KB.
- The extension no longer accepts the TeX-based npm `tikzc` as a renderer. A
  non-Rust executable is reported with installation instructions instead of
  being used through TeX.
- The Phase 0 golden generator (`devtools/golden/`) and its unused lualatex
  reference data (`tests/fixtures/golden/`). Visual regression continues to use
  the reviewed Rust-native baselines in `tests/visual-native/`.

### Fixed

- Japanese italic and IPAex synthetic bold now recognize single-font settings
  as well as font fallback lists, so `\itshape` / `\textit` / `\emph` and
  `\bfseries` / `\textbf` produce visible styles with bundled Japanese fonts.
- Returning focus to the same source editor and save/dirty-state notifications
  without text changes no longer trigger an unnecessary preview refresh after
  GUI edits. The current image, viewport and selection are retained.
- IPAex `\bfseries` and `\textbf` use a synthetic stroke so Japanese bold
  remains visible without system fonts, including zone-heading styles.
- Rust path labels and coordinates on `-|` / `|-` now follow TikZ's position
  timing: `pos=0.5` is the corner, and `pos=0.25` / `0.75` are the midpoints
  of each leg, independent of leg lengths. This restores the feedback label
  placement in `notebook/test-jp.tikz`; sloped labels use the active leg's tangent.
- Rust text layout no longer emits a visible leading space for source newlines
  and indentation following `\\` or `\\[length]`. Explicit spacing commands
  remain intact. Regression tests cover mixed-width labels, nested font groups,
  alignment modes, source whitespace and SVG/PNG equivalence.
- Fixed native bare-color fills, postfix path-label defaults, relative Bezier
  destination controls, fixed-width label alignment and Japanese punctuation
  layout; added bounded synthetic regressions for Desktop-discovered syntax.
- Native Rust CI smoke tests use the existing `tests/fixtures/test.tikz` for
  SVG and PNG export instead of the missing `example.tikz`.

## [0.3.3] - 2026-07-27

### Fixed

- VSCode extension canvas: unnatural space before ASCII characters that
  directly follow a CJK run in node text (e.g. `…を1対1で…` rendered with a
  ~2.4-character gap before the `1`). The compute worker's MathJax lite
  adaptor estimated fallback CJK glyphs at 1em each while the SVG output
  renders them at an x-height-matched 0.884em, and the overestimate
  accumulated across the run. The worker runtime now measures fallback text
  with OffscreenCanvas when available and otherwise scales the estimate to
  the emitted font-size (4th local patch in `tikzc-editor/UPSTREAM.md`;
  regression test `tests/mathjax-cjk-fallback-width.test.ts`).

## [0.3.2] - 2026-07-27

### Added

- VSCode extension: hand (pan) tool in the canvas toolbar. A hand-icon button
  (shortcut `H`) next to Magnify switches left-drag to panning, with grab /
  grabbing cursors. Injected at build time via `panToolPlugin()` in
  `vite.config.ts` (exact-string patches on the vendored editor, loud build
  failure if upstream drifts); the vendored sources stay unmodified. Starting
  any drag-pan (hand tool, middle-drag, Alt+drag) now also exits
  fit-to-content mode so the panned viewport no longer snaps back to the
  fitted position on the next recompute.

### Changed

- VSCode extension build: re-enabled the compute Web Worker in the VSIX
  bundle, reverting the 0.3.1 stub. The standalone editor's behavior is the
  source of truth, so the extension accepts the larger bundle (worker chunks
  duplicate the core + MathJax + fonts graph) in exchange for non-blocking
  recomputes (IME, textarea, and canvas interaction stay responsive during a
  full recompute). The webview CSP already allowed `worker-src`, and the
  inline main-thread fallback still applies if the worker fails to start.

## [0.3.1] - 2026-07-27

### Changed

- VSCode extension build: the compute Web Worker introduced in 0.3.0 is
  disabled in the VSIX bundle. Bundling `compute.worker.ts` duplicated the
  core + MathJax + fonts graph into the worker bundle (~12 MB, ~60 extra
  chunks). The build now stubs the worker construction so
  `computeSnapshotPreferWorker()` takes its existing inline (main-thread)
  fallback — the pre-0.3.0 status quo for the extension. The stub plugin fails
  the build loudly if the upstream worker construction code changes, and the
  standalone (non-VSIX) editor keeps using the worker.

## [0.3.0] - 2026-07-27

### Changed

- VSCode extension WYSIWYG editor: canvas text editing no longer feels sluggish
  with Japanese (IME) input. Three scheduling/architecture changes, no feature
  changes:
  - While an IME composition is in progress, preview recomputes are suppressed
    entirely (intermediate states like `に` → `にほ` → `日本` never reach the
    render pipeline) and the committed text flushes immediately on
    composition end. Non-IME canvas text typing is debounced (120ms, 220ms for
    documents over 80k chars) like source-panel typing, instead of recomputing
    on every keystroke. Caret and selection overlays stay immediate — only the
    canvas glyph refresh waits for the debounce.
  - Canvas text edits now take the incremental compute path (new `edit-text`
    trigger reusing the drag machinery: incremental parse + selective semantic
    replay + SVG subtree reuse), so a keystroke re-evaluates the changed node
    and its dependents instead of the whole document. All existing full-compute
    fallbacks (structure change, opaque dependencies, parse errors) apply.
  - The whole compute pipeline (parse → semantic → MathJax measure → SVG emit)
    moved into a Web Worker (`compute.worker.ts`), so even a full recompute no
    longer blocks the IME, textarea, or canvas interaction. The native lualatex
    text fallback is bridged worker → page → extension host, profiling timings
    are forwarded to the page, and the client transparently falls back to
    inline (main-thread) compute if the worker cannot start or dies.
    Known cosmetic limitation: snapshots that crossed the worker boundary carry
    no Lezer tree (not structured-clone safe) — the named-color swatches
    re-parse lazily instead, and DevPanel's syntax-tree view is empty for
    worker-computed snapshots.

## [0.2.2] - 2026-07-23

### Fixed

- VSCode extension WYSIWYG editor: PNG / SVG / PDF export failed ("Failed to
  decode SVG for PNG export.") for figures whose node text contains `<` or `>`
  (e.g. `notebook/test-jp.tikz` with `$d_i<\lambda_{\mathrm{obs}}$`). MathJax's
  LiteParser serializes fragments in HTML mode, where attribute values only
  escape `&` and `"`, so the `data-latex` attribute kept a raw `<` and the
  serialized export document was ill-formed XML — the live canvas still
  rendered because the HTML parser tolerates it. The webview engine wrapper now
  escapes `<`/`>` inside attribute values of MathJax fragment markup at the
  payload boundary (`webview/node-text-fallback/mathjax-xml-safe.ts`).

## [0.2.1] - 2026-07-23

### Fixed

- VSCode extension WYSIWYG editor: PNG / SVG export failed ("Failed to decode
  SVG for PNG export.") for figures using the native lualatex text fallback
  (e.g. `sandbox/nat.tikz` with fontawesome icons and CJK text). dvisvgm
  fragments reference glyphs via `xlink:href`, but the editor's root `<svg>`
  declares only the default namespace, so the serialized export document was
  ill-formed XML (unbound `xlink:` prefix) — the live canvas still rendered
  because the HTML parser is namespace-lenient. Fragment post-processing now
  rewrites `xlink:href` to the SVG2 `href`.

## [0.2.0] - 2026-07-23

### Added

- VSCode extension WYSIWYG editor: native text fallback — node text the
  embedded editor's MathJax engine cannot render (e.g. `\faGlobe` with
  `#| packages: [fontawesome]`) is now compiled by lualatex on the extension
  host (`latex.compileSnippet` RPC) and embedded into the canvas as an SVG
  fragment, so the canvas shows the same glyphs the tikzc CLI produces while
  keeping full WYSIWYG interaction. Snippets are compiled at the engine's
  base font size, cached on both sides (with failure TTL and in-flight
  de-duplication), and recolored via `currentColor` so `text=` node colors
  apply.
- `buildSnippetTex()` / `compileSnippetToSvg()` / `parseSnippetMetrics()` in
  `src/core.ts`: standalone snippet compilation with exact TeX box metrics
  (`\wd`/`\ht`/`\dp` written to a metrics file) and a papersize-bbox dvisvgm
  run so the SVG viewBox matches the TeX box and the baseline is exact.

## [0.1.3] - 2026-07-14

### Added

- `tikzc -V` / `tikzc --version` flag that prints the CLI version and exits.

### Fixed

- VSCode extension WYSIWYG editor: the `auto` option (e.g. set globally on the
  `tikzpicture`) no longer overrides an explicit placement key
  (`above`, `below`, `below=15pt`, `anchor=`, ...) on path nodes. Real TikZ
  applies `auto` only while the anchor is unset, so edge labels such as
  `node[midway, below=15pt] {...}` inside an `[auto]` picture rendered on the
  wrong side of the line in the editor while the lualatex SVG/PNG export
  placed them correctly.

## [0.1.2] - 2026-07-14

### Fixed

- VSCode extension embedded editor preview (`latex.compile`): the exporter's
  `dvisvgm` class option on `\documentclass` is now stripped before
  compiling, since tikzc's lualatex → dvisvgm pipeline treats that mismatch
  as fatal (`Backend request inconsistent with engine`).
- VSCode extension embedded editor preview: the `#|` header (`packages`,
  `libraries`, `mainfont`) is now merged into the standalone document the
  editor exports, so e.g. `#| packages: [fontawesome]` icons render in the
  live preview instead of failing with "Undefined control sequence".
- `buildTex()` (and the extension preview) now rewrite the common
  `below right={0.55cm and 1.3cm} of foo` misspelling of the
  `positioning` library's two-distance syntax to the canonical unbraced
  `below right=0.55cm and 1.3cm of foo`, avoiding a
  `"Unknown operator a' or an'"` failure from the PGF math parser.

## [0.1.1] - 2026-07-13

### Added

- GitHub Actions workflow to manually create release tags
  (`manually-create-release-tag.yml`).
- Marketplace `keywords` (`tikz`, `latex`, `svg`, `png`, `diagram`) for the
  VSCode extension.

### Changed

- Extension Marketplace `categories` narrowed to valid values
  (`Visualization`, `Programming Languages`).
- `docs/PUBLISH.md`: replaced the hard-coded publisher ID with a
  `<your-id>` placeholder.

## [0.1.0] - 2026-07-10

Initial release.

### Added

- `tikzc` CLI that compiles `.tikz` files to SVG / PNG via
  `lualatex` → `dvisvgm` / `pdftoppm`, with `-f svg|png|both`, `--dpi`,
  `-o` output directory, and `--watch` mode.
- `#|` header options in `.tikz` sources (`packages`, `libraries`, `scale`,
  `mainfont`), taking precedence over CLI flags and VSCode settings; bare TikZ
  code without `\begin{tikzpicture}` is wrapped automatically.
- Japanese (CJK) label support through lualatex + fontspec
  (default font: `IPAexMincho`).
- VSCode extension `tikzc-preview`: WYSIWYG TikZ editor embedding the vendored
  [tikz-editor](https://github.com/DominikPeters/tikz-editor) (MIT) in a
  webview, with instant canvas preview, two-way sync with the `.tikz` text
  buffer, and single-document mode.
- Extension commands `TikZ: Export as SVG` / `TikZ: Export as PNG` using the
  accurate lualatex pipeline, plus settings `tikzc.mainfont`,
  `tikzc.extraPackages`, `tikzc.extraLibraries`, and `tikzc.pngDpi`.
- Docs: manual (EN / JP), branch strategy, commit rules, testing guide, and
  versioning policy.

[Unreleased]: https://github.com/RyoNakagami/tikzc/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/RyoNakagami/tikzc/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/RyoNakagami/tikzc/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/RyoNakagami/tikzc/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/RyoNakagami/tikzc/compare/v0.3.3...v1.0.0
[0.3.3]: https://github.com/RyoNakagami/tikzc/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/RyoNakagami/tikzc/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/RyoNakagami/tikzc/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/RyoNakagami/tikzc/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/RyoNakagami/tikzc/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/RyoNakagami/tikzc/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/RyoNakagami/tikzc/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/RyoNakagami/tikzc/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/RyoNakagami/tikzc/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/RyoNakagami/tikzc/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/RyoNakagami/tikzc/releases/tag/v0.1.0
