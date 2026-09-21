/**
 * The admin API seen from a checkout: what `export-from-server.ts` and `publish-to-server.ts` share.
 *
 * A game server is not trusted here. It is a remote host, sometimes one an operator typed the
 * address of, and the export tool writes files. So every reply is parsed at this boundary: a
 * collection name has to be one of `CONTENT_COLLECTIONS` by exact string, its value has to have the
 * shape that collection declares, and the file it lands in is `spec.file` from this checkout, never
 * a path the server sent. A hostile server can therefore change the bytes inside a known content
 * file — which the compile and the pull request review then catch — and nothing else.
 *
 * The token is a secret that only ever travels in an `Authorization` header. It is never a flag,
 * never a query value, and `redact` scrubs it from anything on its way to a log.
 */
import path from "node:path";
import { CONTENT_COLLECTIONS, type ContentCollection } from "../../game/src/content/compiler/collections.js";

export const COLLECTIONS_BY_NAME: ReadonlyMap<string, ContentCollection> = new Map(CONTENT_COLLECTIONS.map(spec => [spec.name, spec]));

const REVISION = /^[0-9a-f]{64}$/;
/** The shipped content is about 2 MiB of JSON; the publish endpoint caps a body at 16 MiB. */
const MAX_REPLY_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ServerSources {
  revision: string;
  /** The revision each collection currently has, which is the precondition a publish checks. */
  revisions: Record<string, string>;
  sources: Record<string, unknown>;
}
export interface ServerInfo {
  name: string;
  endpoint: string;
  assetBaseUrl: string | null;
  catalogRevision: string;
}
export interface RevisionHistoryEntry { id?: number; revision: string; previous?: string | null; by?: string | null; at?: number | null; note?: string | null }
export interface PublishReply {
  revision: string; previous: string | null; unchanged: boolean; stored: boolean;
  changedCollections: string[]; changedTables: string[]; revisions: Record<string, string>;
  live: string[]; onRestart: string[];
  affected: Record<string, string[]>;
  problems: { path: string; message: string; severity: string }[];
  assetValidation?: string;
  spawns?: { world: string; added: number; pending: number; retiring: number; removed: number }[];
  notified?: number;
}

/** What the server said no with. `detail` is whatever else the error object carried, such as `blockers`. */
export class ServerRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "ServerRefusal";
  }
}

/** Replaces every secret with `***`, for any string that might reach a log or a pull request body. */
export function redact(text: string, ...secrets: (string | undefined)[]): string {
  let output = text;
  for (const secret of secrets) if (secret && secret.length >= 8) output = output.split(secret).join("***");
  return output;
}

/**
 * Plain `https://host/` (or loopback `http://`), with no credentials, query or fragment, so nothing
 * that could carry a token ends up in a URL. The trailing slash makes `new URL(path, base)` safe.
 */
