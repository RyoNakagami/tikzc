import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setActiveEditorPlatform } from "@tikz-editor/app/platform/current";
import { revisionForText } from "@tikz-editor/app/linked-file-sync";
import type { DocumentFileRef } from "@tikz-editor/app/store/types";
import {
  createVscodePlatformAdapter,
  signalReady,
  logToHost,
  setOpenDocumentInterceptor
} from "./vscode-platform";

window.addEventListener("error", (event) => {
  logToHost(`window.onerror: ${event.message} (${event.filename}:${event.lineno})`);
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
  logToHost(`unhandledrejection: ${reason}`);
});

async function bootstrap() {
  const platform = createVscodePlatformAdapter();
  setActiveEditorPlatform(platform);
  // must run before the first canvas render kicks off MathJax
  const { registerMathJaxFontLoader } = await import("./mathjax-fonts");
  registerMathJaxFontLoader();
  const { App, APP_MENU_COMMAND_IDS, applyWorkspace } = await import("@tikz-editor/app");
  const { useEditorStore } = await import("@tikz-editor/app/store/store");
  const { getDockLayoutHandle } = await import("@tikz-editor/app/ui/DockLayout");

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
  signalReady();
  logToHost("bootstrap: App mounted");

  // Single-document mode: the editor always mirrors exactly the .tikz file
  // that is open in VSCode. Open requests from the host reuse the existing
  // document (or create it) and every other document — including tabs
  // restored from a previous session — is closed.
  setOpenDocumentInterceptor(({ source, path }) => {
    const { dispatch } = useEditorStore.getState();
    const name = path.split(/[\\/]/).pop() ?? path;
    const fileRef: DocumentFileRef = { kind: "file", name, path, provider: "desktop-fs" };
    const revision = revisionForText(source);

    const existing = Object.values(useEditorStore.getState().documents).find(
      (doc) => doc.fileRef?.path === path
    );
    if (existing) {
      dispatch({ type: "SWITCH_DOCUMENT", documentId: existing.id });
      if (!existing.dirty && existing.source !== source) {
        dispatch({
          type: "REPLACE_DOCUMENT_SOURCE_FROM_DISK",
          documentId: existing.id,
          source,
          fileRef,
          diskRevision: revision
        });
      }
    } else {
      dispatch({ type: "NEW_DOCUMENT", source, title: name });
      dispatch({
        type: "MARK_DOCUMENT_SAVED",
        fileRef,
        diskRevision: revision,
        lastKnownDiskSource: source
      });
    }

    for (const doc of Object.values(useEditorStore.getState().documents)) {
      if (doc.fileRef?.path !== path) {
        dispatch({ type: "CLOSE_DOCUMENT", documentId: doc.id });
      }
    }
  });

  // The VSCode text editor is the source view, so the in-app source panel is
  // redundant: force the built-in "Canvas Only" layout once the dock exists.
  const applyCanvasOnlyLayout = (attempt = 0) => {
    if (getDockLayoutHandle()) {
      applyWorkspace("canvasOnly");
      return;
    }
    if (attempt < 50) {
      window.setTimeout(() => applyCanvasOnlyLayout(attempt + 1), 100);
    }
  };
  applyCanvasOnlyLayout();

  // Auto write-back: canvas edits mark the document dirty; run the app's own
  // save flow (debounced) so changes land in the VSCode buffer immediately.
  // Re-dispatch only when the source actually changed since the last attempt,
  // so a pending conflict dialog is not re-triggered every tick.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const lastAttemptedSource = new Map<string, string>();
  useEditorStore.subscribe((state) => {
    const doc = state.activeDocumentId ? state.documents[state.activeDocumentId] : undefined;
    if (!doc?.dirty || doc.fileRef?.provider !== "desktop-fs" || !doc.fileRef.path) return;
    if (lastAttemptedSource.get(doc.id) === doc.source) return;
    const docId = doc.id;
    const source = doc.source;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      lastAttemptedSource.set(docId, source);
      platform.menu?.dispatchCommand?.(APP_MENU_COMMAND_IDS.SAVE_DOCUMENT, "platform");
    }, 600);
  });
}

bootstrap().catch((e: unknown) => {
  const detail = e instanceof Error ? e.stack ?? e.message : String(e);
  logToHost(`bootstrap failed: ${detail}`);
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = "";
    const pre = document.createElement("pre");
    pre.style.cssText = "padding:16px;white-space:pre-wrap;color:var(--vscode-errorForeground,#f48771)";
    pre.textContent = `tikzc: failed to start the TikZ editor.\n\n${detail}`;
    root.appendChild(pre);
  }
});
