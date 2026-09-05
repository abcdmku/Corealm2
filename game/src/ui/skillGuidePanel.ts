import { PanelFrame } from "./panelFrame.js";
/**
 * The compact unlock list shown after a player clicks a skill.
 *
 * The panel reads its rows from the canonical content registry through `skillUnlockLevels()`. The
 * UI only decides how to group and label those rows, so adding a recipe or shortcut updates the
 * guide without another hand-maintained list.
 */
import type { SkillId } from "../contracts.js";
import { SKILLS } from "../content/skills.js";
import {
  skillUnlockLevels,
  type SkillUnlock,
  type SkillUnlockKind,
} from "../content/skillGuides.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { formatQuantity } from "./panels.js";

const KIND_ORDER: readonly SkillUnlockKind[] = [
  "resource", "recipe", "spell", "gear", "shortcut",
];

const KIND_LABELS: Readonly<Record<SkillUnlockKind, string>> = {
  resource: "Gather",
  recipe: "Materials",
  spell: "Spells",
  gear: "Gear",
  shortcut: "Shortcuts",
};

export class SkillGuidePanel implements ManagedPanel {
  readonly frame: PanelFrame;

  private readonly root: HTMLElement;
  private readonly intro: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly unlocks: HTMLElement;
  private selected: SkillId | null = null;
  private signature = "";

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "skill-guide",
      title: "Skill guide",
      // Follow the Skills panel's normal or compact width, plus its 10px edge inset and a 10px gap.
      placement: { top: "96px", right: "calc(var(--side-panel-width, 224px) + 20px)", width: "320px" },
      movable: true,
      registry: ctx.registry,
      onOpen: () => this.refresh(true),
      onClose: () => {
        this.selected = null;
        this.signature = "";
      },
    });

    const root = document.createElement("div");
    root.className = "skill-guide";

    const intro = document.createElement("p");
    intro.className = "skill-guide__intro";

    const summary = document.createElement("div");
    summary.className = "skill-guide__summary";
    const summaryLabel = document.createElement("span");
    summaryLabel.className = "skill-guide__summary-label";
    summaryLabel.textContent = "Progress";
    const summaryValue = document.createElement("span");
    summaryValue.className = "skill-guide__summary-value";
    summary.append(summaryLabel, summaryValue);

    const section = document.createElement("section");
    section.className = "skill-guide__section";
    const heading = document.createElement("h3");
    heading.className = "u-caps u-dim skill-guide__section-title";
    heading.textContent = "Unlocks by level";
    const unlocks = document.createElement("ul");
    unlocks.className = "skill-guide__unlocks";
    section.append(heading, unlocks);

    root.append(intro, summary, section);
    this.frame.body.appendChild(root);
    this.root = root;
    this.intro = intro;
    this.summary = summaryValue;
    this.unlocks = unlocks;
  }

  openFor(skill: SkillId): void {
    this.selected = skill;
    this.frame.open();
    this.render();
  }

  refresh(force = false): void {
    if (!this.selected) return;
    const view = this.ctx.api.getSkills()[this.selected];
    const signature = `${this.selected}:${view.level}:${view.xp}`;
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.render(view.level);
  }

  dispose(): void {
    this.frame.dispose();
  }

  private render(levelOverride?: number): void {
    const skill = this.selected;
    if (!skill) return;

    const def = SKILLS[skill];
    const view = this.ctx.api.getSkills()[skill];
    const currentLevel = levelOverride ?? view.level;
    const levels = skillUnlockLevels(skill);
    const unlockCount = levels.reduce((count, entry) => count + entry.unlocks.length, 0);

    this.root.dataset["skill"] = skill;
    this.root.style.setProperty("--skill-colour", `var(--skill-${skill})`);
    this.intro.textContent = def.blurb;
    this.summary.textContent =
      `Level ${currentLevel} · ${formatQuantity(view.xp)} xp · ${unlockCount} unlocks`;
    this.frame.setSubtitle(`${def.name} · ${unlockCount} unlocks`);
    this.unlocks.replaceChildren();

    for (const levelEntry of levels) {
      const byKind = new Map<SkillUnlockKind, SkillUnlock[]>();
      for (const unlock of levelEntry.unlocks) {
        const bucket = byKind.get(unlock.kind);
        if (bucket) bucket.push(unlock);
        else byKind.set(unlock.kind, [unlock]);
      }

      for (const kind of KIND_ORDER) {
        const entries = byKind.get(kind);
        if (!entries || entries.length === 0) continue;
        this.unlocks.appendChild(this.buildUnlockRow(levelEntry.level, kind, entries, currentLevel));
      }
    }

    if (this.unlocks.childElementCount === 0) {
      const empty = document.createElement("li");
      empty.className = "skill-guide__empty";
      empty.textContent = "No named unlocks yet.";
      this.unlocks.appendChild(empty);
    }
  }

  private buildUnlockRow(
    level: number,
    kind: SkillUnlockKind,
    entries: readonly SkillUnlock[],
    currentLevel: number,
  ): HTMLElement {
    const available = currentLevel >= level;
    const row = document.createElement("li");
    row.className = `skill-guide__unlock ${available ? "is-available" : "is-locked"}`;
    row.dataset["state"] = available ? "available" : "locked";

    const levelNode = document.createElement("span");
    levelNode.className = "skill-guide__level";
    levelNode.textContent = `Lv ${level}`;

    const text = document.createElement("span");
    text.className = "skill-guide__text";
    const name = document.createElement("span");
    name.className = "skill-guide__name";
    name.textContent = KIND_LABELS[kind];
    const detail = document.createElement("span");
    detail.className = "skill-guide__detail";
    detail.textContent = entries
      .map((entry) => entry.detail ? `${entry.name} (${entry.detail})` : entry.name)
      .join(" · ");
    text.append(name, detail);

    const state = document.createElement("span");
    state.className = "skill-guide__state";
    state.textContent = available ? "Ready" : "Locked";

    row.append(levelNode, text, state);
    row.setAttribute(
      "aria-label",
      `Level ${level}, ${KIND_LABELS[kind]}: ${detail.textContent}. ${state.textContent}`,
    );
    return row;
  }
}
