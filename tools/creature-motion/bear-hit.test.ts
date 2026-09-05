import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { authorBearHit } from "./bear-hit.js";
import { applyClip, duration, restorePose, storedPose } from "./pose.js";

const source = path.join(fileURLToPath(new URL("../../", import.meta.url)), "game/public/assets/models/animal/animal_bear.glb");

describe("bear impact pose and planted recovery", () => {
  it.each([0, -1, 1] as const)("keeps every paw planted while side %s moves the animal's mass, then returns to Idle", async (side) => {
    const doc = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).read(source);
    const original = storedPose(doc);
    const protectedClips = doc.getRoot().listAnimations().filter(clip => !/^Hit/.test(clip.getName()));
    const protectedData = protectedClips.map(clip => clip.listSamplers().map(sampler => [
      Array.from(sampler.getInput()!.getArray()!), Array.from(sampler.getOutput()!.getArray()!),
    ]));
    applyClip(doc.getRoot().listAnimations().find(clip => clip.getName() === "Idle")!, 0);
    const idle = storedPose(doc);
    const position = (node: typeof idle[number]["node"]) => new Vector3(...node.getWorldMatrix().slice(12, 15));
    const nodes = doc.getRoot().listNodes();
    const paws = nodes.filter(node => /^Bear_[lr]_(FrontLeg|HindLeg)_(Ball|Toe)SHJnt$/.test(node.getName()));
    const head = nodes.find(node => node.getName() === "Bear_Head_TopSHJnt")!;
    const shoulder = nodes.find(node => node.getName() === "Bear_Spine_TopSHJnt")!;
    const pelvis = nodes.find(node => node.getName() === "Bear_ROOTSHJnt")!;
    const root = nodes.find(node => node.getName() === "Bear_MAINSHJnt")!;
    const rest = new Map([...paws, head, shoulder, pelvis, root].map(node => [node, position(node)]));
    restorePose(original);
    authorBearHit(doc, side);
    expect(storedPose(doc)).toEqual(original);
    expect(protectedClips.map(clip => clip.listSamplers().map(sampler => [
      Array.from(sampler.getInput()!.getArray()!), Array.from(sampler.getOutput()!.getArray()!),
    ]))).toEqual(protectedData);
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === (side === 0 ? "Hit" : side < 0 ? "HitLeft" : "HitRight"))!;
    let pawError = 0, headTravel = 0, shoulderTravel = 0, compression = 0;
    for (let frame = 0; frame <= 120; frame++) {
      restorePose(original);
      applyClip(clip, duration(clip) * frame / 120);
      for (const paw of paws) pawError = Math.max(pawError, position(paw).distanceTo(rest.get(paw)!));
      headTravel = Math.max(headTravel, position(head).distanceTo(rest.get(head)!));
      shoulderTravel = Math.max(shoulderTravel, position(shoulder).distanceTo(rest.get(shoulder)!));
      compression = Math.max(compression, rest.get(pelvis)!.y - position(pelvis).y);
      expect(position(root).distanceTo(rest.get(root)!)).toBeLessThan(1e-7);
    }
    expect(paws).toHaveLength(8);
    expect(pawError).toBeLessThan(0.002);
    expect(headTravel).toBeGreaterThan(0.25);
    expect(shoulderTravel).toBeGreaterThan(0.15);
    expect(compression).toBeGreaterThan(0.075);
    for (const pose of idle) {
      expect(new Vector3(...pose.node.getTranslation()).distanceTo(new Vector3(...pose.t))).toBeLessThan(0.0001);
      expect(new Quaternion().fromArray(pose.node.getRotation()).angleTo(new Quaternion().fromArray(pose.r))).toBeLessThan(0.0001);
    }
  });
});
