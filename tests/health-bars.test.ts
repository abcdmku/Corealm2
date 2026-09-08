import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { SemanticEntity } from "../game/src/contracts.js";
import {
  HealthBars, LINGER_MS, TOP_SAMPLE_INTERVAL_MS, healthColour, type PlayerVitals,
} from "../game/src/render/healthBars.js";
import { PLAYER_HEIGHT } from "../game/src/app/config.js";

/**
 * The smallest DOM the bars need: elements with a style bag, a class list, a dataset, children and
 * attributes. No layout, no jsdom; the test asserts what was written, not how it was painted.
 */
class FakeElement {
  className = "";
  readonly style: Record<string, string> & { setProperty(name: string, value: string): void };
  readonly classList: { toggle(name: string, force?: boolean): void; contains(name: string): boolean };
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  parent: FakeElement | null = null;
  private readonly classes = new Set<string>();

  constructor() {
    const style: Record<string, string> = {};
    this.style = Object.assign(style, {
      setProperty: (name: string, value: string) => { style[name] = value; },
    });
    this.classList = {
      toggle: (name, force) => {
        const on = force ?? !this.classes.has(name);
        if (on) this.classes.add(name); else this.classes.delete(name);
      },
      contains: (name) => this.classes.has(name) || this.className.split(" ").includes(name),
    };
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
}

const WIDTH = 1000;
const HEIGHT = 500;

function creature(id: string, health: number, maxHealth: number, position: [number, number, number], bodyRadius = 0.5): SemanticEntity {
  return {
    id, archetype: "enemy", name: id, tier: 1, regionId: "fallowmarch", position, state: health > 0 ? "alive" : "dead",
    interactions: ["attack"],
    combat: { health, maxHealth, level: 3, aggroRadius: 6, bodyRadius },
    view: { assetId: "wolf", labelHeight: 2.2 },
  } as unknown as SemanticEntity;
}

function harness() {
  const root = new FakeElement();
  const camera = new THREE.PerspectiveCamera(55, WIDTH / HEIGHT, 0.1, 200);
  camera.position.set(0, 8, 12);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const entities = new Map<string, SemanticEntity>();
  const drawn = new Map<string, [number, number, number]>();
  const tops = new Map<string, number | null>();
  let topCalls = 0;
  const vitals: PlayerVitals = { health: 40, maxHealth: 40, targetId: null, engagedBy: [] };
  let playerTop: number | null = null;
  const bars = new HealthBars({
    playerTop: () => playerTop,
    camera,
    root: root as unknown as HTMLElement,
    entity: (id) => entities.get(id) ?? null,
    drawnPosition: (id) => drawn.get(id) ?? null,
    drawnTop: (id) => { topCalls += 1; return tops.get(id) ?? null; },
    player: () => vitals,
  });
  const container = root.children[0]!;
  const barFor = (id: string) => container.children.find((child) => child.dataset["entityId"] === id) ?? null;
  return { bars, root, container, camera, entities, drawn, tops, vitals, barFor, topCalls: () => topCalls, setPlayerTop: (top: number | null) => { playerTop = top; } };
}

/** Where the bars will put a world point, in CSS pixels, using the same camera. */
function screenOf(camera: THREE.Camera, x: number, y: number, z: number): { x: number; y: number } {
  const p = new THREE.Vector3(x, y, z).project(camera);
  return { x: (p.x * 0.5 + 0.5) * WIDTH, y: (-p.y * 0.5 + 0.5) * HEIGHT };
}

describe("health bars", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { createElement: () => new FakeElement() });
    vi.stubGlobal("window", { innerWidth: WIDTH, innerHeight: HEIGHT });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("draws nothing out of combat and mounts one passive container", () => {
    const h = harness();
    h.bars.update(0, [0, 0, 0]);
    expect(h.root.children).toHaveLength(1);
    expect(h.container.className).toContain("is-passive");
    expect(h.container.children).toHaveLength(0);
    expect(h.bars.count()).toBe(0);
  });

