import path from "node:path";

import type { ImagegenKind } from "../../shared/skinContracts.js";
import {
  createCommandGenerator, createImagegenService, createSkinKind, IMAGEGEN_JOB_ID, ImagegenFailure,
  type ImagegenGenerator, type ImagegenKindHandler, type ImagegenService,
} from "../../../game/src/multiplayer/imagegenRunner.js";
import { repoRoot } from "../../../tools/lib/paths.js";
import { isLoopbackDevdocsRequest, type DevdocsJsonResponse, type DevdocsRequest } from "./collections.js";
import { checkAssetMaterials, defaultPublicRoot, saveSkin, type SkinsHandlerOptions } from "./skins.js";

/**
 * The repo editor's image jobs: `/__devdocs/imagegen`, the same jobs a live server runs at
 * `/admin/imagegen`, through the shared runner (`game/src/multiplayer/imagegenRunner.ts`). Jobs live
 * under `art/skins/jobs/<jobId>/`; a finished skin job saves an `imagegen` skin into the checkout.
 *
 *   GET  /__devdocs/imagegen          -> { jobs }   newest first
 *   POST /__devdocs/imagegen          ImagegenRequest -> { job }
 *   GET  /__devdocs/imagegen/<jobId>  -> { job }
 *   POST /__devdocs/imagegen/<jobId>  -> { job }    retry a failed job; painted images are reused
 *
 * The generator is Codex CLI; `DEVDOCS_IMAGEGEN_COMMAND` replaces it with a shell template and
 * `DEVDOCS_IMAGEGEN_EFFORT` sets Codex's reasoning effort.
 */
export const IMAGEGEN_PATH = "/__devdocs/imagegen";

export interface ImagegenOptions extends SkinsHandlerOptions {
  /** Absolute directory holding `<jobId>/`. Defaults to `art/skins/jobs`. */
  jobsRoot?: string;
  generator?: ImagegenGenerator;
  timeoutMs?: number;
  /** Kinds beyond `skin`, such as the icon finisher. */
  kinds?: Partial<Record<ImagegenKind, ImagegenKindHandler<undefined>>>;
}
export type ImagegenHandlerRequest = DevdocsRequest & { body?: unknown };
export type RepoImagegenService = ImagegenService<undefined>;

export const defaultJobsRoot = path.join(repoRoot, "art", "skins", "jobs");

export function isImagegenPath(url?: string): boolean {
  const raw = url?.split(/[?#]/, 1)[0];
  return raw === IMAGEGEN_PATH || raw?.startsWith(`${IMAGEGEN_PATH}/`) === true;
}

function json(status: number, data: unknown): DevdocsJsonResponse {
  return { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(data) };
}

/** The checkout's skin kind: materials checked against `assets/manifest.json`, the result saved with `saveSkin`. */
export function repoSkinKind(options: SkinsHandlerOptions = {}): ImagegenKindHandler<undefined> {
  const publicRoot = path.resolve(options.publicRoot ?? defaultPublicRoot);
  return createSkinKind<undefined>({
    check: async (request, materials) => { await checkAssetMaterials(publicRoot, request.assetId, materials); },
    async save(job, maps, context) {
      const saved = await saveSkin({ assetId: job.assetId, name: job.name, kind: "imagegen", prompt: job.prompt, generator: context.generator,
        maps: Object.fromEntries([...maps].map(([material, bytes]) => [material, bytes.toString("base64")])) }, options);
      return { skinId: saved.skin.id, outputs: Object.values(saved.skin.maps).map(map => `assets/${map}`) };
    },
  });
}

export function createRepoImagegenService(options: ImagegenOptions = {}): RepoImagegenService {
  return createImagegenService<undefined>({
    root: options.jobsRoot ?? defaultJobsRoot,
    generator: options.generator ?? createCommandGenerator({ command: process.env.DEVDOCS_IMAGEGEN_COMMAND, effort: process.env.DEVDOCS_IMAGEGEN_EFFORT }),
    // Codex runs in the checkout, where it can read the art direction docs.
    cwd: repoRoot,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    kinds: { skin: repoSkinKind(options), ...options.kinds },
  });
}

// Vite re-runs `configureServer` on a config restart inside the same process. One service per
// jobs directory keeps a restart from marking this process's own running job as interrupted.
const services = ((globalThis as { __corealmImagegenServices?: Map<string, RepoImagegenService> }).__corealmImagegenServices ??= new Map());

export function createImagegenHandler(options: ImagegenOptions = {}) {
  const key = path.resolve(options.jobsRoot ?? defaultJobsRoot);
  const service = options.generator ? createRepoImagegenService(options) : services.get(key) ?? services.set(key, createRepoImagegenService(options)).get(key)!;
  for (const [kind, handler] of Object.entries(options.kinds ?? {})) if (handler) service.register(kind as ImagegenKind, handler);
  const handle = async (request: ImagegenHandlerRequest): Promise<DevdocsJsonResponse | undefined> => {
    if (!isImagegenPath(request.url)) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return json(403, { error: "Dev docs API accepts loopback requests only" });
    const raw = request.url!.split(/[?#]/, 1)[0]!;
    const method = request.method ?? "GET";
    try {
      if (raw === IMAGEGEN_PATH) {
        if (method === "GET") return json(200, { jobs: await service.list() });
        if (method === "POST") return json(200, { job: await service.create(request.body, undefined) });
        return json(405, { error: "GET or POST required" });
      }
      const id = raw.slice(IMAGEGEN_PATH.length + 1);
      if (method !== "GET" && method !== "POST") return json(405, { error: "GET or POST required" });
      if (!IMAGEGEN_JOB_ID.test(id)) return json(400, { error: "Invalid job id" });
      const job = method === "POST" ? await service.retry(id) : await service.get(id);
      return job ? json(200, { job }) : json(404, { error: "Unknown job" });
    } catch (error) {
      if (error instanceof ImagegenFailure) return json(error.status, { error: error.message, ...(error.detail === undefined ? {} : { diagnostics: error.detail }) });
      throw error;
    }
  };
  return Object.assign(handle, { service });
}
