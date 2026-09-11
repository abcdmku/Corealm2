import { describe, expect, it } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { AnimationMixer, Matrix4, SkinnedMesh, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { attachItemSkin } from "../tools/item-models/skin.js";

function fixture() {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene();
  doc.getRoot().setDefaultScene(scene);
  for (const [name, bone, points] of [
    ["breastplate", "spine_03", [-.18, 1.1, .15, .18, 1.1, .15, 0, 1.48, .18]],
    ["pauldron", "upperarm_l", [.18, 1.45, -.15, .33, 1.48, -.1, .22, 1.55, .05]],
    ["shin", "calf_r", [-.15, .2, .1, -.05, .35, .1, -.2, .5, .07]],
    ["lining", null, [0, 1.12, .16, 0, 1.23, .17, .23, 1.45, .05]],
  ] as const) {
    const position = doc.createAccessor().setType("VEC3").setArray(new Float32Array(points)).setBuffer(buffer);
    const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(doc.createPrimitive().setAttribute("POSITION", position)));
    if (bone) node.setExtras({ itemModelBone: bone });
    scene.addChild(node);
  }
  return doc;
}

async function parse(document: Document) {
  // Animation library materials/textures are irrelevant to skeletal deformation in Node.
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) primitive.setMaterial(null);
  for (const material of document.getRoot().listMaterials()) material.dispose();
  for (const texture of document.getRoot().listTextures()) texture.dispose();
  const bytes = await new NodeIO().writeBinary(document);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "");
}

describe("authored rigid plate skin hints", () => {
  it("preserves the native rig, assigns exact rigid weights, and leaves cloth blended", async () => {
    const doc = fixture();
    await attachItemSkin(doc, "corven_plate");
    const source = await new NodeIO().read("game/public/assets/models/character/base_male.glb");
    const skin = doc.getRoot().listSkins()[0]!, native = source.getRoot().listSkins()[0]!;
    expect(skin.listJoints().map(joint => joint.getName())).toEqual(native.listJoints().map(joint => joint.getName()));
    expect(Array.from(skin.getInverseBindMatrices()!.getArray()!)).toEqual(Array.from(native.getInverseBindMatrices()!.getArray()!));
    skin.listJoints().forEach((joint, index) => expect(joint.getWorldMatrix()).toEqual(native.listJoints()[index]!.getWorldMatrix()));
    expect(doc.getRoot().listMeshes()).toHaveLength(4);
    let blended = 0;
    for (const node of doc.getRoot().listNodes().filter(node => node.getMesh())) {
      expect(node.getWorldMatrix()).toEqual(new Matrix4().elements);
      const primitive = node.getMesh()!.listPrimitives()[0]!, weights = primitive.getAttribute("WEIGHTS_0")!, joints = primitive.getAttribute("JOINTS_0")!;
      for (let vertex = 0; vertex < weights.getCount(); vertex++) {
        const w: number[] = [], j: number[] = [];
        weights.getElement(vertex, w); joints.getElement(vertex, j);
        if (node.getExtras().itemModelBone) {
          expect(w).toEqual([1, 0, 0, 0]);
          expect(skin.listJoints()[j[0]!]!.getName()).toBe(node.getExtras().itemModelBone);
        } else if (w.filter(value => value > 0).length > 1) blended++;
      }
    }
    expect(blended).toBe(3);
  });

  it("keeps rigid plate edges unchanged through native idle, jog and sword attack while the plates move", async () => {
    const doc = fixture(); await attachItemSkin(doc, "corven_plate");
    const loaded = await parse(doc), clips = [];
    for (const library of [1, 2]) clips.push(...(await parse(await new NodeIO().read(`game/public/assets/models/animation/animation_library_${library}.glb`))).animations);
    const meshes: SkinnedMesh[] = [];
    loaded.scene.traverse(node => { if (node instanceof SkinnedMesh && node.name !== "lining") meshes.push(node); });
    expect(meshes).toHaveLength(3);
    for (const name of ["Idle_Loop", "Jog_Fwd_Loop", "Sword_Attack"]) {
      const clip = clips.find(clip => clip.name === name)!;
      expect(clip).toBeTruthy();
      const mixer = new AnimationMixer(loaded.scene); mixer.clipAction(clip).play();
      let moved = false;
      for (const phase of [.1, .35, .7]) {
        mixer.setTime(clip.duration * phase); loaded.scene.updateMatrixWorld(true);
        for (const mesh of meshes) {
          const position = mesh.geometry.getAttribute("position");
          const bind = Array.from({ length: position.count }, (_, i) => new Vector3().fromBufferAttribute(position, i));
          const posed = bind.map((point, index) => mesh.applyBoneTransform(index, point.clone()).applyMatrix4(mesh.matrixWorld));
          for (let i = 0; i < 3; i++) {
            const next = (i + 1) % 3;
            expect(Math.abs(posed[i]!.distanceTo(posed[next]!) / bind[i]!.distanceTo(bind[next]!) - 1)).toBeLessThan(1e-4);
            moved ||= posed[i]!.distanceTo(bind[i]!) > .01;
          }
        }
      }
      expect(moved).toBe(true);
      mixer.stopAllAction(); mixer.uncacheRoot(loaded.scene);
    }
  });

  it("rejects unknown rigid bone names rather than silently falling back to soft weights", async () => {
    const doc = fixture(); doc.getRoot().listNodes()[0]!.setExtras({ itemModelBone: "unknown_plate_bone" });
    await expect(attachItemSkin(doc, "corven_plate")).rejects.toThrow("invalid rigid plate bone");
  });
});
