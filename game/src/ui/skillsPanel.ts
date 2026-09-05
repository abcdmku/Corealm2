import { PanelFrame } from "./panelFrame.js";
/**
 * The ten skills, grouped the way the design groups them: combat, gathering, production,
 * utility. Each row carries its own colour from `content/skills.ts` — the same colour the floating
 * XP number uses — so "that green number was woodcutting" is learnable without reading a word.
 *
 * A row shows level, progress through the current level, and the exact XP still to go, because
 * "1,240 to next" is the number a player actually plans around.
 */
import type { SkillId } from "../contracts.js";
import { SKILLS, skillsInGroup } from "../content/skills.js";
import type { SkillGroup } from "../content/skills.js";
import { MAX_LEVEL, levelProgress } from "../content/xp.js";
import { notify } from "./contextMenu.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { formatExact, formatQuantity } from "./panels.js";

const GROUP_LABELS: readonly [SkillGroup, string][] = [
  ["combat", "Combat"],
  ["gathering", "Gathering"],
  ["production", "Production"],
  ["utility", "Utility"],
];

interface SkillRow {
  level: HTMLElement;
  fill: HTMLElement;
  detail: HTMLElement;
  root: HTMLElement;
}

export class SkillsPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly rows = new Map<SkillId, SkillRow>();
  private signature = "";

  constructor(
    private readonly ctx: UiContext,
    private readonly onSkillClick?: (skill: SkillId) => void,
  ) {
    this.frame = new PanelFrame({
      id: "skills",
      title: "Skills",
      key: "k",
      keyLabel: "Skills",
      registry: ctx.registry,
      placement: { right: "10px", bottom: "48px", width: "190px", maxHeight: "calc(100vh - 110px)" },
      group: "side",
      onOpen: () => this.refresh(true),
    });

    for (const [group, label] of GROUP_LABELS) {
      const section = document.createElement("section");
      section.className = "skills__group";

      const heading = document.createElement("h3");
      heading.className = "u-caps u-dim skills__group-title";
      heading.textContent = label;
      section.appendChild(heading);

      for (const id of skillsInGroup(group)) section.appendChild(this.buildRow(id));
      this.frame.body.appendChild(section);
    }
  }

  refresh(force = false): void {
    const skills = this.ctx.api.getSkills();
    const ids = Object.keys(SKILLS) as SkillId[];

    const signature = ids.map((id) => `${id}:${skills[id].level}:${skills[id].xp}`).join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;

    let totalLevel = 0;
    let totalXp = 0;

    for (const id of ids) {
      const view = skills[id];
      totalLevel += view.level;
      totalXp += view.xp;

      const row = this.rows.get(id);
      if (!row) continue;
      row.level.textContent = String(view.level);
      row.fill.style.width = `${(levelProgress(view.xp) * 100).toFixed(1)}%`;
      row.detail.textContent = view.level >= MAX_LEVEL
        ? `${formatQuantity(view.xp)} xp · maxed`
        : `${formatQuantity(view.xp)} xp · ${formatQuantity(view.xpToNext)} to next`;
      row.root.setAttribute(
        "aria-label",
        `${SKILLS[id].name}, level ${view.level}, ${formatExact(view.xp)} experience`,
      );
    }

    this.frame.setSubtitle(`Total ${totalLevel} · ${formatQuantity(totalXp)} xp`);
  }

  dispose(): void {
    this.frame.dispose();
  }

  private buildRow(id: SkillId): HTMLElement {
    const def = SKILLS[id];

    const row = document.createElement("button");
    row.type = "button";
    row.className = "skill-row";
    row.dataset["skill"] = id;

    const dot = document.createElement("span");
    dot.className = "skill-dot";

    const name = document.createElement("span");
    name.className = "skill-row__name";
    name.textContent = def.name;

    const level = document.createElement("span");
    level.className = "skill-row__level u-numeric";
    level.textContent = "1";

    const bar = document.createElement("span");
    bar.className = "bar bar--skill skill-row__bar";
    const fill = document.createElement("span");
    fill.className = "bar__fill";
    bar.appendChild(fill);

    const detail = document.createElement("span");
    detail.className = "skill-row__detail u-numeric u-dim";
    detail.textContent = "0 xp";

    row.append(dot, name, level, bar, detail);

    row.addEventListener("click", () => {
      if (this.onSkillClick) this.onSkillClick(id);
      else notify(`${def.name}: ${def.blurb}`, "info");
    });
    this.ctx.tooltip.attach(row, () => ({ kind: "text", title: def.name, lines: [def.blurb] }));

    this.rows.set(id, { level, fill, detail, root: row });
    return row;
  }
}
