import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { collectionRevision } from "../game/src/content/compiler/revision.js";
import { mergeBase, type BaseDecision } from "../game/src/content/compiler/baseMerge.js";
import { ADMIN_API_SEGMENTS, contentType } from "../game/src/multiplayer/adminUi.js";
import { readContentSources } from "./content/compile.js";
import { gameRoot, repoRoot } from "./lib/paths.js";

/**
 * A game server's admin API, faked, for looking at the server-mode editor without running a server.
 *
 * The `players` and `server` workspaces only exist against a live server, so a screenshot pass or a
 * layout audit of them needs something to answer `/admin/*`. This is that something: the repo's own
 * content for the collections, and a deliberately awkward cast for everything else — a player with
 * a full inventory and a four-hundred-kind bank, a name long enough to test a truncation, an
 * expired token, a ban with no expiry. It writes nothing and is never part of a build.
 *
 * `tools/devdocs-surface-audit.ts --server` is its caller. It serves the built editor at `/admin/`
 * and `game/public` at the root, so item icons resolve exactly as they do behind a real server.
 */

const REVISION = "5e".repeat(32);
const PREVIOUS = "a4".repeat(32);
const NOW = Date.UTC(2026, 8, 20, 14, 30);
const OWNER = "acc_ownerR00kFallowmarch1234";
const ADMIN = "acc_adminWrenKarrowmoor5678";

const json = (response: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(payload) });
  response.end(payload);
};

interface FixturePlayer {
  accountId: string; name: string; firstSeen: number; lastSeen: number; playtimeSeconds: number;
  lastWorld: { providerId: string; worldId: string } | null;
  position: [number, number, number] | null; regionId: string | null;
  online: { providerId: string; worldId: string } | null;
  ban: { accountId: string; name: string | null; reason: string; expiresAt: number | null; bannedBy: string; bannedAt: number } | null;
}

const world = (worldId: string) => ({ providerId: "reference", worldId });

function players(): FixturePlayer[] {
  return [
    { accountId: OWNER, name: "Rook", firstSeen: NOW - 86_400_000 * 40, lastSeen: NOW, playtimeSeconds: 154_800, lastWorld: world("corealm"), position: [-48.25, 0.5, -37.5], regionId: "fallowmarch", online: world("corealm"), ban: null },
    { accountId: ADMIN, name: "Wren Ashenford-Blackbriar", firstSeen: NOW - 86_400_000 * 12, lastSeen: NOW - 90_000, playtimeSeconds: 41_200, lastWorld: world("second-corealm"), position: [112.5, 1.25, 64], regionId: "vellenwood", online: null, ban: null },
    { accountId: "acc_playerThistleGravelmaw90", name: "Thistle", firstSeen: NOW - 86_400_000 * 3, lastSeen: NOW - 3_600_000, playtimeSeconds: 6_240, lastWorld: world("corealm"), position: [0, 0, 0], regionId: "gravelmaw", online: null,
      ban: { accountId: "acc_playerThistleGravelmaw90", name: "Thistle", reason: "Repeated harassment in proximity chat after two warnings", expiresAt: null, bannedBy: OWNER, bannedAt: NOW - 7_200_000 } },
    { accountId: "acc_playerMossbackKilnhalt111", name: "Mossback", firstSeen: NOW - 86_400_000 * 90, lastSeen: NOW - 86_400_000 * 30, playtimeSeconds: 412_900, lastWorld: world("corealm"), position: [-220.5, 8, 310.75], regionId: "kilnhalt", online: null, ban: null },
    { accountId: "acc_playerQuillCrownward22222", name: "Quill", firstSeen: NOW - 86_400_000, lastSeen: NOW - 120_000, playtimeSeconds: 900, lastWorld: null, position: null, regionId: null, online: null, ban: null },
  ];
}

