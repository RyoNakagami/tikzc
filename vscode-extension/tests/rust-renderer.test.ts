import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { RustRenderer } from "../src/preview/renderer";
import { arrangeObject, canArrange, deleteObject, editNode, insertDrawing, moveEndpoint, movePathPoint, moveObject, type SourceEdit, type DrawingTool, type ArrangeAction } from "../src/preview/editing";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Deliberately fail if missing: parity checks must never silently skip the renderer.
const binary = process.env.TIKZC_NATIVE_TEST_BINARY || path.join(root, "target", "release", process.platform === "win32" ? "tikzc.exe" : "tikzc");
const run = promisify(execFile);

test("arrow translation and deletion preserve named anchors, labels and scope transforms",async()=>{
  const renderer=new RustRenderer();
  let source=String.raw`% 日本語
\begin{tikzpicture}[rotate=30,scale=1.5]
\node[draw] (a) at (0,0) {A};
\node[draw] (b) at (3,2) {B};
\draw[->] (a.east) -- node[midway,above] {矢印} (b.west);
\end{tikzpicture}`;
  const render=()=>renderer.render({binary,source,dpi:96});
  const apply=(edit:SourceEdit)=>{source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);};
  try {
    let artifact=await render();
    const original=artifact.editing!;
    const path=()=>artifact.editing!.objects!.find(o=>o.kind==="path")!;
    const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
    for(let i=1;i<=2;i++) {
      apply(moveObject(source,artifact.editing!,path().id,20,-10));
      artifact=await render();
      for(let j=0;j<2;j++) assert.deepEqual(artifact.editing!.nodes[j].bounds,original.nodes[j].bounds,"named nodes do not move with the arrow");
      close(path().bounds[0],original.objects![2].bounds[0]+20*i);
      close(path().bounds[1],original.objects![2].bounds[1]+10*i);
      close(path().bounds[2],original.objects![2].bounds[2]);
      close(artifact.editing!.nodes[2].x,original.nodes[2].x+20*i);
      close(artifact.editing!.nodes[2].y,original.nodes[2].y-10*i);
      assert.equal(source.match(/transform canvas=/g)?.length,1,"repeated translations reuse their wrapper");
    }
    apply(arrangeObject(source,artifact.editing!,path().id,"back"));artifact=await render();
    const before=path().bounds;
    apply(moveObject(source,artifact.editing!,path().id,5,8));artifact=await render();
    close(path().bounds[0],before[0]+5);close(path().bounds[1],before[1]-8);
    assert.match(source,/\(a\.east\) -- node/);
    const invalid=deleteObject(source,artifact.editing!,artifact.editing!.objects![0].id);
    await assert.rejects(renderer.render({binary,dpi:96,source:source.slice(0,invalid.start)+source.slice(invalid.end)}),/unknown.*(?:coordinate|node)/i);
    apply(deleteObject(source,artifact.editing!,path().id,artifact.editing!.nodes[2].id));artifact=await render();
    assert.equal(artifact.editing!.nodes.length,2,"deleting an inline label retains its arrow");
    assert.ok(path());assert.doesNotMatch(source,/矢印/);
    apply(deleteObject(source,artifact.editing!,path().id));artifact=await render();
    assert.equal(artifact.editing!.objects!.length,2);
    while(artifact.editing!.objects!.length) {
      apply(deleteObject(source,artifact.editing!,artifact.editing!.objects![0].id));artifact=await render();
    }
    assert.equal(artifact.editing!.nodes.length,0);assert.ok(artifact.png.length,"deleting the last object retains an editable blank canvas");
  } finally {renderer.dispose();}
});

