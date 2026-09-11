import * as THREE from "three";
import {
  EQUIP_SLOTS,
  SKILL_IDS,
  type EquipSlot,
  type EquipmentBonuses,
  type ItemId,
  type ItemStack,
  type RegionId,
  type SemanticEntity,
  type SkillId,
  type SpellId,
  type SpellRung,
  type Vec3,
} from "../contracts.js";
import { content, enemyCombatLevel } from "../content/index.js";
import { enemyBlockFor } from "../content/enemies.js";
import { ALL_ITEMS } from "../content/items.js";
import { SPELLS } from "../content/spells.js";
import { REGIONS } from "../content/regions.js";
import { SKILLS } from "../content/skills.js";
import { MAX_LEVEL } from "../content/xp.js";
import { AssetRegistry } from "../render/assets.js";
import { CharacterRig, type CharacterPose } from "../render/characterRig.js";
import { npcOutfitParts } from "../render/characterAppearances.js";
import {
  EntityViews,
  type CharacterMotion,
  type EntityMotionSnapshot,
  type EntityViewScene,
} from "../render/entityViews.js";
import * as equipmentVisuals from "../render/equipmentVisuals.js";
import { MaterialLibrary } from "../render/materials.js";
import { registerProceduralGear } from "../render/proceduralGear.js";
import { SpellVfx } from "../render/spellVfx.js";
import { equipmentTotalsOf } from "../systems/equipment.js";

export type ActorTargetKind = "npc" | "creature";
export type LabAction = "melee" | "cast" | "target-attack" | "hit-target" | "kill-target" | "respawn-target";

export interface ActorPreset {
  id: string;
  label: string;
  kind: ActorTargetKind;
  assetId: string;
  tier: number;
  scale: number;
  regionId: RegionId;
  partAssetIds?: readonly string[];
}

export const NPC_PRESETS: readonly ActorPreset[] = REGIONS.flatMap((region) => (
  (region.settlement?.npcs ?? []).map((npc) => ({
    id: npc.id,
    label: npc.name,
    kind: "npc" as const,
    assetId: npc.assetId,
    tier: region.tier,
    scale: 1,
    regionId: region.id,
    partAssetIds: npcOutfitParts(npc.id, npc.assetId),
  }))
));

export const CREATURE_PRESETS: readonly ActorPreset[] = REGIONS.flatMap((region) => {
  const sources = [
    ...region.enemyGroups.map((group) => ({ group, regionId: region.id, dungeonName: null as string | null })),
    ...(region.dungeon?.enemyGroups ?? []).map((group) => ({
      group,
      regionId: region.dungeon!.id,
      dungeonName: region.dungeon!.name,
    })),
  ];
  return sources.map(({ group, regionId, dungeonName }) => ({
    id: dungeonName ? `${regionId}:${group.id}` : group.id,
    label: `${group.name}${enemyBlockFor(group.id, group.family, group.tier) ? ` (Level ${enemyCombatLevel(enemyBlockFor(group.id, group.family, group.tier)!)})` : ""}${dungeonName ? ` - ${dungeonName}` : ""}`,
    kind: "creature" as const,
    assetId: group.assetId,
    tier: group.tier,
    scale: group.boss ? group.scale * 1.6 : group.scale,
    regionId,
  }));
});

export const LAB_SPELLS = SPELLS.map((spell) => ({
  id: spell.id,
  label: `${spell.name} - ${spell.element} ${spell.rung}`,
}));

/**
 * Every production equipment item, grouped by its production slot for the lab controls.
 *
 * Both axes come from canonical catalogs: `EQUIP_SLOTS` owns the slot order and `ALL_ITEMS` owns
 * item identity, display name, and slot assignment. A newly-authored equipment row therefore
 * appears in the lab without adding another list here.
 */
export const LAB_EQUIPMENT: readonly {
  slot: EquipSlot;
  label: string;
  items: readonly { id: ItemId; label: string }[];
}[] = EQUIP_SLOTS.map((slot) => ({
  slot,
  label: titleCaseIdentifier(slot),
  items: ALL_ITEMS
    .filter((item) => item.equip?.slot === slot)
    .map((item) => ({ id: item.id, label: item.name })),
}));

