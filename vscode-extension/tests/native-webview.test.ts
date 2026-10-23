import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { setTimeout as tick } from "node:timers/promises";

const code=buildSync({entryPoints:[fileURLToPath(new URL("../webview/native-preview.ts",import.meta.url))],bundle:true,write:false,format:"iife"}).outputFiles[0].text;
class Element {
  id=""; value=""; textContent=""; hidden=false; disabled=false; src="";
  style:Record<string,string>={}; dataset:Record<string,string>={};
  children:Element[]=[]; handlers=new Map<string,Set<(e:any)=>void>>();
  clientWidth=200; clientHeight=100; offsetLeft=48; offsetTop=48; offsetWidth=200; offsetHeight=100;
  classes=new Set<string>();
  classList={toggle:(key:string,active?:boolean)=>{if(active??!this.classes.has(key))this.classes.add(key);else this.classes.delete(key);},contains:(key:string)=>this.classes.has(key)};
  addEventListener(name:string,fn:(e:any)=>void){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name)!.add(fn);}
  removeEventListener(name:string,fn:(e:any)=>void){this.handlers.get(name)?.delete(fn);}
  fire(name:string,event:any={}){for(const fn of [...this.handlers.get(name)??[]])fn({button:0,pointerId:1,preventDefault(){},stopPropagation(){},...event});}
  removeAttribute(key:string){delete (this as any)[key];} setAttribute(){} focus(){} setPointerCapture(){} releasePointerCapture(){} hasPointerCapture(){return true;}
  replaceChildren(){this.children=[];} appendChild(child:Element){this.children.push(child);}
  getBoundingClientRect(){return {left:100,top:80,width:this.clientWidth,height:this.clientHeight};}
}
function setup(lang="en") {
  const elements=new Map<string,Element>();
  const el=(id:string)=>{if(!elements.has(id)){const element=new Element();element.id=id;elements.set(id,element);}return elements.get(id)!;};
  el("tool").value="select";el("format").value="svg";el("diagram").hidden=true;
  const window=Object.assign(new Element(),{innerWidth:1000,innerHeight:600}),sent:any[]=[],blobs=new Map<string,Blob>();
  let id=0,delay=false;const decoders:Array<()=>void>=[];
  class Image {src="";naturalWidth=200;naturalHeight=100;decode(){return delay?new Promise<void>(resolve=>decoders.push(resolve)):Promise.resolve();}}
  runInNewContext(code,{document:{documentElement:{lang},getElementById:el,createElement:()=>new Element()},window,Image,acquireVsCodeApi:()=>({postMessage:(m:any)=>sent.push(m)}),Blob,Uint8Array,atob,URL:{createObjectURL:(blob:Blob)=>{const key=`blob:${++id}`;blobs.set(key,blob);return key;},revokeObjectURL:(key:string)=>blobs.delete(key)}});
  const message=(data:any)=>window.fire("message",{data});
  const payload=(editing?:any,extra:any={})=>({type:"render",token:7,svg:'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10"/></svg>',png:Buffer.from([137,80,78,71]).toString("base64"),editing,...extra});
  return {el,window,sent,blobs,message,payload,delay:()=>{delay=true;},decode:()=>{delay=false;for(const done of decoders.splice(0))done();}};
}
const label="日本語".repeat(60)+String.raw` $x^2$`;
const metadata={viewBox:[-10,-20,100,50],insertionOffset:100,nodes:[{id:3,label,bounds:[0,0,30,10],fontSize:10,x:5,y:6}]};

test("webview displays exact SVG/PNG payloads and clears stale images on external edits/errors",async()=>{
  const h=setup();assert.equal(h.sent[0].type,"ready");const data=h.payload();
  h.message(data);await tick(0);
  const img=h.el("diagram");assert.equal(await h.blobs.get(img.src)!.text(),data.svg);
  h.el("format").value="png";h.el("format").fire("change");
  assert.deepEqual(Buffer.from(await h.blobs.get(img.src)!.arrayBuffer()),Buffer.from(data.png,"base64"));
  h.el("export").fire("click");assert.equal(h.sent.at(-1).type,"export");assert.equal(h.sent.at(-1).format,"png");
  h.message({type:"pending"});assert.equal(img.hidden,true);assert.equal(img.src,undefined);assert.equal(h.blobs.size,0);
  h.message({type:"error",message:"Unsupported syntax"});assert.equal(h.el("status").textContent,"Unsupported syntax");
});

