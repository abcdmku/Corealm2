import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  applyGearAppearance,
  gearAppearance,
  gearAppearancePartsWithCharge,
  type GearAppearance,
} from "../game/src/render/equipmentVisuals.js";
import {
  buildItemIconPrimitive,
  fitItemIconCamera,
  prepareItemIconAsset,
} from "../game/src/render/itemIconRenderer.js";
import { itemIconAppearance, type ItemIconPrimitive } from "../game/src/render/itemIconAppearances.js";
import { registerProceduralGear } from "../game/src/render/proceduralGear.js";
import { AssetRegistry } from "../game/src/render/assets.js";

const MAP_FIELDS = [
  "map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap",
] as const;

function authoredMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    name: "authored-material",
    color: 0x725139,
    emissive: 0x182430,
    emissiveIntensity: 0.36,
    roughness: 0.93,
    metalness: 0.76,
    vertexColors: true,
    transparent: true,
    opacity: 0.87,
    alphaTest: 0.21,
    side: THREE.DoubleSide,
    normalScale: new THREE.Vector2(0.7, 0.9),
  });
  for (const field of MAP_FIELDS) material[field] = new THREE.Texture();
  return material;
}

function materials(object: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const result: THREE.MeshStandardMaterial[] = [];
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    result.push(...(Array.isArray(child.material) ? child.material : [child.material]));
  });
  return result;
}

function meshes(object: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  object.traverse(child => {
    if (child instanceof THREE.Mesh) result.push(child);
  });
  return result;
}

function materialState(material: THREE.MeshStandardMaterial): unknown {
  const shader = {
    vertexShader: "",
    fragmentShader: "#include <color_fragment>\n#include <roughnessmap_fragment>",
    uniforms: {},
  } as Parameters<THREE.Material["onBeforeCompile"]>[0];
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return {
    type: material.type,
    name: material.name,
    color: material.color.toArray(),
    emissive: material.emissive.toArray(),
    emissiveIntensity: material.emissiveIntensity,
    roughness: material.roughness,
    metalness: material.metalness,
    vertexColors: material.vertexColors,
    normalScale: material.normalScale.toArray(),
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    side: material.side,
    maps: MAP_FIELDS.map(field => material[field]?.uuid),
    shader: shader.fragmentShader,
    cacheKey: material.customProgramCacheKey(),
  };
}

function appearanceFor(itemId: string): GearAppearance {
  const appearance = gearAppearance(itemId);
  expect(appearance, itemId).not.toBeNull();
  return appearance!;
}

function graphTransforms(object: THREE.Object3D): unknown[] {
  const result: unknown[] = [];
  object.traverse(child => {
    result.push({
      uuid: child.uuid, position: child.position.toArray(),
      quaternion: child.quaternion.toArray(), scale: child.scale.toArray(),
    });
  });
  return result;
}

