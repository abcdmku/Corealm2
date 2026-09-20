import { discordProvider, githubProvider, type OAuthProvider } from "./providers.js";

/** Deployment choices for the identity service, validated before anything opens a socket or a file. */
export interface IdentityConfiguration {
  host: string;
  port: number;
  /** Empty only for an ephemeral loopback port, where the service derives it after binding. */
  publicUrl: string;
  dataDir: string;
  allowedOrigins: string[];
  providers: OAuthProvider[];
  rotateKey: boolean;
  /** Development only: lets a loopback or private game server into the public directory. */
  allowPrivateServers: boolean;
}

const LOOPBACK = ["127.0.0.1", "localhost", "::1", "[::1]"];

/** Secrets come from the environment only. A flag would land in shell history and process lists. */
export function identityConfiguration(args: readonly string[], env: NodeJS.ProcessEnv = process.env): IdentityConfiguration {
  const value = (flag: string, variable: string, fallback?: string) => {
    const index = args.indexOf(flag);
    if (index >= 0 && (!args[index + 1] || args[index + 1]!.startsWith("--"))) throw new Error(`${flag} requires a value`);
    return index >= 0 ? args[index + 1]! : env[variable] ?? fallback;
  };
  const host = value("--host", "COREALM_IDENTITY_HOST", "127.0.0.1")!;
  const port = Number(value("--port", "COREALM_IDENTITY_PORT", "4190"));
  const dataDir = value("--data", "COREALM_IDENTITY_DATA", "identity-data")!;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port must be 0 through 65535");
  const loopback = LOOPBACK.includes(host);
  if (port === 0 && !loopback) throw new Error("Ephemeral ports require a loopback listener");

  const configuredPublicUrl = value("--public-url", "COREALM_IDENTITY_PUBLIC_URL");
  if (!loopback && !configuredPublicUrl) throw new Error("A remote listener requires a public HTTPS URL");
  // An ephemeral port has no address to advertise yet; the service fills it in once it binds.
  const publicUrl = !configuredPublicUrl && port === 0 ? null : new URL(configuredPublicUrl ?? `http://127.0.0.1:${port}`);
  if (publicUrl) {
    if (publicUrl.href.replace(/\/$/, "") !== publicUrl.origin) throw new Error("The public URL must be a bare origin, such as https://id.example.com");
    if (publicUrl.protocol !== "https:" && !LOOPBACK.includes(publicUrl.hostname)) throw new Error("OAuth redirects require HTTPS");
  }

  const allowedOrigins = (value("--origins", "COREALM_IDENTITY_ORIGINS", "")!).split(",").map(part => part.trim()).filter(Boolean);
  if (!allowedOrigins.length) throw new Error("Set the game and devdocs origins with --origins or COREALM_IDENTITY_ORIGINS");
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    const local = LOOPBACK.includes(url.hostname);
    if (url.origin !== origin || (url.protocol !== "https:" && !(local && url.protocol === "http:")))
      throw new Error("Allowed origins must be exact HTTPS origins or local HTTP origins");
  }

  const providers: OAuthProvider[] = [];
  const credentials = (name: string, idVariable: string, secretVariable: string) => {
    const clientId = env[idVariable]?.trim(), clientSecret = env[secretVariable]?.trim();
    if (!clientId && !clientSecret) return null;
    if (!clientId || !clientSecret) throw new Error(`${name} needs both ${idVariable} and ${secretVariable}`);
    return { clientId, clientSecret };
  };
  const discord = credentials("Discord", "COREALM_IDENTITY_DISCORD_CLIENT_ID", "COREALM_IDENTITY_DISCORD_CLIENT_SECRET");
  if (discord) providers.push(discordProvider(discord));
  const github = credentials("GitHub", "COREALM_IDENTITY_GITHUB_CLIENT_ID", "COREALM_IDENTITY_GITHUB_CLIENT_SECRET");
  if (github) providers.push(githubProvider(github));
  if (!providers.length) throw new Error("Configure Discord or GitHub OAuth credentials in the environment");

  const allowPrivate = args.includes("--allow-private-servers") || ["1", "true"].includes((env.COREALM_IDENTITY_ALLOW_PRIVATE_SERVERS ?? "").trim().toLowerCase());
  if (allowPrivate && !loopback) throw new Error("Private server registration is a development option and requires a loopback listener");

  return { host, port, publicUrl: publicUrl?.origin ?? "", dataDir, allowedOrigins, providers,
    rotateKey: args.includes("--rotate-key"), allowPrivateServers: allowPrivate };
}
