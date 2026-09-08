/**
 * Small line icons drawn on the same 24px grid for the game's interface.
 *
 * One or two strokes each, nothing inside the silhouette. At the dock's 22px they have to read as
 * a shape, not a drawing: a bag, a rising bar, a tunic, a scroll, a spark, a key row.
 */
export type UiIconName = "pack" | "skills" | "equipment" | "quests" | "spells" | "keys" | "lab" | "close";

const PATHS: Readonly<Record<UiIconName, readonly string[]>> = {
  // A satchel: rounded body and a single handle.
  pack: [
    "M4 9h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z",
    "M8 9V7a4 4 0 0 1 8 0v2",
  ],
  // Three bars climbing.
  skills: [
    "M5 20v-5M12 20V9M19 20V4",
  ],
  // A tunic.
  equipment: [
    "M8 4 3 7l2 4 2-1v10h10V10l2 1 2-4-5-3a4 4 0 0 1-8 0Z",
  ],
  // A scroll with two lines of writing.
  quests: [
    "M6 3h9l4 4v14H6V3Z",
    "M9 12h7M9 16h5",
  ],
  // A four-point spark.
  spells: [
    "M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z",
  ],
  // A key row.
  keys: [
    "M2 7h20v10H2z",
    "M6 11h.01M10 11h.01M14 11h.01M18 11h.01M8 14h8",
  ],
  // A flask.
  lab: [
    "M9 3h6M10 3v6l-5.5 9.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3",
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
  svg.setAttribute("stroke-width", "1.6");
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
