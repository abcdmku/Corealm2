import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { NodeIO, type Document, type Mesh as GltfMesh, type Node as GltfNode, type Primitive } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, Object3D, PropertyBinding } from "three";
import type { AssetEntry, AssetManifest } from "../../render/assets.js";
import { mergeManifestEntries } from "../../render/manifestOverlay.js";
import type { WorldBakeAssets } from "./nodeWorldBake.js";

/** Where model files come from: a directory holding `manifest.json`, or an asset host. */
export interface BakeAssetSource {
  manifest(): Promise<AssetManifest>;
  /** A model file named by a manifest entry (`models/...glb`). */
  read(file: string): Promise<Uint8Array>;
}

export function directoryAssetSource(directory: string): BakeAssetSource {
  const root = resolve(directory);
  const inside = (file: string) => {
    const path = resolve(root, file), local = relative(root, path);
    if (local.startsWith("..") || isAbsolute(local)) throw new Error(`Asset file escapes its directory: ${file}`);
    return path;
  };
  return {
    manifest: async () => JSON.parse(await readFile(inside("manifest.json"), "utf8")) as AssetManifest,
    read: async file => new Uint8Array(await readFile(inside(file))),
  };
}

/** An asset host (`<base>/manifest.json`, `<base>/models/...`), with a server's model files at `overlayBase` when it has any. */
export function urlAssetSource(base: string, overlayBase?: string, fetcher: typeof fetch = fetch): BakeAssetSource {
  const get = async (url: URL) => {
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`Asset request failed: ${url.href} HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const root = new URL(base.endsWith("/") ? base : `${base}/`);
  return {
    manifest: async () => JSON.parse(new TextDecoder().decode(await get(new URL("manifest.json", root)))) as AssetManifest,
    read: async file => {
      if (overlayBase) {
        const overlay = new URL(file, overlayBase.endsWith("/") ? overlayBase : `${overlayBase}/`);
        const response = await fetcher(overlay);
        if (response.ok) return new Uint8Array(await response.arrayBuffer());
      }
      return get(new URL(file, root));
    },
  };
}

/**
 * A GLB for its geometry. The release tree's models name their textures as separate files
 * (`../../textures/imported/<sha>.png`), which `readBinary` refuses to resolve; the bake never reads a
 * texture, so each external image gets an empty placeholder and embedded ones are kept as they are.
 */
export async function readGeometryGlb(io: NodeIO, bytes: Uint8Array): Promise<Document> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB file");
  let offset = 12, json: Record<string, unknown> | null = null, bin: Uint8Array | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true), chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)) as Record<string, unknown>;
    else if (type === 0x004e4942) bin = chunk;
    offset += 8 + length;
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  const images = Array.isArray(json.images) ? json.images as { uri?: string }[] : [];
  const external = images.flatMap(image => typeof image.uri === "string" && !image.uri.startsWith("data:") ? [image.uri] : []);
  if (!external.length) return io.readBinary(bytes);
  const resources: Record<string, Uint8Array<ArrayBuffer>> = Object.fromEntries(external.map(uri => [uri, new Uint8Array(0)]));
  if (bin) resources["@glb.bin"] = new Uint8Array(bin);
  return io.readJSON({ json: json as never, resources });
}

/**
 * The bake's asset library: the host manifest with a server's model overlay merged over it by id, as
 * every registry in a page merges it, and GLB triangles without textures, DOM or WebGL.
 * Measurements come from the manifest, never from the triangles, exactly as `AssetRegistry` answers them.
 */
export class BakeGeometryAssets implements WorldBakeAssets {
  private readonly loaded = new Map<string, Promise<Group>>();
  private readonly ready = new Map<string, Group>();
  private readonly byId: Map<string, AssetEntry>;
  private constructor(private readonly source: BakeAssetSource, private readonly manifest: AssetManifest) {
    this.byId = new Map(manifest.assets.map(entry => [entry.id, entry]));
  }
  static async open(source: BakeAssetSource, overlay: readonly AssetEntry[] = []): Promise<BakeGeometryAssets> {
    const host = await source.manifest();
    return new BakeGeometryAssets(source, overlay.length ? { ...host, assets: mergeManifestEntries(host.assets, overlay) } : host);
  }
  entry(id: string): AssetEntry | undefined { return this.byId.get(id); }
  getManifest(): AssetManifest { return this.manifest; }
  /** Case-insensitive, as `AssetRegistry.byTags`. */
  byTags(...tags: string[]): AssetEntry[] {
    const wanted = tags.map(tag => tag.toLowerCase());
    return this.manifest.assets.filter(asset => { const owned = asset.tags.map(tag => tag.toLowerCase()); return wanted.every(tag => owned.includes(tag)); });
  }
  // AssetRegistry's measurements. Written out rather than imported: this module loads no content, so a
  // baker can open its assets before it installs the catalog it bakes.
  baseY(id: string): number { const entry = this.byId.get(id); return entry?.groundY ?? entry?.base?.y ?? 0; }
  assetSize(id: string): { x: number; y: number; z: number } | null { return this.byId.get(id)?.size ?? null; }
  assetCenterXZ(id: string): { x: number; z: number } | null {
    const entry = this.byId.get(id);
    return entry ? { x: (entry.base?.x ?? -entry.size.x / 2) + entry.size.x / 2, z: (entry.base?.z ?? -entry.size.z / 2) + entry.size.z / 2 } : null;
  }
  async loadMany(ids: readonly string[]): Promise<void> { await Promise.all(ids.map(id => this.load(id))); }
  load(id: string): Promise<Group> {
    let pending = this.loaded.get(id);
    if (!pending) { pending = this.read(id); this.loaded.set(id, pending); }
    return pending;
  }
  instance(id: string): Group {
    const root = this.ready.get(id);
    if (!root) throw new Error(`Geometry asset not loaded: ${id}`);
    return root.clone(true);
  }
  private async read(id: string): Promise<Group> {
    const entry = this.byId.get(id);
    if (!entry) throw new Error(`Unknown geometry asset: ${id}`);
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const root = gltfScene(await readGeometryGlb(io, await this.source.read(entry.file)));
    root.name = id;
    this.ready.set(id, root);
    return root;
  }
}

/**
 * The default scene as three's GLTFLoader builds it, without materials' textures: the node hierarchy
 * with each node's own transform, one Mesh per primitive (a Group when a mesh has several), vertex
 * channels in their stored type and normalization, and GLTFLoader's names. Navigation fingerprints hash
 * mesh names and transformed positions, so the client's navmesh artifact depends on all of them.
 */
function gltfScene(document: Document): Group {
  const root = document.getRoot(), scene = root.getDefaultScene() ?? root.listScenes()[0];
  const meshIndex = new Map(root.listMeshes().map((mesh, index) => [mesh, index]));
  // GLTFLoader.createUniqueName: sanitized, and suffixed _1, _2 when taken. The scene's name and then every node's
  // name are reserved before any mesh resolves its geometry.
  const used = new Map<string, number>();
  const unique = (name: string) => {
    const clean = PropertyBinding.sanitizeNodeName(name);
    const count = used.get(clean);
    if (count === undefined) { used.set(clean, 0); return clean; }
    used.set(clean, count + 1);
    return `${clean}_${count + 1}`;
  };
  const group = new Group();
  if (scene?.getName()) group.name = unique(scene.getName());
  const order: GltfNode[] = [];
  const visit = (node: GltfNode) => { order.push(node); for (const child of node.listChildren()) visit(child); };
  for (const node of scene?.listChildren() ?? []) visit(node);
  const nodeNames = new Map(order.map(node => [node, node.getName() ? unique(node.getName()) : ""]));
  const meshes = new Map<GltfMesh, Object3D>(), uses = new Map<GltfMesh, number>();
  const meshObject = (mesh: GltfMesh): Object3D => {
    const built = mesh.listPrimitives().map(primitive => {
      const object = new Mesh(primitiveGeometry(primitive), new MeshStandardMaterial({ name: primitive.getMaterial()?.getName() ?? "" }));
      object.name = unique(mesh.getName() || `mesh_${meshIndex.get(mesh)}`);
      return object;
    });
    if (built.length === 1) return built[0]!;
    const holder = new Group(); holder.add(...built); return holder;
  };
  const build = (node: GltfNode): Object3D => {
    const mesh = node.getMesh();
    let object: Object3D;
    if (mesh) {
      // A mesh several nodes share is built once; later nodes take a clone, as GLTFLoader's reference cache does.
      const first = meshes.get(mesh);
      if (!first) { object = meshObject(mesh); meshes.set(mesh, object); uses.set(mesh, 0); }
      else { object = first.clone(); const use = uses.get(mesh)! + 1; uses.set(mesh, use); object.name += `_instance_${use}`; }
    } else object = new Object3D();
    if (node.getName()) object.name = nodeNames.get(node)!;
    object.position.fromArray(node.getTranslation());
    object.quaternion.fromArray(node.getRotation());
    object.scale.fromArray(node.getScale());
    for (const child of node.listChildren()) object.add(build(child));
    return object;
  };
  for (const node of scene?.listChildren() ?? []) group.add(build(node));
  return group;
}

/** glTF accessors are never half floats, the one array type three's attributes do not take. */
type AttributeArray = ConstructorParameters<typeof BufferAttribute>[0];

function primitiveGeometry(primitive: Primitive): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const [semantic, name] of [["POSITION", "position"], ["NORMAL", "normal"], ["COLOR_0", "color"], ["TEXCOORD_0", "uv"]] as const) {
    const accessor = primitive.getAttribute(semantic), array = accessor?.getArray();
    if (accessor && array) geometry.setAttribute(name, new BufferAttribute(array as AttributeArray, accessor.getElementSize(), accessor.getNormalized()));
  }
  const indices = primitive.getIndices()?.getArray();
  if (indices) geometry.setIndex(new BufferAttribute(indices as AttributeArray, 1));
  return geometry;
}
