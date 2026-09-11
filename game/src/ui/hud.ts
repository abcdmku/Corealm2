/**
 * The always-on HUD: vitals, the current activity, the XP feed, toasts, and marks.
 *
 * Everything here is arranged around one constraint from the brief — the middle of the screen is
 * where the game is, so the HUD lives on the edges. Vitals top-left, marks and the XP feed
 * top-right (below the minimap, which owns direction-finding now — the compass lives on its rim),
 * toasts bottom-left where the context menu already put them.
 *
 * The HUD takes over the notice channel from `ui/contextMenu.ts` via `setNoticeSink` (wired in
 * `panels.ts`), so every failed action, every greyed menu entry, and every game event lands in one
 * strip instead of three competing ones.
 *
 * There is no per-frame work here. `update()` is called on a 100 ms cadence and each channel keeps
 * a signature of what it last wrote. Nothing touches the DOM unless the underlying number changed.
 */
import type { GameEvent, SkillId } from "../contracts.js";
import { SKILL_IDS } from "../contracts.js";
import { UNREACHABLE_DESTINATION_MESSAGE } from "../api/gameApi.js";
import { content } from "../content/index.js";
import { SKILLS } from "../content/skills.js";
import { RECOVERY_CACHE_ID } from "../systems/death.js";
import { reportResult } from "./contextMenu.js";
import type { NoticeTone } from "./contextMenu.js";
import type { UiContext, UiOptions } from "./panels.js";
import { formatQuantity } from "./panels.js";

/**
 * Lines kept in the message log.
 *
 * Eight, not the four this was as a toast strip. The log is read AFTER the fact — the point of
 * making it a log rather than a set of expiring toasts is that a message which arrived while the
 * player was looking at a fight is still there when they look down. Four lines is one busy exchange.
 */
const MESSAGE_LIMIT = 8;
/**
 * Quiet time before the panel dims. It does NOT delete anything — the lines stay until pushed out
 * by newer ones, which is the whole difference between this and the toast strip it replaced.
 */
const MESSAGE_IDLE_MS = 14_000;
const XP_DROP_LIMIT = 6;
const XP_DROP_MS = 2_200;
const EVENT_INTERVAL_MS = 250;

/** Turns the canonical recharge payload into the one receipt shown to the player. */
export function describeEssenceRecharge(data: GameEvent["data"]): string {
  const weaponId = typeof data["weaponItemId"] === "string" ? data["weaponItemId"] : null;
  const essenceId = typeof data["essenceItemId"] === "string" ? data["essenceItemId"] : null;
  const after = typeof data["after"] === "number" ? data["after"] : null;
  const spent = typeof data["essenceSpent"] === "number" ? data["essenceSpent"] : null;
  const weaponName = weaponId ? content.item(weaponId)?.name ?? titleCase(weaponId) : "Weapon";
  const essenceName = essenceId ? content.item(essenceId)?.name ?? titleCase(essenceId) : "essence";

  const chargeReceipt = after === null
    ? `${weaponName} recharged.`
    : `${weaponName} recharged to ${formatQuantity(after)} charges.`;
  return spent === null ? chargeReceipt : `${chargeReceipt} Spent ${formatQuantity(spent)} ${essenceName}.`;
}

export function eventChangesWeaponCharge(event: GameEvent): boolean {
  return event.type === "spell.launched" || event.type === "essence.recharged";
}

/** Production receipts use the catalogue's ordinary names, including creature-crafted gear. */
export function describeProductionCompletion(data: GameEvent["data"]): string {
  const itemId = typeof data["itemId"] === "string" ? data["itemId"] : null;
  if (!itemId) return "Production finished.";
  const quantity = typeof data["quantity"] === "number" ? data["quantity"] : 1;
  const name = content.item(itemId)?.name ?? titleCase(itemId);
  return `Made ${quantity} × ${name}.`;
}

