import * as THREE from 'three';
import type { ArmorTheme, ArmorMaterials, Surface } from './contracts.js';
import { addScaleField } from './scale-field.js';
import { V, clamp, normal, shell, binding, edge, stitches, ornament, diamond, star } from './hood-geometry.js';

type Ring = [number, number, number, number, number, number];
const TAU = Math.PI * 2;

// v, height, half-width, depth radius, depth center, half-angle of face opening.
// These profiles are independently traced: the Dragonhide cowl flares and falls lower
// behind the ears, while Starhide's crown turns into a higher swept cloth point.
const starRings: Ring[] = [
  [0, 1.464, .157, .137, -.030, .68], [.14, 1.520, .138, .121, -.023, .80],
  [.29, 1.577, .110, .116, -.011, .84], [.45, 1.642, .100, .113, -.004, .81],
  [.59, 1.704, .098, .117, -.003, .79], [.72, 1.760, .087, .108, -.006, .64],
  [.82, 1.801, .065, .083, -.009, 0], [.90, 1.820, .041, .056, -.013, 0],
  [.97, 1.831, .015, .023, -.016, 0], [1, 1.833, .0006, .0006, -.016, 0],
];
const dragonRings: Ring[] = [
  [0, 1.455, .164, .148, -.033, .63], [.14, 1.513, .147, .128, -.027, .78],
  [.29, 1.575, .117, .120, -.014, .86], [.45, 1.644, .102, .116, -.006, .80],
  [.59, 1.707, .102, .119, -.006, .78], [.72, 1.765, .089, .110, -.012, .62],
  [.82, 1.805, .068, .085, -.016, 0], [.90, 1.826, .044, .059, -.020, 0],
  [.97, 1.837, .018, .026, -.021, 0], [1, 1.839, .0006, .0006, -.021, 0],
];

function section(rings: Ring[], v: number): number[] {
  let index = rings.findIndex(r => r[0] >= v); if (index <= 0) index = 1;
  const a = rings[index - 1]!, b = rings[index]!, span = b[0] - a[0];
  const t = clamp((v - a[0]) / span, 0, 1), t2 = t * t, t3 = t2 * t;
  return [0, ...[1, 2, 3, 4, 5].map(i => {
    const slope = (at: number) => {
      if (at === 0) return (rings[1]![i]! - rings[0]![i]!) / (rings[1]![0] - rings[0]![0]);
      if (at === rings.length - 1) return (rings[at]![i]! - rings[at - 1]![i]!) / (rings[at]![0] - rings[at - 1]![0]);
      const before = (rings[at]![i]! - rings[at - 1]![i]!) / (rings[at]![0] - rings[at - 1]![0]);
      const after = (rings[at + 1]![i]! - rings[at]![i]!) / (rings[at + 1]![0] - rings[at]![0]);
      if (before * after <= 0) return 0;
      return Math.sign(before) * Math.min((Math.abs(before) + Math.abs(after)) * .5, Math.abs(before) * 2, Math.abs(after) * 2);
    };
    return (2 * t3 - 3 * t2 + 1) * a[i]! + (t3 - 2 * t2 + t) * span * slope(index - 1)
      + (-2 * t3 + 3 * t2) * b[i]! + (t3 - t2) * span * slope(index);
  })];
}

function crownSurface(theme: ArmorTheme): Surface {
  const dragon = theme === 'dragonhide', rings = dragon ? dragonRings : starRings;
  return (u, v) => {
    const r = section(rings, v), angle = r[5]! + (TAU - r[5]! * 2) * u;
    const back = Math.max(0, -Math.cos(angle));
    const rearGather = (dragon ? .092 : .061) * Math.exp(-Math.pow((v - (dragon ? .39 : .61)) / (dragon ? .31 : .22), 2)) * back ** 7;
    const crownFold = .0032 * Math.sin(v * 22 + angle * 3.7) * Math.sin(v * Math.PI) * Math.sin(angle) ** 2;
    const biasCrease = (dragon ? .010 : .007) * Math.cos(v * 28 + angle * 10) * Math.sin(v * Math.PI) ** 2 * back ** 3;
    const lowHem = (dragon ? .035 : .044) * (1 - v) ** 5 * Math.sin(angle) ** 2;
    // Two unequal sewn crown gathers break up the smooth skull surface. The
    // lips lie outside the fitted crown; their shallow tucks retain head clearance.
    const crownBand = Math.exp(-Math.pow((v - .81) / .165, 2));
    const foldLeft = Math.exp(-Math.pow((u - .145 - .035 * (v - .7)) / .037, 2));
    const foldRight = Math.exp(-Math.pow((u - .835 + .065 * (v - .7)) / .048, 2));
    const tuck = Math.exp(-Math.pow((u - .192 - .025 * (v - .7)) / .026, 2));
    const sewnCrown = crownBand * (.007 * foldLeft + .009 * foldRight - .0017 * tuck);
    const sideBand = Math.exp(-Math.pow((v - .38) / .27, 2));
    const looseSides = sideBand * (
      .0065 * Math.exp(-Math.pow((u - .10 - .11 * v) / .038, 2))
      + .0080 * Math.exp(-Math.pow((u - .895 + .075 * v) / .047, 2)));
    // Exact zero at the face arch and lower hem preserves their accepted fit.
    const seamEnvelope = Math.sin(Math.PI * u) ** .55 * Math.sin(Math.PI * v) ** .35;
    const gathered = (sewnCrown + looseSides) * seamEnvelope;
    const sideEase = (dragon ? .008 : .006) * sideBand * Math.sin(angle) ** 2 * Math.sin(Math.PI * u);
    return V((r[2]! + crownFold - biasCrease + gathered + sideEase) * Math.sin(angle), r[1]! + lowHem,
      r[4]! + (r[3]! + crownFold - biasCrease + gathered) * Math.cos(angle) - rearGather);
  };
}

