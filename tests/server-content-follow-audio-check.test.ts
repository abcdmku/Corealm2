import { describe, expect, it } from "vitest";
import { createAssetHost, missingAudioFiles } from "../game/src/multiplayer/assetManifest.js";

/** A publish refuses a sound whose file no client could load, and asks only about the files it adds. */
const running = { cues: { "ui.click": { variants: ["audio/sfx/click.ogg"] } }, loops: {} };
const candidate = { cues: { "ui.click": { variants: ["audio/sfx/click.ogg", "audio/sfx/stored.ogg", "audio/sfx/host.ogg", "audio/sfx/missing.ogg"] } }, loops: {} };
const store = { index: async () => ({ revision: "r1", files: { "audio/sfx/stored.ogg": { sha256: "a".repeat(64), bytes: 10, type: "audio/ogg", at: "2026-09-27T00:00:00.000Z" } } }) };

describe("the audio publish check", () => {
  it("names each added audio file that is neither in the server's store nor on the host tree", async () => {
    const asked: string[] = [];
    const host = createAssetHost({ bundledManifest: async () => ({ assets: [] }), contentAssets: store,
      bundledFile: async path => { asked.push(path); return path === "audio/sfx/host.ogg"; } });
    expect(await missingAudioFiles(host, { audio: candidate }, running)).toEqual([{ path: "audio.cues.ui.click.variants[3]", severity: "error",
      message: "The audio file audio/sfx/missing.ogg is neither in this server's files nor on its asset host. Upload it first, then publish the sound." }]);
    // The running catalog's file is not asked about again; the stored one is answered by the index.
    expect(asked).toEqual(["audio/sfx/host.ogg", "audio/sfx/missing.ogg"]);
  });

  it("asks a remote asset host with HEAD", async () => {
    const heads: string[] = [];
    const host = createAssetHost({ assetBaseUrl: "https://assets.example.com/corealm/", fetch: (async (url: string, init: RequestInit) => {
      heads.push(`${init.method} ${url}`);
      return new Response(null, { status: url.endsWith("host.ogg") ? 200 : 404 });
    }) as typeof fetch });
    const problems = await missingAudioFiles(host, { audio: candidate }, running);
    expect(problems.map(problem => problem.path)).toEqual(["audio.cues.ui.click.variants[1]", "audio.cues.ui.click.variants[3]"]);
    expect(heads).toEqual(["HEAD https://assets.example.com/corealm/audio/sfx/stored.ogg", "HEAD https://assets.example.com/corealm/audio/sfx/host.ogg", "HEAD https://assets.example.com/corealm/audio/sfx/missing.ogg"]);
  });
});
