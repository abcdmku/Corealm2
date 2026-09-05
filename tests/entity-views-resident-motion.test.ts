import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { RegionId, SemanticEntity, Vec3 } from "../game/src/contracts.js";
import { EntityViews } from "../game/src/render/entityViews.js";
import { MaterialLibrary } from "../game/src/render/materials.js";

function actor(id: string, position: Vec3 = [0, 0, 0], regionId: RegionId = "fallowmarch"): SemanticEntity {
  return {
    id, name: id, archetype: "enemy", tier: 1, regionId, position,
    state: "alive", interactions: ["inspect", "attack"],
    view: { assetId: "test_creature", gaitSpeedMps: 1.2 },
  };
}

async function fixture(entities: SemanticEntity[], radius = 12) {
  const source = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const vertices = geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(vertices * 4), 4));
  const weights = new Float32Array(vertices * 4);
  for (let i = 0; i < vertices; i += 1) weights[i * 4] = 1;
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  const material = new THREE.MeshStandardMaterial({ name: "animal_test_mat" });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  const bone = new THREE.Bone();
  bone.name = "Resident_Spine";
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  source.add(mesh);
  source.updateMatrixWorld(true);
  const clips = ["Idle", "Walk", "Run", "Attack", "Hit", "Death"].map((name) => (
    new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack(
      "Resident_Spine.position", [0, 0.5, 1],
      [0, 0, 0, 0, 0.3, 0, 0, name === "Death" ? -0.5 : 0, 0],
    )])
  ));
  const propGeometry = new THREE.BoxGeometry(1, 1, 1);
  const propSource = new THREE.Group();
  propSource.add(new THREE.Mesh(propGeometry, material));
  const assets = {
    entry: (id: string) => ({
      id, animations: id === "test_creature" ? clips.map((clip) => clip.name) : [],
      size: { x: 1, y: 1, z: 1 }, impliedWalkMps: 1, impliedRunMps: 2,
    }),
    isLoaded: () => true,
    load: async (id: string) => id === "test_creature" ? source : propSource,
    instance: (id: string) => id === "test_creature" ? source : propSource,
    clipOf: (_asset: string, name: string) => clips.find((clip) => clip.name === name),
    clip: () => undefined,
  };
  const scene = { entityGroup: new THREE.Group(), overlayGroup: new THREE.Group() };
  const materials = new MaterialLibrary();
  const views = new EntityViews(scene, assets as never, materials, {
    maxUniqueViews: 1, maxUniqueDrawCalls: 8, maxAnimatedViews: 1,
  });
  await views.prepare(entities);
  views.updateActiveArea([0, 0, 0], radius);
  views.update(0, new THREE.Vector3(100, 0, 0));
  views.sync(entities);
  return {
    views, scene,
    dispose() {
      views.dispose(); materials.dispose(); geometry.dispose(); propGeometry.dispose(); material.dispose();
    },
  };
}

function rejectFurtherMotionReads(entity: SemanticEntity): void {
  Object.defineProperty(entity, "archetype", {
    configurable: true,
    get() { throw new Error(`Motion visited stale entity ${entity.id}`); },
  });
}

