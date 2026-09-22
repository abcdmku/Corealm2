import { CHAT_CHANNELS, type RemotePlayer, type SemanticEntity, type WorldUpdate } from "../contracts.js";
import { playerSessionState } from "../state/store.js";
import type { HeadlessWorld } from "./headlessWorld.js";
import { SessionFailure } from "./protocol.js";
import { sameCombatRealm } from "../systems/combat.js";
import { publicPresentation } from "./publicActions.js";
import { replicatedTraversal } from "./traversal.js";

export const INTEREST_RADIUS = 48;
export const MAX_REPLICATED_ENTITIES = 2048;
export const MAX_OUTBOUND_BYTES = 2 * 1024 * 1024;
interface CachedPlayer { json: string; value: RemotePlayer; gameplay?: string }

/** Shared once-per-tick public changes. Private data never enters this cache. */
export class ReplicationFrame extends Map<string,CachedPlayer> {
  readonly gameplayChanges = new Set<string>();
  constructor(world: HeadlessWorld, previous: Map<string,string>) {
    super();
    for (const id of world.active) {
      const value=publicPlayer(world,id);
      const gameplay=JSON.stringify([value.name,value.level,value.regionId,value.health,value.maxHealth,value.equipment,value.presentation]);
      this.set(id,{value,json:JSON.stringify(value),gameplay});
      if(previous.get(id)!==gameplay)this.gameplayChanges.add(id);
      previous.set(id,gameplay);
    }
    for(const id of previous.keys())if(!world.active.has(id))previous.delete(id);
  }
}

export function publicPlayer(world: HeadlessWorld, id: string): RemotePlayer {
  const state = world.players.get(id)!.store.get();
  const traversal = replicatedTraversal(state, key => world.entities.get(key), world.clock.elapsedMs);
  const activity = state.activity;
  const obstacle = activity?.kind === "traversing" ? world.entities.get(activity.obstacleId) : undefined;
  return { id, name: state.player.name, level: world.players.get(id)!.api.getPlayer().combatLevelEstimate,
    position: traversal?.position ?? state.player.position, facingRad: traversal?.facingRad ?? state.player.facingRad,
    regionId: state.player.regionId, health: state.player.health, maxHealth: state.player.maxHealth,
    equipment: Object.fromEntries(Object.entries(state.equipment).flatMap(([slot, stack]) => stack ? [[slot, stack.itemId]] : [])),
    presentation: traversal && activity?.kind === "traversing" && obstacle?.obstacle
      ? { pose: traversal.kind === "passage" ? "walk" : traversal.kind,
        traversal:{entityId:obstacle.id,entry:state.player.position,exit:activity.exitPosition??obstacle.obstacle.exitPosition,endsAtMs:activity.endsAtMs} }
      : publicPresentation(state) };
}

