import { describe, expect, it } from "vitest";
import { Color, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, ShaderMaterial, Texture } from "three";
import { MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import { materialColor, materialOpacity, positionLocal, uniform, vec3 } from "three/tsl";
import { cloneNodeMaterial, composeSurface, ensureNodeMaterial, surfaceNodes } from "../game/src/render/nodeMaterials.js";

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
    const source = new MeshPhysicalMaterial({ map: new Texture(), color: 0x123456 });
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

  it("composes effects over snapshots of all channels without overwriting preceding effects", () => {
    const material = new MeshStandardNodeMaterial();
    expect(surfaceNodes(material).color).toBe(materialColor);
    expect(surfaceNodes(material).opacity).toBe(materialOpacity);
    expect(surfaceNodes(material).position).toBe(positionLocal);
    const tint = materialColor.mul(vec3(0.8, 0.9, 1));
    const firstOpacity = materialOpacity.mul(0.8);
    expect(composeSurface(material, {
      color: previous => { expect(previous).toBe(materialColor); return tint; },
      opacity: previous => { expect(previous).toBe(materialOpacity); return firstOpacity; },
    })).toBe(material);
    let nextOpacity = firstOpacity;
    composeSurface(material, {
      color: previous => {
        expect(previous).toBe(tint);
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
    expect(surfaceNodes(material).color).toBe(tint);
  });
});
