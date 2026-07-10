import { parseColorInput, type ParsedColorInput } from "xcolor-rgb-convert";

export type ParsedCustomColor = ParsedColorInput;

export function parseCustomColorInput(raw: string): ParsedCustomColor | null {
  return parseColorInput(raw);
}
