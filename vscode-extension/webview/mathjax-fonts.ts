/*
 * Register the MathJax dynamic-font loader on the main thread.
 *
 * The webview runs the Vite-bundled MathJax runtime (see localMathJaxPlugin in
 * vite.config.ts) instead of the CDN one, so dynamic font subsets must resolve
 * through bundled lazy chunks. This mirrors the FONT_CHUNKS map in the vendored
 * thumbnail-render.worker.ts — keep the two in sync when updating tikzc-editor.
 */
import { setWorkerFontLoader } from "tikz-editor/text/mathjax-engine";

// All dynamic subsets shipped by @mathjax/mathjax-newcm-font (svg/dynamic/*).
// A missing entry is not a graceful degradation: MathJax's loadDynamicFile
// rejects, the measure retry never succeeds, and any node whose text touches
// that subset (e.g. \mathbb → double-struck) falls back to plain text forever.
const FONT_CHUNKS: Record<string, () => Promise<unknown>> = {
  "accents":       () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/accents.js"),
  "accents-b-i":   () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/accents-b-i.js"),
  "arabic":        () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/arabic.js"),
  "arrows":        () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/arrows.js"),
  "braille":       () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/braille.js"),
  "braille-d":     () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/braille-d.js"),
  "calligraphic":  () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/calligraphic.js"),
  "cherokee":      () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/cherokee.js"),
  "cyrillic":      () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/cyrillic.js"),
  "cyrillic-ss":   () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/cyrillic-ss.js"),
  "devanagari":    () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/devanagari.js"),
  "double-struck": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/double-struck.js"),
  "fraktur":       () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/fraktur.js"),
  "greek":         () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/greek.js"),
  "greek-ss":      () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/greek-ss.js"),
  "hebrew":        () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/hebrew.js"),
  "latin":         () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/latin.js"),
  "latin-b":       () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-b.js"),
  "latin-bi":      () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-bi.js"),
  "latin-i":       () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-i.js"),
  "marrows":       () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/marrows.js"),
  "math":          () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/math.js"),
  "monospace":     () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace.js"),
  "monospace-ex":  () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace-ex.js"),
  "monospace-l":   () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace-l.js"),
  "mshapes":       () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/mshapes.js"),
  "phonetics":     () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/phonetics.js"),
  "phonetics-ss":  () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/phonetics-ss.js"),
  "PUA":           () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/PUA.js"),
  "sans-serif":    () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif.js"),
  "sans-serif-b":  () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-b.js"),
  "sans-serif-bi": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-bi.js"),
  "sans-serif-ex": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-ex.js"),
  "sans-serif-i":  () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-i.js"),
  "sans-serif-r":  () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-r.js"),
  "script":        () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/script.js"),
  "shapes":        () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/shapes.js"),
  "symbols":       () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols.js"),
  "symbols-b-i":   () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols-b-i.js"),
  "variants":      () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/variants.js"),
};

export function registerMathJaxFontLoader(): void {
  setWorkerFontLoader((name: string) => {
    const key = name.match(/\/svg\/dynamic\/(.+?)\.js$/)?.[1];
    const loader = key ? FONT_CHUNKS[key] : null;
    if (loader) return loader();
    return Promise.reject(new Error(`MathJax dynamic font not bundled: ${name}`));
  });
}
