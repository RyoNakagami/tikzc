# ARCHITECTURE — Design Principles (Constitution)

This document defines the **non-negotiable design principles** of the tikzc
project. Every implementation decision, refactoring, and build-configuration
change must comply with it. If a change would violate one of these principles,
first propose an amendment to this document and get it agreed upon before
making the change.

## Article 1 — Documented native diagram semantics define rendering

- tikzc is a fast, Rust-native renderer for a documented practical subset of
  TikZ. Native output follows the supported diagram semantics, without promising
  arbitrary TeX execution or pixel-identical lualatex typesetting.
- The supported subset is the one written in
  [RUST_ENGINE.md](RUST_ENGINE.md#native-compatibility-contract) and fixed by
  tests. Successful generation alone is not proof of compatibility.
- TeX reference images are comparison material, not pixel parity gates.

## Article 2 — One renderer, one artifact

- The Rust engine is the only renderer. The CLI, the VSCode preview and the
  SVG/PNG export all use it; there is no second implementation to keep in step.
- Preview and export share one compilation artifact, so what is previewed is
  what is exported. PNG is produced from that same SVG.
- Text is laid out by the engine and emitted as paths. The webview displays
  the artifact as an image and must not remeasure or re-lay-out text.
- The extension runs the `tikzc` executable installed on the machine (PATH or
  `tikzc.nativePath`); the VSIX does not contain it. A version mismatch is
  reported to the user.

## Article 3 — Fully local, offline operation

- Rendering requires no TeX Live, Poppler, Node.js or network at runtime.
  Fonts needed for the default output are embedded in the executable.
- The webview must not reference external resources such as CDNs. Everything
  it needs is bundled into the VSIX.
- Subprocesses of external toolchains, remote services and arbitrary file
  reads from diagram sources must not be introduced into the renderer.

## Article 4 — No silent degradation

- There is no fallback renderer. Unsupported or invalid input produces an
  explicit diagnostic with its source position; it is never skipped silently
  when skipping would change the meaning of the diagram.
- A failed run must not replace existing output files.
- Canvas edits in the extension are compiled and validated before they are
  applied to the source; an invalid edit leaves source and canvas intact.
- Known approximations and limitations must be documented in
  [RUST_ENGINE.md](RUST_ENGINE.md) and in the CHANGELOG.

## Amendment procedure

- Changes to this document must be made in a dedicated commit, with the
  reason for the amendment stated in the commit message.
- For the history behind each article (versions, symptoms), refer to the
  corresponding entries in CHANGELOG.md.
- 1.0.0 removed the TypeScript / LuaLaTeX CLI and the vendored WYSIWYG editor.
  The articles that governed them (standalone-editor parity, the compute
  worker, the lualatex text fallback) were removed with them.
