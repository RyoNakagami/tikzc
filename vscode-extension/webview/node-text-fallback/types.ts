/*
 * Wire types for the "latex.compileSnippet" RPC (native text fallback).
 * Structurally mirrored by the extension host's snippet-service.ts — keep the
 * two in sync (they are duplicated on purpose: the webview and the extension
 * host build with separate tsconfigs and must not import each other's code).
 */

export type NativeSnippetRequest = {
  /** caller correlation key (the wrapper engine's native cache key) */
  id: string;
  text: string;
  mode: "text" | "math";
  /** wrap width in bp (CSS pt) at base font size; null = natural width */
  widthBp: number | null;
  alignment: "ragged-right" | "ragged-left" | "center" | "justified" | null;
  fontStyle: "normal" | "italic";
  fontWeight: "normal" | "bold";
  fontFamily: "serif" | "sans" | "monospace";
  /** `#|` header lines of the current document ("" = host-side fallback) */
  header: string;
};

export type NativeSnippetResult =
  | {
      id: string;
      status: "ok";
      /** full dvisvgm SVG document (root <svg> included) */
      svg: string;
      /** TeX box dimensions converted to bp (the editor engine's pt unit) */
      wdBp: number;
      htBp: number;
      dpBp: number;
    }
  | { id: string; status: "error"; message: string; errorKind: "latex" | "transient" };

export type NativeSnippetCompiler = (
  requests: NativeSnippetRequest[]
) => Promise<NativeSnippetResult[]>;
