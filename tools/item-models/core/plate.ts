import * as THREE from "three";
import type { CoreArmorBuilder, FitSection } from "./contracts.js";

type Surface = (u: number, v: number) => THREE.Vector3;
const TAU = Math.PI * 2;
const mix = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Interpolate the measured body, preserving its asymmetric front/back outline. */
function section(sections: readonly FitSection[], level: number, angle: number): [number, number, number, number] {
  if (!sections.length) throw new Error("Plate armor requires measured native body sections");
  const sorted = [...sections].sort((a, b) => a.level - b.level);
  let hi = sorted.findIndex(s => s.level >= level);
  if (hi < 0) hi = sorted.length - 1;
  const b = sorted[hi]!, a = sorted[Math.max(0, hi - 1)]!;
  const t = b.level === a.level ? 0 : clamp((level - a.level) / (b.level - a.level), 0, 1);
  function radial(s: FitSection): number {
    const dx = Math.sin(angle), dz = Math.cos(angle);
    let radius = 0;
    for (let i = 0; i < s.outline.length; i++) {
      const p = s.outline[i]!, q = s.outline[(i + 1) % s.outline.length]!;
      const px = p[0] - s.center[0], pz = p[1] - s.center[1];
      const ex = q[0] - p[0], ez = q[1] - p[1];
      const det = dx * ez - dz * ex;
      if (Math.abs(det) < 1e-10) continue;
      const r = (px * ez - pz * ex) / det, along = (px * dz - pz * dx) / det;
      if (r >= 0 && along >= -1e-6 && along <= 1.000001) radius = Math.max(radius, r);
    }
    return radius;
  }
  return [mix(a.center[0], b.center[0], t), mix(a.center[1], b.center[1], t), mix(radial(a), radial(b), t), level];
}

/** The shell's outer surface sits 16 mm above skin, leaving 11 mm inside a 5 mm plate. */
function fitted(sections: readonly FitSection[], lo: number, hi: number, start: number, end: number,
  axis: "x" | "y", side = 1, clearance = .017, hem = 0): Surface {
  return (u, v) => {
    const angle = mix(start, end, u);
    const level = mix(lo, hi, v) + hem * Math.cos(angle) * Math.sin(Math.PI * v);
    const [c0, c1, r] = section(sections, level, angle);
    const radius = r + clearance;
    return axis === "y" ? V(side * (c0 + Math.sin(angle) * radius), level, c1 + Math.cos(angle) * radius)
      : V(side * level, c0 + Math.sin(angle) * radius, c1 + Math.cos(angle) * radius);
  };
}
function normal(s: Surface, u: number, v: number): THREE.Vector3 {
  const du = s(clamp(u + .0001, 0, 1), v).sub(s(clamp(u - .0001, 0, 1), v));
  const dv = s(u, clamp(v + .0001, 0, 1)).sub(s(u, clamp(v - .0001, 0, 1)));
  return du.cross(dv).normalize();
}

