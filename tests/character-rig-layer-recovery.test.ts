import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CharacterRig } from "../game/src/render/characterRig.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function outfitFixture() {
  const source = new THREE.Group();
  const sourceBone = new THREE.Bone(); sourceBone.name = "root";
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.bind(new THREE.Skeleton([sourceBone])); source.add(sourceBone, mesh);
  const assets = { entry: () => ({ tags: ["torso"] }), load: vi.fn(async (_id: string) => source) };
  const rig = new CharacterRig(assets as never) as any;
  const bone = new THREE.Bone(); bone.name = "root";
  const target = new THREE.Group(); rig.root.add(target); target.add(bone);
  const current = new THREE.SkinnedMesh(geometry, mesh.material);
  current.bind(new THREE.Skeleton([bone])); target.add(current);
  rig.layerTarget = target; rig.hostBones.set("root", bone);
  rig.layerMeshes = [current]; rig.layerSignature = "old"; rig.committedLayerAssets = ["old"];
  rig.baseOutfitIds = ["next"];
  return { rig, assets, current, bone, source };
}

describe("character outfit load recovery", () => {
  it("keeps the old outfit and cap animated until graphics preparation finishes, then swaps without reparenting", async () => {
    const { rig, current, bone } = outfitFixture();
    const prepared = deferred<void>();
    let candidate!: THREE.Object3D;
    rig.capped = true;
    rig.setAppearancePreparation((root: THREE.Object3D) => { candidate = root; return prepared.promise; });
    const pending = rig.rebuildLayersNow();
    await vi.waitFor(() => expect(candidate).toBeDefined());
    expect(current.parent).toBe(rig.layerTarget);
    expect(current.visible).toBe(true);
    expect(rig.capped).toBe(true);
    expect(rig.committedLayerAssets).toEqual(["old"]);
    expect(candidate.visible).toBe(false);
    const replacement = candidate.children[0] as THREE.SkinnedMesh;
    expect(replacement.skeleton.bones[0]).toBe(bone);
    const mixer = new THREE.AnimationMixer(rig.layerTarget);
    mixer.clipAction(new THREE.AnimationClip("move", 1, [new THREE.NumberKeyframeTrack("root.position[x]", [0, 1], [0, 2])])).play();
    mixer.update(0.25); rig.root.updateMatrixWorld(true);
    expect(current.getVertexPosition(0, new THREE.Vector3()).x).toBeCloseTo(0.5);
    expect(replacement.getVertexPosition(0, new THREE.Vector3()).x).toBeCloseTo(0.5);
    const removed = vi.fn(); candidate.addEventListener("removed", removed);
    prepared.resolve(); await pending;
    expect(current.parent).toBeNull();
    expect(candidate.visible).toBe(true);
    expect(candidate.parent).toBe(rig.layerTarget);
    expect(removed).not.toHaveBeenCalled();
    expect(rig.layerMeshes).toEqual([replacement]);
    expect(rig.committedLayerAssets).toEqual(["next"]);
    rig.dispose();
  });

  it("lets a newer outfit finish while an obsolete asset is still loading", async () => {
    const { rig, assets, source } = outfitFixture();
    const slow = deferred<THREE.Group>();
    assets.load.mockImplementationOnce(() => slow.promise);
    const obsolete = rig.rebuildLayersNow();
    rig.baseOutfitIds = ["latest"];
    await rig.rebuildLayersNow();
    const committed = rig.layerMeshes[0];
    expect(rig.committedLayerAssets).toEqual(["latest"]);
    slow.resolve(source); await obsolete;
    expect(rig.layerMeshes[0]).toBe(committed);
    expect(rig.layerLoadPending).toBe(false);
    rig.dispose();
  });

  it("caps only the native body when the prepared outfit is already attached beneath it", async () => {
    const { rig, source, current } = outfitFixture();
    rig.body = rig.layerTarget;
    rig.bodyAssetId = "base_male";
    rig.forceHeadCap = true;
    rig.bodyMeshes = [current];
    rig.bodyGeometries.set(current, current.geometry);
    const sourceGeometry = (source.children[1] as THREE.Mesh).geometry;
    await rig.rebuildLayersNow();
    expect(rig.capped).toBe(true);
    expect(rig.layerMeshes).toHaveLength(1);
    expect(rig.layerMeshes[0].parent).toBe(rig.layerRoot);
    expect(rig.layerMeshes[0].geometry).toBe(sourceGeometry);
    expect(sourceGeometry.getAttribute("position").count).toBe(3);
    rig.dispose();
  });

  it("discards an obsolete prepared outfit and its owned resources without reviving it", async () => {
    const { rig, current } = outfitFixture();
    const preparation: { root: THREE.Object3D; ready: ReturnType<typeof deferred<void>> }[] = [];
    rig.gear = { applyGearAppearance: (mesh: THREE.Mesh) => { mesh.material = (mesh.material as THREE.Material).clone(); } };
    rig.gearBySlot.set("body", [{ assetId: "next", slot: "body", attach: "skin" }]);
    rig.setAppearancePreparation((root: THREE.Object3D) => {
      const ready = deferred<void>(); preparation.push({ root, ready }); return ready.promise;
    });
    const obsolete = rig.rebuildLayersNow();
    await vi.waitFor(() => expect(preparation).toHaveLength(1));
    const first = preparation[0]!;
    const material = (first.root.children[0] as THREE.Mesh).material as THREE.Material;
    const dispose = vi.spyOn(material, "dispose");
    rig.gearBySlot.set("body", [{ assetId: "latest", slot: "body", attach: "skin" }]);
    const latest = rig.rebuildLayersNow();
    expect(first.root.parent).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(current.parent).toBe(rig.layerTarget);
    await vi.waitFor(() => expect(preparation).toHaveLength(2));
    preparation[1]!.ready.resolve(); await latest;
    first.ready.reject(new Error("obsolete preparation failed")); await obsolete;
    expect(rig.committedLayerAssets).toEqual(["latest"]);
    expect(rig.layerLoadPending).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
    rig.dispose();
  });

  it.each(["reject", "dispose"] as const)("retains the old outfit on preparation rejection and never attaches after disposal: %s", async action => {
    const { rig, current } = outfitFixture();
    const prepared = deferred<void>();
    let candidate!: THREE.Object3D;
    rig.setAppearancePreparation((root: THREE.Object3D) => { candidate = root; return prepared.promise; });
    const pending = rig.rebuildLayersNow();
    await vi.waitFor(() => expect(candidate).toBeDefined());
    if (action === "dispose") rig.dispose();
    prepared.reject(new Error("preparation failed")); await pending;
    expect(candidate.parent).toBeNull();
    if (action === "reject") {
      expect(current.parent).toBe(rig.layerTarget);
      expect(rig.layerSignature).toBe("old");
      expect(rig.layerLoadPending).toBe(true);
      rig.dispose();
    } else expect(rig.layerMeshes).toEqual([]);
  });

  it("retains a weapon through graphics preparation and failed replacements, and cancels pending equips on removal", async () => {
    const assets = { entry: () => undefined, load: vi.fn(async () => new THREE.Group()) };
    const rig = new CharacterRig(assets as never) as any;
    const hand = new THREE.Bone(); rig.hostBones.set("hand_r", hand); rig.root.add(hand);
    const old = new THREE.Group(); rig.setSlot("mainHand", old);
    const preparation: { root: THREE.Object3D; ready: ReturnType<typeof deferred<void>> }[] = [];
    rig.setAppearancePreparation((root: THREE.Object3D) => {
      const ready = deferred<void>(); preparation.push({ root, ready }); return ready.promise;
    });
    const appearance = { assetId: "sword", slot: "mainHand", attach: "bone" };
    const pending = rig.attachBoneSlot("mainHand", appearance);
    await vi.waitFor(() => expect(preparation).toHaveLength(1));
    expect(old.parent).toBe(hand);
    expect(old.visible).toBe(true);
    expect(preparation[0]!.root.visible).toBe(false);
    const removed = vi.fn(); preparation[0]!.root.addEventListener("removed", removed);
    preparation[0]!.ready.resolve(); await pending;
    const sword = rig.boneAttachments.get("mainHand");
    expect(old.parent).toBeNull(); expect(sword.visible).toBe(true);
    expect(removed).not.toHaveBeenCalled();
    assets.load.mockRejectedValueOnce(new Error("offline"));
    await rig.attachBoneSlot("mainHand", { ...appearance, assetId: "missing" });
    expect(rig.boneAttachments.get("mainHand")).toBe(sword);
    const cancelled = rig.attachBoneSlot("mainHand", appearance);
    await vi.waitFor(() => expect(preparation).toHaveLength(2));
    await rig.attachBoneSlot("mainHand", null);
    expect(preparation[1]!.root.parent).toBeNull();
    preparation[1]!.ready.resolve(); await cancelled;
    expect(rig.boneAttachments.size).toBe(0);
    expect(hand.children).toEqual([]);
    rig.dispose();
  });

  it("requests independent outfit parts together and retains the old outfit until every part arrives", async () => {
    const resolve = new Map<string, (source: THREE.Group) => void>();
    const tags: Record<string, string[]> = { chest: ["torso"], legs: ["legs"], hair: ["hair"] };
    const assets = { entry: (id: string) => ({ tags: tags[id] }),
      load: (id: string) => new Promise<THREE.Group>(done => resolve.set(id, done)) };
    const rig = new CharacterRig(assets as never) as any;
    rig.layerTarget = new THREE.Group();
    rig.baseOutfitIds = ["chest", "legs", "hair"];
    const current = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    rig.layerTarget.add(current); rig.layerMeshes = [current];
    const pending = rig.rebuildLayersNow();
    expect([...resolve.keys()]).toEqual(["chest", "legs", "hair"]);
    resolve.get("legs")!(new THREE.Group()); resolve.get("hair")!(new THREE.Group());
    await Promise.resolve();
    expect(current.parent).toBe(rig.layerTarget);
    resolve.get("chest")!(new THREE.Group());
    await pending;
    expect(current.parent).toBeNull();
    expect(rig.layerSignature).toContain("chest");
    expect(rig.layerLoadPending).toBe(false);
    current.geometry.dispose(); (current.material as THREE.Material).dispose();
  });
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

