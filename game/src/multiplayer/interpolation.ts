import type { Vec3 } from "../contracts.js";

/** One update of presentation delay. Large corrections snap instead of crossing walls. */
export class ActorInterpolation {
  private from: Vec3;
  private to: Vec3;
  private at = 0;
  private duration = 100;
  private sampledAt = 0;
  private fromFacing: number;
  private toFacing: number;
  constructor(position: Vec3, facing = 0) { this.from = [...position]; this.to = [...position]; this.fromFacing = facing; this.toFacing = facing; }
  /** Teleports, respawns and realm changes must never travel through the intervening geometry. */
  reset(position: Vec3, facing: number, now: number): void {
    this.from = [...position]; this.to = [...position];
    this.fromFacing = this.toFacing = facing; this.at = this.sampledAt = now;
  }
  freeze(now: number): void { this.reset(this.sample(now), this.facing(now), now); }
  push(position: Vec3, now: number, facing = this.toFacing, intervalMs = 100): void {
    now = Math.max(now, this.sampledAt);
    // State-only deltas must not restart an unfinished movement or turn.
    const sameFacing = Math.abs(Math.atan2(Math.sin(facing - this.toFacing), Math.cos(facing - this.toFacing))) < 1e-8;
    if (position.every((value, axis) => value === this.to[axis]) && sameFacing) return;
    const current = this.sample(now);
    if (Math.hypot(position[0] - current[0], position[1] - current[1], position[2] - current[2]) > 8) {
      this.reset(position, facing, now); return;
    }
    this.fromFacing = this.facing(now);
    this.toFacing = this.fromFacing + Math.atan2(Math.sin(facing - this.fromFacing), Math.cos(facing - this.fromFacing));
    this.from = current;
    this.to = [...position]; this.at = now;
    this.duration = Math.max(16, Math.min(1000, intervalMs));
  }
  facing(now: number): number {
    now = this.sampledAt = Math.max(now, this.sampledAt);
    const t = Math.max(0, Math.min(1, (now - this.at) / this.duration));
    return this.fromFacing + (this.toFacing - this.fromFacing) * t;
  }
  sample(now: number): Vec3 {
    // A socket callback can run after a RAF timestamp was captured but before that frame
    // draws. Never rewind the transform already shown by the structural update.
    now = this.sampledAt = Math.max(now, this.sampledAt);
    const t = Math.max(0, Math.min(1, (now - this.at) / this.duration));
    return [this.from[0] + (this.to[0] - this.from[0]) * t,
      this.from[1] + (this.to[1] - this.from[1]) * t, this.from[2] + (this.to[2] - this.from[2]) * t];
  }
}

/** What one authoritative update says about a replicated creature or NPC. */
export interface ReplicatedActorFrame {
  readonly position: Vec3;
  readonly facing: number;
  readonly dead: boolean;
  /** Region and model: a change in either is a teleport, never a walk. */
  readonly placement: string;
}

/**
 * Applies one authoritative update to an actor's drawn motion.
 *
 * A body stops where it is drawn on the update that says it died, and holds there until it comes
 * back. Snapping it to the authoritative position instead jerked every kill forward by the step
 * the drawn body had not finished yet (0.3 m for a charging wolf), and interpolating to it slid
 * the corpse along the ground under its death clip.
 */
export function followReplicatedActor(
  motion: ActorInterpolation, previous: ReplicatedActorFrame | undefined, next: ReplicatedActorFrame,
  now: number, intervalMs: number,
): void {
  if (previous && (previous.placement !== next.placement || (previous.dead && !next.dead))) {
    motion.reset(next.position, next.facing, now);
  } else if (next.dead) {
    if (!previous?.dead) motion.freeze(now);
  } else {
    motion.push(next.position, now, next.facing, intervalMs);
  }
}
