import { t } from "../src/preview/i18n";
import type { EditableNode, EditableObject } from "../src/preview/editing";
export type UiNode = EditableNode & {label:string; bold:boolean; italic:boolean; underline:boolean};
export interface Target {key:string; label:string; bounds:[number,number,number,number]; node?:UiNode; object?:EditableObject}

/** Back-to-front targets, independent of DOM hit testing (which hides nested nodes). */
export function selectionTargets(nodes:UiNode[],objects:EditableObject[]):Target[] {
  const targets:Target[]=[];
  for(const object of [...objects].filter(o=>o.visible).sort((a,b)=>a.order-b.order)) {
    const children=nodes.filter(n=>n.objectId===object.id);
    if(object.kind!=="node" || children.length===0) targets.push({key:`o${object.id}`,object,bounds:object.bounds,label:object.kind==="path"?t("Line / path"):object.kind==="matrix"?t("Matrix"):t("Object")});
    for(const node of children) targets.push({key:`n${node.id}`,object,node,bounds:node.bounds,label:node.label || t("Empty node")});
  }
  for(const node of nodes.filter(n=>n.objectId==null || !objects.some(o=>o.id===n.objectId))) targets.push({key:`n${node.id}`,node,bounds:node.bounds,label:node.label || t("Empty node")});
  return targets;
}

export function overlappingTargets(targets:Target[],x:number,y:number):Target[] {
  return targets.filter(t=>{
    const [left,top,width,height]=t.bounds;
    return x>=left && x<=left+Math.max(width,3) && y>=top && y<=top+Math.max(height,3);
  }).reverse();
}
