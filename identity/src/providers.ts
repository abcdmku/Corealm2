import { createHash, randomBytes } from "node:crypto";

/** OAuth providers behind one small interface, so tests can stub one and deployments can add one. */

export type FetchLike = typeof globalThis.fetch;
export interface ProviderIdentity {
  /** The provider's stable user id. Never an email or a handle, both of which change. */
  providerUserId: string;
  /** A starting point for the Corealm display name. The store cleans it and resolves collisions. */
  suggestedName: string;
}
export interface OAuthProvider {
  readonly name: string;
  /** Whether the provider accepts a PKCE challenge. GitHub OAuth apps still do not. */
  readonly pkce: boolean;
  authorizeUrl(state: string, redirectUri: string, codeChallenge?: string): string;
  exchange(code: string, redirectUri: string, context: { codeVerifier?: string; fetch: FetchLike }): Promise<ProviderIdentity>;
}

/** Provider replies are external input: bounded, parsed, and checked field by field. */
const MAX_PROVIDER_BYTES = 65_536;
async function readJson(response: Response): Promise<Record<string, unknown>> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_PROVIDER_BYTES) throw new Error("Provider response exceeds the size limit");
  const text = await response.text();
  if (text.length > MAX_PROVIDER_BYTES) throw new Error("Provider response exceeds the size limit");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Provider response is not JSON"); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Provider response is not an object");
  return value as Record<string, unknown>;
}
function accessToken(body: Record<string, unknown>): string {
  const token = body.access_token;
  if (typeof token !== "string" || !token || token.length > 4096) throw new Error("Provider returned no access token");
  return token;
}
function userId(value: unknown): string {
  const id = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof id !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) throw new Error("Provider returned no usable user id");
  return id;
}
function suggested(...candidates: unknown[]): string {
  for (const candidate of candidates) if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 64);
  return "player";
}

/** PKCE, for the providers that support it. The verifier stays in the login state row. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier, "ascii").digest("base64url") };
}

export interface ProviderCredentials { clientId: string; clientSecret: string }

export function discordProvider(credentials: ProviderCredentials): OAuthProvider {
  return {
    name: "discord", pkce: true,
    authorizeUrl(state, redirectUri, codeChallenge) {
      const url = new URL("https://discord.com/oauth2/authorize");
      url.searchParams.set("client_id", credentials.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", "identify");
      url.searchParams.set("prompt", "none");
      url.searchParams.set("state", state);
      if (codeChallenge) { url.searchParams.set("code_challenge", codeChallenge); url.searchParams.set("code_challenge_method", "S256"); }
      return url.href;
    },
    async exchange(code, redirectUri, context) {
      const body = new URLSearchParams({
        client_id: credentials.clientId, client_secret: credentials.clientSecret,
        grant_type: "authorization_code", code, redirect_uri: redirectUri,
        ...(context.codeVerifier ? { code_verifier: context.codeVerifier } : {}),
      });
      const token = await context.fetch("https://discord.com/api/oauth2/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, redirect: "error",
      });
      if (!token.ok) throw new Error("Discord rejected the authorization code");
      const profile = await context.fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${accessToken(await readJson(token))}`, Accept: "application/json" }, redirect: "error",
      });
      if (!profile.ok) throw new Error("Discord rejected the access token");
      const user = await readJson(profile);
      return { providerUserId: userId(user.id), suggestedName: suggested(user.global_name, user.username) };
    },
  };
}

export function githubProvider(credentials: ProviderCredentials): OAuthProvider {
  return {
    name: "github", pkce: false,
    authorizeUrl(state, redirectUri) {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", credentials.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", "read:user");
      url.searchParams.set("state", state);
      return url.href;
    },
    async exchange(code, redirectUri, context) {
      const token = await context.fetch("https://github.com/login/oauth/access_token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, code, redirect_uri: redirectUri }),
        redirect: "error",
      });
      if (!token.ok) throw new Error("GitHub rejected the authorization code");
      const profile = await context.fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken(await readJson(token))}`, Accept: "application/vnd.github+json", "User-Agent": "corealm-identity" }, redirect: "error",
      });
      if (!profile.ok) throw new Error("GitHub rejected the access token");
      const user = await readJson(profile);
      return { providerUserId: userId(user.id), suggestedName: suggested(user.login, user.name) };
    },
  };
}
