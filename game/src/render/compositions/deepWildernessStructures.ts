import type { PartPlacement } from '../buildings.js';
import { WILDERNESS_EXPANSION_SITES } from '../../content/wildernessDepth.js';

export const DEEP_WILDERNESS_STRUCTURE_IDS = [
  'cinder_chain_foundry', 'nightforge_bastion', 'hollow_star_sanctum',
] as const;
export type DeepWildernessStructureId = typeof DEEP_WILDERNESS_STRUCTURE_IDS[number];
type Point = readonly [number, number];
type TorchMount = {
  readonly position: readonly [number, number, number];
  readonly yaw: number;
  readonly theme: 'ember' | 'azure' | 'violet';
};
export interface DeepWildernessCourt {
  readonly id: string;
  readonly centre: Point;
  /** No drawn solid taller than 0.45 m enters this circle. */
  readonly radius: number;
  /** Fifteen disjoint 1.1 m body sockets. Use fewer sockets for larger creatures. */
  readonly residentSockets: readonly Point[];
  readonly maxBodyRadius: 1.1;
}
export interface DeepWildernessStructureDefinition {
  readonly name: string;
  readonly footprint: readonly [number, number];
  readonly clearThrough: readonly [Point, Point];
  readonly clearWidth: number;
  readonly courts: readonly DeepWildernessCourt[];
  readonly keeper: { readonly centre: Point; readonly radius: number };
  readonly torches: readonly TorchMount[];
  /** Grounded player positions for ordinary-camera acceptance, never detached views. */
  readonly inspectionStops: readonly Point[];
}

function court(id: string, centre: Point, radius: number): DeepWildernessCourt {
  const spacing = radius === 7 ? 2.55 : 3;
  const residentSockets: Point[] = [];
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
    if (row === 0 && column === 0) continue;
    residentSockets.push([centre[0] + (column - 1.5) * spacing,
      centre[1] + (row - 1.5) * spacing]);
  }
  return { id, centre, radius, residentSockets, maxBodyRadius: 1.1 };
}

const footprint = (id: DeepWildernessStructureId) => WILDERNESS_EXPANSION_SITES.find(site => site.id === id)!.footprint;
export const DEEP_WILDERNESS_STRUCTURES: Readonly<Record<DeepWildernessStructureId, DeepWildernessStructureDefinition>> = {
  cinder_chain_foundry: {
    name: 'Cinder Chain Foundry', footprint: footprint('cinder_chain_foundry'),
    clearThrough: [[0, 30], [0, -30]], clearWidth: 10,
    courts: [court('west_casting_yard', [-16, 0], 8), court('east_chain_yard', [16, 0], 8),
      court('forecourt', [0, 17], 7)], keeper: { centre: [0, -15], radius: 5 },
    torches: [
      { position: [-6.1, 2.2, 25.1], yaw: 0, theme: 'ember' },
      { position: [6.1, 2.2, 25.1], yaw: 0, theme: 'ember' },
      { position: [-16.7, 1.6, -19.42], yaw: 0, theme: 'ember' },
      { position: [16.7, 1.6, -19.42], yaw: 0, theme: 'ember' },
      { position: [-29.27, 2, 4], yaw: Math.PI / 2, theme: 'ember' },
      { position: [29.27, 2, -4], yaw: -Math.PI / 2, theme: 'azure' },
    ], inspectionStops: [[0, 32], [-16, 8], [16, -8], [0, -15]],
  },
  nightforge_bastion: {
    name: 'Nightforge Bastion', footprint: footprint('nightforge_bastion'),
    clearThrough: [[0, 34], [0, -34]], clearWidth: 10,
    courts: [court('west_muster', [-16, 1], 9), court('east_muster', [16, 1], 9),
      court('gate_court', [0, 19], 7)], keeper: { centre: [0, -15], radius: 5 },
    torches: [
      { position: [-6.1, 2.4, 29.1], yaw: 0, theme: 'azure' },
      { position: [6.1, 2.4, 29.1], yaw: 0, theme: 'azure' },
      { position: [-30.01, 2.4, 0], yaw: Math.PI / 2, theme: 'azure' },
      { position: [30.01, 2.4, 0], yaw: -Math.PI / 2, theme: 'violet' },
      { position: [-6.1, 2.4, -26.9], yaw: 0, theme: 'violet' },
      { position: [6.1, 2.4, -26.9], yaw: 0, theme: 'violet' },
    ], inspectionStops: [[0, 36], [-16, 7], [16, -6], [0, -15]],
  },
  hollow_star_sanctum: {
    name: 'Hollow Star Sanctum', footprint: footprint('hollow_star_sanctum'),
    clearThrough: [[0, 34], [0, -34]], clearWidth: 10,
    courts: [court('west_vespers', [-17, 1], 9), court('east_vespers', [17, 1], 9),
      court('pilgrims_court', [0, 19], 7)], keeper: { centre: [0, -15], radius: 5 },
    torches: [
      { position: [-6.1, 2.1, 28.1], yaw: 0, theme: 'violet' },
      { position: [6.1, 2.1, 28.1], yaw: 0, theme: 'azure' },
      { position: [-30.1, 1.6, 0], yaw: Math.PI / 2, theme: 'violet' },
      { position: [30.1, 1.6, 0], yaw: -Math.PI / 2, theme: 'azure' },
      { position: [-6.1, 2.1, -26.9], yaw: 0, theme: 'azure' },
      { position: [6.1, 2.1, -26.9], yaw: 0, theme: 'violet' },
    ], inspectionStops: [[0, 36], [-17, 8], [17, -5], [0, -15]],
  },
};

