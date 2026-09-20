import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { contentRevision, formatContentJson } from '../../../tools/content/format.js';
import { compileContent, formulaSourceRevision } from '../../../tools/content/compile.js';
import type { ReferencePools } from '../../../game/src/content/compiler/references.js';
import { applyOperations } from '../../shared/applyOperations.js';
import { affectedCompiled, affectedSources, changedCollections, staleCollections } from '../../../game/src/content/compiler/changes.js';
import { atomicReplaceFile } from '../../../tools/lib/atomic-replace-file.js';
import { withFileLock } from '../../../tools/content/locks.js';
import { repoRoot } from '../../../tools/lib/paths.js';
import type { ContentTransactionRequest } from '../../shared/contracts.js';
import { collectionFile, loadCollectionSnapshots } from '../lib/validateCollections.js';
import { isLoopbackDevdocsRequest, type DevdocsRequest, type DevdocsJsonResponse } from './collections.js';
export interface TransactionOptions {contentRoot?:string;referencePools?:()=>Promise<ReferencePools>; compiler?:()=>Promise<typeof compileContent>}
export const isTransactionPath=(url:string|undefined)=>url?.split(/[?#]/,1)[0]==='/__devdocs/transaction';
const json=(status:number,data:unknown):DevdocsJsonResponse=>({status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
export async function transact(body:ContentTransactionRequest,options:TransactionOptions={}):Promise<DevdocsJsonResponse>{
  if(!body||!['preview','save'].includes(body.operation)||!Array.isArray(body.changes)||!body.changes.length||body.changes.length>1000||!body.revisions||typeof body.revisions!=='object')return json(422,{error:'Invalid content transaction'});
  const root=path.resolve(options.contentRoot??path.join(repoRoot,'game/content'));
  // Formula checks publish under the same lock. Finish them before locking this transaction.
  let checked: {compiler:typeof compileContent;sourceRevision:string}|{error:unknown};
  try{const compiler=await options.compiler?.()??compileContent;checked={compiler,sourceRevision:formulaSourceRevision()};}
  catch(error){checked={error};}
  return withFileLock(path.join(root,'.collection-write'),async()=>{
    const journal=path.join(root,'.content-transaction.json');
    try{const interrupted=JSON.parse(await readFile(journal,'utf8')) as {files:{file:string;text:string|null}[]};for(const entry of interrupted.files){const resolved=path.resolve(root,entry.file);if(path.relative(root,resolved).startsWith('..'))throw new Error('Invalid transaction recovery path');if(entry.text===null)await unlink(resolved).catch(()=>{});else await atomicReplaceFile(resolved,entry.text);}await unlink(journal);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const snapshots=await loadCollectionSnapshots(root), values=new Map([...snapshots].map(([name,row])=>[name,structuredClone(row.data)]));
    const revisions=Object.fromEntries([...snapshots].map(([name,row])=>[name,contentRevision(row.text)]));
    if(staleCollections(body.revisions,revisions).length)return json(409,{error:'Content changed. Your draft has been preserved.',revisions});
    // Server mode sends the same operations to a live server's publish endpoint, so the two writers
    // share one implementation rather than two that have to be kept equal by hand.
    try{applyOperations(values,body.changes);}catch(error){return json(422,{error:error instanceof Error?error.message:String(error)});}
    const before=new Map([...snapshots].map(([name,row])=>[name,row.data as unknown]));
    const changed=changedCollections(before,values);
    if(body.operation==='save'&&changed.some(spec=>body.revisions[spec.name]!==revisions[spec.name]))return json(409,{error:'Review current revisions for every affected collection. Your draft has been preserved.',revisions});
    if('error' in checked){const error=checked.error;return json(422,{error:error instanceof Error?error.message:String(error),diagnostics:[{path:'formulas',message:'Save is paused until formula source passes project checking',severity:'error'}],revisions});}
    const {compiler,sourceRevision}=checked;
    if(formulaSourceRevision()!==sourceRevision)return json(409,{error:'Formula source changed before compilation. Your draft has been preserved.',revisions});
    const compiled=compiler(values,await options.referencePools?.()??{});
    if(!compiled.ok)return json(422,{error:'Content failed validation. Sources and last valid build are unchanged.',diagnostics:compiled.diagnostics,revisions});
    const affected=affectedSources(changed,before,values);
    try{const previous=JSON.parse(await readFile(path.join(root,'compiled/catalog.json'),'utf8')) as {tables:Record<string,unknown>};affected.push(...affectedCompiled(previous.tables,compiled.tables,affected));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const collections=changed.map(spec=>{const data=values.get(spec.name),text=formatContentJson(data);return {collection:{name:spec.name,count:Array.isArray(data)?data.length:Object.keys(data as object).length,editable:true,idKey:spec.idKey,shape:spec.shape},revision:contentRevision(text),data};});
    if(body.operation==='save'){
      if(formulaSourceRevision()!==sourceRevision)return json(409,{error:'Formula source changed during preview. Your draft has been preserved.',revisions});
      const output=path.join(root,'compiled/catalog.json');await mkdir(path.dirname(output),{recursive:true});
      let previous:string|undefined;try{previous=await readFile(output,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      await atomicReplaceFile(journal,formatContentJson({files:[...changed.map(spec=>({file:spec.file,text:snapshots.get(spec.name)!.text})),{file:'compiled/catalog.json',text:previous??null}]}));
      const written:typeof changed=[];
      try{for(const spec of changed){await atomicReplaceFile(collectionFile(root,spec),formatContentJson(values.get(spec.name)));written.push(spec);}await atomicReplaceFile(output,formatContentJson(compiled));await unlink(journal);}
      catch(error){for(const spec of written.reverse())await atomicReplaceFile(collectionFile(root,spec),snapshots.get(spec.name)!.text);if(previous!==undefined)await atomicReplaceFile(output,previous);else await unlink(output).catch(()=>{});await unlink(journal).catch(()=>{});throw error;}
    }
    return json(200,{revision:compiled.revision,collections,affected,diagnostics:compiled.diagnostics,compiled,revisions:body.operation==='save'?{...revisions,...Object.fromEntries(collections.map(row=>[row.collection.name,row.revision]))}:revisions});
  });
}
export function createTransactionHandler(options:TransactionOptions={}){return async(request:DevdocsRequest&{body?:unknown})=>{
  if(!isTransactionPath(request.url))return undefined;if(!isLoopbackDevdocsRequest(request))return json(403,{error:'Loopback requests only'});if(request.method!=='POST')return json(405,{error:'POST required'});
  return transact(request.body as ContentTransactionRequest,options);
};}
