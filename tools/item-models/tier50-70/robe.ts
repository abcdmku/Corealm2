import * as THREE from 'three';
import type { ArmorMaterials, ArmorTheme, Surface } from './contracts.js';
import { addScaleField } from './scale-field.js';
import { V, TAU, mix, clamp, bodyPoint, normalAt, shell, ribbon, frame, diamond, filigree, offset, face } from './robe-geometry.js';
import type { Domain } from './robe-geometry.js';

function scaleSurfaceInsideBinding(f: Surface, bindingWidth: number): Surface {
  // The scale field already clips 2.4 mm at the sides and 1.8 mm at its ends.
  // Reserve the rest of the binding's inner half, plus 0.6 mm, so raised lips
  // cannot pass through its bevel. The backing and metal outline stay fixed.
  const sideInset = Math.max(0, bindingWidth * .56 + .0006 - .0024);
  const endInset = Math.max(0, bindingWidth * .56 + .0006 - .0018);
  const vInset = Math.min(.06, endInset / Math.max(.001, f(.5, 0).distanceTo(f(.5, 1))));
  const rowInsets = new Map<number, number>();
  return (u, v) => {
    const row = mix(vInset, 1 - vInset, v);
    let inset = rowInsets.get(row);
    if (inset === undefined) {
      inset = Math.min(.38, sideInset / Math.max(.001, f(0, row).distanceTo(f(1, row))));
      rowInsets.set(row, inset);
    }
    return f(mix(inset, 1 - inset, u), row);
  };
}

function scutes(g: THREE.Group, name: string, f: Surface, m: ArmorMaterials,
  columns: number, rows: number, domain?: Domain, seed = 17, bindingWidth = 0, backingRows = 14, backingRecess = 0): number {
  shell(g, `${name} dark recessed backing`, backingRecess ? offset(f, -backingRecess) : f,
    m.lining, m.lining, 8, backingRows, .004, domain);
  const firstScale = g.children.length;
  const scaleSurface = bindingWidth ? scaleSurfaceInsideBinding(f, bindingWidth) : f;
  addScaleField(g, `${name} individual overlapping scutes`, scaleSurface, m, {
    columns, rows, lift: .00025, seed,
    ...(domain === 'skirt' ? { deform: 'skirt' as const } : domain ? { bone: domain } : {}),
  });
  return g.children.slice(firstScale).reduce((height, child) =>
    Math.max(height, child.userData.scaleField?.faceReliefRange?.[1] ?? 0), 0);
}

