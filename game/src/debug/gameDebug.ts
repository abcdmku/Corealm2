/**
 * `window.__gameDebug` — the test surface. Game code never calls it.
 *
 * The nine harness-required methods are FIXED by tools/lib/driver.ts and tools/smoke-test.ts. Their
 * names, synchrony, and return shapes are not ours to choose (see runs/corealm/architecture.md,
 * correction R1):
 *
 *   - all nine are SYNCHRONOUS: the driver reads them inside page.evaluate and JSON-serialises the
 *     result. Full snapshots include getEntities(); the default lean profile omits those thousands
 *     of rows. A Promise from any getter would still serialise to {}.
 *   - all nine are JSON-SAFE: callDebug does JSON.parse(JSON.stringify(fn() ?? null))
 *   - getState().ready gates boot detection
 *   - getPlayerPosition() returns {x,y,z}, NOT the Vec3 tuple the contracts use internally
 *   - getNavigationState().status must literally be "ready"
 *   - reset() takes effect within ~150 ms and is not awaited
 *   - volatile per-frame data lives under exactly `clock` and `renderer`, because
 *     play-game.ts's semanticFingerprint deletes those two keys before diffing. Anything volatile
 *     elsewhere makes every scenario step report changed:true and destroys the signal.
 *
 * Everything below the nine is a Corealm-specific test helper.
 */
