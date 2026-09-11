/**
 * Shared panel plumbing, the item-display helpers every panel needs, and the single UI entry point.
 *
 * `createUi(api)` is the ONE thing the root wires at boot. It owns the HUD, the panels, the shared
 * tooltip, and the notice sink; the root only has to mount it, call `update()` once a frame, and
 * dispose it on teardown.
 *
 * Two rules run through this file:
 *
 *  - Everything a panel does goes through `GameApi`, and a failing `Result` is surfaced with its
 *    own `error.message`. Nothing throws at the player, nothing fails silently.
 *  - Nothing repaints on a frame boundary. Panels build a cheap signature of the data they render
 *    and only touch the DOM when it changes, because a 100 ms sim tick leaves no budget for a UI
 *    that relayouts 60 times a second.
 *
 * Composition, not inheritance: panels hold a `PanelFrame` rather than extending one. This module
 * imports the panels and the panels import this module, and a cycle of `class X extends Y` across
 * that boundary would explode at module-evaluation time. Every cross-module reference here is
 * resolved inside a function body instead.
 */
import type {
  EntityId, FeatureLabApi, GameApi, ItemDef, ItemId, ItemStack, LootContainerView, QuestId,
  RegionId, Result, SkillId, SpellId, Vec3,
} from "../contracts.js";
import { content } from "../content/index.js";
import { SKILLS } from "../content/skills.js";
import { keybindings } from "../input/keyboard.js";
import type { KeyBindingRegistry } from "../input/keyboard.js";
import { ContextMenu, notify, reportResult, setNoticeSink } from "./contextMenu.js";
import type { NoticeTone } from "./contextMenu.js";
import type { Tooltip } from "./tooltips.js";
import { DeferredTooltip } from "./deferredTooltip.js";
import { DeferredOverlay } from "./deferredOverlay.js";
import { createItemIcon } from "./itemIcons.js";
import { Hud } from "./hud.js";
import type { DeathDetail } from "./deathScreen.js";
import { TitleScreen, type SaveRecoveryControls } from "./titleScreen.js";
import { SettingsStore } from "./settings.js";
import { PanelDock } from "./dock.js";
import { createSpellActionBar, type ActionBarSpell, type SpellActionBar } from "./spellActionBar.js";
import { createAreaAimSession, type AreaAimHost, type AreaAimSession } from "./areaAim.js";
import { areaFootprintRadius } from "../systems/elementalAttacks.js";
import type { ElementalSpellId } from "../content/elementalSpells.js";
import { SPELL_RANGE } from "../app/config.js";
import { panelInteraction } from "./panelInteraction.js";
import { QuestTracker } from "./questTracker.js";
import { AgentPanel } from "./agentPanel.js";
import type { AgentSession } from "../agent/session.js";
import type { HuntContractsSystem } from "../systems/huntContracts.js";
import { Minimap } from "./minimap.js";
import {
  LazyPanel,
  cancelPendingPanelOpens,
  loadBankPanel,
  loadControlsPanel,
  loadDialoguePanel,
  loadEquipmentPanel,
  loadFeatureLabPanel,
  loadInventoryPanel,
  loadMapPanel,
  loadProductionPanel,
  loadQuestPanel,
  loadSettingsPanel,
  loadShopPanel,
  loadSkillGuidePanel,
  loadSkillsPanel,
  loadSpellbookPanel,
  type BankPanelHandle,
  type DialoguePanelHandle,
  type ShopPanelHandle,
  type ProductionPanelHandle,
  type SkillGuidePanelHandle,
} from "./lazyPanelRegistry.js";

/** The inventory is 28 slots, per PRD section 5. Panels that mirror it use this, never a literal. */
export const INVENTORY_SLOTS = 28;
export const INVENTORY_COLUMNS = 4;

// ------------------------------------------------------------------ formatting

/** Thousands separators up to five digits, then k/m. Tooltips always show the exact number. */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const n = Math.floor(value);
  if (n < 100_000) return n.toLocaleString("en-US");
  if (n < 10_000_000) return `${Math.floor(n / 1000).toLocaleString("en-US")}k`;
  return `${Math.floor(n / 1_000_000).toLocaleString("en-US")}m`;
}