function torso(g: THREE.Group, theme: ArmorTheme, m: ArmorMaterials) {
  const dragon = theme === 'dragonhide';
  const bodice: Surface = (u, v) => {
    // Extend behind the sash so torso flexion cannot uncover the waist seam.
    const y = mix(1.015, 1.337, v), a = u * TAU;
    const fold = .0019 * Math.sin(a * 8 + v * 2.4) * Math.sin(Math.PI * v);
    return bodyPoint(y, a, .015 + fold);
  };
  shell(g, 'Smooth fitted sleeveless cloth bodice', bodice, m.cloth, m.lining, 64, 24, .0025, undefined, true);
  // A sewn underlay closes the chest behind the decorative V lapels. It ends
  // below the throat, leaving the split collar and exposed arms untouched.
  const chestUnderlay: Surface = (u, v) => {
    const a = mix(-.70, .70, u);
    const neckline = 1.482 + .003 * Math.pow(Math.abs(u * 2 - 1), 1.4);
    return bodyPoint(mix(1.310, neckline, v), a, .013);
  };
  shell(g, 'Fitted inner chest fabric beneath V lapels', chestUnderlay,
    m.cloth, m.lining, 16, 12, .0025, undefined, true);
  const upper: Surface = (u, v) => {
    const a = u * TAU, frontAngle = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
    const notch = Math.pow(Math.max(0, 1 - frontAngle / .70), 1.10);
    const top = 1.479 - .089 * Math.pow(Math.abs(Math.sin(a)), 5) - (dragon ? .084 : .108) * notch;
    const y = mix(1.328, top, v), p = bodyPoint(y, a, .016);
    // Shoulder tissue enters the body scan above the armhole. Ease the yoke
    // inward smoothly while preserving the closed front and upper back.
    const side = Math.pow(Math.abs(Math.sin(a)), 5) * Math.pow(v, 2);
    p.x = mix(p.x, Math.sin(a) * .201, side);
    return p;
  };
  shell(g, 'Continuous upper back and curved open armholes', upper, m.cloth, m.lining, 64, 16, .0025, 'spine_03', true);
  // The sharper blue V needs closer samples so its binding follows the cloth
  // instead of cutting a straight chord through the curved yoke.
  const necklinePath = Array.from({length: dragon ? 9 : 17}, (_, k) => [k / (dragon ? 8 : 16), 1] as [number, number]);
  ribbon(g, 'Turned metal bound armhole and neck edge', upper,
    necklinePath, dragon ? .0084 : .007, m.metal, 'spine_03', false, true);

  // The fitted underlay is the visible chest fabric. Extra crossed inner bands
  // exposed their lining and cut across one another beneath the long lapels.

  for (const side of [-1, 1]) {
    const chestRaw: Surface = (u, v) => {
      const y = mix(1.091, 1.405, v);
      const center = dragon ? .33 + .58 * v - .20 * Math.sin(v * Math.PI) : .26 + .61 * v - .17 * Math.sin(v * Math.PI);
      const width = dragon ? .08 + .64 * Math.sin(Math.PI * v * .85) : .06 + .51 * Math.sin(Math.PI * v * .86);
      return bodyPoint(y, side * (center + (u - .5) * width), .020);
    };
    const chest = face(chestRaw, V(side * .3, 0, 1));
    scutes(g, `Sinuous ${dragon ? 'broad' : 'slender'} chest scale inset ${side}`, chest, m, dragon ? 6 : 5, 15, undefined, side + 11, dragon ? .0102 : .0081);
    frame(g, `Chest inset ${side}`, offset(chest, .0015), m, dragon ? .0102 : .0081);

    const lapelRaw: Surface = (u, v) => {
      const y = mix(dragon ? 1.199 : 1.093, 1.475, v);
      const a = side * ((dragon ? .009 : .017) + (dragon ? .48 : .46) * v + (u - .5) * (.070 + .16 * v));
      const turnedFold = (dragon ? .008 : .012) * Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
      const p = bodyPoint(y, a, .027 + turnedFold);
      p.y += .004 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      return p;
    };
    const lapel = face(lapelRaw, V(0, 0, 1));
    shell(g, `${dragon ? 'Open V' : 'Overlapping long V'} folded lapel ${side}`, lapel, m.cloth, m.lining, 12, 32, .0032, undefined, true);
    frame(g, `Folded lapel ${side}`, lapel, m, dragon ? .0088 : .0075);
    if (dragon) {
      const brocade: Surface = (u, v) => bodyPoint(mix(1.209, 1.432, v), side * (.035 + .53 * u), .023);
      const f = face(brocade, V(0, 0, 1));
      ribbon(g, `Chest gold acanthus stem ${side}`, f, [[.10, .13], [.18, .4], [.40, .63], [.74, .82]], .0040, m.metal, undefined, true);
      ribbon(g, `Chest gold broad leaf ${side}`, f, [[.20, .39], [.39, .41], [.43, .56], [.63, .65]], .0070, m.metal, undefined, true);
      ribbon(g, `Chest gold upper leaf ${side}`, f, [[.40, .62], [.33, .77], [.53, .86], [.74, .82]], .0060, m.metal, undefined, true);
    }
    const backRaw: Surface = (u, v) => bodyPoint(mix(1.092, 1.425, v), Math.PI + side * (.21 + .35 * v + (u - .5) * (.060 + .37 * Math.sin(v * Math.PI))), .020);
    const back = face(backRaw, V(0, 0, -1));
    scutes(g, `Tapered back scale inset ${side}`, back, m, 4, 13, undefined, 41 + side, dragon ? .0083 : .007);
    frame(g, `Back inset ${side}`, offset(back, .0015), m, dragon ? .0083 : .007);
  }

  const collar: Surface = (u, v) => {
    const a = .40 + u * (TAU - .80), bottom = 1.447 + .009 * Math.cos(a);
    const y = mix(bottom, 1.570 - .020 * Math.cos(a), v);
    const rx = mix(.096, .089, v) + .004 * Math.sin(v * Math.PI), rz = mix(.096, .103, v);
    return V(Math.sin(a) * rx, y, -.045 + Math.cos(a) * rz);
  };
    shell(g, 'Sculpted standing split collar with turned lining', collar, m.cloth, m.lining, 48, 12, .0032, 'spine_03');
  frame(g, 'Standing collar', collar, m, dragon ? .009 : .0073, 'spine_03');
  ribbon(g, 'Standing collar rolled top edge', collar, [[0, 1], [.2, 1], [.4, 1], [.6, 1], [.8, 1], [1, 1]], dragon ? .009 : .0075, m.metal, 'spine_03', false, true);
  for (const side of [0, 1]) {
    const f: Surface = (u, v) => offset(collar, .002)(side ? .85 + .14 * u : .01 + .14 * u, .11 + .77 * v);
    if (dragon) scutes(g, `Collar front scale facing ${side}`, f, m, 3, 4, 'spine_03', 91 + side);
    filigree(g, `Collar sculpted foliage ${side}`, offset(f, dragon ? .0015 : .001), m, 'spine_03', dragon);
  }
  if (dragon) {
    const clasp: Surface = (u, v) => bodyPoint(mix(1.176, 1.275, v), (u - .5) * .36, .033);
    diamond(g, 'Dragon pointed sternum clasp', clasp, .5, .50, .37, .40, m, undefined, true);
  }
}

