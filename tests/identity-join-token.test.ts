import { describe, expect, it } from "vitest";
import {
  audienceOf, createSigningKey, identityKeys, joinTokenClaims, publicKeyFromBase64url, signJoinToken, verifyJoinToken,
  type IdentityKey, type JoinTokenClaims,
} from "../identity/src/joinToken.js";

const NOW = 1_700_000_000;

function keyPair(): { signing: ReturnType<typeof createSigningKey>["signing"]; published: IdentityKey } {
  const created = createSigningKey();
  return { signing: created.signing, published: { kid: created.signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" } };
}
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
function reassemble(token: string, parts: { header?: object; payload?: object }): string {
  const [header, payload, signature] = token.split(".") as [string, string, string];
  return [parts.header ? encode(parts.header) : header, parts.payload ? encode(parts.payload) : payload, signature].join(".");
}
function decodeClaims(token: string): JoinTokenClaims {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
}

describe("join token audience", () => {
  it("maps websocket endpoints onto the http origin both sides compare", () => {
    expect(audienceOf("wss://play.example.com/")).toBe("https://play.example.com");
    expect(audienceOf("https://play.example.com")).toBe("https://play.example.com");
    expect(audienceOf("wss://play.example.com:443/join")).toBe("https://play.example.com");
    expect(audienceOf("wss://play.example.com:8443/")).toBe("https://play.example.com:8443");
    expect(audienceOf("ws://127.0.0.1:4180/")).toBe("http://127.0.0.1:4180");
    expect(audienceOf("ws://127.0.0.1/")).toBe("http://127.0.0.1");
    expect(() => audienceOf("ftp://play.example.com")).toThrow(/ws, wss, http or https/);
    expect(() => audienceOf("wss://user:pass@play.example.com")).toThrow(/credentials/);
    expect(() => audienceOf("not a url")).toThrow(/URL/);
  });
});

describe("join token signing", () => {
  it("round trips claims and pins the frozen wire format", () => {
    const { signing, published } = keyPair();
    const claims = joinTokenClaims({ accountId: "acc_0123456789abcdefghijkl", name: "Rook", endpoint: "wss://play.example.com/", issuedAt: NOW });
    expect(claims).toMatchObject({ sub: "acc_0123456789abcdefghijkl", name: "Rook", aud: "https://play.example.com", iat: NOW, exp: NOW + 60 });
    const token = signJoinToken(signing, claims);
    const [header, payload, signature] = token.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({ alg: "EdDSA", typ: "corealm-join", kid: signing.kid });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toEqual(claims);
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);
    expect(token.length).toBeLessThan(4096);
    const result = verifyJoinToken(token, { keys: [published], audience: "wss://play.example.com/", now: NOW });
    expect(result).toEqual({ ok: true, claims });
    expect(verifyJoinToken(token, { keys: [published], audience: "https://play.example.com", now: NOW }).ok).toBe(true);
  });

  it("names every rejection so a caller knows whether to refetch keys or refuse the player", () => {
    const { signing, published } = keyPair();
    const other = keyPair();
    const claims = joinTokenClaims({ accountId: "acc_0123456789abcdefghijkl", name: "Rook", endpoint: "wss://play.example.com/", issuedAt: NOW });
    const token = signJoinToken(signing, claims);
    const verify = (value: unknown, overrides: { audience?: string; now?: number; keys?: IdentityKey[] } = {}) =>
      verifyJoinToken(value, { keys: overrides.keys ?? [published], audience: overrides.audience ?? "wss://play.example.com/", now: overrides.now ?? NOW });

    expect(verify(token, { audience: "wss://other.example.com/" })).toEqual({ ok: false, reason: "wrong-audience" });
    expect(verify(token, { now: NOW + 61 }).ok).toBe(true); // inside the allowed skew
    expect(verify(token, { now: NOW + 66 })).toEqual({ ok: false, reason: "expired" });
    expect(verify(token, { now: NOW - 6 })).toEqual({ ok: false, reason: "not-yet-valid" });
    expect(verify(token, { keys: [other.published] })).toEqual({ ok: false, reason: "unknown-key" });
    expect(verify(token, { keys: [{ ...other.published, kid: signing.kid }] })).toEqual({ ok: false, reason: "bad-signature" });
    expect(verify(reassemble(token, { payload: { ...claims, sub: "acc_zzzzzzzzzzzzzzzzzzzzzz" } }))).toEqual({ ok: false, reason: "bad-signature" });
    expect(verify(reassemble(token, { payload: { ...claims, name: "Admin" } }))).toEqual({ ok: false, reason: "bad-signature" });

    // Algorithm confusion, unsigned tokens and reshaped claims never reach a signature check.
    expect(verify(reassemble(token, { header: { alg: "HS256", typ: "corealm-join", kid: signing.kid } }))).toEqual({ ok: false, reason: "malformed" });
    expect(verify(reassemble(token, { header: { alg: "none", typ: "corealm-join", kid: signing.kid } }))).toEqual({ ok: false, reason: "malformed" });
    expect(verify(reassemble(token, { header: { alg: "EdDSA", typ: "JWT", kid: signing.kid } }))).toEqual({ ok: false, reason: "malformed" });
    expect(verify(reassemble(token, { payload: { ...claims, exp: claims.iat + 61 } }))).toEqual({ ok: false, reason: "malformed" });
    expect(verify(reassemble(token, { payload: { ...claims, aud: "https://play.example.com/" } }))).toEqual({ ok: false, reason: "malformed" });
    expect(verify(reassemble(token, { payload: { sub: claims.sub, name: claims.name, aud: claims.aud, iat: claims.iat, exp: claims.exp } }))).toEqual({ ok: false, reason: "malformed" });
    expect(verify(`${token}.`)).toEqual({ ok: false, reason: "malformed" });
    expect(verify(token.replace(/^/, "="))).toEqual({ ok: false, reason: "malformed" });
    expect(verify(`${token}${"a".repeat(4096)}`)).toEqual({ ok: false, reason: "malformed" });
    expect(verify(42)).toEqual({ ok: false, reason: "malformed" });
    // Base64 that is not the canonical encoding of its own bytes is a forgery attempt.
    const [header, payload, signature] = token.split(".") as [string, string, string];
    expect(verify([header, payload, `${signature}=`].join("."))).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses to mint anything outside the contract", () => {
    const { signing } = keyPair();
    const claims = joinTokenClaims({ accountId: "acc_0123456789abcdefghijkl", name: "Rook", endpoint: "wss://play.example.com/", issuedAt: NOW });
    expect(() => signJoinToken(signing, { ...claims, exp: claims.iat + 600 })).toThrow(/claims/);
    expect(() => signJoinToken(signing, { ...claims, sub: "rook" })).toThrow(/claims/);
    expect(() => signJoinToken({ ...signing, kid: "!" }, claims)).toThrow(/key id/);
    expect(decodeClaims(signJoinToken(signing, claims)).jti).not.toBe(decodeClaims(signJoinToken(signing, joinTokenClaims({
      accountId: claims.sub, name: claims.name, endpoint: "wss://play.example.com/", issuedAt: NOW,
    }))).jti);
  });
});

describe("published key documents", () => {
  it("accepts the service document and rejects anything unusable", () => {
    const { published } = keyPair();
    expect(identityKeys({ keys: [published] })).toEqual([published]);
    expect(publicKeyFromBase64url(published.publicKey).asymmetricKeyType).toBe("ed25519");
    expect(() => identityKeys({ keys: [] })).toThrow(/key document/);
    expect(() => identityKeys({ keys: [{ ...published, alg: "RS256" }] })).toThrow(/key document/);
    expect(() => identityKeys({ keys: [{ ...published, status: "revoked" }] })).toThrow(/key document/);
    expect(() => identityKeys({ keys: [{ ...published, publicKey: "short" }] })).toThrow(/32 base64url/);
    expect(() => identityKeys([published])).toThrow(/key document/);
  });
});
