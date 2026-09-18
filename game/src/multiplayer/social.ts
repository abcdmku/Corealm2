import { LOCAL_CHAT_MAX_LENGTH, LOCAL_CHAT_RADIUS, MAX_PARTY_PLAYERS, PARTY_REWARD_RADIUS, PARTY_SHARED_XP_RATE, WHO_LIMIT,
  err, ok, type ChatChannel, type ChatMessage, type LootStack, type OnlinePlayer, type PartyOperation, type PartyRecord, type Result, type SemanticEntity, type SkillId, type SocialView } from "../contracts.js";
import { content } from "../content/index.js";
import { distanceXZ } from "../core/math.js";
import { addSkillXp } from "../state/store.js";
import { sameCombatRealm } from "../systems/combat.js";
import type { HeadlessWorld } from "./headlessWorld.js";

const INVITE_MS = 60_000;
const RECONNECT_MS = 30_000;
const HISTORY_LIMIT = 80;

/** All routing and membership decisions run on the authority, before serialization. */
export class WorldSocial {
  private readonly parties = new Map<string, PartyRecord>();
  private readonly membership = new Map<string, string>();
  private readonly invitations = new Map<string, Map<string, number>>();
  private readonly messages = new Map<string, ChatMessage[]>();
  private readonly lastChat = new Map<string, number>();
  private readonly disconnected = new Map<string, number>();
  private serial = 0;
  constructor(private readonly world: HeadlessWorld, saved: PartyRecord[] = []) {
    for (const party of structuredClone(saved)) {
      this.parties.set(party.id, party);
      for (const member of party.members) {
        this.membership.set(member.id, party.id);
        this.disconnected.set(member.id, world.clock.elapsedMs);
      }
    }
  }
  private party(id: string): PartyRecord | undefined { return this.parties.get(this.membership.get(id) ?? ""); }
  private nearby(a: string, b: string, radius: number): boolean {
    const first = this.world.players.get(a)?.store.get().player, second = this.world.players.get(b)?.store.get().player;
    return !!first && !!second && this.world.active.has(a) && this.world.active.has(b)
      && sameCombatRealm(first.regionId, second.regionId) && distanceXZ(first.position, second.position) <= radius;
  }
  join(id: string): void { this.disconnected.delete(id); }
  disconnect(id: string): void {
    this.disconnected.set(id, this.world.clock.elapsedMs);
    this.invitations.delete(id);
  }
  tick(): void {
    const now = this.world.clock.elapsedMs;
    for (const [id, at] of this.disconnected) if (now - at >= RECONNECT_MS) {
      this.remove(id); this.disconnected.delete(id); this.messages.delete(id); this.lastChat.delete(id);
    }
    for (const [id, invites] of this.invitations) {
      for (const [partyId, expires] of invites) if (expires <= now || !this.parties.has(partyId)) invites.delete(partyId);
      if (!invites.size) this.invitations.delete(id);
    }
  }
  private name(id: string): string { return this.world.players.get(id)!.store.get().player.name; }
  private level(id: string): number { return this.world.players.get(id)!.api.getPlayer().combatLevelEstimate; }
  /** An exact player ID wins; otherwise a case-insensitive name, so `/w name` needs no lookup first. */
  private findActive(target: string): string | undefined {
    if (this.world.active.has(target)) return target;
    const wanted = target.trim().toLowerCase();
    for (const id of this.world.active) if (this.name(id).toLowerCase() === wanted) return id;
    return undefined;
  }
  chat(id: string, raw: string, channel: ChatChannel = "nearby", target?: string): Result<unknown> {
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (!text || raw.length > LOCAL_CHAT_MAX_LENGTH) return err("INVALID_ARGUMENT", "Enter a message of 1 to 280 characters.");
    const now = this.world.clock.elapsedMs;
    if (now - (this.lastChat.get(id) ?? -Infinity) < 1000) return err("UNAVAILABLE", "Wait a second before sending another message.");
    const message: ChatMessage = { id: 0, channel, playerId: id, name: this.name(id), text, atMs: now };
    let recipients: string[];
    if (channel === "party") {
      const party = this.party(id);
      if (!party) return err("UNAVAILABLE", "You are not in a party.");
      recipients = party.members.map(member => member.id).filter(member => this.world.active.has(member));
    } else if (channel === "whisper") {
      const to = target === undefined ? undefined : this.findActive(target);
      if (!to) return err("UNAVAILABLE", "That player is not online.");
      if (to === id) return err("INVALID_ARGUMENT", "Choose another player to whisper.");
      message.toId = to; message.toName = this.name(to);
      recipients = [id, to];
    } else {
      recipients = [...this.world.active].filter(recipient => this.nearby(id, recipient, LOCAL_CHAT_RADIUS));
    }
    this.lastChat.set(id, now);
    message.id = ++this.serial;
    for (const recipient of recipients) {
      const history = this.messages.get(recipient) ?? [];
      history.push(message); if (history.length > HISTORY_LIMIT) history.shift();
      this.messages.set(recipient, history);
    }
    return ok({ sent: true });
  }
  /** Connected players in name order, capped so a crowded world cannot inflate one reply. */
  who(id: string): Result<{ players: OnlinePlayer[] }> {
    const players = [...this.world.active].filter(other => other !== id)
      .map(other => ({ id: other, name: this.name(other), level: this.level(other) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, WHO_LIMIT);
    return ok({ players });
  }
  command(id: string, operation: PartyOperation, target?: string): Result<unknown> {
    this.tick();
    const party = this.party(id);
    if (operation === "create") {
      if (party) return err("UNAVAILABLE", "You are already in a party.");
      let partyId: string;
      do { partyId = `party:${this.world.clock.tick}:${++this.serial}`; } while (this.parties.has(partyId));
      this.parties.set(partyId, { id: partyId, leaderId: id, nextLootId: id,
        members: [{ id, name: this.name(id) }] });
      this.membership.set(id, partyId); this.invitations.delete(id);
      return ok({ partyId });
    }
    if (operation === "accept" || operation === "decline") {
      const invites = this.invitations.get(id), expires = invites?.get(target ?? "");
      if (!expires) return err("UNAVAILABLE", "This invitation has expired.");
      if (operation === "decline") { invites!.delete(target!); return ok({ declined: true }); }
      if (party) return err("UNAVAILABLE", "Leave your current party first.");
      const invited = this.parties.get(target!)!;
      if (invited.members.length >= MAX_PARTY_PLAYERS) return err("UNAVAILABLE", "This party already has eight players.");
      invited.members.push({ id, name: this.name(id) });
      this.membership.set(id, invited.id); this.invitations.delete(id);
      return ok({ partyId: invited.id });
    }
    if (!party) return err("UNAVAILABLE", "Create or join a party first.");
    if (operation === "leave") { this.remove(id); return ok({ left: true }); }
    if (party.leaderId !== id) return err("UNAVAILABLE", "Only the party leader can do that.");
    if (operation === "disband") {
      for (const member of [...party.members]) this.remove(member.id);
      return ok({ disbanded: true });
    }
    if (operation === "kick") {
      if (target === id || !party.members.some(member => member.id === target)) return err("INVALID_ARGUMENT", "Choose another party member.");
      this.remove(target!); return ok({ removed: target });
    }
    if (operation === "invite") {
      if (!target || !this.world.active.has(target)) return err("UNAVAILABLE", "That player is not online.");
      if (target === id || this.membership.has(target)) return err("UNAVAILABLE", "That player is already in a party.");
      if (party.members.length >= MAX_PARTY_PLAYERS) return err("UNAVAILABLE", "Your party already has eight players.");
      const invites = this.invitations.get(target) ?? new Map<string, number>();
      if (invites.has(party.id)) return err("UNAVAILABLE", "That invitation is still pending.");
      if (invites.size >= MAX_PARTY_PLAYERS) return err("UNAVAILABLE", "That player has too many pending invitations.");
      invites.set(party.id, this.world.clock.elapsedMs + INVITE_MS); this.invitations.set(target, invites);
      return ok({ invited: target });
    }
    return err("INVALID_ARGUMENT", "Unknown party action.");
  }
  private remove(id: string): void {
    const party = this.party(id); if (!party) return;
    const index = party.members.findIndex(member => member.id === id);
    const next = party.members[(index + 1) % party.members.length]?.id;
    party.members.splice(index, 1); this.membership.delete(id);
    if (!party.members.length) { this.parties.delete(party.id); return; }
    if (party.leaderId === id) party.leaderId = party.members[0]!.id;
    if (party.nextLootId === id) party.nextLootId = next!;
  }
  private eligible(party: PartyRecord | undefined, enemy: SemanticEntity): string[] {
    if (!party) return [];
    return party.members.flatMap(member => {
      const player = this.world.players.get(member.id)?.store.get().player;
      return player && this.world.active.has(member.id) && player.health > 0
        && sameCombatRealm(player.regionId, enemy.regionId) && distanceXZ(player.position, enemy.position) <= PARTY_REWARD_RADIUS ? [member.id] : [];
    });
  }
  shareKill(killerId: string, enemy: SemanticEntity, skill: SkillId, xp: number, atMs: number): void {
    for (const id of this.eligible(this.party(killerId), enemy)) if (id !== killerId) {
      const player = this.world.players.get(id)!;
      const amount = Math.floor(xp * PARTY_SHARED_XP_RATE);
      const result = addSkillXp(player.store.get(), skill, amount); player.store.markDirty();
      if (result.levelsGained) player.events.emit("level.gained", { skill, level: result.newLevel, levelsGained: result.levelsGained }, undefined, atMs);
    }
  }
  tagLoot(killerId: string, items: LootStack[]): LootStack[] {
    const party = this.party(killerId);
    return items.map(item => ({ ...item, ...(party ? { partyId: party.id } : {}) }));
  }
  collect(collectorId: string, stack: LootStack, pile: SemanticEntity): Result<number> {
    const party = (stack.partyId ? this.parties.get(stack.partyId) : undefined) ?? this.party(collectorId);
    const eligible = new Set(this.eligible(party, pile));
    const deliver = (id: string): Result<number> => {
      const player = this.world.players.get(id)!;
      const state = player.store.get();
      if (content.item(stack.itemId)?.orb && (state.magic.consumedOrbs[stack.itemId]
        || [...state.inventory.slots, ...state.bank.slots, ...Object.values(state.equipment), ...(state.world.recoveryCache?.items ?? [])]
          .some(item => item?.itemId === stack.itemId && item.quantity > 0))) return err("UNAVAILABLE", "That orb is already owned.");
      const result = player.inventory.addItem(stack.itemId, stack.quantity, { silent: true });
      if (result.ok && result.value > 0) player.events.emit("item.received", { itemId: stack.itemId, quantity: result.value,
        source: "loot", from: pile.id, sourceName: pile.name }, pile.id, this.world.clock.elapsedMs);
      return result;
    };
    if (!party) return deliver(collectorId);
    const start = Math.max(0, party.members.findIndex(member => member.id === party.nextLootId));
    for (let offset = 0; offset < party.members.length; offset++) {
      const index = (start + offset) % party.members.length, id = party.members[index]!.id;
      if (!eligible.has(id)) continue;
      const result = deliver(id);
      if (result.ok && result.value > 0) {
        party.nextLootId = party.members[(index + 1) % party.members.length]!.id;
        return result;
      }
    }
    return err("UNAVAILABLE", "No nearby living party member can carry this item.");
  }
  view(id: string): SocialView {
    const party = this.party(id);
    return {
      party: party ? { id: party.id, leaderId: party.leaderId, nextLootId: party.nextLootId,
        members: party.members.map(member => {
          const player = this.world.players.get(member.id)?.store.get().player;
          const connected = this.world.active.has(member.id);
          return { ...member, level: player ? this.level(member.id) : 1, connected, nearby: this.nearby(id, member.id, PARTY_REWARD_RADIUS),
            health: connected ? player?.health ?? 0 : 0, maxHealth: connected ? player?.maxHealth ?? 0 : 0 };
        }) } : null,
      invitations: [...(this.invitations.get(id) ?? [])].flatMap(([partyId, expiresAtMs]) => {
        const invited = this.parties.get(partyId);
        return invited && expiresAtMs > this.world.clock.elapsedMs ? [{ partyId, expiresAtMs,
          leaderName: invited.members.find(member => member.id === invited.leaderId)!.name }] : [];
      }),
      messages: (this.messages.get(id) ?? []).map(message => ({ ...message })),
    };
  }
  snapshot(): PartyRecord[] { return structuredClone([...this.parties.values()]); }
}
