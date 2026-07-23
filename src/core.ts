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

/**
 * Accept the common `below right={0.55cm and 1.3cm} of foo` misspelling of
 * the positioning-library syntax. With braces around only the distance pair,
 * pgfkeys hands the group to the math parser before `positioning` can split
 * on ` and `, which dies with "Unknown operator `a' or `an'". Rewrite to the
 * canonical unbraced form `below right=0.55cm and 1.3cm of foo`.
 *
 * Only the four diagonal keys take the two-distance `and` form, and the
 * braced content must be comma-free (a comma would need the braces to stay).
 */
export function normalizePositioningAnd(body: string): string {
  return body.replace(
    /\b((?:above|below)\s+(?:left|right)\s*=\s*)\{([^{},]+?\s+and\s+[^{},]+?)\}\s*(of\b)/g,
    "$1$2 $3"
  );
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
  let content = normalizePositioningAnd(body.trim());
  if (!/\\begin\s*\{tikzpicture\}/.test(content)) {
    content = `\\begin{tikzpicture}\n${content}\n\\end{tikzpicture}`;
  }
  if (scale) {
    content = `\\scalebox{${scale}}{${content}}`;
  }

  lines.push(content, "\\end{document}");
  return lines.join("\n");
}

/**
 * Remove the `dvisvgm` class option the embedded editor puts on
 * `\documentclass` for its original latex->dvi->dvisvgm workflow. tikzc
 * compiles lualatex->pdf->dvisvgm --pdf instead, and recent standalone.cls
 * versions make the mismatch fatal ("Backend request inconsistent with
 * engine: using 'luatex' backend").
 */
export function stripDvisvgmClassOption(tex: string): string {
  return tex.replace(
    /(\\documentclass)\s*\[([^\]]*)\]/,
    (_m, cmd: string, opts: string) => {
      const rest = opts
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s !== "dvisvgm");
      return rest.length > 0 ? `${cmd}[${rest.join(",")}]` : cmd;
    }
  );
}

/**
 * Inject tikzc's preamble (fontspec + mainfont, and the `#|` header
 * packages/libraries of `source` merged with `defaults`) into a standalone
 * LaTeX document assembled by the embedded editor.
 *
 * The editor's exporter only emits `\usepackage{tikz}` plus the libraries it
 * can infer from the picture: the `#|` header never reaches it, so e.g.
 * `#| packages: [fontawesome]` icons compile via the CLI but come out as
 * "Undefined control sequence" in the editor's compiled preview. Merging here
 * keeps the preview consistent with buildTex() without patching the vendored
 * editor.
 */
export function injectStandalonePreamble(
  tex: string,
  source: string,
  defaults: TikzOptions = {}
): string {
  const marker = "\\begin{document}";
  const at = tex.indexOf(marker);
  if (at === -1) return tex; // not a standalone document we understand

  const { opts } = parseSource(source);
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

  const preamble = [
    "\\usepackage{fontspec}",
    `\\setmainfont{${mainfont}}`,
    ...packages.map((p) => `\\usepackage{${p}}`),
    `\\usetikzlibrary{${libraries.join(",")}}`,
  ].join("\n");

  return `${tex.slice(0, at)}${preamble}\n${tex.slice(at)}`;
}

// ---------------------------------------------------------------------------
// node-text snippet assembly (native text fallback for the embedded editor)
// ---------------------------------------------------------------------------

export interface SnippetParams {
  text: string;
  mode: "text" | "math";
  /** wrap width in bp (CSS pt); null = natural single-line width */
  widthBp: number | null;
  alignment: "ragged-right" | "ragged-left" | "center" | "justified" | null;
  fontStyle: "normal" | "italic";
  fontWeight: "normal" | "bold";
  fontFamily: "serif" | "sans" | "monospace";
}

export interface SnippetMetrics {
  /** TeX pt (72.27/inch), as reported by \wd, \ht, \dp */
  wdTexPt: number;
  htTexPt: number;
  dpTexPt: number;
}

const SNIPPET_METRICS_FILE = "metrics.txt";
const SNIPPET_METRICS_PREFIX = "TIKZC-METRICS";

/**
 * Wrap node text with the same font/width/alignment switches the embedded
 * editor's MathJax engine applies (buildWrappedTeX), so a natively compiled
 * snippet measures and renders like its MathJax counterpart.
 */
function buildSnippetStyledText(params: SnippetParams): string {
  let styled = params.text;
  if (params.mode === "text" && params.fontFamily === "sans") {
    styled = `\\textsf{${styled}}`;
  } else if (params.mode === "text" && params.fontFamily === "monospace") {
    styled = `\\texttt{${styled}}`;
  }
  if (params.mode === "text" && params.fontWeight === "bold") {
    styled = `\\textbf{${styled}}`;
  }
  if (params.mode === "text" && params.fontStyle === "italic") {
    styled = `\\textit{${styled}}`;
  }
  if (params.mode === "math") {
    styled = `$${styled}$`;
    return params.widthBp == null ? styled : `\\parbox{${params.widthBp}bp}{${styled}}`;
  }
  if (params.widthBp == null) {
    return `\\mbox{${styled}}`;
  }
  const align =
    params.alignment === "ragged-left"
      ? "\\raggedleft "
      : params.alignment === "center"
        ? "\\centering "
        : params.alignment === "justified"
          ? ""
          : "\\raggedright ";
  return `\\parbox[t]{${params.widthBp}bp}{${align}${styled}}`;
}