describe("prepared icon assets", () => {
  it("clones source transforms and material arrays while preserving resource detail", () => {
    const source = new THREE.Group();
    source.position.set(0.2, -0.3, 0.4);
    source.rotation.set(0.1, 0.2, -0.1);
    source.scale.set(1.2, 0.8, 1.1);
    const authored = [authoredMaterial(), authoredMaterial()];
    const sourceMesh = new THREE.Mesh(new THREE.BoxGeometry(), authored);
    sourceMesh.position.set(0.3, 0.2, 0.1);
    source.add(sourceMesh);
    const before = authored.map(materialState);
    const beforeTransform = graphTransforms(source);

    const icon = prepareItemIconAsset(source, {
      kind: "asset", assetId: "resource-fixture", colour: 0xabcdef, scale: 0.5,
    });
    const iconMesh = meshes(icon)[0]!;

    expect(icon).not.toBe(source);
    expect(iconMesh).not.toBe(sourceMesh);
    expect(iconMesh.geometry).toBe(sourceMesh.geometry);
    expect(iconMesh.geometry.userData["itemIconOwned"]).not.toBe(true);
    expect(iconMesh.material).not.toBe(sourceMesh.material);
    expect(icon.scale.toArray()).toEqual([0.6, 0.4, 0.55]);
    expect(icon.position.toArray()).toEqual(source.position.toArray());
    expect(icon.quaternion.toArray()).toEqual(source.quaternion.toArray());
    expect(iconMesh.position.toArray()).toEqual(sourceMesh.position.toArray());
    expect(graphTransforms(source)).toEqual(beforeTransform);
    expect(sourceMesh.material).toBe(authored);
    expect(authored.map(materialState)).toEqual(before);

    materials(icon).forEach((material, index) => {
      const original = authored[index]!;
      expect(material).not.toBe(original);
      for (const field of MAP_FIELDS) expect(material[field], field).toBe(original[field]);
      expect(material.vertexColors).toBe(true);
      expect(material.roughness).toBe(original.roughness);
      expect(material.metalness).toBe(original.metalness);
      expect(material.normalScale.toArray()).toEqual(original.normalScale.toArray());
      expect(material.opacity).toBe(original.opacity);
      expect(material.alphaTest).toBe(original.alphaTest);
      expect(material.side).toBe(original.side);
    });
    materials(icon)[0]!.color.setHex(0xffffff);
    expect(authored.map(materialState)).toEqual(before);
  });

  it.each([
    "kaldite_sword", "kaldite_dagger", "marchhide_robe", "charhide_boots",
    "basic_wooden_staff", "cinderpine_wand", "tideworn_sword", "mossbound_staff",
  ])("uses the production material treatment for %s", itemId => {
    const appearance = appearanceFor(itemId);
    const source = new THREE.Mesh(new THREE.BoxGeometry(), authoredMaterial());
    const sourceBefore = materialState(source.material);
    const expected = source.clone();
    applyGearAppearance(expected, appearance);

    const icon = prepareItemIconAsset(source, {
      kind: "asset", assetId: appearance.assetId, gearAppearance: appearance,
    });

    expect(materials(icon).map(materialState)).toEqual(materials(expected).map(materialState));
    expect(materials(icon)[0]).not.toBe(source.material);
    expect(materialState(source.material)).toEqual(sourceBefore);
    expect(source.children).toHaveLength(0);
  });

  it("keeps the authored leather grip and localizes gear accents to their gem or mask", () => {
    const appearance = appearanceFor("kaldite_dagger");
    const steel = authoredMaterial();
    steel.emissiveMap = null;
    const leather = authoredMaterial();
    leather.userData["equipmentRole"] = "leather";
    leather.emissiveMap = null;
    const gem = authoredMaterial();
    gem.userData["equipmentRole"] = "gem";
    gem.emissiveMap = null;
    const masked = authoredMaterial();
    const source = new THREE.Mesh(new THREE.BoxGeometry(), [steel, leather, gem, masked]);
    const before = materials(source).map(materialState);

    const icon = prepareItemIconAsset(source, {
      kind: "asset", assetId: appearance.assetId, gearAppearance: appearance,
    });
    const [iconSteel, iconLeather, iconGem, iconMasked] = materials(icon);

    expect(iconSteel!.color.getHex()).toBe(appearance.tint);
    expect(iconSteel!.emissiveIntensity).toBe(0);
    expect(iconLeather!.color.toArray()).toEqual(leather.color.toArray());
    expect(iconLeather!.map).toBe(leather.map);
    expect(iconLeather!.emissiveIntensity).toBe(0);
    expect(iconGem!.color.getHex()).toBe(appearance.accent);
    expect(iconGem!.emissive.getHex()).toBe(appearance.accent);
    expect(iconMasked!.emissiveMap).toBe(masked.emissiveMap);
    expect(iconMasked!.emissiveIntensity).toBeGreaterThan(0);
    expect(materials(source).map(materialState)).toEqual(before);
  });

  it.each([true, false])("attaches the production elemental socket with charge %s", charged => {
    const appearance = gearAppearancePartsWithCharge("fire_staff", { itemId: "fire_staff", charged })[0]!;
    expect(appearance.orb).toBeDefined();
    const source = new THREE.Group();
    source.add(new THREE.Mesh(new THREE.BoxGeometry(), authoredMaterial()));
    const expected = source.clone(true);
    applyGearAppearance(expected, appearance);

    const icon = prepareItemIconAsset(source, {
      kind: "asset", assetId: appearance.assetId, gearAppearance: appearance,
    });
    const expectedOrb = meshes(expected).find(mesh => mesh.name.startsWith("magic-weapon-socket-"))!;
    const iconOrb = meshes(icon).find(mesh => mesh.name.startsWith("magic-weapon-socket-"))!;

    expect(iconOrb).toBeDefined();
    expect(iconOrb.name).toBe(expectedOrb.name);
    expect(iconOrb.position.toArray()).toEqual(expectedOrb.position.toArray());
    expect(iconOrb.quaternion.toArray()).toEqual(expectedOrb.quaternion.toArray());
    expect(iconOrb.scale.toArray()).toEqual(expectedOrb.scale.toArray());
    expect(iconOrb.castShadow).toBe(expectedOrb.castShadow);
    expect(iconOrb.receiveShadow).toBe(expectedOrb.receiveShadow);
    expect(materials(iconOrb).map(materialState)).toEqual(materials(expectedOrb).map(materialState));
    expect(source.children).toHaveLength(1);
    expect(meshes(source).some(mesh => mesh.name.startsWith("magic-weapon-socket-"))).toBe(false);
  });

  it.each([false, true])("owns untinted material clones with gear metadata %s", withGear => {
    const authored = new THREE.MeshPhysicalMaterial({
      color: 0x587932, map: new THREE.Texture(), vertexColors: true,
      metalness: 0.67, roughness: 0.82, clearcoat: 0.73, clearcoatRoughness: 0.23,
    });
    const source = new THREE.Mesh(new THREE.BoxGeometry(), authored);
    const appearance: GearAppearance = { assetId: "native-fixture", slot: "mainHand", attach: "bone" };
    const icon = prepareItemIconAsset(source, {
      kind: "asset", assetId: appearance.assetId,
      ...(withGear ? { gearAppearance: appearance } : {}),
    });
    const cloned = materials(icon)[0] as THREE.MeshPhysicalMaterial;

    expect(cloned).not.toBe(authored);
    expect(materialState(cloned)).toEqual(materialState(authored));
    expect(cloned.clearcoat).toBe(authored.clearcoat);
    expect(cloned.clearcoatRoughness).toBe(authored.clearcoatRoughness);
    let sourceDisposed = false;
    authored.addEventListener("dispose", () => { sourceDisposed = true; });
    cloned.dispose();
    expect(sourceDisposed).toBe(false);
  });
});

