import "../lib/repoContent.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Document, NodeIO, type Accessor, type Material, type Node, type Primitive, type Skin } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { copyToDocument, createDefaultPropertyResolver } from "@gltf-transform/functions";
import { Box3, Matrix3, Matrix4, Vector3 } from "three";
import sharp from "sharp";
import { ALL_ITEMS } from "../../game/src/content/items.js";
import type { AssetEntry } from "../../game/src/render/assets.js";
import type { ItemModelMetadata } from "./contracts.js";
import { attachItemSkin } from "./skin.js";

const slots = ["head", "body", "hands", "legs", "feet"] as const;
export type ArmorSlot = typeof slots[number];
type Coverage = NonNullable<ItemModelMetadata["bodyCoverage"]>;
/** Column-major, affine matrices. Corrections operate in native bind-space metres. */
interface VertexTransform { vertices: number[]; matrix: number[]; weights?: number[] }
interface PartSelection { node: number | string; primitive?: number; triangles?: number[] }
interface AssignedPart extends PartSelection {
  slot: ArmorSlot;
  matrix?: number[];
  vertexTransforms?: VertexTransform[];
  rigidBone?: string;
  deform?: "skirt" | "native-hand";
}
interface OmittedPart extends PartSelection { omitReason: string }
export interface TripoArmorConfig {
  /** Relative to the config file, or absolute. The original is never written. */
  source: string;
  setId: string;
  /** Relative to the repository, inside the candidate root or an assigned Tripo armor import directory. */
  output?: string;
  textureSize?: 1024 | 2048 | 4096 | 8192;
  alignment: { space: "native-male-t-pose"; reviewedBy: string; matrix?: number[] };
  /** Desired source-joint world matrices BEFORE alignment, keyed by exact exported joint name.
   * Bake targetWorld * inverseBind using exported skin weights. Node TRS is not a bind-pose source.
   * Every joint with a nonzero weight must have an explicit target. Vertex warps cannot coexist.
   */
  sourceSkin?: { jointWorldMatrices: Record<string, number[]> };
  slots: Record<ArmorSlot, { itemId: string; bodyCoverage?: Coverage }>;
  /** Every source triangle needs exactly one assignment or an explicit omission. */
  parts: (AssignedPart | OmittedPart)[];
}

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);
const pack = { id: "corealm-tripo-armor", name: "Corealm Tripo armor", author: "Corealm", license: "LicenseRef-Corealm-Original", source: "tools/item-models/import-tripo.ts" };
const regionTags: Record<ArmorSlot, string> = { head: "head", body: "torso", hands: "arms", legs: "legs", feet: "feet" };

function matrix(values: number[] | undefined, label: string): Matrix4 {
  if (values === undefined) return new Matrix4();
  if (!Array.isArray(values) || values.length !== 16 || !values.every(Number.isFinite)) throw new Error(`${label}: expected 16 finite matrix values`);
  if ([3, 7, 11].some(i => Math.abs(values[i]!) > 1e-8) || Math.abs(values[15]! - 1) > 1e-8) throw new Error(`${label}: matrix must be affine`);
  const result = new Matrix4().fromArray(values);
  if (Math.abs(result.determinant()) < 1e-12) throw new Error(`${label}: degenerate matrix`);
  return result;
}

