/**
 * Multiplayer chat and party presentation.
 *
 * Chat has no window of its own. Incoming lines go into the HUD message log beside quest updates
 * and level-ups, and a one-line chat bar sits under that log. The gear on the bar hides channels
 * and creates or leaves a party. The party is a section of the pinned-quest card: name, combat
 * level and health for each member, with a + that lists online players to invite.
 *
 * Right-clicking another player offers an invite and a whisper. Every write goes through
 * `GameApi.submit`, so the authority decides and a rejection lands in the log as a warning.
 */
import {
  LOCAL_CHAT_MAX_LENGTH, MAX_PARTY_PLAYERS,
  type ChatMessage, type CommandOutcome, type GameApi, type GameCommand, type OnlinePlayer, type PartyView,
  type SemanticEntity, type SocialView,
} from "../contracts.js";
import { keybindings, type Unregister } from "../input/keyboard.js";
import { ContextMenu, notify, setEntityMenuEntries, type ContextMenuItem } from "./contextMenu.js";
import { createUiIcon } from "./icons.js";
import { activeMessageLog, MESSAGE_CHANNELS, type MessageLine } from "./messageLog.js";
import { parseChatInput, type ChatTarget } from "./chatCommands.js";
import { addTrackerSection } from "./questTracker.js";
import "./styles/social.css";

type SocialApi = Pick<GameApi, "inspect" | "getSkills"> & { submit(command: GameCommand): Promise<CommandOutcome> };

const empty = (): SocialView => ({ party: null, invitations: [], messages: [] });
const REMOTE_PREFIX = "remote:";

/**
 * Born hidden, because the tracker reads `hidden` the moment the section is registered: a section
 * that starts visible leaves an empty two-pixel card on screen until the next forced repaint.
 */
function partySection(): HTMLElement {
  const section = document.createElement("div");
  section.className = "party";
  section.hidden = true;
  section.setAttribute("aria-label", "Party");
  return section;
}

export class MultiplayerSocial {
  private readonly bar = document.createElement("form");
  private readonly channelButton = document.createElement("button");
  private readonly input = document.createElement("input");
  private readonly gear = document.createElement("button");
  private readonly section = partySection();
  private readonly tracker = addTrackerSection(this.section);
  private readonly menu: ContextMenu;
  private state = empty();
  private playerId = "";
  private online = false;
  private target: ChatTarget = { channel: "nearby" };
  private replyTo: string | null = null;
  private sending = false;
  private readonly seenMessages = new Set<number>();
  private readonly seenInvitations = new Set<string>();
  /** Member names from the last update, for join and leave lines. Undefined until the first update. */
  private members: Map<string, string> | null | undefined;
  private sectionJson = "";
  private readonly memberRows = new Map<string, { row: HTMLElement; status: HTMLElement; bar: HTMLElement; fill: HTMLElement }>();
  private unbindEnter: Unregister | null = null;