import * as THREE from "three";
import type { EntityId, ItemId, QuestId, SkillId, Vec3 } from "../contracts.js";
import type { Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import type { Navigation } from "../systems/navigation.js";
import type { Movement } from "../systems/movement.js";
import type { CorealmGameApi } from "../api/gameApi.js";
import type { Renderer } from "../render/renderer.js";
import type { OrbitCamera } from "../render/camera.js";
import type { AssetRegistry } from "../render/assets.js";
import { addSkillXp, setSkillLevel as applySkillLevel } from "../state/store.js";
import { roundVec3 } from "../core/math.js";
import { keybindings } from "../input/keyboard.js";

export interface RecordedError {
  atMs: number;
  source: string;
  message: string;
  stack?: string;
}

export interface DebugDeps {
  store: Store;
  events: EventBus;
  clock: SimClock;
  nav: Navigation;
  movement: Movement;
  api: CorealmGameApi;
  renderer: Renderer;
  camera: OrbitCamera;
  assets: AssetRegistry;
  errors: RecordedError[];
  /** True only after the first playable frame has rendered and the boot overlay is gone. */
  isReady(): boolean;
  /**
   * Live particle count in the spell effect layer, when one is wired.
   *
   * Exists because the alternative is guessing. `render/spellVfx.ts` draws through ONE additive
   * InstancedMesh, so from outside the only evidence a cast produced anything is `drawCalls` moving
   * by one — and that number also moves when the player crosses a streaming boundary or a building
   * fades, which is most of what happens while walking to a fight. `tools/verify-magic.ts` was
   * reading draw calls and calling a streamed-in hedge a spell. This answers the question directly.
   */
  spellParticles?(): number;
  /** JSON-safe audio playback state and evidence; absent only in boot-fallback tests. */
  audioState?(): unknown;
  audioHistory?(limit?: number): unknown;
  clearAudioHistory?(): void;
  foliageOcclusion?(): unknown;
  roofVisibility?(): unknown;
  playerSilhouette?(): unknown;
  setFoliageOcclusionEnabled?(enabled: boolean): void;
  setContainedTroughWater?(enabled: boolean): unknown;
  setFoliageOcclusionBoundsOptimization?(enabled: boolean): void;
  version: { build: string; contracts: string; content: string };
  /** Rebuilds the world and restores spawn state. Must complete synchronously. */
  resetWorld(seed?: number, keepSave?: boolean): void;
  /** True when nothing is pending: no navigation, activity, combat, or asset load. */
  isIdle(): boolean;
  teleport(to: Vec3): void;
  saveNow(): void;
  getSaveBlob(): string;
  loadSaveBlob(json: string): void;
  /** Fast-forwards world timers that deliberately do not use the session SimClock. */
  advanceWorldTime?(seconds: number): void;
  focusCamera(shotId: string): boolean;
  /** Frames the live player closely enough to inspect held equipment. */
  focusPlayer(): boolean;
  /** Frames one live entity for generated guide photography. */
  focusEntity(entityId: EntityId): boolean;
  /** Frames a route-graph location, using its authored shot when one exists. */
  focusLocation(locationId: string): boolean;
  /**
   * Free orbit pose around an arbitrary world point, for structure inspection.
   *
   * `focusCamera` and `focusLocation` both snap their target to the navmesh, which is right for a
   * gameplay pose and wrong for photographing a roof: the interesting half of a structure audit is
   * above head height and off the walkable surface. This one places the orbit centre exactly where
   * it is asked to.
   */
  inspectPose(target: Vec3, yaw: number, pitch: number, distance: number, detached?: boolean): boolean;
  /** Freezes simulation and hides the player while documentation captures run. */
  setCaptureMode(enabled: boolean): void;
  /** Renders and returns the current gameplay canvas before another frame can clear it. */
  captureDocumentationFrame(): string;
  listShots(): string[];
  callTool(name: string, args: unknown): Promise<unknown>;
  /** Test-only item grant. Goes through the real inventory so slot limits still apply. */
  giveItem(itemId: ItemId, quantity: number, to: "inventory" | "bank"): unknown;
  /** Opens the real bank panel after a browser check has moved the player into bank range. */
  openBank?(bankId?: EntityId): boolean;
  /** Opens the real shop panel for browser acceptance without depending on unfinished trade wiring. */
  openShop?(shopId?: EntityId): boolean;
  /** Empties a resource node through the real depletion path, so events and respawn still fire. */
  depleteNode(entityId: EntityId): boolean;
  /** Brings a node or enemy back immediately, skipping its respawn timer. */
  forceRespawn(entityId: EntityId): boolean;
  /** World-space box the renderer draws for one entity, or null when it draws nothing. */
  drawnBounds(
    entityId: EntityId,
  ): { min: Vec3; max: Vec3; meshes: number; path: string; fade: number } | null;
  /** Instancing, rig and draw-call budget state for the entity layer. */
  entityViewStats(): unknown;
  /**
   * What the cursor currently has hovered and selected.
   *
   * Selection lives in the input controller, not in `GameState`, so nothing else on this surface
   * can see it - and "the ring is still on the corpse" is exactly the kind of thing that needs a
   * measurement rather than a screenshot.
   */
  selection?(): { hovered: EntityId | null; selected: EntityId | null };
  /** Selects an entity through the same path a click takes, for checks that need one selected. */
  select?(entityId: EntityId | null): void;
  /** Terrain height at a world XZ. The same function the world layer places entities with. */
  groundHeight(x: number, z: number): number;
  roadPolylines?(): readonly (readonly Vec3[])[];
  /** Every assembled building, with the footprint the terrain has to be flat across. */
  listBuildings(): { id: string; prefab: string; x: number; z: number; width: number; depth: number; rotationY: number }[];
  /**
   * Whatever the scatter system reported for its last run, one entry per region.
   *
   * Optional for small boot-fallback tests that do not build procedural dressing. The real boot
   * supplies `ScatterResult[]`; without it `getScatterStats()` answers `{ available: false }`.
   */
  scatterStats?(): unknown;
  /** Generation-tile readiness, separate from the first playable frame. */
  scatterResidency?(): unknown;
  scatterVisibility?(): unknown;
  /** Live rig playback state; optional only for boot-fallback tests without a character rig. */
  playerMotion?(): unknown;
  entityMotion?(entityId: EntityId): unknown;
  /** Solved shoreline contours and basin closure state for the rendered water bodies. */
  waterBodies?(): unknown;
  /** One JSON-safe terrain/biome/coast probe for world authoring tools. */
  worldSample?(x: number, z: number): unknown;
  worldClearance?(options: { x: number; z: number; radius: number; y?: number }): unknown;
  setMovementDetourDiagnostics?(enabled: boolean): void;
  movementDetourDiagnostics?(): unknown;
  /** Build-time only: one north-up tile rendered from the complete Three scene. */
  captureWorldMapTile?(options: {
    centreX: number;
    centreZ: number;
    spanMetres: number;
    pixels: number;
  }): string;
}

/**
 * Archetypes whose entity origin is placed on the terrain by `spotToVec3`, so a gap between the
 * drawn mesh and the ground is a defect rather than an authored offset.
 *
 * `landmark` is excluded on purpose: 725 of the world's 892 entities are landmark rows, almost all
 * of them prefab or composition PARTS, which are authored in their parent asset's own frame with
 * deliberate offsets (the worst is a `wall_bottom_trim` sunk 0.134 m, which is how the trim reads).
 * `checkBuildingFooting()` already covers whether those parents stand level.
 */
const GROUND_PLACED_ARCHETYPES: readonly string[] = [
  "ore", "tree", "fishing_spot",
  "enemy", "boss", "npc", "station", "bank", "shop",
  "obstacle", "door", "portal", "loot", "recovery_cache",
];

/** Worst rows returned by `checkGrounding()`. 892 entities of full detail blows the serialiser. */
const GROUNDING_REPORT_LIMIT = 200;

function xyz(value: Vec3): { x: number; y: number; z: number } {
  return { x: value[0], y: value[1], z: value[2] };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function installGameDebug(deps: DebugDeps): void {
  const { store, events, clock, nav, movement, api, renderer, camera, assets } = deps;

  const debugApi = {
    // ------------------------------------------------- the nine harness methods

    getState(): Record<string, unknown> {
      const state = store.get();
      const stats = renderer.getStats();
      return {
        ready: deps.isReady(),
        version: deps.version,
        regionId: state.player.regionId,
        seed: state.meta.seed,
        skills: Object.fromEntries(
          Object.entries(state.skills).map(([id, entry]) => [id, { level: entry.level, xp: entry.xp }]),
        ),
        currency: state.currency,
        health: state.player.health,
        maxHealth: state.player.maxHealth,
        inventoryUsed: state.inventory.slots.filter((slot) => slot !== null).length,
        bankUsed: state.bank.slots.length,
        activity: state.activity ? state.activity.kind : null,
        combatTargetId: state.combat.targetId,
        selectedEntityId: deps.selection?.().selected ?? null,
        hoveredEntityId: deps.selection?.().hovered ?? null,
        questCount: Object.keys(state.quests).length,
        entityCount: api.hooks.entities?.all().length ?? 0,
        assets: assets.stats(),
        navStatus: nav.getStatus(),
        // Volatile. play-game.ts deletes these two keys before diffing snapshots.
        clock: { elapsedMs: clock.elapsedMs, tick: clock.tick, paused: clock.paused, timeScale: clock.timeScale },
        renderer: { fps: stats.fps, frameMs: stats.frameMs, drawCalls: stats.drawCalls, triangles: stats.triangles },
      };
    },

    getPlayer(): Record<string, unknown> {
      const view = api.getPlayer();
      return {
        position: xyz(roundVec3(view.position)),
        regionId: view.regionId,
        health: view.health,
        maxHealth: view.maxHealth,
        inCombat: view.inCombat,
        dead: view.dead,
        moving: view.moving,
        activityKind: view.activityKind,
        combatLevelEstimate: view.combatLevelEstimate,
        facingRad: Math.round(store.get().player.facingRad * 1000) / 1000,
      };
    },

    /** The harness requires {x,y,z}, not the internal Vec3 tuple. */
    getPlayerPosition(): { x: number; y: number; z: number } {
      return xyz(roundVec3(store.get().player.position));
    },

    getCamera(): Record<string, unknown> {
      return camera.snapshot();
    },

    getEntities(): unknown[] {
      const all = api.hooks.entities?.all() ?? [];
      return all.map((entity) => ({
        id: entity.id,
        archetype: entity.archetype,
        name: entity.name,
        tier: entity.tier,
        regionId: entity.regionId,
        position: xyz(roundVec3(entity.position)),
        state: entity.state,
        interactions: entity.interactions,
        ...(entity.resource ? { remaining: entity.resource.remaining } : {}),
        ...(entity.combat ? { health: entity.combat.health, maxHealth: entity.combat.maxHealth } : {}),
      }));
    },

    getCurrentActivity(): unknown {
      return api.getActivity();
    },

    getObjectives(): unknown[] {
      return api.getQuests().map((quest) => ({
        id: quest.id,
        name: quest.name,
        status: quest.status,
        stage: quest.stage,
        stageCount: quest.stageCount,
        currentObjective: quest.currentObjective,
        // The ids the objective points at. The prose itself carries none, so a test that wants to
        // act on a quest reads these rather than parsing a sentence.
        refs: quest.currentObjectiveRefs,
      }));
    },

    /**
     * Every key the game answers to, from the live registry.
     *
     * Exists because "the panels are bound to i/k/e and nothing says so" was a real Phase 1 bug,
     * and the only honest way to test that a key still works is to ask what is bound and then
     * press it. A hard-coded list in a scenario would keep passing after the binding was lost.
     */
    getKeyBindings(): unknown[] {
      return keybindings.list().map((binding) => ({
        id: binding.id,
        keys: [...binding.keys],
        label: binding.label,
        group: binding.group ?? "General",
      }));
    },

    /** Which panels exist and which are open right now. Screenshots cannot answer the second half. */
    getPanels(): unknown[] {
      return [...document.querySelectorAll<HTMLElement>(".panel")].map((panel) => ({
        id: panel.id.replace(/^panel-/, ""),
        open: !panel.hidden,
      }));
    },

    getNavigationState(): Record<string, unknown> {
      const state = store.get();
      // The harness checks this exact string equals "ready".
      return nav.snapshot(
        state.player.movement.path,
        state.player.movement.destination,
        movement.remainingDistance(state),
      ) as unknown as Record<string, unknown>;
    },

    /** Synchronous by contract: the driver calls it, waits 150 ms, and does not await. */
    reset(options?: { seed?: number; keepSave?: boolean }): void {
      deps.resetWorld(options?.seed, options?.keepSave ?? false);
    },

    // ------------------------------------------------ additional test surface

    ready(): boolean {
      return deps.isReady();
    },

    getVersion(): { build: string; contracts: string; content: string } {
      return deps.version;
    },

    setPaused(paused: boolean): void {
      clock.paused = Boolean(paused);
    },

    setTimeScale(scale: number): void {
      if (!Number.isFinite(scale)) return;
      clock.timeScale = Math.max(0.1, Math.min(100, scale));
    },

    getPerformanceTimings(): Record<string, unknown> {
      return renderer.getPerformanceTimings();
    },
    setTransmissionOcclusionEnabled(enabled: boolean): void {
      renderer.setTransmissionOcclusionEnabled(Boolean(enabled));
    },
    setTransmissionProbeMode(mode: "bounds" | "exact-diagnostic"): void {
      renderer.setTransmissionProbeMode(mode === "exact-diagnostic" ? mode : "bounds");
    },

    getMetrics(): Record<string, number> {
      const stats = renderer.getStats();
      const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return {
        fps: stats.fps,
        frameMs: stats.frameMs,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        programs: stats.programs,
        textures: renderer.renderer.info.memory.textures,
        geometries: renderer.renderer.info.memory.geometries,
        entityCount: api.hooks.entities?.all().length ?? 0,
        // Lives here and NOT in `getState`. `tools/play-game.ts` diffs state snapshots between
        // actions, and a per-frame particle count in that object would report a difference on every
        // comparison forever — the same reason `clock` and `renderer` are called out as volatile and
        // stripped there. Metrics are already understood to be a live reading.
        spellParticles: deps.spellParticles?.() ?? 0,
        heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : 0,
      };
    },

    getErrors(): RecordedError[] {
      return deps.errors.map((entry) => ({ ...entry }));
    },
    setMovementDetourDiagnostics(enabled: boolean): void {
      deps.setMovementDetourDiagnostics?.(enabled);
    },
    getMovementDetourDiagnostics(): unknown {
      return deps.movementDetourDiagnostics?.() ?? null;
    },

    getPlayerSilhouette(): unknown { return deps.playerSilhouette?.() ?? null; },
    getBiomeAtmosphere(): unknown { return deps.renderer.biomeAtmosphere.snapshot(); },
    getRoofVisibility(): unknown {
      return deps.roofVisibility?.() ?? null;
    },

    getFoliageOcclusion(): unknown {
      return deps.foliageOcclusion?.() ?? null;
    },

    setContainedTroughWater(enabled: boolean): unknown {
      return deps.setContainedTroughWater?.(Boolean(enabled));
    },
    setFoliageOcclusionEnabled(enabled: boolean): void {
      deps.setFoliageOcclusionEnabled?.(enabled);
    },
    setFoliageOcclusionBoundsOptimization(enabled: boolean): void {
      deps.setFoliageOcclusionBoundsOptimization?.(enabled);
    },

    getAudioState(): unknown {
      return deps.audioState?.() ?? null;
    },

    getAudioHistory(limit?: number): unknown {
      return deps.audioHistory?.(limit) ?? [];
    },

    clearAudioHistory(): void {
      deps.clearAudioHistory?.();
    },

    isIdle(): boolean {
      return deps.isIdle();
    },

    advanceGameTime(seconds: number): void {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      clock.skipMs(seconds * 1000);
      deps.advanceWorldTime?.(seconds);
    },

    select(entityId: EntityId | null): void {
      deps.select?.(entityId);
    },

    teleport(to: Vec3 | { x: number; y: number; z: number } | { entityId: EntityId } | { locationId: string }): boolean {
      let target: Vec3 | null = null;
      if (Array.isArray(to)) target = to as Vec3;
      else if (typeof to === "object" && to !== null && "x" in to) target = [to.x, to.y, to.z];
      else if (typeof to === "object" && to !== null && "entityId" in to) {
        target = api.hooks.entities?.get(to.entityId)?.position ?? null;
      } else if (typeof to === "object" && to !== null && "locationId" in to) {
        target = nav.routeNode(to.locationId)?.position ?? null;
      }
      if (!target) return false;
      deps.teleport(target);
      return true;
    },

    grantXp(skill: SkillId, amount: number): number {
      const result = addSkillXp(store.get(), skill, amount);
      if (result.levelsGained > 0) {
        events.emit("level.gained", { skill, level: result.newLevel, levelsGained: result.levelsGained }, undefined, clock.elapsedMs);
        events.flush();
      }
      store.markDirty();
      return result.newLevel;
    },

    setSkillLevel(skill: SkillId, level: number): number {
      applySkillLevel(store.get(), skill, level);
      store.markDirty();
      return store.get().skills[skill].level;
    },

    setCurrency(marks: number): void {
      if (!Number.isFinite(marks)) return;
      store.get().currency = Math.max(0, Math.floor(marks));
      store.markDirty();
    },

    setHealth(health: number): void {
      const state = store.get();
      if (!Number.isFinite(health)) return;
      state.player.health = Math.max(0, Math.min(state.player.maxHealth, Math.floor(health)));
      store.markDirty();
    },

    setSeed(seed: number): void {
      if (!Number.isFinite(seed)) return;
      store.get().meta.seed = seed >>> 0;
      store.markDirty();
    },

    clearInventory(): void {
      const slots = store.get().inventory.slots;
      for (let index = 0; index < slots.length; index += 1) slots[index] = null;
      store.markDirty();
    },

    openBank(bankId?: EntityId): boolean {
      return deps.openBank?.(bankId) ?? false;
    },

    openShop(shopId?: EntityId): boolean {
      return deps.openShop?.(shopId) ?? false;
    },

    getEntity(entityId: EntityId): unknown {
      return api.hooks.entities?.get(entityId) ?? null;
    },

    listEntities(filter?: { archetype?: string; regionId?: string; tier?: number }): unknown[] {
      const all = api.hooks.entities?.all() ?? [];
      return all.filter((entity) => {
        if (filter?.archetype && entity.archetype !== filter.archetype) return false;
        if (filter?.regionId && entity.regionId !== filter.regionId) return false;
        if (filter?.tier !== undefined && entity.tier !== filter.tier) return false;
        return true;
      });
    },

    getEvents(sinceSeq = 0): { events: unknown[]; nextSeq: number } {
      return events.since(sinceSeq);
    },

    getNavPath(from: Vec3, to: Vec3): unknown {
      const path = nav.findPath(from, to);
      return path ? path.map((point) => xyz(roundVec3(point))) : null;
    },

    getNavPoint(point: Vec3): { x: number; y: number; z: number } | null {
      const found = nav.closestPoint(point);
      return found ? xyz(roundVec3(found)) : null;
    },

    planRoute(fromId: string, toId: string, agilityLevel = 1): unknown {
      return nav.planRoute(fromId, toId, agilityLevel);
    },

    listRouteNodes(): unknown[] {
      return nav.listRouteNodes();
    },

    /** Measure actual GPU submissions in one frame, including its shadow pass. */
    getRenderProfile(namePrefix?: string): unknown {
      const gpu = renderer.renderer;
      const original = gpu.renderBufferDirect;
      const rows = new Map<string, { name: string; pass: string; calls: number; triangles: number;
        objects: number[]; targets: string[]; materials: { name: string; uuid: string; transparent: boolean; opacity: number; side: number; forceSinglePass: boolean; transmission: number }[] }>();
      gpu.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
        const calls = gpu.info.render.calls;
        const triangles = gpu.info.render.triangles;
        original.call(this, camera, scene, geometry, material, object, group);
        const submitted = gpu.info.render.calls - calls;
        if (!submitted) return;
        const name = object.name || object.parent?.name || object.type;
        const target = gpu.getRenderTarget();
        const pass = camera === renderer.camera ? target ? "colour-offscreen" : "colour" : "shadow";
        const key = `${pass}:${name}`;
        const row = rows.get(key) ?? { name, pass, calls: 0, triangles: 0, objects: [], targets: [], materials: [] };
        row.calls += submitted;
        row.triangles += gpu.info.render.triangles - triangles;
        if (!row.objects.includes(object.id)) row.objects.push(object.id);
        const targetId = target?.texture.uuid ?? "canvas";
        if (!row.targets.includes(targetId)) row.targets.push(targetId);
        if (!row.materials.some(entry => entry.uuid === material.uuid && entry.side === material.side)) row.materials.push({
          name: material.name, uuid: material.uuid, transparent: material.transparent,
          opacity: material.opacity, side: material.side, forceSinglePass: material.forceSinglePass,
          transmission: (material as THREE.MeshPhysicalMaterial).transmission ?? 0,
        });
        rows.set(key, row);
      };
      try {
        renderer.camera.updateMatrixWorld();
        renderer.prepareScene?.(renderer.camera);
        gpu.render(renderer.scene, renderer.camera);
      } finally {
        gpu.renderBufferDirect = original;
      }
      const draws = [...rows.values()].sort((a, b) => b.triangles - a.triangles);
      const transmissiveCandidates: Record<string, unknown>[] = [];
      const cameraFrustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4()
        .multiplyMatrices(renderer.camera.projectionMatrix, renderer.camera.matrixWorldInverse));
      renderer.scene.traverseVisible(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !object.layers.test(renderer.camera.layers)) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const transmissive = materials.filter(material => material.visible && (material as THREE.MeshPhysicalMaterial).transmission > 0);
        if (!transmissive.length || (mesh.frustumCulled && !cameraFrustum.intersectsObject(mesh))) return;
        const bounds = new THREE.Box3().setFromObject(mesh);
        const projected = new THREE.Box2();
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new THREE.Vector3(x, y, z).project(renderer.camera);
          projected.expandByPoint(new THREE.Vector2((point.x + 1) * gpu.domElement.width / 2, (1 - point.y) * gpu.domElement.height / 2));
        }
        transmissiveCandidates.push({ name: object.name, objectId: object.id, type: object.type,
          count: (object as THREE.InstancedMesh).count ?? null,
          instanceCount: (object as THREE.BatchedMesh).instanceCount ?? null,
          worldBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
          projectedBoundsPixels: { min: projected.min.toArray(), max: projected.max.toArray() },
          nearbyEntities: (api.hooks.entities?.all() ?? []).filter(entity => bounds.distanceToPoint(new THREE.Vector3(...entity.position)) < 5)
            .map(entity => ({ id: entity.id, assetId: entity.view?.assetId, position: entity.position })),
          materials: transmissive.map(material => ({ name: material.name, uuid: material.uuid,
            transmission: (material as THREE.MeshPhysicalMaterial).transmission })) });
      });
      return {
        calls: draws.reduce((sum, row) => sum + row.calls, 0),
        triangles: draws.reduce((sum, row) => sum + row.triangles, 0),
        passes: Object.fromEntries(["colour", "colour-offscreen", "shadow"].map((pass) => {
          const submitted = draws.filter((row) => row.pass === pass);
          return [pass, { calls: submitted.reduce((sum, row) => sum + row.calls, 0), triangles: submitted.reduce((sum, row) => sum + row.triangles, 0) }];
        })),
        textures: gpu.info.memory.textures,
        transmissiveDraws: draws.filter(row => row.materials.some(material => material.transmission > 0)),
        transmissiveCandidates,
        draws: namePrefix ? draws.filter((row) => row.name.startsWith(namePrefix)) : draws.slice(0, 40),
      };
    },

    /** Temporary diagnostic only; restores the material's actual mesh before returning. */
    captureTransmissionContribution(objectId: number): { withSurface: string; withoutSurface: string } {
      const object = renderer.scene.getObjectById(objectId) as THREE.Mesh | undefined;
      const materials = object?.isMesh ? Array.isArray(object.material) ? object.material : [object.material] : [];
      if (!object || !materials.some(material => (material as THREE.MeshPhysicalMaterial).transmission > 0)) {
        throw new Error("Contribution capture requires an existing transmissive mesh");
      }
      const visible = object.visible;
      const draw = () => { renderer.prepareScene?.(renderer.camera); renderer.renderer.render(renderer.scene, renderer.camera);
        return renderer.renderer.domElement.toDataURL("image/png"); };
      // One synchronous call: no simulation, animation or wind update can run between images.
      try {
        object.visible = true;
        const withSurface = draw();
        object.visible = false;
        const withoutSurface = draw();
        return { withSurface, withoutSurface };
      } finally {
        object.visible = visible;
        draw();
      }
    },

    /** Scene graph inventory, including objects culled from the current render. */
    getSceneStats(): Record<string, unknown> {
      const counts: Record<string, number> = {};
      const hidden: Record<string, number> = {};
      let total = 0;
      renderer.scene.traverse((object) => {
        total += 1;
        const key = object.name ? object.name.replace(/[-_]?\d+$/, "") : object.type;
        counts[key] = (counts[key] ?? 0) + 1;
        let node: THREE.Object3D | null = object;
        let visible = true;
        while (node) {
          if (!node.visible) { visible = false; break; }
          node = node.parent;
        }
        if (!visible) hidden[key] = (hidden[key] ?? 0) + 1;
      });
      return { totalObjects: total, counts, hidden };
    },

    /**
      * The world-space box the renderer actually draws for one entity, or null when it draws
      * nothing.
      *
      * "It vanished" and "it is drawn somewhere I am not looking" are different bugs with the same
      * screenshot, and `getSceneStats` cannot tell them apart: it counts meshes, and an instanced
      * mesh exists whether or not any of its slots are visible. This reads the instance matrix for
      * the entity's own slot.
      */
    getDrawnBounds(entityId: EntityId): Record<string, unknown> | null {
      const bounds = deps.drawnBounds(entityId);
      if (!bounds) return null;
      return {
        min: xyz(bounds.min),
        max: xyz(bounds.max),
        height: round3(bounds.max[1] - bounds.min[1]),
        width: round3(Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2])),
        meshes: bounds.meshes,
        // "instanced" is the baked-idle fallback, "animated:<clip>" is a live rig. A screenshot
        // cannot tell them apart and the difference is the whole reason a boss looks like a statue.
        path: bounds.path,
        // How far through dissolving a corpse is, 0 to 1. The box is measured off the object graph
        // and an invisible corpse still has one, so this is the only thing that says it has gone.
        fade: round3(bounds.fade),
      };
    },

    /**
     * How level the ground is under each building, in metres.
     *
     * A building is assembled level — every part shares the origin's ground height, because
     * following the terrain per part would shear a twelve-metre hall — so any tilt in the ground
     * beneath it turns into a floating corner or a buried one. That was the "wall panels float at
     * an angle, roof sections rest on grass" finding, and it is not a rendering bug at all: it is
     * a building standing off the edge of its settlement's flattened pad.
     *
     * `worst` is the largest gap between the height at the building's origin and the height under
     * any corner of its footprint. Anything above a few centimetres is visible.
     */
    checkBuildingFooting(): { id: string; worst: number }[] {
      return deps.listBuildings()
        .map((building) => {
          const cos = Math.cos(building.rotationY);
          const sin = Math.sin(building.rotationY);
          const base = deps.groundHeight(building.x, building.z);
          let worst = 0;
          for (const sx of [-0.5, 0.5]) {
            for (const sz of [-0.5, 0.5]) {
              const lx = sx * building.width;
              const lz = sz * building.depth;
              const x = building.x + lx * cos + lz * sin;
              const z = building.z - lx * sin + lz * cos;
              worst = Math.max(worst, Math.abs(deps.groundHeight(x, z) - base));
            }
          }
          return { id: building.id, worst: round3(worst) };
        })
        .sort((a, b) => b.worst - a.worst);
    },

    /**
     * Terrain height at a world XZ — the same function the world layer places entities with.
     *
     * Wired in boot.ts since round 1 and declared in `DebugDeps`, but never exposed here, so
     * `window.__gameDebug.groundHeight` read `undefined` and every grounding audit had to rebuild
     * the height field offline to ask the question.
     */
    groundHeight(x: number, z: number): number {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
      return round3(deps.groundHeight(x, z));
    },

    getRoadPolylines(): readonly (readonly Vec3[])[] {
      return deps.roadPolylines?.() ?? [];
    },

    /** Every assembled building and the footprint the terrain has to be flat across. Same story. */
    listBuildings(): unknown[] {
      return deps.listBuildings();
    },

    /**
     * How far every ground-placed entity's drawn mesh sits above or below the ground under it.
     *
     * This is the number the whole floating/sinking class reduces to. Nothing placed an entity by
     * its mesh: `spotToVec3` put the GLB ORIGIN at ground level, and 119 of the 213 assets in the
     * library have |bbox.min.y| > 2 cm, so the visible gap came out as exactly
     * `glbMinY x scale x tierSilhouetteScale(tier)` — verified to three decimals across 159 surface
     * entities. That is why the Fallen Duskoak hovered 5.773 m (a `roof_log` at scale 1.5), the
     * Coldbrace fletching bench hovered 1.411 m.
     *
     * `gap` is `drawnMinY - groundY`: positive floats, negative sinks. Anything past a few
     * centimetres is visible in a screenshot, so a gate line can assert `worst < 0.05`.
     *
     * Two things to know before reading the numbers. `groundY` is the ANALYTIC height field, which
     * is what entities are placed against; the tessellated mesh the player sees differs from it by
     * meanAbs 0.031 m over 38,332 samples, so treat sub-5 cm rows as noise. And an entity the
     * renderer draws nothing for has no bounds at all — those are counted in `notDrawn`, never
     * silently scored as zero.
     */
    checkGrounding(): Record<string, unknown> {
      const all = api.hooks.entities?.all() ?? [];
      const rows: { id: string; archetype: string; assetId: string; drawnMinY: number; groundY: number; gap: number }[] = [];
      let considered = 0;
      let notDrawn = 0;
      for (const entity of all) {
        if (!GROUND_PLACED_ARCHETYPES.includes(entity.archetype)) continue;
        // "parent#part" ids are composition parts, authored in the parent's frame.
        if (entity.id.includes("#")) continue;
        considered += 1;
        const bounds = deps.drawnBounds(entity.id);
        if (!bounds) { notDrawn += 1; continue; }
        const groundY = deps.groundHeight(entity.position[0], entity.position[2]);
        rows.push({
          id: entity.id,
          archetype: entity.archetype,
          assetId: entity.view?.assetId ?? "",
          drawnMinY: round3(bounds.min[1]),
          groundY: round3(groundY),
          gap: round3(bounds.min[1] - groundY),
        });
      }
      rows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
      const worstRow = rows[0];
      return {
        considered,
        measured: rows.length,
        notDrawn,
        worst: worstRow ? Math.abs(worstRow.gap) : 0,
        overTolerance: rows.filter((row) => Math.abs(row.gap) > 0.05).length,
        // Worst-first, capped. `measured` is the true population; `entries` is a window onto it.
        entries: rows.slice(0, GROUNDING_REPORT_LIMIT),
      };
    },

    /**
     * What the procedural scatter pass placed, per region.
     *
     * `scatterWorld` already computes this — placed, rejected, instancedMeshes, estimatedDrawCalls,
     * estimatedTriangles, byLayer, missingAssets — and boot throws the array away at the `await`,
     * so ~525 buried pebbles and every rejection were invisible from outside the page. When boot
     * has not supplied the port this answers `{ available: false }` rather than an empty array,
     * because "scatter placed nothing" and "nobody asked scatter" are different bugs.
     */
    getScatterStats(): unknown {
      if (!deps.scatterStats) return { available: false, reason: "boot did not supply a scatter port" };
      return { available: true, regions: deps.scatterStats() };
    },

    getScatterResidency(): unknown {
      return deps.scatterResidency?.() ?? null;
    },
    getScatterVisibility(): unknown {
      return deps.scatterVisibility?.() ?? null;
    },

    getPlayerMotion(): unknown {
      return deps.playerMotion?.() ?? null;
    },

    getEntityMotion(entityId: EntityId): unknown {
      return deps.entityMotion?.(entityId) ?? null;
    },

    getWaterBodies(): unknown {
      return deps.waterBodies?.() ?? null;
    },

    sampleWorld(x: number, z: number): unknown {
      return deps.worldSample?.(x, z) ?? null;
    },

    probeWorldClearance(options: { x: number; z: number; radius: number; y?: number }): unknown {
      if (![options.x, options.z, options.radius].every(Number.isFinite) || options.radius <= 0
        || (options.y !== undefined && !Number.isFinite(options.y))) throw new Error("A clearance probe needs finite coordinates and a positive radius.");
      return deps.worldClearance?.(options) ?? null;
    },

    captureWorldMapTile(options: {
      centreX: number;
      centreZ: number;
      spanMetres: number;
      pixels: number;
    }): string {
      if (!deps.captureWorldMapTile) throw new Error("World-map capture is not installed.");
      return deps.captureWorldMapTile(options);
    },

    /** Instancing, rig and draw-call budget state for the entity layer. */
    getEntityViewStats(): Record<string, unknown> {
      return deps.entityViewStats() as unknown as Record<string, unknown>;
    },

    listClips(): string[] {
      return assets.clipNames();
    },

    focusCamera(shotId: string): boolean {
      return deps.focusCamera(shotId);
    },

    focusPlayer(): boolean {
      return deps.focusPlayer();
    },

    focusEntity(entityId: EntityId): boolean {
      return deps.focusEntity(entityId);
    },

    focusLocation(locationId: string): boolean {
      return deps.focusLocation(locationId);
    },

    setCaptureMode(enabled: boolean): void {
      deps.setCaptureMode(Boolean(enabled));
    },

    captureDocumentationFrame(): string {
      return deps.captureDocumentationFrame();
    },

    /** Alias. `tools/screenshot.ts --preset` calls this name. */
    setCameraPreset(shotId: string): boolean {
      return deps.focusCamera(shotId);
    },

    /** Orbit an arbitrary world point. Structure audits need poses no route node offers. */
    inspectPose(pose: {
      x: number; y: number; z: number; yaw?: number; pitch?: number; distance?: number; detached?: boolean;
    }): boolean {
      return deps.inspectPose(
        [Number(pose.x), Number(pose.y), Number(pose.z)],
        Number(pose.yaw ?? 0), Number(pose.pitch ?? 0.35), Number(pose.distance ?? 14),
        pose.detached === true,
      );
    },

    listShots(): string[] {
      return deps.listShots();
    },

    saveNow(): void {
      deps.saveNow();
    },

    getSaveBlob(): string {
      return deps.getSaveBlob();
    },

    loadSaveBlob(json: string): void {
      deps.loadSaveBlob(json);
    },

    /** Invokes an agent tool in-page. This is how parity between a click and a tool call is proven. */
    callTool(name: string, args: unknown): Promise<unknown> {
      return deps.callTool(name, args);
    },

    depleteNode(entityId: EntityId): boolean {
      return deps.depleteNode(entityId);
    },

    forceRespawn(entityId: EntityId): boolean {
      return deps.forceRespawn(entityId);
    },

    setQuestStage(questId: QuestId, stage: number): void {
      const quests = store.get().quests;
      const existing = quests[questId] ?? { status: "active" as const, stage: 0, counters: {}, flags: {} };
      existing.stage = Math.max(0, Math.floor(stage));
      existing.status = "active";
      quests[questId] = existing;
      store.markDirty();
    },

    giveItem(itemId: ItemId, quantity: number, to: "inventory" | "bank" = "inventory"): unknown {
      return deps.giveItem(itemId, quantity, to);
    },

    /**
     * Sets the character up to exercise the released magic ladder in one call.
     *
     * The first argument remains the Magic level. The second remains numeric for older callers,
     * but now means how much of each released essence to grant. Weapons, orbs, and essence all pass
     * through the real inventory and equipment paths. This matters for orbs: the first inventory
     * grant creates the charged weapon's 1,000-charge ledger entry, while duplicate grants do not
     * refill one that has already been used.
     *
     * The default level equips Cairnpine plus Water. A lower level equips the strongest released
     * charged staff it can use. Fire stays out until its region ships.
     */
    seedMagic(magicLevel = 70, essenceQuantity = 5000): Record<string, unknown> {
      applySkillLevel(store.get(), "magic", magicLevel);

      const weapons: ItemId[] = [
        "basic_wooden_wand", "basic_wooden_staff",
        "palewood_wand", "palewood_staff",
        "duskoak_wand", "duskoak_staff",
        "cairnpine_wand", "cairnpine_staff",
        "air_wand", "air_staff",
        "earth_wand", "earth_staff",
        "water_wand", "water_staff",
      ];
      const releasedOrbs: ItemId[] = ["air_orb", "earth_orb", "water_orb"];
      const releasedEssence: ItemId[] = ["air_essence", "earth_essence", "water_essence"];
      const essencePerType = Math.max(1, Math.floor(essenceQuantity));

      // A two-handed staff cannot share the normal off hand. Use the same unequip path as the UI.
      if (store.get().equipment.offHand) api.unequipItem("offHand");
      for (const itemId of weapons) deps.giveItem(itemId, 1, "inventory");
      for (const itemId of releasedOrbs) deps.giveItem(itemId, 1, "inventory");
      for (const itemId of releasedEssence) deps.giveItem(itemId, essencePerType, "inventory");

      const level = store.get().skills.magic.level;
      const loadout = level >= 10
        ? { weapon: "water_staff" as ItemId }
        : level >= 5
          ? { weapon: "earth_staff" as ItemId }
          : { weapon: "air_staff" as ItemId };
      const weaponResult = api.equipItem(loadout.weapon);
      store.markDirty();

      const book = api.getSpellbook();
      const weapon = book.equippedWeapon;
      return {
        magic: level,
        weapons,
        equippedWeapon: weaponResult.ok ? loadout.weapon : null,
        weaponError: weaponResult.ok ? null : weaponResult.error.message,
        weaponCharges: weapon?.charges ?? 0,
        essence: book.essence,
        castable: book.spells.filter((row) => row.castable).length,
        activeSpellId: book.activeSpellId,
      };
    },
  };

  (window as unknown as { __gameDebug?: unknown }).__gameDebug = debugApi;
}