/** Skill controls in the frozen contract order, labelled by the production skill catalog. */
export const LAB_SKILLS: readonly { id: SkillId; label: string }[] = SKILL_IDS.map((id) => ({
  id,
  label: SKILLS[id].name,
}));

export const PLAYER_POSES: readonly CharacterPose[] = [
  "idle", "walk", "run", "attack_melee", "cast", "hit", "death", "mine", "chop", "fish", "produce", "eat", "climb", "bank",
];

export interface ActorLabState {
  ready: boolean;
  revision: number;
  frames: number;
  targetKind: ActorTargetKind;
  targetPresetId: string;
  targetEntityId: string | null;
  targetState: string | null;
  player: ReturnType<CharacterRig["motionSnapshot"]> | null;
  playerStats: ReturnType<CharacterRig["stats"]> | null;
  equipment: Record<EquipSlot, ItemId | null>;
  equipmentTotals: EquipmentBonuses;
  levels: Record<SkillId, number>;
  target: EntityMotionSnapshot | null;
  spellId: string;
  liveParticles: number;
  spellDrawCalls: number;
  peakParticles: number;
  peakSpellDrawCalls: number;
  castCount: number;
  hitCount: number;
  deathCount: number;
  respawnCount: number;
  playerMarkers: { swing: number; impact: number; footstep: number };
  lastAction: LabAction | "spawn" | null;
  errors: string[];
}

interface PendingAction { atMs: number; action: () => void }

const PLAYER_POSITION: Vec3 = [-2.2, 0, 0];
const TARGET_X = 2.2;
const SWORD: ItemId = "grithe_sword";
const STAFF: ItemId = "palewood_staff";

export class ActorLab {
  readonly root: THREE.Group;

  private readonly entityGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();
  private readonly views: EntityViews;
  private readonly player: CharacterRig;
  private readonly spells: SpellVfx;
  private readonly equipment = emptyEquipment();
  private readonly levels = startingLevels();
  private targetEntity: SemanticEntity | null = null;
  private targetKind: ActorTargetKind = "creature";
  private targetPresetId = CREATURE_PRESETS[0]?.id ?? "";
  private targetWalking = false;
  private walkPhase = 0;
  private spellId: SpellId = SPELLS[0]?.id ?? "emberlash";
  private revision = 0;
  private frames = 0;
  private castCount = 0;
  private hitCount = 0;
  private deathCount = 0;
  private respawnCount = 0;
  private peakParticles = 0;
  private peakSpellDrawCalls = 0;
  private playerMarkers = { swing: 0, impact: 0, footstep: 0 };
  private pendingMeleeHit = false;
  private lastAction: ActorLabState["lastAction"] = null;
  private ready = false;
  private gearRegistered = false;
  private errors: string[] = [];
  private pending: PendingAction[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly assets: AssetRegistry,
  ) {
    // `equipmentTotalsOf` deliberately reads the production content registry. The standalone lab
    // does not run application boot, so give that same registry its canonical item table here.
    // Registering a partial table preserves any other production tables already present.
    content.register({ items: ALL_ITEMS });
    this.root = new THREE.Group();
    this.root.name = "isolation-lab-actors";
    this.entityGroup.name = "isolation-lab-entities";
    this.overlayGroup.name = "isolation-lab-overlays";
    this.root.add(this.entityGroup, this.overlayGroup);
    scene.add(this.root);
    const viewScene: EntityViewScene = {
      entityGroup: this.entityGroup,
      overlayGroup: this.overlayGroup,
    };
    this.views = new EntityViews(viewScene, assets, new MaterialLibrary(), {
      maxUniqueDrawCalls: 64,
      maxUniqueViews: 4,
      maxAnimatedViews: 4,
      animationRadius: 30,
    });
    this.player = new CharacterRig(assets);
    // Keep the actor lab focused: equipment remains production code, but only the selected weapon
    // is fetched instead of preloading the whole equipment ladder in the background.
    this.player.setGearVisuals({ ...equipmentVisuals, gearAssetIds: () => [] });
    this.spells = new SpellVfx({ parent: this.overlayGroup, camera, groundHeightAt: () => 0 });
  }

