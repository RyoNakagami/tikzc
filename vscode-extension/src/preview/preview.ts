import { arrangeObject, canArrange, deleteObject, editNode, fontState, insertDrawing, moveEndpoint, movePathPoint, moveObject, type EditingMetadata, type SourceEdit } from "./editing";
import * as vscode from "vscode";
import * as path from "node:path";
import { buildPreviewHtml } from "./preview-html";
import { RustRenderer, type RenderArtifact, type RenderRequest } from "./renderer";
import { PreviewQueue } from "./preview-queue";
import { getLanguage, setLanguage, t } from "./i18n";

export function activateNativePreview(ctx: vscode.ExtensionContext): void {
  const renderer = new RustRenderer(ctx.extension?.packageJSON?.version, (message) => { void vscode.window.showWarningMessage(`tikzc: ${message}`); });
  let panel: vscode.WebviewPanel | undefined;
  let document: vscode.TextDocument | undefined;
  let ready = false;
  let renderToken = 0;
  let rendered: {source: string; editing?: EditingMetadata} | undefined;
  let guiEdit = false;
  let applied: {doc: vscode.TextDocument; source: string} | undefined;
  let queue: PreviewQueue<RenderRequest, Awaited<ReturnType<RustRenderer["render"]>> & {source: string}> | undefined;
  const configuredLanguage = () => vscode.workspace.getConfiguration("tikzc").get<string>("language", "en");
  setLanguage(configuredLanguage());
  const isTikz = (doc: vscode.TextDocument) => doc.languageId === "tikz" || doc.fileName.endsWith(".tikz");

  function publish(result: RenderArtifact & {source: string}, selection?: {nodeId?: number; objectId?: number}): void {
    rendered = {source: result.source, editing: result.editing};
    const all = result.editing?.nodes ?? [];
    const counts = new Map<number, number>();
    for (const node of all) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
    const nodes = all.filter(node => counts.get(node.id) === 1);
    void panel?.webview.postMessage({type:"render",token:renderToken,svg:result.svg,png:result.png.toString("base64"),
      preserveViewport: !!selection, selection,
      editing: result.editing && {...result.editing,canArrange:canArrange(result.editing),nodes:nodes.map(n=>({...n,...fontState(n,result.source),label:result.source.slice(n.labelStart+1,n.end-1)}))}});
  }

  function request(doc: vscode.TextDocument): RenderRequest {
    const cfg = vscode.workspace.getConfiguration("tikzc", doc.uri);
    return {
      binary: cfg.get<string>("nativePath", "") || "tikzc",
      source: doc.getText(),
      dpi: cfg.get<number>("pngDpi", 300),
      mainfont: cfg.get<string>("mainfont", ""),
      packages: cfg.get<string[]>("extraPackages", []),
      libraries: cfg.get<string[]>("extraLibraries", []),
    };
  }

  function refresh(immediate = false): void {
    if (!panel || !document || !ready) return;
    panel.title = `TikZc Editor: ${path.basename(document.fileName)}`;
    const delay = immediate ? 0 : vscode.workspace.getConfiguration("tikzc", document.uri).get<number>("debounceMs", 400);
    queue?.update(request(document), delay);
  }

  async function open(): Promise<void> {
    const active = vscode.window.activeTextEditor?.document;
    if (active && isTikz(active)) document = active;
    if (!document) {
      void vscode.window.showWarningMessage("tikzc: open a .tikz file first.");
      return;
    }
    if (panel) {
      panel.reveal(vscode.ViewColumn.Beside, true);
      refresh(true);
      return;
    }
    const current = vscode.window.createWebviewPanel("tikzcNativePreview", "TikZc Editor", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, "dist")],
    });
    panel = current;
    queue = new PreviewQueue(
      async (value) => ({...await renderer.render(value), source: value.source}),
      (result) => publish(result),
      (error) => { void current.webview.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }); },
      () => { ++renderToken; rendered = undefined; void current.webview.postMessage({ type: "pending" }); },
    );
    current.onDidDispose(() => {
      queue?.dispose();
      queue = undefined;
      panel = undefined;
      ready = false;
      rendered = undefined;
      renderer.dispose?.();
    });
    current.webview.onDidReceiveMessage((message) => {
      if (panel !== current) return;
      if (message?.type === "ready") { ready = true; refresh(true); }
      if (["edit","insert","arrange","move-object","move-endpoint","move-path-point","delete"].includes(message?.type)) void applyCanvasEdit(message);
      if (message?.type === "language" && (message.value === "en" || message.value === "ja")) {
        void vscode.workspace.getConfiguration("tikzc").update("language", message.value, vscode.ConfigurationTarget.Global);
      }
      if (message?.type === "export" && (message.format === "svg" || message.format === "png")) {
        void exportAs(message.format, document);
      }
    });
    current.webview.html = buildPreviewHtml(current.webview, ctx.extensionUri);
  }

  async function applyCanvasEdit(message: any): Promise<void> {
    if (guiEdit || !document || !rendered || message.token !== renderToken || document.getText() !== rendered.source) return;
    const doc = document, snapshot = rendered, targetPanel = panel;
    try {
      let edit: SourceEdit;
      if (message.type === "move-path-point") {
        if (!snapshot.editing) return;
        edit = movePathPoint(snapshot.source,snapshot.editing,message.objectId,message.point,message.x,message.y,message.reference);
      } else if (message.type === "move-endpoint") {
        if (!snapshot.editing) return;
        edit = moveEndpoint(snapshot.source,snapshot.editing,message.objectId,message.endpoint,message.x,message.y,message.reference);
      } else if (message.type === "move-object" || message.type === "delete") {
        if (!snapshot.editing) return;
        edit = message.type === "delete" ? deleteObject(snapshot.source,snapshot.editing,message.objectId,message.id) :
          moveObject(snapshot.source,snapshot.editing,message.objectId,message.dx,message.dy);
      } else if (message.type === "arrange") {
        if (!snapshot.editing) return;
        edit = arrangeObject(snapshot.source,snapshot.editing,message.objectId,message.action);
      } else if (message.type === "insert") {
        if (!snapshot.editing) return;
        edit = insertDrawing(snapshot.source, snapshot.editing, message.drawing);
      } else {
        const matches = snapshot.editing?.nodes.filter(n => n.id === message.id) ?? [];
        if (matches.length !== 1) return;
        const node = matches[0];
        edit = {start: node.start, end: node.end, text: editNode(snapshot.source, node, message.edit)};
      }
      const candidate = snapshot.source.slice(0,edit.start) + edit.text + snapshot.source.slice(edit.end);
      guiEdit = true;
      // Invalid labels/styles must not destroy the editable canvas. This artifact
      // is cached and reused by the regular preview after the single undoable edit.
      const artifact = await renderer.render({...request(doc), source: candidate});
      if (document !== doc || panel !== targetPanel || message.token !== renderToken || doc.getText() !== snapshot.source) return;
      const change = new vscode.WorkspaceEdit();
      change.replace(doc.uri,new vscode.Range(doc.positionAt(edit.start),doc.positionAt(edit.end)),edit.text);
      applied = {doc,source:candidate};
      if (!await vscode.workspace.applyEdit(change)) throw new Error(t("Could not apply the change to the source."));
      if (document !== doc || panel !== targetPanel || message.token !== renderToken || doc.getText() !== candidate) return;
      const nodeIndex = snapshot.editing?.nodes.findIndex(n=>n.id===message.id) ?? -1;
      const objectId = message.objectId ?? snapshot.editing?.nodes[nodeIndex]?.objectId;
      const objectIndex = snapshot.editing?.objects?.findIndex(o=>o.id===objectId) ?? -1;
      ++renderToken;
      publish({...artifact,source:candidate},{nodeId:message.type==="delete"?undefined:artifact.editing?.nodes[nodeIndex]?.id,objectId:artifact.editing?.objects?.[objectIndex]?.id});
    } catch (error) {
      if (panel === targetPanel && message.token === renderToken) {
        let detail = error instanceof Error ? error.message : String(error);
        if(message.type==="delete" && /unknown coordinate or node/.test(detail)) detail=t("Cannot delete: other objects refer to it. Delete the lines and nodes that refer to it first.")+"\n"+detail;
        void targetPanel?.webview.postMessage({type: "edit-error", token: message.token, message: detail});
        void vscode.window.showErrorMessage(`tikzc: ${detail}`);
      }
    } finally { guiEdit = false; }
  }

  async function exportAs(format: "svg" | "png", doc?: vscode.TextDocument): Promise<void> {
    if (!doc) {
      const active = vscode.window.activeTextEditor?.document;
      doc = active && isTikz(active) ? active : document;
    }
    if (!doc) { void vscode.window.showWarningMessage("tikzc: open a .tikz file first."); return; }
    // Snapshot before the dialog: edits during export cannot mix revisions.
    const snapshot = request(doc);
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(doc.fileName.replace(/\.[^.]+$/, `.${format}`)),
      filters: { [format.toUpperCase()]: [format] },
    });
    if (!target) return;
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `tikzc: exporting ${format.toUpperCase()}…` }, async () => {
        const result = await renderer.render(snapshot);
        await vscode.workspace.fs.writeFile(target, format === "svg" ? Buffer.from(result.svg, "utf8") : result.png);
      });
      void vscode.window.showInformationMessage(`tikzc: saved ${target.fsPath}`);
    } catch (error) {
      void vscode.window.showErrorMessage(`tikzc: export failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  ctx.subscriptions.push(
    vscode.commands.registerCommand("tikzc.showPreview", open),
    vscode.commands.registerCommand("tikzc.exportSvg", () => exportAs("svg")),
    vscode.commands.registerCommand("tikzc.exportPng", () => exportAs("png")),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document !== document || event.contentChanges?.length === 0) return;
      if (applied?.doc === document && applied.source === document.getText()) return;
      applied = undefined;
      refresh();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (panel && editor && isTikz(editor.document) && editor.document !== document) { document = editor.document; applied = undefined; refresh(true); }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("tikzc")) return;
      const previous = getLanguage();
      setLanguage(configuredLanguage());
      if (panel && previous !== getLanguage()) {
        // The toolbar is rendered by the host; reloading re-sends "ready", which re-renders.
        ready = false;
        panel.webview.html = buildPreviewHtml(panel.webview, ctx.extensionUri);
      } else refresh(true);
    }),
    { dispose: () => { queue?.dispose(); panel?.dispose(); renderer.dispose?.(); } },
  );
}
