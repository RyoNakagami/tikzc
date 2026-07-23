/*
 * vscode-platform.ts — EditorPlatform adapter that hosts the tikz-editor App
 * inside a VSCode webview.
 *
 * Everything that needs the extension host (file access, dialogs, clipboard,
 * lualatex) goes through a small request/response protocol over postMessage.
 * The linked-file API is mapped onto the VSCode TextDocument of the .tikz
 * file, which is what gives us two-way sync with the normal text editor:
 *   - readLinkedText  -> current buffer text (unsaved edits included)
 *   - writeLinkedText -> WorkspaceEdit + save
 *   - bindLinkedFileChange <- onDidChangeTextDocument / file watcher
 */

import type {
  EditorPlatform,
  MenuCommandHandler
} from "@tikz-editor/app/platform/types";
import type { DocumentFileRef, FileRevision } from "@tikz-editor/app/store/types";
import {
  revisionForText,
  type LinkedTextReadResult,
  type LinkedTextWriteResult
} from "@tikz-editor/app/linked-file-sync";
import type {
  NativeSnippetRequest,
  NativeSnippetResult
} from "./node-text-fallback/types";

type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

declare function acquireVsCodeApi(): VsCodeApi;

declare global {
  interface Window {
    __TIKZC_PERSISTENCE__?: Record<string, string>;
  }
}

const VSCODE_PROVIDER = "desktop-fs"; // reuse the desktop provider id so isLinkedFileRef() accepts our refs

const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// RPC plumbing
// ---------------------------------------------------------------------------

type PendingRpc = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

let nextRpcId = 1;
const pendingRpcs = new Map<number, PendingRpc>();

function rpc<T>(method: string, params?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextRpcId++;
    pendingRpcs.set(id, { resolve: resolve as (value: unknown) => void, reject });
    vscode.postMessage({ type: "rpc", id, method, params });
  });
}

function notify(method: string, params?: unknown): void {
  vscode.postMessage({ type: "notify", method, params });
}

type OpenDocumentHandler = (opened: { source: string; fileRef: DocumentFileRef | null }) => void;
type LinkedChangeHandler = (fileRef: DocumentFileRef) => void;
type OpenDocumentInterceptor = (opened: { source: string; path: string }) => void;

let openDocumentHandler: OpenDocumentHandler | null = null;
let linkedChangeHandler: LinkedChangeHandler | null = null;
let pendingOpenDocument: { source: string; fileRef: DocumentFileRef | null } | null = null;
let openDocumentInterceptor: OpenDocumentInterceptor | null = null;

/**
 * Take over "open-document" events from the host instead of letting them reach
 * the App's own open-request flow. Used for single-document mode, where the
 * webview mirrors exactly the .tikz file that is open in VSCode.
 */
export function setOpenDocumentInterceptor(fn: OpenDocumentInterceptor): void {
  openDocumentInterceptor = fn;
}

function fileRefForPath(path: string): DocumentFileRef {
  const name = path.split(/[\\/]/).pop() ?? path;
  return { kind: "file", name, path, provider: VSCODE_PROVIDER };
}

let loggedFirstMessageSource = false;