/** Per-connection bounded delta baseline. Public serialization is cached once per world tick. */
export class Replicator {
  private sequence = 0;
  private players = new Map<string, string>();
  private entities = new Map<string, string>();
  private readonly gameplay = new Map<string, string>();
  private privateFields = new Map<string,string>();
  private eventSequence = 0;
  private actionSequence = 0;
  private socialJson = "";
  private readonly cosmeticPhase: number;
  private nearby: string[] = [];
  private fastMotion = new Set<string>();
  private interestTick = -Infinity;
  private membershipVersion = -1;
  private interestRegion = "";
  constructor(readonly sessionId: string, readonly playerId: string) {
    this.cosmeticPhase = [...playerId].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0) % 5;
  }
  /**
   * Forget every baseline but the sequence. The world behind this connection was replaced, so its event
   * and action counters start again; the next update must be a snapshot, and the client takes it as
   * the next in order.
   */
  rebase(): void {
    this.players.clear(); this.entities.clear(); this.gameplay.clear(); this.privateFields.clear();
    this.eventSequence = 0; this.actionSequence = 0; this.socialJson = ""; this.nearby = []; this.fastMotion.clear();
    this.interestTick = -Infinity; this.membershipVersion = -1; this.interestRegion = "";
  }
  update(world: HeadlessWorld, acknowledgedCommand: number, publicCache: Map<string, CachedPlayer>, snapshot = false,
    entityCache = new Map<string, { json: string; value: SemanticEntity }>(),
    committedState?: NonNullable<WorldUpdate["privateState"]>): WorldUpdate {
    const player = world.players.get(this.playerId)!;
    const position = player.store.get().player.position;
    const players: RemotePlayer[] = []; const removedPlayers: string[] = [];
    const motion: RemotePlayer[] = [];
    const region=player.store.get().player.regionId;
    const refreshInterest=snapshot || this.nearby.length<=128 || world.clock.tick%5===this.cosmeticPhase&&world.clock.tick!==this.interestTick
      || this.membershipVersion!==world.membershipVersion || this.interestRegion!==region;
    if(refreshInterest){
      this.nearby=[];
      world.spatial.forEachInRadius(position,world.ports.interestRadius??INTEREST_RADIUS,(id)=>{
        if(id!==this.playerId && sameCombatRealm(world.players.get(id)!.store.get().player.regionId,region))this.nearby.push(id);
      });
      const visible=new Set(this.nearby);
      this.fastMotion = new Set([...this.nearby].sort((a,b) => {
        const pa=world.players.get(a)!.store.get().player.position, pb=world.players.get(b)!.store.get().player.position;
        return Math.hypot(pa[0]-position[0],pa[2]-position[2])-Math.hypot(pb[0]-position[0],pb[2]-position[2]);
      }).slice(0,32));
      for(const id of this.players.keys())if(!visible.has(id)){removedPlayers.push(id);this.players.delete(id);this.gameplay.delete(id);}
      this.interestTick=world.clock.tick;this.membershipVersion=world.membershipVersion;this.interestRegion=region;
    }
    const cosmeticTick = this.nearby.length <= 128 || world.clock.tick % 5 === this.cosmeticPhase;
    const candidates = snapshot || cosmeticTick || !(publicCache instanceof ReplicationFrame) ? this.nearby
      : [...new Set([...this.fastMotion, ...[...publicCache.gameplayChanges].filter(id=>this.players.has(id)),
        ...(refreshInterest?this.nearby.filter(id=>!this.players.has(id)):[])])];
    for (const id of candidates) {
      let cached = publicCache.get(id);
      if (!cached) { const value = publicPlayer(world, id); cached = { value, json: JSON.stringify(value) }; publicCache.set(id, cached); }
      if (!sameCombatRealm(cached.value.regionId, player.store.get().player.regionId)) {
        if(this.players.delete(id))removedPlayers.push(id);
        this.gameplay.delete(id); this.nearby=this.nearby.filter(candidate=>candidate!==id); continue;
      }
      cached.gameplay ??= JSON.stringify([cached.value.name,cached.value.level,cached.value.regionId,cached.value.health,cached.value.maxHealth,cached.value.equipment,cached.value.presentation]);
      const previous = this.players.get(id);
      const send = snapshot || previous === undefined || this.gameplay.get(id) !== cached.gameplay || cosmeticTick || this.fastMotion.has(id);
      if(send)this.players.set(id,cached.json);
      if (send && (snapshot || previous !== cached.json)) {
        if (snapshot || previous === undefined || this.gameplay.get(id) !== cached.gameplay) players.push(cached.value);
        else motion.push(cached.value);
      }
      if (send) this.gameplay.set(id,cached.gameplay);
    }
    const nextEntities = new Map<string, string>(); const entities: SemanticEntity[] = [];
    world.entities.index().forEachInRadius(position, world.ports.interestRadius ?? INTEREST_RADIUS, (id) => {
      const privateEntity = player.questEntities.get(id);
      const entity = privateEntity ?? world.entities.get(id)!;
      if (!sameCombatRealm(entity.regionId, player.store.get().player.regionId)) return;
      const pile = world.shared.lootPiles[id];
      if (pile && !world.social.canLoot(this.playerId, id)) return;
      if (entity.archetype === "recovery_cache" && player.store.get().world.recoveryCache?.id !== id) return;
      let cached = privateEntity ? undefined : entityCache.get(id);
      if (!cached) { cached = { json: JSON.stringify(entity), value: entity }; if (!privateEntity) entityCache.set(id, cached); }
      const json = cached.json; nextEntities.set(id, json);
      if (snapshot || this.entities.get(id) !== json) entities.push(entity);
    });
    if (nextEntities.size > MAX_REPLICATED_ENTITIES) throw new SessionFailure("BACKLOG", "Interest snapshot exceeds entity limit");
    const state = committedState ?? playerSessionState(player.store.get());
    const privateDelta: NonNullable<WorldUpdate["privateDelta"]> = {};
    for (const key of Object.keys(state) as (keyof typeof state)[]) {
      const json = JSON.stringify(state[key]);
      if (this.privateFields.get(key) !== json) Object.assign(privateDelta, { [key]: state[key] });
      this.privateFields.set(key,json);
    }
    const events = player.events.since(this.eventSequence);
    this.eventSequence = events.nextSeq;
    const actions = snapshot ? [] : world.actions.since(this.actionSequence).filter(action =>
      sameCombatRealm(action.regionId, region) && (action.playerId === this.playerId ||
        Math.hypot(action.position[0] - position[0], action.position[2] - position[2]) <= (world.ports.interestRadius ?? INTEREST_RADIUS)));
    this.actionSequence = world.actions.currentSequence();
    const social = world.social.view(this.playerId), socialJson = JSON.stringify(social);
    const update: WorldUpdate = {
      sessionId: this.sessionId, sequence: this.sequence + 1, baseSequence: snapshot ? null : this.sequence,
      tick: world.clock.tick, simMs: world.clock.elapsedMs, acknowledgedCommand, snapshot,
      players, entities,
      ...(snapshot || socialJson !== this.socialJson ? { social } : {}),
      ...(motion.length ? { playerMotion: encodeMotion(motion) } : {}),
      events: snapshot ? [] : events.events,
      ...(actions.length ? { actions } : {}),
      removedPlayers: snapshot ? [] : removedPlayers,
      removedEntities: snapshot ? [] : [...this.entities.keys()].filter((id) => !nextEntities.has(id)),
      ...(snapshot ? { privateState: state } : Object.keys(privateDelta).length ? { privateDelta } : {}),
    };
    this.socialJson = socialJson;
    this.sequence++; this.entities = nextEntities;
    return update;
  }
}