function addRearPoint(g: THREE.Group, theme: ArmorTheme, m: ArmorMaterials): void {
  const dragon = theme === 'dragonhide';
  const axis = new THREE.CatmullRomCurve3(dragon
    ? [V(0, 1.754, -.085), V(.004, 1.699, -.151), V(.011, 1.614, -.196), V(.018, 1.548, -.208), V(.026, 1.507, -.238)]
    : [V(0, 1.780, -.073), V(.002, 1.764, -.132), V(.008, 1.736, -.174), V(.013, 1.705, -.212), V(.018, 1.689, -.254)]);
  const rear: Surface = (u, v) => {
    const q = axis.getPoint(v), tangent = axis.getTangent(v).normalize();
    const across = V(1, 0, 0), vertical = tangent.clone().cross(across).normalize();
    const a = -u * TAU, r = (dragon ? .064 : .052) * (1 - v) ** (dragon ? .86 : 1.15) + .00045;
    const folded = 1 + .10 * Math.cos(a * 4 + v * 8) * Math.sin(Math.PI * v);
    return q.addScaledVector(across, Math.sin(a) * r * .83).addScaledVector(vertical, Math.cos(a) * r * folded);
  };
  shell(g, `${theme} closed soft ${dragon ? 'falling rear drape' : 'swept rear cloth point'}`, rear, m.cloth, m.lining, 32, 26, .0018, [1, 1.2]);
  const rootCap: Surface = (u, v) => rear(1 - u, 0).lerp(axis.getPoint(0), v * .9999);
  const tipCap: Surface = (u, v) => rear(u, 1).lerp(axis.getPoint(1), v * .9999);
  // This closing seam sits inside the crown and is seen through the open hood.
  shell(g, `${theme} enclosed rear root seam`, rootCap, m.lining, m.lining, 32, 3, .0012);
  shell(g, `${theme} enclosed rear sewn tip`, tipCap, m.cloth, m.lining, 24, 2, .0007);
  stitches(g, `${theme} back point center seam`, rear, 'v', .25, m.thread, dragon ? 65 : 45);
}

function addCrest(g: THREE.Group, theme: ArmorTheme, m: ArmorMaterials): void {
  if (theme === 'dragonhide') {
    // Gold branches trace the tall asymmetric-looking spear seen in the icon.
    ornament(g, 'dragonhide tall branching gold brow crest', V(0, 1.792, .079), V(0, .22, 1),
      [[0, -.021], [.017, .003], [.047, .018], [.023, .017], [.034, .037], [.014, .027], [.009, .047], [0, .091], [-.009, .047], [-.014, .027], [-.034, .037], [-.023, .017], [-.047, .018], [-.017, .003]],
      [[[0, .007], [-.009, .027], [0, .056], [.009, .027]], [[-.016, .009], [-.026, .021], [-.013, .017]], [[.016, .009], [.013, .017], [.026, .021]]], m, .0019);
    diamond(g, 'dragonhide violet crest jewel', V(0, 1.822, .087), V(0, .22, 1), .006, .015, m);
    binding(g, 'dragonhide crest central carved ridge', t => V(0, 1.787 + .080 * t, .083 - .016 * t), () => V(0, .22, 1), .0018, m.metal, 24, .0019);
  } else {
    ornament(g, 'starhide swept open silver brow star', V(0, 1.792, .080), V(0, .28, 1),
      [[0, -.021], [.010, .003], [.038, .020], [.017, .018], [.009, .028], [0, .060], [-.008, .027], [-.017, .018], [-.038, .020], [-.010, .003]],
      [[[0, .002], [-.006, .019], [0, .038], [.006, .019]], [[-.011, .009], [-.024, .017], [-.011, .018]], [[.011, .009], [.011, .018], [.024, .017]]], m);
  }
}

