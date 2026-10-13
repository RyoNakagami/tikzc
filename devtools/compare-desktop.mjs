// Local, opt-in corpus audit. Original inputs are read-only; all artifacts are
// confined to target/. No private source files are copied into tracked fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
function option(name,fallback){const i=args.indexOf(name);return i<0?fallback:args[i+1];}
const root=path.resolve(option('--root','/home/ryo_billiken/Desktop'));
const out=path.resolve(option('--out',path.join(repo,'target/desktop-comparison/baseline')));
if(!out.startsWith(path.join(repo,'target')+path.sep))throw Error('Output must be inside this repository target/');
const native=path.resolve(option('--native',path.join(repo,'target/release/tikzc')));
const reference=option('--reference','tikzc');
const reuse=option('--reuse-reference',null);
const cached=reuse?JSON.parse(await fs.readFile(reuse,'utf8')):null;
const old=new Map(cached?.cases.map(c=>[c.sha256,c.reference])??[]);
const paths=execFileSync('rg',['--files','--hidden','--no-ignore','-0',root,'-g','*.tikz','-g','!**/.git/**','-g','!**/node_modules/**','-g','!**/target/**'],{maxBuffer:32*1024*1024}).toString().split('\0').filter(Boolean).sort();
await fs.mkdir(out,{recursive:true});
const unique=new Map();
for(const input of paths){const source=await fs.readFile(input);const sha256=crypto.createHash('sha256').update(source).digest('hex');const entry=unique.get(sha256)??{sha256,paths:[],bytes:source.length};entry.paths.push(input);unique.set(sha256,entry);}
const cases=[...unique.values()];
async function run(binary,input,directory){
  await fs.mkdir(directory,{recursive:true});const t=performance.now();
  const result=await new Promise(resolve=>{
    const child=spawn(binary,[input,'-f','both','-o',directory,'--dpi','150','-q'],{cwd:repo,detached:process.platform!=='win32',env:process.env});
    let stdout='',stderr='',timedOut=false;let timer;
    child.stdout.on('data',d=>{if(stdout.length<100_000)stdout+=d;});child.stderr.on('data',d=>{if(stderr.length<100_000)stderr+=d;});
    child.on('error',error=>{clearTimeout(timer);resolve({code:null,error:String(error),stdout,stderr});});
    child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,timedOut,stdout,stderr});});
    timer=setTimeout(()=>{timedOut=true;try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL');}catch{}},30_000);
  });
  result.ms=performance.now()-t;
  const stem=path.basename(input,path.extname(input));result.svg=path.join(directory,stem+'.svg');result.png=path.join(directory,stem+'.png');
  if(result.code===0){try{const png=await fs.readFile(result.png);result.width=png.readUInt32BE(16);result.height=png.readUInt32BE(20);result.svgBytes=(await fs.stat(result.svg)).size;}catch(e){result.error=String(e);result.code=-1;}}
  return result;
}
const report={createdAt:new Date().toISOString(),root,out,referenceCommand:reference,nativeCommand:native,referenceVersion:execFileSync(reference,['--version']).toString().trim(),nativeVersion:execFileSync(native,['--version']).toString().trim(),nativeSha256:crypto.createHash('sha256').update(await fs.readFile(native)).digest('hex'),referenceReuse:reuse,dpi:150,excluded:['.git','node_modules','target'],fileCount:paths.length,uniqueCount:cases.length,cases};
let saveQueue=Promise.resolve();
function save(){const snapshot=JSON.stringify(report,null,2);saveQueue=saveQueue.then(()=>fs.writeFile(path.join(out,'results.json'),snapshot));return saveQueue;}
let index=0;
async function worker(){while(index<cases.length){const c=cases[index++];const input=c.paths[0];const dir=path.join(out,c.sha256.slice(0,12));
    c.native=await run(native,input,path.join(dir,'native'));
    c.reference=old.get(c.sha256)??await run(reference,input,path.join(dir,'reference'));
    console.log(`${cases.indexOf(c)+1}/${cases.length} reference=${c.reference.code} native=${c.native.code} ${path.basename(input)}${c.native.code!==0?' '+c.native.stderr.trim().split('\n').at(-1):''}`);
    await save();
}}
await Promise.all([worker(),worker()]);
for(const c of cases){for(const input of c.paths){const hash=crypto.createHash('sha256').update(await fs.readFile(input)).digest('hex');if(hash!==c.sha256)throw Error(`Input changed during audit: ${input}`);}}
report.inputsUnchanged=true;
const summary=report.summary={both:0,referenceOnly:0,nativeOnly:0,neither:0,externalUnique:0,externalBoth:0};
for(const c of cases){const l=c.reference.code===0,n=c.native.code===0;summary[l?(n?'both':'referenceOnly'):(n?'nativeOnly':'neither')]++;if(c.paths.some(p=>!p.startsWith(repo+path.sep))){summary.externalUnique++;if(l&&n)summary.externalBoth++;}}
function stats(values){const v=values.slice().sort((a,b)=>a-b);const at=p=>v[Math.min(v.length-1,Math.floor(v.length*p))];return v.length?{count:v.length,median:at(.5),p95:at(.95),max:v.at(-1)}:null;}
const external=cases.filter(c=>c.paths.some(p=>!p.startsWith(repo+path.sep))&&c.reference.code===0&&c.native.code===0);
report.externalMetrics={widthRelativeError:stats(external.map(c=>Math.abs(c.native.width/c.reference.width-1))),heightRelativeError:stats(external.map(c=>Math.abs(c.native.height/c.reference.height-1))),referenceMs:stats(external.map(c=>c.reference.ms)),nativeMs:stats(external.map(c=>c.native.ms)),note:'PNG canvas dimensions, not element-level or pixel parity; single concurrent process timings, not a controlled benchmark.'};
await save();
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=p=>esc(path.relative(out,p).split(path.sep).map(encodeURIComponent).join('/'));
const cards=cases.map(c=>`<section><h2>${esc(path.basename(c.paths[0]))}</h2><p>${esc(c.paths.join('\n'))}</p><div class="pair">${['reference','native'].map(k=>{const r=c[k];return `<article><h3>${k} — ${r.code===0?`${r.width}×${r.height}, ${r.ms.toFixed(1)} ms`:'ERROR'}</h3>${r.code===0?`<a href="${link(r.svg)}"><img loading="lazy" src="${link(r.png)}"></a>`:`<pre>${esc(r.stderr||r.error)}</pre>`}</article>`;}).join('')}</div></section>`).join('');
await fs.writeFile(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>Tikzc corpus comparison</title><style>body{font:14px sans-serif;margin:2em;background:#f6f7f9}section{background:white;padding:1em;margin-bottom:2em}p,pre{white-space:pre-wrap;overflow-wrap:anywhere}.pair{display:grid;grid-template-columns:1fr 1fr;gap:1em}img{max-width:100%;height:auto}article{min-width:0}h2{font-size:18px}</style><h1>Tikzc Desktop corpus comparison</h1><p>${esc(JSON.stringify(summary))}</p><p>Same 150 DPI; independent image fitting below is for inspection, not proof of geometry parity. Click an image for SVG. Timings are single concurrent runs, not benchmarks.</p>${cards}`);
console.log(JSON.stringify(summary));console.log(path.join(out,'index.html'));
