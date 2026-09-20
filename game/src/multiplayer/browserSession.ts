import type { WorldConfiguration, WorldUpdate, SemanticEntity, WorldDescriptor, SessionCredentials, WorldProvider, SessionPhase, RemotePlayer } from "../contracts.js";
import {WORLD_CONTENT_VERSION,WORLD_LAB_CONTENT_VERSION} from "../contracts.js";
import type { Store } from "../state/store.js";
import { composeSessionState } from "../state/store.js";
import type { GameLoop } from "../app/loop.js";
import type { SimClock } from "../core/time.js";
import type { EntityStore } from "../world/entities.js";
import type { EntityViews } from "../render/entityViews.js";
import type { AssetRegistry } from "../render/assets.js";
import { SessionFailure } from "./protocol.js";
import { foreignAssetHost } from "../app/config.js";
import { createWorldSelector, savedHosts } from "../multiplayer/worldSelector.js";
import type { SessionControllerPorts } from "./providers.js";
import { npcOutfitParts } from "../render/characterAppearances.js";
import { ActorInterpolation } from "../multiplayer/interpolation.js";
import {MovementPrediction} from "./movementPrediction.js";
import {visibleRemotePlayers} from "./visiblePlayers.js";
import {CrowdDetail} from "./crowdDetail.js";
import {ReplicatedEntityLayer,upsertReplicatedEntity} from "./replicatedEntities.js";
import type { CorealmGameApi } from "../api/gameApi.js";
import type { EventBus } from "../core/events.js";
import type { SaveService } from "../persistence/storage.js";
import type { Movement, DirectInput } from "../systems/movement.js";
import { replicatedTraversal } from "./traversal.js";
import { sampleTraversal } from "../systems/traversalMotion.js";
import type { TraversalPresentation } from "../render/traversalPresentation.js";
import { sampleFishing } from "../render/fishingPose.js";
import { GATHER_TICK_MS } from "../core/time.js";
import { MultiplayerSocial } from "../ui/multiplayerSocial.js";

/** World selection that outlives the loading screen: built early, wired to the engine later. */
export type WorldSelection = Awaited<ReturnType<typeof createWorldSelector>> & { attach(ports: SessionControllerPorts): void };

declare global {
  interface Window {
    __COREALM_MULTIPLAYER__?: WorldConfiguration;
    __COREALM_DEVELOPMENT_GUESTS__?: boolean;
    __COREALM_AUTHENTICATE__?: (world:WorldDescriptor) => Promise<SessionCredentials>;
    __COREALM_PROVIDERS__?: WorldProvider[];
    __multiplayerLab?: { observe(): unknown };
  }
}

export interface BrowserSessionPorts {
  mountWorlds?(panel:HTMLElement):void;
  store: Store; loop: GameLoop; clock: SimClock; entities: EntityStore; views: EntityViews; assets: AssetRegistry;
  api: CorealmGameApi; events: EventBus; saves: SaveService; movement: Movement;
  phase?(phase:SessionPhase):void;
  applied?(update:WorldUpdate):void;
  restored?():void;
  expectedSeed?:number;
  traversal?: TraversalPresentation;
}

/**
 * World selection, before the engine exists.
 *
 * Discovery and the player's world choice need none of the gameplay ports, so the panel is built
 * and mounted while the game is still loading. Session ports arrive later through `attach`, and
 * `setReady` opens joining once the first frame is on screen. Returns null when the page has no
 * configured worlds and the player has added no host of their own.
 */
