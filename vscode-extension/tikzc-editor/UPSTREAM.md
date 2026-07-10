# vendored: tikz-editor

- Upstream: <https://github.com/DominikPeters/tikz-editor>
- Commit: `f9617fe024133fc59eae86ef906000d0b9ebc57a`
- License: MIT (see the bundled [LICENSE](LICENSE))
- Extracted scope: the `src/` and `package.json` of
  `packages/{core,app,lang-tikz,lezer-tikz}`, `packages/app/public/`
  (excluding the source-panel-only `docs/`), and the root `LICENSE` /
  `package.json` (for version reference).
  `apps/` / `test/` / `scripts/` / `design/` are not included because they are
  not needed to build the extension.

The code in this directory is unmodified (features unnecessary for the VSCode
build are swapped for stubs at build time by `vscode-extension/vite.config.ts`),
except for the local patches listed below — re-apply them when re-extracting:

- `packages/core/src/text/mathjax-engine.ts`: added `stripTexLineComments()`
  and call it in `normalizeMathJaxTextInput()`. Node text is sliced raw from
  the source, and the engine collapses newlines to spaces before handing the
  text to MathJax, so an unescaped `%` (e.g. the idiomatic `\node ... {%`)
  swallowed the entire node text as a TeX comment and the node rendered blank.
  Comments must be stripped (TeX-style: through the newline and the next
  line's leading whitespace, keeping `\%`) before the newline collapse.
  Candidate for an upstream PR.
- `packages/core/src/text/mathjax-engine.ts` (2nd patch): the worker runtime's
  `tex2svgPromise` now wraps the conversion in `mathjax.handleRetriesFor`
  instead of `Promise.resolve(...)`. The sync wrapper rethrows the "MathJax
  retry" error raised while a dynamic font subset is still loading, so the
  queued async re-render always failed, `flushPending()` reported no changed
  keys, and nodes needing a dynamic font stayed in the plain-text fallback
  until an unrelated re-layout. Candidate for an upstream PR.
- `packages/core/src/text/mathjax-engine.ts` (3rd patch):
  `splitExplicitMultilineSource()` now brace-balances each fragment. The
  explicit-multiline width measurement splits node text at every `\\`
  regardless of TeX group depth, so `{\footnotesize a\\b}` produced
  brace-unbalanced fragments and node-text validation reported
  "Missing close brace" errors for valid input (the canvas still rendered —
  only the diagnostics badge was wrong). Candidate for an upstream PR.
- `packages/app/src/ui/canvas-panel/{CanvasPanel.tsx,CanvasPanelView.tsx,canvas-text-edit-machine.ts}`:
  IME (Japanese input) support for canvas text editing. The edit textarea was
  a controlled component with no `onChange`: normal keys were intercepted via
  cancelable `beforeinput` intents, but IME composition `beforeinput` is
  non-cancelable, so React restored the stale controlled value on every
  `input` event and killed the composition — CJK input was impossible.
  Composition events now bypass the intent pipeline; a new
  `textarea_dom_sync` machine action mirrors the textarea DOM into the
  session from `onChange`/`onCompositionEnd`, and keydown ignores
  Enter/Escape while composing (keyCode 229). Candidate for an upstream PR.
- `packages/app/src/ui/workers/thumbnail-render.worker.ts`: extended
  `FONT_CHUNKS` to cover all 40 dynamic subsets of
  `@mathjax/mathjax-newcm-font` (was 18). A missing entry makes MathJax's
  `loadDynamicFile` reject, the render retry never succeeds, and any node
  whose text touches that subset (e.g. `\mathbb` → `double-struck`,
  `\mathcal` → `calligraphic`) permanently falls back to plain text.
  Keep in sync with `vscode-extension/webview/mathjax-fonts.ts`.
  Candidate for an upstream PR.
To update, run from the repository root:

```sh
./scripts/update-tikz-editor.sh            # re-extract the latest master
./scripts/update-tikz-editor.sh <commit>   # re-extract a specific commit
```