/** Independently project the geometry through the returned camera, without using fit bounds. */
function projectedVertexBounds(object: THREE.Object3D, camera: THREE.OrthographicCamera): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  camera.updateMatrixWorld(true);
  const result = new THREE.Box3();
  const point = new THREE.Vector3();
  object.traverseVisible(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry;
    const position = geometry.getAttribute("position");
    const count = geometry.index?.count ?? position.count;
    for (let offset = 0; offset < count; offset += 1) {
      const vertex = geometry.index?.getX(offset) ?? offset;
      child.getVertexPosition(vertex, point).applyMatrix4(child.matrixWorld).project(camera);
      result.expandByPoint(point);
    }
  });
  return result;
}

function assertIconOccupancy(bounds: THREE.Box3, frameScale = 1): void {
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  expect(Math.max(size.x, size.y) * 128).toBeCloseTo(209.92 / frameScale, 5);
  expect((centre.x + 1) * 128).toBeCloseTo(128, 5);
  expect((1 - centre.y) * 128).toBeCloseTo(128, 5);
  expect(bounds.min.x).toBeGreaterThan(-1);
  expect(bounds.min.y).toBeGreaterThan(-1);
  expect(bounds.min.z).toBeGreaterThan(-1);
  expect(bounds.max.x).toBeLessThan(1);
  expect(bounds.max.y).toBeLessThan(1);
  expect(bounds.max.z).toBeLessThan(1);
}

