/**
 * Deferred panel construction and the import boundaries for optional UI.
 *
 * The small key proxy matters. A panel normally registers its shortcut in the
 * `PanelFrame` constructor, but that constructor cannot run until its chunk has
 * loaded. `LazyPanel` registers the same binding up front, then the real frame
 * replaces it when construction finishes.
 */
import type { EntityId, FeatureLabApi, ItemId, SkillId } from "../contracts.js";
import type { KeyBindingRegistry, Unregister } from "../input/keyboard.js";
import type { ManagedPanel, PanelHandle, UiContext } from "./panels.js";
import type { SettingsStore } from "./settings.js";
import type { SaveRecoveryControls } from "./titleScreen.js";
import { panelInteraction } from "./panelInteraction.js";

const pendingPanels = new WeakMap<KeyBindingRegistry, Set<{ cancelPending(): void }>>();

/** A title transition cancels unfinished requests without closing panels already on screen. */
export function cancelPendingPanelOpens(registry: KeyBindingRegistry): void {
  for (const panel of pendingPanels.get(registry) ?? []) panel.cancelPending();
}

export interface LazyPanelOptions<T extends ManagedPanel> {
  readonly id: string;
  readonly title: string;
  readonly registry: KeyBindingRegistry;
  readonly key?: string;
  readonly keyLabel?: string;
  load(): Promise<T>;
  onError?(error: unknown): void;
}

/** A panel-shaped handle whose implementation arrives on first use. */
export class LazyPanel<T extends ManagedPanel> implements ManagedPanel {
  readonly frame: PanelHandle;

  private panel: T | null = null;
  private loading: Promise<T | null> | null = null;
  private mountTarget: HTMLElement | null = null;
  private desiredOpen: boolean | null = null;
  private openGeneration: number | null = null;
  private popPendingEscape: Unregister | null = null;
  private actionGeneration = 0;
  private disposed = false;
  private readonly unregister: Unregister | null;

  constructor(private readonly options: LazyPanelOptions<T>) {
    let panels = pendingPanels.get(options.registry);
    if (!panels) {
      panels = new Set();
      pendingPanels.set(options.registry, panels);
    }
    panels.add(this);
    this.frame = {
      mount: (parent) => { this.mount(parent); },
      isOpen: () => this.isOpen(),
      open: () => { this.open(); },
      close: () => { this.close(); },
      toggle: () => { this.toggle(); },
      dispose: () => { this.dispose(); },
    };

    this.unregister = options.key
      ? options.registry.register({
          id: `panel.${options.id}`,
          keys: [options.key],
          label: options.keyLabel ?? `Toggle ${options.title}`,
          group: "Panels",
          onDown: () => {
            this.toggle();
            return true;
          },
        })
      : null;
  }

  /** Runs a panel-specific operation now, or as soon as its module loads. */
  withPanel(action: (panel: T) => void): void {
    if (this.disposed) return;
    if (this.panel) {
      action(this.panel);
      return;
    }
    const generation = this.actionGeneration;
    void this.ensureLoaded().then((panel) => {
      if (panel && !this.disposed && generation === this.actionGeneration) action(panel);
    });
  }

  refresh(force = false): void {
    if (this.panel?.frame.isOpen()) this.panel.refresh(force);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending();
    pendingPanels.get(this.options.registry)?.delete(this);
    this.panel?.dispose();
    this.panel = null;
    this.unregister?.();
    this.mountTarget = null;
  }

  cancelPending(): void {
    this.actionGeneration += 1;
    this.desiredOpen = false;
    this.clearPendingOpen();
  }

  private mount(parent: HTMLElement): void {
    if (this.disposed) return;
    this.mountTarget = parent;
    this.panel?.frame.mount(parent);
  }

  private isOpen(): boolean {
    if (this.panel) return this.panel.frame.isOpen();
    return this.desiredOpen === true;
  }

  private open(): void {
    if (this.disposed) return;
    if (this.panel) {
      this.panel.frame.open();
      return;
    }
    this.clearPendingOpen();
    this.desiredOpen = true;
    this.openGeneration = ++panelInteraction.generation;
    this.popPendingEscape = this.options.registry.pushEscapeHandler(() => {
      const current = this.openGeneration === panelInteraction.generation;
      this.close();
      return current;
    });
    void this.ensureLoaded();
  }

  private close(): void {
    this.cancelPending();
    this.panel?.frame.close();
  }

  private clearPendingOpen(): void {
    this.openGeneration = null;
    this.popPendingEscape?.();
    this.popPendingEscape = null;
  }

