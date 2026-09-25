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
    clock: { advance: (_delta: number) => 0, paused: false, timeScale: 1, alpha: () => 0.375, elapsedMs: 0 },
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
    update: vi.fn((_delta: number) => { order.push("animation"); }),
    playAction: vi.fn(),
    cancelAttack: vi.fn(),
    actionDurationSeconds: vi.fn<(...args: unknown[]) => number | null>(() => null),
    motionSnapshot: vi.fn(() => ({ drawnPosition: [4, 0, 0], semanticPosition: [4, 0, 0], semanticRotationY: 0 })),
  };
  loop.setEntityViews(views as unknown as EntityViews, source, refresh);
  const started = performance.now();
  loop.start();
  return { loop, source, refresh, views, order, deps, render: (offset: number) => frame!(started + offset) };
}

describe("frame loop resident motion", () => {
  it('caps presentation at 60 Hz while reading every input frame and preserving animation time', () => {
    const f = fixture();
    try {
      for (let at = 0; at < 1000; at += 2) f.render(at);
      expect(f.deps.input.update).toHaveBeenCalledTimes(500);
      expect(f.deps.renderer.render).toHaveBeenCalledTimes(60);
      const animationSeconds = f.views.update.mock.calls.reduce((total, [delta]) => total + delta, 0);
      expect(animationSeconds).toBeGreaterThan(.97);
      expect(animationSeconds).toBeLessThan(1);
      // A resumed tab presents once, without trying to draw all missed frames.
      f.render(5000);
      expect(f.deps.renderer.render).toHaveBeenCalledTimes(61);
      expect(f.views.update.mock.lastCall![0]).toBe(.25);
    } finally { f.loop.dispose(); }
  });
  it("does not resurrect a network swing cancelled before the next render", () => {
    const f=fixture(),rig={root:{visible:true},setPosition:vi.fn(),play:vi.fn(),poseFor:()=>"idle",
      setLocomotionSpeed:vi.fn(),update:vi.fn(),drainMotionEvents:()=>[],syncTraversalPose:vi.fn(),
      visibleSlots:()=>[],applyEquipment:vi.fn(),meleeTiming:()=>({clipSeconds:1.5})};
    f.loop.setPlayerRig(rig as unknown as CharacterRig);
    const base={playerId:"player",position:[0,0,0] as const,regionId:"fallowmarch" as const};
    try {
      f.loop.handleWorldAction({...base,sequence:1,type:"attack",attack:{id:1,sourceId:"player",targetId:"archer",attacker:"player",kind:"melee",atMs:0,contactAtMs:500,recoverAtMs:800}},0);
      f.loop.handleWorldAction({...base,sequence:2,type:"attackCancelled",sourceId:"player"},1);
      f.render(1000 / 60);
      expect(rig.play).toHaveBeenCalledWith("idle");
      expect(rig.play.mock.calls.some(call=>call[0]==="attack_melee")).toBe(false);
    } finally {f.loop.dispose();}
  });
  it("moves online enemy shots between authoritative updates", () => {
    const f=fixture(),base={playerId:"player",position:[0,0,0] as const,regionId:"fallowmarch" as const};
    f.source.mockReturnValue([{id:"archer",position:[4,0,0]}] as never);
    f.deps.clock.elapsedMs=500;
    try {
      f.loop.handleWorldAction({...base,sequence:1,type:"attack",attack:{id:1,sourceId:"archer",targetId:"player",attacker:"enemy",kind:"ranged",atMs:0,contactAtMs:1000,recoverAtMs:1200}},0);
      const mesh=f.deps.scene.overlayGroup.getObjectByName("enemy-projectiles") as THREE.InstancedMesh;
      const matrix=new THREE.Matrix4();
      f.loop.setRemotePresentationTime(500);f.render(1000 / 60);mesh.getMatrixAt(0,matrix);const first=matrix.elements[12]!;
      f.loop.setRemotePresentationTime(550);f.render(66);mesh.getMatrixAt(0,matrix);
      expect(mesh.count).toBe(1);expect(matrix.elements[12]).toBeLessThan(first);
      expect(f.deps.clock.elapsedMs).toBe(500);
    } finally {f.loop.dispose();}
  });
  it("keeps an enemy's new target flight when the previous target cancels later in the batch", () => {
    const f=fixture(),base={position:[0,0,0] as const,regionId:"fallowmarch" as const};
    f.source.mockReturnValue([{id:"archer",position:[4,0,0]},{id:"remote:previous",position:[2,0,0]}] as never);
    f.deps.clock.elapsedMs=500;
    const attack={id:1,sourceId:"archer",attacker:"enemy" as const,kind:"ranged" as const,atMs:0,contactAtMs:1000,recoverAtMs:1200};
    try {
      f.loop.handleWorldAction({...base,sequence:1,playerId:"previous",type:"attack",attack:{...attack,targetId:"previous"}},0);
      f.loop.handleWorldAction({...base,sequence:2,playerId:"player",type:"attack",attack:{...attack,targetId:"player"}},1);
      f.loop.handleWorldAction({...base,sequence:3,playerId:"previous",type:"attackCancelled",sourceId:"archer"},2);
      f.loop.setRemotePresentationTime(500);f.render(1000 / 60);
      expect(f.views.cancelAttack).not.toHaveBeenCalled();
      expect(f.loop.remoteProjectileState()).toEqual({visible:1,targets:["player"]});
    }finally{f.loop.dispose();}
  });
  it('yields scene work to a pending browser press and resumes with accumulated time', () => {
    let pending = true;
    vi.stubGlobal('navigator', { scheduling: { isInputPending: () => pending } });
    const f = fixture();
    try {
      f.render(1000 / 60);
      expect(f.deps.input.update).toHaveBeenCalledTimes(1);
      expect(f.views.update).not.toHaveBeenCalled();
      pending = false; f.render(2000 / 60);
      expect(f.views.update).toHaveBeenCalledTimes(1);
      expect(f.views.update.mock.calls[0]![0]).toBeCloseTo(.032, 2);
    } finally { f.loop.dispose(); }
  });
  it('keeps input and menus updating without rebuilding unpresentable animation frames', () => {
    const f = fixture(), ui = { update: vi.fn() };
    let ready = false;
    Object.assign(f.deps.renderer, { canRenderFrame: () => ready });
    f.loop.setUi(ui as never);
    try {
      f.render(1000 / 60); f.render(2000 / 60);
      expect(f.deps.input.update).toHaveBeenCalledTimes(2);
      expect(ui.update).toHaveBeenCalledTimes(2);
      expect(f.views.update).not.toHaveBeenCalled();
      expect(f.deps.renderer.render).not.toHaveBeenCalled();
      ready = true; f.render(3000 / 60);
      expect(f.views.update).toHaveBeenCalledTimes(1);
      expect(f.views.update.mock.calls[0]![0]).toBeCloseTo(.048, 2);
      expect(f.deps.renderer.render).toHaveBeenCalledTimes(1);
    } finally { f.loop.dispose(); }
  });
  it('includes GPU completion delay in automatic graphics adaptation', () => {
    const f = fixture(), observer = vi.fn();
    Object.assign(f.deps.renderer, { getFramePressureMs: () => 180 });
    f.loop.setFrameObserver(observer);
    try { f.render(1000 / 60); expect(observer).toHaveBeenCalledWith(180); }
    finally { f.loop.dispose(); }
  });
  it("draws a zero-length frame when the first RAF predates a long boot task", () => {
    const f = fixture();
    try {
      f.render(-5000);
      expect(f.views.update.mock.calls[0]![0]).toBe(0);
      f.render(-4900);
      expect(f.views.update.mock.calls[1]![0]).toBeCloseTo(.1, 3);
    } finally { f.loop.dispose(); }
  });
  it("reconciles resource handoffs after structural sync and before drawing every frame", () => {
    const f = fixture();
    const reconcile = vi.fn(() => { f.order.push("handoff"); });
    f.loop.setEntityViews(f.views as unknown as EntityViews, f.source, f.refresh, reconcile);
    try {
      f.render(1000 / 60);
      expect(f.order).toEqual(["residency", "handoff", "motion", "animation"]);
      f.order.length = 0;
      f.render(300);
      expect(f.order).toEqual(["residency", "source", "structure", "handoff", "motion", "animation"]);
      expect(reconcile).toHaveBeenCalledTimes(2);
    } finally { f.loop.dispose(); }
  });
  it("retimes the independent hit layer without a simulation movement hold", () => {
    const f = fixture();
    f.views.actionDurationSeconds.mockReturnValue(1.034);
    f.views.playAction.mockReturnValue(true);
    try {
      f.deps.clock.elapsedMs = 500; f.deps.clock.timeScale = 2;
      f.loop.handleWorldAction({ sequence: 1, playerId: 'player', position: [0, 0, 0], regionId: 'fallowmarch', type: 'hit',
        hit: { atMs: 500, attacker: 'player', sourceId: 'player', targetId: 'archer', damage: 1,
          hit: true, maxHit: 1, kind: 'melee', killed: false, spellId: null } }, 0);
      f.render(1000 / 60);
      expect(f.views.actionDurationSeconds).toHaveBeenCalledWith('archer', 'hit', 'left');
      expect(f.views.playAction).toHaveBeenCalledWith('archer', 'hit', { impactSide: 'left', durationSeconds: .517 });
    } finally { f.loop.dispose(); }
  });
  it("renders committed enemy shots and clears interrupted flights, realm changes, resets and disposal", () => {
    const f = fixture();
    f.source.mockReturnValue([{ id: "archer", position: [4, 0, 0] }] as never);
    let id = 0, sequence = 0;
    const base = { playerId: "player", position: [0, 0, 0] as const, regionId: "fallowmarch" as const };
    const shoot = (): void => f.loop.handleWorldAction({ ...base, sequence: ++sequence, type: "attack", attack: { id: ++id, attacker: "enemy",
      sourceId: "archer", targetId: "player", kind: "ranged", atMs: 0, contactAtMs: 1000, recoverAtMs: 1200 } }, 0);
    const mesh = (): THREE.InstancedMesh => f.deps.scene.overlayGroup.getObjectByName("enemy-projectiles") as THREE.InstancedMesh;
    try {
      f.deps.clock.elapsedMs = 500;
      shoot(); f.render(1000 / 60);
      expect(mesh().count).toBe(1);
      f.loop.handleWorldAction({ ...base, sequence: ++sequence, type: "attackCancelled", sourceId: "archer" }, 0);
      f.render(2000 / 60);
      expect(mesh().count).toBe(0);
      shoot(); f.render(3000 / 60);
      expect(mesh().count).toBe(1);
      f.deps.store.get().player.regionId = "gravelmaw";
      f.render(4000 / 60);
      expect(mesh().count).toBe(0);
      shoot(); f.render(5000 / 60);
      f.loop.resetPresentation();
      expect(mesh().count).toBe(0);
      shoot(); f.render(6000 / 60);
      expect(mesh().count).toBe(1);
      f.loop.dispose();
      expect(f.deps.scene.overlayGroup.children).toHaveLength(0);
    } finally { f.loop.dispose(); }
  });

  it("chooses hit side using the attacker's position relative to the target's facing", () => {
    const f = fixture();
    const land = (sequence: number): void => f.loop.handleWorldAction({ sequence, playerId: "player", position: [0, 0, 0], regionId: "fallowmarch", type: "hit",
      hit: { atMs: 0, attacker: "player", sourceId: "player", targetId: "archer", damage: 1, hit: true, maxHit: 1, kind: "melee", killed: false, spellId: null } }, 0);
    try {
      land(1); f.render(1000 / 60);
      expect(f.views.playAction).toHaveBeenLastCalledWith("archer", "hit", { impactSide: "left" });
      f.deps.store.get().player.position = [8, 0, 0];
      land(2); f.render(2000 / 60);
      expect(f.views.playAction).toHaveBeenLastCalledWith("archer", "hit", { impactSide: "right" });
    } finally { f.loop.dispose(); }
  });
  it("refreshes residency and interpolates each frame while collecting semantics only at structural cadence", () => {
    const f = fixture();
    try {
      for (let frame = 1; frame <= 58; frame += 1) f.render(frame * 1000 / 60);
      expect(f.refresh).toHaveBeenCalledTimes(58);
      expect(f.views.syncResidentMotion).toHaveBeenCalledTimes(58);
      expect(f.views.syncResidentMotion).toHaveBeenLastCalledWith(1);
      expect(f.source).toHaveBeenCalledTimes(3);
      expect(f.views.sync).toHaveBeenCalledTimes(3);
      expect(f.order.slice(0, 3)).toEqual(["residency", "motion", "animation"]);
      for (let i = 0; i < f.order.length; i += 1) {
        if (f.order[i] === "source") expect(f.order.slice(i - 1, i + 4))
          .toEqual(["residency", "source", "structure", "motion", "animation"]);
      }
    } finally { f.loop.stop(); }
  });

  it("replaces stale residency callbacks on reattachment", () => {
    const f = fixture();
    try {
      f.render(1000 / 60);
      f.deps.clock.paused = true;
      f.loop.setEntityViews(f.views as unknown as EntityViews, f.source);
      f.render(2000 / 60);
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
    try {
      f.loop.setRemoteTraversal(sample); f.render(1000 / 60);
      expect(f.deps.store.get().player.position).toEqual([0, 0, 0]);
      expect(rig.setPosition).toHaveBeenLastCalledWith([1.25, 0.6, 0], Math.PI / 2);
      expect(f.deps.scene.syncPlayer).toHaveBeenLastCalledWith([1.25, 0.6, 0], Math.PI / 2);
      expect(f.deps.camera.update).toHaveBeenLastCalledWith(1.25, 0.6, 0);
      expect(rig.play).not.toHaveBeenCalled();
      expect(rig.syncTraversalPose).toHaveBeenLastCalledWith(sample);
      sample = { ...sample, concealed: true, position: [0, 0, 0], kind: "passage" };
      f.loop.setRemoteTraversal(sample); f.render(2000 / 60);
      expect(rig.play).not.toHaveBeenCalled();
      expect(rig.syncTraversalPose).toHaveBeenLastCalledWith(sample);
      f.deps.store.get().player.position = [1.5, 0, 0];
      sample = null;
      f.loop.setRemoteTraversal(sample); f.render(3000 / 60);
      expect(rig.syncTraversalPose).toHaveBeenLastCalledWith(null);
      expect(f.deps.scene.syncPlayer).toHaveBeenLastCalledWith([1.5, 0, 0], 0);
    } finally { f.loop.stop(); }
  });
});
