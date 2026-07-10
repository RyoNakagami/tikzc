export const PNG_EXPORT_MIME_TYPE = "image/png";
export const DEFAULT_PNG_EXPORT_FILE_NAME = "tikz-export.png";

export type PngExportArtifact = {
  fileName: string;
  mimeType: "image/png";
};

export type CreatePngExportArtifactOptions = {
  fileName?: string;
};

export function normalizePngExportFileName(fileName?: string): string {
  const candidate = fileName?.trim() ?? "";
  if (candidate.length === 0) {
    return DEFAULT_PNG_EXPORT_FILE_NAME;
  }
  if (/\.png$/i.test(candidate)) {
    return candidate;
  }
  return `${candidate}.png`;
}

export function createPngExportArtifact(options: CreatePngExportArtifactOptions = {}): PngExportArtifact {
  return {
    fileName: normalizePngExportFileName(options.fileName),
    mimeType: PNG_EXPORT_MIME_TYPE
  };
}
