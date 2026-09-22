import { InstancedInterleavedBuffer, type InstancedBufferAttribute, type InstancedMesh, type BatchedMesh, type Texture, Matrix4 } from 'three';
import { Fn, drawIndex, float, instanceIndex, instancedBufferAttribute, int, ivec2, mat4,
  modelWorldMatrix, textureLoad, textureSize, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';

const matrixBuffers = new WeakMap<InstancedBufferAttribute, InstancedInterleavedBuffer>();

/** The same instance or indirect batch transform that precedes a node material's positionNode. */
export const objectInstanceMatrix = Fn((builder) => {
  const object = builder.object;
  if ((object as InstancedMesh).isInstancedMesh) {
    const source = (object as InstancedMesh).instanceMatrix;
    let buffer = matrixBuffers.get(source);
    if (!buffer) {
      buffer = new InstancedInterleavedBuffer(source.array, 16, 1);
      buffer.setUsage(source.usage);
      matrixBuffers.set(source, buffer);
    }
    const shared = buffer;
    const syncMatrix = () => {
      if (shared.version !== source.version) {
        shared.clearUpdateRanges();
        for (const range of source.updateRanges) shared.addUpdateRange(range.start, range.count);
        shared.version = source.version;
      }
    };
    return mat4(
      instancedBufferAttribute(shared, 'vec4', 16, 0),
      instancedBufferAttribute(shared, 'vec4', 16, 4),
      instancedBufferAttribute(shared, 'vec4', 16, 8),
      instancedBufferAttribute(shared, 'vec4', 16, 12),
    ).onFrameUpdate(syncMatrix);
  }
  if ((object as BatchedMesh).isBatchedMesh) {
    const batch = object as BatchedMesh & { _indirectTexture: Texture; _matricesTexture: Texture };
    const index = int((builder as typeof builder & { getDrawIndex(): string | null }).getDrawIndex() === null ? instanceIndex : drawIndex);
    // TextureSizeNode is untyped upstream; its r185 constructor fixes nodeType to uvec2.
    const indirectSize = int((textureSize(textureLoad(batch._indirectTexture), int(0)) as unknown as Node<'uvec2'>).x);
    const indirect = textureLoad(batch._indirectTexture, ivec2(index.mod(indirectSize), index.div(indirectSize))).x;
    const size = int((textureSize(textureLoad(batch._matricesTexture), int(0)) as unknown as Node<'uvec2'>).x);
    const first = float(indirect).mul(4).toInt();
    const x = first.mod(size), y = first.div(size);
    return mat4(
      textureLoad(batch._matricesTexture, ivec2(x, y)),
      textureLoad(batch._matricesTexture, ivec2(x.add(1), y)),
      textureLoad(batch._matricesTexture, ivec2(x.add(2), y)),
      textureLoad(batch._matricesTexture, ivec2(x.add(3), y)),
    );
  }
  return mat4(new Matrix4());
}).once();

export const objectInstanceWorldOrigin = Fn(() =>
  modelWorldMatrix.mul(objectInstanceMatrix().mul(vec4(0, 0, 0, 1))).xyz);
