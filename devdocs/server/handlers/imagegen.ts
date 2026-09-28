import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import type { ImagegenJob, ImagegenRequest } from "../../shared/skinContracts.js";
import { atomicReplaceFile } from "../../../tools/lib/atomic-replace-file.js";
import { repoRoot } from "../../../tools/lib/paths.js";
import { isLoopbackDevdocsRequest, type DevdocsJsonResponse, type DevdocsRequest } from "./collections.js";
import {
  checkAssetMaterials, decodeSkinPng, defaultPublicRoot, materialFileNames, pngDimensions, saveSkin, SkinError,
  type SkinsHandlerOptions,
} from "./skins.js";

/**
 * Image-generation jobs for creature skins. A job stores its reference maps and prompt under
 * `art/skins/jobs/<jobId>/`, runs the image model once per material (one job at a time in this
 * process), and saves the repainted maps as an `imagegen` skin. `job.json` is rewritten on every
 * transition, so the list survives a server restart.
 */
export const IMAGEGEN_PATH = "/__devdocs/imagegen";
export const IMAGEGEN_TIMEOUT_MS = 20 * 60 * 1000;
const LOG_TAIL_CHARS = 4000;
const JOB_ID = /^[a-z0-9-]+$/;

export interface ImagegenRunInput {
  assetId: string;
  material: string;
  /** Absolute paths. */
  reference: string;
  output: string;
  promptFile: string;
  jobDir: string;
  cwd: string;
  prompt: string;
  width: number;
  height: number;
  timeoutMs: number;
  log: (text: string) => void;
}
export interface ImagegenRunner {
  /** Recorded as the skin's `generator`. */
  generator: string;
  /** Resolves once `output` is written; rejects on failure or timeout. */
  run: (input: ImagegenRunInput) => Promise<void>;
}
export interface ImagegenOptions extends SkinsHandlerOptions {
  /** Absolute directory holding `<jobId>/`. Defaults to `art/skins/jobs`. */
  jobsRoot?: string;
  runner?: ImagegenRunner;
  timeoutMs?: number;
}
export type ImagegenHandlerRequest = DevdocsRequest & { body?: unknown };

export const defaultJobsRoot = path.join(repoRoot, "art", "skins", "jobs");

export function isImagegenPath(url?: string): boolean {
  const raw = url?.split(/[?#]/, 1)[0];
  return raw === IMAGEGEN_PATH || raw?.startsWith(`${IMAGEGEN_PATH}/`) === true;
}

function json(status: number, data: unknown): DevdocsJsonResponse {
  return { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(data) };
}

/** The instruction one Codex run receives for one map. */
export function imagegenTask(input: Omit<ImagegenRunInput, "log" | "timeoutMs" | "cwd" | "jobDir">): string {
  return [
    `Repaint a creature texture for the Corealm game.`,
    `The attached image is the UV texture atlas (albedo map) of material "${input.material}" on the 3D model "${input.assetId}", ${input.width}x${input.height} pixels. It is also on disk at ${input.reference}.`,
    ``,
    `Art direction:`,
    input.prompt.trim(),
    ``,
    `Use your built-in image generation tool to edit the attached image into a repainted texture atlas that follows the art direction. Requirements:`,
    `- Keep the exact UV layout: every island keeps its position, outline and size, and empty background regions stay where they are. The result must map onto the same model without changes.`,
    `- Keep each region's anatomy where the reference has it: where the reference is dark (for example a back or dorsal side) and where it is light (a belly), the repaint keeps that placement. Never flip or reorient markings by what the animal usually looks like; the reference's tones show which edge of each island faces which way on the model.`,
    `- Output a flat texture atlas at the same aspect ratio (ideally ${input.width}x${input.height}): no border, frame, label, mockup, lighting, or 3D render.`,
    `- Make it an intricate layered texture: layered colours, markings and fine surface detail (scales, fur, feathers, skin or plates as the regions suggest). A flat or monochrome recolor is not acceptable.`,
    `- Save the result as a PNG at exactly: ${input.output}`,
    `Do not change any other file. When the PNG is saved, reply DONE.`,
  ].join("\n");
}

const quote = (value: string) => `"${value.replace(/"/g, '\\"')}"`;

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
}

function runShell(command: string, input: { cwd: string; timeoutMs: number; log: (text: string) => void; stdin?: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd: input.cwd, shell: true, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => { killTree(child.pid); reject(new Error(`Timed out after ${Math.round(input.timeoutMs / 60000)} min`)); }, input.timeoutMs);
    child.stdout.on("data", chunk => input.log(String(chunk)));
    child.stderr.on("data", chunk => input.log(String(chunk)));
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`Generator exited with code ${code}`)); });
    child.stdin.end(input.stdin ?? "");
  });
}

/**
 * `DEVDOCS_IMAGEGEN_COMMAND` (a shell template with `{reference}` `{output}` `{prompt_file}` `{cwd}`)
 * when set, otherwise `codex exec` with the reference attached and the task on stdin.
 */
