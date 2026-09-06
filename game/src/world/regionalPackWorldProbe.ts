import type { Vec3 } from "../contracts.js";
import type { RegionalPackCatalogue } from "./regionalPackEntities.js";
import type { ForestTreeDescriptor } from "./forestResources.js";
import type { ScatterStreamingController } from "./scatterStreaming.js";
import { ForestObstacles } from "./forestObstacles.js";
import { scatterTilesForBounds } from "./scatter.js";
import { auditRegionalPackWorld, type RegionalPackWorldAuditPorts } from "./regionalPackWorldAudit.js";

interface ProbePorts extends Omit<RegionalPackWorldAuditPorts, "forestOverlaps" | "preparePack"> {
  readonly scatterStreaming: Pick<ScatterStreamingController, "loadSpawn" | "getResidency" | "setActivePosition">;
  /** Actual descriptors delivered by the production scatter onTree callback. */
  readonly forestInstances: ReadonlyMap<string, { readonly descriptor: ForestTreeDescriptor }>;
  readonly playerPosition: () => Vec3;
}

/** Boot exposes this only on an explicit acceptance query. The audit indexes generated trunks
 * independently of the nearby harvestable-entity registry, so distant packs have real coverage.
 * Every generated tree is included, even if the current save depleted it. This proves the
 * stricter fresh-world placement and never changes the player's tree depletion state. */
export function createRegionalPackWorldProbe(ports: ProbePorts) {
  let running = false;
  return {
    async run(packIds?: readonly string[], catalogue?: RegionalPackCatalogue) {
      if (running) throw new Error("A regional pack world audit is already running");
      running = true;
      const trunks = new ForestObstacles();
      try {
        return await auditRegionalPackWorld({
          ...ports,
          forestOverlaps: (position, radius) => trunks.overlaps(position, radius),
          preparePack: async (pack) => {
            // One 96m generation ring covers every authored pack's <=16m reservation.
            const results = await ports.scatterStreaming.loadSpawn(pack.centre[0], pack.centre[1], 1);
            const required = scatterTilesForBounds({ minX: pack.centre[0] - pack.radius - 1,
              maxX: pack.centre[0] + pack.radius + 1, minZ: pack.centre[1] - pack.radius - 1,
              maxZ: pack.centre[1] + pack.radius + 1 });
            const resident = new Set(ports.scatterStreaming.getResidency().resident);
            if (!required.every((tile) => resident.has(tile.id)) || results.some((result) => result.missingAssets.length)) return false;
            for (const { descriptor } of ports.forestInstances.values()) trunks.upsert(descriptor);
            return true;
          },
        }, { packIds }, catalogue);
      } finally {
        const player = ports.playerPosition();
        ports.scatterStreaming.setActivePosition(player[0], player[2]);
        running = false;
      }
    },
  };
}
