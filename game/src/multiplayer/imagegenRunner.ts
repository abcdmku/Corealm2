import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ImagegenJob, ImagegenKind, ImagegenRequest } from "../../../devdocs/shared/skinContracts.js";
import { decodePng, encodePng, pngSize, resizeRgba } from "./imagegenPng.js";

/**
 * Image generation jobs, for both hosts: the repo editor's Vite middleware
 * (`devdocs/server/handlers/imagegen.ts`) and a live server's `/admin/imagegen`
 * (`adminImagegen.ts`). Plain Node, no Vite and no native addon, so the packaged server carries it.
 *
 * A job is a directory `<root>/<jobId>/`: `job.json` (rewritten on every transition, so the list
 * survives a restart), the prompt, the reference PNGs, one `output-<file>.png` per painted image, and
 * `job.log`. Jobs run one at a time per service. Each image is one run of the generator (Codex CLI by
 * default, or a configured shell command). An output already on disk is never painted again, so
 * Retry after a failed save costs no new generation.
 *
 * What a job paints and what happens to the result depends on its kind (`skin` | `icon`), through an
 * `ImagegenKindHandler`: `plan` checks the request and lists the images, `task` writes each image's
 * instruction, `finish` turns the painted files into the finished asset (files stored, content saved
 * or published) and reports what it wrote. The host registers a handler per kind it offers; a
 * request of any other kind is refused.
 */

export const IMAGEGEN_TIMEOUT_MS = 20 * 60 * 1000;
export const IMAGEGEN_MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const IMAGEGEN_MAX_DIMENSION = 4096;
/** A request carries several 16 MB references as base64. */
export const IMAGEGEN_MAX_REQUEST_BYTES = 96 * 1024 * 1024;
const LOG_TAIL_CHARS = 4000;
export const IMAGEGEN_JOB_ID = /^[a-z0-9-]+$/;
const SAFE_ID = /^[a-z0-9_.-]+$/;
const BASE64 = /^(?:data:image\/png;base64,)?([A-Za-z0-9+/]+={0,2})$/;

/** A request or action this host refuses; `status` is the HTTP status to answer with. */
export class ImagegenFailure extends Error {
  constructor(readonly status: number, message: string, readonly detail?: unknown) { super(message); this.name = "ImagegenFailure"; }
}

export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value) && value !== "." && value !== ".." && value.length <= 120;
}

/** A lowercase id from free text: `Mossy Frog!` -> `mossy-frog`. */
export function slugId(text: string): string {
  return text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80) || "skin";
}

/**
 * File names for free-text names (`Wild horse · source coat` -> `Wild_horse_source_coat`), in the
 * `[A-Za-z0-9_.-]` a map path allows, deduplicated case-insensitively.
 */
