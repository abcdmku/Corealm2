import * as THREE from 'three';

/** Intersect the original torso in source-local YZ, retaining its atlas coordinates. */
function flankSurface(body, side) {
  const position = body.geometry.getAttribute('position');
  const uv = body.geometry.getAttribute('uv');
  const index = body.geometry.getIndex();
  const triangles = [];
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const ids = [0, 1, 2].map(c => index ? index.getX(i + c) : i + c);
    const p = ids.map(id => new THREE.Vector3().fromBufferAttribute(position, id));
    if (Math.max(...p.map(v => v.x * side)) < 0.5) continue;
    const minY = Math.min(...p.map(v => v.y)), maxY = Math.max(...p.map(v => v.y));
    const minZ = Math.min(...p.map(v => v.z)), maxZ = Math.max(...p.map(v => v.z));
    if (maxY < -10 || minY > 4.5 || maxZ < 8 || minZ > 16) continue;
    const determinant = (p[1].z - p[2].z) * (p[0].y - p[2].y) + (p[2].y - p[1].y) * (p[0].z - p[2].z);
    if (Math.abs(determinant) < 1e-9) continue;
    triangles.push({ p, uv: ids.map(id => new THREE.Vector2().fromBufferAttribute(uv, id)), minY, maxY, minZ, maxZ, determinant });
  }
  if (!triangles.length) throw new Error('Goose wing fitting found no source flank triangles');
  return (y, z) => {
    let result;
    for (const triangle of triangles) {
      if (y < triangle.minY - 1e-5 || y > triangle.maxY + 1e-5 || z < triangle.minZ - 1e-5 || z > triangle.maxZ + 1e-5) continue;
      const { p, determinant } = triangle;
      const a = ((p[1].z - p[2].z) * (y - p[2].y) + (p[2].y - p[1].y) * (z - p[2].z)) / determinant;
      const b = ((p[2].z - p[0].z) * (y - p[2].y) + (p[0].y - p[2].y) * (z - p[2].z)) / determinant;
      const c = 1 - a - b;
      if (Math.min(a, b, c) < -1e-5) continue;
      const x = p[0].x * a + p[1].x * b + p[2].x * c;
      if (x * side < 0.5 || result && x * side <= result.x * side) continue;
      result = {
        x,
        uv: triangle.uv[0].clone().multiplyScalar(a).addScaledVector(triangle.uv[1], b).addScaledVector(triangle.uv[2], c),
      };
    }
    if (!result) throw new Error(`Goose folded wing leaves source flank at y=${y.toFixed(3)}, z=${z.toFixed(3)}`);
    return result;
  };
}

