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
import { parseValue } from "../../game/src/content/schema/core.js";
import { canonicalMetaFile, MetaFileSchema, type MetaFile } from "../../game/src/content/metaOps.js";
import { contentMetaRoot, contentPath, contentRevision, writeContentJson } from "./format.js";
import { withFileLock } from "./locks.js";

// The records and their operations are shared with a live server's store and have no Node in them.
export {
  META_STATUSES, REQUEST_KINDS, REQUEST_STATES, CANDIDATE_KINDS, ART_VERDICTS,
  RequestSchema, NoteSchema, CandidateSchema, HistorySchema, MetaRecordSchema, MetaFileSchema,
  emptyMetaRecord, recordHistory,
  type MetaStatus, type RequestKind, type RequestState, type ArtVerdict,
  type MetaRequest, type MetaNote, type MetaCandidate, type MetaHistory, type MetaRecord, type MetaFile,
} from "../../game/src/content/metaOps.js";

export function metaFileName(collection: string): string {
  if (/^balance\/[a-z][a-z0-9-]*$/i.test(collection)) return `meta/${collection.replace("/", "--")}.meta.json`;
  if (!/^[a-z][a-z0-9-]*$/i.test(collection)) throw new Error(`Invalid meta collection name: ${collection}`);
  return `meta/${collection}.meta.json`;
}

export function metaCollectionName(fileName: string): string | undefined {
  if (!/^[a-z][a-z0-9-]*\.meta\.json$/i.test(fileName)) return undefined;
  return fileName.slice(0, -".meta.json".length).replace(/^balance--/, "balance/");
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
  const canonical = canonicalMetaFile(records, collection);
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
    return names.map(metaCollectionName).filter((name): name is string => name !== undefined).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
