/** Small line icons drawn on the same 24px grid for the game's interface. */
export type UiIconName = "pack" | "skills" | "equipment" | "quests" | "spells" | "keys" | "lab" | "close";

const PATHS: Readonly<Record<UiIconName, readonly string[]>> = {
  pack: [
    "M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6",
    "M6 6h12l2 5v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8l2-5Z",
    "M4 11l6 2m4 0 6-2M10 11h4v5h-4zM8 18h8",
  ],
  skills: [
    "M5 21v-6h4v6m2 0V10h4v11m2 0V6h4v15M3 21h19",
    "M5 3v6M2 6h6",
  ],
  equipment: [
    "M8 4 4 6l-2 5 4 2 1-2v10h10V11l1 2 4-2-2-5-4-2",
    "M8 4a4 4 0 0 0 8 0M7 16h10M12 9v7",
  ],
  quests: [
    "M7 3h12a2 2 0 0 1 2 2v2h-4V5a2 2 0 0 1 2-2M17 7v12a2 2 0 0 1-2 2H5",
    "M7 3a2 2 0 0 0-2 2v12H2v2a2 2 0 0 0 4 0v-2h7M9 8h5M9 11h5M9 14h3",
  ],
  spells: [
    "M12 9c-2-2-5-3-9-2v13c4-1 7 0 9 2 2-2 5-3 9-2V7c-2-.5-4-.4-6 0M12 9v13",
    "m13 2 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2ZM6 12l3 1M6 16l3 1M15 13l3-1M15 17l3-1",
  ],
  keys: [
    "M9 3h6v6H9zM2 12h6v7H2zM9 12h6v7H9zM16 12h6v7h-6z",
    "m11 6 1-1 1 1M5 15l-1 1 1 1m6-1 1 1 1-1m8-1 1 1-1 1",
  ],
  lab: [
    "M9 3h6M10 3v6l-6 9a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3l-6-9V3M7 14h10",
    "M10 18h.01M14 17h.01",
  ],
  close: ["m6 6 12 12M18 6 6 18"],
};

/** Decorative: the surrounding button supplies its accessible name and keyboard behavior. */
export function createUiIcon(name: UiIconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("ui-icon");
  for (const d of PATHS[name]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}