const COURSE = .62;
const TORCH_SCALE = 1.7;

/** Existing measured production kit only. Decorative fragments never become giant AABB walls. */
function recipe(collisionOnly: boolean) {
  const parts: PartPlacement[] = [];
  const place = (tag: string, assetId: string, x: number, y: number, z: number,
    yaw = 0, scale = 1, axes?: readonly [number, number, number]) => {
    parts.push({ tag, assetId, dx: x, dy: y, dz: z, rotationY: yaw, scale,
      ...(axes ? { scaleAxes: axes } : {}) });
  };
  const stone = (tag: string, x: number, y: number, z: number, width: number,
    height: number, depth: number, yaw = 0) => {
    if (collisionOnly && (y > .45 || height <= .45)) return;
    place(tag, 'kerb_straight', x - Math.sin(yaw) * depth / 2, y,
      z - Math.cos(yaw) * depth / 2, yaw, 1, [width / 2, height / .134, depth / .7]);
  };
  const pier = (tag: string, x: number, z: number, height: number, width = 2.4, depth = 2.4) => {
    if (collisionOnly) { stone(`${tag}_solid`, x, 0, z, width + .5, height, depth + .5); return; }
    stone(`${tag}_foot`, x, 0, z, width + .5, .38, depth + .5);
    const courses = Math.ceil(height / COURSE), rise = height / courses;
    for (let i = 0; i < courses; i++) stone(`${tag}_course_${i}`, x, i * rise, z, width, rise, depth);
    stone(`${tag}_capital`, x, height, z, width + .35, .32, depth + .35);
  };
  const wall = (tag: string, x: number, z: number, heights: readonly number[], yaw = 0,
    depth = 1.5, module = 3) => {
    heights.forEach((height, column) => {
      const along = (column - (heights.length - 1) / 2) * module;
      const px = x + Math.cos(yaw) * along, pz = z - Math.sin(yaw) * along;
      if (collisionOnly) { stone(`${tag}_${column}_solid`, px, 0, pz, module, height, depth, yaw); return; }
      const courses = Math.ceil(height / COURSE), rise = height / courses;
      for (let row = 0; row < courses; row++) {
        const split = row % 2 ? .43 : .57;
        for (const [half, width, offset] of [[0, module * split, -module * (1 - split) / 2],
          [1, module * (1 - split), module * split / 2]] as const) {
          stone(`${tag}_${column}_${row}_${half}`, px + Math.cos(yaw) * offset,
            row * rise, pz - Math.sin(yaw) * offset, width, rise, depth, yaw);
        }
      }
    });
  };
  // The 10 m opening is clear to 5.6 m. Each corbel overlaps its bearing by at least 1.7 m.
  const portal = (tag: string, z: number, height = 5.6) => {
    for (const side of [-1, 1]) {
      pier(`${tag}_${side}`, side * 6.5, z, height, 2.4, 2.4);
      if (!collisionOnly) for (let i = 0; i < 7; i++) {
        const inner = 5.2 - (i + 1) * .64, width = 7.6 - inner;
        stone(`${tag}_corbel_${side}_${i}`, side * (inner + width / 2), height + i * COURSE,
          z, width, COURSE, 2.4);
      }
    }
    if (!collisionOnly) stone(`${tag}_keystone`, 0, height + 7 * COURSE, z, 15.2, .62, 2.4);
  };
  const rubble = (tag: string, x: number, z: number, index: number, scale = 3.5) => {
    if (collisionOnly) return;
    const shape = index % 4, bases = [.11, .112, .115, .115];
    place(tag, `rubble_brick_${shape + 1}`, x, bases[shape]! * scale - .015, z,
      index * 2.39996, scale);
  };
  const prop = (tag: string, assetId: string, x: number, y: number, z: number, yaw = 0,
    scale = 1, axes?: readonly [number, number, number]) => {
    if (!collisionOnly) place(tag, assetId, x, y, z, yaw, scale, axes);
  };
  return { parts, stone, pier, wall, portal, rubble, prop };
}

