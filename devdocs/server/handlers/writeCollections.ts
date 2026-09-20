import type { CollectionResponse } from '../../shared/contracts.js';
import { CONTENT_COLLECTIONS } from '../../../game/src/content/compiler/collections.js';
import { isLoopbackDevdocsRequest, type DevdocsJsonResponse, type DevdocsRequest } from './collections.js';
import { transact, type TransactionOptions } from './transaction.js';
export interface CollectionWriteHandlerOptions extends TransactionOptions {}
export type CollectionWriteRequest=DevdocsRequest&{body?:unknown};
export type CollectionWriteHandler=(request:CollectionWriteRequest)=>Promise<DevdocsJsonResponse|undefined>;
export type CollectionWriteResponse=CollectionResponse;
export const isCollectionWritePath=(url:string|undefined)=>url?.startsWith('/__devdocs/collections/')===true;
const json=(status:number,data:unknown):DevdocsJsonResponse=>({status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
export function createCollectionWriteHandler(options:CollectionWriteHandlerOptions={}):CollectionWriteHandler{return async request=>{
 if(!isCollectionWritePath(request.url))return undefined;
 if(!isLoopbackDevdocsRequest(request))return json(403,{error:'Loopback requests only'});
 if(request.method!=='PUT'&&request.method!=='DELETE')return json(405,{error:'PUT or DELETE required'});
 let segments:string[];try{segments=request.url!.split(/[?#]/,1)[0]!.slice('/__devdocs/collections/'.length).split('/').map(decodeURIComponent);}catch{return json(400,{error:'Malformed URL'});}
 const id=segments.pop()!,name=segments.join('/'),spec=CONTENT_COLLECTIONS.find(row=>row.name===name);
 if(!spec||!id||id.includes('/')||id.includes('\\'))return json(404,{error:'Unknown collection or record'});
 const body=request.body as {revision?:string;record?:unknown}|undefined;if(!body?.revision)return json(422,{error:'Revision required'});
 const result=await transact({operation:'save',revisions:{[name]:body.revision},changes:[request.method==='PUT'?{kind:'put',collection:name,id,record:body.record}:{kind:'delete',collection:name,id}]},options);
 if(result.status!==200)return result;
 const payload=JSON.parse(result.body) as {collections:CollectionResponse[];diagnostics:unknown;revision:string};const row=payload.collections.find(row=>row.collection.name===name);
 if(row)return json(200,{...row,diagnostics:payload.diagnostics,compiledRevision:payload.revision});
 // A no-op save still returns the current source response.
 const {readFile}=await import('node:fs/promises');const path=await import('node:path');const {repoRoot}=await import('../../../tools/lib/paths.js');const data=JSON.parse(await readFile(path.join(options.contentRoot??path.join(repoRoot,'game/content'),spec.file),'utf8'));
 return json(200,{collection:{name,count:Array.isArray(data)?data.length:Object.keys(data).length,editable:true,idKey:spec.idKey,shape:spec.shape},data,revision:body.revision});
};}
