import type { AdminRoute } from "./adminApi.js";
import type { AdminActor, AuditWrite } from "./adminStorage.js";
import { WorldBakeRefused, type WorldBakes } from "./serverWorldBake.js";

/**
 * `/admin/world`: the world geometry this server runs, and its bakes (`serverWorldBake.ts`).
 *
 *   GET  /admin/world   WorldStatusBody                        content:read
 *   POST /admin/world   {} -> 202 WorldStatusBody, bake queued   content:publish
 *
 * A POST bakes the active catalog's world again even when one is on disk, which is how an admin
 * retries a failed bake. It is audited as `world.bake`, like every other admin write.
 */
export function createWorldRoute(options: { bakes: Pick<WorldBakes, "status" | "bakeNow">; audit?(by: AdminActor, entry: AuditWrite): Promise<void>; log?(event: Record<string, unknown>): void }): AdminRoute {
  return async context => {
    if (context.rest[0] !== "world") return false;
    if (context.rest.length !== 1) context.fail(404, "not_found", "No such admin endpoint");
    if (context.method === "GET") {
      await context.scoped("content:read");
      context.json(200, options.bakes.status());
    } else if (context.method === "POST") {
      const { actor } = await context.scoped("content:publish");
      const body = await context.body();
      if (Object.keys(body).length) context.fail(400, "invalid_request", "The body is {}");
      const before = options.bakes.status().revision;
      const bake = await options.bakes.bakeNow().catch(error => {
        if (error instanceof WorldBakeRefused) context.fail(409, "nothing_to_bake", error.message);
        throw error;
      });
      await options.audit?.(actor, { action: "world.bake", target: bake.revision, before: { revision: before }, after: { revision: bake.revision, catalogRevision: bake.catalogRevision, status: bake.status } });
      options.log?.({ event: "world.bake", accountId: actor.accountId, revision: bake.revision, catalogRevision: bake.catalogRevision });
      context.json(202, options.bakes.status());
    } else context.fail(405, "method_not_allowed", "GET or POST");
    return true;
  };
}
