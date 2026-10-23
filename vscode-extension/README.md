# TikZc Editor — Rust renderer

Open a `.tikz` file and press **Ctrl+K V** (**Cmd+K V** on macOS), or run
**TikZc Editor: Open to the Side**. Edit in VSCode; unsaved buffer changes are
compiled after the configured debounce interval.

The standard preview and **TikZc Editor: Export (SVG / PNG)** command share one Rust
compilation artifact. The SVG is displayed as an isolated image without CSS or
MathJax text layout. Japanese, ASCII, full-width and half-width labels are paths,
so the browser does not remeasure them. PNG is produced from that same SVG.
Use the **SVG / PNG** selector to inspect either exported artifact, and
**Fit / 100%** to change display scale. Ctrl+wheel (Cmd+wheel or pinch on macOS)
zooms around the cursor, and Space-drag or middle-button drag pans; **Fit / 100%**
returns from a zoom to Fit. The canvas background is white, as is
Rust's PNG output.

This guarantees the same diagram geometry for the same source/settings snapshot.
SVG and PNG edge antialiasing can differ with renderer, zoom, and DPI. PNG mode
uses the exported PNG bytes. This does not promise LuaLaTeX pixel equivalence.
Pending source-editor changes and errors hide the previous image; unsupported syntax is reported
instead of falling back to a different renderer.

## Canvas editing

Control names below are the English ones (`tikzc.language: en`, the default);
set `ja` or use the toolbar's **Language** selector for Japanese labels.

Double-click a node (or select it and choose **Edit text**) to edit its complete
label, including Japanese and supported TeX. **Apply** or **Ctrl/Cmd+Enter** applies
the change; **Esc** cancels. IME composition does not submit the label.
Selected nodes also support dragging, coordinates, and font formatting.