function foundry(collisionOnly: boolean): PartPlacement[] {
  const r = recipe(collisionOnly);
  r.wall('west_boundary', -30, 0, [1.86, 2.48, 3.1, 3.72, 3.1, 2.48, 2.48, 3.1, 3.72, 2.48, 1.86, 1.24], Math.PI / 2);
  r.wall('east_boundary', 30, 0, [1.24, 1.86, 2.48, 2.48, 3.1, 3.72, 3.1, 2.48, 1.86, 1.24, .62, 1.24], Math.PI / 2);
  for (const side of [-1, 1]) {
    r.wall(`front_${side}`, side * 20, 24, [1.24, 1.86, 2.48, 3.1, 2.48, 1.86], 0);
    r.wall(`rear_${side}`, side * 20, -24, [3.1, 4.34, 5.58, 6.2, 4.96, 3.72], 0);
    r.pier(`gate_buttress_${side}`, side * 6.5, 24, 4.34, 2.4, 2.4);
    // A furnace has two heavy cheeks, a blackened back, a supported hood and a tall flue.
    const x = side * 20;
    r.stone(`furnace_${side}_hearth`, x, 0, -21.3, 8, .36, 5.2);
    for (const cheek of [-1, 1]) r.pier(`furnace_${side}_cheek_${cheek}`, x + cheek * 3.3, -21.5, 3.1, 1.4, 4.2);
    r.stone(`furnace_${side}_back`, x, 0, -23.4, 6, 4.34, 1.2);
    if (!collisionOnly) {
      for (let course = 0; course < 4; course++) r.stone(`furnace_${side}_hood_${course}`,
        x, 3.1 + course * .62, -21.5, 8 - course * .7, .62, 4.2);
      // The native village chimney has a pointed underside for a pitched roof. These flat
      // furnace hoods instead carry a broad, continuous masonry flue with damage at its crown.
      const flueZ = -21.8, flueCourses = side < 0 ? 11 : 8;
      r.stone(`furnace_${side}_flue_bed`, x, 4.96, flueZ, 3.4, .62, 3.4);
      for (let course = 0; course < flueCourses; course++) {
        const y = 5.58 + course * COURSE;
        for (const face of [-1, 1]) {
          r.stone(`furnace_${side}_flue_face_${face}_${course}`, x, y, flueZ + face * 1.22, 3, COURSE, .56);
          r.stone(`furnace_${side}_flue_side_${face}_${course}`, x + face * 1.22, y, flueZ, .56, COURSE, 1.88);
        }
      }
      const crownY = 5.58 + flueCourses * COURSE;
      for (const face of [-1, 1]) for (const half of [-1, 1]) {
        const rise = face < 0 ? (half === side ? 1.24 : .62) : (half === side ? .62 : .31);
        r.stone(`furnace_${side}_flue_crown_${face}_${half}`, x + half * .75,
          crownY, flueZ + face * 1.22, 1.5, rise, .56);
      }
      for (const face of [-1, 1]) r.stone(`furnace_${side}_flue_crown_side_${face}`,
        x + face * 1.22, crownY, flueZ, .56, face === side ? .93 : .62, 1.88);
      r.prop(`furnace_${side}_chain`, 'chain_coil', x - 1.1, .355, -20.2, .4, 2.2);
      r.prop(`furnace_${side}_cauldron`, 'cauldron', x + 1.7, .364, -20.3, .2, 1.8);
    }
    // Side workshops preserve casting moulds, chains, iron bars and abandoned tools.
    for (let bay = 0; bay < 3; bay++) {
      const z = -10 + bay * 9;
      r.stone(`casting_${side}_${bay}_bed`, side * 27.2, 0, z, 2.2, .5, 4);
      r.prop(`casting_${side}_${bay}_iron`, 'crate_metal', side * 27.2, .5, z - .65, .2, 1.5);
      r.prop(`casting_${side}_${bay}_chain`, 'chain_coil', side * 27.2, .495, z + 1, .9, 1.6);
    }
    r.prop(`anvil_${side}`, 'anvil_log', side * 25.6, -.001, 16, .3, 1.7);
    r.prop(`whetstone_${side}`, 'whetstone', side * 27.7, -.004, 19, side, 1.5);
    for (let i = 0; i < 8; i++) r.rubble(`fallen_slag_${side}_${i}`, side * (10.2 + i * 2.5),
      -26.5 + (i % 2) * .1, i + (side + 1) * 4, 3 + (i % 3));
  }
  r.portal('chain_arch', -25, 5.6);
  return r.parts;
}

