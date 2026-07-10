/*
 * The @mathjax/src root export ("." -> bundle/node-main.cjs) ships no .d.ts,
 * so declare the minimal node-main surface used by mathjax.test.ts here.
 */
declare module "@mathjax/src" {
  interface MathJaxLiteAdaptor {
    firstChild(node: unknown): unknown;
    outerHTML(node: unknown): string;
  }

  interface MathJaxNodeRuntime {
    tex2svg(tex: string, options?: { display?: boolean }): unknown;
    tex2svgPromise(tex: string, options?: { display?: boolean }): Promise<unknown>;
    startup: { adaptor: MathJaxLiteAdaptor };
  }

  const entrypoint: {
    init(config: Record<string, unknown>): Promise<MathJaxNodeRuntime>;
  };
  export = entrypoint;
}
