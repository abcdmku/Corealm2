import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createThumbnailProvider } from "../devdocs/src/viewer/thumbnailRenderer.js";
import {
  createThumbnailsHandler,
  decodePngDataUrl,
  isThumbnailsPath,
  THUMBNAIL_MAX_REQUEST_BYTES,
  type ThumbnailsHandler,
  type ThumbnailsHandlerResponse,
  type ThumbnailWriteResponse,
} from "../devdocs/server/handlers/thumbnails.js";

vi.mock("../devdocs/src/viewer/registry.js", () => ({ viewerRegistry: async () => ({ entry: () => undefined }) }));
afterEach(() => vi.unstubAllGlobals());

/** Smallest valid PNG: 1x1 transparent pixel. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(): Promise<{ root: string; handler: ThumbnailsHandler }> {
  const parent = await mkdtemp(path.join(os.tmpdir(), "corealm-devdocs-thumbnails-"));
  roots.push(parent);
  // The thumbnail directory does not exist yet: the first PUT must create it.
  const root = path.join(parent, "thumbnails");
  return { root, handler: createThumbnailsHandler({ thumbnailRoot: root }) };
}
function body<T>(response: ThumbnailsHandlerResponse | undefined): T {
  if (!response || typeof response.body !== "string") throw new Error("Expected a JSON response");
  return JSON.parse(response.body) as T;
}
const url = "/__devdocs/thumbnails/goat.png";

describe("devdocs thumbnails handler", () => {
  it("keeps server-mode thumbnails off the repository cache endpoints", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    // An absent manifest entry falls back to a glyph, without probing a nonexistent cache API.
    expect(await createThumbnailProvider({ repoCache: false })("absent_asset")).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still uses an existing repository thumbnail before loading a model", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 200, headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await createThumbnailProvider({ repoCache: true })("goat")).toBe("/__devdocs/thumbnails/goat.png");
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/__devdocs/thumbnails/goat.png", { method: "HEAD", cache: "no-cache" });
  });
  it("returns 404 before a render is stored, then serves the PUT PNG bytes", async () => {
    const { root, handler } = await fixture();
    const missing = await handler({ method: "GET", url });
    expect(missing?.status).toBe(404);
    expect(body<{ assetId: string }>(missing).assetId).toBe("goat");

    const written = await handler({ method: "PUT", url, body: { dataUrl: PNG_DATA_URL } });
    expect(written?.status).toBe(200);
    expect(body<ThumbnailWriteResponse>(written)).toEqual({ ok: true, url });
    expect(await readdir(root)).toEqual(["goat.png"]);
    expect(Buffer.from(await readFile(path.join(root, "goat.png"))).equals(PNG_BYTES)).toBe(true);

    const served = await handler({ method: "GET", url: `${url}?v=123` });
    expect(served?.status).toBe(200);
    expect(served?.headers["Content-Type"]).toBe("image/png");
    expect(served?.headers["Content-Length"]).toBe(String(PNG_BYTES.length));
    expect(Buffer.from(served!.body as Uint8Array).equals(PNG_BYTES)).toBe(true);
    const head = await handler({ method: "HEAD", url });
    expect(head?.status).toBe(200);
    expect(head?.body).toBe("");
  });

  it("replaces an existing thumbnail atomically without leaving temporary files", async () => {
    const { root, handler } = await fixture();
    await handler({ method: "PUT", url, body: { dataUrl: PNG_DATA_URL } });
    await writeFile(path.join(root, "goat.png"), "stale");
    const written = await handler({ method: "PUT", url, body: { dataUrl: PNG_DATA_URL } });
    expect(written?.status).toBe(200);
    expect(await readdir(root)).toEqual(["goat.png"]);
    expect(Buffer.from(await readFile(path.join(root, "goat.png"))).equals(PNG_BYTES)).toBe(true);
  });

  it("rejects payloads that are not PNG data URLs and writes nothing", async () => {
    const { root, handler } = await fixture();
    const jpeg = `data:image/jpeg;base64,${PNG_BYTES.toString("base64")}`;
    const notPng = `data:image/png;base64,${Buffer.from("GIF89a not a png at all").toString("base64")}`;
    for (const payload of [undefined, "text", [], {}, { dataUrl: 12 }, { dataUrl: "" }, { dataUrl: jpeg }, { dataUrl: notPng }, { dataUrl: "data:image/png;base64,***" }, { dataUrl: "https://evil.example/x.png" }]) {
      const result = await handler({ method: "PUT", url, body: payload });
      expect(result?.status, JSON.stringify(payload)).toBe(400);
    }
    await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });
    expect(decodePngDataUrl(PNG_DATA_URL, THUMBNAIL_MAX_REQUEST_BYTES)?.equals(PNG_BYTES)).toBe(true);
    expect(decodePngDataUrl(PNG_DATA_URL, 8)).toBeUndefined();
    const tiny = createThumbnailsHandler({ thumbnailRoot: root, maxBytes: 16 });
    expect((await tiny({ method: "PUT", url, body: { dataUrl: PNG_DATA_URL } }))?.status).toBe(400);
  });

  it("only accepts safe asset ids under the thumbnails route", async () => {
    const { root, handler } = await fixture();
    for (const target of [
      "/__devdocs/thumbnails/goat",
      "/__devdocs/thumbnails/goat.jpg",
      "/__devdocs/thumbnails/.png",
      "/__devdocs/thumbnails/../goat.png",
      "/__devdocs/thumbnails/%2e%2e/goat.png",
      "/__devdocs/thumbnails/a/b.png",
      "/__devdocs/thumbnails/a%2fb.png",
      "/__devdocs/thumbnails/goat.png.png/x",
      "/__devdocs/thumbnails/goat png.png",
    ]) {
      expect((await handler({ method: "GET", url: target }))?.status, target).toBe(400);
      expect((await handler({ method: "PUT", url: target, body: { dataUrl: PNG_DATA_URL } }))?.status, target).toBe(400);
    }
    const ok = await handler({ method: "PUT", url: "/__devdocs/thumbnails/Rock_Medium-01_v2.png", body: { dataUrl: PNG_DATA_URL } });
    expect(ok?.status).toBe(200);
    expect(await readdir(root)).toEqual(["Rock_Medium-01_v2.png"]);
    expect(await handler({ method: "GET", url: "/__devdocs/thumbnailsx/goat.png" })).toBeUndefined();
    expect(await handler({ method: "GET", url: "/items/goat" })).toBeUndefined();
    expect(isThumbnailsPath("/__devdocs/thumbnails")).toBe(false);
    expect(isThumbnailsPath("/__devdocs/thumbnails/goat.png")).toBe(true);
  });

  it("refuses remote origins and unsupported methods", async () => {
    const { root, handler } = await fixture();
    expect((await handler({ method: "GET", url, socket: { remoteAddress: "192.0.2.10" } }))?.status).toBe(403);
    expect((await handler({ method: "PUT", url, headers: { host: "evil.example" }, body: { dataUrl: PNG_DATA_URL } }))?.status).toBe(403);
    expect((await handler({ method: "PUT", url, headers: { origin: "https://evil.example" }, body: { dataUrl: PNG_DATA_URL } }))?.status).toBe(403);
    expect((await handler({ method: "PUT", url, headers: { origin: "null" }, body: { dataUrl: PNG_DATA_URL } }))?.status).toBe(403);
    const post = await handler({ method: "POST", url, body: { dataUrl: PNG_DATA_URL } });
    expect(post?.status).toBe(405);
    expect(post?.headers.Allow).toBe("GET, HEAD, PUT");
    expect((await handler({ method: "DELETE", url }))?.status).toBe(405);
    await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
