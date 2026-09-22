import { describe, expect, it, vi } from "vitest";
import { IdentityClient } from "../game/src/multiplayer/identityClient.js";
import { SessionFailure } from "../game/src/multiplayer/protocol.js";

const SESSION_KEY = "corealm.identity.v1";
const NOW = 1_700_000_000;

function storage() {
  const map = new Map<string, string>();
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}
function stored(expiresAt = NOW + 600) {
  const store = storage();
  store.map.set(SESSION_KEY, JSON.stringify({ token: "sess-1", expiresAt, account: { id: "acc_rook", name: "Rook" } }));
  return store;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("the login round trip", () => {
  it("takes the session out of the fragment and out of the URL", () => {
    const store = storage();
    const replaced: string[] = [];
    let href = "http://127.0.0.1:4210/play?world=frostmere#session=sess-1&expiresAt=1700000600&account=acc_rook&name=Rook";
    const client = new IdentityClient("http://127.0.0.1:4190/", {
      storage: store, now: () => NOW, href: () => href, replace: (url) => { href = url; replaced.push(url); },
    });
    expect(client.account()).toEqual({ id: "acc_rook", name: "Rook" });
    expect(replaced).toEqual(["http://127.0.0.1:4210/play?world=frostmere"]);
    expect(href).toBe("http://127.0.0.1:4210/play?world=frostmere");
    expect(JSON.parse(store.map.get(SESSION_KEY)!)).toEqual({ token: "sess-1", expiresAt: 1_700_000_600, account: { id: "acc_rook", name: "Rook" } });
  });

  it("reports a refused login and stores nothing", () => {
    const store = storage();
    const client = new IdentityClient("http://127.0.0.1:4190", {
      storage: store, now: () => NOW, href: () => "http://127.0.0.1:4210/play#error=access_denied", replace: () => {},
    });
    expect(client.account()).toBeNull();
    expect(client.loginFailure()).toBe("Sign-in was cancelled.");
    expect(store.map.size).toBe(0);
  });

  it("refuses a fragment that is missing the account it claims to carry", () => {
    const store = storage();
    const client = new IdentityClient("http://127.0.0.1:4190", {
      storage: store, now: () => NOW, replace: () => {},
      href: () => "http://127.0.0.1:4210/play#session=sess-1&expiresAt=1700000600&name=Rook",
    });
    expect(client.account()).toBeNull();
    expect(client.loginFailure()).toBe("Sign-in returned an unusable session. Try again.");
    expect(store.map.size).toBe(0);
  });

  it("leaves a fragment that is not a login result alone", () => {
    const replaced: string[] = [];
    const client = new IdentityClient("http://127.0.0.1:4190", {
      storage: storage(), now: () => NOW, href: () => "http://127.0.0.1:4210/play#worldMenu", replace: (url) => replaced.push(url),
    });
    expect(replaced).toEqual([]);
    expect(client.account()).toBeNull();
  });

  it("sends the player to the service's own form and back to this page without its fragment", () => {
    const navigated: string[] = [];
    const client = new IdentityClient("http://127.0.0.1:4190", {
      storage: storage(), now: () => NOW, replace: () => {}, navigate: (url) => navigated.push(url),
      href: () => "http://127.0.0.1:4210/play?world=frostmere#worldMenu",
    });
    client.login();
    // The password is typed on the identity origin, so signing in is a navigation and not a fetch.
    expect(navigated).toEqual(["http://127.0.0.1:4190/login?return=http%3A%2F%2F127.0.0.1%3A4210%2Fplay%3Fworld%3Dfrostmere"]);
    client.changePassword();
    expect(navigated[1]).toBe("http://127.0.0.1:4190/password?return=http%3A%2F%2F127.0.0.1%3A4210%2Fplay%3Fworld%3Dfrostmere");
  });
});

describe("the stored session", () => {
  it("is signed in until the expiry the service reported", () => {
    const store = stored(NOW + 1);
    const fresh = new IdentityClient("http://127.0.0.1:4190", { storage: store, now: () => NOW, replace: () => {} });
    expect(fresh.account()).toEqual({ id: "acc_rook", name: "Rook" });
    const expired = new IdentityClient("http://127.0.0.1:4190", { storage: stored(NOW), now: () => NOW, replace: () => {} });
    expect(expired.account()).toBeNull();
  });

  it("drops an expired session from storage rather than sending it", () => {
    const store = stored(NOW - 1);
    const client = new IdentityClient("http://127.0.0.1:4190", { storage: store, now: () => NOW, replace: () => {} });
    expect(client.account()).toBeNull();
    expect(store.map.has(SESSION_KEY)).toBe(false);
  });

  it("ignores a storage entry that is not a session", () => {
    const store = storage();
    store.map.set(SESSION_KEY, '{"token":42}');
    expect(new IdentityClient("http://127.0.0.1:4190", { storage: store, now: () => NOW, replace: () => {} }).account()).toBeNull();
    expect(store.map.has(SESSION_KEY)).toBe(false);
  });

  it("tells subscribers when signing out clears it", async () => {
    const store = stored();
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const client = new IdentityClient("http://127.0.0.1:4190", { storage: store, now: () => NOW, replace: () => {}, fetch: fetchImpl as unknown as typeof fetch });
    const seen: (string | null)[] = [];
    client.subscribe(() => seen.push(client.account()?.name ?? null));
    await client.logout();
    expect(seen).toEqual([null]);
    expect(store.map.size).toBe(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("join tokens", () => {
  it.each(["request", "body"] as const)("times out a stalled identity %s without losing the signed-in account", async phase => {
    vi.useFakeTimers();
    try {
      const store = stored();
      let transportSignal: AbortSignal | undefined;
      const never = new Promise<never>(() => {});
      const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
        transportSignal = init.signal as AbortSignal;
        return phase === "request" ? never : { ok: true, status: 200, text: () => never } as unknown as Response;
      });
      const client = new IdentityClient("http://127.0.0.1:4190", { storage: store, now: () => NOW, fetch: fetchImpl as unknown as typeof fetch });
      const result = client.joinToken("wss://play.example.com/").catch(error => error);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await result).toMatchObject({ code: "UNAVAILABLE", message: expect.stringContaining("too long") });
      expect(transportSignal?.aborted).toBe(true);
      expect(client.account()?.name).toBe("Rook");
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it.each([200, 503])("honors caller cancellation while reading a %s response body and removes its listener", async status => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      const remove = vi.spyOn(caller.signal, "removeEventListener");
      let transportSignal: AbortSignal | undefined;
      const text = vi.fn(() => new Promise<string>(() => {}));
      const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
        transportSignal = init.signal as AbortSignal;
        return { ok: status === 200, status, text } as unknown as Response;
      });
      const client = new IdentityClient("http://127.0.0.1:4190", { storage: stored(), now: () => NOW, fetch: fetchImpl as unknown as typeof fetch });
      const result = client.joinToken("wss://play.example.com/", caller.signal).catch(error => error);
      await vi.advanceTimersByTimeAsync(0);
      expect(text).toHaveBeenCalledOnce();
      const reason = new DOMException("Another world was selected", "AbortError");
      caller.abort(reason);
      expect(await result).toBe(reason);
      expect(transportSignal?.aborted).toBe(true);
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("does not send an already-cancelled request and cleans up a completed request", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => json({ token: "jt-1", expiresAt: NOW + 60 }));
      const client = new IdentityClient("http://127.0.0.1:4190", { storage: stored(), now: () => NOW, fetch: fetchImpl as unknown as typeof fetch });
      const cancelled = new AbortController();
      cancelled.abort();
      await expect(client.joinToken("wss://play.example.com/", cancelled.signal)).rejects.toMatchObject({ name: "AbortError" });
      expect(fetchImpl).not.toHaveBeenCalled();
      const caller = new AbortController();
      const remove = vi.spyOn(caller.signal, "removeEventListener");
      expect(await client.joinToken("wss://play.example.com/", caller.signal)).toBe("jt-1");
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("asks for one token per call, with the world's endpoint as the audience", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return json({ token: `jt-${calls.length}`, expiresAt: NOW + 60 }); });
    const client = new IdentityClient("http://127.0.0.1:4190", { storage: stored(), now: () => NOW, replace: () => {}, fetch: fetchImpl as unknown as typeof fetch });
    expect(await client.joinToken("ws://127.0.0.1:4180/")).toBe("jt-1");
    expect(await client.joinToken("wss://play.example.com/")).toBe("jt-2");
    expect(calls.map((call) => call.url)).toEqual(["http://127.0.0.1:4190/token", "http://127.0.0.1:4190/token"]);
    expect(calls.map((call) => JSON.parse(String(call.init.body)))).toEqual([{ audience: "ws://127.0.0.1:4180/" }, { audience: "wss://play.example.com/" }]);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sess-1");
    expect(calls[0]!.init.credentials).toBe("omit");
  });

  it("never keeps a join token", async () => {
    const store = stored();
    const client = new IdentityClient("http://127.0.0.1:4190", { storage: store, now: () => NOW, replace: () => {}, fetch: (async () => json({ token: "jt-1", expiresAt: NOW + 60 })) as unknown as typeof fetch });
    await client.joinToken("ws://127.0.0.1:4180/");
    expect([...store.map.values()].join("")).not.toContain("jt-1");
  });

  it("refuses to join when nobody is signed in", async () => {
    const fetchImpl = vi.fn();
    const client = new IdentityClient("http://127.0.0.1:4190", { storage: storage(), now: () => NOW, replace: () => {}, fetch: fetchImpl as unknown as typeof fetch });
    await expect(client.joinToken("ws://127.0.0.1:4180/")).rejects.toThrow(new SessionFailure("UNAUTHORIZED", "Sign in to join this world"));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a 401 as a session that is gone", async () => {
    const store = stored();
    const client = new IdentityClient("http://127.0.0.1:4190", { storage: store, now: () => NOW, replace: () => {}, fetch: (async () => json({ error: { code: "unauthorized", message: "A session is required" } }, 401)) as unknown as typeof fetch });
    await expect(client.joinToken("ws://127.0.0.1:4180/")).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Your sign-in expired. Sign in again." });
    expect(client.account()).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it("carries a rate limit through as one", async () => {
    const client = new IdentityClient("http://127.0.0.1:4190", { storage: stored(), now: () => NOW, replace: () => {}, fetch: (async () => json({ error: { code: "rate_limited", message: "Too many join tokens; slow down" } }, 429)) as unknown as typeof fetch });
    await expect(client.joinToken("ws://127.0.0.1:4180/")).rejects.toMatchObject({ code: "RATE_LIMITED", message: "Too many join tokens; slow down" });
    expect(client.account()).toEqual({ id: "acc_rook", name: "Rook" });
  });

  it("rejects an answer that is not a join token", async () => {
    for (const body of [{ token: 42, expiresAt: NOW + 60 }, { token: "jt-1" }, { token: "", expiresAt: NOW + 60 }, ["jt-1"]]) {
      const client = new IdentityClient("http://127.0.0.1:4190", { storage: stored(), now: () => NOW, replace: () => {}, fetch: (async () => json(body)) as unknown as typeof fetch });
      await expect(client.joinToken("ws://127.0.0.1:4180/")).rejects.toThrow(SessionFailure);
    }
    const broken = new IdentityClient("http://127.0.0.1:4190", { storage: stored(), now: () => NOW, replace: () => {}, fetch: (async () => new Response("<html>nope</html>", { status: 200 })) as unknown as typeof fetch });
    await expect(broken.joinToken("ws://127.0.0.1:4180/")).rejects.toMatchObject({ message: "The identity service returned invalid JSON" });
  });
});

describe("the account and the public directory", () => {
  it("keeps a new display name", async () => {
    const store = stored();
    const client = new IdentityClient("http://127.0.0.1:4190", { storage: store, now: () => NOW, replace: () => {}, fetch: (async () => json({ id: "acc_rook", name: "Rookwood" })) as unknown as typeof fetch });
    expect(await client.rename("Rookwood")).toEqual({ id: "acc_rook", name: "Rookwood" });
    expect(client.account()).toEqual({ id: "acc_rook", name: "Rookwood" });
    expect(JSON.parse(store.map.get(SESSION_KEY)!).account).toEqual({ id: "acc_rook", name: "Rookwood" });
  });

  it("reports a taken name with what the service said", async () => {
    const client = new IdentityClient("http://127.0.0.1:4190", { storage: stored(), now: () => NOW, replace: () => {}, fetch: (async () => json({ error: { code: "name_taken", message: "That display name is taken" } }, 409)) as unknown as typeof fetch });
    await expect(client.rename("Rookwood")).rejects.toMatchObject({ code: "INVALID_MESSAGE", message: "That display name is taken" });
  });

  it("signs out when a refresh finds the session revoked", async () => {
    const store = stored();
    const client = new IdentityClient("http://127.0.0.1:4190", { storage: store, now: () => NOW, replace: () => {}, fetch: (async () => json({ error: { code: "unauthorized", message: "A session is required" } }, 401)) as unknown as typeof fetch });
    expect(await client.refresh()).toBeNull();
    expect(client.account()).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it("lists the public servers and drops the rows it cannot use", async () => {
    const client = new IdentityClient("http://127.0.0.1:4190", { storage: storage(), now: () => NOW, replace: () => {}, fetch: (async () => json({ servers: [
      { name: "Frostmere", endpoint: "wss://play.example.com/", description: "The first one", registeredAt: NOW, lastSeenAt: NOW },
      { name: "Nameless", endpoint: "https://play.example.com/" },
      { endpoint: "wss://play.example.com/" },
      { name: "Loopback", endpoint: "ws://127.0.0.1:4180/" },
    ] })) as unknown as typeof fetch });
    expect(await client.servers()).toEqual([
      { name: "Frostmere", endpoint: "wss://play.example.com/", description: "The first one" },
      { name: "Loopback", endpoint: "ws://127.0.0.1:4180/" },
    ]);
  });

  it("rejects a directory that is not a server list", async () => {
    const client = new IdentityClient("http://127.0.0.1:4190", { storage: storage(), now: () => NOW, replace: () => {}, fetch: (async () => json({ servers: "none" })) as unknown as typeof fetch });
    await expect(client.servers()).rejects.toMatchObject({ message: "The identity service returned an unusable server directory" });
  });
});
