import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CharacterRig } from "../game/src/render/characterRig.js";

describe("character outfit load recovery", () => {
  it("shows the carried hatchet through an equipment change, then restores the worn weapon", async () => {
    const assets = { load: vi.fn(async () => new THREE.Group()) };
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