export function normaliseServerUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); }
  catch { throw new Error(`Not a server URL: ${raw}`); }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error(`A server URL must be https (http is allowed only for loopback): ${raw}`);
  if (url.username || url.password) throw new Error("A server URL must carry no credentials; the token goes in COREALM_CONTENT_TOKEN");
  if (url.search || url.hash) throw new Error(`A server URL must carry no query or fragment: ${raw}`);
  return `${url.origin}${url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`}`;
}

export interface ContentServerOptions {
  serverUrl: string;
  /** `cat_…` or `cas_…`. Read from the environment by the CLI, never from a flag. */
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** One admin API. Every method parses its reply before returning it. */
export class ContentServer {
  readonly url: string;
  private readonly token: string;
  private readonly call: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ContentServerOptions) {
    this.url = normaliseServerUrl(options.serverUrl);
    this.token = options.token;
    if (!this.token) throw new Error("No API token. Set COREALM_CONTENT_TOKEN to a cat_… token minted in devdocs under Server → Access.");
    this.call = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Never includes the token, and scrubs it from anything the transport put in an error. */
  private safe(error: unknown): Error {
    const cause = error instanceof Error ? error : new Error(String(error));
    return new Error(redact(cause.message, this.token), { cause: undefined });
  }

  private async request(route: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<unknown> {
    const target = new URL(route, this.url).toString();
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    let response: Response;
    try {
      response = await this.call(target, {
        method: init.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(init.auth === false ? {} : { Authorization: `Bearer ${this.token}` }),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) { throw this.safe(new Error(`${init.method ?? "GET"} ${target} failed: ${error instanceof Error ? error.message : String(error)}`)); }

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_REPLY_BYTES) throw new Error(`${target} answered ${declared} bytes, over the ${MAX_REPLY_BYTES} byte cap`);
    const text = await response.text();
    if (text.length > MAX_REPLY_BYTES) throw new Error(`${target} answered over the ${MAX_REPLY_BYTES} byte cap`);
    let payload: unknown = null;
    if (text) { try { payload = JSON.parse(text); } catch { throw new Error(`${target} answered ${response.status} with something that is not JSON`); } }
    if (response.ok) return payload;

    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
    const { code, message, ...detail } = error;
    throw new ServerRefusal(response.status, typeof code === "string" ? code : `http_${response.status}`,
      redact(typeof message === "string" ? message : `${target} answered ${response.status}`, this.token), detail);
  }

  /** `GET /admin/info` needs no credential: it is what a sign-in screen reads. */
  async info(): Promise<ServerInfo> {
    const payload = await this.request("admin/info", { auth: false }).catch((error: unknown) => {
      if (error instanceof ServerRefusal && (error.status === 404 || error.status === 501)) {
        throw new Error(`${this.url}admin/info answered ${error.status}. Either this is not a Corealm game server, or it runs without accounts and has no admin API.`);
      }
      throw error;
    });
    if (!isRecord(payload) || typeof payload.name !== "string" || typeof payload.endpoint !== "string" || typeof payload.catalogRevision !== "string") {
      throw new Error(`${this.url}admin/info did not answer with a server description; is this a Corealm game server?`);
    }
    return { name: payload.name, endpoint: payload.endpoint, catalogRevision: payload.catalogRevision,
      assetBaseUrl: typeof payload.assetBaseUrl === "string" ? payload.assetBaseUrl : null };
  }

  async revision(limit = 1): Promise<{ revision: string; history: RevisionHistoryEntry[] }> {
    const payload = await this.request(`admin/content/revision?limit=${encodeURIComponent(String(limit))}`);
    if (!isRecord(payload) || typeof payload.revision !== "string" || !REVISION.test(payload.revision)) throw new Error("The server did not report a catalog revision");
    const history = Array.isArray(payload.history) ? payload.history.filter(isRecord).map(row => ({
      revision: typeof row.revision === "string" ? row.revision : "",
      previous: typeof row.previous === "string" ? row.previous : null,
      by: typeof row.by === "string" ? row.by : null,
      at: typeof row.at === "number" ? row.at : null,
      note: typeof row.note === "string" ? row.note : null,
    })) : [];
    return { revision: payload.revision, history };
  }

  async sources(revision?: string): Promise<ServerSources> {
    if (revision !== undefined && !REVISION.test(revision)) throw new Error(`Not a revision: ${revision}`);
    return parseServerSources(await this.request(`admin/content/sources${revision ? `?revision=${revision}` : ""}`));
  }

  async send(route: "validate" | "publish", body: { base: string; collections: Record<string, { revision: string; value: unknown }>; note?: string }): Promise<PublishReply> {
    const payload = await this.request(`admin/content/${route}`, { method: "POST", body });
    if (!isRecord(payload) || typeof payload.revision !== "string") throw new Error(`The server's ${route} reply was not a publish result`);
    return {
      revision: payload.revision, previous: typeof payload.previous === "string" ? payload.previous : null,
      unchanged: payload.unchanged === true, stored: payload.stored === true,
      changedCollections: stringList(payload.changedCollections), changedTables: stringList(payload.changedTables),
      revisions: isRecord(payload.revisions) ? Object.fromEntries(Object.entries(payload.revisions).filter(([, value]) => typeof value === "string")) as Record<string, string> : {},
      live: stringList(payload.live), onRestart: stringList(payload.onRestart),
      affected: isRecord(payload.affected) ? Object.fromEntries(Object.entries(payload.affected).map(([name, ids]) => [name, stringList(ids)])) : {},
      problems: Array.isArray(payload.problems) ? payload.problems.filter(isRecord).map(problem => ({
        path: String(problem.path ?? ""), message: String(problem.message ?? ""), severity: String(problem.severity ?? "error") })) : [],
      assetValidation: typeof payload.assetValidation === "string" ? payload.assetValidation : undefined,
      spawns: Array.isArray(payload.spawns) ? payload.spawns.filter(isRecord).map(row => ({
        world: String(row.world ?? ""), added: Number(row.added ?? 0), pending: Number(row.pending ?? 0),
        retiring: Number(row.retiring ?? 0), removed: Number(row.removed ?? 0) })) : undefined,
      notified: typeof payload.notified === "number" ? payload.notified : undefined,
    };
  }
}

/**
 * The one gate between a server's reply and this checkout's files. A name that is not exactly one of
 * `CONTENT_COLLECTIONS` is refused, which covers `../x`, `/etc/passwd`, `C:\x`, a NUL, `__proto__`
 * and any collection a future release invents. The path-shaped check ahead of it exists to say why.
 */