/** A deliberate stop is not a pathfinding failure and must not be presented as one. */
export function describeNavigationFailure(data: GameEvent["data"]): { text: string; tone: NoticeTone } | null {
  const reason = typeof data["reason"] === "string" ? data["reason"] : "";
  if (reason === "cancelled" || reason === "movement-disabled") return null;
  return { text: UNREACHABLE_DESTINATION_MESSAGE, tone: "error" };
}

/** Repeating the same failed route adds no information and should not wake the message log again. */
export function ignoresRepeatedNotice(message: string): boolean {
  return message === UNREACHABLE_DESTINATION_MESSAGE;
}

export class Hud {
  readonly element: HTMLElement;
  private readonly toastStrip: HTMLElement;
  /** Live quiet-timer for the message log, so it can be replaced rather than stacked. */
  private messageIdleTimer: number | null = null;

  private readonly healthBar: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly healthText: HTMLElement;
  private readonly activityRow: HTMLElement;
  private readonly activityLabel: HTMLElement;
  private readonly activityFill: HTMLElement;
  private readonly activityCount: HTMLElement;
  private readonly currencyValue: HTMLElement;
  private readonly xpFeed: HTMLElement;
  private readonly cacheBanner: HTMLElement;
  private readonly cacheDetail: HTMLElement;

  private healthSig = "";
  private activitySig = "";
  private currencySig = "";

  private xpBaseline: Partial<Record<SkillId, number>> = {};
  private xpSeeded = false;
  private lastEventMs = 0;
  private eventCursor = 0;
  private eventPollInFlight = false;
  private readonly timers = new Set<number>();

