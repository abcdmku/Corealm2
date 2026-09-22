import type { GameCommand, SessionError, WorldConfiguration, WorldDescriptor, WorldProvider, SessionPhase } from "../contracts.js";
import { discoverWorlds, record, SessionFailure, compatible, worldKey } from "./protocol.js";
import { ProviderRegistry, SessionController, type SessionControllerPorts } from "./providers.js";
import { WebSocketProvider } from "./webSocketProvider.js";
import { type DirectoryServer, type IdentityClient } from "./identityClient.js";
import { lastPlayChoice, playTargetText, rememberPlayChoice, type PlayTarget } from "./playIntent.js";

const HOSTS_KEY="corealm.hosts.v1";
const MAX_HOSTS=20;

/** Whether this page can sign a player in, and whether one is signed in now. */
export interface AccountAccess { configured:boolean; signedIn:boolean }

/** Why an account world cannot be joined yet, or null when nothing about the account stops it. */
export function accountBlocker(world:WorldDescriptor, access:AccountAccess):string|null{
  if(world.authentication!=="account")return null;
  if(!access.configured)return "Login unavailable";
  if(!access.signedIn)return "Sign in to join";
  return null;
}

/**
 * What a refused join says. The three codes a player can act on get an answer that names the
 * action; everything else keeps what the server said.
 */
export function joinFailureMessage(failure:SessionError):string{
  switch(failure.code){
    // Only the server knows the reason and the expiry, so its sentence stands. What the client adds
    // is the one thing the player can still do about it.
    case "BANNED":return `${failure.message.replace(/[.\s]+$/,"")}. Local play and other servers still work.`;
    case "DUPLICATE_LOGIN":return "That account is already playing on this server. Leave the other session, then join again.";
    case "UNAUTHORIZED":return "This server refused your sign-in. Sign in again, then join.";
    case "FULL":return "This world is full. Choose another world or try again.";
    default:return failure.message;
  }
}

/** Hosts the player added, kept as directory URLs. A client preference, like the tracker's pin. */
export function savedHosts():string[]{
  try{const raw:unknown=JSON.parse(localStorage.getItem(HOSTS_KEY)??"[]");
    return Array.isArray(raw)?raw.filter((value):value is string=>typeof value==="string").slice(0,MAX_HOSTS):[];}
  catch{return [];}
}
function storeHosts(hosts:readonly string[]):void{
  try{localStorage.setItem(HOSTS_KEY,JSON.stringify(hosts));}catch{/* Private mode: the host still works this session. */}
}

/**
 * Turns what a player types into a directory URL: "host", "host:port", a ws:// endpoint or a full
 * URL. The scheme defaults to http for loopback and https elsewhere, which is what `endpoint`
 * accepts; a bare host gets the reference host's `/worlds` directory path.
 */