/** A character worth laying out: every slot used, every skill moved, a bank with plenty in it. */
function character(items: { id: string; stackable?: boolean; equip?: { slot?: string } }[], accountId: string): Record<string, unknown> {
  const stackable = items.filter(item => item.stackable);
  const single = items.filter(item => !item.stackable && item.equip);
  const inventory = Array.from({ length: 28 }, (_, index) => {
    if (index >= 26) return null;
    const stack = index % 3 === 0 ? stackable[index % Math.max(1, stackable.length)] : single[index % Math.max(1, single.length)];
    if (!stack) return null;
    return { slotIndex: index, itemId: stack.id, quantity: stack.stackable ? (index + 1) * 137 : 1 };
  });
  const bySlot = (slot: string) => items.find(item => item.equip?.slot === slot)?.id;
  const equipment: Record<string, { itemId: string; quantity: number } | null> = {};
  for (const [key, slot] of [["head", "head"], ["body", "body"], ["legs", "legs"], ["feet", "feet"], ["hands", "hands"], ["mainHand", "mainHand"], ["offHand", "offHand"], ["accessory1", "accessory1"], ["accessory2", "accessory2"], ["ring2", "accessory2"], ["earring2", "accessory1"]]) {
    const found = bySlot(slot!);
    equipment[key!] = found ? { itemId: found, quantity: 1 } : null;
  }
  const skills = Object.fromEntries(["melee", "magic", "mining", "woodcutting", "fishing", "smithing", "crafting", "cooking", "fletching", "agility"]
    .map((skill, index) => [skill, { xp: 1_200 * (index + 1) * (index + 3), level: 8 + index * 4 }]));
  return {
    currency: 1_284_905,
    skills,
    inventory,
    bank: stackable.slice(0, 40).map((item, index) => ({ itemId: item.id, quantity: (index + 1) * 512 })),
    equipment,
    revision: accountId.slice(-16).padEnd(16, "0").replace(/[^0-9a-f]/g, "a"),
  };
}

function stats(): Record<string, unknown> {
  return {
    startedAt: NOW - 903_400, uptimeSeconds: 903.4,
    worlds: [
      { providerId: "reference", worldId: "corealm", name: "Corealm", playersOnline: 12, capacity: 200, tick: 9031 },
      { providerId: "reference", worldId: "second-corealm", name: "Corealm II — Fridays only", playersOnline: 47, capacity: 50, tick: 9029 },
    ],
    tick: { samples: 9031, lastMs: 21.4, meanMs: 23.9123456, p95Ms: 129.5, maxMs: 134.2 },
    stages: { samples: 9031, simulationMs: 18.1, snapshotMs: 3.4, commitMs: 0.9, replicationMs: 1.5 },
    commands: 4821, rejected: 3, errors: 0, backlogDisconnects: 1,
    bytesOut: 91_263_344, bytesOutPerSecond: 101_021.2,
    memory: { rssBytes: 1_231_847_424, heapUsedBytes: 412_398_080 },
    events: [
      { at: NOW - 600_000, kind: "join", accountId: OWNER, detail: "corealm" },
      { at: NOW - 540_000, kind: "admin-session", accountId: OWNER, detail: "owner" },
      { at: NOW - 300_000, kind: "rejected", accountId: "acc_playerThistleGravelmaw90", detail: "BANNED" },
      { at: NOW - 120_000, kind: "kick", accountId: ADMIN, detail: "Taking the world down for a publish" },
      { at: NOW - 60_000, kind: "join", accountId: ADMIN, detail: "second-corealm" },
    ],
    // Two worlds, so this server runs a thread each: one healthy, one that crashed twice and came back.
    threads: {
      mode: "auto",
      worlds: [
        { worldId: "corealm", available: true, restarts: 0, failures: 0, abandoned: false, bootMs: 3_812, buildMs: 2_904, heapUsedBytes: 702_021_632, utilization: 0.41, cpuMs: 620_410 },
        { worldId: "second-corealm", available: true, restarts: 2, failures: 2, abandoned: false, bootMs: 4_118, buildMs: 3_002, heapUsedBytes: 668_991_488, utilization: 0.37, cpuMs: 588_120 },
      ],
      database: { calls: 184_221, commits: 9_030, commitMs: [0.7, 1.1, 0.9, 2.4], commitWaitMs: [0.2, 0.4, 1.9, 0.3], busyMs: 18_204, utilization: 0.12 },
    },
    catalogRevision: REVISION,
    server: {
      name: "Raid Night", description: "Fridays, 8pm, bring your own arrows.", endpoint: "wss://play.example.com/",
      assetBaseUrl: "https://cdn.example.com/corealm/", identityUrl: "https://identity.example.com/", authentication: "account",
      catalogRevision: REVISION, host: "0.0.0.0", registerWithDirectory: true,
      worlds: [{ providerId: "reference", worldId: "corealm", name: "Corealm", seed: 1337, capacity: 200 },
        { providerId: "reference", worldId: "second-corealm", name: "Corealm II — Fridays only", seed: 4242, capacity: 50 }],
    },
  };
}

