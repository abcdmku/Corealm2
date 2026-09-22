import type { WorldConfiguration, WorldUpdate, SemanticEntity, WorldDescriptor, SessionCredentials, WorldProvider, SessionPhase, RemotePlayer } from "../contracts.js";
import { content } from "../content/index.js";
import { createServerCatalogOverlay } from "./clientCatalogFetch.js";
import type { Store } from "../state/store.js";
import { composeSessionState } from "../state/store.js";
import type { GameLoop } from "../app/loop.js";
import type { SimClock } from "../core/time.js";
import type { EntityStore } from "../world/entities.js";
import type { EntityViews } from "../render/entityViews.js";
import type { AssetRegistry } from "../render/assets.js";
import { SessionFailure } from "./protocol.js";
import { foreignAssetHost, identityUrl } from "../app/config.js";
import { IdentityClient } from "./identityClient.js";
import { createWorldSelector, savedHosts } from "../multiplayer/worldSelector.js";
import { canStorePendingLaunch, joinRoute, storePendingLaunch, type PendingLaunch, type PlayTarget } from "./playIntent.js";
import type { SessionControllerPorts } from "./providers.js";
import type { LocalLaunch } from "./localLaunch.js";
import { npcOutfitParts } from "../render/characterAppearances.js";
import { ActorInterpolation } from "../multiplayer/interpolation.js";
import {MovementPrediction} from "./movementPrediction.js";
import {visibleRemotePlayers} from "./visiblePlayers.js";
import {CrowdDetail} from "./crowdDetail.js";
import {ReplicatedEntityLayer,isStaticScenery,upsertReplicatedEntity} from "./replicatedEntities.js";
import type { CorealmGameApi } from "../api/gameApi.js";
import type { EventBus } from "../core/events.js";
import type { Movement, DirectInput } from "../systems/movement.js";
import { replicatedTraversal } from "./traversal.js";
import { sampleTraversal } from "../systems/traversalMotion.js";
import type { TraversalPresentation } from "../render/traversalPresentation.js";
import { sampleFishing } from "../render/fishingPose.js";
import { GATHER_TICK_MS } from "../core/time.js";
import { MultiplayerSocial } from "../ui/multiplayerSocial.js";
import { ContentNotice, SessionNotice } from "../ui/contentNotice.js";

/** World selection that outlives the loading screen: built early, wired to the engine later. */
export type WorldSelection = Awaited<ReturnType<typeof createWorldSelector>> & {
  attach(ports: SessionControllerPorts): void;
  /** Whether this page had any world to offer: a configuration, a saved host or an identity service. */
  configured: boolean;
  /** "Play local": a world hosted in a worker on this page. Null on a page that offers none (the multiplayer lab). */
  local: LocalLaunch | null;
};

declare global {
  interface Window {
    __COREALM_MULTIPLAYER__?: WorldConfiguration;
    __COREALM_DEVELOPMENT_GUESTS__?: boolean;
    __COREALM_AUTHENTICATE__?: (world:WorldDescriptor) => Promise<SessionCredentials>;
    __COREALM_PROVIDERS__?: WorldProvider[];
    __multiplayerLab?: { observe(): unknown };
    /** Worker-hosted local play, for harnesses: the worker's start report and the state of the join. */
    __corealmLocalWorker?: { observe(): unknown; command(command: import("../contracts.js").GameCommand): Promise<unknown> };
  }
}

export interface BrowserSessionPorts {
  mountWorlds?(panel:HTMLElement):void;
  store: Store; loop: GameLoop; clock: SimClock; entities: EntityStore; views: EntityViews; assets: AssetRegistry;
  api: CorealmGameApi; events: EventBus; movement: Movement;
  phase?(phase:SessionPhase):void;
  applied?(update:WorldUpdate):void;
  /** The session ended and the page shows its own scenery again, with nobody in it. */
  restored?():void;
  expectedSeed?:number;
  /**
   * A lab page changes its own static scenery while joined (a new structure). It is handed `recapture`, and calls it with the
   * page's entities after such a change, so the next full snapshot restores the scenery that is there now.
   */
  sceneryChanges?(recapture:(entities:readonly SemanticEntity[])=>void):void;
  traversal?: TraversalPresentation;
}

