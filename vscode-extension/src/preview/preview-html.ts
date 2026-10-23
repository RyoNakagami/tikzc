import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { getLanguage, t } from "./i18n";

/** Build the isolated image viewer; document lifecycle stays in preview.ts. */
export function buildPreviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = randomBytes(24).toString("hex");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "native-preview.js"));
    const selected = (value: string) => value === getLanguage() ? " selected" : "";
    return `<!doctype html><html lang="${getLanguage()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body { margin:0; height:100vh; display:flex; flex-direction:column; color:var(--vscode-foreground); background:var(--vscode-editor-background); font:13px var(--vscode-font-family); }
header { flex:none; position:sticky; top:0; z-index:3; padding:10px; background:var(--vscode-editor-background); display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
button,select,input { color:var(--vscode-button-foreground); background:var(--vscode-button-background); border:0; padding:5px 10px; cursor:pointer; }
input { width:70px; } button[aria-pressed="true"] { outline:2px solid var(--vscode-focusBorder); }
button:disabled { opacity:.5; cursor:default; } #status { flex:none; padding:12px; white-space:pre-wrap; } #viewport { flex:1; min-height:0; padding:16px; overflow:auto; }
#canvas { position:relative; box-sizing:border-box; width:max-content; min-width:300px; max-width:100%; padding:48px; margin:auto; touch-action:none; } #overlay { position:absolute; pointer-events:none; } .node-hit { position:absolute; pointer-events:auto; border:1px solid transparent; background:transparent; padding:0; touch-action:none; } .node-hit:hover,.node-hit.selected { border:2px solid var(--vscode-focusBorder); background:rgba(70,140,220,.12); }
#endpoints { position:absolute; pointer-events:none; z-index:2; }
.endpoint { box-sizing:border-box; position:absolute; width:18px; height:18px; padding:0; border:2px solid var(--vscode-focusBorder); border-radius:50%; background:var(--vscode-editor-background); pointer-events:auto; transform:translate(-50%,-50%); cursor:crosshair; touch-action:none; }
.endpoint.bend { border-radius:2px; } .endpoint.control { border-radius:2px; transform:translate(-50%,-50%) rotate(45deg); }
.endpoint.active { background:var(--vscode-focusBorder); }
#path-editor { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:8px 12px; border:1px solid var(--vscode-focusBorder); }
#path-editor legend { font-weight:bold; } #path-anchor { max-width:180px; }
#canvas.drawing .endpoint { box-sizing:border-box; pointer-events:none; }
#canvas.drawing { cursor:crosshair; } #canvas.drawing .node-hit { pointer-events:none; }
#canvas.pan-ready, #canvas.pan-ready * { cursor:grab; } #canvas.panning, #canvas.panning * { cursor:grabbing; }
#objects { width:220px; max-width:100%; } #canvas:focus { outline:none; }
#draft { position:absolute; pointer-events:none; box-sizing:border-box; border:2px dashed var(--vscode-focusBorder); background:rgba(70,140,220,.12); transform-origin:0 0; }
#draft.round { border-radius:50%; } #draft.line { border-width:2px 0 0; background:none; }
#label-editor { position:fixed; z-index:4; width:280px; max-width:90vw; max-height:calc(100vh - 16px); overflow:auto; padding:10px; box-sizing:border-box; background:var(--vscode-editorWidget-background); border:1px solid var(--vscode-focusBorder); box-shadow:0 2px 8px #0005; }
#label-text { display:block; box-sizing:border-box; width:100%; min-height:90px; margin:6px 0; color:var(--vscode-input-foreground); background:var(--vscode-input-background); font:13px var(--vscode-editor-font-family); }
#label-error { color:var(--vscode-errorForeground); white-space:pre-wrap; } #selected { display:inline-block; width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
img { display:block; background:white; margin:auto; } img.fit { max-width:100%; height:auto; } [hidden] { display:none !important; }
</style></head><body><header><strong>TikZc Editor</strong>
<label>${t("View")} <select id="format"><option value="svg">SVG</option><option value="png">PNG</option></select></label>
<label>${t("Language")} <select id="language"><option value="en"${selected("en")}>English</option><option value="ja"${selected("ja")}>日本語</option></select></label>
<button id="fit">Fit / 100%</button><button id="export" disabled>${t("Export…")}</button>
<label>${t("Tool")} <select id="tool" disabled><option value="select">${t("Select / move")}</option><option value="text">${t("Add text")}</option><option value="rectangle">${t("Rectangle")}</option><option value="ellipse">${t("Ellipse")}</option><option value="circle">${t("Circle")}</option><option value="line">${t("Line")}</option><option value="arrow">${t("Arrow")}</option></select></label>
<button id="edit-label" disabled>${t("Edit text")}</button>
<label>${t("Object")} <select id="objects" aria-label="${t("Select object")}" disabled><option value="">${t("Choose…")}</option></select></label>
<button id="back" disabled title="${t("Send to back")}">${t("To back")}</button><button id="backward" disabled title="${t("Send backward")}">${t("Backward")}</button><button id="forward" disabled title="${t("Bring forward")}">${t("Forward")}</button><button id="front" disabled title="${t("Bring to front")}">${t("To front")}</button>
<button id="delete-object" disabled title="${t("Delete selected object (Delete)")}">${t("Delete")}</button>
<span id="selected">${t("Click a label to select")}</span>
<button id="bold" title="${t("Bold")}" aria-label="${t("Bold")}" aria-pressed="false" disabled><b>B</b></button>
<button id="italic" title="${t("Italic")}" aria-label="${t("Italic")}" aria-pressed="false" disabled><i>I</i></button>
<button id="underline" title="${t("Underline")}" aria-label="${t("Underline")}" aria-pressed="false" disabled><u>U</u></button>
<button id="smaller" aria-label="${t("Decrease font size")}" disabled>A−</button><button id="larger" aria-label="${t("Increase font size")}" disabled>A＋</button>
<label>${t("Font size")} <input id="font-size" type="number" min="1" max="200" step="1" disabled> pt</label>
<label>X <input id="node-x" type="number" step="0.1" disabled> cm</label>
<label>Y <input id="node-y" type="number" step="0.1" disabled> cm</label>
<button id="move" disabled>${t("Apply position")}</button>
<fieldset id="path-editor" hidden><legend>${t("Arrow edit points")}</legend>
<label>${t("Point")} <select id="path-point" aria-label="${t("Arrow edit points")}"></select></label>
<label>X <input id="path-x" aria-label="${t("Point X coordinate")}" type="number" step="0.1"> cm</label>
<label>Y <input id="path-y" aria-label="${t("Point Y coordinate")}" type="number" step="0.1"> cm</label>
<label>${t("Connect to")} <select id="path-anchor" aria-label="${t("Point connection target")}"><option value="">${t("Free coordinate")}</option></select></label>
<button id="path-apply">${t("Apply point")}</button><span id="path-hint"></span></fieldset>
</header><div id="status" role="status">${t("Waiting to compile…")}</div><div id="viewport"><div id="canvas" tabindex="0" aria-label="${t("TikZ canvas. Tab to select, Alt-click to cycle overlapping objects")}"><img id="diagram" class="fit" alt="TikZ diagram" hidden draggable="false"><div id="overlay"></div><div id="endpoints"></div><div id="draft" hidden></div>
<div id="label-editor" role="dialog" aria-label="${t("Edit label")}" hidden><label for="label-text">${t("Text (TeX allowed)")}</label><textarea id="label-text" spellcheck="false"></textarea><button id="label-save">${t("Apply")}</button> <button id="label-cancel">${t("Cancel")}</button><p>${t("Ctrl / Cmd + Enter to apply, Esc to close")}</p><div id="label-error" role="alert"></div></div>
</div></div>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
}