function validateConfig(config: TripoArmorConfig): void {
  if (!config || typeof config.source !== "string" || !config.source.trim()) throw new Error("source is required");
  if (typeof config.setId !== "string" || !/^[a-z0-9_-]+$/.test(config.setId)) throw new Error("Invalid setId");
  if (config.alignment?.space !== "native-male-t-pose" || typeof config.alignment.reviewedBy !== "string" || !config.alignment.reviewedBy.trim()) {
    throw new Error("An explicit native-male-t-pose alignment and fit author are required; an uncorrected A-pose cannot be skinned");
  }
  matrix(config.alignment.matrix, "alignment");
  if (config.sourceSkin) {
    const poses = config.sourceSkin.jointWorldMatrices;
    if (!poses || typeof poses !== "object" || Array.isArray(poses) || !Object.keys(poses).length) throw new Error("sourceSkin requires explicit jointWorldMatrices");
    for (const [joint, values] of Object.entries(poses)) {
      if (!joint.trim() || !Array.isArray(values)) throw new Error("sourceSkin contains an invalid joint target");
      matrix(values, `source joint ${joint}`);
    }
  }
  if (![1024, 2048, 4096, 8192].includes(config.textureSize ?? 2048)) throw new Error("textureSize must be 1024, 2048, 4096 or 8192");
  if (!Array.isArray(config.parts) || !config.parts.length) throw new Error("parts must contain explicit source assignments");
  const ids = new Set<string>();
  for (const slot of slots) {
    const entry = config.slots?.[slot];
    const item = ALL_ITEMS.find(item => item.id === entry?.itemId);
    if (!item || item.equip?.slot !== slot) throw new Error(`${slot}: unknown item or wrong equipment slot ${entry?.itemId}`);
    if (ids.has(item.id)) throw new Error(`Duplicate item ${item.id}`);
    ids.add(item.id);
    for (const coverage of entry!.bodyCoverage ?? []) {
      if (!["torso", "legs"].includes(coverage.region) || !Number.isFinite(coverage.minY) || !Number.isFinite(coverage.maxY) || coverage.minY >= coverage.maxY) throw new Error(`${item.id}: invalid bodyCoverage`);
    }
  }
}

interface SkinBake { matrices: (Matrix4 | undefined)[]; influences: { joints: Accessor; weights: Accessor }[] }
interface SourcePrimitive { node: Node; nodeIndex: number; primitive: Primitive; primitiveIndex: number; indices: number[]; coverage: Uint8Array; skinBake?: SkinBake }
interface Assignment { source: SourcePrimitive; part: AssignedPart; triangles: number[] }

function skinBaker(document: Document, config: TripoArmorConfig): (node: Node, primitive: Primitive) => SkinBake | undefined {
  const poses = config.sourceSkin?.jointWorldMatrices;
  const skins = document.getRoot().listSkins();
  if (!poses) {
    if (skins.length || document.getRoot().listAnimations().length) throw new Error("Skinned or animated source requires explicit sourceSkin.jointWorldMatrices to bake its pose");
    return () => undefined;
  }
  if (!skins.length) throw new Error("sourceSkin was supplied for a source with no skin");
  const known = new Map<string, Node>();
  for (const skin of skins) for (const joint of skin.listJoints()) {
    const name = joint.getName();
    if (!name || known.has(name) && known.get(name) !== joint) throw new Error(`sourceSkin: ambiguous or unnamed joint ${name}`);
    known.set(name, joint);
  }
  for (const name of Object.keys(poses)) if (!known.has(name)) throw new Error(`sourceSkin: unknown source joint ${name}`);
  const cache = new Map<Skin, (Matrix4 | undefined)[]>();
  for (const skin of skins) {
    const inverse = skin.getInverseBindMatrices(), joints = skin.listJoints();
    if (!inverse || inverse.getType() !== "MAT4" || inverse.getCount() !== joints.length) throw new Error("sourceSkin: complete inverse bind matrices are required");
    cache.set(skin, joints.map((joint, i) => {
      const bindInverse = matrix(inverse.getElement(i, []), `inverse bind ${joint.getName()}`);
      const target = poses[joint.getName()];
      const posed = target ? matrix(target, `target ${joint.getName()}`).multiply(bindInverse) : undefined;
      if (posed && posed.determinant() <= 0) throw new Error(`sourceSkin: joint ${joint.getName()} reflects geometry; put coordinate reflections in alignment`);
      return posed;
    }));
  }
  return (node, primitive) => {
    const skin = node.getSkin();
    if (!skin) return undefined;
    const semantics = primitive.listSemantics();
    const suffixes = semantics.filter(name => /^(JOINTS|WEIGHTS)_/.test(name)).map(name => name.split("_")[1]!);
    const influences = [...new Set(suffixes)].sort().map(suffix => {
      const joints = primitive.getAttribute(`JOINTS_${suffix}`), weights = primitive.getAttribute(`WEIGHTS_${suffix}`);
      if (!joints || !weights || joints.getType() !== "VEC4" || weights.getType() !== "VEC4" || joints.getNormalized()) throw new Error(`node ${node.getName()}: skin needs paired VEC4 joints/weights`);
      return { joints, weights };
    });
    if (!influences.length) throw new Error(`node ${node.getName()}: skinned mesh has no vertex influences`);
    const matrices = cache.get(skin)!;
    const count = primitive.getAttribute("POSITION")!.getCount();
    for (let vertex = 0; vertex < count; vertex++) {
      let total = 0;
      for (const { joints, weights } of influences) {
        const j = joints.getElement(vertex, []), w = weights.getElement(vertex, []);
        for (let i = 0; i < 4; i++) {
          if (!Number.isInteger(j[i]) || j[i]! < 0 || j[i]! >= matrices.length || !Number.isFinite(w[i]) || w[i]! < 0) throw new Error(`node ${node.getName()}, vertex ${vertex}: invalid source skin influence`);
          if (w[i]! > 0 && !matrices[j[i]!]) throw new Error(`sourceSkin: missing used joint target ${skin.listJoints()[j[i]!]!.getName()}`);
          total += w[i]!;
        }
      }
      if (Math.abs(total - 1) > .001) throw new Error(`node ${node.getName()}, vertex ${vertex}: source skin weights sum to ${total}, expected 1`);
    }
    return { matrices, influences };
  };
}

