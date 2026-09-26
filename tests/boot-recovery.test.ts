import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBootRecovery, isDownloadFailure } from "../game/src/app/bootRecovery.js";

describe("interrupted boot recovery", () => {
  let win: EventTarget;
  let doc: EventTarget & { visibilityState: string };
  let online: { onLine: boolean };
  let reload: ReturnType<typeof vi.fn>;
  let storage: Map<string, string>;
  let button: { click?: () => void };
  beforeEach(() => {
    vi.useFakeTimers();
    win = new EventTarget();
    button = {};
    doc = Object.assign(new EventTarget(), {
      visibilityState: "visible",
      getElementById: () => ({ classList: { remove() {} }, innerHTML: "", append() {} }),
      createElement: () => ({ addEventListener: (_: string, click: () => void) => { button.click = click; } }),
    });
    online = { onLine: true };
    reload = vi.fn();
    storage = new Map();
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", online);
    vi.stubGlobal("location", { replace: reload, href: "https://example.test/Corealm2/?play=local&local=memory" });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("returns to the menu without repeating a local or server join", () => {
    vi.stubGlobal("location", { replace: reload, href: "https://example.test/Corealm2/?play=host/world&local=memory" });
    storage.set("corealm.play.pending.v1", "{}");
    createBootRecovery().fail(new Error("Failed to fetch"));
    vi.runAllTimers();
    expect(reload).toHaveBeenCalledWith("https://example.test/Corealm2/?local=memory");
    expect(storage.has("corealm.play.pending.v1")).toBe(false);
  });
  it("recognizes module download errors without hiding programming errors", () => {
    for (const message of ["Failed to fetch dynamically imported module: /boot.js", "Importing a module script failed.", "error loading dynamically imported module", "Failed to fetch", "Unable to preload CSS for /boot.css"]) {
      expect(isDownloadFailure(new TypeError(message))).toBe(true);
    }
    expect(isDownloadFailure(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });
  it("waits for both visibility and connectivity, and deduplicates resume events", () => {
    doc.visibilityState = "hidden";
    online.onLine = false;
    createBootRecovery().fail(new TypeError("Failed to fetch"));
    vi.runAllTimers();
    online.onLine = true;
    win.dispatchEvent(new Event("online"));
    expect(reload).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("pageshow"));
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("stops automatic reload loops across documents but allows a manual retry", () => {
    createBootRecovery().fail(new Error("Failed to fetch"));
    vi.runAllTimers();
    createBootRecovery().fail(new Error("Failed to fetch"));
    vi.runAllTimers();
    win.dispatchEvent(new Event("online"));
    expect(reload).toHaveBeenCalledTimes(1);
    button.click!();
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it("leaves unexpected errors for manual reload", () => {
    createBootRecovery().fail(new Error("bad state"));
    vi.runAllTimers();
    win.dispatchEvent(new Event("online"));
    expect(reload).not.toHaveBeenCalled();
    button.click!();
    expect(reload).toHaveBeenCalledOnce();
  });
  it("clears recovery on successful startup", () => {
    const recovery = createBootRecovery();
    recovery.fail(new Error("Failed to fetch"));
    storage.set("corealm.bootRecovery", "1");
    recovery.complete();
    vi.runAllTimers();
    win.dispatchEvent(new Event("online"));
    expect(reload).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });
  it("keeps manual recovery available when storage is blocked", () => {
    vi.stubGlobal("sessionStorage", { getItem() { throw new Error("denied"); } });
    createBootRecovery().fail(new Error("Failed to fetch"));
    vi.runAllTimers();
    expect(reload).not.toHaveBeenCalled();
    button.click!();
    expect(reload).toHaveBeenCalledOnce();
  });
});