/** Thin overlapping vanes follow the source torso and taper inward toward its tail. */
export function gooseWings(object, body, addJoint) {
  const report = [];
  object.updateMatrixWorld(true);
  for (const side of [-1, 1]) {
    const label = side < 0 ? 'Left' : 'Right';
    const shoulder = addJoint(object, body, `Goose_Wing${label}`, 'Bone005', new THREE.Vector3(side * 2.5, 3, 14));
    const wrist = addJoint(object, body, `Goose_Wrist${label}`, shoulder.name, new THREE.Vector3(side * 3.5, -2, 12));
    const surface = flankSurface(body, side);
    const vertices = [], uvs = [], indices = [], skinIndices = [], skinWeights = [];
    let maxClearance = 0;
    const feather = ({ rootY, rootZ, tipY, tipZ, width, layer, wristAmount }) => {
      const start = vertices.length / 3;
      const sections = 18, across = 6, stride = across + 1;
      const direction = new THREE.Vector2(tipY - rootY, tipZ - rootZ).normalize();
      const cross = new THREE.Vector2(-direction.y, direction.x);
      for (let face = 0; face < 2; face++) {
        for (let r = 0; r <= sections; r++) {
          const t = r / sections;
          const outline = Math.max(0.012, Math.pow(Math.sin(Math.PI * t), 0.64) * (1 - 0.22 * t));
          const centerY = THREE.MathUtils.lerp(rootY, tipY, t);
          const centerZ = THREE.MathUtils.lerp(rootZ, tipZ, t) + Math.sin(Math.PI * t) * 0.13;
          for (let column = 0; column <= across; column++) {
            const u = column / across * 2 - 1;
            const vane = u * width * outline * (u < 0 ? 0.88 : 1);
            const y = centerY + cross.x * vane, z = centerZ + cross.y * vane;
            const hit = surface(y, z);
            // Clearance is measured in source units. Even the top layer is under 3 mm.
            const clearance = 0.026 + layer * 0.008 + (1 - u * u) * outline * 0.01 - face * 0.016;
            const point = new THREE.Vector3(hit.x + side * clearance, y, z);
            vertices.push(...body.localToWorld(point).toArray());
            uvs.push(hit.uv.x, hit.uv.y);
            const wristWeight = wristAmount * THREE.MathUtils.smoothstep(t, 0.24, 0.87);
            skinIndices.push(0, 1, 0, 0); skinWeights.push(1 - wristWeight, wristWeight, 0, 0);
            maxClearance = Math.max(maxClearance, clearance);
          }
        }
      }
      const faceSize = (sections + 1) * stride;
      const triangle = (a, b, c, reverse) => indices.push(...(reverse ? [a, c, b] : [a, b, c]));
      for (let face = 0; face < 2; face++) {
        const offset = start + face * faceSize;
        for (let r = 0; r < sections; r++) for (let column = 0; column < across; column++) {
          const a = offset + r * stride + column, b = a + 1, c = a + stride, d = c + 1;
          const reverse = (side > 0) !== (face === 1);
          triangle(a, b, c, reverse); triangle(b, d, c, reverse);
        }
      }
      // Close the thin rim; the vane has no round tube cross-section.
      const rim = [];
      for (let column = 0; column <= across; column++) rim.push(start + column);
      for (let r = 1; r <= sections; r++) rim.push(start + r * stride + across);
      for (let column = across - 1; column >= 0; column--) rim.push(start + sections * stride + column);
      for (let r = sections - 1; r > 0; r--) rim.push(start + r * stride);
      for (let i = 0; i < rim.length; i++) {
        const a = rim[i], b = rim[(i + 1) % rim.length];
        triangle(a, a + faceSize, b, side > 0); triangle(b, a + faceSize, b + faceSize, side > 0);
      }
    };
    // Long remiges overlap as one folded panel. Their tips descend along the rear flank.
    for (let f = 0; f < 7; f++) {
      feather({
        rootY: 2.7 - f * 0.42, rootZ: 13.4 - f * 0.26,
        tipY: -6.1 - f * 0.31, tipZ: 10.85 - f * 0.22,
        width: 0.76 - f * 0.015, layer: 6 - f, wristAmount: 0.72,
      });
    }
    // Broad shoulder coverts hide the feather roots and meet the existing breast plumage.
    for (let f = 0; f < 4; f++) {
      feather({
        rootY: 3.18 - f * 0.28, rootZ: 13.82 - f * 0.37,
        tipY: -2.8 - f * 0.30, tipZ: 12.02 - f * 0.34,
        width: 0.85, layer: 7 + (3 - f) * 0.25, wristAmount: 0.12,
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const material = body.material.clone();
    material.name = `animal_reedbank_goose_${label.toLowerCase()}_wing`;
    material.side = THREE.DoubleSide;
    const wing = new THREE.SkinnedMesh(geometry, material);
    wing.name = `goose_authored_${label.toLowerCase()}_wing`;
    wing.castShadow = wing.receiveShadow = true;
    object.add(wing); object.updateMatrixWorld(true);
    wing.bind(new THREE.Skeleton([shoulder, wrist]), new THREE.Matrix4());
    report.push({
      role: `${label.toLowerCase()} feathered wing`, joints: [shoulder.name, wrist.name],
      vertices: vertices.length / 3, authoredGeometry: true, feathers: 11,
      sourceSurfaceFit: 'Outer source torso triangles in YZ; original interpolated feather-atlas UVs',
      maxSourceUnitClearance: maxClearance, sourceUnitVaneThickness: 0.016,
    });
  }
  return report;
}
