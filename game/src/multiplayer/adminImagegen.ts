import type { ImagegenJob, ImagegenKind } from "../../../devdocs/shared/skinContracts.js";
import type { CreatureSkin } from "../content/schema/creatureSkins.js";
import { collectionRevision } from "../content/compiler/revision.js";
import type { AdminRoute, AdminRouteContext } from "./adminApi.js";
import type { AdminActor, AuditWrite } from "./adminStorage.js";
import type { CatalogStorage } from "./catalogStorage.js";
import type { ContentAssetStore } from "./contentAssets.js";
import { PublishFailure, type ContentPublisher } from "./contentPublish.js";
import {
  createCommandGenerator, createImagegenService, createSkinKind, IMAGEGEN_JOB_ID, IMAGEGEN_MAX_REQUEST_BYTES, ImagegenFailure, materialFileNames, slugId,
  type ImagegenGenerator, type ImagegenKindHandler, type ImagegenService,
} from "./imagegenRunner.js";

/**
 * Image generation on a live server, the same jobs the repo editor runs (`imagegenRunner.ts`):
 *
 *   GET  /admin/imagegen          content:read     { jobs: ImagegenJob[] }  newest first
 *   POST /admin/imagegen          content:publish  ImagegenRequest -> { job }
 *   GET  /admin/imagegen/<jobId>  content:read     { job }
 *   POST /admin/imagegen/<jobId>  content:publish  { job }  retry a failed job; painted images are reused
 *
 * Offered only when the server's config has an `imagegen` block; without one every path answers
 * 404 `not_offered`, which devdocs' capability probe reads as absent. Jobs live in
 * `<data>/imagegen-jobs/<jobId>/`. A finished skin job stores its maps in the server's file store
 * (`assets/skins/<asset>/<skin>/<material>.png`) and publishes the `creatureSkins` row as the admin
 * who started the job, with the note `Image job <id>`. A failed store or publish keeps the painted
 * maps, so Retry publishes without painting again.
 */

/** The `imagegen` block of `corealm-server.json`. Every field is optional; `{}` offers Codex CLI at medium effort. */
export interface ImagegenConfig {
  /** A shell template run per image instead of Codex (see `CommandGeneratorOptions.command`). */
  command?: string;
  /** Codex `model_reasoning_effort`. */
  effort?: string;
  /** Per image. Default 20. */
  timeoutMinutes?: number;
}

/** The config block, or null when absent (image generation not offered). Throws for a malformed block. */
export function parseImagegenConfig(raw: unknown): ImagegenConfig | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("imagegen must be an object: { command?, effort?, timeoutMinutes? }");
  const block = raw as Record<string, unknown>, config: ImagegenConfig = {};
  for (const key of Object.keys(block)) if (!["command", "effort", "timeoutMinutes"].includes(key)) throw new Error(`imagegen has no setting ${JSON.stringify(key)}`);
  if (block.command !== undefined) {
    if (typeof block.command !== "string" || !block.command.trim() || block.command.length > 4000) throw new Error("imagegen.command must be a non-empty shell template");
    config.command = block.command.trim();
  }
  if (block.effort !== undefined) {
    if (typeof block.effort !== "string" || !/^[a-z]{1,20}$/.test(block.effort)) throw new Error("imagegen.effort must be a Codex reasoning effort such as medium");
    config.effort = block.effort;
  }
  if (block.timeoutMinutes !== undefined) {
    if (typeof block.timeoutMinutes !== "number" || !Number.isFinite(block.timeoutMinutes) || block.timeoutMinutes <= 0 || block.timeoutMinutes > 240)
      throw new Error("imagegen.timeoutMinutes must be a number of minutes from 1 to 240");
    config.timeoutMinutes = block.timeoutMinutes;
  }
  return config;
}

export interface ImagegenRouteOptions {
  /** `parseImagegenConfig(config.imagegen)`. Null answers every path `not_offered`. */
  config: ImagegenConfig | null;
  /** `<data>/imagegen-jobs`. */
  dir: string;
  store: Pick<ContentAssetStore, "put">;
  /** Where the active sources are read from, to add the skin row to. */
  catalog: Pick<CatalogStorage, "activeRevision" | "sources">;
  /**
   * The running server's publisher. A getter because the reference server makes it after its routes:
   * null until then, and a finished job fails (Retry publishes) if it is still null.
   */
  publisher(): Pick<ContentPublisher, "publish"> | null;
  /** The server's audit helper, `ServerAdminStorage.record`. */
  audit?(by: AdminActor, entry: AuditWrite): Promise<void>;
  log?(event: Record<string, unknown>): void;
  /** Tests replace Codex. */
  generator?: ImagegenGenerator;
  now?(): number;
}

export interface ImagegenRoute {
  route: AdminRoute;
  /** Null when not offered. */
  service: ImagegenService<AdminActor> | null;
  /** Offer another kind (the icon finisher). Does nothing when image generation is not offered. */
  register(kind: ImagegenKind, handler: ImagegenKindHandler<AdminActor>): void;
}

const CODES: Readonly<Record<number, string>> = { 400: "invalid_request", 404: "not_found", 409: "conflict" };

/** Why a publish refused, with its first problems, as one line for the job's error. */
function publishError(error: unknown): Error {
  if (!(error instanceof PublishFailure)) return error instanceof Error ? error : new Error(String(error));
  const problems = Array.isArray(error.details.problems) ? error.details.problems as { path?: string; message?: string }[] : [];
  const listed = problems.slice(0, 3).map(problem => `${problem.path ? `${problem.path}: ` : ""}${problem.message ?? ""}`).join("; ");
  return new Error(`Publish refused (${error.code}): ${error.message}${listed ? ` ${listed}` : ""}`);
}

