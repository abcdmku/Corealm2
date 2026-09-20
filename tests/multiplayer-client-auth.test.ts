import { afterEach, describe, expect, it, vi } from "vitest";
import { WORLD_CONTENT_VERSION, WORLD_PROTOCOL_VERSION, type SessionError, type SessionPhase, type WorldDescriptor, type WorldSession } from "../game/src/contracts.js";
import { IdentityClient } from "../game/src/multiplayer/identityClient.js";
import { ProviderRegistry, SessionController } from "../game/src/multiplayer/providers.js";
import { SessionFailure } from "../game/src/multiplayer/protocol.js";
import { accountBlocker, joinFailureMessage } from "../game/src/multiplayer/worldSelector.js";

const NOW = 1_700_000_000;
const world: WorldDescriptor = {
  providerId: "reference", worldId: "frostmere", name: "Frostmere", endpoint: "ws://127.0.0.1:4180/",
  protocolVersion: WORLD_PROTOCOL_VERSION, contentVersion: WORLD_CONTENT_VERSION, seed: 1337,
  population: 3, capacity: 40, availability: "available", authentication: "account",
};

function signedIn(mint: () => string): IdentityClient {
  const map = new Map<string, string>([["corealm.identity.v1", JSON.stringify({ token: "sess-1", expiresAt: NOW + 600, account: { id: "acc_rook", name: "Rook" } })]]);
  return new IdentityClient("http://127.0.0.1:4190", {
    now: () => NOW, replace: () => {},
    storage: { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: (key) => { map.delete(key); } },
    fetch: (async () => new Response(JSON.stringify({ token: mint(), expiresAt: NOW + 60 }), { status: 200 })) as unknown as typeof fetch,
  });
}

afterEach(() => { vi.useRealTimers(); });

describe("joining an account world", () => {
  it("mints a new join token for every attempt, reconnects included", async () => {
    vi.useFakeTimers();
    let minted = 0;
    const identity = signedIn(() => `jt-${++minted}`);
    const used: string[] = [];
    let notify: (phase: SessionPhase) => void = () => {};
    const session: WorldSession = {
      id: "session-1", playerId: "acc_rook", world, command: vi.fn(), subscribe: () => () => {},
      subscribeStatus: (listener) => { notify = listener; return () => {}; }, close: async () => {},
    };
    const registry = new ProviderRegistry();
    registry.register({
      id: "reference", discover: async () => [world],
      authenticate: async (target) => ({ token: await identity.joinToken(target.endpoint) }),
      connect: async (_target, credentials) => { used.push(credentials.token); return session; },
    });
    const phases: SessionPhase[] = [];
    const controller = new SessionController(registry, { apply: vi.fn(), clear: vi.fn(), offline: async () => {}, phase: (phase) => { phases.push(phase); } });

    await controller.join(world);
    expect(used).toEqual(["jt-1"]);

    // The transport dropped: the controller rejoins, and the rejoin authenticates again rather
    // than replaying the token the first join already spent.
    notify("reconnecting");
    await vi.advanceTimersByTimeAsync(500);
    expect(used).toEqual(["jt-1", "jt-2"]);
    expect(phases).toEqual(["connecting", "connected", "reconnecting", "connecting", "connected"]);
  });

  it("reports the code behind a refused join, not just its text", async () => {
    const registry = new ProviderRegistry();
    registry.register({
      id: "reference", discover: async () => [world], authenticate: async () => ({ token: "jt-1" }),
      connect: async () => { throw new SessionFailure("DUPLICATE_LOGIN", "That account is already in a world on this server"); },
    });
    const seen: { phase: SessionPhase; failure?: SessionError }[] = [];
    const controller = new SessionController(registry, { apply: vi.fn(), clear: vi.fn(), offline: async () => {}, phase: (phase, _message, failure) => { seen.push({ phase, ...(failure ? { failure } : {}) }); } });
    await controller.join(world);
    expect(seen.at(-1)).toEqual({ phase: "unavailable", failure: { code: "DUPLICATE_LOGIN", message: "That account is already in a world on this server" } });
  });

  it("refuses before the socket when the page cannot sign in", async () => {
    const identity = new IdentityClient("http://127.0.0.1:4190", {
      now: () => NOW, replace: () => {}, storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      fetch: (async () => { throw new Error("no network"); }) as unknown as typeof fetch,
    });
    const connect = vi.fn();
    const registry = new ProviderRegistry();
    registry.register({ id: "reference", discover: async () => [world], connect, authenticate: async (target) => ({ token: await identity.joinToken(target.endpoint) }) });
    const messages: (string | undefined)[] = [];
    const controller = new SessionController(registry, { apply: vi.fn(), clear: vi.fn(), offline: async () => {}, phase: (_phase, message) => { messages.push(message); } });
    await controller.join(world);
    expect(connect).not.toHaveBeenCalled();
    expect(messages.at(-1)).toBe("Sign in to join this world");
  });
});

describe("what the picker says about an account world", () => {
  it("names the one thing standing between the player and the world", () => {
    expect(accountBlocker(world, { configured: true, signedIn: true })).toBeNull();
    expect(accountBlocker(world, { configured: true, signedIn: false })).toBe("Sign in to join");
    expect(accountBlocker(world, { configured: false, signedIn: false })).toBe("Login unavailable");
  });

  it("lets guest worlds through whatever the page can do", () => {
    const { authentication: _account, ...open } = world;
    for (const guest of [{ ...open, authentication: "guest" } as WorldDescriptor, open]) {
      expect(accountBlocker(guest, { configured: false, signedIn: false })).toBeNull();
    }
  });

  it("answers the refusals a player can act on", () => {
    expect(joinFailureMessage({ code: "BANNED", message: "Banned from this server until 2026-10-01T00:00:00.000Z: griefing" }))
      .toBe("Banned from this server until 2026-10-01T00:00:00.000Z: griefing. Local play and other servers still work.");
    expect(joinFailureMessage({ code: "DUPLICATE_LOGIN", message: "duplicate login" }))
      .toBe("That account is already playing on this server. Leave the other session, then join again.");
    expect(joinFailureMessage({ code: "UNAUTHORIZED", message: "bad token" }))
      .toBe("This server refused your sign-in. Sign in again, then join.");
    expect(joinFailureMessage({ code: "FULL", message: "full" }))
      .toBe("This world is full. Choose another world or try again.");
    expect(joinFailureMessage({ code: "INCOMPATIBLE", message: "This world requires a different game or protocol version" }))
      .toBe("This world requires a different game or protocol version");
  });
});