describe("EntityViews resident motion", () => {
  it("reads current position and facing between structural syncs with the same interpolation", async () => {
    const entity = actor("walker");
    const f = await fixture([entity]);
    try {
      entity.position = [2, 0, 0];
      entity.view!.rotationY = Math.PI / 2;
      f.views.syncResidentMotion(0.25);
      expect(f.views.motionSnapshot(entity.id)).toMatchObject({
        semanticPosition: [2, 0, 0], drawnPosition: [0.5, 0, 0],
        semanticRotationY: Math.PI / 2, drawnRotationY: Math.PI / 8, motion: "walk",
      });
      f.views.syncResidentMotion(0.75);
      expect(f.views.motionSnapshot(entity.id)!.drawnPosition).toEqual([1.5, 0, 0]);
      f.views.syncResidentMotion();
      expect(f.views.motionSnapshot(entity.id)!.drawnPosition).toEqual([2, 0, 0]);
    } finally { f.dispose(); }
  });

  it("replaces an object even when its id and structural signature are unchanged", async () => {
    const original = actor("walker");
    const f = await fixture([original]);
    try {
      const replacement = structuredClone(original);
      f.views.sync([replacement]);
      rejectFurtherMotionReads(original);
      replacement.position = [3, 0, 0];
      f.views.syncResidentMotion();
      expect(f.views.motionSnapshot(replacement.id)!.drawnPosition).toEqual([3, 0, 0]);
    } finally { f.dispose(); }
  });

  it("drops despawned references and accepts a later actor reusing the id", async () => {
    const removed = actor("reused-id");
    const survivor = actor("survivor", [1, 0, 0]);
    const f = await fixture([removed, survivor]);
    try {
      f.views.sync([survivor]);
      rejectFurtherMotionReads(removed);
      survivor.position = [2, 0, 0];
      f.views.syncResidentMotion();
      expect(f.views.has(removed.id)).toBe(false);
      expect(f.views.motionSnapshot(survivor.id)!.drawnPosition).toEqual([2, 0, 0]);
      const replacement = actor(removed.id, [4, 0, 0]);
      f.views.sync([survivor, replacement]);
      replacement.position = [5, 0, 0];
      f.views.syncResidentMotion();
      expect(f.views.motionSnapshot(replacement.id)!.drawnPosition).toEqual([5, 0, 0]);
    } finally { f.dispose(); }
  });

  it("follows realm-filtered snapshots without retaining the previous realm's actors", async () => {
    const surface = actor("surface");
    const dungeon = actor("dungeon", [0, -40, 0], "gravelmaw");
    const f = await fixture([surface]);
    try {
      f.views.sync([dungeon]);
      rejectFurtherMotionReads(surface);
      dungeon.position = [2, -40, 0];
      f.views.syncResidentMotion();
      expect(f.views.residencyStats().residentIds).toEqual([dungeon.id]);
      expect(f.views.motionSnapshot(dungeon.id)!.drawnPosition).toEqual([2, -40, 0]);
      const returned = actor(surface.id);
      f.views.sync([returned]);
      rejectFurtherMotionReads(dungeon);
      returned.position = [3, 0, 0];
      f.views.syncResidentMotion();
      expect(f.views.residencyStats().residentIds).toEqual([returned.id]);
      expect(f.views.motionSnapshot(returned.id)!.drawnPosition).toEqual([3, 0, 0]);
    } finally { f.dispose(); }
  });

  it("adopts newly resident actors when the active area moves between structural syncs", async () => {
    const near = actor("near");
    const distant = actor("distant", [80, 0, 0]);
    const f = await fixture([near, distant]);
    try {
      expect(f.views.has(distant.id)).toBe(false);
      distant.position = [81, 0, 0];
      f.views.updateActivePosition([80, 0, 0]);
      rejectFurtherMotionReads(near);
      distant.position = [82, 0, 0];
      f.views.syncResidentMotion();
      expect(f.views.has(near.id)).toBe(false);
      expect(f.views.motionSnapshot(distant.id)!.drawnPosition).toEqual([82, 0, 0]);
    } finally { f.dispose(); }
  });

  it("does no per-frame motion reads for 800 nonresident actors or resident static props", async () => {
    const near = actor("near");
    const distant = Array.from({ length: 800 }, (_, i) => actor(`distant-${i}`, [1000 + i, 0, 0]));
    const prop: SemanticEntity = {
      ...actor("prop", [2, 0, 0]), archetype: "obstacle", interactions: [], view: { assetId: "test_prop" },
    };
    const f = await fixture([near, ...distant, prop]);
    try {
      expect(f.views.residencyStats().residentIds).toEqual([near.id, prop.id]);
      for (const entity of [...distant, prop]) rejectFurtherMotionReads(entity);
      near.position = [1, 0, 0];
      f.views.syncResidentMotion();
      expect(f.views.motionSnapshot(near.id)!.drawnPosition).toEqual([1, 0, 0]);
    } finally { f.dispose(); }
  });

  it("removes a resident mover when the same id becomes a static prop", async () => {
    const original = actor("changed-kind");
    const f = await fixture([original]);
    try {
      const prop: SemanticEntity = { ...original, archetype: "obstacle", view: { assetId: "test_prop" } };
      await f.views.prepare([prop]);
      f.views.sync([prop]);
      rejectFurtherMotionReads(original);
      rejectFurtherMotionReads(prop);
      prop.position = [4, 0, 0];
      f.views.syncResidentMotion();
      expect(f.views.motionSnapshot(prop.id)!.drawnPosition).toEqual([0, 0, 0]);
    } finally { f.dispose(); }
  });

  it("preserves explicit-set syncMotion without changing the authoritative resident references", async () => {
    const a = actor("a");
    const b = actor("b", [1, 0, 0]);
    const f = await fixture([a, b]);
    try {
      a.position = [2, 0, 0];
      b.position = [4, 0, 0];
      f.views.syncMotion([a]);
      expect(f.views.motionSnapshot(a.id)!.drawnPosition).toEqual([2, 0, 0]);
      expect(f.views.motionSnapshot(b.id)!.drawnPosition).toEqual([1, 0, 0]);
      f.views.syncResidentMotion();
      expect(f.views.motionSnapshot(b.id)!.drawnPosition).toEqual([4, 0, 0]);
    } finally { f.dispose(); }
  });

  it("matches explicit-set creature phases and poses through movement, rig changes and actions", async () => {
    const entities = [actor("a"), actor("b", [3, 0, 0])];
    const explicitEntities = structuredClone(entities);
    const resident = await fixture(entities);
    const explicit = await fixture(explicitEntities);
    try {
      for (let frame = 0; frame < 12; frame += 1) {
        const alpha = [0.1, 0.5, 0.9][frame % 3]!;
        const viewer = new THREE.Vector3(frame >= 3 && frame < 8 ? 100 : 0, 0, 0);
        for (const list of [entities, explicitEntities]) {
          if (frame % 3 === 0) for (const entity of list) {
            const [x, y, z] = entity.position;
            entity.position = [x + 0.12, y, z];
            entity.view!.rotationY = frame * 0.1;
          }
        }
        if (frame === 4) {
          resident.views.sync(entities);
          explicit.views.sync(explicitEntities);
        }
        if (frame === 6) for (const f of [resident, explicit]) {
          expect(f.views.playAction("a", "attack", { durationSeconds: 1 })).toBe(true);
        }
        resident.views.syncResidentMotion(alpha);
        explicit.views.syncMotion(explicitEntities, alpha);
        resident.views.update(1 / 30, viewer);
        explicit.views.update(1 / 30, viewer);
        for (const entity of entities) {
          expect(resident.views.motionSnapshot(entity.id)).toEqual(explicit.views.motionSnapshot(entity.id));
          expect(resident.views.drawnBounds(entity.id)).toEqual(explicit.views.drawnBounds(entity.id));
        }
      }
      expect(resident.views.motionSnapshot("a")).toMatchObject({ path: "live-rig", motion: "attack" });
      expect(resident.views.motionSnapshot("b")).toMatchObject({ path: "sampled-rig", motion: "walk" });
    } finally { resident.dispose(); explicit.dispose(); }
  });
});