/** Native male metres, Y up, +Z front. The open-faced hood follows the native Head bone. */
export function buildHood(theme: ArmorTheme, m: ArmorMaterials): THREE.Group {
  const g = new THREE.Group(); g.name = `${theme} icon-traced cloth hood`;
  const dragon = theme === 'dragonhide', hood = crownSurface(theme);
  shell(g, `${theme} fitted sewn crown and continuous side cowl`, hood, m.cloth, m.lining, 64, 52, .0022, [1.7, 1.45]);
  const opening: Surface = (u, v) => hood(u, v * .82);
  for (const u of [0, 1]) {
    edge(g, `${theme} sculpted face opening binding`, opening, 'v', u, m, dragon ? .010 : .0082, 48);
    stitches(g, `${theme} face opening hand stitches`, opening, 'v', u ? .986 : .014, m.thread, 68);
  }
  edge(g, `${theme} curved sidecloth rolled hem`, hood, 'u', 0, m, dragon ? .0062 : .0048, 52);
  for (const u of [.235, .5, .765]) stitches(g, `${theme} crown sewn panel seam`, hood, 'v', u, m.thread, 60);
  addRearPoint(g, theme, m);

  // The upper temple panel is a different traced shape in each icon. All scutes
  // are real overlapping closed plates on the same fitted cloth underlay.
  for (const side of [-1, 1]) {
    const patch: Surface = (u, v) => {
      const center = side < 0 ? .814 : .186;
      const width = dragon
        ? .112 * Math.sin(Math.PI * (.12 + .78 * v)) + .021
        : .075 * Math.sin(Math.PI * (.10 + .83 * v)) + .014;
      const hu = center + (u - .5) * width;
      const hv = (dragon ? .035 : .20) + v * (dragon ? .700 : .570) - .050 * Math.abs(u - .5);
      return hood(hu, hv).addScaledVector(normal(hood, hu, hv), .0030);
    };
    shell(g, `${theme} ${side < 0 ? 'left' : 'right'} temple scale backing`, patch, m.scales, m.lining, 12, 24, .0014, [.45, 1]);
    addScaleField(g, `${theme} temple overlapping scutes ${side}`, patch, m, { columns: dragon ? 6 : 5, rows: dragon ? 16 : 13, bone: 'Head', lift: .0017, seed: side < 0 ? 419 : 527 });
    for (const u of [0, 1]) edge(g, `${theme} temple engraved metal side`, patch, 'v', u, m, dragon ? .0058 : .0042, 32);
    for (const v of [0, 1]) edge(g, `${theme} temple curved metal cap`, patch, 'u', v, m, .0045, 20);
    if (dragon) {
      const u = side > 0 ? 0 : 1, q = patch(u, .60), n = normal(patch, u, .60);
      diamond(g, 'dragonhide angular temple diamond clasp', q.addScaledVector(n, .004), n, .011, .028, m);
    } else {
      const u = side > 0 ? 0 : 1, q = patch(u, .06), n = normal(patch, u, .06);
      star(g, 'starhide swept temple four point clasp', q.addScaledVector(n, .004), n, .016, .025, m);
    }
  }

  if (dragon) {
    const brow: Surface = (u, v) => {
      const a = u * 2 - 1;
      return V(a * (.093 + .004 * v), 1.732 + .063 * (1 - Math.abs(a) ** 1.33) + .022 * v,
        .087 - .017 * Math.abs(a) ** 1.6 - .006 * v);
    };
    shell(g, 'dragonhide broad arched brow scale backing', brow, m.scales, m.lining, 32, 5, .0015, [1, .2]);
    addScaleField(g, 'dragonhide brow overlapping violet scales', brow, m, { columns: 16, rows: 3, bone: 'Head', lift: .0018, seed: 837 });
    edge(g, 'dragonhide raised gold arch lower edge', brow, 'u', 0, m, .0088, 40);
    edge(g, 'dragonhide gold crown arch upper edge', brow, 'u', 1, m, .0048, 40);
    stitches(g, 'dragonhide tiny arch seam stitches', brow, 'u', .97, m.thread, 50, .004);
  }

  // Keep the face fully open. The side cowl and crown line the hood; no
  // veil, throat leaves, or opaque sheet spans the face opening.
  addCrest(g, theme, m);
  g.userData.fit = { nativeBody: 'base_male', crownY: 1.81, clothThicknessMeters: .002, faceOpening: 'open', headBone: 'Head' };
  return g;
}
