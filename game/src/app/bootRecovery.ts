// Content-free: this must be available before the game module can be downloaded.
import { takePendingLaunch } from "../multiplayer/playIntent.js";

const RELOAD_KEY = "corealm.bootRecovery";

export function isDownloadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|loading chunk|unable to preload css|networkerror|load failed|could not be downloaded/i.test(message);
}

export function createBootRecovery() {
  let pending = false;
  let reloading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reload = (automatic: boolean) => {
    if (reloading || document.visibilityState === "hidden" || !navigator.onLine) return;
    if (automatic) {
      // No storage means no safe way to bound retries across navigation. Keep the button instead.
      try {
        if (sessionStorage.getItem(RELOAD_KEY)) return;
        sessionStorage.setItem(RELOAD_KEY, "1");
      } catch { return; }
    }
    reloading = true;
    takePendingLaunch();
    const menu = new URL(location.href);
    menu.searchParams.delete("play");
    menu.searchParams.delete("mode");
    location.replace(menu.href);
  };
  const resume = () => { if (pending) reload(true); };
  window.addEventListener("online", resume);
  window.addEventListener("pageshow", resume);
  document.addEventListener("visibilitychange", resume);
  return {
    fail(error: unknown, download = isDownloadFailure(error)) {
      pending = download;
      clearTimeout(timer);
      const screen = document.getElementById("boot-screen");
      if (!screen) return;
      screen.classList.remove("hidden");
      screen.innerHTML = `<div class="boot-mark">COREALM</div>`;
      const message = document.createElement("div");
      message.className = "boot-error";
      message.textContent = download
        ? "The game download was interrupted. Reconnecting to the main menu..."
        : "The game couldn't start. Return to the main menu to try again.";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "boot-retry";
      button.textContent = "Main menu";
      button.addEventListener("click", () => reload(false));
      screen.append(message, button);
      if (download) timer = setTimeout(resume, 1500);
    },
    complete() {
      pending = false;
      clearTimeout(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
      try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* Storage is optional. */ }
    },
  };
}
