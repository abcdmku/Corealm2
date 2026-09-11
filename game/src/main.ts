import { boot } from "./app/boot.js";
import { bootProfileFor } from "./app/bootProfile.js";

// The game owns right-click interactions; never let Chromium replace them with its menu.
document.addEventListener("contextmenu", (event) => event.preventDefault());

const canvas = document.getElementById("viewport");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Corealm needs a <canvas id=\"viewport\">");
}

const profile = bootProfileFor(window.location);
if (profile.kind === "feature-lab") {
  const label = profile.labMode === "building" ? "Building Lab" : "Combat Lab";
  document.title = `Corealm · ${label}`;
  document.body.dataset["bootProfile"] = "feature-lab";
  document.body.dataset["labMode"] = profile.labMode ?? "combat";
}

boot(canvas, { profile }).catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error("Corealm failed to boot", error);
  const screen = document.getElementById("boot-screen");
  if (screen) {
    screen.classList.remove("hidden");
    screen.innerHTML = `<div class="boot-mark">COREALM</div><pre class="boot-error">${escapeHtml(message)}</pre>`;
  }
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}