  constructor(private readonly api: SocialApi) {
    this.menu = new ContextMenu({ api: api as GameApi });

    this.bar.className = "chatbar";
    this.bar.hidden = true;
    this.bar.setAttribute("aria-label", "Chat");
    this.bar.addEventListener("pointerdown", event => event.stopPropagation());

    this.channelButton.type = "button";
    this.channelButton.className = "chatbar__channel";
    this.channelButton.addEventListener("click", () => { this.cycleChannel(); this.input.focus(); });

    this.input.type = "text";
    this.input.className = "chatbar__input";
    this.input.maxLength = LOCAL_CHAT_MAX_LENGTH;
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", "Chat message");
    this.input.addEventListener("focus", () => { activeMessageLog()?.setExpanded(true); this.paintTarget(); });
    this.input.addEventListener("blur", () => { activeMessageLog()?.setExpanded(false); this.paintTarget(); });
    this.input.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.input.blur();
    });

    this.gear.type = "button";
    this.gear.className = "chatbar__gear";
    this.gear.setAttribute("aria-label", "Chat settings");
    this.gear.append(createUiIcon("gear"));
    this.gear.addEventListener("click", () => this.openChatMenu());

    this.bar.append(this.channelButton, this.input, this.gear);
    this.bar.addEventListener("submit", event => { event.preventDefault(); void this.send(); });
    this.dock();

    this.paintTarget();
  }

  /** The bar belongs at the top of the chat block. Before the HUD exists, it waits in the root. */
  private dock(): void {
    const log = activeMessageLog();
    if (log) log.adoptChatBar(this.bar);
    else (document.getElementById("ui-root") ?? document.body).append(this.bar);
  }

  connected(connected: boolean): void {
    this.dock();
    this.online = connected;
    this.bar.hidden = !connected;
    document.getElementById("ui-root")?.classList.toggle("has-chatbar", connected);
    if (connected && !this.unbindEnter) {
      this.unbindEnter = keybindings.register({
        id: "chat.open", keys: ["enter"], label: "Chat", group: "Social",
        onDown: () => { this.input.focus(); return true; },
      });
      setEntityMenuEntries(entity => this.playerEntries(entity));
    }
    if (!connected) {
      this.unbindEnter?.();
      this.unbindEnter = null;
      setEntityMenuEntries(null);
      this.menu.close();
      this.input.blur();
      this.renderSection();
    }
  }

  clear(): void {
    this.state = empty();
    this.input.value = "";
    this.target = { channel: "nearby" };
    this.replyTo = null;
    this.seenMessages.clear();
    this.seenInvitations.clear();
    this.members = undefined;
    this.sectionJson = "";
    this.paintTarget();
    this.renderSection();
  }

  observe(): SocialView { return structuredClone(this.state); }

  update(state: SocialView | undefined, playerId: string): void {
    this.playerId = playerId;
    if (!state) return;
    this.state = state;
    for (const message of state.messages) {
      if (this.seenMessages.has(message.id)) continue;
      this.seenMessages.add(message.id);
      this.postMessage(message);
    }
    if (this.seenMessages.size > 4 * state.messages.length + 64) {
      this.seenMessages.clear();
      for (const message of state.messages) this.seenMessages.add(message.id);
    }
    for (const invitation of state.invitations) {
      if (this.seenInvitations.has(invitation.partyId)) continue;
      this.seenInvitations.add(invitation.partyId);
      this.log({ channel: "party", tone: "success", text: `${invitation.leaderName} invited you to a party. Join from the tracker.` });
    }
    for (const partyId of this.seenInvitations) {
      if (!state.invitations.some(invitation => invitation.partyId === partyId)) this.seenInvitations.delete(partyId);
    }
    this.announceMembership(state.party);
    if (this.target.channel === "party" && !state.party) this.setTarget({ channel: "nearby" });
    this.renderSection();
  }

  // ------------------------------------------------------------------ chat

  private log(line: MessageLine): void {
    activeMessageLog()?.push(line);
  }

  private postMessage(message: ChatMessage): void {
    if (message.channel === "whisper") {
      const outgoing = message.playerId === this.playerId;
      if (!outgoing) this.replyTo = message.name;
      this.log({ channel: "whisper", tone: "info", text: message.text,
        speaker: outgoing ? `To ${message.toName ?? "?"}` : `${message.name} whispers` });
      return;
    }
    this.log({ channel: message.channel, tone: "info", text: message.text,
      speaker: message.channel === "party" ? `[Party] ${message.name}` : message.name });
  }

  private announceMembership(party: PartyView | null): void {
    const next = party ? new Map(party.members.map(member => [member.id, member.name])) : null;
    const previous = this.members;
    this.members = next;
    if (previous === undefined) return;
    if (!previous && next) {
      this.log({ channel: "party", tone: "success", text: next.size === 1 ? "You created a party." : "You joined the party." });
      return;
    }
    if (previous && !next) {
      this.log({ channel: "party", tone: "info", text: "You are no longer in a party." });
      return;
    }
    if (!previous || !next) return;
    for (const [id, name] of next) if (!previous.has(id)) this.log({ channel: "party", tone: "success", text: `${name} joined the party.` });
    for (const [id, name] of previous) if (!next.has(id)) this.log({ channel: "party", tone: "info", text: `${name} left the party.` });
  }

  private async send(): Promise<void> {
    const raw = this.input.value;
    if (!raw.trim()) { this.input.blur(); return; }
    if (this.sending) return;
    const parsed = parseChatInput(raw, this.target, this.replyTo);
    if ("error" in parsed) { notify(parsed.error, "error"); return; }
    this.setTarget(parsed.target);
    if (!parsed.text) { this.input.value = ""; return; }
    const command: GameCommand = parsed.target.channel === "whisper"
      ? { method: "chat", args: [parsed.text, "whisper", parsed.target.name] }
      : { method: "chat", args: [parsed.text, parsed.target.channel] };
    this.sending = true;
    try {
      if (await this.submit(command) !== null && this.input.value === raw) {
        this.input.value = "";
        this.input.blur();
      }
    } finally {
      this.sending = false;
    }
  }

  private setTarget(target: ChatTarget): void {
    this.target = target;
    this.paintTarget();
  }

  /** Say, then Party when in one, then the last whisper partner, then back to Say. */
  private cycleChannel(): void {
    const order: ChatTarget[] = [{ channel: "nearby" }];
    if (this.state.party) order.push({ channel: "party" });
    const whisper = this.target.channel === "whisper" ? this.target.name : this.replyTo;
    if (whisper) order.push({ channel: "whisper", name: whisper });
    const index = order.findIndex(target => target.channel === this.target.channel);
    this.setTarget(order[(index + 1) % order.length]!);
  }

  private paintTarget(): void {
    const target = this.target;
    this.channelButton.dataset["channel"] = target.channel;
    this.channelButton.textContent = target.channel === "nearby" ? "Say" : target.channel === "party" ? "Party" : `To ${target.name}`;
    this.channelButton.setAttribute("aria-label", `Chat channel: ${this.channelButton.textContent}. Click to change.`);
    this.input.placeholder = document.activeElement !== this.input ? "Press Enter to chat"
      : target.channel === "nearby" ? "Players within 30 m hear you"
        : target.channel === "party" ? "Message your party" : `Whisper ${target.name}`;
  }

  private openChatMenu(): void {
    const log = activeMessageLog();
    const items: ContextMenuItem[] = [this.state.party
      ? { id: "party-leave", label: "Leave party", enabled: true, danger: true, onSelect: () => void this.party("leave") }
      : { id: "party-create", label: "Create party", enabled: true, onSelect: () => void this.party("create") }];
    for (const channel of MESSAGE_CHANNELS) {
      const shown = log?.isShown(channel.id) ?? true;
      items.push({
        id: `show-${channel.id}`, label: channel.label, hint: shown ? "Shown" : "Hidden", enabled: log !== null,
        onSelect: () => { log?.setShown(channel.id, !shown); this.openChatMenu(); },
      });
    }
    const rect = this.gear.getBoundingClientRect();
    this.menu.open(rect.left, rect.top, items, { title: "Chat", subtitle: "Click a channel to hide it" });
  }

  // ----------------------------------------------------------------- party

  /** Resolves to the accepted result, or null after reporting the rejection in the log. */
  private async submit(command: GameCommand): Promise<unknown | null> {
    try {
      const outcome = await this.api.submit(command);
      if (outcome.status === "accepted") return outcome.result ?? {};
      notify(outcome.error.message, "error");
    } catch {
      notify("Connection lost. Reconnect to continue.", "error");
    }
    return null;
  }

  private party(operation: "create" | "leave" | "disband"): Promise<unknown | null> {
    return this.submit({ method: "party", args: [operation] });
  }

  /** Creates a party first when there is none, so one right-click is enough to start grouping. */
  private async invite(playerId: string, name: string): Promise<void> {
    if (!this.state.party && await this.party("create") === null) return;
    if (await this.submit({ method: "party", args: ["invite", playerId] }) !== null) {
      this.log({ channel: "party", tone: "success", text: `Invited ${name} to the party.` });
    }
  }

  private whisper(name: string): void {
    this.setTarget({ channel: "whisper", name });
    this.input.focus();
  }

  private inviteBlocker(playerId: string): string | null {
    const party = this.state.party;
    if (!party) return null;
    if (party.members.some(member => member.id === playerId)) return "Already in your party";
    if (party.leaderId !== this.playerId) return "Only the leader can invite";
    if (party.members.length >= MAX_PARTY_PLAYERS) return "Party is full";
    return null;
  }

  private playerEntries(entity: SemanticEntity): ContextMenuItem[] {
    if (!this.online || entity.meta?.remotePlayer !== true || !entity.id.startsWith(REMOTE_PREFIX)) return [];
    const playerId = entity.id.slice(REMOTE_PREFIX.length);
    const blocker = this.inviteBlocker(playerId);
    return [
      { id: "party-invite", label: `Invite ${entity.name} to party`, enabled: blocker === null,
        ...(blocker ? { reason: blocker } : {}), onSelect: () => void this.invite(playerId, entity.name) },
      { id: "whisper", label: `Whisper ${entity.name}`, enabled: true, onSelect: () => this.whisper(entity.name) },
    ];
  }

  private async openRoster(anchor: HTMLElement): Promise<void> {
    const result = await this.submit({ method: "who", args: [] }) as { players?: OnlinePlayer[] } | null;
    if (!result) return;
    const members = new Set(this.state.party?.members.map(member => member.id));
    const players = (result.players ?? []).filter(player => !members.has(player.id));
    const items: ContextMenuItem[] = players.map(player => ({
      id: `invite-${player.id}`, label: player.name, hint: `Lvl ${player.level}`, enabled: true,
      onSelect: () => void this.invite(player.id, player.name),
    }));
    if (!items.length) items.push({ id: "none", label: "No other players online", enabled: false });
    const rect = anchor.getBoundingClientRect();
    this.menu.open(rect.right, rect.top, items, { title: "Invite", subtitle: `${players.length} online` });
  }

  private memberEntries(member: PartyView["members"][number], party: PartyView): ContextMenuItem[] {
    const leader = party.leaderId === this.playerId;
    if (member.id === this.playerId) {
      return [
        { id: "party-leave", label: "Leave party", enabled: true, danger: true, onSelect: () => void this.party("leave") },
        ...(leader ? [{ id: "party-disband", label: "Disband party", enabled: true, danger: true, onSelect: () => void this.party("disband") }] : []),
      ];
    }
    return [
      { id: "whisper", label: `Whisper ${member.name}`, enabled: true, onSelect: () => this.whisper(member.name) },
      ...(leader ? [{ id: "party-kick", label: `Remove ${member.name}`, enabled: true, danger: true,
        onSelect: () => void this.submit({ method: "party", args: ["kick", member.id] }) }] : []),
    ];
  }

  private renderSection(): void {
    const party = this.online ? this.state.party : null;
    const invitations = this.online ? this.state.invitations : [];
    // Health and range change every tick in a fight; they repaint in place so a click on + or
    // Join never lands on a row that was just replaced.
    const json = JSON.stringify([party && [party.id, party.leaderId, party.members.map(member => [member.id, member.name, member.level])],
      invitations.map(invitation => [invitation.partyId, invitation.leaderName]), this.playerId]);
    if (json === this.sectionJson) { this.paintMembers(party); return; }
    this.sectionJson = json;
    this.memberRows.clear();

    const rows: HTMLElement[] = [];
    if (party) {
      const head = document.createElement("div");
      head.className = "party__head";
      const caption = document.createElement("span");
      caption.className = "party__caption";
      caption.textContent = "Party";
      const count = document.createElement("span");
      count.className = "quest-tracker__stage u-numeric";
      count.textContent = `${party.members.length}/${MAX_PARTY_PLAYERS}`;
      head.append(caption, count);
      if (party.leaderId === this.playerId && party.members.length < MAX_PARTY_PLAYERS) {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "quest-tracker__btn party__add";
        add.textContent = "+";
        add.setAttribute("aria-label", "Invite online players");
        add.addEventListener("click", () => void this.openRoster(add));
        head.append(add);
      }
      rows.push(head);
      for (const member of party.members) rows.push(this.memberRow(member, party));
      this.paintMembers(party);
    }
    if (!party && invitations.length) {
      const head = document.createElement("div");
      head.className = "party__head";
      const caption = document.createElement("span");
      caption.className = "party__caption";
      caption.textContent = invitations.length === 1 ? "Party invite" : "Party invites";
      head.append(caption);
      rows.push(head);
    }
    for (const invitation of invitations) {
      const row = document.createElement("div");
      row.className = "party__invite";
      const label = document.createElement("span");
      label.className = "party__invite-label u-truncate";
      label.textContent = `${invitation.leaderName}'s party`;
      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "party__invite-join";
      accept.textContent = "Join";
      accept.setAttribute("aria-label", `Join ${invitation.leaderName}'s party`);
      accept.addEventListener("click", () => void this.submit({ method: "party", args: ["accept", invitation.partyId] }));
      const decline = document.createElement("button");
      decline.type = "button";
      decline.className = "quest-tracker__btn";
      decline.textContent = "×";
      decline.setAttribute("aria-label", `Decline ${invitation.leaderName}'s invitation`);
      decline.addEventListener("click", () => void this.submit({ method: "party", args: ["decline", invitation.partyId] }));
      row.append(label, accept, decline);
      rows.push(row);
    }
    this.section.replaceChildren(...rows);
    const hidden = rows.length === 0;
    if (this.section.hidden !== hidden) {
      this.section.hidden = hidden;
      this.tracker.refresh();
    }
  }

  private memberRow(member: PartyView["members"][number], party: PartyView): HTMLElement {
    const row = document.createElement("div");
    row.className = "party-member";
    row.dataset["playerId"] = member.id;
    row.classList.toggle("is-self", member.id === this.playerId);

    const head = document.createElement("div");
    head.className = "party-member__head";
    const name = document.createElement("span");
    name.className = "party-member__name u-truncate";
    name.textContent = member.name;
    if (member.id === party.leaderId) {
      const crown = document.createElement("span");
      crown.className = "party-member__leader";
      crown.textContent = "♛";
      crown.setAttribute("aria-label", "Leader");
      name.prepend(crown);
    }
    const status = document.createElement("span");
    status.className = "party-member__status";
    const level = document.createElement("span");
    level.className = "quest-tracker__stage u-numeric";
    level.textContent = `Lvl ${member.level}`;
    head.append(name, status, level);

    const bar = document.createElement("div");
    bar.className = "bar bar--thin party-member__health";
    bar.setAttribute("role", "meter");
    bar.setAttribute("aria-label", `${member.name} health`);
    const fill = document.createElement("div");
    fill.className = "bar__fill";
    bar.append(fill);

    row.append(head, bar);
    row.addEventListener("contextmenu", event => {
      event.preventDefault();
      event.stopPropagation();
      const current = this.state.party;
      const latest = current?.members.find(entry => entry.id === member.id);
      if (!current || !latest) return;
      this.menu.open(event.clientX, event.clientY, this.memberEntries(latest, current), { title: latest.name, subtitle: `Level ${latest.level}` });
    });
    this.memberRows.set(member.id, { row, status, bar, fill });
    return row;
  }

  private paintMembers(party: PartyView | null): void {
    for (const member of party?.members ?? []) {
      const parts = this.memberRows.get(member.id);
      if (!parts) continue;
      const self = member.id === this.playerId;
      const health = Math.max(0, Math.round(member.health)), maxHealth = Math.round(member.maxHealth);
      const ratio = member.maxHealth > 0 ? Math.max(0, Math.min(1, member.health / member.maxHealth)) : 0;
      parts.row.classList.toggle("is-away", !member.connected || (!member.nearby && !self));
      parts.row.title = member.connected ? `${health} / ${maxHealth} health${member.nearby || self ? "" : " · far away"}` : "Reconnecting";
      parts.status.textContent = !member.connected ? "offline" : member.health <= 0 ? "down" : "";
      parts.bar.setAttribute("aria-valuenow", String(health));
      parts.bar.setAttribute("aria-valuemax", String(maxHealth));
      parts.bar.style.setProperty("--bar-colour", ratio > 0.6 ? "#6b9c52" : ratio > 0.3 ? "#c9a227" : "#c9553d");
      parts.fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    }
  }
}
