import { describe, expect as vitestExpect, it } from "vitest";
import { Color, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, ShaderMaterial, Texture } from "three";
import { MaterialNode, MaterialReferenceNode, MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, NodeMaterial, type Node } from "three/webgpu";
import { materialColor, materialOpacity, positionLocal, uniform, vec3 as tslVec3 } from "three/tsl";
import { cloneNodeMaterial, composeSurface, ensureNodeMaterial, sourceMaterialNode, sourceMaterialReference, surfaceColorNode, surfaceNodes } from "../game/src/render/nodeMaterials.js";

// Vitest's generic assertion types need not expand the recursive TSL graph types.
const expect = (value: unknown) => vitestExpect(value);
const vec3 = tslVec3 as unknown as {
  (value: Node): Node<"vec3">;
  (x: number, y: number, z: number): Node<"vec3">;
};
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
    expect(referencesInput(surfaceNodes(material).color, sourceMaterialNode(material, MaterialNode.COLOR))).toBe(true);
    expect(surfaceNodes(material).opacity).toBe(sourceMaterialNode(material, MaterialNode.OPACITY));
    expect(surfaceNodes(material).position).toBe(positionLocal);
    const tint = sourceMaterialNode<"vec3">(material, MaterialNode.COLOR).mul(0.8);
    const firstOpacity = sourceMaterialNode<"float">(material, MaterialNode.OPACITY).mul(0.8);
    expect(composeSurface(material, {
      color: previous => { expect(referencesInput(previous, sourceMaterialNode(material, MaterialNode.COLOR))).toBe(true); return tint; },
      opacity: previous => { expect(previous).toBe(sourceMaterialNode(material, MaterialNode.OPACITY)); return firstOpacity; },
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
    expect(referencesInput(channels[1], sourceMaterialNode(material, MaterialNode.COLOR))).toBe(true);
    expect(surfaceNodes(material).opacity).toBe(sourceMaterialNode(material, MaterialNode.OPACITY));
  });
});


it("keeps surface color, opacity and mapped alpha on the actual source during shadow overrides", () => {
  const original = new MeshStandardNodeMaterial({ color: 0x123456, map: new Texture(), opacity: .7 });
  composeSurface(original, { color: previous => previous.mul(.8) });
  const clone = cloneNodeMaterial(original);
  clone.color.set(0xff0000); clone.opacity = .3; clone.map = new Texture();
  const shadow = new NodeMaterial() as NodeMaterial & { isShadowPassMaterial: boolean };
  shadow.isShadowPassMaterial = true;
  type PropertyNode = Node & { getCache(property: string, type: string): MaterialReferenceNode };
  const color = sourceMaterialNode(original, MaterialNode.COLOR) as PropertyNode;
  for (const [property, type, expected] of [
    ["color", "color", clone.color], ["map", "texture", clone.map], ["opacity", "float", .3],
  ] as const) {
    const reference = color.getCache(property, type);
    reference.updateReference({ material: shadow, renderer: { _currentSourceMaterial: clone } } as never);
    expect(reference.reference).toBe(clone);
    expect((reference.reference as unknown as Record<string, unknown>)[property]).toBe(expected);
    // Asynchronous compilation can run after the override context is restored.
    reference.updateReference({ material: shadow, renderer: {} } as never);
    expect(reference.reference).toBe(original);
    reference.updateReference({ material: clone, renderer: {} } as never);
    expect(reference.reference).toBe(clone);
  }
  expect(clone.colorNode).toBe(original.colorNode);
  expect(surfaceColorNode(original)).toBeTruthy();
});


it("reads raw custom properties from each clone without applying the surface map", () => {
  const owner = new MeshStandardNodeMaterial({ map: new Texture(), color: 0x123456 }) as MeshStandardNodeMaterial & { shimmer: number };
  owner.shimmer = .2;
  const clone = cloneNodeMaterial(owner) as MeshStandardNodeMaterial & { shimmer: number };
  clone.shimmer = .9; clone.color.set(0xff0000);
  const shadow = new NodeMaterial() as NodeMaterial & { isShadowPassMaterial: boolean };
  shadow.isShadowPassMaterial = true;
  const raw = sourceMaterialReference<"float">(owner, "shimmer", "float") as unknown as MaterialReferenceNode;
  const color = sourceMaterialReference<"color">(owner, "color", "color") as unknown as MaterialReferenceNode;
  for (const reference of [raw, color]) {
    reference.updateReference({ material: shadow, renderer: { _currentSourceMaterial: clone } } as never);
    expect(reference.reference).toBe(clone);
  }
  expect((raw.reference as typeof clone).shimmer).toBe(.9);
  expect((color.reference as typeof clone).color).toBe(clone.color);
  expect(raw.property).toBe("shimmer"); expect(color.property).toBe("color");
  expect(sourceMaterialReference(owner, "color", "color")).toBe(color);
});
