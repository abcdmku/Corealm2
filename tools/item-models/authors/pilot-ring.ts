import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const TAU = Math.PI * 2;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Small deterministic tool marks. No canvas or image-derived geometry. */
function copperNormal(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  let seed = 83093;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = (seed >>> 24) / 255;
    const scratch = Math.pow(Math.max(0, Math.sin(x * .7 + Math.sin(y * .05) * 2)), 18);
    height[y * size + x] = (grain * 50 + scratch * 22) / 255 * .000014;
  }
  // One texture repeat spans 13.6 mm along the shank and 9.4 mm around its section.
  // Convert the 14 micrometre tool relief into physical tangent-space slopes.
  const sample = (x: number, y: number) => height[((y + size) % size) * size + (x + size) % size]!;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (sample(x + 1,y) - sample(x - 1,y)) / (2 * .0136 / size);
    const dy = (sample(x,y + 1) - sample(x,y - 1)) / (2 * .0094 / size);
    const normal = v(-dx,-dy,1).normalize();
    const i = (y * size + x) * 4;
    data[i] = Math.round((normal.x * .5 + .5) * 255);
    data[i + 1] = Math.round((normal.y * .5 + .5) * 255);
    data[i + 2] = Math.round((normal.z * .5 + .5) * 255);
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'Copper tool relief tangent normal';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function copperRoughness(): THREE.DataTexture {
  const size=128,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const variation=Math.sin(x*.18+Math.sin(y*.11)*2)*Math.sin(y*.16-x*.08);
    const value=Math.round(211+variation*35);const i=(y*size+x)*4;
    data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  texture.name='Uneven polish in copper hammer marks';texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}

function mesh(name: string, geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  geo.name = `${name} geometry`;
  const result = new THREE.Mesh(geo, material);
  result.name = name;
  return result;
}

/** A forged, rounded rectangular shank, with a smooth bore and hammered outside. */
function shank(): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const around = 240, cross = 24;
  for (let a = 0; a <= around; a++) {
    const angle = a / around * TAU;
    const shoulder = Math.pow(Math.max(0, Math.sin(angle)), 4);
    const leftShoulder=Math.exp(-Math.pow((angle-2.13)/.40,2));
    const rightShoulder=Math.exp(-Math.pow((angle-.85)/.32,2));
    const halfWidth = .00148 + shoulder * .00062 + leftShoulder*.00034 + rightShoulder*.00014;
    const thickness = .00164 + shoulder * .00038 + leftShoulder*.00022;
    for (let b = 0; b <= cross; b++) {
      const t = b / cross * TAU;
      const cx = Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), .40);
      const cz = Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), .40);
      const outerWeight = Math.pow((cx + 1) / 2, 2);
      // Overlapping shallow depressions give broad facets, not a corrugated torus.
      let hammer = .000008 * Math.sin(angle * 37 + cz * 8);
      // Individual broad hammer blows have staggered centres and different depths.
      // Keep the bore untouched; only the outside and its bevel receive these dents.
      for(let mark=0;mark<29;mark++) {
        const markAngle=(mark/29*TAU+.047*Math.sin(mark*4.73)+TAU)%TAU;
        const angularDistance=Math.atan2(Math.sin(angle-markAngle),Math.cos(angle-markAngle));
        const markWidth=.095+.035*(.5+.5*Math.sin(mark*1.71));
        const across=cz-.72*Math.sin(mark*2.37);
        hammer-=(.000075+.000055*(.5+.5*Math.sin(mark*3.91)))
          *Math.exp(-Math.pow(angularDistance/markWidth,4)-Math.pow(across/.66,4));
      }
      const radius = .010 + thickness * (cx + 1) / 2 + outerWeight * hammer;
      positions.push(radius * Math.cos(angle), radius * Math.sin(angle), cz * halfWidth);
      uvs.push(a / around * 5, b / cross);
    }
  }
  for (let a = 0; a < around; a++) for (let b = 0; b < cross; b++) {
    const p = a * (cross + 1) + b, q = p + cross + 1;
    indices.push(p, q, p + 1, p + 1, q, q + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Closed asymmetric fractured chip with a sloping crown, no brilliant-cut symmetry. */
function quartz(): THREE.BufferGeometry {
  const vertices = [
    [-.0029,.0120,-.0022], [.0019,.0119,-.0028], [.00365,.0126,-.0008],
    [.0031,.0124,.0021], [.0002,.0118,.00305], [-.0030,.0123,.0019],
    [-.00365,.0154,-.0019], [.00165,.0150,-.0030], [.00375,.0145,-.00045],
    [.00255,.01485,.0025], [-.00025,.0155,.00315], [-.00375,.0148,.0014],
    [-.0020,.0172,-.0018], [.0010,.01675,-.0019], [.0020,.01625,.0009],
    [-.0001,.01665,.00225], [-.0028,.0169,.00065],
  ];
  const faces = [
    [0,2,1],[0,3,2],[0,4,3],[0,5,4],
    [0,1,7],[0,7,6],[1,2,8],[1,8,7],[2,3,9],[2,9,8],
    [3,4,10],[3,10,9],[4,5,11],[4,11,10],[5,0,6],[5,6,11],
    [6,7,12],[7,13,12],[7,8,13],[8,14,13],[8,9,14],
    [9,15,14],[9,10,15],[10,16,15],[10,11,16],[11,6,12],[11,12,16],
    [12,13,14],[12,14,15],[12,15,16],
  ];
  const positions: number[] = [], uv: number[] = [];
  // Orient every facet away from the chip centroid.
  const center = v(0,.0148,0);
  for (const face of faces) {
    const p = face.map(i => new THREE.Vector3(...vertices[i] as [number,number,number])) as [THREE.Vector3,THREE.Vector3,THREE.Vector3];
    const normal = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]));
    if (normal.dot(p[0].clone().sub(center)) < 0) [p[1],p[2]] = [p[2],p[1]];
    // Fine conchoidal breaks split large planes without changing the chip silhouette.
    const mid = p[0].clone().multiplyScalar(.29).addScaledVector(p[1],.34).addScaledVector(p[2],.37);
    const facetNormal = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).normalize();
    mid.addScaledVector(facetNormal,.000115 + .000075 * Math.sin(positions.length * .37));
    for (let edge = 0; edge < 3; edge++) for (const point of [p[edge]!,p[(edge+1)%3]!,mid]) {
      positions.push(...point.toArray()); uv.push(point.x / .008 + .5, point.y / .008);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
  geo.computeVertexNormals();
  return geo;
}

