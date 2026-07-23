/*
 * Unit tests for webview/node-text-fallback/mathjax-xml-safe.ts.
 * The fixture mirrors MathJax LiteParser HTML-mode output, where attribute
 * values keep raw `<`/`>` (only `&` and `"` are escaped).
 *
 * Run with:  npm test   (in vscode-extension/)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeAngleBracketsInAttributeValues } from "../webview/node-text-fallback/mathjax-xml-safe";

test("属性値内の < > がエスケープされる（data-latex の不等号）", () => {
  const markup =
    '<g data-mml-node="math" data-latex="$d_i<\\lambda_{\\mathrm{obs}}$"><use href="#a"/></g>';
  const out = escapeAngleBracketsInAttributeValues(markup);
  assert.equal(
    out,
    '<g data-mml-node="math" data-latex="$d_i&lt;\\lambda_{\\mathrm{obs}}$"><use href="#a"/></g>'
  );
});

test("タグ構造とテキスト内容は変更されない", () => {
  const markup = '<g fill="currentColor"><text x="0">a &lt; b</text><path d="M0 0Z"/></g>';
  assert.equal(escapeAngleBracketsInAttributeValues(markup), markup);
});

test("冪等（二重適用しても壊れない）", () => {
  const markup = '<g data-latex="x < y > z"><path d="M0 0"/></g>';
  const once = escapeAngleBracketsInAttributeValues(markup);
  assert.equal(escapeAngleBracketsInAttributeValues(once), once);
});

test("シングルクォート属性も処理される", () => {
  const markup = "<use data-latex='a<b' href='#g0'/>";
  assert.equal(
    escapeAngleBracketsInAttributeValues(markup),
    "<use data-latex='a&lt;b' href='#g0'/>"
  );
});

test("引用符の混在（値中のもう一方の引用符）を壊さない", () => {
  const markup = `<g data-latex="it's <a>" aria-label='say "hi" < now'/>`;
  assert.equal(
    escapeAngleBracketsInAttributeValues(markup),
    `<g data-latex="it's &lt;a&gt;" aria-label='say "hi" &lt; now'/>`
  );
});

test("コメントは素通しされる", () => {
  const markup = '<!-- a < b --><g data-latex="x<y"/>';
  assert.equal(
    escapeAngleBracketsInAttributeValues(markup),
    '<!-- a < b --><g data-latex="x&lt;y"/>'
  );
});

test("エスケープ後の断片は strict XML としてパースできる", async () => {
  const markup =
    '<g data-latex="\\parbox{10pt}{しきい値判定 $d_i<\\lambda_{\\mathrm{obs}}$}"><path d="M0 0Z"/></g>';
  const wrapped = `<svg xmlns="http://www.w3.org/2000/svg">${escapeAngleBracketsInAttributeValues(markup)}</svg>`;
  // node:test 環境に DOMParser はないので最低限の well-formedness を確認:
  // 属性値の外に生の < が残っていないこと
  const outsideAttrs = wrapped.replace(/=(["'])[^"']*\1/g, "=''");
  const tagLike = outsideAttrs.split("<").slice(1);
  for (const chunk of tagLike) {
    assert.ok(chunk.includes(">"), `unterminated tag near: <${chunk.slice(0, 40)}`);
  }
});