Use **Object** to select covered or nested nodes, shapes, and paths. On the
canvas, **Tab / Shift+Tab** cycles through targets; **Alt+click** cycles through
targets at the clicked point. **Backward / Forward** moves an object one step, and
**To back / To front** moves it to either end. A path and its inline labels move
together in paint order. Order is saved with standard
[PGF layers](https://tikz.dev/base-layers), preserving source declaration order,
coordinate references, and enclosing scopes. Every move is undoable.

Select a line or arrow to drag the whole path, or enter its center coordinates
in **X / Y**. Its inline labels move with it. The source retains named anchor
references and adds a canvas translation. To remove the selection, use **Delete**
or **Delete / Backspace** with the canvas or object picker focused. Selecting an
inline label deletes only that label; selecting a path deletes the whole path.
Select the entire matrix in the picker to delete a matrix. Nodes still referenced
by other objects cannot be deleted until those references are removed.

To change an arrow, select the path or its inline label. Round handles edit
**Start / End**, square handles edit intermediate vertices and orthogonal corners,
and diamond handles edit Bézier control points. The **Arrow edit points** panel also lets
you choose **Start / End / Bend / Control**, enter X/Y in cm, and apply the change.
Select a named anchor in **Connect to** to reconnect a start or end. Dragging endpoints
snaps within 12 screen pixels of a named node's center, sides, or corners; hold
**Alt** to place freely. **Esc** cancels a drag. A focused handle also responds to
arrow keys (1 bp, or 10 bp with Shift).

Open paths with `--`, `|-`, `-|`, `to`, Bézier controls and relative `+` / `++`
coordinates expose editable points. Relative coordinates are materialized in the
same undoable edit to keep the other explicit vertices fixed. Moving an implicit
orthogonal corner converts it to an explicit polyline vertex; moving a curve
control converts the curve header to explicit Bézier controls. Labels and named
endpoint references are retained. Intermediate arcs can remain in a route with
explicit endpoints, but arc endpoints, closed, generated, and plot paths currently
require source editing. Rebuild/update both the Rust executable and extension;
older executables cannot supply the new editing metadata.

GUI updates keep the current image visible until both replacement image buffers
are decoded. Selection, zoom, and canvas coordinates stay fixed; editing does not
blank the image or trigger a second compilation. **Fit / 100%** reframes the
diagram when its bounds have grown beyond the current viewport. Returning focus
to the same source editor or receiving a save/dirty-state notification does not
recompile or reset the preview.

Choose a tool from **Tool**: click to add text, or drag to add a rectangle,
ellipse, circle, line, or arrow. New shapes are editable nodes with empty labels;
double-click them to add text. Dragging shows an outline; Esc cancels it.
These tools work in both SVG and PNG mode, including Fit mode. Empty documents
start with a blank canvas. New objects use a `reset cm` scope so their coordinates
match the canvas even inside a scaled or rotated picture; existing styles and
clipping still apply.

Each operation updates the unsaved `.tikz` buffer as one undoable edit. Use Undo
in the source editor to revert it. Changes are compiled before application;
invalid input leaves the source and canvas intact. Editing the source or switching
documents while a canvas change is compiling cancels that change.
Generated/repeated macro or loop nodes are not independently editable. Object
ordering requires uniquely mapped literal drawing commands in a single picture
(or a bare fragment); generated commands and paths spanning mixed layers disable
the ordering controls. Nested literal scopes are supported. Object
creation requires a literal single picture boundary (or a bare TikZ fragment);
it is disabled for generated or multiple pictures. Arc endpoints and closed,
generated or plot paths expose no edit points; change those in the source editor.

## Installation and build

The extension runs the Rust `tikzc` executable installed on your machine; the
VSIX does not contain it. No TeX installation is needed.

1. Install Rust 1.92 or later (on Windows, also the MSVC Build Tools).
2. Install `tikzc`:

   ```sh
   cargo install --git https://github.com/RyoNakagami/tikzc tikzc --locked
   # from a checkout: cargo install --path . --locked
   ```

3. Build and install the extension:

   ```sh
   npm ci
   npm run package
   code --install-extension "dist/packages/tikzc-preview-$(cat ../VERSION).vsix"
   ```

`npm run package` builds JavaScript only and produces one VSIX under
`dist/packages/` that works on Linux, macOS and Windows. Existing archives in
that directory are excluded from the package contents.

The extension looks up `tikzc` on PATH and accepts every version from 1.0.0
on. If a 0.x build (an early Rust build or the TeX-based npm `tikzc`) comes
first on PATH, the preview reports that it is older than 1.0.0. Remove it
(`npm unlink -g tikzc`) or set `tikzc.nativePath` (for example
`~/.cargo/bin/tikzc`).
When the executable's major.minor version differs from the extension's, a
warning asks you to reinstall it; rendering continues.

## Settings

| Setting | Use |
| --- | --- |
| `tikzc.nativePath` | Optional Rust executable path. Default: `tikzc` on PATH. |
| `tikzc.mainfont` | Default font; source `#| mainfont:` overrides it. Empty uses IPAexMincho. |
| `tikzc.extraPackages` / `tikzc.extraLibraries` | Additional headers; the Rust subset must support them. |
| `tikzc.pngDpi` | PNG preview and export resolution, default 300. |
| `tikzc.debounceMs` | Delay after editing, default 400 ms. |
| `tikzc.language` | Preview toolbar and message language: `en` (default) or `ja`. Also switchable from the preview toolbar. |

All rendering settings apply to preview and export alike. The source buffer is
snapshotted when export starts, before the save dialog. Switching `.tikz` tabs
retargets the preview; configuration changes recompile it.

## Verification

```sh
npm run build:native
npm run check
npm test
```

The suite checks mixed-width left/center/right aligned multiline labels
and math, compares SVG and PNG bytes against the Rust CLI at 96/150/300 DPI,
checks host preview/export wiring and the webview image payload, and tests stale
results/errors, disposal, settings, unsaved buffers and missing executables.
It also checks canvas label edits, coordinate conversion, drawing insertion,
IME/cancellation, and validation before source changes.
It fails if the Rust binary is missing (build it first). Set
`TIKZC_NATIVE_TEST_BINARY` to test a different executable.

License: MIT.
The `tikzc` executable embeds fonts; their license notices are in the repository under `assets/fonts/`.

For real Chromium pointer/hit-testing coverage after `cargo build` and
`npm run build:ext`, run `node scripts/test-native-browser.mjs` from this directory.
It uses a temporary browser profile and saves a screenshot and edited `.tikz` in
its printed temporary directory. Set `CHROME_BINARY` or `TIKZC_NATIVE_TEST_BINARY`
to choose the browser or renderer executable.
