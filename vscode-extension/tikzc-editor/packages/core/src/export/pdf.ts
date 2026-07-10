export const PDF_EXPORT_MIME_TYPE = "application/pdf";
export const DEFAULT_PDF_EXPORT_FILE_NAME = "tikz-export.pdf";

export type PdfExportArtifact = {
  fileName: string;
  mimeType: "application/pdf";
};

export type CreatePdfExportArtifactOptions = {
  fileName?: string;
};

export function normalizePdfExportFileName(fileName?: string): string {
  const candidate = fileName?.trim() ?? "";
  if (candidate.length === 0) {
    return DEFAULT_PDF_EXPORT_FILE_NAME;
  }
  if (/\.pdf$/i.test(candidate)) {
    return candidate;
  }
  return `${candidate}.pdf`;
}

export function createPdfExportArtifact(options: CreatePdfExportArtifactOptions = {}): PdfExportArtifact {
  return {
    fileName: normalizePdfExportFileName(options.fileName),
    mimeType: PDF_EXPORT_MIME_TYPE
  };
}
