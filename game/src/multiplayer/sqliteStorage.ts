import { DatabaseSync } from "node:sqlite";
import type { StoredWorldPlayer, WorldKey, WorldStorage, WorldStorageRecord } from "../contracts.js";
import { worldKey } from "./protocol.js";

/** One host owns a database. State and receipts share the same SQLite transaction. */
export class SqliteWorldStorage implements WorldStorage {
  readonly entityPatches = true;
  private readonly db: DatabaseSync;
  private closed = false;
  private readonly cachedChunks = new Map<string, Map<string, string>>();
  private readonly receiptTails = new Map<string, Map<string, WorldStorageRecord["receipts"][string][number] | undefined>>();
  private readonly receiptHeads = new Map<string,Map<string,number>>();
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    try {
      // SQLite owns the OS lock, so a crashed process cannot leave a stale lock file.
      this.db.exec("PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS worlds (world_key TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS world_chunks (world_key TEXT NOT NULL, chunk_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(world_key, chunk_key)) STRICT;");
      this.db.exec("CREATE TABLE IF NOT EXISTS world_receipts (world_key TEXT NOT NULL, player_id TEXT NOT NULL, operation INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(world_key,player_id,operation)) STRICT;");
      this.db.exec("CREATE TABLE IF NOT EXISTS world_entities (world_key TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(world_key,entity_id)) STRICT;");
    } catch (error) { this.db.close(); throw error; }
  }
  async load(key: WorldKey): Promise<WorldStorageRecord | null> {
    const row = this.db.prepare("SELECT payload FROM worlds WHERE world_key = ?").get(worldKey(key));
    if (!row) return null;
    const value = JSON.parse(String(row.payload)) as WorldStorageRecord;
    this.restoreEntities(value, worldKey(key));
    // Old monolithic records remain readable; the next commit migrates them atomically.
    const chunks = this.db.prepare("SELECT chunk_key, payload FROM world_chunks WHERE world_key = ?").all(worldKey(key));
    if (chunks.length) {
      value.players = Object.create(null); value.receipts = Object.create(null);
      for (const chunk of chunks) {
        const [kind, id] = JSON.parse(String(chunk.chunk_key)) as [string, string];
        if (kind === "player") value.players[id] = JSON.parse(String(chunk.payload));
        if (kind === "receipts") value.receipts[id] = JSON.parse(String(chunk.payload));
        if (kind === "random" && value.random) value.random.players[id] = JSON.parse(String(chunk.payload));
      }
    }
    for (const row of this.db.prepare("SELECT player_id, payload FROM world_receipts WHERE world_key = ? ORDER BY player_id, operation").all(worldKey(key))) {
      const id=String(row.player_id); (value.receipts[id] ??= []).push(JSON.parse(String(row.payload)));
    }
    if (value.schemaVersion !== 1 || worldKey(value.key) !== worldKey(key)) throw new Error("Unsupported or mismatched world storage");
    return value;
  }
  async loadResident(key:WorldKey):Promise<WorldStorageRecord|null> {
    const row=this.db.prepare("SELECT payload FROM worlds WHERE world_key=?").get(worldKey(key));if(!row)return null;
    const value=JSON.parse(String(row.payload)) as WorldStorageRecord;
    this.restoreEntities(value, worldKey(key));
    if(value.schemaVersion!==1||worldKey(value.key)!==worldKey(key))throw new Error("Unsupported or mismatched world storage");
    if(Object.keys(value.players).length||Object.keys(value.random?.players??{}).length)return this.load(key);
    value.players=Object.create(null);value.receipts=Object.create(null);
    const rows=this.db.prepare("SELECT chunk_key FROM world_chunks WHERE world_key=? AND json_extract(chunk_key,'$[0]')='player' AND (json_extract(payload,'$.ownedWorld.campfire') IS NOT NULL OR json_extract(payload,'$.ownedWorld.recoveryCache') IS NOT NULL)").all(worldKey(key));
    for(const row of rows){const [,id]=JSON.parse(String(row.chunk_key)) as [string,string];const player=await this.loadPlayer(key,id);
      if(player){value.players[id]=player.state;value.receipts[id]=player.receipts;if(player.random&&value.random)value.random.players[id]=player.random;}}
    return value;
  }
  async loadPlayer(key:WorldKey,playerId:string):Promise<StoredWorldPlayer|null> {
    const lookup=this.db.prepare("SELECT payload FROM world_chunks WHERE world_key=? AND chunk_key=?");
    const row=lookup.get(worldKey(key),JSON.stringify(["player",playerId]));if(!row)return null;
    const state=JSON.parse(String(row.payload));
    if(state.player?.id!==playerId)throw new Error("Stored player identity mismatch");
    const receipts=this.db.prepare("SELECT payload FROM world_receipts WHERE world_key=? AND player_id=? ORDER BY operation").all(worldKey(key),playerId).map(row=>JSON.parse(String(row.payload)));
    if(!receipts.length){const legacy=lookup.get(worldKey(key),JSON.stringify(["receipts",playerId]));if(legacy)receipts.push(...JSON.parse(String(legacy.payload)));}
    const random=lookup.get(worldKey(key),JSON.stringify(["random",playerId]));
    return {state,receipts,...(random?{random:JSON.parse(String(random.payload))}:{})};
  }
  async commit(record: WorldStorageRecord): Promise<void> {
    const key = worldKey(record.key);
    const patchEntities = record.entityWrites === "patch";
    const payload = JSON.stringify({ ...record, ...(patchEntities ? { entities: [], removedEntityIds: [] } : {}), players: {}, receipts: {}, ...(record.random?{random:{world:record.random.world,players:{}}}:{}) });
    const previous = this.cachedChunks.get(key) ?? new Map<string,string>();
    const next = new Map<string,string>();
    const priorReceipts = this.receiptTails.get(key);
    const nextReceipts = new Map<string, WorldStorageRecord["receipts"][string][number] | undefined>();
    const priorHeads=this.receiptHeads.get(key),nextHeads=new Map<string,number>();
    for (const [id, state] of Object.entries(record.players)) next.set(JSON.stringify(["player",id]), JSON.stringify(state));
    for(const [id,state]of Object.entries(record.random?.players??{}))next.set(JSON.stringify(["random",id]),JSON.stringify(state));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (patchEntities) {
        const putEntity = this.db.prepare("INSERT INTO world_entities (world_key,entity_id,payload) VALUES (?,?,?) ON CONFLICT(world_key,entity_id) DO UPDATE SET payload=excluded.payload");
        // Upgrade monolithic saves in the same transaction, retaining omitted old rows.
        const old = this.db.prepare("SELECT payload FROM worlds WHERE world_key=?").get(key);
        if (old) {
          const prior = JSON.parse(String(old.payload)) as WorldStorageRecord;
          if (prior.entityWrites !== "patch") for (const entity of prior.entities) putEntity.run(key, entity.id, JSON.stringify(entity));
        }
        for (const entity of record.entities) putEntity.run(key, entity.id, JSON.stringify(entity));
        const removeEntity = this.db.prepare("DELETE FROM world_entities WHERE world_key=? AND entity_id=?");
        for (const id of record.removedEntityIds ?? []) removeEntity.run(key, id);
      } else this.db.prepare("DELETE FROM world_entities WHERE world_key=?").run(key);
      this.db.prepare("INSERT INTO worlds (world_key, payload) VALUES (?, ?) ON CONFLICT(world_key) DO UPDATE SET payload = excluded.payload").run(key, payload);
      const put = this.db.prepare("INSERT INTO world_chunks (world_key, chunk_key, payload) VALUES (?, ?, ?) ON CONFLICT(world_key,chunk_key) DO UPDATE SET payload = excluded.payload");
      for (const [chunk, json] of next) if (previous.get(chunk) !== json) put.run(key, chunk, json);
      // Include on-disk chunks on the first commit after reopening.
      const persisted = record.playerWrites==="patch"?[]:this.db.prepare("SELECT chunk_key FROM world_chunks WHERE world_key = ?").all(key);
      const remove = this.db.prepare("DELETE FROM world_chunks WHERE world_key = ? AND chunk_key = ?");
      for (const row of persisted) if (!next.has(String(row.chunk_key))) remove.run(key, String(row.chunk_key));
      const putReceipt=this.db.prepare("INSERT INTO world_receipts (world_key,player_id,operation,payload) VALUES (?,?,?,?) ON CONFLICT(world_key,player_id,operation) DO UPDATE SET payload=excluded.payload");
      const pruneReceipts=this.db.prepare("DELETE FROM world_receipts WHERE world_key=? AND player_id=? AND operation<?");
      for (const [id, receipts] of Object.entries(record.receipts)) {
        const tail=receipts.at(-1), prior=priorReceipts?.get(id); nextReceipts.set(id,tail);
        const head=receipts[0]?.operation??Number.MAX_SAFE_INTEGER;nextHeads.set(id,head);
        if (prior && tail === prior && priorHeads?.get(id)===head) continue;
        if(!prior)remove.run(key,JSON.stringify(["receipts",id]));
        for (const receipt of receipts) if (!prior || receipt.operation > prior.operation) putReceipt.run(key,id,receipt.operation,JSON.stringify(receipt));
        pruneReceipts.run(key,id,receipts[0]?.operation ?? Number.MAX_SAFE_INTEGER);
      }
      const receiptOwners=record.playerWrites==="patch"?[]:priorReceipts ? [...priorReceipts.keys()].map(player_id=>({player_id}))
        : this.db.prepare("SELECT DISTINCT player_id FROM world_receipts WHERE world_key=?").all(key);
      const removeOwner=this.db.prepare("DELETE FROM world_receipts WHERE world_key=? AND player_id=?");
      for(const row of receiptOwners)if(!Object.hasOwn(record.receipts,String(row.player_id)))removeOwner.run(key,String(row.player_id));
      this.db.exec("COMMIT");
      this.cachedChunks.set(key,next);
      this.receiptTails.set(key,nextReceipts);
      this.receiptHeads.set(key,nextHeads);
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private restoreEntities(value: WorldStorageRecord, key: string): void {
    if (value.entityWrites !== "patch") return;
    value.entities = this.db.prepare("SELECT payload FROM world_entities WHERE world_key=? ORDER BY rowid").all(key)
      .map(row => JSON.parse(String(row.payload)));
    delete value.entityWrites; delete value.removedEntityIds;
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true;
    this.db.close();
    this.cachedChunks.clear(); this.receiptTails.clear(); this.receiptHeads.clear();
  }
}
