// Deliberately display the renderer's image as an isolated image document:
// no MathJax, browser text measurement, or inherited SVG/CSS can move glyphs.
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
import type { PathPoint, NodeAnchor, EditableObject, EditingMetadata, NodeEdit, DrawingTool } from "../src/preview/editing";
import { setLanguage, t } from "../src/preview/i18n";
import { selectionTargets, overlappingTargets, type UiNode, type Target } from "./native-selection";
const host = acquireVsCodeApi();
setLanguage(document.documentElement?.lang);
const diagram = document.getElementById("diagram") as HTMLImageElement;
const status = document.getElementById("status")!;
const format = document.getElementById("format") as HTMLSelectElement;
const svgButton = document.getElementById("svg") as HTMLButtonElement;
const pngButton = document.getElementById("png") as HTMLButtonElement;
let svgUrl = "";
let pngUrl = "";
const overlay = document.getElementById("overlay")!;
const endpoints = document.getElementById("endpoints")!;
let anchors: NodeAnchor[] = [];
const pointPicker = document.getElementById("path-point") as HTMLSelectElement;
const anchorPicker = document.getElementById("path-anchor") as HTMLSelectElement;
const pathEditor = document.getElementById("path-editor")!;
let pointIndex = 0;
const controls = ["bold", "italic", "underline", "smaller", "larger", "font-size", "node-x", "node-y", "move", "edit-label"]
  .map(id => document.getElementById(id) as HTMLInputElement | HTMLButtonElement);
let nodes: UiNode[] = [], selected: UiNode | undefined, selectedId: number | undefined;
let objects: EditableObject[] = [], targets: Target[] = [], chosen: Target | undefined;
let arrangeEnabled = false;
const objectList = document.getElementById("objects") as HTMLSelectElement;
const arrangeButtons = ["back","backward","forward","front"].map(id=>document.getElementById(id) as HTMLButtonElement);
const deleteButton = document.getElementById("delete-object") as HTMLButtonElement;
let token = 0, viewBox: EditingMetadata["viewBox"] = [0,0,1,1];
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const canvas = document.getElementById("canvas")!;
const tool = document.getElementById("tool") as HTMLSelectElement;
const draft = document.getElementById("draft")!;
const labelEditor = document.getElementById("label-editor")!;
const labelText = document.getElementById("label-text") as HTMLTextAreaElement;
const labelSave = document.getElementById("label-save") as HTMLButtonElement;
const labelError = document.getElementById("label-error")!;
let busy = false, canInsert = false;
let cancelGesture: (() => void) | undefined;
let presentationRevision = 0;

