import { expect, it } from "vitest";
import { identityKeys, verifyJoinToken } from "../identity/src/joinToken.js";
import { fragmentOf, openForm, PASSWORD, PLAY_ORIGIN, RETURN_URL, signIn, startService, submit } from "./identity-harness.js";

const GAME_ENDPOINT = "wss://eu.corealm.example/";

it("issues a join token a game server can verify from the published key alone", async () => {
  const { service, clock, base } = await startService();

  const opened = await openForm(base, "register");
  expect(opened.response.status).toBe(200);
  // The page says where the session is about to go, which is the one thing a player cannot check.
  expect(opened.page).toContain("Creating an account to play on <strong>https://play.example.com</strong>");
  const registered = await submit(base, "register", { state: opened.state, username: "Rook", password: PASSWORD });
  const { location, fragment, session } = fragmentOf(registered);
  // 303, so coming back and refreshing does not re-post the password.
  expect(registered.status).toBe(303);
  expect(location.origin + location.pathname).toBe(`${PLAY_ORIGIN}/play`);
  expect(location.search).toBe("?mode=live");
  // The session arrives in the fragment, which browsers never send to a server or a referrer.
  expect(registered.headers.get("location")).toContain("#");
  expect(registered.headers.get("referrer-policy")).toBe("no-referrer");
  expect(fragment.get("name")).toBe("Rook");
  expect(fragment.get("account")).toMatch(/^acc_[A-Za-z0-9_-]{22}$/);
  expect(Number(fragment.get("expiresAt"))).toBe(clock.unix + 30 * 24 * 60 * 60);
  expect(session).toHaveLength(43);

  const account = await (await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${session}` } })).json();
  expect(account).toEqual({ id: fragment.get("account"), name: "Rook" });

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

it("signs a registered account back in and refuses a session that was thrown away", async () => {
  const { base } = await startService();
  const registered = await signIn(base, "register", "Rook", PASSWORD);
  expect(registered.response.status).toBe(303);

  const again = await signIn(base, "login", "rook", PASSWORD);
  expect(again.response.status).toBe(303);
  // The name is matched without case, and the original case is what other players see.
  expect(again.fragment.get("account")).toBe(registered.fragment.get("account"));
  expect(again.fragment.get("name")).toBe("Rook");
  expect(again.session).not.toBe(registered.session);

  expect((await fetch(`${base}/token`, { method: "POST", body: JSON.stringify({ audience: GAME_ENDPOINT }) })).status).toBe(401);
  const bogus = await fetch(`${base}/token`, { method: "POST", headers: { Authorization: "Bearer not-a-session" }, body: JSON.stringify({ audience: GAME_ENDPOINT }) });
  expect(bogus.status).toBe(401);
  expect(await bogus.json()).toEqual({ error: { code: "unauthorized", message: "A session is required" } });
  const badAudience = await fetch(`${base}/token`, {
    method: "POST", headers: { Authorization: `Bearer ${again.session}`, "Content-Type": "application/json" }, body: JSON.stringify({ audience: "ftp://play.example.com" }),
  });
  expect(badAudience.status).toBe(400);
  expect((await badAudience.json() as { error: { code: string } }).error.code).toBe("invalid_audience");

  expect((await fetch(`${base}/logout`, { method: "POST", headers: { Authorization: `Bearer ${again.session}` } })).status).toBe(200);
  expect((await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${again.session}` } })).status).toBe(401);
  expect((await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${registered.session}` } })).status).toBe(200);
});

it("signs an account out of every session at once", async () => {
  const { base } = await startService();
  await signIn(base, "register", "Rook", PASSWORD);
  await signIn(base, "register", "Hall", PASSWORD);
  const phone = await signIn(base, "login", "Rook", PASSWORD);
  const desktop = await signIn(base, "login", "Rook", PASSWORD);
  const other = await signIn(base, "login", "Hall", PASSWORD);
  expect(desktop.fragment.get("account")).toBe(phone.fragment.get("account"));

  const revoked = await fetch(`${base}/logout/all`, { method: "POST", headers: { Authorization: `Bearer ${phone.session}` } });
  expect(revoked.status).toBe(200);
  // Three: the one the registration made, and the two logins.
  expect(await revoked.json()).toEqual({ ok: true, revoked: 3 });
  expect((await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${phone.session}` } })).status).toBe(401);
  expect((await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${desktop.session}` } })).status).toBe(401);
  // Another account keeps its session.
  expect((await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${other.session}` } })).status).toBe(200);
  expect((await fetch(`${base}/logout/all`, { method: "POST" })).status).toBe(401);
});

it("keeps one display name per account, whoever asks for it", async () => {
  const { base } = await startService();
  const first = await signIn(base, "register", "Rook", PASSWORD);

  const taken = await signIn(base, "register", "rook", "another-password-1");
  expect(taken.response.status).toBe(409);
  expect(await taken.response.text()).toContain("That username is taken. Choose another.");
  const reserved = await signIn(base, "register", "admin", "another-password-1");
  expect(reserved.response.status).toBe(400);
  expect(await reserved.response.text()).toContain("That username is reserved. Choose another.");
  const short = await signIn(base, "register", "no", "another-password-1");
  expect(short.response.status).toBe(400);
  expect(await short.response.text()).toContain("A username is 3 to 24 characters");

  // Renaming is a bearer call from the game origin, so it never carries a password.
  const rename = async (session: string, name: string) => fetch(`${base}/account/name`, {
    method: "POST", headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" }, body: JSON.stringify({ name }),
  });
  const renamed = await rename(first.session, "Rookery");
  expect(renamed.status).toBe(200);
  expect(await renamed.json()).toEqual({ id: first.fragment.get("account"), name: "Rookery" });
  await signIn(base, "register", "Hall", PASSWORD);
  const clash = await rename(first.session, "hall");
  expect(clash.status).toBe(409);
  expect((await clash.json() as { error: { code: string } }).error.code).toBe("name_taken");
  expect((await rename(first.session, "no")).status).toBe(400);
  expect((await rename(first.session, "has space")).status).toBe(400);
  expect((await rename(first.session, "System")).status).toBe(400);
  expect(await (await fetch(`${base}/account`, { headers: { Authorization: `Bearer ${first.session}` } })).json())
    .toEqual({ id: first.fragment.get("account"), name: "Rookery" });
});

it("answers health, preflight and unknown routes the way a browser and a proxy expect", async () => {
  const { base } = await startService();
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
  // The OAuth routes are gone, not redirected.
  expect((await fetch(`${base}/login/discord?return=${encodeURIComponent(RETURN_URL)}`, { redirect: "manual" })).status).toBe(404);
  expect((await fetch(`${base}/callback/github?code=x&state=y`, { redirect: "manual" })).status).toBe(404);
  expect((await fetch(`${base}/account/link/discord`, { method: "POST" })).status).toBe(404);
  const oversized = await fetch(`${base}/account/name`, {
    method: "POST", headers: { Authorization: "Bearer x", "Content-Type": "application/json" }, body: JSON.stringify({ name: "x".repeat(20_000) }),
  });
  expect(oversized.status).toBe(401);
});
