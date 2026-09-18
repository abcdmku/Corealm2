import type {SemanticEntity, Vec3} from "../contracts.js";

export const DETAILED_REMOTE_PLAYERS = 32;

/** Population and distance hysteresis avoid rebuilding appearances at a crowded boundary. */
export class CrowdDetail {
  private crowded = false;
  private detailed = new Set<string>();

  clear(): void { this.crowded = false; this.detailed.clear(); }

  select(visible: readonly SemanticEntity[], origin: Vec3): Set<string> {
    this.crowded = visible.length >= (this.crowded ? 48 : 64);
    if (!this.crowded) {
      this.detailed = new Set(visible.map(entity => entity.id));
      return new Set();
    }
    const ranked = visible.map(entity => ({entity, distance:
      Math.hypot(entity.position[0] - origin[0], entity.position[2] - origin[2])
      - (this.detailed.has(entity.id) ? 1 : 0)}));
    ranked.sort((a, b) => a.distance - b.distance || a.entity.id.localeCompare(b.entity.id));
    this.detailed = new Set(ranked.slice(0, DETAILED_REMOTE_PLAYERS).map(row => row.entity.id));
    return new Set(visible.filter(entity => !this.detailed.has(entity.id)).map(entity => entity.id));
  }
}