export const buildPlateArmor: CoreArmorBuilder = (slot, options) => {
  const g = new THREE.Group();
  g.name = `Core fitted plate ${slot}`;
  const m = options.materials;
  function mesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, bone: string) {
    geometry.computeVertexNormals();
    const object = new THREE.Mesh(geometry, material);
    object.name = name; object.userData.itemModelBone = bone;
    object.castShadow = true; object.receiveShadow = true; g.add(object); return object;
  }
  // Every panel is a closed volume, including side cuts and cuff openings.
  function shell(name: string, s: Surface, bone: string, nu = 48, nv = 16, thickness = .005,
    material: THREE.Material = m.shell, outward = 1) {
    nu = Math.max(8, Math.round(nu * .5)); nv = Math.max(2, Math.round(nv * .6));
    const positions: number[] = [], uv: number[] = [], indices: number[] = [];
    const stride = nu + 1, layerSize = stride * (nv + 1);
    const across: number[] = [0], along: number[] = [0];
    for (let i = 1; i <= nu; i++) across.push(across[i - 1]! + s(i / nu, .5).distanceTo(s((i - 1) / nu, .5)));
    for (let j = 1; j <= nv; j++) along.push(along[j - 1]! + s(.5, j / nv).distanceTo(s(.5, (j - 1) / nv)));
    for (let layer = 0; layer < 2; layer++) for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      const p = s(u, v).addScaledVector(normal(s, u, v), -layer * thickness * outward);
      positions.push(p.x, p.y, p.z); uv.push(across[i]! / .25, along[j]! / .25);
    }
    const tri = (a: number, b: number, c: number, sign = outward) => sign > 0 ? indices.push(a, b, c) : indices.push(a, c, b);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
      tri(a, b, d); tri(a, d, c); tri(a + layerSize, d + layerSize, b + layerSize); tri(a + layerSize, c + layerSize, d + layerSize);
    }
    const boundary: number[] = [];
    for (let i = 0; i < nu; i++) boundary.push(i);
    for (let j = 0; j < nv; j++) boundary.push(j * stride + nu);
    for (let i = nu; i > 0; i--) boundary.push(nv * stride + i);
    for (let j = nv; j > 0; j--) boundary.push(j * stride);
    for (let i = 0; i < boundary.length; i++) { const a = boundary[i]!, b = boundary[(i + 1) % boundary.length]!; tri(a, a + layerSize, b + layerSize); tri(a, b + layerSize, b); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(indices);
    return mesh(name, geo, material, bone);
  }
  function cord(name: string, path: (t: number) => THREE.Vector3, radius: number, bone: string, material: THREE.Material = m.edge, steps = 48) {
    steps = Math.max(6, Math.round(steps * .5));
    const p: number[] = [], uv: number[] = [], ix: number[] = []; let distance = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, center = path(t), tangent = path(clamp(t + .0001, 0, 1)).sub(path(clamp(t - .0001, 0, 1))).normalize();
      const a = new THREE.Vector3().crossVectors(tangent, Math.abs(tangent.y) < .9 ? V(0, 1, 0) : V(1, 0, 0)).normalize(), b = new THREE.Vector3().crossVectors(tangent, a);
      if (i) distance += center.distanceTo(path((i - 1) / steps));
      for (let k = 0; k <= 4; k++) { const angle = k / 4 * TAU, q = center.clone().addScaledVector(a, Math.cos(angle) * radius).addScaledVector(b, Math.sin(angle) * radius); p.push(q.x, q.y, q.z); uv.push(distance / .25, k / 4 * TAU * radius / .25); }
    }
    for (let i = 0; i < steps; i++) for (let k = 0; k < 4; k++) {const a = i * 5 + k; ix.push(a, a + 1, a + 6, a, a + 6, a + 5);}
    // Flat end caps are hidden inside the adjoining rolled edge or shell.
    for (let k = 1; k < 3; k++) {ix.push(0, k + 1, k); const a = steps * 5; ix.push(a, a + k, a + k + 1);}
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(ix); mesh(name, geo, material, bone);
  }
  function rivet(name: string, s: Surface, u: number, v: number, bone: string, outward: number) {
    const c = s(u, v), n = normal(s, u, v).multiplyScalar(outward);
    const tangent = s(clamp(u + .001, 0, 1), v).sub(s(clamp(u - .001, 0, 1), v)).normalize();
    const b = new THREE.Vector3().crossVectors(n, tangent).normalize();
    const cap: Surface = (a, r) => c.clone().addScaledVector(tangent, Math.cos(a * TAU) * (.0001 + r * .0027)).addScaledVector(b, Math.sin(a * TAU) * (.0001 + r * .0027)).addScaledVector(n, .0005 + .0018 * (1 - r * r));
    shell(name, cap, bone, 10, 3, .001, options.detail === 2 ? m.accent : m.edge, -1);
  }
  function panel(name: string, s: Surface, bone: string, outward = 1, nu = 48, nv = 14, edges = true) {
    shell(name, s, bone, nu, nv, .005, m.shell, outward);
    if (edges) {
      for (const v of [0, 1]) cord(`${name} rolled hem ${v}`, t => s(t, v), .0014, bone, m.edge, nu);
      for (const u of [0, 1]) cord(`${name} returned edge ${u}`, t => s(u, t), .0013, bone, m.edge, nv);
    }
    for (const u of [.07, .93]) for (const v of [.13, .87]) rivet(`${name} flush fastening`, s, u, v, bone, outward);
    if (options.detail) {
      for (const v of [.07, .93]) cord(`${name} fine chased border`, t => s(mix(.07, .93, t), v).addScaledVector(normal(s, mix(.07, .93, t), v), .00035 * outward), .00035, bone, m.accent, nu * .5);
    }
  }
  const body = options.body;
  if (slot === "body") {
    // The neckline climbs to the base of the neck and drops only at the armholes.
    const torsoPanel = (start: number, end: number, back = false): Surface => (u, v) => {
      const angle = mix(start, end, u);
      const top = (back ? 1.507 : 1.492) - .057 * Math.pow(Math.abs(Math.sin(angle)), 1.5);
      const level = mix(1.177, top, v);
      const [cx, cz, radius] = section(body.torso, level, angle);
      // Shoulder-plane side rays include the arm root. Tailor the armhole inward.
      const x = clamp(cx + Math.sin(angle) * (radius + .018), -.204, .204);
      return V(x, level, cz + Math.cos(angle) * (radius + .018));
    };
    panel("Shaped breastplate", torsoPanel(-1.56, 1.56), "spine_03", 1, 48, 26);
    panel("Scapular backplate", torsoPanel(1.56, TAU - 1.56, true), "spine_03", 1, 48, 26);
    panel("Lower breast articulation", fitted(body.torso, 1.073, 1.205, -1.56, 1.56, "y", 1, .017), "spine_02", 1, 40, 10);
    panel("Lower back articulation", fitted(body.torso, 1.073, 1.205, 1.56, TAU - 1.56, "y", 1, .017), "spine_02", 1, 40, 10);
    for (const [start, end, back] of [[-1.56, 1.56, false], [1.56, TAU - 1.56, true]] as const) {
      const outer = torsoPanel(start, end, back);
      const inner: Surface = (u, v) => outer(u, v).addScaledVector(normal(outer, u, v), -.008);
      const lining = shell(`${back ? "Back" : "Breast"} continuous fitted arming lining`, inner, "spine_03", 40, 20, .002, m.lining);
      delete lining.userData.itemModelBone;
    }
    for (let i = 0; i < 3; i++) {
      const lo = 1.040 - i * .045;
      panel(`Abdominal articulated lame ${i + 1}`, fitted(body.torso, lo, lo + .085, 0, TAU, "y", 1, .019 + i * .0005), i === 0 ? "spine_01" : "pelvis", 1, 56, 6);
    }
    // Flexible arming leather bridges joints; no rigid bone tag, so the native skin
    // exporter blends this small underlayer while keeping every metal panel rigid.
    const waist = shell("Continuous flexible waist arming gusset", fitted(body.torso, .924, 1.242, 0, TAU, "y", 1, .015), "spine_01", 48, 12, .002, m.leather);
    delete waist.userData.itemModelBone;
    for (const side of [-1, 1]) {
      const suffix = side > 0 ? "l" : "r";
      const suspension: Surface = (u, v) => {
        const angle = mix(-Math.PI / 2, Math.PI / 2, v);
        return V(side * mix(.133, .174, u), 1.390 + .157 * Math.cos(angle), -.028 + .129 * Math.sin(angle));
      };
      shell(`${suffix} fitted shoulder suspension`, suspension, `clavicle_${suffix}`, 12, 24, .003, m.leather, -side);
      for (const u of [.06, .94]) cord(`${suffix} shoulder suspension seam`, t => suspension(u, t), .0006, `clavicle_${suffix}`, m.thread, 24);
      panel(`${suffix} shoulder crown`, fitted(body.leftArm, .190, .290, -.42, Math.PI + .42, "x", side, .017), `clavicle_${suffix}`, -side, 36, 8);
      for (let i = 0; i < 2; i++) panel(`${suffix} shoulder falling lame ${i + 1}`, fitted(body.leftArm, .267 + i * .038, .326 + i * .038, -.34, Math.PI + .34, "x", side, .017 - i * .001), `upperarm_${suffix}`, -side, 36, 5);
    }
    g.userData.coreCoverage = [{region: "torso", minY: .940, maxY: 1.490}];
  } else if (slot === "legs") {
    for (const side of [-1, 1]) {
      const suffix = side > 0 ? "l" : "r";
      panel(`${suffix} tailored cuisse`, fitted(body.leftLeg, .594, .915, -1.53, 1.53, "y", side, .017), `thigh_${suffix}`, side, 40, 18);
      panel(`${suffix} rear cuisse closure`, fitted(body.leftLeg, .613, .90, 1.55, TAU - 1.55, "y", side, .016), `thigh_${suffix}`, side, 32, 14);
      panel(`${suffix} rounded knee cup`, fitted(body.leftLeg, .511, .602, -1.4, 1.4, "y", side, .018), `calf_${suffix}`, side, 36, 8);
      panel(`${suffix} anatomical greave`, fitted(body.leftLeg, .235, .526, -1.55, 1.55, "y", side, .017), `calf_${suffix}`, side, 40, 18);
      panel(`${suffix} rear greave closure`, fitted(body.leftLeg, .242, .508, 1.57, TAU - 1.57, "y", side, .016), `calf_${suffix}`, side, 32, 14);
      const knee = shell(`${suffix} flexible closed knee arming gusset`, fitted(body.leftLeg, .472, .672, 0, TAU, "y", side, .015), `calf_${suffix}`, 40, 12, .002, m.leather, side);
      delete knee.userData.itemModelBone;
      const legBacking = shell(`${suffix} continuous flexible leg backing`, fitted(body.leftLeg, .204, .931, 0, TAU, "y", side, .011), `calf_${suffix}`, 40, 28, .002, m.lining, side);
      delete legBacking.userData.itemModelBone;
    }
    g.userData.coreCoverage = [{region: "legs", minY: .219, maxY: .910}];
  } else if (slot === "hands") {
    for (const side of [-1, 1]) {
      const suffix = side > 0 ? "l" : "r";
      panel(`${suffix} slim forearm cuff`, fitted(body.leftArm, .584, .708, -.05, TAU - .07, "x", side, .016), `lowerarm_${suffix}`, -side, 40, 12);
      for (let i = 0; i < 3; i++) panel(`${suffix} metacarpal articulation ${i + 1}`, fitted(body.leftHand, .705 + i * .028, .744 + i * .028, .10, Math.PI - .10, "x", side, .014), `hand_${suffix}`, -side, 28, 5);
    }
  } else if (slot === "feet") {
    for (const side of [-1, 1]) {
      const suffix = side > 0 ? "l" : "r";
      panel(`${suffix} ankle collar`, fitted(body.leftLeg, .115, .265, -.02, TAU - .04, "y", side, .016), `calf_${suffix}`, side, 40, 10);
      panel(`${suffix} fitted heel and toe shoe`, fitted(body.leftFoot, .004, .185, -.02, TAU - .04, "y", side, .014), `foot_${suffix}`, side, 48, 12);
      const ankle = shell(`${suffix} flexible closed ankle bellows`, fitted(body.leftFoot, .073, .275, 0, TAU, "y", side, .015), `foot_${suffix}`, 40, 14, .002, m.leather, side);
      delete ankle.userData.itemModelBone;
      const sole: Surface = (u, v) => {
        const angle = u * TAU, [cx, cz, r] = section(body.leftFoot, .008, angle);
        return V(side * (cx + Math.sin(angle) * (r + .014) * (1 - v * .999)), .004, cz + Math.cos(angle) * (r + .014) * (1 - v * .999));
      };
      shell(`${suffix} closed shaped leather sole`, sole, `foot_${suffix}`, 48, 4, .004, m.leather, -side);
      // The measured narrowing foot loft already covers the toe and instep; leave its ankle opening clear.
      const shoe = fitted(body.leftFoot, .004, .185, -.02, TAU - .04, "y", side, .014);
      for (const v of [.28, .56]) cord(`${suffix} sabaton articulation seam`, t => shoe(t, v), .0013, `foot_${suffix}`, m.edge, 48);
    }
  } else {
    const top = Math.max(...body.head.map(s => s.level));
    panel("Helmet rounded skull", fitted(body.head, 1.724, top - .006, -.02, TAU - .04, "y", 1, .017), "Head", 1, 56, 18);
    panel("Helmet nape and cheek wrap", fitted(body.head, 1.566, 1.737, .84, TAU - .84, "y", 1, .017), "Head", 1, 48, 16);
    // Crown closes with a low dome instead of a cone or top ornament.
    const cap: Surface = (u, v) => {
      const a = u * TAU, [cx, cz, r] = section(body.head, top - .012, a);
      return V(cx + Math.sin(a) * (r + .017) * (1 - v * .999), top - .012 + .029 * Math.sin(v * Math.PI / 2), cz + Math.cos(a) * (r + .017) * (1 - v * .999));
    };
    panel("Helmet closed crown", cap, "Head", 1, 48, 10, false);
    panel("Helmet shaped brow", fitted(body.head, 1.702, 1.732, -.86, .86, "y", 1, .017), "Head", 1, 32, 4);
  }
  g.userData.coreFamily = "plate";
  g.userData.fit = { source: body.source, sourceSha256: body.sourceSha256, shellThicknessM: .005, nominalOuterClearanceM: .017, textureTileM: .25 };
  return g;
};





