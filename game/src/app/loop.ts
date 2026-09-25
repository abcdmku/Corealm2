import { spellImpactPoint } from "../systems/spellAim.js";
/**
 * The frame loop. It draws and it simulates nothing: the world is a session's, on a server or in the
 * local-play worker, and this thread shows what that session replicates.
 *
 * Each frame reads input, draws the replicated store, and presents the world actions the session
 * delivered since the last one. The player's drawn pose is the prediction the session layer hands in
 * through `setRemotePose`; other actors interpolate between the host's ticks.
 */
import type { GameState, Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import type { Renderer } from "../render/renderer.js";
import type { OrbitCamera } from "../render/camera.js";
import type { WorldScene } from "../render/scene.js";
import type { TraversalSample } from "../systems/traversalMotion.js";
import { EnemyProjectiles } from "../render/enemyProjectiles.js";
import type { CombatAttackStart, CombatHit } from "../systems/combat.js";
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
import type { GameEvent, ItemId, SkillId, SpellElement, SpellId, SpellRung, WorldAction } from "../contracts.js";
import type { Ui } from "../ui/panels.js";
import type { EntityId, SemanticEntity, Vec3 } from "../contracts.js";
import { GATHER_TICK_MS } from "../core/time.js";
import { MOVEMENT } from "./config.js";

/**
 * The overlay layer's per-frame hook. Gets the player as DRAWN this frame, the predicted pose,
 * because a route head that follows the store's position steps at the host's tick rate.
 */
export interface OverlayTicker {
  update(nowMs: number, playerRenderPosition: Vec3): void;
}

export interface LoopDeps {
  store: Store;
  events: EventBus;
  /** A mirror of the host's clock: the session layer writes the replicated time into it. */
  clock: SimClock;
  renderer: Renderer;
  camera: OrbitCamera;
  /** The roof cutaway step (`roofCutawayFrame`). Required: fixed follow has nothing else between the lens and a roof. */
  updateRoofVisibility(position: Vec3 | null): void;
  scene: WorldScene;
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
  private entityViews: EntityViews | null = null;
  private entitySource: (() => readonly SemanticEntity[]) | null = null;
  private refreshEntityResidency: (() => void) | null = null;
  private reconcileEntityPresentation: (() => void) | null = null;
  private remoteTraversal: TraversalSample | null = null;
  setRemoteTraversal(sample: TraversalSample | null): void { this.remoteTraversal = sample; }
  private viewSyncAccumulatorMs = 0;
  private overlays: OverlayTicker | null = null;
  private playerRig: CharacterRig | null = null;
  private vfx: Vfx | null = null;
  private environmentEffects: { update(seconds: number, camera: Renderer['camera']): void; dispose(): void } | null = null;
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
  private spellRangeFrame: ((nowMs: number) => void) | null = null;
  setSpellRangeFrame(update: (nowMs: number) => void): void { this.spellRangeFrame = update; }
  private healthBars: HealthBars | null = null;
  /** Scratch for the cast origin, so a cast allocates nothing. */
  private readonly spellOriginTuple: [number, number, number] = [0, 0, 0];
  private fishingRigKey: string | null = null;
  private gatheringRigKey: string | null = null;
  private ui: Ui | null = null;
  private interiors: { group: { visible: boolean }; visible: () => boolean }[] = [];
  private frameObserver: ((frameMs: number) => void) | null = null;
  private pendingRenderDeltaMs = 0;
  private nextPresentationAt: number | null = null;

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
  setEntityViews(views: EntityViews, entities: () => readonly SemanticEntity[], refreshResidency?: () => void, reconcilePresentation?: () => void): void {
    this.entityViews = views;
    this.entitySource = entities;
    this.refreshEntityResidency = refreshResidency ?? null;
    this.reconcileEntityPresentation = reconcilePresentation ?? null;
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

  setEnvironmentEffects(effects: { update(seconds: number, camera: Renderer['camera']): void; dispose(): void }): void {
    this.environmentEffects?.dispose();
    this.environmentEffects = effects;
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

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameAt = performance.now();
    this.pendingRenderDeltaMs = 0;
    this.nextPresentationAt = null;
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
    this.environmentEffects?.dispose();
    this.environmentEffects = null;
    this.enemyProjectiles?.dispose();
    this.enemyProjectiles = null;
  }

  /** Clears render-only work when a session starts or ends, or when the host replaces the character. */
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
    // A first RAF timestamp can precede start() after a long task in that browser frame.
    const realDelta = Math.max(0, Math.min(frameMs, 250));
    this.lastFrameAt = nowMs;

    this.deps.input.update();
    this.pendingRenderDeltaMs = Math.min(250, this.pendingRenderDeltaMs + realDelta);
    // Chromium can have a press waiting behind this RAF callback. Yield before another
    // expensive scene traversal so that the handler runs before we draw an obsolete input state.
    const pendingInput = typeof navigator !== 'undefined'
      && (navigator as Navigator & { scheduling?: { isInputPending(): boolean } }).scheduling?.isInputPending();
    // A high-refresh display must not fill the shared GPU with hundreds of game frames.
    // Keep input at browser cadence and give uploads and other tabs time between presentations.
    const presentationInterval = 1000 / 60;
    const presentationDue = this.nextPresentationAt === null || nowMs + 0.25 >= this.nextPresentationAt;
    if (presentationDue && (this.deps.renderer.canRenderFrame?.() ?? true) && !pendingInput) {
      this.renderFrame(nowMs, this.pendingRenderDeltaMs);
      this.pendingRenderDeltaMs = 0;
      const deadline = this.nextPresentationAt ?? nowMs;
      this.nextPresentationAt = deadline + (Math.floor(Math.max(0, nowMs - deadline) / presentationInterval) + 1) * presentationInterval;
    } else {
      // Input has already been read. Avoid spending the main thread on palettes/scene updates
      // that cannot be drawn, while menus still reflect current state.
      this.ui?.update();
    }
    // A responsive JS loop does not mean the GPU is keeping up. Distance adaptation must
    // see unfinished graphics work too, including frames deliberately not submitted.
    this.frameObserver?.(Math.max(frameMs, this.deps.renderer.getFramePressureMs?.() ?? 0));
  };

  private remotePresentationTime: number | null = null;
  setRemotePresentationTime(now: number): void { this.remotePresentationTime = now; }
  private networkStarts: CombatAttackStart[] = [];
  private networkHits: CombatHit[] = [];
  private readonly networkCommitted = new Map<string,{until:number;owner:string;attackId:number}>();
  private remotePose:{position:Vec3;facingRad:number}|null=null;
  remoteProjectileState(): {visible:number;targets:string[]} { return this.enemyProjectiles?.snapshot()??{visible:0,targets:[]}; }
  setRemotePose(pose:{position:Vec3;facingRad:number}|null):void{this.remotePose=pose;}
  /** A session began or ended: what the last one left in flight must not be drawn over the next. */
  sessionChanged(): void {
    this.remotePresentationTime = null;
    this.networkStarts.length = 0; this.networkHits.length = 0;
    this.networkCommitted.clear(); this.enemyProjectiles?.clear(); this.remoteTraversal = null;
    this.spellVfx?.clear();
    this.remotePose=null;
    this.resetPresentation();
  }

  private updateRenderPose(): void {
    const player = this.deps.store.get().player;
    this.renderPos[0] = player.position[0];
    this.renderPos[1] = player.position[1];
    this.renderPos[2] = player.position[2];
    this.renderFacingRad = player.facingRad;
  }

  private renderFrame(nowMs: number, realDeltaMs: number): void {
    const { store, scene, camera, renderer } = this.deps;
    const state = store.get();

    const traversal = this.remoteTraversal;
    this.updateRenderPose();
    if (traversal) {
      this.renderPos[0] = traversal.position[0];
      this.renderPos[1] = traversal.position[1];
      this.renderPos[2] = traversal.position[2];
      this.renderFacingRad = traversal.facingRad;
    }
    const position: Vec3 = this.remotePose?this.remotePose.position:this.renderPos;
    const facingRad = this.remotePose?this.remotePose.facingRad:this.renderFacingRad;

    for (const interior of this.interiors) interior.group.visible = interior.visible();
    // Residency follows the player every frame, including frames without a structural diff.
    // Keep this separate from collecting the complete semantic snapshot.
    this.refreshEntityResidency?.();
    this.syncEntityViews(realDeltaMs);
    this.reconcileEntityPresentation?.();
    // Structure at 4 Hz, motion every frame. `sync` is throttled because rebuilding instance groups
    // is expensive, but the host moves a creature every 100 ms tick, so at 4 Hz three of every four
    // movement steps were invisible and the fourth was a 40 cm jump.
    // The resident references are refreshed by structural sync and active-area changes.
    this.entityViews?.syncResidentMotion(1);
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
    for (const [id, attack] of this.networkCommitted) if (attack.until <= this.deps.clock.elapsedMs) this.networkCommitted.delete(id);
    if (this.enemyProjectiles) {
      this.enemyProjectiles.update(this.remotePresentationTime ?? this.deps.clock.elapsedMs,
        (id, attack) => this.networkCommitted.get(id)?.owner === attack.targetId
          && this.networkCommitted.get(id)?.attackId === attack.id && this.entityPositionFor(id) !== null,
        (id) => id === state.player.id ? position : this.entityViews?.motionSnapshot(`remote:${id}`)?.drawnPosition ?? this.entityViews?.motionSnapshot(id)?.drawnPosition);
    }
    this.paintCombatHits(nowMs);
    this.vfx?.update(nowMs);
    // After `vfx`, so a spell burst draws over the floating numbers rather than under them.
    this.spellVfx?.update(nowMs);
    this.ui?.update();
    this.syncPlayerEquipment();
    this.syncPlayerRig(position, facingRad, realDeltaMs, nowMs, traversal);
    scene.syncPlayer(position, facingRad);
    this.deps.updateRoofVisibility(this.playerRig?.root.visible === false ? null : position);
    camera.update(position[0], position[1], position[2]);
    renderer.followShadow(renderer.camera.position.clone().setY(position[1]));
    renderer.camera.updateMatrixWorld();
    this.environmentEffects?.update(nowMs / 1000, renderer.camera);
    // After the camera has moved for this frame, unlike the floaters above, so a bar pinned over a
    // head projects through THIS frame's view and does not trail it by one.
    this.healthBars?.update(nowMs, position);
    this.spellRangeFrame?.(nowMs);
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
      // The session layer extrapolates the host's clock between updates, so the contact pose does
      // not lead or trail its roll by a whole tick.
      const presentationAtMs = Math.max(0, this.remotePresentationTime ?? this.deps.clock.elapsedMs);
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
      const presentationAtMs = Math.max(0, this.remotePresentationTime ?? this.deps.clock.elapsedMs);
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
    for (const start of this.networkStarts.splice(0)) {
      const durationSeconds = Math.max(0.05, (start.recoverAtMs - start.atMs) / 1000 / (this.deps.clock.timeScale || 1));
      if (start.attacker === "player") {
        this.pendingRigPose = "attack_melee";
        this.pendingRigPoseTimeScale = (this.playerRig?.meleeTiming().clipSeconds ?? 1.533333) / durationSeconds;
        this.pendingPlayerSwing = start;
        this.playerSwingSounded = false;
      } else {
        this.entityViews?.playAction(start.sourceId, "attack", { durationSeconds });
      }
    }
  }

  private paintCombatHits(nowMs: number): void {
    const playerId = this.deps.store.get().player.id;
    for (const hit of this.networkHits.splice(0)) {
      // The host has reached the contact frame. Health, recoil, sound and numbers agree here.
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
  handleWorldAction(action: WorldAction, nowMs: number): void {
    const owner = this.deps.store.get().player.id;
    const viewId = (id: string): string => id === owner ? id
      : this.entityPositionFor(`remote:${id}`) ? `remote:${id}` : id;
    if (action.type === "attack") {
      const start = action.attack;
      this.networkCommitted.set(start.sourceId,{until:start.recoverAtMs,owner:action.playerId,attackId:start.id});
      if (start.sourceId === owner) this.networkStarts.push(start);
      else {
        this.entityViews?.playAction(viewId(start.sourceId), start.attacker === "player" ? "player_attack" : "attack",
          { durationSeconds: Math.max(0.05, (start.recoverAtMs - start.atMs) / 1000) });
        const source = this.entityPositionFor(viewId(start.sourceId));
        const target = start.targetId === owner ? this.remotePose?.position ?? this.deps.store.get().player.position
          : this.entityPositionFor(viewId(start.targetId));
        if (start.attacker === "enemy" && start.kind !== "melee" && source && target) {
          this.enemyProjectiles ??= new EnemyProjectiles(this.deps.scene.overlayGroup);
          this.projectileRegion = this.deps.store.get().player.regionId;
          this.enemyProjectiles.start(start, source, target);
        }
      }
    } else if (action.type === "attackCancelled") {
      const current = this.networkCommitted.get(action.sourceId);
      if (current && current.owner !== action.playerId) return;
      this.networkCommitted.delete(action.sourceId);
      this.networkStarts = this.networkStarts.filter(start => start.sourceId !== action.sourceId);
      this.entityViews?.cancelAttack(viewId(action.sourceId));
      if(action.sourceId===owner&&this.pendingPlayerSwing){
        this.pendingPlayerSwing=null;this.playerSwingSounded=false;this.pendingRigPose=null;
        this.playerRig?.play("idle",true);
      }
    } else if (action.type === "hit") {
      const hit = action.hit;
      if (hit.sourceId === owner || hit.targetId === owner) this.networkHits.push(hit);
      else {
        const target = viewId(hit.targetId);
        this.vfx?.damage(target, hit.damage, hit.kind === "magic" ? "magic" : "melee", nowMs,
          hit.targetId === action.playerId ? action.position : undefined);
        if (hit.hit) this.entityViews?.playAction(target, "hit");
      }
    } else if (action.type === "spell" && action.playerId !== owner && this.entityPositionFor(`remote:${action.playerId}`)) {
      const spell = content.spell(action.spellId);
      if (spell) this.handleSpellLaunch({ seq: action.sequence, type: "spell.launched", atMs: action.atMs,
        data: { ...action, element: spell.element, rung: spell.rung, rank: spell.rank ?? 0 } }, nowMs, `remote:${action.playerId}`);
    } else if (action.type === "gesture" && action.playerId !== owner) {
      this.entityViews?.playAction(`remote:${action.playerId}`, action.pose);
    } else if (action.type === "death" && action.playerId !== owner) {
      this.vfx?.remoteDeath(action.position, nowMs);
    }
  }

  handleSpellLaunch(event: GameEvent, nowMs: number, casterId?: string): void {
    if (event.type !== "spell.launched" || !this.spellVfx) return;
    const data = event.data;
    const targetId = typeof data["targetId"] === "string" ? data["targetId"] : null;
    const element = data["element"] as SpellElement | undefined;
    const rung = data["rung"] as SpellRung | undefined;
    if (!targetId || !element || !rung) return;
    const rawAim = data["aim"];
    const aim: Vec3 | null = Array.isArray(rawAim) && rawAim.length === 3 && rawAim.every((v) => typeof v === "number")
      ? [rawAim[0] as number, rawAim[1] as number, rawAim[2] as number] : null;
    const to = aim ?? this.entityPositionFor(targetId);
    if (!to) return;

    const spellId = typeof data["spellId"] === "string" ? data["spellId"] as SpellId : undefined;
    const rank = typeof data["rank"] === "number" ? data["rank"] : 0;
    this.spellVfx.cast({
      // Seeded off the sim stamp and the target, so two casts thrown in one frame at two enemies
      // scatter differently, and the same cast replayed from a seed scatters identically.
      id: `${casterId ?? this.deps.store.get().player.id}:${event.seq}:${event.atMs}:${targetId}`,
      spellId,
      remote: casterId !== undefined,
      element,
      rung,
      from: casterId ? this.remoteCastOrigin(casterId) : this.castOrigin(),
      to,
      // An area invocation was placed on the ground; a bolt still aims up the target's body.
      impactPoint: aim ? aim : spellImpactPoint(to,this.entityViews?.drawnBounds(targetId)),
      hit: data["hit"] === true,
      // The event carries the flight in SIM milliseconds, which is what the damage was scheduled
      // against. This layer runs on the render clock, so the sim's time scale is divided out or the
      // bolt and the hit come apart the moment anything scales time — the acceptance harness runs
      // at 20.
      flightMsOverride: typeof data["flightMs"] === "number"
        ? data["flightMs"] / (this.deps.clock.timeScale || 1)
        : undefined,
      timeScale: this.deps.clock.timeScale || 1,
    }, nowMs);

    // The cast animation belongs here too, for the same reason the bolt does: this is the moment
    // the spell leaves. Driving it off the hit log would play the throw at the instant the spell
    // arrived, a whole flight late.
    if (casterId) {
      this.entityViews?.playAction(casterId, "cast", { durationSeconds: 1 / (rank > 0
        ? (rank < 2 ? 1.15 : rank < 4 ? 0.85 : 0.65) : (castTimeScale(rung) ?? 1)) });
      return;
    }
    this.pendingRigPose = "cast";
    // Invocations use the lab's tempo ladder: quick for a dart, slow and heavy for a finale.
    this.pendingRigPoseTimeScale = rank > 0 ? (rank < 2 ? 1.15 : rank < 4 ? 0.85 : 0.65) : castTimeScale(rung);
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

  private remoteCastOrigin(id: string): Vec3 {
    const at = this.entityViews?.motionSnapshot(id)?.drawnPosition ?? this.entityPositionFor(id) ?? [0, 0, 0];
    return [at[0], at[1] + CAST_ORIGIN_HEIGHT, at[2]];
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
}
