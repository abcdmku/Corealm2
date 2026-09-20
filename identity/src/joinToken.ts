import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, timingSafeEqual, verify } from "node:crypto";

/**
 * The join token contract. The identity service signs, the game server verifies, and neither
 * side may add a dependency to do it: this module imports `node:crypto` and nothing else.
 */

/** A game server's join limit. A token that cannot fit through the join message is not worth parsing. */
export const MAX_JOIN_TOKEN_CHARS = 4096;
/** Tokens are minted for one join attempt. The frozen contract caps the lifetime at a minute. */
export const JOIN_TOKEN_LIFETIME_SECONDS = 60;
/** Two machines never agree on the second. A few seconds of slack, never a minute. */
export const JOIN_TOKEN_SKEW_SECONDS = 5;

export const JOIN_TOKEN_TYPE = "corealm-join";
export const JOIN_TOKEN_ALGORITHM = "EdDSA";

export interface JoinTokenClaims {
  /** Account id, also the game server's `playerId`. */
  sub: string;
  /** Display name at mint time. */
  name: string;
  /** Normalised origin of the game server this token may be presented to. */
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}
/** One published verification key. This is exactly a row of `/.well-known/corealm-keys.json`. */
export interface IdentityKey {
  kid: string;
  alg: typeof JOIN_TOKEN_ALGORITHM;
  /** base64url of the raw 32 byte Ed25519 public key. */
  publicKey: string;
  status: "active" | "retired";
}
/** The signing half. `privateKey` is base64url PKCS#8 DER and never leaves the data directory. */
export interface SigningKey { kid: string; privateKey: string }
export type JoinTokenRejection =
  | "malformed" | "unknown-key" | "bad-signature" | "wrong-audience" | "expired" | "not-yet-valid";
export type JoinTokenResult = { ok: true; claims: JoinTokenClaims } | { ok: false; reason: JoinTokenRejection };

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ACCOUNT_ID = /^acc_[A-Za-z0-9_-]{22,120}$/;
const KEY_ID = /^[A-Za-z0-9_-]{4,64}$/;

/**
 * The audience both sides compute. `wss://play.example.com/` and `https://play.example.com` are
 * the same game server, so they must produce the same string or every join fails on a detail.
 */
export function audienceOf(endpoint: string): string {
  if (typeof endpoint !== "string" || !endpoint || endpoint.length > 2048) throw new Error("Endpoint must be a URL string");
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("Endpoint must be a URL string"); }
  const scheme = { "ws:": "http:", "wss:": "https:", "http:": "http:", "https:": "https:" }[url.protocol];
  if (!scheme) throw new Error("Endpoints use ws, wss, http or https");
  if (url.username || url.password) throw new Error("Endpoints cannot carry credentials");
  // ws and http share port 80, wss and https share 443, so the parser has already dropped the
  // default port and `host` is the origin's host for the mapped scheme.
  return `${scheme}//${url.host}`;
}

/** base64url with no padding, the only encoding this contract accepts. */
function encode(value: Buffer | string): string {
  return Buffer.from(value as never).toString("base64url");
}
/** Reject any segment that is not the single canonical encoding of its bytes. */
function decodeCanonical(segment: string): Buffer | null {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  const bytes = Buffer.from(segment, "base64url");
  return bytes.toString("base64url") === segment ? bytes : null;
}
function parseJson(bytes: Buffer): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const names = Object.keys(value);
  return names.length === keys.length && names.every(name => keys.includes(name));
}

