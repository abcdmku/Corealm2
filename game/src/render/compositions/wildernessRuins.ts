import type { PartPlacement } from '../buildings.js';

export const WILDERNESS_RUIN_IDS = [
  'wilderness_broken_watchtower',
  'wilderness_roofless_abbey',
  'wilderness_ruined_smithy',
  'wilderness_shattered_aqueduct',
] as const;
export type WildernessRuinId = typeof WILDERNESS_RUIN_IDS[number];

type TorchMount = { readonly position: readonly [number, number, number]; readonly yaw: number };
type RuinDefinition = {
  readonly name: string;
  readonly footprint: readonly [number, number];
  readonly clearThrough: readonly [readonly [number, number], readonly [number, number]];
  readonly torches: readonly TorchMount[];
};

/** Footprints include fallen masonry. All recipes face +Z and leave a ground-level passage. */
export const WILDERNESS_RUINS: Readonly<Record<WildernessRuinId, RuinDefinition>> = {
  wilderness_broken_watchtower: {
    name: 'Broken watchtower', footprint: [22, 20], clearThrough: [[0, 12], [0, -12]],
    torches: [{ position: [-3.6, 1.9, 4.54], yaw: 0 }, { position: [3.6, 1.7, -4.54], yaw: Math.PI },
      { position: [-4.06, 5.3, -2.8], yaw: Math.PI / 2 }],
  },
  wilderness_roofless_abbey: {
    name: 'Roofless abbey', footprint: [28, 34], clearThrough: [[0, 18], [0, -18]],
    torches: [{ position: [-4.8, 2.1, 11.54], yaw: 0 }, { position: [4.8, 2.1, -11.54], yaw: Math.PI },
      { position: [-7.96, 1.8, 0], yaw: Math.PI / 2 }],
  },
  wilderness_ruined_smithy: {
    name: 'Ruined smithy', footprint: [30, 22], clearThrough: [[0, 13], [0, -13]],
    torches: [{ position: [-3.46, 1.8, 3], yaw: Math.PI / 2 }, { position: [3.46, 1.8, -3], yaw: -Math.PI / 2 }],
  },
  wilderness_shattered_aqueduct: {
    name: 'Shattered aqueduct', footprint: [42, 16], clearThrough: [[0, 10], [0, -10]],
    torches: [{ position: [-3.8, 1.9, 1.04], yaw: 0 }, { position: [3.8, 1.9, -1.04], yaw: Math.PI }],
  },
};

const STONE_COURSE = .46;
const TORCH_SCALE = 1.55;

