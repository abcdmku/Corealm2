/**
 * The right-click menu, plus the shared "say why that failed" channel every input path needs.
 *
 * The PRD's readability pillar has a hard rule here: an interaction an entity has is ALWAYS listed.
 * Unavailable entries stay visible, greyed, and state the missing requirement in plain text
 * ("Requires Mining 10"). Hiding them is what makes a game feel arbitrary — the player cannot learn
 * a rule they were never shown. So this file never filters; it only greys.
 *
 * Every entry routes through `GameApi`. The greying here is a *mirror* of the rules, not the
 * enforcement of them: selection still calls the API, the API still validates, and a stale grey can
 * therefore never silently block a legal action.
 */
import type {
  EntityId, GameApi, InteractionId, Result, SemanticEntity, SkillId, SkillView, Vec3,
} from "../contracts.js";
import { entityExamineLabel, entityLevelLabel } from "./displayLabels.js";

// -------------------------------------------------------------- notice channel

export type NoticeTone = "info" | "error" | "success";
export type NoticeSink = (message: string, tone: NoticeTone) => void;

let noticeSink: NoticeSink | null = null;

/**
 * The HUD's event toast strip (a later round) should call this and take the channel over. Until it
 * does, we render a minimal strip ourselves, because "the click did nothing and said nothing" is
 * the single worst failure mode for a menu that greys things out.
 */
export function setNoticeSink(sink: NoticeSink | null): void {
  noticeSink = sink;
}

export function notify(message: string, tone: NoticeTone = "info"): void {
  if (noticeSink) {
    noticeSink(message, tone);
    return;
  }
  defaultToast(message, tone);
}

/**
 * The one place a `Result` is unwrapped for a human. Failures are shown, never thrown — the
 * contract says nothing crosses the API boundary as an exception, and the UI must honour that.
 */
export function reportResult<T>(result: Result<T>): result is { ok: true; value: T } {
  if (!result.ok) notify(result.error.message, "error");
  return result.ok;
}

const MESSAGE_LIMIT = 8;

/**
 * The pre-HUD fallback for the message log.
 *
 * Only reachable before `createUi` has wired `Hud.pushNotice` as the sink — a boot failure, or a
 * test that stands this file up alone. It writes into the SAME `.msglog` element the HUD owns, with
 * the same classes, so the two cannot disagree about where the game talks to the player, and the
 * HUD taking over mid-session leaves the existing lines in place rather than orphaning them.
 */
function defaultToast(message: string, tone: NoticeTone): void {
  const root = uiRoot();
  if (!root) return;
  let strip = root.querySelector<HTMLElement>(".msglog");
  if (!strip) {
    strip = document.createElement("div");
    strip.className = "msglog";
    // Announced politely so a screen reader hears the failure without stealing focus mid-action.
    strip.setAttribute("role", "log");
    strip.setAttribute("aria-live", "polite");
    root.appendChild(strip);
  }

  const line = document.createElement("div");
  line.className = `msglog__line msglog__line--${tone}`;
  line.dataset["message"] = message;
  line.textContent = message;
  strip.appendChild(line);
  while (strip.childElementCount > MESSAGE_LIMIT) strip.firstElementChild?.remove();
}

function uiRoot(): HTMLElement | null {
  return document.getElementById("ui-root");
}

// ------------------------------------------------------- interaction vocabulary

/**
 * Menu order. Highest-intent verb first, examine always last. Most entities carry one or two of
 * these, so this mostly decides sensible things like talk-before-trade on a shopkeeper.
 */
export const INTERACTION_PRIORITY: readonly InteractionId[] = [
  // No "cast": enemies advertise "attack" alone now, and it means "hit that with what I am holding"
  // (`world/regionBuilder.ts`). The verb still exists in the contract for `GameApi.cast`, which
  // names a specific spell, so it keeps a label below — nothing routes it into a menu.
  "attack",
  "talk", "trade", "bank", "awaken", "recharge", "produce",
  "mine", "chop", "fish",
  "loot", "take",
  "open", "enter", "climb", "vault",
  "equip", "unequip",
  "inspect",
] as const;