test("webview messages follow the selected language and the toggle reports changes",async()=>{
  const en=setup();en.message({type:"pending"});assert.equal(en.el("status").textContent,"Compiling…");
  en.el("language").value="ja";en.el("language").fire("change");assert.equal(en.sent.at(-1).type,"language");assert.equal(en.sent.at(-1).value,"ja");
  const ja=setup("ja");ja.message({type:"pending"});assert.equal(ja.el("status").textContent,"コンパイル中…");
});

test("GUI images swap only after decoding, preserve viewport and selection, and cancel stale decodes",async()=>{
  const h=setup();h.message(h.payload(metadata));await tick(0);
  h.el("overlay").children[0].fire("click");
  const img=h.el("diagram"),old=img.src,status=h.el("status").textContent;
  h.el("bold").fire("click");assert.equal(h.el("status").textContent,status);assert.equal(img.src,old);assert.equal(img.hidden,false);
  h.delay();h.message(h.payload({...metadata,viewBox:[-20,-30,150,80],nodes:[{...metadata.nodes[0],id:8}]},{token:8,preserveViewport:true,selection:{nodeId:8}}));
  await tick(0);assert.equal(img.src,old);assert.equal(img.hidden,false);assert.ok(h.blobs.has(old));
  h.decode();await tick(0);
  assert.notEqual(img.src,old);assert.equal(img.hidden,false);assert.ok(!h.blobs.has(old));assert.equal(h.blobs.size,2);
  assert.equal(img.style.left,"28px");assert.equal(img.style.top,"28px");assert.equal(img.style.width,"300px");
  assert.equal(h.el("objects").value,"n8");assert.equal(h.el("status").textContent,status);
  h.delay();h.message(h.payload(metadata,{token:9,preserveViewport:true}));h.message({type:"pending"});h.decode();await tick(0);
  assert.equal(img.hidden,true);assert.equal(h.blobs.size,0,"invalidated decode cannot revive an old diagram or leak blobs");
});

test("full label edits retain IME-safe shortcuts and failed edits retain their draft",async()=>{
  const h=setup();h.message(h.payload(metadata));await tick(0);
  const hit=h.el("overlay").children[0];hit.fire("click");hit.fire("dblclick");
  assert.equal(h.el("label-text").value,label);h.el("label-text").value="変更";
  h.el("label-text").fire("keydown",{key:"Enter",ctrlKey:true,isComposing:true});assert.equal(h.sent.length,1);
  h.el("label-text").fire("keydown",{key:"Enter",metaKey:true});assert.equal(h.sent.at(-1).edit.text,"変更");
  h.el("label-save").fire("click");assert.equal(h.sent.length,2);
  h.message({type:"edit-error",token:7,message:"bad syntax"});assert.equal(h.el("label-editor").hidden,false);assert.equal(h.el("label-text").value,"変更");
});

test("drawing uses SVG/PNG coordinates and cancels gestures on Escape or source revisions",async()=>{
  const h=setup();
  for(const format of ["svg","png"]){
    h.message(h.payload(metadata));await tick(0);h.el("format").value=format;h.el("format").fire("change");
    h.el("tool").value="arrow";h.el("tool").fire("change");h.el("canvas").fire("pointerdown",{clientX:120,clientY:100});
    h.el("canvas").fire("pointermove",{clientX:260,clientY:140});assert.equal(h.el("draft").hidden,false);
    h.el("canvas").fire("pointerup",{clientX:260,clientY:140});
    assert.equal(JSON.stringify(h.sent.at(-1).drawing),JSON.stringify({tool:"arrow",start:[0,10],end:[70,-10]}));
  }
  for(const cancel of [()=>h.window.fire("keydown",{key:"Escape"}),()=>h.message({type:"pending"})]){
    h.message(h.payload(metadata));await tick(0);h.el("tool").value="rectangle";h.el("tool").fire("change");
    const before=h.sent.length;h.el("canvas").fire("pointerdown",{clientX:120,clientY:100});cancel();h.el("canvas").fire("pointerup",{clientX:260,clientY:140});assert.equal(h.sent.length,before);
  }
});

