import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setTimeout as tick } from "node:timers/promises";

test("native host preview and both export commands use identical dirty-buffer snapshots and artifacts", async () => {
  const code = buildSync({ entryPoints: [fileURLToPath(new URL("../src/preview/preview.ts", import.meta.url))], bundle: true,
    platform: "node", format: "cjs", external: ["vscode", "./renderer"], write: false }).outputFiles[0].text;
  const commands = new Map<string, (...args: any[]) => any>();
  const events = new Map<string, (...args: any[]) => any>();
  const messages: any[] = [];
  const requests: any[] = [];
  const writes: Buffer[] = [];
  let source = "unsaved 日本語ABC";
  const document = { languageId: "tikz", fileName: "/diagram.tikz", uri: { fsPath: "/diagram.tikz" }, getText: () => source };
  const config: Record<string, unknown> = { nativePath: "/rust/tikzc", pngDpi: 150, debounceMs: 0, mainfont: "IPAexGothic", extraLibraries: ["calc"] };
  const subscription = {};
  const on = (name: string) => (handler: (...args: any[]) => any) => { events.set(name, handler); return subscription; };
  const panel = { title: "", reveal() {}, dispose() {}, onDidDispose: on("dispose"), webview: {
    html: "", postMessage: (message: unknown) => messages.push(message), onDidReceiveMessage: on("message"),
    asWebviewUri: () => "https://webview.invalid/native-preview.js",
  } };
  const vscode = {
    ViewColumn: { Beside: 2 }, ProgressLocation: { Notification: 1 },
    Uri: { file: (fsPath: string) => ({ fsPath }), joinPath: () => ({ fsPath: "/extension/dist" }) },
    commands: { registerCommand: (name: string, handler: (...args: any[]) => any) => { commands.set(name, handler); return subscription; } },
    window: { activeTextEditor: { document } as { document: typeof document } | undefined,
      createWebviewPanel: () => panel, onDidChangeActiveTextEditor: on("active"),
      showSaveDialog: async () => ({ fsPath: "/out" }), withProgress: async (_: unknown, action: () => any) => action(),
      showWarningMessage: (message: string) => assert.fail(message), showErrorMessage: (message: string) => assert.fail(message), showInformationMessage() {},
    },
    ConfigurationTarget: { Global: 1 },
    workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => config[key] ?? fallback,
        update: async (key: string, value: unknown) => { config[key] = value; events.get("configuration")!({ affectsConfiguration: () => true }); } }),
      onDidChangeTextDocument: on("change"), onDidChangeConfiguration: on("configuration"),
      fs: { writeFile: async (_: unknown, bytes: Buffer) => { writes.push(bytes); } },
    },
  };
  const artifact = { svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 2"/></svg>', png: Buffer.from([1, 2, 3]) };
  class RustRenderer { async render(request: unknown) { requests.push(request); return artifact; } }
  const module = { exports: {} as { activateNativePreview: (ctx: unknown) => void } };
  const require = createRequire(import.meta.url);
  runInNewContext(code, { module, exports: module.exports, Buffer, process, setTimeout, clearTimeout,
    require: (name: string) => name === "vscode" ? vscode : name === "./renderer" ? { RustRenderer } : require(name) });
  module.exports.activateNativePreview({ subscriptions: [], extensionPath: "/missing-extension", extensionUri: { fsPath: "/missing-extension" } });
  await commands.get("tikzc.showPreview")!();
  assert.match(panel.webview.html, /default-src 'none'/);
  events.get("message")!({ type: "ready" }); await tick(20);
  const rendered = messages.find((message) => message.type === "render");
  assert.equal(rendered.svg, artifact.svg);
  assert.equal(rendered.png, artifact.png.toString("base64"));
  assert.equal(requests[0].source, source);
  assert.equal(requests[0].mainfont, config.mainfont);
  assert.equal(requests[0].binary, config.nativePath);
  assert.equal(requests[0].dpi, 150);
  vscode.window.activeTextEditor = undefined; // panel has focus
  await commands.get("tikzc.exportSvg")!();
  await commands.get("tikzc.exportPng")!();
  assert.equal(writes[0].toString(), rendered.svg);
  assert.equal(writes[1].toString("base64"), rendered.png);
  assert.equal(JSON.stringify(requests[0]), JSON.stringify(requests[1]));
  assert.equal(JSON.stringify(requests[0]), JSON.stringify(requests[2]));
  source = "next unsaved revision";
  events.get("change")!({ document });
  assert.equal(messages.at(-1).type, "pending"); await tick(20);
  assert.equal(requests.at(-1).source, source);
  config.pngDpi = 300;
  events.get("configuration")!({ affectsConfiguration: () => true }); await tick(20);
  assert.equal(requests.at(-1).dpi, 300);
  // English is the default; the toolbar toggle persists the setting and reloads the toolbar.
  assert.match(panel.webview.html, /<html lang="en">/); assert.match(panel.webview.html, /Waiting to compile…/);
  const before = messages.length;
  events.get("message")!({ type: "language", value: "ja" }); await tick(20);
  assert.equal(config.language, "ja");
  assert.match(panel.webview.html, /<html lang="ja">/); assert.match(panel.webview.html, /コンパイル待ち…/);
  assert.match(panel.webview.html, /<option value="ja" selected>/);
  assert.equal(messages.length, before);
  events.get("message")!({ type: "ready" }); await tick(20);
  assert.equal(messages.at(-1).type, "render");
  events.get("message")!({ type: "language", value: "en" }); await tick(20);
  events.get("dispose")!();
});