  async initialize(kind: ActorTargetKind = "creature", presetId?: string): Promise<ActorLabState> {
    this.ready = false;
    this.errors = [];
    try {
      if (!this.gearRegistered) {
        registerProceduralGear(this.assets);
        this.gearRegistered = true;
      }
      await this.assets.loadAnimationLibraries();
      const built = await this.player.build({
        bodyAssetId: "base_male",
        outfitAssetIds: [
          "outfit_male_peasant_chest",
          "outfit_male_peasant_legs",
          "outfit_male_peasant_boots",
        ],
      });
      if (!built) throw new Error("Main player rig could not be built");
      this.player.root.name = "main-player";
      this.entityGroup.add(this.player.root);
      this.player.setPosition(PLAYER_POSITION, Math.PI / 2);
      await this.setTarget(kind, presetId ?? this.presets(kind)[0]?.id ?? "");
      this.ready = true;
      this.revision += 1;
    } catch (cause) {
      this.errors.push(cause instanceof Error ? cause.message : String(cause));
      this.ready = false;
    }
    return this.getState();
  }

  presets(kind: ActorTargetKind): readonly ActorPreset[] {
    return kind === "npc" ? NPC_PRESETS : CREATURE_PRESETS;
  }

  async setTarget(kind: ActorTargetKind, presetId: string): Promise<ActorLabState> {
    const presets = this.presets(kind);
    const preset = presets.find((candidate) => candidate.id === presetId) ?? presets[0];
    if (!preset) throw new Error(`No ${kind} presets are available`);
    this.targetKind = kind;
    this.targetPresetId = preset.id;
    this.targetWalking = false;
    this.walkPhase = 0;
    const entityId = `lab-target-${preset.id}`;
    const scale = preset.scale;
    this.targetEntity = {
      id: entityId,
      archetype: kind === "npc" ? "npc" : "enemy",
      name: preset.label,
      tier: preset.tier,
      regionId: preset.regionId,
      position: [TARGET_X, -this.assets.baseY(preset.assetId) * scale, 0],
      state: "alive",
      interactions: kind === "npc" ? ["inspect", "talk"] : ["inspect", "attack"],
      view: {
        assetId: preset.assetId,
        partAssetIds: preset.partAssetIds,
        scale,
        rotationY: -Math.PI / 2,
        materialTier: preset.tier,
        labelHeight: 2.2,
      },
    };
    await this.views.prepare([this.targetEntity]);
    this.views.sync([this.targetEntity]);
    this.views.update(0, this.camera.position);
    this.lastAction = "spawn";
    this.revision += 1;
    return this.getState();
  }

  setPlayerPose(pose: CharacterPose): ActorLabState {
    this.player.play(pose, true);
    if (pose === "walk") this.player.setLocomotionSpeed(1.8);
    if (pose === "run") this.player.setLocomotionSpeed(4.2);
    this.revision += 1;
    return this.getState();
  }

  setTargetMotion(motion: CharacterMotion): ActorLabState {
    const target = this.targetEntity;
    if (!target) return this.getState();
    this.targetWalking = motion === "walk";
    if (motion === "death") {
      target.state = "dead";
      this.views.sync([target]);
    } else if (motion === "idle") {
      target.state = "alive";
      this.views.sync([target]);
    } else if (motion === "attack" || motion === "hit") {
      this.views.playAction(target.id, motion);
    }
    this.revision += 1;
    return this.getState();
  }

  setSpell(spellId: string): ActorLabState {
    const spell = SPELLS.find((candidate) => candidate.id === spellId);
    if (spell) this.spellId = spell.id;
    return this.getState();
  }

