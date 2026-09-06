import * as THREE from 'three';
import { axialField } from './tapir-sections.mjs';

// Shape guidance, not a claim of measured photograph ratios:
// https://www.nps.gov/romo/learn/nature/moose.htm
// https://wdfw.wa.gov/species-habitats/species/alces-alces
// https://parks.canada.ca/pn-np/ns/cbreton/decouvrir-discover/faune-animals/mammiferes-mammals/orignal-moose
// Long legs, raised shoulder, narrow nasal bridge with an overhanging upper lip,
// pendulous throat bell, and broad palms on narrower antler beams.
export const MOOSE_CONFIG = Object.freeze({
  profile: {
    height: 1.66, width: .38, hipY: 1.70, front: .56, rear: -.66,
    legX: .29, kneeY: .93, kneeFront: .585, kneeRear: -.47,
    ankle: .17, ankleFront: .62, ankleRear: -.72, legR: .105,
    neck: [0, 1.87, .72], head: [0, 2.01, 1.18],
    stride: .78, runStride: 1.10,
  },
  eyes: [.166, 2.050, 1.252],
  jaw: [0, 1.773, 1.324],
  earBase: [.158, 2.151, 1.074],
  earCenter: [.307, 2.270, .995],
  earTip: [.435, 2.375, .918],
  earRadii: [[.033, .025], [.071, .017], [.003, .005]],
  upperLegRadii: { front: .106, hind: .147, rootBlend: .040 },
  // Existing gait timing remains valid; contact audit must verify these targets.
  walkCrouch: .100, runCrouch: .205,
  muzzleSkin: { minZ: 1.51, maxY: 1.89 },
  anatomyBounds: { min: [-.45, .002, -1.14], max: [.45, 2.31, 1.86] },
});

/** Use these in the existing axial-distance path. No new field type needed. */
export function mooseFields(rig) {
  return [
    axialField([
      [-1.075, 1.700, .006, .008], [-.940, 1.700, .242, .275],
      [-.670, 1.692, .350, .337], [-.360, 1.676, .371, .334],
      [-.080, 1.690, .365, .355], [.180, 1.737, .350, .405],
      [.415, 1.785, .327, .443], [.600, 1.825, .268, .357],
      [.760, 1.858, .140, .222], [.850, 1.885, .006, .010],
    ], 'Body', rig, .028),
    axialField([
      [.545, 1.875, .120, .185], [.690, 1.905, .212, .228],
      [.855, 1.947, .198, .207], [1.018, 2.000, .142, .151],
      [1.095, 2.018, .007, .010],
    ], 'Neck', rig, .026),
    axialField([
      [.985, 2.041, .009, .014], [1.092, 2.047, .161, .171],
      [1.215, 2.027, .159, .155], [1.350, 1.961, .124, .127],
      [1.474, 1.866, .116, .106], [1.576, 1.787, .142, .112],
      [1.689, 1.750, .151, .094], [1.774, 1.748, .083, .059],
      [1.807, 1.754, .006, .008],
    ], 'Head', rig, .020),
    axialField([
      [1.186, 1.824, .009, .013], [1.320, 1.793, .095, .058],
      [1.487, 1.712, .102, .048], [1.621, 1.678, .085, .031],
      [1.689, 1.684, .008, .010],
    ], 'Jaw', rig, .014),
  ];
}

/** Replace the moose-only body/head branch; leave shared leg construction next. */
export function mooseAnatomy({ shapes, cavity, s, p }) {
  shapes.push(...mooseFields(s.rig));
  for (const side of [-1, 1]) {
    cavity([side * .124, 1.785, 1.712], [.026, .021, .040], [.12, side * .27, 0], p.dark);
  }
  return MOOSE_CONFIG;
}