export function parseServerSources(payload: unknown): ServerSources {
  if (!isRecord(payload)) throw new Error("The server's content sources reply was not an object");
  const { revision, revisions, sources } = payload;
  if (typeof revision !== "string" || !REVISION.test(revision)) throw new Error("The server's content sources reply carried no catalog revision");
  if (!isRecord(sources)) throw new Error("The server's content sources reply carried no `sources` object");
  if (!isRecord(revisions)) throw new Error("The server's content sources reply carried no `revisions` object");

  const checked: Record<string, unknown> = {};
  for (const name of Object.keys(sources)) {
    assertCollectionName(name);
    const spec = COLLECTIONS_BY_NAME.get(name)!;
    const value = sources[name];
    const shaped = spec.shape === "array" ? Array.isArray(value) : isRecord(value);
    if (!shaped) throw new Error(`The server sent collection "${name}" as ${Array.isArray(value) ? "an array" : typeof value}, but it is ${spec.shape === "array" ? "an array" : "an object"}`);
    checked[name] = value;
  }
  const checkedRevisions: Record<string, string> = {};
  for (const name of Object.keys(revisions)) {
    assertCollectionName(name);
    const value = revisions[name];
    if (typeof value !== "string" || !REVISION.test(value)) throw new Error(`The server sent an unusable revision for collection "${name}"`);
    checkedRevisions[name] = value;
  }
  return { revision, revisions: checkedRevisions, sources: checked };
}

/** Refuses a name that could name a path, then refuses any name this checkout does not know. */
export function assertCollectionName(name: string): ContentCollection {
  if (name.includes("\0") || name.includes("\\") || name.includes("..") || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.length > 64) {
    throw new Error(`The server sent a collection name that looks like a path, which it may never be: ${JSON.stringify(name)}`);
  }
  const spec = COLLECTIONS_BY_NAME.get(name);
  if (!spec) throw new Error(`The server sent an unknown collection "${name}". This checkout writes only the collections it knows; nothing was written.`);
  return spec;
}

/** Where a collection's JSON lives in a checkout. The path comes from this repo, never from a reply. */
export function collectionTarget(contentRoot: string, spec: ContentCollection): string {
  const root = path.resolve(contentRoot);
  const target = path.resolve(root, spec.file);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing to write outside ${root}: ${spec.file}`);
  return target;
}

/** Safe for a pull request body or a log line: one line, no markdown, no control characters, bounded. */
export function safeId(value: string): string {
  const cleaned = value.replace(/[^\w.:/@ '-]+/g, "?");
  return cleaned.length > 96 ? `${cleaned.slice(0, 93)}...` : cleaned;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** Turns a refusal into the sentence an operator should act on. */
export function explainRefusal(error: ServerRefusal): string {
  const blockers = Array.isArray(error.detail.blockers) ? error.detail.blockers : [];
  switch (error.code) {
    case "stale_collections": {
      const stale = stringList(error.detail.stale);
      return [`The live server refused this publish: ${stale.length ? stale.join(", ") : "some collections"} changed on the server since this checkout last exported it.`,
        "Someone edited the live server in devdocs. The server is the source of truth for its own data, so nothing is being forced.",
        "Run the content export workflow, merge the pull request it opens, then publish again."].join("\n");
    }
    case "definition_in_use": {
      const lines = blockers.filter(isRecord).slice(0, 20).map(blocker =>
        `  - ${safeId(String(blocker.kind ?? "definition"))} ${safeId(String(blocker.id ?? "?"))} held by ${safeId(String(blocker.heldBy ?? "?"))}` +
        `${blocker.place ? ` (${safeId(String(blocker.place))})` : ""}${blocker.world ? ` in world ${safeId(String(blocker.world))}` : ""}` +
        `${blocker.name ? ` — ${safeId(String(blocker.name))}` : ""}`);
      return [`The live server refused to remove a definition that is still in use:`, ...lines,
        "Set `retired: true` on the definition instead. A retired definition still resolves for the players holding it, but it no longer drops, spawns or sells."].join("\n");
    }
    case "content_invalid": {
      const problems = Array.isArray(error.detail.problems) ? error.detail.problems.filter(isRecord) : [];
      return [`The live server compiled this content and found ${problems.length} problem${problems.length === 1 ? "" : "s"}:`,
        ...problems.slice(0, 30).map(problem => `  - ${safeId(String(problem.path ?? ""))}: ${redact(String(problem.message ?? ""))}`)].join("\n");
    }
    case "spawn_unplaceable":
      return `A changed spawn group has a creature with nowhere to stand in world ${safeId(String(error.detail.world ?? "?"))}. Move the placement or shrink its count.`;
    case "asset_manifest_unavailable":
      return "The server could not read its asset host's manifest, so it cannot check asset ids. Try again once the asset host answers.";
    case "forbidden":
      return `${error.message}\nMint a token with the content:publish scope in devdocs under Server → Access.`;
    case "unauthorized":
      return `${error.message}\nCheck COREALM_CONTENT_TOKEN. A token that was revoked, expired, or minted on another server is refused here.`;
    default:
      return `${error.message} (${error.status} ${error.code})`;
  }
}
