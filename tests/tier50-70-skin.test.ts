import { fileURLToPath } from 'node:url';
import { Document, NodeIO, type Accessor } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { attachItemSkin } from '../tools/item-models/skin.js';
import { tailorSkirtWeights } from '../tools/item-models/tier50-70/skin.js';
import { bakePlayerJog } from '../game/src/render/playerLocomotion.js';

const samples = [
  [.20, .78, .12], [-.20, .78, .12],
  [.20, .70, -.17], [-.20, .70, -.17],
  [.20, .91, -.15], [-.20, .91, -.15],
  [.20, .50, -.20], [-.20, .50, -.20], [0, 1.06, .14],
  [.12, .28, .25], [-.12, .28, .25], [0, .30, .23],
];
const array = (accessor: Accessor) => Array.from(accessor.getArray()!);

async function fixture() {
  const document = new Document(), buffer = document.createBuffer();
  const scene = document.createScene(); document.getRoot().setDefaultScene(scene);
  const make = (name: string, skirt: boolean) => {
    const position = document.createAccessor().setType('VEC3').setArray(new Float32Array(samples.flat())).setBuffer(buffer);
    const primitive = document.createPrimitive().setAttribute('POSITION', position);
    const mesh = document.createMesh(name).addPrimitive(primitive);
    const node = document.createNode(name).setMesh(mesh);
    if (skirt) node.setExtras({ itemModelDeform: 'skirt' });
    scene.addChild(node); return { node, primitive, position };
  };
  const skirt = make('Coat panels', true), ordinary = make('Unmarked body inset', false);
  await attachItemSkin(document, 'dragonhide_robe');
  return { document, skirt, ordinary };
}

/** Use the native rig and the same shortened player jog used by CharacterRig. */
async function playerJog(document: Document) {
  const rig = new THREE.Group(), byName = new Map<string, THREE.Object3D>();
  const nodes = new Map(document.getRoot().listNodes().filter(node => !node.getMesh()).map(node => {
    const object = new THREE.Object3D(); object.name = node.getName();
    object.position.fromArray(node.getTranslation()); object.quaternion.fromArray(node.getRotation()); object.scale.fromArray(node.getScale());
    byName.set(object.name, object); return [node, object] as const;
  }));
  for (const [node, object] of nodes) (nodes.get(node.getParentNode()!) ?? rig).add(object);
  rig.updateMatrixWorld(true);
  const library = await new NodeIO().read(fileURLToPath(new URL('../game/public/assets/models/animation/animation_library_1.glb', import.meta.url)));
  const animation = library.getRoot().listAnimations().find(value => value.getName() === 'Jog_Fwd_Loop');
  expect(animation).toBeDefined();
  const tracks = animation!.listChannels().map(channel => {
    const sampler = channel.getSampler()!, name = channel.getTargetNode()!.getName(), path = channel.getTargetPath();
    const times = sampler.getInput()!.getArray()!, values = sampler.getOutput()!.getArray()!;
    expect(['LINEAR', 'STEP']).toContain(sampler.getInterpolation());
    const interpolation = sampler.getInterpolation() === 'STEP' ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
    return path === 'rotation' ? new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values, interpolation)
      : new THREE.VectorKeyframeTrack(`${name}.${path === 'translation' ? 'position' : 'scale'}`, times, values, interpolation);
  });
  const source = new THREE.AnimationClip('Jog_Fwd_Loop', -1, tracks);
  const clip = bakePlayerJog(source, rig, 3.5).clip;
  const mixer = new THREE.AnimationMixer(rig); mixer.clipAction(clip).play();
  const skin = document.getRoot().listSkins()[0]!, inverse = skin.getInverseBindMatrices()!;
  const inverseMatrices = skin.listJoints().map((_, index) => {
    const values: number[] = []; inverse.getElement(index, values); return new THREE.Matrix4().fromArray(values);
  });
  return {
    pose(phase: number) {
      mixer.setTime(phase * clip.duration); rig.updateMatrixWorld(true);
      return skin.listJoints().map((joint, index) => byName.get(joint.getName())!.matrixWorld.clone().multiply(inverseMatrices[index]!));
    },
    pelvis: skin.listJoints().findIndex(joint => joint.getName() === 'pelvis'),
  };
}

function deform(point: number[], vertex: number, joints: number[], weights: number[], matrices: THREE.Matrix4[]) {
  const result = new THREE.Vector3();
  for (let influence = 0; influence < 4; influence++) {
    const index = vertex * 4 + influence, weight = weights[index]!;
    if (weight) result.addScaledVector(new THREE.Vector3().fromArray(point).applyMatrix4(matrices[joints[index]!]!), weight);
  }
  return result;
}

describe('tailored coat deformation on the native player rig', () => {
  it('reduces upper and rear panel swing through the real player jog while preserving authored geometry and unmarked skinning', async () => {
    const { document, skirt, ordinary } = await fixture();
    const oldPosition = array(skirt.position), oldJoints = array(skirt.primitive.getAttribute('JOINTS_0')!), oldWeights = array(skirt.primitive.getAttribute('WEIGHTS_0')!);
    const ordinaryJoints = array(ordinary.primitive.getAttribute('JOINTS_0')!), ordinaryWeights = array(ordinary.primitive.getAttribute('WEIGHTS_0')!);
    const jog = await playerJog(document);
    expect(tailorSkirtWeights(document)).toBe(samples.length);
    expect(skirt.primitive.getAttribute('POSITION')).toBe(skirt.position);
    expect(array(skirt.position)).toEqual(oldPosition);
    expect(array(ordinary.primitive.getAttribute('JOINTS_0')!)).toEqual(ordinaryJoints);
    expect(array(ordinary.primitive.getAttribute('WEIGHTS_0')!)).toEqual(ordinaryWeights);
    const joints = array(skirt.primitive.getAttribute('JOINTS_0')!), weights = array(skirt.primitive.getAttribute('WEIGHTS_0')!);
    for (let vertex = 0; vertex < samples.length; vertex++) {
      const influences = weights.slice(vertex * 4, vertex * 4 + 4);
      expect(influences.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
      expect(influences.reduce((total, value) => total + value, 0)).toBeCloseTo(1, 6);
    }
    const oldExcursion = samples.map(() => 0), newExcursion = samples.map(() => 0);
    for (const phase of [.05, .20, .35, .50, .65, .80, .95]) {
      const matrices = jog.pose(phase);
      samples.forEach((point, vertex) => {
        const anchor = new THREE.Vector3().fromArray(point).applyMatrix4(matrices[jog.pelvis]!);
        oldExcursion[vertex] = Math.max(oldExcursion[vertex]!, deform(point, vertex, oldJoints, oldWeights, matrices).distanceTo(anchor));
        newExcursion[vertex] = Math.max(newExcursion[vertex]!, deform(point, vertex, joints, weights, matrices).distanceTo(anchor));
      });
    }
    // This measures moving cloth against its pelvic attachment, not absolute root travel.
    // Both legs, upper hip guards and long rear tails must lose the excessive rigid-leg swing.
    for (let vertex = 0; vertex < 8; vertex++) {
      expect(oldExcursion[vertex], `baseline sample ${vertex} really moves`).toBeGreaterThan(.02);
      expect(newExcursion[vertex], `panel sample ${vertex} retains its hanging attachment`).toBeLessThan(oldExcursion[vertex]! * .65);
    }
    expect(newExcursion[8], 'waist seam follows the pelvis').toBeLessThan(1e-6);
  });
});
