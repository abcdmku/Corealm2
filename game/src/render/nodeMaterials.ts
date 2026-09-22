import {
  Material,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
} from "three";
import {
  MaterialNode,
  MaterialReferenceNode,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
} from "three/webgpu";
import {
  positionLocal,
  vec3,
  vec4,
} from "three/tsl";

export type SurfaceNodeMaterial = MeshBasicNodeMaterial | MeshStandardNodeMaterial | MeshPhysicalNodeMaterial;

export interface SurfaceNodes {
  color: Node<"vec3">;
  opacity: Node<"float">;
  normal: Node<"vec3">;
  roughness: Node<"float">;
  metalness: Node<"float">;
  emissive: Node<"vec3">;
  position: Node<"vec3">;
}

export type SurfaceTransforms = {
  [Channel in keyof SurfaceNodes]?: (previous: SurfaceNodes[Channel]) => SurfaceNodes[Channel];
};

// These are the only constructor forms used here. Three's full TSL overloads
// recursively compare every node extension for dynamic material input types.
const rgbNode = vec3 as unknown as (value: Node) => Node<"vec3">;
const rgbaNode = vec4 as unknown as {
  (value: Node): Node<"vec4">;
  (value: Node<"vec3">, alpha: Node<"float">): Node<"vec4">;
};

const converted = new WeakMap<Material, SurfaceNodeMaterial>();

function isSurfaceNodeMaterial(material: Material): material is SurfaceNodeMaterial {
  return (material as MeshBasicNodeMaterial).isMeshBasicNodeMaterial === true
    || (material as MeshStandardNodeMaterial).isMeshStandardNodeMaterial === true
    || (material as MeshPhysicalNodeMaterial).isMeshPhysicalNodeMaterial === true;
}

// Three's material copy serializes userData. Shader nodes and uniforms are live
// objects, so keep them out of that serialization and retain their references.
function copySource<T extends Material>(source: T): T {
  return Object.assign(Object.create(source) as T, { userData: {} });
}

