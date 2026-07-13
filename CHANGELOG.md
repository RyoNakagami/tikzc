# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/RyoNakagami/tikzc/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/RyoNakagami/tikzc/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/RyoNakagami/tikzc/releases/tag/v0.1.0
