import { ALL_PROCEDURAL_GEAR_ASSETS } from '../../game/src/render/proceduralGear.js';
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CollectionResponse } from "../shared/contracts.js";
import { contentRevision } from "../../tools/content/format.js";
import { repoRoot } from "../../tools/lib/paths.js";

function catalog(name: string, data: unknown[]): CollectionResponse {
  return { collection: { name, count: data.length, editable: false, shape: "array", idKey: "id" }, revision: contentRevision(JSON.stringify(data)), data };
}

/** The manifest stays read-only here; creatures and enemies use the registered JSON store. */
export async function readRuntimeCatalogs(): Promise<CollectionResponse[]> {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "game/public/assets/manifest.json"), "utf8")) as { assets: unknown[] };
  const catalogs=[catalog("assets",[...manifest.assets,...ALL_PROCEDURAL_GEAR_ASSETS.map(row=>({id:row.assetId,itemId:row.itemId,procedural:true}))])];
  try{const build=JSON.parse(await readFile(path.join(repoRoot,'game/content/compiled/catalog.json'),'utf8')) as {tables:Record<string,unknown>;revision:string};for(const name of ['items','recipes','resources','enemies','species'])if(Array.isArray(build.tables[name]))catalogs.push({...catalog(`compiled-${name}`,build.tables[name] as unknown[]),revision:build.revision});}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return catalogs;
}
