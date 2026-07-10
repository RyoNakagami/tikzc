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
const editorVersion = (
  JSON.parse(readFileSync(path.join(EDITOR, "package.json"), "utf8")) as { version?: string }
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
  plugins: [localBrandPlugin(), localMathJaxPlugin(), lightweightStubsPlugin(), react()],
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
