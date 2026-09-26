import { sendGameCommand } from "../api/commands.js";
import { PanelFrame } from "./panelFrame.js";
/**
 * Four elements crossed with the spell ladder: four basic rungs, then five ranks of invocation.
 *
 * The panel only presents values resolved by GameApi, so charge and rune rules stay identical in
 * combat, agent tools, and the UI. A tile is dragged onto an action bar slot to bind it; clicking a
 * basic sets it as the standing auto-cast spell, clicking an invocation casts it once (a targeted
 * one at the current target, an area one through the ground reticle).
 *
 * Hovering a spell shows rune icons and its cost per cast.
 */
import type { SpellElement, SpellId, SpellRow, SpellRung, SpellbookView, TownTeleportId, UtilityMagicView, UtilitySpellId } from "../contracts.js";
import { SPELL_ELEMENTS, SPELL_RUNGS } from "../contracts.js";
import { ELEMENT_COLOURS } from "../render/elementColours.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { formatQuantity, installRovingGrid, itemDef, report } from "./panels.js";
import { spellIconMarkup } from "./spellIcons.js";
import { townTeleportIconMarkup, utilitySpellIconMarkup } from "./utilitySpellIcons.js";
import { SPELL_DRAG_MIME } from "./spellActionBar.js";
import { spellElementRequirementLabel } from "./displayLabels.js";

const ELEMENT_LABELS: Readonly<Record<SpellElement, string>> = {
  wind: "Air",
  water: "Water",
  earth: "Earth",
  fire: "Fire",
};

const RUNG_LABELS: Readonly<Record<SpellRung, string>> = {
  lash: "Lash",
  bolt: "Bolt",
  burst: "Burst",
  surge: "Surge",
};

const RANK_LABELS: readonly string[] = ["", "Rank I", "Rank II", "Rank III", "Rank IV", "Rank V"];
const RANKS: readonly number[] = [1, 2, 3, 4, 5];


const LOCK_GLYPH =
  '<svg class="spellbook__lock" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"'
  + ' fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">'
  + '<rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor" stroke="none"/>'
  + '<path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg>';

function cssHex(colour: number): string {
  return `#${(colour >>> 0).toString(16).padStart(6, "0")}`;
}

function cadence(castMs: number): string {
  return `${(castMs / 1000).toFixed(1)}s`;
}

interface SpellCell {
  root: HTMLButtonElement;
  req: HTMLElement;
  lock: HTMLElement;
}

interface UtilityCell extends SpellCell { badge: HTMLElement }

export class SpellbookPanel implements ManagedPanel {
  readonly frame: PanelFrame;