export function materialFileNames(materials: readonly string[]): Map<string, string> {
  const used = new Set<string>(), names = new Map<string, string>();
  for (const material of materials) {
    const base = material.normalize("NFKD").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/_+/g, "_").replace(/^[_.]+|[_.]+$/g, "").slice(0, 80) || "material";
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`;
    used.add(name.toLowerCase());
    names.set(material, name);
  }
  return names;
}

/** One reference image (base64, with or without a PNG data URL prefix), checked to be a sane PNG. */
export function decodeReferencePng(value: unknown, label: string): Buffer {
  if (typeof value !== "string" || value.length > Math.ceil(IMAGEGEN_MAX_IMAGE_BYTES / 3) * 4 + 64) throw new ImagegenFailure(400, `${label}: expected a base64 PNG up to 16 MB`);
  const match = BASE64.exec(value);
  if (!match) throw new ImagegenFailure(400, `${label}: not base64 PNG data`);
  const bytes = Buffer.from(match[1]!, "base64"), size = pngSize(bytes);
  if (!size) throw new ImagegenFailure(400, `${label}: not a PNG`);
  if (bytes.length > IMAGEGEN_MAX_IMAGE_BYTES) throw new ImagegenFailure(400, `${label}: larger than 16 MB`);
  if (size.width < 1 || size.height < 1 || size.width > IMAGEGEN_MAX_DIMENSION || size.height > IMAGEGEN_MAX_DIMENSION)
    throw new ImagegenFailure(400, `${label}: ${size.width}x${size.height} is outside 1..${IMAGEGEN_MAX_DIMENSION}`);
  return bytes;
}

/* ---------- Kinds ---------- */

/** One image a job paints: one generator run. */
export interface ImagegenStep {
  /** Shown in the log and listed as the job's `materials`: a material name for a skin, e.g. `icon` for an icon. */
  name: string;
  /** The reference (a key of the request's `references`) attached to this run, if any. */
  reference?: string;
}

/** A painted image, as the generator wrote it. */
export interface PaintedImage {
  step: ImagegenStep;
  /** Absolute path of `output-<file>.png` in the job directory. */
  file: string;
  bytes: Buffer;
  /** The attached reference's bytes, when the step had one. */
  reference?: Buffer;
}

export interface ImagegenFinishContext<Owner> {
  /** Who started the job: `undefined` in the repo editor, the admin actor on a server. */
  owner: Owner;
  /** Recorded as the asset's generator, e.g. `codex exec + gpt-image`. */
  generator: string;
  /** Appends to the job's log. */
  log(text: string): void;
}

/** What a finished job records. */
export interface ImagegenFinished {
  /** A skin job's saved skin. */
  skinId?: string;
  /** Every file written, by public path (`assets/skins/...`, `assets/icons/items/48/<id>.png`). */
  outputs: string[];
}

/**
 * What a host plugs in per job kind. Every method may throw `ImagegenFailure`: from `plan` it refuses
 * the request (nothing is stored), from `finish` it fails the job with its outputs kept, so Retry calls
 * `finish` again without painting anything.
 */
export interface ImagegenKindHandler<Owner = unknown> {
  /** Checks a request of this kind and lists the images to paint. `references` are decoded, checked PNGs. */
  plan(request: ImagegenRequest, references: ReadonlyMap<string, Buffer>): Promise<ImagegenStep[]> | ImagegenStep[];
  /** The instruction one generator run receives. It must tell the generator to save a PNG at exactly `output`. */
  task(job: ImagegenJob, step: ImagegenStep, files: { output: string; reference?: { path: string; width: number; height: number } }): string;
  /** Turns the painted images, in `plan` order, into the finished asset. */
  finish(job: ImagegenJob, painted: readonly PaintedImage[], context: ImagegenFinishContext<Owner>): Promise<ImagegenFinished>;
}

/**
 * The hook for item icon jobs (`kind: "icon"`, docs/item-icons.md), implemented beside the icon art
 * pipeline and registered by the host: `service.register("icon", finisher)` (or `kinds: { icon }` when
 * creating the service; on a server, `createImagegenRoute(...).register("icon", finisher)`).
 *
 * - `plan`: require `request.itemId` (and that the item exists), throw `ImagegenFailure(400)` if not;
 *   return one step, e.g. `{ name: "icon", reference: <a key of request.references> }` or no reference.
 * - `task`: the icon prompt text for that item; it must name `files.output` as the PNG to save.
 * - `finish`: trim and scale `painted[0].bytes` to the 256 master, derive the 48 inventory icon, store
 *   both (repo: the checkout; server: the content asset store, as `context.owner`), record provenance,
 *   and return `{ outputs: [<256 path>, <48 path>] }`. `imagegenPng.ts` decodes, resizes and encodes
 *   PNGs without native addons.
 */
export type IconJobFinisher<Owner = unknown> = ImagegenKindHandler<Owner>;

/** The instruction one generator run receives for one skin map. */
export function skinTask(input: { assetId: string; material: string; reference: string; output: string; prompt: string; width: number; height: number }): string {
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

export interface SkinKindOptions<Owner> {
  /** Extra request checks, such as the asset and its materials against a manifest. Throws to refuse. */
  check?(request: ImagegenRequest, materials: readonly string[]): Promise<void>;
  /** Saves the maps (material -> PNG, already the reference's size) as an `imagegen` skin named `job.name`. */
  save(job: ImagegenJob, maps: ReadonlyMap<string, Buffer>, context: ImagegenFinishContext<Owner>): Promise<ImagegenFinished>;
}

/** The `skin` kind: one run per material map, each output stretched back to its reference's size, then saved. */
export function createSkinKind<Owner>(options: SkinKindOptions<Owner>): ImagegenKindHandler<Owner> {
  return {
    async plan(request, references) {
      if (!isSafeId(request.assetId)) throw new ImagegenFailure(400, "assetId must match [a-z0-9_.-]");
      const materials = [...references.keys()];
      if (!materials.length) throw new ImagegenFailure(400, "A skin job needs at least one reference map");
      await options.check?.(request, materials);
      return materials.map(material => ({ name: material, reference: material }));
    },
    task: (job, step, files) => skinTask({ assetId: job.assetId, material: step.name, reference: files.reference!.path, output: files.output,
      prompt: job.prompt, width: files.reference!.width, height: files.reference!.height }),
    async finish(job, painted, context) {
      const maps = new Map<string, Buffer>();
      for (const image of painted) {
        const size = pngSize(image.reference!)!;
        const decoded = decodePng(image.bytes);
        const resized = decoded.width !== size.width || decoded.height !== size.height;
        maps.set(image.step.name, resized ? encodePng(resizeRgba(decoded, size.width, size.height)) : image.bytes);
        if (resized) context.log(`\n== ${image.step.name}: output ${decoded.width}x${decoded.height} resized to ${size.width}x${size.height}\n`);
      }
      return options.save(job, maps, context);
    },
  };
}

/* ---------- The generator ---------- */

export interface ImagegenRunInput {
  /** The step's name. */
  name: string;
  /** The full instruction (`ImagegenKindHandler.task`), also on disk at `taskFile`. */
  task: string;
  /** Absolute paths. `reference` is absent for a step with none. */
  reference?: string;
  output: string;
  /** The author's prompt alone. */
  promptFile: string;
  taskFile: string;
  jobDir: string;
  cwd: string;
  timeoutMs: number;
  log: (text: string) => void;
}
export interface ImagegenGenerator {
  /** Recorded as the asset's `generator`. */
  generator: string;
  /** Resolves once `output` is written; rejects on failure or timeout. */
  run: (input: ImagegenRunInput) => Promise<void>;
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

export interface CommandGeneratorOptions {
  /**
   * A shell template run per image instead of Codex, with `{reference}` `{output}` `{prompt_file}`
   * `{task_file}` `{cwd}` replaced by quoted paths (`{reference}` is empty for a step without one).
   */
  command?: string;
  /** Codex `model_reasoning_effort`. Default `medium`: painting needs the image model, not deep reasoning. */
  effort?: string;
}

/** `codex exec` with the reference attached and the task on stdin, or the configured command. */
export function createCommandGenerator(options: CommandGeneratorOptions = {}): ImagegenGenerator {
  const template = options.command?.trim();
  if (template) return {
    generator: `command: ${template.split(/\s+/, 1)[0]}`,
    run: input => runShell(template.replace(/\{(reference|output|prompt_file|task_file|cwd)\}/g, (_, key: string) =>
      quote(key === "reference" ? input.reference ?? "" : key === "output" ? input.output : key === "prompt_file" ? input.promptFile : key === "task_file" ? input.taskFile : input.cwd)), input),
  };
  return {
    generator: "codex exec + gpt-image",
    run: input => runShell([
      "codex", "exec", "-c", quote(`model_reasoning_effort=${options.effort?.trim() || "medium"}`),
      ...(input.reference ? ["-i", quote(input.reference)] : []), "-C", quote(input.cwd), "--sandbox", "workspace-write", "--skip-git-repo-check",
      "-o", quote(path.join(input.jobDir, `codex-last-${path.basename(input.output, ".png").replace(/^output-/, "")}.md`)), "-",
    ].join(" "), { ...input, stdin: input.task }),
  };
}

/* ---------- The service ---------- */

export interface ImagegenServiceOptions<Owner> {
  /** Absolute directory holding `<jobId>/`. */
  root: string;
  generator: ImagegenGenerator;
  /** Handlers by kind. More can be added with `register`. */
  kinds?: Partial<Record<ImagegenKind, ImagegenKindHandler<Owner>>>;
  /** Where the generator runs. Default: the job's own directory. */
  cwd?: string;
  timeoutMs?: number;
  now?: () => Date;
  /**
   * Checked right before a job finishes (stores and publishes as its owner): why that owner may no
   * longer write, or null. A refusal fails the job with that reason and keeps its painted images,
   * so a Retry by a current admin, who then owns the job, finishes it without painting again.
   */
  standing?(owner: Owner): Promise<string | null>;
}

export interface ImagegenService<Owner> {
  /** Checks and queues a job. Throws `ImagegenFailure` for a request this host refuses. */
  create(body: unknown, owner: Owner): Promise<ImagegenJob>;
  /** Newest first. */
  list(): Promise<ImagegenJob[]>;
  get(id: string): Promise<ImagegenJob | undefined>;
  /** Queue a failed job again. Images it already painted are reused. With `owner`, that caller finishes (publishes) it; without, its creator. */
  retry(id: string, owner?: Owner): Promise<ImagegenJob | undefined>;
  /** Resolves when the queue is empty. */
  idle(): Promise<void>;
  /** Offer a job kind, or replace its handler. */
  register(kind: ImagegenKind, handler: ImagegenKindHandler<Owner>): void;
  /** Whether a kind is offered. */
  offers(kind: ImagegenKind): boolean;
}

const KINDS: readonly ImagegenKind[] = ["skin", "icon"];

/** `pid` is the process whose queue runs the job; `owner` who started it; files are the job directory's names. */
interface StoredJob<Owner> extends ImagegenJob {
  steps: (ImagegenStep & { file: string })[];
  /** Reference name -> file name part (`reference-<file>.png`). */
  references: Record<string, string>;
  owner?: Owner;
  pid?: number;
}

/** Whether a process still exists. Signal 0 only checks; EPERM means it exists but is not ours. */
function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function jobIdAt(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").toLowerCase()}-${randomBytes(3).toString("hex")}`;
}

