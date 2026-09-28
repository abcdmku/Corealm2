import { beforeEach, describe, expect, it } from "vitest";

import { setBackend, type DevdocsBackend, type DevdocsCapabilities } from "../devdocs/src/api/backend.js";
import type { ContentTransactionRequest } from "../devdocs/shared/contracts.js";
import type { CreatureSkin } from "../devdocs/shared/skinContracts.js";
import { SkinApiUnavailable, saveSkin, startImagegen } from "../devdocs/src/workspaces/art/creatures/skinApi.js";
import { filesBlock, imagegenBlock, metaBlock } from "../devdocs/src/workspaces/art/gates.js";

/*
  A skin save is backend-neutral: the maps go through `putFiles`, then the `creatureSkins` record is
  an ordinary content save. The same calls run in repo mode and on a live server.
*/

const EVERYTHING: DevdocsCapabilities = { write: true, meta: true, requests: true, git: true, bulk: true, assets: true, formulas: true, files: true, imagegen: true, publish: false };
const GENERATED: CreatureSkin = {
  id: "frost-stag", assetId: "animal_deer", name: "Frost stag", kind: "imagegen", prompt: "frost-rimed coat", generator: "gpt-image",
  maps: { Coat: "skins/animal_deer/frost-stag/Coat.png", Eye: "skins/animal_deer/frost-stag/Eye.png" },
  sha256: { Coat: "c".repeat(64), Eye: "e".repeat(64) }, createdAt: "2026-09-01T00:00:00.000Z",
};

function fakeBackend(capabilities: Partial<DevdocsCapabilities> = {}, rows: CreatureSkin[] = [GENERATED]) {
  const puts: Record<string, string>[] = [];
  const saves: ContentTransactionRequest[] = [];
  const backend = {
    kind: "server", label: "Test", assetBaseUrl: "", capabilities: { ...EVERYTHING, ...capabilities },
    collection: async () => ({ collection: { name: "creatureSkins", count: rows.length, editable: true, idKey: "id", shape: "array" }, revision: "skins-r1", data: rows }),
    putFiles: async (files: Record<string, string>) => {
      puts.push(files);
      return { files: Object.fromEntries(Object.keys(files).map(file => [file, { sha256: `${file.length}`.padStart(64, "0"), bytes: 1 }])) };
    },
    transact: async (request: ContentTransactionRequest) => {
      saves.push(request);
      return { ok: true, body: { revision: "cat", collections: [{ collection: { name: "creatureSkins", count: 0, editable: true, idKey: "id", shape: "array" }, revision: "skins-r2", data: [] }], affected: [], diagnostics: [], compiled: undefined } };
    },
    imagegen: { start: async () => { throw new Error("not reached"); }, list: async () => [], retry: async () => { throw new Error("not reached"); } },
  } as unknown as DevdocsBackend;
  return { backend, puts, saves };
}

let fake: ReturnType<typeof fakeBackend>;
beforeEach(() => { fake = fakeBackend(); setBackend(fake.backend); });

describe("saving a skin through the backend", () => {
  it("stores a new skin's maps under assets/skins, then saves its record with their hashes", async () => {
    const saved = await saveSkin({ assetId: "animal_deer", name: "Ash Stag!", kind: "recolor", maps: { "Wild horse · coat": "AAAA" }, recolor: { hue: 12, saturation: 1, value: 1 } });
    expect(fake.puts).toEqual([{ "assets/skins/animal_deer/ash-stag/Wild_horse_coat.png": "AAAA" }]);
    expect(saved.revision).toBe("skins-r2");
    expect(saved.skin).toMatchObject({ id: "ash-stag", assetId: "animal_deer", kind: "recolor", maps: { "Wild horse · coat": "skins/animal_deer/ash-stag/Wild_horse_coat.png" }, recolor: { hue: 12, saturation: 1, value: 1 } });
    expect(saved.skin.sha256).toEqual({ "Wild horse · coat": "53".padStart(64, "0") });
    expect(fake.saves).toEqual([{ operation: "save", revisions: { creatureSkins: "skins-r1" }, changes: [{ kind: "put", collection: "creatureSkins", id: "ash-stag", record: saved.skin, create: true }] }]);
  });

  it("picks a free id when the name's is taken", async () => {
    const saved = await saveSkin({ assetId: "animal_deer", name: "Frost stag", kind: "upload", maps: { Coat: "AAAA" } });
    expect(saved.skin.id).toBe("frost-stag-2");
  });

  it("merges a hand upload into a generated skin: other maps, kind, prompt and createdAt stay", async () => {
    const saved = await saveSkin({ assetId: "animal_deer", skinId: "frost-stag", name: "Frost stag", kind: "upload", merge: true, maps: { Coat: "BBBB" } });
    expect(fake.puts).toEqual([{ "assets/skins/animal_deer/frost-stag/Coat.png": "BBBB" }]);
    expect(saved.skin).toEqual({ ...GENERATED, sha256: { Coat: "44".padStart(64, "0"), Eye: "e".repeat(64) }, uploaded: ["Coat"] });
    expect(fake.saves[0]!.changes[0]).not.toHaveProperty("create");
  });

  it("refuses a merge into a skin that is missing or belongs to another model", async () => {
    await expect(saveSkin({ assetId: "animal_deer", skinId: "nope", name: "x", kind: "upload", merge: true, maps: { Coat: "AA" } })).rejects.toThrow("No skin nope");
    await expect(saveSkin({ assetId: "animal_wolf", skinId: "frost-stag", name: "x", kind: "upload", merge: true, maps: { Coat: "AA" } })).rejects.toThrow("belongs to animal_deer");
    expect(fake.puts).toEqual([]);
  });
});

describe("gates", () => {
  it("says why a save, a job or a verdict cannot run, and never calls the backend", async () => {
    fake = fakeBackend({ files: false, imagegen: false, meta: false });
    setBackend(fake.backend);
    expect(filesBlock()).toContain("no file store");
    expect(imagegenBlock()).toContain("does not run on this server");
    expect(metaBlock()).toContain("metadata store");
    await expect(saveSkin({ assetId: "animal_deer", name: "x", kind: "upload", maps: { Coat: "AA" } })).rejects.toBeInstanceOf(SkinApiUnavailable);
    await expect(startImagegen({ assetId: "animal_deer", name: "x", prompt: "y", references: {} })).rejects.toBeInstanceOf(SkinApiUnavailable);
    expect(fake.puts).toEqual([]);

    setBackend(fakeBackend({ write: false }).backend);
    expect(filesBlock()).toBe("This editor is read only.");
    setBackend(fakeBackend().backend);
    expect([filesBlock(), imagegenBlock(), metaBlock()]).toEqual([undefined, undefined, undefined]);
  });
});
