/** Three different alpine landforms, shared by terrain and reusable meshes. */
type Summit = readonly [x: number, z: number, height: number, shoulder: number];
type Ridge = readonly [from: number, to: number, width: number, lee: number];
type Massif = { readonly summits: readonly Summit[]; readonly ridges: readonly Ridge[]; readonly apron: number };

export const MOUNTAIN_MASSIF_VARIANTS: readonly Massif[] = [
  // A broken high crest, with a dominant tooth and two unequal connected horns.
  // Short western buttresses contrast with its longer eastern snow slopes.
  { apron: .12, summits: [
    [.16,-.16,1,.18], [.03,-.40,.72,.20], [.30,.06,.83,.17], [.08,.34,.61,.25], [.19,.60,.30,.23],
    [-.08,.01,.65,.24], [-.34,.20,.41,.23], [-.55,.40,.24,.24], [-.46,-.13,.31,.22],
    [.59,-.06,.42,.23], [.61,.33,.28,.24], [-.29,-.58,.35,.23], [.32,-.62,.36,.21],
    [-.84,.63,.01,.17], [-.90,-.26,.01,.17], [-.57,-.88,.01,.18], [.40,-.92,.01,.17],
    [.91,-.18,.01,.18], [.87,.61,.01,.18], [.21,.94,.01,.17], [-.29,.78,.08,.24],
  ], ridges: [
    [0,1,1,-1], [0,2,.82,1], [2,3,1,1], [3,4,1,-1], [0,5,1,-1], [5,6,1,-1], [6,7,1,1],
    [5,8,.88,1], [2,9,.93,1], [9,10,1,-1], [3,10,.8,-1], [1,11,1,1], [1,12,.84,1],
    [7,13,1,1], [8,14,1,-1], [11,15,1,-1], [12,16,1,1], [9,17,1,1], [10,18,1,-1],
    [4,19,1,1], [3,20,.85,-1], [20,13,.8,1],
  ] },
  // Two broad broken ridges face across a deep, offset saddle. This group has
  // no central cone and no radial symmetry; its long axes turn through the pass.
  { apron: .16, summits: [
    [-.27,-.28,.90,.29], [-.15,-.05,.70,.27], [.04,.13,.44,.30], [.28,.33,1,.27],
    [.14,.59,.66,.27], [-.49,-.47,.53,.24], [.01,-.48,.59,.29], [.34,-.32,.41,.26],
    [.48,-.04,.57,.22], [.58,.33,.58,.24], [-.23,.42,.32,.29], [-.51,.02,.38,.27],
    [-.68,.34,.18,.27], [.52,.68,.33,.26], [-.12,.78,.25,.26],
    [-.83,-.71,.01,.18], [.04,-.93,.01,.19], [.78,-.59,.01,.18], [.92,.15,.01,.19],
    [.79,.87,.01,.18], [-.09,.96,.01,.18], [-.89,.59,.01,.18], [-.94,-.14,.01,.18],
  ], ridges: [
    [0,1,1,1], [1,2,1,-1], [2,3,.92,-1], [3,4,1,-1], [0,5,1,-1], [0,6,1,1],
    [6,7,1,1], [7,8,.82,-1], [3,8,.93,1], [3,9,.95,1], [4,13,1,1], [4,14,1,-1],
    [2,10,1,-1], [1,11,1,-1], [11,12,1,1], [10,12,.85,1], [5,15,1,-1], [6,16,1,1],
    [7,17,1,1], [8,18,1,-1], [9,18,1,1], [13,19,1,-1], [14,20,1,1], [12,21,1,-1], [11,22,1,-1],
  ] },
  // An eroded shoulder: long low ridges and two unequal saddles, broad runoff
  // bowls and irregular foothill spurs. Its authored crest is only .72 of the unit.
  { apron: .19, summits: [
    [-.17,-.31,.72,.34], [.03,-.09,.66,.35], [.18,.12,.61,.33], [-.07,.35,.30,.30],
    [.05,.58,.45,.29], [-.43,-.51,.41,.28], [.23,-.55,.33,.28], [.47,-.23,.37,.26],
    [-.43,.01,.35,.29], [-.63,.23,.22,.28], [.49,.35,.29,.28], [-.35,.65,.24,.28],
    [-.71,-.82,.01,.18], [.28,-.94,.01,.19], [.87,-.43,.01,.19], [-.93,-.06,.01,.19],
    [-.85,.59,.01,.19], [.85,.66,.01,.19], [.05,.95,.01,.19], [-.48,.92,.01,.19],
  ], ridges: [
    [0,1,1,1], [1,2,1,-1], [2,3,.88,1], [3,4,1,-1], [0,5,1,-1], [0,6,.91,1],
    [1,7,1,1], [1,8,1,-1], [8,9,1,1], [2,10,1,1], [4,10,.84,1], [4,11,1,-1],
    [5,12,1,-1], [6,13,1,1], [7,14,1,1], [8,15,1,-1], [9,16,1,-1], [10,17,1,1],
    [4,18,1,1], [11,19,1,-1],
  ] },
];
type Buttress = readonly [x: number, z: number, radiusX: number, radiusZ: number,
  angle: number, height: number, tiltX: number, tiltZ: number, fracture: number];
