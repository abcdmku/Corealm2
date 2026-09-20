import type { DatabaseSync } from "node:sqlite";
import { CATALOG_REVISION } from "../content/clientCatalog.js";
import type { AdminActor, AuditWrite, AuditWriter } from "./adminStorage.js";

/**
 * Published catalogs by revision, the pointer to the active one, and every move of that pointer.
 *
 * A server's content is its own copy of the source collections. It starts as a copy of the catalog
 * the server shipped with and diverges with each publish, so there is no overlay to merge: `sources`
 * of the active revision is the whole truth, and `server` and `client` are what it compiled to.
 *
 * Asynchronous, and every value is a JSON string or plain data, because the database moves to its
 * own thread later and training runs use disposable stores. Nothing here may hold a live object.
 * This module loads no content table, so a host can open it before it installs a catalog.
 */
export type CatalogKind = "server" | "client";
export interface CatalogWrite {
  revision: string;
  /** The formula code the catalog was compiled with. A deploy that changes it makes stored catalogs stale. */
  formulaRevision: string;
  /** JSON text. `client` is stored as the exact bytes `GET /catalog/<revision>` serves. */
  server: string; client: string; sources: string;
  by: string; at: number; note: string | null;
}
export interface CatalogRevisionInfo { revision: string; formulaRevision: string; storedBy: string; storedAt: number; note: string | null }
export interface CatalogActivation { id: number; revision: string; previous: string | null; by: string; at: number }
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
   * Moves the pointer and records the move. The revision must be stored. Activating the active revision is a no-op that returns the last move.
   * `audit` is written with the move or not at all, so the log never names a publish that did not happen.
   */
  activate(revision: string, by: string, at: number, audit?: { by: AdminActor; entry: AuditWrite }): Promise<CatalogActivation>;
  /** Pointer moves, newest first. */
  history(limit: number): Promise<CatalogActivation[]>;
}

export const CATALOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS catalogs (revision TEXT PRIMARY KEY, formula_revision TEXT NOT NULL, server TEXT NOT NULL, client TEXT NOT NULL,
  sources TEXT NOT NULL, stored_by TEXT NOT NULL, stored_at INTEGER NOT NULL, note TEXT) STRICT;
CREATE TABLE IF NOT EXISTS catalog_active (id INTEGER PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL REFERENCES catalogs(revision)) STRICT;
CREATE TABLE IF NOT EXISTS catalog_history (id INTEGER PRIMARY KEY AUTOINCREMENT, revision TEXT NOT NULL REFERENCES catalogs(revision),
  previous TEXT, activated_by TEXT NOT NULL, activated_at INTEGER NOT NULL) STRICT;`;

function checked(write: CatalogWrite): void {
  if (!CATALOG_REVISION.test(write.revision) || !CATALOG_REVISION.test(write.formulaRevision)) throw new Error("A catalog revision is a sha256 hex digest");
}

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
    const row = this.db.prepare("SELECT formula_revision, stored_by, stored_at, note FROM catalogs WHERE revision=?").get(revision);
    return row ? { revision, formulaRevision: String(row.formula_revision), storedBy: String(row.stored_by), storedAt: Number(row.stored_at), note: row.note === null ? null : String(row.note) } : null;
  }
  async store(write: CatalogWrite): Promise<boolean> {
    checked(write);
    return this.db.prepare(`INSERT INTO catalogs (revision,formula_revision,server,client,sources,stored_by,stored_at,note) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(revision) DO NOTHING`).run(write.revision, write.formulaRevision, write.server, write.client, write.sources, write.by, write.at, write.note).changes > 0;
  }
  async activate(revision: string, by: string, at: number, audit?: { by: AdminActor; entry: AuditWrite }): Promise<CatalogActivation> {
    if (audit && !this.audit) throw new Error("This catalog store was opened without an audit log");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.db.prepare("SELECT 1 FROM catalogs WHERE revision=?").get(revision)) throw new Error(`Catalog revision ${revision} is not stored`);
      const previous = this.active();
      if (previous !== revision) {
        this.db.prepare("INSERT INTO catalog_active (id,revision) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision").run(revision);
        this.db.prepare("INSERT INTO catalog_history (revision,previous,activated_by,activated_at) VALUES (?,?,?,?)").run(revision, previous, by, at);
        if (audit) this.audit!(audit.by, audit.entry);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return (await this.history(1))[0]!;
  }
  async history(limit: number): Promise<CatalogActivation[]> {
    return this.db.prepare("SELECT id, revision, previous, activated_by, activated_at FROM catalog_history ORDER BY id DESC LIMIT ?").all(limit)
      .map(row => ({ id: Number(row.id), revision: String(row.revision), previous: row.previous === null ? null : String(row.previous), by: String(row.activated_by), at: Number(row.activated_at) }));
  }
}

/** The same rules over maps, for tests, embedders that keep nothing, and disposable training stores. */
export class MemoryCatalogStorage implements CatalogStorage {
  private readonly rows = new Map<string, CatalogWrite>();
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
    return row ? { revision, formulaRevision: row.formulaRevision, storedBy: row.by, storedAt: row.at, note: row.note } : null;
  }
  async store(write: CatalogWrite): Promise<boolean> {
    checked(write);
    if (this.rows.has(write.revision)) return false;
    this.rows.set(write.revision, { ...write }); return true;
  }
  async activate(revision: string, by: string, at: number, audit?: { by: AdminActor; entry: AuditWrite }): Promise<CatalogActivation> {
    if (!this.rows.has(revision)) throw new Error(`Catalog revision ${revision} is not stored`);
    if (audit && !this.audit) throw new Error("This catalog store was opened without an audit log");
    if (this.active !== revision) { this.moves.push({ id: this.moves.length + 1, revision, previous: this.active, by, at }); this.active = revision; if (audit) this.audit!(audit.by, audit.entry); }
    return { ...this.moves.at(-1)! };
  }
  async history(limit: number): Promise<CatalogActivation[]> { return this.moves.slice(-limit).reverse().map(move => ({ ...move })); }
}