export function publicKeyToBase64url(key: ReturnType<typeof createPublicKey>): string {
  return encode(Buffer.from(key.export({ format: "der", type: "spki" })).subarray(SPKI_PREFIX.length));
}
export function publicKeyFromBase64url(value: string): ReturnType<typeof createPublicKey> {
  const raw = decodeCanonical(value);
  if (!raw || raw.length !== 32) throw new Error("Ed25519 public keys are 32 base64url encoded bytes");
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

/** Mint a signing key and its published half. Called once on first start and again on rotation. */
export function createSigningKey(): { signing: SigningKey; publicKey: string } {
  const pair = generateKeyPairSync("ed25519");
  return {
    signing: { kid: encode(randomBytes(9)), privateKey: encode(Buffer.from(pair.privateKey.export({ format: "der", type: "pkcs8" }))) },
    publicKey: publicKeyToBase64url(pair.publicKey),
  };
}
function privateKeyOf(key: SigningKey): ReturnType<typeof createPrivateKey> {
  const der = decodeCanonical(key.privateKey);
  if (!der) throw new Error("Signing key is not base64url PKCS#8");
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

export function signJoinToken(key: SigningKey, claims: JoinTokenClaims): string {
  if (!KEY_ID.test(key.kid)) throw new Error("Invalid key id");
  if (!claimsAreWellFormed(claims as unknown as Record<string, unknown>)) throw new Error("Invalid join token claims");
  const header = `${encode(JSON.stringify({ alg: JOIN_TOKEN_ALGORITHM, typ: JOIN_TOKEN_TYPE, kid: key.kid }))}.${encode(JSON.stringify(claims))}`;
  const token = `${header}.${encode(sign(null, Buffer.from(header, "ascii"), privateKeyOf(key)))}`;
  if (token.length > MAX_JOIN_TOKEN_CHARS) throw new Error("Join token exceeds the join message limit");
  return token;
}

/** Build the claims for one join attempt. The caller supplies identity, endpoint and clock. */
export function joinTokenClaims(input: { accountId: string; name: string; endpoint: string; issuedAt: number }): JoinTokenClaims {
  const iat = Math.floor(input.issuedAt);
  return {
    sub: input.accountId, name: input.name, aud: audienceOf(input.endpoint),
    iat, exp: iat + JOIN_TOKEN_LIFETIME_SECONDS, jti: encode(randomBytes(12)),
  };
}

function claimsAreWellFormed(value: Record<string, unknown>): value is Record<string, unknown> & JoinTokenClaims {
  if (!onlyKeys(value, ["sub", "name", "aud", "iat", "exp", "jti"])) return false;
  if (typeof value.sub !== "string" || !ACCOUNT_ID.test(value.sub)) return false;
  if (typeof value.name !== "string" || !value.name || value.name.length > 64) return false;
  if (typeof value.jti !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(value.jti)) return false;
  if (!Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp)) return false;
  const lifetime = (value.exp as number) - (value.iat as number);
  if (lifetime <= 0 || lifetime > JOIN_TOKEN_LIFETIME_SECONDS) return false;
  if (typeof value.aud !== "string") return false;
  try { return audienceOf(value.aud) === value.aud; } catch { return false; }
}

/**
 * Verify a token against the published keys. Every rejection is named so a game server can tell
 * "refetch the keys" (`unknown-key`) from "this client is lying" (`bad-signature`).
 */
export function verifyJoinToken(
  token: unknown,
  options: { keys: readonly IdentityKey[]; audience: string; now?: number; skewSeconds?: number },
): JoinTokenResult {
  if (typeof token !== "string" || token.length > MAX_JOIN_TOKEN_CHARS) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];
  const headerBytes = decodeCanonical(headerSegment), payloadBytes = decodeCanonical(payloadSegment);
  const signature = decodeCanonical(signatureSegment);
  if (!headerBytes || !payloadBytes || !signature || signature.length !== 64) return { ok: false, reason: "malformed" };
  const header = parseJson(headerBytes), payload = parseJson(payloadBytes);
  if (!header || !payload) return { ok: false, reason: "malformed" };
  if (!onlyKeys(header, ["alg", "typ", "kid"]) || header.alg !== JOIN_TOKEN_ALGORITHM || header.typ !== JOIN_TOKEN_TYPE
    || typeof header.kid !== "string" || !KEY_ID.test(header.kid)) return { ok: false, reason: "malformed" };
  if (!claimsAreWellFormed(payload)) return { ok: false, reason: "malformed" };
  const claims: JoinTokenClaims = { sub: payload.sub, name: payload.name, aud: payload.aud, iat: payload.iat, exp: payload.exp, jti: payload.jti };

  const candidates = options.keys.filter(key => key.kid === header.kid && key.alg === JOIN_TOKEN_ALGORITHM);
  if (!candidates.length) return { ok: false, reason: "unknown-key" };
  const signed = Buffer.from(`${headerSegment}.${payloadSegment}`, "ascii");
  let verified = false;
  for (const key of candidates) {
    try { if (verify(null, signed, publicKeyFromBase64url(key.publicKey), signature)) verified = true; } catch { /* a malformed published key is not a valid signature */ }
  }
  if (!verified) return { ok: false, reason: "bad-signature" };

  let audience: string;
  try { audience = audienceOf(options.audience); } catch { return { ok: false, reason: "wrong-audience" }; }
  const expected = Buffer.from(audience, "utf8"), actual = Buffer.from(claims.aud, "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: "wrong-audience" };

  const skew = options.skewSeconds ?? JOIN_TOKEN_SKEW_SECONDS;
  const now = Math.floor(options.now ?? Date.now() / 1000);
  if (now > claims.exp + skew) return { ok: false, reason: "expired" };
  if (now < claims.iat - skew) return { ok: false, reason: "not-yet-valid" };
  return { ok: true, claims };
}

/** Parse a fetched `/.well-known/corealm-keys.json` document. Used by the game server in M3. */
export function identityKeys(value: unknown): IdentityKey[] {
  if (value === null || typeof value !== "object" || !Array.isArray((value as { keys?: unknown }).keys)) throw new Error("Invalid key document");
  const rows = (value as { keys: unknown[] }).keys;
  if (!rows.length || rows.length > 32) throw new Error("Invalid key document");
  return rows.map(row => {
    if (row === null || typeof row !== "object") throw new Error("Invalid key document");
    const key = row as Record<string, unknown>;
    if (typeof key.kid !== "string" || !KEY_ID.test(key.kid) || key.alg !== JOIN_TOKEN_ALGORITHM
      || typeof key.publicKey !== "string" || (key.status !== "active" && key.status !== "retired")) throw new Error("Invalid key document");
    publicKeyFromBase64url(key.publicKey);
    return { kid: key.kid, alg: JOIN_TOKEN_ALGORITHM, publicKey: key.publicKey, status: key.status };
  });
}
