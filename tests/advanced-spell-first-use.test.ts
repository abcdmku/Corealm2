import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { SpellVfx, type SpellCastRequest } from "../game/src/render/spellVfx.js";
import { elementalDuration } from "../game/src/content/elementalFinales.js";
import { planElementalAttack } from "../game/src/systems/elementalAttacks.js";
import { ElementalSolids, ElementalVolumes, type VolumeShape } from "../game/src/render/elementalVolumes.js";

const request: SpellCastRequest = {
  id: "first-invocation", spellId: "furnace-whip", element: "fire", rung: "burst",
  from: [0, 1.2, 0], to: [0, 0, 8], impactPoint: [0, 0, 8], hit: false,
};
const pulses = planElementalAttack("furnace-whip", [0, 0, 0], request.to);
const duration = elementalDuration("furnace-whip", pulses.at(-1)!.at);

afterEach(() => vi.restoreAllMocks());

function harness(constructionMs: number) {
  // The wall clock has a separate origin from the caller's render clock. Boot can
  // take arbitrarily long without changing a later cast's caller-supplied timing.
  let wallMs = 40_000;
  let constructions = 0;
  vi.spyOn(performance, "now").mockImplementation(() => wallMs);
  const parent = new THREE.Group();
  parent.addEventListener("childadded", ({ child }) => {
    if (child.name !== "advanced-spell-cast") return;
    child.addEventListener("childadded", ({ child: effects }) => {
      if (effects.name !== "elemental-spell-effects") return;
      // This callback runs inside the real ElementalSpellVfx constructor. Advance
      // the clock without sleeping or replacing the production renderer.
      constructions += 1;
      wallMs += constructionMs;
    });
  });
  const vfx = new SpellVfx({ parent, camera: new THREE.PerspectiveCamera(), groundHeightAt: () => 0 });
  return {
    vfx, parent,
    constructions: () => constructions,
    elapseWall: (ms: number) => { wallMs += ms; },
    lights: () => {
      const lights: THREE.PointLight[] = [];
      parent.traverseVisible((object) => {
        if ((object as THREE.PointLight).isPointLight) lights.push(object as THREE.PointLight);
      });
      return lights;
    },
    art: () => parent.getObjectByName("elemental-spell-effects")!.userData["elementalArt"] as {
      fire: { variant: string; mainShapes: number }; contacts: string[];
    },
  };
}

