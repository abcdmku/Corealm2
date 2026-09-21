import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { cp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CONTENT_COLLECTIONS } from "../game/src/content/compiler/collections.js";
import { collectionRevision } from "../game/src/content/compiler/revision.js";
import { formatContentJson } from "../game/src/content/compiler/canonical.js";
import { readContentSources } from "../tools/content/compile.js";
import { contentRoot } from "../tools/content/format.js";
import { exportFromServer } from "../tools/content/export-from-server.js";
import { publishToServer } from "../tools/content/publish-to-server.js";
import { normaliseServerUrl, parseServerSources } from "../tools/content/serverSync.js";

/**
 * The export tool writes files from a reply a remote host sent, so the host is treated as hostile.
 * Everything here runs against a fake server: what matters is that nothing lands on disk, not what a
 * real server would have said. `content-server-sync.test.ts` runs the same tools against a real one.
 */

const SECRET = "cat_deadbeefdeadbeefdeadbeefdeadbeef";
const REVISION = "a".repeat(64);
let root: string, repoSources: Map<string, unknown>;

/** Every file under the content root with its hash, so "wrote nothing" is provable. */
async function fingerprint(directory: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(directory, full).split(path.sep).join("/")] = createHash("sha256").update(await readFile(full)).digest("hex");
  }
  return out;
}

