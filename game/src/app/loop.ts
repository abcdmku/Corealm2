import { interpolatedGroundHeight } from "../render/terrainContact.js";
/**
 * The update loop. Fixed 100 ms sim tick with an accumulator, decoupled from render.
 *
 * Update order matters and is fixed by runs/corealm/PRD.md section 3. The one ordering that must
 * never be changed: events flush LAST, after quests, so a `level.gained` and the `quest.updated`
 * it triggers land in the same tick and in causal order.
 *
 * The render half of this file interpolates. The sim moves the player 0.4202 m in one instant, ten
 * times a second; the camera, the world and the UI move every frame. Measured at 480 fps across
 * 11,050 frames of continuous movement, only 170 of them (1.54%) contained any player displacement
 * at all, and the camera's follow lag sawtoothed 0.005 m -> 0.692 m every 100 ms against a player
 * that teleported. So `renderFrame` draws the player at a point BETWEEN the last two sim ticks and
 * everything that follows the player — scene, rig, camera, shadow — reads that same interpolated
 * pose. The cost is up to one tick of latency on the drawn character, which is the standard trade
 * and is invisible next to a 42 cm jump.
 */
import type { GameState, Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import type { RngStreams } from "../core/rng.js";
import type { Renderer } from "../render/renderer.js";
import type { OrbitCamera } from "../render/camera.js";
import type { WorldScene } from "../render/scene.js";
import type { Navigation } from "../systems/navigation.js";
import type { Movement } from "../systems/movement.js";
import type { TraversalSample } from "../systems/traversalMotion.js";
import { EnemyProjectiles } from "../render/enemyProjectiles.js";
import type { CombatAttackStart, CombatHit } from "../systems/combat.js";
import type { CorealmGameApi } from "../api/gameApi.js";
import type { SaveService } from "../persistence/storage.js";
import type { InputController } from "../input/mouse.js";
import type { EntityViews } from "../render/entityViews.js";
import type {
  CharacterMotionEvent,
  CharacterRig,
  CharacterPose,
  GearWeaponChargePresentationLike,
} from "../render/characterRig.js";
import type { Vfx } from "../render/vfx.js";
import type { SpellVfx } from "../render/spellVfx.js";
import type { HealthBars } from "../render/healthBars.js";
import { content } from "../content/index.js";
import type { GameEvent, ItemId, SkillId, SpellElement, SpellRung } from "../contracts.js";
import type { Ui } from "../ui/panels.js";
import type { EntityId, SemanticEntity, Vec3 } from "../contracts.js";
import { GATHER_TICK_MS, SIM_TICK_MS } from "../core/time.js";
import { AUTOSAVE_INTERVAL_MS, MOVEMENT } from "./config.js";

/**
 * The overlay layer's per-frame hook. Gets the player as DRAWN this frame, interpolated between
 * sim ticks, because a route head that follows the store's position steps at the sim rate.
 */
export interface OverlayTicker {
  update(nowMs: number, playerRenderPosition: Vec3): void;
}

/** A system that wants a slice of each sim tick. Registered by later build rounds. */
export interface TickSystem {
  readonly name: string;
  /** Lower runs earlier. Keep inside the PRD's documented order. */
  readonly order: number;
  tick(deltaMs: number, atMs: number): void;
}

export interface LoopDeps {
  store: Store;
  events: EventBus;
  clock: SimClock;
  rng: RngStreams;
  renderer: Renderer;
  camera: OrbitCamera;
  updateRoofVisibility?(position: Vec3 | null): void;
  scene: WorldScene;
  nav: Navigation;
  movement: Movement;
  api: CorealmGameApi;
  saves: SaveService;
  input: InputController;
}

/**
 * The slice of `state.player.movement` the render layer reads.
 *
 * Speed is the sim's, not a per-frame position delta. The old code differenced
 * `state.player.position` between rendered frames and handed the result to `poseFor`, which meant
 * the rig was told "standing still" on 98.5% of frames and "running at 190 m/s" on the other 1.5%:
 * `play()` flipped idle<->run about twenty times a second and `action.reset()` restarted the jog
 * clip every time, so a 100 fps screencast showed the body pose pixel-identical across 116 ms of a
 * 0.933 s clip.
 *
 * `speed` and `gait` are what `Movement.publishSpeed` writes onto the movement record each tick
 * (`MovementSpeedFields` in systems/movement.ts). They are optional here because `state/store.ts`
 * declares only the fields it declared before — the writer landed in the same wave as this reader,
 * and a structural read costs nothing and cannot break if it is ever withdrawn. The fallback is the
 * old behaviour: moving means running at the configured speed.
 *
 * `gait` rather than `mode` decides whether the character is moving, because `mode` stays "direct"
 * through the deceleration coast and because a player walking into a wall keeps `mode: "direct"`
 * while `speed` is 0 — the published speed is measured AFTER the collision clamp, so it reads as
 * standing still, which is what they are.
 */
interface PlayerMovementView {
  mode: "idle" | "path" | "direct";
  speed?: number;
  gait?: "idle" | "walk" | "run";
}

/**
 * Above this, the player did not walk — it was teleported, and the render pose snaps.
 *
 * One sim tick of running is 4.2 m/s * 0.1 s = 0.4202 m measured, so 2 m is ~4.8 steps of headroom
 * and still far under the smallest thing anyone calls a teleport (a respawn crosses regions).
 * Without it, `__gameDebug.teleport` and every death respawn would smear the character across the
 * map over 100 ms.
 */
const TELEPORT_SNAP_METRES = 2;
const TELEPORT_SNAP_SQUARED = TELEPORT_SNAP_METRES * TELEPORT_SNAP_METRES;

const TWO_PI = Math.PI * 2;

/**
 * Tools are carried, not equipped. Return the strongest matching tool in the pack so the held
 * fishing model shows what the gathering roll actually uses.
 */
function bestCarriedGatheringTool(state: GameState, skill: SkillId): ItemId | null {
  let best: { itemId: ItemId; bonus: number } | null = null;
  for (const stack of state.inventory.slots) {
    if (!stack) continue;
    const tool = content.item(stack.itemId)?.tool;
    if (!tool || tool.skill !== skill) continue;
    if (!best || tool.gatherBonus > best.bonus) {
      best = { itemId: stack.itemId, bonus: tool.gatherBonus };
    }
  }
  return best?.itemId ?? null;
}


/**
 * How fast the single casting clip plays, by rung.
 *
 * `Spell_Simple_Shoot` is 1.0 s of the same gesture whatever is being thrown. A lash runs slightly
 * hot so a cheap dart looks flicked; a surge runs at two-thirds speed so the biggest spell in the
 * game looks like it costs something. The band is deliberately narrow — below about 0.6 the clip
 * stops reading as one motion and starts reading as a stutter, and the cast still has to finish
 * inside the 3000 ms it is given.
 */
/**
 * Height above the player's feet that a spell is emitted from.
 *
 * Chest height on the 1.8 m rigs this game uses, so the bolt leaves the middle of the character
 * rather than their head or their shins.
 */
const CAST_ORIGIN_HEIGHT = 1.1;

function castTimeScale(rung: SpellRung | null): number | null {
  switch (rung) {
    case "lash": return 1.15;
    case "bolt": return 1.0;
    case "burst": return 0.85;
    case "surge": return 0.7;
    default: return null;
  }
}

export class GameLoop {
  private running = false;
  private frameHandle = 0;
  private lastFrameAt = 0;
  private lastAutosaveAt = 0;
  private systems: TickSystem[] = [];
  private entityViews: EntityViews | null = null;
  private entitySource: (() => SemanticEntity[]) | null = null;
  private refreshEntityResidency: (() => void) | null = null;
  private reconcileEntityPresentation: (() => void) | null = null;
  private traversalPresentation: (() => TraversalSample | null) | null = null;
  private traversalWasVisible = false;
  private viewSyncAccumulatorMs = 0;
  private overlays: OverlayTicker | null = null;
  private playerRig: CharacterRig | null = null;
  private vfx: Vfx | null = null;
  private drainHits: (() => readonly CombatHit[]) | null = null;
  private drainAttackStarts: (() => readonly CombatAttackStart[]) | null = null;
  private attackStillCommitted: ((id: EntityId) => boolean) | null = null;
  private enemyProjectiles: EnemyProjectiles | null = null;
  private projectileRegion: string | null = null;
  private playerMotionHandler: ((event: CharacterMotionEvent) => void) | null = null;
  private combatPresentationHandler: ((hit: CombatHit, phase: "swing" | "impact" | "combined") => void) | null = null;
  /**
   * The player's current melee wind-up, so the rig's measured swing frame can sound the whoosh.
   *
   * The hit log only exists at contact, and the presentation handler used to receive every melee
   * hit as `"combined"` at that instant: measured on hardware, `combat.melee_swing` and
   * `combat.melee_hit` started 1.4 ms apart, both at contact, so the swing never led the blow. The
   * swing marker on `Sword_Attack` (phase 0.18) fires here first; contact then presents as
   * `"impact"` only. If no swing marker fired, because the rig is absent or a flinch replaced the
   * attack pose, contact still falls back to `"combined"` and nothing is lost.
   */
  private pendingPlayerSwing: CombatAttackStart | null = null;
  private playerSwingSounded = false;
  private spellVfx: SpellVfx | null = null;
  private healthBars: HealthBars | null = null;
  /** Scratch for the cast origin, so a cast allocates nothing. */
  private readonly spellOriginTuple: [number, number, number] = [0, 0, 0];
  private fishingRigKey: string | null = null;
  private gatheringRigKey: string | null = null;
  private ui: Ui | null = null;
  private interiors: { group: { visible: boolean }; visible: () => boolean }[] = [];
  private frameObserver: ((frameMs: number) => void) | null = null;

  /**
   * The sim pose before the most recent tick. How far through the next one we are now comes from
   * `SimClock.alpha()`.
   *
   * This used to mirror the clock's own accumulator, because that field was private. Two copies of
   * one integrator is two things that can drift apart, and the one that drifts is the one nothing
   * tests, so the clock publishes it now and the mirror is gone.
   */
  private prevPlayerPos: [number, number, number] = [0, 0, 0];
  private prevFacingRad = 0;
  private havePrevPose = false;
  private renderAlpha = 1;
  /** Scratch, reused every frame. The render pose is written here rather than allocated. */
  private readonly renderPos: [number, number, number] = [0, 0, 0];
  private renderFacingRad = 0;

  /**
   * Worn item ids, in `rig.visibleSlots()` order, from the last frame that changed.
   *
   * A per-frame diff rather than a subscription to `item.equipped`, because it also covers
   * save-load, `__gameDebug.reset` and a scenario granting a kit directly — none of which emit an
   * equip event. It allocates nothing: the comparison walks a fixed-length array of interned item
   * id strings.
   */
  private wornItemIds: (string | null)[] = [];
  /** Charged weapon id plus charged/empty state from the last rig sync. */
  private wornWeaponChargeSignature: string | null = null;
  private archetypeOf: ((entityId: EntityId) => string | null) | null = null;
  /** Set by the event subscription, drained by the next render frame. */
  private pendingRigPose: CharacterPose | null = null;
  /**
   * Playback rate for the pose in `pendingRigPose`, when it should not run at its authored tempo.
   *
   * Set only for casts, and only from the spell's rung. The 86-clip animation library ships exactly
   * one casting motion (`Spell_Simple_Shoot`; the other three Spell_Simple_* clips are Enter, Exit
   * and an idle loop), so without this every spell from Emberlash to Kilnsurge is the same 1.0 s
   * gesture and the rung the player picked reads nowhere on the body.
   */
  private pendingRigPoseTimeScale: number | null = null;

  constructor(private readonly deps: LoopDeps) {
    // A bank interaction is instantaneous rather than a stored activity, so `BankSystem` publishes
    // `activity.started` on the bank entity. Boot opens the window off the same signal. Without an
    // archetype lookup wired in, the chest-opening pose stays dormant and nothing else changes.
    deps.events.subscribe((event) => {
      if (event.type !== "activity.started" || !event.entityId) return;
      if (this.archetypeOf?.(event.entityId) !== "bank") return;
      this.pendingRigPose = "bank";
    });
  }

  /**
   * Attaches the render mirror of the semantic world.
   *
   * Kept out of `LoopDeps` because the views are built after the world is, and the loop must be
   * constructible before them. Views resync on a slow cadence rather than every frame: entity state
   * changes at gameplay speed, not at 240 Hz, and a full diff every frame is pure waste.
   */
  setEntityViews(views: EntityViews, entities: () => SemanticEntity[], refreshResidency?: () => void, reconcilePresentation?: () => void): void {
    this.entityViews = views;
    this.entitySource = entities;
    this.refreshEntityResidency = refreshResidency ?? null;
    this.reconcileEntityPresentation = reconcilePresentation ?? null;
  }

  /** Samples presentation without moving the authoritative player before traversal resolves. */
  setTraversalPresentation(sample: () => TraversalSample | null): void {
    this.traversalPresentation = sample;
  }

  /**
   * Overlays tick every frame: they expire on a timer and follow entities that move. Boot hands in
   * the guidance layer, which runs the renderer's update after its own arrival and route checks.
   */
  setOverlays(overlays: OverlayTicker): void {
    this.overlays = overlays;
  }

  /** The player's skinned rig, when one built successfully. */
  setPlayerRig(rig: CharacterRig): void {
    this.playerRig = rig;
  }

  /**
   * How the loop asks what an entity is, without importing the world layer.
   *
   * Only consumer today is the bank pose. Optional: unwired, the lookup returns nothing and the
   * `Chest_Open` clip simply never fires, which is the behaviour before this wave.
   */
  setArchetypeLookup(lookup: (entityId: EntityId) => string | null): void {
    this.archetypeOf = lookup;
  }

  /**
   * Plays a one-shot on the player rig at the next rendered frame.
   *
   * The seam for anything that is not movement, a stored activity or a swing. Bank interaction is
   * instantaneous, so its event schedules this pose without adding a fake timer to game state.
   */
  playPose(pose: CharacterPose): void {
    this.pendingRigPose = pose;
  }

  /** Floating combat and XP feedback. Ticked on real time so it reads the same at any time scale. */
  setVfx(vfx: Vfx): void {
    this.vfx = vfx;
  }

  /**
   * The spell effect layer. Optional: unwired, casts still resolve, still award XP and still play
   * their cue — they simply pay out on the rig's contact marker like a sword does.
   */
  setSpellVfx(spellVfx: SpellVfx): void {
    this.spellVfx = spellVfx;
  }

  /**
   * Health bars over the player and the creatures in the fight. Optional: unwired, the HUD's own
   * bar is the only readout, which is how every fight read before this landed.
   */
  setHealthBars(healthBars: HealthBars): void {
    this.healthBars = healthBars;
  }

  /**
   * Where damage numbers come from.
   *
   * `systems/combat.ts` has kept a hit log since round 3, with a comment on `consumeHits()` saying
   * "render/vfx.ts polls this for damage numbers", and nothing ever polled it — `Vfx.damage()` had
   * no callers anywhere in the project. So every fight in the game, including the two-phase boss,
   * happened in complete silence: health bars moved and nothing else did. It went unnoticed because
   * the gate check reads combat out of XP and entity state, which are both correct.
   *
   * The same drain now also drives the swing and flinch poses, which is the only place the edge
   * they need is visible: `PlayerView.inCombat` is a multi-second state flag, and `Sword_Attack`
   * and `Hit_Chest` are 1.533 s and 0.333 s events.
   *
   * The log is drained rather than read, so a frame that drops cannot replay yesterday's swings.
   */
  setCombatHits(drain: () => readonly CombatHit[]): void {
    this.drainHits = drain;
  }

  setCombatAttackStarts(drain: () => readonly CombatAttackStart[], committed?: (id: EntityId) => boolean): void {
    this.drainAttackStarts = drain;
    this.attackStillCommitted = committed ?? null;
  }

  /** Sound and other presentation systems consume the rig's measured contact frames here. */
  setPlayerMotionHandler(handler: (event: CharacterMotionEvent) => void): void {
    this.playerMotionHandler = handler;
  }

  /** Splits a resolved player attack into its visible swing and contact frames. */
  setCombatPresentationHandler(
    handler: (hit: CombatHit, phase: "swing" | "impact" | "combined") => void,
  ): void {
    this.combatPresentationHandler = handler;
  }

  /** The human UI. `update()` is internally throttled, so calling it every frame is correct. */
  setUi(ui: Ui): void {
    this.ui = ui;
  }

  /**
   * An interior that should only render while the player is inside it.
   *
   * The Gravelmaw sits a few metres below Karrowmoor, so its floors, walls and ceilings were being
   * drawn from every surface pose — six draw calls over budget at Highcairn for geometry nobody
   * could see through the moor.
   */
  addInterior(group: { visible: boolean }, visible: () => boolean): void {
    this.interiors.push({ group, visible });
  }

  setFrameObserver(observer: (frameMs: number) => void): void {
    this.frameObserver = observer;
  }

  /** Later rounds register their systems here. Kept sorted by declared order. */
  addSystem(system: TickSystem): void {
    this.systems.push(system);
    this.systems.sort((a, b) => a.order - b.order);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameAt = performance.now();
    this.deps.renderer.resetFrameTiming?.();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  isRunning(): boolean {
    return this.running;
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  /** Releases loop-owned presentation resources when the game is torn down. */
  dispose(): void {
    this.stop();
    this.enemyProjectiles?.dispose();
    this.enemyProjectiles = null;
  }

  /** Clears render-only work when debug or save loading replaces the canonical world. */
  resetPresentation(): void {
    this.enemyProjectiles?.clear();
    this.pendingRigPose = null;
    this.pendingRigPoseTimeScale = null;
    this.gatheringRigKey = null;
    this.pendingPlayerSwing = null;
    this.playerSwingSounded = false;
    this.playerRig?.drainMotionEvents();
    this.playerRig?.play("idle", true);
  }

  private frame = (nowMs: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.frame);

    const frameMs = nowMs - this.lastFrameAt;
    const realDelta = Math.min(frameMs, 250);
    this.lastFrameAt = nowMs;

    const clock = this.deps.clock;
    const ticks = clock.advance(realDelta);
    for (let i = 0; i < ticks; i += 1) {
      // Captured per tick, not per batch: the render pose interpolates across the LAST tick, so a
      // catch-up batch of eight still draws the final 100 ms rather than smearing 800 ms of motion.
      this.capturePrevPose();
      this.simTick();
    }
    // A paused sim runs no ticks, so a blend held at whatever alpha the pause caught would freeze
    // the character part-way between two tick poses — and `__gameDebug.teleport` while paused would
    // leave it stranded there. alpha 1 is the true sim pose, which is the only honest thing to draw
    // when nothing is advancing, and it is what `SimClock.alpha()` deliberately does not return.
    this.renderAlpha = clock.paused ? 1 : clock.alpha();

    this.renderFrame(nowMs, realDelta);
    this.maybeAutosave(nowMs);
    this.frameObserver?.(frameMs);
  };

  /** One 100 ms simulation step. */
  private simTick(): void {
    const { store, clock, movement, events } = this.deps;
    const state = store.get();
    const atMs = clock.elapsedMs;

    // 1. input has already been folded into the movement controller by the input layer
    // 2. movement
    movement.update(state, SIM_TICK_MS, atMs);

    // 4..11. registered systems: gathering, production, combat, enemy AI, health, quests
    for (const system of this.systems) system.tick(SIM_TICK_MS, atMs);

    // 13. clock commit
    clock.commitTick();
    state.meta.playSeconds += SIM_TICK_MS / 1000;
    // Played time is persisted state and is also the clock for portable fires and resource
    // respawns. Keep the save dirty between autosave intervals so an idle countdown cannot rewind
    // after reload. `Store` holds one boolean, so this does not queue writes per tick.
    store.markDirty();

    // 14. events flush LAST, on purpose.
    events.flush();
  }

  private capturePrevPose(): void {
    const player = this.deps.store.get().player;
    this.prevPlayerPos[0] = player.position[0];
    this.prevPlayerPos[1] = player.position[1];
    this.prevPlayerPos[2] = player.position[2];
    this.prevFacingRad = player.facingRad;
    this.havePrevPose = true;
  }

  /**
   * Writes the drawn player pose into `renderPos` / `renderFacingRad`.
   *
   * Facing takes the shortest arc, so a turn across the -pi/pi seam interpolates 20 degrees rather
   * than 340. It matters: `turnToward` runs once per sim tick with deltaMs 100, so a direct-input
   * turn steps up to 1.26 rad (72 degrees) at once and the rig read that raw.
   */
  private updateRenderPose(alpha: number): void {
    const player = this.deps.store.get().player;
    const current = player.position;
    if (!this.havePrevPose) {
      this.renderPos[0] = current[0];
      this.renderPos[1] = current[1];
      this.renderPos[2] = current[2];
      this.renderFacingRad = player.facingRad;
      return;
    }

    const dx = current[0] - this.prevPlayerPos[0];
    const dy = current[1] - this.prevPlayerPos[1];
    const dz = current[2] - this.prevPlayerPos[2];
    if (dx * dx + dy * dy + dz * dz > TELEPORT_SNAP_SQUARED) {
      this.prevPlayerPos[0] = current[0];
      this.prevPlayerPos[1] = current[1];
      this.prevPlayerPos[2] = current[2];
      this.prevFacingRad = player.facingRad;
      this.renderPos[0] = current[0];
      this.renderPos[1] = current[1];
      this.renderPos[2] = current[2];
      this.renderFacingRad = player.facingRad;
      return;
    }

    this.renderPos[0] = this.prevPlayerPos[0] + dx * alpha;
    this.renderPos[1] = this.prevPlayerPos[1] + dy * alpha;
    this.renderPos[2] = this.prevPlayerPos[2] + dz * alpha;
    this.renderPos[1] = interpolatedGroundHeight(this.prevPlayerPos, current, this.renderPos,
      (x, z) => this.deps.scene.meshHeightAt(x, z));

    let turn = (player.facingRad - this.prevFacingRad) % TWO_PI;
    if (turn > Math.PI) turn -= TWO_PI;
    else if (turn < -Math.PI) turn += TWO_PI;
    this.renderFacingRad = this.prevFacingRad + turn * alpha;
  }

  private renderFrame(nowMs: number, realDeltaMs: number): void {
    const { store, scene, camera, renderer, input } = this.deps;
    const state = store.get();

    const traversal = this.traversalPresentation?.() ?? null;
    // Completion and recovery already reach their landing. Reusing the preceding simulation
    // interpolation span here would pull the rendered player back toward the entry for a tick.
    if (!traversal && this.traversalWasVisible) this.havePrevPose = false;
    this.updateRenderPose(this.renderAlpha);
    if (traversal) {
      this.renderPos[0] = traversal.position[0];
      this.renderPos[1] = traversal.position[1];
      this.renderPos[2] = traversal.position[2];
      this.renderFacingRad = traversal.facingRad;
    }
    this.traversalWasVisible = traversal !== null;
    const position: Vec3 = this.renderPos;
    const facingRad = this.renderFacingRad;

    input.update();
    for (const interior of this.interiors) interior.group.visible = interior.visible();
    // Residency follows the player every frame, including frames without a structural diff.
    // Keep this separate from collecting the complete semantic snapshot.
    this.refreshEntityResidency?.();
    this.syncEntityViews(realDeltaMs);
    this.reconcileEntityPresentation?.();
    // Structure at 4 Hz, motion every frame. `sync` is throttled because rebuilding instance groups
    // is expensive, but `EnemyAiSystem.stepToward` writes a new position every 100 ms sim tick, so
    // at 4 Hz three of every four movement steps were invisible and the fourth was a 40 cm jump.
    // The resident references are refreshed by structural sync and active-area changes.
    this.entityViews?.syncResidentMotion(this.renderAlpha);
    // Animation advances on real time, not sim time: a paused sim should still idle, and a
    // time-scaled test run should not play idles at 100x.
    //
    // The corpse fade is the exception and takes the SIM clock, which is why both go in. It is a
    // function of `nowMs - view.diedAtMs`, and that instant was stamped on the sim clock, so any
    // other time base would make a body dissolve at the wrong moment - or on a resumed save, at a
    // wildly wrong one.
    this.entityViews?.update(realDeltaMs / 1000, renderer.camera.position, this.deps.clock.elapsedMs);
    this.overlays?.update(this.deps.clock.elapsedMs, position);
    if (this.projectileRegion !== state.player.regionId) this.enemyProjectiles?.clear();
    this.projectileRegion = state.player.regionId;
    this.presentAttackStarts();
    if (this.enemyProjectiles) {
      this.enemyProjectiles.update(this.deps.clock.elapsedMs,
        (id) => this.attackStillCommitted?.(id) ?? false,
        (id) => id === state.player.id ? position : this.entityViews?.motionSnapshot(id)?.drawnPosition);
    }
    this.paintCombatHits(nowMs);
    this.vfx?.update(nowMs);
    // After `vfx`, so a spell burst draws over the floating numbers rather than under them.
    this.spellVfx?.update(nowMs);
    this.ui?.update();
    this.syncPlayerEquipment();
    this.syncPlayerRig(position, facingRad, realDeltaMs, nowMs, traversal);
    scene.syncPlayer(position, facingRad);
    this.deps.updateRoofVisibility?.(this.playerRig?.root.visible === false ? null : position);
    camera.update(position[0], position[1], position[2]);
    renderer.followShadow(renderer.camera.position.clone().setY(position[1]));
    renderer.camera.updateMatrixWorld();
    // After the camera has moved for this frame, unlike the floaters above, so a bar pinned over a
    // head projects through THIS frame's view and does not trail it by one.
    this.healthBars?.update(nowMs, position);
    scene.materials.updatePlayerOcclusion(renderer.renderer, renderer.camera, position,
      this.playerRig?.root.visible ?? true);
    renderer.render(nowMs);
  }

  /**
   * Drives the player rig: position, facing, the pose implied by what the player is doing, and the
   * stride rate that keeps the feet from skating.
   *
   * Everything here reads the sim, not the scene graph. The one thing that used to come from the
   * render frame — speed, differenced between drawn positions — is exactly what froze the run
   * animation; see `PlayerMovementView`.
   */
  private syncPlayerRig(position: Vec3, facingRad: number, realDeltaMs: number, nowMs: number,
    traversal: TraversalSample | null = null): void {
    const rig = this.playerRig;
    if (!rig) return;

    const state = this.deps.store.get();
    const movement: PlayerMovementView = state.player.movement;
    const moving = movement.gait ? movement.gait !== "idle" : movement.mode !== "idle";
    const speed = movement.speed ?? (moving ? MOVEMENT.runSpeed : 0);
    const activity = state.activity;

    const fishingSpot = activity?.kind === "gathering" && activity.skill === "fishing"
      ? this.entityPositionFor(activity.entityId) : null;
    rig.setPosition(position, fishingSpot && state.player.health > 0
      ? Math.atan2(fishingSpot[0] - position[0], fishingSpot[2] - position[2]) : facingRad);

    // A one-shot claimed by an interaction or a swing outranks the steady-state pose for this
    // frame; `update()` drops back to idle when the clip finishes.
    const forced = this.pendingRigPose;
    const forcedTimeScale = this.pendingRigPoseTimeScale;
    this.pendingRigPose = null;
    this.pendingRigPoseTimeScale = null;
    const activeTraversal = state.player.health > 0 ? traversal : null;
    if (forced && state.player.health > 0 && !activeTraversal) {
      rig.play(forced, true, forcedTimeScale ?? undefined);
    } else {
      const pose = rig.poseFor({
        moving,
        speed,
        dead: state.player.health <= 0,
        inCombat: state.combat.targetId !== null || state.combat.engagedBy.length > 0,
        activityKind: activity?.kind ?? null,
        activitySkill: activity?.kind === "gathering" ? activity.skill : null,
        activityTier: activity?.kind === "gathering" ? activity.nodeTier : null,
        activityToolItemId: activity?.kind === "gathering"
          ? bestCarriedGatheringTool(state, activity.skill)
          : null,
      });
      if (!activeTraversal) rig.play(pose);
    }
    rig.setLocomotionSpeed(speed);

    if (activity?.kind === "gathering" && (activity.skill === "mining" || activity.skill === "woodcutting")) {
      const key = `${activity.entityId}:${activity.startedAtMs}:${activity.skill}`;
      // Systems evaluate at the start of a sim tick, then the clock commits 100 ms. Rewinding one
      // tick and adding the render interpolation fraction gives the same instant the current state
      // represents, so the contact pose does not lead its semantic roll by a whole fixed step.
      const presentationAtMs = Math.max(
        0,
        this.deps.clock.elapsedMs - SIM_TICK_MS + this.renderAlpha * SIM_TICK_MS,
      );
      rig.syncGatheringCycle(
        activity.nextRollAtMs - presentationAtMs,
        GATHER_TICK_MS,
        key !== this.gatheringRigKey,
      );
      this.gatheringRigKey = key;
    } else {
      this.gatheringRigKey = null;
    }

    if (activity?.kind === "gathering" && activity.skill === "fishing" && state.player.health > 0) {
      const presentationAtMs = Math.max(0, this.deps.clock.elapsedMs - SIM_TICK_MS + this.renderAlpha * SIM_TICK_MS);
      const key = `${activity.entityId}:${activity.startedAtMs}:fishing`;
      rig.syncFishingCycle(this.entityPositionFor(activity.entityId), presentationAtMs - activity.startedAtMs,
        activity.nextRollAtMs - presentationAtMs, GATHER_TICK_MS, key !== this.fishingRigKey);
      this.fishingRigKey = key;
    } else if (this.fishingRigKey !== null) {
      rig.syncFishingCycle(null, 0, 0, GATHER_TICK_MS);
      this.fishingRigKey = null;
    }
    rig.syncTraversalPose(activeTraversal);
    rig.update(realDeltaMs / 1000);
    const fishingSplash = this.fishingRigKey !== null ? rig.drainFishingSplash() : null;
    if (fishingSplash) this.vfx?.fishingCastSplash(fishingSplash, nowMs);
    for (const event of rig.drainMotionEvents()) {
      if (event.kind === "swing" && event.pose === "attack_melee") this.presentPlayerSwing();
      this.playerMotionHandler?.(event);
    }
  }

  /** Sounds the wind-up once per attack, on the clip's swing marker rather than at contact. */
  private presentPlayerSwing(): void {
    const start = this.pendingPlayerSwing;
    if (!start || this.playerSwingSounded) return;
    this.playerSwingSounded = true;
    this.combatPresentationHandler?.({
      atMs: start.atMs, attacker: "player", sourceId: start.sourceId, targetId: start.targetId,
      damage: 0, hit: false, maxHit: 0, kind: start.kind, killed: false, spellId: null,
    }, "swing");
  }

  /**
   * Pushes worn equipment into the rig when, and only when, it changes.
   *
   * Before this, `equipMainHandAsset`, `VISIBLE_SLOTS` and `equippedAssetId` had zero callers
   * anywhere in the repo: a full tier-10 Kaldite kit rendered pixel-identical to naked and
   * `getSceneStats().totalObjects` read 1077 before and 1077 after. Measured with this wired:
   * 772 naked, 773 with the kit, and the rig's own child list gains the sword and swaps the whole
   * peasant set for the ranger one.
   */
  private syncPlayerEquipment(): void {
    const rig = this.playerRig;
    if (!rig) return;
    const state = this.deps.store.get();
    const worn = state.equipment;
    const slots = rig.visibleSlots();
    const mainHandId = worn.mainHand?.itemId ?? null;
    const chargeSpec = mainHandId ? content.item(mainHandId)?.magicWeapon?.charge : undefined;
    const chargedWeaponItemId = chargeSpec ? mainHandId : null;
    const weaponCharged = chargedWeaponItemId !== null
      && (state.magic.weaponCharges[chargedWeaponItemId] ?? 0) > 0;
    const chargeSignature = `${chargedWeaponItemId ?? "-"}/${weaponCharged ? "charged" : "empty"}`;

    let changed = this.wornItemIds.length !== slots.length
      || this.wornWeaponChargeSignature !== chargeSignature;
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      const itemId = (slot ? worn[slot]?.itemId : null) ?? null;
      if (this.wornItemIds[index] !== itemId) {
        this.wornItemIds[index] = itemId;
        changed = true;
      }
    }
    if (!changed) return;
    this.wornItemIds.length = slots.length;
    this.wornWeaponChargeSignature = chargeSignature;
    const charge: GearWeaponChargePresentationLike = {
      itemId: chargedWeaponItemId,
      charged: weaponCharged,
    };
    void rig.applyEquipment(worn, charge);
  }

  /**
   * Turns this frame's swings into floating numbers and into a pose.
   *
   * A hit the player took floats over the player and reads as "incoming"; one they landed floats
   * over whatever they hit. A miss is worth showing too — a run of zeroes against a high-armour
   * target is the game explaining why Magic exists — so `hit: false` still paints, as a nought.
   *
   * The pose is the other half. A flinch outranks a swing: being hit is the thing the player needs
   * to see, and `Hit_Chest` is 0.333 s against `Sword_Attack`'s 1.533 s, so it reads as an
   * interruption and recovers before the next 600 ms combat tick.
   */
  private presentAttackStarts(): void {
    for (const start of this.drainAttackStarts?.() ?? []) {
      const durationSeconds = Math.max(0.05, (start.recoverAtMs - start.atMs) / 1000 / (this.deps.clock.timeScale || 1));
      if (start.attacker === "player") {
        this.pendingRigPose = "attack_melee";
        this.pendingRigPoseTimeScale = (this.playerRig?.meleeTiming().clipSeconds ?? 1.533333) / durationSeconds;
        this.pendingPlayerSwing = start;
        this.playerSwingSounded = false;
      } else {
        this.entityViews?.playAction(start.sourceId, "attack", { durationSeconds });
        if (start.kind !== "melee" && this.attackStillCommitted?.(start.sourceId)) {
          const source = this.entityViews?.motionSnapshot(start.sourceId)?.drawnPosition;
          const player = this.deps.store.get().player;
          if (source && start.targetId === player.id) {
            this.enemyProjectiles ??= new EnemyProjectiles(this.deps.scene.overlayGroup);
            this.projectileRegion = player.regionId;
            this.enemyProjectiles.start(start, source, this.renderPos);
          }
        }
      }
    }
  }

  private paintCombatHits(nowMs: number): void {
    const playerId = this.deps.store.get().player.id;
    for (const hit of this.drainHits?.() ?? []) {
      // Simulation has reached the contact frame. Health, recoil, sound and numbers agree here.
      // A melee blow whose swing already sounded on the rig marker presents as the impact alone.
      const swung = hit.attacker === "player" && hit.kind === "melee" && this.playerSwingSounded;
      if (hit.attacker === "player" && hit.kind === "melee") {
        this.pendingPlayerSwing = null;
        this.playerSwingSounded = false;
      }
      this.combatPresentationHandler?.(hit, hit.kind === "magic" || swung ? "impact" : "combined");
      if (hit.attacker === "enemy") {
        this.vfx?.damage(null, hit.damage, "incoming", nowMs);
        if (hit.hit && hit.targetId === playerId) {
          this.pendingRigPose = "hit";
          this.pendingRigPoseTimeScale = null;
        }
      } else {
        this.vfx?.damage(hit.targetId, hit.damage, hit.kind === "magic" ? "magic" : "melee", nowMs);
        if (hit.hit) {
          const target = this.entityViews?.motionSnapshot(hit.targetId);
          const source = this.deps.store.get().player.position;
          // Positive local X is the target's right. Use its semantic contact-facing pose,
          // independent of render interpolation and camera orbit.
          const lateral = target ? (source[0] - target.semanticPosition[0]) * Math.cos(target.semanticRotationY)
            - (source[2] - target.semanticPosition[2]) * Math.sin(target.semanticRotationY) : 0;
          const impactSide = Math.abs(lateral) < 0.1 ? "front" : lateral < 0 ? "left" : "right";
          const authoredSeconds = this.entityViews?.actionDurationSeconds(hit.targetId, "hit", impactSide);
          this.entityViews?.playAction(hit.targetId, "hit", {
            impactSide, ...(!authoredSeconds || !Number.isFinite(authoredSeconds) ? {} : {
              durationSeconds: authoredSeconds / (this.deps.clock.timeScale || 1),
            }),
          });
        }
      }
    }
  }

  /**
   * Starts the bolt for a cast that has just been rolled.
   *
   * Driven by the `spell.launched` event rather than by the hit log, because the hit log entry for a
   * spell is now written when it LANDS — `systems/combat.ts` defers the damage for the length of the
   * flight, so by the time a magic `CombatHit` exists the projectile should already have arrived.
   *
   * Nothing here decides timing. The event carries `flightMs`, the sim scheduled the damage against
   * it, and `render/spellVfx.ts` draws against the same shared `spellFlightMs`; this only has to
   * point the effect at the right places.
   */
  handleSpellLaunch(event: GameEvent, nowMs: number): void {
    if (event.type !== "spell.launched" || !this.spellVfx) return;
    const data = event.data;
    const targetId = typeof data["targetId"] === "string" ? data["targetId"] : null;
    const element = data["element"] as SpellElement | undefined;
    const rung = data["rung"] as SpellRung | undefined;
    if (!targetId || !element || !rung) return;
    const to = this.entityPositionFor(targetId);
    if (!to) return;

    this.spellVfx.cast({
      // Seeded off the sim stamp and the target, so two casts thrown in one frame at two enemies
      // scatter differently, and the same cast replayed from a seed scatters identically.
      id: `${event.atMs}:${targetId}`,
      element,
      rung,
      from: this.castOrigin(),
      to,
      hit: data["hit"] === true,
      // The event carries the flight in SIM milliseconds, which is what the damage was scheduled
      // against. This layer runs on the render clock, so the sim's time scale is divided out or the
      // bolt and the hit come apart the moment anything scales time — the acceptance harness runs
      // at 20.
      flightMsOverride: typeof data["flightMs"] === "number"
        ? data["flightMs"] / (this.deps.clock.timeScale || 1)
        : undefined,
    }, nowMs);

    // The cast animation belongs here too, for the same reason the bolt does: this is the moment
    // the spell leaves. Driving it off the hit log would play the throw at the instant the spell
    // arrived, a whole flight late.
    this.pendingRigPose = "cast";
    this.pendingRigPoseTimeScale = castTimeScale(rung);
  }

  /**
   * Where a spell leaves the caster: the centre of the player, slightly in front.
   *
   * An earlier pass read the crown of the staff through the hand bone, which was more literal and
   * read worse — the crown swings through a wide arc during the cast, so the bolt appeared to be
   * flung from wherever the arm happened to be rather than aimed, and at some phases it started
   * behind the player's shoulder. A fixed point at chest height is steady, reads as "from the
   * caster", and is what the effect layer's forward nudge was designed around.
   *
   * The nudge itself lives in `render/spellVfx.ts` (`HAND_REACH`), which knows the direction to the
   * target; this only has to supply the height.
   */
  private castOrigin(): Vec3 {
    const at = this.deps.store.get().player.position;
    this.spellOriginTuple[0] = at[0];
    this.spellOriginTuple[1] = at[1] + CAST_ORIGIN_HEIGHT;
    this.spellOriginTuple[2] = at[2];
    return this.spellOriginTuple;
  }

  /** Where a target stands right now. Null rather than the origin when it has gone. */
  private entityPositionFor(entityId: EntityId): Vec3 | null {
    if (!this.entitySource) return null;
    for (const entity of this.entitySource()) {
      if (entity.id === entityId) return entity.position;
    }
    return null;
  }

  /** Diffs semantic entities into the render layer a few times a second, not every frame. */
  private syncEntityViews(realDeltaMs: number): void {
    if (!this.entityViews || !this.entitySource) return;
    // REAL elapsed time. This used to add SIM_TICK_MS per RENDER FRAME, which turns "every 250 ms"
    // into "every third frame": at 150 fps the 4 Hz structural sync actually ran at ~50 Hz, so the
    // two-sync walk-pose hold in `EntityViews.updateMoving` — designed as ~500 ms — decayed in
    // ~40 ms, well inside the 100 ms between two AI movement steps. Every moving creature's walk
    // pose therefore expired MID-STRIDE and re-latched on the next sim tick: walk-idle-walk at
    // ~10 Hz, each flip a fresh 0.18 s crossfade, and the perpetual half-blended pose is the
    // whole-body "rapid shaking" reported from play. The defect needs more render frames than sim
    // ticks to appear, which is why every SwiftShader probe at 7 fps measured the same creatures
    // as perfectly clean while a 154 fps desktop shook.
    this.viewSyncAccumulatorMs += realDeltaMs;
    if (this.viewSyncAccumulatorMs < 250) return;
    this.viewSyncAccumulatorMs = 0;
    this.entityViews.sync(this.entitySource());
  }

  private maybeAutosave(nowMs: number): void {
    if (nowMs - this.lastAutosaveAt < AUTOSAVE_INTERVAL_MS) return;
    this.lastAutosaveAt = nowMs;
    if (!this.deps.store.consumeDirty()) return;
    this.deps.saves.save(this.deps.store.get(), Date.now());
  }
}
