import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SemanticEntity } from "../game/src/contracts.js";
import { EntityViews } from "../game/src/render/entityViews.js";
import { MaterialLibrary } from "../game/src/render/materials.js";
import { missingCreatureHit, playbackTime } from "../game/src/render/creatureMotion.js";

interface FixtureOptions {
  impliedWalkMps?: number;
  impliedRunMps?: number;
  scale?: number;
  gaitSpeedMps?: number;
  tier?: number;
}

async function fixture(count = 1, deathClip = true, options: FixtureOptions = {}) {
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
  bone.name = "Test_Spine";
  // A support branch and a head branch, so the support-safe hit overlay (SLICE-03) can be built:
  // the recoil is a masked additive rotation on Test_Head, and Test_Leg (with its ancestor
  // Test_Spine) keeps the base pose. Every vertex is still skinned to Test_Spine alone.
  const leg = new THREE.Bone();
  leg.name = "Test_Leg";
  leg.position.set(0, -0.5, 0);
  const head = new THREE.Bone();
  head.name = "Test_Head";
  head.position.set(0, 0.6, 0);
  bone.add(leg, head);
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone, leg, head]));
  source.add(mesh);
  source.updateMatrixWorld(true);
  const headNod = new THREE.QuaternionKeyframeTrack("Test_Head.quaternion", [0, 0.5, 1],
    [0, -0.4, 0].flatMap((angle) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray()));
  const clips = ["Idle", "Walk", "Run", "Attack", "Hit", ...(deathClip ? ["Death"] : [])].map((name) => (
    new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack(
      "Test_Spine.position", [0, 0.5, 1], [0, 0, 0, 0, 0.3, 0, 0, name === "Death" ? -0.5 : 0, 0],
    ), ...(name === "Hit" ? [headNod] : [])])
  ));
  const assets = {
    entry: () => ({
      id: "test_creature", animations: clips.map((clip) => clip.name), size: { x: 1, y: 1, z: 1 },
      impliedWalkMps: options.impliedWalkMps, impliedRunMps: options.impliedRunMps,
    }),
    isLoaded: () => true,
    load: async () => source,
    instance: () => source,
    clipOf: (_asset: string, name: string) => clips.find((clip) => clip.name === name),
    clip: () => undefined,
  };
  const scene = { entityGroup: new THREE.Group(), overlayGroup: new THREE.Group() };
  const materials = new MaterialLibrary();
  const views = new EntityViews(scene, assets as never, materials, {
    maxUniqueViews: 1, maxUniqueDrawCalls: 8, maxAnimatedViews: 1,
  });
  const entities: SemanticEntity[] = Array.from({ length: count }, (_, index) => ({
    id: `actor-${index}`, name: "Test actor", archetype: "enemy", tier: options.tier ?? 1,
    regionId: "fallowmarch", position: [index % 6, 0, Math.floor(index / 6)],
    state: "alive", interactions: ["inspect", "attack"],
    view: { assetId: "test_creature", scale: options.scale, gaitSpeedMps: options.gaitSpeedMps },
  }));
  await views.prepare(entities);
  views.updateActiveArea([0, 0, 0], 180);
  views.update(0, new THREE.Vector3(100, 0, 0));
  views.sync(entities);
  return { views, entities, scene, source, clips, dispose() { views.dispose(); materials.dispose(); geometry.dispose(); material.dispose(); } };
}

