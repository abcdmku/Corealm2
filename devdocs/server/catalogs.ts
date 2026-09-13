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
  return [catalog("assets", manifest.assets)];
}