/** Client rejects old sessions and delta gaps before changing visible state. */
export class ReplicatedState {
  sequence = 0;
  readonly players = new Map<string, RemotePlayer>();
  readonly entities = new Map<string, SemanticEntity>();
  privateState: WorldUpdate["privateState"];
  constructor(readonly sessionId: string, private readonly playerId?: string) {}
  apply(update: WorldUpdate): boolean {
    validateUpdate(update,this.playerId);
    if (update.sessionId !== this.sessionId || update.sequence <= this.sequence) return false;
    if (!update.snapshot && update.baseSequence !== this.sequence) throw new SessionFailure("OUT_OF_ORDER", "Snapshot required after replication gap");
    let privateState = update.privateState;
    if (update.privateDelta) {
      if (!this.privateState || update.snapshot || privateState) throw new SessionFailure("INVALID_MESSAGE","Private delta requires a prior snapshot");
      const keys = Object.keys(this.privateState);
      if (Object.keys(update.privateDelta).some(key => !keys.includes(key))) throw new SessionFailure("INVALID_MESSAGE","Unknown private field");
      privateState = { ...this.privateState, ...update.privateDelta };
      validateUpdate({ ...update, privateState, privateDelta: undefined }, this.playerId);
    }
    const replacements=new Map(update.players.map(player=>[player.id,player]));
    const moved=update.playerMotion?decodeMotion(update.playerMotion,(id)=>replacements.get(id)??(update.snapshot?undefined:this.players.get(id))):[];
    if (update.snapshot) { this.players.clear(); this.entities.clear(); }
    for (const player of update.players) this.players.set(player.id, player);
    if (update.playerMotion) {
      for (const player of moved) this.players.set(player.id, player);
      // Provider subscribers receive ordinary semantic actors after wire decoding.
      update.players = [...update.players, ...moved]; delete update.playerMotion;
    }
    for (const id of update.removedPlayers) this.players.delete(id);
    for (const entity of update.entities) this.entities.set(entity.id, entity);
    for (const id of update.removedEntities) this.entities.delete(id);
    if (privateState) { this.privateState = privateState; update.privateState = privateState; }
    delete update.privateDelta;
    this.sequence = update.sequence; return true;
  }
}

function encodeMotion(players: RemotePlayer[]): NonNullable<WorldUpdate["playerMotion"]> {
  const bytes = new Uint8Array(players.length * 16); const view = new DataView(bytes.buffer);
  for (let i=0;i<players.length;i++) {
    const player=players[i]!;
    for(let axis=0;axis<3;axis++) view.setFloat32(i*16+axis*4,player.position[axis]!,true);
    view.setFloat32(i*16+12,player.facingRad,true);
  }
  if(typeof Buffer!=="undefined")return {ids:players.map(player=>player.id),data:Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString("base64")};
  let binary=""; for(let offset=0;offset<bytes.length;offset+=8192) binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return { ids: players.map(player=>player.id), data:btoa(binary) };
}