async function replaceFile(file: string, text: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, text); await rename(temporary, file); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

const publicJob = <Owner>({ steps: _steps, references: _references, owner: _owner, pid: _pid, ...job }: StoredJob<Owner>): ImagegenJob => job;

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** The request's shape, before its kind's own checks. */
export function parseImagegenRequest(body: unknown): { request: ImagegenRequest & { kind: ImagegenKind }; references: Map<string, Buffer> } {
  if (!record(body)) throw new ImagegenFailure(400, "Expected an ImagegenRequest object");
  const kind = body.kind ?? "skin";
  if (!KINDS.includes(kind as ImagegenKind)) throw new ImagegenFailure(400, "kind must be skin or icon");
  if (typeof body.name !== "string" || !body.name.trim()) throw new ImagegenFailure(400, "name is required");
  if (typeof body.prompt !== "string" || !body.prompt.trim()) throw new ImagegenFailure(400, "prompt is required");
  if (typeof body.assetId !== "string") throw new ImagegenFailure(400, "assetId must be a string");
  if (body.itemId !== undefined && !isSafeId(body.itemId)) throw new ImagegenFailure(400, "itemId must match [a-z0-9_.-]");
  if (!record(body.references)) throw new ImagegenFailure(400, "references must map names to PNGs");
  const references = new Map(Object.entries(body.references).map(([name, value]) => [name, decodeReferencePng(value, `Reference ${JSON.stringify(name)}`)] as const));
  return {
    request: { kind: kind as ImagegenKind, assetId: body.assetId, name: body.name.trim(), prompt: body.prompt, references: body.references as Record<string, string>,
      ...(body.itemId === undefined ? {} : { itemId: body.itemId as string }) },
    references,
  };
}

