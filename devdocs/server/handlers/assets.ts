import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";

import type { AssetCategory, AssetEntry, AssetManifest, AssetPack } from "../../../game/src/render/assets.js";
import { parseValue } from "../../../game/src/content/schema/core.js";
import { CONTENT_COLLECTIONS, parseContentCollection, type ContentCollection } from "../../../game/src/content/compiler/collections.js";
import { contentRevision, formatContentJson } from "../../../tools/content/format.js";
import {
  CANDIDATE_KINDS,
  emptyMetaRecord,
  MetaFileSchema,
  metaCollectionName,
  metaFileName,
  type MetaCandidate,
  type MetaFile,
  type MetaRecord,
} from "../../../tools/content/meta.js";
import { withFileLock } from "../../../tools/content/locks.js";
import { atomicReplaceFile } from "../../../tools/lib/atomic-replace-file.js";
import { repoRoot as defaultRepoRoot } from "../../../tools/lib/paths.js";
import {
  isLoopbackDevdocsRequest,
  type DevdocsJsonResponse,
  type DevdocsRequest,
} from "./collections.js";

/** The maximum GLB payload accepted by the local authoring server. */
export const ASSET_UPLOAD_MAX_BYTES = 32 * 1024 * 1024;
/** JSON/base64 uploads need room for encoding overhead in the Vite middleware. */
export const ASSET_UPLOAD_MAX_REQUEST_BYTES = Math.ceil(ASSET_UPLOAD_MAX_BYTES * 4 / 3) + 512 * 1024;

const ASSETS_PATH = "/__devdocs/assets";
const CANDIDATE_PREFIX = "art/candidates/";
const MODELS_PREFIX = "models/";
const ASSET_CATEGORIES: readonly AssetCategory[] = ["nature", "rock", "building", "prop", "farm", "dungeon", "character", "outfit", "weapon", "animation", "water"];
const BODY_VALUES = ["male", "female", "creature"] as const;
const MAX_CANDIDATE_ID_LENGTH = 220;
const ASSETS_LOCK_NAME = ".devdocs-assets-workflow";

export interface AssetsHandlerOptions {
  /** Absolute `game/content` root. Defaults to the repository content root. */
  contentRoot?: string;
  /** Absolute repository root. Derived from `contentRoot` for isolated handler tests. */
  repoRoot?: string;
  /** Absolute `game/public/assets` root. Useful for isolated handler tests. */
  publicAssetRoot?: string;
  /** Server-owned identity; clients cannot supply authors or timestamps. */
  actor?: string;
  now?: () => string;
  maxUploadBytes?: number;
}

export type AssetsHandlerRequest = DevdocsRequest & { body?: unknown };
export type AssetsHandlerResponse = Omit<DevdocsJsonResponse, "body"> & { body: string | Uint8Array };
export type AssetsHandler = (request: AssetsHandlerRequest) => Promise<AssetsHandlerResponse | undefined>;

export interface AssetCandidateView extends MetaCandidate {
  collection: string;
  entityId: string;
  revision: string;
  fileUrl: string;
}

export interface AssetCandidatesResponse {
  candidates: AssetCandidateView[];
}

export interface AssetPreviousFile {
  assetId: string;
  file: string;
  sha256: string;
  bytes: number;
  archiveFile: string;
}

export interface AssetActionResponse {
  candidate: AssetCandidateView;
  collection: string;
  entityId: string;
  revision: string;
  pendingApproval?: boolean;
  asset?: (AssetEntry & { sha256?: string; provenance?: Record<string, string> });
  previousAsset?: AssetPreviousFile;
}

interface ParsedUrl {
  pathname: string;
  query: string;
}

interface CandidateLocation {
  collection: string;
  entityId: string;
  file: string;
  text: string;
  revision: string;
  records: MetaFile;
  record: MetaRecord;
  candidate: MetaCandidate;
  index: number;
}

interface AssetInspection {
  bytes: number;
  sha256: string;
  animations: string[];
  materials: string[];
  size?: { x: number; y: number; z: number };
  json: Record<string, unknown>;
}

interface UploadInput {
  collection: string;
  entityId: string;
  revision: string;
  fileName: string;
  bytes: Buffer;
  slot?: string;
  body?: (typeof BODY_VALUES)[number];
  provenance?: Record<string, string>;
}

interface ActionInput {
  revision: string;
  reason?: string;
  body?: (typeof BODY_VALUES)[number];
  approvals?: { male?: boolean; female?: boolean };
  asset?: Record<string, unknown>;
  pack?: Record<string, unknown>;
  assetId?: string;
  manifestRevision?: string;
}

class AssetsActionError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(status: number, value: unknown, extraHeaders: Readonly<Record<string, string>> = {}): AssetsHandlerResponse {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
    body: JSON.stringify(value),
  };
}

function failure(status: number, error: string, extra: Record<string, unknown> = {}): AssetsHandlerResponse {
  return json(status, { error, ...extra });
}

/** Keep literal dot segments intact until route validation has rejected them. */
function parseUrl(url: string | undefined): ParsedUrl | undefined {
  if (!url) return undefined;
  const withoutHash = url.split("#", 1)[0]!;
  const queryStart = withoutHash.indexOf("?");
  const rawPath = queryStart < 0 ? withoutHash : withoutHash.slice(0, queryStart);
  const query = queryStart < 0 ? "" : withoutHash.slice(queryStart + 1);
  if (!rawPath) return undefined;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(rawPath)) {
    const authorityStart = rawPath.indexOf("://") + 3;
    const authorityEnd = rawPath.indexOf("/", authorityStart);
    return { pathname: authorityEnd < 0 ? "/" : rawPath.slice(authorityEnd), query };
  }
  return rawPath.startsWith("/") ? { pathname: rawPath, query } : undefined;
}

type AssetRoute =
  | { kind: "candidates" }
  | { kind: "upload" }
  | { kind: "file"; candidateId: string }
  | { kind: "action"; candidateId: string; action: "approve" | "reject" | "promote" }
  | { kind: "malformed" };

