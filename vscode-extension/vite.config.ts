/*
 * Vite build for the webview bundle: hosts the vendored tikz-editor App.
 * Mirrors tikz-editor/apps/web/vite.config.ts, plus an alias that resolves
 * @tikz-editor/app from the submodule source (we are outside its workspace).
 */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";

const EDITOR = path.resolve(__dirname, "tikzc-editor");
// About dialog shows the tikzc extension version, not the vendored editor's.
const editorVersion = (
  JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8")) as { version?: string }
).version ?? "0.0.0";

// Rebrand the vendored UI ("TikZ Editor Web" → "Local TikZ Editor") at build
// time so the sources under tikzc-editor/ stay unmodified upstream copies.
function localBrandPlugin(): Plugin {
  return {
    name: "tikzc-local-brand",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("tikzc-editor")) return null;
      let out = code
        // Toolbar.tsx renders the qualifier as separate JSX
        .replace(
          /TikZ Editor <span className=\{css\.titleQualifier\}>Web<\/span>/g,
          "Local TikZ Editor"
        )
        .replace(/TikZ Editor Web/g, "Local TikZ Editor");
      return out === code ? null : { code: out, map: null };
    },
  };
}

// Upstream's browser MathJax runtime is loaded from cdn.jsdelivr.net, which
// the webview CSP blocks (and would break offline use). Route the main thread
// through the same Vite-bundled runtime the thumbnail worker uses, and expose
// it as globalThis.MathJax for getActiveMathJaxOutputJax().
const MATHJAX_RUNTIME_SELECTION =
  /const runtime = hasBrowserDomGlobals\(\)\s*\?\s*await initializeBrowserRuntime\(font\)\s*:\s*hasWorkerRuntimeGlobals\(\)\s*\?\s*await initializeWorkerRuntime\(\)\s*:\s*await initializeNodeRuntime\(\);/;

function localMathJaxPlugin(): Plugin {
  return {
    name: "tikzc-local-mathjax",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("text/mathjax-engine")) return null;
      if (!MATHJAX_RUNTIME_SELECTION.test(code)) {
        throw new Error(
          "tikzc-local-mathjax: runtime selection code in mathjax-engine.ts changed upstream — update MATHJAX_RUNTIME_SELECTION in vite.config.ts"
        );
      }
      const out = code.replace(
        MATHJAX_RUNTIME_SELECTION,
        "const runtime = await initializeWorkerRuntime();\n" +
          "  if (hasBrowserDomGlobals()) { (globalThis as { MathJax?: unknown }).MathJax = runtime; }"
      );
      return { code: out, map: null };
    },
  };
}

// Lightweight build: features that are dead in the VSCode single-document /
// canvas-only mode are stubbed out at build time (sources stay unmodified).
//   - SourcePanel: the VSCode text editor is the source view (drops CodeMirror)
//   - TabStrip: single-document mode has no tabs
//   - AssistantPanel: platform.assistant is not provided (drops react-markdown)
const UI_STUBS: Record<string, string> = {
  "ui/source-panel/SourcePanel.tsx":
    "export function SourcePanel() { return null; }\n" +
    "export function prioritizeDiagnosticsForDisplay(diagnostics) { return [...diagnostics]; }",
  "ui/TabStrip.tsx": "export function TabStrip() { return null; }",
  "ui/AssistantPanel.tsx": "export function AssistantPanel() { return null; }",
};

// Import formats that create new documents (invisible in single-document mode).
const MODULE_STUBS: Record<string, string> = {
  pptx2tikz:
    "const unavailable = () => { throw new Error(\"PowerPoint import is disabled in the VSCode build of tikzc.\"); };\n" +
    "export const parse = unavailable, convertSlidesToTikZ = unavailable, parseClipboardGVML = unavailable, convertSlideToTikZ = unavailable;",
  ipe2tikz:
    "export const convertIpeToTikz = () => { throw new Error(\"IPE import is disabled in the VSCode build of tikzc.\"); };",
};

