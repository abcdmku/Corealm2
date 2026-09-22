import * as THREE from "three";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { positionLocal, vec3 } from "three/tsl";
import { describe, expect, it } from "vitest";
import { createMagicTreeShimmer } from "../game/src/render/magicTreeShimmer.js";

function descendants(root: Node | null): Node[] {
  const nodes: Node[] = [];
  root?.traverse(node => nodes.push(node));
  return nodes;
}

describe("magic tree shimmer", () => {
  it("animates bark and leaf emission from the shared clock while preserving cutouts and vertex animation", () => {
    const time = { value: 0 };
    for (const role of ["bark", "foliage"] as const) {
      const source = new MeshStandardNodeMaterial({
        name: role === "bark" ? "Bark_Corealm" : "Leaves_Corealm_broadleaf_magic_cutout",
        map: new THREE.Texture(), alphaTest: role === "foliage" ? .32 : 0,
      });
      source.userData.corealmMagicTree = true;
      source.emissiveNode = vec3(0.1, 0, 0);
      source.positionNode = positionLocal.add(vec3(0.03, 0, 0));
      const material = createMagicTreeShimmer(source, time) as MeshStandardNodeMaterial;
      expect(material).not.toBe(source);
      expect(material.emissiveNode).not.toBe(source.emissiveNode);
      expect(material.positionNode).toBe(source.positionNode);
      expect(material.alphaTest).toBe(source.alphaTest);
      expect(material.map).toBe(source.map);
      expect(material.transparent).toBe(false);
      expect(material.depthWrite).toBe(true);
      const nodes = descendants(material.emissiveNode);
      expect(nodes).toContain(source.emissiveNode);
      const clock = nodes.find(node => "object" in node && node.object === time) as Node & { object: { value: number } };
      expect(clock).toBeDefined();
      time.value = 3.5;
      expect(clock.object.value).toBe(3.5);
      time.value = 7;
      expect(clock.object.value).toBe(7);
      expect(material.positionNode).toBe(source.positionNode);
      source.map!.dispose(); source.dispose(); material.dispose();
    }
  });

  it("keeps ordinary tree materials and non-lit materials free of the magic shader", () => {
    const source = new THREE.MeshStandardMaterial({ name: "Bark_Corealm" });
    const unlit = new THREE.MeshBasicMaterial();
    unlit.userData.corealmMagicTree = true;
    expect(createMagicTreeShimmer(source, { value: 0 })).toBe(source);
    expect(createMagicTreeShimmer(unlit, { value: 0 })).toBe(unlit);
    source.dispose(); unlit.dispose();
  });
});
