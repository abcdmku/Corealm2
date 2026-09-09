import { PanelFrame } from "./panelFrame.js";
/** Setup controls around the shared production feature yard. */
import type {
  FeatureLabApi,
  FeatureLabMode,
  FeatureLabMotionView,
  FeatureLabState,
  FeatureLabStructureKind,
  FeatureLabStructureKit,
  FeatureLabTargetKind,
  SkillId,
  SpellId,
} from "../contracts.js";
import { notify } from "./contextMenu.js";
import type { ManagedPanel, UiContext } from "./panels.js";


function option(value: string, label: string): HTMLOptionElement {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function field<T extends HTMLInputElement | HTMLSelectElement>(control: T, id: string): T {
  control.id = id;
  control.classList.add("field");
  return control;
}

function labelled(label: string, control: HTMLElement): HTMLLabelElement {
  const root = document.createElement("label");
  root.className = "lab-field";
  const text = document.createElement("span");
  text.className = "u-caps u-dim";
  text.textContent = label;
  root.append(text, control);
  return root;
}

function workbench(id: string, title: string): HTMLElement {
  const root = document.createElement("section");
  root.id = id;
  root.className = "lab-workbench lab-section";
  root.setAttribute("aria-label", title);

  const heading = document.createElement("h3");
  heading.textContent = title;
  root.appendChild(heading);
  return root;
}

export class FeatureLabPanel implements ManagedPanel {
  readonly frame: PanelFrame;

  private readonly mode = field(document.createElement("select"), "lab-mode");
  private readonly status = document.createElement("p");
  private readonly presentationToggle = document.createElement("a");
  private readonly presentationNote = document.createElement("p");
  private readonly combatWorkbench = workbench("lab-combat-workbench", "Combat workbench");
  private readonly bankWorkbench = workbench("lab-bank-workbench", "Bank workbench");
  private readonly buildingWorkbench = workbench("lab-building-workbench", "Building workbench");

  private readonly kind = field(document.createElement("select"), "lab-target-kind");
  private readonly target = field(document.createElement("select"), "lab-target");
  private readonly skill = field(document.createElement("select"), "lab-skill");
  private readonly level = field(document.createElement("input"), "lab-level");
  private readonly spell = field(document.createElement("select"), "lab-spell");
  private readonly attack: HTMLButtonElement;
  private readonly cast: HTMLButtonElement;
  private readonly awakenAltar: HTMLButtonElement;

  private readonly sourceKind = field(document.createElement("select"), "lab-source-kind");
  private readonly structureId = field(document.createElement("select"), "lab-structure-id");
  private readonly kit = field(document.createElement("select"), "lab-kit-id");
  private readonly width = field(document.createElement("input"), "lab-footprint-width");
  private readonly depth = field(document.createElement("input"), "lab-footprint-depth");
  private readonly depthLabel: HTMLElement;
  private readonly seed = field(document.createElement("input"), "lab-variant-seed");
  private readonly playerVisible = document.createElement("input");
  private readonly walking = document.createElement("input");
  private readonly freeMove = document.createElement("input");

  private targetKind: FeatureLabTargetKind | null = null;
  private structureKind: FeatureLabStructureKind | null = null;
  private shownTargetEntityId: string | null | undefined;
  private shownSpellId: SpellId | null | undefined;
  private signature = "";

  constructor(private readonly ctx: UiContext, private readonly lab: FeatureLabApi) {
    this.frame = new PanelFrame({
      id: "feature-lab",
      title: "Feature lab",
      key: "l",
      keyLabel: "Lab",
      registry: ctx.registry,
      placement: { right: "10px", bottom: "48px", width: "300px", maxHeight: "calc(100vh - 110px)" },
      group: "side",
      onOpen: () => this.refresh(true),
    });

    this.mode.classList.add("lab-mode-select");
    this.mode.append(option("combat", "Combat"), option("building", "Building"));
    this.mode.addEventListener("change", () => this.invoke(() => (
      this.lab.setMode(this.mode.value as FeatureLabMode)
    )));

    this.status.id = "lab-status";
    this.status.className = "lab-status";
    this.status.style.whiteSpace = "pre-wrap";

    this.presentationToggle.id = "lab-presentation-toggle";
    this.presentationToggle.className = "btn";
    this.presentationNote.id = "lab-presentation-note";
    this.presentationNote.className = "empty-state";

    this.kind.append(option("creature", "Creature"), option("npc", "NPC"));
    this.kind.addEventListener("change", () => {
      this.populateTargets(this.kind.value as FeatureLabTargetKind);
    });
    const spawn = this.button("lab-spawn-target", "Spawn chosen target", () => this.lab.spawnTarget(
      this.kind.value as FeatureLabTargetKind,
      this.target.value,
    ));

    const catalog = this.lab.getCatalog();
    const spellRangeLink = document.createElement("a");
    spellRangeLink.id = "lab-open-spell-range";
    spellRangeLink.className = "btn";
    spellRangeLink.textContent = "Open 24-spell range";
    const rangeUrl = new URL(window.location.href);
    rangeUrl.searchParams.set("mode", "combat"); rangeUrl.searchParams.set("spells", "1");
    spellRangeLink.href = rangeUrl.href;
    this.skill.append(...catalog.skills.map((row) => option(row.id, row.label)));
    this.skill.value = "magic";
    this.skill.addEventListener("change", () => this.refresh(true));
    this.level.type = "number";
    this.level.min = "1";
    this.level.max = "99";
    this.level.step = "1";
    const setLevel = this.button("lab-set-level", "Set skill level", () => this.lab.setLevel(
      this.skill.value as SkillId,
      Number(this.level.value),
    ));

    this.spell.append(...catalog.spells.map((row) => option(row.id, row.label)));
    const setSpell = this.button("lab-select-spell", "Select spell", () => (
      this.lab.setSpell(this.spell.value as SpellId)
    ));
    const combatActions = document.createElement("div");
    combatActions.className = "lab-actions";
    this.attack = this.button("lab-attack", "Attack spawned creature", () => this.lab.perform("attack"));
    this.cast = this.button("lab-cast", "Cast at spawned creature", () => this.lab.perform("cast"));
    combatActions.append(
      this.attack,
      this.cast,
      this.button("lab-reset-player", "Reset player", () => this.lab.perform("reset-player")),
    );

    const gear = document.createElement("p");
    gear.className = "empty-state lab-gear-note";
    gear.textContent = "Open Worn and choose a slot to equip any production item valid for it.";

    this.combatWorkbench.append(
      spellRangeLink,
      labelled("Target kind", this.kind),
      labelled("Target", this.target),
      spawn,
      labelled("Skill", this.skill),
      labelled("Level", this.level),
      setLevel,
      labelled("Spell", this.spell),
      setSpell,
      combatActions,
      gear,
    );

    const bankActions = document.createElement("div");
    bankActions.className = "lab-actions";
    bankActions.append(
      this.button("lab-open-bank", "Open bank", () => this.lab.perform("open-bank")),
      this.button("lab-reset-bank", "Reset bank fixture", () => this.lab.perform("reset-bank")),
    );
    const bankNote = document.createElement("p");
    bankNote.className = "empty-state";
    bankNote.textContent = "The chest, carried items, storage, and transfer window all use production code.";
    this.bankWorkbench.append(bankActions, bankNote);

    this.sourceKind.append(
      option("prefab", "Prefab"),
      option("composition", "Composition"),
      option("wall-run", "Wall run"),
    );
    this.sourceKind.addEventListener("change", () => {
      const kind = this.sourceKind.value as FeatureLabStructureKind;
      const id = this.firstStructureId(kind);
      this.invoke(() => this.lab.setStructure({ kind, id }));
    });
    this.structureId.addEventListener("change", () => this.invoke(() => (
      this.lab.setStructure({ id: this.structureId.value })
    )));

    this.kit.append(...catalog.structures.kits.map((row) => option(row.id, row.label)));
    this.kit.addEventListener("change", () => this.invoke(() => this.lab.setStructure({
      kit: this.kit.value as FeatureLabStructureKit,
    })));

    for (const input of [this.width, this.depth]) {
      input.type = "number";
      input.min = "2";
      input.max = "30";
      input.step = "1";
    }
    this.width.addEventListener("change", () => this.invoke(() => this.lab.setStructure({
      width: Number(this.width.value),
    })));
    this.depth.addEventListener("change", () => this.invoke(() => this.lab.setStructure({
      depth: Number(this.depth.value),
    })));
    const depthField = labelled("Depth", this.depth);
    this.depthLabel = depthField.firstElementChild as HTMLElement;

    this.seed.type = "number";
    this.seed.min = "0";
    this.seed.step = "1";
    this.seed.addEventListener("change", () => this.invoke(() => this.lab.setStructure({
      seed: Number(this.seed.value),
    })));
    const structureActions = document.createElement("div");
    structureActions.className = "lab-actions";
    structureActions.append(
      this.button("lab-previous-seed", "Previous seed", () => this.lab.setStructure({
        seed: Math.max(0, Number(this.seed.value) - 1),
      })),
      this.button("lab-next-seed", "Next seed", () => this.lab.setStructure({
        seed: Number(this.seed.value) + 1,
      })),
      this.button("lab-fit-structure", "Fit structure", () => this.lab.fitStructure()),
    );
    this.awakenAltar = this.button(
      "lab-awaken-altar",
      "Use Air Orb on altar",
      () => this.lab.perform("awaken-altar"),
    );

    this.playerVisible.id = "lab-player-visible";
    this.playerVisible.type = "checkbox";
    this.playerVisible.style.width = "auto";
    this.playerVisible.addEventListener("change", () => this.invoke(() => (
      this.lab.setPlayerVisible(this.playerVisible.checked)
    )));

    this.walking.id = "lab-walk-enabled";
    this.walking.type = "checkbox";
    this.walking.style.width = "auto";
    this.walking.addEventListener("change", () => this.invoke(() => (
      this.lab.setWalkingEnabled(this.walking.checked)
    )));

    this.freeMove.id = "lab-free-move";
    this.freeMove.type = "checkbox";
    this.freeMove.style.width = "auto";
    this.freeMove.addEventListener("change", () => this.invoke(() => (
      this.lab.setFreeCameraEnabled(this.freeMove.checked)
    )));

    const playerVisibleToggle = labelled("Player visible", this.playerVisible);
    const walkToggle = labelled("Walk in yard", this.walking);
    const freeMoveToggle = labelled("Free camera", this.freeMove);
    this.buildingWorkbench.append(
      labelled("Source kind", this.sourceKind),
      labelled("Structure", this.structureId),
      labelled("Regional kit", this.kit),
      labelled("Width", this.width),
      depthField,
      labelled("Variant seed", this.seed),
      structureActions,
      this.awakenAltar,
      playerVisibleToggle,
      walkToggle,
      freeMoveToggle,
    );

    this.frame.body.append(
      labelled("Workbench", this.mode),
      this.presentationToggle,
      this.presentationNote,
      this.status,
      this.combatWorkbench,
      this.bankWorkbench,
      this.buildingWorkbench,
    );
    this.populateTargets("creature");
    this.populateStructureIds("prefab");
    this.refresh(true);
  }

  refresh(force = false): void {
    const state = this.lab.getState();
    const skillId = this.skill.value as SkillId;
    const status = this.statusFor(state);
    const signature = this.signatureFor(state, skillId, status);
    if (!force && signature === this.signature) return;
    this.signature = signature;

    this.mode.value = state.mode;
    const presentationUrl = new URL(window.location.href);
    const presentationRequested = presentationUrl.searchParams.get("presentation") === "1";
    if (presentationRequested) presentationUrl.searchParams.delete("presentation");
    else presentationUrl.searchParams.set("presentation", "1");
    this.presentationToggle.href = presentationUrl.href;
    this.presentationToggle.textContent = presentationRequested
      ? "Remove presentation fixture"
      : "Add presentation fixture";
    this.presentationNote.hidden = !presentationRequested;
    this.presentationNote.textContent = state.presentation?.enabled
      ? `${state.presentation.resourceEntityIds.length} gatherable resources; `
        + `${state.presentation.scatterInstances} foliage instances. Close the lab panel, then click `
        + "Oak or Copper Rock to gather. Compare the matching trees before and after chopping."
      : "Switch to Combat to load the presentation fixture.";
    this.showWorkbench(this.combatWorkbench, state.mode === "combat");
    this.showWorkbench(this.bankWorkbench, state.mode === "combat");
    this.showWorkbench(this.buildingWorkbench, state.mode === "building");

    const targetEntityId = state.target?.entityId ?? null;
    if (targetEntityId !== this.shownTargetEntityId) {
      this.shownTargetEntityId = targetEntityId;
      if (state.target) {
        this.kind.value = state.target.kind;
        this.populateTargets(state.target.kind, state.target.presetId);
      }
    }
    this.syncInput(this.level, state.levels[skillId] ?? 1, force);
    if (state.spellId !== this.shownSpellId) {
      this.shownSpellId = state.spellId;
      if (state.spellId) this.spell.value = state.spellId;
    }

    const selection = state.structure.selection;
    this.sourceKind.value = selection.kind;
    this.populateStructureIds(selection.kind, selection.id);
    this.kit.value = selection.kit;
    this.syncInput(this.width, selection.width, force);
    this.syncInput(this.depth, selection.depth, force);
    this.syncInput(this.seed, selection.seed, force);
    const fixedComposition = selection.kind === "composition";
    this.width.disabled = fixedComposition;
    this.depth.disabled = fixedComposition;
    const wallRun = selection.kind === "wall-run";
    this.width.min = wallRun ? "6" : "2";
    this.width.step = wallRun ? "2" : "1";
    this.depth.min = "2";
    this.depth.max = wallRun ? String(Math.max(2, selection.width - 4)) : "30";
    this.depth.step = wallRun ? "2" : "1";
    this.depthLabel.textContent = selection.kind === "wall-run" ? "Opening" : "Depth";
    this.playerVisible.checked = state.playerVisible;
    this.walking.checked = state.walkingEnabled;
    this.freeMove.checked = state.freeCameraEnabled;

    const creatureReady = state.target?.kind === "creature"
      && state.target.state !== "dead"
      && (state.target.health === null || state.target.health > 0);
    this.attack.disabled = !creatureReady;
    this.cast.disabled = !creatureReady;
    this.awakenAltar.disabled = state.altar === null || state.altar.state === "awakened";
    this.status.textContent = status;
    this.frame.setSubtitle(`${state.mode} · production yard`);
  }

  dispose(): void {
    this.frame.dispose();
  }

  private populateTargets(kind: FeatureLabTargetKind, selected?: string): void {
    if (this.targetKind !== kind) {
      this.targetKind = kind;
      const rows = this.lab.getCatalog().targets[kind];
      this.target.replaceChildren(...rows.map((row) => option(row.id, row.label)));
    }
    if (selected && [...this.target.options].some((row) => row.value === selected)) {
      this.target.value = selected;
    }
  }

  private populateStructureIds(kind: FeatureLabStructureKind, selected?: string): void {
    if (this.structureKind !== kind) {
      this.structureKind = kind;
      const catalog = this.lab.getCatalog().structures;
      const rows = kind === "prefab"
        ? catalog.prefabs
        : kind === "composition" ? catalog.compositions : [{ id: "wall_run", label: "Wall run" }];
      this.structureId.replaceChildren(...rows.map((row) => option(row.id, row.label)));
    }
    if (selected && [...this.structureId.options].some((row) => row.value === selected)) {
      this.structureId.value = selected;
    }
  }

  private firstStructureId(kind: FeatureLabStructureKind): string {
    const catalog = this.lab.getCatalog().structures;
    if (kind === "wall-run") return "wall_run";
    const row = kind === "prefab" ? catalog.prefabs[0] : catalog.compositions[0];
    if (!row) throw new Error(`No ${kind} structures are available`);
    return row.id;
  }

  private showWorkbench(root: HTMLElement, visible: boolean): void {
    root.hidden = !visible;
    root.style.display = visible ? "flex" : "none";
  }

  private syncInput(input: HTMLInputElement, value: number, force: boolean): void {
    if (force || document.activeElement !== input) input.value = String(value);
  }

  private button(
    id: string,
    label: string,
    action: () => unknown | Promise<unknown>,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = "btn";
    button.textContent = label;
    button.addEventListener("click", () => this.invoke(action, button));
    return button;
  }

  private invoke(action: () => unknown | Promise<unknown>, button?: HTMLButtonElement): void {
    if (button) button.disabled = true;
    Promise.resolve()
      .then(action)
      .then(() => {
        this.ctx.refresh();
        this.refresh(true);
      })
      .catch((cause: unknown) => {
        notify(cause instanceof Error ? cause.message : String(cause), "error");
        this.refresh(true);
      })
      .finally(() => {
        if (button) button.disabled = false;
        this.refresh(true);
      });
  }

  private statusFor(state: FeatureLabState): string {
    const structure = state.structure;
    const selection = structure.selection;
    const structureLabel = [
      structure.ready ? "ready" : "not ready",
      `${selection.kind} ${selection.id}`,
      selection.kit,
      `${selection.width} x ${selection.depth}`,
      `seed ${selection.seed}`,
      structure.variant ? `variant ${structure.variant}` : null,
    ].filter((value): value is string => value !== null).join("; ");
    const structureCounts = [
      `${structure.partCount} parts`,
      `${structure.assetCount} assets`,
      `${structure.collisionCount} collisions`,
      `${structure.buildMs.toFixed(0)} ms`,
    ].join("; ");
    const position = state.playerPosition.map((value) => value.toFixed(1)).join(", ");
    const player = [
      `${state.player.health}/${state.player.maxHealth} health`,
      `position ${position}`,
      state.movement.mode,
      `motion ${this.motionLabel(state.playerMotion)}`,
    ].join("; ");
    const target = state.target
      ? [
          `${state.target.name} (${state.target.state})`,
          `${state.target.health ?? "-"}/${state.target.maxHealth ?? "-"} health`,
          state.selectedEntityId === state.target.entityId ? "selected" : "not selected",
          `motion ${this.motionLabel(state.target.motion)}`,
        ].join("; ")
      : "none";
    const activity = [
      `${state.liveSpellParticles} spell particles`,
      `${state.counters.combatStarted} combats`,
      `${state.counters.spellLaunched} spells`,
      `${state.counters.navigationStarted}/${state.counters.navigationCompleted} routes`,
    ].join("; ");
    const altar = state.altar
      ? `${state.altar.state}; ${state.altar.element}; interactions ${state.altar.interactions.join(", ")}; `
        + `Orb ${state.altar.orbConsumed ? "consumed" : "ready"}`
      : "not selected";
    const bank = state.bank
      ? `${state.bank.contents.usedSlots}/${state.bank.contents.capacity} slots; ${state.bank.state}`
      : "missing";
    const errors = state.errors.length === 0
      ? "none"
      : `${state.errors.length}: ${state.errors.slice(-3).join(" | ")}`;
    return [
      `Engine ${state.engine}; world ${state.world}; mode ${state.mode}; walking ${state.walkingEnabled ? "on" : "off"}`,
      `Structure ${structureLabel}`,
      `Counts ${structureCounts}`,
      `Player ${player}`,
      `Target ${target}`,
      `Bank ${bank}`,
      `Altar ${altar}`,
      `Activity ${activity}`,
      `Errors ${errors}`,
    ].join("\n");
  }

  private motionLabel(motion: FeatureLabMotionView | null): string {
    if (!motion) return "unavailable";
    const name = motion.motion ?? motion.pose ?? "idle";
    const clip = motion.clip ? ` / ${motion.clip}` : "";
    const time = typeof motion.time === "number" ? ` at ${motion.time.toFixed(2)} s` : "";
    const rig = motion.liveRig === false ? " / fallback rig" : "";
    return `${name}${clip}${time}${rig}`;
  }

  private signatureFor(state: FeatureLabState, skillId: SkillId, status: string): string {
    const selection = state.structure.selection;
    return [
      status,
      state.mode,
      state.walkingEnabled,
      state.playerVisible,
      state.freeCameraEnabled,
      state.target?.entityId ?? "-",
      state.levels[skillId],
      state.spellId ?? "-",
      state.bank?.state ?? "-",
      ...(state.bank?.contents.slots.map((stack) => `${stack.itemId}:${stack.quantity}`) ?? []),
      ...(state.bank?.inventory.map((stack) => `held:${stack.itemId}:${stack.quantity}`) ?? []),
      selection.kind,
      selection.id,
      selection.kit,
      selection.width,
      selection.depth,
      selection.seed,
      state.altar?.state ?? "-",
      state.altar?.orbConsumed ?? false,
    ].join("|");
  }
}