  private toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  private ensureLoaded(): Promise<T | null> {
    if (this.panel) return Promise.resolve(this.panel);
    if (this.loading) return this.loading;

    this.loading = this.options.load().then((panel) => {
      if (this.disposed) {
        panel.dispose();
        return null;
      }
      this.panel = panel;
      if (this.mountTarget) panel.frame.mount(this.mountTarget);
      const mayOpen = this.desiredOpen === true && this.openGeneration === panelInteraction.generation;
      this.clearPendingOpen();
      if (mayOpen) panel.frame.open();
      else if (this.desiredOpen === false) panel.frame.close();
      this.desiredOpen = null;
      return panel;
    }).catch((error: unknown) => {
      this.clearPendingOpen();
      this.desiredOpen = null;
      this.options.onError?.(error);
      return null;
    }).finally(() => {
      this.loading = null;
    });

    return this.loading;
  }
}

export interface SkillGuidePanelHandle extends ManagedPanel {
  openFor(skill: SkillId): void;
}

export interface ProductionPanelHandle extends ManagedPanel {
  openFor(entityId: EntityId): void;
}

export interface BankPanelHandle extends ManagedPanel {
  openFor(entityId?: EntityId): void;
  deposit(itemId: ItemId, quantity: number): void;
}

export interface ShopPanelHandle extends ManagedPanel {
  openFor(shopId?: EntityId): void;
  sell(itemId: ItemId, quantity: number): void;
}

export interface DialoguePanelHandle extends ManagedPanel {
  openFor(): void;
}

export async function loadInventoryPanel(context: UiContext): Promise<ManagedPanel> {
  const { InventoryPanel } = await import("./inventoryPanel.js");
  return new InventoryPanel(context);
}

export async function loadProductionPanel(context: UiContext): Promise<ProductionPanelHandle> {
  const { ProductionPanel } = await import("./productionPanel.js");
  return new ProductionPanel(context);
}

export async function loadSkillGuidePanel(context: UiContext): Promise<SkillGuidePanelHandle> {
  const { SkillGuidePanel } = await import("./skillGuidePanel.js");
  return new SkillGuidePanel(context);
}

export async function loadSkillsPanel(
  context: UiContext,
  openGuide: (skill: SkillId) => void,
): Promise<ManagedPanel> {
  const { SkillsPanel } = await import("./skillsPanel.js");
  return new SkillsPanel(context, openGuide);
}

export async function loadEquipmentPanel(
  context: UiContext,
  featureLab?: FeatureLabApi,
): Promise<ManagedPanel> {
  const { EquipmentPanel } = await import("./equipmentPanel.js");
  return new EquipmentPanel(context, featureLab);
}

let featureLabPanelModulePromise: Promise<typeof import("./featureLabPanel.js")> | null = null;

function featureLabPanelModule(): Promise<typeof import("./featureLabPanel.js")> {
  featureLabPanelModulePromise ??= import("./featureLabPanel.js");
  return featureLabPanelModulePromise;
}

/** Starts the required lab workbench chunk while the production scene is still booting. */
export function preloadFeatureLabPanel(): void {
  // Construction still owns user-facing error handling. This catch only prevents an early failed
  // fetch from becoming an unhandled rejection before the LazyPanel awaits the shared promise.
  void featureLabPanelModule().catch(() => undefined);
}

export async function loadFeatureLabPanel(
  context: UiContext,
  featureLab: FeatureLabApi,
): Promise<ManagedPanel> {
  const { FeatureLabPanel } = await featureLabPanelModule();
  return new FeatureLabPanel(context, featureLab);
}

export async function loadBankPanel(context: UiContext): Promise<BankPanelHandle> {
  const { BankPanel } = await import("./bankPanel.js");
  return new BankPanel(context);
}

export async function loadShopPanel(context: UiContext): Promise<ShopPanelHandle> {
  const { ShopPanel } = await import("./shopPanel.js");
  return new ShopPanel(context);
}

export async function loadQuestPanel(context: UiContext): Promise<ManagedPanel> {
  const { QuestPanel } = await import("./questPanel.js");
  return new QuestPanel(context);
}

export async function loadDialoguePanel(context: UiContext): Promise<DialoguePanelHandle> {
  const { DialoguePanel } = await import("./dialoguePanel.js");
  return new DialoguePanel(context);
}

export async function loadControlsPanel(context: UiContext): Promise<ManagedPanel> {
  const { ControlsPanel } = await import("./controlsPanel.js");
  return new ControlsPanel(context);
}

export async function loadSettingsPanel(
  context: UiContext, settings: SettingsStore, onClose: () => void, saveRecovery?: SaveRecoveryControls,
): Promise<ManagedPanel> {
  const { SettingsPanel } = await import("./settingsPanel.js");
  return new SettingsPanel(context, settings, onClose, saveRecovery);
}

export async function loadMapPanel(context: UiContext): Promise<ManagedPanel> {
  const { MapPanel } = await import("./mapPanel.js");
  return new MapPanel(context);
}

export async function loadSpellbookPanel(context: UiContext): Promise<ManagedPanel> {
  const { SpellbookPanel } = await import("./spellbookPanel.js");
  return new SpellbookPanel(context);
}
