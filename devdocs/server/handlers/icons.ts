import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../../../tools/lib/paths.js";
import { isLoopbackDevdocsRequest, type DevdocsRequest } from "./collections.js";

export function isIconMasterPath(url?: string): boolean { return Boolean(url?.startsWith("/__devdocs/icons/")); }
export async function readIconMaster(request: DevdocsRequest): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array | string }> {
  const fail = (status: number, error: string) => ({ status, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error }) });
  if (!isLoopbackDevdocsRequest(request)) return fail(403, "Dev docs API accepts loopback requests only");
  if (request.method !== "GET") return fail(405, "Method not allowed");
  const match = /^\/__devdocs\/icons\/([a-z0-9_-]+\.png)(?:\?[^#]*)?$/i.exec(request.url ?? "");
  if (!match) return fail(400, "Invalid icon name");
  const masterPath = path.join(repoRoot, "art/item-icons/256", match[1]!);
  try { return { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "no-cache" }, body: await readFile(masterPath) }; }
  catch (error) { return fail((error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500, "Icon master unavailable"); }
}