  it("shows a bar over the target and the player once a fight starts, anchored above their heads", () => {
    const h = harness();
    h.entities.set("wolf", creature("wolf", 30, 30, [3, 0, -2]));
    h.drawn.set("wolf", [3.2, 0.1, -2.1]);
    h.tops.set("wolf", 1.1);
    h.vitals.targetId = "wolf";

    h.bars.update(1000, [0, 0, 0]);
    expect(h.bars.ids().sort()).toEqual(["player", "wolf"]);

    const wolf = h.barFor("wolf")!;
    expect(wolf.className).toContain("hp-bar--creature");
    expect(wolf.style["display"]).toBe("block");
    expect(wolf.classList.contains("is-target")).toBe(true);
    expect(wolf.children[1]!.style["width"]).toBe("100.0%");
    expect(wolf.style["--bar-colour"]).toBe(healthColour(1));
    expect(wolf.getAttribute("aria-valuenow")).toBe("30");
    // Drawn position plus measured top plus the lift: over the wolf's head, not at its feet.
    const expectedWolf = screenOf(h.camera, 3.2, 0.1 + 1.1 + 0.18, -2.1);
    expect(Number.parseFloat(wolf.style["left"]!)).toBeCloseTo(expectedWolf.x, 0);
    expect(Number.parseFloat(wolf.style["top"]!)).toBeCloseTo(expectedWolf.y, 0);

    const player = h.barFor("player")!;
    expect(player.className).toContain("hp-bar--player");
    const expectedPlayer = screenOf(h.camera, 0, PLAYER_HEIGHT + 0.2, 0);
    expect(Number.parseFloat(player.style["left"]!)).toBeCloseTo(expectedPlayer.x, 0);
    expect(Number.parseFloat(player.style["top"]!)).toBeCloseTo(expectedPlayer.y, 0);
  });

  it("follows the drawn position, not the sim position, and re-measures the top on a cadence", () => {
    const h = harness();
    h.entities.set("wolf", creature("wolf", 30, 30, [3, 0, -2]));
    h.drawn.set("wolf", [3, 0, -2]);
    h.tops.set("wolf", 1.0);
    h.vitals.targetId = "wolf";
    h.bars.update(0, [0, 0, 0]);
    expect(h.topCalls()).toBe(1);

    h.drawn.set("wolf", [1, 0, -2]);
    h.bars.update(16, [0, 0, 0]);
    expect(h.topCalls()).toBe(1);
    const moved = screenOf(h.camera, 1, 1.18, -2);
    expect(Number.parseFloat(h.barFor("wolf")!.style["left"]!)).toBeCloseTo(moved.x, 0);

    h.bars.update(TOP_SAMPLE_INTERVAL_MS + 16, [0, 0, 0]);
    expect(h.topCalls()).toBe(2);
  });

  it("hangs the player's bar just over the measured rig, not the configured capsule height", () => {
    const h = harness();
    h.setPlayerTop(1.52);
    h.vitals.engagedBy = ["wolf"];
    h.entities.set("wolf", creature("wolf", 30, 30, [0, 0, -2]));
    h.drawn.set("wolf", [0, 0, -2]);
    h.bars.update(0, [0, 0, 0]);
    const measured = screenOf(h.camera, 0, 1.52 + 0.2, 0);
    expect(Number.parseFloat(h.barFor("player")!.style["top"]!)).toBeCloseTo(measured.y, 0);

    // An empty or absurd measurement falls back to the configured height.
    h.setPlayerTop(null);
    h.bars.update(TOP_SAMPLE_INTERVAL_MS + 1, [0, 0, 0]);
    const fallback = screenOf(h.camera, 0, PLAYER_HEIGHT + 0.2, 0);
    expect(Number.parseFloat(h.barFor("player")!.style["top"]!)).toBeCloseTo(fallback.y, 0);
  });

  it("falls back to the authored label height when the measured top is missing or absurd", () => {
    const h = harness();
    h.entities.set("wolf", creature("wolf", 30, 30, [0, 0, -2]));
    h.drawn.set("wolf", [0, 0, -2]);
    h.tops.set("wolf", null);
    h.vitals.targetId = "wolf";
    h.bars.update(0, [0, 0, 0]);
    const fallback = screenOf(h.camera, 0, 2.2 + 0.18, -2);
    expect(Number.parseFloat(h.barFor("wolf")!.style["top"]!)).toBeCloseTo(fallback.y, 0);

    h.tops.set("wolf", 40);
    h.bars.update(TOP_SAMPLE_INTERVAL_MS + 1, [0, 0, 0]);
    expect(Number.parseFloat(h.barFor("wolf")!.style["top"]!)).toBeCloseTo(fallback.y, 0);
  });

  it("drops the fill on a hit and lets the ghost trail follow after a hold", () => {
    const h = harness();
    const wolf = creature("wolf", 30, 30, [0, 0, -2]);
    h.entities.set("wolf", wolf);
    h.drawn.set("wolf", [0, 0, -2]);
    h.tops.set("wolf", 1);
    h.vitals.targetId = "wolf";
    h.bars.update(0, [0, 0, 0]);

    wolf.combat!.health = 15;
    h.bars.update(100, [0, 0, 0]);
    const bar = h.barFor("wolf")!;
    const [ghost, fill] = bar.children as [FakeElement, FakeElement];
    expect(fill.style["width"]).toBe("50.0%");
    expect(ghost.style["width"]).toBe("100.0%");
    expect(bar.style["--bar-colour"]).toBe(healthColour(0.5));

    // Still held a little later...
    h.bars.update(300, [0, 0, 0]);
    expect(ghost.style["width"]).toBe("100.0%");
    // ...then sliding, and then caught up.
    h.bars.update(500, [0, 0, 0]);
    const sliding = Number.parseFloat(ghost.style["width"]!);
    expect(sliding).toBeLessThan(100);
    expect(sliding).toBeGreaterThan(50);
    h.bars.update(2500, [0, 0, 0]);
    expect(ghost.style["width"]).toBe("50.0%");

    // A heal snaps the ghost up with the fill.
    wolf.combat!.health = 24;
    h.bars.update(2600, [0, 0, 0]);
    expect(fill.style["width"]).toBe("80.0%");
    expect(ghost.style["width"]).toBe("80.0%");
  });

