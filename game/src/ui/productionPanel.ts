import { sendGameCommand } from "../api/commands.js";
import { PanelFrame } from "./panelFrame.js";
import { QuantitySelector } from "./quantitySelector.js";
import type {
  EntityId, EssenceTomeView, GameApi, ItemId, ItemStack, SemanticEntity, SkillId, StationKind,
} from "../contracts.js";
import { burnChance, content, type RecipeDef } from "../content/index.js";
import { notify } from "./contextMenu.js";
import { createItemIcon } from "./itemIcons.js";
import { emptyState, formatQuantity, itemDef, itemName, report, skillName, stackSignature, type ManagedPanel, type UiContext } from "./panels.js";

/** GameApi.produceAt accepts batches of at most 28, even when the ingredients stack. */
const MAX_PRODUCTION_BATCH = 28;

/**
 * Recipe selection for one inspected station.
 *
 * Content owns the rows and `GameApi.produce` owns every rule. This panel only mirrors level,
 * ingredient, station, and cooking-burn information so choosing a batch does not require a blind
 * API call. A portable fire is an ordinary `station.kind === "campfire"` here.
 */
export class ProductionPanel implements ManagedPanel {
  readonly frame: PanelFrame;

  private readonly quantity: QuantitySelector;
  private readonly stationLine: HTMLElement;
  private readonly fireLine: HTMLElement;
  private readonly list: HTMLElement;
  private stationId: EntityId | null = null;
  private signature = "";

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "production",
      title: "Production",
      registry: ctx.registry,
      placement: { top: "64px", left: "calc(50% - 240px)", width: "480px" },
      group: "center",
      onOpen: () => this.refresh(true),
    });

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar production-toolbar";
    this.quantity = new QuantitySelector("Batch", () => this.refresh(true));
    toolbar.appendChild(this.quantity.root);

    const station = document.createElement("div");
    station.className = "production-station";
    this.stationLine = document.createElement("div");
    this.stationLine.className = "production-station__name";
    this.fireLine = document.createElement("div");
    this.fireLine.className = "production-station__fire u-dim";
    this.fireLine.hidden = true;
    station.append(this.stationLine, this.fireLine);

    this.list = document.createElement("div");
    this.list.className = "production-list";
    this.list.setAttribute("role", "list");

    this.frame.body.append(toolbar, station, this.list);
  }

  openFor(entityId: EntityId): void {
    const inspected = this.ctx.api.inspect(entityId);
    if (!inspected.ok) {
      report(inspected);
      return;
    }
    if (!inspected.value.station) {
      notify(`${inspected.value.name} is not a production station.`, "error");
      return;
    }

    this.stationId = entityId;
    this.signature = "";
    this.frame.setSubtitle(inspected.value.name);
    this.frame.open();
    this.refresh(true);
  }

  refresh(force = false): void {
    if (!this.stationId) return;
    const inspected = this.ctx.api.inspect(this.stationId);
    if (!inspected.ok) {
      const message = inspected.error.message;
      if (force || this.signature !== `missing:${message}`) {
        this.signature = `missing:${message}`;
        this.stationLine.textContent = message;
        this.fireLine.hidden = true;
        this.list.replaceChildren(emptyState(message));
      }
      return;
    }

    const entity = inspected.value;
    const station = entity.station;
    if (!station) {
      const message = "This station is no longer available.";
      if (force || this.signature !== `missing:${message}`) {
        this.signature = `missing:${message}`;
        this.stationLine.textContent = message;
        this.fireLine.hidden = true;
        this.list.replaceChildren(emptyState(message));
      }
      return;
    }
    const recipes = this.recipesFor(station.kind, station.skill, station.recipeIds);
    const tomes = station.kind === "essence_altar" ? this.ctx.api.essenceTomes() : [];
    const inventory = this.ctx.api.getInventory();
    const skills = this.ctx.api.getSkills();
    const activity = this.ctx.api.getActivity();
    const selectedRemainingMs = campfireRemainingMs(entity, this.ctx.api);
    const nearbyFire = station.kind === "campfire" ? null : this.nearbyCampfire();
    const nearbyRemainingMs = nearbyFire ? campfireRemainingMs(nearbyFire, this.ctx.api) : null;
    const remainingToken = selectedRemainingMs === null ? "-" : Math.ceil(selectedRemainingMs / 1_000);
    const nearbyToken = nearbyRemainingMs === null ? "-" : Math.ceil(nearbyRemainingMs / 1_000);
    const signature = [
      entity.id, entity.state, station.kind, station.skill,
      ...inventory.slots.map(stackSignature),
      ...recipes.map((recipe) => `${recipe.id}:${skills[recipe.skill]?.level ?? 1}`),
      ...tomes.flatMap((tome) => tome.essences.map((essence) => `${tome.itemId}:${essence.itemId}:${essence.charges}:${essence.carried}:${essence.canImbue}`)),
      activity ? `${activity.kind}:${activity.recipeId ?? "-"}:${activity.completed}:${activity.remaining}` : "idle",
      remainingToken, nearbyFire?.id ?? "-", nearbyToken,
    ].join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;

    this.frame.setSubtitle(entity.name);
    this.stationLine.textContent = `${stationLabel(station.kind)} · ${skillName(station.skill)}`;
    this.paintFireLine(entity, selectedRemainingMs, nearbyFire, nearbyRemainingMs);

    const fragment = document.createDocumentFragment();
    if (station.kind === "essence_altar") fragment.appendChild(this.tomeRechargeSection(tomes));
    if (recipes.length === 0 && station.kind !== "essence_altar") {
      fragment.appendChild(emptyState("This station has no compatible recipes."));
    }
    for (const recipe of recipes) {
      fragment.appendChild(this.recipeRow(recipe, inventory.slots, skills[recipe.skill]?.level ?? 1, activity));
    }
    this.list.replaceChildren(fragment);
  }

  private tomeRechargeSection(tomes: readonly EssenceTomeView[]): HTMLElement {
    const section = document.createElement("section");
    section.setAttribute("aria-label", "Essence tome imbuing");
    const heading = document.createElement("h3");
    heading.className = "production-row__name";
    heading.textContent = "Imbue essence tomes";
    const instruction = document.createElement("p");
    instruction.className = "production-row__details u-dim";
    instruction.textContent = "Carry a tome and enough essence to an awakened altar. Each full recharge fills one essence type.";
    section.append(heading, instruction);
    if (tomes.length === 0) {
      section.appendChild(emptyState("Carry an essence tome to imbue it here."));
      return section;
    }
    for (const tome of tomes) {
      for (const essence of tome.essences) section.appendChild(this.tomeRechargeRow(tome, essence));
    }
    return section;
  }

  private tomeRechargeRow(tome: EssenceTomeView, essence: EssenceTomeView["essences"][number]): HTMLElement {
    const root = document.createElement("article");
    root.className = "production-row";
    root.setAttribute("role", "listitem");
    const glyph = document.createElement("span");
    glyph.className = "slot__glyph production-row__glyph";
    glyph.appendChild(createItemIcon(itemDef(essence.itemId)));
    const text = document.createElement("div");
    text.className = "production-row__text";
    const name = document.createElement("div");
    name.className = "production-row__name";
    name.textContent = `${tome.name} · ${essence.name}`;
    const cost = document.createElement("div");
    cost.className = "production-row__ingredients";
    cost.textContent = `${formatQuantity(tome.essencePerRecharge)} ${essence.name} for a full recharge`;
    const status = document.createElement("div");
    status.className = "production-row__details u-dim";
    status.textContent = `${formatQuantity(essence.charges)}/${formatQuantity(tome.chargeCapacity)} charges · ${formatQuantity(essence.carried)} essence carried`;
    text.append(name, cost, status);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--primary production-row__action";
    button.textContent = "Imbue";
    button.disabled = !essence.canImbue;
    button.title = essence.charges > 0 ? "Use all charges of this essence type before recharging" : essence.canImbue
      ? `Spend ${tome.essencePerRecharge} ${essence.name}` : `Need ${tome.essencePerRecharge} ${essence.name}`;
    button.addEventListener("click", async () => {
      const result = await sendGameCommand(this.ctx.api, "imbueTome", tome.itemId, essence.itemId);
      if (report(result)) {
        this.refresh(true);
        this.ctx.refresh();
      }
    });
    root.append(glyph, text, button);
    return root;
  }

  dispose(): void {
    this.frame.dispose();
  }

  private recipesFor(kind: StationKind, skill: SkillId, listedIds: readonly string[]): RecipeDef[] {
    const candidates = listedIds.length > 0
      ? listedIds.map((id) => content.recipe(id)).filter(isRecipeDef)
      : content.recipesForSkill(skill);
    return candidates
      .filter((recipe) => recipe.stations === null || recipe.stations.includes(kind))
      .sort((a, b) => a.reqLevel - b.reqLevel || a.name.localeCompare(b.name));
  }

  private recipeRow(
    recipe: RecipeDef,
    slots: readonly (ItemStack | null)[],
    level: number,
    activity: ReturnType<GameApi["getActivity"]>,
  ): HTMLElement {
    const max = maxRecipeBatches(recipe, slots);
    const requested = this.quantity.resolve(Math.min(max, MAX_PRODUCTION_BATCH));
    const levelMet = level >= recipe.reqLevel;
    const ingredientsMet = requested <= max;
    const batchSizeMet = requested <= MAX_PRODUCTION_BATCH;
    const busy = activity !== null;
    const enabled = levelMet && ingredientsMet && batchSizeMet && !busy;
    const blockedReason = !levelMet
      ? `Requires ${skillName(recipe.skill)} ${recipe.reqLevel}`
      : !batchSizeMet
        ? `Batch limit is ${MAX_PRODUCTION_BATCH}`
        : !ingredientsMet
          ? `Need ingredients for ${requested}`
          : busy
            ? "Finish or stop the current activity first"
            : null;

    const root = document.createElement("article");
    root.className = "production-row";
    root.setAttribute("role", "listitem");
    if (!enabled) root.classList.add("is-blocked");

    const glyph = document.createElement("span");
    glyph.className = "slot__glyph production-row__glyph";
    glyph.appendChild(createItemIcon(itemDef(recipe.output.itemId)));

    const text = document.createElement("div");
    text.className = "production-row__text";
    const name = document.createElement("div");
    name.className = "production-row__name";
    name.textContent = recipe.name;
    const ingredients = document.createElement("div");
    ingredients.className = "production-row__ingredients";
    ingredients.textContent = recipe.inputs
      .map((input) => `${input.quantity} ${itemName(input.itemId)}`)
      .join(" + ");
    const details = document.createElement("div");
    details.className = "production-row__details u-dim";
    const detailParts = [
      `${skillName(recipe.skill)} ${recipe.reqLevel}`,
      recipe.stations === null ? "No station required" : `At ${formatStations(recipe.stations)}`,
      `${formatDuration(recipe.durationMs)} each`,
      `${formatQuantity(recipe.xp)} xp`,
    ];
    if (recipe.kind === "cook") {
      detailParts.push(`${Math.round(burnChance(level, recipe.reqLevel) * 100)}% burn`);
    }
    details.textContent = detailParts.join(" · ");
    const batch = document.createElement("div");
    batch.className = "production-row__batch u-dim";
    batch.textContent = `Batch ${requested} · ${max} possible${blockedReason ? ` · ${blockedReason}` : ""}`;
    text.append(name, ingredients, details, batch);

    const make = document.createElement("button");
    make.type = "button";
    make.className = "btn btn--primary production-row__action";
    make.textContent = recipe.kind === "cook" ? "Cook" : "Make";
    make.disabled = !enabled;
    this.ctx.tooltip?.attach(root, () => blockedReason ? ({
      kind: "text",
      title: "Unavailable",
      lines: [blockedReason],
    }) : null);
    make.addEventListener("click", async () => {
      if (!this.stationId) return;
      const result = await sendGameCommand(this.ctx.api, "produceAt", this.stationId, recipe.id, this.quantity.resolve(Math.min(
          maxRecipeBatches(recipe, this.ctx.api.getInventory().slots), MAX_PRODUCTION_BATCH,
        )));
      if (result.ok) {
        notify(`Started ${recipe.name} · batch ${result.value.queued}.`, "success");
        this.refresh(true);
        this.ctx.refresh();
      } else {
        report(result);
      }
    });

    root.append(glyph, text, make);
    return root;
  }

  private nearbyCampfire(): SemanticEntity | null {
    const nearby = this.ctx.api.observe({
      scope: "visible",
      radius: 8,
      archetypes: ["station"],
      interaction: "produce",
      limit: 12,
    });
    for (const row of nearby) {
      const inspected = this.ctx.api.inspect(row.id);
      if (inspected.ok && inspected.value.station?.kind === "campfire") return inspected.value;
    }
    return null;
  }

  private paintFireLine(
    selected: SemanticEntity,
    selectedRemainingMs: number | null,
    nearby: SemanticEntity | null,
    nearbyRemainingMs: number | null,
  ): void {
    if (selected.station?.kind === "campfire") {
      this.fireLine.hidden = false;
      this.fireLine.textContent = selectedRemainingMs === null
        ? "Portable fire"
        : `Fire remaining ${formatRemaining(selectedRemainingMs)}`;
      return;
    }
    if (nearby) {
      this.fireLine.hidden = false;
      this.fireLine.textContent = nearbyRemainingMs === null
        ? "Portable campfire nearby"
        : `Nearby campfire ${formatRemaining(nearbyRemainingMs)} remaining`;
      return;
    }
    this.fireLine.hidden = true;
    this.fireLine.textContent = "";
  }
}