function shoulders(g: THREE.Group, theme: ArmorTheme, m: ArmorMaterials) {
  const dragon = theme === 'dragonhide';
  for (const side of [-1, 1]) {
    const front = new THREE.CatmullRomCurve3([
      V(side * .104, 1.468, .036), V(side * .153, 1.488, .064),
      V(side * .215, 1.501, .036), V(side * (dragon ? .279 : .273), dragon ? 1.522 : 1.530, -.010),
    ]);
    const rear = new THREE.CatmullRomCurve3([
      V(side * .104, 1.468, -.116), V(side * .154, 1.492, -.151),
      V(side * .209, 1.504, -.160), V(side * (dragon ? .264 : .253), dragon ? 1.518 : 1.555, -.132),
    ]);
    const saddleRaw: Surface = (u, v) => {
      const t = .001 + .998 * v, p = front.getPoint(t).lerp(rear.getPoint(t), u);
      const dip = Math.sin(u * Math.PI) * Math.pow(v, 3);
      p.x -= side * (dragon ? .013 : .042) * dip;
      p.y += .007 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI) - (dragon ? .009 : .018) * dip;
      return p;
    };
    const saddle = face(saddleRaw, V(0, 1, 0));
    shell(g, `${dragon ? 'Broad single-wing' : 'Twin-crest'} curved shoulder saddle ${side}`, saddle, m.cloth, m.lining, 16, 20, .0035, 'spine_03');
    const scale: Surface = (u, v) => offset(saddle, .004)(.12 + .76 * u, .15 + .76 * v);
    scutes(g, `Shoulder saddle inset ${side}`, scale, m, 6, 7, 'spine_03', 71 + side);
    ribbon(g, `Shoulder sculpted outer swept rim ${side}`, saddle, [[0, 1], [.2, 1], [.4, 1], [.6, 1], [.8, 1], [1, 1]], dragon ? .011 : .009, m.metal, 'spine_03', false, true);

    for (const isRear of [false, true]) {
      const crest = isRear ? rear : front;
      const edge = new THREE.CatmullRomCurve3([
        V(side * .179, 1.423, isRear ? -.143 : .064),
        V(side * .204, 1.452, isRear ? -.161 : .064),
        V(side * .237, 1.474, isRear ? -.150 : .028),
        crest.getPoint(1),
      ]);
      const leafRaw: Surface = (u, v) => {
        const t = .001 + .998 * v, p = crest.getPoint(t).lerp(edge.getPoint(t), u);
        // Convex metal-faced leather turns over the armhole instead of ending
        // in a flat triangular fin. The lower boundary has a shallow scallop.
        p.z += (isRear ? -1 : 1) * .004 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
        p.y += .003 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
        return p;
      };
      const leaf = face(leafRaw, V(0, 0, isRear ? -1 : 1));
      shell(g, `${isRear ? 'Rear' : 'Front'} curved shoulder overlap ${side}`, leaf, m.cloth, m.lining, 12, 20, .0035, 'spine_03');
      frame(g, `Shoulder overlap ${side} ${isRear}`, leaf, m, dragon ? .010 : .0087, 'spine_03');
      const inset: Surface = (u, v) => offset(leaf, .003)(.16 + .63 * u, .16 + .67 * v);
      if (dragon) scutes(g, `Shoulder outer scale leaf ${side} ${isRear}`, inset, m, 3, 6, 'spine_03', 51 + side + Number(isRear));
      filigree(g, `Shoulder chased metal foliage ${side} ${isRear}`, offset(inset, dragon ? .0015 : .001), m, 'spine_03', dragon);
    }
  }
}