export async function startWorldSelection(options:{fixture?:boolean}={}):Promise<WorldSelection|null> {
  const configuration = window.__COREALM_MULTIPLAYER__;
  if (!configuration && !savedHosts().length) return null;
  const name = document.createElement("input"); name.setAttribute("aria-label", "Development guest name"); name.placeholder = "Development guest name";
  name.value = `guest-${crypto.randomUUID().slice(0, 8)}`; name.maxLength = 40;
  const developmentGuests=options.fixture===true||window.__COREALM_DEVELOPMENT_GUESTS__===true;
  // Gameplay ports are forwarded rather than captured: nothing reaches the engine before it exists.
  const attached:{ports:SessionControllerPorts|null}={ports:null};
  const selector = await createWorldSelector(configuration, {
    validate:world=>attached.ports?.validate?.(world),
    clear:()=>attached.ports?.clear(),
    apply:update=>attached.ports?.apply(update),
    phase:(phase,message)=>attached.ports?.phase(phase,message),
    offline:async()=>{await attached.ports?.offline();},
  }, async world => {
    if(window.__COREALM_AUTHENTICATE__)return window.__COREALM_AUTHENTICATE__(world);
    if(developmentGuests)return {token:`guest:${name.value}`};
    throw new SessionFailure("UNAUTHORIZED","This deployment must provide a sign-in adapter");
  }, window.__COREALM_PROVIDERS__, {ready:false});
  if(developmentGuests){
    const identity=document.createElement("label");identity.className="worlds__identity";
    identity.append("Guest character",name);selector.panel.insertBefore(identity,selector.panel.children[2]??null);
  }
  return {...selector, attach(ports){attached.ports=ports;selector.refresh();}};
}

