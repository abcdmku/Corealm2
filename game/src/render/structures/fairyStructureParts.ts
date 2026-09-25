import type { PartPlacement, PrefabId } from '../buildings.js';
import { MARKET_STALL_ASSETS } from './stall.js';

/** This authored recipe remains selectable in the building lab through its normal stable seed. */
export const LANTERN_MARKET_SEED = 4107510004;
const COTTAGE_SEEDS = new Set([
  2581683547, // Lantern Rest: Willow
  2829961531, // Moss
  3781720648, // Moonpetal
  2859835434, // Orchid
  2010098969, // Dewglass
  2503148399, // Prism Hollow: Root
  2120188044, // Orchid
  2357906514, // Moon
]);
export const LANTERN_MARKET_STALLS = [
  { x: -4.2, z: 2, yaw: .15 },
  { x: 0, z: -.8, yaw: 0 },
  { x: 4.2, z: 2, yaw: -.18 },
] as const;

function part(tag: string, assetId: string, dx: number, dy: number, dz: number, rotationY = 0, scale = 1): PartPlacement {
  return { tag, assetId, dx, dy, dz, rotationY, scale };
}

export function fairyStructureParts(
  prefab: PrefabId,
  footprint: readonly [number, number],
  seed: number,
  base: PartPlacement[],
): PartPlacement[] {
  if (prefab === 'cottage' && COTTAGE_SEEDS.has(seed >>> 0)
    && Math.max(...footprint) === 6 && Math.min(...footprint) === 4) {
    const door = base.find(piece => /^w2_/.test(piece.tag) && piece.assetId.includes('_door'));
    if (!door) return base;
    const yaw = door.rotationY;
    // Native fieldstone kerbs make two shallow risers. The upper course enters the wall by .22 m.
    const result = [...base,
      part('fairy_doorstep_lower', 'kerb_straight', door.dx + Math.sin(yaw) * 1.27,
        door.dy - .012, door.dz + Math.cos(yaw) * 1.27, yaw + Math.PI),
      part('fairy_doorstep_upper', 'kerb_straight', door.dx + Math.sin(yaw) * .57,
        door.dy + .12, door.dz + Math.cos(yaw) * .57, yaw + Math.PI),
    ];
    if (!base.some(piece => piece.assetId === 'lamp_wall')) {
      // Same placement as the measured cottage entryLamp fixture. Its glass hangs below the eave.
      const along = door.dx < -.5 ? -1.18 : 1.18;
      result.push(part('fairy_entry_lamp', 'lamp_wall',
        door.dx + Math.sin(yaw) * .121 + Math.cos(yaw) * along,
        door.dy + 2.02,
        door.dz + Math.cos(yaw) * .121 - Math.sin(yaw) * along,
        yaw, .45));
    }
    return result;
  }
  if (prefab !== 'market_row' || (seed >>> 0) !== LANTERN_MARKET_SEED
    || ![9, 12].includes(footprint[0]) || footprint[1] !== 3) return base;
  return LANTERN_MARKET_STALLS.map((stall, index) => part(
    `stall${index}`, MARKET_STALL_ASSETS[[1, 5, 0][index]!]!,
    stall.x, 0, stall.z, stall.yaw,
  ));
}