function bastion(collisionOnly: boolean): PartPlacement[] {
  const r = recipe(collisionOnly);
  // Low side curtains permit gameplay views into the court. The rear towers carry the skyline.
  r.wall('west_curtain', -31, 0, [3.72, 4.34, 4.96, 4.34, 3.72, 3.72, 4.34, 4.96, 4.34, 3.72, 3.1, 3.72, 4.34, 3.72], Math.PI / 2, 2);
  r.wall('east_curtain', 31, 0, [3.1, 3.72, 4.34, 4.96, 4.34, 3.72, 4.34, 3.72, 3.1, 3.72, 4.34, 3.72, 3.1, 3.72], Math.PI / 2, 2);
  for (const side of [-1, 1]) {
    r.wall(`front_curtain_${side}`, side * 20, 28, [3.1, 3.72, 4.34, 4.34, 3.72, 3.1], 0, 2);
    r.wall(`rear_curtain_${side}`, side * 20, -28, [5.58, 6.2, 6.82, 6.2, 5.58, 4.96], 0, 2);
    for (const front of [-1, 1]) {
      const x = side * 28, z = front * 25, height = front < 0 ? 11.16 : 6.2;
      r.pier(`corner_tower_${side}_${front}`, x, z, height, 6, 6);
      if (!collisionOnly) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        r.stone(`tower_crown_${side}_${front}_${sx}_${sz}`, x + sx * 2.1, height + .32,
          z + sz * 2.1, 1.8, 1.24, 1.8);
      }
    }
    r.pier(`rear_sentinel_${side}`, side * 13, -25, side < 0 ? 14.26 : 11.78, 6, 6);
    for (const x of [10.5, 15.5]) r.pier(`sentinel_buttress_${side}_${x}`, side * x, -21.5, 5.58, 1.6, 2);
    if (!collisionOnly) {
      const h = side < 0 ? 14.26 : 11.78;
      r.prop(`sentinel_spire_${side}`, 'roof_tower', side * 13, h + .32 + .572 * .98, -25, 0, .98);
      r.prop(`arsenal_${side}`, 'weapon_rack', side * 28.5, .003, -11, Math.PI / 2, 1.8);
      r.prop(`iron_cage_${side}`, 'cage', side * 28.6, .084, 10, .1, 2);
      for (let i = 0; i < 6; i++) r.prop(`iron_fence_${side}_${i}`, 'fence_metal_ornate',
        side * 29.8, 0, -7 + i * 2.6, Math.PI / 2, 1.2);
    }
    for (let i = 0; i < 7; i++) r.rubble(`siege_fall_${side}_${i}`, side * (10.7 + i * 2.5),
      30.1 - (i % 2) * .5, i, 3 + i % 2);
  }
  r.portal('outer_gate', 28, 5.6);
  r.portal('inner_gate', -28, 6.84);
  return r.parts;
}

