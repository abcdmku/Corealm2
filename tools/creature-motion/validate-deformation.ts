import type { Document } from "@gltf-transform/core";
import { Box3, Matrix4, Vector3 } from "three";

/** CPU counterpart of glTF skinning, used to detect broken bindings without a game/browser run. */
export function deformedBounds(doc: Document): { min: number[]; max: number[] } {
  const box = new Box3();
  const source = new Vector3(), transformed = new Vector3(), result = new Vector3();
  const coordinates: number[] = [], indices: number[] = [], weights: number[] = [], bind: number[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const skin = node.getSkin();
    const world = new Matrix4().fromArray(node.getWorldMatrix());
    const jointMatrices = skin?.listJoints().map((joint, i) => {
      skin.getInverseBindMatrices()!.getElement(i, bind);
      return new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(bind));
    });
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION")!;
      const jointIndices = primitive.getAttribute("JOINTS_0");
      const jointWeights = primitive.getAttribute("WEIGHTS_0");
      for (let i = 0; i < positions.getCount(); i++) {
        positions.getElement(i, coordinates); source.fromArray(coordinates);
        if (jointMatrices && jointIndices && jointWeights) {
          jointIndices.getElement(i, indices); jointWeights.getElement(i, weights);
          result.set(0, 0, 0);
          for (let j = 0; j < weights.length; j++) {
            if (!weights[j]) continue;
            const matrix = jointMatrices[indices[j]!];
            if (!matrix) throw new Error(`Invalid skin index ${indices[j]}`);
            transformed.copy(source).applyMatrix4(matrix).multiplyScalar(weights[j]!);
            result.add(transformed);
          }
        } else result.copy(source).applyMatrix4(world);
        if (![result.x, result.y, result.z].every(Number.isFinite)) throw new Error("Nonfinite skinned vertex");
        box.expandByPoint(result);
      }
    }
  }
  if (box.isEmpty()) throw new Error("Creature has no vertices");
  return { min: box.min.toArray(), max: box.max.toArray() };
}
