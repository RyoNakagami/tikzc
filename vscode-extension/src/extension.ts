/*
 * extension.ts — hosts the vendored tikz-editor WYSIWYG App in a webview.
 *
 * The webview runs the full tikz-editor UI (canvas + source panel, two-way
 * sync). This file is the platform backend for it:
 *   - linked-file RPC mapped onto the .tikz TextDocument (so the canvas and
 *     the normal VSCode text editor stay in sync)
 *   - dialogs / clipboard / persistence (globalState)
 *   - PlatformLatex bridge: real lualatex + dvisvgm via ../../src/core
 *
 * Export commands (SVG / PNG via lualatex) are unchanged from the previous
 * preview-based extension.
 */

import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import { appendFileSync } from "node:fs";
import { execFile } from "node:child_process";
import {
  compileTikz,
  compileTexToSvg,
  injectStandalonePreamble,
  normalizePositioningAnd,
  stripDvisvgmClassOption,
  TikzCompileError,
  type TikzOptions,
} from "../../src/core";
import { SnippetService, type SnippetRpcRequest } from "./snippet-service";

const PERSISTENCE_KEY = "tikzc.editorPersistence";
const LOG_FILE = path.join(os.tmpdir(), "tikzc-webview.log");

let panel: vscode.WebviewPanel | undefined;
// the .tikz document mirrored by the panel (single-document mode); its `#|`
// header drives the preamble injected into webview latex.compile requests
let linkedDoc: vscode.TextDocument | undefined;
let watchedPaths = new Set<string>();
let fileWatchers: vscode.FileSystemWatcher[] = [];
let lastCompileLog = "";
let logChannel: vscode.OutputChannel | undefined;
// node-text snippet compiles (native text fallback); caches survive panel
// reloads so re-opening the editor doesn't recompile every icon
const snippetService = new SnippetService();

function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  logChannel?.appendLine(line);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // tmp file logging is best-effort
  }
}

function isTikzDoc(doc: vscode.TextDocument): boolean {
  return doc.languageId === "tikz" || doc.fileName.endsWith(".tikz");
}

/**
 * Gate linked-file RPCs (linked.read / linked.write) so the webview can only
 * touch files it is already allowed to see, never an arbitrary absolute path.
 * The webview is treated as untrusted: without this a compromised webview could
 * read ~/.ssh/... or overwrite ~/.aws/credentials via a crafted RPC.
 *
 * A path is allowed if it is (a) currently watched (i.e. the canvas linked it,
 * which only happens for the .tikz doc the user opened) or (b) inside an open
 * workspace folder. Path is normalised before the containment test so
 * "…/workspace/../../etc/passwd" cannot escape.
 */
function isAllowedLinkedPath(fsPath: string): boolean {
  const resolved = path.resolve(fsPath);
  if (watchedPaths.has(resolved) || watchedPaths.has(fsPath)) return true;
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const root = path.resolve(folder.uri.fsPath);
    const rel = path.relative(root, resolved);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return true;
    }
  }
  return false;
}

function configDefaults(): TikzOptions {
  const cfg = vscode.workspace.getConfiguration("tikzc");
  const mainfont = cfg.get<string>("mainfont", "");
  return {
    mainfont: mainfont || undefined,
    packages: cfg.get<string[]>("extraPackages", []),
    libraries: cfg.get<string[]>("extraLibraries", []),
  };
}

export function activate(ctx: vscode.ExtensionContext): void {
  logChannel = vscode.window.createOutputChannel("TikZ Editor (tikzc)");
  log("extension activated");
  ctx.subscriptions.push(
    logChannel,
    vscode.commands.registerCommand("tikzc.showPreview", () => openEditorPanel(ctx)),
    vscode.commands.registerCommand("tikzc.exportSvg", () => exportAs("svg")),
    vscode.commands.registerCommand("tikzc.exportPng", () => exportAs("png")),

    // text edits in a linked .tikz document -> notify the canvas
    vscode.workspace.onDidChangeTextDocument((e) => {
      notifyLinkedChange(e.document.uri.fsPath);
    }),

    // single-document mode: the panel mirrors whichever .tikz file is active,
    // so switching tabs must re-target the canvas as well
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const doc = editor?.document;
      if (panel && doc && isTikzDoc(doc)) sendOpenDocument(doc);
    })
  );
}

// ---------------------------------------------------------------------------
// editor panel
// ---------------------------------------------------------------------------