export const INTERACTION_LABELS: Record<InteractionId, string> = {
  inspect: "Examine",
  mine: "Mine",
  chop: "Chop",
  fish: "Fish",
  attack: "Attack",
  cast: "Cast at",  // unreachable from a menu; see INTERACTION_PRIORITY
  talk: "Talk to",
  open: "Open",
  enter: "Enter",
  climb: "Climb",
  vault: "Vault",
  loot: "Loot",
  take: "Take",
  awaken: "Awaken",
  produce: "Use",
  recharge: "Recharge at",
  bank: "Bank",
  trade: "Trade with",
  equip: "Equip",
  unequip: "Unequip",
};

/** World containers read as boxes the player opens, while the gameplay verb remains `loot`. */
export function interactionLabel(entity: SemanticEntity, interaction: InteractionId): string {
  if (
    interaction === "loot"
    && (entity.archetype === "loot" || entity.archetype === "recovery_cache")
  ) return "Open";
  return INTERACTION_LABELS[interaction];
}

/** Sorts an entity's interactions into menu order. Unknown ids sink to the bottom, never vanish. */
export function orderInteractions(interactions: readonly InteractionId[]): InteractionId[] {
  const rank = (id: InteractionId): number => {
    const index = INTERACTION_PRIORITY.indexOf(id);
    return index === -1 ? INTERACTION_PRIORITY.length : index;
  };
  return [...interactions].sort((a, b) => rank(a) - rank(b));
}

/** What a plain left click on this entity does. `null` when it only supports examine. */
export function primaryInteraction(interactions: readonly InteractionId[]): InteractionId | null {
  const ordered = orderInteractions(interactions);
  return ordered.find((id) => id !== "inspect") ?? ordered[0] ?? null;
}

/** Skill ids are single words, so title case matches `content/skills.ts` names exactly. */
export function defaultSkillLabel(skill: SkillId): string {
  return skill.charAt(0).toUpperCase() + skill.slice(1);
}

/** Verbs that a spent or felled node cannot serve. */
const HARVEST_VERBS: readonly InteractionId[] = ["mine", "chop", "fish"];
const COMBAT_VERBS: readonly InteractionId[] = ["attack", "cast"];

export interface Availability {
  enabled: boolean;
  /** Plain-language reason, shown greyed beside the entry. */
  reason?: string;
}

/**
 * Mirrors the rules the API enforces, in the order a player would ask about them: is the thing
 * still there, then am I good enough at it.
 */
export function describeAvailability(
  entity: SemanticEntity,
  interaction: InteractionId,
  skills: Record<SkillId, SkillView>,
  skillLabel: (skill: SkillId) => string = defaultSkillLabel,
): Availability {
  if (interaction === "inspect") return { enabled: true };

  if (entity.state === "depleted" && HARVEST_VERBS.includes(interaction)) {
    return { enabled: false, reason: "Depleted — it will respawn" };
  }
  if (entity.state === "dead" && COMBAT_VERBS.includes(interaction)) {
    return { enabled: false, reason: "Already defeated" };
  }
  if (entity.state === "locked" && (interaction === "open" || interaction === "enter")) {
    return { enabled: false, reason: "Locked" };
  }

  const required = requirementsFor(entity, interaction);
  const missing: string[] = [];
  for (const [skill, level] of required) {
    const have = skills[skill]?.level ?? 1;
    if (have < level) missing.push(`${skillLabel(skill)} ${level}`);
  }
  if (missing.length > 0) return { enabled: false, reason: `Requires ${missing.join(", ")}` };
  return { enabled: true };
}

/** Agility shortcuts carry their own level on `obstacle`; everything else uses `requirements`. */
function requirementsFor(entity: SemanticEntity, interaction: InteractionId): [SkillId, number][] {
  if ((interaction === "climb" || interaction === "vault") && entity.obstacle) {
    return [["agility", entity.obstacle.reqLevel]];
  }
  const out: [SkillId, number][] = [];
  for (const [skill, level] of Object.entries(entity.requirements ?? {})) {
    if (typeof level === "number") out.push([skill as SkillId, level]);
  }
  return out;
}

// ------------------------------------------------------------------ the menu