function decodeMotion(motion: NonNullable<WorldUpdate["playerMotion"]>, player: (id:string)=>RemotePlayer|undefined): RemotePlayer[] {
  if (!Array.isArray(motion.ids) || motion.ids.length>1000 || typeof motion.data!=="string" || motion.data.length>22000) throw new SessionFailure("INVALID_MESSAGE","Invalid actor motion");
  const binary=atob(motion.data);
  if(binary.length!==motion.ids.length*16) throw new SessionFailure("INVALID_MESSAGE","Invalid actor motion length");
  const bytes=Uint8Array.from(binary,character=>character.charCodeAt(0)); const view=new DataView(bytes.buffer);
  return motion.ids.map((id,index)=>{
    const prior=player(id); if(!prior) throw new SessionFailure("INVALID_MESSAGE","Unknown actor motion");
    const x=view.getFloat32(index*16,true),y=view.getFloat32(index*16+4,true),z=view.getFloat32(index*16+8,true),facingRad=view.getFloat32(index*16+12,true);
    if(![x,y,z,facingRad].every(Number.isFinite))throw new SessionFailure("INVALID_MESSAGE","Non-finite actor motion");
    return {...prior,position:[x,y,z],facingRad};
  });
}

function validateUpdate(update: WorldUpdate, playerId?: string):void {
  const finite=(value:unknown)=>typeof value==="number"&&Number.isFinite(value);
  const point=(value:unknown)=>Array.isArray(value)&&value.length===3&&value.every(finite);
  const integer=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
  const ids=(value:unknown,max:number)=>Array.isArray(value)&&value.length<=max&&value.every(id=>typeof id==="string"&&id.length<=256);
  const text=(value:unknown,max=256)=>typeof value==="string"&&value.length<=max;
  if(!update||typeof update.sessionId!=="string"||!integer(update.sequence)||!integer(update.tick)||!integer(update.acknowledgedCommand)
    ||!finite(update.simMs)||typeof update.snapshot!=="boolean"||!(update.baseSequence===null||integer(update.baseSequence))
    ||!Array.isArray(update.players)||update.players.length>1000||!Array.isArray(update.entities)||update.entities.length>MAX_REPLICATED_ENTITIES
    ||!ids(update.removedPlayers,1000)||!ids(update.removedEntities,MAX_REPLICATED_ENTITIES))throw new SessionFailure("INVALID_MESSAGE","Invalid world update");
  for(const player of update.players)if(!player||typeof player.id!=="string"||typeof player.name!=="string"||!point(player.position)
    ||!finite(player.health)||!finite(player.maxHealth)||!finite(player.facingRad)||typeof player.regionId!=="string"||!player.equipment)throw new SessionFailure("INVALID_MESSAGE","Invalid public actor");
  for (const player of update.players) if (player.presentation &&
    (!["idle","walk","run","mine","chop","fish","eat","produce","climb","vault","balance","slide","death"].includes(player.presentation.pose)
      || player.presentation.toolItemId !== undefined && typeof player.presentation.toolItemId !== "string"))
    throw new SessionFailure("INVALID_MESSAGE", "Invalid public pose");
  for (const player of update.players) {
    const gathering=player.presentation?.gathering, traversal=player.presentation?.traversal;
    if (gathering && (typeof gathering.entityId!=="string" || !finite(gathering.startedAtMs) || !finite(gathering.nextRollAtMs))
      || traversal && (typeof traversal.entityId!=="string" || !point(traversal.entry) || !point(traversal.exit) || !finite(traversal.endsAtMs)))
      throw new SessionFailure("INVALID_MESSAGE","Invalid public activity timing");
  }
  if (update.actions) {
    if (!Array.isArray(update.actions) || update.actions.length > 4096) throw new SessionFailure("INVALID_MESSAGE", "Invalid public action batch");
    let previous = -1;
    for (const action of update.actions) {
      if (!action || !integer(action.sequence) || action.sequence <= previous || typeof action.playerId !== "string"
        || typeof action.regionId !== "string" || !point(action.position)) throw new SessionFailure("INVALID_MESSAGE", "Invalid public action");
      previous = action.sequence;
      let valid = false;
      if (action.type === "attack" || action.type === "hit") {
        const cue = action.type === "attack" ? action.attack : action.hit;
        valid = !!cue && typeof cue.sourceId === "string" && typeof cue.targetId === "string" && finite(cue.atMs)
          && ["player", "enemy"].includes(cue.attacker) && ["melee","ranged","magic","special"].includes(cue.kind);
        valid &&= action.type === "attack" ? finite(action.attack.contactAtMs) && finite(action.attack.recoverAtMs)
          : finite(action.hit.damage) && typeof action.hit.hit === "boolean";
      } else if (action.type === "spell") valid = finite(action.atMs) && typeof action.spellId === "string"
        && typeof action.targetId === "string" && finite(action.flightMs) && action.flightMs >= 0 && typeof action.hit === "boolean"
        && (action.aim === undefined || point(action.aim));
      else if (action.type === "gesture") valid = finite(action.atMs) && action.pose === "bank";
      else if (action.type === "attackCancelled") valid = typeof action.sourceId === "string";
      else if (action.type === "death") valid = finite(action.atMs);
      if (!valid) throw new SessionFailure("INVALID_MESSAGE", "Invalid public action payload");
    }
  }
  for(const entity of update.entities)if(!entity||typeof entity.id!=="string"||typeof entity.name!=="string"||!point(entity.position)
    ||!Array.isArray(entity.interactions)||typeof entity.state!=="string"||typeof entity.archetype!=="string")throw new SessionFailure("INVALID_MESSAGE","Invalid world entity");
  if(update.snapshot&&!update.privateState)throw new SessionFailure("INVALID_MESSAGE","Snapshot lacks private state");
  if(update.privateState&&(!point(update.privateState.player?.position)||(playerId&&update.privateState.player.id!==playerId)))throw new SessionFailure("INVALID_MESSAGE","Invalid private owner state");
  if(update.events&&(!Array.isArray(update.events)||update.events.length>512))throw new SessionFailure("INVALID_MESSAGE","Invalid event batch");
  if (update.social !== undefined) {
    const social = update.social;
    if (!social || !Array.isArray(social.messages) || social.messages.length > 80 || !Array.isArray(social.invitations)
      || social.invitations.length > 8 || social.messages.some(message => !message || !integer(message.id)
        || !text(message.playerId) || !text(message.name) || !text(message.text, 280) || !finite(message.atMs)
        || !(CHAT_CHANNELS as readonly string[]).includes(message.channel)
        || message.channel === "whisper" && (!text(message.toId) || !text(message.toName)))
      || social.invitations.some(invite => !invite || !text(invite.partyId) || !text(invite.leaderName) || !finite(invite.expiresAtMs)))
      throw new SessionFailure("INVALID_MESSAGE", "Invalid social update");
    const trade = social.trade;
    if (trade != null && (!text(trade.id) || !integer(trade.revision) || trade.revision < 0 || !finite(trade.expiresAtMs)
      || !Array.isArray(trade.participants) || trade.participants.length !== 2
      || trade.participants.some(member => !member || !text(member.id) || !text(member.name) || typeof member.accepted !== "boolean"
        || !Array.isArray(member.items) || member.items.length > 29 || member.items.some(item => !item || !text(item.itemId)
          || !integer(item.quantity) || item.quantity < 1 || item.quantity > 1_000_000))
      || new Set(trade.participants.map(member => member.id)).size !== 2
      || playerId && !trade.participants.some(member => member.id === playerId))) throw new SessionFailure("INVALID_MESSAGE", "Invalid trade update");
    const party = social.party;
    if (party !== null && (!party || !text(party.id) || !text(party.leaderId) || !text(party.nextLootId)
      || !Array.isArray(party.members) || party.members.length < 1 || party.members.length > 8
      || party.members.some(member => !member || !text(member.id) || !text(member.name) || !finite(member.level) || !finite(member.health)
        || !finite(member.maxHealth) || typeof member.connected !== "boolean" || typeof member.nearby !== "boolean")
      || new Set(party.members.map(member => member.id)).size !== party.members.length
      || !party.members.some(member => member.id === party.leaderId) || !party.members.some(member => member.id === party.nextLootId)
      || playerId && !party.members.some(member => member.id === playerId))) throw new SessionFailure("INVALID_MESSAGE", "Invalid party update");
  }
}