async function openEditorPanel(ctx: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const doc = editor && isTikzDoc(editor.document) ? editor.document : undefined;

  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside, true);
    if (doc) sendOpenDocument(doc);
    return;
  }

  const distRoot = vscode.Uri.joinPath(ctx.extensionUri, "dist", "webview");
  panel = vscode.window.createWebviewPanel(
    "tikzcEditor",
    "Local TikZ Editor",
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [distRoot],
    }
  );

  panel.onDidDispose(() => {
    panel = undefined;
    linkedDoc = undefined;
    disposeFileWatchers();
    watchedPaths = new Set();
  });

  const pendingOpen = doc;
  panel.webview.onDidReceiveMessage((msg) => {
    void handleWebviewMessage(ctx, msg, pendingOpen);
  });

  panel.webview.html = await buildWebviewHtml(ctx, panel.webview, distRoot);
  log(`editor panel opened (doc: ${doc?.fileName ?? "none"})`);
}

function sendOpenDocument(doc: vscode.TextDocument): void {
  linkedDoc = doc;
  panel?.webview.postMessage({
    type: "open-document",
    source: doc.getText(),
    path: doc.uri.fsPath,
  });
}

function notifyLinkedChange(fsPath: string): void {
  const resolved = path.resolve(fsPath);
  if (!panel || !watchedPaths.has(resolved)) return;
  panel.webview.postMessage({ type: "linked-file-changed", path: fsPath });
}

function disposeFileWatchers(): void {
  for (const w of fileWatchers) w.dispose();
  fileWatchers = [];
}

/** Watch linked files on disk too, for changes made outside VSCode. */
function syncFileWatchers(paths: string[]): void {
  disposeFileWatchers();
  for (const fsPath of paths) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(fsPath), path.basename(fsPath))
    );
    const notifyUnlessOpen = (uri: vscode.Uri) => {
      // an open TextDocument already reports through onDidChangeTextDocument
      const open = vscode.workspace.textDocuments.some(
        (d) => d.uri.fsPath === uri.fsPath
      );
      if (!open) notifyLinkedChange(uri.fsPath);
    };
    watcher.onDidChange(notifyUnlessOpen);
    watcher.onDidCreate(notifyUnlessOpen);
    watcher.onDidDelete((uri) => notifyLinkedChange(uri.fsPath));
    fileWatchers.push(watcher);
  }
}

async function buildWebviewHtml(
  ctx: vscode.ExtensionContext,
  webview: vscode.Webview,
  distRoot: vscode.Uri
): Promise<string> {
  const indexUri = vscode.Uri.joinPath(distRoot, "index.html");
  let html = Buffer.from(await vscode.workspace.fs.readFile(indexUri)).toString("utf8");

  const baseUri = webview.asWebviewUri(distRoot).toString();
  const nonce = Array.from({ length: 32 }, () =>
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".charAt(
      Math.floor(Math.random() * 62)
    )
  ).join("");
  // script-src is nonce-locked to our own bundle only. In particular this
  // intentionally does NOT allow cdn.jsdelivr.net, so the vendored TikzJaxModal
  // (which tries to inject tikzjax.js from that CDN, without SRI) is permanently
  // blocked in this build — the native lualatex path is used instead. Do not add
  // remote script/connect origins here without a subresource-integrity story.
  const csp = [
    "default-src 'none'",
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `img-src ${webview.cspSource} data: blob:`,
    `worker-src ${webview.cspSource} blob:`,
    `connect-src ${webview.cspSource} data: blob:`,
  ].join("; ");

  const persistence =
    ctx.globalState.get<Record<string, string>>(PERSISTENCE_KEY) ?? {};

  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    `<base href="${baseUri}/">`,
    // seeded before any module runs: platform persistence.load() is synchronous
    `<script nonce="${nonce}">window.__TIKZC_PERSISTENCE__ = ${JSON.stringify(persistence).replace(/</g, "\\u003c")};</script>`,
  ].join("\n");

  return html.replace("<head>", `<head>\n${head}`);
}

// ---------------------------------------------------------------------------
// webview messages
// ---------------------------------------------------------------------------

type RpcMessage = { type: "rpc"; id: number; method: string; params?: Record<string, unknown> };
type NotifyMessage = { type: "notify"; method: string; params?: Record<string, unknown> };