/** Flattened, rounded copper claws bent over the rough chip. */
function claw(angle: number): THREE.BufferGeometry {
  const outward = v(Math.cos(angle),0,Math.sin(angle));
  const tangent = v(-Math.sin(angle),0,Math.cos(angle));
  const nodes = [
    outward.clone().multiplyScalar(.0028).add(v(0,.01155,0)),
    outward.clone().multiplyScalar(.0038).add(v(0,.0125,0)),
    outward.clone().multiplyScalar(.0040).add(v(0,.0140,0)),
    outward.clone().multiplyScalar(.00355).add(v(0,.0151,0)),
    outward.clone().multiplyScalar(.00300).add(v(0,.01545,0)),
  ];
  const curve = new THREE.CatmullRomCurve3(nodes);
  const pos: number[] = [], uv: number[] = [], index: number[] = [];
  const steps = 24, sides = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = curve.getPoint(t), along = curve.getTangent(t);
    const radial = tangent.clone().cross(along).normalize();
    const tip = t > .85 ? Math.sqrt(Math.max(.035, 1 - Math.pow((t-.85)/.15,2))) : 1;
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * TAU;
      const width = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)),.55) * .00069 * tip;
      const depth = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)),.55) * .00036 * tip;
      const point = p.clone().addScaledVector(tangent,width).addScaledVector(radial,depth);
      pos.push(...point.toArray()); uv.push(t * 2,j/sides);
    }
  }
  for (let i=0;i<steps;i++) for(let j=0;j<sides;j++) {
    const p=i*(sides+1)+j,q=p+sides+1;
    index.push(p,q,p+1,p+1,q,q+1);
  }
  for(let j=1;j<sides-1;j++) { index.push(0,j,j+1); const o=steps*(sides+1); index.push(o,o+j+1,o+j); }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geo.setIndex(index);geo.computeVertexNormals();return geo;
}

