import { MAX_WORLD_PLAYERS } from "../contracts.js";
import { RECONNECT_RESERVATION_MS, SessionFailure } from "./protocol.js";

interface Slot { sessionId: string; reservedUntil: number | null }
/** Synchronous admission is atomic within the single process that owns this world. */
export class Admission {
  private readonly slots = new Map<string, Slot>();
  constructor(readonly capacity: number, private readonly now = Date.now) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_WORLD_PLAYERS) throw new RangeError("Invalid world capacity");
  }
  expire(): string[] {
    const expired: string[] = [];
    for (const [playerId, slot] of this.slots) if (slot.reservedUntil !== null && slot.reservedUntil <= this.now()) {
      this.slots.delete(playerId); expired.push(playerId);
    }
    return expired;
  }
  get population(): number { this.expire(); return this.slots.size; }
  join(playerId: string, sessionId: string): boolean {
    this.expire();
    const prior = this.slots.get(playerId);
    if (prior?.reservedUntil === null) throw new SessionFailure("DUPLICATE_LOGIN", "This player is already connected");
    if (!prior && this.slots.size >= this.capacity) throw new SessionFailure("FULL", "This world is full");
    this.slots.set(playerId, { sessionId, reservedUntil: null });
    return prior !== undefined;
  }
  owns(playerId: string, sessionId: string): boolean {
    const slot = this.slots.get(playerId);
    return slot?.sessionId === sessionId && slot.reservedUntil === null;
  }
  leave(playerId: string, sessionId: string, reserve: boolean): void {
    const slot = this.slots.get(playerId);
    if (!slot || slot.sessionId !== sessionId) return;
    if (reserve) slot.reservedUntil = this.now() + RECONNECT_RESERVATION_MS;
    else this.slots.delete(playerId);
  }
}