export function formatExact(value: number): string {
  return Math.floor(value).toLocaleString("en-US");
}

/** "iron_ore" becomes "Iron Ore". Only used when content has no def for the id yet. */
export function prettifyId(id: string): string {
  const words = id.split(/[_\-.\s]+/).filter(Boolean);
  if (words.length === 0) return id;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function itemDef(itemId: ItemId): ItemDef | undefined {
  return content.item(itemId);
}

export function itemName(itemId: ItemId): string {
  return content.item(itemId)?.name ?? prettifyId(itemId);
}

export function skillName(skill: SkillId): string {
  return SKILLS[skill].name;
}

export function skillColour(skill: SkillId): string {
  return SKILLS[skill].colour;
}

/** Sell price rule from the frozen ItemDef contract: 60% of value. */
export function itemSellPrice(def: ItemDef | undefined): number {
  return def ? Math.round(def.value * 0.6) : 0;
}

// ------------------------------------------------------------- item glyphs

export function itemGlyphText(itemId: ItemId): string {
  const name = itemName(itemId);
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0] ?? name;
  const second = words[1];
  if (second) return (first.charAt(0) + second.charAt(0)).toUpperCase();
  return first.slice(0, 2).toUpperCase();
}

/** A signature for one slot, used to decide whether a repaint is needed at all. */
export function stackSignature(stack: ItemStack | null | undefined): string {
  return stack ? `${stack.itemId}:${stack.quantity}` : "-";
}

/**
 * Paints one slot button, but only when the stack actually changed, which is why the signature
 * lives on the element itself.
 */
export function paintSlot(cell: HTMLElement, stack: ItemStack | null, emptyLabel?: string): void {
  const signature = `${stackSignature(stack)}|${emptyLabel ?? ""}`;
  if (cell.dataset["sig"] === signature) return;
  cell.dataset["sig"] = signature;
  cell.replaceChildren();

  if (!stack) {
    cell.classList.add("is-empty");
    delete cell.dataset["item"];
    cell.setAttribute("aria-label", emptyLabel ? `${emptyLabel}: empty` : "Empty slot");
    if (emptyLabel) {
      const label = document.createElement("span");
      label.className = "slot__label";
      label.textContent = emptyLabel;
      cell.appendChild(label);
    }
    return;
  }

  cell.classList.remove("is-empty");
  cell.dataset["item"] = stack.itemId;

  const glyph = document.createElement("span");
  glyph.className = "slot__glyph";
  glyph.appendChild(createItemIcon(itemDef(stack.itemId)));
  cell.appendChild(glyph);

  if (stack.quantity > 1) {
    const count = document.createElement("span");
    count.className = "slot__count";
    count.textContent = formatQuantity(stack.quantity);
    cell.appendChild(count);
  }

  cell.setAttribute(
    "aria-label",
    stack.quantity > 1
      ? `${itemName(stack.itemId)}, ${formatExact(stack.quantity)}`
      : itemName(stack.itemId),
  );
}

/**
 * Roving-tabindex arrow navigation over a slot grid. 28 tab stops in the inventory would make the
 * keyboard route unusable, so the grid is one tab stop and the arrows move inside it.
 */
export function installRovingGrid(container: HTMLElement, columns: number): void {
  const cells = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>("[data-slot-index]")];

  container.addEventListener("keydown", (event) => {
    const list = cells();
    const active = document.activeElement;
    const index = list.findIndex((cell) => cell === active);
    if (index < 0) return;

    let next = index;
    switch (event.key) {
      case "ArrowRight": next = index + 1; break;
      case "ArrowLeft": next = index - 1; break;
      case "ArrowDown": next = index + columns; break;
      case "ArrowUp": next = index - columns; break;
      case "Home": next = 0; break;
      case "End": next = list.length - 1; break;
      default: return;
    }

    // The grid owns this key from here, whether or not the move lands.
    //
    // `KeyboardController` listens on `window` and treats the arrows as movement, and a slot is a
    // <button>, which `isTextEntry` deliberately does not count as text entry — so arrow-navigating
    // your pack also walked you across the map, about four metres a second. Stopping propagation is
    // what keeps the two apart, and it has to happen BEFORE the bounds check below: an arrow at the
    // edge of the grid moves nothing, and used to leak to the world for exactly that reason.
    event.preventDefault();
    event.stopPropagation();

    if (next < 0 || next >= list.length) return;
    const target = list[next];
    if (!target) return;
    for (const cell of list) cell.tabIndex = cell === target ? 0 : -1;
    target.focus({ preventScroll: true });
  });

  container.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.dataset["slotIndex"] === undefined) return;
    for (const cell of cells()) cell.tabIndex = cell === target ? 0 : -1;
  });
}

