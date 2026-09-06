import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { clipGeometryBelow } from "../game/src/render/entityViews.js";

describe("depleted geometry from normalized GLTF attributes", () => {
  it.each([false, true])("bakes metre-space positions before centroid clipping (indexed=%s)", indexed => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Int16Array([
      -32767, -32767, 0, 32767, -32767, 0, 0, 0, 32767,
      -32767, 32767, 0, 32767, 32767, 0, 0, 16384, 32767,
    ]);
    const normals = new Int16Array(Array.from({ length: 6 }, () => [18918, 18918, 18918]).flat());
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3, true));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3, true));
    if (indexed) geometry.setIndex([0, 1, 2, 3, 4, 5]);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(-1.338534, 9.273127, -0.939424),
      new THREE.Quaternion(), new THREE.Vector3(9.474602, 9.474602, 4.737301),
    );
    const beforePositions = positions.slice(), beforeNormals = normals.slice();
    const output = clipGeometryBelow(geometry, matrix, 4.34676)!;
    expect(output).not.toBeNull();
    const actual = output.getAttribute("position");
    expect(actual.count).toBe(3);
    expect(actual.array).toBeInstanceOf(Float32Array);
    expect(actual.normalized).toBe(false);
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const expected = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute("position"), vertex).applyMatrix4(matrix);
      expect(new THREE.Vector3().fromBufferAttribute(actual, vertex).distanceTo(expected)).toBeLessThan(0.000002);
      const normal = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute("normal"), vertex)
        .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix));
      expect(new THREE.Vector3().fromBufferAttribute(output.getAttribute("normal"), vertex).distanceTo(normal)).toBeLessThan(0.000001);
    }
    expect(positions).toEqual(beforePositions);
    expect(normals).toEqual(beforeNormals);
    expect(clipGeometryBelow(geometry, matrix, -100)).toBeNull();
    output.dispose(); geometry.dispose();
  });
});
