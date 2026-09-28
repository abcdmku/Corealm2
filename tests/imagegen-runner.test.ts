import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { decodePng, encodePng, pngSize, resizeRgba } from "../game/src/multiplayer/imagegenPng.js";
import {
  createCommandGenerator, createImagegenService, createSkinKind, ImagegenFailure, type ImagegenGenerator, type ImagegenKindHandler,
} from "../game/src/multiplayer/imagegenRunner.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function temp(): Promise<string> { const root = await mkdtemp(path.join(os.tmpdir(), "corealm-imagegen-")); roots.push(root); return root; }

const png = (width: number, height: number, colour = { r: 200, g: 90, b: 40 }) => sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer();
const paint = (width: number, height: number) => async (input: { output: string }) => { await writeFile(input.output, await png(width, height, { r: 10, g: 120, b: 130 })); };

/** A kind that records what it was asked and "publishes" into a list. */
function recordingKind<Owner = string>(saved: { job: string; names: string[]; sizes: string[]; owner: unknown }[]): ImagegenKindHandler<Owner> {
  return createSkinKind<Owner>({
    async save(job, maps, context) {
      saved.push({ job: job.id, names: [...maps.keys()], sizes: [...maps.values()].map(bytes => { const size = pngSize(bytes)!; return `${size.width}x${size.height}`; }), owner: context.owner });
      return { skinId: "tide", outputs: [...maps.keys()].map(name => `assets/skins/fish/tide/${name}.png`) };
    },
  });
}

async function request(names = ["coat"]) {
  return { assetId: "fish", name: "Tide", prompt: "Deep teal back", references: Object.fromEntries(await Promise.all(names.map(async name => [name, (await png(16, 8)).toString("base64")] as const))) };
}