  /**
   * Selects any item the production content catalog assigns to this slot, then routes the complete
   * desired worn set through `CharacterRig.applyEquipment` so skin replacement, rigid sockets,
   * tinting, and disposal are the same paths used in the game.
   *
   * Accessory slots are still recorded even though the production renderer intentionally has no
   * meshes for them. `CharacterRig.visibleSlots()` excludes those two slots, so their effect here
   * is honest semantic telemetry rather than an invented visual.
   */
  async equipPlayer(slot: EquipSlot, itemId: ItemId | null): Promise<ActorLabState> {
    await this.selectEquipment(slot, itemId);
    this.revision += 1;
    return this.getState();
  }

  /**
   * Sets presentation-lab skill telemetry within the same 1..99 bounds as production.
   *
   * The isolated lab does not construct a Store or CombatSystem, so this deliberately changes no
   * damage, accuracy, requirements, or unlock formula. Feature tests can still state the intended
   * player level without booting the final simulation.
   */
  setLevel(skillId: SkillId, level: number): ActorLabState {
    if (!(SKILL_IDS as readonly string[]).includes(skillId)) {
      throw new Error(`Unknown production skill: ${String(skillId)}`);
    }
    const whole = Number.isFinite(level) ? Math.floor(level) : 1;
    this.levels[skillId] = Math.max(1, Math.min(MAX_LEVEL, whole));
    this.revision += 1;
    return this.getState();
  }

  async perform(action: LabAction, hit = true): Promise<ActorLabState> {
    const target = this.targetEntity;
    if (!target) return this.getState();
    const now = performance.now();
    this.lastAction = action;

    if (action === "melee") {
      if (this.equipment.mainHand === null) {
        await this.selectEquipment("mainHand", SWORD);
      }
      this.player.play("attack_melee", true);
      this.pendingMeleeHit = hit;
    } else if (action === "cast") {
      const spell = SPELLS.find((candidate) => candidate.id === this.spellId) ?? SPELLS[0];
      if (!spell) throw new Error("The spell catalog is empty");
      if (this.equipment.mainHand === null) {
        await this.selectEquipment("mainHand", STAFF);
      }
      this.player.play("cast", true, castTimeScale(spell.rung));
      this.castCount += 1;
      const from: Vec3 = [PLAYER_POSITION[0] + 0.2, 1.15, PLAYER_POSITION[2]];
      const to: Vec3 = [target.position[0], target.position[1], target.position[2]];
      const flightMs = this.spells.flightMs(spell.rung, Math.abs(to[0] - from[0]));
      this.spells.cast({
        id: `lab-cast-${this.castCount}`,
        element: spell.element,
        rung: spell.rung,
        from,
        to,
        hit,
      }, now);
      if (hit) this.schedule(now + flightMs, () => this.hitTarget());
    } else if (action === "target-attack") {
      this.views.playAction(target.id, "attack");
      this.schedule(now + 430, () => this.player.play("hit", true));
    } else if (action === "hit-target") {
      this.hitTarget();
    } else if (action === "kill-target") {
      this.killTarget();
    } else if (action === "respawn-target") {
      this.respawnTarget();
    }
    this.revision += 1;
    return this.getState();
  }

