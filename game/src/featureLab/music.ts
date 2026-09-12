import type { AudioCatalog } from "../audio/catalog.js";
import type { Vec3 } from "../contracts.js";

/** Compact music areas use the production position selector, engine and movement tick. */
export function musicLabCatalog(catalog: AudioCatalog): AudioCatalog {
  return { ...catalog, regions: { ...catalog.regions, fallowmarch: {
    music: "music.distant-plains", ambient: "ambient.open-plains",
    musicAreas: [
      { id: "fairy", music: "music.fairy", centre: [-32, 0], radius: 10 },
      { id: "fairy-mire", music: "music.fairy-mire", centre: [32, 0], radius: 10 },
      { id: "castle", music: "music.castle", centre: [0, 0], radius: 8, exitPadding: 3 },
    ],
  } } };
}

export function createMusicWorkbench(move: (point: Vec3) => void): void {
  const panel = document.createElement("section");
  panel.setAttribute("aria-label", "Regional music lab");
  panel.style.cssText = "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:90;background:#171d20;color:#eee;padding:12px;border:1px solid #788279;border-radius:6px;font:14px sans-serif;max-width:580px";
  const title = document.createElement("div");
  title.textContent = "Regional music lab";
  panel.append(title);
  const presets: Array<[string, Vec3]> = [
    ["T30 Fairy", [-32, 0, 0]], ["T60 Fairy Mire", [32, 0, 0]],
    ["T40 Plains", [0, 0, 20]], ["Castle approach", [0, 0, 10]],
    ["Inside castle", [0, 0, 0]],
  ];
  for (const [label, point] of presets) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText = "margin:8px 6px 8px 0;padding:6px";
    button.addEventListener("click", () => { move(point); button.blur(); });
    panel.append(button);
  }
  const hint = document.createElement("div");
  hint.textContent = "At Castle approach, walk toward the yard centre to enter the 8 m music area. Leave beyond 11 m to return to Plains.";
  panel.append(hint);
  document.body.append(panel);
}