export function defaultImagegenRunner(template = process.env.DEVDOCS_IMAGEGEN_COMMAND): ImagegenRunner {
  if (template?.trim()) return {
    generator: `DEVDOCS_IMAGEGEN_COMMAND: ${template.trim().split(/\s+/, 1)[0]}`,
    run: input => runShell(template.replace(/\{(reference|output|prompt_file|cwd)\}/g, (_, key: string) =>
      quote(key === "reference" ? input.reference : key === "output" ? input.output : key === "prompt_file" ? input.promptFile : input.cwd)), input),
  };
  return {
    generator: "codex exec + gpt-image",
    run: input => runShell([
      // Painting a texture needs the image model, not deep reasoning; max effort only adds minutes.
      "codex", "exec", "-c", quote(`model_reasoning_effort=${process.env.DEVDOCS_IMAGEGEN_EFFORT?.trim() || "medium"}`),
      "-i", quote(input.reference), "-C", quote(input.cwd), "--sandbox", "workspace-write", "--skip-git-repo-check",
      "-o", quote(path.join(input.jobDir, `codex-last-${path.basename(input.output, ".png").replace(/^output-/, "")}.md`)), "-",
    ].join(" "), { ...input, stdin: imagegenTask(input) }),
  };
}

function jobId(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").toLowerCase()}-${randomBytes(3).toString("hex")}`;
}

/** `pid` is the process whose queue runs the job. */
interface StoredJob extends ImagegenJob { files: Record<string, string>; pid?: number }

/** Whether a process still exists. Signal 0 only checks; EPERM means it exists but is not ours. */
function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export interface ImagegenService {
  create(body: unknown): Promise<ImagegenJob>;
  list(): Promise<ImagegenJob[]>;
  get(id: string): Promise<ImagegenJob | undefined>;
  /** Queue a failed job again. Maps it already painted are reused, so a failed save costs no new generation. */
  retry(id: string): Promise<ImagegenJob | undefined>;
  /** Resolves when the queue is empty. */
  idle(): Promise<void>;
}

const publicJob = ({ files: _files, pid: _pid, ...job }: StoredJob): ImagegenJob => job;

