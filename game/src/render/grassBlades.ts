import { BufferGeometry, Matrix4, Mesh, Object3D, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Bakes the production grass model into one instance geometry. XZ share a scale
 * so the wider native footprint becomes one metre; Y becomes one metre high.
 * Authored UVs, normals and leaf colours survive. The cached source is untouched.
 */
export function createGrassBladeGeometry(source: Object3D): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const visit = (node: Object3D, parent: Matrix4): void => {
    const local = node.matrixAutoUpdate
      ? new Matrix4().compose(node.position, node.quaternion, node.scale)
      : node.matrix.clone();
    const transform = new Matrix4().multiplyMatrices(parent, local);
    const mesh = node as Mesh;
    if (mesh.isMesh) {
      const part = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      part.applyMatrix4(transform);
      if (!part.getAttribute("normal")) part.computeVertexNormals();
      // A mirrored node normally changes renderer face winding. After baking it
      // into vertices, carry that winding change into every retained attribute.
      if (transform.determinant() < 0) {
        for (const attribute of Object.values(part.attributes)) {
          for (let triangle = 0; triangle < attribute.count; triangle += 3) {
            for (let component = 0; component < attribute.itemSize; component++) {
              const value = attribute.getComponent(triangle + 1, component);
              attribute.setComponent(triangle + 1, component, attribute.getComponent(triangle + 2, component));
              attribute.setComponent(triangle + 2, component, value);
            }
          }
        }
      }
      parts.push(part);
    }
    for (const child of node.children) visit(child, transform);
  };
  try {
    visit(source, new Matrix4());
    if (parts.length === 0) throw new Error("Grass model contains no mesh geometry");
    const merged = mergeGeometries(parts, false);
    if (!merged) throw new Error("Grass model attributes cannot be merged");
    merged.computeBoundingBox();
    const bounds = merged.boundingBox!;
    const dimensions = bounds.getSize(new Vector3());
    const width = Math.max(dimensions.x, dimensions.z);
    if (!Number.isFinite(width) || !Number.isFinite(dimensions.y) || width <= 0 || dimensions.y <= 0) {
      merged.dispose();
      throw new Error("Grass model must have a finite width and height");
    }
    const centre = bounds.getCenter(new Vector3());
    merged.translate(-centre.x, -bounds.min.y, -centre.z);
    // BufferGeometry.scale applies the inverse-transpose to authored normals.
    merged.scale(1 / width, 1 / dimensions.y, 1 / width);
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    merged.name = "corealm-grass-blades-unit";
    return merged;
  } finally {
    for (const part of parts) part.dispose();
  }
}