function sanctum(collisionOnly: boolean): PartPlacement[] {
  const r = recipe(collisionOnly);
  // A broken twelve-column ambulatory surrounds three broad courts. Its unequal columns and
  // surviving rib heads describe the vanished observatory dome without covering combat views.
  for (const side of [-1, 1]) {
    r.wall(`ambulatory_${side}`, side * 32, 0, [1.24, 1.86, 2.48, 1.86, 1.24, .62, 1.24, 1.86, 2.48, 1.24], Math.PI / 2, 1.6);
    for (const [index, x, z, height] of [
      [0, 31, 0, 5.58], [1, 30, -15, 8.06], [2, 25, -24, 10.54],
      [3, 14, -28, 13.02], [4, 30, 15, 3.72], [5, 23, 25, 6.2],
    ] as const) {
      r.pier(`observatory_${side}_${index}`, side * x, z, height, 2.8, 2.8);
      if (!collisionOnly) {
        for (let step = 0; step < 3; step++) r.stone(`rib_${side}_${index}_${step}`,
          side * (x - .55 * step), height + .32 + step * .62, z, 2.8 + step * .6, .62, 2.8);
      }
    }
    r.wall(`rear_aperture_${side}`, side * 20, -28, [3.72, 4.96, 6.2, 7.44, 5.58, 3.72], 0, 1.8);
    r.wall(`entry_remnant_${side}`, side * 19, 27, [1.24, 1.86, 3.1, 2.48, 1.86], 0, 1.5);
    r.stone(`astral_altar_${side}_plinth`, side * 12, 0, -18, 5.4, .35, 3.2);
    r.prop(`astral_altar_${side}`, 'altar_ruins_altar', side * 12, .3345, -18, 0, 2);
    r.prop(`observatory_candle_${side}`, 'candle_stand', side * 14, .362, -18, 0, 1.7);
    r.prop(`lost_instrument_${side}`, 'chandelier', side * 24.2, 2.533, 18.5, .2, 1.5);
    r.stone(`instrument_pedestal_${side}`, side * 24.2, 0, 18.5, 2, .4, 2);
    for (let i = 0; i < 9; i++) r.rubble(`vault_fall_${side}_${i}`,
      side * (29 + (i % 2) * .15), -22 + i * 5.7, i, 3.5 + i % 3);
  }
  // The broken star is inlaid flush enough to walk over. It marks the keeper's arena while
  // leaving every approach and every pack's body clearance unchanged.
  for (let i = 0; i < 16; i++) {
    const angle = i / 16 * Math.PI * 2;
    r.stone(`ritual_ring_${i}`, Math.sin(angle) * 8, 0, -15 + Math.cos(angle) * 8,
      2.8, .08, .5, angle + Math.PI / 2);
  }
  for (const side of [-1, 1]) r.stone(`star_arm_${side}`, side * 3, 0, -15, 6.5, .06, .5, side * .55);
  r.portal('pilgrim_portal', 27, 5.6);
  r.portal('zenith_portal', -28, 6.84);
  return r.parts;
}

const BUILDERS = { cinder_chain_foundry: foundry, nightforge_bastion: bastion, hollow_star_sanctum: sanctum };

/** Production navigation uses merged ground-bearing solids from these same recipes. */
export function buildDeepWildernessStructureCollisionParts(id: DeepWildernessStructureId): PartPlacement[] {
  return BUILDERS[id](true);
}

export function buildDeepWildernessStructure(id: DeepWildernessStructureId): PartPlacement[] {
  const parts = BUILDERS[id](false);
  DEEP_WILDERNESS_STRUCTURES[id].torches.forEach((mount, index) => {
    parts.push({ tag: `mounted_torch_${index}`, assetId: 'torch', dx: mount.position[0],
      dy: mount.position[1], dz: mount.position[2], rotationY: mount.yaw, scale: TORCH_SCALE });
  });
  return parts;
}
