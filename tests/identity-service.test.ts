import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { identityKeys, verifyJoinToken } from "../identity/src/joinToken.js";
import type { OAuthProvider, ProviderIdentity } from "../identity/src/providers.js";
import { startIdentityService, type IdentityService, type IdentityServiceOptions } from "../identity/src/server.js";

const PLAY_ORIGIN = "https://play.example.com";
const RETURN_URL = `${PLAY_ORIGIN}/play?mode=live`;
const GAME_ENDPOINT = "wss://eu.corealm.example/";

/** Stands in for Discord. Codes map to provider identities, so a test can pick who logs in. */
function stubProvider(users: Record<string, ProviderIdentity>): OAuthProvider & { challenges: string[] } {
  const challenges: string[] = [];
  return {
    name: "stub", pkce: true, challenges,
    authorizeUrl(state, redirectUri, codeChallenge) {
      if (codeChallenge) challenges.push(codeChallenge);
      const url = new URL("https://provider.example/authorize");
      url.searchParams.set("state", state); url.searchParams.set("redirect_uri", redirectUri);
      if (codeChallenge) url.searchParams.set("code_challenge", codeChallenge);
      return url.href;
    },
    async exchange(code) {
      const user = users[code];
      if (!user) throw new Error("Unknown authorization code");
      return user;
    },
  };
}

const running: { service: IdentityService; directory: string }[] = [];
afterEach(async () => {
  for (const entry of running.splice(0)) {
    await entry.service.close();
    await rm(entry.directory, { recursive: true, force: true });
  }
});

async function startService(options: Partial<IdentityServiceOptions> & { providers: readonly OAuthProvider[] }) {
  const directory = await mkdtemp(join(tmpdir(), "corealm-identity-"));
  const clock = { unix: 1_700_000_000 };
  const service = await startIdentityService({
    dataDir: directory, allowedOrigins: [PLAY_ORIGIN, "http://127.0.0.1:5173"],
    now: () => clock.unix, log: () => {}, stateTtlSeconds: 60, ...options,
  });
  running.push({ service, directory });
  return { service, clock, base: `http://127.0.0.1:${service.port}` };
}

