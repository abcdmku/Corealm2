/** Stage T50/T70 harvestable nature. Root promotes only after production-lab acceptance. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Document, NodeIO, getBounds, type Primitive, type Material } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, weld } from '@gltf-transform/functions';
import { Vector3 } from 'three';
import { buildGroundOreAsset } from '../build-ground-ores.js';
import { RESOURCE_TREE_DESIGNS, retainLeafSpray, sculptOreNormal, sculptOrePoint, sculptTreeNormal, sculptTreePoint, type Point, type ResourceTreeId } from './sculpt.js';
import { brokenBoughs, cutLivingStump, scorchBark } from './wood.js';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const out = path.resolve('test-results/wilderness-resources');
const pack = { id: 'corealm-original-wilderness-resources', name: 'Corealm Wilderness living resources', author: 'Corealm project',
  source: 'tools/wilderness-resources/build.ts', license: 'LicenseRef-Corealm-Original' };
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const rounded = (n: number) => Number(n.toFixed(5));
type Vertex = { p: Point; n: Point; uv: [number, number]; c: Point; field: number };
const mix = (a: Vertex, b: Vertex, t: number): Vertex => ({
  p: a.p.map((v, i) => v + (b.p[i]! - v) * t) as Point,
  n: new Vector3(...a.n).lerp(new Vector3(...b.n), t).normalize().toArray() as Point,
  uv: a.uv.map((v, i) => v + (b.uv[i]! - v) * t) as [number, number],
  c: a.c.map((v, i) => v + (b.c[i]! - v) * t) as Point, field: 0,
});

function indices(primitive: Primitive): number[] {
  return primitive.getIndices() ? Array.from(primitive.getIndices()!.getArray()!) : Array.from({ length: primitive.getAttribute('POSITION')!.getCount() }, (_, i) => i);
}

/** Move all native attributes into float arrays before sculpting quantized source normals/colours. */
function sculptPrimitive(doc: Document, primitive: Primitive, id: ResourceTreeId): void {
  const positions = primitive.getAttribute('POSITION')!, normals = primitive.getAttribute('NORMAL')!, colours = primitive.getAttribute('COLOR_0')!;
  const p: number[] = [], n: number[] = [], c: number[] = [], bark = primitive.getMaterial()!.getName().startsWith('Bark');
  for (let i = 0; i < positions.getCount(); i++) {
    const point = positions.getElement(i, [0, 0, 0]) as Point;
    p.push(...sculptTreePoint(id, point)); n.push(...sculptTreeNormal(id, point, normals.getElement(i, [0, 0, 0]) as Point));
    const original = colours.getElement(i, []);
    const tint = id.startsWith('corealm_magic') ? bark ? [.55, .51, .66] : id.endsWith('starwood') ? [.69, .87, 1] : [.84, .68, 1] : bark ? [1, .94, .86] : [.88, .91, .72];
    c.push(...original.map((v, axis) => v * tint[axis]!));
  }
  const buffer = doc.getRoot().listBuffers()[0]!;
  for (const [semantic, values] of [['POSITION', p], ['NORMAL', n], ['COLOR_0', c]] as const)
    primitive.setAttribute(semantic, doc.createAccessor(`${id}-${semantic}`).setType('VEC3').setArray(Float32Array.from(values)).setBuffer(buffer));
}

function pruneSprays(doc: Document, primitive: Primitive, id: ResourceTreeId, sourceSprays: number[][]): { before: number; after: number; ranges: number[][] } {
  const input = indices(primitive), position = primitive.getAttribute('POSITION')!, selected: number[] = [], ranges: number[][] = [];
  const grouped = new Map<number, number[][]>();
  for (const row of sourceSprays) { const entries = grouped.get(row[2]!) ?? []; entries.push(row); grouped.set(row[2]!, entries); }
  let kept = 0;
  for (const [serial, rows] of grouped) {
    const vertices = rows.flatMap(([first, count]) => input.slice(first! * 3, (first! + count!) * 3));
    const centre = vertices.reduce((sum, index) => sum.add(new Vector3(...position.getElement(index, []))), new Vector3()).multiplyScalar(1 / vertices.length);
    if (!retainLeafSpray(id, centre.toArray() as Point, serial)) continue;
    kept++;
    for (const [first, count, spray] of rows) { ranges.push([selected.length / 3, count!, spray!]); selected.push(...input.slice(first! * 3, (first! + count!) * 3)); }
  }
  if (!sourceSprays.length || !selected.length) throw new Error(`${id}: native botanical spray provenance missing`);
  primitive.setIndices(doc.createAccessor(`${id}-intact-leaf-sprays`).setType('SCALAR').setArray(Uint32Array.from(selected)).setBuffer(doc.getRoot().listBuffers()[0]!));
  return { before: grouped.size, after: kept, ranges };
}

