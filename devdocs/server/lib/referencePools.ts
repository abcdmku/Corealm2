import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
// This module has only a type import and pure geometry functions; it does not load game content.
import { ALL_PROCEDURAL_GEAR_ASSETS } from '../../../game/src/render/proceduralGear.js';
import { repoRoot } from '../../../tools/lib/paths.js';
import type { ReferencePools } from '../../../tools/content/references.js';
/** Only immutable asset IDs are external. Authored references come from the compiler snapshot. */
export async function readDevdocsReferencePools():Promise<ReferencePools>{
 const publicRoot=path.join(repoRoot,'game/public');const manifest=JSON.parse(await readFile(path.join(publicRoot,'assets/manifest.json'),'utf8')) as {assets:{id:string}[]};
 const asset=new Set([...manifest.assets.map(row=>row.id),...ALL_PROCEDURAL_GEAR_ASSETS.map(row=>row.assetId)]);
 for(const entry of await readdir(path.join(publicRoot,'audio'),{recursive:true,withFileTypes:true}))if(entry.isFile())asset.add(path.relative(publicRoot,path.join(entry.parentPath,entry.name)).replaceAll('\\','/'));
 return {asset};
}
