// Real Chromium pointer/hit-testing smoke test; no browser automation dependency.
// Run after build:ext and cargo build: node scripts/test-native-browser.mjs
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {buildSync} from 'esbuild';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const binary=process.env.TIKZC_NATIVE_TEST_BINARY || join(root,'target/debug/tikzc');
const directory=mkdtempSync(join(tmpdir(),'tikzc-path-browser-'));
const require=createRequire(import.meta.url);
function bundle(relative,mocks={}) {
  const code=buildSync({entryPoints:[join(root,relative)],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false}).outputFiles[0].text;
  const module={exports:{}};
  runInNewContext(code,{module,exports:module.exports,require:name=>mocks[name]??require(name)});
  return module.exports;
}
console.log('Browser smoke: preparing HTML and compiler metadata');
const {buildPreviewHtml}=bundle('vscode-extension/src/preview/preview-html.ts',{vscode:{Uri:{joinPath:()=>({})}}});
const {movePathPoint}=bundle('vscode-extension/src/preview/editing.ts');
let source=String.raw`\begin{tikzpicture}
\node[draw] (a) at (0,0) {Start};
\node[draw] (b) at (5,2) {End};
\draw[->] (a.east) -- ++(1,0) |- (b.west) node[midway,above] {Label};
\end{tikzpicture}`;
let artifact, token=0;
function render() {
  artifact=JSON.parse(execFileSync(binary,['--preview-server'],{input:JSON.stringify({source,dpi:96})+'\n',timeout:15000,encoding:'utf8',maxBuffer:16*1024*1024}));
  assert.ok(!artifact.error,artifact.error);
  artifact.editing.nodes=artifact.editing.nodes.map(n=>({...n,label:source.slice(n.labelStart+1,n.end-1),bold:false,italic:false,underline:false}));
  return {...artifact,type:'render',token:++token,png:Buffer.from(artifact.png).toString('base64')};
}
const initial=render();
let html=buildPreviewHtml({asWebviewUri:()=> 'native-preview.js'},{});
const nonce=html.match(/<script nonce="([^"]+)"/)[1];
const script=readFileSync(join(root,'vscode-extension/dist/native-preview.js'),'utf8');
const bootstrap=`window.guiMessages=[];function acquireVsCodeApi(){return {postMessage(m){window.guiMessages.push(m);if(m.type==='ready')setTimeout(()=>window.postMessage(${JSON.stringify(initial)},'*'),0);}};}`;
html=html.replace(/<script nonce="[^"]+" src="[^"]+"><\/script>/,()=>`<script nonce="${nonce}">${bootstrap}\n${script}</script>`);
html=html.replace('body {',':root { --vscode-foreground:#222; --vscode-editor-background:#f5f5f5; --vscode-button-background:#2364aa; --vscode-button-foreground:white; --vscode-focusBorder:#1565c0; --vscode-font-family:Arial,sans-serif; } body {');
writeFileSync(join(directory,'index.html'),html);
console.log('Browser smoke: launching Chromium');
const browser=spawn(process.env.CHROME_BINARY || '/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run',`--user-data-dir=${join(directory,'profile')}`,'--remote-debugging-pipe'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
let nextId=0, buffer='',session,stderr='';
const pending=new Map();
browser.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
browser.stdio[4].on('data',chunk=>{
  buffer+=chunk.toString();let end;
  while((end=buffer.indexOf('\0'))>=0){const data=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);const job=pending.get(data.id);if(job){pending.delete(data.id);clearTimeout(job.timer);data.error?job.reject(new Error(JSON.stringify(data.error))):job.resolve(data.result);}}
});
function send(method,params={},sessionId=session) {
  return new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout: ${method}\n${stderr}`));},15000);
    pending.set(id,{resolve,reject,timer});browser.stdio[3].write(JSON.stringify({id,method,params,...sessionId?{sessionId}:{}})+'\0');
  });
}
async function evaluate(expression) {
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;
}
async function waitFor(expression) {for(let i=0;i<200;i++){if(await evaluate(expression))return;await delay(25);}throw new Error(`Not ready: ${expression}`);}
async function applyMessage() {
  const message=await evaluate('window.guiMessages.filter(m=>m.type==="move-path-point").at(-1)');
  assert.ok(message);assert.equal(message.token,token);
  const edit=movePathPoint(source,artifact.editing,message.objectId,message.point,message.x,message.y,message.reference);
  source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
  const payload=render();payload.preserveViewport=true;payload.selection={objectId:artifact.editing.objects.find(o=>o.kind==='path').id};
  await evaluate(`window.postMessage(${JSON.stringify(payload)},'*')`);
  await waitFor('document.getElementById("canvas").getAttribute("aria-busy")==="false"');
  return message;
}
try {
  const target=await send('Target.createTarget',{url:pathToFileURL(join(directory,'index.html')).href},undefined);
  session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},undefined)).sessionId;
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false});
  await waitFor('document.getElementById("diagram") && !document.getElementById("diagram").hidden');
  const pathId=artifact.editing.objects.find(o=>o.kind==='path').id;
  // Select the inline label too: its parent path must retain editing handles.
  const label=artifact.editing.nodes.find(n=>n.objectId===pathId);
  await evaluate(`document.getElementById('objects').value='n${label.id}';document.getElementById('objects').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate('document.querySelectorAll(".endpoint").length'),4);
  const initialSource=source;
  for(const kind of ['start','end','bend']) {
    const rect=await evaluate(`(()=>{const e=document.querySelector('.endpoint.${kind}'),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,index:Number(e.dataset.point),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e};})()`);
    assert.ok(rect.hit,`${kind} must be reachable by a real pointer`);
    const point=artifact.editing.objects.find(o=>o.kind==='path').pathPoints[rect.index];
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x,y:rect.y});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1,modifiers:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+22,y:rect.y-17,button:'left',buttons:1,modifiers:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+22,y:rect.y-17,button:'left',clickCount:1,modifiers:1});
    await waitFor('document.getElementById("canvas").getAttribute("aria-busy")==="true"');
    const message=await applyMessage();
    assert.notEqual(message.x,point.x);assert.notEqual(message.y,point.y);
    assert.ok(artifact.editing.objects.find(o=>o.kind==='path').pathPoints.some(p=>Math.abs(p.x-message.x)<1e-5&&Math.abs(p.y-message.y)<1e-5));
  }
  assert.notEqual(source,initialSource);
  await evaluate(`document.getElementById('path-point').value='1';document.getElementById('path-point').dispatchEvent(new Event('change'));document.getElementById('path-x').value='2.54';document.getElementById('path-y').value='1.27';`);
  const applyRect=await evaluate(`(()=>{const r=document.getElementById('path-apply').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...applyRect,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...applyRect,button:'left',clickCount:1});
  const numeric=await applyMessage();assert.equal(numeric.x,72);assert.equal(numeric.y,36);
  const screenshot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(directory,'path-points.png'),Buffer.from(screenshot.data,'base64'));
  writeFileSync(join(directory,'edited.tikz'),source);
  console.log(`Browser PASS: start/end/bend drags, label selection, numeric editing. Screenshot: ${directory}/path-points.png`);
} finally {
  await send('Browser.close',{},undefined).catch(()=>{});
  browser.kill();
}
