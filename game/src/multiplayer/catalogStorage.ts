import type { DatabaseSync } from "node:sqlite";
import { CATALOG_REVISION } from "../content/clientCatalog.js";
import type { AdminActor, AuditWrite, AuditWriter } from "./adminStorage.js";
import { isSemver } from "./semver.js";

/**
 * Published catalogs by revision, the pointer to the active one, and every move of that pointer.
 *
 * A server's content is its own copy of the source collections. It starts as a copy of the catalog
 * the server shipped with and diverges with each publish, so there is no overlay to merge: `sources`
 * of the active revision is the whole truth, and `server` and `client` are what it compiled to.
 *
 * Every revision also records the base game it derives from (`BaseMarker`), and the source
 * collections of each base the server took are kept once per base revision. Those are what an
 * update from a newer base merges against: see `content/compiler/baseMerge.ts`.
 *
 * Asynchronous, and every value is a JSON string or plain data, because the database moves to its
 * own thread later and training runs use disposable stores. Nothing here may hold a live object.
 * This module loads no content table, so a host can open it before it installs a catalog.
 */
export type CatalogKind = "server" | "client";
/**
 * The base game a catalog derives from: the base version (semver, `package.json`'s `version` when
 * that base was built) and the revision of the base's compiled catalog. A seed sets it, a publish
 * inherits it from the revision it was made from, a base update sets a new one, and a rollback
 * restores what the target revision recorded. `0.0.0` is a version nobody knew: a database from
 * before base versions whose seed was not the base this server shipped with.
 */
export interface BaseMarker { version: string; revision: string }
export const UNKNOWN_BASE_VERSION = "0.0.0";
export interface CatalogWrite {
  revision: string;
  /** The formula code the catalog was compiled with. A deploy that changes it makes stored catalogs stale. */
  formulaRevision: string;
  /** JSON text. `client` is stored as the exact bytes `GET /catalog/<revision>` serves. */
  server: string; client: string; sources: string;
  by: string; at: number; note: string | null;
  /** The base this revision derives from, as first stored. `activate` with a marker replaces it. */
  base: BaseMarker;
}
/** The source collections of a base the server took, kept once per base revision. */
export interface BaseWrite { revision: string; version: string; sources: string; at: number }
export interface CatalogRevisionInfo { revision: string; formulaRevision: string; storedBy: string; storedAt: number; note: string | null; base: BaseMarker }
/** One move of the pointer. `base` is the base in force after it. */
export interface CatalogActivation { id: number; revision: string; previous: string | null; by: string; at: number; base: BaseMarker }
export interface CatalogStorage {
  activeRevision(): Promise<string | null>;
  /** JSON text of one output of a stored revision. */
  catalog(revision: string, kind: CatalogKind): Promise<string | null>;
  /** JSON text of the source collections a revision was compiled from. Omit the revision for the active one. */
  sources(revision?: string): Promise<{ revision: string; sources: string } | null>;
  revisionInfo(revision: string): Promise<CatalogRevisionInfo | null>;
  /** Idempotent on `revision`: a revision is a content hash, so a second store changes nothing. True when the row is new. */
  store(write: CatalogWrite): Promise<boolean>;
  /**
   * Moves the pointer and records the move. The revision must be stored. Activating the active
   * revision is a no-op that returns the last move, unless `base` differs from the base that
   * revision records: the base then moves, and that is recorded as a move of its own.
   * `base`, when given, becomes the revision's recorded base in the same transaction.
   * `audit` is written with the move or not at all, so the log never names a publish that did not happen.
   */
  activate(revision: string, by: string, at: number, audit?: { by: AdminActor; entry: AuditWrite }, base?: BaseMarker): Promise<CatalogActivation>;
  /** Pointer moves, newest first. */
  history(limit: number): Promise<CatalogActivation[]>;
  /** The base the active revision derives from. Null before the first seed. */
  activeBase(): Promise<BaseMarker | null>;
  /** Idempotent on `revision`. True when the row is new. */
  storeBase(write: BaseWrite): Promise<boolean>;
  /** JSON text of the source collections of a base this server took, or null. */
  baseSources(revision: string): Promise<string | null>;
}

