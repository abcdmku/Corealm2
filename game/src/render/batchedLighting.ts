import * as THREE from "three";
import { Lighting, LightsNode, Node, NodeUtils, type RectAreaLightNode, type NodeBuilder } from "three/webgpu";
import { RectAreaLightTexturesLib } from "three/addons/lights/RectAreaLightTexturesLib.js";
import {
  Loop, NodeUpdateType, getDistanceAttenuation, int, mix, normalWorld, positionView, renderGroup, texture, uniform, uniformArray, vec3,
} from "three/tsl";

/** The scene keeps fixed pools: spell, fairy, dungeon and wilderness point lights plus the
 * lava bank strips. Three unrolls every light into every lit fragment shader, which made
 * each one ~95 KB of WGSL and ~400 ms of driver compilation. Looping over one uniform array
 * keeps the same lighting math while the shader size no longer grows with the pools. */
export const MAX_BATCHED_POINT_LIGHTS = 24;
export const MAX_BATCHED_AREA_LIGHTS = 4;
export const MAX_BATCHED_HEMISPHERE_LIGHTS = 2;

// Every kind shares one vec4 array, so batching costs a single uniform-buffer binding; a
// separate array per attribute pushed rich materials past WebGPU's twelve per stage.
const POINT_STRIDE = 2, AREA_STRIDE = 4, HEMISPHERE_STRIDE = 3;
const POINT_BASE = 0;
const AREA_BASE = POINT_BASE + MAX_BATCHED_POINT_LIGHTS * POINT_STRIDE;
const HEMISPHERE_BASE = AREA_BASE + MAX_BATCHED_AREA_LIGHTS * AREA_STRIDE;
const LIGHT_VECTORS = HEMISPHERE_BASE + MAX_BATCHED_HEMISPHERE_LIGHTS * HEMISPHERE_STRIDE;

type LightContext = { lightingModel: LightingModel; reflectedLight: ReflectedLight; positionView?: typeof positionView; irradiance: NodeLike };
const lightContext = (builder: NodeBuilder) => builder.context as unknown as LightContext;
type ReflectedLight = { directDiffuse: NodeLike; directSpecular: NodeLike };
type NodeLike = { addAssign(value: unknown): void };
type LightingModel = {
  direct(input: object, builder: unknown): void;
  directRectArea?(input: object, builder: unknown): void;
};
type Frame = { camera: THREE.Camera | null };
// @types/three cannot express uniform-array element swizzles or a uniform loop bound.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TslNode = any;
const loop = Loop as unknown as (count: TslNode, body: (index: { i: TslNode }) => void) => void;

const position = new THREE.Vector3();
const world = new THREE.Matrix4();
const rotation = new THREE.Matrix4();
const colour = new THREE.Color();

/** One scene's packed light data. Each kind writes its own slice before the frame's draws. */
class LightData {
  readonly vectors = Array.from({ length: LIGHT_VECTORS }, () => new THREE.Vector4());
  readonly node: TslNode = uniformArray(this.vectors, "vec4").setGroup(renderGroup);
  /** Element `offset` of light `index` in a slice starting at `base`. */
  at(base: number, stride: number, index: TslNode, offset: number): TslNode {
    return this.node.element(int(base + offset).add(index.mul(stride)));
  }
}

abstract class LightArrayNode<T extends THREE.Light> extends Node {
  protected lights: T[] = [];
  readonly count = uniform(0, "int").setGroup(renderGroup);
  constructor(protected readonly data: LightData, readonly maxCount: number) {
    super();
    this.updateType = NodeUpdateType.RENDER;
  }
  setLights(lights: T[]): this {
    this.lights = lights;
    return this;
  }
}