/** Split the wood surface into bark and shallow exposed-sap channels using its swept branch UVs. */
function carveSap(doc: Document, primitive: Primitive, id: ResourceTreeId): { bark: Primitive; sap: Primitive; faces: number } {
  const source = indices(primitive), bark: Vertex[] = [], sap: Vertex[] = [];
  const read = (i: number): Vertex => {
    const uv = primitive.getAttribute('TEXCOORD_0')!.getElement(i, [0, 0]) as [number, number];
    const p = primitive.getAttribute('POSITION')!.getElement(i, [0, 0, 0]) as Point;
    // Long grain channels taper at the root. Unequal runs interrupt before every branch tip.
    const field = Math.abs(Math.sin(uv[0] * 5.4 + Math.sin(uv[1] * .68) * .19)) - .083;
    return { p, n: primitive.getAttribute('NORMAL')!.getElement(i, [0, 0, 0]) as Point, uv,
      c: primitive.getAttribute('COLOR_0')!.getElement(i, [0, 0, 0]) as Point, field: p[1] < .7 ? 1 : field };
  };
  const clip = (input: Vertex[], inside: boolean): Vertex[] => {
    const output: Vertex[] = [];
    for (let e = 0; e < input.length; e++) {
      const a = input[e]!, b = input[(e + 1) % input.length]!, av = inside ? a.field <= 0 : a.field >= 0, bv = inside ? b.field <= 0 : b.field >= 0;
      if (av) output.push(a);
      if (av !== bv) output.push(mix(a, b, a.field / (a.field - b.field)));
    }
    return output;
  };
  for (let t = 0; t < source.length; t += 3) {
    const triangle = source.slice(t, t + 3).map(read);
    for (const [output, inside] of [[bark, false], [sap, true]] as const) {
      const polygon = clip(triangle, inside);
      for (let i = 1; i < polygon.length - 1; i++) output.push(polygon[0]!, polygon[i]!, polygon[i + 1]!);
    }
  }
  const make = (vertices: Vertex[], material: Material, isSap: boolean) => {
    const result = doc.createPrimitive().setMaterial(material), buffer = doc.getRoot().listBuffers()[0]!;
    const attrs: Record<string, number[]> = { POSITION: [], NORMAL: [], TEXCOORD_0: [], COLOR_0: [] };
    for (const v of vertices) {
      const recess = isSap ? Math.max(0, -v.field / .083) * .009 : 0;
      attrs.POSITION!.push(...v.p.map((p, i) => p - v.n[i]! * recess)); attrs.NORMAL!.push(...v.n); attrs.TEXCOORD_0!.push(...v.uv); attrs.COLOR_0!.push(...(isSap ? [1, 1, 1] : v.c));
    }
    for (const [name, values] of Object.entries(attrs)) result.setAttribute(name, doc.createAccessor(`${id}-${name}`).setType(name === 'TEXCOORD_0' ? 'VEC2' : 'VEC3').setArray(Float32Array.from(values)).setBuffer(buffer));
    return result;
  };
  const blue = id.endsWith('starwood');
  const material = doc.createMaterial(`Corealm exposed ${blue ? 'blue' : 'violet'} sap`)
    .setBaseColorFactor(blue ? [.06, .21, .30, 1] : [.19, .07, .27, 1])
    .setEmissiveFactor(blue ? [.025, .28, .47] : [.23, .04, .40]).setRoughnessFactor(.62).setMetallicFactor(0);
  return { bark: make(bark, primitive.getMaterial()!, false), sap: make(sap, material, true), faces: sap.length / 3 };
}

