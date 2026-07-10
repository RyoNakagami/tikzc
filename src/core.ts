/*
 * core.ts — TikZ compile pipeline shared by the CLI and the VSCode extension.
 *
 * Pipeline (port of quarto_tikz.lua):
 *   .tikz --(assemble standalone .tex)--> .tex
 *        --(lualatex)--> .pdf
 *        --(dvisvgm --pdf --no-fonts)--> .svg
 *        --(pdftoppm -png)--> .png
 *
 * lualatex + fontspec so CJK / Japanese labels render with system fonts.
 *
 * Source header options (same syntax as the Quarto filter):
 *   #| packages: [circuitikz, pgfplots]   -- extra \usepackage
 *   #| libraries: [arrows.meta, calc]     -- extra \usetikzlibrary
 *   #| scale: 1.5                         -- wraps in \scalebox
 *   #| mainfont: IPAexGothic              -- fontspec main font
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const DEFAULT_PACKAGES = ["amsmath", "amssymb"];

export const DEFAULT_LIBRARIES = [
  "arrows.meta",
  "positioning",
  "calc",
  "shapes.geometric",
  "backgrounds",
  "fit",
];

// system font used for CJK / Japanese labels (resolved by fontspec via fontconfig)
export const DEFAULT_MAINFONT = "IPAexMincho";

export type OutputFormat = "svg" | "png";

export interface TikzOptions {
  packages?: string[];
  libraries?: string[];
  mainfont?: string;
  scale?: string;
}

export interface CompileRequest {
  formats: OutputFormat[];
  dpi?: number;
  /** defaults merged under the source's own `#|` header options */
  defaults?: TikzOptions;
}

export interface CompileResult {
  tex: string;
  svg?: string;
  png?: Buffer;
  elapsedMs: number;
}

export class TikzCompileError extends Error {
  constructor(message: string, public readonly log: string) {
    super(message);
    this.name = "TikzCompileError";
  }
}

// ---------------------------------------------------------------------------
// source parsing
// ---------------------------------------------------------------------------

/** "[a, b, c]" or "a, b" -> ["a","b","c"] */
export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^\s*\[/, "")
    .replace(/\]\s*$/, "")
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter((s) => s.length > 0);
}

function mergeLists(...lists: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const v of list) {
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
  }
  return out;
}