export const author: ItemModelAuthor = {
  ids: ['grithe_ring'],
  build(itemId) {
    if(itemId !== 'grithe_ring') throw new Error(`Unsupported ring ${itemId}`);
    const root = new THREE.Group(); root.name = 'Grithe copper and raw quartz ring';
    root.userData.itemModel = {itemId,author:'pilot-ring',reference:'art/item-icons/generated/grithe_ring.png',
      description:'Forged reddish copper ring with 20 mm open finger bore, softly bevelled hammered shank, four bent copper claws and one asymmetric fractured clear quartz chip. Unseen rear setting inferred.'};
    const copper = new THREE.MeshStandardMaterial({name:'Warm polished hammered copper',color:0xc88b6c,metalness:1,roughness:.36,roughnessMap:copperRoughness(),normalMap:copperNormal(),normalScale:new THREE.Vector2(1,1)});
    const crystal = new THREE.MeshPhysicalMaterial({name:'Clear milky fractured quartz',color:0xfffcf8,metalness:0,roughness:.10,transmission:.83,thickness:.004,ior:1.544,attenuationColor:new THREE.Color(0xfffbf5),attenuationDistance:.12,clearcoat:.22,clearcoatRoughness:.10});
    const fracture = new THREE.MeshStandardMaterial({name:'Quartz white mineral fracture edges',color:0xe8e3db,roughness:.43});
    root.add(mesh('Open forged copper shank',shank(),copper));
    const rimCurve = new THREE.CatmullRomCurve3(Array.from({length:16},(_,i)=>{
      const a=i/16*TAU;return v(Math.cos(a)*.0035,.0121 + .00010*Math.sin(a*3),Math.sin(a)*.0028);
    }),true);
    root.add(mesh('Low copper quartz seat',new THREE.TubeGeometry(rimCurve,64,.00043,8,true),copper));
    root.add(mesh('Single rough quartz chip',quartz(),crystal));
    for(let i=0;i<4;i++) root.add(mesh(`Bent copper claw ${i+1}`,claw(Math.PI/4+i*Math.PI/2),copper));
    // Hairline inclusions sit within the volume and remain meaningful from side views.
    const cracks = [
      [[-.0029,.0151,.0015],[-.0018,.0155,.0019],[-.0012,.0164,.0015],[-.0020,.0171,.0006]],
      [[-.0023,.0132,.0016],[-.0009,.0141,.0024],[.0002,.0145,.0025],[.0011,.0154,.0019],[.0018,.0160,.0008]],
      [[-.0009,.0141,.0024],[-.0015,.0148,.0012],[-.0007,.0156,.0002]],
      [[.0030,.0131,.0001],[.0019,.0140,-.0003],[.0020,.0151,-.0011],[.0011,.0162,-.0015]],
      [[-.0025,.0140,-.0016],[-.0013,.0148,-.0021],[.0000,.0151,-.0020],[.0009,.0164,-.0016]],
      [[-.0013,.0148,-.0021],[-.0011,.0156,-.0010],[-.0018,.0168,-.0012]],
    ];
    cracks.forEach((points,i)=>root.add(mesh(`Quartz internal feather ${i+1}`,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>{
      const point = new THREE.Vector3(...p as [number,number,number]);
      if(point.y > .016) point.y = .016 + (point.y - .016) * .65;
      return point;
    })),14,.000020,4,false),fracture)));
    // Thin closed mineral-filled fracture flakes. Opaque flecks are visible in the
    // transmission pass, unlike alpha surfaces behind a transmissive outer shell.
    for(let i=0;i<18;i++) {
      const a=i*2.39996;
      const center=v(Math.cos(a)*(.0010+.0006*Math.sin(i*1.7)),.0133+(i%5)*.00055,Math.sin(a)*.0017);
      const flake=new THREE.TetrahedronGeometry(1,0);
      flake.scale(.00026+.00013*(i%3),.00032+.00007*(i%4),.000012);
      flake.rotateX(.4*Math.sin(i));flake.rotateY(a*.43);flake.rotateZ(a);
      flake.translate(center.x,center.y,center.z);
      root.add(mesh(`Quartz mineral feather flake ${i+1}`,flake,fracture));
    }
    return root;
  },
};