export const CATALOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS catalogs (revision TEXT PRIMARY KEY, formula_revision TEXT NOT NULL, server TEXT NOT NULL, client TEXT NOT NULL,
  sources TEXT NOT NULL, stored_by TEXT NOT NULL, stored_at INTEGER NOT NULL, note TEXT,
  base_version TEXT NOT NULL DEFAULT '0.0.0', base_revision TEXT NOT NULL DEFAULT '') STRICT;
CREATE TABLE IF NOT EXISTS catalog_active (id INTEGER PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL REFERENCES catalogs(revision)) STRICT;
CREATE TABLE IF NOT EXISTS catalog_history (id INTEGER PRIMARY KEY AUTOINCREMENT, revision TEXT NOT NULL REFERENCES catalogs(revision),
  previous TEXT, activated_by TEXT NOT NULL, activated_at INTEGER NOT NULL,
  base_version TEXT NOT NULL DEFAULT '0.0.0', base_revision TEXT NOT NULL DEFAULT '') STRICT;
CREATE TABLE IF NOT EXISTS catalog_bases (revision TEXT PRIMARY KEY, version TEXT NOT NULL, sources TEXT NOT NULL, stored_at INTEGER NOT NULL) STRICT;`;

/**
 * Schema 3 to 4, inside the caller's transaction: base markers on every catalog and every move, and
 * the base sources table. The first history entry is the seed, so its sources become the recorded
 * base and its revision the base revision. Its version is the bundled base's when that seed is the
 * bundled base, and `0.0.0` otherwise, because nothing recorded which release seeded it.
 * Returns the fields of the one log line, or null when the database held no catalog.
 */
export function migrateCatalogBases(db: DatabaseSync, bundled: BaseMarker | null): Record<string, unknown> | null {
  const columns = (table: string) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name)));
  for (const table of ["catalogs", "catalog_history"]) {
    const has = columns(table);
    if (!has.has("base_version")) db.exec(`ALTER TABLE ${table} ADD COLUMN base_version TEXT NOT NULL DEFAULT '0.0.0'`);
    if (!has.has("base_revision")) db.exec(`ALTER TABLE ${table} ADD COLUMN base_revision TEXT NOT NULL DEFAULT ''`);
  }
  const seed = db.prepare("SELECT h.revision, c.sources, c.stored_at FROM catalog_history h JOIN catalogs c ON c.revision = h.revision ORDER BY h.id LIMIT 1").get();
  if (!seed) return null;
  const revision = String(seed.revision), known = bundled !== null && bundled.revision === revision;
  const version = known ? bundled.version : UNKNOWN_BASE_VERSION;
  db.prepare("INSERT INTO catalog_bases (revision, version, sources, stored_at) VALUES (?,?,?,?) ON CONFLICT(revision) DO NOTHING").run(revision, version, String(seed.sources), Number(seed.stored_at));
  db.prepare("UPDATE catalogs SET base_version=?, base_revision=?").run(version, revision);
  db.prepare("UPDATE catalog_history SET base_version=?, base_revision=?").run(version, revision);
  return { baseRevision: revision, baseVersion: version, bundledRevision: bundled?.revision ?? null,
    message: known ? `Every stored catalog now derives from base ${version}, the base this server ships with, which seeded this database.`
      : `Every stored catalog now derives from the catalog that seeded this database. Its base version was never recorded, so it is ${UNKNOWN_BASE_VERSION}.` };
}

function checked(write: CatalogWrite): void {
  if (!CATALOG_REVISION.test(write.revision) || !CATALOG_REVISION.test(write.formulaRevision)) throw new Error("A catalog revision is a sha256 hex digest");
  marker(write.base);
}
function marker(base: BaseMarker): void {
  if (!isSemver(base.version) || !CATALOG_REVISION.test(base.revision)) throw new Error("A base is a semver version and a catalog revision");
}
const markerOf = (row: Record<string, unknown>): BaseMarker => ({ version: String(row.base_version), revision: String(row.base_revision) });
const activationOf = (row: Record<string, unknown>): CatalogActivation => ({ id: Number(row.id), revision: String(row.revision),
  previous: row.previous === null ? null : String(row.previous), by: String(row.activated_by), at: Number(row.activated_at), base: markerOf(row) });

/** On the one connection `SqliteWorldStorage` owns: the database is locked exclusively, so nothing else may open it. */
export class SqliteCatalogStorage implements CatalogStorage {
  constructor(private readonly db: DatabaseSync, private readonly audit?: AuditWriter) {}
  private active(): string | null {
    const row = this.db.prepare("SELECT revision FROM catalog_active WHERE id=1").get();
    return row ? String(row.revision) : null;
  }
  async activeRevision(): Promise<string | null> { return this.active(); }
  async catalog(revision: string, kind: CatalogKind): Promise<string | null> {
    const row = this.db.prepare(`SELECT ${kind === "server" ? "server" : "client"} AS body FROM catalogs WHERE revision=?`).get(revision);
    return row ? String(row.body) : null;
  }
  async sources(revision?: string): Promise<{ revision: string; sources: string } | null> {
    const wanted = revision ?? this.active(); if (wanted === null) return null;
    const row = this.db.prepare("SELECT sources FROM catalogs WHERE revision=?").get(wanted);
    return row ? { revision: wanted, sources: String(row.sources) } : null;
  }
  async revisionInfo(revision: string): Promise<CatalogRevisionInfo | null> {
    const row = this.db.prepare("SELECT formula_revision, stored_by, stored_at, note, base_version, base_revision FROM catalogs WHERE revision=?").get(revision);
    return row ? { revision, formulaRevision: String(row.formula_revision), storedBy: String(row.stored_by), storedAt: Number(row.stored_at), note: row.note === null ? null : String(row.note), base: markerOf(row) } : null;
  }
  async store(write: CatalogWrite): Promise<boolean> {
    checked(write);
    return this.db.prepare(`INSERT INTO catalogs (revision,formula_revision,server,client,sources,stored_by,stored_at,note,base_version,base_revision) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(revision) DO NOTHING`).run(write.revision, write.formulaRevision, write.server, write.client, write.sources, write.by, write.at, write.note,
      write.base.version, write.base.revision).changes > 0;
  }
  async activate(revision: string, by: string, at: number, audit?: { by: AdminActor; entry: AuditWrite }, base?: BaseMarker): Promise<CatalogActivation> {
    if (audit && !this.audit) throw new Error("This catalog store was opened without an audit log");
    if (base) marker(base);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT base_version, base_revision FROM catalogs WHERE revision=?").get(revision);
      if (!row) throw new Error(`Catalog revision ${revision} is not stored`);
      const previous = this.active(), recorded = markerOf(row);
      const rebased = base !== undefined && (base.version !== recorded.version || base.revision !== recorded.revision);
      if (rebased) this.db.prepare("UPDATE catalogs SET base_version=?, base_revision=? WHERE revision=?").run(base.version, base.revision, revision);
      if (previous !== revision || rebased) {
        const now = rebased ? base : recorded;
        this.db.prepare("INSERT INTO catalog_active (id,revision) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision").run(revision);
        this.db.prepare("INSERT INTO catalog_history (revision,previous,activated_by,activated_at,base_version,base_revision) VALUES (?,?,?,?,?,?)").run(revision, previous, by, at, now.version, now.revision);
        if (audit) this.audit!(audit.by, audit.entry);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return (await this.history(1))[0]!;
  }
  async history(limit: number): Promise<CatalogActivation[]> {
    return this.db.prepare("SELECT id, revision, previous, activated_by, activated_at, base_version, base_revision FROM catalog_history ORDER BY id DESC LIMIT ?").all(limit).map(activationOf);
  }
  async activeBase(): Promise<BaseMarker | null> {
    const row = this.db.prepare("SELECT c.base_version, c.base_revision FROM catalog_active a JOIN catalogs c ON c.revision = a.revision WHERE a.id=1").get();
    return row ? markerOf(row) : null;
  }
  async storeBase(write: BaseWrite): Promise<boolean> {
    marker(write);
    return this.db.prepare("INSERT INTO catalog_bases (revision, version, sources, stored_at) VALUES (?,?,?,?) ON CONFLICT(revision) DO NOTHING")
      .run(write.revision, write.version, write.sources, write.at).changes > 0;
  }
  async baseSources(revision: string): Promise<string | null> {
    const row = this.db.prepare("SELECT sources FROM catalog_bases WHERE revision=?").get(revision);
    return row ? String(row.sources) : null;
  }
}

/** The same rules over maps, for tests, embedders that keep nothing, and disposable training stores. */
export class MemoryCatalogStorage implements CatalogStorage {
  private readonly rows = new Map<string, CatalogWrite>();
  private readonly bases = new Map<string, BaseWrite>();
  private readonly moves: CatalogActivation[] = [];
  private active: string | null = null;
  constructor(private readonly audit?: AuditWriter) {}
  async activeRevision(): Promise<string | null> { return this.active; }
  async catalog(revision: string, kind: CatalogKind): Promise<string | null> { return this.rows.get(revision)?.[kind] ?? null; }
  async sources(revision?: string): Promise<{ revision: string; sources: string } | null> {
    const wanted = revision ?? this.active, row = wanted === null ? undefined : this.rows.get(wanted);
    return row ? { revision: row.revision, sources: row.sources } : null;
  }
  async revisionInfo(revision: string): Promise<CatalogRevisionInfo | null> {
    const row = this.rows.get(revision);
    return row ? { revision, formulaRevision: row.formulaRevision, storedBy: row.by, storedAt: row.at, note: row.note, base: { ...row.base } } : null;
  }
  async store(write: CatalogWrite): Promise<boolean> {
    checked(write);
    if (this.rows.has(write.revision)) return false;
    this.rows.set(write.revision, { ...write, base: { ...write.base } }); return true;
  }
  async activate(revision: string, by: string, at: number, audit?: { by: AdminActor; entry: AuditWrite }, base?: BaseMarker): Promise<CatalogActivation> {
    const row = this.rows.get(revision);
    if (!row) throw new Error(`Catalog revision ${revision} is not stored`);
    if (audit && !this.audit) throw new Error("This catalog store was opened without an audit log");
    if (base) marker(base);
    const rebased = base !== undefined && (base.version !== row.base.version || base.revision !== row.base.revision);
    if (this.active !== revision || rebased) {
      if (rebased) row.base = { ...base };
      this.moves.push({ id: this.moves.length + 1, revision, previous: this.active, by, at, base: { ...row.base } }); this.active = revision;
      if (audit) this.audit!(audit.by, audit.entry);
    }
    return { ...this.moves.at(-1)!, base: { ...this.moves.at(-1)!.base } };
  }
  async history(limit: number): Promise<CatalogActivation[]> { return this.moves.slice(-limit).reverse().map(move => ({ ...move, base: { ...move.base } })); }
  async activeBase(): Promise<BaseMarker | null> { return this.active === null ? null : { ...this.rows.get(this.active)!.base }; }
  async storeBase(write: BaseWrite): Promise<boolean> {
    marker(write);
    if (this.bases.has(write.revision)) return false;
    this.bases.set(write.revision, { ...write }); return true;
  }
  async baseSources(revision: string): Promise<string | null> { return this.bases.get(revision)?.sources ?? null; }
}