/** Parse "#| key: value" header lines at the top of the source. */
export function parseSource(text: string): {
  opts: Record<string, string>;
  body: string;
} {
  const opts: Record<string, string> = {};
  const bodyLines: string[] = [];
  let inHeader = true;
  for (const line of text.split("\n")) {
    const m = inHeader && line.match(/^\s*#\|\s*([\w-]+)\s*:\s*(.+?)\s*$/);
    if (m) {
      opts[m[1]] = m[2];
    } else {
      inHeader = false;
      bodyLines.push(line);
    }
  }
  return { opts, body: bodyLines.join("\n") };
}

// ---------------------------------------------------------------------------
// tex assembly
// ---------------------------------------------------------------------------

export function buildTex(source: string, defaults: TikzOptions = {}): string {
  const { opts, body } = parseSource(source);

  const packages = mergeLists(
    DEFAULT_PACKAGES,
    defaults.packages ?? [],
    parseList(opts.packages)
  );
  const libraries = mergeLists(
    DEFAULT_LIBRARIES,
    defaults.libraries ?? [],
    parseList(opts.libraries)
  );
  const mainfont = opts.mainfont ?? defaults.mainfont ?? DEFAULT_MAINFONT;
  const scale = opts.scale ?? defaults.scale;

  // load tikz as a package (not the `tikz` class option): the class option
  // expects a bare tikzpicture as the top-level box, which breaks \scalebox
  const lines = [
    "\\documentclass[border=2pt]{standalone}",
    "\\usepackage{fontspec}",
    `\\setmainfont{${mainfont}}`,
    "\\usepackage{tikz}",
    ...packages.map((p) => `\\usepackage{${p}}`),
    `\\usetikzlibrary{${libraries.join(",")}}`,
    "\\begin{document}",
  ];

  // allow bare content: wrap in tikzpicture if user omitted it
  let content = body.trim();
  if (!/\\begin\s*\{tikzpicture\}/.test(content)) {
    content = `\\begin{tikzpicture}\n${content}\n\\end{tikzpicture}`;
  }
  if (scale) {
    content = `\\scalebox{${scale}}{${content}}`;
  }

  lines.push(content, "\\end{document}");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// compilation
// ---------------------------------------------------------------------------

async function run(cmd: string, args: string[], cwd: string): Promise<void> {
  await execFileP(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024 });
}

/** Extract the first "! ..." error block from a LaTeX log. */
function extractLatexError(log: string): string {
  const m = log.match(/^(!.*(?:\n(?!\s*$).*)*)/m);
  if (m) return m[1];
  return log.slice(-2000);
}

/**
 * Compile a complete LaTeX document (not a .tikz snippet) to SVG.
 * Used by the VSCode extension's tikz-editor PlatformLatex bridge, where the
 * embedded editor supplies its own standalone document.
 */
export async function compileTexToSvg(
  tex: string
): Promise<{ svg: string; log: string }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tikzc-"));
  try {
    const texPath = path.join(tmp, "diagram.tex");
    const pdfPath = path.join(tmp, "diagram.pdf");
    const svgPath = path.join(tmp, "diagram.svg");
    await fs.writeFile(texPath, tex, "utf8");

    let log = "";
    try {
      await run(
        "lualatex",
        [
          "-interaction=nonstopmode",
          "-halt-on-error",
          // never let \write18 spawn subprocesses: the .tikz/.tex source is
          // untrusted input, and shell-escape would be arbitrary code execution
          "-no-shell-escape",
          `-output-directory=${tmp}`,
          texPath,
        ],
        tmp
      );
      log = await fs.readFile(path.join(tmp, "diagram.log"), "utf8").catch(() => "");
    } catch {
      log = await fs
        .readFile(path.join(tmp, "diagram.log"), "utf8")
        .catch(() => "no log");
      throw new TikzCompileError(
        `lualatex compilation failed:\n${extractLatexError(log)}`,
        log
      );
    }

    try {
      await run(
        "dvisvgm",
        ["--pdf", "--no-fonts", "--exact-bbox", "--optimize=all", "-o", svgPath, pdfPath],
        tmp
      );
    } catch (e) {
      throw new TikzCompileError(`dvisvgm conversion failed: ${e}`, log);
    }
    return { svg: await fs.readFile(svgPath, "utf8"), log };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export async function compileTikz(
  source: string,
  request: CompileRequest
): Promise<CompileResult> {
  const started = Date.now();
  const tex = buildTex(source, request.defaults);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tikzc-"));

  try {
    const texPath = path.join(tmp, "diagram.tex");
    const pdfPath = path.join(tmp, "diagram.pdf");
    await fs.writeFile(texPath, tex, "utf8");

    try {
      await run(
        "lualatex",
        [
          "-interaction=nonstopmode",
          "-halt-on-error",
          // never let \write18 spawn subprocesses: the .tikz/.tex source is
          // untrusted input, and shell-escape would be arbitrary code execution
          "-no-shell-escape",
          `-output-directory=${tmp}`,
          texPath,
        ],
        tmp
      );
    } catch {
      const log = await fs
        .readFile(path.join(tmp, "diagram.log"), "utf8")
        .catch(() => "no log");
      throw new TikzCompileError(
        `lualatex compilation failed:\n${extractLatexError(log)}`,
        log
      );
    }

    const result: CompileResult = { tex, elapsedMs: 0 };

    if (request.formats.includes("svg")) {
      // lualatex emits PDF; dvisvgm reads it with --pdf. --no-fonts embeds
      // glyphs as paths so CJK renders without shipping font files.
      const svgPath = path.join(tmp, "diagram.svg");
      try {
        await run(
          "dvisvgm",
          ["--pdf", "--no-fonts", "--exact-bbox", "--optimize=all", "-o", svgPath, pdfPath],
          tmp
        );
      } catch (e) {
        throw new TikzCompileError(`dvisvgm conversion failed: ${e}`, "");
      }
      result.svg = await fs.readFile(svgPath, "utf8");
    }

    if (request.formats.includes("png")) {
      const dpi = request.dpi ?? 300;
      try {
        await run(
          "pdftoppm",
          ["-png", "-r", String(dpi), "-singlefile", pdfPath, path.join(tmp, "diagram")],
          tmp
        );
      } catch (e) {
        throw new TikzCompileError(`pdftoppm conversion failed: ${e}`, "");
      }
      result.png = await fs.readFile(path.join(tmp, "diagram.png"));
    }

    result.elapsedMs = Date.now() - started;
    return result;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
