import * as THREE from 'three';

/** Split the source's closed lip into independent upper/lower surfaces and fill the mouth cavity. */
export function splitSalamanderMouth(mesh, jaw) {
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const attributes = geometry.attributes;
  const jawIndex = mesh.skeleton.bones.indexOf(jaw);
  const neckIndex = mesh.skeleton.bones.findIndex(bone => bone.name === 'FireSalamander_Neck_TopSHJnt');
  const out = { position: [], normal: [], uv: [], skinIndex: [], skinWeight: [] };
  const seam = [];
  const read = i => ({
    p: new THREE.Vector3().fromBufferAttribute(attributes.position, i),
    n: new THREE.Vector3().fromBufferAttribute(attributes.normal, i),
    uv: new THREE.Vector2().fromBufferAttribute(attributes.uv, i),
    w: new Map(Array.from({ length: 4 }, (_, c) => [attributes.skinIndex.getComponent(i, c), attributes.skinWeight.getComponent(i, c)]).filter(([, value]) => value > 0)),
  });
  const mix = (a, b, t) => {
    const w = new Map();
    for (const [joint, weight] of a.w) w.set(joint, weight * (1 - t));
    for (const [joint, weight] of b.w) w.set(joint, (w.get(joint) ?? 0) + weight * t);
    return { p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize(), uv: a.uv.clone().lerp(b.uv, t), w };
  };
  const clip = (polygon, dimension, bound, positive, collect = false) => {
    const clipped = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = a.p[dimension] - bound, db = b.p[dimension] - bound;
      const insideA = positive ? da >= 0 : da <= 0, insideB = positive ? db >= 0 : db <= 0;
      if (insideA) clipped.push(a);
      if (insideA !== insideB) {
        const crossing = mix(a, b, da / (da - db));
        clipped.push(crossing);
        if (collect) seam.push(crossing.p.clone());
      }
    }
    return clipped;
  };
  let lowerVertices = 0;
  const emit = (polygon, lower) => {
    for (let t = 1; t + 1 < polygon.length; t++) for (const vertex of [polygon[0], polygon[t], polygon[t + 1]]) {
      const w = new Map(vertex.w);
      if (lower) {
        const amount = THREE.MathUtils.smoothstep(vertex.p.z, 10.7, 11.55);
        for (const [joint, weight] of w) w.set(joint, weight * (1 - amount));
        w.set(jawIndex, (w.get(jawIndex) ?? 0) + amount); lowerVertices++;
      }
      const entries = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = entries.reduce((sum, [, value]) => sum + value, 0);
      while (entries.length < 4) entries.push([0, 0]);
      out.position.push(...vertex.p.toArray()); out.normal.push(...vertex.n.toArray()); out.uv.push(...vertex.uv.toArray());
      out.skinIndex.push(...entries.map(([joint]) => joint)); out.skinWeight.push(...entries.map(([, value]) => value / sum));
    }
  };
  for (let i = 0; i < attributes.position.count; i += 3) {
    const triangle = [read(i), read(i + 1), read(i + 2)];
    const front = clip(triangle, 'z', 10.7, true);
    emit(clip(triangle, 'z', 10.7, false), false);
    if (!front.length) continue;
    emit(clip(front, 'y', 4.2, true, true), false);
    emit(clip(front, 'y', 4.2, false), true);
  }
  const replaced = new THREE.BufferGeometry();
  for (const [name, values] of Object.entries(out)) replaced.setAttribute(name, name === 'skinIndex'
    ? new THREE.Uint16BufferAttribute(values, 4)
    : new THREE.Float32BufferAttribute(values, name === 'uv' ? 2 : name.startsWith('skin') ? 4 : 3));
  replaced.computeBoundingBox(); replaced.computeBoundingSphere();
  mesh.geometry = replaced;
  const unique = [...new Map(seam.map(point => [point.toArray().map(value => value.toFixed(5)).join(','), point])).values()];
  const center = unique.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(unique.length);
  unique.sort((a, b) => Math.atan2(a.z - center.z, a.x - center.x) - Math.atan2(b.z - center.z, b.x - center.x));
  const interior = { position: [], uv: [], skinIndex: [], skinWeight: [] };
  for (const [joint, offset] of [[neckIndex, .005], [jawIndex, -.005]]) {
    for (let i = 0; i < unique.length; i++) {
      for (const point of [center, unique[i], unique[(i + 1) % unique.length]]) {
        interior.position.push(point.x, point.y + offset, point.z);
        interior.uv.push(.5 + point.x * .08, (point.z - 10.7) / 4);
        interior.skinIndex.push(joint, 0, 0, 0); interior.skinWeight.push(1, 0, 0, 0);
      }
    }
  }
  const innerGeometry = new THREE.BufferGeometry();
  for (const [name, values] of Object.entries(interior)) innerGeometry.setAttribute(name, name === 'skinIndex'
    ? new THREE.Uint16BufferAttribute(values, 4)
    : new THREE.Float32BufferAttribute(values, name === 'uv' ? 2 : name.startsWith('skin') ? 4 : 3));
  innerGeometry.computeVertexNormals();
  const innerMaterial = new THREE.MeshStandardMaterial({ color: 0x21100b, roughness: .84, side: THREE.DoubleSide });
  innerMaterial.name = 'animal_kiln_salamander_mouth_interior';
  const inner = new THREE.SkinnedMesh(innerGeometry, innerMaterial);
  inner.name = 'salamander_authored_mouth_interior';
  inner.position.copy(mesh.position); inner.quaternion.copy(mesh.quaternion); inner.scale.copy(mesh.scale);
  mesh.parent.add(inner); inner.updateMatrixWorld(true);
  inner.bind(mesh.skeleton, mesh.bindMatrix.clone());
  return { vertices: replaced.attributes.position.count, lowerVertices, interiorVertices: innerGeometry.attributes.position.count, seamVertices: unique.length };
}