// Individually placed rock blocks interrupt particular faces. Their tilted tops
// receive snow and their short unequal scarps end in the existing lower slopes.
// They do not circle a summit or share an elevation, spacing, or terrace profile.
const BUTTRESSES: readonly (readonly Buttress[])[] = [
  [
    [-.01,-.30,.12,.16,.27,.81,.07,-.12,.9], [.36,-.25,.13,.17,-.46,.78,-.11,.06,.8],
    [-.16,-.10,.17,.13,.61,.68,.09,.06,1.1], [.40,.10,.16,.21,-.36,.72,-.06,-.10,.85],
    [-.30,.17,.18,.12,-.72,.54,.12,-.04,.82], [-.40,-.30,.16,.14,.20,.46,.06,.06,.9],
    [.10,.37,.18,.15,.52,.61,-.05,-.09,1.15], [.50,.35,.16,.13,-.27,.41,-.08,.04,.8],
    [-.56,.39,.12,.18,.66,.29,.03,-.07,.85], [.05,.63,.17,.10,-.52,.33,-.04,-.05,.9],
  ],
  [
    [-.44,-.24,.17,.18,.42,.75,.06,-.08,.82], [-.21,-.43,.17,.12,-.56,.81,-.08,.05,1.05],
    [-.08,-.11,.14,.20,.72,.65,-.07,-.08,.9], [-.51,.06,.18,.14,-.21,.49,.05,.06,.85],
    [.08,.30,.18,.14,-.54,.80,.08,-.08,.9], [.41,.15,.14,.22,.38,.82,-.09,.04,1.05],
    [.25,.51,.20,.13,-.61,.77,-.06,-.05,.87], [.62,.33,.14,.18,.23,.55,-.09,.05,.8],
    [-.11,.56,.20,.12,.59,.43,.08,-.06,.88], [.49,-.22,.17,.13,-.45,.46,-.06,.04,.9],
    [.28,.76,.18,.12,.41,.39,-.05,-.06,.85],
  ],
  [
    [-.34,-.29,.20,.14,.43,.61,.05,-.05,.72], [.02,-.30,.22,.15,-.28,.65,-.05,.04,.8],
    [.19,.02,.17,.22,.51,.61,-.06,-.03,.75], [-.24,.11,.21,.13,-.67,.43,.05,.04,.68],
    [.41,.21,.18,.12,.36,.43,-.05,-.04,.7], [-.07,.56,.21,.13,-.35,.41,.06,-.04,.72],
    [-.49,.58,.16,.14,.48,.26,.03,-.04,.7],
  ],
];

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (v: number): number => { const t = clamp01(v); return t * t * (3 - 2 * t); };

/** Smooth, seeded noise is evaluated once while building the shared height table. */
function noise(x: number, z: number, seed: number): number {
  const hash = (i: number, j: number): number => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1274126177);
    n = Math.imul(n ^ n >>> 13, 1274126177);
    return ((n ^ n >>> 16) >>> 0) / 4294967295;
  };
  const i = Math.floor(x), j = Math.floor(z), u = smooth(x - i), v = smooth(z - j);
  return (hash(i, j) * (1 - u) + hash(i + 1, j) * u) * (1 - v)
    + (hash(i, j + 1) * (1 - u) + hash(i + 1, j + 1) * u) * v;
}

