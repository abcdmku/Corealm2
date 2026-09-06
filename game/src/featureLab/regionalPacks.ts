import type { Vec3 } from "../contracts.js";
import { REGIONAL_PACKS } from "../content/regionalPacks.js";
import {
  assembleRegionalPack, type RegionalPackAssembly, type RegionalPackPorts, type RegionalPackCatalogue,
} from "../world/regionalPackEntities.js";

export const REGIONAL_PACK_LAB_CENTRE: readonly [number, number] = [-72, 30];

export interface RegionalPackFixture extends RegionalPackAssembly {
  readonly spawn: Vec3;
}

/** Translate the whole authored encounter into the west yard. Member IDs, offsets, stats,
 * sizes and the production activity circuit stay intact; the root injects the returned habitat.
 */
export function assembleRegionalPackFixture(
  packId: string, ports: RegionalPackPorts,
  catalogue?: RegionalPackCatalogue,
): RegionalPackFixture {
  const pack = (catalogue?.packs ?? REGIONAL_PACKS).find((candidate) => candidate.id === packId);
  if (!pack) throw new Error(`Unknown regional pack fixture: ${packId}`);
  const assembly = assembleRegionalPack(packId, ports, {
    translation: [REGIONAL_PACK_LAB_CENTRE[0] - pack.centre[0], REGIONAL_PACK_LAB_CENTRE[1] - pack.centre[1]],
    regionId: "fallowmarch",
  }, catalogue);
  // Enter from the setting's open +Z approach, facing its supply cache or shrine from the front.
  const spawn: Vec3 = [-72, ports.heightAt(-72, 60), 60];
  if (!spawn.every(Number.isFinite)) throw new Error(`Regional pack fixture has invalid player grounding: ${packId}`);
  return { ...assembly, spawn };
}
