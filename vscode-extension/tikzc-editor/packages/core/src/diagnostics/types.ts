import type { Span } from "../ast/types.js";

export type Severity = "error" | "warning";

export type Diagnostic = {
  severity: Severity;
  message: string;
  span: Span;
  code?: string;
};