function route(url: string | undefined): AssetRoute | undefined {
  const parsed = parseUrl(url);
  if (!parsed) return undefined;
  if (parsed.pathname === ASSETS_PATH) return { kind: "malformed" };
  if (!parsed.pathname.startsWith(`${ASSETS_PATH}/`)) return undefined;
  const rawSegments = parsed.pathname.slice(ASSETS_PATH.length + 1).split("/");
  if (rawSegments.some(segment => !segment)) return { kind: "malformed" };
  let segments: string[];
  try { segments = rawSegments.map(segment => decodeURIComponent(segment)); }
  catch { return { kind: "malformed" }; }
  if (segments.some(segment => !safeRouteSegment(segment))) return { kind: "malformed" };
  if (segments.length === 1 && segments[0] === "candidates") return { kind: "candidates" };
  if (segments.length === 1 && segments[0] === "upload") return { kind: "upload" };
  if (segments.length === 2 && segments[0] === "candidate-file") return { kind: "file", candidateId: segments[1]! };
  if (segments.length === 2 && ["approve", "reject", "promote"].includes(segments[1]!)) {
    return { kind: "action", candidateId: segments[0]!, action: segments[1] as "approve" | "reject" | "promote" };
  }
  return { kind: "malformed" };
}

/** Whether a URL belongs to the asset workflow API. */
export function isAssetsPath(url: string | undefined): boolean {
  const parsed = parseUrl(url);
  return parsed !== undefined && (parsed.pathname === ASSETS_PATH || parsed.pathname.startsWith(`${ASSETS_PATH}/`));
}

function safeRouteSegment(value: string): boolean {
  return Boolean(value)
    && !value.includes("\\")
    && !value.includes("\0")
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && value.length <= MAX_CANDIDATE_ID_LENGTH;
}

function safeEntityId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 220
    && !value.includes("\\")
    && !value.includes("\0")
    && !value.split("/").some(segment => !segment || segment === "." || segment === "..");
}