export interface ContextMenuItem {
  id: string;
  label: string;
  enabled: boolean;
  /** Greyed explanation shown on the entry itself when it is unavailable. */
  reason?: string;
  /** Dim right-aligned text: a shortcut, a count, a distance. */
  hint?: string;
  /** Marks destructive or combat entries. Visual only. */
  danger?: boolean;
  onSelect?: () => void;
}

export interface ContextMenuDeps {
  api: GameApi;
  /** Defaults to #ui-root. */
  root?: HTMLElement | null;
  /** Override to use `content/skills.ts` display names once a panel owns that mapping. */
  skillLabel?: (skill: SkillId) => string;
  /** Opens recipe selection without auto-starting the station's highest affordable recipe. */
  onProduction?: (entityId: EntityId) => void;
}

export interface OpenOptions {
  title?: string;
  subtitle?: string;
  /** Focus the first entry immediately. Set for keyboard-opened menus. */
  focusFirst?: boolean;
  /** False in authoring mode: inspection stays available while movement-bearing actions do not. */
  movementEnabled?: boolean;
}

/** Keeps the menu clear of the window edge. */
const EDGE_MARGIN_PX = 8;

export class ContextMenu {
  private element: HTMLElement | null = null;
  private items: ContextMenuItem[] = [];
  private focusIndex = -1;
  private restoreFocus: HTMLElement | null = null;
  private readonly skillLabel: (skill: SkillId) => string;

  constructor(private readonly deps: ContextMenuDeps) {
    this.skillLabel = deps.skillLabel ?? defaultSkillLabel;
  }

  isOpen(): boolean {
    return this.element !== null;
  }

  /** For the input layer: a click inside the menu is not a click on the world. */
  containsTarget(target: EventTarget | null): boolean {
    return this.element !== null && target instanceof Node && this.element.contains(target);
  }

  /** Right click on an entity. Lists every interaction it has, available or not. */
  openForEntity(entityId: EntityId, clientX: number, clientY: number, options: OpenOptions = {}): void {
    const inspected = this.deps.api.inspect(entityId);
    if (!inspected.ok) {
      // Never throw at the player. Show what the API said and offer nothing else.
      this.open(clientX, clientY, [
        { id: "error", label: inspected.error.message, enabled: false },
      ], { title: "Unavailable", ...options });
      return;
    }

    const entity = inspected.value;
    const skills = this.deps.api.getSkills();
    const items: ContextMenuItem[] = orderInteractions(entity.interactions).map((interaction) => {
      const availability = describeAvailability(entity, interaction, skills, this.skillLabel);
      const movementAllowed = options.movementEnabled !== false || interaction === "inspect";
      const item: ContextMenuItem = {
        id: interaction,
        label: `${interactionLabel(entity, interaction)} ${entity.name}`,
        enabled: availability.enabled && movementAllowed,
        danger: COMBAT_VERBS.includes(interaction),
        onSelect: () => this.runInteraction(entity, interaction),
      };
      if (!movementAllowed) item.reason = "Enable walking to use this action";
      else if (availability.reason !== undefined) item.reason = availability.reason;
      return item;
    });

    items.push({
      id: "walk-here",
      label: "Walk here",
      enabled: options.movementEnabled !== false,
      onSelect: () => { reportResult(this.deps.api.moveTo({ entityId: entity.id })); },
      ...(options.movementEnabled === false ? { reason: "Enable walking to move" } : {}),
    });

    this.open(clientX, clientY, items, {
      title: entity.name,
      subtitle: entitySubtitle(entity, this.deps.api),
      ...options,
    });
  }

  /** Right click on ground. Short, but it keeps the interaction model consistent. */
  openForGround(point: Vec3, clientX: number, clientY: number, options: OpenOptions = {}): void {
    this.open(clientX, clientY, [
      {
        id: "walk-here",
        label: "Walk here",
        enabled: options.movementEnabled !== false,
        onSelect: () => { reportResult(this.deps.api.moveTo({ position: point })); },
        ...(options.movementEnabled === false ? { reason: "Enable walking to move" } : {}),
      },
      {
        id: "stop",
        label: "Stop",
        enabled: true,
        onSelect: () => { reportResult(this.deps.api.stop()); },
      },
    ], { title: "Ground", ...options });
  }

