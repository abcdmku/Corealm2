/**
 * Build the data bundle consumed by the read-only Devdocs player guide.
 *
 * The authoring app reads collections through its loopback API. The player has no server, so the
 * same request envelopes are captured as one static JSON file before Vite bundles the app. Source
 * maps, metadata, and editor-only records never enter this file.
 *
 * Usage: npx tsx tools/build-player-guide.ts [--out devdocs/generated/content-bundle.json]
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CollectionResponse, CollectionSummary } from "../devdocs/shared/contracts.js";
import { readRuntimeCatalogs } from "../devdocs/server/catalogs.js";
import { compileAndPublish } from "./content/compile.js";
import { CONTENT_COLLECTIONS, type ContentCollection } from "../game/src/content/compiler/collections.js";
import { contentRoot, contentRevision, formatContentJson } from "./content/format.js";
import { atomicReplaceFile } from "./lib/atomic-replace-file.js";
import { repoRoot } from "./lib/paths.js";

const GENERATED_ROOT = path.resolve(repoRoot, "devdocs", "generated");
const DEFAULT_OUTPUT = path.join(GENERATED_ROOT, "content-bundle.json");
const PLAYER_BUNDLE_FORMAT = "corealm-player-catalog";
const PLAYER_BUNDLE_VERSION = 1 as const;
// These fields belong to the authoring meta store. `notes` remains public content on assets and
// NPCs, so it must stay in the player catalog.
const PRIVATE_KEYS = new Set(["requests", "history", "candidates"]);

type JsonRecord = Record<string, unknown>;

export interface PlayerGuideBundle {
  format: typeof PLAYER_BUNDLE_FORMAT;
  version: typeof PLAYER_BUNDLE_VERSION;
  /** Revision of the compiled source and runtime catalog inputs. */
  revision: string;
  /** The summaries and GET response bodies keyed by the API path after `/__devdocs/`. */
  requests: {
    collections: CollectionSummary[];
    [path: string]: unknown;
  };
}

export interface BuildPlayerGuideOptions {
  /** Content root used by the compiler. Defaults to `game/content`. */
  contentRoot?: string;
  /** Destination for the generated request bundle. Must stay under `devdocs/generated`. */
  out?: string;
}

function collectionCount(spec: ContentCollection, data: unknown): number {
  if (spec.shape === "array") return Array.isArray(data) ? data.length : 0;
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? Object.keys(data).length
    : 0;
}

function responseFor(spec: ContentCollection, data: unknown, revision: string): CollectionResponse {
  return {
    collection: {
      name: spec.name,
      count: collectionCount(spec, data),
      editable: false,
      idKey: spec.idKey,
      shape: spec.shape,
    },
    // The player never writes a collection, but retaining a revision keeps the response contract
    // identical to the authoring API and gives diagnostics a useful source fingerprint.
    revision,
    data,
  };
}

function outputPath(value: string | undefined): string {
  const destination = path.resolve(repoRoot, value ?? path.relative(repoRoot, DEFAULT_OUTPUT));
  const relative = path.relative(GENERATED_ROOT, destination);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Player guide output must stay inside ${GENERATED_ROOT}: ${destination}`);
  }
  if (path.extname(destination).toLowerCase() !== ".json") {
    throw new Error(`Player guide output must be a JSON file: ${destination}`);
  }
  return destination;
}

function assertPublicData(value: unknown, at = "bundle"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPublicData(entry, `${at}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as JsonRecord)) {
    if (PRIVATE_KEYS.has(key)) throw new Error(`Player guide data contains private field ${at}.${key}`);
    assertPublicData(entry, `${at}.${key}`);
  }
}

/**
 * Compile content and write the static GET response bundle used by player mode.
 * The destination is replaced only after compilation and serialization succeed.
 */
export async function buildPlayerGuide(options: BuildPlayerGuideOptions = {}): Promise<{
  output: string;
  bundle: PlayerGuideBundle;
}> {
  const root = path.resolve(options.contentRoot ?? contentRoot);
  const destination = outputPath(options.out);
  const compiled = await compileAndPublish(root);
  if (!compiled.ok) {
    const diagnostics = compiled.diagnostics
      .filter(issue => issue.severity === "error")
      .map(issue => `${issue.path}: ${issue.message}`)
      .join("\n");
    throw new Error(`Cannot build player guide from invalid content${diagnostics ? `\n${diagnostics}` : ""}`);
  }

  const responses = new Map<string, CollectionResponse>();
  for (const spec of CONTENT_COLLECTIONS) {
    const data = compiled.tables[spec.name];
    responses.set(spec.name, responseFor(spec, data, compiled.revision));
  }

  // Runtime catalogs are the last mile between authored sources and the game. Keep this seam
  // separate from source collection registration so compiled views (creatures, assets, and
  // future runtime-only catalogs) can be added without making the player know their file paths.
  for (const response of await readRuntimeCatalogs()) {
    if (responses.has(response.collection.name)) {
      responses.delete(response.collection.name);
    }
    responses.set(response.collection.name, { ...response, collection: { ...response.collection, editable: false } });
  }

  const requestBodies: Record<string, unknown> = {};
  const summaries: CollectionSummary[] = [];
  for (const response of responses.values()) {
    summaries.push(response.collection);
    requestBodies[`collections/${encodeURIComponent(response.collection.name)}`] = response;
  }
  requestBodies.collections = summaries;
  const revision = contentRevision(formatContentJson({
    compiled: compiled.revision,
    requests: requestBodies,
  }));
  const bundle: PlayerGuideBundle = {
    format: PLAYER_BUNDLE_FORMAT,
    version: PLAYER_BUNDLE_VERSION,
    revision,
    requests: { collections: summaries, ...requestBodies },
  };
  // Keep the envelope's `requests` property (the static transport itself) while checking every
  // response body for editor metadata.
  assertPublicData(bundle.requests, "bundle.requests");
  await mkdir(path.dirname(destination), { recursive: true });
  await atomicReplaceFile(destination, formatContentJson(bundle));
  return { output: destination, bundle };
}

function argumentValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArguments(args: readonly string[]): BuildPlayerGuideOptions {
  const supported = new Set(["--out"]);
  const unknown = args.filter((arg, index) => arg.startsWith("--") && !supported.has(arg) && args[index - 1] !== "--out");
  if (unknown.length > 0) throw new Error(`Unknown arguments: ${unknown.join(" ")}`);
  return { out: argumentValue(args, "--out") };
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const result = await buildPlayerGuide(parseArguments(process.argv.slice(2)));
  const summary = result.bundle.requests.collections.map(collection => `${collection.name}:${collection.count}`).join(" ");
  console.log(`Built ${path.relative(repoRoot, result.output)} (${result.bundle.revision}); ${summary}`);
}
