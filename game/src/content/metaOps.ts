/**
 * Authoring metadata beside the content, as data and pure operations: status, notes, requests,
 * approvals, set pieces, candidates, history and art verdicts.
 *
 * Two stores hold it. The repository keeps one JSON file per collection in the checkout
 * (the repository meta tools); a live server keeps the same keyed record per collection in its own
 * database (`multiplayer/adminMeta.ts`). Both apply an operation through `applyMetaOperation`, so a
 * note, a request or a verdict means the same thing on either. No Node built-ins: the admin route,
 * the Vite middleware and tests share this module, and no game client module imports it.
 */
import { arr, bool, discriminated, enumOf, int, num, obj, opt, parseValue, rec, refine, str, unknown as unknownSchema, type Infer, type ParseContext } from "./schema/core.js";
import { CONTENT_COLLECTIONS, type ContentCollection } from "./compiler/collections.js";
import { formatContentJson } from "./compiler/canonical.js";

export const META_STATUSES = ["draft", "candidate", "approved", "live", "rejected"] as const;
export type MetaStatus = (typeof META_STATUSES)[number];

export const REQUEST_KINDS = ["art", "balance", "placement", "audio", "text"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_STATES = ["open", "claimed", "replied", "closed"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export const CANDIDATE_KINDS = ["glb", "icon"] as const;

/** An art reviewer's verdict on a model, a state it plays, a body it is worn on, or a variant. */
export const ART_VERDICTS = ["approved", "polish", "replace"] as const;
export type ArtVerdict = (typeof ART_VERDICTS)[number];

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
  /**
   * Art review: a verdict for the whole record plus per-aspect checks keyed `<kind>:<name>`, such as
   * `state:death`, `pose:mine`, `body:female`, `slot:head` or `variant:<creatureId>`.
   */
  art: opt(obj({
    verdict: opt(enumOf(ART_VERDICTS)),
    note: opt(str({}, { multiline: true })),
    at: opt(Timestamp),
    by: opt(Author),
    checks: opt(rec(obj({ verdict: opt(enumOf(ART_VERDICTS)), note: opt(str({}, { multiline: true })) }))),
  })),
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

/** Appends a history entry and returns the same record for chaining. */
export function recordHistory(record: MetaRecord, entry: MetaHistory): MetaRecord {
  record.history.push(entry);
  return record;
}

/** A collection's records validated and keyed in id order, so a write changes only the edited record's text. */
export function canonicalMetaFile(records: MetaFile, collection: string): MetaFile {
  const validated = parseValue(MetaFileSchema, records, `${collection}.meta`);
  const ordered: MetaFile = {};
  for (const key of Object.keys(validated).sort()) {
    Object.defineProperty(ordered, key, { value: validated[key], enumerable: true, writable: true, configurable: true });
  }
  return ordered;
}

/** The stored text of a collection's metadata. Its sha256 is the revision a patch names. */
export function metaText(records: MetaFile, collection: string): string {
  return formatContentJson(canonicalMetaFile(records, collection));
}

// ---- Requests: notes that carry a request block ----------------------------------------------

export interface RequestEntry {
  entityId: string;
  note: Omit<MetaNote, "request">;
  request: MetaRequest;
}
export interface CollectionRequestEntry extends RequestEntry { collection: string }
/** The request queue across collections: each collection's revision and its matching requests. */
export interface RequestsReport { revisions: Record<string, string>; requests: CollectionRequestEntry[] }

function nonempty(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} must not be blank`);
}

function validateAction(actor: string, at: string): void {
  nonempty(actor, "actor");
  if (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) {
    throw new Error("at must be an ISO timestamp, such as 2026-09-13T12:00:00.000Z");
  }
}

function entries(records: MetaFile): RequestEntry[] {
  const result: RequestEntry[] = [];
  const seen = new Set<string>();
  for (const [entityId, record] of Object.entries(records)) {
    for (const { request, ...note } of record.notes) {
      if (!request) continue;
      if (seen.has(request.id)) throw new Error(`Duplicate request id: ${request.id}`);
      seen.add(request.id);
      result.push({ entityId, note, request });
    }
  }
  return result;
}

function copy(records: MetaFile): MetaFile {
  const parsed = parseValue(MetaFileSchema, records, "requests.meta");
  entries(parsed);
  return parsed;
}

export function listRequests(records: MetaFile, options: { states?: readonly RequestState[] } = {}): RequestEntry[] {
  const states = options.states ?? ["open", "claimed"];
  return entries(copy(records)).filter(({ request }) => states.includes(request.state));
}

/** The open and claimed requests of every collection given, in the order given. */
export function requestsReport(collections: readonly { collection: string; records: MetaFile; revision: string }[]): RequestsReport {
  const report: RequestsReport = { revisions: {}, requests: [] };
  for (const { collection, records, revision } of collections) {
    report.revisions[collection] = revision;
    report.requests.push(...listRequests(records).map((entry): CollectionRequestEntry => ({ collection, ...entry })));
  }
  return report;
}

export interface OpenRequestInput {
  entityId: string;
  requestId: string;
  kind: RequestKind;
  text: string;
  actor: string;
  at: string;
  label?: string;
}

/** The caller must initialize metadata for a valid content entity before opening its first request. */
export function openRequest(records: MetaFile, input: OpenRequestInput): MetaFile {
  validateAction(input.actor, input.at);
  nonempty(input.requestId, "requestId");
  nonempty(input.text, "text");
  const next = copy(records);
  if (!Object.hasOwn(next, input.entityId)) throw new Error(`Unknown entity: ${input.entityId}`);
  if (entries(next).some(({ request }) => request.id === input.requestId)) throw new Error(`Duplicate request id: ${input.requestId}`);
  const record = next[input.entityId]!;
  record.notes.push({
    at: input.at, by: input.actor, text: input.text,
    ...(input.label === undefined ? {} : { label: input.label }),
    request: { id: input.requestId, kind: input.kind, state: "open" },
  });
  record.history.push({ at: input.at, by: input.actor, action: "request.open", detail: input.requestId });
  return copy(next);
}

export interface RequestActionInput { requestId: string; actor: string; at: string }

function target(records: MetaFile, requestId: string): RequestEntry {
  const entry = entries(records).find(({ request }) => request.id === requestId);
  if (!entry) throw new Error(`Unknown request: ${requestId}`);
  return entry;
}

export function claimRequest(records: MetaFile, input: RequestActionInput): MetaFile {
  validateAction(input.actor, input.at);
  const next = copy(records);
  const entry = target(next, input.requestId);
  const request = entry.request;
  if (request.state === "claimed" && request.claimedBy === input.actor) return next;
  if (request.state !== "open") throw new Error(`Request ${request.id} is ${request.state}${request.claimedBy ? ` by ${request.claimedBy}` : ""}`);
  request.state = "claimed";
  request.claimedBy = input.actor;
  request.claimedAt = input.at;
  next[entry.entityId]!.history.push({ at: input.at, by: input.actor, action: "request.claim", detail: input.requestId });
  return next;
}

export function replyToRequest(records: MetaFile, input: RequestActionInput & { text: string }): MetaFile {
  validateAction(input.actor, input.at);
  nonempty(input.text, "text");
  const next = copy(records);
  const entry = target(next, input.requestId);
  const request = entry.request;
  if (request.state !== "claimed" || request.claimedBy !== input.actor) {
    throw new Error(`Only the current claimer may reply to claimed request ${request.id}`);
  }
  request.state = "replied";
  request.reply = input.text;
  request.repliedAt = input.at;
  next[entry.entityId]!.history.push({
    at: input.at, by: input.actor, action: "request.reply", detail: JSON.stringify({ requestId: input.requestId, text: input.text }),
  });
  return next;
}

// ---- Human metadata operations: what `PATCH meta/<collection>/<id>` takes ------------------------

const nonblank = refine(str({ nonEmpty: true }), value => value.trim().length > 0, "must not be blank");
const authoringStatus = enumOf(["draft", "candidate", "rejected"] as const);
const operationSchema = discriminated("kind", {
  status: obj({ kind: enumOf(["status"] as const), status: authoringStatus }),
  note: obj({ kind: enumOf(["note"] as const), text: nonblank, label: opt(str()) }),
  "request.open": obj({ kind: enumOf(["request.open"] as const), requestId: nonblank, requestKind: enumOf(REQUEST_KINDS), text: nonblank, label: opt(str()) }),
  "request.close": obj({ kind: enumOf(["request.close"] as const), requestId: nonblank }),
  piece: refine(obj({ kind: enumOf(["piece"] as const), slot: enumOf(["head", "body", "legs", "hands", "feet"] as const), note: opt(str()), status: opt(authoringStatus) }),
    value => value.note !== undefined || value.status !== undefined, "piece requires note or status"),
  // `verdict: "clear"` removes a verdict; an absent verdict leaves it. `key` absent targets the record.
  art: refine(obj({ kind: enumOf(["art"] as const), key: opt(str({ pattern: /^[a-z]+:[A-Za-z0-9_.-]+$/ })), verdict: opt(enumOf([...ART_VERDICTS, "clear"] as const)), note: opt(str()) }),
    value => value.note !== undefined || value.verdict !== undefined, "art requires verdict or note"),
});
const patchSchema = obj({ revision: str({ pattern: /^[a-f0-9]{64}$/ }), operation: operationSchema });
export type MetaPatch = Infer<typeof patchSchema>;
export type MetaOperation = MetaPatch["operation"];

export interface MetaResponse { collection: string; entityId: string; revision: string; data: MetaRecord }
export interface MetaDigestEntry { status: MetaRecord["status"]; openRequests: number; notes: number; candidates: number; art?: ArtVerdict; artChecks?: Record<string, ArtVerdict> }
export interface MetaDigestResponse { collection: string; revision: string; records: Record<string, MetaDigestEntry> }

/** What both stores answer a stale revision with; the browser matches on it where no status survives. */
export const META_CONFLICT_MESSAGE = "Metadata changed since it was read. Reload before saving.";

/** A patch body, or the schema issues that reject it. */
export function parseMetaPatch(body: unknown): { patch: MetaPatch } | { issues: ParseContext["issues"] } {
  const ctx: ParseContext = { issues: [] };
  const patch = patchSchema.parse(body, "patch", ctx);
  return ctx.issues.length ? { issues: ctx.issues } : { patch };
}

/** Assets and generated tables have no authored collection file, but their records still take notes. */
const ASSETS_COLLECTION: ContentCollection = { name: "assets", file: "", schema: unknownSchema(), shape: "array", idKey: "id" };

/**
 * The collection a metadata path names, or undefined. The authored and resolved inspection pages share
 * one record, so `compiled-items` is `items`.
 */
export function metaCollection(name: string): ContentCollection | undefined {
  const collection = name.startsWith("compiled-") ? name.slice("compiled-".length) : name;
  return CONTENT_COLLECTIONS.find(row => row.name === collection) ?? (collection === "assets" ? ASSETS_COLLECTION : undefined);
}

/** The per-collection badge digest: status, open requests, counts and verdicts, without notes or history. */
export function metaDigest(records: MetaFile): Record<string, MetaDigestEntry> {
  return Object.fromEntries(Object.entries(records).map(([id, record]) => [id, {
    status: record.status,
    openRequests: record.notes.filter(note => note.request && note.request.state !== "closed").length,
    notes: record.notes.length,
    candidates: (record.candidates ?? []).filter(candidate => candidate.status === "candidate" || candidate.status === "draft").length,
    ...(record.art?.verdict ? { art: record.art.verdict } : {}),
    ...(record.art?.checks ? { artChecks: Object.fromEntries(Object.entries(record.art.checks).flatMap(([key, check]) => check.verdict ? [[key, check.verdict]] : [])) } : {}),
  } satisfies MetaDigestEntry]));
}

/** A refused operation and the HTTP status it answers with. */
export class MetaActionError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "MetaActionError"; }
}

function ownRecord(records: MetaFile, entityId: string): MetaRecord {
  if (!Object.hasOwn(records, entityId)) {
    Object.defineProperty(records, entityId, { value: emptyMetaRecord(), enumerable: true, writable: true, configurable: true });
  }
  return records[entityId]!;
}

/**
 * Applies one human operation to `records` in place and returns the records to store. `authored` is the
 * content record, read for set pieces only (`members`). Throws `MetaActionError` for a refusal.
 * Asset approvals and candidate promotion use their own review route.
 */
export function applyMetaOperation(records: MetaFile, collection: string, entityId: string, authored: Record<string, unknown> | undefined,
  operation: MetaOperation, actor: string, at: string): MetaFile {
  const record = ownRecord(records, entityId);
  if (operation.kind === "request.open") {
    try {
      return openRequest(records, { entityId, requestId: operation.requestId, kind: operation.requestKind,
        text: operation.text, actor, at, ...(operation.label === undefined ? {} : { label: operation.label }) });
    } catch (error) { throw new MetaActionError(400, error instanceof Error ? error.message : "Unable to open request"); }
  }
  if (operation.kind === "note") {
    record.notes.push({ at, by: actor, text: operation.text, ...(operation.label === undefined ? {} : { label: operation.label }) });
    record.history.push({ at, by: actor, action: "note.add" });
  } else if (operation.kind === "status") {
    record.status = operation.status;
    record.history.push({ at, by: actor, action: "status.set", detail: operation.status });
  } else if (operation.kind === "request.close") {
    const requests = record.notes.filter(note => note.request?.id === operation.requestId);
    if (requests.length === 0) throw new MetaActionError(404, "Unknown request for this entity");
    if (requests.length !== 1) throw new MetaActionError(400, "Duplicate request id");
    const request = requests[0]!.request!;
    if (request.state !== "closed") {
      request.state = "closed";
      request.closedAt = at;
      record.history.push({ at, by: actor, action: "request.close", detail: operation.requestId });
    }
  } else if (operation.kind === "art") {
    const art = record.art ??= {};
    const target = operation.key === undefined ? art : ((art.checks ??= {})[operation.key] ??= {});
    if (operation.verdict === "clear") delete target.verdict;
    else if (operation.verdict !== undefined) target.verdict = operation.verdict;
    if (operation.note !== undefined) { if (operation.note.trim()) target.note = operation.note; else delete target.note; }
    if (operation.key !== undefined && !target.verdict && !target.note) delete art.checks![operation.key];
    art.at = at; art.by = actor;
    if (!art.verdict && !art.note && !Object.keys(art.checks ?? {}).length) delete record.art;
    record.history.push({ at, by: actor, action: "art.review", detail: `${operation.key ?? "record"}${operation.verdict ? ` ${operation.verdict}` : ""}` });
  } else {
    if (collection !== "equipmentSets") throw new MetaActionError(400, "Piece notes are available only for equipment sets");
    const members = authored?.members;
    if (!members || typeof members !== "object" || !Object.hasOwn(members, operation.slot)) throw new MetaActionError(400, "Piece is not a member of this set");
    record.pieces ??= {};
    const current = record.pieces[operation.slot] ?? {};
    record.pieces[operation.slot] = { ...current,
      ...(operation.note === undefined ? {} : { note: operation.note }),
      ...(operation.status === undefined ? {} : { status: operation.status }) };
    record.history.push({ at, by: actor, action: "piece.update", detail: operation.slot });
  }
  return records;
}