/** Walks the whole redirect flow a browser would, without following the provider hop. */
async function login(base: string, code: string, returnUrl = RETURN_URL) {
  const start = await fetch(`${base}/login/stub?return=${encodeURIComponent(returnUrl)}`, { redirect: "manual" });
  const state = new URL(start.headers.get("location") ?? "https://provider.example/").searchParams.get("state") ?? "";
  const callback = await fetch(`${base}/callback/stub?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, { redirect: "manual" });
  const location = new URL(callback.headers.get("location") ?? "https://play.example.com/");
  const fragment = new URLSearchParams(location.hash.slice(1));
  return { start, state, callback, location, fragment, session: fragment.get("session") ?? "" };
}

it("issues a join token a game server can verify from the published key alone", async () => {
  const { service, clock, base } = await startService({ providers: [stubProvider({ "code-rook": { providerUserId: "1001", suggestedName: "Rook" } })] });

  const { start, callback, location, fragment, session } = await login(base, "code-rook");
  expect(start.status).toBe(302);
  expect(callback.status).toBe(302);
  expect(location.origin + location.pathname).toBe(`${PLAY_ORIGIN}/play`);
  expect(location.search).toBe("?mode=live");
  // The session arrives in the fragment, which browsers never send to a server or a referrer.
  expect(callback.headers.get("location")).toContain("#");
  expect(fragment.get("name")).toBe("Rook");
  expect(fragment.get("account")).toMatch(/^acc_[A-Za-z0-9_-]{22}$/);
  expect(Number(fragment.get("expiresAt"))).toBe(clock.unix + 30 * 24 * 60 * 60);
  expect(session).toHaveLength(43);

  const account = await (await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${session}` } })).json();
  expect(account).toEqual({ id: fragment.get("account"), name: "Rook", providers: ["stub"] });

  const minted = await fetch(`${base}/token`, {
    method: "POST", headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json", Origin: PLAY_ORIGIN },
    body: JSON.stringify({ audience: GAME_ENDPOINT }),
  });
  expect(minted.status).toBe(200);
  expect(minted.headers.get("access-control-allow-origin")).toBe(PLAY_ORIGIN);
  const issued = await minted.json() as { token: string; expiresAt: number };
  expect(issued.expiresAt).toBe(clock.unix + 60);

  // What the game server does in M3: fetch the keys, verify offline, trust nothing else.
  const document = await fetch(`${base}/.well-known/corealm-keys.json`);
  expect(document.headers.get("access-control-allow-origin")).toBe("*");
  const keys = identityKeys(await document.json());
  expect(keys).toHaveLength(1);
  expect(keys[0]!.status).toBe("active");
  const verified = verifyJoinToken(issued.token, { keys, audience: GAME_ENDPOINT, now: clock.unix });
  expect(verified).toEqual({ ok: true, claims: { sub: account.id, name: "Rook", aud: "https://eu.corealm.example", iat: clock.unix, exp: clock.unix + 60, jti: expect.any(String) } });

  expect(verifyJoinToken(issued.token, { keys, audience: "wss://us.corealm.example/", now: clock.unix }))
    .toEqual({ ok: false, reason: "wrong-audience" });
  expect(verifyJoinToken(issued.token, { keys, audience: GAME_ENDPOINT, now: clock.unix + 120 }))
    .toEqual({ ok: false, reason: "expired" });

  // Rotation republishes the retired key, so tokens minted a moment ago still verify.
  const rotated = service.rotateSigningKey();
  const after = identityKeys(await (await fetch(`${base}/.well-known/corealm-keys.json`)).json());
  expect(after.map(key => key.status)).toEqual(["active", "retired"]);
  expect(after[0]!.kid).toBe(rotated);
  expect(after[1]!.kid).toBe(keys[0]!.kid);
  expect(verifyJoinToken(issued.token, { keys: after, audience: GAME_ENDPOINT, now: clock.unix }).ok).toBe(true);
  const next = await (await fetch(`${base}/token`, {
    method: "POST", headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" }, body: JSON.stringify({ audience: GAME_ENDPOINT }),
  })).json() as { token: string };
  expect(JSON.parse(Buffer.from(next.token.split(".")[0]!, "base64url").toString("utf8")).kid).toBe(rotated);
  expect(verifyJoinToken(next.token, { keys, audience: GAME_ENDPOINT, now: clock.unix })).toEqual({ ok: false, reason: "unknown-key" });
});

