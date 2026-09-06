import * as THREE from 'three';

// Original Corealm creature. The lofts are anatomical surfaces, including the
// continuous tail/ribcage/neck. Every visible part shares the deforming skeleton.
export async function buildMonitor() {
  const TAU = Math.PI * 2;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const clamp = THREE.MathUtils.clamp;
  const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const pulse = (t, a, peak, b) => t < peak ? smooth((t - a) / (peak - a)) : 1 - smooth((t - peak) / (b - peak));
  const hash = (a, b = 0) => { const n = Math.sin(a * 127.1 + b * 311.7 + 24.97) * 43758.5453; return n - Math.floor(n); };
  const colors = {
    ash: new THREE.Color('#4c534a'), slate: new THREE.Color('#353c34'), pale: new THREE.Color('#b3b293'),
    belly: new THREE.Color('#b8b79a'), fold: new THREE.Color('#80866c'), dark: new THREE.Color('#343e33'),
    claw: new THREE.Color('#b9b598'), tip: new THREE.Color('#4b5042'), mouth: new THREE.Color('#543d3b'),
  };
  const object = new THREE.Group();
  object.name = 'ashscale_monitor';
  const bones = [], boneByName = new Map(), rests = new Map();
  function bone(name, parent, world) {
    const b = new THREE.Bone(); b.name = `monitor_${name}`;
    b.position.copy(world);
    if (parent) b.position.sub(rests.get(parent).world);
    (parent || object).add(b);
    b.userData.anatomy = name;
    rests.set(b, { world: world.clone(), position: b.position.clone(), quaternion: b.quaternion.clone(), scale: b.scale.clone() });
    boneByName.set(name, b); bones.push(b); return b;
  }
  const root = bone('root', null, V(0, 0, 0));
  const pelvis = bone('pelvis', root, V(0, .58, -.53));
  const spine = bone('spine', pelvis, V(0, .63, -.02));
  const chest = bone('chest', spine, V(0, .66, .53));
  const neck = bone('neck_base', chest, V(0, .70, .73));
  const neckTip = bone('neck_upper', neck, V(0, .93, 1.04));
  const head = bone('head', neckTip, V(0, 1.047, 1.27));
  const jaw = bone('jaw', head, V(0, 1.018, 1.27));
  const tongue = bone('tongue', jaw, V(0, 1.014, 1.58));
  const tail = [];
  const tailPos = [[0, .51, -.79], [0, .40, -1.17], [0, .28, -1.57], [0, .18, -1.98], [0, .105, -2.40], [0, .05, -2.86]];
  tailPos.forEach((p, i) => tail.push(bone(`tail_${i + 1}`, i ? tail[i - 1] : pelvis, V(...p))));
  const legs = [];
  for (const hind of [false, true]) for (const side of [1, -1]) {
    const label = `${hind ? 'hind' : 'fore'}_${side > 0 ? 'left' : 'right'}`;
    const hipPos = V(side * (hind ? .27 : .235), hind ? .55 : .615, hind ? -.52 : .49);
    const kneePos = V(side * (hind ? .66 : .65), hind ? .265 : .275, hind ? -.70 : .24);
    const footPos = V(side * (hind ? .78 : .75), .085, hind ? -.42 : .76);
    const upper = bone(`${label}_upper`, hind ? pelvis : chest, hipPos);
    const lower = bone(`${label}_lower`, upper, kneePos);
    const foot = bone(`${label}_foot`, lower, footPos);
    const toes = [];
    const toeLengths = hind ? [.120, .195, .285, .310, .185] : [.105, .180, .235, .220, .135];
    for (let digit = 0; digit < 5; digit++) {
      const spread = [-.048, -.025, 0, .028, .051][digit];
      const toePos = footPos.clone().add(V(side * spread, -.041, .077 - Math.abs(digit - 2) * .014));
      const b = bone(`${label}_toe_${digit + 1}`, foot, toePos);
      toes.push({ bone: b, start: toePos, length: toeLengths[digit], angle: [-.46, -.17, .055, .23, .60][digit] * side });
    }
    legs.push({ label, side, hind, upper, lower, foot, toes, hipPos, kneePos, footPos,
      a: hipPos.distanceTo(kneePos), b: kneePos.distanceTo(footPos),
      upperDir: kneePos.clone().sub(hipPos).normalize(), lowerDir: footPos.clone().sub(kneePos).normalize() });
  }
  const boneIndex = new Map(bones.map((b, i) => [b, i]));
  const rigid = (b) => [[boneIndex.get(b), 1]];
  const mix = (a, b, t) => [[boneIndex.get(a), 1 - clamp(t, 0, 1)], [boneIndex.get(b), clamp(t, 0, 1)]];
  const axisBones = [...tail].reverse().concat([pelvis, spine, chest, neck, neckTip, head]);
  function axialWeights(z) {
    for (let i = 0; i < axisBones.length - 1; i++) {
      const a = axisBones[i], b = axisBones[i + 1];
      const az = rests.get(a).world.z, bz = rests.get(b).world.z;
      if (z <= bz) return mix(a, b, smooth((z - az) / (bz - az)));
    }
    return rigid(head);
  }
  const positions = [], uvs = [], vertexColors = [], indicesByMaterial = Array.from({ length: 7 }, () => []), skinIndices = [], skinWeights = [], normalWelds = [];
  function vertex(p, uv, color, weights) {
    const n = positions.length / 3;
    positions.push(p.x, p.y, p.z); uvs.push(...uv); vertexColors.push(color.r, color.g, color.b);
    const ids = [0, 0, 0, 0], ws = [0, 0, 0, 0];
    weights.forEach(([id, w], i) => { ids[i] = id; ws[i] = w; });
    skinIndices.push(...ids); skinWeights.push(...ws); return n;
  }
  function tri(mat, a, b, c) { indicesByMaterial[mat].push(a, b, c); }
  function stitch(mat, rings, sides) {
    rings.forEach(ring => normalWelds.push([ring[0], ring[sides]]));
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
      const a = rings[i][j], b = rings[i + 1][j], c = rings[i][j + 1], d = rings[i + 1][j + 1];
      tri(mat, a, b, c); tri(mat, b, d, c);
    }
  }
  // Each profile row is z, centre height, width radius, height radius.
  const profile = [
    [-2.99, .031, .002, .002], [-2.85, .049, .022, .018], [-2.59, .077, .041, .033],
    [-2.27, .123, .070, .052], [-1.9, .190, .106, .083], [-1.5, .290, .150, .119],
    [-1.12, .421, .206, .163], [-.79, .531, .266, .211], [-.54, .58, .319, .252],
    [-.22, .611, .367, .273], [.12, .633, .355, .260], [.41, .650, .317, .237],
    [.62, .681, .246, .195], [.78, .773, .215, .168], [.96, .902, .181, .143],
    [1.115, .997, .147, .112], [1.275, 1.043, .114, .094],
  ];
  function interpolate(rows, z, col) {
    let i = 0;
    while (i < rows.length - 2 && z > rows[i + 1][0]) i++;
    const a = rows[i], b = rows[i + 1], prev = rows[Math.max(0, i - 1)], next = rows[Math.min(rows.length - 1, i + 2)];
    const dz = b[0] - a[0], t = clamp((z - a[0]) / dz, 0, 1);
    const m0 = (b[col] - prev[col]) / (b[0] - prev[0]);
    const m1 = (next[col] - a[col]) / (next[0] - a[0]);
    return (2 * t ** 3 - 3 * t * t + 1) * a[col] + (t ** 3 - 2 * t * t + t) * dz * m0 + (-2 * t ** 3 + 3 * t * t) * b[col] + (t ** 3 - t * t) * dz * m1;
  }
  function skinPoint(z, angle, relief = 0) {
    const cy = interpolate(profile, z, 1), rx = interpolate(profile, z, 2), ry = interpolate(profile, z, 3);
    const dy = (interpolate(profile, z + .002, 1) - interpolate(profile, z - .002, 1)) / .004;
    const up = V(0, 1, -dy).normalize();
    return V(Math.sin(angle) * (rx + relief), cy + Math.cos(angle) * (ry + relief) * up.y, z + Math.cos(angle) * (ry + relief) * up.z);
  }
  function skinColor(z, angle, row, col) {
    const underside = smooth((-Math.cos(angle) - .02) / .72);
    const c = colors.ash.clone().lerp(colors.belly, underside);
    const band = .5 + .5 * Math.sin((z + 2.9) * 20 + Math.sin(angle * 3) * .9);
    if (z < -.88) c.multiplyScalar(.77 + .31 * smooth((band - .2) / .65));
    const cell = hash(row, col);
    c.multiplyScalar(.88 + cell * .18);
    if (Math.cos(angle) > -.38 && z > -.95 && z < .90) {
      const spots = Math.sin(z * 28 + angle * 5.3) * Math.sin(angle * 15 - z * 3);
      if (spots > .40) c.lerp(colors.pale, .53);
      else if (spots < -.52) c.lerp(colors.dark, .38);
    }
    return c;
  }
  const bodyRings = [], nBody = 112, bodySides = 44;
  const bodyHoles = legs.map(leg => {
    const middle = Math.round((leg.hipPos.z - profile[0][0]) / (profile.at(-1)[0] - profile[0][0]) * nBody);
    const around = leg.side > 0 ? bodySides / 4 : bodySides * 3 / 4;
    return { leg, i0: middle - 3, i1: middle + 3, j0: around - 2, j1: around + 2, boundary: [] };
  });
  for (let i = 0; i <= nBody; i++) {
    const z = THREE.MathUtils.lerp(profile[0][0], profile.at(-1)[0], i / nBody), ring = [];
    for (let j = 0; j <= bodySides; j++) {
      const theta = j / bodySides * TAU;
      const cellU = (i % 3) / 3, cellV = ((j + Math.floor(i / 3) % 2 * 2) % 4) / 4;
      const ridge = Math.sin(cellU * Math.PI) ** 2 * Math.sin(cellV * Math.PI) ** 2;
      const relief = ridge * Math.min(.0027, interpolate(profile, z, 2) * .012) * (.6 + .4 * Math.max(0, Math.cos(theta)));
      ring.push(vertex(skinPoint(z, theta, relief), [j / bodySides * 4, (z + 3) / .6], skinColor(z, theta, Math.floor(i / 3), Math.floor((j % bodySides) / 4)), axialWeights(z)));
    }
    bodyRings.push(ring);
  }
  bodyRings.forEach(ring => normalWelds.push([ring[0], ring[bodySides]]));
  for (let i = 0; i < nBody; i++) for (let j = 0; j < bodySides; j++) {
    if (bodyHoles.some(h => i >= h.i0 && i < h.i1 && j >= h.j0 && j < h.j1)) continue;
    const a = bodyRings[i][j], b = bodyRings[i + 1][j], c = bodyRings[i][j + 1], d = bodyRings[i + 1][j + 1];
    tri(0, a, b, c); tri(0, b, d, c);
  }
  // The limb loops reuse the torso's actual boundary vertices. There is no
  // intersecting shoulder cap: the flank and leg form one connected skin.
  for (const h of bodyHoles) {
    for (let j = h.j0; j < h.j1; j++) h.boundary.push(bodyRings[h.i0][j]);
    for (let i = h.i0; i < h.i1; i++) h.boundary.push(bodyRings[i][h.j1]);
    for (let j = h.j1; j > h.j0; j--) h.boundary.push(bodyRings[h.i1][j]);
    for (let i = h.i1; i > h.i0; i--) h.boundary.push(bodyRings[i][h.j0]);
  }
  // Low hexagonal scutes sit on the dorsal skin. Their edges follow the curved
  // anatomical surface; centre relief gives real scale highlights at grazing light.
  let scaleCount = 0;
  for (let row = 0; row < 48; row++) {
    const baseZ = -2.38 + row * .061;
    for (let column = -4; column <= 4; column++) {
      if (hash(row + 2, column + 30) < .22) continue;
      const z = baseZ + (hash(row + 101, column + 20) - .5) * .029;
      const theta = column * .245 + (row % 2) * .115 + (hash(row + 50, column + 3) - .5) * .105;
      const halfZ = .016 + hash(row + 80, column + 7) * .010, halfAngle = .065 + hash(row + 23, column + 5) * .028;
      const c = skinColor(z, theta, row + 200, column + 7);
      const centre = vertex(skinPoint(z, theta, .0032 * Math.min(1, interpolate(profile, z, 2) / .11)), [theta / TAU * 4, (z + 3) / .6], c, axialWeights(z));
      const outline = [[-1, 0], [-.52, -.93], [.48, -.93], [1, 0], [.48, .93], [-.52, .93]].map(([a, b]) => {
        const pz = z + a * halfZ, pa = theta + b * halfAngle;
        return vertex(skinPoint(pz, pa, .0003), [pa / TAU * 4, (pz + 3) / .6], c.clone().multiplyScalar(.98), axialWeights(pz));
      });
      for (let j = 0; j < 6; j++) tri(0, centre, outline[j], outline[(j + 1) % 6]);
      scaleCount++;
    }
  }
  // A custom swept surface used for limbs, digits, folds, and the jaw. The
  // radii vary along anatomical curves instead of stacking rigid cylinders.
  function tube(points, widths, heights, options = {}) {
    const { rings = 18, sides = 16, weights = () => rigid(head), color = () => colors.ash, mat = 0, floor = false, grain = .003, caps = true, rootBoundary = null, startAt = 0, uvWidth = 1 } = options;
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const ringsOut = [], arcLength = curve.getLength(), alongUV = new Float32Array(sides + 1);
    let previousFrame = null;
    const scalar = (a, t) => { const f = t * (a.length - 1), k = Math.min(a.length - 2, Math.floor(f)); return THREE.MathUtils.lerp(a[k], a[k + 1], f - k); };
    for (let i = 0; i <= rings; i++) {
      const t = startAt + i / rings * (1 - startAt), p = curve.getPoint(t), dir = curve.getTangent(t);
      if (i === 0 && rootBoundary) {
        const anchor = V(...positions.slice(rootBoundary[0] * 3, rootBoundary[0] * 3 + 3)).sub(p);
        previousFrame = anchor.addScaledVector(dir, -anchor.dot(dir)).normalize();
        // UV seams split render vertices only. The position, weighting and
        // smoothed normal remain welded to the torso boundary.
        const seam = rootBoundary.map((id, j) => {
          const p = V(...positions.slice(id * 3, id * 3 + 3)), c = new THREE.Color().fromArray(vertexColors, id * 3);
          const w = Array.from({ length: 4 }, (_, k) => [skinIndices[id * 4 + k], skinWeights[id * 4 + k]]);
          const copy = vertex(p, [j / sides * uvWidth, 0], c, w); normalWelds.push([id, copy]); return copy;
        });
        ringsOut.push([...seam, seam[0]]); continue;
      }
      const reference = Math.abs(dir.y) > .93 ? V(0, 0, 1) : V(0, 1, 0);
      const e1 = previousFrame ? previousFrame.clone().addScaledVector(dir, -previousFrame.dot(dir)).normalize() : dir.clone().cross(reference).normalize();
      const e2 = e1.clone().cross(dir).normalize(); previousFrame = e1;
      const ring = [];
      for (let j = 0; j <= sides; j++) {
        const a = TAU * j / sides;
        const detail = grain * Math.sin(Math.PI * (i % 3) / 3) ** 2 * Math.sin(Math.PI * (((j % sides) + Math.floor(i / 3) % 2) % 3) / 3) ** 2;
        const v = p.clone().addScaledVector(e1, Math.cos(a) * (scalar(widths, t) + detail)).addScaledVector(e2, Math.sin(a) * (scalar(heights, t) + detail));
        if (floor) v.y = Math.max(0, v.y);
        if (rootBoundary) {
          const prior = ringsOut.at(-1)[j];
          alongUV[j] += v.distanceTo(V(...positions.slice(prior * 3, prior * 3 + 3))) / .6;
        }
        ring.push(vertex(v, [j / sides * uvWidth, rootBoundary ? alongUV[j] : (t - startAt) * arcLength / .6], color(t, j === sides ? 0 : a, p), weights(t, p)));
      }
      ringsOut.push(ring);
    }
    stitch(mat, ringsOut, sides);
    if (caps) {
      const first = vertex(points[0], [.5, 0], color(0, 0, points[0]), weights(0, points[0]));
      const last = vertex(points.at(-1), [.5, 1], color(1, 0, points.at(-1)), weights(1, points.at(-1)));
      for (let j = 0; j < sides; j++) { tri(mat, first, ringsOut[0][j], ringsOut[0][j + 1]); tri(mat, last, ringsOut.at(-1)[j + 1], ringsOut.at(-1)[j]); }
    }
  }
  // Angular, shallow skull. Widened rear cheeks taper to the long blunt snout.
  const skull = [[1.185, 1.045, .095, .073], [1.275, 1.073, .158, .117], [1.38, 1.086, .171, .105], [1.49, 1.068, .145, .078], [1.63, 1.052, .112, .059], [1.759, 1.046, .078, .038], [1.778, 1.045, .001, .004]];
  function headSurface(rows, bindBone, count, sides, lower = false) {
    const rings = [];
    for (let i = 0; i <= count; i++) {
      const z = THREE.MathUtils.lerp(rows[0][0], rows.at(-1)[0], i / count), ring = [];
      const cy = interpolate(rows, z, 1), rx = interpolate(rows, z, 2), ry = interpolate(rows, z, 3);
      for (let j = 0; j <= sides; j++) {
        const a = j / sides * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        const x = Math.sign(sa) * Math.abs(sa) ** .78 * rx;
        const y = cy + Math.sign(ca) * Math.abs(ca) ** .70 * ry;
        const c = (lower ? colors.belly : colors.ash).clone().lerp(colors.pale, hash(Math.floor(i / 2) + 3, Math.floor(j / 3)) * .22);
        if (!lower && ca < -.15) c.lerp(colors.fold, .45);
        if (i % 3 === 1 && j % 3 === 1) c.multiplyScalar(.89);
        ring.push(vertex(V(x, y, z), [j / sides * 2, (z - rows[0][0]) / .6], c, rigid(bindBone)));
      }
      rings.push(ring);
    }
    stitch(0, rings, sides);
  }
  headSurface(skull, head, 26, 32);
  headSurface([[1.225, .995, .092, .024], [1.33, .985, .141, .038], [1.46, .984, .133, .033], [1.61, .997, .104, .020], [1.747, 1.006, .071, .012], [1.766, 1.008, .002, .002]], jaw, 19, 28, true);
  // Palate and lower mouth remain inside the lips until the jaw opens.
  tube([V(0, 1.018, 1.275), V(0, 1.013, 1.48), V(0, 1.016, 1.727)], [.085, .117, .051], [.009, .011, .005], { rings: 12, sides: 16, mat: 1, color: () => colors.mouth, weights: () => rigid(head), grain: 0 });
  tube([V(0, 1.01, 1.28), V(0, 1.006, 1.48), V(0, 1.011, 1.73)], [.075, .113, .049], [.006, .009, .004], { rings: 12, sides: 16, mat: 1, color: () => colors.mouth.clone().multiplyScalar(1.2), weights: () => rigid(jaw), grain: 0 });
  for (const side of [-1, 1]) {
    const lip = [V(side * .125, 1.027, 1.28), V(side * .147, 1.02, 1.40), V(side * .120, 1.018, 1.56), V(side * .077, 1.020, 1.735)];
    tube(lip, [.002, .0055, .004, .001], [.002, .006, .005, .001], { rings: 22, sides: 6, grain: 0, color: () => colors.dark, weights: () => rigid(head) });
    // Two elliptical eye lenses, their iris and slit sitting on a dark limbal ring.
    function lens(cx, cy, cz, rY, rZ, depth, mat, color) {
      const rings = [];
      for (let k = 0; k <= 5; k++) {
        const r = k / 5, ring = [];
        for (let j = 0; j <= 20; j++) {
          const a = j / 20 * TAU;
          ring.push(vertex(V(side * (cx + depth * Math.sqrt(Math.max(0, 1 - r * r))), cy + Math.sin(a) * rY * r, cz + Math.cos(a) * rZ * r), [(.5 + Math.cos(a) * r * .5), (.5 + Math.sin(a) * r * .5)], color, rigid(head)));
        }
        rings.push(ring);
      }
      // Lens points outward on either flank.
      normalWelds.push(rings[0]);
      rings.forEach(ring => normalWelds.push([ring[0], ring[20]]));
      for (let k = 0; k < 5; k++) for (let j = 0; j < 20; j++) {
        const a = rings[k][j], b = rings[k + 1][j], c = rings[k][j + 1], d = rings[k + 1][j + 1];
        if (side > 0) { tri(mat, a, c, b); tri(mat, b, c, d); } else { tri(mat, a, b, c); tri(mat, b, d, c); }
      }
    }
    lens(.162, 1.111, 1.372, .029, .036, .014, 2, new THREE.Color('#293126'));
    lens(.171, 1.112, 1.375, .018, .024, .007, 3, new THREE.Color('#938255'));
    lens(.176, 1.112, 1.376, .0165, .004, .003, 4, new THREE.Color('#101910'));
    tube([V(side * .152, 1.130, 1.336), V(side * .170, 1.142, 1.370), V(side * .161, 1.130, 1.408), V(side * .145, 1.115, 1.429)], [.003, .010, .009, .002], [.003, .007, .007, .002], { rings: 17, sides: 8, weights: () => rigid(head), color: () => colors.ash.clone().multiplyScalar(1.04), grain: .001 });
    // Elongated recessed nostril and the tapered scale over its upper rim.
    tube([V(side * .113, 1.081, 1.574), V(side * .109, 1.084, 1.610), V(side * .100, 1.079, 1.641)], [.001, .006, .001], [.001, .012, .001], { rings: 10, sides: 8, weights: () => rigid(head), color: () => colors.dark, grain: 0 });
    for (let i = 0; i < 10; i++) {
      const z = 1.337 + i * .036, x = side * THREE.MathUtils.lerp(.128, .070, i / 10);
      tube([V(x, 1.015, z), V(x * .98, .998, z + .005), V(x * .96, .990, z + .010)], [.010, .007, .0005], [.007, .005, .0005], { rings: 4, sides: 6, mat: 5, weights: () => rigid(head), color: () => colors.claw, grain: 0 });
    }
  }
  const tongueColor = new THREE.Color('#885c59');
  tube([V(0, 1.014, 1.58), V(0, 1.012, 1.77), V(0, 1.013, 1.94)], [.016, .011, .007], [.005, .004, .003], { rings: 12, sides: 8, mat: 1, weights: () => rigid(tongue), color: () => tongueColor, grain: 0 });
  for (const s of [-1, 1]) tube([V(s * .004, 1.013, 1.90), V(s * .018, 1.010, 1.99), V(s * .027, 1.013, 2.035)], [.006, .004, .0005], [.003, .002, .0005], { rings: 6, sides: 6, mat: 1, weights: () => rigid(tongue), color: () => tongueColor, grain: 0 });
  // Throat creases are attached to the neck, and curve beneath its stretched skin.
  for (let i = 0; i < 4; i++) {
    const z = .774 + i * .064, foldRings = [];
    for (let k = 0; k <= 4; k++) {
      const fz = z + (k / 4 - .5) * .032, row = [];
      for (let j = 0; j <= 20; j++) {
        const theta = 2.02 + j / 20 * 2.24;
        const height = .0018 * Math.sin(k / 4 * Math.PI) * Math.sin(j / 20 * Math.PI);
        row.push(vertex(skinPoint(fz, theta, height), [theta / TAU * 4, (fz + 3) / .6], colors.fold.clone().lerp(colors.belly, .16), axialWeights(fz)));
      }
      foldRings.push(row);
    }
    for (let k = 0; k < 4; k++) for (let j = 0; j < 20; j++) { tri(0, foldRings[k][j], foldRings[k + 1][j], foldRings[k][j + 1]); tri(0, foldRings[k + 1][j], foldRings[k + 1][j + 1], foldRings[k][j + 1]); }
  }
  for (const leg of legs) {
    const { hipPos, kneePos, footPos, upper, lower, foot, hind, side, toes } = leg;
    const buriedRoot = hipPos.clone(); buriedRoot.x = side * .06; buriedRoot.y += .013;
    const palmJoin = footPos.clone().add(V(0, -.036, .022));
    const pts = [buriedRoot, hipPos.clone(), hipPos.clone().lerp(kneePos, .46).add(V(0, .022, hind ? .025 : -.006)), kneePos.clone(), kneePos.clone().lerp(footPos, .54), palmJoin];
    const boundary = bodyHoles.find(h => h.leg === leg).boundary;
    tube(pts, hind ? [.092, .128, .118, .091, .075, .033] : [.078, .107, .098, .078, .064, .031], hind ? [.091, .116, .103, .083, .063, .026] : [.076, .098, .090, .073, .055, .025], {
      rings: 22, sides: boundary.length, caps: false, rootBoundary: boundary, startAt: .25, uvWidth: 2,
      weights: (t) => t < .35 ? mix(upper.parent, upper, smooth((t - .03) / .32)) : t < .70 ? mix(upper, lower, smooth((t - .51) / .19)) : mix(lower, foot, smooth((t - .87) / .13)),
      color: (t, a, p) => {
        const c = colors.ash.clone().lerp(colors.belly, Math.max(0, -Math.sin(a)) * .14);
        c.multiplyScalar(.92 + .12 * hash(Math.floor(t * 24) + 12, Math.floor(a * 4)));
        const stripe = Math.sin(t * 43 + Math.sin(a * 3));
        c.lerp(colors.dark, Math.max(0, stripe - .18) * .18);
        c.lerp(colors.pale, Math.max(0, -stripe - .42) * .24);
        return c;
      },
      grain: .002,
    });
    const palmBase = footPos.clone().add(V(0, -.031, -.016)), palmFront = footPos.clone().add(V(0, -.031, .099));
    tube([palmBase, footPos.clone().add(V(side * .004, -.032, .050)), palmFront], [.035, .061, .046], [.034, .048, .029], { rings: 12, sides: 16, weights: () => rigid(foot), floor: true, color: () => colors.ash.clone().lerp(colors.belly, .15), grain: .002 });
    for (const toe of toes) {
      const forward = V(Math.sin(toe.angle), 0, Math.cos(toe.angle));
      const knuckle = toe.start.clone().addScaledVector(forward, toe.length * .47); knuckle.y = .049 + .006 * Math.cos(toe.angle);
      const end = toe.start.clone().addScaledVector(forward, toe.length); end.y = .020;
      const tip = end.clone().addScaledVector(forward, .066); tip.y = .007;
      tube([toe.start, knuckle, end], [.020, .018, .011], [.019, .021, .010], { rings: 9, sides: 8, weights: (t) => mix(foot, toe.bone, smooth(t * 4)), floor: true, color: (t) => colors.ash.clone().lerp(colors.belly, .15 + t * .12), grain: .001 });
      tube([end.clone().addScaledVector(forward, -.011), end.clone().addScaledVector(forward, .023).add(V(0, .023, 0)), tip], [.014, .010, .0006], [.014, .011, .0006], { rings: 5, sides: 7, mat: 5, weights: () => rigid(toe.bone), floor: true, color: (t) => colors.claw.clone().lerp(colors.tip, t * t), grain: 0 });
      // Transverse digit scales are geometry ridges, with their own UV space.
      for (let k = 1; k <= 2; k++) {
        const centre = toe.start.clone().lerp(end, k / 3); centre.y += .018;
        const across = V(forward.z, 0, -forward.x).multiplyScalar(.019 * (1 - k * .08));
        tube([centre.clone().sub(across), centre.clone().add(V(0, .004, 0)), centre.clone().add(across)], [.001, .003, .001], [.001, .003, .001], { rings: 3, sides: 4, weights: () => rigid(toe.bone), color: () => colors.pale.clone().multiplyScalar(.86), grain: 0 });
      }
    }
    // The elbow/knee fold wraps around the joint instead of floating as a ring.
    const foldPts = [];
    for (let k = 0; k <= 10; k++) {
      const a = -.8 + k / 10 * 2;
      foldPts.push(kneePos.clone().add(V(side * Math.cos(a) * .076, Math.sin(a) * .071, .008)));
    }
    tube(foldPts, [.002, .008, .006, .002], [.002, .006, .005, .002], { rings: 14, sides: 6, weights: () => mix(upper, lower, .48), color: () => colors.fold, grain: 0 });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  const indices = [];
  indicesByMaterial.forEach((row, material) => { if (row.length) { geometry.addGroup(indices.length, row.length, material); indices.push(...row); } });
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  for (const weld of normalWelds) {
    const n = V(0, 0, 0);
    for (const id of weld) n.add(V(normals.getX(id), normals.getY(id), normals.getZ(id)));
    n.normalize(); for (const id of weld) normals.setXYZ(id, n.x, n.y, n.z);
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  // A deterministic, tileable Voronoi scale atlas is shared by every skin part.
  // Colour, tangent normals and roughness vary independently. UV density makes
  // trunk scales broader, with finer scales wrapping the neck, limbs and digits.
  function scaleMaps() {
    const size = 512, cells = 16, height = new Float32Array(size * size);
    const colour = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const gx = x / size * cells, gy = y / size * cells, cellX = Math.floor(gx), cellY = Math.floor(gy);
      let d1 = Infinity, d2 = Infinity, cellTone = .5;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const cx = cellX + ox, cy = cellY + oy, wx = (cx + cells) % cells, wy = (cy + cells) % cells;
        const sx = cx + .5 + (hash(wx + 901, wy + 31) - .5) * .46;
        const sy = cy + .5 + (hash(wx + 53, wy + 908) - .5) * .46;
        const d = Math.hypot(gx - sx, gy - sy);
        if (d < d1) { d2 = d1; d1 = d; cellTone = hash(wx + 171, wy + 49); } else if (d < d2) d2 = d;
      }
      const edge = smooth((d2 - d1 - .022) / .13), dome = 1 - smooth(d1 / .87);
      const grit = hash(x + 678, y + 951), index = y * size + x, out = index * 4;
      height[index] = edge * (.47 + dome * .29) + grit * .024;
      const value = clamp(Math.round(255 * (.73 + edge * .17 + cellTone * .065 + grit * .025)), 0, 255);
      colour.set([value, value, value, 255], out);
      const r = Math.round(219 - edge * 29 + cellTone * 16 + grit * 9); rough.set([r, r, r, 255], out);
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const left = height[y * size + (x + size - 1) % size], right = height[y * size + (x + 1) % size];
      const down = height[((y + size - 1) % size) * size + x], up = height[((y + 1) % size) * size + x];
      const n = V((left - right) * 3.8, (down - up) * 3.8, 1).normalize();
      normal.set([Math.round((n.x * .5 + .5) * 255), Math.round((n.y * .5 + .5) * 255), Math.round((n.z * .5 + .5) * 255), 255], (y * size + x) * 4);
    }
    const tex = (data, name, colorSpace = THREE.NoColorSpace) => {
      let texture;
      if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        const pixels = context.createImageData(size, size); pixels.data.set(data); context.putImageData(pixels, 0, 0);
        texture = new THREE.CanvasTexture(canvas);
      } else texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      texture.name = name; texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.anisotropy = 4;
      texture.colorSpace = colorSpace; texture.needsUpdate = true; return texture;
    };
    return { map: tex(colour, 'ashscale original fine scale colour', THREE.SRGBColorSpace), normalMap: tex(normal, 'ashscale original scale normals'), roughnessMap: tex(rough, 'ashscale original scale roughness') };
  }
  const maps = scaleMaps();
  const materials = [
    new THREE.MeshStandardMaterial({ name: 'Ashscale pebbled skin and ventral scales', color: 0xffffff, vertexColors: true, roughness: .97, metalness: 0, ...maps, normalScale: new THREE.Vector2(.53, .53) }),
    new THREE.MeshStandardMaterial({ name: 'Soft mouth and forked tongue', color: 0xffffff, vertexColors: true, roughness: .62, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ name: 'Recessed dark eye surround', color: 0xffffff, vertexColors: true, roughness: .24 }),
    new THREE.MeshStandardMaterial({ name: 'Old gold iris', color: 0xffffff, vertexColors: true, roughness: .31 }),
    new THREE.MeshStandardMaterial({ name: 'Vertical black pupil', color: 0xffffff, vertexColors: true, roughness: .14 }),
    new THREE.MeshStandardMaterial({ name: 'Worn keratin claws and teeth', color: 0xffffff, vertexColors: true, roughness: .66 }),
    new THREE.MeshStandardMaterial({ name: 'Ventral fold accent', color: 0xffffff, vertexColors: true, roughness: .9 }),
  ];
  const mesh = new THREE.SkinnedMesh(geometry, materials);
  mesh.name = 'ashscale_monitor_anatomical_skin'; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  object.add(mesh); object.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.userData = { originalTopology: true, modeledDorsalScutes: scaleCount, digitCount: 20, uvLayout: 'continuous longitudinal body and local part islands', forward: '+Z' };

  function reset() { for (const b of bones) { const r = rests.get(b); b.position.copy(r.position); b.quaternion.copy(r.quaternion); b.scale.copy(r.scale); } tongue.scale.z = .025; }
  function rotate(b, x = 0, y = 0, z = 0) { b.quaternion.setFromEuler(new THREE.Euler(x, y, z, 'XYZ')); }
  function solveLeg(leg, target, footRotation = new THREE.Quaternion(), kneeLift = 0) {
    object.updateMatrixWorld(true);
    const hip = leg.upper.getWorldPosition(new THREE.Vector3());
    const delta = target.clone().sub(hip), distance = clamp(delta.length(), .045, leg.a + leg.b - .004), direction = delta.normalize();
    const pole = V(leg.side * 1.0, -.32 + kneeLift, leg.hind ? -.43 : -.72);
    pole.addScaledVector(direction, -pole.dot(direction)).normalize();
    const along = (leg.a * leg.a - leg.b * leg.b + distance * distance) / (2 * distance);
    const high = Math.sqrt(Math.max(0, leg.a * leg.a - along * along));
    const kneePosition = hip.clone().addScaledVector(direction, along).addScaledVector(pole, high);
    const upperWorldQ = new THREE.Quaternion().setFromUnitVectors(leg.upperDir, kneePosition.clone().sub(hip).normalize());
    const parentQ = leg.upper.parent.getWorldQuaternion(new THREE.Quaternion());
    leg.upper.quaternion.copy(parentQ.invert()).multiply(upperWorldQ);
    const lowerWorldQ = new THREE.Quaternion().setFromUnitVectors(leg.lowerDir, target.clone().sub(kneePosition).normalize());
    leg.lower.quaternion.copy(upperWorldQ.clone().invert()).multiply(lowerWorldQ);
    leg.foot.quaternion.copy(lowerWorldQ.clone().invert()).multiply(footRotation);
  }
  const walkSeconds = 1.36, runSeconds = .72, walkStride = .48, runStride = .68, walkDuty = .74, runDuty = .56;
  function pose(kind, time, duration) {
    reset();
    const u = time / duration;
    let legMode = 'fixed', death = 0;
    if (kind === 'Idle') {
      const wave = Math.sin(TAU * u);
      pelvis.position.y += .008 * (1 - Math.cos(TAU * u));
      rotate(spine, 0, .012 * wave, 0); rotate(chest, .006 * wave, -.01 * wave, 0);
      rotate(neck, -.012 * wave, .025 * Math.sin(TAU * u), 0);
      rotate(neckTip, .009 * wave, -.020 * Math.sin(TAU * u), 0);
      tail.forEach((b, i) => rotate(b, 0, .014 * Math.sin(TAU * u - i * .54) - .014 * Math.sin(-i * .54), 0));
      tongue.scale.z = .025 + .975 * pulse(u, .54, .575, .605) + .72 * pulse(u, .615, .642, .67);
    } else if (kind === 'Walk' || kind === 'Run') {
      legMode = kind;
      const run = kind === 'Run', wave = Math.sin(TAU * u), amplitude = run ? .052 : .032;
      pelvis.position.x += amplitude * wave;
      pelvis.position.y += (run ? .018 : .009) * (1 - Math.cos(TAU * u * 2));
      rotate(pelvis, run ? .018 * Math.sin(TAU * u * 2) : 0, (run ? .055 : .038) * wave, 0);
      rotate(spine, 0, -(run ? .085 : .065) * wave, .012 * wave);
      rotate(chest, 0, (run ? .055 : .040) * wave, -.012 * wave);
      rotate(neck, run ? .035 : .012, -.018 * wave, 0);
      rotate(neckTip, run ? -.03 : -.01, .012 * wave, 0);
      rotate(head, 0, -.017 * wave, 0);
      tail.forEach((b, i) => rotate(b, i === 0 ? .023 - (run ? .018 * Math.sin(TAU * u * 2) : 0) : .001 * Math.sin(TAU * u - i * .4), (run ? .066 : .045) * Math.sin(TAU * u - i * .47), 0));
    } else if (kind === 'Attack') {
      const wind = pulse(u, .02, .23, .44), bite = pulse(u, .25, .48, .89), recoil = pulse(u, .48, .61, .94);
      pelvis.position.z += .067 * bite - .035 * wind;
      pelvis.position.y -= .027 * bite;
      rotate(spine, .02 * wind + .044 * bite, -.05 * wind, 0);
      rotate(chest, -.033 * wind + .082 * bite, .07 * wind, 0);
      rotate(neck, -.16 * wind + .28 * bite, -.06 * wind, 0);
      rotate(neckTip, -.10 * wind + .16 * bite, 0, 0);
      rotate(head, -.04 * wind - .22 * bite + .08 * recoil, 0, 0);
      rotate(jaw, .65 * pulse(u, .10, .34, .51) + .05 * recoil, 0, 0);
      tail.forEach((b, i) => rotate(b, .012 * bite, .065 * wind * (1 + i * .1) - .04 * recoil, 0));
    } else if (kind === 'Death') {
      death = smooth(u / .88);
      pelvis.position.y -= .155 * death;
      pelvis.position.x += .13 * death;
      rotate(pelvis, -.07 * death, .10 * death, -1.22 * death);
      rotate(spine, .12 * death, -.17 * death, -.05 * death);
      rotate(chest, .10 * death, .08 * death, 0);
      rotate(neck, .51 * death, -.16 * death, .06 * death);
      rotate(neckTip, .37 * death, .09 * death, 0);
      rotate(head, -.14 * death, 0, 0);
      rotate(jaw, .19 * death, 0, 0);
      tail.forEach((b, i) => rotate(b, i === 0 ? .055 * death : 0, (.09 + i * .012) * death + .034 * Math.sin(TAU * u * 2 - i * .5) * Math.sin(Math.PI * u), .06 * death));
      // The limp tail settles along the ground instead of inheriting the rolled
      // pelvis orientation and pointing into the air at the end of the fall.
      const restingHeights = [.25, .17, .12, .082, .05, .027];
      tail.forEach((b, i) => {
        object.updateMatrixWorld(true);
        const here = b.getWorldPosition(V(0, 0, 0));
        const restDir = i < tail.length - 1 ? rests.get(tail[i + 1]).position.clone() : V(0, -.020, -.130);
        const originalEnd = restDir.clone().applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion())).add(here);
        const y = Math.max(restingHeights[i], THREE.MathUtils.lerp(originalEnd.y, restingHeights[i], death));
        const dy = clamp(y - here.y, -restDir.length() * .96, restDir.length() * .96);
        const originalHorizontal = originalEnd.clone().sub(here); originalHorizontal.y = 0; originalHorizontal.normalize();
        const horizontal = originalHorizontal.lerp(V(-.045 * (i + 1) ** 1.3 + .13 - here.x, 0, -1).normalize(), death).normalize().multiplyScalar(Math.sqrt(restDir.lengthSq() - dy * dy));
        horizontal.y = dy;
        const desired = new THREE.Quaternion().setFromUnitVectors(restDir.normalize(), horizontal.normalize());
        b.quaternion.copy(b.parent.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(desired);
      });
    } else {
      const side = kind === 'HitLeft' ? -1 : kind === 'HitRight' ? 1 : 0;
      const impact = pulse(u, 0, .16, .78), recover = pulse(u, .3, .53, 1);
      pelvis.position.z -= .04 * impact;
      pelvis.position.y -= .029 * impact;
      pelvis.position.x += side * .028 * impact;
      rotate(spine, -.04 * impact, -side * .095 * impact, side * .045 * impact);
      rotate(chest, -.04 * impact, -side * .13 * impact, side * .06 * impact);
      rotate(neck, -.12 * impact + .035 * recover, -side * .17 * impact, side * .06 * impact);
      rotate(neckTip, -.09 * impact, -side * .08 * impact, 0);
      rotate(head, .04 * recover, side * .045 * recover, 0);
      rotate(jaw, .12 * impact, 0, 0);
      tail.forEach((b, i) => rotate(b, .025 * impact, (side || 1) * .032 * impact * (1 + i * .15), 0));
    }
    for (const leg of legs) {
      const target = leg.footPos.clone();
      let lift = 0, footPitch = 0;
      if (legMode !== 'fixed') {
        const run = legMode === 'Run', duty = run ? runDuty : walkDuty, stride = run ? runStride : walkStride;
        const phaseOffset = run ? ((leg.hind ? leg.side < 0 : leg.side > 0) ? 0 : .5) : (leg.hind ? (leg.side > 0 ? .75 : .25) : (leg.side > 0 ? 0 : .5));
        const phase = (u + phaseOffset) % 1;
        if (phase < duty) target.z += stride * (.5 - phase / duty);
        else {
          const swing = (phase - duty) / (1 - duty);
          target.z += stride * (-.5 + smooth(swing));
          lift = Math.sin(Math.PI * swing);
          target.y += (run ? .145 : .088) * lift;
          target.x += leg.side * .023 * lift;
          footPitch = -.21 * lift;
        }
      }
      if (death > 0) {
        target.x += .17 * death;
        target.y += (leg.side > 0 ? .008 : .20) * death;
        target.z += (leg.hind ? -.08 : .10) * death;
        footPitch = (leg.side > 0 ? 0 : .04) * death;
      }
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(footPitch, 0, leg.side > 0 ? 0 : -death * .25));
      solveLeg(leg, target, rotation, death * .92);
      leg.toes.forEach((toe, i) => rotate(toe.bone, lift * (.09 + i * .018) + (leg.side > 0 ? 0 : death * .04), 0, 0));
    }
    object.updateMatrixWorld(true);
  }
  const definitions = [['Idle', 4.2, 100], ['Walk', walkSeconds, 72], ['Run', runSeconds, 72], ['Attack', 1.1, 72], ['Hit', .62, 46], ['HitLeft', .66, 46], ['HitRight', .66, 46], ['Death', 1.7, 80]];
  const clips = definitions.map(([name, duration, samples]) => {
    const times = [], channels = bones.map(() => ({ p: [], q: [], s: [] }));
    for (let i = 0; i <= samples; i++) {
      const t = duration * i / samples;
      // Force mathematically identical seam samples for cyclic and return clips.
      const sampleTime = i === samples && name !== 'Death' ? 0 : t;
      pose(name, sampleTime, duration); times.push(t);
      bones.forEach((b, j) => {
        const c = channels[j], q = b.quaternion.clone();
        if (c.q.length && q.dot(new THREE.Quaternion().fromArray(c.q, c.q.length - 4)) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        c.p.push(...b.position.toArray()); c.q.push(...q.toArray()); c.s.push(...b.scale.toArray());
      });
    }
    const tracks = [];
    bones.forEach((b, j) => {
      tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, times, channels[j].p));
      tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, channels[j].q));
      if (b === tongue) tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.scale`, times, channels[j].s));
    });
    const clip = new THREE.AnimationClip(name, duration, tracks);
    clip.userData = { authored: true, inPlace: true, footTrajectory: name === 'Walk' || name === 'Run' ? 'analytic stance line with two-bone IK and low return arc' : 'braced two-bone IK', contactNormalized: name === 'Attack' ? .48 : undefined };
    return clip;
  });
  reset(); object.updateMatrixWorld(true); mesh.skeleton.update();
  object.userData = { creatureId: 'ashscale_monitor', authoredBy: 'Corealm original procedural anatomy', forward: '+Z', units: 'meters', solePlane: 0 };
  return {
    object, clips,
    meta: {
      id: 'ashscale_monitor', is: 'ashscale monitor',
      tags: ['reptile', 'monitor', 'original', 'skinned', 'modeled-scales', 'five-toed', 'long-tail'],
      provenance: 'Original Corealm authored continuous anatomical lofts, custom scale topology, weighted rig and analytical IK animation. No third-party meshes or textures.',
      attackSeconds: 1.1, contactNormalized: .48,
      impliedWalkMps: walkStride / (walkDuty * walkSeconds), impliedRunMps: runStride / (runDuty * runSeconds),
      walkClipSeconds: walkSeconds, runClipSeconds: runSeconds,
      gaitFootBones: legs.map(l => l.foot.name),
      notes: ['+Z forward, Y up, metre units, contact pads at Y=0.', 'Continuous ribcage, muscular tapered tail, long raised neck and shallow wedge skull.', `${scaleCount} irregular modeled dorsal scutes, continuous fine scale colour/normal/roughness maps, flush throat folds, 20 unequal articulated clawed digits, recessed eyes, teeth and forked tongue.`, 'Walk stance 74%, run stance 56%; contact feet translate backward linearly, paired with the recorded implied travel speeds. No root translation.', 'Idle/Walk/Run have matching endpoints. Attack and all three hit reactions return to their initial pose; Death holds its collapsed pose.'],
    },
  };
}
