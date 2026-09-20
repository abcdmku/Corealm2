import { JOIN_TOKEN_SKEW_SECONDS, identityKeys, verifyJoinToken, type IdentityKey } from "../../../identity/src/joinToken.js";
import { SessionFailure } from "./protocol.js";
import type { AuthenticationAdapter } from "./referenceServer.js";

export interface IdentityAuthenticationOptions {
  /** Base URL of the identity service, as `hostConfiguration` normalises it. */
  identityUrl: string;
  fetch?: typeof fetch;
  /** Wall clock in milliseconds. */
  now?: () => number;
  /** Least time between key fetches, so tokens naming unknown keys cannot hammer the identity service. */
  refetchIntervalMs?: number;
}
const KEY_DOCUMENT_LIMIT = 65_536;
/** Tokens live about a minute, so this many accepted joins inside one minute is an attack, not a crowd. */
const MAX_REMEMBERED_TOKENS = 100_000;

/**
 * Verifies join tokens offline against the identity service's published keys. The keys are
 * fetched once here, and again only when a token names a key this server has not seen. The
 * audience is the endpoint of the world being joined, which is the server's public endpoint.
 */
export async function createIdentityAuthentication(options: IdentityAuthenticationOptions): Promise<AuthenticationAdapter> {
  const request = options.fetch ?? fetch, now = options.now ?? Date.now, interval = options.refetchIntervalMs ?? 10_000;
  const url = new URL(".well-known/corealm-keys.json", options.identityUrl.endsWith("/") ? options.identityUrl : `${options.identityUrl}/`).href;
  let keys: IdentityKey[] = [], fetchedAt = -Infinity, refresh: Promise<void> | null = null;
  async function fetchKeys(): Promise<void> {
    fetchedAt = now();
    const response = await request(url, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > KEY_DOCUMENT_LIMIT) throw new Error("Key document exceeds size limit");
    keys = identityKeys(JSON.parse(text));
  }
  try { await fetchKeys(); }
  catch (error) { throw new Error(`Identity service keys are unavailable at ${url}: ${error instanceof Error ? error.message : String(error)}`); }

  // Replay defence: an accepted token id is refused until the token could no longer verify anyway.
  const used = new Map<string, number>(); let prunedAt = -Infinity;
  const invalid = () => new SessionFailure("UNAUTHORIZED", "Join token is invalid");
  return {
    authentication: "account",
    async authenticate(token, world) {
      const verify = () => verifyJoinToken(token, { keys, audience: world.endpoint, now: now() / 1000 });
      let result = verify();
      if (!result.ok && result.reason === "unknown-key" && (refresh || now() - fetchedAt >= interval)) {
        // One fetch serves every join waiting on it. A failed fetch keeps the keys already held.
        await (refresh ??= fetchKeys().catch(() => {}).finally(() => { refresh = null; }));
        result = verify();
      }
      if (!result.ok) throw result.reason === "expired" ? new SessionFailure("UNAUTHORIZED", "Join token expired")
        : result.reason === "wrong-audience" ? new SessionFailure("UNAUTHORIZED", "Join token was issued for another server") : invalid();
      const seconds = now() / 1000;
      if (seconds - prunedAt >= 1) { prunedAt = seconds; for (const [jti, until] of used) if (until < seconds) used.delete(jti); }
      if (used.has(result.claims.jti)) throw invalid();
      if (used.size >= MAX_REMEMBERED_TOKENS) throw new SessionFailure("UNAVAILABLE", "Server is busy");
      used.set(result.claims.jti, result.claims.exp + JOIN_TOKEN_SKEW_SECONDS);
      return { playerId: result.claims.sub, name: result.claims.name };
    },
  };
}
