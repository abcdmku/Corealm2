import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameLoop, type LoopDeps } from "../game/src/app/loop.js";
import type { EntityViews } from "../game/src/render/entityViews.js";
import type { CharacterRig } from "../game/src/render/characterRig.js";
import type { TraversalSample } from "../game/src/systems/traversalMotion.js";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const camera = new THREE.PerspectiveCamera();
  const state = {
    player: { id: "player", position: [0, 0, 0], facingRad: 0, health: 100, regionId: "fallowmarch", movement: { mode: "idle" } },
    equipment: {}, combat: { targetId: null, engagedBy: [] }, magic: { weaponCharges: {} }, activity: null,
  };
  const deps = {
    events: { subscribe: vi.fn() },
    store: { get: () => state },
    clock: { advance: () => 0, paused: false, timeScale: 1, alpha: () => 0.375, elapsedMs: 0 },
    scene: { overlayGroup: new THREE.Group(), syncPlayer: vi.fn(), materials: { updatePlayerOcclusion: vi.fn() } },
    camera: { update: vi.fn() },
    renderer: { camera, renderer: {}, followShadow: vi.fn(), render: vi.fn() },
    input: { update: vi.fn() },
  };
  const loop = new GameLoop(deps as unknown as LoopDeps);
  const order: string[] = [];
  const source = vi.fn(() => { order.push("source"); return []; });
  const refresh = vi.fn(() => { order.push("residency"); });
  const views = {
    sync: vi.fn(() => { order.push("structure"); }),
    syncResidentMotion: vi.fn(() => { order.push("motion"); }),
    update: vi.fn(() => { order.push("animation"); }),
    playAction: vi.fn(),
    actionDurationSeconds: vi.fn<(...args: unknown[]) => number | null>(() => null),
    motionSnapshot: vi.fn(() => ({ drawnPosition: [4, 0, 0], semanticPosition: [4, 0, 0], semanticRotationY: 0 })),
  };
  loop.setEntityViews(views as unknown as EntityViews, source, refresh);
  const started = performance.now();
  loop.start();
  return { loop, source, refresh, views, order, deps, render: (offset: number) => frame!(started + offset) };
}