describe("image job runner", () => {
  it("runs jobs one at a time, each image once, and finishes with the kind's outputs", async () => {
    const root = await temp(), saved: Parameters<typeof recordingKind>[0] = [];
    const order: string[] = [];
    let running = 0;
    const generator: ImagegenGenerator = { generator: "fake", run: async input => {
      running++;
      expect(running).toBe(1);
      order.push(`${input.name}: ${(await readFile(input.taskFile, "utf8")).includes("16x8")} ${input.reference ? path.basename(input.reference) : "-"}`);
      input.log("painting\n");
      await new Promise(resolve => setTimeout(resolve, 10));
      await paint(32, 16)(input);
      running--;
    } };
    const service = createImagegenService<string>({ root, generator, kinds: { skin: recordingKind(saved) } });
    const first = await service.create(await request(["coat", "Eye · left"]), "alice");
    const second = await service.create(await request(), "bob");
    expect(first).toMatchObject({ kind: "skin", assetId: "fish", name: "Tide", materials: ["coat", "Eye · left"], status: "queued" });
    expect(Object.keys(first)).not.toContain("owner");
    await service.idle();
    expect(order).toEqual(["coat: true reference-coat.png", "Eye · left: true reference-Eye_left.png", "coat: true reference-coat.png"]);
    expect(saved.map(row => [row.names, row.sizes, row.owner])).toEqual([[["coat", "Eye · left"], ["16x8", "16x8"], "alice"], [["coat"], ["16x8"], "bob"]]);
    const done = await service.get(first.id);
    expect(done).toMatchObject({ status: "done", skinId: "tide", outputs: ["assets/skins/fish/tide/coat.png", "assets/skins/fish/tide/Eye · left.png"] });
    expect(done!.log).toContain("resized to 16x8");
    expect((await service.list()).map(job => job.id).sort()).toEqual([first.id, second.id].sort());
    expect((await readdir(path.join(root, first.id))).sort()).toEqual(expect.arrayContaining(["job.json", "job.log", "prompt.txt", "output-coat.png", "task-coat.txt"]));
  });

  it("refuses bad requests and kinds it does not offer, then offers a registered kind", async () => {
    const service = createImagegenService<undefined>({ root: await temp(), generator: { generator: "fake", run: paint(4, 4) }, kinds: { skin: recordingKind<undefined>([]) } });
    const good = await request();
    const cases: [unknown, RegExp][] = [
      [null, /ImagegenRequest/], [{ ...good, name: " " }, /name/], [{ ...good, prompt: "" }, /prompt/], [{ ...good, kind: "paint" }, /kind/],
      [{ ...good, references: { coat: "R0lGODlh" } }, /not a PNG/], [{ ...good, references: {} }, /at least one/], [{ ...good, assetId: "../x" }, /assetId/],
      [{ ...good, kind: "icon", itemId: "iron_sword" }, /does not paint icon/], [{ ...good, kind: "icon", itemId: "../x" }, /itemId/],
    ];
    for (const [body, message] of cases) await expect(service.create(body, undefined), JSON.stringify(body)?.slice(0, 60)).rejects.toThrow(message);
    await expect(service.create(null, undefined)).rejects.toBeInstanceOf(ImagegenFailure);
    expect(await service.list()).toEqual([]);

    const icons: string[] = [];
    service.register("icon", {
      plan: request => { if (!request.itemId) throw new ImagegenFailure(400, "itemId is required"); return [{ name: "icon" }]; },
      task: (job, _step, files) => `Paint ${job.itemId} to ${files.output}`,
      finish: async (job, painted) => { icons.push(`${job.itemId} ${painted[0]!.reference === undefined}`); return { outputs: [`assets/icons/items/48/${job.itemId}.png`] }; },
    });
    expect(service.offers("icon")).toBe(true);
    await expect(service.create({ ...good, kind: "icon" }, undefined)).rejects.toThrow(/itemId is required/);
    const job = await service.create({ ...good, kind: "icon", itemId: "iron_sword", assetId: "" }, undefined);
    await service.idle();
    expect(await service.get(job.id)).toMatchObject({ kind: "icon", itemId: "iron_sword", materials: ["icon"], status: "done", outputs: ["assets/icons/items/48/iron_sword.png"] });
    expect(icons).toEqual(["iron_sword true"]);
  });

  it("fails a job when the generator fails or writes nothing, and retries without repainting what it wrote", async () => {
    const root = await temp(), saved: Parameters<typeof recordingKind>[0] = [];
    let calls = 0, saves = 0;
    const kind = recordingKind(saved);
    const flaky: ImagegenKindHandler<string> = { ...kind, finish: (job, painted, context) => ++saves === 1 ? Promise.reject(new Error("publish refused")) : kind.finish(job, painted, context) };
    const service = createImagegenService<string>({ root, generator: { generator: "fake", run: async input => { calls++; await paint(16, 8)(input); } }, kinds: { skin: flaky } });
    const job = await service.create(await request(), "alice");
    await service.idle();
    expect(await service.get(job.id)).toMatchObject({ status: "failed", error: "publish refused" });
    expect(await service.retry("missing-job")).toBeUndefined();
    expect(await service.retry(job.id)).toMatchObject({ status: "queued" });
    await service.idle();
    expect(await service.get(job.id)).toMatchObject({ status: "done", skinId: "tide" });
    expect(calls).toBe(1);
    expect(saved.map(row => row.owner)).toEqual(["alice"]);
    await expect(service.retry(job.id)).rejects.toThrow(/Only a failed job/);

    for (const run of [async () => { throw new Error("model refused"); }, async () => undefined]) {
      const broken = createImagegenService<string>({ root: await temp(), generator: { generator: "fake", run }, kinds: { skin: kind } });
      const failed = await broken.create(await request(), "alice");
      await broken.idle();
      expect(await broken.get(failed.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/model refused|without writing/) });
    }
  });

  it("marks jobs a previous process left running as interrupted, and keeps its own", async () => {
    const root = await temp();
    const stored = (id: string, extra: object) => ({ id, kind: "skin", assetId: "fish", name: id, prompt: "p", materials: ["coat"], status: "running",
      createdAt: "2026-09-26T00:00:00.000Z", steps: [{ name: "coat", reference: "coat", file: "coat" }], references: { coat: "coat" }, ...extra });
    await mkdir(path.join(root, "old-job"), { recursive: true });
    await writeFile(path.join(root, "old-job/job.json"), JSON.stringify(stored("old-job", { pid: 2 ** 22 + 12345 })));
    // A job this process owns is still running in the queue a Vite config restart left behind.
    await mkdir(path.join(root, "live-job"), { recursive: true });
    await writeFile(path.join(root, "live-job/job.json"), JSON.stringify(stored("live-job", { pid: process.pid })));
    const service = createImagegenService<string>({ root, generator: { generator: "fake", run: async () => undefined }, kinds: { skin: recordingKind([]) } });
    expect(await service.get("old-job")).toMatchObject({ status: "failed", error: "interrupted" });
    expect(await service.get("live-job")).toMatchObject({ status: "running" });
    expect(await service.get("../old-job")).toBeUndefined();
  });

  it("runs a configured shell command with the job's paths", async () => {
    const root = await temp();
    // Copies the reference to the output: a stand-in for Codex that exercises the template and the shell.
    const command = `node -e "require('fs').copyFileSync(process.argv[1], process.argv[2])" {reference} {output}`;
    const generator = createCommandGenerator({ command });
    expect(generator.generator).toBe("command: node");
    const saved: Parameters<typeof recordingKind>[0] = [];
    const service = createImagegenService<string>({ root, generator, kinds: { skin: recordingKind(saved) } });
    const job = await service.create(await request(), "alice");
    await service.idle();
    expect(await service.get(job.id), (await service.get(job.id))?.log).toMatchObject({ status: "done" });
    expect(saved[0]!.sizes).toEqual(["16x8"]);
  }, 30_000);
});

describe("portable PNG codec", () => {
  it("reads what sharp writes, writes what sharp reads, and resizes without shifting colour", async () => {
    for (const channels of [3, 4] as const) {
      const source = await sharp({ create: { width: 7, height: 5, channels, background: { r: 30, g: 140, b: 220, alpha: 0.5 } } }).png().toBuffer();
      const decoded = decodePng(source);
      const raw = await sharp(source).ensureAlpha().raw().toBuffer();
      expect(Buffer.from(decoded.data)).toEqual(raw);
      const encoded = encodePng(decoded);
      expect(await sharp(encoded).ensureAlpha().raw().toBuffer()).toEqual(raw);
      const small = resizeRgba(decoded, 3, 2), big = resizeRgba(decoded, 20, 9);
      expect([small.width, small.height, big.width, big.height]).toEqual([3, 2, 20, 9]);
      for (const image of [small, big]) expect([...image.data.subarray(0, 4)]).toEqual([...raw.subarray(0, 4)]);
    }
    const palette = await sharp({ create: { width: 9, height: 3, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png({ palette: true }).toBuffer();
    expect([...decodePng(palette).data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    const grey = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 128, g: 128, b: 128 } } }).greyscale().png().toBuffer();
    expect([...decodePng(grey).data.subarray(0, 4)]).toEqual([128, 128, 128, 255]);
    const sixteen = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 255, b: 0 } } }).toColourspace("rgb16").png().toBuffer();
    expect([...decodePng(sixteen).data.subarray(0, 4)]).toEqual([255, 255, 0, 255]);
  });
});