function updateTool(): void {
  cancelGesture?.();
  labelEditor.hidden = true;
  canvas.classList.toggle("drawing", tool.value !== "select");
  status.textContent = tool.value === "select"
    ? t("Edit arrows with the round start/end handles, square bend handles, and diamond curve-control handles. You can also enter coordinates under “Arrow edit points” above. Endpoints snap to node centers, edges, and corners (hold Alt to disable). Double-click to edit text. Tab to select. Changes can be undone in the source.")
    : tool.value === "text" ? t("Click the canvas to add text, then double-click to edit it.")
    : t("Drag on the canvas to add. Press Esc to cancel.");
}
function beginLabelEdit(): void {
  if (!selected || busy) return;
  tool.value = "select"; updateTool();
  labelText.value = selected.label;
  labelError.textContent = "";
  labelEditor.hidden = false;
  const rect = diagram.getBoundingClientRect();
  const left = rect.left+(selected.bounds[0]-viewBox[0])/viewBox[2]*rect.width;
  const top = rect.top+(selected.bounds[1]-viewBox[1])/viewBox[3]*rect.height;
  labelEditor.style.left = `${Math.max(8,Math.min(left,window.innerWidth-labelEditor.offsetWidth-8))}px`;
  labelEditor.style.top = `${Math.max(8,Math.min(top,window.innerHeight-labelEditor.offsetHeight-8))}px`;
  labelText.focus();
}
function submit(message: object): void {
  if (busy) return;
  busy = true;
  canvas.setAttribute("aria-busy","true");
  host.postMessage({...message, token});
}
function select(node?: UiNode): void {
  selected = node;
  controls.forEach(c => c.disabled = !node || busy);
  document.getElementById("selected")!.textContent = node ? node.label || t("Empty node") : t("Click a label to select");
  selectedId = node?.id;
  if (!node) return;
  document.getElementById("selected")!.textContent = node.label || t("Empty node");
  for (const key of ["bold", "italic", "underline"] as const) document.getElementById(key)!.setAttribute("aria-pressed", String(node[key]));
  input("font-size").value = String(Number(node.fontSize.toFixed(2)));
  input("node-x").value = (node.x*2.54/72).toFixed(3);
  input("node-y").value = (node.y*2.54/72).toFixed(3);
}
function selectTarget(target?: Target): void {
  if (chosen?.object?.id !== target?.object?.id) pointIndex = 0;
  chosen = target;
  select(target?.node);
  if (target) document.getElementById("selected")!.textContent = target.label;
  const path = !target?.node && target?.object?.kind==="path" && target.object.editable ? target.object : undefined;
  if(path) {
    input("node-x").value=((path.bounds[0]+path.bounds[2]/2)*2.54/72).toFixed(3);
    input("node-y").value=(-(path.bounds[1]+path.bounds[3]/2)*2.54/72).toFixed(3);
    for(const id of ["node-x","node-y","move"]) input(id).disabled=false;
  }
  deleteButton.disabled = !target?.object?.editable || (!!target.node && target.object.kind==="matrix");
  objectList.value = target?.key ?? "";
  const ordered = objects.filter(o=>o.visible).sort((a,b)=>a.order-b.order);
  const index = ordered.findIndex(o=>o.id===target?.object?.id);
  for (const button of arrangeButtons) button.disabled = !arrangeEnabled || index<0 ||
    ((button.id==="back" || button.id==="backward") ? index===0 : index===ordered.length-1);
  for (const hit of Array.from(overlay.children)) hit.classList.toggle("selected", (hit as HTMLElement).dataset.key===target?.key);
  buildEndpoints();
}
function pathPoints(): PathPoint[] {
  const object = chosen?.object;
  if (!object?.editable || object.kind !== "path") return [];
  return object.pathPoints ?? (object.endpoints ?? []).map((p,i)=>({...p,kind:i===0?"start":"end",replacement:"coordinate"}));
}
function pointLabel(point: PathPoint, index: number): string {
  return point.kind === "start" ? t("Start") : point.kind === "end" ? t("End") : point.kind === "bend" ? t("Bend {0}",index) : t("Control {0}",index);
}
function syncPointInputs(): void {
  const points = pathPoints(), point = points[pointIndex];
  pointPicker.value = String(pointIndex);
  for (const element of [pointPicker,anchorPicker,input("path-x"),input("path-y"),input("path-apply")]) element.disabled = busy || !point;
  anchorPicker.disabled = busy || !point || !["start","end"].includes(point.kind);
  anchorPicker.value = "";
  if (point) { input("path-x").value = (point.x*2.54/72).toFixed(4); input("path-y").value = (point.y*2.54/72).toFixed(4); }
  for (const handle of Array.from(endpoints.children)) handle.classList.toggle("active",(handle as HTMLElement).dataset.point===String(pointIndex));
}
function submitPoint(index:number,x:number,y:number,reference?:string): void {
  if (!chosen?.object || busy) return;
  // Keep compatibility with older renderers that only expose endpoints.
  submit(chosen.object.pathPoints ? {type:"move-path-point",objectId:chosen.object.id,point:index,x,y,reference} :
    {type:"move-endpoint",objectId:chosen.object.id,endpoint:index,x,y,reference});
  syncPointInputs();
}
function buildEndpoints(): void {
  endpoints.replaceChildren(); pointPicker.replaceChildren(); anchorPicker.replaceChildren();
  const object = chosen?.object, points = pathPoints();
  pathEditor.hidden = object?.kind !== "path";
  document.getElementById("path-hint")!.textContent = points.length ? t("Drag or enter coordinates to change") :
    object?.pathPoints == null && object?.endpoints == null ? t("Edit points are unavailable. Update the Rust executable.") : t("Edit this path's points in the source.");
  if (pointIndex >= points.length) pointIndex = 0;
  const free = document.createElement("option"); free.value=""; free.textContent=t("Free coordinate"); anchorPicker.appendChild(free);
  for (const anchor of anchors) {
    const option=document.createElement("option");option.value=anchor.reference;option.textContent=anchor.reference;anchorPicker.appendChild(option);
  }
  for (const [index,point] of points.entries()) {
    const label = pointLabel(point,index);
    const option = document.createElement("option"); option.value=String(index);option.textContent=label;pointPicker.appendChild(option);
    const handle = document.createElement("button");
    handle.className = `endpoint ${point.kind}`;
    handle.dataset.point = String(index);
    handle.title = t("Drag {0}",label);
    handle.setAttribute("aria-label",handle.title);
    const place = (x: number, y: number) => {
      handle.style.left = `${(x-viewBox[0])/viewBox[2]*100}%`;
      handle.style.top = `${(-y-viewBox[1])/viewBox[3]*100}%`;
    };
    place(point.x,point.y);
    handle.addEventListener("click", () => { if(!busy) {pointIndex=index;syncPointInputs();} });
    handle.addEventListener("keydown", event => {
      if(busy || event.isComposing) return;
      const delta:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};
      if(!delta[event.key]) return;
      event.preventDefault(); pointIndex=index;
      const [dx,dy]=delta[event.key],step=event.shiftKey?10:1;
      submitPoint(index,point.x+dx*step,point.y+dy*step);
    });
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || busy || tool.value !== "select") return;
      event.preventDefault(); event.stopPropagation();
      cancelGesture?.(); pointIndex=index;syncPointInputs();
      canvas.focus({preventScroll:true}); labelEditor.hidden = true;
      handle.setPointerCapture(event.pointerId);
      const rect = diagram.getBoundingClientRect();
      const locate = (e: PointerEvent) => {
        let x = point.x + (e.clientX-event.clientX)/rect.width*viewBox[2];
        let y = point.y - (e.clientY-event.clientY)/rect.height*viewBox[3];
        let snap: NodeAnchor | undefined, distance = 12;
        if (!e.altKey && ["start","end"].includes(point.kind)) for (const anchor of anchors) {
          const d = Math.hypot((anchor.x-x)/viewBox[2]*rect.width,(anchor.y-y)/viewBox[3]*rect.height);
          if (d < distance) { distance = d; snap = anchor; }
        }
        if (snap) { x = snap.x; y = snap.y; }
        return {x,y,reference:snap?.reference};
      };
      const move = (e: PointerEvent) => {
        const next=locate(e);place(next.x,next.y);handle.title=next.reference ?? label;
        input("path-x").value=(next.x*2.54/72).toFixed(4);input("path-y").value=(next.y*2.54/72).toFixed(4);
      };
      const cancel = () => {
        handle.removeEventListener("pointermove",move); handle.removeEventListener("pointerup",finish); handle.removeEventListener("pointercancel",cancel);
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        place(point.x,point.y); cancelGesture = undefined;syncPointInputs();
      };
      const finish = (e: PointerEvent) => {
        const next = locate(e); cancel();
        if (Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY) <= 2) return;
        place(next.x,next.y);submitPoint(index,next.x,next.y,next.reference);
      };
      cancelGesture = cancel;
      handle.addEventListener("pointermove",move); handle.addEventListener("pointerup",finish); handle.addEventListener("pointercancel",cancel);
    });
    endpoints.appendChild(handle);
  }
  syncPointInputs();
  positionOverlay();
}
pointPicker.addEventListener("change",()=>{if(!busy){pointIndex=Number(pointPicker.value);syncPointInputs();}});
anchorPicker.addEventListener("change",()=>{
  const anchor=anchors.find(a=>a.reference===anchorPicker.value);
  if(anchor) {input("path-x").value=(anchor.x*2.54/72).toFixed(4);input("path-y").value=(anchor.y*2.54/72).toFixed(4);}
});
for(const id of ["path-x","path-y"]) input(id).addEventListener("input",()=>{anchorPicker.value="";});
input("path-apply").addEventListener("click",()=>{
  if(!input("path-x").value.trim() || !input("path-y").value.trim()) return;
  const x=Number(input("path-x").value)*72/2.54,y=Number(input("path-y").value)*72/2.54;
  if(Number.isFinite(x)&&Number.isFinite(y)) submitPoint(pointIndex,x,y,anchorPicker.value||undefined);
});
function edit(change: NodeEdit): void {
  if (!selected || busy) return;
  submit({type:"edit", id:selected.id, edit:change});
}
function positionOverlay(): void {
  for (const layer of [overlay,endpoints]) {
    layer.style.left = `${diagram.offsetLeft}px`; layer.style.top = `${diagram.offsetTop}px`;
    layer.style.width = `${diagram.clientWidth}px`; layer.style.height = `${diagram.clientHeight}px`;
  }
}
function buildOverlay(): void {
  overlay.replaceChildren?.();
  objectList.replaceChildren();
  const placeholder = document.createElement("option"); placeholder.value=""; placeholder.textContent=t("Choose…"); objectList.appendChild(placeholder);
  targets = selectionTargets(nodes,objects);
  for (const [index,target] of [...targets].reverse().entries()) {
    const option = document.createElement("option"); option.value=target.key; option.textContent=`${index+1}: ${target.label.slice(0,70)}`; objectList.appendChild(option);
  }
  objectList.disabled = targets.length===0;
  for (const target of targets) {
    const node = target.node;
    const hit = document.createElement("button"); hit.className = "node-hit"; hit.dataset.key = target.key;
    hit.title = target.label; hit.setAttribute("aria-label", t("Select: {0}",hit.title));
    const [x,y,w,h] = target.bounds;
    hit.style.left = `${(x-viewBox[0])/viewBox[2]*100}%`; hit.style.top = `${(y-viewBox[1])/viewBox[3]*100}%`;
    hit.style.width = `${Math.max(w,3)/viewBox[2]*100}%`; hit.style.height = `${Math.max(h,3)/viewBox[3]*100}%`;
    hit.addEventListener("click", event => {
      if (busy) return;
      if (event.altKey) {
        const rect=diagram.getBoundingClientRect();
        const overlaps=overlappingTargets(targets,viewBox[0]+(event.clientX-rect.left)/rect.width*viewBox[2],viewBox[1]+(event.clientY-rect.top)/rect.height*viewBox[3]);
        const index=overlaps.findIndex(t=>t.key===chosen?.key);
        selectTarget(overlaps[(index+1)%overlaps.length]);
      } else selectTarget(target);
    });
    hit.addEventListener("dblclick", () => {if(node) beginLabelEdit();});
    hit.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === "F2") { event.preventDefault(); selectTarget(target); if(node) beginLabelEdit(); } });
    hit.addEventListener("pointerdown", event => {
      if (event.button !== 0 || busy || tool.value !== "select") return;
      event.stopPropagation();
      canvas.focus({preventScroll:true});
      if (event.altKey) return;
      labelEditor.hidden = true;
      selectTarget(target);
      if (!node && !(target.object?.kind==="path" && target.object.editable)) return;
      hit.setPointerCapture(event.pointerId);
      const startX=event.clientX,startY=event.clientY;
      const move = (e: PointerEvent) => { hit.style.transform=`translate(${e.clientX-startX}px,${e.clientY-startY}px)`; };
      const finish = (e: PointerEvent) => {
        cancel();
        const dx=e.clientX-startX,dy=e.clientY-startY;
        if (Math.hypot(dx,dy)>2 && chosen?.key===target.key) {
          hit.style.transform=`translate(${dx}px,${dy}px)`;
          const moveX=dx/diagram.clientWidth*viewBox[2], moveY=-dy/diagram.clientHeight*viewBox[3];
          if(node) edit({action:"move",x:node.x+moveX,y:node.y+moveY});
          else submit({type:"move-object",objectId:target.object!.id,dx:moveX,dy:moveY});
        }
      };
      const cancel = () => {hit.removeEventListener("pointermove",move);hit.removeEventListener("pointerup",finish);hit.removeEventListener("pointercancel",cancel);hit.style.transform="";cancelGesture=undefined;};
      cancelGesture = cancel;
      hit.addEventListener("pointermove",move);hit.addEventListener("pointerup",finish);hit.addEventListener("pointercancel",cancel);
    });
    overlay.appendChild(hit);
  }
  selectTarget(targets.find(t=>t.key===chosen?.key) ?? targets.find(t=>t.node?.id===selectedId && selectedId!=null));
}
function clear(): void {
  ++presentationRevision;
  cancelGesture?.();
  busy = false; canInsert = false; tool.disabled = true; labelSave.disabled = false;
  labelEditor.hidden = draft.hidden = true;
  nodes = []; anchors=[]; objects=[]; targets=[]; chosen=undefined; arrangeEnabled=false; selectTarget(); overlay.replaceChildren?.(); objectList.disabled=true;
  canvas.setAttribute("aria-busy","false");
  resetViewport();
  diagram.hidden = true;
  diagram.removeAttribute("src");
  if (svgUrl) URL.revokeObjectURL(svgUrl);
  if (pngUrl) URL.revokeObjectURL(pngUrl);
  svgUrl = pngUrl = "";
  svgButton.disabled = pngButton.disabled = true;
}
function display(): void {
  const url = format.value === "png" ? pngUrl : svgUrl;
  if (!url) return;
  diagram.src = url;
  diagram.hidden = false;
}
function resetViewport(): void {
  canvas.style.width = canvas.style.height = "";
  for (const key of ["position","left","top","width","height","maxWidth"] as const) diagram.style[key] = "";
}
function preserveViewport(next: EditingMetadata["viewBox"]): void {
  const sx=diagram.clientWidth/viewBox[2], sy=diagram.clientHeight/viewBox[3];
  const left=diagram.offsetLeft+(next[0]-viewBox[0])*sx;
  const top=diagram.offsetTop+(next[1]-viewBox[1])*sy;
  canvas.style.width=`${canvas.clientWidth}px`; canvas.style.height=`${canvas.clientHeight}px`;
  Object.assign(diagram.style,{position:"absolute",left:`${left}px`,top:`${top}px`,width:`${next[2]*sx}px`,height:`${next[3]*sy}px`,maxWidth:"none"});
}
async function present(data: any): Promise<void> {
  const revision=++presentationRevision;
  const nextSvg=URL.createObjectURL(new Blob([data.svg],{type:"image/svg+xml"}));
  const bytes=Uint8Array.from(atob(data.png),c=>c.charCodeAt(0));
  const nextPng=URL.createObjectURL(new Blob([bytes],{type:"image/png"}));
  let committed=false;
  try {
    const svg=new Image(), png=new Image(); svg.src=nextSvg; png.src=nextPng;
    await Promise.all([svg.decode(),png.decode()]);
    if(revision!==presentationRevision) return;
    cancelGesture?.();
    if(data.preserveViewport && !diagram.hidden && data.editing) preserveViewport(data.editing.viewBox);
    else resetViewport();
    const oldSvg=svgUrl, oldPng=pngUrl;
    svgUrl=nextSvg; pngUrl=nextPng;
    diagram.width=svg.naturalWidth; diagram.height=svg.naturalHeight;
    token=data.token;
    nodes=data.editing?.nodes ?? []; objects=data.editing?.objects ?? []; anchors=data.editing?.anchors ?? [];
    viewBox=data.editing?.viewBox ?? [0,0,1,1];
    arrangeEnabled=!!data.editing?.canArrange;
    if(data.selection) {
      selectedId=data.selection.nodeId;
      chosen=undefined;
      const candidates=selectionTargets(nodes,objects);
      chosen=candidates.find(t=>t.node?.id===selectedId && selectedId!=null) ?? candidates.find(t=>t.object?.id===data.selection.objectId && data.selection.objectId!=null);
    }
    busy=false; canvas.setAttribute("aria-busy","false");
    buildOverlay();
    canInsert=Number.isInteger(data.editing?.insertionOffset); tool.disabled=!canInsert;
    if(!canInsert) tool.value="select";
    updateTool();
    svgButton.disabled=pngButton.disabled=false;
    display(); positionOverlay();
    committed=true;
    // The replacement is already decoded before releasing the visible buffers.
    if(oldSvg) URL.revokeObjectURL(oldSvg);
    if(oldPng) URL.revokeObjectURL(oldPng);
  } catch(error) {
    if(revision===presentationRevision) {clear();status.textContent=t("Could not display the image: {0}",String(error));}
  } finally {
    if(!committed) {URL.revokeObjectURL(nextSvg);URL.revokeObjectURL(nextPng);}
  }
}
window.addEventListener("message", ({ data }) => {
  if (data?.type === "pending") { clear(); status.textContent = t("Compiling…"); }
  if (data?.type === "error") { clear(); status.textContent = data.message; }
  if (data?.type === "edit-error" && data.token === token) {
    for(const hit of Array.from(overlay.children)) (hit as HTMLElement).style.transform="";
    busy = false; canvas.setAttribute("aria-busy","false"); selectTarget(chosen); tool.disabled = !canInsert; labelSave.disabled = false;
    status.textContent = labelError.textContent = data.message;
  }
  if (data?.type === "render") void present(data);
});
objectList.addEventListener("change",()=>{if(!busy) selectTarget(targets.find(t=>t.key===objectList.value));});
for(const button of arrangeButtons) button.addEventListener("click",()=>{
  if(chosen?.object && !button.disabled) submit({type:"arrange",objectId:chosen.object.id,id:selected?.id,action:button.id});
});
function removeSelected(): void {
  if(chosen?.object && !deleteButton.disabled) submit({type:"delete",objectId:chosen.object.id,id:selected?.id});
}
deleteButton.addEventListener("click",removeSelected);
tool.addEventListener("change", updateTool);
document.getElementById("edit-label")!.addEventListener("click", beginLabelEdit);
labelSave.addEventListener("click", () => edit({action:"text", text:labelText.value}));
document.getElementById("label-cancel")!.addEventListener("click", () => { labelEditor.hidden = true; });
labelText.addEventListener("keydown", event => {
  if (event.isComposing) return;
  if (event.key === "Escape") { event.preventDefault(); labelEditor.hidden = true; }
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); edit({action:"text", text:labelText.value}); }
});
window.addEventListener("keydown", event => {
  const target=event.target as HTMLElement;
  if((event.key==="Delete" || event.key==="Backspace") && (target===canvas || target===objectList || (target?.classList?.contains("node-hit") || target?.classList?.contains("endpoint")))) {
    event.preventDefault();removeSelected();
  }
  if(event.key==="Tab" && !busy && targets.length && (target===canvas || (target?.classList?.contains("node-hit") || target?.classList?.contains("endpoint")))) {
    event.preventDefault();
    const index=targets.findIndex(t=>t.key===chosen?.key);
    selectTarget(targets[(index+(event.shiftKey?-1:1)+targets.length)%targets.length]);
    canvas.focus({preventScroll:true});
  }
  if (event.key === "Escape" && !event.isComposing) { tool.value = "select"; updateTool(); }
});
canvas.addEventListener("pointerdown", event => {
  if (event.button !== 0 || busy || !canInsert || tool.value === "select" || diagram.hidden || !labelEditor.hidden) return;
  event.preventDefault();
  const kind = tool.value as DrawingTool;
  const rect = diagram.getBoundingClientRect(), frame = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  // SVG viewBox Y points down; source-space Y points up. Capture the dimensions
  // once, so dragging outside the image or over a scrolled canvas is consistent.
  const point = (x: number, y: number): [number, number] => [viewBox[0]+(x-rect.left)/rect.width*viewBox[2], -(viewBox[1]+(y-rect.top)/rect.height*viewBox[3])];
  const start = point(event.clientX,event.clientY), x = event.clientX, y = event.clientY;
  canvas.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => {
    const dx = e.clientX-x, dy = e.clientY-y;
    const line = kind === "line" || kind === "arrow";
    let w = Math.abs(dx), h = Math.abs(dy);
    if (kind === "circle") w = h = Math.max(w,h);
    draft.hidden = kind === "text";
    draft.classList.toggle("line", line);
    draft.classList.toggle("round", kind === "circle" || kind === "ellipse");
    draft.style.left = `${(line ? x : (x+e.clientX-w)/2)-frame.left}px`;
    draft.style.top = `${(line ? y : (y+e.clientY-h)/2)-frame.top}px`;
    draft.style.width = `${line ? Math.hypot(dx,dy) : w}px`;
    draft.style.height = `${line ? 0 : h}px`;
    draft.style.transform = line ? `rotate(${Math.atan2(dy,dx)}rad)` : "";
  };
  const cancel = () => {
    canvas.removeEventListener("pointermove",move); canvas.removeEventListener("pointerup",finish); canvas.removeEventListener("pointercancel",cancel);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    draft.hidden = true; cancelGesture = undefined;
  };
  const finish = (e: PointerEvent) => {
    cancel();
    if (kind !== "text" && Math.hypot(e.clientX-x,e.clientY-y)<3) return;
    submit({type:"insert", drawing:{tool:kind, start, end:point(e.clientX,e.clientY)}});
    tool.value = "select"; updateTool();
  };
  cancelGesture = cancel;
  canvas.addEventListener("pointermove",move); canvas.addEventListener("pointerup",finish); canvas.addEventListener("pointercancel",cancel);
});
format.addEventListener("change", display);
const languagePicker = document.getElementById("language") as HTMLSelectElement;
languagePicker.addEventListener("change", () => host.postMessage({ type: "language", value: languagePicker.value }));
document.getElementById("fit")!.addEventListener("click", () => {resetViewport();diagram.classList.toggle("fit");});
diagram.addEventListener("load", positionOverlay);
window.addEventListener("resize", () => {resetViewport();positionOverlay();});
document.getElementById("fit")!.addEventListener("click", positionOverlay);
for (const action of ["bold","italic","underline"] as const) document.getElementById(action)!.addEventListener("click",()=>edit({action}));
document.getElementById("smaller")!.addEventListener("click",()=>edit({action:"size",value:Math.max(1,(selected?.fontSize ?? 10)-1)}));
document.getElementById("larger")!.addEventListener("click",()=>edit({action:"size",value:Math.min(200,(selected?.fontSize ?? 10)+1)}));
input("font-size").addEventListener("change",()=>edit({action:"size",value:Number(input("font-size").value)}));
document.getElementById("move")!.addEventListener("click",()=>{
  const x=Number(input("node-x").value)*72/2.54,y=Number(input("node-y").value)*72/2.54;
  if(selected) edit({action:"move",x,y});
  else if(chosen?.object?.kind==="path") {
    const [left,top,width,height]=chosen.object.bounds;
    submit({type:"move-object",objectId:chosen.object.id,dx:x-left-width/2,dy:y+top+height/2});
  }
});
svgButton.addEventListener("click", () => host.postMessage({ type: "export", format: "svg" }));
pngButton.addEventListener("click", () => host.postMessage({ type: "export", format: "png" }));
window.addEventListener("unload", clear);
host.postMessage({ type: "ready" });
export {};
