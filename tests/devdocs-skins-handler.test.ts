import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import type { CreatureSkin, ImagegenJob, SaveSkinResponse } from "../devdocs/shared/skinContracts.js";
import { createSkinsHandler } from "../devdocs/server/handlers/skins.js";
import { createImagegenHandler, createImagegenService, type ImagegenRunner } from "../devdocs/server/handlers/imagegen.js";
import type { DevdocsJsonResponse } from "../devdocs/server/handlers/collections.js";
import { contentRevision } from "../tools/content/format.js";
import { repoRoot } from "../tools/lib/paths.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const ASSET = "animal_salmon";
const MATERIAL = "animal_salmon_mat";
const SPACED = "Wild horse · source coat";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "corealm-devdocs-skins-"));
  roots.push(root);
  const contentRoot = path.join(root, "content"), publicRoot = path.join(root, "public"), jobsRoot = path.join(root, "jobs");
  await cp(path.join(repoRoot, "game/content/data"), path.join(contentRoot, "data"), { recursive: true });
  await writeFile(path.join(contentRoot, "data/creatureSkins.json"), "[]\n");
  await mkdir(path.join(publicRoot, "assets"), { recursive: true });
  // Real asset ids, so the content compiler's repo asset pool accepts the skin's `assetId`.
  await writeFile(path.join(publicRoot, "assets/manifest.json"), JSON.stringify({ assets: [
    { id: ASSET, materials: [MATERIAL] },
    { id: "creature_marchwild_horse", materials: [SPACED, "Wild horse · source eye"] },
  ] }));
  const options = { contentRoot, publicRoot, jobsRoot, now: () => "2026-09-27T12:00:00.000Z" };
  return { root, contentRoot, publicRoot, jobsRoot, options };
}

async function png(width: number, height: number, colour = { r: 200, g: 90, b: 40 }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer();
}
const body = <T>(response: DevdocsJsonResponse | undefined): T => JSON.parse(response!.body) as T;
const skins = async (contentRoot: string) => JSON.parse(await readFile(path.join(contentRoot, "data/creatureSkins.json"), "utf8")) as CreatureSkin[];
const post = (url: string, payload: unknown) => ({ method: "POST", url, body: payload, socket: { remoteAddress: "127.0.0.1" } });