describe("frame loop resident motion", () => {
  it("retimes the independent hit layer without a simulation movement hold", () => {
    const f = fixture();
    f.views.actionDurationSeconds.mockReturnValue(1.034);
    f.views.playAction.mockReturnValue(true);
    let pending = true;
    f.loop.setCombatHits(() => {
      if (!pending) return [];
      pending = false;
      return [{ atMs: 500, attacker: 'player', sourceId: 'player', targetId: 'archer', damage: 1,
        hit: true, maxHit: 1, kind: 'melee', killed: false, spellId: null }];
    });
    try {
      f.deps.clock.elapsedMs = 500; f.deps.clock.timeScale = 2;
      f.render(16);
      expect(f.views.actionDurationSeconds).toHaveBeenCalledWith('archer', 'hit', 'left');
      expect(f.views.playAction).toHaveBeenCalledWith('archer', 'hit', { impactSide: 'left', durationSeconds: .517 });
    } finally { f.loop.dispose(); }
  });
  it("renders committed enemy shots and clears interrupted flights, realm changes, resets and disposal", () => {
    const f = fixture();
    let committed = true;
    let id = 0;
    let pending = true;
    f.loop.setCombatAttackStarts(() => {
      if (!pending) return [];
      pending = false;
      return [{ id: ++id, attacker: "enemy", sourceId: "archer", targetId: "player", kind: "ranged",
        atMs: 0, contactAtMs: 1000, recoverAtMs: 1200 }];
    }, () => committed);
    const mesh = (): THREE.InstancedMesh => f.deps.scene.overlayGroup.getObjectByName("enemy-projectiles") as THREE.InstancedMesh;
    try {
      f.deps.clock.elapsedMs = 500;
      f.render(16);
      expect(mesh().count).toBe(1);
      committed = false;
      f.render(32);
      expect(mesh().count).toBe(0);
      committed = true; pending = true;
      f.render(48);
      expect(mesh().count).toBe(1);
      f.deps.store.get().player.regionId = "gravelmaw";
      f.render(64);
      expect(mesh().count).toBe(0);
      pending = true;
      f.render(80);
      f.loop.resetPresentation();
      expect(mesh().count).toBe(0);
      pending = true;
      f.render(96);
      expect(mesh().count).toBe(1);
      f.loop.dispose();
      expect(f.deps.scene.overlayGroup.children).toHaveLength(0);
    } finally { f.loop.dispose(); }
  });

  it("chooses hit side using the attacker's position relative to the target's facing", () => {
    const f = fixture();
    f.loop.setCombatHits(() => [{ atMs: 0, attacker: "player", sourceId: "player", targetId: "archer",
      damage: 1, hit: true, maxHit: 1, kind: "melee", killed: false, spellId: null }]);
    try {
      f.render(16);
      expect(f.views.playAction).toHaveBeenLastCalledWith("archer", "hit", { impactSide: "left" });
      f.deps.store.get().player.position = [8, 0, 0];
      f.render(32);
      expect(f.views.playAction).toHaveBeenLastCalledWith("archer", "hit", { impactSide: "right" });
    } finally { f.loop.dispose(); }
  });
  it("refreshes residency and interpolates each frame while collecting semantics only at structural cadence", () => {
    const f = fixture();
    try {
      for (let frame = 1; frame <= 60; frame += 1) f.render(frame * 16);
      expect(f.refresh).toHaveBeenCalledTimes(60);
      expect(f.views.syncResidentMotion).toHaveBeenCalledTimes(60);
      expect(f.views.syncResidentMotion).toHaveBeenLastCalledWith(0.375);
      expect(f.source).toHaveBeenCalledTimes(3);
      expect(f.views.sync).toHaveBeenCalledTimes(3);
      expect(f.order.slice(0, 3)).toEqual(["residency", "motion", "animation"]);
      for (let i = 0; i < f.order.length; i += 1) {
        if (f.order[i] === "source") expect(f.order.slice(i - 1, i + 4))
          .toEqual(["residency", "source", "structure", "motion", "animation"]);
      }
    } finally { f.loop.stop(); }
  });

  it("uses the semantic pose while paused and replaces stale residency callbacks on reattachment", () => {
    const f = fixture();
    try {
      f.render(16);
      f.deps.clock.paused = true;
      f.loop.setEntityViews(f.views as unknown as EntityViews, f.source);
      f.render(32);
      expect(f.refresh).toHaveBeenCalledTimes(1);
      expect(f.views.syncResidentMotion).toHaveBeenLastCalledWith(1);
      expect(f.source).not.toHaveBeenCalled();
    } finally { f.loop.stop(); }
  });

  it("places the rig, camera and scene at the traversal sample without committing semantic movement", () => {
    const f = fixture();
    const rig = {
      root: { visible: true }, setPosition: vi.fn(), play: vi.fn(), poseFor: () => "idle",
      setLocomotionSpeed: vi.fn(), update: vi.fn(), drainMotionEvents: () => [],
      syncTraversalPose: vi.fn(),
      visibleSlots: () => [], applyEquipment: vi.fn(),
    };
    let sample: TraversalSample | null = {
      position: [1.25, 0.6, 0], facingRad: Math.PI / 2, kind: "climb", phase: "contact",
      progress: 0.4, curtainOpacity: 0, concealed: false,
    };
    f.loop.setPlayerRig(rig as unknown as CharacterRig);
    f.loop.setTraversalPresentation(() => sample);
    try {
      f.render(16);
      expect(f.deps.store.get().player.position).toEqual([0, 0, 0]);
      expect(rig.setPosition).toHaveBeenLastCalledWith([1.25, 0.6, 0], Math.PI / 2);
      expect(f.deps.scene.syncPlayer).toHaveBeenLastCalledWith([1.25, 0.6, 0], Math.PI / 2);
      expect(f.deps.camera.update).toHaveBeenLastCalledWith(1.25, 0.6, 0);
      expect(rig.play).not.toHaveBeenCalled();
      expect(rig.syncTraversalPose).toHaveBeenLastCalledWith(sample);
      sample = { ...sample, concealed: true, position: [0, 0, 0], kind: "passage" };
      f.render(32);
      expect(rig.play).not.toHaveBeenCalled();
      expect(rig.syncTraversalPose).toHaveBeenLastCalledWith(sample);
      f.deps.store.get().player.position = [1.5, 0, 0];
      sample = null;
      f.render(48);
      expect(rig.syncTraversalPose).toHaveBeenLastCalledWith(null);
      expect(f.deps.scene.syncPlayer).toHaveBeenLastCalledWith([1.5, 0, 0], 0);
    } finally { f.loop.stop(); }
  });
});
