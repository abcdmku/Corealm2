import { readFile } from 'node:fs/promises';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { appendGaitAnimations, assertSourcePreserved, auditGroundGait, readRawGlb } from '../tools/repair-ground-creature-gaits.js';
import { cyclicFootPath, solveTwoBone, worldPosition, type BakedGait } from '../tools/lib/ground-gait.js';
import { addChannel } from '../tools/creature-motion/pose.js';

describe('offline ground gait repair', () => {
  it('matches the same root velocity throughout stance and joins swing position/velocity at both ends', () => {
    for (const [seconds, speed, duty, lift] of [[1.066666603, .5 / 4.6, .66, .012], [.466666698, 1.3 / 4.6, .58, .018]]) {
      const evaluate = (phase: number) => cyclicFootPath(phase, duty!, seconds!, speed!, lift!);
      const epsilon = 1e-6;
      for (const phase of [.01, duty! * .25, duty! * .75]) {
        const before = evaluate(phase - epsilon), after = evaluate(phase + epsilon);
        expect(Math.abs((after.z - before.z) / (2 * epsilon * seconds!) + speed!)).toBeLessThan(1e-9);
        expect(before.y).toBe(0); expect(after.y).toBe(0);
      }
      for (const phase of [0, duty!]) {
        const at = evaluate(phase), before = evaluate(phase - epsilon), after = evaluate(phase + epsilon);
        expect(Math.abs(before.z - after.z)).toBeLessThan(1e-6);
        const beforeVelocity = (at.z - before.z) / (epsilon * seconds!);
        const afterVelocity = (after.z - at.z) / (epsilon * seconds!);
        expect(Math.abs(beforeVelocity - afterVelocity)).toBeLessThan(.0001);
        expect(Math.max(before.y, at.y, after.y)).toBeLessThan(1e-9);
      }
    }
  });

  it('solves a scaled +X chain in a rotated parent frame without changing skeleton translations or scales', () => {
    const doc = new Document();
    const wrapper = doc.createNode('wrapper').setScale([.01, .01, .01]).setRotation(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -.4).toArray());
    const upper = doc.createNode('upper').setTranslation([1, 3, 0]).setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), .7).toArray());
    const lower = doc.createNode('lower').setTranslation([5, 0, 0]).setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -1.2).toArray());
    const end = doc.createNode('end').setTranslation([7, 0, 0]);
    wrapper.addChild(upper); upper.addChild(lower); lower.addChild(end); doc.createScene().addChild(wrapper);
    const reference = [upper, lower, end].map(node => [node.getTranslation(), node.getScale()]);
    for (let i = 0; i < 64; i++) {
      const target = new Vector3(.06, .035 + .01 * Math.sin(i / 8), -.025 + .01 * Math.cos(i / 8));
      const solved = solveTwoBone(upper, lower, end, target, new Vector3(.03, .1, .03));
      expect(solved.extensionMargin).toBeGreaterThan(.04);
      expect(worldPosition(end).distanceTo(target)).toBeLessThan(1e-8);
      expect([upper, lower, end].map(node => [node.getTranslation(), node.getScale()])).toEqual(reference);
    }
  });

  it('keeps every source geometry/image byte and all nonlocomotion animation data exact in the staged GLB', async () => {
    const bytes = await readFile('game/public/assets/models/animal/animal_crab.glb');
    const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS), doc = await io.readBinary(bytes);
    const node = doc.getRoot().listNodes().find(node => node.getName() === 'Bone002')!;
    const gait: BakedGait = { name: 'Walk', seconds: 1, nativeMps: .1, feet: [], notes: [], tracks: [{ node, path: 'translation', times: [0, 1], values: [...node.getTranslation(), ...node.getTranslation()] }] };
    const result = appendGaitAnimations(bytes, [gait]);
    expect(() => assertSourcePreserved(bytes, result)).not.toThrow();
    const before = readRawGlb(bytes), after = readRawGlb(result);
    expect(after.bin.subarray(0, before.bin.length).equals(before.bin)).toBe(true);
    expect(after.json.animations.filter((clip: any) => clip.name !== 'Walk')).toEqual(before.json.animations.filter((clip: any) => clip.name !== 'Walk'));
    expect(after.json.nodes).toEqual(before.json.nodes);
    expect(after.json.meshes).toEqual(before.json.meshes);
    expect(after.json.materials).toEqual(before.json.materials);
    expect(after.json.skins).toEqual(before.json.skins);
    expect(after.json.images).toEqual(before.json.images);
    const corrupted = Buffer.from(result), rawOffset = 20 + corrupted.readUInt32LE(12) + 8;
    corrupted[rawOffset + 32] = corrupted[rawOffset + 32]! ^ 1;
    expect(() => assertSourcePreserved(bytes, corrupted)).toThrow('BIN bytes changed');
  });

  it('rejects a sole skating on the ground during its declared swing', () => {
    const doc = new Document(), buffer = doc.createBuffer();
    const bone = doc.createNode('bone'), meshNode = doc.createNode('footMesh');
    const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0])).setBuffer(buffer);
    const joints = doc.createAccessor().setType('VEC4').setArray(new Uint16Array([0, 0, 0, 0])).setBuffer(buffer);
    const weights = doc.createAccessor().setType('VEC4').setArray(new Float32Array([1, 0, 0, 0])).setBuffer(buffer);
    const inverse = doc.createAccessor().setType('MAT4').setArray(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).setBuffer(buffer);
    meshNode.setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', position).setAttribute('JOINTS_0', joints).setAttribute('WEIGHTS_0', weights)));
    meshNode.setSkin(doc.createSkin().addJoint(bone).setInverseBindMatrices(inverse));
    doc.createScene().addChild(bone).addChild(meshNode);
    const clip = doc.createAnimation('Walk'), times = Array.from({ length: 401 }, (_, i) => i / 400);
    addChannel(doc, clip, bone, 'translation', times, times.flatMap(phase => [0, 0, cyclicFootPath(phase, .5, 1, .1, 0).z]));
    const gait: BakedGait = { name: 'Walk', seconds: 1, nativeMps: .1, tracks: [], notes: [], feet: [{ name: 'foot', vertices: [0], primaryVertices: [0], phaseOffset: 0, duty: .5, clearance: 0 }] };
    const audit = auditGroundGait(doc, gait, 'footMesh', 0, 400);
    expect(audit.feet[0]!.primarySlipMps.max).toBeLessThan(.001);
    expect(audit.feet[0]!.incidentalPhysicalPlaneSlipMps.max).toBeGreaterThan(.29);
    expect(audit.passed).toBe(false);
    expect(audit.failures).toContain('foot: all-phase physical contact speed exceeds12mm/s');
  });
});
