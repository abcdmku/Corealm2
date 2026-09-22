import {
  Material,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
} from "three";
import {
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
} from "three/webgpu";
import {
  materialColor,
  materialEmissive,
  materialMetalness,
  materialNormal,
  materialOpacity,
  materialRoughness,
  positionLocal,
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
    MeshPhysicalMaterial.prototype.copy.call(material, properties as MeshPhysicalMaterial);
  } else if ((source as MeshStandardMaterial).isMeshStandardMaterial) {
    material = new MeshStandardNodeMaterial();
    MeshStandardMaterial.prototype.copy.call(material, properties as MeshStandardMaterial);
  } else if ((source as MeshBasicMaterial).isMeshBasicMaterial) {
    material = new MeshBasicNodeMaterial();
    MeshBasicMaterial.prototype.copy.call(material, properties as MeshBasicMaterial);
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
  const clone = (nodes as MeshPhysicalNodeMaterial).isMeshPhysicalNodeMaterial
    ? new MeshPhysicalNodeMaterial()
    : (nodes as MeshStandardNodeMaterial).isMeshStandardNodeMaterial
      ? new MeshStandardNodeMaterial()
      : new MeshBasicNodeMaterial();
  // NodeMaterial.copy is safe here: the source is a fully initialized node
  // material and the new destination has no graph that copy could mutate.
  clone.copy(copySource(nodes));
  clone.userData = { ...nodes.userData };
  return clone;
}

/** Snapshot the current graph inputs before adding another material effect. */
export function surfaceNodes(material: SurfaceNodeMaterial): SurfaceNodes {
  const lit = material as MeshStandardNodeMaterial;
  return {
    color: (material.colorNode ?? materialColor) as Node<"vec3">,
    opacity: (material.opacityNode ?? materialOpacity) as Node<"float">,
    normal: (material.normalNode ?? materialNormal) as Node<"vec3">,
    roughness: (lit.roughnessNode ?? materialRoughness) as Node<"float">,
    metalness: (lit.metalnessNode ?? materialMetalness) as Node<"float">,
    emissive: (lit.emissiveNode ?? materialEmissive) as Node<"vec3">,
    position: (material.positionNode ?? positionLocal) as Node<"vec3">,
  };
}

export function composeSurface<T extends SurfaceNodeMaterial>(material: T, transforms: SurfaceTransforms): T {
  const previous = surfaceNodes(material);
  const lit = material as MeshStandardNodeMaterial;
  if (transforms.color) material.colorNode = transforms.color(previous.color);
  if (transforms.opacity) material.opacityNode = transforms.opacity(previous.opacity);
  if (transforms.normal) material.normalNode = transforms.normal(previous.normal);
  if (transforms.roughness) lit.roughnessNode = transforms.roughness(previous.roughness);
  if (transforms.metalness) lit.metalnessNode = transforms.metalness(previous.metalness);
  if (transforms.emissive) lit.emissiveNode = transforms.emissive(previous.emissive);
  if (transforms.position) material.positionNode = transforms.position(previous.position);
  material.needsUpdate = true;
  return material;
}
