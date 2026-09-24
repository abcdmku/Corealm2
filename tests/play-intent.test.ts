import { afterEach, beforeEach, expect, it } from "vitest";
import {
  assetHostReadable, canStorePendingLaunch, joinRoute, lastPlayChoice, parsePlayTarget, playTargetOf, playTargetText,
  rememberPlayChoice, storePendingLaunch, takePendingLaunch,
} from "../game/src/multiplayer/playIntent.js";

/** A storage that behaves like the browser's, including the exception a private window throws. */
function storage(refuse = false): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { if (refuse) throw new Error("storage is disabled"); values.set(key, String(value)); },
    removeItem: key => { values.delete(key); },
    clear: () => values.clear(),
  } as Storage;
}

const globals = globalThis as { localStorage?: Storage; sessionStorage?: Storage };
beforeEach(() => { globals.localStorage = storage(); globals.sessionStorage = storage(); });
afterEach(() => { delete globals.localStorage; delete globals.sessionStorage; });

it("reads the two targets a play link may name", () => {
  expect(playTargetOf("?play=local")).toEqual({ kind: "local" });
  expect(playTargetOf("?play=reference/yard")).toEqual({ kind: "world", providerId: "reference", worldId: "yard" });
  expect(playTargetOf(new URLSearchParams("mode=combat"))).toBeNull();
  expect(playTargetOf("?play=")).toBeNull();
});

it("refuses anything that cannot name a world, rather than guessing one", () => {
  for (const value of ["yard", "reference/", "/yard", "reference/yard/extra", "reference/../etc", "a b/c",
    `${"x".repeat(80)}/yard`, "reference/<script>"]) {
    expect(parsePlayTarget(value), value).toMatchObject({ kind: "invalid" });
  }
});

it("writes a target the same way a play link spells it", () => {
  expect(playTargetText({ kind: "local" })).toBe("local");
  expect(playTargetText({ kind: "world", providerId: "reference", worldId: "yard" })).toBe("reference/yard");
  expect(playTargetText({ kind: "invalid", value: "nonsense" })).toBeNull();
});

it("starts a first visit on local play and remembers the choice after that", () => {
  expect(lastPlayChoice()).toEqual({ kind: "local" });
  rememberPlayChoice({ kind: "world", providerId: "reference", worldId: "yard" });
  expect(lastPlayChoice()).toEqual({ kind: "world", providerId: "reference", worldId: "yard" });
  rememberPlayChoice({ kind: "local" });
  expect(lastPlayChoice()).toEqual({ kind: "local" });
});

it("falls back to local when the stored choice is nonsense or the storage is closed", () => {
  globals.localStorage!.setItem("corealm.play.v1", "not a world");
  expect(lastPlayChoice()).toEqual({ kind: "local" });
  globals.localStorage = storage(true);
  expect(() => rememberPlayChoice({ kind: "local" })).not.toThrow();
  expect(lastPlayChoice()).toEqual({ kind: "local" });
});

it("carries a pending launch across exactly one reload", () => {
  storePendingLaunch({ providerId: "reference", worldId: "yard", assetBaseUrl: "https://cdn.example.com/", attempts: 1 });
  expect(takePendingLaunch()).toEqual({ providerId: "reference", worldId: "yard", assetBaseUrl: "https://cdn.example.com/", attempts: 1 });
  expect(takePendingLaunch()).toBeNull();
});

it("ignores a pending launch that does not name a world and an http(s) host", () => {
  for (const written of ['{"providerId":"reference","worldId":"yard","assetBaseUrl":"/local/"}',
    '{"providerId":"","worldId":"yard","assetBaseUrl":"https://cdn.example.com/"}',
    '{"providerId":"reference","worldId":"yard","assetBaseUrl":"javascript:alert(1)"}', "not json", "[]"]) {
    globals.sessionStorage!.setItem("corealm.play.pending.v1", written);
    expect(takePendingLaunch(), written).toBeNull();
  }
});

it("reloads once for a foreign asset host, then refuses instead of looping", () => {
  expect(joinRoute({ assetHostForeign: false, rebaseAttempts: 0, canStore: true })).toBe("join");
  expect(joinRoute({ assetHostForeign: false, rebaseAttempts: 1, canStore: true })).toBe("join");
  expect(joinRoute({ assetHostForeign: true, rebaseAttempts: 0, canStore: true })).toBe("reload");
  expect(joinRoute({ assetHostForeign: true, rebaseAttempts: 1, canStore: true })).toBe("refuse");
});

it("refuses rather than reloads when the page cannot remember why it reloaded", () => {
  expect(joinRoute({ assetHostForeign: true, rebaseAttempts: 0, canStore: false })).toBe("refuse");
  expect(canStorePendingLaunch()).toBe(true);
  globals.sessionStorage = storage(true);
  expect(canStorePendingLaunch()).toBe(false);
});

it("reads a world's asset host before reloading onto it", async () => {
  const asked: string[] = [];
  const answer = (outcome: Response | Error): typeof fetch => async (input, init) => {
    asked.push(`${init?.method} ${init?.mode} ${String(input)}`);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  expect(await assetHostReadable("https://play.test/dev-assets/", answer(new Response(null, { status: 200 })))).toBe(true);
  expect(asked).toEqual(["HEAD cors https://play.test/dev-assets/assets/manifest.json"]);
  // What a browser reports for a host that sends no Access-Control-Allow-Origin.
  expect(await assetHostReadable("https://play.test/dev-assets/", answer(new TypeError("Failed to fetch")))).toBe(false);
  expect(await assetHostReadable("https://play.test/dev-assets/", answer(new Response(null, { status: 404 })))).toBe(false);
});