async function serialize(doc: Document, id: string, category: string, description: string, metadata: Record<string, unknown>) {
  await doc.transform(weld(), prune());
  const bytes = await io.writeBinary(doc), bounds = getBounds(doc.getRoot().listScenes()[0]!);
  const file = `models/corealm/${category === 'nature' ? 'nature' : 'geology'}/${id}.glb`;
  await mkdir(path.dirname(path.join(out, file)), { recursive: true }); await writeFile(path.join(out, file), bytes);
  let triangles = 0, trunkRadius = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    triangles += indices(primitive).length / 3;
    if (primitive.getMaterial()?.getName().startsWith('Bark')) {
      const p = primitive.getAttribute('POSITION')!;
      for (let i = 0; i < p.getCount(); i++) { const v = p.getElement(i, []); if (v[1]! >= .65 && v[1]! <= 1.1) trunkRadius = Math.max(trunkRadius, Math.hypot(v[0]!, v[2]!)); }
    }
  }
  return { id, file, pack: pack.id, category, is: description, tags: ['wilderness', 'corealm', 'original', category === 'nature' ? 'tree' : 'ore'],
    bytes: bytes.length, sha256: hash(bytes), size: { x: rounded(bounds.max[0]! - bounds.min[0]!), y: rounded(bounds.max[1]! - bounds.min[1]!), z: rounded(bounds.max[2]! - bounds.min[2]!) },
    base: { x: rounded(bounds.min[0]!), y: rounded(bounds.min[1]!), z: rounded(bounds.min[2]!) }, triangles, animations: [],
    materials: doc.getRoot().listMaterials().map(m => m.getName()), ...(trunkRadius ? { trunkRadius: rounded(trunkRadius) } : {}), ...metadata };
}

