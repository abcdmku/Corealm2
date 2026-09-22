import { describe, expect as vitestExpect, it } from "vitest";
import { Color, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, ShaderMaterial, Texture } from "three";
import { MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import { materialColor, materialOpacity, positionLocal, uniform, vec3 } from "three/tsl";
import { cloneNodeMaterial, composeSurface, ensureNodeMaterial, surfaceNodes } from "../game/src/render/nodeMaterials.js";

// Vitest's generic assertion types need not expand the recursive TSL graph types.
const expect = (value: unknown) => vitestExpect(value);
const referencesInput = (node: unknown, expected: unknown): boolean => {
  for (let current = node; current && typeof current === "object"; current = (current as { node?: unknown }).node) {
    if (current === expected) return true;
  }
  return false;
};

describe("node material conversion", () => {
  it("converts and caches ordinary materials without erasing node defaults", () => {
    const texture = new Texture();
    for (const [source, Type] of [
      [new MeshBasicMaterial({ color: 0x123456, map: texture }), MeshBasicNodeMaterial],
      [new MeshStandardMaterial({ color: 0x123456, map: texture, roughness: 0.3 }), MeshStandardNodeMaterial],
      [new MeshPhysicalMaterial({ color: 0x123456, map: texture, transmission: 0.75, clearcoat: 0.8 }), MeshPhysicalNodeMaterial],
    ] as const) {
      const material = ensureNodeMaterial(source);
      expect(material).toBeInstanceOf(Type);
      expect(ensureNodeMaterial(source)).toBe(material);
      expect(ensureNodeMaterial(material)).toBe(material);
      expect(material.color.equals(source.color)).toBe(true);
      expect(material.color).not.toBe(source.color);
      expect(material.map).toBe(texture);
      expect(material.colorNode).toBeNull();
      expect(material.positionNode).toBeNull();
      expect(material.fragmentNode).toBeNull();
      if (material instanceof MeshPhysicalNodeMaterial) {
        expect(material.transmission).toBe(0.75);
        expect(material.clearcoat).toBe(0.8);
        expect(material.transmissionNode).toBeNull();
      }
    }
  });

  it("retains live metadata and gives clones owned values with shared graph and texture references", () => {
    const source = new MeshPhysicalMaterial({ map: new Texture(), color: 0x123456, alphaTest: 0.4, alphaToCoverage: true });
    const gain = uniform(0.5);
    const metadata: Record<string, unknown> = { gain };
    metadata.self = metadata;
    source.userData = metadata;
    const material = ensureNodeMaterial(source);
    material.colorNode = vec3(gain);
    material.opacityNode = gain;
    const clone = cloneNodeMaterial(material) as MeshPhysicalNodeMaterial;
    expect(clone).not.toBe(material);
    expect(clone.uuid).not.toBe(material.uuid);
    expect(clone.colorNode).toBe(material.colorNode);
    expect(clone.opacityNode).toBe(gain);
    expect(clone.map).toBe(source.map);
    expect(clone.userData).not.toBe(material.userData);
    expect(clone.userData.gain).toBe(gain);
    expect(clone.userData.self).toBe(metadata);
    expect(clone.alphaTest).toBe(0.4);
    expect(clone.alphaToCoverage).toBe(true);
    clone.color.set(0xffffff);
    expect(material.color.equals(new Color(0x123456))).toBe(true);
    expect(source.userData).toBe(metadata);
  });

  it("rejects unported shaders instead of silently losing their effects", () => {
    expect(() => ensureNodeMaterial(new ShaderMaterial())).toThrow("explicit node material port");
    const custom = new MeshStandardMaterial();
    custom.onBeforeCompile = () => {};
    expect(() => ensureNodeMaterial(custom)).toThrow("unported onBeforeCompile");
    const cached = new MeshBasicMaterial();
    ensureNodeMaterial(cached);
    cached.onBeforeCompile = () => {};
    expect(() => ensureNodeMaterial(cached)).toThrow("unported onBeforeCompile");
  });

  it("preserves specialized node material classes and their render hooks", () => {
    class AnimatedMaterial extends MeshPhysicalNodeMaterial {
      phase = uniform(0);
      override onBeforeRender() { this.phase.value += 1; }
    }
    const source = new AnimatedMaterial();
    source.transmission = 0.7;
    source.clearcoat = 0.8;
    source.colorNode = vec3(source.phase);
    const clone = cloneNodeMaterial(source) as AnimatedMaterial;
    expect(clone).toBeInstanceOf(AnimatedMaterial);
    expect(clone.phase).toBe(source.phase);
    expect(clone.transmission).toBe(0.7);
    expect(clone.clearcoat).toBe(0.8);
    expect(clone.colorNode).toBe(source.colorNode);
    clone.onBeforeRender();
    expect(source.phase.value).toBe(1);
  });

  it("composes effects over snapshots of all channels without overwriting preceding effects", () => {
    const material = new MeshStandardNodeMaterial();
    expect(referencesInput(surfaceNodes(material).color, materialColor)).toBe(true);
    expect(surfaceNodes(material).opacity).toBe(materialOpacity);
    expect(surfaceNodes(material).position).toBe(positionLocal);
    const tint = materialColor.mul(vec3(0.8, 0.9, 1));
    const firstOpacity = materialOpacity.mul(0.8);
    expect(composeSurface(material, {
      color: previous => { expect(referencesInput(previous, materialColor)).toBe(true); return tint; },
      opacity: previous => { expect(previous).toBe(materialOpacity); return firstOpacity; },
    })).toBe(material);
    const firstColor = material.colorNode;
    let nextOpacity = firstOpacity;
    composeSurface(material, {
      color: previous => {
        expect(referencesInput(previous, firstColor)).toBe(true);
        // A callback changing another channel must not change this batch's input.
        material.opacityNode = uniform(0);
        return previous;
      },
      opacity: previous => {
        expect(previous).toBe(firstOpacity);
        nextOpacity = previous.mul(0.5);
        return nextOpacity;
      },
    });
    expect(surfaceNodes(material).opacity).toBe(nextOpacity);
    expect(referencesInput(surfaceNodes(material).color, material.colorNode)).toBe(true);
  });

  it("preserves mapped color alpha separately from RGB transforms and material opacity", () => {
    const material = new MeshStandardNodeMaterial({ map: new Texture(), opacity: 0.8 });
    const recolored = vec3(0.1, 0.3, 0.6);
    composeSurface(material, { color: () => recolored });
    let joined: unknown = material.colorNode;
    while (joined && typeof joined === "object" && !(joined as { nodes?: unknown[] }).nodes) {
      joined = (joined as { node?: unknown }).node;
    }
    const channels = (joined as { nodes: unknown[] }).nodes;
    expect(channels[0]).toBe(recolored);
    expect(referencesInput(channels[1], materialColor)).toBe(true);
    expect(surfaceNodes(material).opacity).toBe(materialOpacity);
  });
});