describe("devdocs skins handler", () => {
  it("writes a recolor skin's maps and upserts its record with hashes and a new revision", async () => {
    const { contentRoot, publicRoot, options } = await fixture();
    const handler = createSkinsHandler(options);
    const map = await png(8, 4);
    const response = await handler(post("/__devdocs/skins", { assetId: ASSET, name: "Rusty Salmon", kind: "recolor",
      maps: { [MATERIAL]: map.toString("base64") }, recolor: { hue: 20, saturation: 1.1, value: 0.9 } }));
    expect(response?.status, response?.body).toBe(200);
    const saved = body<SaveSkinResponse>(response);
    // Maps are re-encoded smaller; the pixels and the recorded hash of the written file must match.
    const written = await readFile(path.join(publicRoot, "assets", `skins/${ASSET}/rusty-salmon/${MATERIAL}.png`));
    expect(await sharp(written).raw().toBuffer()).toEqual(await sharp(map).raw().toBuffer());
    const expected: CreatureSkin = { id: "rusty-salmon", assetId: ASSET, name: "Rusty Salmon", kind: "recolor",
      maps: { [MATERIAL]: `skins/${ASSET}/rusty-salmon/${MATERIAL}.png` }, recolor: { hue: 20, saturation: 1.1, value: 0.9 },
      sha256: { [MATERIAL]: createHash("sha256").update(written).digest("hex") }, createdAt: "2026-09-27T12:00:00.000Z" };
    expect(saved.skin).toEqual(expected);
    const text = await readFile(path.join(contentRoot, "data/creatureSkins.json"), "utf8");
    expect(JSON.parse(text)).toEqual([expected]);
    expect(saved.revision).toBe(contentRevision(text));

    // A second skin with the same name gets a fresh id instead of replacing the first.
    const second = body<SaveSkinResponse>(await handler(post("/__devdocs/skins", { assetId: ASSET, name: "Rusty Salmon", kind: "recolor", maps: { [MATERIAL]: map.toString("base64") } })));
    expect(second.skin.id).toBe("rusty-salmon-2");
    expect((await skins(contentRoot)).map(row => row.id)).toEqual(["rusty-salmon", "rusty-salmon-2"]);
  }, 60_000);

  it("merges an uploaded map into an existing skin and records which map was uploaded", async () => {
    const { contentRoot, publicRoot, options } = await fixture();
    const handler = createSkinsHandler(options);
    const generated = body<SaveSkinResponse>(await handler(post("/__devdocs/skins", { assetId: ASSET, name: "Tide Salmon", kind: "imagegen",
      prompt: "teal", generator: "fake", maps: { [MATERIAL]: (await png(8, 4)).toString("base64") } }))).skin;
    const upload = await png(8, 4, { r: 10, g: 20, b: 30 });
    const response = await handler(post("/__devdocs/skins", { assetId: ASSET, skinId: generated.id, name: "Tide Salmon", kind: "upload", merge: true,
      maps: { [MATERIAL]: upload.toString("base64") } }));
    expect(response?.status, response?.body).toBe(200);
    const merged = body<SaveSkinResponse>(response).skin;
    expect(merged).toMatchObject({ id: generated.id, kind: "imagegen", prompt: "teal", generator: "fake", createdAt: generated.createdAt, uploaded: [MATERIAL] });
    expect(merged.sha256![MATERIAL]).not.toBe(generated.sha256![MATERIAL]);
    const written = await readFile(path.join(publicRoot, "assets", merged.maps[MATERIAL]!));
    expect(await sharp(written).raw().toBuffer()).toEqual(await sharp(upload).raw().toBuffer());
    expect((await skins(contentRoot)).map(skin => skin.id)).toEqual([generated.id]);

    const missing = await handler(post("/__devdocs/skins", { assetId: ASSET, skinId: "nope", name: "x", kind: "upload", merge: true, maps: { [MATERIAL]: upload.toString("base64") } }));
    expect(missing?.status).toBe(404);
    const noId = await handler(post("/__devdocs/skins", { assetId: ASSET, name: "x", kind: "upload", merge: true, maps: { [MATERIAL]: upload.toString("base64") } }));
    expect(noId?.status).toBe(400);
  }, 60_000);

  it("names map files from free-text material names", async () => {
    const { publicRoot, options } = await fixture();
    const saved = body<SaveSkinResponse>(await createSkinsHandler(options)(post("/__devdocs/skins", {
      assetId: "creature_marchwild_horse", skinId: "bay", name: "Bay", kind: "source", maps: { [SPACED]: (await png(2, 2)).toString("base64") } })));
    expect(saved.skin.maps).toEqual({ [SPACED]: "skins/creature_marchwild_horse/bay/Wild_horse_source_coat.png" });
    expect(await readdir(path.join(publicRoot, "assets/skins/creature_marchwild_horse/bay"))).toEqual(["Wild_horse_source_coat.png"]);
  }, 60_000);

  it("rejects unknown assets and materials, non-PNG data, oversized images, unsafe ids and remote callers", async () => {
    const { contentRoot, publicRoot, options } = await fixture();
    const handler = createSkinsHandler(options);
    const good = (await png(4, 4)).toString("base64");
    const huge = Buffer.from(await png(1, 1));
    huge.writeUInt32BE(5000, 16); // IHDR width
    const cases: [unknown, number, RegExp][] = [
      [{ assetId: "animal_nothing", name: "X", kind: "recolor", maps: { m: good } }, 404, /Unknown asset/],
      [{ assetId: ASSET, name: "X", kind: "recolor", maps: { other_mat: good } }, 400, /no material "other_mat"/],
      [{ assetId: ASSET, name: "X", kind: "recolor", maps: {} }, 400, /At least one/],
      [{ assetId: ASSET, name: "X", kind: "recolor", maps: { [MATERIAL]: Buffer.from("GIF89a not a png").toString("base64") } }, 400, /not a PNG/],
      [{ assetId: ASSET, name: "X", kind: "recolor", maps: { [MATERIAL]: huge.toString("base64") } }, 400, /outside 1\.\.4096/],
      [{ assetId: "../../content", name: "X", kind: "recolor", maps: { [MATERIAL]: good } }, 400, /assetId/],
      [{ assetId: ASSET, skinId: "../escape", name: "X", kind: "recolor", maps: { [MATERIAL]: good } }, 400, /skinId/],
      [{ assetId: ASSET, skinId: "..", name: "X", kind: "recolor", maps: { [MATERIAL]: good } }, 400, /skinId/],
      [{ assetId: ASSET, name: "X", kind: "paint", maps: { [MATERIAL]: good } }, 400, /kind/],
    ];
    for (const [payload, status, error] of cases) {
      const response = await handler(post("/__devdocs/skins", payload));
      expect(response?.status, JSON.stringify(payload).slice(0, 80)).toBe(status);
      expect(body<{ error: string }>(response).error).toMatch(error);
    }
    expect((await handler({ method: "POST", url: "/__devdocs/skins", body: {}, socket: { remoteAddress: "192.0.2.1" } }))?.status).toBe(403);
    expect((await handler({ method: "GET", url: "/__devdocs/skins" }))?.status).toBe(405);
    expect(await skins(contentRoot)).toEqual([]);
    expect(await readdir(path.join(publicRoot, "assets"))).toEqual(["manifest.json"]);
  }, 60_000);
});

