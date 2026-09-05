import * as THREE from 'three';

const smooth = (lo, hi, value) => THREE.MathUtils.smoothstep(value, lo, hi);

function blend(entries) {
  const p = new THREE.Vector3(), w = new Map();
  for (const [vertex, amount] of entries) {
    p.addScaledVector(vertex.p, amount);
    for (const [joint, weight] of vertex.w) w.set(joint, (w.get(joint) ?? 0) + amount * weight);
  }
  return { p, w };
}

/** Weld positions for curvature while keeping independent source UV corners at atlas seams. */
function component(geometry, start, end) {
  const a = geometry.attributes, vertices = [], faces = [], welded = new Map();
  for (let i = start; i < end; i += 3) {
    const ids = [], uv = [];
    for (let k = 0; k < 3; k++) {
      const p = new THREE.Vector3().fromBufferAttribute(a.position, i + k);
      const key = p.toArray().map(value => value.toFixed(5)).join(',');
      let index = welded.get(key);
      if (index === undefined) {
        index = vertices.length; welded.set(key, index);
        const w = new Map();
        for (let c = 0; c < 4; c++) {
          const joint = a.skinIndex.getComponent(i + k, c), weight = a.skinWeight.getComponent(i + k, c);
          if (weight > 0) w.set(joint, (w.get(joint) ?? 0) + weight);
        }
        vertices.push({ p, w });
      }
      ids.push(index); uv.push(new THREE.Vector2().fromBufferAttribute(a.uv, i + k));
    }
    faces.push({ ids, uv });
  }
  return { vertices, faces };
}

function curvedSurface(surface) {
  const { vertices, faces } = surface, edges = new Map(), neighbors = vertices.map(() => new Set());
  const edgeKey = (a, b) => a < b ? `${a}/${b}` : `${b}/${a}`;
  for (const { ids } of faces) for (let k = 0; k < 3; k++) {
    const a = ids[k], b = ids[(k + 1) % 3], opposite = ids[(k + 2) % 3], key = edgeKey(a, b);
    if (!edges.has(key)) edges.set(key, { a, b, opposite: [] });
    edges.get(key).opposite.push(opposite); neighbors[a].add(b); neighbors[b].add(a);
  }
  const boundaries = vertices.map(() => []);
  for (const edge of edges.values()) if (edge.opposite.length === 1) {
    boundaries[edge.a].push(edge.b); boundaries[edge.b].push(edge.a);
  }
  const next = vertices.map((vertex, index) => {
    const boundary = boundaries[index];
    if (boundary.length === 2) return blend([[vertex, .75], [vertices[boundary[0]], .125], [vertices[boundary[1]], .125]]);
    const adjacent = [...neighbors[index]], n = adjacent.length;
    const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
    return blend([[vertex, 1 - n * beta], ...adjacent.map(id => [vertices[id], beta])]);
  });
  for (const edge of edges.values()) {
    edge.index = next.length;
    next.push(edge.opposite.length === 2
      ? blend([[vertices[edge.a], .375], [vertices[edge.b], .375], [vertices[edge.opposite[0]], .125], [vertices[edge.opposite[1]], .125]])
      : blend([[vertices[edge.a], .5], [vertices[edge.b], .5]]));
  }
  const refined = [];
  for (const { ids: [a, b, c], uv: [u, v, w] } of faces) {
    const ab = edges.get(edgeKey(a, b)).index, bc = edges.get(edgeKey(b, c)).index, ca = edges.get(edgeKey(c, a)).index;
    const uv = u.clone().lerp(v, .5), vw = v.clone().lerp(w, .5), wu = w.clone().lerp(u, .5);
    refined.push({ ids: [a, ab, ca], uv: [u, uv, wu] }, { ids: [b, bc, ab], uv: [v, vw, uv] }, { ids: [c, ca, bc], uv: [w, wu, vw] }, { ids: [ab, bc, ca], uv: [uv, vw, wu] });
  }
  return { vertices: next, faces: refined };
}

function normals(surface) {
  const result = surface.vertices.map(() => new THREE.Vector3());
  for (const { ids: [a, b, c] } of surface.faces) {
    const n = new THREE.Vector3().subVectors(surface.vertices[b].p, surface.vertices[a].p).cross(new THREE.Vector3().subVectors(surface.vertices[c].p, surface.vertices[a].p));
    result[a].add(n); result[b].add(n); result[c].add(n);
  }
  return result.map(n => n.normalize());
}