test("canvas changes validate before a single undoable source edit and reject stale or invalid changes", async () => {
  const code = buildSync({entryPoints:[fileURLToPath(new URL("../src/preview/preview.ts",import.meta.url))],bundle:true,platform:"node",format:"cjs",external:["vscode","./renderer"],write:false}).outputFiles[0].text;
  const commands=new Map<string,Function>(), events=new Map<string,Function>(), messages:any[]=[], changes:any[]=[], errors:string[]=[];
  let source="\\begin{tikzpicture}\n\\node{日本語};\n\\end{tikzpicture}";
  const original=source;
  const doc={languageId:"tikz",fileName:"/test.tikz",uri:{fsPath:"/test.tikz"},getText:()=>source,positionAt:(n:number)=>n};
  const on=(name:string)=>(fn:Function)=>{events.set(name,fn);return {};};
  const panel={title:"",reveal(){},dispose(){},onDidDispose:on("dispose"),webview:{html:"",postMessage:(m:any)=>messages.push(m),onDidReceiveMessage:on("message"),asWebviewUri:()=>"https://webview.invalid/native-preview.js"}};
  class Range {constructor(public start:number,public end:number){}}
  class WorkspaceEdit {
    replacements:any[]=[];
    replace(uri:any,range:Range,text:string){this.replacements.push({uri,range,text});}
  }
  const vscode={Range,WorkspaceEdit,ViewColumn:{Beside:2},Uri:{joinPath:()=>({})},
    commands:{registerCommand:(name:string,fn:Function)=>{commands.set(name,fn);return {};}},
    window:{activeTextEditor:{document:doc},createWebviewPanel:()=>panel,onDidChangeActiveTextEditor:on("active"),showErrorMessage:(m:string)=>errors.push(m)},
    workspace:{getConfiguration:()=>({get:(_key:string,fallback:any)=>fallback}),onDidChangeTextDocument:on("change"),onDidChangeConfiguration:on("config"),
      applyEdit:async(edit:WorkspaceEdit)=>{changes.push({before:source,edit}); for(const replacement of edit.replacements) source=source.slice(0,replacement.range.start)+replacement.text+source.slice(replacement.range.end); events.get("active")!({document:doc}); events.get("change")!({document:doc,contentChanges:[{}]}); events.get("change")!({document:doc,contentChanges:[]});return true;}}
  };
  let release: (()=>void)|undefined;
  class RustRenderer {
    async render(request:{source:string}) {
      if(request.source.includes("INVALID")) throw new Error("Unsupported label");
      if(request.source.includes("WAIT")) await new Promise<void>(resolve=>{release=resolve;});
      const start=request.source.indexOf("\\node")+5, labelStart=request.source.indexOf("{",start), end=request.source.indexOf("}",labelStart)+1;
      return {svg:"<svg/>",png:Buffer.from([1]),editing:{viewBox:[0,0,100,100],insertionOffset:request.source.lastIndexOf("\\end{tikzpicture}"),nodes:[{id:start,start,labelStart,end,font:"",fontSize:10,x:0,y:0,bounds:[0,0,20,10],moveMatrix:[1,0,0,1]}]}};
    }
  }
  const module={exports:{} as {activateNativePreview:(ctx:any)=>void}}, require=createRequire(import.meta.url);
  runInNewContext(code,{module,exports:module.exports,Buffer,process,setTimeout,clearTimeout,require:(name:string)=>name==="vscode"?vscode:name==="./renderer"?{RustRenderer}:require(name)});
  module.exports.activateNativePreview({subscriptions:[],extensionPath:"/missing",extensionUri:{}});
  await commands.get("tikzc.showPreview")!(); events.get("message")!({type:"ready"}); await tick(20);
  const rendered=()=>messages.filter(m=>m.type==="render").at(-1);
  const edit=(text:string,token=rendered().token)=>events.get("message")!({type:"edit",token,id:rendered().editing.nodes[0].id,edit:{action:"text",text}});
  const pendingBefore=messages.filter(m=>m.type==="pending").length;
  edit("変更"); await tick(20);
  assert.equal(changes.length,1); assert.equal(changes[0].edit.replacements.length,1);
  assert.equal(source,original.replace("日本語","変更"));
  assert.equal(changes[0].before,original,"one WorkspaceEdit preserves a complete undo snapshot");
  assert.equal(messages.filter(m=>m.type==="pending").length,pendingBefore,"GUI edits never blank the preview via pending");
  assert.equal(rendered().preserveViewport,true);
  assert.equal(rendered().selection.nodeId,rendered().editing.nodes[0].id);
  const afterEdit = messages.length;
  events.get("active")!(undefined);
  events.get("active")!({document:doc});
  events.get("change")!({document:doc,contentChanges:[]});
  await tick(20);
  assert.equal(messages.length,afterEdit,"returning focus or a dirty-state notification must not refresh the edited canvas");
  const changed=source;
  edit("INVALID"); await tick(20);
  assert.equal(source,changed); assert.equal(changes.length,1); assert.equal(messages.at(-1).type,"edit-error");
  assert.match(errors.at(-1)!,/Unsupported label/);
  edit("stale",-1); await tick(5); assert.equal(source,changed);
  events.get("message")!({type:"insert",token:rendered().token,drawing:{tool:"rectangle",start:[10,20],end:[40,60]}}); await tick(20);
  assert.equal(changes.length,2); assert.equal(changes[1].edit.replacements.length,1);
  assert.match(source,/\\begin\{scope\}\[reset cm\]/);
  assert.match(source,/\\end\{scope\}\n\\end\{tikzpicture\}$/);
  edit("WAIT"); await tick(5);
  assert.ok(release);
  source=source.replace("変更","外部の編集"); events.get("change")!({document:doc});
  release!(); await tick(20);
  assert.equal(changes.length,2,"a source edit during compilation cancels the canvas edit");
  assert.match(source,/外部の編集/);
  events.get("dispose")!();
});

