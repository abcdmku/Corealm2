import { expect, it } from "vitest";
import * as THREE from "three";
import { CharacterRig } from "../game/src/render/characterRig.js";

it("plays the complete death reaction despite normal idle requests, then permits recovery", () => {
  const rig = new CharacterRig({} as never);
  const mixer = new THREE.AnimationMixer(rig.root);
  const death = mixer.clipAction(new THREE.AnimationClip("Death01", 2, []));
  const idle = mixer.clipAction(new THREE.AnimationClip("Idle_Loop", 1, []));
  Object.assign(rig, { mixer, actions: new Map([["Death01", death], ["Idle_Loop", idle]]) });
  rig.play("death", true);
  for (let frame = 0; frame < 90; frame++) {
    mixer.update(1 / 60);
    rig.play("idle");
  }
  expect(rig.currentPose()).toBe("death");
  expect(death.time).toBeCloseTo(1.5, 5);
  expect(death.loop).toBe(THREE.LoopOnce);
  mixer.update(1);
  expect(death.time).toBe(2);
  rig.play("idle");
  expect(rig.currentPose()).toBe("idle");
});
