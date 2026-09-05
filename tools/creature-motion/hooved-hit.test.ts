import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import type { Node } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { authorHoovedHit } from "./hooved-hit.js";
import { applyClip, duration, restorePose, storedPose } from "./pose.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const position = (node: Node) => new Vector3(...node.getWorldMatrix().slice(12, 15));

describe.each(["animal_cattle", "animal_boar"] as const)("%s planted impact and recovery", id => {
  it.each([0, -1, 1] as const)("preserves hoof contacts, anatomy and approved clips for side %s", async side => {
    const doc = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).read(path.join(repo, `game/public/assets/models/animal/${id}.glb`));
    const original = storedPose(doc);
    const protectedClips = doc.getRoot().listAnimations().filter(clip => !/^Hit/.test(clip.getName()));
    const clipData = () => protectedClips.map(clip => clip.listSamplers().map(sampler => [
      Array.from(sampler.getInput()!.getArray()!), Array.from(sampler.getOutput()!.getArray()!),
    ]));
    const approved = clipData();
    applyClip(doc.getRoot().listAnimations().find(clip => clip.getName() === "Idle")!, 0);
    const idle = storedPose(doc);
    const nodes = doc.getRoot().listNodes();
    const prefix = id === "animal_boar" ? "WildBoar" : "Cow";
    const joint = (name: string) => nodes.find(node => node.getName() === `${prefix}_${name}SHJnt`)!;
    const contacts = nodes.filter(node => /_(Front|Hind)Leg_(Ball|Toe)SHJnt$/.test(node.getName()));
    const contactPositions = new Map(contacts.map(node => [node, position(node)]));
    const head = joint("Head_Top"), shoulder = joint("Spine_Top"), pelvis = joint("ROOT"), root = joint("MAIN");
    const headBase = position(head), shoulderBase = position(shoulder), pelvisBase = position(pelvis), rootBase = position(root);
    const legs = ["l_FrontLeg", "r_FrontLeg", "l_HindLeg", "r_HindLeg"].map(part => {
      const chain = ["Hip", "Knee1", "Knee2", "Ankle"].map(suffix => joint(`${part}_${suffix}`));
      const lengths = chain.slice(1).map((node, i) => position(node).distanceTo(position(chain[i]!)));
      const axis = position(chain[2]!).sub(position(chain[0]!)).normalize();
      const pole = position(chain[1]!).sub(position(chain[0]!));
      pole.addScaledVector(axis, -pole.dot(axis)).normalize();
      return { chain, lengths, pole };
    });
    restorePose(original);
    authorHoovedHit(doc, id, side);
    expect(storedPose(doc)).toEqual(original);
    expect(clipData()).toEqual(approved);
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === (side === 0 ? "Hit" : side < 0 ? "HitLeft" : "HitRight"))!;
    let contactError = 0, headTravel = 0, shoulderDrop = 0, pelvisDrop = 0;
    for (let frame = 0; frame <= 240; frame++) {
      restorePose(original);
      applyClip(clip, duration(clip) * frame / 240);
      for (const contact of contacts) contactError = Math.max(contactError, position(contact).distanceTo(contactPositions.get(contact)!));
      headTravel = Math.max(headTravel, position(head).distanceTo(headBase));
      shoulderDrop = Math.max(shoulderDrop, shoulderBase.y - position(shoulder).y);
      pelvisDrop = Math.max(pelvisDrop, pelvisBase.y - position(pelvis).y);
      expect(position(root).distanceTo(rootBase)).toBeLessThan(1e-7);
      for (const { chain, lengths, pole } of legs) {
        chain.slice(1).forEach((node, index) => expect(Math.abs(position(node).distanceTo(position(chain[index]!)) - lengths[index]!)).toBeLessThan(1e-6));
        const axis = position(chain[2]!).sub(position(chain[0]!)).normalize();
        const bend = position(chain[1]!).sub(position(chain[0]!));
        bend.addScaledVector(axis, -bend.dot(axis)).normalize();
        expect(bend.dot(pole)).toBeGreaterThan(0.98);
      }
    }
    expect(contacts).toHaveLength(8);
    expect(contactError).toBeLessThan(0.002);
    expect(headTravel).toBeGreaterThan(id === "animal_boar" ? 0.18 : 0.25);
    expect(shoulderDrop).toBeGreaterThan(id === "animal_boar" ? 0.09 : 0.13);
    expect(pelvisDrop).toBeGreaterThan(id === "animal_boar" ? 0.06 : 0.085);
    for (const pose of idle) {
      expect(new Vector3(...pose.node.getTranslation()).distanceTo(new Vector3(...pose.t))).toBeLessThan(0.0001);
      expect(new Quaternion().fromArray(pose.node.getRotation()).angleTo(new Quaternion().fromArray(pose.r))).toBeLessThan(0.0001);
    }
  });
});
