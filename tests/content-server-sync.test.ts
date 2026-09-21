import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { cp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { formatContentJson } from "../game/src/content/compiler/canonical.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";
import { atomicReplaceFile } from "../tools/lib/atomic-replace-file.js";
import { formulaSourceRevision } from "../tools/content/compile.js";
import { contentRoot } from "../tools/content/format.js";
import { startLabServer, LAB_OWNER, LAB_TABLE, type LabServer, type Sources } from "../tools/content/labServer.js";
import { exportFromServer } from "../tools/content/export-from-server.js";
import { publishToServer, PublishRefused } from "../tools/content/publish-to-server.js";

/**
 * M8's proof, as far as a checkout can carry it: the export and publish tools against a real
 * `startReferenceServer`, with a real API token, over the same admin API devdocs uses. GitHub
 * Actions is the only part not exercised here, and `tools/content/selftest-server-sync.ts` runs the
 * same fixture through the tools' real CLI entry for the workflow that does.
 *
 * The checkout the tools write into is a temporary copy of `game/content/data`. This file must never
 * touch the real one.
 */

const TABLE = LAB_TABLE, PORT = 4321;

let root: string, serverUrl: string, serverName: string;
let readToken: string, publishToken: string;
let running: LabServer;

async function fingerprint(directory: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(directory, full).split(path.sep).join("/")] = createHash("sha256").update(await readFile(full)).digest("hex");
  }
  return out;
}
/** Names of files whose bytes moved between two fingerprints. */
const moved = (before: Record<string, string>, after: Record<string, string>) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name]).sort();

const serverSources = (): Promise<Sources> => running.sources();
const activeRevision = () => running.activeRevision();
/** Rewrite a collection in the temporary checkout the way `content:format` would. */
const editCheckout = async (collection: string, change: (draft: any) => void) => {
  const target = path.join(root, "data", `${collection}.json`);
  const value = JSON.parse(await readFile(target, "utf8"));
  change(value);
  await atomicReplaceFile(target, formatContentJson(value));
};

beforeAll(async () => {
  root = path.join(tmpdir(), `corealm-content-sync-${randomUUID()}`);
  await cp(path.join(contentRoot, "data"), path.join(root, "data"), { recursive: true });
  running = await startLabServer({ port: PORT });
  serverUrl = running.url;
  serverName = running.name;
  readToken = await running.mintToken("ci export", ["content:read"]);
  publishToken = await running.mintToken("ci publish", ["content:read", "content:publish"]);
  expect([readToken.startsWith("cat_"), publishToken.startsWith("cat_")]).toEqual([true, true]);
}, 120_000);

afterAll(async () => {
  await running?.close();
  await rm(root, { recursive: true, force: true });
});

describe("exporting a live server into a checkout", () => {
  it("is a zero diff when the server holds what the checkout holds", async () => {
    const before = await fingerprint(root);
    const result = await exportFromServer({ serverUrl, token: readToken, root });
    expect([result.changed, result.written, result.missing]).toEqual([[], [], []]);
    expect(result.serverRevision).toBe(RESOLVED_CATALOG.revision);
    // A checkout whose formulas are the server release's compiles the same sources to the same revision.
    expect(result.revisionMatches).toBe(RESOLVED_CATALOG.formulaRevision === formulaSourceRevision());
    if (result.revisionMatches) expect(result.compiledRevision).toBe(result.serverRevision);
    // Only the compiled catalog appeared; every authored file is byte for byte what it was.
    expect(moved(before, await fingerprint(root))).toEqual(["compiled/catalog.json"]);
    expect(result.summary).toContain("This checkout already holds that content. Nothing changed.");
  }, 120_000);

  it("brings back a loot edit made through the admin API as exactly that diff", async () => {
    const published = await running.publishAsDevdocs(draft => {
      const table = draft.lootTables.find((row: any) => row.id === TABLE);
      table.rolls[0].drops.find((drop: any) => drop.itemId === "pale_quartz").chance = 0.05;
    }, "frogs drop more quartz");
    expect(published.changedCollections).toEqual(["lootTables"]);

    const before = await fingerprint(root);
    const result = await exportFromServer({ serverUrl, token: readToken, root });
    expect(result.changed).toEqual([{ collection: "lootTables", ids: [TABLE] }]);
    expect(result.written).toEqual(["data/lootTables.json"]);
    expect(result.serverRevision).toBe(published.revision);
    expect(moved(before, await fingerprint(root))).toEqual(["compiled/catalog.json", "data/lootTables.json"]);

    // The file holds the server's value, written by the canonical writer, so the diff is the one record.
    const written = await readFile(path.join(root, "data", "lootTables.json"), "utf8");
    expect(written).toBe(formatContentJson((await serverSources()).lootTables));
    expect(JSON.parse(written).find((row: any) => row.id === TABLE).rolls[0].drops.find((drop: any) => drop.itemId === "pale_quartz").chance).toBe(0.05);

    expect(result.summary).toContain("| `lootTables` | `shared_t0_frog` |");
    expect(result.summary).toContain("published by `" + LAB_OWNER + "`");
    if (result.revisionMatches) expect(result.compiledRevision).toBe(published.revision);

    // Exporting again now changes nothing, which is what keeps the pull request branch quiet.
    const again = await exportFromServer({ serverUrl, token: readToken, root });
    expect([again.changed, again.written]).toEqual([[], []]);
  }, 120_000);

  it("refuses to read with no token and to write from a token that may not read", async () => {
    await expect(exportFromServer({ serverUrl, token: "cat_nope", root })).rejects.toThrow(/expired or was revoked/i);
    await expect(exportFromServer({ serverUrl, token: "", root })).rejects.toThrow(/COREALM_CONTENT_TOKEN/);
  }, 60_000);
});