describe("creature presentation continuity", () => {
  it.each([
    { motion: "walk" as const, speed: 1.6, clip: "Walk" },
    { motion: "run" as const, speed: 3.2, clip: "Run" },
  ])("halves authored $motion cadence at twice the drawn scale and the same world speed", async ({ motion, speed, clip }) => {
    const options = { impliedWalkMps: 1, impliedRunMps: 2, gaitSpeedMps: speed };
    const normal = await fixture(1, true, { ...options, scale: 1 });
    const larger = await fixture(1, true, { ...options, scale: 2 });
    try {
      const step = 0.125;
      const before = [normal, larger].map((f) => {
        expect(f.views.setLocomotion("actor-0", motion)).toBe(true);
        f.views.update(0, new THREE.Vector3(0, 0, 0));
        return f.views.motionSnapshot("actor-0")!;
      });
      const widths = [normal, larger].map((f) => {
        const bounds = f.views.drawnBounds("actor-0")!;
        return bounds.max[0] - bounds.min[0];
      });
      expect(widths[1]).toBeCloseTo(widths[0]! * 2);

      for (const f of [normal, larger]) {
        const [x, y, z] = f.entities[0]!.position;
        f.entities[0]!.position = [x + speed * step, y, z];
        f.views.syncMotion(f.entities);
        f.views.update(step, new THREE.Vector3(0, 0, 0));
      }
      const after = [normal, larger].map((f) => f.views.motionSnapshot("actor-0")!);
      for (const state of after) {
        expect(state).toMatchObject({ path: "live-rig", motion, clip });
        expect(state.drawnPosition[0]).toBeCloseTo(speed * step);
        expect(state.timeScale).toBeGreaterThan(0.6);
        expect(state.timeScale).toBeLessThan(2.4);
      }
      expect(after[1]!.timeScale).toBeCloseTo(after[0]!.timeScale! / 2);
      const normalAdvance = after[0]!.time! - before[0]!.time!;
      const largerAdvance = after[1]!.time! - before[1]!.time!;
      expect(normalAdvance).toBeGreaterThan(0);
      expect(largerAdvance).toBeCloseTo(normalAdvance / 2);
    } finally { normal.dispose(); larger.dispose(); }
  });

  it.each([
    { motion: "walk" as const, speed: 1.6 },
    { motion: "run" as const, speed: 3.2 },
  ])("lets an enlarged authored $motion cycle run below the unscaled minimum rate", async ({ motion, speed }) => {
    const options = { impliedWalkMps: 1, impliedRunMps: 2, gaitSpeedMps: speed };
    const normal = await fixture(1, true, { ...options, scale: 1 });
    const larger = await fixture(1, true, { ...options, scale: 4 });
    try {
      const samples = [normal, larger].map((f) => {
        expect(f.views.setLocomotion("actor-0", motion)).toBe(true);
        f.views.update(0, new THREE.Vector3(0, 0, 0));
        const before = f.views.motionSnapshot("actor-0")!;
        f.views.update(0.125, new THREE.Vector3(0, 0, 0));
        return { before, after: f.views.motionSnapshot("actor-0")! };
      });
      expect(samples[1]!.after.timeScale).toBeGreaterThan(0);
      expect(samples[1]!.after.timeScale).toBeLessThan(0.6);
      expect(samples[1]!.after.timeScale).toBeCloseTo(samples[0]!.after.timeScale! / 4);
      expect(samples[1]!.after.time! - samples[1]!.before.time!).toBeCloseTo(
        (samples[0]!.after.time! - samples[0]!.before.time!) / 4,
      );
    } finally { normal.dispose(); larger.dispose(); }
  });

  it.each([
    { motion: "walk" as const, speed: 1.6 },
    { motion: "run" as const, speed: 3.2 },
  ])("uses the drawn tier silhouette to retime authored $motion", async ({ motion, speed }) => {
    const options = { impliedWalkMps: 1, impliedRunMps: 2, gaitSpeedMps: speed, scale: 1 };
    const smallTier = await fixture(1, true, { ...options, tier: 1 });
    const largeTier = await fixture(1, true, { ...options, tier: 99 });
    try {
      const samples = [smallTier, largeTier].map((f) => {
        expect(f.views.setLocomotion("actor-0", motion)).toBe(true);
        f.views.update(0, new THREE.Vector3(0, 0, 0));
        const bounds = f.views.drawnBounds("actor-0")!;
        const before = f.views.motionSnapshot("actor-0")!;
        f.views.update(0.125, new THREE.Vector3(0, 0, 0));
        const after = f.views.motionSnapshot("actor-0")!;
        return { width: bounds.max[0] - bounds.min[0], before, after };
      });
      const [small, large] = samples;
      expect(large!.width).toBeGreaterThan(small!.width);
      const drawnScaleRatio = large!.width / small!.width;
      expect(large!.after.timeScale).toBeCloseTo(small!.after.timeScale! / drawnScaleRatio);
      expect(large!.after.time! - large!.before.time!).toBeCloseTo(
        (small!.after.time! - small!.before.time!) / drawnScaleRatio,
      );
    } finally { smallTier.dispose(); largeTier.dispose(); }
  });

  it.each([
    { motion: "walk" as const, speed: 1.6 },
    { motion: "run" as const, speed: 3.2 },
  ])("preserves scaled authored $motion phase on live-rig to sampled-rig travel and return", async ({ motion, speed }) => {
    const f = await fixture(1, true, { impliedWalkMps: 1, impliedRunMps: 2, gaitSpeedMps: speed, scale: 2 });
    try {
      expect(f.views.setLocomotion("actor-0", motion)).toBe(true);
      f.views.update(0.125, new THREE.Vector3(0, 0, 0));
      const near = f.views.motionSnapshot("actor-0")!;
      expect(near).toMatchObject({ path: "live-rig", motion });
      f.views.update(0, new THREE.Vector3(100, 0, 0));
      expect(f.views.motionSnapshot("actor-0")).toMatchObject({
        path: "sampled-rig", motion, clip: near.clip, time: near.time, timeScale: near.timeScale,
      });
      const [x, y, z] = f.entities[0]!.position;
      f.entities[0]!.position = [x + speed * 0.25, y, z];
      f.views.syncMotion(f.entities);
      f.views.update(0.25, new THREE.Vector3(100, 0, 0));
      const far = f.views.motionSnapshot("actor-0")!;
      expect(far.path).toBe("sampled-rig");
      expect(far.time).toBeCloseTo(playbackTime(near.time! + 0.25 * near.timeScale!, near.duration!, true));
      expect(far.timeScale).toBe(near.timeScale);
      f.views.update(0, new THREE.Vector3(0, 0, 0));
      expect(f.views.motionSnapshot("actor-0")).toMatchObject({
        path: "live-rig", motion, clip: far.clip, time: far.time, timeScale: far.timeScale,
      });
      f.views.update(0.125, new THREE.Vector3(0, 0, 0));
      expect(f.views.motionSnapshot("actor-0")!.time).toBeCloseTo(
        playbackTime(far.time! + 0.125 * far.timeScale!, far.duration!, true),
      );
    } finally { f.dispose(); }
  });

  it("retains explicit locomotion through representation changes and clears it on semantic removal", async () => {
    const f = await fixture();
    try {
      expect(f.views.setLocomotion("actor-0", "run")).toBe(true);
      f.views.update(0.1, new THREE.Vector3(0, 0, 0));
      expect(f.views.motionSnapshot("actor-0")).toMatchObject({ path: "live-rig", motion: "run" });
      f.views.update(0.1, new THREE.Vector3(100, 0, 0));
      expect(f.views.motionSnapshot("actor-0")).toMatchObject({ path: "sampled-rig", motion: "run" });
      f.views.updateActiveArea([500, 0, 0], 20);
      expect(f.views.has("actor-0")).toBe(false);
      f.views.sync(f.entities);
      f.views.updateActiveArea([0, 0, 0], 180);
      f.views.update(0.1, new THREE.Vector3(100, 0, 0));
      expect(f.views.motionSnapshot("actor-0")!.motion).toBe("run");
      f.views.sync([]);
      f.views.sync(f.entities);
      f.views.update(0.1, new THREE.Vector3(100, 0, 0));
      expect(f.views.motionSnapshot("actor-0")!.motion).toBe("idle");
    } finally { f.dispose(); }
  });

  it("keeps an actor's exact phase when crossing both full-rig boundaries", async () => {
    const f = await fixture();
    try {
      f.views.update(0.12, new THREE.Vector3(100, 0, 0));
      const far = f.views.motionSnapshot("actor-0")!;
      expect(far.path).toBe("sampled-rig");
      f.views.update(0, new THREE.Vector3(0, 0, 0));
      expect(f.views.motionSnapshot("actor-0")).toMatchObject({ path: "live-rig", clip: far.clip, time: far.time });
      f.views.update(0.1, new THREE.Vector3(60, 0, 0));
      const retained = f.views.motionSnapshot("actor-0")!;
      expect(retained.path).toBe("live-rig");
      expect(retained.time).toBeCloseTo(playbackTime(far.time! + 0.1 * far.timeScale!, far.duration!, true));
      f.views.update(0, new THREE.Vector3(100, 0, 0));
      expect(f.views.motionSnapshot("actor-0")).toMatchObject({ path: "sampled-rig", time: retained.time });
    } finally { f.dispose(); }
  });

  it("advances all 24 actors even when only one full rig is affordable", async () => {
    const f = await fixture(24);
    try {
      const before = f.entities.map((entity) => f.views.motionSnapshot(entity.id)!);
      for (let frame = 0; frame < 12; frame += 1) f.views.update(1 / 60, new THREE.Vector3(0, 0, 0));
      for (let i = 0; i < f.entities.length; i += 1) {
        const after = f.views.motionSnapshot(f.entities[i]!.id)!;
        expect(after.time).toBeCloseTo(playbackTime(before[i]!.time! + 0.2 * before[i]!.timeScale!, 1, true));
        expect(["live-rig", "sampled-rig"]).toContain(after.path);
      }
      expect(f.views.stats().uniqueViews).toBe(1);
    } finally { f.dispose(); }
  });

  it("retimes attack, plays the recoil overlay over it, and holds a far corpse against later hits", async () => {
    const f = await fixture();
    try {
      expect(f.views.playAction("actor-0", "attack", { durationSeconds: 2 })).toBe(true);
      f.views.update(0.2, new THREE.Vector3(100, 0, 0));
      expect(f.views.motionSnapshot("actor-0")).toMatchObject({ motion: "attack", time: 0.1, timeScale: 0.5 });
      // SLICE-03: a nonlethal hit is a masked additive overlay. It neither interrupts the committed
      // attack nor restarts its clock; the far sampled rig receives the same overlay as a live one.
      expect(f.views.playAction("actor-0", "hit")).toBe(true);
      expect(f.views.motionSnapshot("actor-0")).toMatchObject({
        path: "sampled-rig", motion: "attack", time: 0.1,
        hitOverlay: { clip: "Hit_MaskedOverlay", time: 0, duration: 1, maskStatus: "native-masked", bones: ["Test_Head"] },
      });
      for (let i = 0; i < 5; i += 1) f.views.update(0.25, new THREE.Vector3(100, 0, 0));
      // 1.25 s later the 1 s overlay has finished while the retimed 2 s attack is still committed.
      expect(f.views.motionSnapshot("actor-0")).toMatchObject({ motion: "attack", hitOverlay: null });
      expect(f.views.motionSnapshot("actor-0")!.time).toBeCloseTo(0.725);
      for (let i = 0; i < 3; i += 1) f.views.update(0.25, new THREE.Vector3(100, 0, 0));
      expect(f.views.motionSnapshot("actor-0")?.motion).toBe("idle");
      f.entities[0]!.state = "dead";
      f.views.sync(f.entities);
      for (let i = 0; i < 6; i += 1) f.views.update(0.25, new THREE.Vector3(100, 0, 0));
      expect(f.views.motionSnapshot("actor-0")).toMatchObject({ motion: "death", time: 1 });
      expect(f.views.playAction("actor-0", "hit")).toBe(false);
      expect(f.views.motionSnapshot("actor-0")).toMatchObject({ motion: "death", time: 1 });
    } finally { f.dispose(); }
  });

  it("uses bone recoil rather than root translation when a source has no hit clip", async () => {
    const f = await fixture();
    try {
      const recoil = missingCreatureHit(f.source, f.clips[0]!)!;
      expect(recoil.tracks.some((track) => track.name === "Test_Spine.quaternion")).toBe(true);
      const track = recoil.tracks.find((entry) => entry.name === "Test_Spine.quaternion")!;
      expect(Array.from(track.values.slice(0, 4))).not.toEqual(Array.from(track.values.slice(8, 12)));
      expect(f.clips[0]!.tracks.some((entry) => entry.name.endsWith("quaternion"))).toBe(false);
    } finally { f.dispose(); }
  });

  it("restarts a repeated close hit from phase zero without disturbing the base gait", async () => {
    const f = await fixture();
    try {
      f.views.update(0, new THREE.Vector3(0, 0, 0));
      const start = f.views.motionSnapshot("actor-0")!;
      expect(start).toMatchObject({ path: "live-rig", motion: "idle", clip: "Idle", hitOverlay: null });
      expect(f.views.playAction("actor-0", "hit")).toBe(true);
      f.views.update(0.2, new THREE.Vector3(0, 0, 0));
      expect(f.views.playAction("actor-0", "hit")).toBe(true);
      f.views.update(0.09, new THREE.Vector3(0, 0, 0));
      const drawn = new Map<string, THREE.Bone>();
      f.scene.entityGroup.traverse((node) => {
        if ((node as THREE.Bone).isBone && node.userData.entityId === "actor-0") drawn.set(node.name, node as THREE.Bone);
      });
      const snapshot = f.views.motionSnapshot("actor-0")!;
      // The second hit restarts the overlay clock (0.09, not 0.29) while the Idle base keeps its own
      // continuous clock from its per-actor phase and rate; the spine follows Idle alone.
      expect(snapshot).toMatchObject({ path: "live-rig", motion: "idle", clip: "Idle", timeScale: start.timeScale });
      expect(snapshot.time).toBeCloseTo(playbackTime(start.time! + 0.29 * start.timeScale!, 1, true));
      expect(snapshot.hitOverlay?.time).toBeCloseTo(0.09);
      const idleY = snapshot.time! <= 0.5 ? 0.3 * snapshot.time! / 0.5 : 0.3 * (1 - snapshot.time!) / 0.5;
      expect(drawn.get("Test_Spine")!.position.y).toBeCloseTo(idleY);
      // Recoil is the authored head nod at 0.09 s (-0.4 * 0.09 / 0.5 = -0.072 rad), faded in by the
      // overlay weight (0.5 at 9% of a one-second clip). The support branch is untouched.
      const nod = drawn.get("Test_Head")!.quaternion.angleTo(new THREE.Quaternion());
      expect(snapshot.hitOverlay?.weight).toBeCloseTo(0.5);
      expect(nod).toBeCloseTo(0.036, 3);
      expect(drawn.get("Test_Leg")!.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
    } finally { f.dispose(); }
  });

  it("stops spending full-rig animation budget on a source without a death clip", async () => {
    const f = await fixture(1, false);
    try {
      f.views.update(0, new THREE.Vector3(0, 0, 0));
      f.views.playAction("actor-0", "hit");
      f.views.update(0.03, new THREE.Vector3(0, 0, 0));
      f.entities[0]!.state = "dead";
      f.views.sync(f.entities);
      const frozen = f.views.motionSnapshot("actor-0")!.time;
      f.views.update(0.2, new THREE.Vector3(0, 0, 0));
      expect(f.views.motionSnapshot("actor-0")).toMatchObject({ motion: "death", time: frozen, timeScale: 0 });
      expect(f.views.stats().animatedLastFrame).toBe(0);
      f.entities[0]!.state = "alive";
      f.views.sync(f.entities);
      f.views.update(0.1, new THREE.Vector3(0, 0, 0));
      expect(f.views.motionSnapshot("actor-0")!.motion).toBe("idle");
      expect(f.views.stats().animatedLastFrame).toBe(1);
    } finally { f.dispose(); }
  });
});
