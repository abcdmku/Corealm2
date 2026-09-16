import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CorealmGameApi } from "../game/src/api/gameApi.js";
import { createTools } from "../game/src/agent/tools.js";
import { Overlays } from "../game/src/render/overlays.js";
import type { GameApi, SemanticEntity } from "../game/src/contracts.js";
import { ok } from "../game/src/contracts.js";

const TOWN_POSITION = [-160, 0.89, -80] as const;

function overlayHarness() {
  const entity: SemanticEntity = {
    id: "moving_target",
    archetype: "npc",
    name: "Moving Target",
    tier: 1,
    regionId: "fallowmarch",
    position: [4, 0, 8],
    state: "idle",
    interactions: ["inspect"],
  };
  const set = vi.fn(() => 1);
  const api = new CorealmGameApi(
    { get: () => ({ player: { health: 10, position: [0, 0, 0] } }), markDirty: vi.fn() } as never,
    {} as never,
    { routeNode: (id: string) => id === "town_center" ? { position: [...TOWN_POSITION] } : undefined } as never,
    {} as never,
    { elapsedMs: 0 } as never,
  );
  api.register("entities", {
    get: (id) => id === entity.id ? entity : undefined,
    all: () => [entity],
    observe: () => [],
  });
  api.register("overlays", { set, clear: () => 0 });
  return { api, entity, set };
}

describe("overlay target resolution", () => {
  it("repairs a pure location id mistakenly supplied as entityId", () => {
    const { api, set } = overlayHarness();

    expect(api.overlay("set", {
      id: "town",
      kind: "marker",
      entityId: "town_center",
    })).toEqual(ok({ activeCount: 1 }));
    expect(set).toHaveBeenCalledWith({
      id: "town",
      kind: "marker",
      locationId: "town_center",
      position: [...TOWN_POSITION],
    });
  });

  it("resolves an explicit locationId and preserves real entity following", () => {
    const { api, entity, set } = overlayHarness();

    expect(api.overlay("set", {
      id: "town",
      kind: "label",
      locationId: "town_center",
      text: "Coldbrace Square",
    })).toEqual(ok({ activeCount: 1 }));
    expect(set).toHaveBeenLastCalledWith({
      id: "town",
      kind: "label",
      locationId: "town_center",
      position: [...TOWN_POSITION],
      text: "Coldbrace Square",
    });

    expect(api.overlay("set", {
      id: "target",
      kind: "highlight",
      entityId: entity.id,
    })).toEqual(ok({ activeCount: 1 }));
    expect(set).toHaveBeenLastCalledWith({
      id: "target",
      kind: "highlight",
      entityId: entity.id,
    });
  });

  it("rejects unknown and anchorless overlays without drawing", () => {
    const { api, set } = overlayHarness();

    expect(api.overlay("set", {
      id: "missing",
      kind: "marker",
      entityId: "not_real",
    })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(api.overlay("set", {
      id: "nowhere",
      kind: "label",
      text: "Nowhere",
    })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(set).not.toHaveBeenCalled();
  });
});

describe("corealm_overlay tool contract", () => {
  it("advertises locationId and forwards it to the canonical API", async () => {
    const overlay = vi.fn(() => ok({ activeCount: 1 }));
    const tool = createTools({ overlay } as unknown as GameApi)
      .find((candidate) => candidate.name === "corealm_overlay");
    if (!tool) throw new Error("corealm_overlay is missing");

    const properties = tool.inputSchema["properties"] as Record<string, unknown>;
    expect(properties).toHaveProperty("locationId");
    expect(tool.description).toMatch(/unknown targets return NOT_FOUND/i);
    await expect(Promise.resolve(tool.execute({
      op: "set",
      id: "town",
      kind: "marker",
      locationId: "town_center",
    }))).resolves.toEqual({ activeCount: 1 });
    expect(overlay).toHaveBeenCalledWith("set", {
      id: "town",
      kind: "marker",
      locationId: "town_center",
    });
  });
});

describe("overlay renderer fallback", () => {
  it('reuses immediate hollow walk feedback and conforms it to the active map instead of the main terrain', () => {
    const root = new THREE.Group();
    const ground = (x: number, z: number) => -20 + x * .4 + z * .2;
    const overlays = new Overlays({scene:{overlayGroup:root,heightAtXZ:()=>500} as never,
      camera:new THREE.PerspectiveCamera(),entityPosition:()=>null,labelRoot:{} as HTMLElement,
      groundHeightAt:ground});
    const marker = overlays.preparationRoot(); const added = vi.fn();
    marker.parent!.addEventListener('childadded', added);
    for (const position of [[3,ground(3,4),4],[8,ground(8,-1),-1]] as const) {
      overlays.setWalkDestination('walk',position,0); overlays.update(0);
      expect(overlays.preparationRoot()).toBe(marker); expect(marker.visible).toBe(true);
      const ring = marker.getObjectByName('walk-ring') as THREE.Mesh;
      const geometry = ring.geometry as THREE.RingGeometry;
      expect(geometry.parameters.innerRadius).toBeGreaterThan(.5);
      expect(geometry.getAttribute('color').itemSize).toBe(4);
      const vertices = geometry.getAttribute('position');
      for (let i=0;i<vertices.count;i++) expect(position[1]+vertices.getY(i))
        .toBeCloseTo(ground(position[0]+vertices.getX(i),position[2]+vertices.getZ(i))+.025,5);
      expect(marker.children.map(child=>child.name)).toEqual(['walk-ring','walk-beam']);
      overlays.clear('walk'); expect(marker.visible).toBe(false);
    }
    expect(added).not.toHaveBeenCalled();
  });
  it("never creates an unresolved marker at world origin", () => {
    const overlayGroup = new THREE.Group();
    const overlays = new Overlays({
      scene: {
        overlayGroup,
        heightAtXZ: () => 0,
      } as never,
      camera: new THREE.PerspectiveCamera(),
      entityPosition: () => null,
      labelRoot: {} as HTMLElement,
    });

    expect(overlays.set({ id: "missing", kind: "marker", entityId: "not_real" }, 0)).toBe(0);
    expect(overlays.list()).toEqual([]);
    expect(overlayGroup.getObjectByName("overlays")?.children.filter(child => child.visible)).toHaveLength(0);
  });
});
