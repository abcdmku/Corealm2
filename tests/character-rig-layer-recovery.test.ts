import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CharacterRig } from "../game/src/render/characterRig.js";

describe("character outfit load recovery", () => {
  it("keeps the casting light on an exported staff's authored socket as its hand animates", async () => {
    // Exported equipment can be a merged mesh without the procedural source's userData.
    const assets = { entry: () => undefined, load: vi.fn(async () => new THREE.Group()) };
    const rig = new CharacterRig(assets as never) as any;
    rig.ready = true;
    const hand = new THREE.Bone();
    hand.name = "hand_r";
    rig.root.add(hand);
    rig.hostBones.set("hand_r", hand);
    await rig.attachBoneSlot("mainHand", { assetId: "corealm_staff_1", slot: "mainHand", attach: "bone" });
    const staff = rig.boneAttachments.get("mainHand") as THREE.Object3D;
    const expected = () => {
      staff.updateWorldMatrix(true, false);
      return staff.localToWorld(new THREE.Vector3(0, 0.85, 0));
    };
    const first = new THREE.Vector3(...rig.castingFocus());
    expect(first.distanceTo(expected())).toBeLessThan(0.00001);
    expect(first.distanceTo(hand.getWorldPosition(new THREE.Vector3()))).toBeGreaterThan(0.5);
    hand.position.set(1, 2, 3);
    hand.rotation.set(0.4, -0.6, 1.2);
    const moved = new THREE.Vector3(...rig.castingFocus());
    expect(moved.distanceTo(expected())).toBeLessThan(0.00001);
    expect(moved.distanceTo(first)).toBeGreaterThan(1);
    await rig.attachBoneSlot("mainHand", null);
    expect(new THREE.Vector3(...rig.castingFocus()).distanceTo(moved)).toBeGreaterThan(0.5);
  });
  it("shows the carried hatchet through an equipment change, then restores the worn weapon", async () => {
    const assets = { entry: () => undefined, load: vi.fn(async () => new THREE.Group()) };
    const rig = new CharacterRig(assets as never) as any;
    rig.ready = true;
    const hand = new THREE.Bone();
    hand.name = "hand_r";
    rig.root.add(hand);
    rig.hostBones.set("hand_r", hand);
    const sword = { assetId: "sword", slot: "mainHand", attach: "bone" };
    rig.gearBySlot.set("mainHand", [sword]);
    rig.poseFor({ moving: false, speed: 0, dead: false, inCombat: false,
      activityKind: "gathering", activitySkill: "woodcutting", activityToolItemId: "worn_hatchet" });
    await Promise.resolve();
    await Promise.resolve();
    expect(rig.motionSnapshot(true).attachments.mainHand).toBe("equip-mainHand-corealm_axe_1");
    rig.gearBySlot.set("mainHand", [{ ...sword, assetId: "sword_longsword" }]);
    rig.poseFor({ moving: false, speed: 0, dead: false, inCombat: false,
      activityKind: "gathering", activitySkill: "woodcutting", activityToolItemId: "worn_hatchet" });
    await Promise.resolve();
    expect(rig.motionSnapshot(true).attachments.mainHand).toBe("equip-mainHand-corealm_axe_1");
    rig.poseFor({ moving: false, speed: 0, dead: false, inCombat: false, activityKind: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(rig.motionSnapshot(true).attachments.mainHand).toBe("equip-mainHand-sword_longsword");
  });
  it("preserves the complete existing outfit and cap when a replacement source fails", async () => {
    const assets = { entry: () => ({ tags: ["torso"] }), load: vi.fn(async () => { throw new Error("offline"); }) };
    const rig = new CharacterRig(assets as never) as any;
    rig.layerTarget = new THREE.Group();
    rig.baseOutfitIds = ["outfit_male_knight_chest"];
    rig.layerSignature = "previous-complete-outfit";
    rig.capped = true;
    const current = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    rig.layerTarget.add(current); rig.layerMeshes = [current];
    await rig.rebuildLayersNow();
    expect(current.parent).toBe(rig.layerTarget);
    expect(rig.layerMeshes).toEqual([current]);
    expect(rig.capped).toBe(true);
    expect(rig.layerSignature).toBe("previous-complete-outfit");
  });
  it("hides the hairstyle with headgear and loads it again after headgear removal", async () => {
    const tags: Record<string, string[]> = { hair_buns: ["hair", "head"], outfit_female_ranger_hood: ["head"] };
    const assets = { entry: (id: string) => ({ tags: tags[id] }), load: vi.fn(async (_id: string) => new THREE.Group()) };
    const rig = new CharacterRig(assets as never) as any;
    rig.layerTarget = new THREE.Group();
    rig.baseOutfitIds = ["hair_buns"];
    rig.gearBySlot.set("head", [{ assetId: "outfit_female_ranger_hood", slot: "head", attach: "skin" }]);
    await rig.rebuildLayersNow();
    expect(assets.load.mock.calls.map(call => call[0])).toEqual(["outfit_female_ranger_hood"]);
    rig.gearBySlot.clear(); assets.load.mockClear();
    await rig.rebuildLayersNow();
    expect(assets.load.mock.calls.map(call => call[0])).toEqual(["hair_buns"]);
  });
  it("retries a failed layer load when the same equipment is applied again", async () => {
    const load = vi.fn(async (_id: string) => new THREE.Group());
    load.mockRejectedValueOnce(new Error("temporary failure"));
    const assets = { entry: () => ({ tags: ["torso"] }), load };
    const rig = new CharacterRig(assets as never) as any;
    rig.layerTarget = new THREE.Group();
    rig.baseOutfitIds = ["outfit_male_knight_chest"];
    await rig.rebuildLayersNow();
    await rig.applyEquipment({});
    expect(load).toHaveBeenCalledTimes(2);
    expect(rig.layerSignature).toContain("outfit_male_knight_chest");
    expect(rig.layerLoadPending).toBe(false);
  });
});