  private readonly cells = new Map<SpellId, SpellCell>();
  private readonly rows = new Map<SpellId, SpellRow>();
  private readonly utilityCells = new Map<UtilitySpellId, UtilityCell>();
  private readonly teleportCells = new Map<TownTeleportId, UtilityCell>();
  private autofocus: HTMLElement | null = null;
  private signature = "";
  private readonly utilitySection = document.createElement("section");
  private readonly teleportSection = document.createElement("section");

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "spellbook",
      title: "Spellbook",
      key: "b",
      keyLabel: "Spellbook",
      registry: ctx.registry,
      // The inventory's slot, exactly: a side card above the dock, swapped with the pack, the
      // skills and the worn gear. Four icon tiles across fit the pack's width; the whole book is
      // ten rows tall and scrolls inside the frame on a short screen.
      placement: { right: "10px", bottom: "48px", width: "190px", maxHeight: "calc(100vh - 110px)" },
      group: "side",
      onOpen: () => this.refresh(true),
    });

    const view = ctx.api.getSpellbook();
    for (const row of view.spells) this.rows.set(row.id, row);

    const body = document.createElement("div");
    body.className = "spellbook";


    const grid = document.createElement("div");
    grid.className = "spellbook__grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Spells by element and rank");

    const corner = document.createElement("span");
    corner.className = "spellbook__corner";
    corner.setAttribute("aria-hidden", "true");
    grid.appendChild(corner);
    for (const element of SPELL_ELEMENTS) {
      grid.appendChild(this.buildHead(element, view.releasedElements.includes(element), view.spells));
    }

    let index = 0;
    const byCell = new Map<string, SpellRow>();
    for (const row of view.spells) byCell.set(`${row.element}/${row.rank > 0 ? `r${row.rank}` : row.rung}`, row);

    for (const rung of SPELL_RUNGS) {
      grid.appendChild(this.buildRowLabel(RUNG_LABELS[rung]));
      for (const element of SPELL_ELEMENTS) {
        grid.appendChild(this.buildCell(element, byCell.get(`${element}/${rung}`), index, `No ${ELEMENT_LABELS[element]} spell at this rung`));
        index += 1;
      }
    }

    const divider = document.createElement("div");
    divider.className = "spellbook__divider";
    divider.textContent = "Invocations";
    divider.setAttribute("aria-hidden", "true");
    grid.appendChild(divider);

    for (const rank of RANKS) {
      const label = this.buildRowLabel(RANK_LABELS[rank]!);
      grid.appendChild(label);
      for (const element of SPELL_ELEMENTS) {
        const cell = this.buildCell(element, byCell.get(`${element}/r${rank}`), index, `No ${ELEMENT_LABELS[element]} invocation at rank ${rank}`);
        cell.classList.add("spellbook__cell--advanced");
        grid.appendChild(cell);
        index += 1;
      }
    }

    installRovingGrid(grid, SPELL_ELEMENTS.length);
    body.appendChild(grid);
    for (const [section, label] of [
      [this.utilitySection, "Cosmic utility"],
      [this.teleportSection, "Teleports"],
    ] as const) {
      section.className = "spellbook__section";
      section.setAttribute("aria-label", label);
      body.appendChild(section);
    }
    this.frame.body.appendChild(body);
  }

  refresh(force = false): void {
    const view = this.ctx.api.getSpellbook();
    const utility = this.ctx.api.utilityMagic();
    const simMs = this.ctx.api.getTime().simMs;
    const signature = [
      view.magicLevel,
      view.preferredSpellId ?? "-",
      view.activeSpellId ?? "-",
      view.castLock?.spellId ?? "-",
      ...SPELL_ELEMENTS.map((element) => `${element}:${view.essence[element]}`),
      ...view.runes.map((rune) => `${rune.itemId}:${rune.carried}`),
      ...view.spells.map((row) => [
        row.id,
        row.maxHit,
        row.castMs,
        row.fuelCost,
        row.unlocked ? 1 : 0,
        row.castable ? 1 : 0,
        row.blockedBy ?? "ready",
      ].join(":")),
      ...utility.spells.map((row) => `${row.id}:${row.castable}:${row.blockedBy}:${row.costs.map((cost) => cost.available).join(",")}`),
      ...utility.effects.map((effect) => `${effect.spellId}:${effect.group}:${Math.ceil((effect.expiresAtMs - simMs) / 1000)}`),
      ...utility.fields.map((field) => `${field.id}:${field.spellId}:${Math.ceil((field.expiresAtMs - simMs) / 1000)}`),
      ...utility.teleports.map((row) => `${row.id}:${row.unlocked}:${row.castable}:${row.blockedBy}`),
      utility.teleportCast?.townId ?? "-",
    ].join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;

    for (const row of view.spells) {
      this.rows.set(row.id, row);
      const cell = this.cells.get(row.id);
      if (cell) this.paintCell(cell, row, view);
    }
    const focusId = view.preferredSpellId ?? view.activeSpellId;
    this.setAutofocus(focusId === null ? null : this.cells.get(focusId)?.root ?? null);
    this.frame.setSubtitle(`Magic ${view.magicLevel}`);
    this.paintUtility(utility, simMs, view.magicLevel);
  }

  dispose(): void {
    this.frame.dispose();
  }

  private paintUtility(view: UtilityMagicView, simMs: number, magicLevel: number): void {
    const utilityGrid = this.ensureTileGrid(this.utilitySection, "Cosmic utility");
    for (const spell of view.spells) {
      const active = view.effects.filter((effect) => effect.spellId === spell.id && effect.expiresAtMs > simMs);
      const fields = view.fields.filter((field) => field.spellId === spell.id && field.expiresAtMs > simMs);
      let cell = this.utilityCells.get(spell.id);
      if (!cell) {
        cell = this.makeUtilityCell(utilitySpellIconMarkup(spell.id), `cast:${spell.id}`, () => void this.castUtility(spell.id, spell.target));
        cell.root.dataset["slotIndex"] = String(this.utilityCells.size);
        cell.root.tabIndex = this.utilityCells.size === 0 ? 0 : -1;
        this.utilityCells.set(spell.id, cell);
        utilityGrid.appendChild(cell.root);
        this.ctx.tooltip.attach(cell.root, () => {
          const current = this.ctx.api.utilityMagic().spells.find((entry) => entry.id === spell.id);
          if (!current) return null;
          const now = this.ctx.api.getTime().simMs;
          const magic = this.ctx.api.utilityMagic();
          const remaining = [...magic.effects, ...magic.fields].filter((entry) => entry.spellId === spell.id && entry.expiresAtMs > now)
            .map((entry) => Math.ceil((entry.expiresAtMs - now) / 1000));
          return { kind: "text", title: current.name, lines: [
            current.description,
            `Magic ${current.reqLevel} · ${current.durationMs / 1000}s · ${current.target === "area" ? `${current.radius}m area centered on you` : current.target === "enemy" ? "Engaged enemy" : "Self"}`,
            ...(remaining.length ? [`Active · ${Math.max(...remaining)}s remaining`] : []),
            current.blockedBy ?? "Ready to cast.",
          ], runeCosts: current.costs.map((cost) => ({ itemId: cost.itemId, name: itemDef(cost.itemId)?.name ?? cost.itemId,
            quantity: cost.quantity, carried: cost.available })) };
        });
      }
      this.paintUtilityCell(cell, spell.reqLevel, magicLevel, !spell.castable, spell.blockedBy, spell.name,
        Math.max(0, ...active.map((effect) => effect.expiresAtMs - simMs), ...fields.map((field) => field.expiresAtMs - simMs)));
    }

    const teleportGrid = this.ensureTileGrid(this.teleportSection, "Teleports");
    for (const town of view.teleports) {
      let cell = this.teleportCells.get(town.id);
      if (!cell) {
        cell = this.makeUtilityCell(townTeleportIconMarkup(town.id), `town:${town.id}`, () => {
          const current = this.ctx.api.utilityMagic().teleports.find((entry) => entry.id === town.id);
          if (current) void this.useTeleport(town.id, current.unlocked);
        });
        cell.root.dataset["slotIndex"] = String(this.teleportCells.size);
        cell.root.tabIndex = this.teleportCells.size === 0 ? 0 : -1;
        this.teleportCells.set(town.id, cell);
        teleportGrid.appendChild(cell.root);
        this.ctx.tooltip.attach(cell.root, () => {
          const current = this.ctx.api.utilityMagic().teleports.find((entry) => entry.id === town.id);
          if (!current) return null;
          const loose = this.ctx.api.getInventory().slots.reduce((count, slot) => count + (slot?.itemId === "temporal_essence" ? slot.quantity : 0), 0);
          const stored = this.ctx.api.essenceTomes().reduce((count, tome) => count + (tome.essences.find((essence) => essence.itemId === "temporal_essence")?.charges ?? 0), 0);
          return { kind: "text", title: current.name, lines: [
            `Magic ${current.reqLevel} · ${current.unlocked ? "Visited: click to teleport" : "Unvisited: activate at the nearby town pad"}`,
            current.blockedBy ?? "Ready to teleport.",
          ], runeCosts: [{ itemId: "temporal_essence", name: "Temporal Essence", quantity: current.cost, carried: loose + stored }] };
        });
      }
      this.paintUtilityCell(cell, town.reqLevel, magicLevel, !town.unlocked || !town.castable, town.blockedBy, town.name, 0);
      cell.root.classList.toggle("is-locked", !town.unlocked || town.reqLevel > magicLevel);
      cell.root.dataset["visited"] = town.unlocked ? "true" : "false";
    }
    if (view.teleportCast) {
      const town = view.teleports.find((entry) => entry.id === view.teleportCast?.townId);
      this.teleportSection.dataset["channeling"] = `Channeling to ${town?.name ?? "town"}…`;
    } else {
      delete this.teleportSection.dataset["channeling"];
    }

  }

  private sectionHeading(text: string): HTMLElement {
    const heading = document.createElement("h3");
    heading.className = "spellbook__section-heading";
    heading.textContent = text;
    return heading;
  }

  private ensureTileGrid(section: HTMLElement, title: string): HTMLElement {
    const existing = section.querySelector<HTMLElement>(".spellbook__utility-grid");
    if (existing) return existing;
    const grid = document.createElement("div");
    grid.className = "spellbook__utility-grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", title);
    installRovingGrid(grid, 4);
    section.append(this.sectionHeading(title), grid);
    return grid;
  }

  private makeUtilityCell(markup: string, action: string, onClick: () => void): UtilityCell {
    const root = document.createElement("button");
    root.type = "button";
    root.className = "spellbook__cell spellbook__utility-cell";
    root.dataset["spellbookAction"] = action;
    root.addEventListener("click", onClick);
    const glyph = document.createElement("span");
    glyph.className = "spellbook__cell-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.innerHTML = markup;
    const req = document.createElement("span");
    req.className = "spellbook__cell-req u-numeric";
    const lock = document.createElement("span");
    lock.className = "spellbook__cell-lock";
    lock.setAttribute("aria-hidden", "true");
    lock.innerHTML = LOCK_GLYPH;
    const badge = document.createElement("span");
    badge.className = "spellbook__utility-badge";
    badge.setAttribute("aria-hidden", "true");
    root.append(glyph, req, lock, badge);
    return { root, req, lock, badge };
  }

  private paintUtilityCell(cell: UtilityCell, level: number, magicLevel: number, blocked: boolean, reason: string | null, name: string, activeMs: number): void {
    cell.root.classList.toggle("is-blocked", blocked);
    cell.root.classList.toggle("is-locked", level > magicLevel);
    cell.root.classList.toggle("is-active", activeMs > 0);
    cell.req.textContent = String(level);
    cell.lock.hidden = !blocked;
    cell.badge.textContent = activeMs > 0 ? `${Math.ceil(activeMs / 1000)}s` : "";
    cell.badge.hidden = activeMs <= 0;
    cell.root.setAttribute("aria-label", `${name}, Magic ${level}. ${reason ?? "Ready."}${activeMs > 0 ? ` Active for ${Math.ceil(activeMs / 1000)} more seconds.` : ""}`);
  }

  private async castUtility(id: UtilitySpellId, target: "self" | "enemy" | "area"): Promise<void> {
    const player = this.ctx.api.getPlayer();
    if (target === "enemy" && !player.targetId) {
      this.ctx.notify("Engage an enemy before casting this spell.", "error");
      return;
    }
    const result = target === "enemy"
      ? await sendGameCommand(this.ctx.api, "castUtility", id, player.targetId!)
      : target === "area"
        ? await sendGameCommand(this.ctx.api, "castUtility", id, player.position)
        : await sendGameCommand(this.ctx.api, "castUtility", id);
    if (report(result)) this.ctx.refresh();
  }

  private async useTeleport(id: TownTeleportId, unlocked: boolean): Promise<void> {
    const result = unlocked
      ? await sendGameCommand(this.ctx.api, "teleportTown", id)
      : await sendGameCommand(this.ctx.api, "activateTeleport", id);
    if (report(result)) this.ctx.refresh();
  }

  // ------------------------------------------------------------------ grid

  private buildHead(element: SpellElement, released: boolean, spells: readonly SpellRow[]): HTMLElement {
    const requirement = spellElementRequirementLabel(spells, element);
    const head = document.createElement("div");
    head.className = "spellbook__head";
    head.classList.toggle("is-unreleased", !released);
    head.setAttribute(
      "aria-label",
      released
        ? [`${ELEMENT_LABELS[element]} spells`, requirement].filter(Boolean).join(", ")
        : `${ELEMENT_LABELS[element]}. Unreleased.`,
    );

    const line = document.createElement("div");
    line.className = "spellbook__head-line";

    const dot = document.createElement("span");
    dot.className = "spellbook__swatch spellbook__swatch--small";
    dot.setAttribute("aria-hidden", "true");
    applyElementColours(dot, element);

    const name = document.createElement("span");
    name.className = "spellbook__head-name";
    name.textContent = ELEMENT_LABELS[element];
    line.append(dot, name);

    const blurb = document.createElement("span");
    blurb.className = "spellbook__head-blurb";
    blurb.textContent = released ? requirement : "Unreleased";
    head.append(line, blurb);
    return head;
  }

  private buildRowLabel(text: string): HTMLElement {
    const label = document.createElement("span");
    label.className = "spellbook__rung";
    label.textContent = text;
    return label;
  }

  private buildCell(element: SpellElement, row: SpellRow | undefined, index: number, absentLabel: string): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "spellbook__cell";
    cell.dataset["slotIndex"] = String(index);
    cell.tabIndex = index === 0 ? 0 : -1;
    applyElementColours(cell, element);

    const glyph = document.createElement("span");
    glyph.className = "spellbook__cell-glyph";
    glyph.setAttribute("aria-hidden", "true");

    const req = document.createElement("span");
    req.className = "spellbook__cell-req u-numeric";

    const lock = document.createElement("span");
    lock.className = "spellbook__cell-lock";
    lock.setAttribute("aria-hidden", "true");
    lock.innerHTML = LOCK_GLYPH;
    cell.append(glyph, req, lock);

    if (!row) {
      cell.disabled = true;
      cell.classList.add("is-absent");
      cell.setAttribute("aria-label", absentLabel);
      return cell;
    }

    const id = row.id;
    cell.dataset["spell"] = id;
    glyph.innerHTML = spellIconMarkup(row, 30);

    cell.addEventListener("click", (event) => {
      if (event.shiftKey && this.ctx.assignToActionBar) {
        if (!this.ctx.assignToActionBar(id)) this.ctx.notify?.("Every visible action bar slot is full.");
        return;
      }
      const current = this.rows.get(id);
      if (!current) return;
      if (current.rank === 0) {
        this.choose(this.ctx.api.getSpellbook().preferredSpellId === id ? null : id);
        return;
      }
      this.ctx.activateSpell(id);
    });

    // A tile is the drag source for the action bar. The payload carries no slot, so a drop binds a
    // copy and the book keeps its tile.
    cell.draggable = true;
    cell.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(SPELL_DRAG_MIME, JSON.stringify({ id }));
      event.dataTransfer.setData("text/plain", id);
    });

    this.ctx.tooltip.attach(cell, () => {
      const current = this.rows.get(id);
      if (!current) return null;
      const essenceId = `${current.requiredElement === "wind" ? "air" : current.requiredElement}_essence`;
      return {
        kind: "text", title: current.name, lines: this.tooltipLines(current),
        runeCosts: [
          { itemId: essenceId, name: `${ELEMENT_LABELS[current.requiredElement]} Essence`,
            quantity: current.fuelCost, carried: this.ctx.api.getSpellbook().essence[current.requiredElement] },
          ...current.runes,
        ],
      };
    });

    this.cells.set(id, { root: cell, req, lock });
    return cell;
  }

  private tooltipLines(row: SpellRow): string[] {
    const lines = [row.description];
    lines.push(
      row.rank > 0
        ? `${ELEMENT_LABELS[row.element]} · ${RANK_LABELS[row.rank]} invocation${row.aoe ? " · area" : " · one target"} · Magic ${row.reqLevel}`
        : `${ELEMENT_LABELS[row.element]} · ${RUNG_LABELS[row.rung]} · Magic ${row.reqLevel}`,
    );
    lines.push(
      `Max hit ${formatQuantity(row.maxHit)} · ${formatQuantity(row.baseXp)} base xp`
      + ` · current weapon cadence ${cadence(row.castMs)}`,
    );
    lines.push(row.blockedBy ?? "Ready to cast.");
    lines.push(
      row.rank === 0
        ? "Click to set as the standing spell. Drag to an action bar slot."
        : row.aoe
          ? "Click or press its slot, then click the ground to place it. Drag to an action bar slot."
          : "Click or press its slot to cast once at your target. Drag to an action bar slot.",
    );
    return lines;
  }

  private paintCell(cell: SpellCell, row: SpellRow, view: SpellbookView): void {
    const active = view.activeSpellId === row.id;
    const preferred = view.preferredSpellId === row.id;
    const casting = view.castLock?.spellId === row.id;

    cell.root.classList.toggle("is-locked", !row.unlocked);
    cell.root.classList.toggle("is-blocked", !row.castable);
    cell.root.classList.toggle("is-preferred", preferred);
    cell.root.classList.toggle("is-active", active || casting);
    cell.root.setAttribute("aria-pressed", preferred ? "true" : "false");

   cell.req.textContent = String(row.reqLevel);
   cell.lock.hidden = row.unlocked;
   const availability = row.blockedBy ?? "Ready to cast.";
   const runeText = row.runes.length ? ` and ${row.runes.map((rune) => `${rune.quantity} ${rune.name}`).join(" and ")}` : "";
    cell.root.setAttribute(
      "aria-label",
      `${row.name}, ${ELEMENT_LABELS[row.requiredElement]}, ${row.rank > 0 ? `${RANK_LABELS[row.rank]} invocation` : RUNG_LABELS[row.rung]}, Magic ${row.reqLevel}. `
      + `${formatQuantity(row.fuelCost)} Essence${runeText}, ${cadence(row.castMs)} weapon cadence. `
      + `Max hit ${formatQuantity(row.maxHit)}. ${availability}`,
    );
  }

  private async choose(spellId: SpellId | null): Promise<void> {
    if (!report(await sendGameCommand(this.ctx.api, "setPreferredSpell", spellId))) return;
    this.ctx.refresh();
  }

  private setAutofocus(target: HTMLElement | null): void {
    if (this.autofocus === target) return;
    if (this.autofocus) delete this.autofocus.dataset["autofocus"];
    this.autofocus = target;
    if (target) target.dataset["autofocus"] = "";
  }
}

function applyElementColours(target: HTMLElement, element: SpellElement): void {
  const palette = ELEMENT_COLOURS[element];
  target.style.setProperty("--spell-core", cssHex(palette.core));
  target.style.setProperty("--spell-edge", cssHex(palette.edge));
}