test("preview artifact and CLI SVG/PNG are byte-identical for mixed-width labels", async () => {
  const renderer = new RustRenderer();
  const input = path.join(root, "vscode-extension/tests/fixtures/mixed-alignment.tikz");
  const source = await readFile(input, "utf8");
  const out = await mkdtemp(path.join(os.tmpdir(), "tikzc-parity-"));
  try {
    for (const dpi of [96, 150, 300]) {
      const request = { source, binary, dpi };
      const pending = renderer.render(request);
      assert.equal(renderer.render({ ...request }), pending, "preview/export share the in-flight artifact");
      const artifact = await pending;
      await run(binary, [input, "-f", "both", "-o", out, "--dpi", String(dpi), "-q"]);
      assert.equal(artifact.svg, await readFile(path.join(out, "mixed-alignment.svg"), "utf8"));
      assert.deepEqual(artifact.png, await readFile(path.join(out, "mixed-alignment.png")));
      assert.doesNotMatch(artifact.svg, /<(?:text|foreignObject)\b/, "CJK glyphs must not depend on browser fonts");
      assert.match(artifact.svg, /<path\b/);
      assert.equal(await renderer.render(request), artifact);
    }
    const changed = await renderer.render({ binary, dpi: 150, source: source.replace("日本語ABC", "変更DEF") });
    assert.notEqual(changed.svg, (await renderer.render({ source, binary, dpi: 150 })).svg);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test("canvas label and geometry edits compile with Unicode source offsets and transformed pictures", async () => {
  const renderer=new RustRenderer();
  const source="% 日本語\n\\begin{tikzpicture}[scale=2,rotate=30]\n\\node at (1,2) {original};\n\\end{tikzpicture}% tail";
  const request={binary,source,dpi:96,mainfont:"IPAexGothic"};
  try {
    const artifact=await renderer.render(request);
    const metadata=artifact.editing!;
    assert.equal(metadata.insertionOffset,source.indexOf("\\end{tikzpicture}"));
    const node=metadata.nodes[0];
    const text=String.raw`日本語 $x^2$ \\ \textbf{ABC}`;
    const changed=source.slice(0,node.start)+editNode(source,node,{action:"text",text})+source.slice(node.end);
    const edited=await renderer.render({...request,source:changed});
    assert.notEqual(edited.svg,artifact.svg);
    assert.ok(edited.png.length);
    for (const tool of ["text","rectangle","ellipse","circle","line","arrow"] as DrawingTool[]) {
      const edit=insertDrawing(source,metadata,{tool,start:[20,30],end:[60,50]});
      const result=await renderer.render({...request,source:source.slice(0,edit.start)+edit.text+source.slice(edit.end)});
      assert.notEqual(result.svg,artifact.svg,tool);
      if(!["line","arrow"].includes(tool)) {
        const added=result.editing!.nodes.at(-1)!;
        assert.equal(added.x,tool==="text"?20:40,tool);
        assert.equal(added.y,tool==="text"?30:40,tool);
        if(tool==="rectangle") {assert.equal(added.bounds[2],40);assert.equal(added.bounds[3],20);}
      }
    }
  } finally {renderer.dispose();}
});

test("native diagnostics, settings and source header precedence", async () => {
  const renderer = new RustRenderer();
  const base = { binary, dpi: 96, source: "\\node {日本語ABC};" };
  const normal = await renderer.render(base);
  const gothic = await renderer.render({ ...base, mainfont: "IPAexGothic" });
  assert.notEqual(normal.svg, gothic.svg);
  const override = await renderer.render({ ...base, mainfont: "IPAexGothic", source: "#| mainfont: IPAexMincho\n" + base.source });
  assert.equal(normal.svg, override.svg);
  await assert.rejects(renderer.render({ ...base, mainfont: "IPAexGothic", source: "\\unsupportedcommand;" }), /document\.tikz:1:/);
  await assert.rejects(renderer.render({ ...base, packages: ["not-supported"] }), /Unsupported packages/);
  await assert.rejects(renderer.render({ ...base, dpi: 0 }), /DPI/);
  await assert.rejects(renderer.render({ ...base, binary: process.execPath }), /is not tikzc/);
  await assert.rejects(renderer.render({ ...base, binary: process.execPath }), /cargo install/);
  await assert.rejects(renderer.render({ ...base, binary: path.join(root, "missing-tikzc") }), /tikzc.nativePath/);
  await assert.rejects(renderer.render({ ...base, binary: path.join(root, "missing-tikzc") }), /cargo install/);
  assert.equal((await renderer.render(base)).svg, normal.svg, "a failed request cannot poison retries");
});

test("forward/backward layers preserve nested scopes, source references, PNG parity and stable identities",async()=>{
  const renderer=new RustRenderer();
  let source=String.raw`#| mainfont: IPAexGothic
% 日本語
\begin{tikzpicture}[rotate=15]
\begin{scope}[shift={(1,2)}]
\node[draw,fill=red,minimum size=2cm] (outer) at (0,0) {外側};
\node[draw,fill=blue] (inner) at (outer.center) {内側};
\end{scope}
\draw[->] (outer.east) -- (3,0);
\end{tikzpicture}`;
  const render=()=>renderer.render({binary,source,dpi:96,mainfont:"IPAexGothic"});
  try {
    let artifact=await render();
    assert.equal(canArrange(artifact.editing!),true);
    const initial=artifact.editing!.nodes.map(n=>[n.x,n.y]);
    const original=source;
    for(const [index,action,expected] of [[0,"forward",[1,0,2]],[0,"front",[1,2,0]],[0,"backward",[1,0,2]],[0,"back",[0,1,2]]] as [number,ArrangeAction,number[]][]) {
      const selected=artifact.editing!.objects![index];
      const edit=arrangeObject(source,artifact.editing!,selected.id,action);
      source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
      artifact=await render();
      assert.deepEqual(artifact.editing!.nodes.map(n=>[n.x,n.y]),initial,"layer changes never move geometry or break node references");
      const ordered=[...artifact.editing!.objects!].sort((a,b)=>a.order-b.order);
      assert.deepEqual(ordered.map(o=>artifact.editing!.objects!.indexOf(o)),expected);
      assert.equal(source.match(/% tikzc layers begin/g)?.length,1);
      assert.equal(source.match(/\\pgfdeclarelayer\{tikzcGUI/g)?.length,3,"repeated ordering never nests redundant wrappers");
    }
    assert.ok(source.indexOf("(outer) at")<source.indexOf("(inner) at"));
    assert.ok(source.includes("\\draw[->] (outer.east) -- (3,0);"));
    const initialArtifact=await renderer.render({binary,source:original,dpi:96,mainfont:"IPAexGothic"});
    assert.deepEqual(artifact.png,initialArtifact.png,"restoring the initial order restores identical export pixels");
    const sourceBeforeInsertion=source;
    const edit=insertDrawing(source,artifact.editing!,{tool:"rectangle",start:[50,30],end:[100,70]});
    source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
    artifact=await render();
    assert.equal(artifact.editing!.objects!.at(-1)!.order,3,"new drawings appear in front after previous objects have been arranged");
    const arranged=arrangeObject(source,artifact.editing!,artifact.editing!.objects!.at(-1)!.id,"front");
    source=arranged.text;artifact=await render();
    assert.equal(artifact.editing!.objects!.at(-1)!.order,3);
    assert.equal(sourceBeforeInsertion.match(/\\pgfdeclarelayer\{tikzcGUI/g)?.length,3);
    assert.equal(source.match(/\\pgfdeclarelayer\{tikzcGUI/g)?.length,4);
    assert.match(source,/\\pgfdeclarelayer\{background\}/);
  } finally {renderer.dispose();}
});

test("tikzc older than 1.0.0 is refused by version and 1.0.0 or newer is accepted", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tikzc-version-"));
  const fake = async (name: string, version: string) => {
    const file = path.join(dir, name);
    // Newer versions delegate to the real binary so only the reported version differs.
    await writeFile(file, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version}"; else exec "${binary}" "$@"; fi\n`, { mode: 0o755 });
    return file;
  };
  const renderer = new RustRenderer();
  const request = { dpi: 96, source: "\\node {A};" };
  try {
    for (const version of ["tikzc 0.4.0 (Rust native)", "tikzc 0.3.3"]) {
      const old = await fake(`old-${version.length}`, version);
      await assert.rejects(renderer.render({ ...request, binary: old }), /older than 1\.0\.0/);
      await assert.rejects(renderer.render({ ...request, binary: old }), /cargo install/);
    }
    for (const version of ["tikzc 1.0.0", "tikzc 1.7.2", "tikzc 2.0.0-rc.1", "tikzc 10.0.0"]) {
      assert.ok((await renderer.render({ ...request, binary: await fake(`new-${version.length}-${version.at(-1)}`, version) })).png.length, version);
    }
  } finally { renderer.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("a major.minor mismatch between extension and binary warns once per binary and still renders", async () => {
  const version = /^tikzc (\d+)\.(\d+)\.\d+/.exec((await run(binary, ["--version"])).stdout)!;
  const [major, minor] = [Number(version[1]), Number(version[2])];
  const warnings: string[] = [];
  const request = { binary, dpi: 96, source: "\\node {A};" };
  for (const [extension, count] of [[`${major}.${minor}.99`, 0], [`${major}.${minor + 1}.0`, 1], [`${major + 1}.${minor}.0`, 1]] as [string, number][]) {
    warnings.length = 0;
    const renderer = new RustRenderer(extension, (message) => warnings.push(message));
    try {
      assert.ok((await renderer.render(request)).png.length);
      renderer.dispose(); // restarting the worker re-runs --version
      assert.ok((await renderer.render({ ...request, dpi: 150 })).png.length);
      assert.equal(warnings.length, count, extension);
      if (count) assert.match(warnings[0], /cargo install/);
    } finally { renderer.dispose(); }
  }
});

test("endpoint edits preserve the other end, curve labels and Unicode ranges through transforms and reconnect to nodes", async()=>{
  const renderer=new RustRenderer();
  const apply=(source:string,edit:SourceEdit)=>source.slice(0,edit.start)+edit.text+source.slice(edit.end);
  try {
    for(const operation of ["--", "|-", "to[bend left] node[midway]{日本語}", ".. controls (1,2) and (2,2) .."]) {
      let source=String.raw`% 日本語😀
\begin{tikzpicture}[rotate=20,scale=1.5]
\node[draw] (a) at (0,0) {始点};
\node[draw] (b) at (4,0) {終点};
\begin{scope}[transform canvas={xshift=5bp,yshift=-3bp}]
\draw[->] (a.east) `+operation+String.raw` (b.west);
\end{scope}
\end{tikzpicture}`;
      const render=()=>renderer.render({binary,source,dpi:72,mainfont:"IPAexGothic"});
      let artifact=await render();
      let path=artifact.editing!.objects!.find(o=>o.kind==="path")!;
      const originalStart=path.endpoints![0];
      assert.equal(source.slice(path.endpoints![1].start,path.endpoints![1].end),"(b.west)");
      source=apply(source,moveEndpoint(source,artifact.editing!,path.id,1,100,50));
      artifact=await render();path=artifact.editing!.objects!.find(o=>o.kind==="path")!;
      assert.ok(Math.abs(path.endpoints![1].x-100)<1e-4);
      assert.ok(Math.abs(path.endpoints![1].y-50)<1e-4);
      assert.equal(path.endpoints![0].x,originalStart.x);assert.equal(path.endpoints![0].y,originalStart.y);
      assert.ok(source.includes(operation),"curve options, control points and labels are preserved");
      const anchor=artifact.editing!.anchors!.find(a=>a.reference==="b.north")!;
      source=apply(source,moveEndpoint(source,artifact.editing!,path.id,1,anchor.x,anchor.y,anchor.reference));
      artifact=await render();path=artifact.editing!.objects!.find(o=>o.kind==="path")!;
      assert.ok(Math.abs(path.endpoints![1].x-anchor.x)<1e-4);
      assert.ok(Math.abs(path.endpoints![1].y-anchor.y)<1e-4);
      assert.match(source,/b\.north/);
      assert.throws(()=>moveEndpoint(source,artifact.editing!,path.id,2,0,0));
      assert.throws(()=>moveEndpoint(source,artifact.editing!,path.id,1,NaN,0));
      assert.throws(()=>moveEndpoint(source,artifact.editing!,path.id,1,0,0,"missing.north"));
      const before=path.endpoints![1];
      const node=artifact.editing!.nodes[1];
      source=source.slice(0,node.start)+editNode(source,node,{action:"move",x:node.x+20,y:node.y+10})+source.slice(node.end);
      artifact=await render();path=artifact.editing!.objects!.find(o=>o.kind==="path")!;
      assert.ok(Math.abs(path.endpoints![1].x-before.x-20)<1e-4,"reconnected endpoints follow node movement");
      assert.ok(Math.abs(path.endpoints![1].y-before.y-10)<1e-4);
    }
  } finally {renderer.dispose();}
});

test("all path handles edit relative routes, implicit corners and curve controls without losing labels or anchors", async()=>{
  const renderer=new RustRenderer();
  const apply=(source:string,edit:SourceEdit)=>source.slice(0,edit.start)+edit.text+source.slice(edit.end);
  try {
    for(const route of [
      "-- ++(30bp,0bp) |-", "-- +(30bp,0bp) -- +(40bp,10bp) -|", "to[bend left]",
      ".. controls +(1,2) and +(-1,2) ..", ".. controls (1,2) ..",
    ]) {
      const original=String.raw`% 日本語😀
\begin{tikzpicture}[rotate=20,scale=1.5]
\node[draw] (a) at (0,0) {始点};
\node[draw] (b) at (4,2) {終点};
\begin{scope}[transform canvas={xshift=5bp,yshift=-3bp}]
\draw[->] (a.east) `+route+String.raw` node[midway]{ラベル} (b.west);
\end{scope}
\end{tikzpicture}`;
      const render=(source:string)=>renderer.render({binary,source,dpi:72,mainfont:"IPAexGothic"});
      const artifact=await render(original), object=artifact.editing!.objects!.find(o=>o.kind==="path")!;
      assert.ok(object.pathPoints!.length>=4,route);
      for(const [index,point] of object.pathPoints!.entries()) {
        const x=point.x+8,y=point.y+12;
        const edited=apply(original,movePathPoint(original,artifact.editing!,object.id,index,x,y));
        assert.ok(edited.includes("node[midway]{ラベル}"));
        if(point.kind!=="start") assert.ok(edited.includes("(a.east)"));
        if(point.kind!=="end") assert.ok(edited.includes("(b.west)"));
        const updated=await render(edited), path=updated.editing!.objects!.find(o=>o.kind==="path")!;
        assert.ok(path.pathPoints!.some(p=>Math.abs(p.x-x)<1e-5&&Math.abs(p.y-y)<1e-5),`${route}: ${point.kind} moves to its requested world coordinates`);
        for(const other of object.pathPoints!.filter(p=>p!==point&&p.replacement==="coordinate")) {
          assert.ok(path.pathPoints!.some(p=>Math.abs(p.x-other.x)<1e-5&&Math.abs(p.y-other.y)<1e-5),"unmodified vertices remain fixed, including relative coordinates");
        }
        assert.ok(!edited.includes("++("),"dependent relative coordinates are materialized in the same undo edit");
      }
    }
    const source=await readFile(path.join(root,"notebook/test-jp.tikz"),"utf8");
    const artifact=await renderer.render({binary,source,dpi:72});
    for(const object of artifact.editing!.objects!.filter(o=>o.kind==="path"&&source.slice(o.start,o.end).startsWith("\\draw[->"))) {
      assert.ok(object.pathPoints!.some(p=>p.kind==="start"));
      assert.ok(object.pathPoints!.some(p=>p.kind==="end"));
      if(source.slice(object.start,object.end).includes("++(")) assert.ok(object.pathPoints!.some(p=>p.kind==="bend"));
    }
  } finally {renderer.dispose();}
});
