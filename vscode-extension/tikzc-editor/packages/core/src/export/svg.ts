export const SVG_EXPORT_MIME_TYPE = "image/svg+xml;charset=utf-8";
export const DEFAULT_SVG_EXPORT_FILE_NAME = "tikz-export.svg";

export type SvgExportArtifact = {
  fileName: string;
  mimeType: "image/svg+xml;charset=utf-8";
  text: string;
};

export type CreateSvgExportArtifactOptions = {
  svg: string;
  fileName?: string;
};

export function normalizeSvgExportFileName(fileName?: string): string {
  const candidate = fileName?.trim() ?? "";
  if (candidate.length === 0) {
    return DEFAULT_SVG_EXPORT_FILE_NAME;
  }
  if (/\.svg$/i.test(candidate)) {
    return candidate;
  }
  return `${candidate}.svg`;
}

export function createSvgExportArtifact(options: CreateSvgExportArtifactOptions): SvgExportArtifact {
  return {
    fileName: normalizeSvgExportFileName(options.fileName),
    mimeType: SVG_EXPORT_MIME_TYPE,
    text: options.svg
  };
}
