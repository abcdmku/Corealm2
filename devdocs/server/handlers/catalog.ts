import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../../../tools/lib/paths.js";
import type { DevdocsJsonResponse, DevdocsRequest } from "./collections.js";

const CATALOG_PATH = "/__devdocs/catalog";
export function isCatalogPath(url?: string): boolean { return url?.split(/[?#]/, 1)[0] === CATALOG_PATH; }

/**
 * The compiled catalog the last save produced, in the shape `adoptCatalog` takes. The editor runs the
 * game's own content modules; after a save it adopts this so the stage draws the record just written.
 */
export async function readCompiledCatalog(request: DevdocsRequest, contentRoot = path.join(repoRoot, "game", "content")): Promise<DevdocsJsonResponse> {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if ((request.method ?? "GET") !== "GET") return { status: 405, headers, body: JSON.stringify({ error: "GET required" }) };
  const build = JSON.parse(await readFile(path.join(contentRoot, "compiled", "catalog.json"), "utf8")) as Record<string, unknown>;
  const { version, revision, formulaRevision, tables } = build;
  return { status: 200, headers, body: JSON.stringify({ version, revision, formulaRevision, tables }) };
}