describe("publishing a checkout to a named live server", () => {
  it("sends only the collections that differ, with the server's own revisions as the precondition", async () => {
    await editCheckout("items", (items: any[]) => { items.find(row => row.id === "worn_sword").description = "Published from a checkout."; });
    const before = await activeRevision();
    const result = await publishToServer({ serverUrl, token: publishToken, confirmName: serverName, root, note: "ci publish" });
    expect([result.mode, result.sent, result.base]).toEqual(["publish", ["items"], before]);
    expect([result.reply!.stored, result.reply!.changedCollections, result.reply!.affected.items]).toEqual([true, ["items"], ["worn_sword"]]);
    expect(await activeRevision()).toBe(result.reply!.revision);
    expect((await serverSources()).items.find((row: any) => row.id === "worn_sword").description).toBe("Published from a checkout.");
    expect(result.report).toContain("live now:");
  }, 120_000);

  it("says there is nothing to do when the two already agree", async () => {
    await exportFromServer({ serverUrl, token: readToken, root });
    const result = await publishToServer({ serverUrl, token: publishToken, confirmName: serverName, root });
    expect([result.sent, result.reply]).toEqual([[], null]);
    expect(result.report).toContain("already holds this branch's content");
  }, 120_000);

  it("refuses, and explains, when the live server changed since the checkout was exported", async () => {
    await editCheckout("items", (items: any[]) => { items.find(row => row.id === "worn_sword").description = "A second checkout edit."; });
    // Somebody saves in devdocs in the window between this tool's read and its write.
    let raced: string | null = null;
    const racing: typeof fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const response = await fetch(input as Parameters<typeof fetch>[0], init);
      if (url.includes("/admin/content/sources") && !raced) raced = (await running.publishAsDevdocs(draft => {
        draft.items.find((row: any) => row.id === "worn_sword").description = "Edited in devdocs meanwhile.";
      }, "live edit")).revision as string;
      return response;
    };
    const refused = await publishToServer({ serverUrl, token: publishToken, confirmName: serverName, root, fetch: racing }).catch(error => error as PublishRefused);
    expect(refused).toBeInstanceOf(PublishRefused);
    expect((refused as PublishRefused).code).toBe("stale_collections");
    expect((refused as PublishRefused).message).toContain("items changed on the server since this checkout last exported it");
    expect((refused as PublishRefused).message).toContain("Run the content export workflow, merge the pull request it opens, then publish again.");
    // Nothing was forced: the devdocs edit is still what the server is running.
    expect(await activeRevision()).toBe(raced);
    expect((await serverSources()).items.find((row: any) => row.id === "worn_sword").description).toBe("Edited in devdocs meanwhile.");
  }, 120_000);

  it("refuses a token that may read but not publish, and leaves the server where it was", async () => {
    const before = await activeRevision();
    const refused = await publishToServer({ serverUrl, token: readToken, confirmName: serverName, root }).catch(error => error as PublishRefused);
    expect(refused).toBeInstanceOf(PublishRefused);
    expect([(refused as PublishRefused).code, (refused as PublishRefused).status]).toEqual(["forbidden", 403]);
    expect((refused as PublishRefused).message).toContain("content:publish");
    expect(await activeRevision()).toBe(before);
  }, 120_000);

  it("refuses a server whose name is not the one confirmed, over the real /admin/info", async () => {
    const before = await activeRevision();
    const refused = await publishToServer({ serverUrl, token: publishToken, confirmName: "Some Other Server", root }).catch(error => error as PublishRefused);
    expect((refused as PublishRefused).code).toBe("wrong_server");
    expect((refused as PublishRefused).message).toContain(`calls itself "${serverName}"`);
    expect(await activeRevision()).toBe(before);
  }, 120_000);

  it("runs every check and stores nothing under --validate-only", async () => {
    const before = await activeRevision();
    const result = await publishToServer({ serverUrl, token: publishToken, confirmName: serverName, root, validateOnly: true });
    expect([result.mode, result.sent, result.reply!.stored]).toEqual(["validate", ["items"], false]);
    expect(result.reply!.changedCollections).toEqual(["items"]);
    expect(await activeRevision()).toBe(before);
  }, 120_000);
});