class PointLightArrayNode extends LightArrayNode<THREE.PointLight> {
  override update({ camera }: Frame): undefined {
    if (!camera) return;
    let count = 0;
    for (const light of this.lights) {
      if (count === this.maxCount) break;
      if (light.intensity <= 0) continue;
      const slot = POINT_BASE + count * POINT_STRIDE;
      position.setFromMatrixPosition(light.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      this.data.vectors[slot]!.set(position.x, position.y, position.z, light.distance);
      colour.copy(light.color).multiplyScalar(light.intensity);
      this.data.vectors[slot + 1]!.set(colour.r, colour.g, colour.b, light.decay);
      count++;
    }
    this.count.value = count;
    return undefined;
  }

  override setup(builder: NodeBuilder): null {
    const { lightingModel, reflectedLight } = lightContext(builder);
    const surface = lightContext(builder).positionView ?? positionView;
    const diffuse = vec3(0).toVar("batchedPointDiffuse"), specular = vec3(0).toVar("batchedPointSpecular");
    loop(this.count, ({ i }) => {
      const placement = this.data.at(POINT_BASE, POINT_STRIDE, i, 0), emission = this.data.at(POINT_BASE, POINT_STRIDE, i, 1);
      const lightVector = placement.xyz.sub(surface).toVar();
      const attenuation = getDistanceAttenuation({ lightDistance: lightVector.length(), cutoffDistance: placement.w, decayExponent: emission.w });
      lightingModel.direct({
        lightDirection: lightVector.normalize(),
        lightColor: emission.xyz.mul(attenuation).toVar(),
        lightNode: { light: {}, shadowNode: null },
        reflectedLight: { directDiffuse: diffuse, directSpecular: specular },
      }, builder);
    });
    reflectedLight.directDiffuse.addAssign(diffuse);
    reflectedLight.directSpecular.addAssign(specular);
    return null;
  }
}

type LtcLibrary = Parameters<typeof RectAreaLightNode.setLTC>[0];
let ltcLibrary: LtcLibrary | undefined;

class AreaLightArrayNode extends LightArrayNode<THREE.RectAreaLight> {
  override update({ camera }: Frame): undefined {
    if (!camera) return;
    let count = 0;
    for (const light of this.lights) {
      if (count === this.maxCount) break;
      if (light.intensity <= 0) continue;
      const slot = AREA_BASE + count * AREA_STRIDE, vectors = this.data.vectors;
      colour.copy(light.color).multiplyScalar(light.intensity);
      vectors[slot]!.set(colour.r, colour.g, colour.b, 0);
      position.setFromMatrixPosition(light.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      vectors[slot + 1]!.set(position.x, position.y, position.z, 0);
      world.copy(light.matrixWorld).premultiply(camera.matrixWorldInverse);
      rotation.extractRotation(world);
      position.set(light.width * .5, 0, 0).applyMatrix4(rotation);
      vectors[slot + 2]!.set(position.x, position.y, position.z, 0);
      position.set(0, light.height * .5, 0).applyMatrix4(rotation);
      vectors[slot + 3]!.set(position.x, position.y, position.z, 0);
      count++;
    }
    this.count.value = count;
    return undefined;
  }

  override setup(builder: NodeBuilder): null {
    const { lightingModel, reflectedLight } = lightContext(builder);
    if (!lightingModel.directRectArea) return null;
    const ltc = ltcLibrary ??= RectAreaLightTexturesLib.init() as unknown as LtcLibrary;
    const float = (builder as unknown as { isAvailable(name: string): boolean }).isAvailable("float32Filterable");
    const ltc1 = texture(float ? ltc.LTC_FLOAT_1 : ltc.LTC_HALF_1), ltc2 = texture(float ? ltc.LTC_FLOAT_2 : ltc.LTC_HALF_2);
    const diffuse = vec3(0).toVar("batchedAreaDiffuse"), specular = vec3(0).toVar("batchedAreaSpecular");
    loop(this.count, ({ i }) => {
      lightingModel.directRectArea!({
        lightColor: this.data.at(AREA_BASE, AREA_STRIDE, i, 0).xyz.toVar(),
        lightPosition: this.data.at(AREA_BASE, AREA_STRIDE, i, 1).xyz.toVar(),
        halfWidth: this.data.at(AREA_BASE, AREA_STRIDE, i, 2).xyz.toVar(),
        halfHeight: this.data.at(AREA_BASE, AREA_STRIDE, i, 3).xyz.toVar(),
        reflectedLight: { directDiffuse: diffuse, directSpecular: specular },
        ltc_1: ltc1, ltc_2: ltc2,
      }, builder);
    });
    reflectedLight.directDiffuse.addAssign(diffuse);
    reflectedLight.directSpecular.addAssign(specular);
    return null;
  }
}

class HemisphereLightArrayNode extends LightArrayNode<THREE.HemisphereLight> {
  override update(): undefined {
    let count = 0;
    for (const light of this.lights) {
      if (count === this.maxCount) break;
      if (light.intensity <= 0) continue;
      const slot = HEMISPHERE_BASE + count * HEMISPHERE_STRIDE, vectors = this.data.vectors;
      colour.copy(light.color).multiplyScalar(light.intensity);
      vectors[slot]!.set(colour.r, colour.g, colour.b, 0);
      colour.copy(light.groundColor).multiplyScalar(light.intensity);
      vectors[slot + 1]!.set(colour.r, colour.g, colour.b, 0);
      position.setFromMatrixPosition(light.matrixWorld).normalize();
      vectors[slot + 2]!.set(position.x, position.y, position.z, 0);
      count++;
    }
    this.count.value = count;
    return undefined;
  }

