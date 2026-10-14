import { t } from "./i18n";
export interface EditableNode {
  id: number; start: number; labelStart: number; end: number;
  objectId?: number;
  bounds: [number, number, number, number]; x: number; y: number;
  moveMatrix: [number, number, number, number]; font: string; fontSize: number;
}
export interface PathEndpoint {
  start: number; end: number; x: number; y: number;
  matrix: [number, number, number, number, number, number];
  canvasShift: [number, number];
}
export interface PathPoint extends PathEndpoint {
  kind: "start" | "end" | "bend" | "control";
  replacement: "coordinate" | "corner" | "curve";
  controls?: [[number,number],[number,number]];
  controlIndex?: number;
}
export interface NodeAnchor { reference: string; x: number; y: number }
export interface EditableObject {
  id: number; start: number; end: number; kind: "node" | "path" | "matrix";
  bounds: [number, number, number, number]; layer: string; order: number;
  editable: boolean; visible: boolean; endpoints?: PathEndpoint[]; pathPoints?: PathPoint[]; pathNormalizations?: SourceEdit[];
}
export interface EditingMetadata {
  viewBox: [number, number, number, number]; nodes: EditableNode[]; insertionOffset?: number | null;
  objects?: EditableObject[]; layers?: string[]; anchors?: NodeAnchor[];
}
export type ArrangeAction = "forward" | "backward" | "front" | "back";
export type EditAction = "bold" | "italic" | "underline" | "size" | "move" | "text";
export interface NodeEdit { action: EditAction; value?: number; x?: number; y?: number; text?: string }
export type DrawingTool = "text" | "rectangle" | "ellipse" | "circle" | "line" | "arrow";
export interface CanvasInsert { tool: DrawingTool; start: [number, number]; end: [number, number] }
export interface SourceEdit { start: number; end: number; text: string }

function guiLayerBlock(source: string, name: "layers" | "order"): RegExpMatchArray | undefined {
  const matches = [...source.matchAll(new RegExp(`^% tikzc ${name} begin\\r?\\n[\\s\\S]*?^% tikzc ${name} end(?:\\r?\\n|$)`, "gm"))];
  if (matches.length > 1) throw new Error(t("Check for duplicate GUI layer definitions."));
  return matches[0];
}

function replaceAll(source: string, edits: SourceEdit[]): SourceEdit {
  let text=source;
  for(const edit of edits.sort((a,b)=>b.start-a.start || b.end-a.end)) text=text.slice(0,edit.start)+edit.text+text.slice(edit.end);
  return {start:0,end:source.length,text};
}

function sourceObject(metadata: EditingMetadata, id: number): EditableObject {
  const matches=metadata.objects?.filter(o=>o.id===id) ?? [];
  if(matches.length!==1 || !matches[0].editable) throw new Error(t("This object cannot be edited individually from the source."));
  return matches[0];
}

export function moveObject(source: string, metadata: EditingMetadata, id: number, dx: number, dy: number): SourceEdit {
  const object=sourceObject(metadata,id);
  if(object.kind!=="path" || ![dx,dy].every(n=>typeof n==="number" && Number.isFinite(n) && Math.abs(n)<1e6)) throw new Error("Invalid path translation.");
  let start=object.start, end=object.end;
  const previous=source.slice(0,start).match(/\\begin\{scope\}\[transform canvas=\{xshift=([-\d.]+)bp,yshift=([-\d.]+)bp\}\]\r?\n$/);
  const close=source.slice(end).match(/^\r?\n\\end\{scope\}/);
  if(previous && close) {start=previous.index!;end+=close[0].length;dx+=Number(previous[1]);dy+=Number(previous[2]);}
  return {start,end,text:`\\begin{scope}[transform canvas={xshift=${Number(dx.toFixed(5))}bp,yshift=${Number(dy.toFixed(5))}bp}]\n${source.slice(object.start,object.end)}\n\\end{scope}`};
}