/** Snapshot buffer bytes rather than materializing hundreds of thousands of rod coordinates. */
function geometryBuffers(object: THREE.Object3D): Buffer[] {
  return meshes(object).flatMap(mesh => {
    const geometry = mesh.geometry;
    const arrays = Object.values(geometry.attributes).map(attribute => attribute.array);
    if (geometry.index) arrays.push(geometry.index.array);
    return arrays.map(array => Buffer.from(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)));
  });
}

describe("item icon camera fit", () => {
  const assets = new AssetRegistry();
  registerProceduralGear(assets);

  it.each([
    ["worn_rod", 191.2856], ["palewood_rod", 192.7390], ["duskoak_rod", 193.9815],
    ["cairnpine_rod", 195.0560], ["cinderpine_rod", 195.9945],
  ] as const)("fills the canvas with %s while retaining its full shaft", async (itemId, expectedShaftPixels) => {
    const appearance = itemIconAppearance(itemId);
    expect(appearance.parts).toHaveLength(1);
    const part = appearance.parts[0]!;
    if (part.kind !== "asset") throw new Error(`Rod ${itemId} must use its registered production asset`);
    const source = await assets.load(part.assetId);
    expect(source, part.assetId).toBeDefined();
    const sourceTransforms = graphTransforms(source);
    const sourceBuffers = geometryBuffers(source);
    const sourceGeometries = meshes(source).map(mesh => mesh.geometry);

    const content = new THREE.Group();
    content.add(prepareItemIconAsset(source, part, appearance.presentation));
    if (appearance.rotation) content.rotation.set(...appearance.rotation);
    const contentTransforms = graphTransforms(content);
    const iconRoot = new THREE.Group();
    iconRoot.add(content);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    fitItemIconCamera(iconRoot, camera, appearance);

    const fullBounds = projectedVertexBounds(iconRoot, camera);
    assertIconOccupancy(fullBounds, appearance.frameScale);
    const shaft = content.getObjectByName("rod-shaft")!;
    expect(shaft).toBeDefined();
    const shaftSize = projectedVertexBounds(shaft, camera).getSize(new THREE.Vector3());
    const shaftPixels = Math.max(shaftSize.x, shaftSize.y) * 128;
    expect(shaftPixels).toBeGreaterThan(191);
    expect(shaftPixels).toBeLessThan(197);
    expect(shaftPixels).toBeCloseTo(expectedShaftPixels, 3);
    const worldSize = new THREE.Box3().setFromObject(iconRoot, true).getSize(new THREE.Vector3());
    expect(Math.max(worldSize.x, worldSize.y, worldSize.z)).toBeCloseTo(2, 6);
    expect(camera.position.length()).toBeCloseTo(6, 6);
    expect(graphTransforms(content)).toEqual(contentTransforms);
    expect(graphTransforms(source)).toEqual(sourceTransforms);
    expect(meshes(source).map(mesh => mesh.geometry)).toEqual(sourceGeometries);
    const afterBuffers = geometryBuffers(source);
    expect(afterBuffers).toHaveLength(sourceBuffers.length);
    afterBuffers.forEach((buffer, index) => expect(buffer.equals(sourceBuffers[index]!)).toBe(true));

    // Reusing the same scene must not accumulate a second normalization or centering offset.
    fitItemIconCamera(iconRoot, camera, appearance);
    const repeatBounds = projectedVertexBounds(iconRoot, camera);
    assertIconOccupancy(repeatBounds, appearance.frameScale);
    expect(repeatBounds.min.distanceTo(fullBounds.min)).toBeLessThan(1e-10);
    expect(repeatBounds.max.distanceTo(fullBounds.max)).toBeLessThan(1e-10);
  });

  it.each([1, 1.2])("fits a slender diagonal from actual vertices with frame scale %s", frameScale => {
    const content = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2, 0.02), new THREE.MeshStandardMaterial());
    content.rotation.z = -Math.PI / 4;
    content.position.set(0.37, -0.41, 0.23);
    content.add(bar);
    const transforms = graphTransforms(content);
    const buffers = geometryBuffers(content);
    const iconRoot = new THREE.Group();
    iconRoot.add(content);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);

    fitItemIconCamera(iconRoot, camera, { itemId: "worn_rod", frameScale });

    // The old projected-AABB fit made this diagonal only 122.916px at frameScale=1.
    assertIconOccupancy(projectedVertexBounds(iconRoot, camera), frameScale);
    expect(graphTransforms(content)).toEqual(transforms);
    geometryBuffers(content).forEach((buffer, index) => expect(buffer.equals(buffers[index]!)).toBe(true));
  });
});

