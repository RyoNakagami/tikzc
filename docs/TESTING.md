# Testing

There are two unit-test suites in this repository:

| Suite | Location | Needs the TeX toolchain? |
| --- | --- | --- |
| CLI core (pure logic) | [`tests/`](../tests) | No |
| VSCode extension | [`vscode-extension/tests/`](../vscode-extension/tests) | Yes (compile tests skip if missing) |

Unit tests for `tikzc` live in the [`tests/`](../tests) directory. They cover
the **pure** source-parsing and TeX-assembly logic in
[`src/core.ts`](../src/core.ts) — the functions that transform a `.tikz` source
into a standalone LaTeX document. These tests do **not** shell out to
`lualatex`, `dvisvgm`, or `pdftoppm`, so they run in milliseconds and require no
LaTeX toolchain installed.

The VSCode extension suite (section 3) complements this: it exercises the
**real compile pipeline** (`compileTikz`, `compileTexToSvg`) and the MathJax
SVG rendering used by the webview canvas.

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
# tests 22
# pass 22
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

All tests target the pure functions exported from
[`src/core.ts`](../src/core.ts). The compile pipeline
(`compileTikz`, `compileTexToSvg`), which invokes external binaries, is covered
by the VSCode extension suite instead (section 3).

### `parseList` — parse a list option

Turns a `"[a, b, c]"` or `"a, b"` string into a `string[]`.

- `undefined`, `""`, whitespace-only, and `"[]"` all yield `[]`
- Bracketed lists (`[circuitikz, pgfplots]`)
- Bare comma-separated lists (`arrows.meta, calc`)
- Whitespace is trimmed and surrounding quotes are stripped (`[ "a" , "b" ]`)
- Empty entries from trailing/duplicate commas are dropped (`a,,b,`)
- Single-element input, with and without brackets

### `parseSource` — split `#|` header options from the body

Parses `#| key: value` header lines at the top of the source.

- No header → empty `opts`, body returned verbatim
- Extracts multiple header options (`scale`, `mainfont`, …)
- Header parsing **stops at the first non-header line**; a `#|` line appearing
  after body content is treated as body, not an option
- Tolerates surrounding whitespace in header lines
- Keys may contain hyphens and word characters (`some-key`)

### `buildTex` — assemble the standalone LaTeX document

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
# tests 11
# pass 11
# fail 0
```

### Prerequisites and skip behavior

The compile tests invoke the real toolchain — `lualatex`, `dvisvgm`,
`pdftoppm` — and render Japanese labels with the `IPAexMincho` font (see the
README's Requirements section). When any of these binaries is missing, the
compile tests **skip** (reported as `skipped`, not `fail`), so the suite still
passes on machines without TeX. The MathJax tests run everywhere; they need no
external tools.

### What is tested

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

[`mathjax.test.ts`](../vscode-extension/tests/mathjax.test.ts) — MathJax SVG
rendering with the same configuration the webview canvas uses
(`createMathJaxConfig` in the vendored tikz-editor, minus the Knuth–Plass
linebreak visitor):

- Display and inline TeX formulas render to `<svg>` with `<path>` glyphs
- Lazily-loaded font subsets resolve (`\mathbb` → double-struck)
- Japanese text falls back to `<text>` elements without an error node
- An undefined macro is surfaced as an "Undefined control sequence" error

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
