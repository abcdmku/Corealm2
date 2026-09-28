import { describe, expect, it } from "vitest";
import { CATALOG_TABLE_APPLIES } from "../game/src/multiplayer/catalogHost.js";
import type { PublishSummary } from "../devdocs/src/api/backend.js";
import { parseWorldStatus, publishGroups, WORLD_REBAKE_TABLES } from "../devdocs/src/api/worldBake.js";
import { publishSummary } from "../devdocs/src/api/serverBackend.js";
import { stripView } from "../devdocs/src/workspaces/world/bakeStrip.js";

/*
  What an author reads about the world after a geometry publish: the publish result's groups and the
  World workspace's status strip, from the replies `/admin/content/publish` and `/admin/world` send.
*/

const BASE = "0a".repeat(32), BAKED = "1b".repeat(32), OTHER = "2c".repeat(32);
const NOW = Date.parse("2026-09-27T12:01:30Z");

const summary = (patch: Partial<PublishSummary>): PublishSummary => ({ revision: "r", previous: "p", unchanged: false, live: [], onRestart: [], affected: {}, spawns: [], notified: 0, ...patch });

describe("the publish result", () => {
  it("names the tables a world bake carries as rebuilding the world, apart from those a restart carries", () => {
    expect(WORLD_REBAKE_TABLES).toEqual(Object.entries(CATALOG_TABLE_APPLIES).filter(([, applies]) => applies === "rebake").map(([name]) => name).sort());
    expect(publishGroups(summary({ live: ["items"], onRestart: ["resources", "worldTerrain", "worldRegions"] })))
      .toEqual({ live: ["items"], rebuilding: ["worldTerrain", "worldRegions"], onRestart: ["resources"], bakeQueued: false });
  });

  it("reads the queued bake from the publish reply, and a separate rebake list as not live yet", () => {
    const parsed = publishSummary({ revision: "r2", previous: "r1", live: [], onRestart: ["resources"], rebake: ["worldTerrain"],
      bake: { revision: BAKED, catalogRevision: "r2", status: "queued", queuedAt: "2026-09-27T12:00:00Z", extra: 1 } }, "r1");
    expect(parsed.onRestart).toEqual(["resources", "worldTerrain"]);
    expect(parsed.bake).toEqual({ revision: BAKED, catalogRevision: "r2", status: "queued", queuedAt: "2026-09-27T12:00:00Z" });
    expect(publishGroups(parsed)).toEqual({ live: [], rebuilding: ["worldTerrain"], onRestart: ["resources"], bakeQueued: true });
    expect(publishSummary({ revision: "r2", bake: { status: "nope" } }, "r1").bake).toBeUndefined();
  });
});

describe("the world status strip", () => {
  it("tells a repository author to run the world build", () => {
    expect(stripView(undefined, NOW)).toEqual({
      world: { label: "Repository world", tone: "info" },
      note: "Geometry edits (terrain, regions, resource placements) need `npm run world:build` before they ship. The repository has no server bake.",
      history: [], poll: false, mapStale: false,
    });
  });

  it("shows a server on the base game's world without a stale map", () => {
    const status = parseWorldStatus({ revision: BASE, baseRevision: BASE, active: null, history: [] })!;
    expect(stripView(status, NOW)).toEqual({
      world: { label: "Matches the base game", revision: BASE.slice(0, 10), tone: "ok" },
      note: "Publishing terrain, region or resource placement edits bakes the world here.",
      history: [], poll: false, mapStale: false,
    });
  });

  it("follows a running bake step by step and polls", () => {
    const status = parseWorldStatus({ revision: BASE, source: "embedded", active: {
      revision: BAKED, catalogRevision: "c", status: "baking", queuedAt: "2026-09-27T12:00:00Z", startedAt: "2026-09-27T12:00:05Z",
      steps: [{ name: "pack", ms: 41_000, ok: true }, { name: "records" }],
    }, history: [] })!;
    const view = stripView(status, NOW);
    expect(view.bake).toEqual({ label: "Baking the world", tone: "info", elapsed: "1 m 25 s", retry: false, steps: [
      { name: "pack", state: "done", ms: 41_000 }, { name: "records", state: "running" }, { name: "navmesh", state: "waiting" }, { name: "publish", state: "waiting" },
    ] });
    expect(view.poll).toBe(true);
    expect(view.note).toBe("Worlds restart on it once it passes.");
  });

  it("shows a failed bake with its error and Retry, keeps the last good world, and lists earlier bakes", () => {
    const failed = { revision: OTHER, catalogRevision: "c2", status: "failed", queuedAt: "2026-09-27T11:00:00Z", startedAt: "2026-09-27T11:00:00Z", finishedAt: "2026-09-27T11:00:12Z",
      steps: [{ name: "pack", ok: true, ms: 9_000 }, { name: "records", ok: false, ms: 3_000 }], error: "scatter signature mismatch" };
    const ready = { revision: BAKED, catalogRevision: "c1", status: "ready", queuedAt: "2026-09-26T09:00:00Z", finishedAt: "2026-09-26T09:01:00Z" };
    const view = stripView(parseWorldStatus({ current: { revision: BAKED }, base: false, history: [failed, ready] })!, NOW);
    expect(view).toEqual({
      world: { label: "Baked on this server", revision: BAKED.slice(0, 10), tone: "info" },
      bake: { label: "Bake failed", tone: "danger", elapsed: "12 s", error: "scatter signature mismatch", retry: true, steps: [
        { name: "pack", state: "done", ms: 9_000 }, { name: "records", state: "failed", ms: 3_000 }, { name: "navmesh", state: "waiting" }, { name: "publish", state: "waiting" },
      ] },
      note: "The last good world keeps running.",
      history: [{ revision: BAKED.slice(0, 10), label: "Baked", tone: "ok", when: "2026-09-26T09:01:00Z" }],
      poll: false, mapStale: true,
    });
    expect(stripView(parseWorldStatus({ revision: BAKED, base: false, canBake: false, history: [failed] })!, NOW).bake?.retry).toBe(false);
  });

  it("reads the reply `/admin/world` sends, a queued bake included", () => {
    const status = parseWorldStatus({ revision: BASE, base: true, source: "build", codeRevision: "code", wanted: BAKED,
      queued: { revision: BAKED, catalogRevision: "c", status: "queued", queuedAt: "2026-09-27T12:01:00Z" }, history: [], canBake: true })!;
    expect(stripView(status, NOW).bake).toEqual({ label: "Bake queued", tone: "info", elapsed: "30 s", retry: false, steps: [
      { name: "pack", state: "waiting" }, { name: "records", state: "waiting" }, { name: "navmesh", state: "waiting" }, { name: "publish", state: "waiting" },
    ] });
  });

  it("refuses a reply that names no world", () => {
    expect(parseWorldStatus("<!doctype html>")).toBeUndefined();
    expect(parseWorldStatus({ history: [] })).toBeUndefined();
  });
});