function audit(): Record<string, unknown>[] {
  const base = { credential: "session" as const };
  return [
    { id: 40, at: NOW - 60_000, accountId: OWNER, ...base, action: "player.edit", target: ADMIN,
      before: { inventory: { 3: null }, currency: 1_000 }, after: { inventory: { 3: { itemId: "fire_opal", quantity: 4 } }, currency: 1_284_905, applied: "live", world: { providerId: "reference", worldId: "corealm" } } },
    { id: 39, at: NOW - 180_000, accountId: OWNER, ...base, action: "content.publish", target: REVISION,
      before: { revision: PREVIOUS }, after: { revision: REVISION, base: PREVIOUS, note: "frogs drop the marker", changedCollections: ["lootTables"], changedTables: ["lootTables", "enemies"] } },
    { id: 38, at: NOW - 7_200_000, accountId: OWNER, ...base, action: "ban.set", target: "acc_playerThistleGravelmaw90",
      before: null, after: { reason: "Repeated harassment in proximity chat after two warnings", expiresAt: null } },
    { id: 37, at: NOW - 7_300_000, accountId: OWNER, ...base, action: "player.kick", target: "acc_playerThistleGravelmaw90", before: null, after: { reason: "Last warning" } },
    { id: 36, at: NOW - 86_400_000, accountId: OWNER, ...base, action: "role.set", target: ADMIN, before: null, after: { role: "admin" } },
    { id: 35, at: NOW - 86_400_000 * 2, accountId: OWNER, ...base, action: "token.create", target: "tok_2b8f1c0d9e4a5678", before: null, after: { label: "Content export workflow", scopes: ["content:read"] } },
    { id: 34, at: NOW - 86_400_000 * 3, accountId: OWNER, ...base, action: "settings.set", target: null, before: { name: "Corealm server", "capacity.corealm": null }, after: { name: "Raid Night", "capacity.corealm": 200 } },
    { id: 33, at: NOW - 86_400_000 * 4, accountId: OWNER, credential: "setup", action: "owner.setup", target: OWNER, before: null, after: { role: "owner" } },
  ];
}

export interface AdminFixture { url: string; origin: string; close(): Promise<void> }