/** Independent ridge networks open into concave bowls without repeated terraces. */
function sculptMassif(x: number, z: number, variant: number): number {
  const shape = MOUNTAIN_MASSIF_VARIANTS[variant]!;
  const radius = Math.hypot(x * 1.03, z * .91);
  const apron = Math.max(0, 1 - radius) ** 1.7 * shape.apron;
  let height = apron;
  for (let index = 0; index < shape.ridges.length; index++) {
    const [ia, ib, breadth, leeSign] = shape.ridges[index]!;
    const a = shape.summits[ia]!, b = shape.summits[ib]!;
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    const t = clamp01(((x - a[0]) * dx + (z - a[1]) * dz) / (length * length));
    const ox = x - a[0] - t * dx, oz = z - a[1] - t * dz;
    const side = (dx * oz - dz * ox) / length;
    const distance = Math.hypot(ox, oz);
    const shoulder = (a[3] + (b[3] - a[3]) * t) * breadth;
    const lee = side * leeSign > 0;
    const width = shoulder * (lee ? 1.75 : 1.03);
    // Round only the narrow crest cusp over roughly two control cells. An
    // infinitesimal linear cusp aliases into regular four-metre sawteeth.
    const crestRadius = .025;
    const q = (Math.sqrt(distance * distance + crestRadius * crestRadius) - crestRadius) / width;
    if (q >= 1) continue;
    const crest = a[2] + (b[2] - a[2]) * t;
    // Broad planes break into unequal diagonal fractures. The lee profile opens
    // continuously into the bowl; there is no common shelf height or cliff rim.
    const bowl = lee ? .32 + noise(t * 3, index, variant + 27) * .50 : .04;
    const profile = (1 - q) * (1 - bowl) + (1 - q) ** 1.8 * bowl;
    const fault = (noise(t * 5 + q * 2, side * 11, index + variant * 31) - .5)
      * .045 * smooth(q / .2) * smooth((1 - q) / .3) * Math.min(1, crest * 4);
    height = Math.max(height, apron + Math.max(0, crest - apron) * profile + fault);
  }
  for (const [cx, cz, rx, rz, angle, top, tiltX, tiltZ, fracture] of BUTTRESSES[variant]!) {
    let anchor = shape.summits[0]!, closest = Infinity;
    for (const node of shape.summits) {
      if (node[2] <= top + .06) continue;
      const d = Math.hypot(node[0] - cx, node[1] - cz);
      if (d < closest) { closest = d; anchor = node; }
    }
    // Each long axis runs back into its own uphill ridge. These are attached
    // diagonal buttresses, not vertical columns planted on the mountainside.
    const uphill = Math.atan2(anchor[1] - cz, anchor[0] - cx) + angle * .16;
    const cosine = Math.cos(uphill), sine = Math.sin(uphill);
    const u = (-(x - cx) * sine + (z - cz) * cosine) / (rx * .92);
    const v = ((x - cx) * cosine + (z - cz) * sine) / (rz * 1.42);
    const outline = Math.max(Math.abs(u) * .86 + Math.abs(v) * .26,
      Math.abs(v) * .93 + Math.abs(u) * .18, Math.abs(u * .53 + v * .67));
    if (outline > 1.45) continue;
    // Intersecting unequal planes form a narrow oblique roof crest, falling
    // 30 to 50 m across the block and running uphill into the receiving ridge.
    const backSlope = .18 + tiltZ * .35;
    const roofA = top + u * (.21 + tiltX * .4) + v * backSlope;
    const roofB = top + .035 - u * (.29 - tiltX * .3) + v * (backSlope + .035);
    const plane = (roofA + roofB - Math.hypot(roofA - roofB, .035)) * .5;
    const brokenEdge = .53 + v * .08
      + (noise(u * 2.1 + cx, v * 2.4 + cz, variant + 97) - .5) * .10;
    const talus = v > .2 ? .50 : .94;
    const block = plane - Math.max(0, outline - brokenEdge) * fracture * talus;
    height = Math.max(height, block);
  }
  height += (noise(x * 13, z * 17, variant + 61) - .5) * .011
    * smooth(height / .12) * smooth((.60 - height) / .30);
  return clamp01(height * smooth((1 - Math.max(Math.abs(x), Math.abs(z))) / .10));
}

const CONTROL_CELLS = 128;
const CONTROL_STEP = 2 / CONTROL_CELLS;
// Roughly four-metre cells at native size preserve cliff flutes in both terrain
// collision and reusable meshes. Runtime queries only interpolate four values.
const controlHeights = MOUNTAIN_MASSIF_VARIANTS.map((shape, variant) => {
  const grid = Array.from({ length: CONTROL_CELLS + 1 }, (_, j) =>
    Float32Array.from({ length: CONTROL_CELLS + 1 }, (_, i) =>
      sculptMassif(-1 + i * CONTROL_STEP, -1 + j * CONTROL_STEP, variant)));
  for (const [x, z, height] of shape.summits) {
    const i = Math.round((x + 1) / CONTROL_STEP), j = Math.round((z + 1) / CONTROL_STEP);
    grid[j]![i] = Math.max(grid[j]![i]!, height);
  }
  return grid;
});

/** Deterministic 0..1 relief on a two-unit footprint with a continuous zero edge. */
export function sampleMountainMassif(x: number, z: number, variant = 0): number {
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) >= 1 || Math.abs(z) >= 1) return 0;
  const grid = controlHeights[((Math.trunc(variant) % 3) + 3) % 3] ?? controlHeights[0]!;
  const gx = (x + 1) / CONTROL_STEP, gz = (z + 1) / CONTROL_STEP;
  const i = Math.min(CONTROL_CELLS - 1, Math.floor(gx));
  const j = Math.min(CONTROL_CELLS - 1, Math.floor(gz));
  const u = gx - i, v = gz - j;
  return (grid[j]![i]! * (1 - u) + grid[j]![i + 1]! * u) * (1 - v)
    + (grid[j + 1]![i]! * (1 - u) + grid[j + 1]![i + 1]! * u) * v;
}
