export const SOURCE_FORMAT_REQUEST_EVENT = "tikz-editor:source-format-request";

export type SourceFormatRequestDetail = {
  reason?: "menu" | "shortcut" | "other";
};

export function requestSourceFormat(detail: SourceFormatRequestDetail = {}): void {
  window.dispatchEvent(
    new CustomEvent<SourceFormatRequestDetail>(SOURCE_FORMAT_REQUEST_EVENT, { detail })
  );
}