/** Keep the shipped buffers, skeleton and UVs; omit material references to avoid a DOM image loader. */
async function loadGloveGeometry(assetId: string): Promise<THREE.Group> {
  const encoded = await readFile(`game/public/assets/models/outfit/${assetId}.glb`);
  const jsonLength = encoded.readUInt32LE(12);
  const json = JSON.parse(encoded.subarray(20, 20 + jsonLength).toString("utf8")) as {
    meshes: Array<{ primitives: Array<{ material?: number }> }>;
  };
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
  text.copy(padded);
  const remainder = encoded.subarray(20 + jsonLength);
  const header = Buffer.from(encoded.subarray(0, 20));
  header.writeUInt32LE(20 + padded.length + remainder.length, 8);
  header.writeUInt32LE(padded.length, 12);
  const binary = new Uint8Array(Buffer.concat([header, padded, remainder]));
  return (await new GLTFLoader().parseAsync(binary.buffer, "")).scene;
}

describe("paired glove icons", () => {
  it.each(["grithe_gloves", "marchhide_wraps"])("keeps the shipped fingers and UVs inside a compact pair for %s", async itemId => {
    const appearance = appearanceFor(itemId);
    const source = await loadGloveGeometry(appearance.assetId);
    source.updateMatrixWorld(true);
    const sourceBefore = source.toJSON();
    const transformsBefore = graphTransforms(source);
    const sourceSize = new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3());
    const icon = prepareItemIconAsset(source, {
      kind: "asset", assetId: appearance.assetId, gearAppearance: appearance,
    }, "paired-hands");
    const bounds = new THREE.Box3().setFromObject(icon);
    const size = bounds.getSize(new THREE.Vector3());

    expect(size.x).toBeGreaterThan(0.15);
    expect(size.x).toBeLessThan(0.45);
    expect(size.x).toBeLessThan(sourceSize.x * 0.25);
    expect(size.y).toBeGreaterThan(0.15);
    expect(size.y).toBeLessThan(0.6);
    expect(meshes(icon).filter(mesh => mesh.name === "item-icon-cuff-lining")).toHaveLength(2);

    for (const side of ["l", "r"] as const) {
      const hand = icon.getObjectByName(side === "l" ? "item-icon-left-glove" : "item-icon-right-glove")!;
      expect(hand).toBeDefined();
      const wrist = source.getObjectByName(`hand_${side}`)!.getWorldPosition(new THREE.Vector3());
      const sign = side === "l" ? 1 : -1;
      const stagedVertices = new Map<string, THREE.Vector3[]>();
      for (const mesh of meshes(hand).filter(mesh => mesh.name !== "item-icon-cuff-lining")) {
        expect(mesh.geometry.userData["itemIconOwned"]).toBe(true);
        const position = mesh.geometry.getAttribute("position");
        const uv = mesh.geometry.getAttribute("uv");
        expect(uv.count).toBe(position.count);
        for (let index = 0; index < position.count; index += 1) {
          const key = `${uv.getX(index)},${uv.getY(index)}`;
          const candidates = stagedVertices.get(key) ?? [];
          candidates.push(new THREE.Vector3().fromBufferAttribute(position, index));
          stagedVertices.set(key, candidates);
        }
      }

      const fingerCounts = new Map<string, number>();
      for (const mesh of meshes(source)) {
        if (!(mesh instanceof THREE.SkinnedMesh)) continue;
        const position = mesh.geometry.getAttribute("position");
        const skinIndex = mesh.geometry.getAttribute("skinIndex");
        const skinWeight = mesh.geometry.getAttribute("skinWeight");
        const uv = mesh.geometry.getAttribute("uv");
        for (let index = 0; index < position.count; index += 1) {
          let finger: string | undefined;
          for (let influence = 0; influence < 4; influence += 1) {
            if (skinWeight.getComponent(index, influence) < 0.5) continue;
            const bone = mesh.skeleton.bones[skinIndex.getComponent(index, influence)];
            const match = bone?.name.match(new RegExp(`^(thumb|index|middle|ring|pinky)_\\d+_${side}$`));
            if (match) finger = match[1];
          }
          if (!finger) continue;
          const world = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).sub(wrist);
          const staged = new THREE.Vector3(sign * world.z, sign * world.x, world.y);
          const candidates = stagedVertices.get(`${uv.getX(index)},${uv.getY(index)}`) ?? [];
          expect(candidates.some(position => position.distanceTo(staged) < 1e-7), `${side} ${finger} vertex ${index}`).toBe(true);
          fingerCounts.set(finger, (fingerCounts.get(finger) ?? 0) + 1);
        }
      }
      expect([...fingerCounts.keys()].sort()).toEqual(["index", "middle", "pinky", "ring", "thumb"]);
      for (const count of fingerCounts.values()) expect(count).toBeGreaterThan(2);
    }
    expect(source.toJSON()).toEqual(sourceBefore);
    expect(graphTransforms(source)).toEqual(transformsBefore);
  });
});

