/** Map Rust UTF-8 offsets to editor UTF-16 offsets with one linear scan.
 * The optional settings prefix is measured in UTF-16 code units.
 */
export function sourceOffsets(source: string, prefixLength = 0): (byte: number) => number {
  const offsets = new Uint32Array(Buffer.byteLength(source, "utf8") + 1);
  let byte = 0, utf16 = 0;
  for (const character of source) {
    const code = character.codePointAt(0)!;
    const width = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    // Match UTF-8 decoding of an incomplete character (a replacement glyph).
    // Native source ranges normally fall on complete-character boundaries.
    offsets.fill(utf16 + 1, byte + 1, byte + width);
    byte += width;
    utf16 += character.length;
    offsets[byte] = utf16;
  }
  return (position) => {
    if (!Number.isInteger(position) || position < 0 || position >= offsets.length) {
      throw new Error(`Invalid native source offset: ${position}`);
    }
    return offsets[position] - prefixLength;
  };
}
