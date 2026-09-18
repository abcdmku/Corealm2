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
  constructor(position: Vec3, facing = 0) { this.from = position; this.to = position; this.fromFacing = facing; this.toFacing = facing; }
  push(position: Vec3, now: number, facing = this.toFacing, intervalMs = 100): void {
    now = Math.max(now, this.sampledAt);
    const current = this.sample(now);
    this.fromFacing = this.facing(now);
    this.toFacing = this.fromFacing + Math.atan2(Math.sin(facing - this.fromFacing), Math.cos(facing - this.fromFacing));
    this.from = Math.hypot(position[0] - current[0], position[2] - current[2]) > 8 ? position : current;
    this.to = position; this.at = now;
    this.duration = Math.max(100, Math.min(500, intervalMs));
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