function safeRevision(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function nonblank(value: unknown, field: string, max = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AssetsActionError(400, `${field} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown, field: string, max = 512): string | undefined {
  if (value === undefined || value === null) return undefined;
  return nonblank(value, field, max);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeBase64(value: string, maxBytes: number): Buffer {
  if (!value || value.length > Math.ceil(maxBytes * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new AssetsActionError(413, "Uploaded file is too large or is not valid base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > maxBytes) throw new AssetsActionError(413, "Uploaded file is empty or too large");
  return bytes;
}

function bytesFromValue(value: unknown, maxBytes: number): Buffer | undefined {
  if (Buffer.isBuffer(value)) return value.length > maxBytes ? undefined : Buffer.from(value);
  if (value instanceof Uint8Array) return value.length > maxBytes ? undefined : Buffer.from(value);
  if (value instanceof ArrayBuffer) {
    const bytes = Buffer.from(value);
    return bytes.length > maxBytes ? undefined : bytes;
  }
  if (typeof value === "string") return decodeBase64(value, maxBytes);
  if (isObject(value)) {
    if (typeof value.base64 === "string") return decodeBase64(value.base64, maxBytes);
    if (typeof value.data === "string") return decodeBase64(value.data, maxBytes);
    if (Array.isArray(value.data) && value.data.every(entry => Number.isInteger(entry) && Number(entry) >= 0 && Number(entry) <= 255)) {
      if (value.data.length === 0 || value.data.length > maxBytes) return undefined;
      return Buffer.from(value.data as number[]);
    }
  }
  return undefined;
}

function uploadedBytes(input: Record<string, unknown>, maxBytes: number): Buffer {
  const values = [input.fileBase64, input.base64, input.bytes, input.data, input.file, input.content];
  for (const value of values) {
    if (value === undefined) continue;
    const bytes = bytesFromValue(value, maxBytes);
    if (bytes) return bytes;
  }
  throw new AssetsActionError(400, "Upload must include a base64 GLB file");
}

function relativeSafe(root: string, relative: string): string {
  if (!relative || relative.includes("\\") || relative.includes("\0")) throw new AssetsActionError(400, "Invalid asset path");
  const normalized = relative.replace(/^\.\//, "");
  const absolute = path.resolve(root, normalized);
  const fromRoot = path.relative(root, absolute);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) throw new AssetsActionError(400, "Asset path leaves its allowlisted root");
  if (normalized.split("/").some(segment => !segment || segment === "." || segment === "..")) throw new AssetsActionError(400, "Invalid asset path");
  return absolute;
}

function assertContained(root: string, absolute: string): void {
  const fromRoot = path.relative(path.resolve(root), path.resolve(absolute));
  if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw new AssetsActionError(400, "Asset path leaves its allowlisted root");
  }
}

/** Resolve a path while rejecting symlinked parents or files outside the allowlist. */
async function safeWritablePath(root: string, relative: string): Promise<string> {
  const absolute = relativeSafe(root, relative);
  let parent = path.dirname(absolute);
  for (;;) {
    try {
      const resolvedParent = await realpath(parent);
      assertContained(root, resolvedParent);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const next = path.dirname(parent);
      if (next === parent) throw new AssetsActionError(400, "Asset path has no safe parent");
      parent = next;
    }
  }
  try {
    const resolved = await realpath(absolute);
    assertContained(root, resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolute;
}

function candidateRelativePath(candidate: MetaCandidate): string {
  const relative = candidate.file.replace(/\\/g, "/");
  if (!relative.startsWith(CANDIDATE_PREFIX) || relative.split("/").some(segment => !segment || segment === "." || segment === "..")) {
    throw new AssetsActionError(500, "Candidate metadata contains an invalid file path");
  }
  return relative;
}

function slug(value: string, fallback = "asset"): string {
  const result = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
  return result || fallback;
}

function candidateIdFor(collection: string, entityId: string, slot: string | undefined, body: string | undefined, sha256: string): string {
  const parts = [slug(collection.replace("/", "-"), "content"), slug(entityId, "record")];
  if (slot) parts.push(slug(slot, "slot"));
  if (body) parts.push(body);
  parts.push(sha256.slice(0, 20));
  return parts.join("-").slice(0, MAX_CANDIDATE_ID_LENGTH);
}

function fileUrl(candidateId: string): string {
  return `${ASSETS_PATH}/candidate-file/${encodeURIComponent(candidateId)}`;
}

function candidateView(location: CandidateLocation): AssetCandidateView {
  return {
    ...location.candidate,
    collection: location.collection,
    entityId: location.entityId,
    revision: location.revision,
    fileUrl: fileUrl(location.candidate.candidateId),
  };
}

function metadataFile(contentRoot: string, collection: string): string {
  return relativeSafe(contentRoot, metaFileName(collection));
}

async function readMetadata(contentRoot: string, collection: string): Promise<{ records: MetaFile; text: string; revision: string; file: string }> {
  const file = metadataFile(contentRoot, collection);
  let text = "{}\n";
  try { text = await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { records: parseValue(MetaFileSchema, JSON.parse(text), `${collection}.meta`), text, revision: contentRevision(text), file };
}

async function writeMetadata(file: string, records: MetaFile): Promise<{ text: string; revision: string }> {
  const validated = parseValue(MetaFileSchema, records, path.basename(file));
  const ordered: MetaFile = {};
  for (const id of Object.keys(validated).sort()) {
    Object.defineProperty(ordered, id, { value: validated[id], enumerable: true, writable: true, configurable: true });
  }
  const text = formatContentJson(ordered);
  await mkdir(path.dirname(file), { recursive: true });
  await atomicReplaceFile(file, text);
  return { text, revision: contentRevision(text) };
}

function ownRecord(records: MetaFile, entityId: string): MetaRecord {
  if (!Object.hasOwn(records, entityId)) {
    Object.defineProperty(records, entityId, { value: emptyMetaRecord(), enumerable: true, writable: true, configurable: true });
  }
  return records[entityId]!;
}

async function metadataCollections(contentRoot: string): Promise<string[]> {
  const directory = path.join(contentRoot, "meta");
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return entries.filter(entry => entry.isFile()).map(entry => metaCollectionName(entry.name)).filter((name): name is string => name !== undefined).sort();
}

async function findCandidates(contentRoot: string): Promise<CandidateLocation[]> {
  const locations: CandidateLocation[] = [];
  for (const collection of await metadataCollections(contentRoot)) {
    const snapshot = await readMetadata(contentRoot, collection);
    for (const [entityId, record] of Object.entries(snapshot.records)) {
      for (const [index, candidate] of record.candidates.entries()) {
        locations.push({ collection, entityId, file: snapshot.file, text: snapshot.text, revision: snapshot.revision,
          records: snapshot.records, record, candidate, index });
      }
    }
  }
  return locations;
}

function queryValues(url: string | undefined): URLSearchParams {
  const parsed = parseUrl(url);
  try { return new URLSearchParams(parsed?.query ?? ""); }
  catch { throw new AssetsActionError(400, "Malformed assets query"); }
}

function filterCandidates(locations: CandidateLocation[], params: URLSearchParams): CandidateLocation[] {
  const collection = params.get("collection") ?? params.get("targetCollection");
  const entityId = params.get("entityId") ?? params.get("targetId");
  const status = params.get("status");
  const candidateId = params.get("candidateId");
  if (collection && !CONTENT_COLLECTIONS.some(spec => spec.name === collection)) throw new AssetsActionError(400, "Unknown candidate collection");
  if (status && !["draft", "candidate", "approved", "live", "rejected"].includes(status)) throw new AssetsActionError(400, "Unknown candidate status");
  return locations.filter(location => (!collection || location.collection === collection)
    && (!entityId || location.entityId === entityId)
    && (!status || location.candidate.status === status)
    && (!candidateId || location.candidate.candidateId === candidateId))
    .sort((a, b) => Date.parse(b.candidate.uploadedAt) - Date.parse(a.candidate.uploadedAt) || b.candidate.candidateId.localeCompare(a.candidate.candidateId));
}

function parseProvenance(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) throw new AssetsActionError(400, "provenance must be an object");
  const result: Record<string, string> = {};
  for (const key of ["pack", "author", "license", "source", "prompt"] as const) {
    const valueAtKey = value[key];
    if (valueAtKey !== undefined) result[key] = nonblank(valueAtKey, `provenance.${key}`, key === "prompt" ? 10_000 : 1024);
  }
  return Object.keys(result).length ? result : undefined;
}

function parseBodyValue(value: unknown, field: string): (typeof BODY_VALUES)[number] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !(BODY_VALUES as readonly string[]).includes(value)) throw new AssetsActionError(400, `${field} must be male, female, or creature`);
  return value as (typeof BODY_VALUES)[number];
}

function parseUpload(requestBody: unknown, maxBytes: number): UploadInput {
  if (!isObject(requestBody)) throw new AssetsActionError(400, "Invalid asset upload body");
  const collection = nonblank(requestBody.collection ?? requestBody.targetCollection, "collection", 120);
  const entityId = nonblank(requestBody.entityId ?? requestBody.targetId, "entityId", 220);
  if (!safeEntityId(entityId)) throw new AssetsActionError(400, "Invalid entityId");
  const revision = requestBody.revision;
  if (!safeRevision(revision)) throw new AssetsActionError(400, "Upload requires a current metadata revision");
  const fileName = nonblank(requestBody.fileName ?? requestBody.name ?? "candidate.glb", "fileName", 240);
  if (!/^[^\\/\0]+\.glb$/i.test(fileName)) throw new AssetsActionError(400, "Uploads must be a .glb file name");
  const slot = optionalString(requestBody.slot, "slot", 80);
  if (slot && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(slot)) throw new AssetsActionError(400, "Invalid candidate slot");
  const body = parseBodyValue(requestBody.body, "body");
  const provenance = parseProvenance(requestBody.provenance);
  return { collection, entityId, revision, fileName, bytes: uploadedBytes(requestBody, maxBytes), ...(slot ? { slot } : {}), ...(body ? { body } : {}), ...(provenance ? { provenance } : {}) };
}

function parseApprovals(value: unknown): { male?: boolean; female?: boolean } | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) throw new AssetsActionError(400, "approvals must be an object");
  const result: { male?: boolean; female?: boolean } = {};
  for (const key of ["male", "female"] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "boolean") throw new AssetsActionError(400, `approvals.${key} must be boolean`);
      result[key] = value[key];
    }
  }
  if (!Object.keys(result).length) throw new AssetsActionError(400, "approvals must include male or female");
  return result;
}

type AssetAction = "approve" | "reject" | "promote";

function parseAction(requestBody: unknown, action: AssetAction): ActionInput {
  if (!isObject(requestBody)) throw new AssetsActionError(400, "Invalid asset action body");
  if (!safeRevision(requestBody.revision)) throw new AssetsActionError(400, `${action} requires a current metadata revision`);
  const result: ActionInput = { revision: requestBody.revision };
  const reason = optionalString(requestBody.reason, "reason", 4000);
  if (reason) result.reason = reason;
  const body = parseBodyValue(requestBody.body, "body");
  if (body) result.body = body;
  const approvals = parseApprovals(requestBody.approvals);
  if (approvals) result.approvals = approvals;
  if (requestBody.asset !== undefined) {
    if (!isObject(requestBody.asset)) throw new AssetsActionError(400, "asset must be an object");
    result.asset = requestBody.asset;
  }
  if (requestBody.pack !== undefined) {
    if (!isObject(requestBody.pack)) throw new AssetsActionError(400, "pack must be an object");
    result.pack = requestBody.pack;
  }
  const assetId = requestBody.assetId;
  if (assetId !== undefined) result.assetId = nonblank(assetId, "assetId", 180);
  const manifestRevision = requestBody.manifestRevision;
  if (manifestRevision !== undefined) {
    if (!safeRevision(manifestRevision)) throw new AssetsActionError(400, "manifestRevision must be a SHA-256 revision");
    result.manifestRevision = manifestRevision;
  }
  if (action === "reject" && !reason) throw new AssetsActionError(400, "Rejecting a candidate requires a reason");
  return result;
}

function chunkJson(bytes: Buffer): { json: Record<string, unknown>; bin: Buffer[] } {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF") throw new AssetsActionError(422, "Uploaded file is not a GLB");
  if (bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new AssetsActionError(422, "Invalid GLB header or declared length");
  let offset = 12;
  let json: Record<string, unknown> | undefined;
  const bin: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new AssetsActionError(422, "GLB chunk header is truncated");
    const length = bytes.readUInt32LE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length || length % 4 !== 0) throw new AssetsActionError(422, "GLB chunk extends past the file");
    if (type === "JSON") {
      if (json) throw new AssetsActionError(422, "GLB contains multiple JSON chunks");
      let parsed: unknown;
      try { parsed = JSON.parse(bytes.toString("utf8", start, end).trim()); }
      catch { throw new AssetsActionError(422, "GLB JSON chunk is malformed"); }
      if (!isObject(parsed)) throw new AssetsActionError(422, "GLB JSON chunk must be an object");
      json = parsed;
    } else if (type === "BIN\0") {
      bin.push(Buffer.from(bytes.subarray(start, end)));
    }
    offset = end;
  }
  if (!json) throw new AssetsActionError(422, "GLB has no JSON chunk");
  return { json, bin };
}

function namedArray(json: Record<string, unknown>, key: string): string[] {
  const value = json[key];
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => isObject(entry) && typeof entry.name === "string" ? entry.name : `${key}-${index}`);
}

function numberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length !== 3 || value.some(entry => typeof entry !== "number" || !Number.isFinite(entry))) return undefined;
  return value as number[];
}

function boundsFromGlb(json: Record<string, unknown>, bin: readonly Buffer[]): { x: number; y: number; z: number } | undefined {
  const accessors = Array.isArray(json.accessors) ? json.accessors : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const bounds: Array<{ min: number[]; max: number[] }> = [];
  for (const mesh of meshes) {
    if (!isObject(mesh) || !Array.isArray(mesh.primitives)) continue;
    for (const primitive of mesh.primitives) {
      if (!isObject(primitive) || !isObject(primitive.attributes)) continue;
      const index = primitive.attributes.POSITION;
      if (typeof index !== "number" || !Number.isInteger(index) || !isObject(accessors[index])) continue;
      const accessor = accessors[index] as Record<string, unknown>;
      const min = numberArray(accessor.min);
      const max = numberArray(accessor.max);
      if (min && max) bounds.push({ min, max });
    }
  }
  if (!bounds.length) return undefined;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const bound of bounds) for (let index = 0; index < 3; index += 1) {
    min[index] = Math.min(min[index]!, bound.min[index]!);
    max[index] = Math.max(max[index]!, bound.max[index]!);
  }
  const size = { x: max[0]! - min[0]!, y: max[1]! - min[1]!, z: max[2]! - min[2]! };
  return Object.values(size).every(value => Number.isFinite(value) && value >= 0) ? size : undefined;
}

function inspectGlb(bytes: Buffer, maxBytes: number): AssetInspection {
  if (bytes.length === 0 || bytes.length > maxBytes) throw new AssetsActionError(413, "Uploaded file is empty or too large");
  const { json, bin } = chunkJson(bytes);
  for (const key of ["buffers", "images"] as const) {
    const values = json[key];
    if (!Array.isArray(values)) continue;
    for (const entry of values) {
      if (!isObject(entry) || typeof entry.uri !== "string" || entry.uri.startsWith("data:")) continue;
      throw new AssetsActionError(422, `GLB external ${key.slice(0, -1)} resources are not accepted; embed them in the upload`);
    }
  }
  const buffers = Array.isArray(json.buffers) ? json.buffers : [];
  if (buffers.length > 1 || (buffers[0] && (!isObject(buffers[0]) || typeof buffers[0].byteLength !== "number"))) throw new AssetsActionError(422, "GLB must contain one embedded buffer");
  if (buffers[0]) {
    if (!bin[0] || Number(buffers[0].byteLength) > bin[0].length) throw new AssetsActionError(422, "GLB binary buffer is truncated");
  } else if (bin.length) {
    throw new AssetsActionError(422, "GLB contains a binary chunk without a buffer");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes: bytes.length, sha256, animations: namedArray(json, "animations"), materials: namedArray(json, "materials"), size: boundsFromGlb(json, bin), json };
}

async function collectionEntity(contentRoot: string, collection: string, entityId: string): Promise<{ spec: ContentCollection; row: Record<string, unknown> }> {
  const spec = CONTENT_COLLECTIONS.find(candidate => candidate.name === collection);
  if (!spec) throw new AssetsActionError(404, "Unknown target collection");
  if (!safeEntityId(entityId)) throw new AssetsActionError(400, "Invalid entityId");
  const file = relativeSafe(contentRoot, spec.file);
  let raw: unknown;
  try { raw = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AssetsActionError(404, "Unknown target entity"); throw error; }
  const data = parseContentCollection(spec, raw);
  if (spec.shape === "object") {
    if (entityId === "$collection") return { spec, row: data as Record<string, unknown> };
    if (isObject(data) && Object.hasOwn(data, entityId) && isObject(data[entityId])) return { spec, row: data[entityId] as Record<string, unknown> };
    throw new AssetsActionError(404, "Unknown target entity");
  }
  if (!Array.isArray(data)) throw new AssetsActionError(500, "Target collection is malformed");
  const row = data.find(value => isObject(value) && String(value[spec.idKey]) === entityId);
  if (!row || !isObject(row)) throw new AssetsActionError(404, "Unknown target entity");
  return { spec, row };
}

function candidateForHash(record: MetaRecord, collection: string, entityId: string, slot: string | undefined, body: string | undefined, sha256: string): MetaCandidate | undefined {
  return record.candidates.find(candidate => candidate.kind === "glb" && candidate.sha256 === sha256 && candidate.slot === slot && candidate.body === body)
    ?? record.candidates.find(candidate => candidate.candidateId === candidateIdFor(collection, entityId, slot, body, sha256));
}

async function writeExclusive(file: string, bytes: Uint8Array): Promise<boolean> {
  await mkdir(path.dirname(file), { recursive: true });
  try {
    const handle = await open(file, "wx");
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return false;
  }
}

async function candidateFile(root: string, candidate: MetaCandidate): Promise<string> {
  return safeWritablePath(root, candidateRelativePath(candidate));
}

function targetAssetId(location: CandidateLocation, row: Record<string, unknown> | undefined): string | undefined {
  const direct = row && typeof row.assetId === "string" ? row.assetId : undefined;
  if (direct) return direct;
  const members = row && isObject(row.members) ? row.members : undefined;
  if (location.collection === "equipmentSets" && location.candidate.slot && members) {
    const itemId = members[location.candidate.slot];
    if (typeof itemId === "string") {
     return `corealm_item_${itemId}`;
  }
}
 if (location.collection === "items") {
    return `corealm_item_${location.entityId}`;
 }
  return undefined;
}

function readAssetString(value: unknown, field: string, fallback: string, max = 240): string {
  if (value === undefined || value === null || value === "") return fallback;
  return nonblank(value, field, max);
}

function assetTags(value: unknown, fallback: string[]): string[] {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value) || value.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 80)) throw new AssetsActionError(400, "asset.tags must be a list of short strings");
  return [...new Set(value.map(tag => (tag as string).trim()))];
}

function assetCategory(value: unknown, fallback: AssetCategory): AssetCategory {
  const category = value === undefined || value === null || value === "" ? fallback : value;
  if (typeof category !== "string" || !(ASSET_CATEGORIES as readonly string[]).includes(category)) throw new AssetsActionError(400, "asset.category is not supported");
  return category as AssetCategory;
}

function pathForPromotion(value: unknown, fallback: string): string {
  const file = readAssetString(value, "asset.file", fallback, 300).replace(/\\/g, "/");
  if (!file.startsWith(MODELS_PREFIX) || !file.toLowerCase().endsWith(".glb") || file.split("/").some(segment => !/^[A-Za-z0-9._-]+$/.test(segment) || segment === "." || segment === "..")) throw new AssetsActionError(400, "asset.file must be an allowlisted models/*.glb path");
  return file;
}

function packIdFrom(value: unknown, fallback: string): string {
  const id = readAssetString(value, "pack.id", fallback, 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) throw new AssetsActionError(400, "pack.id contains unsupported characters");
  return id;
}

function packFrom(existing: AssetPack | undefined, candidate: MetaCandidate, supplied: Record<string, unknown> | undefined, packId: string, actor: string): AssetPack {
  const source = supplied ?? {};
  return {
    ...(existing ?? {}),
    id: packId,
    name: readAssetString(source.name, "pack.name", existing?.name ?? "User upload"),
    author: readAssetString(source.author, "pack.author", existing?.author ?? candidate.provenance?.author ?? actor),
    source: readAssetString(source.source, "pack.source", existing?.source ?? candidate.provenance?.source ?? "Local DevDocs upload", 1024),
    license: readAssetString(source.license, "pack.license", existing?.license ?? candidate.provenance?.license ?? "User supplied", 1024),
    ...(typeof source.archiveSha256 === "string" ? { archiveSha256: source.archiveSha256 } : {}),
    ...(typeof source.generatorSha256 === "string" ? { generatorSha256: source.generatorSha256 } : {}),
  };
}

function defaultPromotionCategory(location: CandidateLocation, row: Record<string, unknown>): AssetCategory {
  if (location.collection === "items") {
    const equip = isObject(row.equip) ? row.equip : undefined;
    const slot = equip && typeof equip.slot === "string" ? equip.slot : undefined;
    if (slot === "mainHand" || slot === "offHand") return "weapon";
    if (slot) return "outfit";
    return "prop";
  }
  if (location.collection === "equipmentSets" || row.members) return "outfit";
  if (row.assetId) return "character";
  return "prop";
}

function promotedEntry(location: CandidateLocation, manifest: AssetManifest, input: ActionInput, row: Record<string, unknown>, actor: string): { entry: AssetEntry & { sha256?: string; provenance?: Record<string, string> }; pack: AssetPack; assetId: string; file: string } {
  const candidate = location.candidate;
  const source = input.asset ?? {};
  const existingId = input.assetId ?? (typeof source.id === "string" ? source.id : undefined) ?? candidate.manifestId ?? targetAssetId(location, row);
  const assetId = readAssetString(existingId, "assetId", candidate.candidateId, 180);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(assetId)) throw new AssetsActionError(400, "assetId contains unsupported characters");
  const existing = manifest.assets.find(asset => asset.id === assetId);
  const defaultCategory = defaultPromotionCategory(location, row);
  const category = assetCategory(source.category, existing?.category ?? defaultCategory);
  const file = pathForPromotion(source.file, existing?.file ?? `${MODELS_PREFIX}${category}/${slug(assetId)}.glb`);
  const packId = packIdFrom(source.pack ?? candidate.provenance?.pack, existing?.pack ?? `user-upload-${candidate.sha256.slice(0, 12)}`);
  const packInput = input.pack ?? (isObject(source.packMetadata) ? source.packMetadata : undefined);
  const pack = packFrom(manifest.packs.find(entry => entry.id === packId), candidate, packInput, packId, actor);
  const tags = assetTags(source.tags, ["devdocs-candidate", category]);
  const size = candidate.size ?? existing?.size ?? { x: 0, y: 0, z: 0 };
  const entry: AssetEntry & { sha256?: string; provenance?: Record<string, string> } = {
    ...(existing ?? {}),
    id: assetId,
    file,
    pack: pack.id,
    category,
    is: readAssetString(source.is, "asset.is", existing?.is ?? category, 120),
    tags,
    bytes: candidate.bytes,
    size,
    animations: [...(candidate.animations ?? existing?.animations ?? [])],
    materials: [...(candidate.materials ?? existing?.materials ?? [])],
    sha256: candidate.sha256,
    ...(candidate.provenance ? { provenance: { ...candidate.provenance } } : {}),
  };
  if (isObject(source.itemModel)) entry.itemModel = source.itemModel as AssetEntry["itemModel"];
  if (isObject(source.base)) {
    const base = source.base;
    if (["x", "y", "z"].every(key => typeof base[key] === "number" && Number.isFinite(base[key]))) entry.base = { x: base.x as number, y: base.y as number, z: base.z as number };
  }
  if (typeof source.groundY === "number" && Number.isFinite(source.groundY)) entry.groundY = source.groundY;
  return { entry, pack, assetId, file };
}

async function archivePrevious(repositoryRoot: string, assetId: string, file: string, previous: Buffer): Promise<AssetPreviousFile> {
  const sha256 = createHash("sha256").update(previous).digest("hex");
  const archiveFile = `art/candidates/previous/${slug(assetId)}/${sha256}.glb`;
  const archivePath = await safeWritablePath(repositoryRoot, archiveFile);
  const created = await writeExclusive(archivePath, previous);
  if (!created) {
    const archived = await readFile(archivePath);
    if (createHash("sha256").update(archived).digest("hex") !== sha256 || archived.length !== previous.length) {
      throw new AssetsActionError(409, "Previous asset archive already contains different bytes");
    }
  }
  return { assetId, file, sha256, bytes: previous.length, archiveFile };
}

async function rollbackFile(file: string, previous: Buffer | undefined): Promise<void> {
  if (previous) { await atomicReplaceFile(file, previous); return; }
  try { await unlink(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

async function promote(
  location: CandidateLocation,
  input: ActionInput,
  contentRoot: string,
  repositoryRoot: string,
  publicRoot: string,
  actor: string,
  now: string,
): Promise<AssetsHandlerResponse> {
  const target = await collectionEntity(contentRoot, location.collection, location.entityId);
  const manifestPath = await safeWritablePath(publicRoot, "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  if (input.manifestRevision && contentRevision(manifestText) !== input.manifestRevision) return failure(409, "Asset manifest changed since it was read. Reload before promoting.", { revision: contentRevision(manifestText) });
  let manifest: AssetManifest;
  try { manifest = JSON.parse(manifestText) as AssetManifest; }
  catch { throw new AssetsActionError(500, "Asset manifest is malformed"); }
  if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.packs)) throw new AssetsActionError(500, "Asset manifest is malformed");
  const candidatePath = await candidateFile(repositoryRoot, location.candidate);
  const bytes = await readFile(candidatePath);
  if (bytes.length !== location.candidate.bytes || createHash("sha256").update(bytes).digest("hex") !== location.candidate.sha256) throw new AssetsActionError(409, "Candidate bytes changed since upload; review it again");
  const planned = promotedEntry(location, manifest, input, target.row, actor);
  const destination = await safeWritablePath(publicRoot, planned.file);
  const prior = manifest.assets.find(entry => entry.file === planned.file && entry.id !== planned.assetId);
  if (prior) throw new AssetsActionError(409, `Asset destination is already owned by ${prior.id}`);
  const oldEntry = manifest.assets.find(entry => entry.id === planned.assetId);
  let previousBytes: Buffer | undefined;
  try { previousBytes = await readFile(destination); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (previousBytes && !oldEntry) throw new AssetsActionError(409, "Asset destination already contains an unmanaged file");
  const previousAsset = previousBytes && oldEntry && createHash("sha256").update(previousBytes).digest("hex") !== location.candidate.sha256
    ? await archivePrevious(repositoryRoot, planned.assetId, oldEntry.file, previousBytes) : undefined;
  const updatedManifest: AssetManifest = {
    ...manifest,
    assets: [...manifest.assets],
    packs: [...manifest.packs],
    generatedAt: now,
  };
  const index = updatedManifest.assets.findIndex(entry => entry.id === planned.assetId);
  if (index < 0) updatedManifest.assets.push(planned.entry);
  else updatedManifest.assets[index] = planned.entry;
  const packIndex = updatedManifest.packs.findIndex(pack => pack.id === planned.pack.id);
  if (packIndex < 0) updatedManifest.packs.push(planned.pack);
  else updatedManifest.packs[packIndex] = planned.pack;
  const nextManifestText = formatContentJson(updatedManifest);
  let destinationChanged = false;
  let manifestChanged = false;
  try {
    await mkdir(path.dirname(destination), { recursive: true });
    await atomicReplaceFile(destination, bytes);
    destinationChanged = true;
    await atomicReplaceFile(manifestPath, nextManifestText);
    manifestChanged = true;
    const metadata = await readMetadata(contentRoot, location.collection);
    if (metadata.revision !== input.revision) throw new AssetsActionError(409, "Metadata changed since it was read. Reload before promoting.");
    const record = metadata.records[location.entityId];
    if (!record) throw new AssetsActionError(404, "Candidate target metadata is missing");
    const candidate = record.candidates.find(entry => entry.candidateId === location.candidate.candidateId);
    if (!candidate || candidate.status !== "approved") throw new AssetsActionError(409, "Candidate must remain approved before promotion");
    candidate.status = "live";
    candidate.promotedAt = now;
    candidate.manifestId = planned.assetId;
    record.status = "live";
    record.history.push({ at: now, by: actor, action: "candidate.promote", detail: planned.assetId });
    const written = await writeMetadata(metadata.file, metadata.records);
    const fresh: CandidateLocation = { ...location, records: metadata.records, record, candidate, revision: written.revision, text: written.text, index: record.candidates.indexOf(candidate) };
    return json(200, { candidate: candidateView(fresh), collection: location.collection, entityId: location.entityId, revision: written.revision, asset: planned.entry, ...(previousAsset ? { previousAsset } : {}) } satisfies AssetActionResponse);
  } catch (error) {
    try {
      if (manifestChanged) await atomicReplaceFile(manifestPath, manifestText);
      if (destinationChanged) await rollbackFile(destination, previousBytes);
    } catch (rollbackError) {
      throw new AssetsActionError(500, `Promotion failed and rollback was incomplete: ${rollbackError instanceof Error ? rollbackError.message : "unknown rollback error"}`);
    }
    throw error;
  }
}

export function createAssetsHandler(options: AssetsHandlerOptions = {}): AssetsHandler {
  const contentRoot = path.resolve(options.contentRoot ?? path.join(defaultRepoRoot, "game", "content"));
  const repositoryRoot = path.resolve(options.repoRoot ?? (options.contentRoot ? path.join(contentRoot, "..", "..") : defaultRepoRoot));
  const publicRoot = path.resolve(options.publicAssetRoot ?? path.join(repositoryRoot, "game", "public", "assets"));
  const candidateRoot = repositoryRoot;
  const actor = options.actor ?? "user";
  const now = options.now ?? (() => new Date().toISOString());
  const maxUploadBytes = options.maxUploadBytes ?? ASSET_UPLOAD_MAX_BYTES;
  if (!actor.trim()) throw new Error("Asset actor must not be blank");
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0 || maxUploadBytes > ASSET_UPLOAD_MAX_BYTES) throw new Error("Invalid asset upload limit");

  return async request => {
    const parsed = parseUrl(request.url);
    const selected = route(request.url);
    if (!selected) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return failure(403, "Dev docs API accepts loopback requests only");
    if (!parsed || selected.kind === "malformed") return failure(400, "Malformed assets URL");
    const method = (request.method ?? "GET").toUpperCase();
    if (selected.kind === "candidates") {
      if (method !== "GET") return failure(405, "Method not allowed", { Allow: "GET" });
      try {
        const locations = filterCandidates(await findCandidates(contentRoot), queryValues(request.url));
        return json(200, { candidates: locations.map(candidateView) } satisfies AssetCandidatesResponse);
      } catch (error) { if (error instanceof AssetsActionError) return failure(error.status, error.message); throw error; }
    }
    if (selected.kind === "file") {
      if (method !== "GET") return failure(405, "Method not allowed", { Allow: "GET" });
      try {
        const locations = (await findCandidates(contentRoot)).filter(location => location.candidate.candidateId === selected.candidateId);
        if (!locations.length) return failure(404, "Unknown candidate");
        if (locations.length > 1) return failure(409, "Candidate id is ambiguous");
        const file = await candidateFile(candidateRoot, locations[0]!.candidate);
       const bytes = await readFile(file);
       if (bytes.length !== locations[0]!.candidate.bytes || createHash("sha256").update(bytes).digest("hex") !== locations[0]!.candidate.sha256) return failure(409, "Candidate file no longer matches its metadata");
        return { status: 200, headers: { "Content-Type": locations[0]!.candidate.kind === "icon" ? "image/png" : "model/gltf-binary", "Cache-Control": "no-store" }, body: bytes };
      } catch (error) { if (error instanceof AssetsActionError) return failure(error.status, error.message); if ((error as NodeJS.ErrnoException).code === "ENOENT") return failure(404, "Candidate file unavailable"); throw error; }
    }
    if (selected.kind === "upload") {
      if (method !== "PUT" && method !== "POST") return failure(405, "Method not allowed", { Allow: "PUT, POST" });
      try {
        const upload = parseUpload(request.body, maxUploadBytes);
        const inspection = inspectGlb(upload.bytes, maxUploadBytes);
        const target = await collectionEntity(contentRoot, upload.collection, upload.entityId);
        return await withFileLock(path.join(repositoryRoot, ASSETS_LOCK_NAME), async () => {
          const metadata = await readMetadata(contentRoot, upload.collection);
          if (metadata.revision !== upload.revision) return failure(409, "Metadata changed since it was read. Reload before uploading.", { revision: metadata.revision });
          const record = ownRecord(metadata.records, upload.entityId);
          const existing = candidateForHash(record, upload.collection, upload.entityId, upload.slot, upload.body, inspection.sha256);
          if (existing) {
            const location: CandidateLocation = { collection: upload.collection, entityId: upload.entityId, file: metadata.file, text: metadata.text, revision: metadata.revision, records: metadata.records, record, candidate: existing, index: record.candidates.indexOf(existing) };
            return json(200, { candidate: candidateView(location), collection: upload.collection, entityId: upload.entityId, revision: metadata.revision } satisfies AssetActionResponse);
          }
          const candidateId = candidateIdFor(upload.collection, upload.entityId, upload.slot, upload.body, inspection.sha256);
          const relative = `${CANDIDATE_PREFIX}${slug(upload.collection.replace("/", "-"), "content")}/${slug(upload.entityId, "record")}/${candidateId}.glb`;
          const file = await safeWritablePath(candidateRoot, relative);
          const created = await writeExclusive(file, upload.bytes);
          if (!created) {
            const previous = await readFile(file);
            if (previous.length !== upload.bytes.length || createHash("sha256").update(previous).digest("hex") !== inspection.sha256) throw new AssetsActionError(409, "Candidate path already contains different bytes");
          }
          const candidate: MetaCandidate = {
            candidateId, kind: CANDIDATE_KINDS[0], sha256: inspection.sha256, file: relative, bytes: inspection.bytes,
            ...(inspection.size ? { size: inspection.size } : {}), animations: inspection.animations, materials: inspection.materials,
            status: "candidate", uploadedAt: now(), uploadedBy: actor,
            ...(upload.slot ? { slot: upload.slot } : {}), ...(upload.body ? { body: upload.body } : {}), ...(upload.provenance ? { provenance: upload.provenance } : {}),
          };
          record.candidates.push(candidate);
          if (record.status === "draft") record.status = "candidate";
          record.history.push({ at: candidate.uploadedAt, by: actor, action: "candidate.upload", detail: candidateId });
          const written = await writeMetadata(metadata.file, metadata.records);
          const location: CandidateLocation = { collection: upload.collection, entityId: upload.entityId, file: metadata.file, text: written.text, revision: written.revision, records: metadata.records, record, candidate, index: record.candidates.length - 1 };
          return json(201, { candidate: candidateView(location), collection: upload.collection, entityId: upload.entityId, revision: written.revision } satisfies AssetActionResponse);
        });
      } catch (error) { if (error instanceof AssetsActionError) return failure(error.status, error.message); throw error; }
    }
    if (selected.kind === "action") {
      if (method !== "POST") return failure(405, "Method not allowed", { Allow: "POST" });
      try {
        const actionInput = parseAction(request.body, selected.action);
        return await withFileLock(path.join(repositoryRoot, ASSETS_LOCK_NAME), async () => {
          const locations = (await findCandidates(contentRoot)).filter(location => location.candidate.candidateId === selected.candidateId);
          if (!locations.length) return failure(404, "Unknown candidate");
          if (locations.length > 1) return failure(409, "Candidate id is ambiguous");
          const location = locations[0]!;
          const metadata = await readMetadata(contentRoot, location.collection);
          if (metadata.revision !== actionInput.revision) return failure(409, "Metadata changed since it was read. Reload before reviewing.", { revision: metadata.revision });
          const record = metadata.records[location.entityId];
          if (!record) return failure(404, "Candidate target metadata is missing");
          const candidate = record.candidates.find(entry => entry.candidateId === selected.candidateId);
          if (!candidate) return failure(404, "Unknown candidate");
          const at = now();
          if (selected.action === "approve") {
            if (candidate.status === "live") return failure(409, "A live candidate cannot be approved again");
            if (candidate.status === "rejected") return failure(409, "A rejected candidate must be uploaded again before approval");
            const setApproval = location.collection === "equipmentSets" && candidate.kind === "glb";
            let pendingApproval = false;
            if (setApproval) {
              const approvals = { ...(candidate.approvals ?? {}), ...(actionInput.approvals ?? {}) };
              const requestedBody = actionInput.body ?? candidate.body;
              if (requestedBody === "male" || requestedBody === "female") approvals[requestedBody] = true;
              if (!approvals.male || !approvals.female) {
                if (!approvals.male && !approvals.female) return failure(422, "Set candidates need male and female sign-off before approval");
                pendingApproval = true;
              }
              candidate.approvals = approvals;
              record.approvals = { ...(record.approvals ?? {}), ...approvals };
              if (!pendingApproval) { candidate.status = "approved"; candidate.approvedAt = at; record.status = "approved"; }
            } else {
              candidate.status = "approved";
              candidate.approvedAt = at;
              if (record.status === "draft" || record.status === "candidate") record.status = "approved";
            }
            record.history.push({ at, by: actor, action: pendingApproval ? "candidate.signoff" : "candidate.approve", detail: candidate.candidateId });
            const written = await writeMetadata(metadata.file, metadata.records);
            const fresh: CandidateLocation = { ...location, records: metadata.records, text: written.text, revision: written.revision, record, candidate, index: record.candidates.indexOf(candidate) };
            return json(200, { candidate: candidateView(fresh), collection: location.collection, entityId: location.entityId, revision: written.revision, ...(pendingApproval ? { pendingApproval: true } : {}) } satisfies AssetActionResponse);
          }
          if (selected.action === "reject") {
            if (candidate.status === "live") return failure(409, "A live candidate cannot be rejected");
            candidate.status = "rejected";
            candidate.reasons = [...(candidate.reasons ?? []), actionInput.reason!];
            record.history.push({ at, by: actor, action: "candidate.reject", detail: candidate.candidateId });
            if (record.status !== "live") record.status = "rejected";
            const written = await writeMetadata(metadata.file, metadata.records);
            const fresh: CandidateLocation = { ...location, records: metadata.records, text: written.text, revision: written.revision, record, candidate, index: record.candidates.indexOf(candidate) };
            return json(200, { candidate: candidateView(fresh), collection: location.collection, entityId: location.entityId, revision: written.revision } satisfies AssetActionResponse);
          }
         if (candidate.status === "live") return failure(409, "Candidate is already live");
          if (candidate.kind !== "glb") return failure(409, "Only GLB candidates can be promoted by this workflow");
         if (candidate.status !== "approved") return failure(409, "Only an approved candidate can be promoted");
         return await withFileLock(await safeWritablePath(publicRoot, "manifest.json"), () => promote(location, actionInput, contentRoot, repositoryRoot, publicRoot, actor, at));
        });
      } catch (error) { if (error instanceof AssetsActionError) return failure(error.status, error.message); if ((error as NodeJS.ErrnoException).code === "ENOENT") return failure(404, "Candidate or asset file unavailable"); throw error; }
    }
    return failure(400, "Malformed assets URL");
  };
}

export function assetsHandler(request: AssetsHandlerRequest, options: AssetsHandlerOptions = {}): Promise<AssetsHandlerResponse | undefined> {
  return createAssetsHandler(options)(request);
}

export { inspectGlb };
