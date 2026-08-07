# Testing

There are two unit-test suites in this repository:

| Suite | Location | Needs the TeX toolchain? |
| --- | --- | --- |
| CLI core (pure logic + CLI flags) | [`tests/`](../tests) | No |
| VSCode extension | [`vscode-extension/tests/`](../vscode-extension/tests) | Yes (compile tests skip if missing) |

Unit tests for `tikzc` live in the [`tests/`](../tests) directory. They cover
the **pure** source-parsing and TeX-assembly logic in
[`src/core.ts`](../src/core.ts) — the functions that transform a `.tikz` source
into a standalone LaTeX document — plus the early-exit flags of the CLI
entrypoint ([`src/cli.ts`](../src/cli.ts)). These tests do **not** shell out to
`lualatex`, `dvisvgm`, or `pdftoppm`, so they run in about a second and require
no LaTeX toolchain installed.

The VSCode extension suite (section 3) complements this: it exercises the
**real compile pipeline** (`compileTikz`, `compileTexToSvg`,
`compileSnippetToSvg`), the MathJax SVG rendering used by the webview canvas,
and the native text-fallback pipeline behind the `latex.compileSnippet` RPC.

## 1. Running the tests

Install dependencies once:

```sh
npm install
```

Run the test suite:

```sh
npm test
```

