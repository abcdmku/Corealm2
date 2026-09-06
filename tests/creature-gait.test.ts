import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import type { SemanticEntity } from "../game/src/contracts.js";
import { ENEMY_BLOCKS, enemyBlockFor } from "../game/src/content/enemies.js";
import { REGIONS } from "../game/src/content/regions.js";
import { ENEMY_RETURN_SPEED_MPS, ENEMY_SPEED_MPS } from "../game/src/systems/enemyAI.js";
import { CREATURE_RUN_SPEED } from "../game/src/app/config.js";
import { EntityViews, MOVING_EPSILON } from "../game/src/render/entityViews.js";
import { MaterialLibrary } from "../game/src/render/materials.js";
import { playbackTime } from "../game/src/render/creatureMotion.js";
import { SIM_TICK_MS } from "../game/src/core/time.js";
import MANIFEST from "../game/public/assets/manifest.json" with { type: "json" };

const ASSET_BY_ID = new Map(MANIFEST.assets.map((asset) => [asset.id, asset] as const));
const GROUPS = REGIONS.flatMap((region) => [...region.enemyGroups, ...(region.dungeon?.enemyGroups ?? [])]);
const TICK_SECONDS = SIM_TICK_MS / 1000;
const FRAMES = [0, 0.25, 0.5, 0.75];
interface Gait {
  entityId: string; gait: "walk" | "run" | "return"; impliedMps: number; drawnStrideScale: number;
  speedMps: number; rate: number; cadenceHz: number; slide: number;
}

/** The real renderer consumes shipped timing and production entity transforms.
 * This small skeleton isolates playback policy; the asset-build contact audits inspect real feet.
 */
async function fixture(entities: SemanticEntity[]) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4);
  for (let index = 0; index < count; index += 1) weights[index * 4] = 1;
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  const material = new THREE.MeshStandardMaterial({ name: "animal_gait_test_mat" });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  const bone = new THREE.Bone();
  bone.name = "Gait_Spine";
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  const source = new THREE.Group();
  source.add(mesh);
  source.updateMatrixWorld(true);
  const clips = new Map<string, THREE.AnimationClip[]>();
  for (const entity of entities) {
    const assetId = entity.view!.assetId;
    const entry = ASSET_BY_ID.get(assetId)!;
    clips.set(assetId, (entry.animations ?? []).map((name) => {
      const duration = name === "Walk" ? entry.walkClipSeconds ?? 1
        : name === "Run" ? entry.runClipSeconds ?? entry.walkClipSeconds ?? 1 : 1;
      return new THREE.AnimationClip(name, duration, [new THREE.VectorKeyframeTrack(
        "Gait_Spine.position", [0, duration / 2, duration], [0, 0, 0, 0, 0.01, 0, 0, 0, 0],
      )]);
    }));
  }
  const assets = {
    entry: (id: string) => ASSET_BY_ID.get(id),
    isLoaded: () => true, load: async () => source, instance: () => source,
    clipOf: (id: string, name: string) => clips.get(id)?.find((clip) => clip.name === name),
    clip: () => undefined,
  };
  const materials = new MaterialLibrary();
  const views = new EntityViews(
    { entityGroup: new THREE.Group(), overlayGroup: new THREE.Group() }, assets as never, materials,
    { maxUniqueViews: 1, maxUniqueDrawCalls: 8, maxAnimatedViews: 1 },
  );
  await views.prepare(entities);
  views.updateActiveArea([0, 0, 0], 180);
  views.sync(entities);
  views.update(0, new THREE.Vector3());
  return { views, dispose() { views.dispose(); materials.dispose(); geometry.dispose(); material.dispose(); } };
}

