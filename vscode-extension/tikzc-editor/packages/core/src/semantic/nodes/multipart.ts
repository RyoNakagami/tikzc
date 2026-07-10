import type { OptionListAst } from "../../options/types.js";
import { normalizeOptionValue } from "./utils.js";

export type NodePartText = {
  name: string;
  text: string;
};

const RECTANGLE_SPLIT_CARDINALS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty"
] as const;

const RECTANGLE_SPLIT_ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth"
] as const;

export function parseNodeParts(text: string): NodePartText[] {
  const parts: NodePartText[] = [];
  let cursor = 0;
  let currentName = "text";
  let buffer = "";

  const pushCurrent = (): void => {
    parts.push({ name: currentName, text: buffer.trim() });
    buffer = "";
  };

  while (cursor < text.length) {
    const idx = text.indexOf("\\nodepart", cursor);
    if (idx < 0) {
      buffer += text.slice(cursor);
      break;
    }

    buffer += text.slice(cursor, idx);
    cursor = idx + "\\nodepart".length;

    while (cursor < text.length && /\s/u.test(text[cursor] ?? "")) {
      cursor += 1;
    }

    if (text[cursor] === "[") {
      let depth = 1;
      cursor += 1;
      while (cursor < text.length && depth > 0) {
        const ch = text[cursor];
        if (ch === "[") {
          depth += 1;
        } else if (ch === "]") {
          depth -= 1;
        }
        cursor += 1;
      }
      while (cursor < text.length && /\s/u.test(text[cursor] ?? "")) {
        cursor += 1;
      }
    }

    if (text[cursor] !== "{") {
      buffer += "\\nodepart";
      continue;
    }
    cursor += 1;
    const start = cursor;
    let depth = 1;
    while (cursor < text.length && depth > 0) {
      const ch = text[cursor];
      if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
      }
      cursor += 1;
    }
    const rawName = text.slice(start, Math.max(start, cursor - 1));
    const normalizedName = normalizePartName(rawName);
    pushCurrent();
    currentName = normalizedName.length > 0 ? normalizedName : "text";
  }

  pushCurrent();
  return mergeNodeParts(parts);
}

function mergeNodeParts(parts: NodePartText[]): NodePartText[] {
  const merged = new Map<string, string>();
  const order: string[] = [];
  for (const part of parts) {
    const existing = merged.get(part.name);
    if (existing == null) {
      order.push(part.name);
      merged.set(part.name, part.text);
    } else {
      merged.set(part.name, `${existing}${existing.length > 0 ? " " : ""}${part.text}`.trim());
    }
  }
  return order.map((name) => ({ name, text: merged.get(name) ?? "" }));
}

function normalizePartName(raw: string): string {
  return normalizeOptionValue(raw).trim().toLowerCase().replaceAll("_", " ").replace(/\s+/gu, " ");
}

export function isMultipartShape(shape: string): boolean {
  return (
    shape === "circle split" ||
    shape === "circle solidus" ||
    shape === "ellipse split" ||
    shape === "diamond split" ||
    shape === "rectangle split"
  );
}

export function resolveRectangleSplitParts(options: OptionListAst | undefined): number {
  const fallback = 4;
  if (!options) {
    return fallback;
  }
  let parts = fallback;
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "rectangle split parts") {
      continue;
    }
    const parsed = Number.parseInt(normalizeOptionValue(entry.valueRaw), 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 20) {
      parts = parsed;
    }
  }
  return parts;
}

export function resolveRectangleSplitHorizontal(options: OptionListAst | undefined): boolean {
  if (!options) {
    return false;
  }
  let horizontal = false;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key === "rectangle split horizontal") {
      horizontal = true;
      continue;
    }
    if (entry.kind === "kv" && entry.key === "rectangle split horizontal") {
      const normalized = normalizeOptionValue(entry.valueRaw).trim().toLowerCase();
      if (normalized === "false" || normalized === "off" || normalized === "no" || normalized === "0") {
        horizontal = false;
      } else {
        horizontal = true;
      }
    }
  }
  return horizontal;
}

export function resolveRectangleSplitIgnoreEmptyParts(options: OptionListAst | undefined): boolean {
  if (!options) {
    return false;
  }
  let ignore = false;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key === "rectangle split ignore empty parts") {
      ignore = true;
      continue;
    }
    if (entry.kind === "kv" && entry.key === "rectangle split ignore empty parts") {
      const normalized = normalizeOptionValue(entry.valueRaw).trim().toLowerCase();
      if (normalized === "false" || normalized === "off" || normalized === "no" || normalized === "0") {
        ignore = false;
      } else {
        ignore = true;
      }
    }
  }
  return ignore;
}

export function resolveRectangleSplitPartTexts(parts: NodePartText[], partCount: number): string[] {
  const resolved = Array.from<string>({ length: Math.max(1, partCount) }).fill("");
  const first = parts.find((part) => part.name === "text");
  if (first) {
    resolved[0] = first.text;
  }

  let nextFallbackIndex = 1;
  for (const part of parts) {
    if (part.name === "text") {
      continue;
    }
    const namedIndex = rectangleSplitPartNameToIndex(part.name);
    let targetIndex = namedIndex != null ? namedIndex - 1 : -1;
    if (targetIndex < 0 || targetIndex >= resolved.length) {
      while (nextFallbackIndex < resolved.length && resolved[nextFallbackIndex] !== "") {
        nextFallbackIndex += 1;
      }
      targetIndex = nextFallbackIndex < resolved.length ? nextFallbackIndex : -1;
    }
    if (targetIndex < 0 || targetIndex >= resolved.length) {
      continue;
    }
    const existing = resolved[targetIndex];
    resolved[targetIndex] = existing.length > 0 ? `${existing} ${part.text}`.trim() : part.text;
  }

  return resolved;
}

function rectangleSplitPartNameToIndex(name: string): number | null {
  const numeric = name.match(/^(\d{1,2})$/u);
  if (numeric) {
    const index = Number.parseInt(numeric[1] ?? "", 10);
    return Number.isFinite(index) && index >= 1 && index <= 20 ? index : null;
  }
  if (name === "text") {
    return 1;
  }
  const cardinalIndex = RECTANGLE_SPLIT_CARDINALS.findIndex((value) => value === name);
  if (cardinalIndex >= 0) {
    return cardinalIndex + 1;
  }
  const ordinalIndex = RECTANGLE_SPLIT_ORDINALS.findIndex((value) => value === name);
  if (ordinalIndex >= 0) {
    return ordinalIndex + 1;
  }
  return null;
}
