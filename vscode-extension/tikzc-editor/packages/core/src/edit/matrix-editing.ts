export function isMatrixCellWritableKey(): boolean {
  // Matrix cell writes now share the standard node-property surface.
  // Mode/source-span checks in set-property + inspector still gate unsupported cells.
  return true;
}