// The thumbnail worker duplicates the whole core + MathJax + font stack as a
// second bundle (Vite workers cannot share chunks with the page). The client
// already falls back to main-thread rendering when the Worker constructor
// throws, so disable it and let the ~20 duplicated chunks disappear.
const THUMBNAIL_WORKER_CONSTRUCTION =
  /sharedWorker = new Worker\(new URL\("\.\/thumbnail-render\.worker\.ts", import\.meta\.url\), \{ type: "module" \}\);/;

// Hand (pan) tool: the upstream editor pans only via middle-drag / Alt+drag /
// wheel, none of which are discoverable. Inject a "pan" tool mode with a hand
// icon into the toolbar and route its left-drag through the existing pan drag
// path. Each patch is an exact-string match on the vendored sources and the
// build fails loudly if upstream drifts (same convention as the stubs above).
const PAN_TOOL_PATCHES: Record<string, ReadonlyArray<{ find: string; replace: string }>> = {
  "ui/tool-config.tsx": [
    {
      // Hand icon (Lucide "hand" outline), inserted next to the other icons.
      find: "export { CaretDownIcon };",
      replace:
        "export { CaretDownIcon };\n\n" +
        "function PanIcon({ size = 20 }: { size?: number }) {\n" +
        "  return (\n" +
        '    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">\n' +
        '      <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />\n' +
        '      <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />\n' +
        '      <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />\n' +
        '      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />\n' +
        "    </svg>\n" +
        "  );\n" +
        "}",
    },
    {
      find: '  { mode: "magnify",    label: "Magnify",  title: "Magnify (M)",  shortcut: "m", icon: MagnifyIcon },',
      replace:
        '  { mode: "magnify",    label: "Magnify",  title: "Magnify (M)",  shortcut: "m", icon: MagnifyIcon },\n' +
        '  { mode: "pan" as ToolMode, label: "Pan",  title: "Pan (H)",      shortcut: "h", icon: PanIcon },',
    },
    {
      find: '  return mode !== "select" && mode !== "magnify" && mode !== "addBucket" && mode !== "addMatrix";',
      replace:
        '  return mode !== "select" && mode !== "magnify" && (mode as string) !== "pan" && mode !== "addBucket" && mode !== "addMatrix";',
    },
    {
      find: '  magnify: "Hold and drag to magnify the canvas",',
      replace:
        '  magnify: "Hold and drag to magnify the canvas",\n' +
        '  ["pan" as ToolMode]: "Drag to pan the canvas",',
    },
  ],
  "ui/capabilities.ts": [
    {
      // No pipeline capabilities are needed to pan; register an empty check
      // list so the toolbar button is not disabled as "unsupported".
      find: "  magnify: [],",
      replace: "  magnify: [],\n  ...({ pan: [] } as Record<string, readonly CapabilityCheck[]>),",
    },
  ],
  "ui/canvas-panel/useCanvasToolInteractions.ts": [
    {
      find: "      const canPan = event.button === 1 || (event.button === 0 && event.altKey);",
      replace:
        '      const canPan = event.button === 1 || (event.button === 0 && (event.altKey || (toolMode as string) === "pan"));',
    },
    {
      // Starting a pan turns off fit-to-content mode; otherwise the next
      // recompute snaps the viewport back to the fitted position (zoom
      // gestures already do this upstream, drag-pan did not).
      find:
        "      if (canPan) {\n" +
        "        const clientPoint = makeClientPoint(px(event.clientX), px(event.clientY));",
      replace:
        "      if (canPan) {\n" +
        '        dispatch({ type: "SET_FIT_TO_CONTENT_MODE", active: false });\n' +
        "        const clientPoint = makeClientPoint(px(event.clientX), px(event.clientY));",
    },
  ],
  "ui/canvas-panel/CanvasPanelView.tsx": [
    {
      find:
        '  const viewportCursorClass = toolMode === "magnify" ? css.viewportMagnify : toolMode === "select" ? "" : css.viewportTool;',
      replace:
        '  const viewportCursorClass = (toolMode as string) === "pan" ? css.viewportPan : toolMode === "magnify" ? css.viewportMagnify : toolMode === "select" ? "" : css.viewportTool;',
    },
    {
      find:
        '  const interactionCursorClass = toolMode === "magnify" ? css.interactionLayerMagnify : toolMode === "select" ? "" : css.interactionLayerTool;',
      replace:
        '  const interactionCursorClass = (toolMode as string) === "pan" ? css.viewportPan : toolMode === "magnify" ? css.interactionLayerMagnify : toolMode === "select" ? "" : css.interactionLayerTool;',
    },
  ],
  "ui/canvas-panel/CanvasPanel.module.css": [
    {
      find: ".viewportTool {",
      replace: ".viewportPan {\n  cursor: grab;\n}\n\n.viewportTool {",
    },
  ],
};

