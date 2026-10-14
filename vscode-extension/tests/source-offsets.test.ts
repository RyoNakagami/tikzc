import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceOffsets } from "../src/preview/source-offsets";

test("source offsets match UTF-8 prefix decoding, including astral and replacement characters", () => {
  for (const prefix of ["", "#| mainfont: 日本語\n"]) {
    for (const text of ["", "ASCII\r\n", "日本語 é ｶ 😀 e\u0301", "\ud800x\udc00"]) {
      const source = prefix + text;
      const bytes = Buffer.from(source, "utf8");
      const offset = sourceOffsets(source, prefix.length);
      for (let byte = 0; byte <= bytes.length; byte++) {
        assert.equal(offset(byte), bytes.subarray(0, byte).toString("utf8").length - prefix.length,
          `${JSON.stringify(source)} at byte ${byte}`);
      }
    }
  }
});

test("large Unicode sources preserve every node range after a settings prefix", () => {
  const prefix = "#| mainfont: 日本語\n";
  const lines = Array.from({ length: 1000 }, (_, i) => `\\node (n${i}) {日本語 😀 ${i}};\n`);
  const offset = sourceOffsets(prefix + lines.join(""), prefix.length);
  let byte = Buffer.byteLength(prefix), position = 0;
  for (const line of lines) {
    assert.equal(offset(byte), position);
    byte += Buffer.byteLength(line);
    position += line.length;
    assert.equal(offset(byte), position);
  }
});

test("invalid native offsets are refused", () => {
  const offset = sourceOffsets("abc");
  for (const byte of [-1, 4, 1.5, NaN, Infinity]) {
    assert.throws(() => offset(byte), /Invalid native source offset/);
  }
});