function recipe(collisionOnly = false) {
  const parts: PartPlacement[] = [];
  const place = (tag: string, assetId: string, x: number, y: number, z: number,
    yaw = 0, scale = 1, axes?: readonly [number, number, number]) => {
    if (collisionOnly && /^(?:rubble|chain|torch)/.test(assetId)) return;
    parts.push({ tag, assetId, dx: x, dy: y, dz: z, rotationY: yaw, scale,
      ...(axes ? { scaleAxes: axes } : {}) });
  };
  // kerb_straight is solid dressed stone, 2 x .134 x .7 m, with its depth entirely on +Z.
  // Centre the measured solid before yawing it. Stone courses retain their actual thickness.
  const stone = (tag: string, x: number, y: number, z: number, width: number, height: number,
    depth: number, yaw = 0) => {
    if (collisionOnly && (y > .45 || height <= .45 || tag.startsWith('stair_'))) return;
    place(tag, 'kerb_straight', x - Math.sin(yaw) * depth / 2, y,
      z - Math.cos(yaw) * depth / 2, yaw, 1, [width / 2, height / .134, depth / .7]);
  };
  const fracturedStone = (tag: string, x: number, y: number, z: number, width: number,
    height: number, depth: number, yaw: number, shape: number) => {
    const sizes = [[.346, .208, .25], [.395, .245, .217], [.381, .25, .216], [.257, .25, .216]];
    const bases = [[-.168, -.11, -.125], [-.19, -.112, -.108], [-.183, -.115, -.109], [-.128, -.115, -.113]];
    const size = sizes[shape]!, base = bases[shape]!;
    const axes = [width / size[0]!, height / size[1]!, depth / size[2]!] as const;
    const cx = (base[0]! + size[0]! / 2) * axes[0];
    const cz = (base[2]! + size[2]! / 2) * axes[2];
    place(tag, `rubble_brick_${shape + 1}`, x - cx * Math.cos(yaw) - cz * Math.sin(yaw),
      y - base[1]! * axes[1], z + cx * Math.sin(yaw) - cz * Math.cos(yaw), yaw, 1, axes);
  };
  // Unequal surviving course counts produce the torn wall profile. No upper stone floats over
  // a missing lower course. Alternating end lengths leave recognizable masonry bonds.
  const wall = (tag: string, x: number, z: number, heights: readonly number[], yaw = 0,
    depth = 1.1, module = 1.8,
    openings: readonly { column: number; bottom: number; top: number; width: number }[] = []) => {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    for (let column = 0; column < heights.length; column++) {
      const along = (column - (heights.length - 1) / 2) * module;
      const nominal = heights[column]!;
      const topAt = (offset: number, piece: number) => {
        const neighbour = heights[Math.max(0, Math.min(heights.length - 1, column + (offset < 0 ? -1 : 1)))]!;
        const height = nominal + (neighbour - nominal) * Math.abs(offset) / module;
        const loss = height > 1.5 ? (column * 13 + piece * 7 + tag.length) % 2 : 0;
        return Math.max(1, Math.floor(height / STONE_COURSE) - loss);
      };
      const surviving = Math.max(topAt(-module * .285, 0), topAt(-module * .215, 0),
        topAt(module * .285, 1), topAt(module * .215, 1));
      const opening = openings.find(row => row.column === column);
      if (collisionOnly) {
        if (opening) {
          const jamb = (module - opening.width) / 2;
          for (const side of [-1, 1]) {
            const a = along + side * (opening.width + jamb) / 2;
            stone(`${tag}_${column}_jamb_solid_${side}`, x + a * cos, 0, z - a * sin,
              jamb, surviving * STONE_COURSE, depth, yaw);
          }
          stone(`${tag}_${column}_sill_solid`, x + along * cos, 0, z - along * sin,
            opening.width, opening.bottom, depth, yaw);
        } else stone(`${tag}_${column}_solid`, x + along * cos, 0, z - along * sin,
          module, surviving * STONE_COURSE, depth, yaw);
        continue;
      }
      for (let course = 0; course < surviving; course++) {
        if (opening && course * STONE_COURSE >= opening.bottom - .001 &&
            course * STONE_COURSE < opening.top - .001) {
          const jamb = (module - opening.width) / 2;
          for (const side of [-1, 1]) {
            const a = along + side * (opening.width + jamb) / 2;
            stone(`${tag}_${column}_${course}_jamb_${side}`, x + a * cos, course * STONE_COURSE,
              z - a * sin, jamb, STONE_COURSE, depth, yaw);
          }
          continue;
        }
        // Course seams stagger inside each module without opening structural gaps.
        const split = course % 2 === 0 ? .57 : .43;
        for (const [piece, width, offset] of [
          [0, module * split, -module * (1 - split) / 2],
          [1, module * (1 - split), module * split / 2],
        ] as const) {
          const top = topAt(offset, piece);
          if (course >= top) continue;
          const px = x + (along + offset) * cos, pz = z - (along + offset) * sin;
          if (course >= top - 2) fracturedStone(`${tag}_${column}_${course}_${piece}`,
            px, course * STONE_COURSE, pz, width, STONE_COURSE, depth, yaw, (column + course + piece) % 4);
          else stone(`${tag}_${column}_${course}_${piece}`, px, course * STONE_COURSE,
            pz, width, STONE_COURSE, depth, yaw);
        }
      }
    }
  };
  const pier = (tag: string, x: number, z: number, height: number, width = 1.8, depth = 2) => {
    const courses = Math.round(height / STONE_COURSE);
    if (collisionOnly) {
      stone(`${tag}_solid`, x, 0, z, width, courses * STONE_COURSE, depth);
      return;
    }
    for (let course = 0; course < courses; course++) stone(`${tag}_${course}`, x,
      course * STONE_COURSE, z, width, STONE_COURSE, depth);
    stone(`${tag}_foot`, x, 0, z, width + .6, .34, depth + .6);
  };
  const rubble = (tag: string, points: readonly (readonly [number, number, number])[]) => {
    const bases = [.11, .112, .115, .115];
    points.forEach(([x, z, scale], index) => {
      const shape = index % 4;
      place(`${tag}_${index}`, `rubble_brick_${shape + 1}`, x, bases[shape]! * scale - .018,
        z, index * 2.39996, scale);
    });
  };
  // Corbelled stone arch: each rising course overlaps the one below by at least .65 m.
  // The four-metre clear opening stays empty up to 2.76 m. The cap is borne by both shoulders.
  const arch = (tag: string, x: number, z: number, yaw = 0, depth = 2) => {
    const world = (along: number) => [x + along * Math.cos(yaw), z - along * Math.sin(yaw)] as const;
    for (const side of [-1, 1]) {
      const [px, pz] = world(side * 2.9);
      if (yaw === 0) pier(`${tag}_pier_${side}`, px, pz, 2.76, 1.8, depth);
      else if (collisionOnly) stone(`${tag}_pier_${side}_solid`, px, 0, pz, 1.8, 2.76, depth, yaw);
      else for (let course = 0; course < 6; course++) stone(`${tag}_pier_${side}_${course}`,
        px, course * STONE_COURSE, pz, 1.8, STONE_COURSE, depth, yaw);
      for (let course = 0; course < 6; course++) {
        const inner = 2 - (course + 1) * .32;
        const width = 3.8 - inner;
        const [cx, cz] = world(side * (inner + width / 2));
        stone(`${tag}_corbel_${side}_${course}`, cx, 2.76 + course * STONE_COURSE,
          cz, width, STONE_COURSE, depth, yaw);
      }
    }
    // Close the full spandrel head so an aqueduct trough seats along its whole length.
    for (let block = -2; block <= 2; block++) {
      const [cx, cz] = world(block * 1.52);
      stone(`${tag}_head_${block}`, cx, 5.52, cz, 1.52, STONE_COURSE, depth, yaw);
    }
  };
  return { parts, place, stone, wall, pier, rubble, arch };
}

