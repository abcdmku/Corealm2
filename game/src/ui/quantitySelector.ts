export type QuantityMode = "1" | "5" | "10" | "all" | "custom";

/** A labelled row of quantity choices: 1 / 5 / 10 / All / custom. Shared by the bank and the shop. */
export class QuantitySelector {
  readonly root: HTMLElement;
  private mode: QuantityMode = "1";
  private readonly input: HTMLInputElement;
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(label: string, private readonly onChange?: () => void) {
    const root = document.createElement("div");
    root.className = "qty";

    const caption = document.createElement("span");
    caption.className = "u-caps u-dim";
    caption.textContent = label;
    root.appendChild(caption);

    const group = document.createElement("div");
    group.className = "qty__group";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", label);

    const modes: QuantityMode[] = ["1", "5", "10", "all", "custom"];
    for (const mode of modes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--ghost qty__btn";
      button.textContent = mode === "all" ? "All" : mode === "custom" ? "X" : mode;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", mode === this.mode ? "true" : "false");
      button.addEventListener("click", () => this.setMode(mode));
      this.buttons.push(button);
      group.appendChild(button);
    }
    root.appendChild(group);

    const input = document.createElement("input");
    input.type = "number";
    input.className = "field field--qty";
    input.min = "1";
    input.value = "100";
    input.hidden = true;
    input.setAttribute("aria-label", `${label}: custom amount`);
    input.addEventListener("change", () => this.onChange?.());
    root.appendChild(input);

    this.root = root;
    this.input = input;
    this.syncButtons();
  }

  setMode(mode: QuantityMode): void {
    this.mode = mode;
    this.syncButtons();
    if (mode === "custom") this.input.focus();
    this.onChange?.();
  }

  /** `available` is the stack size the player could act on, used for "All". */
  resolve(available: number): number {
    switch (this.mode) {
      case "1": return 1;
      case "5": return Math.max(1, Math.min(5, available));
      case "10": return Math.max(1, Math.min(10, available));
      case "all": return Math.max(1, available);
      case "custom": {
        const parsed = Number.parseInt(this.input.value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
      }
      default: return 1;
    }
  }

  private syncButtons(): void {
    const modes: QuantityMode[] = ["1", "5", "10", "all", "custom"];
    this.buttons.forEach((button, index) => {
      const on = modes[index] === this.mode;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-checked", on ? "true" : "false");
    });
    this.input.hidden = this.mode !== "custom";
  }
}