/** Replace the old leaf-shaped dewlap and its eleven pointed strands. */
export function mooseBell(s, p) {
  s.loft([
    [0, 1.767, 1.075, .037, .039], [0, 1.674, 1.099, .043, .046],
    [0, 1.568, 1.108, .045, .044], [0, 1.474, 1.096, .036, .038],
    [0, 1.406, 1.078, .022, .026], [0, 1.383, 1.067, .008, .011],
  ], 'Neck', p.dark, {
    rings: 32, sides: 20,
    detail: (t, a) => 1 + .035 * Math.cos(a * 5 + t * 3) + .012 * Math.sin(t * 71 + a * 7),
  });
}

/** Apply to BOTH antler front/back positions before s.add, preserving topology. */
export function mooseAntlerRootPoint(point) {
  const [x, y, z] = point, u = Math.abs(x);
  const t = THREE.MathUtils.clamp((u - .20) / .37, 0, 1);
  const keep = .56 + .44 * t * t * (3 - 2 * t);
  const beamY = 2.215 + .41 * (u - .14);
  const beamZ = 1.095 - .375 * (u - .14) - .110 * (beamY - 2.20);
  return [x, beamY + (y - beamY) * keep, beamZ + (z - beamZ) * keep];
}

/** Replace only the moose generic hoof loop; both toe shells remain Foot-bound. */
export function mooseHooves(s, leg, p) {
  const outline = [[-.025, -.039], [-.030, .014], [-.026, .101], [-.010, .137], [.010, .137], [.026, .101], [.030, .014], [.025, -.039]];
  const sections = [{ y: .167, w: .63, l: .49 }, { y: .111, w: .86, l: .77 }, { y: .043, w: 1, l: 1 }, { y: .002, w: .96, l: .98 }];
  for (const side of [-1, 1]) {
    const points = [], faces = [];
    for (const section of sections) for (const [x, z] of outline) points.push([
      leg.ankle.x + side * .037 + x * section.w,
      section.y, leg.ankle.z + z * section.l,
    ]);
    for (let row = 0; row < 3; row++) for (let k = 0; k < 8; k++) {
      const a = row * 8 + k, b = row * 8 + (k + 1) % 8, c = a + 8, d = b + 8;
      faces.push(a, c, b, b, c, d);
    }
    for (let k = 1; k < 7; k++) faces.push(0, k, k + 1, 24, 24 + k + 1, 24 + k);
    const uv = points.flatMap(point => [(point[0] - leg.ankle.x + .07) / .14, (point[2] - leg.ankle.z + .04) / .18]);
    s.add(points, faces, leg.tag + 'Foot', p.dark, 1, undefined, uv);
  }
  for (const side of [-1, 1]) s.loft([
    [leg.ankle.x + side * .025, .219, leg.ankle.z - .025, .010, .012],
    [leg.ankle.x + side * .025, .196, leg.ankle.z - .040, .011, .014],
    [leg.ankle.x + side * .025, .180, leg.ankle.z - .043, .003, .005],
  ], leg.tag + 'Knee', p.dark, { rings: 8, sides: 10, material: 1 });
}

// CENTRAL INTEGRATION, not performed by this isolated source change:
// 1. Spread MOOSE_CONFIG.profile into the existing moose profile. Keep timings,
//    colors, attack/contact values and bone names. Apply jaw and ear pivots.
// 2. In the moose implicit branch call mooseAnatomy({shapes,cavity,s,p}), use
//    config.eyes and config.muzzleSkin, and use config.upperLegRadii for moose.
// 3. Use earBase/Center/Tip and earRadii in the moose ear loft. These thinner
//    ears prevent the dark rectangular blocks from covering the antler beams.
// 4. Keep mooseAntlers, map every emitted position with mooseAntlerRootPoint,
//    and replace the old bell/strand geometry with mooseBell(s,p).
// 5. Call mooseHooves for moose and skip generic hoof/dewclaw construction.
// 6. Apply the stated moose crouches. Run the unchanged focused contact audit,
//    then physical-sole checks and scheduled production front/side/rear/motion
//    screenshots. This unintegrated helper does not claim visual acceptance.