/** Gentle widening between R9 and the reference; accepted tip turns stay in tails(). */
export function robeCoatPoint(y: number, angle: number, theme: ArmorTheme, lift = 0): THREE.Vector3 {
  const dragon = theme === 'dragonhide', t = clamp((1.057 - y) / .79), waist = bodyPoint(1.057, angle, .017);
  // Open the skirt gradually below the fitted waist, halfway between R9's
  // narrow loft and the reference loft. Keep the sharper turn at the tips.
  const rise = Math.pow(clamp(t / .82), 1.22);
  const outward = mix(rise, 1, THREE.MathUtils.smoothstep(t, .62, .82));
  const midEase = .022 * Math.sin(Math.PI * clamp(t / .82)) ** 2;
  const xRadius = .173 + (dragon ? .2125 : .165) * outward + midEase;
  const zRadius = .137 + (dragon ? .082 : .070) * outward, centerZ = -.023 - .014 * t;
  const anatomy = Math.pow(1 - t, 5);
  const hipEase = .020 * Math.exp(-Math.pow((y - .84) / .115, 2)) * Math.pow(Math.abs(Math.sin(angle)), 1.5);
  const kneeEase = .029 * Math.exp(-Math.pow((y - .57) / .13, 2)) * Math.pow(Math.max(0, Math.cos(angle)), 3);
  const fold = .0045 * Math.sin(angle * 10 + .65 * t) * Math.sin(t * Math.PI * .95);
  const x = Math.sin(angle) * (xRadius + lift + fold + hipEase), z = centerZ + Math.cos(angle) * (zRadius + lift + fold + hipEase + kneeEase);
  return V(mix(x, waist.x + Math.sin(angle) * lift, anatomy), y, mix(z, waist.z + Math.cos(angle) * lift, anatomy));
}

/** Added front-cloth depth in metres; the cut edges and their normals stay fixed. */
function tailoredFrontDrape(u: number, v: number, phase: number): number {
  // Leave a guard around the stitching as well as the cut edge. Quintic ramps
  // meet the untouched cloth with zero first and second derivatives, including
  // the finite-difference stencil used by lining, bindings, and sewn edges.
  const across = THREE.MathUtils.smootherstep(u, .095, .20)
    * (1 - THREE.MathUtils.smootherstep(u, .80, .905));
  const hanging = THREE.MathUtils.smootherstep(v, .08, .25)
    * (1 - THREE.MathUtils.smootherstep(v, .79, .97));
  if (!across || !hanging) return 0;

  // Broad folds fan slightly from the waist. Unequal depths, widths, and slow
  // lateral bends avoid parallel fluting while remaining readable on the
  // existing 18-column shell. The split tails use different bend phases.
  const fall = 1 - v, spread = .72 + .28 * fall;
  const left = .5 - .265 * spread + .018 * Math.sin(4.1 * v + phase);
  const trough = .5 + .010 * spread + .014 * Math.sin(5.4 * v + 1.2 + phase);
  const right = .5 + .270 * spread + .021 * Math.sin(3.5 * v + .8 + phase);
  const channel = (at: number, width: number) => Math.exp(-Math.pow((u - at) / width, 2));
  const depth = 1.50 * channel(left, .086 + .025 * fall)
    - 1.20 * channel(trough, .100 + .025 * fall)
    + 1.00 * channel(right, .072 + .028 * fall);
  // Saturation bounds added relief strictly below 12 mm without a hard crease.
  // Move along Z only, so neither the panel outline nor skirt width correction
  // can shift the accepted scaled panels elsewhere on the robe.
  return .012 * across * hanging * Math.tanh(depth);
}

