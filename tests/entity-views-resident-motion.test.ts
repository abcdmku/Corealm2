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

async function fixture(entities: SemanticEntity[], radius = 12, directionalHits = false, speedMatched = false) {
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
  const head = new THREE.Bone(); head.name = 'Resident_Head';
  const leg = new THREE.Bone(); leg.name = 'Resident_Foot';
  bone.add(head, leg);
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone, head, leg]));
  source.add(mesh);
  source.updateMatrixWorld(true);
  const clips = ["Idle", "Walk", "Run", "Attack", "Hit", "Death", ...(directionalHits ? ["HitLeft", "HitRight"] : [])].map((name) => (
    new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack(
      "Resident_Spine.position", [0, 0.5, 1],
      [0, 0, 0, 0, 0.3, 0, 0, name === "Death" ? -0.5 : 0, 0],
    ), new THREE.QuaternionKeyframeTrack('Resident_Head.quaternion', [0, .5, 1],
      [0, 0, 0, 1, ...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), name.startsWith('Hit') ? .4 : .02).toArray(), 0, 0, 0, 1])])
  ));
  const propGeometry = new THREE.BoxGeometry(1, 1, 1);
  const propSource = new THREE.Group();
  propSource.add(new THREE.Mesh(propGeometry, material));
  const assets = {
    entry: (id: string) => ({
      id, animations: id === "test_creature" ? clips.map((clip) => clip.name) : [],
      size: { x: 1, y: 1, z: 1 }, impliedWalkMps: 1, impliedRunMps: speedMatched ? 7 : 2,
      ...(speedMatched ? { locomotionPolicy: "speed-matched" as const } : {}),
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
  it("lets the visible loot behind a dissolved unique corpse receive the ray pick", async () => {
    const corpse = actor('fallen-keeper');
    const loot: SemanticEntity = { id: 'keeper-loot', name: 'Keeper loot', archetype: 'loot', tier: 50,
      regionId: 'fallowmarch', position: [0, 0, -3], state: 'available', interactions: ['inspect'],
      view: { assetId: 'test_loot' } };
    const f = await fixture([corpse, loot]);
    try {
      const ray = new THREE.Raycaster(new THREE.Vector3(0, .2, 5), new THREE.Vector3(0, 0, -1));
      f.views.update(0, new THREE.Vector3(), 0);
      f.scene.entityGroup.updateMatrixWorld(true);
      expect(f.views.pick(ray)).toBe(corpse.id);
      corpse.state = 'dead'; corpse.view!.diedAtMs = 0;
      f.views.sync([corpse, loot]);
      f.views.update(5, new THREE.Vector3(), 5000);
      f.scene.entityGroup.updateMatrixWorld(true);
      expect(f.views.pickAll(ray)).toEqual([loot.id]);
    } finally { f.dispose(); }
  });
  it("keeps nearby live rigs drawable when pose changes invalidate cached bounds", async () => {
    const entity = actor("animated-bounds");
    const f = await fixture([entity]);
    try {
      f.views.update(0, new THREE.Vector3());
      const meshes: THREE.SkinnedMesh[] = [];
      f.scene.entityGroup.traverse(object => {
        if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh);
      });
      expect(meshes.length).toBeGreaterThan(0);
      // A previous pose can leave a sphere far from the currently animated body.
      for (const mesh of meshes) mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(1000, 0, 0), 0.1);
      f.views.playAction(entity.id, "attack");f.views.update(0.25, new THREE.Vector3());
      expect(meshes.every(mesh => !mesh.frustumCulled && mesh.visible)).toBe(true);
      f.views.update(0, new THREE.Vector3(100, 0, 0));
      expect(f.views.motionSnapshot(entity.id)?.path).toBe("sampled-rig");
    } finally { f.dispose(); }
  });
  it('keeps running phase and translation while overlaying Hit, without touching support bones', async () => {
    for (const viewer of [new THREE.Vector3(), new THREE.Vector3(100, 0, 0)]) {
      const entity = actor('moving-hit'); entity.state='aggro';
      const control = structuredClone(entity);
      const f = await fixture([entity], 12, true), baseline = await fixture([control], 12, true);
      try {
        f.views.update(0, viewer); baseline.views.update(0, viewer);
        entity.position = [.468, 0, 0]; control.position=[.468,0,0];
        f.views.syncResidentMotion(.25); baseline.views.syncResidentMotion(.25);
        expect(f.views.motionSnapshot(entity.id)!.drawnPosition[0]).toBeCloseTo(.117);
        const before=f.views.motionSnapshot(entity.id)!;
        expect(f.views.playAction(entity.id, 'hit', { impactSide: 'right', durationSeconds: .5 })).toBe(true);
        expect(f.views.motionSnapshot(entity.id)!.drawnPosition).toEqual(before.drawnPosition);
        expect(f.views.motionSnapshot(entity.id)!.time).toBe(before.time);
        for (const alpha of [.3, .75, .99, .1]) {
          entity.position=[entity.position[0]+.1,0,0]; control.position=[...entity.position];
          f.views.syncResidentMotion(alpha); baseline.views.syncResidentMotion(alpha);
          f.views.update(.05, viewer); baseline.views.update(.05, viewer);
          const actual=f.views.motionSnapshot(entity.id)!, expected=baseline.views.motionSnapshot(entity.id)!;
          expect(actual).toMatchObject({ clip: 'Run', hitOverlay: { clip: 'HitRight_MaskedOverlay', active:true } });
          expect(actual.time).toBeCloseTo(expected.time!); expect(actual.drawnPosition).toEqual(expected.drawnPosition);
        }
        if(viewer.x===0) {
          const root=(f.views as any).records.get(entity.id).rig.root as THREE.Object3D;
          const base=(baseline.views as any).records.get(entity.id).rig.root as THREE.Object3D;
          expect(root.getObjectByName('Resident_Foot')!.matrixWorld.elements).toEqual(base.getObjectByName('Resident_Foot')!.matrixWorld.elements);
          expect(root.getObjectByName('Resident_Head')!.quaternion.angleTo(base.getObjectByName('Resident_Head')!.quaternion)).toBeGreaterThan(.1);
        }
        f.views.update(.25, viewer); f.views.update(.1, viewer);
        expect(f.views.motionSnapshot(entity.id)!.hitOverlay).toBeNull();
      } finally { f.dispose(); baseline.dispose(); }
    }
  });
  it("matches measured strides above former rate and cadence caps in both residency paths", async () => {
    const entities = [actor('fast-a'), actor('fast-b', [3, 0, 0])];
    for (const entity of entities) { entity.state = 'aggro'; entity.view!.gaitSpeedMps = 12; }
    const f = await fixture(entities);
    try {
      f.views.update(0, new THREE.Vector3());
      for (const entity of entities) entity.position = [entity.position[0] + .1, 0, 0];
      f.views.syncResidentMotion();
      const paths = new Set<string | null>();
      for (const entity of entities) {
        const motion = f.views.motionSnapshot(entity.id)!;
        paths.add(motion.path);
        expect(motion.clip).toBe('Run');
        expect(motion.timeScale).toBeCloseTo(12 / (2 * motion.drawnStrideScale));
        expect(motion.timeScale).toBeGreaterThan(3.2);
      }
      expect(paths).toEqual(new Set(['live-rig', 'sampled-rig']));
    } finally { f.dispose(); }
  });

  it("allows committed swings while a separate directional overlay remains active", async () => {
    const entity = actor('recoil');
    const f = await fixture([entity], 12, true);
    try {
      const viewer = new THREE.Vector3(100, 0, 0);
      expect(f.views.actionDurationSeconds(entity.id, 'hit', 'left')).toBe(1);
      expect(f.views.actionDurationSeconds('absent', 'hit')).toBeNull();
      expect(f.views.playAction(entity.id, 'hit', { impactSide: 'left', durationSeconds: .5 })).toBe(true);
      expect(f.views.playAction(entity.id, 'attack')).toBe(true);
      f.views.update(.25, viewer);
      expect(f.views.motionSnapshot(entity.id)).toMatchObject({ clip: 'Attack', hitOverlay:{clip:'HitLeft_MaskedOverlay',time:.5} });
      f.views.update(.25, viewer);
      entity.position = [.2, 0, 0]; f.views.syncResidentMotion();
      expect(f.views.motionSnapshot(entity.id)?.hitOverlay).toBeNull();
      expect(f.views.playAction(entity.id, 'attack')).toBe(true);
    } finally { f.dispose(); }
  });
  it("uses the speed-matched walk clock for slow pursuit in live and sampled rigs without changing combat intent", async () => {
    const entities = [actor("slow-a"), actor("slow-b", [3, 0, 0])];
    for (const entity of entities) entity.state = "aggro";
    const f = await fixture(entities, 12, false, true);
    try {
      f.views.update(0, new THREE.Vector3(0, 0, 0));
      for (const entity of entities) entity.position = [entity.position[0] + .1, 0, 0];
      f.views.syncResidentMotion();
      const paths = new Set<string | null>();
      for (const entity of entities) {
        const motion = f.views.motionSnapshot(entity.id)!;
        paths.add(motion.path);
        expect(motion).toMatchObject({ motion: "run", clip: "Walk" });
        expect(motion.timeScale).toBeCloseTo(1.2 / motion.drawnStrideScale);
        expect(entity.state).toBe("aggro");
      }
      expect(paths).toEqual(new Set(["live-rig", "sampled-rig"]));
      // The same pursuit intent crosses the gait midpoint, without requiring an idle transition.
      for (const entity of entities) { entity.view!.gaitSpeedMps = 8; entity.position = [entity.position[0] + .1, 0, 0]; }
      f.views.syncResidentMotion();
      for (const entity of entities) expect(f.views.motionSnapshot(entity.id)).toMatchObject({ motion: "run", clip: "Run" });
      // Native-clip authoring remains explicit even on an opted-in asset.
      entities[0]!.view!.gaitSpeedMps = 1.2;
      expect(f.views.setLocomotion(entities[0]!.id, "run")).toBe(true);
      expect(f.views.motionSnapshot(entities[0]!.id)).toMatchObject({ motion: "run", clip: "Run" });
    } finally { f.dispose(); }
  });

  it("returns the nearest actual tall-door intersection distance instead of its distant base", async () => {
    const f = await fixture([]);
    const geometry = new THREE.BoxGeometry(4, 10, 1);
    const material = new THREE.MeshBasicMaterial();
    const front = new THREE.Mesh(geometry, material);
    const rear = new THREE.Mesh(geometry, material);
    front.position.set(0, 5, 4); front.userData.entityId = "front-door";
    rear.position.set(0, 5, 0); rear.userData.entityId = "rear-door";
    f.scene.entityGroup.children[0]!.add(rear, front);
    f.scene.entityGroup.updateMatrixWorld(true);
    try {
      const ray = new THREE.Raycaster(new THREE.Vector3(0, 8, 10), new THREE.Vector3(0, 0, -1));
      expect(f.views.pickHit(ray)).toEqual({ entityId: "front-door", distance: 5.5 });
      expect(f.views.pick(ray)).toBe("front-door");
      expect(f.views.pickAll(ray)).toEqual(["front-door", "rear-door"]);
      // A terrain hit at 8 m is behind the door, although the camera-to-base distance is 10 m.
      expect(f.views.pickHit(ray)!.distance).toBeLessThan(8);
    } finally { f.dispose(); geometry.dispose(); material.dispose(); }
  });
  it("selects requested authored hit sides in sampled and live rigs, with ordinary-hit fallback", async () => {
    for (const directional of [false, true]) {
      const f = await fixture([actor("hit-target")], 12, directional);
      try {
        for (const viewer of [new THREE.Vector3(100, 0, 0), new THREE.Vector3(0, 0, 0)]) {
          f.views.update(0, viewer);
          for (const side of ["left", "right", "front"] as const) {
            expect(f.views.playAction("hit-target", "hit", { impactSide: side, durationSeconds: 0.5 })).toBe(true);
            f.views.update(0.1, viewer);
            const expected = directional && side !== "front" ? side === "left" ? "HitLeft" : "HitRight" : "Hit";
            expect(f.views.motionSnapshot("hit-target")).toMatchObject({ motion: "idle", clip: 'Idle', hitOverlay:{clip:`${expected}_MaskedOverlay`,time:.2} });
            expect(f.views.drawnBounds("hit-target")).not.toBeNull();
          }
        }
      } finally { f.dispose(); }
    }
  });
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
