// The entry evaluates no content. About 140 modules read content tables as they are evaluated, so the
// catalog is fetched and installed here first, and only then is the app imported. Keep every static
// import of this file content-free: `tests/client-catalog-page-graph.test.ts` checks it.
import { installPageCatalog, pageCatalogKind, type InstalledPageCatalog } from "./content/catalogEntry.js";

// The game owns right-click interactions; never let Chromium replace them with its menu.
document.addEventListener("contextmenu", (event) => event.preventDefault());

const viewport = document.getElementById("viewport");
if (!(viewport instanceof HTMLCanvasElement)) {
  throw new Error("Corealm needs a <canvas id=\"viewport\">");
}
const canvas = viewport;

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

/** The boot screen as a dead end with a way out. `retry` absent means only a reload can help. */
function showFailure(message: string, retry?: () => void): void {
  const screen = document.getElementById("boot-screen");
  if (!screen) return;
  screen.classList.remove("hidden");
  screen.innerHTML = `<div class="boot-mark">COREALM</div><pre class="boot-error">${escapeHtml(message)}</pre>`;
  if (!retry) return;
  const button = document.createElement("button");
  button.type = "button"; button.className = "boot-retry"; button.textContent = "Retry";
  button.addEventListener("click", () => {
    screen.innerHTML = `<div class="boot-mark">COREALM</div><div class="boot-status">Downloading the game...</div>`;
    retry();
  }, { once: true });
  screen.append(button);
}

// The engine has no content in it, so its download and parse overlap the catalog fetch.
void import("three").catch(() => {});

const generated = new URL("generated/", new URL(import.meta.env.BASE_URL, location.href)).href;
async function start(): Promise<void> {
  let catalog: InstalledPageCatalog;
  try {
    catalog = await installPageCatalog(generated, pageCatalogKind(location.search));
  } catch (error) {
    // Offline, or a host that is half deployed: say so and offer the fetch again. Nothing was evaluated, so a retry is clean.
    console.error("Corealm could not load its content", error);
    showFailure(error instanceof Error ? error.message : String(error), () => { void start(); });
    return;
  }
  try {
    const query = new URLSearchParams(location.search);
    if (query.get("mode") === "combat" && query.get("gpuPoc") === "1") {
      const { startWebGpuPoc } = await import("./render/webgpuPoc.js");
      await startWebGpuPoc(canvas);
      return;
    }
    // One import, so the app's modules evaluate in one fixed order. Content modules import each other in cycles, and a second
    // dynamic entry into the same graph lets the bundler start a cycle from its other side, where a table is still undefined.
    const { boot, bootProfileFor } = await import("./app/boot.js");
    const profile = bootProfileFor(window.location);
    if (profile.kind === "feature-lab") {
      const label = profile.labMode === "building" ? "Building Lab" : "Combat Lab";
      document.title = `Corealm · ${label}`;
      document.body.dataset["bootProfile"] = "feature-lab";
      document.body.dataset["labMode"] = profile.labMode ?? "combat";
    }
    await boot(canvas, { profile, catalog });
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error("Corealm failed to boot", error);
    showFailure(message);
  }
}
void start();