function skinMatrix(bake: SkinBake, vertex: number): Matrix4 {
  const result = new Matrix4(); result.elements.fill(0);
  let total = 0;
  for (const { joints, weights } of bake.influences) {
    const j = joints.getElement(vertex, []), w = weights.getElement(vertex, []);
    for (let i = 0; i < 4; i++) {
      if (!w[i]) continue;
      const transform = bake.matrices[j[i]!]!;
      for (let component = 0; component < 16; component++) result.elements[component]! += transform.elements[component]! * w[i]!;
      total += w[i]!;
    }
  }
  result.elements = result.elements.map(value => value / total);
  if (result.determinant() < 1e-12) throw new Error(`vertex ${vertex}: weighted skin pose collapses or reflects geometry`);
  return result;
}

function assignments(document: Document, config: TripoArmorConfig): Assignment[] {
  const prepareSkin = skinBaker(document, config);
  const nodes = document.getRoot().listNodes();
  const sources: SourcePrimitive[] = [];
  const sceneNodes = new Set<Node>();
  const scene = document.getRoot().getDefaultScene();
  if (!scene) throw new Error("Source has no default scene");
  scene.traverse(node => sceneNodes.add(node));
  nodes.forEach((node, nodeIndex) => {
    if (!sceneNodes.has(node) || !node.getMesh()) return;
    node.getMesh()!.listPrimitives().forEach((primitive, primitiveIndex) => {
      if (primitive.getMode() !== 4 || primitive.listTargets().length) throw new Error(`node ${nodeIndex}: only static TRIANGLES primitives are supported`);
      const position = primitive.getAttribute("POSITION");
      if (!position || position.getType() !== "VEC3") throw new Error(`node ${nodeIndex}: missing VEC3 POSITION`);
      if (!node.getSkin() && primitive.listSemantics().some(name => /^(JOINTS|WEIGHTS)_/.test(name))) throw new Error(`node ${nodeIndex}: vertex skin attributes have no source skin`);
      const indices = primitive.getIndices() ? Array.from(primitive.getIndices()!.getArray()!) : Array.from({ length: position.getCount() }, (_, i) => i);
      if (!indices.length || indices.length % 3 || indices.some(index => !Number.isInteger(index) || index < 0 || index >= position.getCount())) throw new Error(`node ${nodeIndex}: invalid triangle indices`);
      for (const accessor of primitive.listAttributes()) {
        if (accessor.getCount() !== position.getCount() || !accessor.getArray() || !Array.from(accessor.getArray()!).every(Number.isFinite)) throw new Error(`node ${nodeIndex}: invalid or nonfinite vertex attribute ${accessor.getName()}`);
      }
      matrix(node.getWorldMatrix(), `node ${nodeIndex} world transform`);
      sources.push({ node, nodeIndex, primitive, primitiveIndex, indices, coverage: new Uint8Array(indices.length / 3), skinBake: prepareSkin(node, primitive) });
    });
  });
  const result: Assignment[] = [];
  for (const [row, part] of config.parts.entries()) {
    let nodeIndex: number;
    if (typeof part.node === "string") {
      const matches = nodes.flatMap((node, i) => node.getName() === part.node ? [i] : []);
      if (matches.length !== 1) throw new Error(`part ${row}: node name must match exactly once: ${part.node}`);
      nodeIndex = matches[0]!;
    } else nodeIndex = part.node;
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodes.length) throw new Error(`part ${row}: invalid source node index ${nodeIndex}`);
    if (part.primitive !== undefined && (!Number.isInteger(part.primitive) || part.primitive < 0)) throw new Error(`part ${row}: invalid primitive index`);
    const matches = sources.filter(source => source.nodeIndex === nodeIndex && (part.primitive === undefined || source.primitiveIndex === part.primitive));
    if (!matches.length) throw new Error(`part ${row}: selection has no rendered primitive`);
    if (part.triangles && matches.length !== 1) throw new Error(`part ${row}: triangles require an unambiguous primitive selection`);
    const omitted = "omitReason" in part;
    if (omitted ? !part.omitReason?.trim() || "slot" in part : !slots.includes(part.slot)) throw new Error(`part ${row}: use one slot or an explicit omission reason`);
    if (!omitted) {
      if (part.rigidBone !== undefined && (typeof part.rigidBone !== "string" || !part.rigidBone.trim())) throw new Error(`part ${row}: invalid rigidBone`);
      if (part.deform !== undefined && !["skirt", "native-hand"].includes(part.deform)) throw new Error(`part ${row}: invalid deformation hint`);
      if (part.rigidBone && part.deform) throw new Error(`part ${row}: rigidBone and deform cannot be combined`);
      if (part.deform === "native-hand" && part.slot !== "hands") throw new Error(`part ${row}: native-hand requires hands slot`);
      if (config.sourceSkin && part.vertexTransforms?.length) throw new Error(`part ${row}: sourceSkin and vertexTransforms cannot be combined`);
      matrix(part.matrix, `part ${row}`);
    }
    for (const source of matches) {
      const triangles = part.triangles ?? Array.from(source.coverage.keys());
      if (!Array.isArray(triangles) || !triangles.length) throw new Error(`part ${row}: empty triangle selection`);
      for (const triangle of triangles) {
        if (!Number.isInteger(triangle) || triangle < 0 || triangle >= source.coverage.length) throw new Error(`part ${row}: invalid triangle ${triangle}`);
        if (source.coverage[triangle]) throw new Error(`node ${nodeIndex}, primitive ${source.primitiveIndex}, triangle ${triangle}: duplicate assignment`);
        source.coverage[triangle] = 1;
      }
      if (!omitted) result.push({ source, part, triangles });
    }
  }
  for (const source of sources) {
    const missing = source.coverage.indexOf(0);
    if (missing >= 0) throw new Error(`node ${source.nodeIndex}, primitive ${source.primitiveIndex}, triangle ${missing}: missing assignment or omission`);
  }
  for (const slot of slots) {
    const count = result.filter(row => row.part.slot === slot).reduce((sum, row) => sum + row.triangles.length, 0);
    if (!count || count > 5000) throw new Error(`${slot}: triangle budget ${count}, expected 1–5000`);
  }
  return result;
}