/** The server's skin kind: maps into the file store, then the row published as the job's creator. */
export function serverSkinKind(options: Pick<ImagegenRouteOptions, "store" | "catalog" | "publisher" | "now">): ImagegenKindHandler<AdminActor> {
  const now = options.now ?? Date.now;
  return createSkinKind<AdminActor>({
    async save(job, maps, { owner, generator, log }) {
      const publisher = options.publisher();
      if (!publisher) throw new Error("This server cannot publish content yet");
      // A publish that lands between the read and this one moves the collection: read again and retry.
      for (let attempt = 1; ; attempt++) {
        const revision = await options.catalog.activeRevision();
        const active = revision === null ? null : await options.catalog.sources(revision);
        const sources = active ? JSON.parse(active.sources) as Record<string, unknown> : {};
        const current = sources.creatureSkins;
        if (!active || !Array.isArray(current)) throw new Error("This server's content has no creatureSkins collection to add the skin to");
        const rows = current as CreatureSkin[], base = slugId(job.name);
        let skinId = base;
        for (let n = 2; rows.some(row => row.id === skinId); n++) skinId = `${base}-${n}`;
        const files = materialFileNames([...maps.keys()]);
        const mapPaths = new Map([...maps.keys()].map(material => [material, `skins/${job.assetId}/${skinId}/${files.get(material)}.png`]));
        const stored = await options.store.put(Object.fromEntries([...maps].map(([material, bytes]) => [`assets/${mapPaths.get(material)}`, bytes.toString("base64")])), owner);
        const record: CreatureSkin = {
          id: skinId, assetId: job.assetId, name: job.name, kind: "imagegen", maps: Object.fromEntries(mapPaths),
          prompt: job.prompt, generator, sha256: Object.fromEntries([...mapPaths].map(([material, map]) => [material, stored.files[`assets/${map}`]!.sha256])),
          createdAt: new Date(now()).toISOString(),
        };
        try {
          await publisher.publish({ base: active.revision, collections: { creatureSkins: { revision: collectionRevision(current), value: [...rows, record] } },
            note: `Image job ${job.id}` }, { ...owner, at: now() });
        } catch (error) {
          if (error instanceof PublishFailure && error.code === "stale_collections" && attempt < 3) { log(`\n== publish: content moved, trying again\n`); continue; }
          throw publishError(error);
        }
        log(`\n== published skin ${skinId}\n`);
        return { skinId, outputs: [...mapPaths.values()].map(map => `assets/${map}`) };
      }
    },
  });
}

export function createImagegenRoute(options: ImagegenRouteOptions): ImagegenRoute {
  const { config } = options;
  const service = config ? createImagegenService<AdminActor>({
    root: options.dir,
    generator: options.generator ?? createCommandGenerator(config),
    ...(config.timeoutMinutes ? { timeoutMs: config.timeoutMinutes * 60_000 } : {}),
    ...(options.now ? { now: () => new Date(options.now!()) } : {}),
    kinds: { skin: serverSkinKind(options) },
  }) : null;

  const failed = (context: AdminRouteContext) => (error: unknown): never => {
    if (error instanceof ImagegenFailure) context.fail(error.status, CODES[error.status] ?? "invalid_request", error.message);
    throw error;
  };
  const audit = async (actor: AdminActor, action: string, job: ImagegenJob) => {
    await options.audit?.(actor, { action, target: job.id, after: { kind: job.kind, assetId: job.assetId, ...(job.itemId ? { itemId: job.itemId } : {}), name: job.name } });
    options.log?.({ event: action, jobId: job.id, kind: job.kind, accountId: actor.accountId });
  };

  const route: AdminRoute = async (context: AdminRouteContext) => {
    if (context.rest[0] !== "imagegen") return false;
    const jobs = service;
    if (!jobs) context.fail(404, "not_offered", "This server does not run image generation. An imagegen block in its config offers it.");
    const method = context.method.toUpperCase();
    if (context.rest.length === 1) {
      if (method === "GET") {
        await context.scoped("content:read");
        context.json(200, { jobs: await jobs.list() });
      } else if (method === "POST") {
        const { actor } = await context.scoped("content:publish");
        const body = await context.body(IMAGEGEN_MAX_REQUEST_BYTES);
        const job = await jobs.create(body, actor).catch(failed(context));
        await audit(actor, "imagegen.create", job);
        context.json(200, { job });
      } else context.fail(405, "method_not_allowed", "GET or POST");
      return true;
    }
    const id = context.rest[1]!;
    if (context.rest.length !== 2 || !IMAGEGEN_JOB_ID.test(id)) context.fail(404, "not_found", "No such admin endpoint");
    if (method === "GET") {
      await context.scoped("content:read");
      const job = await jobs.get(id);
      if (!job) context.fail(404, "not_found", "Unknown job");
      context.json(200, { job });
    } else if (method === "POST") {
      const { actor } = await context.scoped("content:publish");
      const job = await jobs.retry(id).catch(failed(context));
      if (!job) context.fail(404, "not_found", "Unknown job");
      await audit(actor, "imagegen.retry", job);
      context.json(200, { job });
    } else context.fail(405, "method_not_allowed", "GET or POST");
    return true;
  };

  return { route, service, register: (kind, handler) => service?.register(kind, handler) };
}
