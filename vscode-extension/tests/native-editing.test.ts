import { test } from "node:test";
import assert from "node:assert/strict";
import { canArrange, editNode, insertDrawing, type EditableNode, type DrawingTool, type EditingMetadata, type EditableObject } from "../src/preview/editing";

const source = String.raw`\node[draw, font=\bfseries] (a) at (1,2) {日本語 {ABC}}; % keep`;
const node: EditableNode = {id:5,start:5,labelStart:source.indexOf("{日本"),end:source.indexOf(";"),bounds:[0,0,10,10],x:0,y:0,moveMatrix:[1,0,0,1],font:"\\bfseries",fontSize:10};

test("arrangement requires unique, visible, editable objects and an insertion point", () => {
  const objects: EditableObject[] = Array.from({ length: 1000 }, (_, id) => ({
    id, start: id, end: id + 1, kind: "node", bounds: [0, 0, 1, 1],
    layer: "main", order: id, editable: true, visible: true,
  }));
  const metadata: EditingMetadata = { viewBox: [0, 0, 100, 100], nodes: [], objects, insertionOffset: 1000 };
  assert.equal(canArrange(metadata), true);
  assert.equal(canArrange({ ...metadata, objects: [...objects, objects[0]] }), false);
  assert.equal(canArrange({ ...metadata, insertionOffset: null }), false);
  assert.equal(canArrange({ ...metadata, objects: objects.slice(0, 1) }), false);
  for (const change of [{ visible: false }, { editable: false }]) {
    assert.equal(canArrange({ ...metadata, objects: [...objects.slice(0, -1), { ...objects[999], ...change }] }), false);
  }
});

test("label editing preserves the complete node header and supports TeX, Unicode, empty and long labels", () => {
  for (const text of ["", "あいうえお".repeat(60), String.raw`$x^2$ \\ \textbf{次の行} \{escaped\}`, "% comment\n本文"]) {
    const result = editNode(source, node, {action:"text",text});
    assert.equal(source.slice(0,node.start)+result+source.slice(node.end), source.slice(0,node.labelStart+1)+text+source.slice(node.end-1));
  }
  for (const text of ["}", "{", "x% hidden close", "x\\", "}\\node {escape"]) {
    assert.throws(() => editNode(source,node,{action:"text",text}));
  }
});

test("drawing insertion uses the compiler boundary, explicit bp units and isolated world coordinates", () => {
  const source = "% 日本語\n\\begin{tikzpicture}[rotate=30]\n\\node{old};\n\\end{tikzpicture}% tail";
  const at = source.indexOf("\\end");
  const metadata = {viewBox:[-10,-20,100,200] as [number,number,number,number],nodes:[],insertionOffset:at};
  for (const tool of ["text","rectangle","circle","ellipse","line","arrow"] as DrawingTool[]) {
    const edit = insertDrawing(source,metadata,{tool,start:[20,30],end:[-10,-20]});
    assert.equal(edit.start, at); assert.equal(edit.end,at);
    assert.match(edit.text,/^\n\\begin\{scope\}\[reset cm\]/);
    assert.match(edit.text,/bp/);
    assert.match(source.slice(0,at)+edit.text+source.slice(at),/\\end\{scope\}\n\\end\{tikzpicture\}% tail$/);
  }
  assert.throws(() => insertDrawing(source,{...metadata,insertionOffset:null},{tool:"text",start:[0,0],end:[0,0]}));
  assert.throws(() => insertDrawing(source,metadata,{tool:"line",start:[NaN,0],end:[1,1]}));
  assert.throws(() => insertDrawing(source,metadata,{tool:"rectangle",start:[0,0],end:[0,1]}));
  assert.throws(() => insertDrawing(source,metadata,{tool:"line",start:[0,0],end:[0,0]}));
});