interface Correction { matrix: Matrix4; normal: Matrix3 }
function corrections(part: AssignedPart, used: Set<number>): Map<number, Correction> {
  const result = new Map<number, Correction>();
  for (const [index, group] of (part.vertexTransforms ?? []).entries()) {
    const transform = matrix(group.matrix, `vertex transform ${index}`);
    if (transform.determinant() <= 0) throw new Error(`vertex transform ${index}: reflections cannot be blended per vertex`);
    if (!Array.isArray(group.vertices) || !group.vertices.length || (group.weights && group.weights.length !== group.vertices.length)) throw new Error(`vertex transform ${index}: invalid vertices/weights`);
    group.vertices.forEach((vertex, i) => {
      if (!Number.isInteger(vertex) || !used.has(vertex)) throw new Error(`vertex transform ${index}: vertex ${vertex} is outside selected triangles`);
      if (result.has(vertex)) throw new Error(`vertex ${vertex}: overlapping corrections`);
      const weight = group.weights?.[i] ?? 1;
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error(`vertex ${vertex}: invalid correction weight`);
      // The blended affine transform must stay invertible too.
      const blend = new Matrix4();
      blend.elements = blend.elements.map((value, i) => value * (1 - weight) + transform.elements[i]! * weight);
      if (Math.abs(blend.determinant()) < 1e-12) throw new Error(`vertex ${vertex}: degenerate blended correction`);
      result.set(vertex, { matrix: blend, normal: new Matrix3().getNormalMatrix(blend) });
    });
  }
  return result;
}