async function handleWebviewMessage(
  ctx: vscode.ExtensionContext,
  msg: RpcMessage | NotifyMessage,
  initialDoc: vscode.TextDocument | undefined
): Promise<void> {
  if (msg.type === "notify") {
    handleNotify(ctx, msg, initialDoc);
    return;
  }
  if (msg.type !== "rpc") return;
  try {
    const value = await handleRpc(msg.method, msg.params ?? {});
    panel?.webview.postMessage({ type: "rpc-result", id: msg.id, ok: true, value });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log(`rpc ${msg.method} failed: ${error}`);
    panel?.webview.postMessage({ type: "rpc-result", id: msg.id, ok: false, error });
  }
}

function handleNotify(
  ctx: vscode.ExtensionContext,
  msg: NotifyMessage,
  initialDoc: vscode.TextDocument | undefined
): void {
  const params = msg.params ?? {};
  switch (msg.method) {
    case "ready": {
      log("webview ready" + (initialDoc ? ` — opening ${initialDoc.fileName}` : ""));
      if (initialDoc) sendOpenDocument(initialDoc);
      break;
    }
    case "log": {
      log(`webview: ${String(params.message)}`);
      break;
    }
    case "persistence.save": {
      const store =
        ctx.globalState.get<Record<string, string>>(PERSISTENCE_KEY) ?? {};
      store[String(params.key)] = String(params.value);
      void ctx.globalState.update(PERSISTENCE_KEY, store);
      break;
    }
    case "window.setDocumentState": {
      if (panel) {
        const title = typeof params.title === "string" && params.title ? params.title : "Local TikZ Editor";
        panel.title = params.dirty ? `● ${title}` : title;
      }
      break;
    }
    case "linked.watch": {
      const paths = Array.isArray(params.paths)
        ? params.paths
            .filter((p): p is string => typeof p === "string")
            .map((p) => path.resolve(p))
        : [];
      watchedPaths = new Set(paths);
      syncFileWatchers(paths);
      break;
    }
  }
}

function findOpenDocument(fsPath: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((d) => d.uri.fsPath === fsPath);
}