/** Convert ordinary imported materials once. Custom GLSL must be ported explicitly. */
export function ensureNodeMaterial(source: Material): SurfaceNodeMaterial {
  if (isSurfaceNodeMaterial(source)) return source;
  if (source.onBeforeCompile !== Material.prototype.onBeforeCompile) {
    throw new Error(`Material ${source.name || source.type} has an unported onBeforeCompile shader.`);
  }
  const cached = converted.get(source);
  if (cached) return cached;

  let material: SurfaceNodeMaterial;
  const properties = copySource(source);
  // Physical also advertises Standard. Check it first to preserve transmission,
  // clearcoat, sheen and the other physical material properties.
  if ((source as MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    material = new MeshPhysicalNodeMaterial();
    MeshPhysicalMaterial.prototype.copy.call(material as unknown as MeshPhysicalMaterial, properties as MeshPhysicalMaterial);
  } else if ((source as MeshStandardMaterial).isMeshStandardMaterial) {
    material = new MeshStandardNodeMaterial();
    MeshStandardMaterial.prototype.copy.call(material as unknown as MeshStandardMaterial, properties as MeshStandardMaterial);
  } else if ((source as MeshBasicMaterial).isMeshBasicMaterial) {
    material = new MeshBasicNodeMaterial();
    MeshBasicMaterial.prototype.copy.call(material as unknown as MeshBasicMaterial, properties as MeshBasicMaterial);
  } else {
    throw new Error(`Material ${source.name || source.type} requires an explicit node material port.`);
  }
  material.userData = { ...source.userData };
  converted.set(source, material);
  return material;
}

/** Give a mesh its own material properties while sharing textures and node graphs. */
export function cloneNodeMaterial(source: Material): SurfaceNodeMaterial {
  const nodes = ensureNodeMaterial(source);
  // Match Material.clone's constructor behavior so specialized node materials
  // retain their lighting model and render hooks.
  const Type = nodes.constructor as new () => SurfaceNodeMaterial;
  const clone = new Type();
  // NodeMaterial.copy skips private fields and only visits setters on the
  // immediate prototype. Preserve inherited accessors, including on subclasses.
  clone.alphaTest = nodes.alphaTest;
  if ((nodes as MeshPhysicalNodeMaterial).isMeshPhysicalNodeMaterial) {
    const physical = nodes as MeshPhysicalNodeMaterial;
    const physicalClone = clone as MeshPhysicalNodeMaterial;
    physicalClone.anisotropy = physical.anisotropy;
    physicalClone.clearcoat = physical.clearcoat;
    physicalClone.iridescence = physical.iridescence;
    physicalClone.dispersion = physical.dispersion;
    physicalClone.sheen = physical.sheen;
    physicalClone.transmission = physical.transmission;
  }
  // NodeMaterial.copy is safe here: the source is a fully initialized node
  // material and the new destination has no graph that copy could mutate.
  clone.copy(copySource(nodes));
  clone.userData = { ...nodes.userData, ...clone.userData };
  return clone;
}

type MaterialScope = ConstructorParameters<typeof MaterialNode>[0];
type SourceState = { material?: Material | null; renderer?: { _currentSourceMaterial?: Material | null } };

function sourceMaterial(state: SourceState, owner: SurfaceNodeMaterial): Material {
  // Three retains the exact source during override draws, including multi-material meshes.
  // A shadow's bare NodeMaterial does not own the surface colour, maps or opacity.
  const source = state.renderer?._currentSourceMaterial;
  if (source) return source;
  const material = state.material as (Material & { isShadowPassMaterial?: boolean }) | null | undefined;
  return material && !material.isShadowPassMaterial ? material : owner;
}

const sourceReferences = new WeakMap<SurfaceNodeMaterial, Map<string, MaterialReferenceNode>>();

/** Read a raw surface property without applying maps or another material transform. */
export function sourceMaterialReference<TNodeType>(
  material: SurfaceNodeMaterial, property: string, type: string,
): Node<TNodeType> {
  let references = sourceReferences.get(material);
  if (!references) { references = new Map(); sourceReferences.set(material, references); }
  const key = `${property}:${type}`;
  let reference = references.get(key);
  if (!reference) {
    reference = new MaterialReferenceNode(property, type, material).onReference(function(state) {
      this.reference = sourceMaterial(state as unknown as SourceState, material);
      return this.reference;
    });
    references.set(key, reference);
  }
  return reference as unknown as Node<TNodeType>;
}

const sourceNodes = new WeakMap<SurfaceNodeMaterial, Map<MaterialScope, Node>>();

/** Material properties that remain attached to the drawn surface through native shadow overrides.
 * References stay draw-specific so clones can share a graph while changing colour/map/opacity. */
export function sourceMaterialNode<TNodeType>(material: SurfaceNodeMaterial, scope: MaterialScope): Node<TNodeType> {
  let nodes = sourceNodes.get(material);
  if (!nodes) { nodes = new Map(); sourceNodes.set(material, nodes); }
  const cached = nodes.get(scope);
  if (cached) return cached as Node<TNodeType>;
  const node = new MaterialNode<TNodeType>(scope) as MaterialNode<TNodeType> & {
    getCache(property: string, type: string): MaterialReferenceNode;
  };
  node.getCache = (property, type) => sourceMaterialReference(material, property, type) as unknown as MaterialReferenceNode;
  const setup = node.setup;
  node.setup = function(builder) {
    const context = builder.context as { material?: Material };
    const previous = context.material;
    context.material = sourceMaterial(builder as unknown as SourceState, material);
    try { return setup.call(this, builder); }
    finally { context.material = previous; }
  };
  nodes.set(scope, node);
  return node;
}

/** Includes texture alpha, which the shadow pipeline also samples for cutout surfaces. */
export function surfaceColorNode(material: SurfaceNodeMaterial): Node<"vec4"> {
  return rgbaNode(material.colorNode ?? sourceMaterialNode<"vec4">(material, MaterialNode.COLOR));
}

/** Snapshot the current graph inputs before adding another material effect. */
export function surfaceNodes(material: SurfaceNodeMaterial): SurfaceNodes {
  const lit = material as MeshStandardNodeMaterial;
  return {
    color: rgbNode(surfaceColorNode(material)),
    opacity: (material.opacityNode ?? sourceMaterialNode<"float">(material, MaterialNode.OPACITY)) as Node<"float">,
    normal: (material.normalNode ?? sourceMaterialNode<"vec3">(material, MaterialNode.NORMAL)) as Node<"vec3">,
    roughness: (lit.roughnessNode ?? sourceMaterialNode<"float">(material, MaterialNode.ROUGHNESS)) as Node<"float">,
    metalness: (lit.metalnessNode ?? sourceMaterialNode<"float">(material, MaterialNode.METALNESS)) as Node<"float">,
    emissive: (lit.emissiveNode ?? sourceMaterialNode<"vec3">(material, MaterialNode.EMISSIVE)) as Node<"vec3">,
    position: (material.positionNode ?? positionLocal) as Node<"vec3">,
  };
}

export function composeSurface<T extends SurfaceNodeMaterial>(material: T, transforms: SurfaceTransforms): T {
  const previous = surfaceNodes(material);
  const previousAlpha = surfaceColorNode(material).a;
  const lit = material as MeshStandardNodeMaterial;
  if (transforms.color) material.colorNode = rgbaNode(transforms.color(previous.color), previousAlpha);
  if (transforms.opacity) material.opacityNode = transforms.opacity(previous.opacity);
  if (transforms.normal) material.normalNode = transforms.normal(previous.normal);
  if (transforms.roughness) lit.roughnessNode = transforms.roughness(previous.roughness);
  if (transforms.metalness) lit.metalnessNode = transforms.metalness(previous.metalness);
  if (transforms.emissive) lit.emissiveNode = transforms.emissive(previous.emissive);
  if (transforms.position) material.positionNode = transforms.position(previous.position);
  material.needsUpdate = true;
  return material;
}