function copyGeometry(target: Document, assignment: Assignment, alignment: Matrix4, material: Material | null): Primitive {
  const { source, part, triangles } = assignment;
  const buffer = target.getRoot().listBuffers()[0]!;
  const selectedIndices = triangles.flatMap(triangle => source.indices.slice(triangle * 3, triangle * 3 + 3));
  const sourceVertices = [...new Set(selectedIndices)];
  const remap = new Map(sourceVertices.map((vertex, index) => [vertex, index]));
  const warp = corrections(part, new Set(sourceVertices));
  const base = alignment.clone().multiply(matrix(source.node.getWorldMatrix(), "source world"));
  const after = matrix(part.matrix, "part matrix");
  const normalBase = new Matrix3().getNormalMatrix(base), normalAfter = new Matrix3().getNormalMatrix(after);
  const reflected = (source.skinBake ? alignment.determinant() : base.determinant()) * after.determinant() < 0;
  const skinned = source.skinBake ? new Map(sourceVertices.map(vertex => {
    // glTF jointWorld * inverseBind already produces world coordinates. Applying mesh world
    // here would apply it twice; the renderer's inverse mesh world and mesh world cancel.
    const transform = alignment.clone().multiply(skinMatrix(source.skinBake!, vertex));
    return [vertex, { matrix: transform, normal: new Matrix3().getNormalMatrix(transform) }] as const;
  })) : undefined;
  const primitive = target.createPrimitive().setMaterial(material).setExtras(source.primitive.getExtras());
  for (const semantic of source.primitive.listSemantics()) {
    if (/^(JOINTS|WEIGHTS)_/.test(semantic)) continue;
    const original = source.primitive.getAttribute(semantic)!;
    const width = original.getElementSize();
    const values = new Float32Array(sourceVertices.length * width);
    const element: number[] = [];
    sourceVertices.forEach((vertex, index) => {
      original.getElement(vertex, element);
      if (["POSITION", "NORMAL", "TANGENT"].includes(semantic)) {
        const vector = new Vector3().fromArray(element);
        const correction = warp.get(vertex);
        const baked = skinned?.get(vertex);
        const vertexBase = baked?.matrix ?? base, vertexNormal = baked?.normal ?? normalBase;
        if (semantic === "POSITION") {
          vector.applyMatrix4(vertexBase);
          if (correction) vector.applyMatrix4(correction.matrix);
          vector.applyMatrix4(after);
        } else {
          // Tangents are directions; normals are covectors under nonuniform scale.
          if (semantic === "NORMAL") vector.applyMatrix3(vertexNormal).normalize();
          else vector.transformDirection(vertexBase);
          if (correction) {
            if (semantic === "NORMAL") vector.applyMatrix3(correction.normal).normalize();
            else vector.transformDirection(correction.matrix);
          }
          if (semantic === "NORMAL") vector.applyMatrix3(normalAfter).normalize();
          else vector.transformDirection(after);
          if (vector.lengthSq() < 1e-12) throw new Error(`node ${source.nodeIndex}: invalid ${semantic}`);
        }
        [element[0], element[1], element[2]] = vector.toArray();
        if (semantic === "TANGENT" && reflected) element[3] = -element[3]!;
      }
      if (!element.every(Number.isFinite)) throw new Error(`node ${source.nodeIndex}: nonfinite transformed ${semantic}`);
      values.set(element, index * width);
    });
    primitive.setAttribute(semantic, target.createAccessor(original.getName() || semantic).setType(original.getType()).setArray(values).setBuffer(buffer));
  }
  const indices = selectedIndices.map(vertex => remap.get(vertex)!);
  if (reflected) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
  primitive.setIndices(target.createAccessor("triangles").setType("SCALAR").setArray(sourceVertices.length > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)).setBuffer(buffer));
  // Some exports omit normals. Generate only that missing attribute without changing topology.
  if (!primitive.getAttribute("NORMAL")) {
    const positions = primitive.getAttribute("POSITION")!;
    const normals = new Float32Array(sourceVertices.length * 3);
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), point: number[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      positions.getElement(indices[i]!, point); a.fromArray(point);
      positions.getElement(indices[i + 1]!, point); b.fromArray(point);
      positions.getElement(indices[i + 2]!, point); c.fromArray(point);
      const face = b.sub(a).cross(c.sub(a));
      for (const vertex of indices.slice(i, i + 3)) for (let axis = 0; axis < 3; axis++) normals[vertex * 3 + axis]! += face.getComponent(axis);
    }
    for (let vertex = 0; vertex < sourceVertices.length; vertex++) {
      a.fromArray(normals, vertex * 3);
      if (a.lengthSq() < 1e-18) throw new Error(`node ${source.nodeIndex}: cannot generate normals for degenerate geometry`);
      a.normalize().toArray(normals, vertex * 3);
    }
    primitive.setAttribute("NORMAL", target.createAccessor("NORMAL").setType("VEC3").setArray(normals).setBuffer(buffer));
  }
  return primitive;
}