function watchtower(collisionOnly = false): PartPlacement[] {
  const r = recipe(collisionOnly);
  r.wall('west_shear', -4.6, -.5, [4.6, 6.4, 9.2, 11.5, 10.6], Math.PI / 2, 1.1, 1.8,
    [{ column: 2, bottom: 4.14, top: 6.44, width: .76 }]);
  r.wall('rear_west', -4.5, -4, [9.2, 10.1], 0);
  r.wall('rear_east', 4.5, -4, [2.76, 4.14], 0);
  r.wall('east_stub', 4.6, .5, [3.22, 2.3, 1.38], Math.PI / 2);
  r.wall('front_west', -4.5, 4, [5.06, 3.22], 0);
  r.wall('front_east', 4.5, 4, [1.84, 2.76], 0);
  // The staircase terminates in the surviving corner, while the broad centre stays passable.
  for (let step = 0; step < 6; step++) r.stone(`stair_${step}`, -2.65, 0,
    2.6 - step * .52, 1.35, .2 + step * .22, .6);
  r.pier('outer_buttress', -6.1, -2.8, 4.14, 1.5, 1.6);
  r.pier('gallery_support', -2.6, -2.1, 4.14, 1, 1);
  // A narrow surviving upper watch platform explains the tower's former floor level. Its torn
  // boards die into the rear corner and rest on a transverse beam and the remaining inner post.
  r.place('gallery_crossbeam', 'roof_log', -3.25, 3.85 - 3.849 * .2, -2.1,
    Math.PI / 2, 1, [.25, .2, 2.4 / 10.696]);
  for (const [index, length] of [3.9, 3.4, 4.1, 2.8, 3.25].entries()) {
    r.place(`gallery_torn_board_${index}`, 'floor_wood', -3.94 + index * .34,
      4.2, -4 + length / 2, 0, 1, [.165, 6, length / 2]);
  }
  r.rubble('fallen_crown', [[6.5, -1.1, 5], [7.8, -.3, 3.8], [6.3, 1.4, 3.2], [8.2, 2.8, 2.4],
    [5.6, -6.2, 4.7], [7, -6.8, 3.1], [-6.8, 5.8, 4], [-8, 6.6, 2.9], [-6.1, 7.4, 2.2],
    [4.2, 6.3, 4.3], [6.1, 6.4, 3.8], [8, 6.2, 1.8], [-7.9, -6.7, 3.7], [-8.9, -4.8, 2.5]]);
  return r.parts;
}