it("refuses hostile returns, replayed state and sessions that were thrown away", async () => {
  const provider = stubProvider({ "code-rook": { providerUserId: "1001", suggestedName: "Rook" } });
  const { clock, base } = await startService({ providers: [provider] });

  const open = await fetch(`${base}/login/stub?return=${encodeURIComponent("https://evil.example.com/steal")}`, { redirect: "manual" });
  expect(open.status).toBe(400);
  expect(await open.json()).toEqual({ error: { code: "invalid_return", message: "The return URL must be an allowed origin" } });
  expect((await fetch(`${base}/login/stub?return=${encodeURIComponent("https://play.example.com.evil.test/")}`, { redirect: "manual" })).status).toBe(400);
  expect((await fetch(`${base}/login/stub`, { redirect: "manual" })).status).toBe(400);
  expect((await fetch(`${base}/login/nope?return=${encodeURIComponent(RETURN_URL)}`, { redirect: "manual" })).status).toBe(404);

  const first = await login(base, "code-rook");
  expect(provider.challenges).toHaveLength(1);
  expect(first.session).not.toBe("");
  // Single use: the same state cannot mint a second session.
  const replay = await fetch(`${base}/callback/stub?code=code-rook&state=${encodeURIComponent(first.state)}`, { redirect: "manual" });
  expect(replay.status).toBe(400);
  expect((await replay.json() as { error: { code: string } }).error.code).toBe("invalid_state");

  const stale = await fetch(`${base}/login/stub?return=${encodeURIComponent(RETURN_URL)}`, { redirect: "manual" });
  const staleState = new URL(stale.headers.get("location")!).searchParams.get("state")!;
  clock.unix += 61;
  const expired = await fetch(`${base}/callback/stub?code=code-rook&state=${encodeURIComponent(staleState)}`, { redirect: "manual" });
  expect(expired.status).toBe(400);
  expect((await expired.json() as { error: { code: string } }).error.code).toBe("invalid_state");

  // A code the provider refuses returns the browser to the app with an error, not a session.
  const failing = await fetch(`${base}/login/stub?return=${encodeURIComponent(RETURN_URL)}`, { redirect: "manual" });
  const failingState = new URL(failing.headers.get("location")!).searchParams.get("state")!;
  const rejected = await fetch(`${base}/callback/stub?code=bogus&state=${encodeURIComponent(failingState)}`, { redirect: "manual" });
  expect(rejected.status).toBe(302);
  expect(new URL(rejected.headers.get("location")!).hash).toBe("#error=exchange_failed");

  expect((await fetch(`${base}/token`, { method: "POST", body: JSON.stringify({ audience: GAME_ENDPOINT }) })).status).toBe(401);
  const bogus = await fetch(`${base}/token`, { method: "POST", headers: { Authorization: "Bearer not-a-session" }, body: JSON.stringify({ audience: GAME_ENDPOINT }) });
  expect(bogus.status).toBe(401);
  expect(await bogus.json()).toEqual({ error: { code: "unauthorized", message: "A session is required" } });
  const badAudience = await fetch(`${base}/token`, {
    method: "POST", headers: { Authorization: `Bearer ${first.session}`, "Content-Type": "application/json" }, body: JSON.stringify({ audience: "ftp://play.example.com" }),
  });
  expect(badAudience.status).toBe(400);
  expect((await badAudience.json() as { error: { code: string } }).error.code).toBe("invalid_audience");

  expect((await fetch(`${base}/logout`, { method: "POST", headers: { Authorization: `Bearer ${first.session}` } })).status).toBe(200);
  expect((await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${first.session}` } })).status).toBe(401);
  expect((await fetch(`${base}/token`, {
    method: "POST", headers: { Authorization: `Bearer ${first.session}`, "Content-Type": "application/json" }, body: JSON.stringify({ audience: GAME_ENDPOINT }),
  })).status).toBe(401);
});

it("signs an account out of every session at once", async () => {
  const { base } = await startService({ providers: [stubProvider({
    rook: { providerUserId: "1001", suggestedName: "Rook" }, hall: { providerUserId: "2002", suggestedName: "Hall" },
  }) ] });
  const phone = await login(base, "rook");
  const desktop = await login(base, "rook");
  const other = await login(base, "hall");
  expect(desktop.fragment.get("account")).toBe(phone.fragment.get("account"));

  const revoked = await fetch(`${base}/logout/all`, { method: "POST", headers: { Authorization: `Bearer ${phone.session}` } });
  expect(revoked.status).toBe(200);
  expect(await revoked.json()).toEqual({ ok: true, revoked: 2 });
  expect((await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${phone.session}` } })).status).toBe(401);
  expect((await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${desktop.session}` } })).status).toBe(401);
  // Another account keeps its session.
  expect((await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${other.session}` } })).status).toBe(200);
  expect((await fetch(`${base}/logout/all`, { method: "POST" })).status).toBe(401);
});

