/*
 * cli.ts — tikzc command-line interface.
 *
 * Usage:
 *   tikzc test.tikz                    # -> test.svg
 *   tikzc test.tikz -f png --dpi 600   # -> test.png
 *   tikzc test.tikz -f both -o out/    # -> out/test.svg, out/test.png
 *   tikzc test.tikz --watch            # recompile on change
 */

import { watch } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  compileTikz,
  parseList,
  TikzCompileError,
  type OutputFormat,
  type TikzOptions,
} from "./core";
// esbuild inlines the JSON at bundle time, so dist/tikzc.cjs stays
// self-contained; devtools/bump-version.sh keeps this in sync with VERSION
import { version as VERSION } from "../package.json";

const HELP = `tikzc — compile .tikz files to SVG / PNG (lualatex + dvisvgm/pdftoppm)

Usage: tikzc [options] <file.tikz>

Options:
  -f, --format <svg|png|both>   output format (default: svg)
  -o, --output <path>           output file or directory (default: next to input)
      --dpi <n>                 PNG resolution (default: 300)
      --mainfont <font>         fontspec main font (default: IPAexMincho)
      --packages <a,b>          extra \\usepackage
      --libraries <a,b>         extra \\usetikzlibrary
      --scale <n>               wrap in \\scalebox
      --keep-tex                also write the generated .tex
  -w, --watch                   watch the input file and recompile on change
  -q, --quiet                   suppress progress output
  -V, --version                 print the tikzc version
  -h, --help                    show this help

Source header options (override CLI flags):
  #| packages: [circuitikz, pgfplots]
  #| libraries: [arrows.meta, calc]
  #| scale: 1.5
  #| mainfont: IPAexGothic
`;

interface CliConfig {
  input: string;
  formats: OutputFormat[];
  output?: string;
  dpi: number;
  keepTex: boolean;
  watch: boolean;
  quiet: boolean;
  defaults: TikzOptions;
}

function parseCli(argv: string[]): CliConfig {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      format: { type: "string", short: "f", default: "svg" },
      output: { type: "string", short: "o" },
      dpi: { type: "string", default: "300" },
      mainfont: { type: "string" },
      packages: { type: "string" },
      libraries: { type: "string" },
      scale: { type: "string" },
      "keep-tex": { type: "boolean", default: false },
      watch: { type: "boolean", short: "w", default: false },
      quiet: { type: "boolean", short: "q", default: false },
      version: { type: "boolean", short: "V", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.version) {
    process.stdout.write(`tikzc ${VERSION}\n`);
    process.exit(0);
  }

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 2);
  }
  if (positionals.length > 1) {
    fail(`expected a single input file, got: ${positionals.join(", ")}`);
  }

  const format = values.format as string;
  if (!["svg", "png", "both"].includes(format)) {
    fail(`invalid --format "${format}" (expected svg, png, or both)`);
  }
  const dpi = Number(values.dpi);
  if (!Number.isFinite(dpi) || dpi <= 0) {
    fail(`invalid --dpi "${values.dpi}"`);
  }

  return {
    input: positionals[0],
    formats: format === "both" ? ["svg", "png"] : [format as OutputFormat],
    output: values.output,
    dpi,
    keepTex: values["keep-tex"] as boolean,
    watch: values.watch as boolean,
    quiet: values.quiet as boolean,
    defaults: {
      mainfont: values.mainfont,
      scale: values.scale,
      packages: parseList(values.packages),
      libraries: parseList(values.libraries),
    },
  };
}

function fail(message: string): never {
  process.stderr.write(`tikzc: ${message}\n`);
  process.exit(2);
}

/** Resolve the output path for one format from -o (file or directory). */
async function outputPath(cfg: CliConfig, ext: string): Promise<string> {
  const base = path.basename(cfg.input).replace(/\.[^.]+$/, "");
  if (!cfg.output) {
    return path.join(path.dirname(cfg.input), `${base}.${ext}`);
  }
  const isDir =
    cfg.output.endsWith(path.sep) ||
    (await fs.stat(cfg.output).then((s) => s.isDirectory(), () => false));
  if (isDir || cfg.formats.length > 1) {
    await fs.mkdir(cfg.output, { recursive: true });
    return path.join(cfg.output, `${base}.${ext}`);
  }
  return cfg.output;
}

async function compileOnce(cfg: CliConfig): Promise<void> {
  const source = await fs.readFile(cfg.input, "utf8");
  const result = await compileTikz(source, {
    formats: cfg.formats,
    dpi: cfg.dpi,
    defaults: cfg.defaults,
  });

  const written: string[] = [];
  if (result.svg !== undefined) {
    const p = await outputPath(cfg, "svg");
    await fs.writeFile(p, result.svg, "utf8");
    written.push(p);
  }
  if (result.png !== undefined) {
    const p = await outputPath(cfg, "png");
    await fs.writeFile(p, result.png);
    written.push(p);
  }
  if (cfg.keepTex) {
    const p = await outputPath(cfg, "tex");
    await fs.writeFile(p, result.tex, "utf8");
    written.push(p);
  }
  if (!cfg.quiet) {
    process.stderr.write(
      `tikzc: ${written.join(", ")} (${result.elapsedMs}ms)\n`
    );
  }
}

async function main(): Promise<void> {
  const cfg = parseCli(process.argv.slice(2));

  await fs.access(cfg.input).catch(() => fail(`cannot read ${cfg.input}`));

  const runOnce = async (): Promise<boolean> => {
    try {
      await compileOnce(cfg);
      return true;
    } catch (e) {
      const msg = e instanceof TikzCompileError ? e.message : String(e);
      process.stderr.write(`tikzc: ${msg}\n`);
      return false;
    }
  };

  if (!cfg.watch) {
    process.exit((await runOnce()) ? 0 : 1);
  }

  await runOnce();
  if (!cfg.quiet) process.stderr.write(`tikzc: watching ${cfg.input}\n`);

  // debounce: editors fire multiple change events per save
  let timer: NodeJS.Timeout | undefined;
  let busy = false;
  let dirty = false;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (busy) {
        dirty = true;
        return;
      }
      busy = true;
      do {
        dirty = false;
        await runOnce();
      } while (dirty);
      busy = false;
    }, 200);
  };
  watch(cfg.input, trigger);
}

main().catch((e) => fail(String(e)));
