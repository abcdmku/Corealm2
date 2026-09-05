import { PanelFrame } from "./panelFrame.js";
/**
 * The Quests panel.
 *
 * Phase 1 shipped nine quests and no way for a player to read any of it: the
 * only place an objective appeared was a toast that scrolled away. This is that missing surface.
 *
 * The one rule this panel enforces is that a player never sees a developer id. `QuestSummary`
 * carries `currentObjective` (prose) and `currentObjectiveRefs` (ids); this file renders the first
 * and prints the second only as *names*, resolved through content where content knows the id. An
 * agent still gets the raw refs from `getQuests()` — that surface is unchanged.
 */
import type { QuestObjectiveRef, QuestSummary } from "../contracts.js";
import { content } from "../content/index.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { prettifyId, skillName } from "./panels.js";

const REGION_NAMES: Record<string, string> = {
  fallowmarch: "Farmland",
  vellenwood: "Woodlands",
  karrowmoor: "Highlands",
  kilnhalt: "Ashlands",
  gravelmaw: "Stone Cavern",
};

const STATUS_ORDER: Record<QuestSummary["status"], number> = { active: 0, unstarted: 1, complete: 2 };

const STATUS_LABEL: Record<QuestSummary["status"], string> = {
  active: "In progress",
  unstarted: "Not started",
  complete: "Complete",
};

/**
 * A ref rendered for a human.
 *
 * Items and spells have names in content. Entities, locations and enemy families do not resolve
 * from content alone here, so they fall back to `prettifyId`, which turns `bracken_pit` into
 * "Bracken Pit" — a place name, not an id. Either way nothing with an underscore reaches the DOM.
 */
function refLabel(ref: QuestObjectiveRef): string {
  if (ref.kind === "item") return content.item(ref.id)?.name ?? prettifyId(ref.id);
  if (ref.kind === "spell") return content.spell(ref.id)?.name ?? prettifyId(ref.id);
  if (ref.kind === "entity") return prettifyId(ref.id.replace(/^npc_/, ""));
  return prettifyId(ref.id);
}

const REF_GROUP: Record<QuestObjectiveRef["kind"], string> = {
  item: "Carry",
  entity: "Find",
  location: "Go to",
  enemyFamily: "Fight",
  recipe: "Make",
  spell: "Cast",
};

export class QuestPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly list: HTMLElement;
  private readonly summaryLine: HTMLElement;
  private signature = "";

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "quests",
      title: "Quests",
      key: "j",
      keyLabel: "Quests",
      registry: ctx.registry,
      placement: { right: "10px", bottom: "48px", width: "190px", maxHeight: "calc(100vh - 110px)" },
      group: "side",
      onOpen: () => this.refresh(true),
    });

    this.summaryLine = document.createElement("p");
    this.summaryLine.className = "u-dim quests__summary";
    this.list = document.createElement("div");
    this.list.className = "quests__list";
    this.frame.body.append(this.summaryLine, this.list);
  }

  refresh(force = false): void {
    const quests = this.ctx.api.getQuests();
    // The pinned id is part of the signature: pinning from the tracker or another session must
    // repaint the pin toggles even though no quest data changed.
    const signature = quests
      .map((quest) => `${quest.id}:${quest.status}:${quest.stage}`)
      .join("|") + `#${this.ctx.pinnedQuestId() ?? ""}`;
    if (!force && signature === this.signature) return;
    this.signature = signature;

    const active = quests.filter((quest) => quest.status === "active").length;
    const done = quests.filter((quest) => quest.status === "complete").length;
    this.frame.setSubtitle(`${active} active · ${done}/${quests.length} done`);
    this.summaryLine.textContent = quests.length === 0
      ? "No quests known yet. Talk to somebody."
      : "Talk to the person who gave it to you when a stage says to report back.";

    const ordered = [...quests].sort((a, b) => {
      const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      return byStatus !== 0 ? byStatus : a.name.localeCompare(b.name);
    });

    this.list.replaceChildren(...ordered.map((quest) => this.buildEntry(quest)));
  }

  private buildEntry(quest: QuestSummary): HTMLElement {
    const entry = document.createElement("article");
    entry.className = `quests__entry is-${quest.status}`;

    const head = document.createElement("header");
    head.className = "quests__head";

    const name = document.createElement("h3");
    name.className = "quests__name";
    name.textContent = quest.name;

    const status = document.createElement("span");
    status.className = "quests__status u-caps";
    status.textContent = quest.status === "active"
      ? `Stage ${quest.stage + 1} of ${quest.stageCount}`
      : STATUS_LABEL[quest.status];

    head.append(name, status);

    // Pin an active quest to the floating tracker. Only active: the tracker's whole job is the
    // current objective, and the other statuses do not have one.
    if (quest.status === "active") {
      const pinned = this.ctx.pinnedQuestId() === quest.id;
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "quests__pin";
      pin.classList.toggle("is-pinned", pinned);
      pin.textContent = pinned ? "◈" : "◇";
      pin.title = pinned ? "Unpin from tracker" : "Pin to tracker";
      pin.setAttribute("aria-label", pinned ? `Unpin ${quest.name} from tracker` : `Pin ${quest.name} to tracker`);
      pin.setAttribute("aria-pressed", pinned ? "true" : "false");
      pin.addEventListener("click", (event) => {
        event.stopPropagation();
        this.ctx.pinQuest(pinned ? null : quest.id);
        this.refresh(true);
      });
      head.appendChild(pin);
    }

    entry.appendChild(head);

    const place = document.createElement("div");
    place.className = "quests__place u-faint";
    const requires = Object.entries(quest.requirements)
      .map(([skill, level]) => `${skillName(skill as never)} ${level}`)
      .join(", ");
    place.textContent = REGION_NAMES[quest.regionId] ?? prettifyId(quest.regionId)
      + (requires ? ` · needs ${requires}` : "");
    entry.appendChild(place);

    if (quest.status === "active") {
      const objective = document.createElement("p");
      objective.className = "quests__objective";
      objective.textContent = quest.currentObjective ?? "";
      entry.appendChild(objective);

      const refs = this.buildRefs(quest.currentObjectiveRefs);
      if (refs) entry.appendChild(refs);

      const bar = document.createElement("div");
      bar.className = "bar bar--thin quests__progress";
      const fill = document.createElement("div");
      fill.className = "bar__fill";
      fill.style.width = `${Math.round((quest.stage / Math.max(1, quest.stageCount)) * 100)}%`;
      bar.appendChild(fill);
      entry.appendChild(bar);
    }

    return entry;
  }

  /** The objective's ids as a row of named chips, grouped by what you do with them. */
  private buildRefs(refs: readonly QuestObjectiveRef[]): HTMLElement | null {
    if (refs.length === 0) return null;
    const row = document.createElement("div");
    row.className = "quests__refs";
    for (const ref of refs) {
      const chip = document.createElement("span");
      chip.className = `chip chip--${ref.kind}`;
      const verb = document.createElement("span");
      verb.className = "chip__verb u-caps";
      verb.textContent = REF_GROUP[ref.kind];
      const label = document.createElement("span");
      label.className = "chip__label";
      label.textContent = refLabel(ref);
      chip.append(verb, label);
      row.appendChild(chip);
    }
    return row;
  }

  dispose(): void {
    this.frame.dispose();
  }
}
