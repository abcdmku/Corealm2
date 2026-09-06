import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameLoop, type LoopDeps } from "../game/src/app/loop.js";
import type { CharacterRig, CharacterMotionEvent } from "../game/src/render/characterRig.js";
import type { CombatAttackStart, CombatHit } from "../game/src/systems/combat.js";
import { CorealmAudioBridge } from "../game/src/audio/gameAudio.js";
import { Store } from "../game/src/state/store.js";
import type { AudioEngine } from "../game/src/audio/engine.js";
import type { AudioDirector } from "../game/src/audio/director.js";

afterEach(() => vi.unstubAllGlobals());

/**
 * Measured on hardware before this change: `combat.melee_swing` and `combat.melee_hit` started
 * 1.4 ms apart, both at the contact tick, because every melee hit reached the presentation handler
 * as "combined". The rig's swing marker on `Sword_Attack` now sounds the whoosh first.
 */
function fixture() {
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const state = {
    player: { id: "player", position: [0, 0, 0], facingRad: 0, health: 100, regionId: "fallowmarch", movement: { mode: "idle" } },
    equipment: {}, combat: { targetId: "bear", engagedBy: [] }, magic: { weaponCharges: {} }, activity: null,
  };
  const deps = {
    events: { subscribe: vi.fn() },
    store: { get: () => state },
    clock: { advance: () => 0, paused: false, timeScale: 1, alpha: () => 0.5, elapsedMs: 0 },
    scene: { overlayGroup: new THREE.Group(), syncPlayer: vi.fn(), materials: { updatePlayerOcclusion: vi.fn() } },
    camera: { update: vi.fn() },
    renderer: { camera: new THREE.PerspectiveCamera(), renderer: {}, followShadow: vi.fn(), render: vi.fn() },
    input: { update: vi.fn() },
  };
  const loop = new GameLoop(deps as unknown as LoopDeps);
  const motion: CharacterMotionEvent[] = [];
  const rig = {
    root: { visible: true },
    setPosition: vi.fn(), play: vi.fn(), poseFor: vi.fn(() => "idle"), setLocomotionSpeed: vi.fn(),
    syncTraversalPose: vi.fn(), update: vi.fn(), syncGatheringCycle: vi.fn(),
    drainMotionEvents: () => motion.splice(0, motion.length),
    meleeTiming: () => ({ contactMs: 460, recoveryMs: 1533, clipSeconds: 1.533333 }),
    visibleSlots: () => [], applyEquipment: vi.fn(async () => undefined),
    motionSnapshot: vi.fn(() => null),
  };
  loop.setPlayerRig(rig as unknown as CharacterRig);
  const phases: Array<{ kind: CombatHit["kind"]; hit: boolean; phase: string }> = [];
  loop.setCombatPresentationHandler((hit, phase) => phases.push({ kind: hit.kind, hit: hit.hit, phase }));
  let starts: CombatAttackStart[] = [];
  let hits: CombatHit[] = [];
  loop.setCombatAttackStarts(() => starts.splice(0, starts.length));
  loop.setCombatHits(() => hits.splice(0, hits.length));
  loop.start();
  const started = performance.now();
  const start: CombatAttackStart = { id: 1, atMs: 0, contactAtMs: 460, recoverAtMs: 1533, attacker: "player", sourceId: "player", targetId: "bear", kind: "melee" };
  const hit: CombatHit = { atMs: 460, attacker: "player", sourceId: "player", targetId: "bear", damage: 3, hit: true, maxHit: 5, kind: "melee", killed: false, spellId: null };
  return { loop, motion, phases, start, hit, queueStart: (s: CombatAttackStart) => { starts.push(s); }, queueHit: (h: CombatHit) => { hits.push(h); },
    render: (offset: number) => frame!(started + offset) };
}

