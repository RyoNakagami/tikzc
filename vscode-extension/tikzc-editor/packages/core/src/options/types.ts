import type { Span } from "../ast/types.js";

export type OptionEntry =
  | {
      kind: "kv";
      key: string;
      valueRaw: string;
      span: Span;
      keySpan?: Span;
      valueSpan?: Span | null;
      raw: string;
    }
  | {
      kind: "flag";
      key: string;
      span: Span;
      keySpan?: Span;
      raw: string;
    }
  | {
      kind: "unknown";
      span: Span;
      raw: string;
    };

export type OptionListAst = {
  span: Span;
  raw: string;
  entries: OptionEntry[];
};