  constructor(private readonly ctx: UiContext, private readonly options: UiOptions) {
    const root = document.createElement("div");
    // is-passive keeps the HUD out of the way of world clicks: #ui-root's rule opts it back out of
    // pointer events. The cache and marks readout opt back in for their in-game hover surfaces.
    // Everything else stays passive so world clicks pass straight through.
    root.className = "hud is-passive";

    // ---- vitals, top left
    const vitals = document.createElement("div");
    vitals.className = "hud__vitals";

    const health = document.createElement("div");
    health.className = "bar bar--tall bar--health hud__health";
    health.setAttribute("role", "meter");
    health.setAttribute("aria-label", "Health");
    const healthFill = document.createElement("div");
    healthFill.className = "bar__fill";
    const healthText = document.createElement("div");
    healthText.className = "bar__text";
    health.append(healthFill, healthText);

    const activity = document.createElement("div");
    activity.className = "hud__activity";
    activity.hidden = true;
    const activityHead = document.createElement("div");
    activityHead.className = "hud__activity-head";
    const activityLabel = document.createElement("span");
    activityLabel.className = "hud__activity-label";
    const activityCount = document.createElement("span");
    activityCount.className = "hud__activity-count u-numeric u-dim";
    activityHead.append(activityLabel, activityCount);
    const activityBar = document.createElement("div");
    activityBar.className = "bar bar--activity";
    const activityFill = document.createElement("div");
    activityFill.className = "bar__fill";
    activityBar.appendChild(activityFill);
    activity.append(activityHead, activityBar);

    // ---- recovery cache, under the vitals
    //
    // `systems/death.ts` has said since round 3 that "the HUD is supposed to show a countdown
    // banner while one is out", and nothing showed one. The death report explains the loss once and
    // is dismissed for good — it has no key and no frame — so without this a player who clicks
    // Dismiss has no way left to find out where their pack is or how long they have. Dying with a
    // live cache destroys the old one, which is what makes the second death the expensive one and
    // this banner worth its space.
    const cache = document.createElement("button");
    cache.type = "button";
    cache.className = "hud__cache";
    cache.hidden = true;
    const cacheLabel = document.createElement("span");
    cacheLabel.className = "hud__cache-label u-caps";
    cacheLabel.textContent = "Cache";
    const cacheDetail = document.createElement("span");
    cacheDetail.className = "hud__cache-detail u-numeric";
    cache.append(cacheLabel, cacheDetail);
    cache.addEventListener("pointerdown", (event) => event.stopPropagation());
    cache.addEventListener("click", () => {
      // `interact` walks into range and opens the cache on arrival. Contents move only by choice.
      reportResult(this.ctx.api.interact(RECOVERY_CACHE_ID, "loot"));
    });
    this.ctx.tooltip.attach(cache, () => ({
      kind: "text",
      title: "Recovery cache",
      lines: ["Walk back to reclaim the items inside."],
    }));

    vitals.append(health, activity, cache);
    this.cacheBanner = cache;
    this.cacheDetail = cacheDetail;

    // ---- marks and the XP feed, top right
    const right = document.createElement("div");
    right.className = "hud__right";
    const currency = document.createElement("div");
    currency.className = "hud__currency";
    const currencyMark = document.createElement("span");
    currencyMark.className = "hud__currency-mark";
    currencyMark.textContent = "◈";
    const currencyValue = document.createElement("span");
    currencyValue.className = "hud__currency-value u-numeric";
    currencyValue.textContent = "0";
    const currencyWord = document.createElement("span");
    currencyWord.className = "u-caps u-dim";
    currencyWord.textContent = "marks";
    currency.append(currencyMark, currencyValue, currencyWord);
    this.ctx.tooltip.attach(currency, () => ({
      kind: "text",
      title: "Marks",
      lines: [(currencyValue.textContent ?? "0") + " marks carried."],
    }));

    const xpFeed = document.createElement("div");
    xpFeed.className = "hud__xp-feed";
    right.append(currency, xpFeed);

    root.append(vitals, right);

    // The message log is a sibling, not a child: #ui-root already styles and positions `.msglog`,
    // and the context menu's pre-HUD fallback looks for exactly that selector.
    const toastStrip = document.createElement("div");
    toastStrip.className = "msglog";
    toastStrip.setAttribute("role", "log");
    toastStrip.setAttribute("aria-live", "polite");

    this.element = root;
    this.toastStrip = toastStrip;
    this.healthBar = health;
    this.healthFill = healthFill;
    this.healthText = healthText;
    this.activityRow = activity;
    this.activityLabel = activityLabel;
    this.activityFill = activityFill;
    this.activityCount = activityCount;
    this.currencyValue = currencyValue;
    this.xpFeed = xpFeed;
  }

  mount(parent: HTMLElement): void {
    parent.append(this.element, this.toastStrip);
  }

  /**
   * The notice sink. Everything the game says to the player in words arrives here.
   *
   * Every input path already funnels through `ui/contextMenu.ts notify()` — a failed click, a
   * rejected `Result`, a described event — so anything that wants to talk to the player says it
   * once, in one place, and lands in this log. Nothing else should grow its own message strip.
   *
   * Repeats are COLLAPSED rather than stacked. An out-of-fuel warning can fire on every combat
   * tick that tries to cast, and eight identical lines would push out the context that explains
   * them; a counter says the same thing and keeps the history.
   */
  pushNotice(message: string, tone: NoticeTone = "info"): void {
    const last = this.toastStrip.lastElementChild as HTMLElement | null;
    if (last && last.dataset["message"] === message) {
      if (ignoresRepeatedNotice(message)) return;
      const seen = Number(last.dataset["count"] ?? "1") + 1;
      last.dataset["count"] = String(seen);
      last.textContent = `${message} (x${seen})`;
      this.markMessageActivity();
      return;
    }

    const line = document.createElement("div");
    line.className = `msglog__line msglog__line--${tone}`;
    line.dataset["message"] = message;
    line.textContent = message;
    this.toastStrip.appendChild(line);
    while (this.toastStrip.childElementCount > MESSAGE_LIMIT) this.toastStrip.firstElementChild?.remove();
    this.markMessageActivity();
  }