  it("marks a kill, lingers, fades and then removes every bar when the fight ends", () => {
    const h = harness();
    const wolf = creature("wolf", 30, 30, [0, 0, -2]);
    h.entities.set("wolf", wolf);
    h.drawn.set("wolf", [0, 0, -2]);
    h.tops.set("wolf", 1);
    h.vitals.targetId = "wolf";
    h.bars.update(0, [0, 0, 0]);

    wolf.combat!.health = 0;
    wolf.state = "dead";
    h.vitals.targetId = null;
    h.bars.update(100, [0, 0, 0]);
    const bar = h.barFor("wolf")!;
    expect(bar.classList.contains("is-dead")).toBe(true);
    expect(bar.children[1]!.style["width"]).toBe("0.0%");
    expect(h.bars.ids().sort()).toEqual(["player", "wolf"]);
    expect(bar.style["opacity"]).toBe("");

    h.bars.update(100 + LINGER_MS - 200, [0, 0, 0]);
    expect(Number.parseFloat(bar.style["opacity"]!)).toBeLessThan(1);
    expect(h.bars.count()).toBe(2);

    h.bars.update(100 + LINGER_MS, [0, 0, 0]);
    expect(h.bars.count()).toBe(0);
    expect(h.container.children).toHaveLength(0);
  });

  it("keeps the same bar when a creature re-engages during its linger", () => {
    const h = harness();
    h.entities.set("wolf", creature("wolf", 30, 30, [0, 0, -2]));
    h.drawn.set("wolf", [0, 0, -2]);
    h.tops.set("wolf", 1);
    h.vitals.engagedBy = ["wolf"];
    h.bars.update(0, [0, 0, 0]);
    const before = h.barFor("wolf");

    h.vitals.engagedBy = [];
    h.bars.update(500, [0, 0, 0]);
    h.vitals.engagedBy = ["wolf"];
    h.bars.update(LINGER_MS + 1000, [0, 0, 0]);
    expect(h.barFor("wolf")).toBe(before);
    expect(h.bars.count()).toBe(2);
  });

  it("removes a bar at once when its creature leaves the world, and hides one behind the camera", () => {
    const h = harness();
    h.entities.set("wolf", creature("wolf", 30, 30, [0, 0, -2]));
    h.entities.set("boar", creature("boar", 20, 20, [0, 0, 40]));
    h.drawn.set("wolf", [0, 0, -2]);
    h.drawn.set("boar", [0, 0, 40]);
    h.vitals.engagedBy = ["wolf", "boar"];
    h.bars.update(0, [0, 0, 0]);
    expect(h.bars.count()).toBe(3);
    // The boar is behind the camera: kept, but not drawn.
    expect(h.barFor("boar")!.style["display"]).toBe("none");
    expect(h.barFor("wolf")!.style["display"]).toBe("block");

    h.entities.delete("wolf");
    h.bars.update(16, [0, 0, 0]);
    expect(h.bars.ids().sort()).toEqual(["boar", "player"]);
  });

  it("widens the bar with the creature's body radius and unmounts on dispose", () => {
    const h = harness();
    h.entities.set("frog", creature("frog", 5, 5, [-1, 0, -2], 0.16));
    h.entities.set("bear", creature("bear", 80, 80, [1, 0, -2], 1.23));
    h.drawn.set("frog", [-1, 0, -2]);
    h.drawn.set("bear", [1, 0, -2]);
    h.vitals.engagedBy = ["frog", "bear"];
    h.bars.update(0, [0, 0, 0]);
    const frog = Number.parseInt(h.barFor("frog")!.style["width"]!, 10);
    const bear = Number.parseInt(h.barFor("bear")!.style["width"]!, 10);
    expect(bear).toBeGreaterThan(frog);
    expect(h.barFor("player")!.style["width"]).toBeUndefined();

    h.bars.dispose();
    expect(h.root.children).toHaveLength(0);
    expect(h.bars.count()).toBe(0);
  });
});