/** A short "this system is not online yet" body. Used wherever the API answers UNAVAILABLE. */
export function emptyState(message: string): HTMLElement {
  const node = document.createElement("p");
  node.className = "empty-state";
  node.textContent = message;
  return node;
}

/** The one place a panel unwraps a Result for a human. Shows `error.message`, never throws. */
export function report<T>(result: Result<T>): boolean {
  return reportResult(result);
}

// -------------------------------------------------------------- the context

/** Read-only access to the same terrain and road geometry used by the playable world. */
export interface MapTerrainSource {
  readonly bounds: Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  sample(x: number, z: number): Readonly<{ height: number; normal: Vec3; regionId: RegionId }>;
  roadPolylines(): Vec3[][];
}

/** What each panel is handed. Everything shared, nothing global. */
export interface UiContext {
  huntContracts?(): HuntContractsSystem | null;
  readonly api: GameApi;
  readonly tooltip: Pick<Tooltip, "attach" | "refresh">;
  readonly menu: ContextMenu;
  readonly registry: KeyBindingRegistry;
  /** Lightweight source for the real terrain-backed map; absent only in isolated UI tests. */
  readonly mapTerrain?: MapTerrainSource;
  /** Projects a world point into viewport pixels for UI anchored to an entity. */
  readonly projectWorldToScreen?: (position: Vec3) => { x: number; y: number; visible: boolean };
  /** True while a bank window is open, so the inventory can offer Deposit. */
  isBankOpen(): boolean;
  /** True while a shop window is open, so the inventory can offer Sell. */
  isShopOpen(): boolean;
  deposit(itemId: ItemId, quantity: number): void;
  sell(itemId: ItemId, quantity: number): void;
  /** Pin a quest to the floating tracker card, or null to unpin. */
  pinQuest(questId: QuestId | null): void;
  /** The quest currently pinned to the tracker, or null. */
  pinnedQuestId(): QuestId | null;
  /** Repaint every open panel now. Called after any mutation so the player sees the result. */
  refresh(): void;
  /**
   * The one spell verb the spellbook and the action bars share: a basic becomes the standing
   * spell, a targeted invocation fires once at the current target, an area invocation opens the
   * ground reticle. Errors are reported to the player, never thrown.
   */
  activateSpell(spellId: SpellId): void;
  /** Puts a spell in the first empty visible action bar slot. Absent when no bar is mounted. */
  assignToActionBar?(spellId: SpellId): boolean;
  /** The notice channel, for a panel that has to tell the player something in passing. */
  notify(message: string, tone?: NoticeTone): void;
}

/** The lifecycle used by both a concrete `PanelFrame` and a deferred panel proxy. */
export interface PanelHandle {
  mount(parent: HTMLElement): void;
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
  dispose(): void;
}

/** Every panel this module manages looks like this. */
export interface ManagedPanel {
  readonly frame: PanelHandle;
  refresh(force?: boolean): void;
  dispose(): void;
}

// ------------------------------------------------------------------- the UI