  /**
   * Wakes the log and restarts the quiet timer.
   *
   * The timer is replaced rather than stacked, so a burst of messages dims once, `MESSAGE_IDLE_MS`
   * after the LAST of them, instead of the panel flickering back and forth as older timers fire.
   */
  private markMessageActivity(): void {
    this.toastStrip.classList.remove("is-idle");
    if (this.messageIdleTimer !== null) window.clearTimeout(this.messageIdleTimer);
    this.messageIdleTimer = window.setTimeout(() => {
      this.toastStrip.classList.add("is-idle");
      this.messageIdleTimer = null;
    }, MESSAGE_IDLE_MS);
  }

  update(nowMs: number): void {
    const api = this.ctx.api;
    const player = api.getPlayer();

    // The bar stays hot for the whole no-regen window, not just while a target is alive.
    this.updateHealth(player.health, player.maxHealth, player.inCombat || player.regenBlocked, player.dead);
    this.updateActivity();
    this.updateCurrency(api.getCurrency());
    this.updateXpFeed();
    this.updateCache();

    if (nowMs - this.lastEventMs >= EVENT_INTERVAL_MS) {
      this.lastEventMs = nowMs;
      this.pollEvents();
    }
  }

  /**
   * The recovery-cache banner: how far, and how long.
   *
   * Both numbers come off the same two calls an agent would make — `inspect` for the cache's own
   * `expiresAtMs` and `observe` for path distance — and the deadline is compared against
   * `getTime().simMs`, never against wall time. Sim time is what every `*AtMs` field in the game is
   * stamped in, and it stops when the clock stops.
   */
  private updateCache(): void {
    const banner = this.cacheBanner;
    const detail = this.cacheDetail;
    if (!banner || !detail) return;

    const found = this.ctx.api.inspect(RECOVERY_CACHE_ID);
    if (!found.ok || found.value.state !== "available") {
      if (!banner.hidden) banner.hidden = true;
      return;
    }

    const expiresAtMs = Number(found.value.meta?.["expiresAtMs"] ?? 0);
    const wallDeadline = found.value.meta?.["expiresAtWallMs"];
    const remainingMs = Math.max(0, typeof wallDeadline === "number" && Number.isFinite(wallDeadline)
      ? wallDeadline - Date.now() : expiresAtMs - this.ctx.api.getTime().simMs);

    // Straight line from the cache's own position, not `observe` path distance: `observe` caps at
    // 140 m and a cache is routinely 340 m behind you, so the honest number is the one that is
    // always available. `scope: "known"` is no help either — it answers with route-graph places,
    // and a cache is not one.
    const player = this.ctx.api.getPlayer().position;
    const at = found.value.position;
    const metres = Math.hypot(at[0] - player[0], at[2] - player[2]);

    const minutes = Math.floor(remainingMs / 60_000);
    const seconds = Math.floor((remainingMs % 60_000) / 1000);
    const clock = `${minutes}:${String(seconds).padStart(2, "0")}`;
    const text = `${Math.round(metres)} m · ${clock}`;

    if (detail.textContent !== text) detail.textContent = text;
    banner.classList.toggle("is-urgent", remainingMs < 120_000);
    if (banner.hidden) banner.hidden = false;
  }

  dispose(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    // Not in `this.timers`: the quiet timer is replaced on every message rather than accumulated,
    // so it is held as a single handle and has to be cleared on its own.
    if (this.messageIdleTimer !== null) window.clearTimeout(this.messageIdleTimer);
    this.messageIdleTimer = null;
    this.element.remove();
    this.toastStrip.remove();
  }

  // ---------------------------------------------------------------- vitals

