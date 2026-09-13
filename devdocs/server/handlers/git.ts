import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { repoRoot as defaultRepoRoot } from "../../../tools/lib/paths.js";
import { isLoopbackDevdocsRequest, type DevdocsJsonResponse, type DevdocsRequest } from "./collections.js";

const execFileAsync = promisify(execFile);
const GIT_PATH = "/__devdocs/git";
const MAX_BUFFER = 4 * 1024 * 1024;
const DIFF_PREFIXES = ["game/content/data/", "game/content/meta/", "devdocs/"] as const;

export interface GitHandlerOptions {
  /** Absolute or relative repository root. Defaults to the current Corealm repository. */
  repoRoot?: string;
}

export interface GitStatusEntry {
  /** Git's two-column porcelain status code, such as ` M`, `M `, `??`, or `R `. */
  status: string;
  /** Current path. For renames and copies this is the destination path. */
  path: string;
  tracked: boolean;
  /** Source path for a rename or copy, when Git reports one. */
  originalPath?: string;
}

export interface GitStatusResponse {
  changes: GitStatusEntry[];
}

export type GitHandler = (request: DevdocsRequest) => Promise<DevdocsJsonResponse | undefined>;

type GitRoute = "status" | "diff" | "malformed";

function json(status: number, value: unknown, extraHeaders: Readonly<Record<string, string>> = {}): DevdocsJsonResponse {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
    body: JSON.stringify(value),
  };
}

function text(status: number, value: string): DevdocsJsonResponse {
  return {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    body: value,
  };
}

function errorResponse(status: number, message: string, extraHeaders: Readonly<Record<string, string>> = {}): DevdocsJsonResponse {
  return json(status, { error: message }, extraHeaders);
}

interface ParsedRequestUrl {
  pathname: string;
  query: string;
}

/** Keep raw path segments intact so a literal `..` cannot disappear through URL normalisation. */
function parseRequestUrl(url: string | undefined): ParsedRequestUrl | undefined {
  if (!url) return undefined;
  const withoutHash = url.split("#", 1)[0]!;
  const queryIndex = withoutHash.indexOf("?");
  const rawPath = queryIndex < 0 ? withoutHash : withoutHash.slice(0, queryIndex);
  const query = queryIndex < 0 ? "" : withoutHash.slice(queryIndex + 1);
  if (!rawPath) return undefined;

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(rawPath)) {
    try {
      const authorityStart = rawPath.indexOf("://") + 3;
      const authorityEnd = rawPath.indexOf("/", authorityStart);
      return { pathname: authorityEnd < 0 ? "/" : rawPath.slice(authorityEnd), query };
    } catch {
      return undefined;
    }
  }
  if (!rawPath.startsWith("/")) return undefined;
  return { pathname: rawPath, query };
}

function routeName(pathname: string): GitRoute | undefined {
  if (pathname === `${GIT_PATH}/status`) return "status";
  if (pathname === `${GIT_PATH}/diff`) return "diff";
  if (pathname.startsWith(`${GIT_PATH}/`)) return "malformed";
  return undefined;
}

/** Whether a URL belongs to the read-only Git routes. */
export function isGitPath(url: string | undefined): boolean {
  const parsed = parseRequestUrl(url);
  return parsed !== undefined && routeName(parsed.pathname) !== undefined;
}

function parseStatus(output: string): GitStatusEntry[] {
  const fields = output.split("\0");
  const changes: GitStatusEntry[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index]!;
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ") throw new Error("Malformed git status output");
    const status = record.slice(0, 2);
    const currentPath = record.slice(3);
    if (!currentPath) throw new Error("Malformed git status path");
    const rename = status[0] === "R" || status[0] === "C";
    const originalPath = rename ? fields[++index] : undefined;
    if (rename && !originalPath) throw new Error("Malformed git rename output");
    changes.push({
      status,
      path: currentPath,
      tracked: status !== "??",
      ...(originalPath === undefined ? {} : { originalPath }),
    });
  }
  return changes;
}

async function readStatus(root: string): Promise<GitStatusResponse> {
  const result = await execFileAsync("git", ["status", "--porcelain=v1", "-z"], {
    cwd: root,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    encoding: "utf8",
  });
  return { changes: parseStatus(String(result.stdout)) };
}

function unsafePath(value: string): boolean {
  if (!value || value.includes("\0") || value.includes("\\") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-z]:/i.test(value)) return true;
  const segments = value.split("/");
  return segments.some(segment => segment.length === 0 || segment === "." || segment === "..");
}

function privatePath(value: string): boolean {
  return value.split("/").some(segment => {
    const lower = segment.toLowerCase();
    return lower.startsWith(".env")
      || /(?:^|[._-])credentials?(?:[._-]|$)/i.test(lower)
      || /(?:^|[._-])secrets?(?:[._-]|$)/i.test(lower)
      || /(?:^|[._-])passwords?(?:[._-]|$)/i.test(lower)
      || /(?:^|[._-])tokens?(?:[._-]|$)/i.test(lower)
      || /^(?:id_rsa|id_ed25519)(?:[._-]|$)/i.test(lower)
      || /\.(?:pem|key|p12|pfx)$/i.test(lower);
  });
}

function allowedDiffPath(value: string): boolean {
  return !unsafePath(value) && !privatePath(value) && DIFF_PREFIXES.some(prefix => value.startsWith(prefix) && value.length > prefix.length);
}

function requestedDiffPath(query: string): string | undefined {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(query);
  } catch {
    return undefined;
  }
  const values = params.getAll("path");
  if (values.length !== 1 || !values[0]) return undefined;
  return values[0];
}

export function createGitHandler(options: GitHandlerOptions = {}): GitHandler {
  const root = path.resolve(options.repoRoot ?? defaultRepoRoot);
  return async request => {
    const parsed = parseRequestUrl(request.url);
    if (!parsed) return isGitPath(request.url) ? errorResponse(400, "Malformed Git URL") : undefined;
    const route = routeName(parsed.pathname);
    if (!route) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return errorResponse(403, "Dev docs API accepts loopback requests only");
    if (request.url?.includes("\0")) return errorResponse(400, "Malformed Git URL");
    if (route === "malformed") return errorResponse(400, "Malformed Git URL");
    const method = (request.method ?? "GET").toUpperCase();
    if (method !== "GET") return errorResponse(405, "Method not allowed", { Allow: "GET" });

    try {
      if (route === "status") return json(200, await readStatus(root));

      const requested = requestedDiffPath(parsed.query);
      if (!requested || !allowedDiffPath(requested)) return errorResponse(400, "Invalid diff path");
      const status = await readStatus(root);
      const entry = status.changes.find(change => change.path === requested && change.tracked);
      if (!entry || (entry.originalPath !== undefined && !allowedDiffPath(entry.originalPath))) return errorResponse(404, "Diff path is not a changed tracked file");
      const result = await execFileAsync("git", ["diff", "--no-ext-diff", "HEAD", "--", requested], {
        cwd: root,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        encoding: "utf8",
      });
      return text(200, String(result.stdout));
    } catch {
      return errorResponse(500, "Unable to read Git data");
    }
  };
}

export function gitHandler(request: DevdocsRequest, options: GitHandlerOptions = {}): Promise<DevdocsJsonResponse | undefined> {
  return createGitHandler(options)(request);
}

export default createGitHandler;