export interface UiOptions {
  saveRecovery?: SaveRecoveryControls;
  registry?: KeyBindingRegistry;
  /** Existing client-preference store, when boot must apply audio before the UI is constructed. */
  settings?: SettingsStore;
  mapTerrain?: MapTerrainSource;
  /** Projects a world point into viewport pixels for compact world-anchored UI. */
  projectWorldToScreen?: (position: Vec3) => { x: number; y: number; visible: boolean };
  /** True when boot found a save. The title screen offers "Continue" rather than "Begin". */
  hasSave?(): boolean;
  /**
   * Clears the save and rebuilds the world. The root wires `resetWorld`; the UI must not reach
   * into persistence or the world layer itself.
   */
  onNewGame?(): void;
  /**
   * World heading the view is looking along, radians, 0 = +Z (north), increasing toward +X.
   * Only the compass uses it. Omitted, the compass shows absolute bearings with north fixed up,
   * which is still correct, just not view-relative.
   */
  getHeadingRad?(): number;
  /**
   * Where the player is currently walking to, or null when idle. Read by the minimap for its
   * destination marker. Comes from the store because `GameApi` does not expose the live path.
   */
  getDestination?(): Vec3 | null;
  /** Present only in the transient real-engine lab; enables setup controls in production panels. */
  featureLab?: FeatureLabApi;
  /**
   * The ground reticle and picker for placing area invocations. Without it, area spells fall back
   * to landing under the current target, which is what the agent surface does anyway.
   */
  areaAim?: AreaAimHost;
  /**
   * Suppresses the world action bars. The spell range lab mounts its own bar over the same slot
   * with range semantics, and two bars answering the same digit would fire twice.
   */
  actionBars?: boolean;
  /** The collaboration session, when the agent surface is installed. Drives the agent panel. */
  agentSession?: AgentSession;
}

export interface Ui {
  setHuntContracts(hunts: HuntContractsSystem | null): void;
  mount(root: HTMLElement): void;
  /** Call once a frame. Internally throttled; it does not repaint per frame. */
  update(): void;
  dispose(): void;
  /** Opens the bank window. The world layer calls this when a bank interaction succeeds. */
  openBank(entityId?: EntityId): void;
  /** Opens the shop window for a shop entity. */
  openShop(shopId?: EntityId): void;
  /** Opens recipe selection for a production station. */
  openProduction(entityId: EntityId): void;
  /** Raises the conversation window. The root calls this on `dialogue.opened`. */
  openDialogue(): void;
  /** Dismisses it. The root calls this on `dialogue.closed`. */
  closeDialogue(): void;
  /** Shows the death report. The root calls this on `player.died` with the event payload. */
  showDeath(detail: DeathDetail): void;
  /** Opens the read-only contents grid beside a world loot container. */
  openLoot(container: LootContainerView): void;
  /** Raises the title and pause screen. */
  openTitle(): void;
  /** The quest the tracker is pinned to. The guidance layer marks its objective in the world. */
  pinnedQuestId(): QuestId | null;
  /** Live client preferences. The root subscribes to apply them. */
  readonly settings: SettingsStore;
  /** The notice channel, for anything outside the UI that needs to tell the player something. */
  notify(message: string, tone?: NoticeTone): void;
}

const HUD_INTERVAL_MS = 100;
const PANEL_INTERVAL_MS = 220;

/**
 * The single entry point. One call at boot, one `update()` a frame, one `dispose()` on teardown.
 */
