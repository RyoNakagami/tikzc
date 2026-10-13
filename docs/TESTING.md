# Testing

## Overview

| Suite | Location | Command | Needs |
| --- | --- | --- | --- |
| Rust renderer and CLI | [`tests/*.rs`](../tests), unit tests in `src/` | `cargo test --locked` | Rust only |
| Development tools | [`tests/devtools/`](../tests/devtools) | `npm test` (repository root) | Node.js; `rg` for the corpus comparison tests |
| Extension preview, export and canvas editing | [`vscode-extension/tests/`](../vscode-extension/tests) | `npm test` (in `vscode-extension/`) | Built Rust binary |

No suite needs a TeX installation.

The full local sequence, from the repository root:

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --release --locked

npm ci && npm run check && npm test
npm --prefix vscode-extension ci
npm --prefix vscode-extension run check
npm --prefix vscode-extension test
```

The `Native Rust renderer` workflow
([`native-rust.yml`](../.github/workflows/native-rust.yml)) runs the Rust
checks, SVG/PNG CLI smoke tests using `tests/fixtures/test.tikz`, the version
check, and the extension's `check` and `test:native` on Linux, macOS and Windows,
and packages one platform-independent VSIX. It is
started manually (`workflow_dispatch`); it does not run the root `npm test`,
so run that locally.

## Rust-native tests

### Version synchronization

`devtools/bump-version.sh --check` checks `VERSION` against the Rust manifest,
the local Cargo lock entry, and both npm manifests/lockfiles without modifying
them. Run `npm test` at the repository root for `tests/devtools/bump-version.test.ts`:
it uses temporary copies to cover npm/Cargo updates, dependency preservation,
version mismatches, malformed inputs, prereleases, formatting, and repeated bumps.
The test runner is `tsx` (TypeScript on Node.js).

`cargo test --locked --test version` checks that the compiled native CLI's
`--version` and `-V` outputs match Cargo metadata and `VERSION`.
After bumping, rebuild with `cargo build --release --locked` before inspecting
`target/release/tikzc --version`.

### SVG size optimization

`tests/svg_optimization.rs` checks cross-label glyph sharing,
unique IDs, valid references, matrix measurement rollback, deterministic
notebook output, default attribute omission, and inherited paint from an
embedding parent. Unit tests in `render/label_svg.rs` cover conflicting IDs,
non-glyph references and rollback; `render/glyph_path.rs` covers strict SVG
number/command parsing, arc flags, exponents, adjacent numbers and invalid data.
Only self-contained `symbol` definitions with a `g` + 32-hex-digit ID are
shared/rounded. Shorter or unexpected IDs remain label-local; definitions with
inherited styling or unfamiliar content are preserved rather than moved.

Keep `tests/visual.rs` at its existing 0.1% tolerance (channel difference > 8).
Do not regenerate goldens to accept an unexplained difference. For a size audit,
retain baseline SVG/PNG, then render the same `notebook/*.tikz` at each phase
using `target/release/tikzc INPUT -f both --dpi 150 -o OUTPUT`. Compare bytes
(report KiB = 1024 bytes), XML IDs/references and decoded RGBA pixels. Also
render baseline and optimized SVG with Chrome and `rsvg-convert` at the same
resolution; compare each renderer to its own baseline.

Inherited paint defaults are set on the root SVG; generated scope wrappers
only transform/clip and do not introduce inherited paint. The omitted values
follow [SVG painting defaults](https://www.w3.org/TR/SVG2/painting.html).
Rectangle `rx` is omitted only when zero and no `ry` is emitted; see
[SVG rectangle geometry](https://www.w3.org/TR/SVG2/shapes.html#RectElement).

New syntax and compatibility requests follow the [feature workflow](FEATURE_WORKFLOW.md).
It separates unsupported syntax, environment failures and visual differences, and defines
when a new feature can be marked supported.

Run the benchmark against a release build:

```sh
cargo run --locked --release --example benchmark -- target/release/tikzc
```

`tests/native.rs` renders all eight corpus fixtures without modifying
them, checks repeatable outlined SVG and nonblank PNG pixels/dimensions, checks
node/segment/arc geometry and diagnostics, and invokes the built CLI with an empty
PATH. It also checks that invalid inputs do not replace an existing output.
Japanese, math and icon rendering use only the embedded fonts.

`tests/expansion.rs` additionally checks ten syntax fixtures plus
`notebook/native-subset.tikz`. It verifies loop tuples/decimal ranges/nesting,
late-bound macro parameters and scope restoration, degree-based scalar math,
ordered/nested transforms, rotated anchors, transformed ellipse/arc geometry,
both arrow endpoints and shortening. Negative tests cover recursion, range
limits, malformed parameters, non-finite math and original-source diagnostics.

`tests/desktop.rs` adds synthetic regressions for unbraced loops,
count/empty fields, math/text/table conversion, plot control points, brace
orientation, fills, coordinate transforms, positioning, cylinder/diamond/grid,
labels/bar tips, relative Bezier controls and Japanese punctuation. It also
checks unsupported variants and nested-loop bounds. No private sources or
optional installed fonts are needed by these tests.

### Geometry and visual regression

`tests/precision.rs` checks measured baselines, fixed baseline skip
with mixed inline sizes, LM Mono advances, shape padding/outer separation,
affine anchors, curved shortening, clip scopes, matrix cells and pattern limits.
`curve.rs` tests cubic arc length and subdivision independently.

`path_positions.rs` checks label timing on `-|` / `|-` paths (the corner is
`pos=0.5`), including transforms, zero-length legs and sloped labels.
`text_weight.rs` checks IPAex synthetic bold in SVG and PNG, Japanese italic
and style restoration, Latin Modern Mono's italic face, and the IPAexGothic
fallback for Japanese typewriter text (including inside math). These tests
and the corpus/extension fixtures use bundled fonts, without requiring Noto
to be installed. `text_whitespace.rs` checks that source newlines and
indentation after `\\` do not change layout while ordinary and explicit
spaces remain. `interactive.rs` covers the metadata behind canvas editing:
reusable text caches and source ranges, insertion boundaries, `reset cm`
placement, PGF-layer ordering, and path edit points.

`tests/visual.rs` renders three synthetic fixtures at 150 DPI and
compares their **reviewed native** PNG baselines in `tests/visual-native/`.
Canvas size must match; at most 0.1% of pixels may differ by more than 8 channel
levels. This protects native behavior, not TeX image parity. Only embedded
fonts are used. Cross-platform tolerance has not yet been measured on all CI OSes.

To intentionally update after a reviewed layout change:

```sh
UPDATE_NATIVE_GOLDENS=1 cargo test --locked --test visual
# Visually inspect all three resulting PNGs.
cargo test --locked --test visual
```

Do not blindly regenerate to make a failing test pass. Source changes and image
changes should be reviewed together. The corpus comparison gallery remains opt-in and
private; it is not copied into these synthetic goldens.

### Opt-in local corpus comparison

`devtools/compare-desktop.mjs` renders a local set of diagrams with two `tikzc`
executables and builds a side-by-side gallery: a reference (`--reference`,
default `tikzc` on PATH) and the build under test (`--native`, default
`target/release/tikzc`). Use it to compare before and after a change.

```sh
# Keep a copy of the current build as the reference
cargo build --release --locked
cp target/release/tikzc target/tikzc-before

# After implementation changes
cargo build --release --locked
node devtools/compare-desktop.mjs --root /path/to/diagrams \
  --reference target/tikzc-before \
  --out target/desktop-comparison/after
# Later runs can reuse the reference results:
#   --reuse-reference target/desktop-comparison/after/results.json
```

The audit needs `rg` and Node. The default root is this user's Desktop; always
pass `--root` elsewhere. It excludes `.git`, `node_modules`, `target`,
deduplicates SHA-256-identical `.tikz` files and verifies originals are
unchanged. Both executables produce SVG and 150-DPI PNG under `target/` only.
The local JSON includes private source paths; keep it and the gallery out of
version control. A 30-second process-group timeout bounds each invocation.

Open `target/desktop-comparison/after/index.html` to compare paired images.
Canvas-dimension errors are not pixel or element-level correctness measures.
Single concurrent timings (and reused reference timings) are not benchmark claims.

The benchmark reports median wall time across five fresh CLI processes for each
output format (PNG at 150 DPI), plus a separate in-process breakdown. It does not
flush OS caches and is not a universal performance guarantee. Fonts and Typst's
World are reused among labels of a diagram, not across CLI process launches.

Inspect outputs manually as well; nonblank-pixel tests are not visual parity
tests. See [native compatibility](RUST_ENGINE.md).

### Shared source fixtures

`tests/fixtures/*.tikz` supplies inputs for the Rust tests, CLI smoke tests and
benchmark. Some `unsupported-*.tikz` names are historical: clip, matrix and
patterns are now partly supported. The unused Phase 0 lualatex reference images
and geometry JSON were removed with the TeX toolchain; visual regression uses
the reviewed, reproducible native baselines in `tests/visual-native/`.

## TypeScript tests

### Root: development tools

```sh
npm ci
npm run check    # type-check tests/**/*.ts
npm test         # tsx --test tests/devtools/*.test.ts
```

The root package holds development tooling only.
[`bump-version.test.ts`](../tests/devtools/bump-version.test.ts) is described under
[version synchronization](#version-synchronization).
[`compare-desktop.test.ts`](../tests/devtools/compare-desktop.test.ts) runs
`devtools/compare-desktop.mjs` from a temporary copy, on a temporary corpus,
with stand-in scripts in place of the two `tikzc` executables. It covers
deduplication and excluded directories, the report and gallery, failure
counts, the `target/`-only output rule, `--reuse-reference`, and the check that
inputs are unchanged. It does not build or run the real `tikzc`, and is skipped
on Windows or when `rg` is missing. The 30-second timeout is not exercised.
The runner is the built-in
[`node:test`](https://nodejs.org/api/test.html) through
[`tsx`](https://github.com/privatenumber/tsx), so there is no build step.

### VSCode extension

The extension preview and SVG/PNG exports run the Rust executable. Build the
release binary before extension tests (`cargo build --locked --release` or
`cd vscode-extension && npm run build:native`). Then, in `vscode-extension/`:

```sh
npm run check
npm test
```

`rust-renderer.test.ts` compares preview artifact bytes with the actual CLI's
SVG and PNG at 96, 150 and 300 DPI. The `mixed-alignment.tikz` fixture includes
Japanese, ASCII, full-width characters, half-width kana, math, multiline text,
and left/center/right alignment. It checks path-only text, font overrides,
diagnostics and failed-request recovery. Missing Rust binaries fail the suite.

`native-host.test.ts` runs the bundled host with a VSCode mock and checks that
preview and export receive the same unsaved source/settings and forward the same
artifact bytes. `native-webview.test.ts` runs the actual bundled webview script
with a DOM adapter and checks the unmodified SVG/PNG image blobs.
`native-editing.test.ts` checks the source edits behind canvas label editing
and drawing insertion.
`preview-queue.test.ts` covers edit coalescing, document-switch races, stale
success/error suppression and panel disposal. These are automated wiring tests,
not an Electron screenshot comparison. The cross-platform Rust CI runs them and
builds one platform-independent VSIX.

For real Chromium pointer and hit-testing coverage, run
`node scripts/test-native-browser.mjs` in `vscode-extension/` after
`cargo build` and `npm run build:ext`. It is opt-in and not part of `npm test`;
set `CHROME_BINARY` or `TIKZC_NATIVE_TEST_BINARY` to choose the browser or
renderer executable.

For manual acceptance, install the matching VSIX, open the mixed-alignment
fixture, use Ctrl+K V, toggle SVG/PNG, and export both. Check unsaved edits,
changing active files, changing `pngDpi`, errors and reopening the panel.
Geometry is shared; edge antialiasing at different zoom/DPI is not guaranteed
pixel-identical.

`npm run test:native` (used by CI) runs the same files as `npm test`. `npm run check`
type-checks the extension host, the webview script and the tests. To run one
file:

```sh
cd vscode-extension
npx tsx --test tests/preview-queue.test.ts
```