/** Source-contour curvature, modeled coiled-whorl relief, and a rounded muscular foot skirt. */
export function refineSnail(mesh) {
  const original = mesh.geometry;
  let shell = component(original, 0, 579), body = component(original, 579, original.attributes.position.count);
  shell = curvedSurface(curvedSurface(curvedSurface(shell)));
  body = curvedSurface(curvedSurface(body));
  const toSourceWorld = mesh.matrixWorld.clone();
  // Remove the converter's metre scale for anatomy measurements in source centimetres.
  const worldUnit = .024;
  const toMesh = toSourceWorld.clone().invert();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(toSourceWorld);
  const shellNormals = normals(shell), bodyNormals = normals(body);
  for (let i = 0; i < shell.vertices.length; i++) {
    const vertex = shell.vertices[i], p = vertex.p.clone().applyMatrix4(toSourceWorld).divideScalar(worldUnit);
    const n = shellNormals[i].clone().applyMatrix3(normalMatrix).normalize();
    const cy = 7.15, cz = -.8;
    const dy = (p.y - cy) / 5.35, dz = (p.z - cz) / 6.15;
    const radius = Math.hypot(dy, dz);
    let theta = Math.atan2(dy, dz); if (theta < 0) theta += Math.PI * 2;
    let ridge = 0, groove = 0;
    // Three continuous coiled whorls grow toward the outer shell, matching its wound anatomy.
    for (let turn = 0; turn < 3; turn++) {
      const whorl = Math.exp((theta + turn * Math.PI * 2 - Math.PI * 5.45) * .18);
      const width = .018 + whorl * .034;
      const distance = radius - whorl;
      ridge = Math.max(ridge, Math.exp(-((distance / width) ** 2)));
      groove = Math.max(groove, Math.exp(-(((distance + width * 1.25) / (width * .62)) ** 2)));
    }
    const side = Math.pow(Math.abs(n.x), 1.6);
    const edge = 1 - smooth(.83, 1.07, radius);
    const relief = (.085 * ridge - .042 * groove) * side * edge;
    const growthLines = .007 * Math.sin(theta * 52 + radius * 23) * Math.min(1, radius * 3) * side;
    p.addScaledVector(n, relief + growthLines);
    vertex.p.copy(p.multiplyScalar(worldUnit).applyMatrix4(toMesh));
  }
  for (let i = 0; i < body.vertices.length; i++) {
    const vertex = body.vertices[i], p = vertex.p.clone().applyMatrix4(toSourceWorld).divideScalar(worldUnit);
    const n = bodyNormals[i].clone().applyMatrix3(normalMatrix).normalize();
    const lowFoot = (1 - smooth(1.0, 2.0, p.y)) * smooth(-.2, .35, p.y);
    const flank = Math.pow(Math.abs(n.x), 1.2);
    // A raised, rounded foot margin overhangs the contact sole, with shallow contraction folds.
    const rim = .28 * Math.exp(-(((p.y - .62) / .43) ** 2)) * flank;
    const folds = .052 * Math.sin(p.z * 3.4 + p.x * .3) * lowFoot * flank;
    p.addScaledVector(n, rim + folds);
    // Keep the sole level; the head has a soft dorsal arch above the long muscular foot.
    if (p.y < .03) p.y = THREE.MathUtils.lerp(p.y, -.04, .45);
    if (p.z > 6 && n.y > .35 && p.y < 3.1) p.y += .18 * Math.exp(-((p.x / 2.2) ** 2)) * Math.sin(Math.min(1, (p.z - 6) / 7.5) * Math.PI);
    vertex.p.copy(p.multiplyScalar(worldUnit).applyMatrix4(toMesh));
  }
  const out = { position: [], normal: [], uv: [], skinIndex: [], skinWeight: [] };
  for (const surface of [shell, body]) {
    const normal = normals(surface);
    for (const face of surface.faces) for (let k = 0; k < 3; k++) {
      const id = face.ids[k], vertex = surface.vertices[id];
      const weights = [...vertex.w].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = weights.reduce((sum, [, weight]) => sum + weight, 0);
      while (weights.length < 4) weights.push([0, 0]);
      out.position.push(...vertex.p.toArray()); out.normal.push(...normal[id].toArray()); out.uv.push(...face.uv[k].toArray());
      out.skinIndex.push(...weights.map(([joint]) => joint)); out.skinWeight.push(...weights.map(([, weight]) => weight / sum));
    }
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, values] of Object.entries(out)) geometry.setAttribute(name, name === 'skinIndex' ? new THREE.Uint16BufferAttribute(values, 4) : new THREE.Float32BufferAttribute(values, name === 'uv' ? 2 : name.startsWith('skin') ? 4 : 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); mesh.geometry = geometry;
  return { shellFaces: shell.faces.length, softFootFaces: body.faces.length, sculpture: 'Continuous curved source shell with three modeled coiled-whorl ridges and incised grooves; rounded muscular foot margin and shallow contraction folds.', sourceUVsPreserved: true };
}