/**
 * Build a standalone document that typesets one node-text snippet at the
 * document's base size (10pt class => \normalsize = 9.96264bp, the editor
 * engine's DEFAULT_TEXT_FONT_SIZE) and writes the exact TeX box dimensions
 * to metrics.txt (\typeout would wrap long lines in the log, so a dedicated
 * \write stream is used instead).
 *
 * The preamble merges the `#|` header of `headerSource` with `defaults`
 * using the same rules as buildTex()/injectStandalonePreamble(), so e.g.
 * `#| packages: [fontawesome]` macros compile in node text too.
 */
export function buildSnippetTex(
  params: SnippetParams,
  headerSource: string,
  defaults: TikzOptions = {}
): string {
  const { opts } = parseSource(headerSource);
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

  return [
    "\\documentclass[border=0pt]{standalone}",
    "\\usepackage{fontspec}",
    `\\setmainfont{${mainfont}}`,
    "\\usepackage{tikz}",
    ...packages.map((p) => `\\usepackage{${p}}`),
    `\\usetikzlibrary{${libraries.join(",")}}`,
    "\\newsavebox\\tikzcsnippetbox",
    "\\newwrite\\tikzcmetricsfile",
    "\\begin{document}",
    // body lines end with % so their newlines don't leak interword spaces
    // into the page box (standalone sets the content in an hbox where a
    // trailing space is NOT dropped and would widen the page beyond \wd)
    `\\sbox\\tikzcsnippetbox{${buildSnippetStyledText(params)}}%`,
    `\\immediate\\openout\\tikzcmetricsfile=${SNIPPET_METRICS_FILE}%`,
    `\\immediate\\write\\tikzcmetricsfile{${SNIPPET_METRICS_PREFIX}:\\the\\wd\\tikzcsnippetbox:\\the\\ht\\tikzcsnippetbox:\\the\\dp\\tikzcsnippetbox}%`,
    "\\immediate\\closeout\\tikzcmetricsfile%",
    "\\usebox\\tikzcsnippetbox%",
    "\\end{document}",
  ].join("\n");
}

/** Parse the TIKZC-METRICS line written by a buildSnippetTex() document. */
export function parseSnippetMetrics(text: string): SnippetMetrics | null {
  const m = text.match(
    new RegExp(`${SNIPPET_METRICS_PREFIX}:(-?[\\d.]+)pt:(-?[\\d.]+)pt:(-?[\\d.]+)pt`)
  );
  if (!m) return null;
  const [wdTexPt, htTexPt, dpTexPt] = [m[1], m[2], m[3]].map(Number);
  if (![wdTexPt, htTexPt, dpTexPt].every(Number.isFinite)) return null;
  return { wdTexPt, htTexPt, dpTexPt };
}

/**
 * Compile a buildSnippetTex() document to SVG plus exact box metrics.
 *
 * dvisvgm runs with --bbox=papersize (not --exact-bbox): the page equals the
 * TeX box (border=0pt), so the SVG viewBox matches \wd/\ht/\dp and the
 * caller can place the baseline exactly. --exact-bbox would crop to ink and
 * lose that correspondence.
 */
export async function compileSnippetToSvg(
  tex: string
): Promise<{ svg: string; metrics: SnippetMetrics; log: string }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tikzc-"));
  try {
    const texPath = path.join(tmp, "snippet.tex");
    const pdfPath = path.join(tmp, "snippet.pdf");
    const svgPath = path.join(tmp, "snippet.svg");
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
      log = await fs.readFile(path.join(tmp, "snippet.log"), "utf8").catch(() => "");
    } catch {
      log = await fs
        .readFile(path.join(tmp, "snippet.log"), "utf8")
        .catch(() => "no log");
      throw new TikzCompileError(
        `lualatex compilation failed:\n${extractLatexError(log)}`,
        log
      );
    }

    const metricsText = await fs
      .readFile(path.join(tmp, SNIPPET_METRICS_FILE), "utf8")
      .catch(() => "");
    const metrics = parseSnippetMetrics(metricsText);
    if (!metrics) {
      throw new TikzCompileError("snippet metrics were not produced", log);
    }

    try {
      await run(
        "dvisvgm",
        ["--pdf", "--no-fonts", "--bbox=papersize", "--optimize=all", "-o", svgPath, pdfPath],
        tmp
      );
    } catch (e) {
      throw new TikzCompileError(`dvisvgm conversion failed: ${e}`, log);
    }
    return { svg: await fs.readFile(svgPath, "utf8"), metrics, log };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
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