/** Change a single handle and freeze relative dependencies in the same undo step. */
export function movePathPoint(source: string, metadata: EditingMetadata, id: number, index: number, x: number, y: number, reference?: string): SourceEdit {
  const object = sourceObject(metadata,id);
  if (!Number.isInteger(index) || index < 0) throw new Error("Invalid path point.");
  const point = object.pathPoints?.[index];
  if (!point) throw new Error(t("This edit point is unavailable. Select the arrow again."));
  return editPathPoint(source,metadata,object,point,x,y,reference);
}

export function moveEndpoint(source: string, metadata: EditingMetadata, id: number, endpoint: number, x: number, y: number, reference?: string): SourceEdit {
  const object = sourceObject(metadata,id), point = object.endpoints?.[endpoint];
  if ((endpoint !== 0 && endpoint !== 1) || !point) throw new Error("Invalid endpoint.");
  return editPathPoint(source,metadata,object,{...point,kind:endpoint===0?"start":"end",replacement:"coordinate"},x,y,reference);
}

function editPathPoint(source: string, metadata: EditingMetadata, object: EditableObject, point: PathPoint, x: number, y: number, reference?: string): SourceEdit {
  const validRange = (range: {start:number;end:number}) => Number.isInteger(range.start) && Number.isInteger(range.end) &&
    range.start >= object.start && range.end <= object.end && range.end > range.start;
  if (object.kind !== "path" || !validRange(point) ||
      ![x,y].every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e6)) throw new Error("Invalid path coordinates or source range.");
  const [a,b,c,d,tx,ty] = point.matrix, det = a*d-b*c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error("Cannot edit a singular transformed path.");
  const bp = (n: number) => `${Number(n.toFixed(8))}bp`;
  const coordinate = (px:number,py:number) => `(${bp((d*(px-tx)-c*(py-ty))/det)},${bp((-b*(px-tx)+a*(py-ty))/det)})`;
  let text = coordinate(x,y);
  if (reference != null) {
    if (!["start","end"].includes(point.kind) || !metadata.anchors?.some(anchor => anchor.reference === reference) || /[(){}\\%\r\n]/.test(reference)) throw new Error("Invalid node anchor.");
    const [sx,sy] = point.canvasShift;
    const shift = sx || sy ? `[xshift=${bp((-d*sx+c*sy)/det)},yshift=${bp((b*sx-a*sy)/det)}]` : "";
    text = `(${shift}${reference})`;
  }
  const previous = source.slice(point.start,point.end);
  if (point.replacement === "corner") {
    if (previous !== "|-" && previous !== "-|") throw new Error("Stale corner.");
    text = `-- ${text} --`;
  } else if (point.replacement === "curve") {
    if (!point.controls || (point.controlIndex !== 0 && point.controlIndex !== 1) || !/^(?:to\b|\.\.)/.test(previous)) throw new Error("Stale curve.");
    const controls = point.controls.map((p,i)=>i===point.controlIndex?coordinate(x,y):coordinate(p[0],p[1]));
    text = `.. controls ${controls[0]} and ${controls[1]} ..`;
  } else if (!/^\+?\+?\s*\(/.test(previous) || !previous.endsWith(")")) throw new Error("Stale coordinate.");
  const edits: SourceEdit[] = [{start:point.start,end:point.end,text}];
  for (const normalization of object.pathNormalizations ?? []) {
    if (!validRange(normalization)) throw new Error("Invalid relative coordinate range.");
    if (normalization.start < point.end && normalization.end > point.start) continue;
    edits.push(normalization);
  }
  let result = source.slice(object.start,object.end);
  for (const edit of edits.sort((a,b)=>b.start-a.start)) result=result.slice(0,edit.start-object.start)+edit.text+result.slice(edit.end-object.start);
  return {start:object.start,end:object.end,text:result};
}

