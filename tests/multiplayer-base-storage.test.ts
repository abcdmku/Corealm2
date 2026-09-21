import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";

/**
 * Schema 3 to 4: base markers on every stored catalog and every move, and the base sources table.
 * The database is written by hand in the schema 3 layout, so the test does not depend on any code
 * that still knows how to write it.
 */
const SCHEMA_3_CATALOG = `
CREATE TABLE catalogs (revision TEXT PRIMARY KEY, formula_revision TEXT NOT NULL, server TEXT NOT NULL, client TEXT NOT NULL,
  sources TEXT NOT NULL, stored_by TEXT NOT NULL, stored_at INTEGER NOT NULL, note TEXT) STRICT;
CREATE TABLE catalog_active (id INTEGER PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL REFERENCES catalogs(revision)) STRICT;
CREATE TABLE catalog_history (id INTEGER PRIMARY KEY AUTOINCREMENT, revision TEXT NOT NULL REFERENCES catalogs(revision),
  previous TEXT, activated_by TEXT NOT NULL, activated_at INTEGER NOT NULL) STRICT;`;
const SEED = "a".repeat(64), EDIT = "b".repeat(64), F = "f".repeat(64);
const files: string[] = [];
afterEach(async () => { for (const file of files.splice(0)) for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true }); });

/** A schema 3 database: seeded with SEED, then an admin published EDIT. */
function schema3(): string {
  const file = join(tmpdir(), `corealm-base-migration-${randomUUID()}.sqlite`); files.push(file);
  new SqliteWorldStorage(file, { log: () => {} }).close();
  const db = new DatabaseSync(file);
  db.exec("DROP TABLE catalog_history; DROP TABLE catalog_active; DROP TABLE catalogs; DROP TABLE catalog_bases;");
  db.exec(SCHEMA_3_CATALOG);
  const put = db.prepare("INSERT INTO catalogs (revision,formula_revision,server,client,sources,stored_by,stored_at,note) VALUES (?,?,?,?,?,?,?,?)");
  put.run(SEED, F, "{}", "{}", '{"items":[{"id":"seeded"}]}', "seed", 1000, "Seeded from the catalog shipped with the server");
  put.run(EDIT, F, "{}", "{}", '{"items":[{"id":"edited"}]}', "acc_admin", 2000, null);
  db.exec(`INSERT INTO catalog_active (id,revision) VALUES (1,'${EDIT}');
    INSERT INTO catalog_history (revision,previous,activated_by,activated_at) VALUES ('${SEED}',NULL,'seed',1000), ('${EDIT}','${SEED}','acc_admin',2000);
    UPDATE meta SET value='3' WHERE key='schema_version';`);
  db.close();
  return file;
}

describe("moving a schema 3 database to base markers", () => {
  it("takes the first history entry as the base, with the bundled version when the bundled base seeded it", async () => {
    const file = schema3(), lines: string[] = [];
    const storage = new SqliteWorldStorage(file, { log: line => lines.push(line), bundledBase: { version: "0.1.0", revision: SEED } });
    expect(lines.map(line => JSON.parse(line))).toEqual([{ event: "storage-migrated", from: 3, to: 4, baseRevision: SEED, baseVersion: "0.1.0", bundledRevision: SEED,
      message: "Every stored catalog now derives from base 0.1.0, the base this server ships with, which seeded this database." }]);
    const marker = { version: "0.1.0", revision: SEED };
    expect(await storage.catalog.activeBase()).toEqual(marker);
    expect((await storage.catalog.revisionInfo(SEED))!.base).toEqual(marker);
    expect((await storage.catalog.history(5)).map(move => move.base)).toEqual([marker, marker]);
    expect(await storage.catalog.baseSources(SEED)).toBe('{"items":[{"id":"seeded"}]}');
    expect({ ...storage.database.prepare("SELECT value FROM meta WHERE key='schema_version'").get() }).toEqual({ value: "4" });
    await storage.close();
    // Once only: opening it again migrates nothing and says nothing.
    const again: string[] = [];
    const reopened = new SqliteWorldStorage(file, { log: line => again.push(line), bundledBase: { version: "9.9.9", revision: SEED } });
    expect([again, await reopened.catalog.activeBase()]).toEqual([[], marker]);
    await reopened.close();
  });

  it("records 0.0.0 when the database was seeded from another base than the one this server ships", async () => {
    const file = schema3(), lines: string[] = [];
    const storage = new SqliteWorldStorage(file, { log: line => lines.push(line), bundledBase: { version: "0.2.0", revision: "c".repeat(64) } });
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "storage-migrated", from: 3, to: 4, baseRevision: SEED, baseVersion: "0.0.0",
      message: "Every stored catalog now derives from the catalog that seeded this database. Its base version was never recorded, so it is 0.0.0." });
    expect(await storage.catalog.activeBase()).toEqual({ version: "0.0.0", revision: SEED });
    await storage.close();
  });

  it("leaves a database with no catalog to its first seed", async () => {
    const file = join(tmpdir(), `corealm-base-migration-${randomUUID()}.sqlite`); files.push(file);
    new SqliteWorldStorage(file, { log: () => {} }).close();
    const db = new DatabaseSync(file);
    db.exec("DROP TABLE catalog_history; DROP TABLE catalog_active; DROP TABLE catalogs; DROP TABLE catalog_bases;"); db.exec(SCHEMA_3_CATALOG);
    db.exec("UPDATE meta SET value='3' WHERE key='schema_version'"); db.close();
    const lines: string[] = [];
    const storage = new SqliteWorldStorage(file, { log: line => lines.push(line) });
    expect([lines, await storage.catalog.activeBase()]).toEqual([[], null]);
    await storage.close();
  });
});