describe("melee swing and contact presentation", () => {
  it("sounds the swing on the rig marker and presents the contact as impact only", () => {
    const f = fixture();
    try {
      f.queueStart(f.start);
      f.render(16);
      expect(f.phases).toEqual([]);
      f.motion.push({ kind: "swing", pose: "attack_melee" });
      f.render(300);
      expect(f.phases).toEqual([{ kind: "melee", hit: false, phase: "swing" }]);
      // A repeated swing marker inside one attack does not double the whoosh.
      f.motion.push({ kind: "swing", pose: "attack_melee" });
      f.render(320);
      expect(f.phases).toHaveLength(1);
      f.queueHit(f.hit);
      f.render(470);
      expect(f.phases).toEqual([
        { kind: "melee", hit: false, phase: "swing" },
        { kind: "melee", hit: true, phase: "impact" },
      ]);
    } finally { f.loop.dispose(); }
  });

  it("falls back to the combined voice when no swing marker fired", () => {
    const f = fixture();
    try {
      f.queueStart(f.start);
      f.render(16);
      f.queueHit(f.hit);
      f.render(470);
      expect(f.phases).toEqual([{ kind: "melee", hit: true, phase: "combined" }]);
      // Markers from other poses, such as a chop mid-fight, never sound a combat swing.
      f.queueStart({ ...f.start, id: 2, atMs: 1600, contactAtMs: 2060, recoverAtMs: 3133 });
      f.render(1620);
      f.motion.push({ kind: "swing", pose: "chop" });
      f.render(1900);
      expect(f.phases).toHaveLength(1);
    } finally { f.loop.dispose(); }
  });

  it("magic contact is unaffected and the bridge maps each phase to one cue", () => {
    const f = fixture();
    try {
      f.queueHit({ ...f.hit, kind: "magic", spellId: "voltrend" });
      f.render(16);
      expect(f.phases).toEqual([{ kind: "magic", hit: true, phase: "impact" }]);
    } finally { f.loop.dispose(); }

    const store = new Store(1, 0);
    const engine = { playCue: vi.fn(), resetOneShots: vi.fn(), setListenerPose: vi.fn() };
    const director = { observeCombatHit: vi.fn(), setRegion: vi.fn(), reset: vi.fn() };
    const bridge = new CorealmAudioBridge({ store, engine: engine as unknown as AudioEngine,
      director: director as unknown as AudioDirector, entity: () => undefined, surfaceAt: () => "grass" });
    bridge.handlePlayerCombatMotion({ ...f.hit, hit: false, damage: 0 }, "swing");
    bridge.handlePlayerCombatMotion(f.hit, "impact");
    bridge.handlePlayerCombatMotion({ ...f.hit, hit: false, damage: 0 }, "impact");
    bridge.handlePlayerCombatMotion({ ...f.hit, killed: true }, "impact");
    expect(engine.playCue.mock.calls.map(([cue]) => cue)).toEqual([
      "combat.melee_swing", "combat.melee_hit", "combat.melee_miss", "combat.melee_hit", "combat.enemy_death",
    ]);
    expect(director.observeCombatHit).not.toHaveBeenCalled();
  });

  it("routes the enemy's blows through the director and drops its death cue for the canonical one", () => {
    // `paintCombatHits` hands EVERY resolved hit to this handler, the enemy's included, and an
    // enemy hit is always "combined" because only the player's rig has a swing marker. There is no
    // second entry point: `handleCombatHits` used to exist alongside this, with no caller anywhere
    // in the repo and a comment claiming a de-duplication that this path gets from `resetOneShots`
    // instead. It is gone, and this pins what the live path actually does.
    const store = new Store(1, 0);
    const engine = { playCue: vi.fn(), resetOneShots: vi.fn(), setListenerPose: vi.fn() };
    const director = { observeCombatHit: vi.fn(), setRegion: vi.fn(), reset: vi.fn(), observeGameEvent: vi.fn() };
    const bridge = new CorealmAudioBridge({ store, engine: engine as unknown as AudioEngine,
      director: director as unknown as AudioDirector, entity: () => undefined, surfaceAt: () => "grass" });

    const incoming: CombatHit = { atMs: 0, attacker: "enemy", sourceId: "bear", targetId: "player",
      damage: 7, hit: true, maxHit: 9, kind: "melee", killed: false, spellId: null };
    bridge.handlePlayerCombatMotion(incoming, "combined");
    bridge.handlePlayerCombatMotion({ ...incoming, hit: false, damage: 0 }, "combined");
    bridge.handlePlayerCombatMotion({ ...incoming, killed: true }, "combined");
    expect(director.observeCombatHit).toHaveBeenCalledTimes(3);
    // The bridge itself sounds nothing for an incoming blow; cue selection is the director's.
    expect(engine.playCue).not.toHaveBeenCalled();

    // Events flush after presentation, so the director's two pending cues for the lethal hit are
    // still waiting on their buffers when this lands and invalidates them.
    bridge.handleEvent({ seq: 1, type: "player.died", atMs: 0, entityId: "player", data: {} });
    expect(engine.resetOneShots).toHaveBeenCalledTimes(1);
    expect(engine.playCue.mock.calls.map(([cue]) => cue)).toEqual(["combat.player_death"]);
    expect(engine.resetOneShots.mock.invocationCallOrder[0]!)
      .toBeLessThan(engine.playCue.mock.invocationCallOrder[0]!);
  });
});