This runs `tsx --test tests/*.test.ts`, which uses the built-in
[`node:test`](https://nodejs.org/api/test.html) runner via
[`tsx`](https://github.com/privatenumber/tsx) (so the TypeScript tests run
directly, with no build step). A passing run ends with:

```
# tests 47
# pass 47
# fail 0
```

### Type-checking

The tests are also type-checked as part of the project's type check
(`tests/**/*.ts` is included in [`tsconfig.json`](../tsconfig.json)):

```sh
npm run check
```

### Running a single test file

```sh
npx tsx --test tests/core.test.ts
```

## 2. What is tested

### [`core.test.ts`](../tests/core.test.ts) — pure functions from `src/core.ts`

#### `parseList` — parse a list option

Turns a `"[a, b, c]"` or `"a, b"` string into a `string[]`.

- `undefined`, `""`, whitespace-only, and `"[]"` all yield `[]`
- Bracketed lists (`[circuitikz, pgfplots]`)
- Bare comma-separated lists (`arrows.meta, calc`)
- Whitespace is trimmed and surrounding quotes are stripped (`[ "a" , "b" ]`)
- Empty entries from trailing/duplicate commas are dropped (`a,,b,`)
- Single-element input, with and without brackets

#### `parseSource` — split `#|` header options from the body

Parses `#| key: value` header lines at the top of the source.

- No header → empty `opts`, body returned verbatim
- Extracts multiple header options (`scale`, `mainfont`, …)
- Header parsing **stops at the first non-header line**; a `#|` line appearing
  after body content is treated as body, not an option
- Tolerates surrounding whitespace in header lines
- Keys may contain hyphens and word characters (`some-key`)

#### `buildTex` — assemble the standalone LaTeX document

Builds the full `.tex` document from a source and optional defaults.

- Bare content is wrapped in a `tikzpicture` environment
- Existing `\begin{tikzpicture}` is **not** double-wrapped
- Emits the expected preamble: `\documentclass[border=2pt]{standalone}`,
  `fontspec`, `tikz`, `\begin{document}` / `\end{document}`
- Emits the default packages and the default libraries as a single
  `\usetikzlibrary{...}` line
- **Font resolution / override precedence** — header option > `defaults.mainfont`
  argument > built-in `DEFAULT_MAINFONT`
- `scale` wraps the content in `\scalebox{...}{...}`; no `\scalebox` when
  `scale` is absent
- **Package / library merging** — defaults, the `defaults` argument, and header
  options are merged and de-duplicated; merge order is
  defaults → `defaults` argument → header

#### `injectStandalonePreamble` — patch a full document's preamble

For sources that are already complete `\documentclass{standalone}` documents:

- Header packages / libraries / `mainfont` are injected before
  `\begin{document}`
- Defaults apply when the source has no header; the header `mainfont` beats
  the `defaults` argument
- Packages repeated between header and defaults are de-duplicated
- A document without `\begin{document}` is returned unchanged

#### `stripDvisvgmClassOption` — sanitize document class options

- Removes `dvisvgm` from the class option list while keeping the others
- Drops the whole option group when `dvisvgm` is the only option
- Leaves documents without the option untouched

#### `normalizePositioningAnd` — unbrace `positioning` distance pairs

Rewrites `below={1cm and 2cm} of x`-style keys to the canonical unbraced
syntax accepted by the `positioning` library.

- All four diagonal keys (`below left`, `above right`, …) are rewritten, at
  every occurrence in a full picture
- Whitespace around `=`, the braces, and `of` is tolerated
- Already-canonical syntax, fully braced values including `of`, braced single
  distances (no `and`), and braces containing commas are left untouched

### [`cli.test.ts`](../tests/cli.test.ts) — the `tikzc` CLI entrypoint

Runs [`src/cli.ts`](../src/cli.ts) as a subprocess via `tsx`. Only the flags
that exit **before** compilation are covered here; the compile pipeline itself
is exercised by the extension suite (section 3).

- `--version` / `-V` print `tikzc <version>` from `package.json` and exit 0
- The printed version matches the canonical [`VERSION`](../VERSION) file
  (the source of truth for `bump-version.sh`)
- `--version` wins over an input file (no compile is attempted)
- `--help` documents the version flags

## 3. VSCode extension tests

The extension has its own suite in
[`vscode-extension/tests/`](../vscode-extension/tests), run from the
`vscode-extension/` directory:

```sh
cd vscode-extension
npm install   # once
npm test      # tsx --test tests/*.test.ts
```

A passing run ends with:

```text
# tests 60
# pass 60
# fail 0
```

### Prerequisites and skip behavior

The compile tests — all of [`compile.test.ts`](../vscode-extension/tests/compile.test.ts)
and the `compileSnippetToSvg` tests in
[`snippet.test.ts`](../vscode-extension/tests/snippet.test.ts) — invoke the
real toolchain (`lualatex`, `dvisvgm`, `pdftoppm`) and render Japanese labels
with the `IPAexMincho` font (see the README's Requirements section). When any
of these binaries is missing, they **skip** (reported as `skipped`, not
`fail`), so the suite still passes on machines without TeX. Every other test
file runs everywhere with no external tools.

### What is tested

#### Compile pipeline (real toolchain)

[`compile.test.ts`](../vscode-extension/tests/compile.test.ts) — the pipeline
behind the `tikzc.exportSvg` / `tikzc.exportPng` commands and the webview's
`latex.compile` RPC:

- **Japanese input** — `buildTex` keeps CJK text and sets
  `fontspec` + `IPAexMincho`; a diagram with Japanese labels compiles to SVG
  with glyphs embedded as paths (`dvisvgm --no-fonts`)
- **SVG output** — `compileTikz({formats: ["svg"]})` returns an SVG document
  and no PNG
- **PNG output** — `compileTikz({formats: ["png"]})` returns a buffer starting
  with the PNG signature and no SVG
- **No errors** — a valid document leaves no `!` error lines in the LaTeX log;
  a broken document is reported as a `TikzCompileError` with the log attached

#### MathJax canvas rendering

[`mathjax.test.ts`](../vscode-extension/tests/mathjax.test.ts) — MathJax SVG
rendering with the same configuration the webview canvas uses
(`createMathJaxConfig` in the vendored tikz-editor, minus the Knuth–Plass
linebreak visitor):

- Display and inline TeX formulas render to `<svg>` with `<path>` glyphs
- Lazily-loaded font subsets resolve (`\mathbb` → double-struck)
- Japanese text falls back to `<text>` elements without an error node
- An undefined macro is surfaced as an "Undefined control sequence" error

[`mathjax-cjk-fallback-width.test.ts`](../vscode-extension/tests/mathjax-cjk-fallback-width.test.ts)
— regression test for the phantom gap that appeared after CJK runs in canvas
node text. The worker runtime's lite adaptor used to estimate fallback CJK
characters at 1em each, while MathJax emits the fallback `<text>` at an
x-height-matched font-size (0.884em for newcm); the per-character overestimate
accumulated and pushed the next in-font glyph (e.g. the "1" in "…を1対1で…")
too far right. The test forces the worker runtime (`self === globalThis`, no
DOM), measures a real CJK node text through
`createMathJaxNodeTextEngine`, and asserts the first in-font glyph after the
CJK run starts exactly where the rendered run ends — and that the old
1em-per-char estimate does not come back. The fix lives in
`installWorkerFallbackTextMeasurement` in
[`mathjax-engine.ts`](../vscode-extension/tikzc-editor/packages/core/src/text/mathjax-engine.ts).

[`mathjax-xml-safe.test.ts`](../vscode-extension/tests/mathjax-xml-safe.test.ts)
— unit tests for `webview/node-text-fallback/mathjax-xml-safe.ts`, which
re-escapes MathJax LiteParser HTML-mode output (attribute values keep raw
`<`/`>`) into strict XML:

- `<` / `>` inside attribute values are escaped; tag structure and text
  content are unchanged
- Idempotent (safe to apply twice); handles single-quoted attributes, mixed
  quotes, and comments
- The escaped fragment parses as strict XML

#### Native text fallback (`latex.compileSnippet`)

[`snippet.test.ts`](../vscode-extension/tests/snippet.test.ts) — the node-text
snippet pipeline in [`src/core.ts`](../src/core.ts) behind the webview
`latex.compileSnippet` RPC (native fallback for node text MathJax cannot
render, e.g. `\faGlobe`):

- `buildSnippetTex` — `#|` header packages / `mainfont` reach the preamble;
  defaults and `DEFAULT_MAINFONT` apply without a header; emits the
  `TIKZC-METRICS` `\write` and the snippet body; nests
  `\textsf`/`\textbf`/`\textit` for family/weight/style (`monospace` →
  `\texttt`); `widthBp` wraps in `\parbox[t]` with the alignment command;
  math mode wraps in `$...$`
- `parseSnippetMetrics` — reads `wd`/`ht`/`dp` from the `TIKZC-METRICS` log
  line; returns `null` on malformed input
- `compileSnippetToSvg` — **real toolchain, skips without TeX**: plain text
  yields SVG with positive metrics; `\faGlobe` compiles with a `fontawesome`
  header; invalid TeX fails with `TikzCompileError`

[`snippet-service.test.ts`](../vscode-extension/tests/snippet-service.test.ts)
— `SnippetService` ([`src/snippet-service.ts`](../vscode-extension/src/snippet-service.ts)),
the extension-host side of the RPC, with an injected mock compiler:

- Successful results are cached (second request compiles nothing); TeX pt
  dimensions are converted to bp
- LaTeX errors are failure-cached; transient errors (timeouts) are **not**
  cached and can be retried
- Concurrent requests for the same snippet share one in-flight compile;
  different snippets compile serially, one at a time
- `header` / `defaults` participate in the cache key; an empty request header
  falls back to `fallbackHeader`

[`native-compiler.test.ts`](../vscode-extension/tests/native-compiler.test.ts)
— the webview-side state machine
(`webview/node-text-fallback/native-compiler.ts`) with a mock compiler:

- `extractTikzHeader` picks up only the leading `#|` lines
- Basic uncompiled → pending → done transition; font sizes are scaled and the
  cache key is size-independent; `textWidthPt` is normalized by font size
- LaTeX failures are cached (not re-queued) and readable via
  `failureMessageFor`; an RPC-level failure marks all queued entries as
  transient failures
- Stale entries not re-requested in the current pass are discarded at flush
  (mid-typing states never compile); with no compiler injected nothing is
  queued
- A changed `#|` header changes the key and triggers recompilation

[`svg-postprocess.test.ts`](../vscode-extension/tests/svg-postprocess.test.ts)
— `toSnippetRenderPayload` (`webview/node-text-fallback/svg-postprocess.ts`)
over a fixture mirroring real dvisvgm 3.x output:

- `viewBox` and body are extracted; broken / viewBox-less SVG yields `null`
- `id`s and their `xlink:href` / `url(#...)` references are renamed with a
  cacheKey-specific prefix, so fragments from different snippets don't collide
- `xlink:href` is rewritten to SVG2 `href` (avoids unbound-prefix errors in
  exported SVG)
- The fragment is wrapped in a `fill="currentColor"` group and explicit black
  fills are replaced, so node text inherits the canvas color

### Type-checking the extension tests

The extension's `npm run check` type-checks the tests via
[`tests/tsconfig.json`](../vscode-extension/tests/tsconfig.json), in addition
to the extension host and webview configs:

```sh
cd vscode-extension
npm run check
```

### Running a single extension test file

```sh
cd vscode-extension
npx tsx --test tests/mathjax.test.ts
```