  update(deltaSeconds: number, nowMs: number): void {
    this.frames += 1;
    this.player.update(deltaSeconds);
    for (const event of this.player.drainMotionEvents()) {
      this.playerMarkers[event.kind] += 1;
      if (event.kind === "impact" && this.pendingMeleeHit) {
        this.pendingMeleeHit = false;
        this.hitTarget();
      }
    }
    const target = this.targetEntity;
    if (target && this.targetWalking && target.state !== "dead") {
      this.walkPhase += deltaSeconds * 0.9;
      target.position = [target.position[0], target.position[1], Math.sin(this.walkPhase) * 0.75];
      target.view!.rotationY = Math.cos(this.walkPhase) >= 0 ? 0 : Math.PI;
      this.views.syncMotion([target]);
    }
    this.views.update(deltaSeconds, this.camera.position);
    this.spells.update(nowMs);
    this.peakParticles = Math.max(this.peakParticles, this.spells.liveParticles());
    this.peakSpellDrawCalls = Math.max(this.peakSpellDrawCalls, this.spells.drawCalls());
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const pending = this.pending[index];
      if (!pending || pending.atMs > nowMs) continue;
      this.pending.splice(index, 1);
      pending.action();
    }
  }

  getState(): ActorLabState {
    const targetId = this.targetEntity?.id ?? null;
    return {
      ready: this.ready,
      revision: this.revision,
      frames: this.frames,
      targetKind: this.targetKind,
      targetPresetId: this.targetPresetId,
      targetEntityId: targetId,
      targetState: this.targetEntity?.state ?? null,
      player: this.player.isReady() ? this.player.motionSnapshot() : null,
      playerStats: this.player.isReady() ? this.player.stats() : null,
      equipment: { ...this.equipment },
      equipmentTotals: equipmentTotalsOf(equipmentStacks(this.equipment)),
      levels: { ...this.levels },
      target: targetId ? this.views.motionSnapshot(targetId) : null,
      spellId: this.spellId,
      liveParticles: this.spells.liveParticles(),
      spellDrawCalls: this.spells.drawCalls(),
      peakParticles: this.peakParticles,
      peakSpellDrawCalls: this.peakSpellDrawCalls,
      castCount: this.castCount,
      hitCount: this.hitCount,
      deathCount: this.deathCount,
      respawnCount: this.respawnCount,
      playerMarkers: { ...this.playerMarkers },
      lastAction: this.lastAction,
      errors: [...this.errors],
    };
  }

  dispose(): void {
    this.pending = [];
    this.spells.dispose();
    this.player.dispose();
    this.views.dispose();
    this.root.removeFromParent();
  }

  private hitTarget(): void {
    const id = this.targetEntity?.id;
    if (!id) return;
    if (this.views.playAction(id, "hit")) this.hitCount += 1;
  }

  private async selectEquipment(slot: EquipSlot, itemId: ItemId | null): Promise<void> {
    if (!(EQUIP_SLOTS as readonly string[]).includes(slot)) {
      throw new Error(`Unknown production equipment slot: ${String(slot)}`);
    }
    if (itemId !== null) {
      const item = ALL_ITEMS.find((candidate) => candidate.id === itemId);
      if (!item?.equip) throw new Error(`${itemId} is not production equipment`);
      if (item.equip.slot !== slot) {
        throw new Error(`${item.name} equips in ${item.equip.slot}, not ${slot}`);
      }
    }

    this.equipment[slot] = itemId;
    await this.player.applyEquipment(equipmentStacks(this.equipment));
  }

  private schedule(atMs: number, action: () => void): void {
    this.pending.push({ atMs, action });
  }

  private killTarget(): void {
    const target = this.targetEntity;
    if (!target || target.state === "dead") return;
    target.state = "dead";
    this.targetWalking = false;
    this.views.sync([target]);
    this.deathCount += 1;
  }

  private respawnTarget(): void {
    const target = this.targetEntity;
    if (!target || target.state === "alive") return;
    target.state = "alive";
    this.views.sync([target]);
    this.respawnCount += 1;
  }
}

function castTimeScale(rung: SpellRung): number {
  if (rung === "surge") return 0.78;
  if (rung === "burst") return 0.88;
  return 1;
}

function emptyEquipment(): Record<EquipSlot, ItemId | null> {
  const equipment = {} as Record<EquipSlot, ItemId | null>;
  for (const slot of EQUIP_SLOTS) equipment[slot] = null;
  return equipment;
}

function startingLevels(): Record<SkillId, number> {
  const levels = {} as Record<SkillId, number>;
  for (const skillId of SKILL_IDS) levels[skillId] = 1;
  return levels;
}

function equipmentStacks(
  equipment: Readonly<Record<EquipSlot, ItemId | null>>,
): Record<EquipSlot, ItemStack | null> {
  const stacks = {} as Record<EquipSlot, ItemStack | null>;
  for (const slot of EQUIP_SLOTS) {
    const itemId = equipment[slot];
    stacks[slot] = itemId === null ? null : { itemId, quantity: 1 };
  }
  return stacks;
}

function titleCaseIdentifier(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replaceAll("_", " ");
  return words.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