  private updateHealth(health: number, maxHealth: number, inCombat: boolean, dead: boolean): void {
    const signature = `${health}/${maxHealth}/${inCombat}/${dead}`;
    if (signature === this.healthSig) return;
    this.healthSig = signature;

    const ratio = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
    this.healthFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.healthText.textContent = dead ? "dead" : `${Math.max(0, Math.round(health))} / ${Math.round(maxHealth)}`;
    // Green while it is fine, brass while it is going, red while it matters. One glance, one colour.
    const colour = ratio > 0.6 ? "#6b9c52" : ratio > 0.3 ? "#c9a227" : "#c9553d";
    this.healthBar.style.setProperty("--bar-colour", colour);
    this.healthBar.classList.toggle("is-low", ratio <= 0.3 && !dead);
    this.healthBar.classList.toggle("is-combat", inCombat);
    this.healthBar.setAttribute("aria-valuenow", String(Math.max(0, Math.round(health))));
    this.healthBar.setAttribute("aria-valuemax", String(Math.round(maxHealth)));
  }

  private updateActivity(): void {
    const activity = this.ctx.api.getActivity();
    const signature = activity
      ? `${activity.kind}:${activity.skill ?? "-"}:${activity.progress.toFixed(2)}:${activity.completed}:${activity.remaining}`
      : "-";
    if (signature === this.activitySig) return;
    this.activitySig = signature;

    if (!activity) {
      this.activityRow.hidden = true;
      return;
    }

    this.activityRow.hidden = false;
    const label = activity.skill ? SKILLS[activity.skill].name : titleCase(activity.kind);
    this.activityLabel.textContent = label;
    if (activity.skill) this.activityRow.dataset["skill"] = activity.skill;
    else delete this.activityRow.dataset["skill"];
    this.activityRow.classList.toggle("has-skill", Boolean(activity.skill));
    this.activityFill.style.width = `${(Math.max(0, Math.min(1, activity.progress)) * 100).toFixed(1)}%`;
    this.activityCount.textContent = activity.remaining > 0
      ? `${activity.completed} done · ${activity.remaining} left`
      : `${activity.completed} done`;
  }

  private updateCurrency(currency: number): void {
    const signature = String(currency);
    if (signature === this.currencySig) return;
    this.currencySig = signature;
    this.currencyValue.textContent = formatQuantity(currency);
  }

  // ---------------------------------------------------------------- xp feed

  /**
   * There is no xp.gained event in the contract, so the feed is a diff of `getSkills()` between
   * polls. That is also more robust: it catches XP from any source, including one a later system
   * forgets to emit an event for.
   */
  private updateXpFeed(): void {
    const skills = this.ctx.api.getSkills();
    if (!this.xpSeeded) {
      for (const id of SKILL_IDS) this.xpBaseline[id] = skills[id].xp;
      this.xpSeeded = true;
      return;
    }

    for (const id of SKILL_IDS) {
      const previous = this.xpBaseline[id] ?? 0;
      const current = skills[id].xp;
      if (current <= previous) {
        this.xpBaseline[id] = current;
        continue;
      }
      this.xpBaseline[id] = current;
      this.spawnXpDrop(id, current - previous);
    }
  }

  private spawnXpDrop(skill: SkillId, amount: number): void {
    const drop = document.createElement("div");
    drop.className = "xp-drop";
    drop.dataset["skill"] = skill;
    drop.style.setProperty("--skill-colour", SKILLS[skill].colour);
    drop.textContent = `+${Math.round(amount).toLocaleString("en-US")} ${SKILLS[skill].name}`;
    this.xpFeed.appendChild(drop);
    while (this.xpFeed.childElementCount > XP_DROP_LIMIT) this.xpFeed.firstElementChild?.remove();
    this.after(XP_DROP_MS, () => drop.remove());
  }

  // ----------------------------------------------------------------- events