/** Shared browser presentation and session lifecycle; simulation remains behind the session boundary. */
export async function installBrowserSession(ports: BrowserSessionPorts, options:{fixture?:boolean;crowds?:boolean;equipment?:boolean}={},
  selection?: WorldSelection|null):Promise<void> {
  // A selection made during loading is adopted; otherwise this is the first thing built.
  const selector = selection ?? await startWorldSelection({fixture:options.fixture===true});
  if (!selector) return;
  const social = new MultiplayerSocial(ports.api);
  let offline = ports.store.snapshot(); let offlineEntities = structuredClone(ports.entities.all());
  const replicatedEntities = new ReplicatedEntityLayer(ports.entities, offlineEntities);
  const remote = new Map<string, SemanticEntity>(); const entities = new Map<string, SemanticEntity>();
  const interpolation = new Map<string, ActorInterpolation>();
  const publicPlayers = new Map<string, RemotePlayer>();
  const motionTicks = new Map<string, number>();
  const actionHistory: { sequence: number; type: string; playerId: string; receivedAt: number }[] = [];
  let visibleIds:string[]=[];
  const crowdDetail = new CrowdDetail();
  let simplifyCrowds = options.crowds === true;
  const prediction=new MovementPrediction(ports.movement);
  let online = false; let lastUpdate: WorldUpdate | null = null;
  let receivedAt = 0;
  let traversing = false;
  let lastSteer = -Infinity; let steering = false;
  let lastDirection = [0,0];
  const steer = (input: DirectInput) => {
    prediction.input(input);
    const now = performance.now(); const moving = input.forward !== 0 || input.strafe !== 0;
    const scale = Math.max(1, Math.hypot(input.forward, input.strafe));
    const sin = Math.sin(input.cameraYaw); const cos = Math.cos(input.cameraYaw);
    const x=(input.strafe*cos-input.forward*sin)/scale, z=(-input.strafe*sin-input.forward*cos)/scale;
    const changed=Math.hypot(x-lastDirection[0]!,z-lastDirection[1]!)>.03;
    if ((!moving && !steering) || (moving && steering && now-lastSteer<(changed?50:150))) return;
    lastSteer = now; steering = moving; lastDirection=[x,z];
    void ports.api.submit({ method: "steer", args: [
      x,z,
    ] });
  };
  const outfit = npcOutfitParts("remote-player", "base_male");
  await Promise.all(["base_male", ...outfit].map((id) => ports.assets.load(id, { priority: "visible-spawn" })));
  selector.attach({
    validate(world){
      if(world.contentVersion!==(options.fixture?WORLD_LAB_CONTENT_VERSION:WORLD_CONTENT_VERSION))throw new SessionFailure("INCOMPATIBLE","This world uses a different scene from the loaded game");
      if(ports.expectedSeed!==undefined&&world.seed!==ports.expectedSeed)throw new SessionFailure("INCOMPATIBLE","This world uses a different map seed from the loaded scene");
      if(foreignAssetHost(world.assetBaseUrl))throw new SessionFailure("INCOMPATIBLE","This world uses a different asset host from the loaded game");
    },
    clear() {
      social?.clear(); remote.clear(); interpolation.clear(); publicPlayers.clear(); motionTicks.clear();
      actionHistory.length=0; visibleIds=[]; crowdDetail.clear(); entities.clear();
      // Connection teardown invalidates network state, not the last complete scene. Keep its
      // frozen views through authentication, retries and failures. A valid snapshot replaces
      // the semantic set below and reconciles views once; leaving restores the offline set.
    },
    phase(phase) {
      social?.connected(phase === "connected");
      if(phase!=="connected") {ports.traversal?.reset(); traversing=false;}
      if(phase!=="connected")prediction.clear();
      if (!online && phase === "connecting") {
        offline = ports.store.snapshot(); offlineEntities = structuredClone(ports.entities.all());
        replicatedEntities.capture(offlineEntities);
      }
      ports.phase?.(phase);
      online = phase !== "offline"; ports.loop.setRemoteSimulation(online);
      ports.events.setSimulationEnabled(!online);
      ports.saves.setOnlineSession(online);
      ports.movement.setDirectInputSink(online ? steer : null); steering = false;
      const session=phase === "connected" ? selector.controller.session : null;
      ports.api.setCommandSession(session ? {
        id:session.id,world:session.world,playerId:session.playerId,
        subscribe:listener=>session.subscribe(listener),close:()=>session.close(),
        async command(command){
          const token=prediction.command(command);
          try {
            const outcome=await session.command(command);
            prediction.acknowledge(token,outcome);return outcome;
          } catch(error) {prediction.cancel(token);throw error;}
        },
      } : null, online);
    },
    async offline() {
      ports.store.replace(structuredClone(offline)); ports.entities.load(structuredClone(offlineEntities));
      ports.views.sync(ports.entities.all()); ports.clock.elapsedMs = offline.meta.playSeconds * 1000; ports.restored?.();
    },
    apply(update) {
      lastUpdate = update;
      receivedAt = performance.now();
      if (update.snapshot) { remote.clear(); interpolation.clear(); publicPlayers.clear(); motionTicks.clear(); entities.clear(); replicatedEntities.reset(); }
      if (update.privateState) ports.store.replace(composeSessionState(update.privateState, { nodes: {}, enemies: {}, lootPiles: {} }, ports.store.get().settings));
      for (const player of update.players) {
        const previous = publicPlayers.get(player.id);
        publicPlayers.set(player.id, player);
        let motion = interpolation.get(player.id);
        if (!motion) { motion = new ActorInterpolation(player.position, player.facingRad); interpolation.set(player.id, motion); }
        if (!previous || previous.position.some((value, axis) => value !== player.position[axis]) || previous.facingRad !== player.facingRad) {
          const resuming = previous?.presentation?.pose === "idle" && player.presentation?.pose !== "idle";
          motion.push(player.position, performance.now(), player.facingRad, resuming ? 100 : (update.tick - (motionTicks.get(player.id) ?? update.tick - 1)) * 100);
          motionTicks.set(player.id, update.tick);
        }
        remote.set(player.id, {
        id: `remote:${player.id}`, archetype: "npc", name: player.name, tier: 1, regionId: player.regionId,
        position: player.position, state: player.health <= 0 ? "dead" : "alive", interactions: ["trade", "inspect"],
        meta: { remotePlayer: true, playerLevel: player.level, pose: player.presentation?.pose ?? "idle" },
        view: { assetId: "base_male", partAssetIds: outfit, rotationY: player.facingRad, labelHeight: 2.2, pickable: "context",
          ...(options.equipment?{equipment: { ...player.equipment, ...(player.presentation?.toolItemId ? { mainHand: player.presentation.toolItemId } : {}) }}:{}) },
      }); }
      for (const id of update.removedPlayers) { remote.delete(id); interpolation.delete(id); publicPlayers.delete(id); motionTicks.delete(id); }
      social?.update(update.social, ports.store.get().player.id);
      for (const entity of update.entities) { entities.set(entity.id, entity); replicatedEntities.upsert(entity); }
      for (const id of update.removedEntities) { entities.delete(id); replicatedEntities.remove(id); }
      const visible=visibleRemotePlayers(remote.values(),ports.store.get().player.position);
      const nextVisible = new Set(visible.map(entity => entity.id.slice("remote:".length)));
      for (const id of visibleIds) if (!nextVisible.has(id)) ports.entities.remove(`remote:${id}`);
      visibleIds=visible.map(entity=>entity.id.slice("remote:".length));
      const simplified = simplifyCrowds ? crowdDetail.select(visible, ports.store.get().player.position) : new Set<string>();
      for (const entity of visible) {
        const drawn = structuredClone(entity);
        // Structural sync writes the drawn transform immediately. Keep it on the same
        // presentation timeline as animation frames instead of jumping to the server pose.
        const motion = interpolation.get(entity.id.slice("remote:".length));
        if (motion) {
          const now = performance.now();
          drawn.position = motion.sample(now);
          if (drawn.view) drawn.view.rotationY = motion.facing(now);
        }
        if (drawn.view) drawn.view.crowd = simplified.has(entity.id);
        upsertReplicatedEntity(ports.entities, drawn);
      }
      ports.views.sync(replicatedEntities.renderSnapshot(ports.store.get().player.regionId));
      for (const id of visibleIds) {
        const presentation = publicPlayers.get(id)?.presentation;
        if (presentation) ports.views.setLocomotion(`remote:${id}`, presentation.pose);
      }
      ports.clock.elapsedMs = update.simMs; ports.clock.tick = update.tick;
      const traversal=replicatedTraversal(ports.store.get(),id=>ports.entities.get(id),update.simMs);
      if(traversal) {
        if(traversing)ports.traversal?.update(traversal);else ports.traversal?.begin(traversal);
      } else if(traversing) {
        const stopped=update.events?.slice().reverse().find(e=>e.type==="activity.stopped");
        ports.traversal?.end(String(stopped?.data.reason??"completed"),ports.store.get().player.position);
      }
      traversing=traversal!==null;
      prediction.reconcile(ports.store.get(),performance.now(),update.simMs,update.acknowledgedCommand);
      for (const event of update.events ?? []) ports.events.emit(event.type, event.data, event.entityId, event.atMs);
      for (const action of update.actions ?? []) {
        ports.loop.handleWorldAction(action, performance.now());
        actionHistory.push({ sequence: action.sequence, type: action.type, playerId: action.playerId, receivedAt: performance.timeOrigin + performance.now() });
      }
      if (actionHistory.length > 128) actionHistory.splice(0, actionHistory.length - 128);
      ports.events.flush(); ports.applied?.(update);
    },
  });
  // The boot path marks the selector ready once the first frame is drawn; a selector created here
  // has a live engine already.
  if(!selection)selector.setReady();
  if(ports.mountWorlds)ports.mountWorlds(selector.panel);
  else {selector.panel.classList.add("worlds--fixture");document.body.append(selector.panel);}
  const gather = document.createElement("button"); gather.textContent = "Mine copper"; gather.type = "button";
  gather.addEventListener("click", () => { void selector.command({ method: "interact", args: ["multiplayer:ore", "mine"] }); });
  if(options.fixture)selector.panel.append(gather);
  if (options.fixture) {
    const { multiplayerActionControls } = await import("../featureLab/multiplayerControls.js");
    multiplayerActionControls(selector.panel, command => { void selector.command(command); });
  }
  if(options.fixture){
    const attack=document.createElement("button");attack.type="button";attack.textContent="Attack fixture frog";
    attack.addEventListener("click",()=>{void selector.command({method:"attack",args:["multiplayer:frog"]});});selector.panel.append(attack);
    const loot=document.createElement("button");loot.type="button";loot.textContent="Open combat loot";
    loot.addEventListener("click",()=>{const pile=ports.entities.all().find(entity=>entity.archetype==="loot"&&entity.id.startsWith("loot_"));
      if(pile)void selector.command({method:"interact",args:[pile.id,"loot"]});});selector.panel.append(loot);
  }
  if(options.fixture)for(const [label,id]of [["Open fixture loot","multiplayer:loot"],["Open recovery cache",`recovery:`]] as const){
    const button=document.createElement("button");button.type="button";button.textContent=label;
    button.addEventListener("click",()=>{void selector.command({method:"interact",args:[id==="recovery:"?`${id}${ports.store.get().player.id}`:id,"loot"]});});selector.panel.append(button);
  }
  let frame = 0;
  if (options.fixture) {
    const label = document.createElement("label"), toggle = document.createElement("input");
    toggle.type = "checkbox"; toggle.checked = simplifyCrowds;
    toggle.addEventListener("change", () => { simplifyCrowds = toggle.checked; crowdDetail.clear(); });
    label.append(toggle, "Simplify crowds"); selector.panel.append(label);
  }
  const animate = (now: number) => {
    const simNow = (lastUpdate?.simMs??0) + Math.min(100, now - receivedAt);
    ports.loop.setRemotePresentationTime(simNow);
    const traversal = ports.traversal ? ports.traversal.current() : online && lastUpdate
      ? replicatedTraversal(ports.store.get(), id => ports.entities.get(id),simNow) : null;
    ports.loop.setRemoteTraversal(traversal);
    ports.loop.setRemotePose(traversal ?? prediction.sample(now));
    for (const id of visibleIds) {
      const entity = ports.entities.get(`remote:${id}`), motion = interpolation.get(id);
      if (entity && motion) {
        ports.entities.setPosition(entity.id, motion.sample(now));
        if (entity.view) entity.view.rotationY = motion.facing(now);
        const presentation = publicPlayers.get(id)?.presentation, t = presentation?.traversal;
        const obstacle = t ? ports.entities.get(t.entityId) : undefined;
        const crossing=t&&obstacle ? sampleTraversal(obstacle,t.entry,t.exit,1-(t.endsAtMs-simNow)/(obstacle.obstacle?.durationMs??3000)) : null;
        const gathering=presentation?.gathering, spot=gathering ? ports.entities.get(gathering.entityId)?.position : undefined;
        const fishing=presentation?.pose==="fish"&&gathering&&spot ? sampleFishing(simNow-gathering.startedAtMs,gathering.nextRollAtMs-simNow,GATHER_TICK_MS) : null;
        ports.views.setRemoteActivity(entity.id,crossing,fishing,spot??null);
        if (fishing && spot && entity.view) entity.view.rotationY=Math.atan2(spot[0]-entity.position[0],spot[2]-entity.position[2]);
      }
    }
    frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);
  window.addEventListener("blur", () => { if (online) steer({ forward: 0, strafe: 0, cameraYaw: 0 }); });
  window.addEventListener("pagehide", () => { cancelAnimationFrame(frame); void selector.controller.leave(); }, { once: true });
  window.__multiplayerLab = { observe: () => ({ phase: selector.panel.dataset.phase ?? "offline", players: [...remote.values()], visiblePlayerIds:[...visibleIds], entities: [...entities.values()],
    presentation: visibleIds.map(id => ({id, equipment:ports.entities.get(`remote:${id}`)?.view?.equipment, materials:ports.views.materialNames(`remote:${id}`), crowd: ports.entities.get(`remote:${id}`)?.view?.crowd === true, motion: ports.views.motionSnapshot(`remote:${id}`), render: ports.views.presentationSnapshot(`remote:${id}`), activity:ports.views.remoteActivitySnapshot(`remote:${id}`)})),
    projectiles:ports.loop.remoteProjectileState(), social: social?.observe(), skills: ports.store.get().skills,
    actions: [...actionHistory], activity: ports.store.get().activity, bank: ports.store.get().bank, combat: ports.store.get().combat,
    dialogue: ports.store.get().dialogue, currency: ports.store.get().currency,
    player: ports.store.get().player, inventory: ports.store.get().inventory, tick: lastUpdate?.tick ?? null, sessionId:lastUpdate?.sessionId??null }) };
}
