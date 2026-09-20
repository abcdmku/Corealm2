import type { SemanticEntity, Vec3 } from "../contracts.js";
import { habitatContains, type HabitatDef } from "../content/worldHabitats.js";
import { getRegion } from "../content/regions.js";
import type { Navigation } from "../systems/navigation.js";
import { habitatIdleTargets } from "../world/habitatMovement.js";

/** Reserves each creature's spawn and idle routes against tree trunks. `clearances` is the scatter's exclusion zones, or a server's own set. */
export function registerHabitatClearances(nav: Pick<Navigation, "nearestWalkable">, entities: readonly SemanticEntity[], habitats: readonly HabitatDef[],
  clearances: { addTreeClearance(points: readonly Vec3[], bodyRadius: number, id?: string): unknown }): void {
    for (const habitat of habitats) {
      const inside = (point: Vec3) => habitatContains(habitat, point);
      for (const entity of entities.filter((entry) => entry.meta?.groupId === habitat.groupId)) {
        const spawn = entity.position;
        const targets = habitatIdleTargets(entity.id, spawn, habitat);
        const valid: Vec3[] = [];
        for (const candidate of targets.candidates) {
          const anchor = habitat.anchors[candidate.anchorIndex]!;
          if (!inside([anchor[0], spawn[1], anchor[1]]) || !inside(candidate.position)) continue;
          const snapped = nav.nearestWalkable(candidate.position, 0.1);
          if (snapped && inside(snapped)) valid.push(snapped);
        }
        const radius = entity.combat?.bodyRadius ?? 0.4;
        clearances.addTreeClearance([spawn], radius, entity.id);
        if (!targets.ranging) {
          clearances.addTreeClearance([spawn, ...valid], radius, `${entity.id}:browsing`);
        } else if (valid.length) {
          for (let i = 0; i < valid.length; i++) {
            // Patrols can resume at their next valid circuit point after combat or a blocked target.
            clearances.addTreeClearance([spawn, valid[i]!], radius, `${entity.id}:return:${i}`);
            clearances.addTreeClearance([valid[i]!, valid[(i + 1) % valid.length]!], radius, `${entity.id}:patrol:${i}`);
          }
        }
      }
    }
}