export function createUi(api: GameApi, options: UiOptions = {}): Ui {
  let hunts: HuntContractsSystem | null = null;
  let lastUiRegion: RegionId | null = null;
  const registry = options.registry ?? keybindings;
  const settings = options.settings ?? new SettingsStore();
  const tooltip = new DeferredTooltip(api, (error) => loadError("Item details")(error));
  let production: LazyPanel<ProductionPanelHandle> | null = null;
  let cancelProductionOpen: (() => void) | null = null;
  const menu = new ContextMenu({
    api,
    skillLabel: skillName,
    onProduction: openProduction,
  });

  let bank: LazyPanel<BankPanelHandle> | null = null;
  let shop: LazyPanel<ShopPanelHandle> | null = null;

  const tracker = new QuestTracker(api, () => hunts, tooltip);
  const agentPanel = options.agentSession
    ? new AgentPanel({ session: options.agentSession, now: () => api.getTime().simMs, settings, tooltip })
    : null;

  const context: UiContext = {
    huntContracts: () => hunts,
    api,
    tooltip,
    menu,
    registry,
    mapTerrain: options.mapTerrain,
    projectWorldToScreen: options.projectWorldToScreen,
    isBankOpen: () => bank?.frame.isOpen() ?? false,
    isShopOpen: () => shop?.frame.isOpen() ?? false,
    deposit: (itemId, quantity) => { bank?.withPanel((panel) => panel.deposit(itemId, quantity)); },
    sell: (itemId, quantity) => { shop?.withPanel((panel) => panel.sell(itemId, quantity)); },
    pinQuest: (questId) => { tracker.pin(questId); },
    pinnedQuestId: () => tracker.pinnedId(),
    refresh: () => refreshAll(true),
    activateSpell,
    assignToActionBar: (spellId) => actionBar?.assign(spellId) ?? false,
    notify: (message, tone) => notify(message, tone),
  };

  // ---- the spell action bars and the ground reticle for area invocations
  //
  // Built before the panels so the spellbook can hand tiles to them. `catalogue()` is read from the
  // same spellbook view the panel paints from, so a slot and a tile never disagree about whether a
  // spell is castable.
  const spellCatalogue = (): ActionBarSpell[] => api.getSpellbook().spells.map((row) => ({
    id: row.id, name: row.name, element: row.element, rung: row.rung, rank: row.rank,
    unlocked: row.unlocked, castable: row.castable, blockedBy: row.blockedBy, description: row.description,
  }));
  const areaAim: AreaAimSession | null = options.areaAim ? createAreaAimSession({
    host: options.areaAim,
    casterPosition: () => api.getPlayer().position,
    cast: (spellId, point) => {
      const result = api.castArea(spellId, point);
      if (!result.ok) {
        notify(result.error.message, "error");
        // Out of range keeps the reticle up so the player can pick a nearer spot; anything else ends it.
        return result.error.code !== "OUT_OF_RANGE";
      }
      refreshAll(true);
      return true;
    },
    notify: (message) => notify(message),
  }) : null;
  const actionBar: SpellActionBar | null = options.actionBars === false ? null : createSpellActionBar({
    catalogue: spellCatalogue,
    activate: activateSpell,
    registry,
    storageKey: "corealm.action-bars.v2",
    // First run: the four entry spells, one per element, in the order the regions open them.
    defaults: [["voltrend", "stonebrand", "rimewash", "emberlash", null, null, null, null]],
    defaultVisible: 1,
    notify: (message) => notify(message),
    tooltip,
  });

  function activateSpell(spellId: SpellId): void {
    const book = api.getSpellbook();
    const row = book.spells.find((entry) => entry.id === spellId);
    if (!row) return;
    if (row.rank === 0) {
      areaAim?.cancel();
      if (report(api.setPreferredSpell(book.preferredSpellId === spellId ? null : spellId))) refreshAll(true);
      return;
    }
    if (!row.castable) {
      notify(row.blockedBy ?? `${row.name} cannot be cast right now.`, "error");
      return;
    }
    if (book.castLock) {
      notify(`${book.spells.find((entry) => entry.id === book.castLock!.spellId)?.name ?? "The invocation"} is still resolving.`);
      return;
    }
    if (row.aoe && areaAim) {
      areaAim.begin({
        spellId, name: row.name, element: row.element,
        radius: areaFootprintRadius(spellId as ElementalSpellId), range: SPELL_RANGE,
      });
      return;
    }
    areaAim?.cancel();
    if (report(api.castNow(spellId))) refreshAll(true);
  }

  const loadError = (title: string) => (error: unknown): void => {
    console.error(`[ui] Could not load ${title}`, error);
    notify(`Could not open ${title}. Try again.`, "error");
  };
  const hud = new Hud(context, options);
  const loot = new DeferredOverlay<LootContainerView>({
    registry,
    load: async () => {
      const { LootReveal } = await import("./lootReveal.js");
      return new LootReveal(context);
    },
    onError: loadError("Loot"),
  });
  const inventory = new LazyPanel({
    id: "inventory", title: "Inventory", key: "i", keyLabel: "Inventory", registry,
    load: () => loadInventoryPanel(context), onError: loadError("Inventory"),
  });
  const skillGuide = new LazyPanel<SkillGuidePanelHandle>({
    id: "skill-guide", title: "Skill guide", registry,
    load: () => loadSkillGuidePanel(context), onError: loadError("Skill guide"),
  });
  const skills = new LazyPanel({
    id: "skills", title: "Skills", key: "k", keyLabel: "Skills", registry,
    load: () => loadSkillsPanel(context, (skill) => {
      skillGuide.withPanel((panel) => panel.openFor(skill));
    }),
    onError: loadError("Skills"),
  });
  const equipment = new LazyPanel({
    id: "equipment", title: "Equipment", key: "e", keyLabel: "Equipment", registry,
    load: () => loadEquipmentPanel(context, options.featureLab), onError: loadError("Equipment"),
  });
  production = new LazyPanel<ProductionPanelHandle>({
    id: "production", title: "Production", registry,
    load: () => loadProductionPanel(context),
    onError: (error) => {
      cancelProductionOpen?.();
      loadError("Production")(error);
    },
  });
  const quests = new LazyPanel({
    id: "quests", title: "Quests", key: "j", keyLabel: "Quests", registry,
    load: () => loadQuestPanel(context), onError: loadError("Quests"),
  });
  const dialogue = new LazyPanel<DialoguePanelHandle>({
    id: "dialogue", title: "Conversation", registry,
    load: () => loadDialoguePanel(context), onError: loadError("Conversation"),
  });
  const controls = new LazyPanel({
    id: "controls", title: "Controls", key: "h", keyLabel: "Controls", registry,
    load: () => loadControlsPanel(context), onError: loadError("Controls"),
  });
  const map = new LazyPanel({
    id: "map", title: "Map", key: "m", keyLabel: "Map", registry,
    load: () => loadMapPanel(context), onError: loadError("Map"),
  });
  const spellbook = new LazyPanel({
    id: "spellbook", title: "Spellbook", key: "b", keyLabel: "Spellbook", registry,
    load: () => loadSpellbookPanel(context), onError: loadError("Spellbook"),
  });
  const featureLab = options.featureLab ? new LazyPanel({
    id: "feature-lab", title: "Feature lab", key: "l", keyLabel: "Feature lab", registry,
    load: () => loadFeatureLabPanel(context, options.featureLab!), onError: loadError("Feature lab"),
  }) : null;
  let titleCoveredBySettings = false;
  const settingsPanel = new LazyPanel({
    id: "settings", title: "Settings", registry,
    load: () => loadSettingsPanel(context, settings, () => {
      if (!titleCoveredBySettings) return;
      titleCoveredBySettings = false;
      title.setCovered(false);
    }, options.saveRecovery),
    onError: loadError("Settings"),
  });
  bank = new LazyPanel<BankPanelHandle>({
    id: "bank", title: "Bank", registry,
    load: () => loadBankPanel(context), onError: loadError("Bank"),
  });
  shop = new LazyPanel<ShopPanelHandle>({
    id: "shop", title: "Shop", registry,
    load: () => loadShopPanel(context), onError: loadError("Shop"),
  });
  const panels: ManagedPanel[] = [
    inventory, skills, skillGuide, equipment, production, quests, map, controls, dialogue, settingsPanel,
    bank, shop, spellbook,
    ...(featureLab ? [featureLab] : []),
  ];

  const death = new DeferredOverlay<DeathDetail>({
    registry,
    load: async () => {
      const { DeathScreen } = await import("./deathScreen.js");
      return new DeathScreen(context);
    },
    onError: loadError("Death report"),
  });
  const title = new TitleScreen({
    saveRecovery: options.saveRecovery,
    hasSave: () => options.hasSave?.() ?? false,
    onNewGame: () => {
      dismissTransient();
      death.hide();
      settingsPanel.frame.close();
      options.onNewGame?.();
      title.close();
    },
    onSettings: () => {
      // Keep the menu usable while the optional controls load, including Escape and retries.
      settingsPanel.withPanel((panel) => {
        if (!title.isOpen()) return;
        titleCoveredBySettings = true;
        title.setCovered(true);
        panel.frame.open();
      });
    },
    onClose: () => {
      cancelProductionOpen?.();
      settingsPanel.frame.close();
      title.close();
    },
  });

  // Built after the map and the title screen exist: its corner buttons drive both.
  const minimap = options.mapTerrain
    ? new Minimap(api, options.mapTerrain, options.getDestination, options.getHeadingRad, {
        onOpenMap: () => map.frame.toggle(),
        onMenu: () => {
          cancelPendingPanelOpens(registry);
          cancelProductionOpen?.();
          death.cancelPending();
          loot.cancelPending();
          title.open();
        },
        tooltip,
      })
    : null;

  // Every panel gets a permanent on-screen button that prints its own key. The bank and the shop
  // are deliberately not on it: both are opened by standing at one, and a button that answers
  // "you are not at a bank" is worse than no button.
  const dock = new PanelDock([
    ...(featureLab ? [{ id: "feature-lab", label: "Lab", key: "l", icon: "lab" as const,
      toggle: () => featureLab.frame.toggle(), isOpen: () => featureLab.frame.isOpen() }] : []),
    { id: "inventory", label: "Inv", key: "i", icon: "pack",
      toggle: () => inventory.frame.toggle(), isOpen: () => inventory.frame.isOpen(),
      badge: () => {
        const used = api.getInventory().slots.filter((slot) => slot !== null).length;
        return used >= INVENTORY_SLOTS ? "FULL" : "";
      } },
    { id: "skills", label: "Skills", key: "k", icon: "skills",
      toggle: () => skills.frame.toggle(), isOpen: () => skills.frame.isOpen() },
    { id: "equipment", label: "Worn", key: "e", icon: "equipment",
      toggle: () => equipment.frame.toggle(), isOpen: () => equipment.frame.isOpen() },
    { id: "quests", label: "Quests", key: "j", icon: "quests",
      toggle: () => quests.frame.toggle(), isOpen: () => quests.frame.isOpen(),
      badge: () => {
        const active = api.getQuests().filter((quest) => quest.status === "active").length;
        return active > 0 ? String(active) : "";
      } },
    // The spellbook stands where the map button used to. The map is one click away on the minimap's
    // own corner button (`ui/minimap.ts`, "Full map (M)") and keeps its "m" binding, so a second
    // dock entry for it was the least useful button on the bar; the spellbook, with sixteen spells
    // behind it, is the most. The map panel itself is unchanged and still registered below.
    { id: "spellbook", label: "Spells", key: "b", icon: "spells",
      toggle: () => spellbook.frame.toggle(), isOpen: () => spellbook.frame.isOpen(),
      // The badge is the element the player has chosen, or nothing while the game is choosing for
      // them. A caster who set fire and then out-levelled it needs to see that from the dock,
      // without opening the book to find out why their damage stopped climbing.
      badge: () => {
        const book = api.getSpellbook();
        if (!book.preferredSpellId) return "";
        return book.spells.find((row) => row.id === book.preferredSpellId)?.element.slice(0, 1).toUpperCase() ?? "";
      } },
    { id: "controls", label: "Keys", key: "h", icon: "keys",
      toggle: () => controls.frame.toggle(), isOpen: () => controls.frame.isOpen() },
  ], tooltip);

  let mounted = false;
  let lastHudMs = 0;
  let lastPanelMs = 0;

  function openProduction(entityId: EntityId): void {
    cancelProductionOpen?.();
    if (title.isOpen()) return;
    const generation = panelInteraction.generation;
    const popEscape = registry.pushEscapeHandler(() => { cancel(); return true; });
    const cancel = () => {
      popEscape();
      if (cancelProductionOpen === cancel) cancelProductionOpen = null;
    };
    cancelProductionOpen = cancel;
    production?.withPanel((panel) => {
      const requested = cancelProductionOpen === cancel;
      cancel();
      // A station selected before loading must not replace a newer menu or panel.
      if (requested && !title.isOpen() && generation === panelInteraction.generation) panel.openFor(entityId);
    });
  }

  function refreshAll(force: boolean): void {
    for (const panel of panels) {
      if (panel.frame.isOpen()) panel.refresh(force);
    }
  }

  function dismissTransient(): void {
    cancelPendingPanelOpens(registry);
    cancelProductionOpen?.();
    areaAim?.cancel();
    menu.close();
    loot.hide();
    for (const panel of panels) panel.frame.close();
    tooltip.refresh();
  }

  return {
    setHuntContracts(next: HuntContractsSystem | null): void {
      hunts = next;
      refreshAll(true);
    },
    mount(root: HTMLElement): void {
      if (mounted) return;
      mounted = true;
      hud.mount(root);
      // The minimap owns the top-right corner; the HUD's purse cluster steps down below it.
      if (minimap) {
        minimap.mount(root);
        root.querySelector(".hud")?.classList.add("has-minimap");
      }
      tracker.mount(root);
      agentPanel?.mount(root);
      dock.mount(root);
      actionBar?.mount(root);
      loot.mount(root);
      for (const panel of panels) panel.frame.mount(root);
      if (new URLSearchParams(location.search).get("spells") !== "1") featureLab?.frame.open();
      // Both of these cover the screen, so they mount last and sit above the panels.
      death.mount(root);
      title.mount(root);
      tooltip.mount(root);
      // The HUD owns the toast channel from here; the context menu's fallback strip stands down.
      setNoticeSink((message, tone) => hud.pushNotice(message, tone));
    },

    update(): void {
      if (!mounted) return;
      const region = api.getPlayer().regionId;
      if (lastUiRegion !== null && region !== lastUiRegion) dismissTransient();
      lastUiRegion = region;
      loot.update();
      const now = performance.now();
      if (now - lastHudMs >= HUD_INTERVAL_MS) {
        lastHudMs = now;
        hud.update(now);
        dock.update();
        death.update();
        minimap?.update(now);
        if (actionBar) {
          const book = api.getSpellbook();
          actionBar.refresh();
          actionBar.select(book.preferredSpellId);
          actionBar.setCastLock(book.castLock, api.getTime().simMs);
        }
        areaAim?.update();
      }
      if (now - lastPanelMs >= PANEL_INTERVAL_MS) {
        lastPanelMs = now;
        refreshAll(false);
        tooltip.refresh();
        tracker.update();
        agentPanel?.update();
      }
    },

    dispose(): void {
      cancelProductionOpen?.();
      setNoticeSink(null);
      areaAim?.dispose();
      actionBar?.dispose();
      minimap?.dispose();
      tracker.dispose();
      agentPanel?.dispose();
      dock.dispose();
      loot.dispose();
      death.dispose();
      title.dispose();
      for (const panel of panels) panel.dispose();
      hud.dispose();
      tooltip.dispose();
      menu.dispose();
      mounted = false;
    },

    openBank(entityId?: EntityId): void {
      bank?.withPanel((panel) => panel.openFor(entityId));
    },

    openShop(shopId?: EntityId): void {
      shop?.withPanel((panel) => panel.openFor(shopId));
    },

    openProduction,

    openDialogue(): void {
      dialogue.withPanel((panel) => panel.openFor());
    },

    closeDialogue(): void {
      dialogue.frame.close();
    },

    showDeath(detail: DeathDetail): void {
      dismissTransient();
      const generation = panelInteraction.generation;
      death.show(detail, () => !title.isOpen() && generation === panelInteraction.generation);
    },

    openLoot(container: LootContainerView): void {
      death.cancelPending();
      const generation = panelInteraction.generation;
      loot.show(container, () => !title.isOpen() && generation === panelInteraction.generation);
    },

    openTitle(): void {
      cancelPendingPanelOpens(registry);
      cancelProductionOpen?.();
      death.cancelPending();
      loot.cancelPending();
      title.open();
    },

    pinnedQuestId(): QuestId | null {
      return tracker.pinnedId();
    },

    settings,

    notify(message: string, tone: NoticeTone = "info"): void {
      notify(message, tone);
    },
  };
}