test("an empty nativePath resolves tikzc on PATH and version warnings reach the user without blocking the preview", async () => {
  const code = buildSync({ entryPoints: [fileURLToPath(new URL("../src/preview/preview.ts", import.meta.url))], bundle: true,
    platform: "node", format: "cjs", external: ["vscode", "./renderer"], write: false }).outputFiles[0].text;
  const commands = new Map<string, Function>(), events = new Map<string, Function>(), messages: any[] = [], requests: any[] = [], warnings: string[] = [];
  const document = { languageId: "tikz", fileName: "/diagram.tikz", uri: { fsPath: "/diagram.tikz" }, getText: () => "\\node {A};" };
  const on = (name: string) => (fn: Function) => { events.set(name, fn); return {}; };
  const panel = { title: "", reveal() {}, dispose() {}, onDidDispose: on("dispose"), webview: { html: "", postMessage: (m: any) => messages.push(m),
    onDidReceiveMessage: on("message"), asWebviewUri: () => "https://webview.invalid/native-preview.js" } };
  const vscode = { ViewColumn: { Beside: 2 }, Uri: { joinPath: () => ({}) },
    commands: { registerCommand: (name: string, fn: Function) => { commands.set(name, fn); return {}; } },
    window: { activeTextEditor: { document }, createWebviewPanel: () => panel, onDidChangeActiveTextEditor: on("active"),
      showWarningMessage: (message: string) => warnings.push(message) },
    workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === "debounceMs" ? 0 : fallback }),
      onDidChangeTextDocument: on("change"), onDidChangeConfiguration: on("config") },
  };
  let expected: string | undefined;
  class RustRenderer {
    constructor(version?: string, private warn?: (message: string) => void) { expected = version; }
    async render(request: unknown) { requests.push(request); this.warn?.("tikzc 0.9.0 does not match"); return { svg: "<svg/>", png: Buffer.from([1]) }; }
  }
  const module = { exports: {} as { activateNativePreview: (ctx: unknown) => void } }, require = createRequire(import.meta.url);
  runInNewContext(code, { module, exports: module.exports, Buffer, process, setTimeout, clearTimeout,
    require: (name: string) => name === "vscode" ? vscode : name === "./renderer" ? { RustRenderer } : require(name) });
  module.exports.activateNativePreview({ subscriptions: [], extensionPath: "/missing", extensionUri: {}, extension: { packageJSON: { version: "1.0.0" } } });
  await commands.get("tikzc.showPreview")!(); events.get("message")!({ type: "ready" }); await tick(20);
  assert.equal(requests[0].binary, "tikzc");
  assert.equal(expected, "1.0.0");
  assert.deepEqual(warnings, ["tikzc: tikzc 0.9.0 does not match"]);
  assert.equal(messages.at(-1).type, "render");
  events.get("dispose")!();
});