function abbey(collisionOnly = false): PartPlacement[] {
  const r = recipe(collisionOnly);
  r.wall('west_cloister', -8.5, -1, [1.38, 2.3, 3.68, 4.6, 3.22, 1.84, .92, .46], Math.PI / 2);
  r.wall('east_cloister', 8.5, -1, [.46, .92, 1.84, 2.3, 1.38, .92, .46, .46], Math.PI / 2);
  r.wall('apse_west', -5.4, -11, [4.14, 6.9, 7.82, 5.98], 0, 1.1, 1.8,
    [{ column: 1, bottom: 1.84, top: 4.6, width: .9 }]);
  r.wall('apse_east', 5.4, -11, [3.68, 2.76, 1.38, .92], 0);
  r.wall('entry_west', -5.4, 11, [2.76, 3.22, 4.14, 2.76], 0);
  r.wall('entry_east', 5.4, 11, [2.76, 4.6, 3.68, 1.84], 0);
  r.arch('west_nave', -5.2, -1, Math.PI / 2, 1.6);
  r.pier('west_transept', -5.2, -7.5, 4.6, 1.6, 1.6);
  r.pier('west_entry_column', -5.2, 6.8, 2.76, 1.6, 1.6);
  r.pier('east_nave_remnant', 5.2, -4, 3.22, 1.6, 1.6);
  r.pier('east_nave_stump', 5.2, 3, 1.38, 1.6, 1.6);
  // A side crypt carries stone coffins. The nave and its two broken portals remain open.
  for (const [i, z] of [-6, -.5, 5].entries()) {
    r.stone(`crypt_${i}_base`, 11.1, 0, z, 1.45, .54, 2.8);
    r.stone(`crypt_${i}_lid`, 11.1 + (i === 1 ? .45 : 0), .54, z, 1.65, .22, 3);
  }
  r.place('side_altar', 'altar_ruins_altar', -10.6, -.005, -9.5, Math.PI / 2, 1.5);
  r.rubble('fallen_vault', [[7.2, 6, 4.5], [8, 8.2, 3.8], [6.4, 7.7, 3.1], [9, 9.3, 2.6],
    [-8.4, -10, 5.2], [-10, -11.1, 4], [-9.1, -13, 3.3], [7.3, -13, 4], [5.6, -13.2, 2.8],
    [-7, 12.5, 3.6], [-9, 11.8, 2.9], [-10.4, 9.9, 1.8], [4.5, 12.5, 4.2], [7, 13.5, 3.1],
    [8.2, -.2, 3.4], [6.5, -1.2, 2.9], [7.5, -2.8, 2], [-7.3, 5.1, 2.8]]);
  return r.parts;
}

function smithy(collisionOnly = false): PartPlacement[] {
  const r = recipe(collisionOnly);
  // Two ruined homes face a six-metre lane. The western forge retains its chimney and hearth.
  r.wall('forge_rear', -8.4, -5.5, [1.84, 3.22, 3.68, 2.3, .92], 0);
  r.wall('forge_west', -12, -.8, [1.38, 2.76, 3.22, 1.84, .92], Math.PI / 2);
  r.wall('forge_front_stub', -10.2, 4.5, [1.84, 1.38, .46], 0);
  r.wall('forge_lane_pier', -4, 3, [2.76], Math.PI / 2);
  r.wall('home_rear', 8.4, -5.5, [.46, 1.38, 2.76, 3.68, 1.84], 0);
  r.wall('home_east', 12, -.8, [.92, 1.84, 2.76, 3.22, 1.84], Math.PI / 2);
  r.wall('home_front_stub', 10.2, 4.5, [.92, 1.38, 1.84], 0);
  r.wall('home_lane_pier', 4, -3, [2.76], Math.PI / 2);
  r.stone('hearth_bed', -10, 0, -3.8, 3.6, .38, 2.4);
  r.stone('hearth_left_cheek', -11.35, .38, -4.1, .8, 1.1, 1.8);
  r.stone('hearth_right_cheek', -8.65, .38, -4.1, .8, 1.1, 1.8);
  r.stone('hearth_fireback', -10, .38, -4.8, 2.8, 1.5, .45);
  r.place('chimney_stack', 'chimney', -10.3, .38, -4.3, 0, 1, [1.75, 1.9, 1.75]);
  r.place('anvil', 'anvil_log', -7.2, -.001, -.4, .6);
  r.place('smith_workbench', 'workbench', -6.5, 0, -4.4, .05);
  r.place('iron_bucket', 'bucket_metal', -7.5, .005, -2.2, .4, 1.3);
  r.place('quench_pot', 'cauldron', -10.8, .003, 1.7, .25, 1.3);
  r.place('abandoned_chain', 'chain_coil', -6.3, -.005, -2.8, .9, 1.5);
  r.place('broken_house_vase', 'rubble_vase', 8, -.003, 1.5, 1.1, 1.5);
  // The forge's worn work floor survives in incomplete patches. Fallen timbers retain the
  // old roof direction, with shorter broken rafters across them and no timber in the lane.
  for (const [index, x, z, width, depth] of [[0, -10.2, -.7, 2, 2], [1, -8.2, -.7, 2, 2],
    [2, -6.2, -.7, 1.6, 2], [3, -10.2, 1.3, 2, 2], [4, -8.2, 1.3, 2, 1.5],
    [5, -8.2, -2.7, 2, 2], [6, -6.2, -2.7, 1.6, 2]] as const) {
    r.place(`forge_floor_${index}`, 'floor_brick', x, .018, z, 0, 1, [width / 2, 1, depth / 2]);
  }
  for (const [index, x, z, yaw, length] of [[0, 8.3, -1.5, .18, 4.8], [1, 9.8, .1, -.22, 4.4],
    [2, 8.5, 2.1, 1.0, 3.7], [3, 6.6, .8, 1.5, 2.8], [4, -9.7, 2.2, .85, 3.1]] as const) {
    r.place(`fallen_rafter_${index}`, 'roof_log', x, .015 - 3.849 * .2, z,
      yaw, 1, [.27, .2, length / 10.696]);
  }
  r.rubble('fallen_houses', [[-12.7, 5.4, 3.8], [-11, 6.2, 4.6], [-9.7, 7, 2.9], [-6.1, 6.4, 3],
    [-5.5, -6.9, 4], [-7.9, -7.4, 2.8], [-12.1, -7, 3.5], [12.5, 5.5, 4.4], [10.3, 6.7, 4],
    [8.8, 7.4, 2.7], [5.8, 5.9, 3.1], [6.2, -7.1, 3.6], [9, -7.3, 2.4], [12.2, -7.3, 3.9]]);
  return r.parts;
}