/**
 * World selection, before the engine exists.
 *
 * Discovery and the player's world choice need none of the gameplay ports, so the panel is built
 * and mounted while the game is still loading. Session ports arrive later through `attach`, and
 * `setReady` opens joining once the engine can apply its snapshot.
 *
 * The picker always exists now, including on a page with no servers at all, because "play local" is
 * a choice a player makes rather than the absence of one. `configured` still reports whether there
 * was anything to join, which is what decides if the menu opens on the worlds view afterwards.
 */
export async function startWorldSelection(options:{fixture?:boolean;play?:PlayTarget|null;launch?:PendingLaunch|null;local?:LocalLaunch|null}={}):Promise<WorldSelection|null> {
  const local = options.local ?? null;
  const configuration = window.__COREALM_MULTIPLAYER__;
  // Who signs this page's players in is a property of the page, never of a world: a game server
  // that could name the identity service could name a lookalike and collect sessions.
  let identity:IdentityClient|null=null,identityError:string|null=null;
  try{const service=identityUrl();if(service)identity=new IdentityClient(service);}
  catch(error){identityError=`Sign-in is unavailable: ${error instanceof Error?error.message:"the identity service address is unusable"}.`;}
  (window as Window&{__corealmIdentity?:IdentityClient|null}).__corealmIdentity=identity;
  const configured = configuration!==undefined||savedHosts().length>0||identity!==null;
  // A reload carried the previous boot's choice here. The asset base was already set from it, so
  // this boot joins that world without asking again; one more foreign answer is refused instead.
  const launch = options.launch ?? null;
  const play = launch ? {kind:"world",providerId:launch.providerId,worldId:launch.worldId} as const : options.play ?? null;
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
  }, async (world, signal) => {
    if(window.__COREALM_AUTHENTICATE__)return window.__COREALM_AUTHENTICATE__(world);
    if(world.authentication==="account"){
      if(!identity)throw new SessionFailure("UNAUTHORIZED","This page cannot sign in, so it cannot join worlds that need an account");
      // One token per attempt, reconnects included: they last 60 seconds and are single use.
      return {token:await identity.joinToken(world.endpoint,signal)};
    }
    if(developmentGuests)return {token:`guest:${name.value}`};
    throw new SessionFailure("UNAUTHORIZED","This deployment must provide a sign-in adapter");
  }, [...(window.__COREALM_PROVIDERS__ ?? []), ...(local ? [local.provider] : [])], {ready:false,identity,identityError,play,
    ...(local ? {local:local.provider.world,localNotice:local.notice} : {}),
    rebase(world){
      const route=joinRoute({assetHostForeign:foreignAssetHost(world.assetBaseUrl),
        rebaseAttempts:launch?.attempts??0,canStore:canStorePendingLaunch()});
      if(route==="join")return false;
      if(route==="refuse")throw new SessionFailure("INCOMPATIBLE","This world loads its files from another host, and this page could not switch to it.");
      // Everything fetched so far came from this page's own origin, and `app/config.ts` locks the
      // base once a URL is built. Reloading is the only way to start again on the world's host.
      storePendingLaunch({providerId:world.providerId,worldId:world.worldId,
        assetBaseUrl:world.assetBaseUrl!,attempts:(launch?.attempts??0)+1});
      location.reload();
      return true;
    }});
  if(developmentGuests){
    const guest=document.createElement("label");guest.className="worlds__identity";
    guest.append("Guest character",name);
    selector.panel.insertBefore(guest,selector.panel.querySelector(".worlds__host"));
  }
  // Local play was asked for by name, is the only thing this page can start, or is picked while the scene loads: boot its world beside the scene.
  if(local){
    if(play?.kind==="local"||(!configured&&play===null))local.provider.prestart();
    selector.panel.addEventListener("worldschosen",event=>{if((event as CustomEvent<{play:string|null}>).detail?.play==="local")local.provider.prestart();});
  }
  return {...selector, configured, local, attach(ports){attached.ports=ports;selector.refresh();}};
}