describe("first advanced invocation", () => {
  it("allocates volume and solid colours before shader preparation and retains them at first use", () => {
    const parent = new THREE.Group(), volumes = new ElementalVolumes(parent), solids = new ElementalSolids(parent);
    const batches = parent.children as THREE.InstancedMesh[];
    const colours = batches.map(mesh => mesh.instanceColor);
    try {
      expect(batches).toHaveLength(6);
      expect(volumes.instances).toBe(0); expect(solids.instances).toBe(0);
      for (const mesh of batches) {
        expect(mesh.count).toBe(0);
        expect(mesh.instanceColor).toBeInstanceOf(THREE.InstancedBufferAttribute);
        expect(mesh.instanceColor!.count).toBe(mesh.instanceMatrix.count);
        expect(mesh.instanceColor!.itemSize).toBe(3);
        expect(mesh.instanceColor!.usage).toBe(THREE.DynamicDrawUsage);
        expect([...mesh.instanceColor!.array].every(value => value === 1)).toBe(true);
      }
      volumes.begin(0, 0.4);
      for (const kind of ["sphere", "tube", "ring", "funnel"] as VolumeShape[]) {
        volumes.put(kind, 0, 1, 0, 1, 1, 1, 0x8844cc, 1, 7);
      }
      volumes.end();
      solids.begin();
      solids.put("stone", 0, 1, 0, 1, 1, 1, 0x8844cc, 7);
      solids.put("ice", 0, 1, 0, 1, 1, 1, 0x8844cc, 7);
      solids.end();
      const actual = new THREE.Color();
      for (const [index, mesh] of batches.entries()) {
        expect(mesh.instanceColor).toBe(colours[index]);
        expect(mesh.count).toBe(1);
        mesh.getColorAt(0, actual);
        const expected = new THREE.Color(0x8844cc).multiplyScalar(index < 4 ? 0.4 : 1);
        expect(actual.r).toBeCloseTo(expected.r, 6);
        expect(actual.g).toBeCloseTo(expected.g, 6);
        expect(actual.b).toBeCloseTo(expected.b, 6);
        expect(mesh.instanceColor!.version).toBeGreaterThan(0);
      }
    } finally { volumes.dispose(); solids.dispose(); }
    expect(parent.children).toEqual([]);
  });

  it("prepares its fixed lights before gameplay and preserves the first cast's pulse clock and duration", () => {
    const constructionMs = 5000;
    expect(constructionMs).toBeGreaterThan(duration);
    const h = harness(constructionMs), launched = 1000;
    try {
      expect(h.constructions()).toBe(1);
      expect(h.vfx.preparationRoot()).toBe(h.parent.getObjectByName("advanced-spell-cast"));
      const lights = h.lights();
      expect(lights).toHaveLength(4);
      expect(lights.every((light) => light.intensity === 0)).toBe(true);
      expect(h.vfx.getState()).toEqual([]);
      expect(h.vfx.liveParticles()).toBe(0);
      const idleMeshes: THREE.Object3D[] = [];
      h.parent.traverseVisible((object) => { if ((object as THREE.Mesh).isMesh) idleMeshes.push(object); });
      expect(idleMeshes).toEqual([]);
      h.vfx.cast(request, launched);
      // The launch subscriber runs after the RAF timestamp was captured. The first
      // older frame must keep the cast until its ordinary contact frame arrives.
      h.vfx.update(launched - 5);
      h.vfx.update(launched);
      expect(h.vfx.advancedState()).toMatchObject({ spellId: "furnace-whip", elapsed: 0 });
      expect(h.vfx.getState()).toHaveLength(1);
      expect(h.art().fire.variant).toBe("furnace-whip");
      expect(h.art().contacts).toHaveLength(pulses.length);

      const contact = pulses[0]!.at;
      h.elapseWall(contact);
      h.vfx.update(launched + contact);
      expect(h.vfx.advancedState()?.elapsed).toBe(contact);
      expect(h.art().fire.mainShapes).toBeGreaterThan(0);
      expect(h.vfx.liveParticles()).toBeGreaterThan(0);

      expect(h.lights()).toEqual(lights);
      h.vfx.update(launched + duration - 1);
      expect(h.vfx.getState()).toHaveLength(1);
      h.vfx.update(launched + duration);
      expect(h.vfx.advancedState()).toBeNull();
      expect(h.vfx.getState()).toEqual([]);
      expect(h.vfx.liveParticles()).toBe(0);
      expect(h.constructions()).toBe(1);
      expect(h.lights()).toEqual(lights);
    } finally { h.vfx.dispose(); }
    expect(h.parent.children).toHaveLength(0);
  });

  it("reuses the renderer without shifting later launches, duplicate events, or scaled pulse timing", () => {
    const constructionMs = 5000, h = harness(constructionMs);
    try {
      h.vfx.cast(request, 1000);
      h.vfx.update(1000 + duration);
      for (const timeScale of [0.5, 1, 20]) {
        const launched = 20_000 + timeScale * 10_000;
        const next = { ...request, id: `reused-${timeScale}`, timeScale };
        h.elapseWall(10_000);
        h.vfx.cast(next, launched);
        h.vfx.update(launched);
        expect(h.vfx.advancedState()?.elapsed).toBe(0);

        const contact = pulses[0]!.at / timeScale;
        h.vfx.cast(next, launched + contact / 2);
        h.vfx.update(launched + contact);
        expect(h.vfx.advancedState()?.elapsed).toBeCloseTo(contact);
        expect(h.art().fire.mainShapes).toBeGreaterThan(0);
        expect(h.vfx.liveParticles()).toBeGreaterThan(0);

        h.vfx.update(launched + duration / timeScale - 0.1);
        expect(h.vfx.getState()).toHaveLength(1);
        h.vfx.update(launched + duration / timeScale);
        expect(h.vfx.getState()).toEqual([]);
      }
      expect(h.constructions()).toBe(1);
    } finally { h.vfx.dispose(); }
  });
});
