import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { WebSocket } from "ws";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey } from "../identity/src/joinToken.js";
import { compileCatalog } from "../game/src/content/compiler/catalog.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";
import { seedCatalog, type BaseCatalog } from "../game/src/multiplayer/catalogHost.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import { MemoryWorldStorage } from "../game/src/multiplayer/memoryStorage.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { readContentSources } from "../tools/content/compile.js";
import placementWorld from "./fixtures/placementWorld.js";

/**
 * A server with edits of its own takes a newer base: edits to other records survive, a record both
 * sides changed waits for a decision, and a base that deletes something a player holds is refused.
 * Memory storage; the temp-file SQLite path is `multiplayer-base-update.test.ts`.
 */
const OWNER = "acc_OOOOOOOOOOOOOOOOOOOOOO", ALICE = "acc_AAAAAAAAAAAAAAAAAAAAAA";
const FROGS = "shared_t0_frog";
const world: WorldDescriptor = { providerId: "reference", worldId: "north", name: "north", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 4, availability: "available" };
type Sources = Record<string, any>;
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const shipped = async (): Promise<Sources> => Object.fromEntries(await readContentSources());
function base(version: string, sources: Sources): BaseCatalog {
  const compiled = compileCatalog(sources, { formulaRevision: RESOLVED_CATALOG.formulaRevision });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems.slice(0, 3)));
  return { version, catalog: compiled.catalog, sources };
}
const table = (sources: Sources, id: string) => sources.lootTables.find((row: any) => row.id === id);