window.addEventListener("message", (event) => {
  // No event.source guard: the VSCode webview iframe is origin-isolated, so
  // only the VSCode webview host (which relays extension-host messages into
  // this frame) and this frame's own scripts can post here. Guarding on
  // event.source is unreliable across VSCode versions/architectures — an
  // earlier `source === window` check silently dropped every host message
  // (open-document, rpc-result, linked-file-changed) in the real webview.
  if (typeof event.data !== "object" || event.data === null) return;
  if (!loggedFirstMessageSource) {
    loggedFirstMessageSource = true;
    const sourceKind =
      event.source === null ? "null"
      : event.source === window ? "window"
      : event.source === window.parent ? "parent"
      : "other";
    notify("log", { message: `first host message: type=${(event.data as { type?: string }).type} source=${sourceKind}` });
  }
  const msg = event.data as {
    type?: string;
    id?: number;
    ok?: boolean;
    value?: unknown;
    error?: string;
    source?: string;
    path?: string;
  };
  if (msg.type === "rpc-result" && typeof msg.id === "number") {
    const pending = pendingRpcs.get(msg.id);
    if (!pending) return;
    pendingRpcs.delete(msg.id);
    if (msg.ok) {
      pending.resolve(msg.value);
    } else {
      pending.reject(new Error(msg.error ?? "extension host request failed"));
    }
    return;
  }
  if (msg.type === "open-document" && typeof msg.source === "string") {
    notify("log", {
      message: `open-document received: ${String(msg.path)} (interceptor: ${openDocumentInterceptor != null})`
    });
    if (openDocumentInterceptor && typeof msg.path === "string") {
      openDocumentInterceptor({ source: msg.source, path: msg.path });
      return;
    }
    const opened = {
      source: msg.source,
      fileRef: typeof msg.path === "string" ? fileRefForPath(msg.path) : null
    };
    if (openDocumentHandler) {
      openDocumentHandler(opened);
    } else {
      pendingOpenDocument = opened;
    }
    return;
  }
  if (msg.type === "linked-file-changed" && typeof msg.path === "string") {
    linkedChangeHandler?.(fileRefForPath(msg.path));
  }
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function blobPartsToBase64(content: BlobPart[]): Promise<string> {
  const blob = new Blob(content);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

type LinkedReadRpcResult =
  | { status: "ok"; source: string }
  | { status: "missing" }
  | { status: "failed"; reason?: string };

async function readLinkedText(fileRef: DocumentFileRef): Promise<LinkedTextReadResult> {
  if (!fileRef.path) {
    return { status: "failed", reason: "File reference has no path." };
  }
  const result = await rpc<LinkedReadRpcResult>("linked.read", { path: fileRef.path });
  if (result.status !== "ok") {
    return result;
  }
  // revision is derived from text only: reads may come from an unsaved
  // TextDocument buffer where disk mtime/size would be meaningless
  return {
    status: "ok",
    source: result.source,
    revision: revisionForText(result.source),
    fileRef
  };
}

async function writeLinkedText(
  fileRef: DocumentFileRef,
  text: string,
  expectedRevision: FileRevision | null
): Promise<LinkedTextWriteResult> {
  const current = await readLinkedText(fileRef);
  if (current.status !== "ok") {
    return current;
  }
  if (expectedRevision && current.revision.hash !== expectedRevision.hash) {
    return {
      status: "changed-on-disk",
      source: current.source,
      revision: current.revision,
      fileRef: current.fileRef
    };
  }
  const result = await rpc<{ ok: boolean; reason?: string }>("linked.write", {
    path: fileRef.path,
    text
  });
  if (!result.ok) {
    return { status: "failed", reason: result.reason ?? "Could not write the linked file." };
  }
  return { status: "saved", revision: revisionForText(text), fileRef };
}

// ---------------------------------------------------------------------------
// platform
// ---------------------------------------------------------------------------

export function createVscodePlatformAdapter(): EditorPlatform {
  const persistence = new Map<string, string>(
    Object.entries(window.__TIKZC_PERSISTENCE__ ?? {})
  );
  let menuHandler: MenuCommandHandler | null = null;

  return {
    id: "vscode",
    persistence: {
      load: (key) => persistence.get(key) ?? null,
      save: (key, value) => {
        persistence.set(key, value);
        notify("persistence.save", { key, value });
      }
    },
    clipboard: {
      readText: () => rpc<string>("clipboard.readText"),
      writeText: (text) => rpc<void>("clipboard.writeText", { text }),
      writeBundle: async (payload) => {
        await rpc<void>("clipboard.writeText", { text: payload.plainText });
      }
    },
    menu: {
      usesNativeMenuBar: false,
      usesNativeContextMenus: false,
      bindCommandHandler: (handler) => {
        menuHandler = handler;
        return () => {
          if (menuHandler === handler) {
            menuHandler = null;
          }
        };
      },
      dispatchCommand: (commandId, origin = "platform") => {
        menuHandler?.(commandId, origin);
      },
      syncNativeMenu: () => {},
      showNativeContextMenu: () => {}
    },
    window: {
      setDocumentState: ({ title, dirty }) => {
        notify("window.setDocumentState", { title, dirty });
      },
      confirmUnsavedChanges: (message) =>
        rpc<"save" | "discard" | "cancel">("window.confirmUnsaved", { message }),
      showMessage: (options) => rpc<void>("window.showMessage", options),
      openExternalUrl: (url) => rpc<boolean>("window.openExternal", { url })
    },
    files: {
      bindOpenRequest: (handler) => {
        openDocumentHandler = handler;
        if (pendingOpenDocument) {
          const opened = pendingOpenDocument;
          pendingOpenDocument = null;
          handler(opened);
        }
        return () => {
          if (openDocumentHandler === handler) {
            openDocumentHandler = null;
          }
        };
      },
      openText: async () => {
        const result = await rpc<{ source: string; path: string } | null>("file.openText");
        if (!result) return null;
        return { source: result.source, fileRef: fileRefForPath(result.path) };
      },
      openBinary: async () => {
        const result = await rpc<{ base64: string; name: string } | null>("file.openBinary");
        if (!result) return null;
        return {
          bytes: base64ToArrayBuffer(result.base64),
          fileRef: { kind: "file" as const, name: result.name }
        };
      },
      saveText: async (text, options) => {
        const mode = options?.mode ?? "save";
        const currentRef = options?.fileRef ?? null;
        if (mode === "save" && currentRef?.path && currentRef.provider === VSCODE_PROVIDER) {
          const written = await writeLinkedText(currentRef, text, null);
          if (written.status === "saved") {
            return { status: "saved", fileRef: currentRef };
          }
          return {
            status: "failed",
            fileRef: currentRef,
            reason: "reason" in written ? written.reason : undefined
          };
        }
        const suggestedName = options?.suggestedName ?? currentRef?.name ?? "diagram.tikz";
        const result = await rpc<{ status: "saved"; path: string } | { status: "cancelled" }>(
          "file.saveAs",
          { text, suggestedName }
        );
        if (result.status === "cancelled") {
          return { status: "cancelled", fileRef: currentRef };
        }
        return { status: "saved", fileRef: fileRefForPath(result.path) };
      },
      readLinkedText: async (fileRef) => {
        if (fileRef.provider !== VSCODE_PROVIDER || !fileRef.path) {
          return { status: "failed", reason: "File is not linked through VSCode." };
        }
        return await readLinkedText(fileRef);
      },
      writeLinkedText: async (fileRef, text, expectedRevision) => {
        if (fileRef.provider !== VSCODE_PROVIDER || !fileRef.path) {
          return { status: "failed", reason: "File is not linked through VSCode." };
        }
        return await writeLinkedText(fileRef, text, expectedRevision);
      },
      syncLinkedFileWatches: (fileRefs) => {
        const paths = fileRefs
          .map((ref) => ref.path)
          .filter((p): p is string => typeof p === "string");
        notify("linked.watch", { paths });
      },
      bindLinkedFileChange: (handler) => {
        linkedChangeHandler = handler;
        return () => {
          if (linkedChangeHandler === handler) {
            linkedChangeHandler = null;
          }
        };
      },
      exportFile: async (content, options) => {
        const base64 = await blobPartsToBase64(content);
        return await rpc<boolean>("file.export", {
          base64,
          fileName: options.fileName,
          mimeType: options.mimeType
        });
      }
    },
    latex: {
      checkAvailable: () => rpc<{ available: boolean; details: string }>("latex.check"),
      compileTikzToSvg: (latexDocument) => rpc<string>("latex.compile", { latexDocument }),
      readLastCompileLog: () => rpc<string>("latex.readLog")
    }
  };
}

/**
 * Compile node-text snippets natively (lualatex on the extension host).
 * Used by the native text fallback engine for node text the MathJax engine
 * cannot render (e.g. fontawesome icons). Kept off `platform.latex` so the
 * vendored PlatformLatex type stays untouched.
 */
export function compileNativeTextSnippets(
  requests: NativeSnippetRequest[]
): Promise<NativeSnippetResult[]> {
  return rpc<NativeSnippetResult[]>("latex.compileSnippet", { snippets: requests });
}

/** Tell the extension host the webview is ready to receive the document. */
export function signalReady(): void {
  notify("ready");
}

/** Forward a diagnostic line to the extension host log (output channel + file). */
export function logToHost(message: string): void {
  notify("log", { message });
}
