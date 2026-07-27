# ARCHITECTURE — Design Principles (Constitution)

This document defines the **non-negotiable design principles** of the tikzc
project. Every implementation decision, refactoring, and build-configuration
change must comply with it. If a change would violate one of these principles,
first propose an amendment to this document and get it agreed upon before
making the change.

## Article 1 — The tikzc CLI (lualatex → dvisvgm) is the source of truth for rendering

- The "correct appearance" of a `.tikz` source is defined by the tikzc CLI's
  compilation output (lualatex → dvisvgm / pdftoppm).
- The canvas view of the VSCode extension's WYSIWYG editor (vendored
  tikz-editor) is only an approximate preview; whenever it disagrees with the
  CLI output, the CLI is correct.
- When a `.tikz` file cannot be displayed by the editor, that discrepancy
  **must not be ignored**. Either adjust the `.tikz` source (without changing
  the CLI output) so the editor can display it, or absorb the difference
  through a fallback (Article 5).

## Article 2 — The standalone editor's behavior is the source of truth for the extension

- The VSCode extension must have **the same runtime behavior** as the
  standalone build of the vendored tikz-editor. Dropping features or changing
  execution paths only in the extension is forbidden in principle.
- Bundle size is never a reason to change behavior. Even if the worker chunks
  duplicate the core + MathJax + fonts graph and inflate the VSIX, that cost
  is accepted (lesson of 0.3.1 → 0.3.2, see Article 3).
- The only permitted exception is build-time stubbing of features that are
  **structurally invisible or meaningless** in the VSCode environment (e.g.
  SourcePanel — the VSCode text editor is the source view, TabStrip —
  single-document mode, pptx/ipe import — new documents cannot be created).
  "It is heavy" or "it is probably unused" is not a justification.

## Article 3 — Disabling the compute worker is not allowed

- The compute pipeline (parse → semantic → MathJax measure → SVG emit) runs
  in a Web Worker (`compute.worker.ts`). **Disabling it at build time and
  dropping to the main-thread fallback is not allowed for any reason.**
- Rationale: in 0.3.1 the worker was stubbed out to reduce VSIX size, and the
  Japanese (IME) input lag / sluggishness came back. Input responsiveness
  takes priority over size. The worker was re-enabled in 0.3.2 and this
  principle was settled then.
- Inline (main-thread) compute is permitted **only as the automatic runtime
  fallback when the worker fails to start** (the existing contract of
  `computeSnapshotPreferWorker()`). Any change that makes the fallback the
  default path violates this article.
- The IME-aware scheduling (suppressing recomputes during composition,
  debouncing canvas text input, the edit-text incremental compute path) is
  equally protected: new features must not bypass or disable it.

## Article 4 — Fully local, offline operation

- The webview must not reference external resources such as CDNs (the CSP
  blocks them anyway). Everything, including the MathJax runtime and fonts,
  is bundled into the VSIX.
- Node text the editor's MathJax cannot render (CJK text, fontawesome, etc.)
  is covered by the native text fallback: lualatex on the extension host.
  This design depends on the **local TeX environment**, not the network;
  replacing it with an external service is not allowed.

## Article 5 — Degradation only as a fallback, and only explicitly

- Fallbacks (worker → inline compute, MathJax → native lualatex, lazy
  re-parse when the Lezer tree is missing at the worker boundary, etc.) exist
  so the system can **degrade at runtime when unavoidable**; they must never
  become the default execution path.
- Known degradations and cosmetic limitations (e.g. snapshots that crossed
  the worker boundary carry no Lezer tree) must be documented in code
  comments and in the CHANGELOG. Silently degrading behavior is not allowed.

## Amendment procedure

- Changes to this document must be made in a dedicated commit, with the
  reason for the amendment stated in the commit message.
- For the history behind each article (versions, symptoms), refer to the
  corresponding entries in CHANGELOG.md.