const gaits: Gait[] = [];
beforeAll(async () => {
  const entities: SemanticEntity[] = GROUPS.filter((group) => ASSET_BY_ID.get(group.assetId)?.impliedWalkMps)
    .flatMap((group) => Array.from({ length: group.count }, (_, index): SemanticEntity => {
      const block = enemyBlockFor(group.id, group.family, group.tier)!;
      return {
        id: group.count === 1 ? group.id : `${group.id}_${index + 1}`, name: group.name,
        archetype: group.boss || group.miniBoss ? "boss" : "enemy", tier: group.tier,
        regionId: "fallowmarch", position: [0, 0, 0], state: "alive", interactions: ["inspect", "attack"],
        combat: {
          health: block.maxHealth, maxHealth: block.maxHealth, level: 1, aggroRadius: block.aggroRadius,
          walkSpeedMps: block.walkSpeedMps, moveSpeedMps: block.moveSpeedMps,
        },
        view: {
          assetId: group.assetId, scale: group.scale * (group.boss ? 1.6 : group.miniBoss ? 1.3 : 1), rotationY: 0,
        },
      };
    }));
  const f = await fixture(entities);
  try {
    for (const gait of ["walk", "run", "return"] as const) {
      for (const entity of entities) {
        // `systems/enemyAI.ts` steps every pursuit at CREATURE_RUN_SPEED and every return at
        // ENEMY_RETURN_SPEED_MPS; authored `moveSpeedMps` only seeds the unauthored walk fallback.
        const pursuit = entity.combat!.moveSpeedMps ?? CREATURE_RUN_SPEED;
        const speed = gait === "walk" ? entity.combat!.walkSpeedMps ?? pursuit / 3
          : gait === "return" ? ENEMY_RETURN_SPEED_MPS : CREATURE_RUN_SPEED;
        entity.state = gait === "walk" ? "alive" : gait === "run" ? "aggro" : "returning";
        entity.view!.gaitSpeedMps = speed;
        entity.position = [0, 0, entity.position[2] + speed * TICK_SECONDS];
      }
      f.views.syncMotion(entities);
      f.views.update(0, new THREE.Vector3());
      for (const entity of entities) {
        const entry = ASSET_BY_ID.get(entity.view!.assetId)!;
        const state = f.views.motionSnapshot(entity.id)!;
        const implied = state.clip === "Run" ? entry.impliedRunMps : entry.impliedWalkMps;
        if (!implied || (implied < 0.15 && !entity.view!.assetId.startsWith("creature_"))) continue;
        // A snail's body wave has no planted limb contact to compare with translation.
        if (entity.view!.assetId === "creature_quarry_snail") continue;
        expect(state.motion, `${entity.id} ${gait} motion`).toBe(gait === "walk" ? "walk" : "run");
        const speedMps = entity.view!.gaitSpeedMps!;
        gaits.push({
          entityId: entity.id, gait, impliedMps: implied, drawnStrideScale: state.drawnStrideScale,
          speedMps, rate: state.timeScale!, cadenceHz: state.timeScale! / state.duration!,
          slide: Math.abs(1 - implied * state.drawnStrideScale * state.timeScale! / speedMps),
        });
      }
    }
  } finally { f.dispose(); }
});