function aqueduct(collisionOnly = false): PartPlacement[] {
  const r = recipe(collisionOnly);
  r.arch('central_span', 0, 0, 0, 2.1);
  r.arch('west_span', -7.6, 0, 0, 2.1);
  r.pier('east_broken_pier', 10.5, 0, 4.14, 2, 2.1);
  r.pier('east_terminal_stump', 18, 0, 1.84, 2.2, 2.5);
  // A surviving water trough runs over the two arches. It stops before the missing eastern span.
  for (let i = 0; i < 8; i++) {
    const x = -10.4 + i * 1.8;
    r.stone(`channel_bed_${i}`, x, 5.98, 0, 1.8, .35, 2.1);
    for (const side of [-1, 1]) r.stone(`channel_side_${i}_${side}`, x, 6.33,
      side * .88, 1.8, .46, .38);
  }
  r.wall('west_abutment', -14.1, 0, [5.52, 4.6, 3.22], 0, 2.1);
  // The fallen eastern arch occupies a rubble fan, leaving the central and western roads clear.
  r.rubble('collapsed_east_span', [[5.8, .4, 6], [7.8, 1.8, 5], [6.6, 3.4, 4.8], [9.6, 3.7, 3.7],
    [12.3, -.4, 5.1], [14.2, 1.6, 4.5], [15.4, -.7, 3.8], [13.4, -2.8, 2.9],
    [16.3, 3.2, 3.5], [18.9, 2.7, 2.6], [-15.5, 1.7, 4.6], [-17, 3.2, 3.2], [-18.5, 1.1, 2.5],
    [8.4, -4.9, 2.4], [11.4, 5.6, 2.9], [14.6, 4.6, 2.1]]);
  return r.parts;
}

const builders = {
  wilderness_broken_watchtower: watchtower,
  wilderness_roofless_abbey: abbey,
  wilderness_ruined_smithy: smithy,
  wilderness_shattered_aqueduct: aqueduct,
};

/** The same wall heights and pier dimensions, merged into one solid per vertical masonry column. */
export function buildWildernessRuinCollisionParts(id: WildernessRuinId): PartPlacement[] {
  return builders[id](true);
}

export function buildWildernessRuin(id: WildernessRuinId): PartPlacement[] {
  const parts = builders[id]();
  WILDERNESS_RUINS[id].torches.forEach((mount, index) => {
    const [dx, dy, dz] = mount.position;
    parts.push({ tag: `mounted_torch_${index}`, assetId: 'torch', dx, dy, dz,
      rotationY: mount.yaw, scale: TORCH_SCALE });
  });
  return parts;
}