function tails(g: THREE.Group, theme: ArmorTheme, m: ArmorMaterials) {
  const dragon = theme === 'dragonhide';
  const centers = dragon ? [0, .89, 1.68, 2.49, Math.PI, TAU - 2.49, TAU - 1.68, TAU - .89] : [.40, 1.12, 1.91, 2.73, 3.56, 4.37, 5.16, 5.88];
  for (let k = 0; k < centers.length; k++) {
    const center = centers[k]!, front = dragon ? k === 0 : k === 0 || k === 7;
    const half = dragon ? front ? .40 : .44 : front ? .347 : .42;
    const hem = dragon
      ? front ? .440 : (k === 1 || k === 7) ? .285 : (k === 2 || k === 6) ? .355 : .315 + (k % 2) * .024
      : front ? .278 : .312 + (k % 2) * .028;
    const panel: Surface = (u, v) => {
      const tip = Math.pow(Math.abs(2 * u - 1), dragon ? 1.12 : 1.3);
      const bottom = hem + (dragon && front ? .16 : .135) * tip;
      const y = mix(bottom, 1.063, v), a = center + (u - .5) * half * 2 + .105 * Math.sin(v * Math.PI) * Math.sin(center);
      let fold = (front ? .0025 : .0060) * Math.sin(u * Math.PI * 2.2 + .4) * Math.sin(v * Math.PI) + .004 * Math.sin(u * Math.PI) * (1 - v);
      if (front) {
        // Three unequal cloth channels gather into the waist and relax toward
        // the pointed hem. Small wandering centres avoid an extruded flute.
        const spread = Math.sqrt(1 - v), envelope = Math.pow(Math.sin(v * Math.PI), .75);
        const channels = [
          { at: .20, bend: .028 * Math.sin(v * 5.2), amount: .0050 },
          { at: .49, bend: .022 * Math.sin(v * 7.1 + .8), amount: -.0042 },
          { at: .79, bend: .031 * Math.sin(v * 4.8 + 1.3), amount: .0038 },
        ];
        for (const channel of channels) {
          const centre = mix(.5, channel.at, spread) + channel.bend * spread;
          fold += channel.amount * Math.exp(-Math.pow((u - centre) / (.080 + .025 * (1 - v)), 2)) * envelope;
        }
      }
      const p = robeCoatPoint(y, a, theme, (front ? .012 : .005 + (k % 2) * .004) + fold);
      // Each staggered panel gets its own short, accelerating tip turn. Using
      // local panel height keeps the flare at the hem, including shorter tails.
      const tipProgress = clamp((.24 - v) / .24);
      const tipFlare = (Math.expm1(4 * tipProgress) - 4 * tipProgress) / (Math.expm1(4) - 4);
      const pointedEnd = .20 + .80 * Math.pow(Math.sin(u * Math.PI), 3);
      p.x += Math.sin(a) * .075 * tipFlare * pointedEnd;
      p.z += Math.cos(a) * .022 * tipFlare * pointedEnd;
      p.y -= .004 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
      if (front) p.z += tailoredFrontDrape(u, v, dragon ? 0 : k === 0 ? -.20 : .55);
      return p;
    };
    const rearScales = dragon && (k === 3 || k === 5);
    if (rearScales) {
      // Replace the two rear flanking fabric panels on red T70. Their authored
      // loft, pointed tips and gold perimeter remain the same. Four columns
      // keep the plates close to the size of the adjacent long scale gores.
      const rearScaleCarrier: Surface = (u, v) => {
        // Clear the central panel's concealed gold binding while returning to
        // the original loft at the perimeter and pointed hem.
        const clearance = .004
          * THREE.MathUtils.smootherstep(u, .06, .18)
          * (1 - THREE.MathUtils.smootherstep(u, .82, .94))
          * THREE.MathUtils.smootherstep(v, .10, .35)
          * (1 - THREE.MathUtils.smootherstep(v, .90, .98));
        return panel(u, v).addScaledVector(normalAt(panel, u, v), clearance);
      };
      scutes(g, `Long pointed rear scale panel ${k}`, rearScaleCarrier, m, 4, 18, 'skirt', 181 + k, .009, 12, .001);
    } else {
      shell(g, dragon && front ? 'Dragonhide single central pointed cloth tabard' : `${front ? 'Split front' : 'Overlapping side and back'} long folded cloth tail ${k}`, panel, m.cloth, m.lining, 18, 30, .003, 'skirt', true);
    }
    frame(g, `Cloth tail ${k}`, panel, m, dragon ? .009 : .0073, 'skirt');
    if (!rearScales) {
      for (const edge of [.085, .915]) ribbon(g, `Tail ${k} sewn edge ${edge}`, offset(panel, .001), [[edge, .045], [edge, .5], [edge, 1]], .0010, m.thread, 'skirt');
      if (front || k === 3 || k === 4) filigree(g, `Tail ${k} sculpted hem ornament`, offset(panel, .002), m, 'skirt', dragon);
    }
    if ((dragon && (k === 1 || k === 7)) || (!dragon && (k === 2 || k === 5))) {
      const inset: Surface = (u, v) => {
        const width = .06 + .81 * Math.sin(Math.PI * (.06 + v * .82));
        return offset(panel, .006)(.5 + (u - .5) * width, .035 + .945 * v);
      };
      scutes(g, `Long pointed side scale gore ${k}`, inset, m, 6, 22, 'skirt', 111 + k, dragon ? .0093 : .008);
      frame(g, `Long side scale gore ${k}`, offset(inset, .0015), m, dragon ? .0093 : .008, 'skirt');
    }
  }

  for (const side of [-1, 1]) for (const layer of [0, 1]) {
    const leafRaw: Surface = (u, v) => {
      const y = mix(layer ? .735 : dragon ? .500 : .406, layer ? 1.083 : .929, v);
      const center = mix(layer ? .64 : .64, layer ? 1.07 : 1.25, v) + .10 * Math.sin(v * Math.PI);
      const width = .025 + (dragon ? .87 : .80) * Math.pow(Math.sin(Math.PI * v * .88), .86);
      const a = side * (center + (u - .5) * width);
      const tuck = THREE.MathUtils.smoothstep(v, .76, 1);
      const lift = mix(layer ? .041 : .029, layer ? .011 : .014, tuck);
      // Keep the sewn waist joins fixed. Only the free end needs clearance
      // above the lower tasset's raised scales or the underlying scale gore.
      const overlapClearance = (layer ? .007 : .004) * (1 - THREE.MathUtils.smootherstep(v, .12, .45));
      return robeCoatPoint(y, a, theme, lift + overlapClearance + .006 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI));
    };
    const leaf = face(leafRaw, V(side * .65, 0, 1));
    const scaleRelief = scutes(g, `${layer ? 'Upper' : 'Lower'} curved overlapping scale tasset ${side}`, leaf, m, layer ? 6 : 7, layer ? 10 : 16, 'skirt', 131 + layer * 3 + side, dragon ? .011 : .009);
    frame(g, `Curved tasset ${side} ${layer}`, offset(leaf, .0015), m, dragon ? .011 : .009, 'skirt');
    ribbon(g, `Curved tasset ${side} ${layer} waist join`, offset(leaf, .0015), [[0, 1], [.25, 1], [.5, 1], [.75, 1], [1, 1]], dragon ? .010 : .008, m.metal, 'skirt', false, true);
    // Ribbon undersides sit 1 mm below their carrier at the bevel edge.
    // Put the diamond above the actual highest scute, with 0.8 mm clearance.
    diamond(g, `Tasset ${side} ${layer} chased tip`, offset(leaf, scaleRelief + .0018), .5, .11, .22, .084, m, 'skirt');
  }
}

