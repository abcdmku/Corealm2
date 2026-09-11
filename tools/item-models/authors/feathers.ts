import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type Kind = 'hen_feather' | 'goose_down' | 'heron_quill' | 'bustard_plume' | 'turkey_tailfeather';
const ids: readonly Kind[] = ['hen_feather', 'goose_down', 'heron_quill', 'bustard_plume', 'turkey_tailfeather'];
const descriptions: Record<Kind, string> = {
  hen_feather: 'Barred brown, still stiff at the quill. Fletchers buy them by the double handful.',
  goose_down: 'Soft breast feathers. Pack them between hide panels to finish a robe with less leather.',
  heron_quill: 'A long hollow flight quill. Cut around an amber bead, it steadies a casting charm.',
  bustard_plume: "A broad feather from a heavy moorland bird. Layered plumes replace a robe's inner pelt.",
  turkey_tailfeather: 'A barred tail feather. Millfield hunters bind a fan of them around a small warding charm.',
};
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function noise(a: number): number { return (Math.sin(a * 173.31 + 19.1) * 43758.5453) % 1; }

// Each barb is a closed elliptical swept solid, not a plane or silhouette shell.
class Fibres {
  p: number[] = []; uv: number[] = []; ix: number[] = [];
  strand(points: THREE.Vector3[], width: number, depth: number, t: number, side: number, hollow = false): void {
    const base = this.p.length / 3, n = points.length;
    for (let j = 0; j < n; j++) {
      const tangent = points[Math.min(j + 1, n - 1)]!.clone().sub(points[Math.max(j - 1, 0)]!).normalize();
      const across = new THREE.Vector3().crossVectors(tangent, v(0, 0, 1)).normalize();
      const normal = new THREE.Vector3().crossVectors(across, tangent).normalize();
      const f = Math.max(.025, 1 - j / (n - 1) * .96);
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3;
        const q = points[j]!.clone().addScaledVector(across, Math.cos(a) * width * f).addScaledVector(normal, Math.sin(a) * depth * f);
        this.p.push(q.x, q.y, q.z); this.uv.push(.5 + side * j / (n - 1) * .5, t + j / (n - 1) * .065);
        if (j < n - 1) { const b = base + j * 6 + k, c = base + j * 6 + (k + 1) % 6; this.ix.push(b, c, b + 6, c, c + 6, b + 6); }
      }
    }
    if (!hollow) for (let k = 1; k < 5; k++) this.ix.push(base, base + k + 1, base + k);
    const last = base + (n - 1) * 6;
    for (let k = 1; k < 5; k++) this.ix.push(last, last + k, last + k + 1);
  }
  mesh(name: string, material: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (let i = 0; i < this.ix.length; i += 3) { const a = this.ix[i]!; this.ix[i] = this.ix[i + 1]!; this.ix[i + 1] = a; }
    g.setIndex(this.ix); g.computeVertexNormals();
    const m = new THREE.Mesh(g, material); m.name = name; m.castShadow = true; m.receiveShadow = true; return m;
  }
}
function vaneMaterial(kind: Kind): THREE.MeshStandardMaterial {
  const size = 512, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const t = y / (size - 1), u = x / (size - 1), edge = Math.abs(u - .5) * 2;
    let c: number[];
    if (kind === 'heron_quill') c = [207 - t * 153, 207 - t * 145, 202 - t * 128];
    else if (kind === 'goose_down') c = [242, 238, 229];
    else {
      const wave = Math.sin((t - edge * .044 + .008 * Math.sin(u * 33)) * Math.PI * (kind === 'hen_feather' ? 13 : 11));
      const dark = wave > (kind === 'turkey_tailfeather' ? -.1 : .02);
      c = dark ? [77, 46, 28] : [181, 132, 82];
      if (kind === 'bustard_plume') {
        c = dark ? [83, 48, 25] : [207, 166, 113];
        if (!dark && Math.sin(x * .33 + Math.sin(y * .19) * 3) * Math.cos(y * .29) > .64) c = [110, 70, 39];
      }
      if (kind === 'turkey_tailfeather') {
        c = dark ? [47, 30, 23] : [157, 93, 46];
        if (t > .935) c = [230, 204, 161];
        else if (t > .845) c = [46, 29, 23];
      }
      if (t < .23) { const f = Math.max(0, (t - .12) / .11); c = c.map((a, i) => [206, 185, 157][i]! * (1 - f) + a * f); }
    }
    const grain = Math.sin((t - edge * .065) * 3600) * 5 + noise(x + y * size) * 4;
    const p = (y * size + x) * 4;
    for (let k = 0; k < 3; k++) data[p + k] = Math.max(0, Math.min(255, c[k]! + grain));
    data[p + 3] = 255;
  }
  const map = new THREE.DataTexture(data, size, size); map.name = `${kind} pigment and barb striations`; map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true;
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true;
  const m = new THREE.MeshStandardMaterial({ map, roughness: .73, metalness: 0 }); m.name = `${kind} keratin vane`; return m;
}
function addFeather(root: THREE.Group, kind: Kind, length: number, width: number, seed = 1, fluffy = false): void {
  const barbs = new Fibres(), down = new Fibres(), shaft = new Fibres();
  const count = fluffy ? 24 : 180;
  const center = (t: number) => v(length * .085 * t * t, length * t, length * (.10 * t * t - .04 * t));
  for (let i = 0; i < count; i++) {
    const t = .13 + .855 * i / (count - 1), f = (t - .13) / .855;
    const profile = Math.pow(Math.sin(Math.PI * f), kind === 'turkey_tailfeather' ? .46 : kind === 'heron_quill' ? .8 : .56);
    for (const side of [-1, 1]) {
      const asymmetry = side < 0 ? 1 : kind === 'heron_quill' ? .76 : .91;
      const gap = !fluffy && i % 43 === 19 ? .80 : 1;
      const reach = width * profile * asymmetry * gap * (1 + noise(i * 3 + seed) * .025);
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= 6; j++) {
        const a = j / 6, q = center(t);
        q.x += side * reach * a; q.y += length * .077 * Math.sin(a * 1.6) * (1 - f * .75);
        q.z += width * .13 * Math.sin(a * Math.PI) + width * (fluffy ? .65 : .09) * a * a * Math.sin(i * 1.71 + side + seed);
        pts.push(q);
      }
      (fluffy ? down : barbs).strand(pts, fluffy ? length * .0038 : length * .003, fluffy ? length * .0017 : length * .00065, t, side);
      if (fluffy || t < .28) for (let b = 1; b <= (fluffy ? 2 : 3); b++) {
        const start = pts[b + 1]!, end = pts[b + 2]!;
        const branch = [start.clone(), start.clone().lerp(end, .8).add(v(side * reach * .14, length * .023, length * .012 * Math.sin(i + b))), end.clone().add(v(side * reach * .27, length * .043, length * .018 * Math.sin(i + b)))];
        down.strand(branch, length * .0009, length * .0007, t, side);
      }
    }
  }
  shaft.strand(Array.from({ length: 40 }, (_, i) => center(i / 39)), length * (fluffy ? .003 : .008), length * (fluffy ? .002 : .005), 0, 1, kind === 'heron_quill');
  const shaftMat = new THREE.MeshStandardMaterial({ color: fluffy ? 0xd7c9ad : 0xd5bb8f, roughness: .42 }); shaftMat.name = 'Ivory keratin rachis';
  const downMat = new THREE.MeshStandardMaterial({ color: kind === 'goose_down' ? 0xf1eee8 : kind === 'heron_quill' ? 0xd8d5ce : 0xcbbb9f, roughness: .91 }); downMat.name = 'Soft branching basal filaments';
  if (!fluffy) root.add(barbs.mesh('Overlapping solid curved barbs with patterned dorsal and ventral surfaces', vaneMaterial(kind)));
  root.add(down.mesh('Unhooked down barbs and branching barbules', downMat), shaft.mesh('Tapered curved quill and rachis', shaftMat));
  if (kind === 'heron_quill') {
    const inner = new THREE.MeshStandardMaterial({ color: 0x796d51, roughness: .82 }); inner.name = 'Quill hollow interior';
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(length * .006, length * .006, length * .06, 12, 1, true), inner);
    tube.name = 'Recessed hollow calamus inner wall'; tube.position.y = length * .03; tube.scale.z = .58; tube.material.side = THREE.BackSide; root.add(tube);
    const lip = new THREE.Mesh(new THREE.RingGeometry(length * .006, length * .008, 12), shaftMat);
    lip.name = 'Open calamus keratin wall thickness'; lip.rotation.x = Math.PI / 2; lip.scale.y = .625; root.add(lip);
  }
}
export const author: ItemModelAuthor = {
  ids,
  build(itemId: string): THREE.Group {
    if (!ids.includes(itemId as Kind)) throw new Error(`Unknown feather ${itemId}`);
    const id = itemId as Kind, root = new THREE.Group(); root.name = id;
    if (id === 'goose_down') {
      // A loose handful with differently curled breast feathers front and back.
      for (let i = 0; i < 8; i++) {
        const f = new THREE.Group(); f.name = `Goose breast feather ${i + 1}`;
        addFeather(f, id, .105 + .022 * Math.sin(i * 2.1), .033, i + 7, true);
        f.rotation.set(.45 * Math.sin(i * 2), .48 * Math.cos(i * 2), i * Math.PI * .76);
        f.position.set(.018 * Math.cos(i * 2.3), .035 + .016 * Math.sin(i * 2.3), .013 * Math.sin(i * 1.9)); root.add(f);
      }
    } else addFeather(root, id, id === 'heron_quill' ? .36 : id === 'bustard_plume' ? .29 : id === 'turkey_tailfeather' ? .31 : .21, id === 'heron_quill' ? .039 : id === 'turkey_tailfeather' ? .059 : id === 'bustard_plume' ? .056 : .04);
    const materials = new Map<string, THREE.Material>();
    root.traverse(object => { if (object instanceof THREE.Mesh && !Array.isArray(object.material)) { const existing = materials.get(object.material.name); if (existing) { object.material.dispose(); object.material = existing; } else materials.set(object.material.name, object.material); } });
    root.userData.itemModel = { itemId: id, author: 'feathers', reference: `art/item-icons/generated/${id}.png`, description: descriptions[id], grip: [0, 0, 0] };
    return root;
  },
};
