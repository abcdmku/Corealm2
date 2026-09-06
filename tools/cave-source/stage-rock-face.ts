import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';

const root = 'art/rebuild/candidates/finish-cave-source';
const sourceDirectory = path.join(root, 'source');
await mkdir(sourceDirectory, { recursive: true });
const metadataUrl = 'https://api.polyhaven.com/files/rock_face_01';
const metadata = await (await fetch(metadataUrl, { signal: AbortSignal.timeout(30000) })).json() as any;
const selected = metadata.gltf['1k'].gltf;
const downloads = [{ relative: 'rock_face_01.gltf', ...selected },
  ...Object.entries(selected.include).map(([relative, item]) => ({ relative, ...(item as object) }))] as
  Array<{ relative: string; url: string; md5: string; size: number }>;
const provenance: object[] = [];
await Promise.all(downloads.map(async item => {
  const file = path.join(sourceDirectory, item.relative);
  await mkdir(path.dirname(file), { recursive: true });
  let bytes: Buffer;
  try { bytes = await readFile(file); } catch { bytes = Buffer.from(await (await fetch(item.url, { signal: AbortSignal.timeout(30000) })).arrayBuffer()); }
  if (bytes.length !== item.size || createHash('md5').update(bytes).digest('hex') !== item.md5) throw new Error(`Source checksum failed: ${item.relative}`);
  await writeFile(file, bytes);
  provenance.push({ file: `source/${item.relative}`, url: item.url, bytes: bytes.length, md5: item.md5,
    sha256: createHash('sha256').update(bytes).digest('hex') });
}));
const io = new NodeIO();
const document = await io.read(path.join(sourceDirectory, 'rock_face_01.gltf'));
const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
const source = primitive.getAttribute('POSITION')!, normal = primitive.getAttribute('NORMAL')!;
const averageNormal = new THREE.Vector3();
const indices = primitive.getIndices()!;
for (let i = 0; i < indices.getCount(); i += 3) {
  const points = [0, 1, 2].map(corner => new THREE.Vector3().fromArray(source.getElement(indices.getScalar(i + corner), [])));
  averageNormal.add(points[1]!.sub(points[0]!).cross(points[2]!.sub(points[0]!)));
}
averageNormal.normalize();
const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), averageNormal).normalize();
const up = new THREE.Vector3().crossVectors(averageNormal, right).normalize();
const rotation = new THREE.Matrix4().makeBasis(right, up, averageNormal).transpose();
const normalRotation = new THREE.Matrix3().setFromMatrix4(rotation);
const points = Array.from({ length: source.getCount() }, (_, i) => new THREE.Vector3().fromArray(source.getElement(i, [])).applyMatrix4(rotation));
const bounds = new THREE.Box3().setFromPoints(points), offset = new THREE.Vector3((bounds.min.x + bounds.max.x) / 2, bounds.min.y, bounds.min.z);
source.setArray(new Float32Array(points.flatMap(point => point.sub(offset).toArray())));
normal.setArray(new Float32Array(Array.from({ length: normal.getCount() }, (_, i) =>
  new THREE.Vector3().fromArray(normal.getElement(i, [])).applyMatrix3(normalRotation).normalize().toArray()).flat()));
document.getRoot().listMaterials()[0]!.setName('Poly Haven Rock Face 01').setDoubleSided(true);
const outputFile = 'models/cave/rock-face-01.glb';
await mkdir(path.join(root, 'models/cave'), { recursive: true });
const output = await io.writeBinary(document);
await writeFile(path.join(root, outputFile), output);
const size = bounds.getSize(new THREE.Vector3());
const pack = { id: 'polyhaven-rock-face-01', name: 'Rock Face 01', author: 'Dario Barresi / Poly Haven',
  source: 'https://polyhaven.com/a/rock_face_01', license: 'CC0-1.0' };
const entry = { id: 'cave_rock_face_01', file: outputFile, pack: pack.id, category: 'rock', is: 'cave-facing',
  tags: ['cave', 'rock', 'scan', 'strata'], bytes: output.length, sha256: createHash('sha256').update(output).digest('hex'),
  size: { x: size.x, y: size.y, z: size.z }, base: { x: -size.x / 2, y: 0, z: 0 },
  triangles: primitive.getIndices()!.getCount() / 3, animations: [], materials: ['Poly Haven Rock Face 01'] };
await writeFile(path.join(root, 'catalog.json'), JSON.stringify({ pack, assets: [entry] }, null, 2));
await writeFile(path.join(root, 'provenance.json'), JSON.stringify({ ...pack, licenseUrl: 'https://polyhaven.com/license', metadataUrl,
  changes: 'Rigid rotation aligns the area-weighted face normal to +Z while preserving the projected original up direction; translation centres X, puts floor Y=0 and back Z=0. Original triangles, UVs and 1K albedo/normal/ARM maps retained. No decimation or procedural replacement.',
  rotationMatrix: rotation.toArray(), sourceFiles: provenance.sort((a: any, b: any) => a.file.localeCompare(b.file)), derived: entry }, null, 2));
console.log(JSON.stringify(entry));
