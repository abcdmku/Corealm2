import * as THREE from 'three';
import { axialField } from './tapir-sections.mjs';

const smooth = (a, b, value) => {
  const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const bell = (x, center, radius) => Math.exp(-(((x - center) / radius) ** 2));

export const BIGHORN_REFINEMENT = Object.freeze({
  // All existing bone positions, animation timing and gait targets stay intact.
  eyes: [.130, 1.488, 1.012],
  eyeCavityScale: [.018, .017, .029],
  coatNormalScale: .105,
  coatRoughness: .94,
  eyeRoughness: .32,
  hornRoughness: .82,
  hoofRoughness: .81,
  // This replaces the color map's repeating tan pattern; retain fine roughness.
  useCoatColorMap: false,
});

/** Replace the ram torso/head ellipsoid branch with these four axial fields. */
export function bighornRefinedFields(rig) {
  return [
    axialField([
      [-.845, 1.067, .005, .009], [-.740, 1.061, .199, .226],
      [-.584, 1.074, .253, .263], [-.408, 1.071, .247, .225],
      [-.160, 1.050, .267, .243], [.085, 1.066, .275, .276],
      [.285, 1.074, .260, .326], [.430, 1.097, .235, .327],
      [.564, 1.154, .169, .227], [.667, 1.207, .005, .009],
    ], 'Body', rig, .025),
    axialField([
      [.430, 1.220, .090, .165], [.543, 1.251, .168, .232],
      [.680, 1.337, .148, .189], [.804, 1.430, .117, .135],
      [.888, 1.467, .004, .006],
    ], 'Neck', rig, .027),
    axialField([
      [.788, 1.482, .006, .010], [.876, 1.484, .124, .115],
      [1.008, 1.482, .130, .104], [1.098, 1.423, .095, .081],
      [1.192, 1.359, .081, .063], [1.279, 1.326, .073, .052],
      [1.321, 1.325, .007, .010],
    ], 'Head', rig, .016),
    axialField([
      [.995, 1.344, .007, .010], [1.070, 1.330, .073, .039],
      [1.180, 1.291, .071, .031], [1.275, 1.285, .006, .008],
    ], 'Jaw', rig, .012),
  ];
}

/** Add these after the ram leg field and before marching-cubes extraction. */
export function bighornPasternFields({ ell, capsule, s, leg }) {
  const ankle = leg.ankle, knee = leg.knee, index = s.rig.index, tag = leg.tag;
  const middle = knee.clone().lerp(ankle, .66);
  const low = [ankle.x, ankle.y + .012, ankle.z + .001];
  capsule(middle.toArray(), low, .026, .033, tag + 'Knee', .014,
    [[index[tag + 'Knee'], .85], [index[tag + 'Ankle'], .15]]);
  // The pastern has a narrow rear tendon and gently widens above the toes.
  // Its lower edge sits inside the hoof shell, without a ring around the ankle.
  ell([ankle.x, .130, ankle.z + .006], [.044, .057, .042], tag + 'Foot',
    [.08, 0, 0], .015, [[index[tag + 'Knee'], .16], [index[tag + 'Foot'], .84]]);
}

/** Geometry-only replacement for the old high-contrast periodic horn rings. */
export function bighornHornDetail(t, angle) {
  const fade = 1 - .90 * smooth(.61, 1, t);
  const phase = 2 * Math.PI * (t * 27 + .14 * Math.sin(t * 19));
  const cut = .014 * Math.max(0, Math.cos(phase + .07 * Math.sin(angle * 2))) ** 7 * fade;
  const face = angle * 3 + .25;
  const section = (.128 * Math.cos(face) - .025 * Math.cos(face * 2)) * (1 - .72 * smooth(.35, 1, t));
  return 1 + section - cut;
}

export function bighornHornColor(t, angle) {
  const color = new THREE.Color(0x75644e).lerp(new THREE.Color(0xafa085), smooth(.06, .81, t));
  const grain = Math.max(0, Math.cos((t * 27 + .14 * Math.sin(t * 19)) * Math.PI * 2)) ** 7;
  return color.multiplyScalar(1 - .028 * grain + .015 * Math.sin(angle * 9 + t * 5));
}

/** Spatial coat colors avoid a large, evenly colored tan surface. */
export function bighornRefinedCoat(point) {
  const [x, y, z] = point, ax = Math.abs(x);
  const color = new THREE.Color(0x756a59);
  const saddle = smooth(.95, 1.32, y) * (1 - smooth(.35, .71, z));
  color.lerp(new THREE.Color(0x554f46), .25 * saddle);
  const neck = smooth(.28, .67, z) * (1 - smooth(.94, 1.12, z)) * smooth(.85, 1.23, y);
  color.lerp(new THREE.Color(0x615746), .33 * neck);
  const flank = bell(z, -.11, .44) * bell(y, .93, .23) * smooth(.11, .25, ax);
  color.lerp(new THREE.Color(0x99876c), .25 * flank);
  const belly = (1 - smooth(.76, .94, y)) * smooth(-.61, -.27, z) * (1 - smooth(.22, .47, z));
  color.lerp(new THREE.Color(0xb1a38b), .49 * belly);
  const rump = (1 - smooth(-.755, -.615, z)) * smooth(.73, .91, y) * (1 - smooth(1.24, 1.37, y));
  color.lerp(new THREE.Color(0xc0b49d), .90 * rump);
  const muzzle = smooth(1.115, 1.31, z) * (1 - smooth(1.38, 1.47, y));
  color.lerp(new THREE.Color(0x928472), .42 * muzzle);
  const legs = 1 - smooth(.15, .52, y);
  color.lerp(new THREE.Color(0x605c51), .38 * legs);
  const mottling = .021 * Math.sin(x * 29 + z * 18) * Math.sin(y * 31 - z * 11)
    + .006 * Math.sin(y * 127 + z * 41 + x * 73);
  return color.multiplyScalar(1 + mottling);
}

/** One shallow eye lens enclosed by skin lids replaces the three bead meshes. */
export function bighornRecessedEye(s, side) {
  const [x, y, z] = BIGHORN_REFINEMENT.eyes;
  const points = [[side * (x - .001), y, z]], uv = [.5, .5], indices = [];
  const outline = [];
  for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2;
    const yy = Math.sin(a) * .011 * (.62 + .38 * Math.abs(Math.sin(a)));
    const zz = Math.cos(a) * .023;
    points.push([side * (x - .008), y + yy, z + zz]);
    uv.push(.5 + zz / .046, .5 + yy / .022);
    outline.push([side * (x - .007), y + yy, z + zz, .003, .003]);
  }
  for (let k = 0; k < 24; k++) {
    const a = 1 + k, b = 1 + (k + 1) % 24;
    indices.push(...(side > 0 ? [0, b, a] : [0, a, b]));
  }
  s.add(points, indices, 'Head', 0x201c16, 3, undefined, uv);
  outline.push(outline[0]);
  s.loft(outline, 'Head', bighornRefinedCoat, { rings: 32, sides: 8, material: 0, axis: [1, 0, 0] });
}

