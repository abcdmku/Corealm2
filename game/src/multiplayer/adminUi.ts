import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

/**
 * The devdocs server-mode build, served under `/admin/`.
 *
 * The JSON API lives under `/admin/` too, so the rule is fixed and the build must fit it: the API
 * owns the first path segments in `ADMIN_API_SEGMENTS` for every method, and everything else under
 * `/admin/` is a static file. The app routes in the URL fragment and loads its files by relative
 * path, so it never needs a path the API owns.
 */

/** First segments after `/admin/` that are the API's, whatever the method or the Accept header. */
export const ADMIN_API_SEGMENTS: readonly string[] = ["info", "setup", "session", "me", "roles", "bans", "tokens", "audit", "content", "stats", "players", "settings"];

/** Where the build comes from: a directory today, files embedded in the executable in M6. */
export interface AdminUiSource {
  /** `path` is relative, `/`-separated and already checked: no `..`, no backslash, no NUL. Null when there is no such file. */
  read(path: string): Promise<{ bytes: Buffer; type: string } | null>;
}

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".map": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".ktx2": "image/ktx2",
};
export const contentType = (path: string): string => TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

/** Files under one directory. A path that resolves outside it, through a link or otherwise, is not a file. */
export function directoryAdminUi(directory: string): AdminUiSource {
  const root = resolve(directory);
  return { async read(path) {
    const file = resolve(root, path);
    if (file !== root && !file.startsWith(root + sep)) return null;
    try {
      if (!(await stat(file)).isFile()) return null;
      return { bytes: await readFile(file), type: contentType(file) };
    } catch { return null; }
  } };
}

/**
 * The file a request path names, or null when the path is one no build contains. Decoded once, then
 * refused on anything that could leave the directory or mean two things to two layers.
 */
export function adminUiPath(pathname: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (!decoded.startsWith("/admin/") || /[\\\0-\x1f\x7f:]/.test(decoded) || decoded.includes("%")) return null;
  const parts = decoded.slice("/admin/".length).split("/");
  if (parts.some((part, index) => part === ".." || part === "." || part.startsWith(".") || (part === "" && index !== parts.length - 1))) return null;
  return parts.join("/");
}

export interface AdminUiOptions {
  source: AdminUiSource | null;
  /** Origins the app may call and load from besides this server: the identity service and the asset host. */
  identityUrl?: string;
  assetBaseUrl?: string;
}
const origin = (url: string | undefined): string | null => { try { return url ? new URL(url).origin : null; } catch { return null; } };
/** Vite writes built files to `assets/name-<hash>.ext`, and such a name never means different bytes. Nothing else is cached for long. */
const HASHED = /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

/** Inline scripts in the page are allowed by hash, so the policy never needs `unsafe-inline` for scripts. */
function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/\bsrc\s*=/i.test(match[1]!) && match[2]!.trim())
    hashes.push(`'sha256-${createHash("sha256").update(match[2]!, "utf8").digest("base64")}'`);
  return hashes;
}
export function adminUiPolicy(options: AdminUiOptions, html: string): string {
  const identity = origin(options.identityUrl), assets = origin(options.assetBaseUrl);
  const list = (...values: (string | null)[]) => values.filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    // Syntax highlighting compiles a wasm grammar engine.
    `script-src ${list("'self'", "'wasm-unsafe-eval'", ...inlineScriptHashes(html))}`,
    // The component kit sets inline styles and one library injects a style element.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${list("'self'", "data:", "blob:", assets)}`,
    "font-src 'self' data:",
    // Model previews fetch GLBs from the asset host and textures out of them as blob URLs.
    `connect-src ${list("'self'", "blob:", "data:", identity, assets)}`,
    `media-src ${list("'self'", "blob:", assets)}`,
    "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'none'", "frame-ancestors 'none'",
  ].join("; ");
}

const MISSING = "The admin UI is not built. Run `npx vite build --config devdocs/vite.config.ts --mode server`, or set adminUiDir to a directory that holds the devdocs server-mode build.";

export function createAdminUi(options: AdminUiOptions) {
  function plain(response: ServerResponse, status: number, code: string, message: string, headers: Record<string, string> = {}): void {
    const payload = JSON.stringify({ error: { code, message } });
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Length": Buffer.byteLength(payload), ...headers });
    response.end(payload);
  }
  /** Answers every `/admin` request the API does not own. Returns false for a path outside `/admin`. */
  return async function adminUi(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const pathname = (request.url ?? "").split(/[?#]/)[0]!;
    if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return false;
    if (request.method !== "GET" && request.method !== "HEAD") { plain(response, 405, "method_not_allowed", "The admin UI is read with GET", { Allow: "GET, HEAD" }); return true; }
    // The build loads its files by relative path, which only resolves under a trailing slash.
    if (pathname === "/admin") { response.writeHead(308, { Location: "/admin/", "Cache-Control": "no-store", "Content-Length": 0 }).end(); return true; }
    const path = adminUiPath(pathname);
    if (path === null) { plain(response, 400, "invalid_request", "That is not a path in the admin UI"); return true; }
    const index = options.source ? await options.source.read("index.html") : null;
    if (!index) { plain(response, 404, "admin_ui_missing", MISSING); return true; }
    const asksForFile = /\.[A-Za-z0-9]+$/.test(path);
    let file = path === "" ? index : asksForFile ? await options.source!.read(path) : null, page = path === "";
    if (!file && !asksForFile) {
      // The app routes in the fragment, so a path here is a stale link. Directly under `/admin/` the page's relative files still resolve; any deeper and they would not.
      if (path.includes("/")) { response.writeHead(302, { Location: "/admin/", "Cache-Control": "no-store", "Content-Length": 0 }).end(); return true; }
      file = index; page = true;
    }
    if (!file) { plain(response, 404, "not_found", "No such file in the admin UI"); return true; }
    page ||= file.type.startsWith("text/html");
    const etag = `"${createHash("sha256").update(file.bytes).digest("base64url").slice(0, 27)}"`;
    const headers: Record<string, string | number> = { "Content-Type": file.type, ETag: etag, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Cache-Control": page ? "no-cache" : HASHED.test(path) ? "public, max-age=31536000, immutable" : "public, max-age=300",
      // A page gets the app's policy. Anything else is inert if someone opens it directly, which matters for an SVG.
      "Content-Security-Policy": page ? adminUiPolicy(options, file.bytes.toString("utf8")) : "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox",
      ...(page ? { "X-Frame-Options": "DENY" } : {}) };
    if (request.headers["if-none-match"] === etag) { response.writeHead(304, headers).end(); return true; }
    response.writeHead(200, { ...headers, "Content-Length": file.bytes.length });
    response.end(request.method === "HEAD" ? undefined : file.bytes);
    return true;
  };
}