export function deleteObject(source: string, metadata: EditingMetadata, id: number, nodeId?: number): SourceEdit {
  const object=sourceObject(metadata,id);
  if(nodeId!=null && object.kind==="matrix") throw new Error(t("Select the whole matrix in the object list to delete it."));
  if(nodeId!=null && object.kind==="path") {
    const node=metadata.nodes.find(n=>n.id===nodeId && n.objectId===id);
    if(!node || source.slice(node.start-4,node.start)!=="node" || node.start-4<=object.start) throw new Error(t("This label cannot be deleted individually."));
    return {start:node.start-4,end:node.end,text:""};
  }
  return {start:object.start,end:object.end,text:""};
}

export function canArrange(metadata: EditingMetadata): boolean {
  const objects = metadata.objects ?? [];
  const ids = new Set<number>();
  return metadata.insertionOffset != null && objects.length > 1 &&
    objects.every(object => {
      if (!object.editable || !object.visible || ids.has(object.id)) return false;
      ids.add(object.id);
      return true;
    });
}

/** PGF layers change paint order without moving declarations or crossing scopes. */
export function arrangeObject(source: string, metadata: EditingMetadata, id: number, action: ArrangeAction): SourceEdit {
  if (!canArrange(metadata)) throw new Error(t("Reorder figures with macro expansion, multiple pictures, or mixed layers in the source."));
  const objects = metadata.objects!;
  const ordered = [...objects].sort((a,b) => a.order-b.order);
  const from = ordered.findIndex(o => o.id === id);
  if (from < 0) throw new Error("The selected object is stale.");
  const to = action === "front" ? ordered.length-1 : action === "back" ? 0 :
    action === "forward" ? Math.min(from+1,ordered.length-1) : action === "backward" ? Math.max(0,from-1) : -1;
  if (to < 0) throw new Error("Unsupported arrange action.");
  if (to === from) return {start:0,end:source.length,text:source};
  ordered.splice(to,0,ordered.splice(from,1)[0]);

  const declarations = guiLayerBlock(source,"layers"), order = guiLayerBlock(source,"order");
  if (!!declarations !== !!order) throw new Error(t("Check the GUI layer definitions and their order."));
  const owned = new Set([...declarations?.[0].matchAll(/\\pgfdeclarelayer\{(tikzcGUI\d+)\}/g) ?? []].map(m=>m[1]));
  const names = new Set([...(metadata.layers ?? []),...owned]);
  const assigned = new Map<number,string>();
  const edits: SourceEdit[] = [];
  for (const object of objects) {
    if (!Number.isInteger(object.start) || !Number.isInteger(object.end) || object.start < 0 || object.end > source.length || object.end <= object.start) throw new Error("Invalid object source range.");
    let name = object.layer;
    if (!owned.has(name) || objects.filter(o=>o.layer===name).length !== 1) {
      let n = 0;
      while (names.has(`tikzcGUI${n}`) || source.includes(`{tikzcGUI${n}}`)) n++;
      name = `tikzcGUI${n}`; names.add(name); owned.add(name);
      edits.push({start:object.start,end:object.end,text:`\\begin{pgfonlayer}{${name}}\n${source.slice(object.start,object.end)}\n\\end{pgfonlayer}`});
    }
    assigned.set(object.id,name);
  }
  // Rust has an implicit background layer; explicitly declare it for PGF too.
  const background = metadata.layers?.includes("background") ? "\\pgfdeclarelayer{background}\n" : "";
  const header = `% tikzc layers begin\n${background}${[...owned].map(n=>`\\pgfdeclarelayer{${n}}`).join("\n")}\n% tikzc layers end\n`;
  const layers = [...(metadata.layers ?? ["background","main"]).filter(n=>!owned.has(n)),...ordered.map(o=>assigned.get(o.id)!)];
  const footer = `% tikzc order begin\n\\pgfsetlayers{${layers.join(",")}}\n% tikzc order end\n`;
  const headerEnd = source.match(/^(?:[^\S\r\n]*#\|[^\n]*(?:\n|$))*/)?.[0].length ?? 0;
  edits.push(declarations ? {start:declarations.index!,end:declarations.index!+declarations[0].length,text:header} : {start:headerEnd,end:headerEnd,text:header});
  edits.push(order ? {start:order.index!,end:order.index!+order[0].length,text:footer} : {start:metadata.insertionOffset!,end:metadata.insertionOffset!,text:`\n${footer}`});
  return replaceAll(source,edits);
}

// Labels contain TeX, but must remain within their original brace group.
function validateLabel(text: unknown): asserts text is string {
  if (typeof text !== "string" || text.length > 100_000) throw new Error(t("The label is too long or invalid."));
  let depth = 0, comment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (comment) { if (c === "\n" || c === "\r") comment = false; continue; }
    if (c === "\\") {
      if (++i === text.length) throw new Error(t("Check the trailing backslash."));
      continue;
    }
    if (c === "%") { comment = true; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth < 0) throw new Error(t("The label has unbalanced braces."));
  }
  if (depth || comment) throw new Error(t("Check the label's braces and comments."));
}

/** Insert world-space geometry at a compiler-verified, top-level source boundary. */
export function insertDrawing(source: string, metadata: EditingMetadata, drawing: CanvasInsert): SourceEdit {
  const at = metadata.insertionOffset;
  if (!Number.isInteger(at) || at! < 0 || at! > source.length) throw new Error(t("Nothing can be added to this figure."));
  for (const point of [drawing.start, drawing.end]) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e6)) throw new Error("Invalid coordinates.");
  }
  const bp = (n: number) => `${Number(n.toFixed(5))}bp`;
  const point = (p: number[]) => `(${bp(p[0])},${bp(p[1])})`;
  let command: string;
  if (drawing.tool === "text") command = `\\node at ${point(drawing.start)} {Text};`;
  else if (drawing.tool === "line" || drawing.tool === "arrow") {
    if (Math.hypot(drawing.end[0]-drawing.start[0], drawing.end[1]-drawing.start[1]) < .01) throw new Error(t("Move the line's start and end apart."));
    command = `\\draw[${drawing.tool === "arrow" ? "->" : "-"}] ${point(drawing.start)} -- ${point(drawing.end)};`;
  } else if (["rectangle", "ellipse", "circle"].includes(drawing.tool)) {
    let width = Math.abs(drawing.end[0]-drawing.start[0]), height = Math.abs(drawing.end[1]-drawing.start[1]);
    if (width < .01 || height < .01) throw new Error(t("Give the shape a width and a height."));
    if (drawing.tool === "circle") width = height = Math.max(width, height);
    const center = drawing.start.map((n, i) => (n + drawing.end[i])/2);
    command = `\\node[draw, ${drawing.tool}, minimum width=${bp(width)}, minimum height=${bp(height)}, inner sep=0bp, outer sep=0bp, anchor=center] at ${point(center)} {};`;
  } else throw new Error("Unsupported drawing tool.");
  const declarations=guiLayerBlock(source,"layers"), order=guiLayerBlock(source,"order");
  if (!!declarations !== !!order) throw new Error(t("Check the GUI layer definitions and their order."));
  // New drawings appear above previously arranged objects, just as they do in
  // a picture that still uses the main layer only.
  const edits:SourceEdit[]=[];
  if(declarations && order) {
    let n=0;
    while(source.includes(`{tikzcGUI${n}}`) || metadata.layers?.includes(`tikzcGUI${n}`)) n++;
    const name=`tikzcGUI${n}`;
    command=`\\begin{pgfonlayer}{${name}}\n${command}\n\\end{pgfonlayer}`;
    edits.push({start:declarations.index!,end:declarations.index!+declarations[0].length,text:declarations[0].replace("% tikzc layers end",`\\pgfdeclarelayer{${name}}\n% tikzc layers end`)});
    edits.push({start:order.index!,end:order.index!+order[0].length,text:`% tikzc order begin\n\\pgfsetlayers{${[...(metadata.layers ?? ["background","main"]),name].join(",")}}\n% tikzc order end\n`});
  }
  const insertion={start: at!, end: at!, text: `\n\\begin{scope}[reset cm]\n${command}\n\\end{scope}\n`};
  return edits.length ? replaceAll(source,[...edits,insertion]) : insertion;
}