/** Shorter keratin toes; upper vertices overlap the smooth furred pastern field. */
export function bighornRefinedHooves(s, leg) {
  const outline = [[-.020, -.025], [-.025, .014], [-.022, .078], [-.009, .100], [.009, .100], [.022, .078], [.025, .014], [.020, -.025]];
  const sections = [{ y: .103, w: .62, l: .54 }, { y: .078, w: .91, l: .77 }, { y: .026, w: 1, l: 1 }, { y: .002, w: .96, l: .98 }];
  for (const side of [-1, 1]) {
    const points = [], indices = [];
    for (const section of sections) for (const [x, z] of outline) points.push([
      leg.ankle.x + side * .030 + x * section.w, section.y, leg.ankle.z + z * section.l,
    ]);
    for (let row = 0; row < 3; row++) for (let k = 0; k < 8; k++) {
      const a = row * 8 + k, b = row * 8 + (k + 1) % 8;
      indices.push(a, a + 8, b, b, a + 8, b + 8);
    }
    for (let k = 1; k < 7; k++) indices.push(0, k, k + 1, 24, 24 + k + 1, 24 + k);
    const uv = points.flatMap(p => [(p[0] - leg.ankle.x + .06) / .12, (p[2] - leg.ankle.z + .03) / .14]);
    s.add(points, indices, leg.tag + 'Foot', p => new THREE.Color(0x49473f).lerp(new THREE.Color(0x615c50), smooth(.060, .103, p[1]) * .52), 1, undefined, uv);
  }
}

// CENTRAL INTEGRATION RECIPE:
// 1. Keep all BIGHORN_LANDMARKS bone/profile pivots and all clips. Replace the
//    bighornAnatomy body/head shapes with bighornRefinedFields(rig); preserve
//    nostril cavities. Set eyes and eye cavity sizes from this config.
// 2. After shared ram leg fields, add bighornPasternFields for each leg. Replace
//    ram hoof generation with bighornRefinedHooves. Existing tiny dewclaws may
//    remain. Do not add a separate torus or cuff at the coronet.
// 3. Replace generic eye meshes and lids for ram with bighornRecessedEye only.
// 4. Keep current tapered horn centerline/radii; use bighornHornDetail as loft
//    detail and bighornHornColor at vertex t/angle. This reduces the growth-mark
//    cut from about 9% to 1.4% while retaining the triangular section.
// 5. Replace ram coatColor with bighornRefinedCoat; use config normal/roughness,
//    and remove only ram's coat color map. Keep its roughness and normal maps.
// 6. Run contact/physical-sole checks, then scheduled close front/side and all
//    production lifecycle views. Source validity does not imply acceptance.