function panToolPlugin(): Plugin {
  return {
    name: "tikzc-pan-tool",
    enforce: "pre",
    transform(code, id) {
      const entry = Object.entries(PAN_TOOL_PATCHES).find(([suffix]) => id.endsWith(suffix));
      if (!entry) return null;
      const [suffix, patches] = entry;
      let out = code;
      for (const { find, replace } of patches) {
        if (!out.includes(find)) {
          throw new Error(
            `tikzc-pan-tool: patch anchor not found in ${suffix} — upstream changed, update PAN_TOOL_PATCHES in vite.config.ts. Missing: ${JSON.stringify(find.slice(0, 80))}`
          );
        }
        out = out.replace(find, replace);
      }
      return { code: out, map: null };
    },
  };
}

function lightweightStubsPlugin(): Plugin {
  const STUB_PREFIX = "\0tikzc-stub:";
  return {
    name: "tikzc-lightweight-stubs",
    enforce: "pre",
    resolveId(source) {
      return source in MODULE_STUBS ? STUB_PREFIX + source : null;
    },
    load(id) {
      return id.startsWith(STUB_PREFIX) ? MODULE_STUBS[id.slice(STUB_PREFIX.length)] : null;
    },
    transform(code, id) {
      const key = Object.keys(UI_STUBS).find((suffix) => id.endsWith(suffix));
      if (key) {
        return { code: UI_STUBS[key], map: null };
      }
      if (id.endsWith("ui/workers/thumbnail-worker-client.ts")) {
        if (!THUMBNAIL_WORKER_CONSTRUCTION.test(code)) {
          throw new Error(
            "tikzc-lightweight-stubs: thumbnail worker construction changed upstream — update THUMBNAIL_WORKER_CONSTRUCTION in vite.config.ts"
          );
        }
        return {
          code: code.replace(
            THUMBNAIL_WORKER_CONSTRUCTION,
            'throw new Error("thumbnail worker disabled in the VSCode build (main-thread fallback is used)");'
          ),
          map: null,
        };
      }
      return null;
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, "webview"),
  // relative asset URLs; the extension host injects <base href> pointing at
  // the webview resource root
  base: "./",
  plugins: [localBrandPlugin(), localMathJaxPlugin(), lightweightStubsPlugin(), panToolPlugin(), react()],
  publicDir: path.resolve(EDITOR, "packages/app/public"),
  define: {
    "import.meta.env.TIKZ_EDITOR_VERSION": JSON.stringify(editorVersion)
  },
  worker: {
    format: "es"
  },
  optimizeDeps: {
    exclude: ["mathlive"]
  },
  resolve: {
    alias: [
      // native text fallback: node text MathJax cannot render is compiled by
      // lualatex on the extension host. Must come before the generic
      // tikz-editor alias (array aliases are first-match-wins).
      {
        find: /^tikz-editor\/text\/mathjax-engine$/,
        replacement: path.resolve(__dirname, "webview/node-text-fallback/engine.ts"),
      },
      { find: /^@tikz-editor\/app$/, replacement: path.resolve(EDITOR, "packages/app/src/index.ts") },
      { find: /^@tikz-editor\/app\/(.*)$/, replacement: path.resolve(EDITOR, "packages/app/src") + "/$1" },
      { find: /^@tikz-editor\/lang-tikz$/, replacement: path.resolve(EDITOR, "packages/lang-tikz/src/index.ts") },
      { find: /^@tikz-editor\/lezer-tikz$/, replacement: path.resolve(EDITOR, "packages/lezer-tikz/src/index.ts") },
      { find: /^tikz-editor(\/.*)?$/, replacement: path.resolve(EDITOR, "packages/core/src") + "$1" }
    ]
  },
  build: {
    outDir: path.resolve(__dirname, "dist/webview"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096
  }
});