  /** Generic entry point. Inventory and bank panels reuse this in later rounds. */
  open(clientX: number, clientY: number, items: ContextMenuItem[], options: OpenOptions = {}): void {
    this.close();
    const root = this.deps.root ?? uiRoot();
    if (!root || items.length === 0) return;

    this.restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.items = items;
    this.focusIndex = -1;

    const menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.setAttribute("role", "menu");
    menu.tabIndex = -1;
    if (options.title) menu.setAttribute("aria-label", options.title);

    if (options.title) {
      const header = document.createElement("div");
      header.className = "ctx-menu__title";
      header.textContent = options.title;
      if (options.subtitle) {
        const sub = document.createElement("span");
        sub.className = "ctx-menu__subtitle";
        sub.textContent = options.subtitle;
        header.appendChild(sub);
      }
      menu.appendChild(header);
    }

    items.forEach((item, index) => menu.appendChild(this.renderItem(item, index)));

    menu.addEventListener("keydown", this.onMenuKeyDown);
    root.appendChild(menu);
    this.element = menu;
    this.position(menu, clientX, clientY);

    // Capture phase, so Escape closes the menu before `input/keyboard.ts` cancels the activity.
    window.addEventListener("keydown", this.onWindowKeyDown, true);
    window.addEventListener("pointerdown", this.onWindowPointerDown, true);
    window.addEventListener("blur", this.onWindowBlur);
    window.addEventListener("resize", this.onWindowResize);

    if (options.focusFirst) this.moveFocus(1);
    else menu.focus({ preventScroll: true });
  }

  close(): void {
    const menu = this.element;
    if (!menu) return;
    this.element = null;
    this.items = [];
    this.focusIndex = -1;

    window.removeEventListener("keydown", this.onWindowKeyDown, true);
    window.removeEventListener("pointerdown", this.onWindowPointerDown, true);
    window.removeEventListener("blur", this.onWindowBlur);
    window.removeEventListener("resize", this.onWindowResize);
    menu.remove();

    // Hand focus back so the next keystroke still drives the game, not a dead element.
    const restore = this.restoreFocus;
    this.restoreFocus = null;
    if (restore && restore.isConnected) restore.focus({ preventScroll: true });
  }

  dispose(): void {
    this.close();
  }

  // ------------------------------------------------------------------ internals

  private renderItem(item: ContextMenuItem, index: number): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ctx-menu__item";
    button.setAttribute("role", "menuitem");
    button.dataset["index"] = String(index);
    button.tabIndex = -1;
    if (item.danger) button.classList.add("ctx-menu__item--danger");
    if (!item.enabled) {
      // aria-disabled, not `disabled`: the entry must stay readable and announceable. That is the
      // whole point of showing it.
      button.classList.add("is-disabled");
      button.setAttribute("aria-disabled", "true");
    }

    const label = document.createElement("span");
    label.className = "ctx-menu__label";
    label.textContent = item.label;
    button.appendChild(label);

    if (item.reason) {
      const reason = document.createElement("span");
      reason.className = "ctx-menu__reason";
      reason.textContent = item.reason;
      button.appendChild(reason);
    } else if (item.hint) {
      const hint = document.createElement("span");
      hint.className = "ctx-menu__hint";
      hint.textContent = item.hint;
      button.appendChild(hint);
    }

