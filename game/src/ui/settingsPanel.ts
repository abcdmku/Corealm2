import { PanelFrame } from "./panelFrame.js";
/**
 * The settings screen, over `SettingsStore`.
 *
 * Every control here changes the client as it moves. The face of each row is a label and a
 * control, nothing else; what a setting changes in the picture or the sound is a hover title on
 * the label, so the window reads as a short list rather than a page of prose.
 *
 * The DOM is built once and only its states are synced afterwards. `refresh()` is called on the
 * panel cadence — every 220 ms while the panel is open — and rebuilding the rows on that beat
 * would blow away the focus ring mid-Tab and drop a switch the player was holding Enter on.
 *
 * The panel also subscribes to the store, so a setting changed anywhere else (the debug surface,
 * a second panel, "reset") shows up here without the panel being reopened.
 */
import type { AudioBus } from "../contracts.js";
import type { DrawDistance, RenderScale, SettingsStore, ShadowQuality, UiSettings } from "./settings.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import type { SaveRecoveryControls } from "./titleScreen.js";

import { notify } from "./contextMenu.js";

/** The two non-renderer booleans, in the order they are shown. */
interface ToggleSpec {
  key: "damageNumbers" | "invertCameraY" | "agentCompanion";
  label: string;
  /** What changes on screen. Shown on hover, not a restatement of the label. */
  hint: string;
}

const TOGGLES: readonly ToggleSpec[] = [
  {
    key: "invertCameraY",
    label: "Invert vertical look",
    hint: "Drag down to raise the camera instead of lowering it.",
  },
  {
    key: "damageNumbers",
    label: "Damage numbers",
    hint: "Hits and misses float over whoever took them.",
  },
  {
    key: "agentCompanion",
    label: "Agent companion",
    hint: "The companion card in the top-left corner. Its × hides it; this brings it back.",
  },
];

const RENDER_SCALES: readonly { value: RenderScale; label: string; accessibleLabel: string }[] = [
  { value: 0.7, label: "70%", accessibleLabel: "70 percent" },
  { value: 0.85, label: "85%", accessibleLabel: "85 percent" },
  { value: 1, label: "100%", accessibleLabel: "100 percent" },
];

const SHADOW_QUALITIES: readonly { value: ShadowQuality; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
];

const DRAW_DISTANCES: readonly { value: DrawDistance | "auto"; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "near", label: "Near" },
  { value: "medium", label: "Medium" },
  { value: "far", label: "Far" },
];

const DENSITY: readonly { value: UiSettings["uiScale"]; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "compact", label: "Compact" },
];

const AUDIO_CONTROLS: readonly {
  key: AudioBus;
  label: string;
  hint: string;
}[] = [
  {
    key: "music",
    label: "Music",
    hint: "Region themes, where the current region has one.",
  },
  {
    key: "ambient",
    label: "Ambient",
    hint: "Wind, wildlife, town life, and the Stone Cavern interior.",
  },
  {
    key: "sfx",
    label: "SFX",
    hint: "Movement, combat, gathering, crafting, and interface feedback.",
  },
];

