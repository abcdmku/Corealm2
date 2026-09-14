import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { repoRoot } from '../../../tools/lib/paths.js';
import { formulaSourceRevision, readContentSources, type ContentBuild } from '../../../tools/content/compile.js';
import type { FormulaBuildStatus } from '../../shared/formulas.js';
import type { FormulasHandlerOptions } from '../handlers/formulas.js';
import type { CollectionWriteHandlerOptions } from '../handlers/writeCollections.js';
import * as initialRegistry from '../../../game/src/content/formulas/index.js';
const run=promisify(execFile);
export function installFormulaWatcher(server:ViteDevServer,options:CollectionWriteHandlerOptions):FormulasHandlerOptions & {compiler: NonNullable<CollectionWriteHandlerOptions["compiler"]>} {
 const root=options.contentRoot??path.join(repoRoot,'game/content');
 let status:FormulaBuildStatus={state:'checking',diagnostics:[]},registry=initialRegistry;
 let acceptedSourceRevision:string|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined, pending=false, running=false;
 const readBuild=async()=>JSON.parse(await readFile(path.join(root,'compiled/catalog.json'),'utf8')) as ContentBuild;
 async function rebuild(){
  if(running){pending=true;return;}running=true;status={...status,state:'checking',diagnostics:[]};
  try{
   const checkedSourceRevision=formulaSourceRevision();
   await run(process.execPath,[path.join(repoRoot,'node_modules/typescript/bin/tsc'),'--noEmit'],{cwd:repoRoot,timeout:120000,maxBuffer:4*1024*1024});
   // A fresh process prevents Node module caching from activating stale formula results.
   await run(process.execPath,['--import','tsx',path.join(repoRoot,'tools/content/compile.ts'),root,checkedSourceRevision],{cwd:repoRoot,timeout:120000,maxBuffer:4*1024*1024});
   registry=await server.ssrLoadModule(`/@fs/${path.join(repoRoot,'game/src/content/formulas/index.ts').replaceAll('\\','/')}`) as typeof initialRegistry;
   if(formulaSourceRevision()!==checkedSourceRevision)throw new Error('Formula source changed after compilation');acceptedSourceRevision=checkedSourceRevision;
   const build=await readBuild();status={state:'valid',revision:build.revision,diagnostics:build.diagnostics};
   server.ws.send({type:'custom',event:'content:compiled',data:{revision:build.revision}});
  }catch(error){const failure=error as Error&{stdout?:string;stderr?:string};status={...status,state:'invalid',diagnostics:[{path:'formulas',message:failure.stdout||failure.stderr||failure.message,severity:'error'}]};}
  finally{running=false;if(pending){pending=false;void rebuild();}}
 }
 const scheduleCheck=()=>{status={...status,state:'checking',diagnostics:[]};pending=running;if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=undefined;void rebuild();},300);};
 const onChange=(file:string)=>{
  const relative=path.relative(repoRoot,file).replaceAll('\\','/');
  // tsc checks the entire project. A repaired test, consumer, or config must unblock saves too.
  const projectSource=/^(?:game\/src|tools|tests|devdocs)\//.test(relative)&&/\.tsx?$/.test(relative);
  if(projectSource||relative==='tsconfig.json')scheduleCheck();
 };
 server.watcher.add?.(['game/src','tools','tests','devdocs','tsconfig.json'].map(file=>path.join(repoRoot,file)));
 server.watcher.on('change',onChange);
 server.watcher.on('unlink',onChange);
 void rebuild();
 server.httpServer?.once('close',()=>{server.watcher.off('change',onChange);server.watcher.off('unlink',onChange);if(timer)clearTimeout(timer);});
 const currentStatus=()=>{if(status.state==='valid'&&formulaSourceRevision()!==acceptedSourceRevision)scheduleCheck();return status;};
 const compiler=async()=>{currentStatus();if(status.state!=='valid'||formulaSourceRevision()!==acceptedSourceRevision)throw new Error(`Formula source must pass project type checking before saving content (state=${status.state}, accepted=${acceptedSourceRevision??'none'}, current=${formulaSourceRevision()}; ${status.diagnostics.map(issue=>issue.message).join(' | ')})`);const module=await server.ssrLoadModule(`/@fs/${path.join(repoRoot,'tools/content/compile.ts').replaceAll('\\','/')}`);return module.compileContent as typeof import('../../../tools/content/compile.js').compileContent;};
 return {compiler,previewImpacts:async(request)=>{const compile=await compiler();const sources=await readContentSources(root);const before=compile(sources);if(!before.ok)throw new Error(before.diagnostics.map(d=>d.message).join('\n'));const proposed=structuredClone(sources);const collection=registry.formulaRegistry[request.formulaId].profilesCollection;const rows=proposed.get(collection) as Record<string,unknown>[];let selected=0;for(let index=0;index<rows.length;index++){const row=rows[index]!;if(request.profileId&&row.id!==request.profileId)continue;if(row.formula&&row.formula!==request.formulaId)continue;selected++;rows[index]=collection==='creatureProfiles'?{...row,...request.parameters as object,id:row.id,name:row.name}:{...row,parameters:request.parameters};}if(!selected)throw new Error('No matching authored profiles');const after=compile(proposed);if(!after.ok)throw new Error(after.diagnostics.map(d=>d.message).join('\n'));return ['items','recipes','enemies'].flatMap(collection=>{const records=(build:ContentBuild)=>collection==='enemies'?(build.tables.compiledCreatures as {enemy:{id:string}}[]).map(row=>row.enemy):build.tables[collection] as {id:string}[];const prior=records(before);return records(after).flatMap(row=>{const old=prior.find(record=>record.id===row.id);return JSON.stringify(old)===JSON.stringify(row)?[]:[{record:`${collection}:${row.id}`,before:old,after:row}];});});},getBuildStatus:currentStatus,loadRegistry:async()=>registry,getConsumers:async()=>{try{const build=await readBuild();return Object.entries(build.sourceMap).map(([record,location])=>({record,...location}));}catch{return [];}}};
}