function waist(g: THREE.Group, theme: ArmorTheme, m: ArmorMaterials) {
  const dragon = theme === 'dragonhide';
  const sash: Surface = (u, v) => {
    const a = u * TAU;
    const y = 1.072 + .025 * Math.abs(Math.sin(a)) - .029 * Math.pow(Math.max(0, Math.cos(a)), 10) + (v - .5) * .034;
    return bodyPoint(y, a, .030);
  };
  shell(g, 'Curved fitted waist sash', sash, m.cloth, m.lining, 80, 6, .003, 'skirt');
  for (const v of [0, 1]) ribbon(g, `Waist sash engraved border ${v}`, sash, [[0, v], [.125, v], [.25, v], [.375, v], [.5, v], [.625, v], [.75, v], [.875, v], [1, v]], dragon ? .009 : .0078, m.metal, 'skirt', false, true);
  const clasp: Surface = (u, v) => bodyPoint(mix(.972, 1.126, v), (u - .5) * .45, .039);
  diamond(g, 'Elongated central waist stone and metal setting', clasp, .5, .61, dragon ? .44 : .34, .32, m, 'skirt', true);
  if (!dragon) diamond(g, 'Starhide lower split-front pendant', clasp, .5, .15, .21, .12, m, 'skirt');
}

export function buildRobe(theme: ArmorTheme, materials: ArmorMaterials): THREE.Group {
  const g = new THREE.Group(); g.name = `${theme} sculpted sleeveless robe`;
  torso(g, theme, materials); shoulders(g, theme, materials); tails(g, theme, materials);
  // Add half the distance from R9's 2x waist width to the reference-matched
  // R7 width. Include tip ornaments and metal borders in the final extent.
  const fittedWaistWidth = bodyPoint(1.14, Math.PI / 2, .015).x - bodyPoint(1.14, -Math.PI / 2, .015).x;
  const referenceWidth = theme === 'dragonhide' ? .9677893817424774 : .8030880391597748;
  const targetWidth = mix(fittedWaistWidth * 2, referenceWidth, .5);
  const bounds = new THREE.Box3().setFromObject(g);
  const widthCorrection = targetWidth / (bounds.max.x - bounds.min.x);
  g.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const position = node.geometry.getAttribute('position');
    const normal = node.geometry.getAttribute('normal');
    let changed = false;
    for (let i = 0; i < position.count; i++) {
      const t = clamp((1.057 - position.getY(i)) / .79);
      const u = clamp(t / .42), correction = mix(1, widthCorrection, u * u * (3 - 2 * u));
      if (correction === 1) continue;
      const x = position.getX(i), derivative = -(widthCorrection - 1) * 6 * u * (1 - u) / (.79 * .42);
      const n = V(normal.getX(i) / correction, normal.getY(i) - x * derivative * normal.getX(i) / correction, normal.getZ(i)).normalize();
      position.setX(i, x * correction);
      normal.setXYZ(i, n.x, n.y, n.z);
      changed = true;
    }
    if (!changed) return;
    position.needsUpdate = true;
    normal.needsUpdate = true;
    node.geometry.computeBoundingBox();
    node.geometry.computeBoundingSphere();
  });
  waist(g, theme, materials);
  g.userData.skirtWidth = { fittedWaistWidth, targetWidth, ratio: targetWidth / fittedWaistWidth, fractionTowardReference: .5, includesTipsAndTrim: true };
  g.userData.robeDesign = theme === 'dragonhide' ? 'single pointed central tabard; broad shoulder wings' : 'paired split front tails; twin swept shoulder crests';
  return g;
}