async function serve(seedVersion: string, bundledBase: BaseCatalog) {
  const created = createSigningKey();
  const keys: IdentityKey[] = [{ kid: created.signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" }];
  const storage = new MemoryWorldStorage();
  await seedCatalog(storage.catalog, { version: seedVersion, catalog: RESOLVED_CATALOG, sources: await shipped() }, () => {});
  const server = await startReferenceServer({ worlds: [world], storage, admin: storage.admin, catalog: storage.catalog, build: placementWorld, bundledBase, ownerAccount: OWNER, log: () => {},
    assets: { bundledManifest: async () => JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")) },
    authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: (async () => new Response(JSON.stringify({ keys }))) as typeof fetch }) });
  cleanups.push(() => server.close());
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { ...(session ? { Authorization: `Bearer ${session}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, bytes: text.length, body: text ? JSON.parse(text) as any : null };
  };
  const token = (accountId: string, name: string) => signJoinToken(created.signing, joinTokenClaims({ accountId, name, endpoint: `ws://127.0.0.1:${server.port}/`, issuedAt: Date.now() / 1000 }));
  let session = "";
  session = (await call("/admin/session", { token: token(OWNER, "Owner") })).body.session;
  async function publish(change: (draft: Sources) => void) {
    const active = (await call("/admin/content/sources")).body, draft = structuredClone(active.sources);
    change(draft);
    const collections = Object.fromEntries(Object.keys(draft).filter(name => JSON.stringify(draft[name]) !== JSON.stringify(active.sources[name])).map(name => [name, { revision: active.revisions[name], value: draft[name] }]));
    const answer = await call("/admin/content/publish", { base: active.revision, collections });
    expect([answer.status, answer.body.error]).toEqual([200, undefined]);
    return answer.body.revision as string;
  }
  const sources = async (): Promise<Sources> => (await call("/admin/content/sources")).body.sources;
  const preview = (body: unknown = {}) => call("/admin/content/base/preview", body);
  const apply = async (decisions: unknown[]) => { const expected = (await preview({ decisions })).body.expect ?? (await call("/admin/content/base")).body; return call("/admin/content/base/apply", { expect: expected, decisions }); };
  return { server, call, token, publish, sources, preview, apply };
}

describe("a server with its own edits takes a newer base", () => {
  it("keeps its own edit to one loot table while taking the base's edit to another", async () => {
    const seed = await shipped(), next = structuredClone(seed), seeded = RESOLVED_CATALOG.revision;
    table(next, FROGS).rolls[0].drops[0].chance = 0.25;
    const served = await serve("0.1.0", base("0.2.0", next));
    const other = (await shipped()).lootTables.find((row: any) => row.id !== FROGS && row.rolls[0]?.drops?.length).id as string;
    await served.publish(draft => { table(draft, other).rolls[0].drops[0].chance = 0.01; });
    expect((await served.call("/admin/content/base")).body.serverModified).toBe(true);

    const preview = await served.preview();
    expect([preview.status, preview.body.conflicts, preview.body.summary.lootTables.takenFromBase, preview.body.summary.lootTables.keptMine, preview.body.validation.ok])
      .toEqual([200, [], 1, 1, true]);
    const applied = await served.apply([]);
    expect([applied.status, applied.body.base.version]).toEqual([200, "0.2.0"]);
    const now = await served.sources();
    expect([table(now, FROGS).rolls[0].drops[0].chance, table(now, other).rolls[0].drops[0].chance]).toEqual([0.25, 0.01]);
    // Leave the process on the catalog it started with.
    expect((await served.call("/admin/content/rollback", { revision: seeded })).status).toBe(200);
  }, 60_000);

  it("asks about a record both sides changed, refuses to guess, and applies either answer", async () => {
    const seed = await shipped(), next = structuredClone(seed), seeded = RESOLVED_CATALOG.revision;
    table(next, FROGS).rolls[0].drops[0].chance = 0.25;
    const bundled = base("0.2.0", next);
    const served = await serve("0.1.0", bundled);
    const own = await served.publish(draft => { table(draft, FROGS).rolls[0].drops[0].chance = 0.35; });

    const preview = await served.preview();
    expect(preview.status).toBe(200);
    expect(preview.body.conflicts.map(({ collection, id, kind, mineFields, theirsFields, decision }: any) => ({ collection, id, kind, mineFields, theirsFields, decision })))
      .toEqual([{ collection: "lootTables", id: FROGS, kind: "both-changed", mineFields: ["rolls"], theirsFields: ["rolls"], decision: null }]);
    expect([preview.body.conflicts[0].mine.rolls[0].drops[0].chance, preview.body.conflicts[0].theirs.rolls[0].drops[0].chance, preview.body.decisionsNeeded, preview.body.validation]).toEqual([0.35, 0.25, 1, null]);
    console.log(`[base-update sizes] one both-changed loot table conflict: preview reply ${preview.bytes} bytes`);

    const undecided = await served.call("/admin/content/base/apply", { expect: preview.body.expect, decisions: [] });
    expect([undecided.status, undecided.body.error]).toEqual([409, { code: "decisions_needed", message: "1 conflict needs a decision before this update can be applied.",
      missing: [{ collection: "lootTables", id: FROGS }], missingTotal: 1 }]);

    const decided = await served.preview({ decisions: [{ collection: "lootTables", id: FROGS, take: "theirs" }] });
    expect([decided.body.decisionsNeeded, decided.body.conflicts[0].decision, decided.body.validation.ok]).toEqual([0, "theirs", true]);

    const mine = await served.apply([{ collection: "lootTables", id: FROGS, take: "mine" }]);
    expect([mine.status, mine.body.baseUpdate.decisions, mine.body.base.version]).toEqual([200, { mine: 1, theirs: 0 }, "0.2.0"]);
    expect(table(await served.sources(), FROGS).rolls[0].drops[0].chance).toBe(0.35);
    // The base moved though the content kept the server's answer: nothing more to take.
    // The server's answer was its own content, so the revision stays and only its base moved, as a move of its own in the history and the audit log.
    expect([mine.body.revision, mine.body.unchanged, mine.body.notified]).toEqual([own, true, 0]);
    expect((await served.call("/admin/content/base")).body.direction).toBe("same");
    expect((await served.call("/admin/content/revision")).body.history.slice(0, 2).map((move: any) => [move.revision, move.previous, move.base.version]))
      .toEqual([[own, own, "0.2.0"], [own, seeded, "0.1.0"]]);
    expect((await served.call("/admin/audit?action=content.base-update")).body.entries.length).toBe(1);

    // Back to the seed, and the same edit again: a publish records the base of the revision it was made from.
    expect((await served.call("/admin/content/rollback", { revision: seeded })).status).toBe(200);
    expect(await served.publish(draft => { table(draft, FROGS).rolls[0].drops[0].chance = 0.35; })).toBe(own);
    expect((await served.call("/admin/content/base")).body.current.version).toBe("0.1.0");
    const theirs = await served.apply([{ collection: "lootTables", id: FROGS, take: "theirs" }]);
    expect([theirs.status, theirs.body.baseUpdate.decisions]).toEqual([200, { mine: 0, theirs: 1 }]);
    expect(table(await served.sources(), FROGS).rolls[0].drops[0].chance).toBe(0.25);
    // Taking the base's side of the only difference lands on the base exactly.
    expect(theirs.body.revision).toBe(bundled.catalog.revision);
    expect((await served.call("/admin/content/rollback", { revision: seeded })).status).toBe(200);
  }, 60_000);

  it("refuses a base that deletes an item a player holds, and reports a downgrade without offering it", async () => {
    const seed = await shipped(), next = structuredClone(seed), seeded = RESOLVED_CATALOG.revision;
    // The starter kit's rod is in no loot table, shop or recipe, so the base can drop it and still compile.
    next.items = next.items.filter((item: any) => item.id !== "worn_rod");
    // Every other item renamed in the base and repriced on the server: a conflict per item, to size the reply.
    for (const item of next.items) item.name = `${item.name} II`;
    const served = await serve("0.1.0", base("0.2.0", next));
    const ws = new WebSocket(`ws://127.0.0.1:${served.server.port}/`); cleanups.push(() => ws.terminate());
    const messages: any[] = []; ws.on("message", data => messages.push(JSON.parse(data.toString())));
    await new Promise<void>(resolve => ws.once("open", resolve));
    ws.send(JSON.stringify({ type: "join", providerId: "reference", worldId: "north", token: served.token(ALICE, "Alice"), protocolVersion: WORLD_PROTOCOL_VERSION }));
    await expect.poll(() => messages.some(message => message.type === "joined"), { timeout: 5000, interval: 10 }).toBe(true);
    await served.publish(draft => { for (const item of draft.items) item.value = (item.value ?? 0) + 1; });

    const preview = await served.preview();
    const conflicts = preview.body.conflicts as any[];
    expect([conflicts.length, preview.body.conflictsTotal, conflicts.filter(conflict => conflict.kind === "deleted-in-base").map(conflict => conflict.id)])
      .toEqual([seed.items.length, seed.items.length, ["worn_rod"]]);
    console.log(`[base-update sizes] ${conflicts.length} item conflicts: preview reply ${preview.bytes} bytes, bodies truncated: ${preview.body.bodiesTruncated}`);
    const everyTheirs = conflicts.map(conflict => ({ collection: conflict.collection, id: conflict.id, take: "theirs" }));
    const decided = await served.preview({ decisions: everyTheirs });
    expect([decided.body.validation.ok, decided.body.validation.status, decided.body.validation.error.code]).toEqual([false, 409, "definition_in_use"]);
    expect(decided.body.validation.error.blockers).toContainEqual(expect.objectContaining({ kind: "item", id: "worn_rod", accountId: ALICE }));
    const refused = await served.call("/admin/content/base/apply", { expect: decided.body.expect, decisions: everyTheirs });
    expect([refused.status, refused.body.error.code]).toEqual([409, "definition_in_use"]);
    expect((await served.call("/admin/content/base")).body.current.version).toBe("0.1.0");
    expect((await served.call("/admin/content/rollback", { revision: seeded })).status).toBe(200);
  }, 60_000);

  it("reports an older bundled base and previews it only when asked for a downgrade", async () => {
    const served = await serve("0.3.0", base("0.2.0", await shipped()));
    const status = (await served.call("/admin/content/base")).body;
    expect([status.direction, status.updateAvailable]).toEqual(["older", false]);
    const refused = await served.preview();
    expect([refused.status, refused.body.error.code]).toEqual([409, "downgrade_refused"]);
    const allowed = await served.preview({ allowDowngrade: true });
    expect([allowed.status, allowed.body.direction, allowed.body.conflicts]).toEqual([200, "older", []]);
  }, 60_000);
});