export function createImagegenService(options: ImagegenOptions = {}): ImagegenService {
  const root = path.resolve(options.jobsRoot ?? defaultJobsRoot);
  const publicRoot = path.resolve(options.publicRoot ?? defaultPublicRoot);
  const runner = options.runner ?? defaultImagegenRunner();
  const timeoutMs = options.timeoutMs ?? IMAGEGEN_TIMEOUT_MS;
  const now = () => new Date().toISOString();
  let queue: Promise<void> = Promise.resolve();

  const dir = (id: string) => path.join(root, id);
  const persist = (job: StoredJob) => atomicReplaceFile(path.join(dir(job.id), "job.json"), `${JSON.stringify(job, null, 2)}\n`);
  const read = async (id: string): Promise<StoredJob | undefined> => {
    if (!JOB_ID.test(id)) return undefined;
    try { return JSON.parse(await readFile(path.join(dir(id), "job.json"), "utf8")) as StoredJob; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  };
  const all = async (): Promise<StoredJob[]> => {
    const ids = await readdir(root).catch(() => [] as string[]);
    const jobs = await Promise.all(ids.map(id => read(id).catch(() => undefined)));
    return jobs.filter((job): job is StoredJob => Boolean(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  };

  // Jobs whose process is gone cannot finish: the queue lived in that process. A job this process
  // owns is still running in the queue a Vite config restart left behind, and will finish there.
  const recovered = all().then(jobs => Promise.all(jobs.filter(job => (job.status === "queued" || job.status === "running") && !alive(job.pid))
    .map(job => persist({ ...job, status: "failed", error: "interrupted", finishedAt: now() })))).then(() => undefined, () => undefined);

  async function run(job: StoredJob): Promise<void> {
    const jobDir = dir(job.id);
    let tail = "";
    const log = (text: string) => {
      tail = (tail + text).slice(-LOG_TAIL_CHARS);
      void appendFile(path.join(jobDir, "job.log"), text).catch(() => undefined);
    };
    Object.assign(job, { status: "running", startedAt: now() });
    await persist(job);
    try {
      const promptFile = path.join(jobDir, "prompt.txt");
      const maps: Record<string, string> = {};
      for (const material of job.materials) {
        const reference = path.join(jobDir, `reference-${job.files[material]}.png`);
        const output = path.join(jobDir, `output-${job.files[material]}.png`);
        const size = pngDimensions(await readFile(reference))!;
        const started = Date.now();
        // A retry keeps every map already painted; only the missing ones go back to the generator.
        if ((await stat(output).catch(() => undefined))?.isFile()) log(`\n== ${material}: reusing ${path.basename(output)}\n`);
        else {
          log(`\n== ${material}: ${runner.generator} (${now()})\n`);
          await runner.run({ assetId: job.assetId, material, reference, output, promptFile, jobDir, cwd: repoRoot, prompt: job.prompt, width: size.width, height: size.height, timeoutMs, log });
        }
        if (!(await stat(output).catch(() => undefined))?.isFile()) throw new Error(`The generator finished without writing ${path.basename(output)}`);
        const image = sharp(await readFile(output));
        const meta = await image.metadata();
        const resized = meta.width !== size.width || meta.height !== size.height;
        const bytes = await (resized ? image.resize(size.width, size.height, { fit: "fill" }) : image).png().toBuffer();
        log(`\n== ${material}: done in ${Math.round((Date.now() - started) / 1000)} s, output ${meta.width}x${meta.height}${resized ? ` resized to ${size.width}x${size.height}` : ""}\n`);
        maps[material] = bytes.toString("base64");
        job.log = tail;
        await persist(job);
      }
      const saved = await saveSkin({ assetId: job.assetId, name: job.name, kind: "imagegen", maps, prompt: job.prompt, generator: runner.generator }, options);
      Object.assign(job, { status: "done", skinId: saved.skin.id, finishedAt: now(), log: tail });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`\n== failed: ${message}\n`);
      Object.assign(job, { status: "failed", error: message, finishedAt: now(), log: tail });
    }
    await persist(job);
  }

  return {
    async create(body) {
      await recovered;
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new SkinError(400, "Expected an ImagegenRequest object");
      const request = body as Partial<ImagegenRequest>;
      if (typeof request.name !== "string" || !request.name.trim()) throw new SkinError(400, "name is required");
      if (typeof request.prompt !== "string" || !request.prompt.trim()) throw new SkinError(400, "prompt is required");
      if (!request.references || typeof request.references !== "object" || Array.isArray(request.references)) throw new SkinError(400, "references must map material names to PNGs");
      const materials = Object.keys(request.references);
      await checkAssetMaterials(publicRoot, request.assetId, materials);
      const references = materials.map(material => decodeSkinPng(request.references![material], `Reference ${JSON.stringify(material)}`));
      const created = new Date();
      const id = jobId(created);
      const files = Object.fromEntries(materialFileNames(materials));
      const job: StoredJob = { id, assetId: request.assetId!, name: request.name.trim(), prompt: request.prompt, kind: "skin", materials, status: "queued", createdAt: created.toISOString(), files, pid: process.pid };
      await mkdir(dir(id), { recursive: true });
      await Promise.all(materials.map((material, index) => writeFile(path.join(dir(id), `reference-${files[material]}.png`), references[index]!)));
      await writeFile(path.join(dir(id), "prompt.txt"), `${request.prompt}\n`);
      await persist(job);
      queue = queue.then(() => run(job)).catch(() => undefined);
      return publicJob(job);
    },
    async retry(id) {
      await recovered;
      const job = await read(id);
      if (!job) return undefined;
      if (job.status !== "failed") throw new SkinError(409, `Only a failed job can be retried; this one is ${job.status}`);
      Object.assign(job, { status: "queued", error: undefined, finishedAt: undefined, startedAt: undefined, pid: process.pid });
      await persist(job);
      queue = queue.then(() => run(job)).catch(() => undefined);
      return publicJob(job);
    },
    async list() { await recovered; return (await all()).map(publicJob); },
    async get(id) { await recovered; const job = await read(id); return job && publicJob(job); },
    async idle() { await recovered; let current: Promise<void>; do { current = queue; await current; } while (current !== queue); },
  };
}

// Vite re-runs `configureServer` on a config restart inside the same process. One service per
// jobs directory keeps a restart from marking this process's own running job as interrupted.
const services = ((globalThis as { __corealmImagegenServices?: Map<string, ImagegenService> }).__corealmImagegenServices ??= new Map());

export function createImagegenHandler(options: ImagegenOptions = {}) {
  const key = path.resolve(options.jobsRoot ?? defaultJobsRoot);
  const service = options.runner ? createImagegenService(options) : services.get(key) ?? services.set(key, createImagegenService(options)).get(key)!;
  return async (request: ImagegenHandlerRequest): Promise<DevdocsJsonResponse | undefined> => {
    if (!isImagegenPath(request.url)) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return json(403, { error: "Dev docs API accepts loopback requests only" });
    const raw = request.url!.split(/[?#]/, 1)[0]!;
    const method = request.method ?? "GET";
    try {
      if (raw === IMAGEGEN_PATH) {
        if (method === "GET") return json(200, { jobs: await service.list() });
        if (method === "POST") return json(200, { job: await service.create(request.body) });
        return json(405, { error: "GET or POST required" });
      }
      const id = raw.slice(IMAGEGEN_PATH.length + 1);
      if (method !== "GET" && method !== "POST") return json(405, { error: "GET or POST required" });
      if (!JOB_ID.test(id)) return json(400, { error: "Invalid job id" });
      const job = method === "POST" ? await service.retry(id) : await service.get(id);
      return job ? json(200, { job }) : json(404, { error: "Unknown job" });
    } catch (error) {
      if (error instanceof SkinError) return json(error.status, { error: error.message, ...(error.detail === undefined ? {} : { diagnostics: error.detail }) });
      throw error;
    }
  };
}