/** Shared browser presentation and session lifecycle; simulation remains behind the session boundary. */
export async function installBrowserSession(ports: BrowserSessionPorts, options:{fixture?:boolean;/** A feature-lab session in a lab worker: the lab scene, and no picker on screen. */lab?:boolean;crowds?:boolean;equipment?:boolean}={},
  selection?: WorldSelection|null):Promise<void> {
  // A selection made during loading is adopted; otherwise this is the first thing built.
  const selector = selection ?? await startWorldSelection({fixture:options.fixture===true});
  if (!selector) return;
  const social = new MultiplayerSocial(ports.api);
  const contentNotice = new ContentNotice(); let contentUpdates: (() => void) | null = null;
  // What local play has to say reaches the player in the game, not only on the picker they have already left.
  const localNotice = selector.local ? new SessionNotice() : null; let localNoticeShown: string | null = null;
  const sayLocalNotice = (): void => { const text = selector.local?.notice() ?? null; if (text && text !== localNoticeShown) { localNoticeShown = text; localNotice?.show(text); } };
  if (localNotice) window.addEventListener("corealm:local-storage", sayLocalNotice);
  let offline = ports.store.snapshot(); let offlineEntities = structuredClone(ports.entities.all());
  const replicatedEntities = new ReplicatedEntityLayer(ports.entities, offlineEntities);
  const remote = new Map<string, SemanticEntity>(); const entities = new Map<string, SemanticEntity>();
  ports.sceneryChanges?.(current=>replicatedEntities.capture(structuredClone(current.filter(isStaticScenery))));
  const interpolation = new Map<string, ActorInterpolation>();
  const entityInterpolation = new Map<string, ActorInterpolation>();
  // Leave 40 ms for ordinary packet jitter. If updates stop, actors settle at the last
  // authoritative target instead of extrapolating into walls or past combat targets.
  const motionInterval = (ticks = 1) => ticks * 100 / ports.clock.timeScale + 40;
  // Both structural updates and render frames sample here. Neither writes a drawn pose back
  // into the authoritative entity store, and structural sync cannot undo interpolation.
  ports.views.setMotionSource(id => {
    const motion = id.startsWith("remote:") ? interpolation.get(id.slice(7)) : entityInterpolation.get(id);
    if (!motion) return null;
    const now = performance.now();
    return { position: motion.sample(now), facingRad: motion.facing(now) };
  });
  const publicPlayers = new Map<string, RemotePlayer>();
  const motionTicks = new Map<string, number>();
  const actionHistory: { sequence: number; type: string; playerId: string; receivedAt: number }[] = [];
  let visibleIds:string[]=[];
  const crowdDetail = new CrowdDetail();
  let simplifyCrowds = options.crowds === true;
  const prediction=new MovementPrediction(ports.movement);
  let online = false; let lastUpdate: WorldUpdate | null = null;
  let connected = false;
  let frozenPose: ReturnType<MovementPrediction["sample"]> = null;
  const connectionNotice = new SessionNotice();
  let hadConnection = false;
  // This thread never simulates, joined or not. Between sessions the game simply waits, as it does
  // while a connection is being made.
  const workerLocal = selector.local?.provider ?? null;
  let firstSnapshotAt: number | null = null;
  let receivedAt = 0;
  let traversing = false;
  let lastSteer = -Infinity; let steering = false;
  let lastDirection = [0,0];
  const steer = (input: DirectInput) => {
    if (!connected) return;
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
  // Names, icons, item stats and shop stock follow the joined server's catalog revision, and only while connected.
  const serverCatalog = createServerCatalogOverlay(content, { failed: error => console.warn("[corealm] The server's content catalog could not be loaded; showing this build's names and stats.", error) });
  selector.attach({
    validate(world){
      if(world.fixture!==(options.fixture||options.lab?"lab":"authored"))throw new SessionFailure("INCOMPATIBLE","This world uses a different scene from the loaded game");
      if(ports.expectedSeed!==undefined&&world.seed!==ports.expectedSeed)throw new SessionFailure("INCOMPATIBLE","This world uses a different map seed from the loaded scene");
      // A different asset host is no longer a refusal. Preloading starts from this page's own base
      // before a world is chosen, so the answer is a reload onto the world's host, which the
      // selector's `rebase` port performs before it ever reaches this check.
    },
    clear() {
      social?.clear(); remote.clear(); publicPlayers.clear(); motionTicks.clear();
      actionHistory.length=0; visibleIds=[]; crowdDetail.clear(); entities.clear();
      // Connection teardown invalidates network state, not the last complete scene. Keep its
      // frozen views through authentication, retries and failures. A valid snapshot replaces
      // the semantic set below and reconciles views once; leaving restores the offline set.
    },
    phase(phase, message) {
      if (connected && phase !== "connected") {
        const now = performance.now();
        frozenPose = ports.traversal?.current() ?? prediction.sample(now);
        for (const motion of interpolation.values()) motion.freeze(now);
        for (const motion of entityInterpolation.values()) motion.freeze(now);
      }
      connected = phase === "connected";
      if (connected) { hadConnection = true; frozenPose = null; connectionNotice.clear(); }
      else if (hadConnection && (phase === "reconnecting" || phase === "unavailable" || phase === "full" || phase === "incompatible")) {
        connectionNotice.show(message ?? "Connection lost. Reconnecting…");
      }
      if (phase === "offline") {
        frozenPose = null; lastUpdate = null; interpolation.clear(); entityInterpolation.clear();
        connectionNotice.clear(); hadConnection = false;
      }
      social?.connected(phase === "connected");
      if(phase!=="connected") {ports.traversal?.reset(); traversing=false;}
      if(phase!=="connected")prediction.clear();
      if (!online && phase === "connecting") {
        offline = ports.store.snapshot(); offlineEntities = structuredClone(ports.entities.all());
        replicatedEntities.capture(offlineEntities);
      }
      ports.phase?.(phase);
      online = phase !== "offline";
      ports.loop.sessionChanged();
      ports.movement.setDirectInputSink(online ? steer : null); steering = false;
      lastSteer = -Infinity; lastDirection = [0, 0];
      const session=phase === "connected" ? selector.controller.session : null;
      // A publish on the server offers a refresh and nothing more. Play carries on with the catalog this session joined with.
      contentUpdates?.(); contentUpdates = session?.subscribeContent?.(() => contentNotice.show()) ?? null;
      if (phase === "offline") contentNotice.clear();
      if (phase === "connected" && session?.world?.providerId === workerLocal?.id) sayLocalNotice(); else if (phase !== "connected") localNotice?.clear();
      if (session?.catalog) void serverCatalog.enter(session.catalog); else if (phase === "offline") serverCatalog.leave();
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
      } : null);
    },
    async offline() {
      ports.store.replace(structuredClone(offline)); ports.entities.load(structuredClone(offlineEntities));
      ports.views.sync(ports.entities.all()); ports.clock.elapsedMs = offline.meta.playSeconds * 1000; ports.restored?.();
    },
    apply(update) {
      lastUpdate = update;
      receivedAt = performance.now();
      if (update.snapshot) firstSnapshotAt ??= receivedAt;
      if (update.snapshot) { remote.clear(); interpolation.clear(); entityInterpolation.clear(); publicPlayers.clear(); motionTicks.clear(); entities.clear(); replicatedEntities.reset(); }
      if (update.privateState) ports.store.replace(composeSessionState(update.privateState, { nodes: {}, enemies: {}, lootPiles: {} }, ports.store.get().settings));
      for (const player of update.players) {
        const previous = publicPlayers.get(player.id);
        publicPlayers.set(player.id, player);
        let motion = interpolation.get(player.id);
        if (!motion) { motion = new ActorInterpolation(player.position, player.facingRad); interpolation.set(player.id, motion); }
        if (!previous || previous.position.some((value, axis) => value !== player.position[axis]) || previous.facingRad !== player.facingRad) {
          const resuming = previous?.presentation?.pose === "idle" && player.presentation?.pose !== "idle";
          if (previous && (previous.regionId !== player.regionId || previous.health <= 0 && player.health > 0)) {
            motion.reset(player.position, player.facingRad, receivedAt);
          } else {
            const ticks = resuming ? 1 : Math.min(5, update.tick - (motionTicks.get(player.id) ?? update.tick - 1));
            motion.push(player.position, receivedAt, player.facingRad, motionInterval(ticks));
          }
          motionTicks.set(player.id, update.tick);
        }
        remote.set(player.id, {
        id: `remote:${player.id}`, archetype: "npc", name: player.name, tier: 1, regionId: player.regionId,
        position: player.position, state: player.health <= 0 ? "dead" : "alive", interactions: ["inspect"],
        meta: { remotePlayer: true, playerLevel: player.level, pose: player.presentation?.pose ?? "idle" },
        view: { assetId: "base_male", partAssetIds: outfit, rotationY: player.facingRad, labelHeight: 2.2, pickable: "context",
          ...(options.equipment?{equipment: { ...player.equipment, ...(player.presentation?.toolItemId ? { mainHand: player.presentation.toolItemId } : {}) }}:{}) },
      }); }
      for (const id of update.removedPlayers) { remote.delete(id); interpolation.delete(id); publicPlayers.delete(id); motionTicks.delete(id); }
      social?.update(update.social, ports.store.get().player.id);
      for (const entity of update.entities) {
        const previous = entities.get(entity.id);
        if (entity.view && ["enemy", "boss", "npc"].includes(entity.archetype)) {
          let motion = entityInterpolation.get(entity.id);
          const facing = entity.view.rotationY ?? 0;
          if (!motion) { motion = new ActorInterpolation(entity.position, facing); entityInterpolation.set(entity.id, motion); }
          else if (previous && (previous.regionId !== entity.regionId || (previous.state === "dead") !== (entity.state === "dead") || previous.view?.assetId !== entity.view.assetId)) {
            motion.reset(entity.position, facing, receivedAt);
          } else motion.push(entity.position, receivedAt, facing, motionInterval());
        } else entityInterpolation.delete(entity.id);
        entities.set(entity.id, entity); replicatedEntities.upsert(entity);
      }
      for (const id of update.removedEntities) { entities.delete(id); entityInterpolation.delete(id); replicatedEntities.remove(id); }
      const visible=visibleRemotePlayers(remote.values(),ports.store.get().player.position);
      const nextVisible = new Set(visible.map(entity => entity.id.slice("remote:".length)));
      for (const id of visibleIds) if (!nextVisible.has(id)) ports.entities.remove(`remote:${id}`);
      visibleIds=visible.map(entity=>entity.id.slice("remote:".length));
      const simplified = simplifyCrowds ? crowdDetail.select(visible, ports.store.get().player.position) : new Set<string>();
      for (const entity of visible) {
        const drawn = structuredClone(entity);
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
      prediction.reconcile(ports.store.get(),performance.now(),update.simMs,update.acknowledgedCommand,update.snapshot ? frozenPose : null);
      for (const event of update.events ?? []) ports.events.emit(event.type, event.data, event.entityId, event.atMs);
      for (const action of update.actions ?? []) {
        ports.loop.handleWorldAction(action, performance.now());
        actionHistory.push({ sequence: action.sequence, type: action.type, playerId: action.playerId, receivedAt: performance.timeOrigin + performance.now() });
      }
      if (actionHistory.length > 128) actionHistory.splice(0, actionHistory.length - 128);
      ports.events.flush(); ports.applied?.(update);
    },
  });
  // Boot enables joining once its engine ports are installed. A selector created here
  // already has those ports.
  if(!selection)selector.setReady();
  if(options.lab){selector.panel.hidden=true;document.body.append(selector.panel);}
  else if(ports.mountWorlds)ports.mountWorlds(selector.panel);
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
    // Debug time control moves the host's pace, and the page's clock mirrors it: presentation time stands still while paused and runs at the scale.
    const simNow = (lastUpdate?.simMs??0) + (!connected || ports.clock.paused ? 0 : Math.max(0, Math.min(100, (now - receivedAt) * ports.clock.timeScale)));
    prediction.setPace(ports.clock.paused, ports.clock.timeScale);
    ports.loop.setRemotePresentationTime(simNow);
    const traversal = !connected ? null : ports.traversal ? ports.traversal.current() : lastUpdate
      ? replicatedTraversal(ports.store.get(), id => ports.entities.get(id),simNow) : null;
    ports.loop.setRemoteTraversal(traversal);
    ports.loop.setRemotePose(connected ? traversal ?? prediction.sample(now) : frozenPose);
    for (const id of visibleIds) {
      const entity = ports.entities.get(`remote:${id}`), motion = interpolation.get(id);
      if (entity && motion) {
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
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") steer({ forward: 0, strafe: 0, cameraYaw: 0 });
  });
  if (workerLocal) {
    // The worker's store writes behind, and a worker hears neither of these. Hidden is the last moment a phone reliably gives.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") workerLocal.flush(); });
    window.addEventListener("pagehide", () => workerLocal.flush());
    // `command` is the UI's own entry point, `api.submit`: through prediction, over the session, to the worker.
    window.__corealmLocalWorker = { command: command => ports.api.submit(command), observe: () => ({ ...workerLocal.observe(), world: workerLocal.world, notice: selector.local?.notice() ?? null,
      phase: selector.panel.dataset.phase ?? "offline",
      status: selector.panel.querySelector(".worlds__status")?.textContent ?? "", firstSnapshotAtMs: firstSnapshotAt, tick: lastUpdate?.tick ?? null }) };
  }
  window.addEventListener("pagehide", () => { cancelAnimationFrame(frame); void selector.controller.leave(); }, { once: true });
  window.__multiplayerLab = { observe: () => ({ phase: selector.panel.dataset.phase ?? "offline", players: [...remote.values()], visiblePlayerIds:[...visibleIds], entities: [...entities.values()],
    presentation: visibleIds.map(id => ({id, equipment:ports.entities.get(`remote:${id}`)?.view?.equipment, materials:ports.views.materialNames(`remote:${id}`), crowd: ports.entities.get(`remote:${id}`)?.view?.crowd === true, motion: ports.views.motionSnapshot(`remote:${id}`), render: ports.views.presentationSnapshot(`remote:${id}`), activity:ports.views.remoteActivitySnapshot(`remote:${id}`)})),
    projectiles:ports.loop.remoteProjectileState(), social: social?.observe(), skills: ports.store.get().skills,
    actions: [...actionHistory], activity: ports.store.get().activity, bank: ports.store.get().bank, combat: ports.store.get().combat,
    dialogue: ports.store.get().dialogue, currency: ports.store.get().currency,
    player: ports.store.get().player, inventory: ports.store.get().inventory, tick: lastUpdate?.tick ?? null, sessionId:lastUpdate?.sessionId??null }) };
}