  override setup(builder: NodeBuilder): null {
    const { irradiance } = lightContext(builder);
    loop(this.count, ({ i }) => {
      const sky = this.data.at(HEMISPHERE_BASE, HEMISPHERE_STRIDE, i, 0).xyz;
      const ground = this.data.at(HEMISPHERE_BASE, HEMISPHERE_STRIDE, i, 1).xyz;
      const weight = normalWorld.dot(this.data.at(HEMISPHERE_BASE, HEMISPHERE_STRIDE, i, 2).xyz).mul(.5).add(.5);
      irradiance.addAssign(mix(ground, sky, weight));
    });
    return null;
  }
}

const kind = (light: THREE.Light): "point" | "area" | "hemisphere" | null => light.castShadow ? null
  : (light as THREE.PointLight).isPointLight ? "point"
    : (light as THREE.RectAreaLight).isRectAreaLight ? "area"
      : (light as THREE.HemisphereLight).isHemisphereLight ? "hemisphere" : null;
const nodeFor = new WeakMap<THREE.Light, Node>();
type LightNodes = ReturnType<LightsNode["setupLightsNode"]>;

/** Point, area and hemisphere lights always compile as three fixed loops, so the program key
 * depends only on the shadowed sun. Entering a cave or a fairy realm toggles their light pools
 * without invalidating a single pipeline. */
class BatchedLightsNode extends LightsNode {
  private readonly data = new LightData();
  private readonly points = new PointLightArrayNode(this.data, MAX_BATCHED_POINT_LIGHTS);
  private readonly areas = new AreaLightArrayNode(this.data, MAX_BATCHED_AREA_LIGHTS);
  private readonly hemispheres = new HemisphereLightArrayNode(this.data, MAX_BATCHED_HEMISPHERE_LIGHTS);

  override customCacheKey(): number {
    const data: number[] = [];
    for (const light of this.getLights() as THREE.Light[]) if (!kind(light)) data.push(light.id, light.castShadow ? 1 : 0);
    return NodeUtils.hashArray(data);
  }

  override setLights(lights: THREE.Light[]): this {
    super.setLights(lights);
    this.points?.setLights(lights.filter((light): light is THREE.PointLight => kind(light) === "point"));
    this.areas?.setLights(lights.filter((light): light is THREE.RectAreaLight => kind(light) === "area"));
    this.hemispheres?.setLights(lights.filter((light): light is THREE.HemisphereLight => kind(light) === "hemisphere"));
    return this;
  }

  override get hasLights(): boolean { return true; }

  override setupLightsNode(builder: NodeBuilder): LightNodes {
    const nodes: unknown[] = [];
    for (const light of [...(this.getLights() as THREE.Light[])].sort((a, b) => a.id - b.id)) {
      if ((light as unknown as Node).isNode) { nodes.push(light); continue; }
      if (kind(light)) continue;
      let node: Node | undefined = nodeFor.get(light);
      if (node === undefined) {
        const library = builder.renderer.library as unknown as { getLightNodeClass(type: unknown): (new (light: THREE.Light) => Node) | null };
        const LightNode = library.getLightNodeClass(light.constructor);
        if (!LightNode) continue;
        node = new LightNode(light);
        nodeFor.set(light, node);
      }
      nodes.push(node);
    }
    nodes.push(this.hemispheres, this.points, this.areas);
    return nodes as unknown as LightNodes;
  }
}

export class BatchedLighting extends Lighting {
  private readonly nodes = new WeakMap<object, BatchedLightsNode>();
  private readonly quad = new LightsNode();

  override createNode(lights: THREE.Light[] = []): LightsNode {
    return new BatchedLightsNode().setLights(lights);
  }

  override getNode(scene: THREE.Scene & { isQuadMesh?: boolean }): LightsNode {
    if (scene.isQuadMesh) return this.quad;
    let node = this.nodes.get(scene);
    if (!node) this.nodes.set(scene, node = new BatchedLightsNode());
    return node;
  }
}