export class SettingsPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly body: HTMLElement;
  private readonly switches = new Map<ToggleSpec["key"], HTMLButtonElement>();
  private readonly renderScaleButtons = new Map<RenderScale, HTMLButtonElement>();
  private readonly shadowQualityButtons = new Map<ShadowQuality, HTMLButtonElement>();
  private readonly drawDistanceButtons = new Map<DrawDistance | "auto", HTMLButtonElement>();
  private readonly densityButtons = new Map<UiSettings["uiScale"], HTMLButtonElement>();
  private readonly audioInputs = new Map<AudioBus, HTMLInputElement>();
  private readonly audioOutputs = new Map<AudioBus, HTMLOutputElement>();
  private readonly unsubscribe: () => void;
  private recoveryGroup: HTMLElement | null = null;
  private recoveryIntro: HTMLElement | null = null;
  private recoveryReason: HTMLElement | null = null;
  private recoveryActions: HTMLElement | null = null;
  private recoveryStatus: HTMLElement | null = null;
  private recoveryDownload: HTMLButtonElement | null = null;
  private recoveryImport: HTMLButtonElement | null = null;
  private recoveryBusy = false;
  private recoverySucceeded = false;
  private recoveryMessage = "";
  private disposed = false;

  constructor(
    ctx: UiContext,
    private readonly settings: SettingsStore,
    onClose?: () => void,
    private readonly saveRecovery?: SaveRecoveryControls,
  ) {
    this.frame = new PanelFrame({
      id: "settings",
      title: "Settings",
      registry: ctx.registry,
      placement: { top: "72px", left: "50%", width: "420px" },
      onOpen: () => this.refresh(true),
      onClose,
    });
    this.frame.root.setAttribute("aria-modal", "true");
    this.frame.root.addEventListener("keydown", this.onKeyDown);

    this.body = document.createElement("div");
    this.body.className = "settings";
    this.frame.body.appendChild(this.body);

    this.build();
    // Fires immediately, so the controls start in sync with the stored value.
    this.unsubscribe = this.settings.subscribe(() => this.sync());
  }

  /** States only. The rows themselves never move. */
  refresh(_force = false): void {
    this.sync();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.frame.root.removeEventListener("keydown", this.onKeyDown);
    this.frame.dispose();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Escape reaches the shared escape stack. Every other key remains inside this modal so slider
    // arrows cannot also move the character behind it.
    if (event.key === "Escape") return;
    if (event.key !== "Tab") {
      event.stopPropagation();
      return;
    }

    event.stopPropagation();
    const stops = [...this.frame.root.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex='0']",
    )].filter((stop) => !stop.hidden && !stop.closest("[hidden]"));
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === this.frame.root)) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  // --------------------------------------------------------------- building

  private build(): void {
    this.body.replaceChildren();
    if (this.saveRecovery) this.buildRecovery();

    const audio = this.group("Audio");
    for (const spec of AUDIO_CONTROLS) audio.appendChild(this.volumeRow(spec));

    const graphics = this.group("Graphics");
    graphics.append(
      this.choiceRow(
        "Resolution",
        "Fewer pixels help the GPU at the cost of a softer picture.",
        "Render resolution",
        RENDER_SCALES,
        this.renderScaleButtons,
        (value) => { this.settings.set({ renderScale: value }); },
      ),
      this.choiceRow(
        "Shadows",
        "Off removes moving sun shadows and saves the most work.",
        "Shadow quality",
        SHADOW_QUALITIES,
        this.shadowQualityButtons,
        (value) => { this.settings.set({ shadowQuality: value }); },
      ),
      this.choiceRow(
        "Draw distance",
        "Auto adjusts the range to keep play smooth.",
        "Draw distance",
        DRAW_DISTANCES,
        this.drawDistanceButtons,
        (value) => { this.settings.set(value === "auto" ? { autoDrawDistance: true }
          : { drawDistance: value, autoDrawDistance: false }); },
      ),
    );

    const game = this.group("Game");
    for (const spec of TOGGLES) game.appendChild(this.toggleRow(spec));
    game.appendChild(this.densityRow());

    const footer = document.createElement("div");
    footer.className = "settings__footer";

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "btn btn--ghost";
    reset.textContent = "Reset to defaults";
    reset.addEventListener("click", () => {
      this.settings.reset();
      notify("Settings reset to defaults", "info");
    });

    footer.append(reset);
    this.body.appendChild(footer);
  }

  /** Recovery is visible only when a stored character needs it or an import just succeeded. */
  private buildRecovery(): void {
    const section = this.group("Save recovery");
    section.dataset["saveRecovery"] = "true";
    this.recoveryGroup = section;

    const intro = document.createElement("p");
    intro.className = "settings__note";
    intro.textContent = "Saving is paused. Download the original file to keep a copy. Importing a working"
      + " save loads that character and replaces the stored original. New game in the game menu deletes it.";
    this.recoveryIntro = intro;

    const reason = document.createElement("p");
    reason.className = "settings__hint";
    reason.style.overflowWrap = "anywhere";
    this.recoveryReason = reason;

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "8px";
    this.recoveryActions = actions;

    const download = document.createElement("button");
    download.type = "button";
    download.className = "btn";
    download.textContent = "Download original save";
    download.addEventListener("click", () => this.downloadOriginalSave());
    this.recoveryDownload = download;

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,.txt,application/json,text/plain";
    fileInput.hidden = true;
    fileInput.style.display = "none";
    fileInput.tabIndex = -1;
    fileInput.setAttribute("aria-label", "Choose a save file to recover");
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) void this.importRecoveryFile(file);
    });

    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className = "btn btn--primary";
    importButton.textContent = "Import a working save";
    importButton.addEventListener("click", () => fileInput.click());
    this.recoveryImport = importButton;
    actions.append(download, importButton, fileInput);

    const status = document.createElement("p");
    status.className = "settings__hint";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.tabIndex = -1;
    this.recoveryStatus = status;
    section.append(intro, reason, actions, status);
  }

  private downloadOriginalSave(): void {
    const recovery = this.saveRecovery?.getRecovery();
    if (!recovery || recovery.raw === null) return;
    let url: string | null = null;
    try {
      // Export the original bytes, including whitespace and malformed JSON, without reserializing.
      url = URL.createObjectURL(new Blob([recovery.raw], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "corealm-original-save.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      this.recoveryMessage = "Original save download started. The stored original is still protected.";
    } catch {
      this.recoveryMessage = "The original save could not be downloaded. It is still protected.";
    } finally {
      if (url) {
        const downloadUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
      }
      this.syncRecovery();
    }
  }

  private async importRecoveryFile(file: File): Promise<void> {
    if (this.recoveryBusy || !this.saveRecovery?.getRecovery()) return;
    this.recoveryBusy = true;
    this.recoveryMessage = "Checking the selected save...";
    this.syncRecovery();
    try {
      const json = await file.text();
      // A disposed panel or an explicit New Game during the read cancels this pending import.
      if (this.disposed || !this.saveRecovery.getRecovery()) return;
      const result = await this.saveRecovery.recoverSave(json);
      this.recoverySucceeded = result.ok;
      this.recoveryMessage = result.ok
        ? "Save recovered. Your character is loaded and saving is active."
        : `${result.reason ?? "The selected save could not be recovered."} The original is still protected.`;
    } catch {
      this.recoveryMessage = "The selected file could not be recovered. The original is still protected.";
    } finally {
      this.recoveryBusy = false;
      if (!this.disposed) {
        this.syncRecovery();
        this.recoveryStatus?.focus({ preventScroll: true });
      }
    }
  }

  private syncRecovery(): void {
    if (!this.recoveryGroup || !this.saveRecovery) return;
    const recovery = this.saveRecovery.getRecovery();
    const visible = Boolean(recovery) || this.recoverySucceeded;
    this.recoveryGroup.hidden = !visible;
    this.recoveryGroup.style.display = visible ? "" : "none";
    if (this.recoveryIntro) this.recoveryIntro.hidden = !recovery;
    if (this.recoveryReason) {
      this.recoveryReason.hidden = !recovery;
      this.recoveryReason.textContent = recovery
        ? `${recovery.reason}${recovery.raw === null ? ". The browser could not read the original file." : ""}`
        : "";
    }
    if (this.recoveryActions) {
      this.recoveryActions.hidden = !recovery;
      this.recoveryActions.style.display = recovery ? "flex" : "none";
    }
    if (this.recoveryDownload) this.recoveryDownload.disabled = !recovery || recovery.raw === null || this.recoveryBusy;
    if (this.recoveryImport) {
      this.recoveryImport.disabled = !recovery || this.recoveryBusy;
      this.recoveryImport.textContent = this.recoveryBusy ? "Checking save..." : "Import a working save";
    }
    if (this.recoveryStatus && this.recoveryStatus.textContent !== this.recoveryMessage) {
      this.recoveryStatus.textContent = this.recoveryMessage;
    }
  }

  private group(title: string): HTMLElement {
    const section = document.createElement("section");
    section.className = "settings__group";

    const heading = document.createElement("h3");
    heading.className = "settings__group-title u-caps u-dim";
    heading.textContent = title;

    section.appendChild(heading);
    this.body.appendChild(section);
    return section;
  }

  private toggleRow(spec: ToggleSpec): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings__row";

    const label = document.createElement("span");
    label.className = "settings__label";
    label.textContent = spec.label;
    label.title = spec.hint;

    // role="switch" rather than a checkbox: it is a control that acts at once, not a form field
    // that waits for a save button.
    const control = document.createElement("button");
    control.type = "button";
    control.className = "switch";
    control.setAttribute("role", "switch");
    control.setAttribute("aria-label", spec.label);
    control.title = spec.hint;

    const track = document.createElement("span");
    track.className = "switch__track";
    const knob = document.createElement("span");
    knob.className = "switch__knob";
    track.appendChild(knob);

    control.append(track);
    control.addEventListener("click", () => {
      this.settings.set({ [spec.key]: !this.settings.get()[spec.key] } as Partial<UiSettings>);
    });

    this.switches.set(spec.key, control);

    row.append(label, control);
    return row;
  }

  private densityRow(): HTMLElement {
    return this.choiceRow(
      "Interface size",
      "Compact shrinks type and padding across the HUD and panels.",
      "Interface density",
      DENSITY,
      this.densityButtons,
      (value) => { this.settings.set({ uiScale: value }); },
    );
  }

  private volumeRow(spec: (typeof AUDIO_CONTROLS)[number]): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings__row";

    const inputId = `setting-volume-${spec.key}`;

    const label = document.createElement("label");
    label.className = "settings__label";
    label.htmlFor = inputId;
    label.textContent = spec.label;
    label.title = spec.hint;

    const control = document.createElement("div");
    control.className = "volume";

    const input = document.createElement("input");
    input.id = inputId;
    input.className = "volume__range";
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.title = spec.hint;
    input.addEventListener("input", () => {
      const percent = Number(input.value);
      this.settings.set({ [spec.key]: percent / 100 });
    });

    const output = document.createElement("output");
    output.className = "volume__value u-numeric";
    output.setAttribute("for", inputId);

    control.append(input, output);
    row.append(label, control);
    this.audioInputs.set(spec.key, input);
    this.audioOutputs.set(spec.key, output);
    return row;
  }

  private choiceRow<T extends string | number>(
    labelText: string,
    hintText: string,
    ariaLabel: string,
    options: readonly { value: T; label: string; accessibleLabel?: string }[],
    buttons: Map<T, HTMLButtonElement>,
    onChoose: (value: T) => void,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings__row";

    const label = document.createElement("span");
    label.className = "settings__label";
    label.textContent = labelText;
    label.title = hintText;

    const group = document.createElement("div");
    group.className = "seg";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", ariaLabel);

    const choiceButtons: HTMLButtonElement[] = [];
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "seg__btn";
      button.textContent = option.label;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", `${ariaLabel}: ${option.accessibleLabel ?? option.label}`);
      button.addEventListener("click", () => { onChoose(option.value); });
      buttons.set(option.value, button);
      choiceButtons.push(button);
      group.appendChild(button);
    }

    group.addEventListener("keydown", (event) => {
      const current = choiceButtons.indexOf(event.target as HTMLButtonElement);
      if (current < 0) return;
      let next = current;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % options.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + options.length) % options.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = options.length - 1;
      else return;

      event.preventDefault();
      event.stopPropagation();
      const option = options[next];
      const button = choiceButtons[next];
      if (!option || !button) return;
      onChoose(option.value);
      button.focus({ preventScroll: true });
    });

    row.append(label, group);
    return row;
  }

  // ----------------------------------------------------------------- state

  private sync(): void {
    this.syncRecovery();
    const current = this.settings.get();

    for (const spec of AUDIO_CONTROLS) {
      const percent = Math.round(current[spec.key] * 100);
      const input = this.audioInputs.get(spec.key);
      if (input && input.value !== String(percent)) input.value = String(percent);
      if (input) {
        input.setAttribute("aria-valuetext", `${percent} percent`);
        // The filled part of the track is painted from this; a native range has no fill of its own.
        input.style.setProperty("--fill", `${percent}%`);
      }
      const output = this.audioOutputs.get(spec.key);
      const value = `${percent}%`;
      if (output && output.textContent !== value) output.textContent = value;
    }

    for (const spec of TOGGLES) {
      const on = current[spec.key];
      const control = this.switches.get(spec.key);
      if (control) {
        control.setAttribute("aria-checked", on ? "true" : "false");
        control.classList.toggle("is-on", on);
      }
    }

    for (const [value, button] of this.renderScaleButtons) {
      const on = current.renderScale === value;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-checked", on ? "true" : "false");
      button.tabIndex = on ? 0 : -1;
    }

    for (const [value, button] of this.shadowQualityButtons) {
      const on = current.shadowQuality === value;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-checked", on ? "true" : "false");
      button.tabIndex = on ? 0 : -1;
    }

    for (const [value, button] of this.drawDistanceButtons) {
      const on = current.autoDrawDistance ? value === "auto" : current.drawDistance === value;
      // Auto's face stays one word; the range it has settled on rides in the hover title.
      if (value === "auto") button.title = current.autoDrawDistance ? `Currently ${current.drawDistance}` : "";
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-checked", on ? "true" : "false");
      button.tabIndex = on ? 0 : -1;
    }

    for (const [value, button] of this.densityButtons) {
      const on = current.uiScale === value;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-checked", on ? "true" : "false");
      button.tabIndex = on ? 0 : -1;
    }
  }
}