export function createImagegenService<Owner>(options: ImagegenServiceOptions<Owner>): ImagegenService<Owner> {
  const root = path.resolve(options.root);
  const kinds = new Map(Object.entries(options.kinds ?? {}) as [ImagegenKind, ImagegenKindHandler<Owner>][]);
  const { generator } = options;
  const timeoutMs = options.timeoutMs ?? IMAGEGEN_TIMEOUT_MS;
  const clock = options.now ?? (() => new Date());
  const now = () => clock().toISOString();
  let queue: Promise<void> = Promise.resolve();

  const dir = (id: string) => path.join(root, id);
  const persist = (job: StoredJob<Owner>) => replaceFile(path.join(dir(job.id), "job.json"), `${JSON.stringify(job, null, 2)}\n`);
  const read = async (id: string): Promise<StoredJob<Owner> | undefined> => {
    if (!IMAGEGEN_JOB_ID.test(id)) return undefined;
    try { return JSON.parse(await readFile(path.join(dir(id), "job.json"), "utf8")) as StoredJob<Owner>; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  };
  const all = async (): Promise<StoredJob<Owner>[]> => {
    const ids = await readdir(root).catch(() => [] as string[]);
    const jobs = await Promise.all(ids.map(id => read(id).catch(() => undefined)));
    return jobs.filter((job): job is StoredJob<Owner> => Boolean(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  };

  // A job whose process is gone cannot finish: the queue lived in that process. A job this process
  // owns is still running in a queue a Vite config restart left behind, and will finish there.
  const recovered = all().then(jobs => Promise.all(jobs.filter(job => (job.status === "queued" || job.status === "running") && !alive(job.pid))
    .map(job => persist({ ...job, status: "failed", error: "interrupted", finishedAt: now() })))).then(() => undefined, () => undefined);

  async function run(job: StoredJob<Owner>): Promise<void> {
    const jobDir = dir(job.id);
    let tail = "";
    const log = (text: string) => {
      tail = (tail + text).slice(-LOG_TAIL_CHARS);
      void appendFile(path.join(jobDir, "job.log"), text).catch(() => undefined);
    };
    Object.assign(job, { status: "running", startedAt: now() });
    await persist(job);
    try {
      const handler = kinds.get(job.kind);
      if (!handler) throw new Error(`This host no longer paints ${job.kind} jobs`);
      const promptFile = path.join(jobDir, "prompt.txt");
      const painted: PaintedImage[] = [];
      for (const step of job.steps) {
        const referenceFile = step.reference === undefined ? undefined : path.join(jobDir, `reference-${job.references[step.reference]}.png`);
        const reference = referenceFile ? await readFile(referenceFile) : undefined;
        const output = path.join(jobDir, `output-${step.file}.png`);
        const started = Date.now();
        // A retry keeps every image already painted; only the missing ones go back to the generator.
        if ((await stat(output).catch(() => undefined))?.isFile()) log(`\n== ${step.name}: reusing ${path.basename(output)}\n`);
        else {
          const size = reference ? pngSize(reference)! : undefined;
          const task = handler.task(publicJob(job), step, { output, ...(referenceFile && size ? { reference: { path: referenceFile, ...size } } : {}) });
          const taskFile = path.join(jobDir, `task-${step.file}.txt`);
          await writeFile(taskFile, `${task}\n`);
          log(`\n== ${step.name}: ${generator.generator} (${now()})\n`);
          await generator.run({ name: step.name, task, ...(referenceFile ? { reference: referenceFile } : {}), output, promptFile, taskFile, jobDir,
            cwd: options.cwd ?? jobDir, timeoutMs, log });
          log(`\n== ${step.name}: painted in ${Math.round((Date.now() - started) / 1000)} s\n`);
        }
        const bytes = await readFile(output).catch(() => undefined);
        if (!bytes) throw new Error(`The generator finished without writing ${path.basename(output)}`);
        if (!pngSize(bytes)) throw new Error(`${path.basename(output)} is not a PNG`);
        painted.push({ step: { name: step.name, ...(step.reference === undefined ? {} : { reference: step.reference }) }, file: output, bytes, ...(reference ? { reference } : {}) });
        job.log = tail;
        await persist(job);
      }
      if (options.standing && job.owner !== undefined) {
        const refused = await options.standing(job.owner);
        if (refused) throw new Error(`${refused}. The painted images are kept: Retry as a current admin to publish them.`);
      }
      const finished = await handler.finish(publicJob(job), painted, { owner: job.owner as Owner, generator: generator.generator, log });
      Object.assign(job, { status: "done", ...(finished.skinId ? { skinId: finished.skinId } : {}), outputs: finished.outputs, finishedAt: now() });
      log(`\n== done: ${finished.outputs.join(", ")}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`\n== failed: ${message}\n`);
      Object.assign(job, { status: "failed", error: message, finishedAt: now() });
    }
    job.log = tail;
    await persist(job);
  }

  const enqueue = (job: StoredJob<Owner>) => { queue = queue.then(() => run(job)).catch(() => undefined); };

  return {
    async create(body, owner) {
      await recovered;
      const { request, references } = parseImagegenRequest(body);
      const handler = kinds.get(request.kind);
      if (!handler) throw new ImagegenFailure(400, `This host does not paint ${request.kind} jobs`);
      const planned = await handler.plan(request, references);
      if (!planned.length) throw new ImagegenFailure(400, "Nothing to paint");
      for (const step of planned) if (step.reference !== undefined && !references.has(step.reference)) throw new ImagegenFailure(400, `No reference ${JSON.stringify(step.reference)}`);
      const stepFiles = materialFileNames(planned.map(step => step.name)), referenceFiles = materialFileNames([...references.keys()]);
      const created = clock(), id = jobIdAt(created);
      const job: StoredJob<Owner> = {
        id, kind: request.kind, ...(request.itemId ? { itemId: request.itemId } : {}), assetId: request.assetId, name: request.name, prompt: request.prompt,
        materials: planned.map(step => step.name), status: "queued", createdAt: created.toISOString(),
        steps: planned.map(step => ({ ...step, file: stepFiles.get(step.name)! })), references: Object.fromEntries(referenceFiles),
        ...(owner === undefined ? {} : { owner }), pid: process.pid,
      };
      await mkdir(dir(id), { recursive: true });
      await Promise.all([...references].map(([name, bytes]) => writeFile(path.join(dir(id), `reference-${referenceFiles.get(name)}.png`), bytes)));
      await writeFile(path.join(dir(id), "prompt.txt"), `${request.prompt}\n`);
      await persist(job);
      enqueue(job);
      return publicJob(job);
    },
    async retry(id, owner) {
      await recovered;
      const job = await read(id);
      if (!job) return undefined;
      if (job.status !== "failed") throw new ImagegenFailure(409, `Only a failed job can be retried; this one is ${job.status}`);
      Object.assign(job, { status: "queued", error: undefined, finishedAt: undefined, startedAt: undefined, pid: process.pid, ...(owner === undefined ? {} : { owner }) });
      await persist(job);
      enqueue(job);
      return publicJob(job);
    },
    async list() { await recovered; return (await all()).map(publicJob); },
    async get(id) { await recovered; const job = await read(id); return job && publicJob(job); },
    async idle() { await recovered; let current: Promise<void>; do { current = queue; await current; } while (current !== queue); },
    register(kind, handler) { kinds.set(kind, handler); },
    offers: kind => kinds.has(kind),
  };
}
