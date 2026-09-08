import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COARSE_POINTER_QUERY, MobileLayout, PORTRAIT_QUERY, SMALL_SCREEN_QUERY, layoutState, resolveTouchPreference,
} from "../game/src/ui/mobileLayout.js";
import { DEFAULT_SETTINGS, SettingsStore } from "../game/src/ui/settings.js";
import { FakeElement } from "./fake-dom.js";

interface FakeQuery {
  matches: boolean;
  media: string;
  listeners: Set<() => void>;
  addEventListener(type: string, handler: () => void): void;
  removeEventListener(type: string, handler: () => void): void;
}

function fakeMatchMedia(initial: Record<string, boolean>) {
  const queries = new Map<string, FakeQuery>();
  const matchMedia = vi.fn((media: string): FakeQuery => {
    let query = queries.get(media);
    if (!query) {
      query = {
        matches: initial[media] ?? false,
        media,
        listeners: new Set(),
        addEventListener: (_type, handler) => { query!.listeners.add(handler); },
        removeEventListener: (_type, handler) => { query!.listeners.delete(handler); },
      };
      queries.set(media, query);
    }
    return query;
  });
  const set = (media: string, matches: boolean): void => {
    const query = matchMedia(media);
    query.matches = matches;
    for (const listener of query.listeners) listener();
  };
  return { matchMedia, set, queries };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mobile layout classes", () => {
  it("mirrors the phone queries onto the root and follows changes", () => {
    const media = fakeMatchMedia({ [SMALL_SCREEN_QUERY]: true, [PORTRAIT_QUERY]: true, [COARSE_POINTER_QUERY]: true });
    vi.stubGlobal("matchMedia", media.matchMedia);
    const root = new FakeElement("div") as unknown as HTMLElement;
    const layout = new MobileLayout(root);

    expect([...root.classList]).toEqual(expect.arrayContaining(["is-small", "is-portrait", "is-touch"]));
    expect(root.classList.contains("is-landscape")).toBe(false);
    expect(layoutState()).toEqual({ small: true, portrait: true, touch: true });

    const seen: boolean[] = [];
    layout.subscribe((state) => seen.push(state.portrait));
    media.set(PORTRAIT_QUERY, false);
    expect(root.classList.contains("is-landscape")).toBe(true);
    expect(seen).toEqual([true, false]);

    layout.dispose();
    expect(root.classList.length).toBe(0);
    expect(media.queries.get(PORTRAIT_QUERY)?.listeners.size).toBe(0);
  });

  it("lets the touch preference override the pointer query in both directions", () => {
    const media = fakeMatchMedia({ [COARSE_POINTER_QUERY]: false });
    vi.stubGlobal("matchMedia", media.matchMedia);
    const root = new FakeElement("div") as unknown as HTMLElement;
    const layout = new MobileLayout(root);
    const touches: boolean[] = [];
    layout.subscribe((state) => touches.push(state.touch));

    expect(root.classList.contains("is-touch")).toBe(false);
    layout.setTouchPreference("on");
    expect(root.classList.contains("is-touch")).toBe(true);
    layout.setTouchPreference("auto");
    expect(root.classList.contains("is-touch")).toBe(false);

    media.set(COARSE_POINTER_QUERY, true);
    expect(root.classList.contains("is-touch")).toBe(true);
    layout.setTouchPreference("off");
    expect(root.classList.contains("is-touch")).toBe(false);
    expect(touches).toEqual([false, true, false, true, false]);
    layout.dispose();
  });

  it("answers desktop when the browser has no matchMedia at all", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(resolveTouchPreference("auto")).toBe(false);
    expect(resolveTouchPreference("on")).toBe(true);
    const root = new FakeElement("div") as unknown as HTMLElement;
    const layout = new MobileLayout(root);
    expect(root.classList.contains("is-small")).toBe(false);
    expect(root.classList.contains("is-landscape")).toBe(true);
    layout.dispose();
  });
});

describe("touch controls setting", () => {
  it("defaults to auto and persists only the three known values", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => values.clear(),
      key: () => null,
      length: 0,
    });
    expect(DEFAULT_SETTINGS.touchControls).toBe("auto");
    const store = new SettingsStore();
    store.set({ touchControls: "on" });
    expect(new SettingsStore().get().touchControls).toBe("on");

    values.set("corealm.settings.v1", JSON.stringify({ touchControls: "maybe" }));
    expect(new SettingsStore().get().touchControls).toBe("auto");
  });
});
