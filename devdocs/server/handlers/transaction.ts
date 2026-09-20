import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_COLLECTIONS } from '../../../game/src/content/compiler/collections.js';
import { contentRevision, formatContentJson } from '../../../tools/content/format.js';
import { compileContent, formulaSourceRevision } from '../../../tools/content/compile.js';
import { renameReferences, type ReferencePools } from '../../../game/src/content/compiler/references.js';
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
const kinds:Record<string,string>={items:'item',recipes:'recipe',resources:'resource',npcs:'npc',shops:'shop',quests:'quest',dialogue:'dialogue',spells:'spell',spellRunes:'rune',equipmentSets:'set',lootTables:'lootTable',creatureDefinitions:'species',creatureProfiles:'creatureProfile',encounters:'encounter',materials:'material',equipmentFamilies:'equipmentFamily',recipeTemplates:'recipeTemplate'};
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
    try{for(const change of body.changes){
      const spec=CONTENT_COLLECTIONS.find(spec=>spec.name===change.collection);if(!spec)throw new Error(`Unknown collection ${change.collection}`);
      if(!change.id||typeof change.id!=='string')throw new Error('Record ID required');
      if(spec.shape==='object'){if(change.kind!=='put'||change.id!=='$collection')throw new Error('Object collections support replacement only');values.set(spec.name,change.record);continue;}
      const rows=values.get(spec.name) as Record<string,unknown>[], index=rows.findIndex(row=>String(row[spec.idKey])===change.id);
      if(change.kind==='put'){
        if(!change.record||typeof change.record!=='object'||String((change.record as Record<string,unknown>)[spec.idKey])!==change.id)throw new Error('Record ID must match URL. Use Rename to change identity.');
        if(change.create&&index>=0)throw new Error(`Record ${change.id} already exists`);
        if(index<0)rows.push(change.record as Record<string,unknown>);else rows[index]=change.record as Record<string,unknown>;
      }else if(change.kind==='delete'){if(index<0)throw new Error(`Unknown record ${change.id}`);rows.splice(index,1);}
      else if(change.kind==='rename'){
        if(index<0||!change.nextId||rows.some(row=>String(row[spec.idKey])===change.nextId))throw new Error('Rename requires an existing record and unused new ID');
        rows[index]![spec.idKey]=change.nextId;
        const kind=kinds[spec.name];if(!kind)throw new Error('This collection has no rename reference contract');
        for(const target of CONTENT_COLLECTIONS){const raw=values.get(target.name);const rewrite=(row:unknown)=>{let result=renameReferences(target.schema,row,kind,change.id,change.nextId);if(spec.name==='creatureDefinitions')result=renameReferences(target.schema,result,'enemy',change.id,change.nextId);return result;};values.set(target.name,target.shape==='array'?(raw as unknown[]).map(rewrite):rewrite(raw));}
        // Domain references whose finite schemas use names rather than the shared RefKind union.
        const field=({equipmentFamilies:'familyId',recipeTemplates:'templateId',creatureProfiles:'profileId',creatureDefinitions:'baseId',encounters:'encounterId'} as Record<string,string>)[spec.name];
        if(field){const rewrite=(raw:unknown):unknown=>Array.isArray(raw)?raw.map(rewrite):raw&&typeof raw==='object'?Object.fromEntries(Object.entries(raw).map(([key,value])=>[key,key===field&&value===change.id?change.nextId:rewrite(value)])):raw;for(const [name,raw]of values)values.set(name,rewrite(raw));}
        if(spec.name==='materials'){for(const tier of values.get('progression') as {materials:Record<string,string>}[])for(const key of Object.keys(tier.materials))if(tier.materials[key]===change.id)tier.materials[key]=change.nextId;}

      }else throw new Error('Unknown operation');
    }}catch(error){return json(422,{error:String(error)});}
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
