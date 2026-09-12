/** Disposable generated data. Player saves use a separate store and never enter this cache. */
export interface GenerationCachePort {
  get<T>(key: string, valid: (value: unknown) => value is T): Promise<T | null>;
  put(key: string, data: unknown): Promise<boolean>;
}

const DATABASE = "corealm-generated-world";
const STORE = "artifacts";
const MAX_ENTRIES = 256;
const TIMEOUT_MS = 1500;
type Entry = { revision: string; data: unknown; writtenAt: number };

export class GenerationCache implements GenerationCachePort {
  private database: Promise<IDBDatabase | null> | null = null;
  private counts = { hits: 0, misses: 0, writes: 0, failures: 0, hitsByKind: {} as Record<string, number> };

  constructor(readonly revision: string, readonly scope: string) {}

  snapshot() { return { revision: this.revision, scope: this.scope, ...this.counts, hitsByKind: { ...this.counts.hitsByKind } }; }

  private open(): Promise<IDBDatabase | null> {
    return this.database ??= new Promise(resolve => {
      let completed = false;
      const finish = (db: IDBDatabase | null) => {
        if (completed) { db?.close(); return; }
        completed = true; clearTimeout(timer); resolve(db);
      };
      const timer = setTimeout(() => finish(null), TIMEOUT_MS);
      try {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore(STORE);
          store.createIndex("writtenAt", "writtenAt");
        };
        request.onerror = request.onblocked = () => finish(null);
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); this.database = null; };
          finish(db);
        };
      } catch { finish(null); }
    });
  }

  private async transaction<T>(mode: IDBTransactionMode, fallback: T,
    run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    const db = await this.open();
    if (!db) { this.counts.failures++; return fallback; }
    return new Promise(resolve => {
      let value = fallback, completed = false, transaction: IDBTransaction | undefined;
      const finish = (ok: boolean) => {
        if (completed) return;
        completed = true; clearTimeout(timer);
        if (!ok) this.counts.failures++;
        resolve(ok ? value : fallback);
      };
      const timer = setTimeout(() => { try { transaction?.abort(); } catch {} finish(false); }, TIMEOUT_MS);
      try {
        transaction = db.transaction(STORE, mode);
        transaction.oncomplete = () => finish(true);
        transaction.onerror = transaction.onabort = () => finish(false);
        run(transaction.objectStore(STORE), result => { value = result; });
      } catch { finish(false); }
    });
  }

  async get<T>(key: string, valid: (value: unknown) => value is T): Promise<T | null> {
    const entry = await this.transaction<Entry | null>("readonly", null, (store, result) => {
      const request = store.get(`${this.scope}/${key}`);
      request.onsuccess = () => result(request.result ?? null);
    });
    if (entry?.revision === this.revision) {
      try {
        if (valid(entry.data)) {
          this.counts.hits++;
          const kind = key.split("/")[0]!;
          this.counts.hitsByKind[kind] = (this.counts.hitsByKind[kind] ?? 0) + 1;
          return entry.data;
        }
      } catch { /* A malformed derived record is a cache miss. */ }
    }
    this.counts.misses++;
    return null;
  }

  async put(key: string, data: unknown): Promise<boolean> {
    const written = await this.transaction("readwrite", false, (store, result) => {
      store.put({ revision: this.revision, data, writtenAt: Date.now() } satisfies Entry, `${this.scope}/${key}`);
      const count = store.count();
      count.onsuccess = () => {
        let remaining = count.result - MAX_ENTRIES;
        if (remaining <= 0) return;
        const oldest = store.index("writtenAt").openCursor();
        oldest.onsuccess = () => {
          const cursor = oldest.result;
          if (!cursor || remaining-- <= 0) return;
          cursor.delete(); cursor.continue();
        };
      };
      result(true);
    });
    if (written) this.counts.writes++;
    return written;
  }
}
