import type { Span } from "../ast/types.js";

export type MacroDefinitionCommandRaw =
  | "\\def"
  | "\\let"
  | "\\newcommand"
  | "\\renewcommand"
  | "\\providecommand"
  | "\\DeclareRobustCommand"
  | "\\DeclareMathOperator";

export type MacroOriginFrame = {
  macroName: string;
  definitionId: string;
  definitionSpan: Span;
  commandRaw: MacroDefinitionCommandRaw;
};

export type TextMacroBinding = {
  kind: "text";
  value: string;
  provenance: MacroOriginFrame[];
};

export type CallableMacroBinding = {
  kind: "callable";
  parameterCount: number;
  optionalFirstArgDefault?: string;
  body: string;
  provenance: MacroOriginFrame[];
};

export type MacroBinding = TextMacroBinding | CallableMacroBinding;
