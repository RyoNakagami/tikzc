declare module "pptx2tikz" {
  export type ParsedSlideDeck = {
    slides: unknown[];
    size: { width: number; height: number };
  };

  export function parse(arrayBuffer: ArrayBuffer): Promise<ParsedSlideDeck>;
  export function parseClipboardGVML(arrayBuffer: ArrayBuffer): Promise<ParsedSlideDeck>;
  export function convertSlideToTikZ(
    slide: unknown,
    size: { width: number; height: number },
    options?: {
      noImages?: boolean;
      imageDir?: string;
      includeLayoutElements?: boolean;
      xcolorRgbConvert?: boolean;
    }
  ): { body?: string; tex?: string; images: unknown[] };
  export function convertSlidesToTikZ(
    slides: unknown[],
    size: { width: number; height: number },
    options?: {
      noImages?: boolean;
      imageDir?: string;
      includeLayoutElements?: boolean;
      xcolorRgbConvert?: boolean;
    }
  ): { tex: string; images: unknown[] };
}
