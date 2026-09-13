/**
 * Dev-only metadata beside the shipped content: status, notes, requests, asset candidates, history.
 *
 * Lives under `game/content/meta/<collection>.meta.json`, keyed by record id. Nothing under
 * `game/src` may import it (`tests/content-meta-isolation.test.ts`), and it is excluded from the
 * world revision hash, so approving an asset or leaving a note never invalidates a baked world.
 *
 * The schema is authored with the same combinators as the shipped tables so the dev docs app can
 * build its note and request forms from it.
 */
import { mkdir, readdir, readFile } from "node:fs/promises";
import { arr, bool, enumOf, int, num, obj, opt, parseValue, rec, str, type Infer } from "../../game/src/content/schema/core.js";
import { contentMetaRoot, contentPath, contentRevision, writeContentJson } from "./format.js";
import { withFileLock } from "./locks.js";

export const META_STATUSES = ["draft", "candidate", "approved", "live", "rejected"] as const;
export type MetaStatus = (typeof META_STATUSES)[number];

export const REQUEST_KINDS = ["art", "balance", "placement", "audio", "text"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_STATES = ["open", "claimed", "replied", "closed"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export const CANDIDATE_KINDS = ["glb", "icon"] as const;

const Timestamp = str({ pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/ }, { label: "At", help: "ISO-8601 timestamp.", readOnly: true });
const Author = str({ nonEmpty: true }, { label: "By", readOnly: true });

export const RequestSchema = obj({
  id: str({ nonEmpty: true }, { readOnly: true }),
  kind: enumOf(REQUEST_KINDS, { label: "Kind" }),
  state: enumOf(REQUEST_STATES, { label: "State" }),
  claimedBy: opt(str({ nonEmpty: true }), { label: "Claimed by" }),
  claimedAt: opt(Timestamp),
  reply: opt(str({}, { multiline: true, label: "Reply" })),
  repliedAt: opt(Timestamp),
  closedAt: opt(Timestamp),
});

export const NoteSchema = obj({
  at: Timestamp,
  by: Author,
  text: str({}, { multiline: true, label: "Note" }),
  label: opt(str({}, { label: "Label" })),
  request: opt(RequestSchema),
});

export const CandidateSchema = obj({
  candidateId: str({ nonEmpty: true }, { readOnly: true }),
  kind: enumOf(CANDIDATE_KINDS),
  sha256: str({ pattern: /^[a-f0-9]{64}$/ }, { readOnly: true }),
  /** Repo-relative path under `art/candidates/`. */
  file: str({ nonEmpty: true }, { readOnly: true }),
  bytes: int({ min: 0 }, { readOnly: true }),
  /** Bounding-box size in metres, `[x, y, z]`. */
  size: opt(obj({ x: num(), y: num(), z: num() })),
  animations: opt(arr(str())),
  materials: opt(arr(str())),
  status: enumOf(META_STATUSES),
  reasons: opt(arr(str())),
  uploadedAt: Timestamp,
  uploadedBy: opt(Author),
  approvedAt: opt(Timestamp),
  promotedAt: opt(Timestamp),
  /** Manifest asset id once promoted. */
  manifestId: opt(str()),
  /** Equipment slot or attachment slot the candidate targets. */
  slot: opt(str()),
  body: opt(enumOf(["male", "female", "creature"] as const)),
  /** Per-body sign-off for skinned armour candidates. */
  approvals: opt(obj({ male: opt(bool()), female: opt(bool()) })),
  provenance: opt(obj({
    pack: opt(str()),
    author: opt(str()),
    license: opt(str()),
    source: opt(str()),
    prompt: opt(str({}, { multiline: true })),
  })),
});

export const HistorySchema = obj({
  at: Timestamp,
  by: Author,
  action: str({ nonEmpty: true }),
  detail: opt(str()),
});

export const MetaRecordSchema = obj({
  status: enumOf(META_STATUSES, { label: "Status" }),
  notes: arr(NoteSchema),
  /** Sets only: per-body sign-off gate before approve. */
  approvals: opt(obj({ male: opt(bool()), female: opt(bool()) })),
  /** Sets only: per-piece notes keyed by armour slot. */
  pieces: opt(rec(obj({ note: opt(str({}, { multiline: true })), status: opt(enumOf(META_STATUSES)) }))),
  candidates: arr(CandidateSchema),
  history: arr(HistorySchema),
  /** Where the status came from when seeded (`manifest.acceptance`, `icon-registry`, ...). */
  sourceRefs: arr(str()),
  /** Icon-specific provenance for items. */
  icon: opt(obj({
    status: opt(enumOf(META_STATUSES)),
    prompt: opt(str({}, { multiline: true })),
    sha256: opt(str()),
    generatedAt: opt(Timestamp),
    approvedAt: opt(Timestamp),
  })),
});

export type MetaRequest = Infer<typeof RequestSchema>;
export type MetaNote = Infer<typeof NoteSchema>;
export type MetaCandidate = Infer<typeof CandidateSchema>;
export type MetaHistory = Infer<typeof HistorySchema>;
export type MetaRecord = Infer<typeof MetaRecordSchema>;

export const MetaFileSchema = rec(MetaRecordSchema);
export type MetaFile = Record<string, MetaRecord>;

export function emptyMetaRecord(status: MetaStatus = "draft"): MetaRecord {
  return { status, notes: [], candidates: [], history: [], sourceRefs: [] };
}

export function metaFileName(collection: string): string {
  if (!/^[a-z][a-z0-9-]*$/i.test(collection)) throw new Error(`Invalid meta collection name: ${collection}`);
  return `meta/${collection}.meta.json`;
}

export async function readMeta(collection: string): Promise<MetaFile> {
  let text: string;
  try { text = await readFile(contentPath(metaFileName(collection)), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return parseValue(MetaFileSchema, JSON.parse(text), `${collection}.meta`);
}

/** Writes the whole keyed file with ids sorted so diffs stay local to the edited record. */
async function writeMetaUnlocked(collection: string, records: MetaFile): Promise<boolean> {
  const validated = parseValue(MetaFileSchema, records, `${collection}.meta`);
  const ordered: MetaFile = {};
  for (const key of Object.keys(validated).sort()) {
    Object.defineProperty(ordered, key, { value: validated[key], enumerable: true, writable: true, configurable: true });
  }
  const canonical = parseValue(MetaFileSchema, ordered, `${collection}.meta`);
  await mkdir(contentMetaRoot, { recursive: true });
  return writeContentJson(metaFileName(collection), canonical);
}

export async function writeMeta(collection: string, records: MetaFile): Promise<boolean> {
  return withFileLock(contentPath(metaFileName(collection)), () => writeMetaUnlocked(collection, records));
}

export interface MetaSnapshot { records: MetaFile; revision: string }

export async function readMetaSnapshot(collection: string): Promise<MetaSnapshot> {
  let text = "{}\n";
  try { text = await readFile(contentPath(metaFileName(collection)), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { records: parseValue(MetaFileSchema, JSON.parse(text), `${collection}.meta`), revision: contentRevision(text) };
}

export class MetaRevisionConflict extends Error {
  readonly status = 409;
  constructor() { super("Metadata changed since it was read. Reload before saving."); }
}

export async function withMetaUpdate(collection: string, expectedRevision: string, update: (records: MetaFile) => MetaFile | Promise<MetaFile>): Promise<MetaSnapshot> {
  return withFileLock(contentPath(metaFileName(collection)), async () => {
    const current = await readMetaSnapshot(collection);
    if (current.revision !== expectedRevision) throw new MetaRevisionConflict();
    await writeMetaUnlocked(collection, await update(current.records));
    return readMetaSnapshot(collection);
  });
}

export async function listMetaCollections(): Promise<string[]> {
  try {
    const names = await readdir(contentMetaRoot);
    return names.filter((name) => name.endsWith(".meta.json")).map((name) => name.slice(0, -".meta.json".length)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Appends a history entry and returns the same record for chaining. */
export function recordHistory(record: MetaRecord, entry: MetaHistory): MetaRecord {
  record.history.push(entry);
  return record;
}
