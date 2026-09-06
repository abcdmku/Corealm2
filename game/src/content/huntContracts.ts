import type { RegionId, SemanticEntity } from "../contracts.js";
import { enemyCombatLevel, type EnemyDef } from "./index.js";

export interface HuntTarget {
  id: string;
  name: string;
  regionId: RegionId;
  regionName: string;
  enemyDefIds: string[];
  level: number;
  residents: number;
  reachable: boolean;
}

export interface HuntOffer {
  id: string;
  targetId: string;
  targetName: string;
  regionId: RegionId;
  regionName: string;
  enemyDefIds: string[];
  level: number;
  requiredKills: number;
  rewardXp: number;
  rewardSkill: "melee";
}

export interface HuntEligibility { regions: readonly RegionId[]; combatLevel: number }

/** Only actual registered enemies enter the board. The caller supplies route/unlock eligibility. */
export function deriveHuntTargets(
  entities: Iterable<SemanticEntity>,
  enemy: (id: string) => EnemyDef | undefined,
  regionName: (id: RegionId) => string,
  reachable: (entity: SemanticEntity) => boolean,
): HuntTarget[] {
  const targets = new Map<string, HuntTarget>();
  for (const entity of entities) {
    if (entity.archetype !== "enemy" || !reachable(entity)) continue;
    const defId = typeof entity.meta?.enemyDefId === "string" ? entity.meta.enemyDefId : "";
    const def = enemy(defId);
    if (!def) continue;
    const id = `${entity.regionId}:${def.id}`;
    const existing = targets.get(id);
    if (existing) { existing.residents += 1; continue; }
    targets.set(id, { id, name: def.name, regionId: entity.regionId,
      regionName: regionName(entity.regionId), enemyDefIds: [def.id], level: enemyCombatLevel(def),
      residents: 1, reachable: true });
  }
  return [...targets.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}

export function eligibleHuntTargets(targets: readonly HuntTarget[], eligibility: HuntEligibility): HuntTarget[] {
  return targets.filter((target) => target.reachable && target.residents >= 1
    && target.enemyDefIds.length > 0 && Number.isFinite(target.level) && target.level >= 1
    && target.level <= Math.max(1, eligibility.combatLevel) + 3
    && eligibility.regions.includes(target.regionId));
}

/** Three stable offers per roll; reloading never rerolls the saved board. */
export function generateHuntOffers(seed: number, serial: number, targets: readonly HuntTarget[],
  eligibility: HuntEligibility, lastTargetId: string | null = null): HuntOffer[] {
  const pool = eligibleHuntTargets(targets, eligibility).sort((a, b) => {
    if (a.id === lastTargetId && b.id !== lastTargetId) return 1;
    if (b.id === lastTargetId && a.id !== lastTargetId) return -1;
    return hash(`${seed}:${serial}:${a.id}`) - hash(`${seed}:${serial}:${b.id}`) || a.id.localeCompare(b.id);
  });
  return pool.slice(0, 3).map((target) => {
    const requiredKills = 4 + hash(`${seed}:${serial}:${target.id}:count`) % 5;
    return { id: `hunt:${serial}:${target.id}`, targetId: target.id, targetName: target.name,
      regionId: target.regionId, regionName: target.regionName, enemyDefIds: [...target.enemyDefIds],
      level: target.level, requiredKills, rewardXp: requiredKills * (12 + target.level * 4), rewardSkill: "melee" };
  });
}