const DROP_SHAPES = ["tuft", "cord", "quill", "scute", "shell", "antler-palm"] as const satisfies readonly ItemIconPrimitive[];
const VARIANT_CASES = ([
  ["tuft", [0, 1, 2, 3]], ["cord", [0, 1, 2]], ["quill", [0, 1]], ["scute", [0, 1, 2, 3]],
  ["ring", [1, 2, 3, 4]], ["amulet", [1, 2, 3, 4]], ["feather", [1, 2]],
  ["claw", [1, 2, 3]], ["gland", [1, 2]],
] as const satisfies readonly (readonly [ItemIconPrimitive, readonly number[]])[])
  .flatMap(([primitive, variants]) => variants.map(variant => [primitive, variant] as const));

function drop(shape: typeof DROP_SHAPES[number]): THREE.Group {
  return buildItemIconPrimitive({ kind: "primitive", primitive: shape, colour: 0x876f4b, accent: 0xc9b68d });
}

// Compare filled triangle projections normalized to a 48px grid. Geometry counts or bounding boxes
// cannot reject two differently constructed meshes with the same visible outline.
function silhouette(object: THREE.Object3D): Uint8Array {
  const size = 48;
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(1, 0.8165, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  object.updateMatrixWorld(true);
  const triangles: THREE.Vector2[][] = [];
  const bounds = new THREE.Box2();
  for (const mesh of meshes(object)) {
    const position = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.index;
    const count = index?.count ?? position.count;
    for (let first = 0; first + 2 < count; first += 3) {
      const triangle: THREE.Vector2[] = [];
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = index ? index.getX(first + corner) : first + corner;
        const point = new THREE.Vector3().fromBufferAttribute(position, vertex)
          .applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
        const projected = new THREE.Vector2(point.x, point.y);
        bounds.expandByPoint(projected);
        triangle.push(projected);
      }
      triangles.push(triangle);
    }
  }
  const centre = bounds.getCenter(new THREE.Vector2());
  const extent = bounds.getSize(new THREE.Vector2());
  const scale = (size - 4) / Math.max(extent.x, extent.y);
  const mask = new Uint8Array(size * size);
  const edge = (a: THREE.Vector2, b: THREE.Vector2, x: number, y: number): number => (
    (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x)
  );
  for (const triangle of triangles) {
    for (const point of triangle) point.sub(centre).multiplyScalar(scale).addScalar(size / 2);
    const [a, b, c] = triangle as [THREE.Vector2, THREE.Vector2, THREE.Vector2];
    if (Math.abs(edge(a, b, c.x, c.y)) < 1e-8) continue;
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const edges = [edge(a, b, x + 0.5, y + 0.5), edge(b, c, x + 0.5, y + 0.5), edge(c, a, x + 0.5, y + 0.5)];
        if (edges.every(value => value >= 0) || edges.every(value => value <= 0)) mask[y * size + x] = 1;
      }
    }
  }
  return mask;
}