export async function startAdminFixture(port: number): Promise<AdminFixture> {
  const sources = Object.fromEntries(await readContentSources()) as Record<string, unknown>;
  const revisions = Object.fromEntries(Object.keys(sources).map(name => [name, collectionRevision(sources[name])]));
  const catalog = JSON.parse(await readFile(path.join(repoRoot, "game/content/compiled/catalog.json"), "utf8")) as Record<string, unknown>;
  const itemRows = ((catalog.tables as Record<string, unknown>).items ?? []) as { id: string; stackable?: boolean; equip?: { slot?: string } }[];
  const cast = players();
  const publicRoot = path.join(gameRoot, "public");
  const buildRoot = path.resolve("dist/devdocs-server");
  const baseFrom = { version: "0.1.0", revision: "b1".repeat(32) };
  const baseTo = { version: "0.2.0", revision: "b2".repeat(32) };
  let baseApplied = false;
  const ancestor = { items: [{ id: "worn_sword", name: "Worn sword", value: 4 }, { id: "old_marker", name: "Old marker", value: 1 }], lootTables: [{ id: "redsill", rolls: [{ itemId: "marsh_gland", quantity: 1 }] }] };
  const mine = { items: [{ id: "worn_sword", name: "Rook's worn sword", value: 9 }, { id: "old_marker", name: "Server keepsake", value: 1 }], lootTables: [{ id: "redsill", rolls: [{ itemId: "marsh_gland", quantity: 3 }] }] };
  const theirs = { items: [{ id: "worn_sword", name: "Worn sword", value: 6 }], lootTables: [{ id: "redsill", rolls: [{ itemId: "marsh_gland", quantity: 2 }] }] };
  const baseExpect = { activeRevision: REVISION, bundledRevision: baseTo.revision };

  const api = async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    const rest = parts.slice(1);
    const at = rest[0];
    // The same split the real server makes: the API owns its first segments, the rest is the build.
    if (parts[0] !== "admin" || at === undefined || !ADMIN_API_SEGMENTS.includes(at)) return false;
    if (at === "content" && rest[1] === "base") {
      if (request.method === "GET" && rest.length === 2) return json(response, 200, { current: baseApplied ? baseTo : baseFrom, bundled: baseTo, updateAvailable: !baseApplied, direction: baseApplied ? "same" : "newer", serverModified: true }), true;
      if (request.method === "GET" && rest[2] === "sources") {
        const bundled = url.searchParams.get("side") === "bundled";
        return json(response, 200, { ...(bundled ? baseTo : baseFrom), sources: bundled ? theirs : ancestor }), true;
      }
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      const input = JSON.parse(raw || "{}") as { decisions?: BaseDecision[]; expect?: typeof baseExpect };
      if (baseApplied) return json(response, 409, { error: { code: "no_update", message: "Already on the bundled base." } }), true;
      const merge = mergeBase({ ancestor, mine, theirs }, input.decisions ?? []);
      const validation = { revision: "d3".repeat(32), previous: REVISION, unchanged: false, stored: false, live: ["items", "lootTables"], onRestart: ["worldRegions"], affected: { items: ["worn_sword"] }, changedCollections: ["items", "lootTables"], changedTables: ["items", "lootTables"], spawns: [], notified: 12 };
      if (rest[2] === "preview") return json(response, 200, {
        base: { from: baseFrom, to: baseTo }, direction: "newer", expect: baseExpect,
        summary: merge.summary, conflicts: merge.conflicts, conflictsTotal: merge.conflicts.length, bodiesTruncated: false, decisionsNeeded: merge.decisionsNeeded,
        validation: merge.decisionsNeeded ? null : { ok: true, result: validation },
        changedCollections: validation.changedCollections, affected: validation.affected,
        live: merge.decisionsNeeded ? null : validation.live, onRestart: merge.decisionsNeeded ? null : validation.onRestart,
      }), true;
      if (rest[2] === "apply") {
        if (input.expect?.activeRevision !== baseExpect.activeRevision || input.expect?.bundledRevision !== baseExpect.bundledRevision) return json(response, 409, { error: { code: "stale_base", message: "Preview is stale." } }), true;
        if (merge.decisionsNeeded) return json(response, 409, { error: { code: "decisions_needed", message: "Choose every conflict.", missingTotal: merge.decisionsNeeded } }), true;
        baseApplied = true;
        return json(response, 200, { ...validation, stored: true, baseUpdate: { from: baseFrom, to: baseTo, direction: "newer", summary: merge.summary, decisions: { mine: (input.decisions ?? []).filter(row => row.take === "mine").length, theirs: (input.decisions ?? []).filter(row => row.take === "theirs").length } } }), true;
      }
    }
    // The asset host this fixture points the editor at is itself: it serves `game/public` at the root,
    // so every item icon resolves exactly as it does behind a real server with an asset host.
    if (at === "info") return json(response, 200, { ...(stats().server as Record<string, unknown>), assetBaseUrl: `http://127.0.0.1:${port}/` }), true;
    if (at === "me") return json(response, 200, { credential: "session", accountId: OWNER, tokenId: null, role: "owner", scopes: ["content:read", "content:publish", "players:read", "players:write", "stats:read"], server: stats().server }), true;
    if (at === "stats") return json(response, 200, stats()), true;
    if (at === "roles") return json(response, 200, { roles: [
      { accountId: OWNER, name: "Rook", role: "owner", grantedBy: null, grantedAt: NOW - 86_400_000 * 4 },
      { accountId: ADMIN, name: "Wren Ashenford-Blackbriar", role: "admin", grantedBy: OWNER, grantedAt: NOW - 86_400_000 },
    ] }), true;
    if (at === "tokens") return json(response, 200, { tokens: [
      { id: "tok_2b8f1c0d9e4a5678", label: "Content export workflow", scopes: ["content:read"], createdBy: OWNER, createdAt: NOW - 86_400_000 * 2, lastUsedAt: NOW - 3_600_000, expiresAt: null },
      { id: "tok_77aa11bb22cc33dd", label: "Nightly publish from CI, main branch only", scopes: ["content:read", "content:publish"], createdBy: OWNER, createdAt: NOW - 86_400_000 * 20, lastUsedAt: null, expiresAt: NOW + 86_400_000 * 30 },
    ] }), true;
    if (at === "bans") return json(response, 200, { bans: cast.filter(player => player.ban).map(player => player.ban) }), true;
    if (at === "audit") return json(response, 200, { entries: audit() }), true;
    if (at === "settings") return json(response, 200, {
      settings: { name: "Raid Night", description: "Fridays, 8pm, bring your own arrows.", registerWithDirectory: true, capacity: { corealm: 200, "second-corealm": 50 } },
      overrides: { name: "Raid Night", "capacity.corealm": 200 },
      defaults: { name: "Corealm server", description: "Fridays, 8pm, bring your own arrows.", registerWithDirectory: true, capacity: { corealm: 64, "second-corealm": 50 } },
    }), true;
    if (at === "content" && rest[1] === "revision") return json(response, 200, { revision: REVISION, history: [
      { id: 39, revision: REVISION, previous: PREVIOUS, by: OWNER, at: NOW - 180_000 },
      { id: 31, revision: PREVIOUS, previous: "c7".repeat(32), by: OWNER, at: NOW - 86_400_000 },
      { id: 12, revision: "c7".repeat(32), previous: null, by: "config", at: NOW - 86_400_000 * 4 },
    ] }), true;
    if (at === "content" && rest[1] === "sources") return json(response, 200, { revision: REVISION, revisions, sources }), true;
    if (at === "content" && rest[1] === "catalog") return json(response, 200, catalog), true;
    if (at === "players" && rest.length === 1) {
      const search = (url.searchParams.get("query") ?? "").toLowerCase();
      return json(response, 200, { players: cast.filter(player => !search || `${player.name} ${player.accountId}`.toLowerCase().includes(search)), cursor: null }), true;
    }
    if (at === "players" && rest.length === 2) {
      const found = cast.find(player => player.accountId === decodeURIComponent(rest[1]!));
      if (!found) return json(response, 404, { error: { code: "not_found", message: "No such player on this server" } }), true;
      return json(response, 200, { ...found, ...character(itemRows, found.accountId) }), true;
    }
    return json(response, 404, { error: { code: "not_found", message: "This fixture does not answer that" } }), true;
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://fixture.invalid");
      if (await api(request, response, url)) return;
      // Everything else: the built editor under `/admin/`, and `game/public` at the root for icons.
      const underAdmin = url.pathname.startsWith("/admin/") || url.pathname === "/admin";
      const relative = underAdmin ? url.pathname.replace(/^\/admin\/?/, "") : url.pathname.slice(1);
      const root = underAdmin ? buildRoot : publicRoot;
      const file = path.resolve(root, relative);
      const inside = file === root || file.startsWith(root + path.sep);
      if (inside && await stat(file).then(entry => entry.isFile(), () => false)) {
        response.writeHead(200, { "Content-Type": contentType(file), "Cache-Control": "no-store" });
        createReadStream(file).pipe(response);
        return;
      }
      if (!underAdmin) { response.writeHead(404).end(); return; }
      const html = await readFile(path.join(buildRoot, "index.html"), "utf8");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(html);
    })().catch(error => { console.error(error); response.writeHead(500).end(); });
  });
  await new Promise<void>(resolve => server.listen(port, "127.0.0.1", () => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  return { url: `${origin}/admin/`, origin, close: () => new Promise<void>(resolve => (server as Server).close(() => resolve())) };
}

/** The session a page needs in `sessionStorage` before the editor will mount against the fixture. */
export const fixtureSession = (origin: string): string => JSON.stringify({
  server: origin, audience: origin, token: "cas_fixture", expiresAt: Date.now() + 86_400_000,
  accountId: OWNER, name: "Rook", role: "owner",
});
export const FIXTURE_PLAYER = OWNER;
