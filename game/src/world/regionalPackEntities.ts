import type { RegionId, SemanticEntity, Vec3 } from "../contracts.js";
import {
  REGIONAL_PACKS, REGIONAL_PACK_GROUPS, REGIONAL_PACK_HABITATS, REGIONAL_PACK_VARIANTS,
  type RegionalPackDef, type RegionalPackVariant,
} from "../content/regionalPacks.js";
import type { EnemyGroupDef } from "../content/regions.js";
import type { HabitatDef } from "../content/worldHabitats.js";
import { Rng } from "../core/rng.js";
import { hashId } from "./habitatMovement.js";
import { buildEnemyGroup, type AssetSize } from "./regionBuilder.js";

export interface RegionalPackPorts {
  readonly heightAt: (x: number, z: number) => number;
  readonly baseY: (assetId: string) => number;
  readonly assetSize: (assetId: string) => AssetSize | null;
}

export interface RegionalPackPlacement {
  /** World-space offset, applied equally to the centre and every spawn/activity anchor. */
  readonly translation?: readonly [number, number];
  readonly regionId?: RegionId;
  /** Combined with the stable pack ID; other packs never consume this stream. */
  readonly seed?: number;
}

export interface RegionalPackAssembly {
  readonly entities: SemanticEntity[];
  readonly habitat: HabitatDef;
  readonly packId: string;
}

export interface RegionalPackCatalogue {
  readonly packs: readonly RegionalPackDef[];
  readonly groups: readonly EnemyGroupDef[];
  readonly habitats: readonly HabitatDef[];
  readonly variants: readonly RegionalPackVariant[];
}

const packs = new Map(REGIONAL_PACKS.map((pack) => [pack.id, pack]));
const groups = new Map(REGIONAL_PACK_GROUPS.map((group) => [group.id, group]));
const habitats = new Map(REGIONAL_PACK_HABITATS.map((habitat) => [habitat.groupId, habitat]));
const variants = new Map(REGIONAL_PACK_VARIANTS.map((variant) => [variant.id, variant]));

/** Construct one authored pack through the same production path as ordinary enemy groups.
 * This returns data only. The caller registers its stats, habitat and entities together.
 */
export function assembleRegionalPack(
  packId: string,
  ports: RegionalPackPorts,
  placement: RegionalPackPlacement = {},
  catalogue?: RegionalPackCatalogue,
): RegionalPackAssembly {
  const pack = catalogue ? catalogue.packs.find((row) => row.id === packId) : packs.get(packId);
  const sourceGroup = catalogue ? catalogue.groups.find((row) => row.id === packId) : groups.get(packId);
  const sourceHabitat = catalogue ? catalogue.habitats.find((row) => row.groupId === packId) : habitats.get(packId);
  if (!pack || !sourceGroup || !sourceHabitat) throw new Error(`Unknown regional pack: ${packId}`);
  const [dx, dz] = placement.translation ?? [0, 0];
  const seed = placement.seed ?? 0;
  if (![dx, dz, seed].every(Number.isFinite)) throw new Error(`Invalid regional pack placement: ${packId}`);
  const regionId = placement.regionId ?? pack.regionId;
  const translate = (point: readonly [number, number]): readonly [number, number] =>
    [point[0] + dx, point[1] + dz];
  const habitat: HabitatDef = {
    ...sourceHabitat,
    regionId,
    centre: translate(sourceHabitat.centre),
    anchors: sourceHabitat.anchors.map(translate),
    dressing: sourceHabitat.dressing.map((piece) => ({ ...piece, x: piece.x + dx, z: piece.z + dz })),
  };
  const group = { ...sourceGroup, centre: translate(sourceGroup.centre) };
  const measuredSize = ports.assetSize(group.assetId);
  const measuredBaseY = ports.baseY(group.assetId);
  if (!measuredSize || ![measuredSize.x, measuredSize.y, measuredSize.z]
    .every((value) => Number.isFinite(value) && value > 0) || !Number.isFinite(measuredBaseY)) {
    throw new Error(`Regional pack requires finite model measurements: ${group.assetId}`);
  }
  const members = pack.members.map((member, index) => {
    const variant = catalogue ? catalogue.variants.find((row) => row.id === member.variantId) : variants.get(member.variantId);
    if (!variant || variant.baseEnemyDefId !== pack.baseEnemyDefId || member.anchorIndex !== index) {
      throw new Error(`Regional pack has an invalid member binding: ${member.id}`);
    }
    return { id: member.id, stats: variant.stats, scaleMultiplier: variant.scaleMultiplier };
  });
  const entities: SemanticEntity[] = [];
  const place = (point: readonly [number, number], _assetId: string, drawnScale: number): Vec3 => {
    const groundY = ports.heightAt(point[0], point[1]);
    const y = groundY - measuredBaseY * drawnScale;
    if (![point[0], point[1], y].every(Number.isFinite)) {
      throw new Error(`Regional pack has invalid grounding: ${packId}`);
    }
    // Match the production placer: preserve authored XZ and round grounded Y to centimetres.
    return [point[0], Math.round(y * 100) / 100, point[1]];
  };
  buildEnemyGroup(regionId, group, new Rng((hashId(packId) ^ seed) >>> 0),
    place, entities, () => measuredSize, { habitat, members });
  return { entities, habitat, packId };
}
