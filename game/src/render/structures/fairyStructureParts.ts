import type { PartPlacement, PrefabId } from '../buildings.js';

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
/** Measured from all ten upward-facing counter planks in the source GLB. */
export const LANTERN_MARKET_COUNTER_Y = .82855;

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
  const result: PartPlacement[] = [];
  for (const [index, stall] of LANTERN_MARKET_STALLS.entries()) {
    result.push(part(`stall${index}`, 'market_stall', stall.x, 0, stall.z, stall.yaw));
    for (const side of [-1, 1]) {
      const x = side * .845, z = -.85;
      result.push({ ...part(`fairy_stall_rear_post_${index}_${side}`, 'corner_wood',
        stall.x + Math.cos(stall.yaw) * x + Math.sin(stall.yaw) * z,
        0,
        stall.z - Math.sin(stall.yaw) * x + Math.cos(stall.yaw) * z,
        stall.yaw), scaleAxes: [.55, 2.8 / 3, .55] });
    }
    const localX = .845, localZ = .35;
    result.push(part(`fairy_stall_lamp_${index}`, 'lamp_wall',
      stall.x + Math.cos(stall.yaw) * localX + Math.sin(stall.yaw) * localZ,
      1.28,
      stall.z - Math.sin(stall.yaw) * localX + Math.cos(stall.yaw) * localZ,
      stall.yaw + Math.PI / 2, .9));
    const localPart = (tag: string, assetId: string, x: number, dy: number, z: number, yaw: number, scale: number) => part(
      `fairy_goods_${index}_${tag}`, assetId,
      stall.x + Math.cos(stall.yaw) * x + Math.sin(stall.yaw) * z,
      dy,
      stall.z - Math.sin(stall.yaw) * x + Math.cos(stall.yaw) * z,
      stall.yaw + yaw, scale,
    );
    // Five wares on the actual .82855 m counter and three containers beside its legs.
    // Each source's base-Y offset is included so crates and sacks rest on the planks.
    result.push(
      localPart('counter_apples', 'farm_crate_apple', -.38, LANTERN_MARKET_COUNTER_Y + .016 * .94, -.15, 0, .94),
      localPart('counter_carrots', 'farm_crate_carrot', .4, LANTERN_MARKET_COUNTER_Y + .016 * .88, -.1, 0, .88),
      ...[-.54, -.01, .5].map((x, slot) => localPart(`counter_sack_${slot}`, 'sack_large', x,
        LANTERN_MARKET_COUNTER_Y - .001 * 1.5, .28, slot === 1 ? .06 : -.04, 1.5)),
    );
    const side = index === 2 ? 1 : -1;
    result.push(
      localPart('floor_barrel', index === 1 ? 'barrel_apples' : 'barrel', side * 1.15, -.003 * .86, -.1, .12, .86),
      localPart('floor_sack', 'sack', side * 1.25, -.002 * .87, .53, -.17, .87),
      localPart('floor_crate', 'crate_wood', side * .63, .052 * .54, .83, .15, .54),
    );
  }
  return result;
}