/** Builds pending candidates only. Neither this fit declaration nor the skin pass grants visual approval. */
export async function buildTripoArmor(source: Document, config: TripoArmorConfig): Promise<{ slot: ArmorSlot; document: Document; triangles: number; bounds: Box3 }[]> {
  validateConfig(config);
  const selected = assignments(source, config);
  const alignment = matrix(config.alignment.matrix, "alignment");
  const outputs = [];
  for (const slot of slots) {
    const { itemId, bodyCoverage } = config.slots[slot];
    const document = new Document(), scene = document.createScene(itemId);
    document.getRoot().setDefaultScene(scene); document.createBuffer();
    const resolve = createDefaultPropertyResolver(document, source);
    const meta: ItemModelMetadata = { itemId, author: "Corealm / Tripo", reference: config.source, description: `${config.setId} ${slot}, fitted by ${config.alignment.reviewedBy}`, wearable: true, ...(bodyCoverage ? { bodyCoverage } : {}) };
    scene.setExtras({ itemModel: meta, tripoImport: { setId: config.setId, status: "pending", fitAuthor: config.alignment.reviewedBy } });
    let triangles = 0;
    const bounds = new Box3();
    for (const [index, assignment] of selected.filter(row => row.part.slot === slot).entries()) {
      const original = assignment.source.primitive.getMaterial();
      const material = original ? copyToDocument(document, source, [original], resolve).get(original) as Material : null;
      const primitive = copyGeometry(document, assignment, alignment, material);
      const name = `${itemId}-${assignment.source.nodeIndex}-${assignment.source.primitiveIndex}-${index}`;
      const { rigidBone, deform } = assignment.part;
      scene.addChild(document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive)).setExtras({ sourceNode: assignment.source.nodeIndex, sourcePrimitive: assignment.source.primitiveIndex, ...(rigidBone ? { itemModelBone: rigidBone } : {}), ...(deform ? { itemModelDeform: deform } : {}) }));
      const position = primitive.getAttribute("POSITION")!, point: number[] = [];
      for (let vertex = 0; vertex < position.getCount(); vertex++) { position.getElement(vertex, point); bounds.expandByPoint(new Vector3().fromArray(point)); }
      triangles += assignment.triangles.length;
    }
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) throw new Error(`${itemId}: invalid fitted bounds`);
    await attachItemSkin(document, itemId);
    // Imported material dependencies can bring separate buffers; GLB has one binary buffer.
    const buffer = document.getRoot().listBuffers()[0]!;
    for (const accessor of document.getRoot().listAccessors()) accessor.setBuffer(buffer);
    for (const other of document.getRoot().listBuffers()) if (other !== buffer) other.dispose();
    outputs.push({ slot, document, triangles, bounds });
  }
  return outputs;
}