describe("creature gait", () => {
  it("ships a walk cycle for every authored animal and expansion creature", () => {
    const missing = GROUPS.filter((group) => /^(animal|creature)_/.test(group.assetId))
      .filter((group) => !ASSET_BY_ID.get(group.assetId)?.animations?.some((name) => /^walk$/i.test(name)))
      .map((group) => group.assetId);
    expect([...new Set(missing)]).toEqual([]);
  });

  it("uses authored speeds for every measured walk and pursuit", () => {
    for (const group of GROUPS) {
      if (!ASSET_BY_ID.get(group.assetId)?.impliedWalkMps) continue;
      const block = enemyBlockFor(group.id, group.family, group.tier)!;
      expect(block.walkSpeedMps, `${group.id} walk`).toBeGreaterThan(0);
      expect(block.moveSpeedMps, `${group.id} pursuit`).toBeGreaterThan(0);
    }
  });

  it("matches each resident's ground speed to its shipped stride metadata", () => {
    const sliding = gaits.filter((row) => row.slide > 0.05).map((row) =>
      `${row.entityId} ${row.gait}: ${(row.slide * 100).toFixed(1)}% slide, ${row.speedMps} m/s, `
      + `${row.impliedMps.toFixed(3)} native m/s, ${row.drawnStrideScale.toFixed(3)} scale, ${row.rate.toFixed(3)} playback`);
    expect(gaits.length).toBeGreaterThan(200);
    expect(sliding, sliding.join("\n")).toEqual([]);
  });

  it("keeps actual playback within walk and run cadence ceilings", () => {
    const racing = gaits.filter((row) => row.cadenceHz > (row.gait === "walk" ? 2.4 : 3) + 1e-6);
    const bySpecies = new Map<string, { gait: string; cadenceHz: number; speedMps: number; impliedMps: number; drawnStrideScale: number }>();
    for (const row of racing) {
      const key = `${row.entityId.replace(/_\d+$/, "")} ${row.gait}`;
      const previous = bySpecies.get(key);
      if (!previous || row.cadenceHz > previous.cadenceHz) bySpecies.set(key, row);
    }
    const summary = [...bySpecies.entries()].map(([key, row]) =>
      `${key}: ${row.cadenceHz.toFixed(2)} Hz at ${row.speedMps.toFixed(2)} m/s over a ${row.impliedMps.toFixed(3)} m/s native stride x${row.drawnStrideScale.toFixed(2)}`);
    expect(summary, summary.join("\n")).toEqual([]);
    // Large bodies take long strides; a shared lower cadence would force their feet to slide.
    for (const row of gaits) expect(row.cadenceHz, `${row.entityId} ${row.gait}`).toBeGreaterThan(0);
  });

  it("keeps natural snail motion continuous on both rig paths at 100 ms simulation steps", async () => {
    const block = ENEMY_BLOCKS.find((row) => row.id === "quarry_snail_t5")!;
    const entity: SemanticEntity = {
      id: "slow-snail", name: "Quarry Snail", archetype: "enemy", tier: 5, regionId: "vellenwood",
      position: [0, 0, 0], state: "alive", interactions: ["inspect", "attack"],
      view: { assetId: "creature_quarry_snail", gaitSpeedMps: block.walkSpeedMps },
    };
    const f = await fixture([entity]);
    try {
      const speed = block.walkSpeedMps!;
      expect(speed * TICK_SECONDS / MOVING_EPSILON).toBeGreaterThan(3);
      let previousTime: number | null = null;
      let frame = 0;
      for (let tick = 1; tick <= 40; tick += 1) {
        entity.position = [0, 0, speed * TICK_SECONDS * tick];
        entity.view!.rotationY = tick * 0.01;
        const viewer = new THREE.Vector3(tick <= 20 ? 0 : 100, 0, 0);
        for (const alpha of FRAMES) {
          // Production runs structural sync first. Every second 250 ms sync overlaps a sim tick.
          if (frame > 0 && frame % 10 === 0) f.views.sync([entity]);
          frame += 1;
          f.views.syncMotion([entity], alpha);
          f.views.update(TICK_SECONDS / FRAMES.length, viewer);
          const state = f.views.motionSnapshot(entity.id)!;
          expect(state.motion).toBe("walk");
          expect(state.drawnPosition[2]).toBeCloseTo(speed * TICK_SECONDS * (tick - 1 + alpha), 7);
          expect(state.drawnRotationY).toBeCloseTo(0.01 * (tick - 1 + alpha), 7);
          if (previousTime !== null) expect(state.time).toBeCloseTo(
            playbackTime(previousTime + TICK_SECONDS / FRAMES.length * state.timeScale!, state.duration!, true), 7,
          );
          previousTime = state.time;
        }
        expect(f.views.motionSnapshot(entity.id)!.path).toBe(tick <= 20 ? "live-rig" : "sampled-rig");
      }
      f.views.syncMotion([entity], 0);
      f.views.update(0, new THREE.Vector3(100, 0, 0));
      expect(f.views.motionSnapshot(entity.id)).toMatchObject({ motion: "idle", drawnPosition: entity.position });
    } finally { f.dispose(); }
  });

  it("walks no faster than pursuit and leaves the player able to disengage", () => {
    for (const block of ENEMY_BLOCKS) {
      const pursuit = block.moveSpeedMps ?? ENEMY_SPEED_MPS;
      if (block.walkSpeedMps !== undefined) expect(block.walkSpeedMps, block.id).toBeLessThanOrEqual(pursuit);
      expect(pursuit, block.id).toBeLessThan(4.2);
    }
  });
});
