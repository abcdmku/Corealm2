import { PanelFrame } from "./panelFrame.js";
/**
 * Four elements crossed with four spell rungs. The panel only presents values resolved by GameApi,
 * so charge rules and weapon cadence stay identical in combat, agent tools, and the UI.
 */
import type { SpellElement, SpellId, SpellRow, SpellRung, SpellbookView } from "../contracts.js";
import { SPELL_ELEMENTS, SPELL_RUNGS } from "../contracts.js";
import { ELEMENT_COLOURS } from "../render/spellVfx.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { formatQuantity, installRovingGrid, report } from "./panels.js";
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

const RUNG_GLYPHS: Readonly<Record<SpellRung, string>> = {
  lash:
    '<path d="M16 10 L19 16 L16 22 L13 16 Z" fill="var(--spell-core)" stroke="var(--spell-edge)"'
    + ' stroke-width="1.4" stroke-linejoin="round"/>',
  bolt:
    '<path d="M3 16 L13 14.4 L13 17.6 Z" fill="var(--spell-edge)" opacity="0.9"/>'
    + '<path d="M22 7 L28 16 L22 25 L13 16 Z" fill="var(--spell-core)" stroke="var(--spell-edge)"'
    + ' stroke-width="1.4" stroke-linejoin="round"/>',
  burst:
    '<path d="M16 3 L19 13 L29 16 L19 19 L16 29 L13 19 L3 16 L13 13 Z" fill="var(--spell-core)"'
    + ' stroke="var(--spell-edge)" stroke-width="1.3" stroke-linejoin="round"/>'
    + '<circle cx="16" cy="16" r="3" fill="var(--spell-edge)" opacity="0.55"/>',
  surge:
    '<path d="M3 12 Q9 6 16 11 Q23 16 29 10" fill="none" stroke="var(--spell-edge)"'
    + ' stroke-width="2" stroke-linecap="round" opacity="0.75"/>'
    + '<path d="M3 22 Q9 15 16 20 Q23 25 29 18 L29 27 Q23 29 16 27 Q9 25 3 27 Z"'
    + ' fill="var(--spell-core)" stroke="var(--spell-edge)" stroke-width="1.3"'
    + ' stroke-linejoin="round"/>',
};

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

function essenceName(element: SpellElement): string {
  return `${ELEMENT_LABELS[element]} Essence`;
}

interface SpellCell {
  root: HTMLButtonElement;
  req: HTMLElement;
  lock: HTMLElement;
}

export class SpellbookPanel implements ManagedPanel {
  readonly frame: PanelFrame;

  private readonly cells = new Map<SpellId, SpellCell>();
  private readonly rows = new Map<SpellId, SpellRow>();
  private autofocus: HTMLElement | null = null;
  private signature = "";

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "spellbook",
      title: "Spellbook",
      key: "b",
      keyLabel: "Spellbook",
      registry: ctx.registry,
      // The inventory's slot, exactly: a side card above the dock, swapped with the pack, the
      // skills and the worn gear. Sixteen icon tiles fit the pack's width at 4 across, and a
      // spellbook that stands where the pack stands is one the player already knows how to find.
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
    grid.setAttribute("aria-label", "Attack spells by element and rung");

    const corner = document.createElement("span");
    corner.className = "spellbook__corner";
    corner.setAttribute("aria-hidden", "true");
    grid.appendChild(corner);
    for (const element of SPELL_ELEMENTS) {
      grid.appendChild(this.buildHead(element, view.releasedElements.includes(element), view.spells));
    }

    let index = 0;
    const byCell = new Map<string, SpellRow>();
    for (const row of view.spells) byCell.set(`${row.element}/${row.rung}`, row);

    for (const rung of SPELL_RUNGS) {
      grid.appendChild(this.buildRungLabel(rung));
      for (const element of SPELL_ELEMENTS) {
        grid.appendChild(this.buildCell(element, byCell.get(`${element}/${rung}`), index));
        index += 1;
      }
    }

    installRovingGrid(grid, SPELL_ELEMENTS.length);
    body.appendChild(grid);
    this.frame.body.appendChild(body);
  }

  refresh(force = false): void {
    const view = this.ctx.api.getSpellbook();
    const signature = [
      view.magicLevel,
      view.preferredSpellId ?? "-",
      view.activeSpellId ?? "-",
      ...SPELL_ELEMENTS.map((element) => `${element}:${view.essence[element]}`),
      ...view.spells.map((row) => [
        row.id,
        row.maxHit,
        row.castMs,
        row.fuelCost,
        row.unlocked ? 1 : 0,
        row.castable ? 1 : 0,
        row.blockedBy ?? "ready",
      ].join(":")),
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
  }

  dispose(): void {
    this.frame.dispose();
  }

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

  private buildRungLabel(rung: SpellRung): HTMLElement {
    const label = document.createElement("span");
    label.className = "spellbook__rung";
    label.textContent = RUNG_LABELS[rung];
    return label;
  }

  private buildCell(element: SpellElement, row: SpellRow | undefined, index: number): HTMLElement {
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
      cell.setAttribute("aria-label", `No ${ELEMENT_LABELS[element]} spell at this rung`);
      return cell;
    }

    const id = row.id;
    glyph.innerHTML =
      `<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">${RUNG_GLYPHS[row.rung]}</svg>`;

    cell.addEventListener("click", () => {
      const current = this.ctx.api.getSpellbook().preferredSpellId;
      this.choose(current === id ? null : id);
    });

    this.ctx.tooltip.attach(cell, () => {
      const current = this.rows.get(id);
      if (!current) return null;
      return { kind: "text", title: current.name, lines: this.tooltipLines(current) };
    });

    this.cells.set(id, { root: cell, req, lock });
    return cell;
  }

  private tooltipLines(row: SpellRow): string[] {
    const lines = [row.description];
    lines.push(`${ELEMENT_LABELS[row.element]} · ${RUNG_LABELS[row.rung]} · Magic ${row.reqLevel}`);
    lines.push(
      `Max hit ${formatQuantity(row.maxHit)} · ${formatQuantity(row.baseXp)} base xp`
      + ` · current weapon cadence ${cadence(row.castMs)}`,
    );
    lines.push(
      `Spends ${formatQuantity(row.fuelCost)} ${ELEMENT_LABELS[row.requiredElement]} Essence per cast`,
    );
    lines.push(row.blockedBy ?? "Ready to cast.");
    return lines;
  }

  private paintCell(cell: SpellCell, row: SpellRow, view: SpellbookView): void {
    const active = view.activeSpellId === row.id;
    const preferred = view.preferredSpellId === row.id;

    cell.root.classList.toggle("is-locked", !row.unlocked);
    cell.root.classList.toggle("is-blocked", !row.castable);
    cell.root.classList.toggle("is-preferred", preferred);
    cell.root.classList.toggle("is-active", active);
    cell.root.setAttribute("aria-pressed", preferred ? "true" : "false");

    cell.req.textContent = String(row.reqLevel);
    cell.lock.hidden = row.unlocked;
    const availability = row.blockedBy ?? "Ready to cast.";
    cell.root.title = availability;
    cell.root.setAttribute(
      "aria-label",
      `${row.name}, ${ELEMENT_LABELS[row.requiredElement]}, Magic ${row.reqLevel}. `
      + `${formatQuantity(row.fuelCost)} Essence, ${cadence(row.castMs)} weapon cadence. `
      + `Max hit ${formatQuantity(row.maxHit)}. ${availability}`,
    );
  }

  private choose(spellId: SpellId | null): void {
    if (!report(this.ctx.api.setPreferredSpell(spellId))) return;
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