test("nested objects can be selected through Alt-click, Tab and the list before arranging",async()=>{
  const h=setup();
  const objects=[{id:0,kind:"node",bounds:[-10,-20,100,50],order:1,visible:true},{id:20,kind:"node",bounds:[0,-10,20,20],order:0,visible:true}];
  const nodes=objects.map((o,i)=>({...metadata.nodes[0],id:i+1,objectId:o.id,bounds:o.bounds,label:i?"inner":"outer"}));
  h.message(h.payload({...metadata,nodes,objects,canArrange:true}));await tick(0);
  const outer=h.el("overlay").children.find(e=>e.dataset.key==="n1")!;
  outer.fire("click");assert.equal(h.el("objects").value,"n1");assert.equal(h.el("forward").disabled,true);
  outer.fire("click",{altKey:true,clientX:140,clientY:120});assert.equal(h.el("objects").value,"n2");
  assert.equal(h.el("forward").disabled,false);assert.equal(h.el("backward").disabled,true);
  h.el("forward").fire("click");assert.equal(h.sent.at(-1).type,"arrange");assert.equal(h.sent.at(-1).objectId,20);
  h.message({type:"edit-error",token:7,message:"retry"});
  h.window.fire("keydown",{key:"Tab",target:h.el("canvas")});assert.equal(h.el("objects").value,"n1");
  h.el("objects").value="n2";h.el("objects").fire("change");assert.equal(h.el("selected").textContent,"inner");
});

test("arrows can be dragged, positioned and deleted without intercepting text-input deletion",async()=>{
  const h=setup();
  const data=h.payload({...metadata,nodes:[],objects:[{id:20,kind:"path",bounds:[0,-10,40,20],order:0,visible:true,editable:true}]});
  h.message(data);await tick(0);
  const hit=h.el("overlay").children[0];hit.fire("click");
  assert.equal(h.el("move").disabled,false);assert.equal(h.el("bold").disabled,true);
  hit.fire("pointerdown",{clientX:100,clientY:100});hit.fire("pointermove",{clientX:120,clientY:110});hit.fire("pointerup",{clientX:120,clientY:110});
  assert.equal(JSON.stringify(h.sent.at(-1)),JSON.stringify({type:"move-object",objectId:20,dx:10,dy:-5,token:7}));
  h.message(data);await tick(0);
  h.el("node-x").value="2.54";h.el("node-y").value="2.54";h.el("move").fire("click");
  assert.equal(h.sent.at(-1).dx,52);assert.equal(h.sent.at(-1).dy,72);
  h.message(data);await tick(0);
  const count=h.sent.length;
  for(const target of [h.el("node-x"),h.el("label-text")]) h.window.fire("keydown",{key:"Delete",target});
  assert.equal(h.sent.length,count);
  h.window.fire("keydown",{key:"Delete",target:h.el("canvas")});
  assert.equal(h.sent.at(-1).type,"delete");assert.equal(h.sent.at(-1).objectId,20);
  h.message(data);await tick(0);h.el("delete-object").fire("click");
  assert.equal(h.sent.length,count+2);
});

test("endpoint handles move only one arrow end, snap to anchors and cancel without edits", async()=>{
  const h=setup();
  const arrow={id:20,kind:"path",bounds:[0,-10,40,20],order:0,visible:true,editable:true,
    endpoints:[{x:0,y:0},{x:40,y:10}]};
  const data=h.payload({...metadata,nodes:[],objects:[arrow],anchors:[{reference:"b.north",x:60,y:20}]});
  for(const format of ["svg","png"]) {
    h.message(data);await tick(0);h.el("format").value=format;h.el("format").fire("change");
    h.el("overlay").children[0].fire("click");
    assert.equal(h.el("endpoints").children.length,2);
    const end=h.el("endpoints").children[1];
    end.fire("pointerdown",{clientX:200,clientY:100});
    end.fire("pointermove",{clientX:239,clientY:81});
    end.fire("pointerup",{clientX:239,clientY:81});
    assert.equal(JSON.stringify(h.sent.at(-1)),JSON.stringify({type:"move-endpoint",objectId:20,endpoint:1,x:60,y:20,reference:"b.north",token:7}));
    h.message({type:"edit-error",token:7,message:"retry"});
    const start=h.el("endpoints").children[0];
    start.fire("pointerdown",{clientX:100,clientY:100});
    start.fire("pointerup",{clientX:110,clientY:110,altKey:true});
    assert.equal(JSON.stringify(h.sent.at(-1)),JSON.stringify({type:"move-endpoint",objectId:20,endpoint:0,x:5,y:-5,token:7}));
  }
  for(const cancel of [()=>h.window.fire("keydown",{key:"Escape"}),()=>h.message({type:"pending"})]) {
    h.message(data);await tick(0);h.el("overlay").children[0].fire("click");
    const end=h.el("endpoints").children[1],before=h.sent.length;
    end.fire("pointerdown",{clientX:200,clientY:100});cancel();end.fire("pointerup",{clientX:240,clientY:80});
    assert.equal(h.sent.length,before);
  }
});