export function hostDirectoryUrl(input:string):string|null{
  const text=input.trim();if(!text||text.length>2048)return null;
  const bare=text.replace(/^[a-z]+:\/\//i,"");
  const local=/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(bare);
  const scheme=/^wss:\/\//i.test(text)?"https://":/^ws:\/\//i.test(text)?"http://"
    :/^[a-z]+:\/\//i.test(text)?null:local?"http://":"https://";
  let url:URL;
  try{url=new URL(scheme===null?text:`${scheme}${bare}`);}catch{return null;}
  if(url.protocol!=="http:"&&url.protocol!=="https:")return null;
  if(url.pathname==="/"||!url.pathname)url.pathname="/worlds";
  url.search="";url.hash="";
  return url.href;
}

/** The short form shown in the list and in failures: "127.0.0.1:4180". */
export function hostLabel(url:string):string{
  try{const parsed=new URL(url);return parsed.pathname==="/worlds"?parsed.host:`${parsed.host}${parsed.pathname}`;}catch{return url;}
}

/** A base game version as the picker prints it: `v0.1.0`. Nothing for a server too old to say. */
export function baseVersionLabel(version:string|undefined):string|null{
  return version?`v${version}`:null;
}

/**
 * The world list as the picker draws it, with each base version placed once per server. A server is
 * the worlds that share an endpoint. One world: its version sits on its row. Several worlds that
 * agree: a heading names the host once, with the version, above their rows. Several that disagree,
 * which a server should never do: each row carries its own. A server that reports none gets neither.
 */
export type WorldListEntry={kind:"server";host:string;version:string}|{kind:"world";world:WorldDescriptor;version:string|null};
export function worldListLayout(worlds:readonly WorldDescriptor[]):WorldListEntry[]{
  const servers=new Map<string,WorldDescriptor[]>();
  for(const world of worlds){const group=servers.get(world.endpoint);if(group)group.push(world);else servers.set(world.endpoint,[world]);}
  const entries:WorldListEntry[]=[];
  for(const [endpoint,group] of servers){
    const versions=new Set(group.map(world=>world.baseVersion));
    const shared=versions.size===1?baseVersionLabel(group[0]!.baseVersion):null;
    if(group.length>1&&shared)entries.push({kind:"server",host:(()=>{try{return new URL(endpoint).host;}catch{return endpoint;}})(),version:shared});
    for(const world of group)entries.push({kind:"world",world,version:group.length>1&&versions.size===1?null:baseVersionLabel(world.baseVersion)});
  }
  return entries;
}

/** What the picker needs from the page it opened over, beyond discovery and the session. */
export interface WorldSelectorOptions {
  ready?:boolean;
  identity?:IdentityClient|null;
  identityError?:string|null;
  /**
   * A target from `?play=`. `local` dismisses the picker before it is ever mounted; a world is
   * joined the moment the engine is ready. An unknown or unreachable target falls back to the
   * picker with a line saying why. Nothing else auto-joins — a remembered choice only moves focus.
   */
  play?:PlayTarget|null;
  /**
   * Joining this world needs the page to reload onto its asset host first. Returns true when it
   * took the join over, which means a reload is already under way and nothing else should happen.
   */
  rebase?:(world:WorldDescriptor)=>boolean;
  /**
   * Local play as a world: the descriptor of the page's own worker-hosted world, whose provider is
   * among `providers`. With it, "Play local" joins that world through the session controller like
   * any other row. Without it the page has no local world, and the row says so instead of offering one.
   */
  local?:WorldDescriptor;
  /** Something the player should know about how the local world started, such as a seed this build does not hold. */
  localNotice?:()=>string|null;
}

export async function createWorldSelector(configuration: WorldConfiguration|undefined, ports: SessionControllerPorts,
  authenticate: (world: WorldDescriptor, signal?: AbortSignal) => Promise<{ token: string }>, providers:readonly WorldProvider[]=[],
  options:WorldSelectorOptions={} ) {
  const identity=options.identity??null;
  const play=options.play??null;
  const localWorld=options.local??null;
  const playingLocal=():boolean=>{const current=controller.session?.world;return localWorld!==null&&!!current&&worldKey(current)===worldKey(localWorld);};
  // A `?play=local` page never sees the picker, so it never pays for discovery before its first
  // frame either: the list fills in the background, for the menu the player may open later.
  const autoLocal=play?.kind==="local";
  // Set when a server rejected the join token: the way out is another sign-in, so offer one even
  // though this browser still holds a session.
  let retrySignIn=false;
  const panel=document.createElement("section");panel.id="multiplayer-selector";panel.className="worlds";
  panel.setAttribute("aria-label","Multiplayer worlds");panel.dataset.phase="offline";
  const header=document.createElement("div");header.className="worlds__header";
  const title=document.createElement("h2");title.textContent="Play";
  const refresh=document.createElement("button");refresh.type="button";refresh.className="btn";refresh.textContent="Refresh worlds";
  header.append(title,refresh);
  const intro=document.createElement("p");intro.className="worlds__intro";
  intro.textContent="Play on your own, or join a world. Online characters are separate from your single-player save.";
  const list=document.createElement("div");list.className="worlds__list";list.setAttribute("aria-label","Available worlds");
  const hostForm=document.createElement("form");hostForm.className="worlds__host";
  const hostInput=document.createElement("input");hostInput.type="text";hostInput.className="worlds__host-input";
  hostInput.setAttribute("aria-label","Host address");hostInput.placeholder="host:port or https://host/worlds";
  hostInput.autocomplete="off";hostInput.maxLength=2048;
  const hostAdd=document.createElement("button");hostAdd.type="submit";hostAdd.className="btn";hostAdd.textContent="Add host";
  hostForm.append(hostInput,hostAdd);
  const hostList=document.createElement("ul");hostList.className="worlds__hosts";hostList.hidden=true;
  hostList.setAttribute("aria-label","Added hosts");
  // Silent until it has something to say: an idle line here only repeated the row badge and the button.
  const status=document.createElement("p");status.role="status";status.tabIndex=-1;status.className="worlds__status";
  const actions=document.createElement("div");actions.className="worlds__actions";
  const commit=document.createElement("button");commit.type="button";commit.className="btn btn--primary";commit.textContent="Play local";
  // Sign-in sits under the intro because it decides which worlds in the list below can be joined.
  const account=document.createElement("div");account.className="worlds__account";account.hidden=true;
  const accountNote=document.createElement("p");accountNote.className="worlds__account-note";
  const accountActions=document.createElement("div");accountActions.className="worlds__account-actions";
  // The password is typed on the identity service's own page, so this is one button that leaves.
  const signIn=document.createElement("button");signIn.type="button";signIn.className="btn worlds__sign-in";
  signIn.textContent="Sign in";
  signIn.addEventListener("click",()=>{retrySignIn=false;identity?.login();});
  const password=document.createElement("button");password.type="button";password.className="worlds__account-link";password.textContent="Change password";
  password.addEventListener("click",()=>{identity?.changePassword();});
  const rename=document.createElement("button");rename.type="button";rename.className="worlds__account-link";rename.textContent="Rename";
  const signOut=document.createElement("button");signOut.type="button";signOut.className="worlds__account-link";signOut.textContent="Sign out";
  const renameForm=document.createElement("form");renameForm.className="worlds__rename";renameForm.hidden=true;
  const renameInput=document.createElement("input");renameInput.type="text";renameInput.className="worlds__host-input";
  renameInput.setAttribute("aria-label","Display name");renameInput.maxLength=24;renameInput.autocomplete="off";
  const renameSave=document.createElement("button");renameSave.type="submit";renameSave.className="btn";renameSave.textContent="Save name";
  renameForm.append(renameInput,renameSave);
  account.append(accountNote,accountActions,renameForm);
  actions.append(commit);panel.append(header,intro,account,list,hostForm,hostList,status,actions);
  const registry=new ProviderRegistry(),registered=new Set<string>();
  for(const provider of providers){registry.register(provider);registered.add(provider.id);}
  // Local play is the first choice, not the absence of one: the panel opens over the loading screen
  // and a player who wants their own character should be able to say so and move on.
  const LOCAL="local";
  const keyOf=(target:PlayTarget):string=>target.kind==="world"?worldKey(target):LOCAL;
  // The row focus starts on, and the row that is already ticked. A remembered world that this page
  // can no longer see falls back to local rather than leaving nothing chosen.
  const remembered=keyOf(lastPlayChoice());
  let worlds:WorldDescriptor[]=[],selected=remembered===LOCAL?LOCAL:remembered,phase:SessionPhase="offline",loading=false;
  // Set once, when the picker is first painted: the player's own choice moves focus after that.
  let focusPending=!autoLocal;
  let hosts=savedHosts();
  // Joining waits for the engine when the selector opens over the loading screen. A player who
  // chooses early gets their world the moment the game is ready, without clicking again.
  let ready=options.ready!==false,pendingJoin=false;
  // The public directory is fetched once and kept: it names servers, and each one's worlds still
  // come from its own `/worlds`. A directory that does not answer leaves the configured hosts alone.
  let directory:DirectoryServer[]|null=null;
  const access=():AccountAccess=>({configured:identity!==null,signedIn:(identity?.account()??null)!==null});
  const unavailable=(world:WorldDescriptor):string|null=>{
    try{compatible(world);ports.validate?.(world);}catch{return "Incompatible version";}
    const blocked=accountBlocker(world,access());
    if(blocked)return blocked;
    if(world.availability==="unavailable")return "Unavailable";
    if(world.availability==="full"||world.population>=world.capacity)return "Full";
    return null;
  };
  /** What the one button does for the current choice and connection. */
  const primary=():{label:string;disabled:boolean;action:"join"|"leave"|"none"}=>{
    if(["connecting","reconnecting"].includes(phase))return {label:"Cancel connection",disabled:false,action:"leave"};
    if(phase==="leaving")return {label:"Leaving world",disabled:true,action:"none"};
    if(selected===LOCAL&&localWorld){
      if(playingLocal())return {label:"Playing local",disabled:true,action:"none"};
      return pendingJoin?{label:"Starting when ready",disabled:true,action:"none"}:{label:"Play local",disabled:false,action:"join"};
    }
    if(selected===LOCAL)return phase==="offline"
      ?{label:"Play local",disabled:true,action:"none"}
      :{label:"Leave world",disabled:false,action:"leave"};
    const world=worlds.find(w=>worldKey(w)===selected);
    const current=controller.session?.world;
    if(!world)return {label:"Join world",disabled:true,action:"none"};
    if(current?.providerId===world.providerId&&current.worldId===world.worldId)return {label:"Connected",disabled:true,action:"none"};
    if(unavailable(world))return {label:"Join world",disabled:true,action:"none"};
    if(pendingJoin)return {label:"Joining when ready",disabled:true,action:"none"};
    return {label:ready?"Join world":"Join when ready",disabled:loading,action:"join"};
  };
  const updateButtons=()=>{
    const focused=document.activeElement;
    const state=primary();
    commit.disabled=state.disabled;commit.textContent=state.label;
    refresh.disabled=loading;
    if(focused instanceof HTMLButtonElement&&panel.contains(focused)&&focused.disabled)status.focus({preventScroll:true});
  };
  const versionTag=(text:string):HTMLElement=>{const tag=document.createElement("span");tag.className="worlds__version";tag.textContent=text;return tag;};
  const renderList=()=>{
    list.replaceChildren();
    const local=document.createElement("label");local.className="worlds__row worlds__row--local";
    const localChoice=document.createElement("input");localChoice.type="radio";localChoice.name="corealm-world";localChoice.value=LOCAL;
    localChoice.checked=selected===LOCAL;localChoice.setAttribute("aria-label","Play local");
    localChoice.addEventListener("change",()=>{selected=LOCAL;updateButtons();});
    const localDetail=document.createElement("span");localDetail.className="worlds__detail";
    const localName=document.createElement("strong");localName.textContent="Play local";
    // The base game this build carries, the same way a server's row says which base its content comes from.
    const localVersion=baseVersionLabel(localWorld?.baseVersion);
    if(localVersion)localName.append(" ",versionTag(localVersion));
    const localNote=document.createElement("small");localNote.textContent=localWorld?"Your single-player character, on this device.":"Local play is unavailable: this page could not read its world files.";
    localDetail.append(localName,localNote);
    const localBadge=document.createElement("span");localBadge.className="worlds__badge";
    localBadge.textContent=!localWorld?"Unavailable":playingLocal()?"Playing now":"Not connected";
    local.append(localChoice,localDetail,localBadge);list.append(local);
    for(const entry of worldListLayout(worlds)){
      if(entry.kind==="server"){
        const heading=document.createElement("div");heading.className="worlds__server";
        const host=document.createElement("span");host.textContent=entry.host;
        heading.append(host," ",versionTag(entry.version));list.append(heading);continue;
      }
      const world=entry.world;
      const label=document.createElement("label");label.className="worlds__row worlds__row--world";
      const radio=document.createElement("input");radio.type="radio";radio.name="corealm-world";radio.value=worldKey(world);radio.checked=radio.value===selected;
      const detail=document.createElement("span");detail.className="worlds__detail";
      const name=document.createElement("strong");name.textContent=world.name;
      if(entry.version)name.append(" ",versionTag(entry.version));
      const population=document.createElement("small");population.textContent=`${world.population.toLocaleString()} / ${world.capacity.toLocaleString()} players`;
      detail.append(name,population);
      const badge=document.createElement("span");badge.className="worlds__badge";
      const reason=unavailable(world);badge.textContent=reason??"Available";if(reason)badge.dataset.unavailable="true";
      radio.setAttribute("aria-label",world.name);
      radio.addEventListener("change",()=>{selected=radio.value;updateButtons();});
      label.append(radio,detail,badge);list.append(label);
    }
    if(!worlds.length){const empty=document.createElement("p");empty.className="worlds__empty";empty.textContent="No worlds found. Add a host below, or play on your own.";list.append(empty);}
    renderAccount();updateButtons();
    focusChoice();
  };
  /**
   * Focus lands on what this browser played last, so Enter repeats it.
   *
   * Once, and only once the panel is on the page: the list is painted before boot mounts it, and
   * focusing a detached input does nothing. It also stands aside for a player who is already typing
   * a host address or a character name somewhere else in the panel.
   */
  const focusChoice=()=>{
    if(!focusPending||!panel.isConnected||panel.contains(document.activeElement))return;
    const row=list.querySelector<HTMLInputElement>(`input[type=radio][value="${CSS.escape(selected)}"]`);
    if(!row)return;
    focusPending=false;row.focus({preventScroll:true});
  };
  /**
   * Enter on a focused row plays it. The rows are radios inside a list, so the browser's own Enter
   * has nothing to submit; without this a keyboard player has to tab past every world to the button.
   */
  list.addEventListener("keydown",event=>{
    if(event.key!=="Enter")return;
    const row=event.target;
    if(!(row instanceof HTMLInputElement)||row.type!=="radio")return;
    event.preventDefault();
    if(!row.checked){row.checked=true;selected=row.value;updateButtons();}
    runPrimary();
  });
  const renderAccount=()=>{
    const who=identity?.account()??null;
    // Only worth showing when it changes what the player can do: a world needs an account, or one
    // is signed in and may want to rename or sign out.
    account.hidden=who===null&&!worlds.some(world=>world.authentication==="account");
    if(account.hidden)return;
    accountActions.replaceChildren();
    if(!identity){
      accountNote.textContent=options.identityError??"This page cannot sign players in, so worlds that need an account are closed.";
      renameForm.hidden=true;return;
    }
    if(who&&!retrySignIn){
      accountNote.textContent=`Signed in as ${who.name}.`;
      accountActions.append(rename,password,signOut);
    }else{
      accountNote.textContent=who?joinFailureMessage({code:"UNAUTHORIZED",message:""})
        :identity.loginFailure()??"Some of these worlds need a Corealm account.";
      accountActions.append(signIn);
      renameForm.hidden=true;
    }
  };
  const renderHosts=()=>{
    hostList.replaceChildren(...hosts.map(host=>{
      const row=document.createElement("li");row.className="worlds__host-row";
      const label=document.createElement("span");label.textContent=hostLabel(host);
      const remove=document.createElement("button");remove.type="button";remove.className="worlds__host-remove";remove.textContent="×";
      remove.setAttribute("aria-label",`Remove host ${hostLabel(host)}`);
      remove.addEventListener("click",()=>{hosts=hosts.filter(entry=>entry!==host);storeHosts(hosts);renderHosts();void reload();});
      row.append(label,remove);return row;}));
    hostList.hidden=!hosts.length;
  };
  const controller=new SessionController(registry,{...ports,phase(next,message,failure){
    phase=next;panel.dataset.phase=next;
    const current=controller.session?.world;
    const name=worlds.find(w=>current&&worldKey(w)===worldKey(current))?.name;
    if(next==="offline")selected=LOCAL;
    else if(next==="connected"&&current)selected=playingLocal()?LOCAL:worldKey(current);
    for(const radio of list.querySelectorAll<HTMLInputElement>("input[type=radio]"))radio.checked=radio.value===selected;
    // A refused join says which refusal it was: another session holds this account, the token was
    // rejected, or the world is full. Each one has a different next move for the player.
    if(failure?.code==="UNAUTHORIZED")retrySignIn=true;
    if(next==="connected")retrySignIn=false;
    status.textContent=failure?joinFailureMessage(failure):message??(next==="connected"&&playingLocal()?options.localNotice?.()??"Playing on your own. Open the menu to join a world later."
      :next==="connecting"&&selected===LOCAL&&localWorld?"Starting your world…":null)??({offline:"",connecting:"Joining world…",connected:`Connected${name?` to ${name}`:""}`,reconnecting:"Connection lost. Reconnecting…",leaving:"Returning to single-player…",full:"This world is full. Choose another world or try again.",incompatible:"This world needs a different game version.",unavailable:"World unavailable. Refresh the list or try again."}[next]);
    renderAccount();updateButtons();panel.dispatchEvent(new Event("worldsessionchange"));ports.phase(next,message,failure);
  }});
  let discovery:AbortController|null=null;
  const reload=async()=>{
    discovery?.abort();const request=new AbortController();discovery=request;loading=true;updateButtons();
    list.setAttribute("aria-busy","true");
    const timeout=setTimeout(()=>request.abort(),10000);
    try{
      if(identity&&directory===null){
        // Quiet on failure: a directory this page cannot reach is not the player's problem, and
        // their own hosts still load.
        try{directory=await identity.servers(request.signal);}catch{directory=null;}
        if(discovery!==request)return;
      }
      const configured=record(configuration)&&typeof configuration.directoryUrl==="string"?configuration.directoryUrl:null;
      const listed=(directory??[]).map(server=>({name:server.name,url:hostDirectoryUrl(server.endpoint)}))
        .filter((entry):entry is {name:string;url:string}=>entry.url!==null&&entry.url!==configured&&!hosts.includes(entry.url));
      // The configured directory, every added host and every public server are asked in parallel.
      // One unreachable host reports itself without hiding the worlds the others returned.
      const sources=[{label:null as string|null,listed:false,configuration},
        ...hosts.map(host=>({label:hostLabel(host),listed:false,configuration:{directoryUrl:host} as WorldConfiguration})),
        ...listed.map(entry=>({label:entry.name,listed:true,configuration:{directoryUrl:entry.url} as WorldConfiguration}))];
      const results=await Promise.all(sources.map(async source=>{
        try{return {source,found:await discoverWorlds(source.configuration,request.signal)};}
        catch(error){return {source,found:[] as WorldDescriptor[],
          failure:error instanceof SessionFailure?error.message:"Could not load worlds. Check your connection and refresh."};}}));
      if(discovery!==request)return;
      const merged=new Map<string,WorldDescriptor>();
      for(const result of results)for(const world of result.found)if(!merged.has(worldKey(world)))merged.set(worldKey(world),world);
      worlds=[...merged.values()];
      for(const id of new Set(worlds.map(w=>w.providerId)))if(!registered.has(id)){
        registry.register(new WebSocketProvider(id,worlds.filter(w=>w.providerId===id),authenticate));registered.add(id);
      }
      if(selected!==LOCAL&&!worlds.some(w=>worldKey(w)===selected)){
        const current=controller.session?.world;
        selected=current&&worlds.some(w=>worldKey(w)===worldKey(current))?worldKey(current):LOCAL;
      }
      // A public server that is down is the directory's news, not this player's: only the page's
      // own configuration and the hosts they typed take over the status line.
      const failed=results.find(result=>result.failure&&!result.source.listed);
      if(failed)status.textContent=`${failed.source.label?`${failed.source.label}: `:""}${failed.failure}`;
      else if(phase==="offline")status.textContent="";
    }catch(error){
      if(discovery!==request)return;
      worlds=[];status.textContent=error instanceof SessionFailure?error.message:"Could not load worlds. Check your connection and refresh.";
    }finally{clearTimeout(timeout);if(discovery===request){loading=false;list.removeAttribute("aria-busy");renderList();}}
  };
  /** The one place a choice is committed, so the memory and the telemetry mark cannot drift apart. */
  const chose=(target:PlayTarget)=>{
    rememberPlayChoice(target);
    panel.dispatchEvent(new CustomEvent("worldschosen",{detail:{play:playTargetText(target)}}));
  };
  const joinSelected=()=>{
    if(selected===LOCAL&&localWorld){void controller.join(localWorld);return;}
    const world=worlds.find(w=>worldKey(w)===selected);
    if(!world)return;
    chose({kind:"world",providerId:world.providerId,worldId:world.worldId});
    // A world on another asset host cannot be joined by this page: everything already loaded came
    // from the page's own origin. The caller writes the choice down and reloads.
    if(options.rebase?.(world)===true){status.textContent=`Loading ${world.name} from its own asset host…`;updateButtons();return;}
    void controller.join(world);
  };
  /** Local play chosen: step out of the way. Over the loading screen that means hiding the panel. */
  const dismiss=()=>{
    pendingJoin=false;
    status.textContent="Playing on your own. Open the menu to join a world later.";
    panel.dispatchEvent(new Event("worldsdismiss"));
    if(panel.classList.contains("worlds--boot"))panel.hidden=true;
    updateButtons();
  };
  const runPrimary=()=>{
    const state=primary();
    if(state.disabled)return;
    if(state.action==="leave"){pendingJoin=false;void controller.leave();return;}
    if(state.action!=="join")return;
    // The local world is a join like any other, but choosing it still means "get out of my way".
    if(selected===LOCAL&&localWorld){chose({kind:"local"});dismiss();}
    if(!ready&&selected===LOCAL&&localWorld){pendingJoin=true;updateButtons();return;}
    if(!ready){pendingJoin=true;status.textContent="Joining as soon as the game finishes loading.";updateButtons();return;}
    joinSelected();
  };
  refresh.addEventListener("click",()=>{directory=null;void reload();});
  commit.addEventListener("click",runPrimary);
  hostForm.addEventListener("submit",event=>{
    event.preventDefault();
    const url=hostDirectoryUrl(hostInput.value);
    if(!url){status.textContent="Enter a host address such as 127.0.0.1:4180.";return;}
    if(hosts.includes(url)){status.textContent=`${hostLabel(url)} is already listed.`;hostInput.value="";return;}
    if(hosts.length>=MAX_HOSTS){status.textContent="Remove a host before adding another.";return;}
    hosts=[...hosts,url];storeHosts(hosts);hostInput.value="";renderHosts();void reload();
  });
  rename.addEventListener("click",()=>{
    renameForm.hidden=!renameForm.hidden;
    if(renameForm.hidden)return;
    renameInput.value=identity?.account()?.name??"";renameInput.focus();
  });
  renameForm.addEventListener("submit",event=>{
    event.preventDefault();
    const next=renameInput.value.trim();
    if(!identity||!next)return;
    renameSave.disabled=true;
    void identity.rename(next).then(account=>{status.textContent=`You are now ${account.name}.`;renameForm.hidden=true;},
      error=>{status.textContent=error instanceof Error?error.message:"That name could not be saved.";})
      .finally(()=>{renameSave.disabled=false;});
  });
  signOut.addEventListener("click",()=>{
    retrySignIn=false;renameForm.hidden=true;
    void identity?.logout().then(()=>{status.textContent="Signed out. Guest worlds and local play still work.";});
  });
  const unsubscribeIdentity=identity?.subscribe(()=>{renderList();})??null;
  window.addEventListener("pagehide",()=>{discovery?.abort();unsubscribeIdentity?.();},{once:true});
  renderHosts();
  // A stored session may have been revoked since this browser last used it; a 401 signs out here
  // rather than at the first join. The result repaints through the subscription above.
  if(identity?.account())void identity.refresh();
  // `?play=local` answers before discovery, so the picker never delays a harness or a returning
  // player who already knows what they want. Everything else waits for the list it is choosing from.
  if(autoLocal){renderList();void reload();}else await reload();
  /**
   * A `?play=<host>/<world>` target, resolved against what discovery actually found.
   *
   * Only this and the primary action ever join. A target that does not exist, or that this page
   * cannot reach, leaves the picker open with the reason on the status line rather than dropping
   * the player into a world they did not ask for.
   */
  const autoWorld=(():WorldDescriptor|null=>{
    if(play?.kind!=="world")return null;
    const found=worlds.find(world=>world.providerId===play.providerId&&world.worldId===play.worldId);
    if(!found){status.textContent=`No world called ${play.providerId}/${play.worldId} answered. Choose one below.`;return null;}
    const reason=unavailable(found);
    if(reason){status.textContent=`${found.name} is not available right now (${reason.toLowerCase()}). Choose another world.`;return null;}
    selected=worldKey(found);focusPending=true;renderList();
    return found;
  })();
  // `?play=local` with a worker-hosted world: the answer is already given, so it joins when the engine is ready.
  if(autoLocal&&localWorld){selected=LOCAL;if(ready)joinSelected();else{pendingJoin=true;updateButtons();}}
  if(play?.kind==="invalid")status.textContent="That play link does not name a world. Choose one below.";
  if(autoWorld&&ready)joinSelected();
  else if(autoWorld){pendingJoin=true;status.textContent=`Joining ${autoWorld.name} as soon as the game finishes loading.`;updateButtons();}
  return {panel,controller,
    /** True when `?play=local` answered for the player, so the picker must never be mounted. */
    autoLocal,
    /** The panel is on the page: put focus on the row this browser played last, so Enter repeats it. */
    mounted(){focusChoice();},
    /** The engine is live: enable joining, and honour a choice made during loading. */
    setReady(){if(ready)return;ready=true;const queued=pendingJoin;pendingJoin=false;updateButtons();if(queued)joinSelected();},
    /**
     * Local play without being asked: the page finished loading, nobody answered the picker, and there is no
     * server on it to choose instead, so the page's own world starts.
     * Nothing is remembered as a choice. False when there is no worker-hosted world or a join is already under way.
     */
    playLocal():boolean{
      if(!localWorld||controller.session||pendingJoin)return false;
      selected=LOCAL;dismiss();
      if(ready)joinSelected();else{pendingJoin=true;updateButtons();}
      return true;
    },
    /** Repaints availability after late ports arrive with the scene's seed check. */
    refresh(){renderList();},
    async command(command:GameCommand){
    const session=controller.session;if(!session){status.textContent="Join a world first";return;}
    try{const result=await session.command(command);if(controller.session===session)status.textContent=result.status==="accepted"?"Accepted by world":result.error.message;return result;}
    catch(error){if(controller.session===session)status.textContent=error instanceof Error?error.message:"World command failed";}
  }};
}
