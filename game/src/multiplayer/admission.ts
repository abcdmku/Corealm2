import { MAX_WORLD_PLAYERS } from "../contracts.js";
import { RECONNECT_RESERVATION_MS, SessionFailure } from "./protocol.js";

interface Slot { sessionId: string; reservedUntil: number | null }
/**
 * One world's capacity. Who may play is the server's player lease, not this: a slot only keeps a
 * dropped player's place in a full world for the reconnect window.
 */
export class Admission {
  private readonly slots = new Map<string, Slot>();
  private limit!: number;
  constructor(capacity: number, private readonly now = Date.now) { this.capacity = capacity; }
  get capacity(): number { return this.limit; }
  /** An admin may change it while the world runs. Players already in stay; it decides the next join. */
  set capacity(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_WORLD_PLAYERS) throw new RangeError("Invalid world capacity");
    this.limit = capacity;
  }
  private expire(): void {
    for (const [playerId, slot] of this.slots) if (slot.reservedUntil !== null && slot.reservedUntil <= this.now()) this.slots.delete(playerId);
  }
  get population(): number { this.expire(); return this.slots.size; }
  /** Throws FULL when this player has no slot and none is free. Takes nothing. */
  check(playerId: string): void {
    this.expire();
    if (!this.slots.has(playerId) && this.slots.size >= this.capacity) throw new SessionFailure("FULL", "This world is full");
  }
  join(playerId: string, sessionId: string): void {
    this.check(playerId);
    this.slots.set(playerId, { sessionId, reservedUntil: null });
  }
  /** Free the slot, or with `reserve` hold it for the reconnect window. Only the session that owns it may. */
  leave(playerId: string, sessionId: string, reserve: boolean): void {
    const slot = this.slots.get(playerId);
    if (!slot || slot.sessionId !== sessionId) return;
    if (reserve) slot.reservedUntil = this.now() + RECONNECT_RESERVATION_MS;
    else this.slots.delete(playerId);
  }
  /** The player went to another world: a place held for their return is free again. */
  forget(playerId: string): void {
    if (this.slots.get(playerId)?.reservedUntil != null) this.slots.delete(playerId);
  }
}
