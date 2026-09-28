import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { createFilesHandler } from "../devdocs/server/handlers/files.js";
import type { DevdocsJsonResponse } from "../devdocs/server/handlers/collections.js";

/* Repo mode's `putFiles`: `POST /__devdocs/files` writes into the checkout's `game/public`. */

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const publicRoot = await mkdtemp(path.join(os.tmpdir(), "corealm-devdocs-files-"));
  roots.push(publicRoot);
  return { publicRoot, handler: createFilesHandler({ publicRoot }) };
}
const png = (colour = { r: 200, g: 90, b: 40 }) => sharp({ create: { width: 64, height: 64, channels: 3, background: colour } }).png({ compressionLevel: 0 }).toBuffer();
const post = (payload: unknown, remoteAddress = "127.0.0.1") => ({ method: "POST", url: "/__devdocs/files", body: payload, socket: { remoteAddress } });
const body = <T>(response: DevdocsJsonResponse | undefined): T => JSON.parse(response!.body) as T;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("devdocs files handler", () => {
  it("writes each file under the public tree, recompressing PNGs, and reports the bytes written", async () => {
    const { publicRoot, handler } = await fixture();
    const map = await png(), audio = Buffer.from("OggS fake audio");
    const response = await handler(post({ files: { "assets/skins/animal_deer/frost/coat.png": map.toString("base64"), "audio/sfx/frost.ogg": audio.toString("base64") } }));
    expect(response?.status).toBe(200);
    const written = await readFile(path.join(publicRoot, "assets/skins/animal_deer/frost/coat.png"));
    expect(written.length).toBeLessThan(map.length);
    // Lossless: the same pixels.
    expect(await sharp(written).raw().toBuffer()).toEqual(await sharp(map).raw().toBuffer());
    expect(await readFile(path.join(publicRoot, "audio/sfx/frost.ogg"))).toEqual(audio);
    expect(body(response)).toEqual({ files: {
      "assets/skins/animal_deer/frost/coat.png": { sha256: sha(written), bytes: written.length },
      "audio/sfx/frost.ogg": { sha256: sha(audio), bytes: audio.length },
    } });
  });

  it("replaces a file in place", async () => {
    const { publicRoot, handler } = await fixture();
    const file = "assets/skins/animal_deer/frost/coat.png";
    await handler(post({ files: { [file]: (await png()).toString("base64") } }));
    const second = body<{ files: Record<string, { sha256: string }> }>(await handler(post({ files: { [file]: (await png({ r: 10, g: 20, b: 200 })).toString("base64") } })));
    expect(sha(await readFile(path.join(publicRoot, file)))).toBe(second.files[file]!.sha256);
  });

  it("writes nothing when any file in the request is refused", async () => {
    const { publicRoot, handler } = await fixture();
    const good = (await png()).toString("base64");
    const cases: [unknown, string][] = [
      [{ files: { "assets/skins/a/b/c.png": good, "../escape.png": good } }, "not a path a game file may live at"],
      [{ files: { "assets/skins/a/b/c.png": good, "assets/skins/a/b/../../x.png": good } }, "not a path"],
      [{ files: { "assets/skins/a/b/c.png": good, "src/main.ts.png": good } }, "not a path"],
      [{ files: { "assets/skins/a/b/c.png": good, "assets/skins/a/b/d.png": Buffer.from("not a png").toString("base64") } }, "not a PNG"],
      [{ files: { "assets/skins/a/b/c.png": good, "assets/skins/a/b/e.png": "***" } }, "expected base64"],
      [{ files: {} }, "at least one file"],
      [{ nope: true }, "at least one file"],
    ];
    for (const [payload, message] of cases) {
      const response = await handler(post(payload));
      expect(response?.status, message).toBe(400);
      expect(body<{ error: string }>(response).error).toContain(message);
    }
    await expect(stat(path.join(publicRoot, "assets"))).rejects.toThrow();
  });

  it("puts back what was there when a write fails part way", async () => {
    const { publicRoot, handler } = await fixture();
    const first = "assets/skins/a/b/c.png", original = await png();
    await handler(post({ files: { [first]: original.toString("base64") } }));
    const before = await readFile(path.join(publicRoot, first));
    // A directory where the second file should go makes its write fail after the first one landed.
    await mkdir(path.join(publicRoot, "assets/skins/a/b/blocked.png"), { recursive: true });
    await writeFile(path.join(publicRoot, "assets/skins/a/b/blocked.png/keep"), "x");
    await expect(handler(post({ files: { [first]: (await png({ r: 0, g: 0, b: 0 })).toString("base64"), "assets/skins/a/b/blocked.png": original.toString("base64") } }))).rejects.toThrow();
    expect(await readFile(path.join(publicRoot, first))).toEqual(before);
  });

  it("answers loopback POSTs only", async () => {
    const { handler } = await fixture();
    expect((await handler(post({ files: {} }, "192.0.2.1")))?.status).toBe(403);
    expect((await handler({ method: "GET", url: "/__devdocs/files", socket: { remoteAddress: "127.0.0.1" } }))?.status).toBe(405);
    expect(await handler({ method: "GET", url: "/__devdocs/skins", socket: { remoteAddress: "127.0.0.1" } })).toBeUndefined();
  });
});
