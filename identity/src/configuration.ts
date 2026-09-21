/** Deployment choices for the identity service, validated before anything opens a socket or a file. */
export interface IdentityConfiguration {
  host: string;
  port: number;
  /** Empty only for an ephemeral loopback port, where the service derives it after binding. */
  publicUrl: string;
  dataDir: string;
  allowedOrigins: string[];
  /** Whether anyone may create an account, or only the operator with `identity-admin`. */
  registration: "open" | "closed";
  /** Read `X-Forwarded-For` for per-address limits. Only true with a proxy you run in front. */
  trustProxy: boolean;
  rotateKey: boolean;
  /** Development only: lets a loopback or private game server into the public directory. */
  allowPrivateServers: boolean;
}

const LOOPBACK = ["127.0.0.1", "localhost", "::1", "[::1]"];

/** Flags override environment variables, and nothing here is a secret: passwords never leave the database. */
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
    // A password crosses the network to this origin, so anything but loopback has to be encrypted.
    if (publicUrl.protocol !== "https:" && !LOOPBACK.includes(publicUrl.hostname)) throw new Error("Passwords require HTTPS");
  }

  const allowedOrigins = (value("--origins", "COREALM_IDENTITY_ORIGINS", "")!).split(",").map(part => part.trim()).filter(Boolean);
  if (!allowedOrigins.length) throw new Error("Set the game and devdocs origins with --origins or COREALM_IDENTITY_ORIGINS");
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    const local = LOOPBACK.includes(url.hostname);
    if (url.origin !== origin || (url.protocol !== "https:" && !(local && url.protocol === "http:")))
      throw new Error("Allowed origins must be exact HTTPS origins or local HTTP origins");
  }

  const registration = (value("--registration", "COREALM_IDENTITY_REGISTRATION", "open")!).trim().toLowerCase();
  if (registration !== "open" && registration !== "closed") throw new Error("Registration is open or closed");

  const flagOrEnv = (flag: string, variable: string) =>
    args.includes(flag) || ["1", "true"].includes((env[variable] ?? "").trim().toLowerCase());
  const allowPrivate = flagOrEnv("--allow-private-servers", "COREALM_IDENTITY_ALLOW_PRIVATE_SERVERS");
  if (allowPrivate && !loopback) throw new Error("Private server registration is a development option and requires a loopback listener");

  return { host, port, publicUrl: publicUrl?.origin ?? "", dataDir, allowedOrigins, registration,
    trustProxy: flagOrEnv("--trust-proxy", "COREALM_IDENTITY_TRUST_PROXY"),
    rotateKey: args.includes("--rotate-key"), allowPrivateServers: allowPrivate };
}
