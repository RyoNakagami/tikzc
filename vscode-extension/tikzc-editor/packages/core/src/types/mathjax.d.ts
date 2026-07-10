declare module "mathjax" {
  type MathJaxAdaptor = {
    firstChild(node: unknown): unknown;
    getAttribute(node: unknown, name: string): string | null;
    innerHTML(node: unknown): string;
  };

  type MathJaxRuntime = {
    tex2svg(tex: string, options: { display: boolean }): unknown;
    tex2svgPromise?: (tex: string, options: { display: boolean }) => Promise<unknown>;
    startup?: {
      adaptor?: MathJaxAdaptor;
      promise?: Promise<unknown>;
    };
  };

  type MathJaxEntrypoint = {
    init(config: Record<string, unknown>): Promise<MathJaxRuntime>;
  };

  const MathJax: MathJaxEntrypoint;
  export default MathJax;
}

declare module "mathjax/tex-svg.js";