  /**
   * A cursor read, not a long poll: the HUD is already on a 250 ms cadence and a pending promise
   * across a reset would be another lifecycle to manage for no gain.
   */
  private pollEvents(): void {
    if (this.eventPollInFlight) return;
    this.eventPollInFlight = true;
    void this.ctx.api.events(this.eventCursor).then((batch) => {
      this.eventPollInFlight = false;
      this.eventCursor = batch.nextSeq;
      for (const event of batch.events) this.handleEvent(event);
    }, () => {
      this.eventPollInFlight = false;
    });
  }

  private handleEvent(event: GameEvent): void {
    if (eventChangesWeaponCharge(event)) {
      // Casting and recharging mutate only the charge ledger. Its inventory stack does not change,
      // so the equipment signature needs this event-driven refresh to repaint the number now.
      this.ctx.refresh();
      this.ctx.tooltip.refresh();
    }

    const described = this.describeEvent(event);
    if (described) this.pushNotice(described.text, described.tone);

  }

  private describeEvent(event: GameEvent): { text: string; tone: NoticeTone } | null {
    const data = event.data;
    switch (event.type) {
      case "level.gained": {
        const skill = typeof data["skill"] === "string" ? data["skill"] : null;
        const level = typeof data["level"] === "number" ? data["level"] : null;
        const name = skill && isSkillId(skill) ? SKILLS[skill].name : skill ?? "A skill";
        return { text: level ? `${name} level ${level}.` : `${name} levelled up.`, tone: "success" };
      }
      case "inventory.full":
        return { text: "Your inventory is full.", tone: "error" };
      case "resource.depleted":
        return { text: `${this.entityName(event) ?? "That node"} is depleted.`, tone: "info" };
      case "health.low":
        return { text: "Your health is low.", tone: "error" };
      case "player.died":
        return { text: "You have died.", tone: "error" };
      case "production.completed": {
        return { text: describeProductionCompletion(data), tone: "success" };
      }
      case "quest.updated": {
        const objective = typeof data["objective"] === "string" ? data["objective"] : null;
        const name = typeof data["name"] === "string" ? data["name"] : "Quest";
        return { text: objective ? `${name}: ${objective}` : `${name} updated.`, tone: "info" };
      }
      case "entity.discovered": {
        const name = this.entityName(event);
        return name ? { text: `Discovered ${name}.`, tone: "info" } : null;
      }
      case "navigation.failed":
        return describeNavigationFailure(data);
      case "essence.recharged":
        return { text: describeEssenceRecharge(data), tone: "success" };
      case "essence.altarAwakened": {
        const name = this.entityName(event) ?? "Essence Altar";
        return {
          text: `${name} awakened. Its matching staffs and wands can now be made and recharged here.`,
          tone: "success",
        };
      }
      case "combat.ended": {
        // Only the endings the player did not ask for. A fight that ends because the target died,
        // or because they clicked something else, explains itself on screen — saying so in words is
        // noise. An engagement that stops on its own does NOT explain itself, and running dry of
        // running out of spell fuel mid-fight was the worst of them: `systems/combat.ts` disengaged silently,
        // so the character simply stopped attacking with nothing said anywhere.
        const reason = typeof data["reason"] === "string" ? data["reason"] : "";
        if (reason === "spell-blocked") {
          return {
            text: "Casting stopped. Carry matching Essence or recharge the equipped elemental weapon.",
            tone: "error",
          };
        }
        if (reason === "out-of-range") return { text: "Your target moved out of reach.", tone: "info" };
        return null;
      }
      default:
        return null;
    }
  }

  private entityName(event: GameEvent): string | null {
    if (typeof event.data["name"] === "string") return event.data["name"];
    if (!event.entityId) return null;
    const inspected = this.ctx.api.inspect(event.entityId);
    return inspected.ok ? inspected.value.name : null;
  }

  private after(delayMs: number, action: () => void): void {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      action();
    }, delayMs);
    this.timers.add(timer);
  }
}

function isSkillId(value: string): value is SkillId {
  return (SKILL_IDS as readonly string[]).includes(value);
}

function titleCase(text: string): string {
  return text.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