export function fontState(node: EditableNode, source: string): { bold: boolean; italic: boolean; underline: boolean } {
  let bold = false, italic = false;
  for (const command of node.font.match(/\\(?:bfseries|mdseries|itshape|upshape)\b/g) ?? []) {
    if (command === "\\bfseries") bold = true;
    if (command === "\\mdseries") bold = false;
    if (command === "\\itshape") italic = true;
    if (command === "\\upshape") italic = false;
  }
  return { bold, italic, underline: source.slice(node.labelStart + 1, node.end - 1).trim().startsWith("\\underline{") };
}

/** Return a single, undoable replacement of one verified source node header/label. */
export function editNode(source: string, node: EditableNode, edit: NodeEdit): string {
  if (!Number.isInteger(node.start) || node.start < 0 || node.start > node.labelStart || node.end > source.length || source[node.labelStart] !== "{" || source[node.end - 1] !== "}") throw new Error("The selected node is stale. Select it again.");
  let header = source.slice(node.start, node.labelStart);
  let label = source.slice(node.labelStart + 1, node.end - 1);
  if (edit.action === "text") {
    validateLabel(edit.text);
    return `${header}{${edit.text}}`;
  }
  const state = fontState(node, source);
  // Our final option block is intentionally regular and can be replaced on
  // repeated GUI edits. Earlier user styles/coordinates remain untouched.
  const managed = /\[font=\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}, xshift=([-\d.]+)bp, yshift=([-\d.]+)bp\]\s*$/;
  const existing = header.match(managed);
  let dx = existing ? Number(existing[2]) : 0;
  let dy = existing ? Number(existing[3]) : 0;
  if (existing) header = header.slice(0, existing.index);
  let font = node.font;
  if (edit.action === "bold") font = font.replace(/\\(?:bfseries|mdseries)\b/g, "") + (state.bold ? "\\mdseries" : "\\bfseries");
  else if (edit.action === "italic") font = font.replace(/\\(?:itshape|upshape)\b/g, "") + (state.italic ? "\\upshape" : "\\itshape");
  else if (edit.action === "underline") {
    const trimmed = label.trim();
    // Only unwrap a whole-label wrapper; inner markup remains intact.
    if (state.underline && matchingGroupEnd(trimmed, 10) === trimmed.length - 1) label = trimmed.slice(11, -1);
    else label = `\\underline{${label}}`;
  } else if (edit.action === "size") {
    if (!Number.isFinite(edit.value) || edit.value! < 1 || edit.value! > 200) throw new Error("Font size must be 1–200 pt.");
    font = font.replace(/\\fontsize\s*\{[^{}]*\}\s*\{[^{}]*\}\s*\\selectfont/g, "").replace(/\\(?:tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)\b/g, "");
    font += `\\fontsize{${edit.value}}{${Number((edit.value! * 1.2).toFixed(3))}}\\selectfont`;
  } else if (edit.action === "move") {
    if (![edit.x, edit.y].every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e6)) throw new Error("Invalid coordinates.");
    const [a,b,c,d] = node.moveMatrix; const det = a*d-b*c;
    if (Math.abs(det) < 1e-12) throw new Error("Cannot move a singular transformed node.");
    const x = edit.x! - node.x, y = edit.y! - node.y;
    dx += (d*x-c*y)/det; dy += (-b*x+a*y)/det;
  } else throw new Error("Unsupported edit action.");
  return `${header}[font={${font.trim()}}, xshift=${Number(dx.toFixed(5))}bp, yshift=${Number(dy.toFixed(5))}bp]{${label}}`;
}

function matchingGroupEnd(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return i;
  }
  return -1;
}