/** A server that answers the two GETs an export makes, with whatever `sources` the test wants. */
function fakeServer(sources: Record<string, unknown>, revisions?: Record<string, unknown>, revision = REVISION): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/admin/content/revision")) return Response.json({ revision, history: [] });
    if (url.includes("/admin/content/sources")) {
      return new Response(`{"revision":${JSON.stringify(revision)},"revisions":${JSON.stringify(revisions ?? Object.fromEntries(Object.keys(sources).map(name => [name, REVISION])))},"sources":${JSON.stringify(sources)}}`,
        { headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
}

const exportWith = (fetchImpl: typeof fetch, options: { dryRun?: boolean } = {}) =>
  exportFromServer({ serverUrl: "https://play.example.com/", token: SECRET, root, fetch: fetchImpl, ...options });

beforeAll(async () => {
  root = path.join(tmpdir(), `corealm-export-boundary-${randomUUID()}`);
  await cp(path.join(contentRoot, "data"), path.join(root, "data"), { recursive: true });
  repoSources = await readContentSources(root);
}, 120_000);
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("what a checkout will accept from a live server", () => {
  /** A whole valid reply built from this checkout's content, with one extra key. A computed key never
   * reaches the `__proto__` setter, so `"__proto__"` arrives as the own property JSON.parse makes. */
  const withKey = (name: string, value: unknown) => ({ ...Object.fromEntries(repoSources), [name]: value });

  it.each([
    ["an unknown collection", "nonsense", /unknown collection "nonsense"/],
    ["a parent-directory name", "../items", /looks like a path/],
    ["an absolute posix path", "/etc/passwd", /looks like a path/],
    ["a windows path", "C:\\corealm\\items", /looks like a path/],
    ["a backslash", "data\\items", /looks like a path/],
    ["an embedded NUL", "items\u0000.json", /looks like a path/],
    ["a prototype key", "__proto__", /unknown collection/],
  ])("refuses %s and writes nothing", async (_label, name, expected) => {
    const before = await fingerprint(root);
    await expect(exportWith(fakeServer(withKey(name, [])))).rejects.toThrow(expected);
    expect(await fingerprint(root)).toEqual(before);
    expect(Object.hasOwn(Object.prototype, "items")).toBe(false);
  }, 120_000);

  it("refuses a collection sent with the wrong shape, and an unusable revision", async () => {
    const before = await fingerprint(root);
    await expect(exportWith(fakeServer(withKey("items", { id: "worn_sword" })))).rejects.toThrow(/sent collection "items" as object, but it is an array/);
    await expect(exportWith(fakeServer(withKey("items", repoSources.get("items")), { items: "nope" }))).rejects.toThrow(/unusable revision for collection "items"/);
    await expect(exportWith(fakeServer({}, undefined, "not-a-revision"))).rejects.toThrow(/did not report a catalog revision/);
    expect(await fingerprint(root)).toEqual(before);
  }, 120_000);

  it("refuses sources that belong to a different revision than the one the server named", async () => {
    const drifting = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/admin/content/revision")) return Response.json({ revision: REVISION, history: [] });
      return Response.json({ revision: "b".repeat(64), revisions: {}, sources: {} });
    }) as typeof fetch;
    await expect(exportWith(drifting)).rejects.toThrow(/reported revision a{64} and then sent the sources of b{64}/);
  });

  it("refuses content that does not compile here, before it writes a byte", async () => {
    const before = await fingerprint(root);
    const broken = structuredClone(repoSources.get("lootTables")) as Record<string, any>[];
    broken.find(row => row.id === "shared_t0_frog")!.rolls[0].drops = [{ itemId: "no_such_item", quantity: [1, 1], chance: 1 }];
    await expect(exportWith(fakeServer(withKey("lootTables", broken)))).rejects.toThrow(/does not compile in this checkout, so nothing was written/);
    expect(await fingerprint(root)).toEqual(before);
  }, 120_000);

  it("reports a change without writing it under --dry-run", async () => {
    const before = await fingerprint(root);
    const edited = structuredClone(repoSources.get("lootTables")) as Record<string, any>[];
    edited.find(row => row.id === "shared_t0_frog")!.name = "Frog starter drops (dry run)";
    const result = await exportWith(fakeServer(withKey("lootTables", edited)), { dryRun: true });
    expect([result.dryRun, result.changedCollections, result.written]).toEqual([true, ["lootTables"], []]);
    expect(result.changed).toEqual([{ collection: "lootTables", ids: ["shared_t0_frog"] }]);
    expect(await fingerprint(root)).toEqual(before);
  }, 120_000);

  it("keeps a collection the server does not know, and says so", async () => {
    const { audio: _dropped, ...partial } = Object.fromEntries(repoSources);
    const result = await exportWith(fakeServer(partial), { dryRun: true });
    expect([result.changedCollections, result.missing]).toEqual([[], ["audio"]]);
    expect(result.summary).toContain("The server sent no value for `audio`");
  }, 120_000);

  it("never lets the token reach a message, a URL or a flag", async () => {
    const leaky = (async () => { throw new Error(`socket hang up while sending ${SECRET}`); }) as typeof fetch;
    await expect(exportWith(leaky)).rejects.toThrow(/socket hang up while sending \*\*\*/);
    await expect(exportWith(leaky)).rejects.not.toThrow(SECRET);
    expect(() => normaliseServerUrl(`https://user:${SECRET}@play.example.com/`)).toThrow(/carry no credentials/);
    expect(() => normaliseServerUrl(`https://play.example.com/?token=${SECRET}`)).toThrow(/no query or fragment/);
    expect(() => normaliseServerUrl("http://play.example.com/")).toThrow(/must be https/);
    expect(normaliseServerUrl("http://127.0.0.1:4320")).toBe("http://127.0.0.1:4320/");
    expect(normaliseServerUrl("https://play.example.com")).toBe("https://play.example.com/");
  });

  it("refuses to publish to a server whose name does not match --confirm, before reading anything", async () => {
    let asked = 0;
    const named = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      asked += 1;
      if (url.endsWith("/admin/info")) return Response.json({ name: "Raid Night", endpoint: "wss://play.example.com/", assetBaseUrl: null, catalogRevision: REVISION });
      throw new Error(`the publish read ${url} after the name did not match`);
    }) as typeof fetch;
    await expect(publishToServer({ serverUrl: "https://play.example.com/", token: SECRET, confirmName: "Test Server", root, fetch: named }))
      .rejects.toThrow(/calls itself "Raid Night", and --confirm said "Test Server". Nothing was sent./);
    expect(asked).toBe(1);
    await expect(publishToServer({ serverUrl: "https://play.example.com/", token: SECRET, confirmName: "", root, fetch: named }))
      .rejects.toThrow(/needs --confirm/);
  });

  it("parses a well-formed reply, and its canonical text is what the repository already holds", async () => {
    const sources = { items: repoSources.get("items"), audio: repoSources.get("audio") };
    const revisions = Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, collectionRevision(value)]));
    const parsed = parseServerSources({ revision: REVISION, revisions, sources });
    expect(Object.keys(parsed.sources).sort()).toEqual(["audio", "items"]);
    expect(parsed.revisions.items).toBe(collectionRevision(repoSources.get("items")));
    // This is why an export of unchanged content is a zero diff. The comparison normalises line
    // endings because `* text=auto` checks these files out as CRLF on Windows and stores them as LF,
    // which is what the canonical writer emits and what a Linux runner sees.
    expect(formatContentJson(parsed.sources.items)).toBe((await readFile(path.join(root, "data", "items.json"), "utf8")).replaceAll("\r\n", "\n"));
  });

  it("maps every collection to a file inside the content root", () => {
    for (const spec of CONTENT_COLLECTIONS) {
      expect(spec.file.startsWith("data/")).toBe(true);
      expect(spec.file).not.toContain("..");
    }
  });
});