    button.addEventListener("click", (event) => {
      event.preventDefault();
      this.select(index);
    });
    button.addEventListener("pointerenter", () => this.setFocus(index));
    return button;
  }

  private select(index: number): void {
    const item = this.items[index];
    if (!item) return;
    if (!item.enabled) {
      // Say why rather than swallowing the click. A dead click reads as a bug.
      notify(item.reason ?? `${item.label} is unavailable`, "info");
      return;
    }
    this.close();
    item.onSelect?.();
  }

  private runInteraction(entity: SemanticEntity, interaction: InteractionId): void {
    if (interaction === "inspect") {
      const result = this.deps.api.inspect(entity.id);
      if (!reportResult(result)) return;
      const seen = result.value;
      notify(entityExamineLabel(seen), "info");
      return;
    }
    if (interaction === "produce" && entity.station && this.deps.onProduction) {
      this.deps.onProduction(entity.id);
      return;
    }
    reportResult(this.deps.api.interact(entity.id, interaction));
  }

  /** Flips around the cursor rather than clamping, so the pointer never covers the first entry. */
  private position(menu: HTMLElement, clientX: number, clientY: number): void {
    menu.style.left = "0px";
    menu.style.top = "0px";
    const rect = menu.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - EDGE_MARGIN_PX;
    const maxY = window.innerHeight - rect.height - EDGE_MARGIN_PX;

    const preferX = clientX + rect.width + EDGE_MARGIN_PX > window.innerWidth ? clientX - rect.width : clientX;
    const preferY = clientY + rect.height + EDGE_MARGIN_PX > window.innerHeight ? clientY - rect.height : clientY;

    menu.style.left = `${Math.round(clamp(preferX, EDGE_MARGIN_PX, Math.max(EDGE_MARGIN_PX, maxX)))}px`;
    menu.style.top = `${Math.round(clamp(preferY, EDGE_MARGIN_PX, Math.max(EDGE_MARGIN_PX, maxY)))}px`;
  }

  private setFocus(index: number): void {
    const menu = this.element;
    if (!menu) return;
    this.focusIndex = index;
    const buttons = menu.querySelectorAll<HTMLElement>(".ctx-menu__item");
    buttons.forEach((button, i) => button.classList.toggle("is-focused", i === index));
    buttons[index]?.focus({ preventScroll: true });
  }

  /**
   * Disabled entries are still landed on. A keyboard user has to be able to arrow onto
   * "Requires Mining 10" and hear it, or the greyed entry is invisible to them.
   */
  private moveFocus(delta: number): void {
    if (this.items.length === 0) return;
    const next = this.focusIndex === -1 && delta < 0
      ? this.items.length - 1
      : (this.focusIndex + delta + this.items.length) % this.items.length;
    this.setFocus(next);
  }

  private onMenuKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); this.moveFocus(1); break;
      case "ArrowUp": event.preventDefault(); this.moveFocus(-1); break;
      case "Home": event.preventDefault(); this.setFocus(0); break;
      case "End": event.preventDefault(); this.setFocus(this.items.length - 1); break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (this.focusIndex >= 0) this.select(this.focusIndex);
        break;
      case "Tab":
        // A context menu is modal-ish: Tab dismisses rather than escaping into the panels behind.
        this.close();
        break;
      default:
        break;
    }
  };

  private onWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  private onWindowPointerDown = (event: PointerEvent): void => {
    if (this.containsTarget(event.target)) return;
    this.close();
  };

  private onWindowBlur = (): void => this.close();

  // Re-anchoring on resize is not worth the bookkeeping; the menu is transient.
  private onWindowResize = (): void => this.close();
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function entitySubtitle(entity: SemanticEntity, api: GameApi): string {
  // Combat level leads for anything that fights back, because it is the one number that tells a
  // player whether to swing. It is computed from the stat block by `enemyCombatLevel` rather than
  // authored anywhere, so what is printed here IS the creature's attack, defence, armour and
  // health read back out. Resources and shortcuts show their actual skill requirements.
  const base = [entityLevelLabel(entity), entity.state].filter(Boolean).join(" · ");
  if (entity.station?.kind !== "campfire") return base;
  const remainingMs = contextRemainingMs(entity, api);
  return remainingMs === null ? `${base} · portable fire` : `${base} · ${formatRemaining(remainingMs)} left`;
}

/** Reads only countdown fields a semantic entity can state in the GameApi sim-clock frame. */
function contextRemainingMs(entity: SemanticEntity, api: GameApi): number | null {
  const meta = entity.meta;
  if (!meta) return null;
  const directMs = meta["remainingMs"] ?? meta["campfireRemainingMs"];
  if (typeof directMs === "number" && Number.isFinite(directMs)) return Math.max(0, directMs);
  const directSeconds = meta["remainingSeconds"] ?? meta["campfireRemainingSeconds"];
  if (typeof directSeconds === "number" && Number.isFinite(directSeconds)) return Math.max(0, directSeconds * 1_000);
  const expiresAtMs = meta["expiresAtMs"];
  if (typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs)) {
    return Math.max(0, expiresAtMs - api.getTime().simMs);
  }
  return null;
}

function formatRemaining(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(seconds / 60);
  const tail = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(tail).padStart(2, "0")}` : `${tail}s`;
}
