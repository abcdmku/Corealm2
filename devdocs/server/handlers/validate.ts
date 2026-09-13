import path from "node:path";
import { CONTENT_COLLECTIONS, parseContentCollection } from "../../../tools/content/collections.js";
import { formatContentJson } from "../../../tools/content/format.js";
import { withFileLock } from "../../../tools/content/locks.js";
import { repoRoot } from "../../../tools/lib/paths.js";
import type { ApiDiagnostic } from "../../shared/contracts.js";
import { loadCollectionSnapshots, validateCollectionOverlay } from "../lib/validateCollections.js";
import { isLoopbackDevdocsRequest, type DevdocsJsonResponse, type DevdocsRequest } from "./collections.js";
import type { CollectionWriteHandlerOptions } from "./writeCollections.js";

export interface ValidationResponse { ok: boolean; collections: number; diagnostics: ApiDiagnostic[] }
export function isValidatePath(url: string | undefined): boolean { return url?.split(/[?#]/, 1)[0] === "/__devdocs/validate"; }
const json = (status: number, body: unknown): DevdocsJsonResponse => ({ status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(body) });

/** Check the editor's current disk snapshot without changing records or generated world data. */
export function createValidateHandler(options: CollectionWriteHandlerOptions = {}) {
  const root = path.resolve(options.contentRoot ?? path.join(repoRoot, "game/content"));
  return async (request: DevdocsRequest): Promise<DevdocsJsonResponse | undefined> => {
    if (!isValidatePath(request.url)) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return json(403, { error: "Dev docs API accepts loopback requests only" });
    if (request.method !== "POST") return { ...json(405, { error: "Method not allowed" }), headers: { ...json(405, {}).headers, Allow: "POST" } };
    try {
      return await withFileLock(path.join(root, ".collection-write"), async () => {
        const snapshots = await loadCollectionSnapshots(root);
        const first = CONTENT_COLLECTIONS[0]!;
        const external = await options.referencePools?.() ?? {};
        const result = validateCollectionOverlay(snapshots, first, snapshots.get(first.name)!.data, "$validation", external);
        const diagnostics = [...result.diagnostics];
        // A drift warning permits an unrelated edit, but it is an error at acceptance time.
        for (const issue of diagnostics) if (issue.message.startsWith("Drifted from") || issue.message.startsWith("Cannot derive")) issue.severity = "error";
        if (!diagnostics.some(issue => issue.severity === "error")) for (const spec of CONTENT_COLLECTIONS) {
          const snapshot = snapshots.get(spec.name)!;
          if (snapshot.text.replace(/\r\n/g, "\n") !== formatContentJson(parseContentCollection(spec, snapshot.data))) diagnostics.push({ path: spec.name, message: "Noncanonical JSON formatting", severity: "error" });
        }
        return json(200, { ok: !diagnostics.some(issue => issue.severity === "error"), collections: snapshots.size, diagnostics } satisfies ValidationResponse);
      });
    } catch (error) {
      return json(error instanceof SyntaxError ? 422 : 500, { error: error instanceof SyntaxError ? "Invalid collection JSON" : "Unable to validate content" });
    }
  };
}
