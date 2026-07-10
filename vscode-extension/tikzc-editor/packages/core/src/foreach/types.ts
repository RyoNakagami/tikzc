import type { PathItem, Span, Statement } from "../ast/types.js";
import type { MacroOriginFrame } from "../macros/types.js";
import type { OptionListAst } from "../options/types.js";

export type ForeachLoopHeader = {
  headerRaw: string;
  variablesRaw: string;
  listRaw: string;
  options?: OptionListAst;
  optionsSpan?: Span;
};

export type ForeachIterationBinding = Record<string, string>;

export type ForeachOriginFrame = {
  loopId: string;
  loopSpan: Span;
  iterationIndex: number;
  bindings: ForeachIterationBinding;
};

export type ForeachStatementAttribution = {
  sourceId: string;
  sourceSpan: Span;
  foreachStack: ForeachOriginFrame[];
};

export type ExpansionSourceMap = {
  sourceId: string;
  sourceSpan: Span;
  sourceKind: "foreach" | "macro";
  mapSpan: (span: Span) => Span | null;
};

export type ForeachExpansionDiagnostic = {
  code: string;
  message: string;
  span: Span;
  severity: "warning" | "error";
};

export type ForeachExpansionResult = {
  figureBody: Statement[];
  diagnostics: ForeachExpansionDiagnostic[];
  statementAttribution: WeakMap<Statement, ForeachStatementAttribution>;
  statementSourceMaps: WeakMap<Statement, ExpansionSourceMap>;
  pathItemForeachStack: WeakMap<PathItem, ForeachOriginFrame[]>;
  pathItemSourceMaps: WeakMap<PathItem, ExpansionSourceMap>;
  statementMacroAttribution: WeakMap<Statement, MacroOriginFrame[]>;
  templateLocalIdByExpandedId: Map<string, string>;
};
