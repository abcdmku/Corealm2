import assert from 'node:assert/strict';
import { Vector3 } from 'three';

/** Unwrap connected body surfaces separately and smooth coincident source corners.
 * Source is triangle soup: corner UV seams can be corrected without splitting the rig. */
export function mapWaspBody(doc, bodies) {
  const position = bodies[0].getAttribute('POSITION');
  const count = position.getCount(), points = Array.from({ length: count }, (_, i) => new Vector3().fromArray(position.getArray(), i * 3));
  const parents = Array.from({ length: count }, (_, i) => i);
  const find = i => parents[i] === i ? i : (parents[i] = find(parents[i]));
  const union = (a, b) => { parents[find(a)] = find(b); };
  const corners = new Map(), triangles = [];
  const skin = bodies[0].getAttribute('JOINTS_0'), weight = bodies[0].getAttribute('WEIGHTS_0');
  const key = i => [...points[i].toArray().map(n => n.toFixed(5)), ...skin.getElement(i, []), ...weight.getElement(i, []).map(n => n.toFixed(4))].join(',');
  for (const body of bodies) {
    const indices = body.getIndices().getArray();
    assert.equal(new Set(indices).size, indices.length, 'Expected independent triangle corners');
    for (let t = 0; t < indices.length; t += 3) {
      const ids = Array.from(indices.slice(t, t + 3));
      triangles.push(ids); union(ids[0], ids[1]); union(ids[1], ids[2]);
      for (const i of ids) { const k = key(i), list = corners.get(k) ?? []; if (list.length) union(i, list[0]); list.push(i); corners.set(k, list); }
    }
  }
  const normal = new Float32Array(bodies[0].getAttribute('NORMAL').getArray());
  const faces = new Map();
  for (const ids of triangles) {
    const n = points[ids[1]].clone().sub(points[ids[0]]).cross(points[ids[2]].clone().sub(points[ids[0]]));
    for (const i of ids) faces.set(i, n);
  }
  // Area-weighted smooth normals across former stripe boundaries. Keep very sharp folds.
  for (const ids of corners.values()) for (const i of ids) {
    const n = new Vector3(), own = faces.get(i).clone().normalize();
    for (const j of ids) if (own.dot(faces.get(j).clone().normalize()) > 0.25) n.add(faces.get(j));
    n.normalize().toArray(normal, i * 3);
  }
  const components = new Map();
  for (const ids of corners.values()) { const i = ids[0], root = find(i), part = components.get(root) ?? []; part.push(...ids); components.set(root, part); }
  const uv = new Float32Array(count * 2), colors = new Float32Array(count * 3).fill(1);
  const componentReport = [];
  for (const ids of components.values()) {
    const unique = [...new Set(ids.map(i => key(i)))].map(k => points[corners.get(k)[0]]);
    const center = unique.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(1 / unique.length);
    componentReport.push({ center: center.toArray(), vertices: ids.length, min: [0,1,2].map(a=>Math.min(...unique.map(p=>p.getComponent(a)))), max: [0,1,2].map(a=>Math.max(...unique.map(p=>p.getComponent(a)))) });
    const cov = Array.from({ length: 3 }, () => [0, 0, 0]);
    for (const p of unique) { const q = p.clone().sub(center).toArray(); for (let a=0;a<3;a++) for(let b=0;b<3;b++) cov[a][b] += q[a]*q[b]; }
    let axis = new Vector3(1, 0.17, 0.31).normalize();
    for(let n=0;n<32;n++) {const q=axis.toArray(); axis.set(...cov.map(r=>r.reduce((s,v,i)=>s+v*q[i],0))).normalize();}
    const side = new Vector3(0, 1, 0); if(Math.abs(side.dot(axis))>.9) side.set(0,0,1);
    side.addScaledVector(axis,-side.dot(axis)).normalize();
    const up = new Vector3().crossVectors(axis,side).normalize();
    const length = Math.max(...unique.map(p=>p.clone().sub(center).dot(axis))) - Math.min(...unique.map(p=>p.clone().sub(center).dot(axis)));
    const radius = Math.max(...unique.map(p=>{const q=p.clone().sub(center); return Math.hypot(q.dot(side),q.dot(up));}));
    for (const i of ids) {
      const q=points[i].clone().sub(center);
      uv[i*2]=Math.atan2(q.dot(side),q.dot(up))/(2*Math.PI)+.5;
      uv[i*2+1]=q.dot(axis)/Math.max(.01,2*Math.PI*radius);
      // Anatomical colour variation follows the surface, never the old stripe groups.
      const n = new Vector3().fromArray(normal,i*3);
      const underside = Math.max(0,-n.z), violet = Math.pow(Math.abs(n.y),2)*.32;
      colors.set([.66+violet*.45,.78-violet*.25,1].map(c=>c*(1-underside*.22)),i*3);
    }
    assert(Number.isFinite(length) && radius>0, 'Valid connected body surface');
  }
  // Keep interpolation local across the underside seam instead of spanning the texture.
  for (const ids of triangles) { const us=ids.map(i=>uv[i*2]); if(Math.max(...us)-Math.min(...us)>.5) for(const i of ids) if(uv[i*2]<.5) uv[i*2]+=1; }
  // Two repeats keep the scales short on the large abdomen as well as the limbs.
  for (const i of faces.keys()) { uv[i*2]*=2; uv[i*2+1]*=2; }
  for (const i of faces.keys()) {
    assert(Math.abs(Math.hypot(...normal.slice(i*3,i*3+3))-1)<1e-4, 'Body normals must remain unit length');
    assert(Number.isFinite(uv[i*2]) && Number.isFinite(uv[i*2+1]), 'Finite body UVs');
  }
  const accessor = (name,type,array) => doc.createAccessor(name).setType(type).setArray(array).setBuffer(position.getBuffer());
  const normals=accessor('wasp_smooth_body_normals','VEC3',normal), texcoords=accessor('wasp_component_uvs','VEC2',uv), colour=accessor('wasp_anatomical_colour','VEC3',colors);
  for (const body of bodies) body.setAttribute('NORMAL',normals).setAttribute('TEXCOORD_0',texcoords).setAttribute('COLOR_0',colour);
  return { components: components.size, componentReport, smoothedCorners: faces.size, mapping: 'component principal-axis cylindrical, corrected triangle seams' };
}