export async function buildWildernessResources() {
  const assets: Awaited<ReturnType<typeof serialize>>[] = [];
  for (const spec of RESOURCE_TREE_DESIGNS) {
    const sourcePath = `game/public/assets/models/corealm/nature/${spec.source}.glb`, sourceBytes = await readFile(sourcePath);
    const doc = await io.readBinary(sourceBytes); let sprays = { before: 0, after: 0, ranges: [] as number[][] }, sapFaces = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
      const sourceSprays = mesh.getExtras().corealmLeafSprays as number[][]; mesh.setName(spec.id);
      for (const primitive of [...mesh.listPrimitives()]) {
        if (primitive.getMaterial()!.getName().startsWith('Leaves')) sprays = pruneSprays(doc, primitive, spec.id, sourceSprays);
        sculptPrimitive(doc, primitive, spec.id);
        if (spec.tier === 50 && primitive.getMaterial()!.getName().startsWith('Bark')) {
          const scorched = scorchBark(doc, primitive, spec.id);
          mesh.removePrimitive(primitive).addPrimitive(scorched);
          for (const bough of brokenBoughs(doc, scorched, spec.id)) mesh.addPrimitive(bough);
          primitive.dispose();
        }
        if (spec.tier === 70 && primitive.getMaterial()!.getName().startsWith('Bark')) {
          primitive.getMaterial()!.setExtras({ ...primitive.getMaterial()!.getExtras(), corealmMagicTree: false });
          const carved = carveSap(doc, primitive, spec.id); mesh.removePrimitive(primitive).addPrimitive(carved.bark).addPrimitive(carved.sap); primitive.dispose(); sapFaces += carved.faces;
        }
      }
      mesh.setExtras({ ...mesh.getExtras(), corealmLeafSprays: sprays.ranges, wildernessSculpt: spec.id });
    }
    for (const node of doc.getRoot().listNodes()) if (node.getMesh()) node.setName(spec.id);
    assets.push(await serialize(doc, spec.id, 'nature', spec.description, { species: spec.species, tier: spec.tier, botanicalSprays: sprays.after, sourceSprays: sprays.before, sapFaces,
      ...(spec.tier === 50 ? { brokenBoughs: 2, fireDamage: 'Localized charcoal bark with ragged edges; textured broken boughs end in splintered exposed wood.' } : {}),
      provenance: { source: sourcePath, sourceSha256: hash(sourceBytes), geometry: 'Native continuous branch hierarchy sculpted with one differentiable deformation; intact botanical sprays pruned on the fireward side. Two collared, splintered dead boughs and local bark scars mark shallow fire damage. Deep bark split into recessed longitudinal sap channels.', textures: 'Embedded accepted Corealm bark scan and species cutouts retained with original UVs.', sourceGenerator: 'tools/build-corealm-nature.ts' } }));
  }
  for (const species of ['teak', 'magic'] as const) {
    const sourceId = species === 'teak' ? 'corealm_teak_lastroot' : 'corealm_magic_starwood';
    const sourcePath = `test-results/wilderness-resources/models/corealm/nature/${sourceId}.glb`, bytes = await readFile(sourcePath), doc = await io.readBinary(bytes);
    const id = `corealm_stump_wilderness_${species}`, cut = cutLivingStump(doc, species);
    for (const mesh of doc.getRoot().listMeshes()) {
      mesh.setName(id);
    }
    for (const node of doc.getRoot().listNodes()) if (node.getMesh()) node.setName(id);
    assets.push(await serialize(doc, id, 'nature', `${species === 'teak' ? 'Slender scorched teak' : 'Heavy dark magic tree'} stump with exposed growth rings`, {
      tier: species === 'teak' ? 50 : 70, tags: ['wilderness', 'corealm', 'original', 'stump'], ...cut,
      provenance: { source: sourcePath, sourceId, sourceSha256: hash(bytes), geometry: 'Lower bole and buttress roots cut directly from the living Wilderness tree; original bark surface, UVs and rooted footprint retained. Growth rings close the exact uneven cut rim.', textures: 'Same embedded bark scan, relief shader metadata and colours as the living tree.' },
    }));
  }
  for (const family of ['cindervein', 'nightglass'] as const) for (const spent of [false, true]) {
    const sourceId = `corealm_ore_${family === 'cindervein' ? 'emberite' : 'kaldite'}${spent ? '_spent' : ''}`;
    const source = await buildGroundOreAsset(sourceId), doc = await io.readBinary(source.glb);
    const id = `corealm_ore_${family}${spent ? '_spent' : ''}`;
    for (const mesh of doc.getRoot().listMeshes()) {
      mesh.setName(id);
      for (const primitive of mesh.listPrimitives()) {
        const p = primitive.getAttribute('POSITION')!, n = primitive.getAttribute('NORMAL')!, c = primitive.getAttribute('COLOR_0')!, material = primitive.getMaterial()!;
        const mineral = material.getName().includes('exposed');
        for (let i = 0; i < p.getCount(); i++) { const original = p.getElement(i, [0, 0, 0]) as Point;
          n.setElement(i, sculptOreNormal(family, original, n.getElement(i, [0, 0, 0]) as Point)); p.setElement(i, sculptOrePoint(family, original));
          const old = c.getElement(i, []);
          // Preserve the source's metre-scale fracture colour variation. A common floor here
          // flattened the entire dark host to one value and erased the weathered pocket lips.
          const hostPeak = family === 'cindervein' ? .0648 : .1195;
          const gain = Math.max(.38, Math.min(1.25, Math.max(...old) / (mineral ? .45 : hostPeak)));
          const colour = mineral ? family === 'cindervein' ? [.43, .105, .020] : [.09, .115, .24] : family === 'cindervein' ? [.17, .158, .154] : [.135, .142, .175];
          c.setElement(i, colour.map(value => value * gain));
        }
        if (mineral) material.setName(`Corealm exposed ${family} mineral`).setRoughnessFactor(family === 'cindervein' ? .67 : .46).setMetallicFactor(.16).setNormalScale(.55)
          .setEmissiveFactor(family === 'cindervein' ? [.13, .018, .002] : [.025, .033, .115]);
      }
    }
    for (const node of doc.getRoot().listNodes()) if (node.getMesh()) node.setName(id);
    assets.push(await serialize(doc, id, 'rock', `${spent ? 'Extracted' : 'Exposed'} ${family} in a worked fractured host`, { tier: family === 'cindervein' ? 50 : 70, mineralFaces: source.entry.mineralFaces,
      presentation: { ...source.entry.presentation, footprint: source.entry.presentation.footprint.map(p => sculptOrePoint(family, p)), frontZ: rounded(sculptOrePoint(family, [0, 0, source.entry.presentation.frontZ])[2]) },
      provenance: { sourceGenerator: 'tools/build-ground-ores.ts', sourceId, sourceSha256: hash(source.glb), geometry: 'Authored six-mass continuous ground ore with recessed mineral exposure and a paired extracted host. New shear and fracture proportions share the same deformation in both states.', textures: 'Original granular fracture normal map retained; host and mineral use separate authored vertex colours.' } }));
  }
  const catalog = { pack: { ...pack, generatorSha256: hash(await readFile('tools/wilderness-resources/build.ts')) }, generator: { command: 'npx tsx tools/wilderness-resources/build.ts', deterministic: true, sculptSha256: hash(await readFile('tools/wilderness-resources/sculpt.ts')), woodSha256: hash(await readFile('tools/wilderness-resources/wood.ts')) }, assets };
  await writeFile(path.join(out, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  console.log(JSON.stringify({ catalog: 'test-results/wilderness-resources/catalog.json', assets: assets.map(a => ({ id: a.id, triangles: a.triangles, bytes: a.bytes, size: a.size })) }, null, 2));
  return catalog;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await buildWildernessResources();