describe("devdocs imagegen jobs", () => {
  const request = async () => ({ assetId: ASSET, name: "Tide Salmon", prompt: "Deep teal back with silver speckles", references: { [MATERIAL]: (await png(16, 8)).toString("base64") } });

  it("runs a queued job and saves the repainted map, resized to the reference, as an imagegen skin", async () => {
    const { contentRoot, publicRoot, jobsRoot, options } = await fixture();
    const seen: string[] = [];
    const runner: ImagegenRunner = { generator: "fake", run: async input => {
      seen.push(`${input.material} ${input.width}x${input.height} ${await readFile(input.promptFile, "utf8")}`);
      input.log("painting\n");
      await sharp({ create: { width: 32, height: 16, channels: 3, background: { r: 10, g: 120, b: 130 } } }).png().toFile(input.output);
    } };
    const handler = createImagegenHandler({ ...options, runner });
    const created = await handler(post("/__devdocs/imagegen", await request()));
    expect(created?.status, created?.body).toBe(200);
    const job = body<{ job: ImagegenJob }>(created).job;
    expect(job).toMatchObject({ assetId: ASSET, name: "Tide Salmon", materials: [MATERIAL], status: "queued" });
    expect((await readdir(path.join(jobsRoot, job.id))).sort()).toEqual(expect.arrayContaining(["job.json", "prompt.txt", `reference-${MATERIAL}.png`]));

    let finished: ImagegenJob | undefined;
    for (let i = 0; i < 400 && !["done", "failed"].includes(finished?.status ?? ""); i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      finished = body<{ job: ImagegenJob }>(await handler({ method: "GET", url: `/__devdocs/imagegen/${job.id}` })).job;
    }
    expect(finished, finished?.error).toMatchObject({ status: "done", skinId: "tide-salmon" });
    expect(finished!.log).toContain("resized to 16x8");
    expect(seen).toEqual([`${MATERIAL} 16x8 Deep teal back with silver speckles\n`]);
    const [skin] = await skins(contentRoot);
    expect(skin).toMatchObject({ id: "tide-salmon", kind: "imagegen", generator: "fake", prompt: "Deep teal back with silver speckles" });
    expect(await sharp(path.join(publicRoot, "assets", skin!.maps[MATERIAL]!)).metadata()).toMatchObject({ width: 16, height: 8, format: "png" });
    expect(body<{ jobs: ImagegenJob[] }>(await handler({ method: "GET", url: "/__devdocs/imagegen" })).jobs.map(row => row.id)).toEqual([job.id]);
  }, 60_000);

  it("marks a job failed when the generator fails or writes nothing", async () => {
    const { contentRoot, options } = await fixture();
    for (const run of [async () => { throw new Error("model refused"); }, async () => undefined]) {
      const service = createImagegenService({ ...options, runner: { generator: "fake", run } });
      const job = await service.create(await request());
      await service.idle();
      expect(await service.get(job.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/model refused|without writing/) });
    }
    expect(await skins(contentRoot)).toEqual([]);
  }, 60_000);

  it("retries a failed job without repainting maps it already wrote", async () => {
    const { contentRoot, options } = await fixture();
    let calls = 0;
    // Paints the map, then fails as a crashed save would; the retry must reuse the painting.
    const run: ImagegenRunner["run"] = async input => {
      calls++;
      await sharp({ create: { width: 16, height: 8, channels: 3, background: { r: 10, g: 120, b: 130 } } }).png().toFile(input.output);
      if (calls === 1) throw new Error("save gate failed");
    };
    const service = createImagegenService({ ...options, runner: { generator: "fake", run } });
    const job = await service.create(await request());
    await service.idle();
    expect(await service.get(job.id)).toMatchObject({ status: "failed" });
    await expect(service.retry("missing-job")).resolves.toBeUndefined();
    expect(await service.retry(job.id)).toMatchObject({ status: "queued" });
    await service.idle();
    expect(await service.get(job.id)).toMatchObject({ status: "done", skinId: "tide-salmon" });
    expect(calls).toBe(1);
    expect((await skins(contentRoot)).map(skin => skin.id)).toEqual(["tide-salmon"]);
    await expect(service.retry(job.id)).rejects.toThrow(/Only a failed job/);
  }, 60_000);

  it("marks jobs a previous process left running as interrupted", async () => {
    const { jobsRoot, options } = await fixture();
    await mkdir(path.join(jobsRoot, "old-job"), { recursive: true });
    await writeFile(path.join(jobsRoot, "old-job/job.json"), JSON.stringify({ id: "old-job", assetId: ASSET, name: "Old", prompt: "p",
      materials: [MATERIAL], status: "running", createdAt: "2026-09-26T00:00:00.000Z", startedAt: "2026-09-26T00:00:01.000Z", files: { [MATERIAL]: MATERIAL } }));
    // A job this process owns is still running in the queue a Vite config restart left behind.
    await mkdir(path.join(jobsRoot, "live-job"), { recursive: true });
    await writeFile(path.join(jobsRoot, "live-job/job.json"), JSON.stringify({ id: "live-job", assetId: ASSET, name: "Live", prompt: "p",
      materials: [MATERIAL], status: "running", createdAt: "2026-09-26T00:00:00.000Z", files: { [MATERIAL]: MATERIAL }, pid: process.pid }));
    const service = createImagegenService({ ...options, runner: { generator: "fake", run: async () => undefined } });
    expect(await service.get("old-job")).toMatchObject({ status: "failed", error: "interrupted" });
    expect(await service.get("live-job")).toMatchObject({ status: "running" });
    expect(await service.get("../old-job")).toBeUndefined();
  });
});
