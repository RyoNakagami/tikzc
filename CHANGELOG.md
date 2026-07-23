# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/RyoNakagami/tikzc/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/RyoNakagami/tikzc/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/RyoNakagami/tikzc/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/RyoNakagami/tikzc/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/RyoNakagami/tikzc/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/RyoNakagami/tikzc/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/RyoNakagami/tikzc/releases/tag/v0.1.0