describe("animal drop icon geometry", () => {
  it.each(VARIANT_CASES)("builds finite owned geometry for %s variant %i", (primitive, variant) => {
    const object = buildItemIconPrimitive({
      kind: "primitive", primitive, variant, colour: 0x876f4b, accent: 0xc9b68d,
    });
    const builtMeshes = meshes(object);
    expect(builtMeshes.length).toBeGreaterThan(0);
    for (const mesh of builtMeshes) {
      expect(mesh.geometry.userData["itemIconOwned"]).toBe(true);
      const position = mesh.geometry.getAttribute("position");
      expect(position.count).toBeGreaterThan(2);
      for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
        expect(Array.from(attribute.array).every(Number.isFinite), name).toBe(true);
      }
      if (mesh.geometry.index) {
        expect(Array.from(mesh.geometry.index.array).every(index => index >= 0 && index < position.count)).toBe(true);
      }
    }
    const bounds = new THREE.Box3().setFromObject(object);
    expect(bounds.isEmpty()).toBe(false);
    expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
  });

  it.each(DROP_SHAPES)("builds finite owned geometry and a repeatable silhouette for %s", shape => {
    const first = drop(shape);
    const second = drop(shape);
    const firstMeshes = meshes(first);
    const secondGeometries = new Set(meshes(second).map(mesh => mesh.geometry));

    expect(firstMeshes.length).toBeGreaterThan(0);
    for (const mesh of firstMeshes) {
      expect(mesh.geometry.userData["itemIconOwned"], shape).toBe(true);
      expect(secondGeometries.has(mesh.geometry), shape).toBe(false);
      const position = mesh.geometry.getAttribute("position");
      expect(position.count).toBeGreaterThan(2);
      for (const attribute of Object.values(mesh.geometry.attributes)) {
        expect(Array.from(attribute.array).every(Number.isFinite), `${shape}: ${attribute.name}`).toBe(true);
      }
      if (mesh.geometry.index) {
        expect(Array.from(mesh.geometry.index.array).every(index => index >= 0 && index < position.count)).toBe(true);
      }
    }
    const bounds = new THREE.Box3().setFromObject(first);
    expect(bounds.isEmpty()).toBe(false);
    expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
    const firstMask = silhouette(first);
    expect(firstMask.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(24);
    expect(silhouette(second)).toEqual(firstMask);
  });

  it("gives each new drop family a distinct filled silhouette at the same normalized scale", () => {
    const masks = DROP_SHAPES.map(shape => ({ shape, mask: silhouette(drop(shape)) }));
    for (let first = 0; first < masks.length; first += 1) {
      for (let second = first + 1; second < masks.length; second += 1) {
        const a = masks[first]!;
        const b = masks[second]!;
        let difference = 0;
        let union = 0;
        for (let pixel = 0; pixel < a.mask.length; pixel += 1) {
          if (a.mask[pixel] !== b.mask[pixel]) difference += 1;
          if (a.mask[pixel] || b.mask[pixel]) union += 1;
        }
        expect(difference / union, `${a.shape} vs ${b.shape}`).toBeGreaterThan(0.05);
      }
    }
  });
});
