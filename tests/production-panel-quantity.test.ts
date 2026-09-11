import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApi as GameApiContract, ItemStack, SemanticEntity } from "../game/src/contracts.js";
import { ok } from "../game/src/contracts.js";
import { CorealmGameApi } from "../game/src/api/gameApi.js";
import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { RECIPES } from "../game/src/content/recipes.js";
import { EventBus } from "../game/src/core/events.js";
import { SimClock } from "../game/src/core/time.js";
import { Store } from "../game/src/state/store.js";
import type { Movement } from "../game/src/systems/movement.js";
import type { Navigation } from "../game/src/systems/navigation.js";
import { setNoticeSink } from "../game/src/ui/contextMenu.js";
import type { UiContext } from "../game/src/ui/panels.js";
import { ProductionPanel } from "../game/src/ui/productionPanel.js";

// Rendering geometry and panel focus are covered by the browser gate. This suite exercises
// production recipe controls and their click handlers against the real API quantity validation.
vi.mock("../game/src/ui/panelFrame.js", () => ({
  PanelFrame: class {
    body = document.createElement("div");
    open() {}
    setSubtitle() {}
    dispose() {}
  },
}));
vi.mock("../game/src/ui/itemIcons.js", () => ({
  createItemIcon: () => document.createElement("span"),
}));

class TestElement extends EventTarget {
  children: TestElement[] = [];
  className = "";
  textContent = "";
  value = "";
  hidden = false;
  disabled = false;
  type = "";
  classList = { add() {}, toggle() {} };
  constructor(readonly tag = "div") { super(); }
  setAttribute() {}
  focus() {}
  append(...children: TestElement[]) {
    for (const child of children) {
      if (child.tag === "fragment") this.children.push(...child.children);
      else this.children.push(child);
    }
  }
  appendChild(child: TestElement) { this.append(child); return child; }
  replaceChildren(...children: TestElement[]) { this.children = []; this.append(...children); }
  click() { if (!this.disabled) this.dispatchEvent(new Event("click")); }
}

const BENCH: SemanticEntity = {
  id: "test-bench", name: "Fletching Bench", archetype: "station", state: "ready", tier: 1,
  position: [0, 0, 0], regionId: "fallowmarch", interactions: ["produce"],
  station: { kind: "fletching_bench", skill: "fletching", recipeIds: ["fletch_basic_wooden_wand"] },
};

function find(root: TestElement, predicate: (element: TestElement) => boolean): TestElement {
  const pending = [root];
  while (pending.length) {
    const element = pending.shift()!;
    if (predicate(element)) return element;
    pending.push(...element.children);
  }
  throw new Error("Missing production control");
}

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => new TestElement(tag),
    createDocumentFragment: () => new TestElement("fragment"),
  });
  content.register({ items: ALL_ITEMS, recipes: RECIPES });
  setNoticeSink(() => undefined);
});

afterEach(() => { setNoticeSink(null); vi.unstubAllGlobals(); });

function panelWithShafts(count: number) {
  let slots: ItemStack[] = [{ itemId: "palewood_shaft", quantity: count }];
  const game = new CorealmGameApi(new Store(1, 0), new EventBus(), {} as Navigation, {} as Movement, new SimClock());
  const queue = vi.fn((_stationId: string, _recipeId: string, quantity: number) => (
    ok({ queued: quantity, durationMs: 1000 })
  ));
  game.register("production", { produce: () => ok({ queued: 1, durationMs: 1000 }), produceAt: queue });
  const api = {
    inspect: () => ok(BENCH),
    getInventory: () => ({ slots }),
    getSkills: () => ({ fletching: { level: 1 } }),
    getActivity: () => null,
    observe: () => [],
    produceAt: game.produceAt.bind(game),
  } as unknown as GameApiContract;
  const panel = new ProductionPanel({ api, refresh: () => undefined } as unknown as UiContext);
  panel.openFor(BENCH.id);
  const body = (panel.frame as unknown as { body: TestElement }).body;
  return {
    queue,
    mode: (label: string) => find(body, (element) => element.tag === "button" && element.textContent === label).click(),
    make: () => find(body, (element) => element.className.includes("production-row__action")),
    batch: () => find(body, (element) => element.className.includes("production-row__batch")),
    custom: (value: number) => {
      const input = find(body, (element) => element.tag === "input");
      input.value = String(value);
      input.dispatchEvent(new Event("change"));
    },
    setStock: (quantity: number) => { slots = [{ itemId: "palewood_shaft", quantity }]; },
  };
}

describe("production batch controls", () => {
  it("All accepts surplus stackable ingredients and submits the API maximum", () => {
    const current = panelWithShafts(100);
    current.mode("All");
    expect(current.make().disabled).toBe(false);
    expect(current.batch().textContent).toContain("Batch 28");
    expect(current.batch().textContent).toContain("100 possible");
    current.make().click();
    expect(current.queue).toHaveBeenCalledWith(BENCH.id, "fletch_basic_wooden_wand", 28);
  });

  it("All uses the available quantity when it is below the API maximum", () => {
    const current = panelWithShafts(6);
    current.mode("All");
    current.make().click();
    expect(current.queue).toHaveBeenCalledWith(BENCH.id, "fletch_basic_wooden_wand", 6);
  });

  it("explains oversized custom batches, then accepts a corrected amount", () => {
    const current = panelWithShafts(100);
    current.mode("X");
    expect(current.make().disabled).toBe(true);
    expect(current.batch().textContent).toContain("Batch limit is 28");
    current.make().click();
    expect(current.queue).not.toHaveBeenCalled();
    current.custom(28);
    expect(current.make().disabled).toBe(false);
    current.make().click();
    expect(current.queue).toHaveBeenCalledWith(BENCH.id, "fletch_basic_wooden_wand", 28);
  });

  it("continues to reject custom amounts without enough ingredients", () => {
    const current = panelWithShafts(3);
    current.mode("X");
    current.custom(4);
    expect(current.make().disabled).toBe(true);
    expect(current.batch().textContent).toContain("Need ingredients for 4");
  });

  it("rechecks ingredient availability when All is clicked", () => {
    const current = panelWithShafts(100);
    current.mode("All");
    current.setStock(11);
    current.make().click();
    expect(current.queue).toHaveBeenCalledWith(BENCH.id, "fletch_basic_wooden_wand", 11);
  });
});