it("keeps one account per provider identity and one display name per account", async () => {
  const { base } = await startService({ providers: [stubProvider({
    rook: { providerUserId: "1001", suggestedName: "Rook" },
    twin: { providerUserId: "1002", suggestedName: "Rook" },
    third: { providerUserId: "1003", suggestedName: "Rook" },
    symbols: { providerUserId: "1004", suggestedName: "✨ ro" },
    short: { providerUserId: "1005", suggestedName: "x" },
  })] });

  const first = await login(base, "rook");
  const again = await login(base, "rook");
  expect(again.fragment.get("account")).toBe(first.fragment.get("account"));
  expect(again.session).not.toBe(first.session);

  expect((await login(base, "twin")).fragment.get("name")).toBe("Rook2");
  expect((await login(base, "third")).fragment.get("name")).toBe("Rook3");
  expect((await login(base, "symbols")).fragment.get("name")).toBe("playerro");
  expect((await login(base, "short")).fragment.get("name")).toBe("playerx");

  const rename = async (session: string, name: string) => fetch(`${base}/account/name`, {
    method: "POST", headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" }, body: JSON.stringify({ name }),
  });
  const renamed = await rename(first.session, "Rookery");
  expect(renamed.status).toBe(200);
  expect(await renamed.json()).toEqual({ id: first.fragment.get("account"), name: "Rookery", providers: ["stub"] });
  const taken = await rename(first.session, "rook2");
  expect(taken.status).toBe(409);
  expect((await taken.json() as { error: { code: string } }).error.code).toBe("name_taken");
  expect((await rename(first.session, "no")).status).toBe(400);
  expect((await rename(first.session, "has space")).status).toBe(400);
  expect((await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${first.session}` } })).status).toBe(200);
});

it("links a second provider to a signed-in account and refuses a claimed identity", async () => {
  const users = { rook: { providerUserId: "1001", suggestedName: "Rook" }, hall: { providerUserId: "2002", suggestedName: "Hall" } };
  const { base } = await startService({ providers: [stubProvider(users), { ...stubProvider(users), name: "second" }] });

  const rook = await login(base, "rook");
  const hall = await login(base, "hall");
  const beginLink = async (session: string, returnUrl = RETURN_URL) => {
    const response = await fetch(`${base}/account/link/second`, {
      method: "POST", headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" }, body: JSON.stringify({ return: returnUrl }),
    });
    expect(response.status).toBe(200);
    return new URL((await response.json() as { url: string }).url).searchParams.get("state")!;
  };
  const accepted = await fetch(`${base}/callback/second?code=hall&state=${encodeURIComponent(await beginLink(hall.session))}`, { redirect: "manual" });
  expect(new URL(accepted.headers.get("location")!).hash).toBe("#linked=second");
  expect(await (await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${hall.session}` } })).json())
    .toEqual({ id: hall.fragment.get("account"), name: "Hall", providers: ["second", "stub"] });

  // That provider identity now belongs to Hall, so nobody else may claim it.
  const stolen = await fetch(`${base}/callback/second?code=hall&state=${encodeURIComponent(await beginLink(rook.session))}`, { redirect: "manual" });
  expect(new URL(stolen.headers.get("location")!).hash).toBe("#error=provider_already_linked");
  expect(await (await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${rook.session}` } })).json())
    .toEqual({ id: rook.fragment.get("account"), name: "Rook", providers: ["stub"] });

  expect((await fetch(`${base}/account/link/second`, { method: "POST", body: JSON.stringify({ return: RETURN_URL }) })).status).toBe(401);
  expect((await fetch(`${base}/account/link/second`, {
    method: "POST", headers: { Authorization: `Bearer ${hall.session}`, "Content-Type": "application/json" }, body: JSON.stringify({ return: "https://evil.example.com/" }),
  })).status).toBe(400);
});

it("answers health, preflight and unknown routes the way a browser and a proxy expect", async () => {
  const { base } = await startService({ providers: [stubProvider({})] });
  expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ok: true });
  const allowed = await fetch(`${base}/token`, { method: "OPTIONS", headers: { Origin: PLAY_ORIGIN } });
  expect(allowed.status).toBe(204);
  expect(allowed.headers.get("access-control-allow-origin")).toBe(PLAY_ORIGIN);
  expect(allowed.headers.get("access-control-allow-headers")).toBe("authorization, content-type");
  expect(allowed.headers.get("vary")).toBe("Origin");
  expect(allowed.headers.get("access-control-allow-credentials")).toBe(null);
  expect((await fetch(`${base}/token`, { method: "OPTIONS", headers: { Origin: "https://evil.example.com" } })).status).toBe(403);
  const missing = await fetch(`${base}/nope`);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: { code: "not_found", message: "No such endpoint" } });
  const oversized = await fetch(`${base}/account/name`, {
    method: "POST", headers: { Authorization: "Bearer x", "Content-Type": "application/json" }, body: JSON.stringify({ name: "x".repeat(20_000) }),
  });
  expect(oversized.status).toBe(401);
});