test("start, end and bend controls remain available when selecting an arrow label and support numeric edits",async()=>{
  const h=setup();
  const pathPoints=[{x:0,y:0,kind:"start"},{x:20,y:0,kind:"bend"},{x:20,y:10,kind:"bend"},{x:40,y:10,kind:"end"}];
  const object={id:20,kind:"path",bounds:[0,-10,40,20],order:0,visible:true,editable:true,pathPoints};
  const data=h.payload({...metadata,objects:[object],nodes:[{...metadata.nodes[0],objectId:20}],anchors:[{reference:"b.north",x:60,y:20}]});
  h.message(data);await tick(0);
  h.el("overlay").children.find(e=>e.dataset.key==="n3")!.fire("click");
  assert.equal(h.el("path-editor").hidden,false);assert.equal(h.el("endpoints").children.length,4);
  assert.deepEqual(h.el("path-point").children.map(e=>e.textContent),["Start","Bend 1","Bend 2","End"]);
  for(const [index,point] of pathPoints.entries()) {
    h.el("path-point").value=String(index);h.el("path-point").fire("change");
    assert.equal(h.el("path-anchor").disabled,point.kind==="bend");
    h.el("path-x").value="2.54";h.el("path-y").value="1.27";h.el("path-apply").fire("click");
    assert.equal(JSON.stringify(h.sent.at(-1)),JSON.stringify({type:"move-path-point",objectId:20,point:index,x:72,y:36,token:7}));
    assert.equal(h.el("path-apply").disabled,true);
    h.message({type:"edit-error",token:7,message:"retry"});
  }
  const handle=h.el("endpoints").children[2];
  handle.fire("pointerdown",{clientX:140,clientY:120});handle.fire("pointerup",{clientX:164,clientY:96});
  assert.equal(h.sent.at(-1).point,2);assert.equal(h.sent.at(-1).x,32);assert.equal(h.sent.at(-1).y,22);
  h.message({type:"edit-error",token:7,message:"retry"});
  h.el("endpoints").children[0].fire("keydown",{key:"ArrowRight",shiftKey:true});
  assert.equal(h.sent.at(-1).point,0);assert.equal(h.sent.at(-1).x,10);
});

test("Ctrl+wheel zooms by resizing the image and the Fit button leaves the zoom",async()=>{
  const h=setup();h.message(h.payload(metadata));await tick(0);
  const img=h.el("diagram"),viewport=h.el("viewport");let prevented=false;
  viewport.fire("wheel",{deltaY:-100,clientX:150,clientY:100,preventDefault(){prevented=true;}});
  assert.equal(prevented,false);assert.equal(img.style.width,"");
  viewport.fire("wheel",{ctrlKey:true,deltaY:-100,deltaMode:0,clientX:150,clientY:100,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(img.style.width,`${200*Math.exp(0.2)}px`);assert.equal(h.el("canvas").style.maxWidth,"none");
  h.window.fire("resize");assert.equal(img.style.width,`${200*Math.exp(0.2)}px`);
  h.message(h.payload(metadata,{token:8}));await tick(0);assert.equal(img.style.width,`${200*Math.exp(0.2)}px`);
  img.classes.delete("fit");h.el("fit").fire("click");
  assert.equal(img.style.width,"");assert.equal(img.classList.contains("fit"),true);assert.equal(h.el("canvas").style.maxWidth,"");
});

test("Space-drag and middle-drag pan the viewport instead of editing",async()=>{
  const h=setup();h.message(h.payload(metadata));await tick(0);
  const viewport=Object.assign(h.el("viewport"),{scrollLeft:50,scrollTop:40}),before=h.sent.length;
  viewport.fire("pointerdown",{clientX:100,clientY:100});assert.equal(h.el("canvas").classList.contains("panning"),false);
  h.window.fire("keydown",{key:" ",target:h.el("canvas")});assert.equal(h.el("canvas").classList.contains("pan-ready"),true);
  viewport.fire("pointerdown",{clientX:100,clientY:100});viewport.fire("pointermove",{clientX:70,clientY:90});
  assert.deepEqual([viewport.scrollLeft,viewport.scrollTop],[80,50]);viewport.fire("pointerup",{});
  h.window.fire("keyup",{key:" "});assert.equal(h.el("canvas").classList.contains("pan-ready"),false);
  viewport.fire("pointerdown",{button:1,clientX:0,clientY:0});viewport.fire("pointermove",{clientX:10,clientY:10});
  assert.deepEqual([viewport.scrollLeft,viewport.scrollTop],[70,40]);viewport.fire("pointerup",{});
  viewport.fire("pointermove",{clientX:500,clientY:500});assert.equal(viewport.scrollLeft,70);
  h.window.fire("keydown",{key:" ",target:h.el("font-size")});assert.equal(h.el("canvas").classList.contains("pan-ready"),false);
  assert.equal(h.sent.length,before);
});
