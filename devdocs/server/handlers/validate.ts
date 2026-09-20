import path from 'node:path';
import { compileContent, readContentSources } from '../../../tools/content/compile.js';
import { CONTENT_COLLECTIONS } from '../../../game/src/content/compiler/collections.js';
import { repoRoot } from '../../../tools/lib/paths.js';
import { isLoopbackDevdocsRequest, type DevdocsRequest, type DevdocsJsonResponse } from './collections.js';
import type { CollectionWriteHandlerOptions } from './writeCollections.js';
export interface ValidationResponse {ok:boolean;collections:number;diagnostics:{path:string;message:string;severity:'error'|'warning'}[]}
export const isValidatePath=(url:string|undefined)=>url?.split(/[?#]/,1)[0]==='/__devdocs/validate';
const json=(status:number,body:unknown):DevdocsJsonResponse=>({status,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export function createValidateHandler(options:CollectionWriteHandlerOptions={}){return async(request:DevdocsRequest)=>{
 if(!isValidatePath(request.url))return undefined;if(!isLoopbackDevdocsRequest(request))return json(403,{error:'Loopback requests only'});if(request.method!=='POST')return json(405,{error:'POST required'});
 const build=compileContent(await readContentSources(options.contentRoot??path.join(repoRoot,'game/content')),await options.referencePools?.()??{});
 return json(200,{ok:build.ok,collections:CONTENT_COLLECTIONS.length,diagnostics:build.diagnostics});
};}