function isRecipeDef(recipe: RecipeDef | undefined): recipe is RecipeDef {
  return recipe !== undefined;
}

function stationLabel(kind: StationKind): string {
  return kind.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatStations(stations: readonly StationKind[] | null): string {
  return stations === null ? "Anywhere" : stations.map(stationLabel).join(" or ");
}

function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1_000;
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

function formatRemaining(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(seconds / 60);
  const tail = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(tail).padStart(2, "0")}` : `${tail}s`;
}

function campfireRemainingMs(entity: { meta?: Record<string, string | number | boolean> }, api: GameApi): number | null {
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

function maxRecipeBatches(recipe: RecipeDef, slots: readonly (ItemStack | null)[]): number {
  const totals = new Map<ItemId, number>();
  const needs = new Map<ItemId, number>();
  for (const slot of slots) {
    if (!slot) continue;
    totals.set(slot.itemId, (totals.get(slot.itemId) ?? 0) + slot.quantity);
  }
  for (const input of recipe.inputs) {
    needs.set(input.itemId, (needs.get(input.itemId) ?? 0) + input.quantity);
  }
  let max = Number.POSITIVE_INFINITY;
  for (const [itemId, quantity] of needs) {
    max = Math.min(max, Math.floor((totals.get(itemId) ?? 0) / quantity));
  }
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}