export async function importTripoArmor(configPath: string): Promise<string> {
  const configBytes = await readFile(configPath);
  const config = JSON.parse(configBytes.toString()) as TripoArmorConfig;
  validateConfig(config);
  const sourcePath = path.resolve(path.dirname(configPath), config.source);
  const output = path.resolve(config.output ?? `art/item-models/candidates/tripo-${config.setId}`);
  const allowedRoots = ["art/item-models/candidates", ...["early", "mid", "late"].map(group => `assets/art/tripo/imports/armor-${group}`)];
  if (!allowedRoots.some(root => {
    const relative = path.relative(path.resolve(root), output);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  })) throw new Error("Candidate output must stay inside an assigned armor import directory or art/item-models/candidates");
  if (sourcePath === output || sourcePath.startsWith(`${output}${path.sep}`)) throw new Error("Source must remain outside candidate output");
  const sourceBytes = await readFile(sourcePath);
  const source = await io().readBinary(sourceBytes);
  const candidates = await buildTripoArmor(source, config);
  const records = [];
  const resized = new Map<string, { image: Uint8Array; mime: string }>();
  for (const { slot, document, triangles, bounds } of candidates) {
    for (const texture of document.getRoot().listTextures()) {
      const original = texture.getImage();
      if (!original) throw new Error(`${texture.getName()}: source texture image is missing`);
      const key = hash(original);
      let image = resized.get(key);
      if (!image) {
        const metadata = await sharp(original).metadata();
        if (!metadata.width || !metadata.height) throw new Error(`${texture.getName()}: texture has no dimensions`);
        image = { image: original, mime: texture.getMimeType() };
        if (Math.max(metadata.width, metadata.height) > (config.textureSize ?? 2048)) {
          image = { image: await sharp(original).resize(config.textureSize ?? 2048, config.textureSize ?? 2048, { fit: "inside", withoutEnlargement: true }).png().toBuffer(), mime: "image/png" };
        }
        resized.set(key, image);
      }
      texture.setImage(image.image).setMimeType(image.mime);
    }
    const glb = await io().writeBinary(document);
    const itemId = config.slots[slot].itemId, file = `models/items/${itemId}.glb`;
    const size = bounds.getSize(new Vector3());
    const entry: AssetEntry = { id: `corealm_item_${itemId}`, file, pack: pack.id, category: "outfit", is: "item", tags: ["item-model", "tripo-authored", itemId, regionTags[slot]], bytes: glb.byteLength,
      itemModel: { itemId, wearable: true, ...(config.slots[slot].bodyCoverage ? { bodyCoverage: config.slots[slot].bodyCoverage } : {}) },
      size: { x: size.x, y: size.y, z: size.z }, base: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z }, animations: [], materials: document.getRoot().listMaterials().map(material => material.getName()) };
    await mkdir(path.dirname(path.join(output, file)), { recursive: true });
    await writeFile(path.join(output, file), glb);
    records.push({ ...entry, itemId, status: "pending", sha256: hash(glb), sourceSha256: hash(sourceBytes), configSha256: hash(configBytes), triangles, drawCalls: document.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().length, 0) });
    console.log(`${itemId}: ${triangles} triangles, 65 native joints, ${glb.byteLength} bytes, pending visual acceptance`);
  }
  const catalogPath = path.join(output, "catalogue.json");
  await writeFile(catalogPath, JSON.stringify({ version: 1, status: "pending", pack, source: sourcePath, sourceSha256: hash(sourceBytes), configSha256: hash(configBytes), textureSize: config.textureSize ?? 2048, assets: records }, null, 2));
  return catalogPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const index = process.argv.indexOf("--config"), config = index >= 0 ? process.argv[index + 1] : undefined;
  if (!config) throw new Error("Use --config <armor-fit.json>");
  console.log(await importTripoArmor(path.resolve(config)));
}