async function handleRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "linked.read": {
      const fsPath = String(params.path);
      if (!isAllowedLinkedPath(fsPath)) {
        log(`linked.read denied (outside workspace): ${fsPath}`);
        return { status: "missing" };
      }
      const open = findOpenDocument(fsPath);
      if (open) return { status: "ok", source: open.getText() };
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
        return { status: "ok", source: Buffer.from(bytes).toString("utf8") };
      } catch {
        return { status: "missing" };
      }
    }

    case "linked.write": {
      const fsPath = String(params.path);
      const text = String(params.text);
      if (!isAllowedLinkedPath(fsPath)) {
        log(`linked.write denied (outside workspace): ${fsPath}`);
        return { ok: false, reason: "Refusing to write outside the workspace." };
      }
      const open = findOpenDocument(fsPath);
      if (open) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          open.positionAt(0),
          open.positionAt(open.getText().length)
        );
        edit.replace(open.uri, fullRange, text);
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) return { ok: false, reason: "Could not apply the edit." };
        // buffer edit only — persisting to disk stays a user decision (Ctrl+S)
        return { ok: true };
      }
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(fsPath),
        Buffer.from(text, "utf8")
      );
      return { ok: true };
    }

    case "file.openText": {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { "TikZ / TeX / SVG": ["tikz", "tex", "svg", "ipe", "txt"] },
      });
      if (!picked?.[0]) return null;
      const bytes = await vscode.workspace.fs.readFile(picked[0]);
      return { source: Buffer.from(bytes).toString("utf8"), path: picked[0].fsPath };
    }

    case "file.openBinary": {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { PowerPoint: ["pptx"] },
      });
      if (!picked?.[0]) return null;
      const bytes = await vscode.workspace.fs.readFile(picked[0]);
      return {
        base64: Buffer.from(bytes).toString("base64"),
        name: path.basename(picked[0].fsPath),
      };
    }

    case "file.saveAs": {
      const suggestedName = String(params.suggestedName ?? "diagram.tikz");
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const target = await vscode.window.showSaveDialog({
        defaultUri: folder ? vscode.Uri.joinPath(folder, suggestedName) : undefined,
      });
      if (!target) return { status: "cancelled" };
      await vscode.workspace.fs.writeFile(target, Buffer.from(String(params.text), "utf8"));
      return { status: "saved", path: target.fsPath };
    }

    case "file.export": {
      const fileName = String(params.fileName ?? "export");
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const target = await vscode.window.showSaveDialog({
        defaultUri: folder ? vscode.Uri.joinPath(folder, fileName) : undefined,
      });
      if (!target) return false;
      await vscode.workspace.fs.writeFile(
        target,
        Buffer.from(String(params.base64), "base64")
      );
      return true;
    }

    case "clipboard.readText":
      return await vscode.env.clipboard.readText();

    case "clipboard.writeText": {
      await vscode.env.clipboard.writeText(String(params.text));
      return undefined;
    }

    case "window.confirmUnsaved": {
      const choice = await vscode.window.showWarningMessage(
        String(params.message),
        { modal: true },
        "Save",
        "Discard"
      );
      if (choice === "Save") return "save";
      if (choice === "Discard") return "discard";
      return "cancel";
    }

    case "window.showMessage": {
      const message = `${String(params.title ?? "")}: ${String(params.message ?? "")}`;
      const kind = params.kind;
      if (kind === "error") await vscode.window.showErrorMessage(message);
      else if (kind === "warning") await vscode.window.showWarningMessage(message);
      else await vscode.window.showInformationMessage(message);
      return undefined;
    }

    case "window.openExternal":
      return await vscode.env.openExternal(vscode.Uri.parse(String(params.url)));

    case "latex.check": {
      try {
        const version = await new Promise<string>((resolve, reject) => {
          execFile("lualatex", ["--version"], (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout.split("\n")[0] ?? "lualatex");
          });
        });
        return { available: true, details: version };
      } catch {
        return {
          available: false,
          details: "lualatex not found — install TeX Live (see the tikzc README)",
        };
      }
    }

    case "latex.compile": {
      try {
        // adapt the editor-built document to the lualatex pipeline: its
        // `dvisvgm` class option is fatal under lualatex, and its standalone
        // export knows nothing about the `#|` header (packages / libraries /
        // mainfont) — merge that back in here; the picture body is exported
        // verbatim, so it needs the same `and` normalization as buildTex()
        const tex = injectStandalonePreamble(
          stripDvisvgmClassOption(
            normalizePositioningAnd(String(params.latexDocument))
          ),
          linkedDoc?.getText() ?? "",
          configDefaults()
        );
        const result = await compileTexToSvg(tex);
        lastCompileLog = result.log;
        return result.svg;
      } catch (e) {
        if (e instanceof TikzCompileError) {
          lastCompileLog = e.log;
          throw new Error(e.message);
        }
        throw e;
      }
    }

    case "latex.compileSnippet": {
      // native text fallback: node text the webview's MathJax engine cannot
      // render, compiled as tiny standalone documents. The webview sends the
      // `#|` header it sees; the linked document is the fallback source.
      const snippets = (params.snippets ?? []) as SnippetRpcRequest[];
      const started = Date.now();
      const results = await snippetService.compileSnippets(
        snippets,
        linkedDoc?.getText() ?? "",
        configDefaults()
      );
      log(
        `compileSnippet: ${results.length} snippet(s) in ${Date.now() - started}ms (` +
          results.map((r) => r.status).join(",") +
          ")"
      );
      return results;
    }

    case "latex.readLog":
      return lastCompileLog;

    default:
      throw new Error(`unknown rpc method: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// export commands (lualatex pipeline, unchanged)
// ---------------------------------------------------------------------------

async function exportAs(format: "svg" | "png"): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const doc = editor && isTikzDoc(editor.document) ? editor.document : undefined;
  if (!doc) {
    vscode.window.showWarningMessage("tikzc: open a .tikz file first.");
    return;
  }

  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(doc.fileName.replace(/\.[^.]+$/, `.${format}`)),
    filters: { [format.toUpperCase()]: [format] },
  });
  if (!target) return;

  const dpi = vscode.workspace
    .getConfiguration("tikzc")
    .get<number>("pngDpi", 300);

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `tikzc: exporting ${format.toUpperCase()}…` },
      async () => {
        const result = await compileTikz(doc.getText(), {
          formats: [format],
          dpi,
          defaults: configDefaults(),
        });
        const data =
          format === "svg"
            ? Buffer.from(result.svg!, "utf8")
            : result.png!;
        await vscode.workspace.fs.writeFile(target, data);
      }
    );
    vscode.window.showInformationMessage(`tikzc: saved ${target.fsPath}`);
  } catch (e) {
    const message = e instanceof TikzCompileError ? e.message : String(e);
    vscode.window.showErrorMessage(`tikzc: export failed — ${message}`);
  }
}

export function deactivate(): void {
  disposeFileWatchers();
}
