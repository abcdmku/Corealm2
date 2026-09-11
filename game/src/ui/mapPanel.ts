import { PanelFrame } from "./panelFrame.js";
/**
 * Terrain-backed world map.
 *
 * The basemap is sampled from the same height lattice, normals, region ownership, and curved road
 * paths as the playable world. Canvas owns that static geometry. SVG owns the live semantic layer:
 * discovered places, labels, the player, focus, and the selected destination.
 */
import type { ObservedEntity, RegionId, Vec3 } from "../contracts.js";
import type { LocationDef, LocationKind } from "../content/regions.js";
import { REGIONS, WALK_SPEED_MPS, WORLD_BOUNDS as CONTENT_WORLD_BOUNDS, allLocations } from "../content/regions.js";
import { REGION_PALETTES } from "../render/materials.js";
import { notify } from "./contextMenu.js";
import type { ManagedPanel, MapTerrainSource, UiContext } from "./panels.js";
import { report } from "./panels.js";
import {
  MAP_HOME_ZOOM, MAP_MAX_ZOOM, MAP_MIN_ZOOM, WorldMapCanvas, type MapScreenPoint,
} from "./worldMapCanvas.js";

/** Kept for isolated consumers. The live panel uses `MapTerrainSource.bounds`. */
export const WORLD_BOUNDS = {
  minX: CONTENT_WORLD_BOUNDS.min[0],
  maxX: CONTENT_WORLD_BOUNDS.max[0],
  minZ: CONTENT_WORLD_BOUNDS.min[1],
  maxZ: CONTENT_WORLD_BOUNDS.max[1],
} as const;

const LABEL_SIZE = 12;
const PIP_RADIUS = 4;
/** How often the expensive observe()/rebuild half of refresh() may run. See refresh(). */
const DATA_INTERVAL_MS = 1_000;
const HIT_RADIUS = 12;
const PAN_KEY_PIXELS = 48;

const KIND_LABEL: Record<LocationKind, string> = {
  settlement: "Town", bank: "Bank", seam: "Ore seam", grove: "Grove", water: "Water",
  gate: "Gate", landmark: "Landmark", camp: "Camp", junction: "Junction",
  dungeon: "Dungeon",
};

const KIND_RANK: Record<LocationKind, number> = {
  settlement: 0, bank: 1, dungeon: 1, gate: 2, seam: 3, grove: 3, water: 3,
  camp: 4, landmark: 5, junction: 6,
};

const DEFAULT_KIND: LocationKind = "landmark";

interface LocationEntry {
  id: string;
  regionId: RegionId;
  def: LocationDef;
}

const SURFACE_REGIONS: ReadonlySet<RegionId> = new Set(REGIONS.map((region) => region.id));

const LOCATION_INDEX: ReadonlyMap<string, LocationEntry> = (() => {
  const index = new Map<string, LocationEntry>();
  for (const entry of allLocations()) {
    if (!SURFACE_REGIONS.has(entry.regionId)) continue;
    index.set(entry.location.id, { id: entry.location.id, regionId: entry.regionId, def: entry.location });
  }
  return index;
})();

/** Every authored surface road and crossing, used only by the no-render-source test fallback. */
const ROAD_EDGES: readonly (readonly [string, string])[] = (() => {
  const seen = new Set<string>();
  const edges: [string, string][] = [];
  const push = (from: string, to: string): void => {
    if (!LOCATION_INDEX.has(from) || !LOCATION_INDEX.has(to)) return;
    const key = from < to ? `${from}|${to}` : `${to}|${from}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push([from, to]);
  };
  for (const region of REGIONS) {
    for (const road of region.roads) push(road.from, road.to);
    for (const link of region.adjacency) push(link.fromLocationId, link.toLocationId);
  }
  return edges;
})();

function fallbackTerrain(): MapTerrainSource {
  const regionAt = (x: number, z: number) => REGIONS.find((region) => (
    x >= region.bounds.min[0] && x <= region.bounds.max[0]
    && z >= region.bounds.min[1] && z <= region.bounds.max[1]
  )) ?? REGIONS[0]!;
  return {
    bounds: WORLD_BOUNDS,
    sample: (x, z) => {
      const region = regionAt(x, z);
      return { height: region.baseHeight, normal: [0, 1, 0] as Vec3, regionId: region.id };
    },
    roadPolylines: () => ROAD_EDGES.map(([fromId, toId]) => {
      const from = LOCATION_INDEX.get(fromId)!;
      const to = LOCATION_INDEX.get(toId)!;
      return [
        [from.def.position[0], regionAt(...from.def.position).baseHeight, from.def.position[1]] as Vec3,
        [to.def.position[0], regionAt(...to.def.position).baseHeight, to.def.position[1]] as Vec3,
      ];
    }),
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function textWidth(text: string, size: number): number {
  let width = 0;
  for (const char of text) {
    if (char === " ") width += 0.28;
    else if ("ijltfIr.,'".includes(char)) width += 0.31;
    else if ("mwMW".includes(char)) width += 0.85;
    else if (char === char.toUpperCase()) width += 0.63;
    else width += 0.52;
  }
  return width * size;
}

interface Box { x0: number; y0: number; x1: number; y1: number }

function overlaps(a: Box, b: Box): boolean {
  return !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1);
}

function control(label: string, ariaLabel: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map__control";
  button.textContent = label;
  button.setAttribute("aria-label", ariaLabel);
  return button;
}

interface PlaceView {
  key: string;
  locationId: string | null;
  entityId: string;
  name: string;
  kind: LocationKind;
  regionId: RegionId;
  position: Vec3;
  distance: number;
  group: SVGGElement;
  label: SVGTextElement;
  screen: MapScreenPoint;
}

interface RegionLabelView {
  position: Vec3;
  label: SVGTextElement;
  screen: MapScreenPoint;
}

export class MapPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly source: MapTerrainSource;
  private readonly body: HTMLElement;
  private readonly figure: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly svg: SVGSVGElement;
  private readonly map: WorldMapCanvas;
  private readonly readoutName: HTMLElement;
  private readonly readoutMeta: HTMLElement;
  private readonly readoutRange: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly zoomOutButton: HTMLButtonElement;
  private readonly zoomInButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly labelsButton: HTMLButtonElement;
  private readonly zoomReadout: HTMLOutputElement;
  private readonly resizeObserver: ResizeObserver | null;

  private signature = "";
  private places: PlaceView[] = [];
  private byKey = new Map<string, PlaceView>();
  private byEntity = new Map<string, PlaceView>();
  private regionLabels: RegionLabelView[] = [];

  private playerMark: SVGGElement | null = null;
  private playerArrow: SVGPathElement | null = null;
  private leader: SVGLineElement | null = null;
  private destRing: SVGCircleElement | null = null;
  private emptyNote: SVGTextElement | null = null;
  private north: SVGTextElement | null = null;

  private focusKey: string | null = null;
  private destKey: string | null = null;
  private rovingIndex = 0;
  private labelsVisible = true;
  private headingRad: number | null = null;
  private lastPos: Vec3 | null = null;

  private dragPointer: number | null = null;
  private dragX = 0;
  private dragY = 0;
  private paintFrame = 0;
  private lastDataMs = -Infinity;

  constructor(private readonly ctx: UiContext) {
    this.source = ctx.mapTerrain ?? fallbackTerrain();
    this.frame = new PanelFrame({
      id: "map",
      title: "Map",
      key: "m",
      keyLabel: "Map",
      registry: ctx.registry,
      placement: { top: "56px", left: "50%", width: "min(1040px, calc(100vw - 80px))" },
      group: "center",
      movable: true,
      onOpen: () => {
        this.rovingIndex = 0;
        this.focusKey = null;
        this.resize();
        // Open where the player is, at street level. The whole map is one wheel-out away.
        this.map.centreOn(this.ctx.api.getPlayer().position, MAP_HOME_ZOOM);
        this.refresh(true);
      },
      onClose: () => this.endDrag(),
    });

    this.body = document.createElement("div");
    this.body.className = "map";

    const toolbar = document.createElement("div");
    toolbar.className = "map__toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Map view controls");

    this.zoomOutButton = control("−", "Zoom map out");
    this.zoomInButton = control("+", "Zoom map in");
    this.resetButton = control("Reset", "Reset map view");
    this.labelsButton = control("Labels", "Hide map labels");
    this.labelsButton.classList.add("map__control--toggle", "is-active");
    this.labelsButton.setAttribute("aria-pressed", "true");
    this.zoomReadout = document.createElement("output");
    this.zoomReadout.className = "map__zoom u-numeric u-dim";
    this.zoomReadout.setAttribute("aria-live", "polite");
    toolbar.append(
      this.zoomOutButton,
      this.zoomReadout,
      this.zoomInButton,
      this.resetButton,
      this.labelsButton,
    );

    const regionSelect = document.createElement("select");
    regionSelect.className = "map__region-select";
    regionSelect.setAttribute("aria-label", "Map region");
    const overview = document.createElement("option");
    overview.value = ""; overview.disabled = true; overview.selected = true; overview.textContent = "Explore regions"; regionSelect.append(overview);
    for (const region of REGIONS) {
      const option = document.createElement("option");
      option.value = region.id; option.textContent = region.name; regionSelect.append(option);
      for (const dungeon of region.dungeon ? [region.dungeon] : []) {
        const cave = document.createElement("option");
        cave.value = dungeon.id; cave.textContent = `${dungeon.name} entrance`; regionSelect.append(cave);
      }
    }
    regionSelect.addEventListener("change", () => {
      const region = REGIONS.find(row => row.id === regionSelect.value);
      const dungeon = REGIONS.flatMap(row => row.dungeon ? [row.dungeon] : []).find(row => row.id === regionSelect.value);
      if (region || dungeon) {
        const x = dungeon ? dungeon.entrance[0] : (region!.bounds.min[0] + region!.bounds.max[0]) / 2;
        const z = dungeon ? dungeon.entrance[1] : (region!.bounds.min[1] + region!.bounds.max[1]) / 2;
        this.map.centreOn([x, this.source.sample(x, z).height, z], dungeon ? MAP_HOME_ZOOM : 3);
        this.schedulePaint();
      }
    });
    toolbar.prepend(regionSelect);

    this.figure = document.createElement("div");
    this.figure.className = "map__figure";
    this.figure.tabIndex = 0;
    this.figure.setAttribute("role", "group");
    this.figure.setAttribute(
      "aria-label",
      "World map. Drag to pan, use the mouse wheel to zoom, or use the map controls.",
    );

    this.canvas = document.createElement("canvas");
    this.canvas.className = "map__canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.svg = el("svg", {
      class: "map__svg",
      viewBox: "0 0 1 1",
      "aria-label": "Discovered places",
    });
    this.figure.append(this.canvas, this.svg);
    this.map = new WorldMapCanvas(this.canvas, this.source);
    this.figure.dataset["mapLabels"] = "shown";
    this.figure.dataset["mapWorldBounds"] = JSON.stringify(this.source.bounds);

    // The hover readout floats inside the figure (bottom-left) rather than adding a footer row:
    // the window is one header and one map, nothing else.
    const readout = document.createElement("div");
    readout.className = "map__readout";
    readout.setAttribute("role", "status");
    readout.setAttribute("aria-live", "polite");
    this.readoutName = document.createElement("span");
    this.readoutName.className = "map__readout-name";
    this.readoutMeta = document.createElement("span");
    this.readoutMeta.className = "map__readout-meta u-caps u-dim";
    this.readoutRange = document.createElement("span");
    this.readoutRange.className = "map__readout-range u-numeric";
    readout.append(this.readoutName, this.readoutMeta, this.readoutRange);
    this.figure.appendChild(readout);

    // Still populated by refresh(), never attached: the region legend was a footer this window
    // no longer spends a row on.
    this.legend = document.createElement("div");
    this.legend.className = "map__legend";
    this.body.append(this.figure);
    this.frame.body.appendChild(this.body);

    // One header for the whole window: the view controls sit in the panel header, between the
    // title and the close button, instead of a second toolbar row above the map.
    const header = this.frame.root.querySelector(":scope > .panel__header");
    const close = header?.querySelector(".panel__close") ?? null;
    if (header && close) header.insertBefore(toolbar, close);
    else this.body.prepend(toolbar);

    this.figure.addEventListener("pointerover", this.onPointerOver);
    this.figure.addEventListener("pointerleave", this.onPointerLeave);
    this.figure.addEventListener("pointerdown", this.onPointerDown);
    this.figure.addEventListener("pointermove", this.onPointerMove);
    this.figure.addEventListener("pointerup", this.onPointerUp);
    this.figure.addEventListener("pointercancel", this.onPointerUp);
    this.figure.addEventListener("wheel", this.onWheel, { passive: false });
    this.figure.addEventListener("focusin", this.onFocusIn);
    this.figure.addEventListener("click", this.onClick);
    this.figure.addEventListener("keydown", this.onKeyDown);
    this.zoomOutButton.addEventListener("click", this.onZoomOut);
    this.zoomInButton.addEventListener("click", this.onZoomIn);
    this.resetButton.addEventListener("click", this.onReset);
    this.labelsButton.addEventListener("click", this.onToggleLabels);

    this.resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          if (!this.frame.isOpen()) return;
          this.resize();
          this.schedulePaint();
        });
    this.resizeObserver?.observe(this.figure);
  }

  known(): ObservedEntity[] {
    return this.ctx.api.observe({ scope: "known", limit: 100 });
  }

  refresh(force = false): void {
    const player = this.ctx.api.getPlayer();

    /*
     * The observe() half is the expensive half: `scope: "known"` prices every known place by PATH
     * distance, which is a navmesh query per row. At the shared 220 ms panel cadence that made the
     * whole game hitch while the window was open — so the data half runs on its own ~1 s clock,
     * and never during a drag, while the cheap parts (player mark, readout, repaint) keep the
     * panel feeling live every tick.
     */
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if ((force || now - this.lastDataMs >= DATA_INTERVAL_MS) && this.dragPointer === null) {
      this.lastDataMs = now;
      const rows = this.known().filter((row) => SURFACE_REGIONS.has(row.regionId));
      const signature = rows.map((row) => row.id).sort().join(",");
      if (force || signature !== this.signature) {
        this.signature = signature;
        this.rebuild(rows);
      } else {
        for (const row of rows) {
          const place = this.byEntity.get(row.id);
          if (!place) continue;
          place.distance = row.distance;
          place.group.setAttribute(
            "aria-label",
            `${place.name}, ${KIND_LABEL[place.kind]}, ${Math.round(place.distance)} metres. Walk there.`,
          );
        }
      }
      this.frame.setSubtitle(this.subtitle(rows, player.regionId));
    }

    this.trackPlayer(player.position);
    this.syncDestinationState();
    this.paintReadout();
    this.schedulePaint();
  }

  dispose(): void {
    this.endDrag();
    this.resizeObserver?.disconnect();
    if (this.paintFrame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.paintFrame);
    this.figure.removeEventListener("pointerover", this.onPointerOver);
    this.figure.removeEventListener("pointerleave", this.onPointerLeave);
    this.figure.removeEventListener("pointerdown", this.onPointerDown);
    this.figure.removeEventListener("pointermove", this.onPointerMove);
    this.figure.removeEventListener("pointerup", this.onPointerUp);
    this.figure.removeEventListener("pointercancel", this.onPointerUp);
    this.figure.removeEventListener("wheel", this.onWheel);
    this.figure.removeEventListener("focusin", this.onFocusIn);
    this.figure.removeEventListener("click", this.onClick);
    this.figure.removeEventListener("keydown", this.onKeyDown);
    this.zoomOutButton.removeEventListener("click", this.onZoomOut);
    this.zoomInButton.removeEventListener("click", this.onZoomIn);
    this.resetButton.removeEventListener("click", this.onReset);
    this.labelsButton.removeEventListener("click", this.onToggleLabels);
    this.map.dispose();
    this.frame.dispose();
  }

  private subtitle(rows: ObservedEntity[], regionId: RegionId): string {
    const region = REGIONS.find((entry) => entry.id === regionId);
    const where = region ? region.name : regionId;
    const count = rows.length === 1 ? "1 place found" : `${rows.length} places found`;
    return `${count} · ${where}`;
  }

  private resolve(row: ObservedEntity): { locationId: string | null; def: LocationDef | null } {
    const direct = LOCATION_INDEX.get(row.id);
    if (direct) return { locationId: direct.id, def: direct.def };

    let best: LocationEntry | null = null;
    let bestDistance = 8;
    for (const entry of LOCATION_INDEX.values()) {
      if (entry.regionId !== row.regionId) continue;
      const dx = entry.def.position[0] - row.position[0];
      const dz = entry.def.position[1] - row.position[2];
      const distance = Math.hypot(dx, dz);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    }
    return best ? { locationId: best.id, def: best.def } : { locationId: null, def: null };
  }

  private rebuild(rows: ObservedEntity[]): void {
    const places: PlaceView[] = [];
    const byKey = new Map<string, PlaceView>();
    const byEntity = new Map<string, PlaceView>();

    for (const row of rows) {
      const { locationId, def } = this.resolve(row);
      const key = locationId ?? row.id;
      const duplicate = byKey.get(key);
      if (duplicate) {
        byEntity.set(row.id, duplicate);
        continue;
      }
      const place: PlaceView = {
        key,
        locationId,
        entityId: row.id,
        name: row.name,
        kind: def?.kind ?? DEFAULT_KIND,
        regionId: row.regionId,
        position: row.position,
        distance: row.distance,
        group: el("g"),
        label: el("text"),
        screen: { x: 0, y: 0, visible: false },
      };
      places.push(place);
      byKey.set(key, place);
      byEntity.set(row.id, place);
    }

    this.places = places;
    this.byKey = byKey;
    this.byEntity = byEntity;
    if (this.focusKey && !byKey.has(this.focusKey)) this.focusKey = null;
    this.rovingIndex = Math.min(this.rovingIndex, Math.max(0, places.length - 1));

    const regionLabels = this.buildRegionLabels();
    const labels = this.buildLabels();
    const overlay = this.buildOverlay();
    const placeNodes = this.buildPlaces();
    this.svg.replaceChildren(regionLabels, labels, overlay, placeNodes);
    this.syncRoving();
    this.paintLegend(rows);
    this.schedulePaint();
  }

  private buildRegionLabels(): SVGGElement {
    const group = el("g", { class: "map__region-labels" });
    this.regionLabels = [];
    for (const region of REGIONS) {
      const x = (region.bounds.min[0] + region.bounds.max[0]) / 2;
      const z = (region.bounds.min[1] + region.bounds.max[1]) / 2;
      const y = this.source.sample(x, z).height;
      const label = el("text", { class: "map__region-name u-caps", "text-anchor": "middle" });
      label.style.setProperty("--region-tint", hexColour(REGION_PALETTES[region.id].accent));
      label.textContent = region.name;
      group.appendChild(label);
      this.regionLabels.push({ position: [x, y, z], label, screen: { x: 0, y: 0, visible: false } });
    }
    return group;
  }

  private buildPlaces(): SVGGElement {
    const group = el("g", { class: "map__places" });
    for (const place of this.places) {
      const node = place.group;
      node.setAttribute("class", `map__place map__place--${place.kind}`);
      node.setAttribute("role", "button");
      node.setAttribute("tabindex", "-1");
      node.setAttribute(
        "aria-label",
        `${place.name}, ${KIND_LABEL[place.kind]}, ${Math.round(place.distance)} metres. Walk there.`,
      );
      node.dataset["place"] = place.key;
      const title = el("title");
      title.textContent = `${place.name}, walk here`;
      node.replaceChildren(title, this.pip(place.kind), el("circle", { class: "map__hit", r: HIT_RADIUS }));
      group.appendChild(node);
    }
    return group;
  }

  private pip(kind: LocationKind): SVGElement {
    switch (kind) {
      case "settlement":
        return el("rect", { class: "map__pip", x: -5, y: -5, width: 10, height: 10, rx: 1.5 });
      case "bank":
        return el("path", { class: "map__pip", d: "M0 -6 L6 0 L0 6 L-6 0 Z" });
      case "gate":
        return el("path", { class: "map__pip", d: "M-5.4 4 L0 -5.4 L5.4 4 Z" });
      case "dungeon":
        return el("circle", { class: "map__pip map__pip--hollow", r: 5.2 });
      case "junction":
        return el("path", { class: "map__pip map__pip--stroke", d: "M-3.6 0 H3.6 M0 -3.6 V3.6" });
      default:
        return el("circle", { class: "map__pip", r: PIP_RADIUS });
    }
  }

  private buildLabels(): SVGGElement {
    const group = el("g", { class: "map__labels" });
    for (const place of this.places) {
      const label = place.label;
      label.setAttribute("class", "map__label");
      label.setAttribute("font-size", String(LABEL_SIZE));
      label.setAttribute("visibility", "hidden");
      label.textContent = place.name;
      group.appendChild(label);
    }
    return group;
  }

  private buildOverlay(): SVGGElement {
    const group = el("g", { class: "map__overlay" });
    this.leader = el("line", { class: "map__leader" });
    this.leader.setAttribute("visibility", "hidden");
    this.destRing = el("circle", { class: "map__dest", r: 9 });
    this.destRing.setAttribute("visibility", "hidden");

    const mark = el("g", { class: "map__player" });
    mark.appendChild(el("circle", { class: "map__player-halo", r: 10 }));
    mark.appendChild(el("circle", { class: "map__player-dot", r: 2.8 }));
    const arrow = el("path", { class: "map__player-arrow", d: "M0 -10.5 L5.2 3 L0 0.2 L-5.2 3 Z" });
    arrow.setAttribute("visibility", "hidden");
    mark.appendChild(arrow);
    const title = el("title");
    title.textContent = "You are here";
    mark.appendChild(title);
    this.playerMark = mark;
    this.playerArrow = arrow;

    const note = el("text", { class: "map__empty", "text-anchor": "middle" });
    note.textContent = "No places found yet. Walk to discover them.";
    this.emptyNote = note;

    this.north = el("text", { class: "map__north u-caps", "text-anchor": "end" });
    this.north.textContent = "N ↑";
    group.append(this.leader, this.destRing, mark, note, this.north);
    return group;
  }

  private paintLegend(rows: ObservedEntity[]): void {
    this.legend.replaceChildren();
    for (const region of REGIONS) {
      const found = rows.filter((row) => row.regionId === region.id).length;
      const chip = document.createElement("span");
      chip.className = "map__chip";
      const swatch = document.createElement("i");
      swatch.className = "map__swatch";
      swatch.style.setProperty("--region-tint", hexColour(REGION_PALETTES[region.id].groundHigh));
      const name = document.createElement("span");
      name.textContent = region.name;
      const count = document.createElement("span");
      count.className = "u-dim u-numeric";
      count.textContent = found > 0 ? `${found}` : "—";
      chip.append(swatch, name, count);
      this.legend.appendChild(chip);
    }
    const hint = document.createElement("span");
    hint.className = "map__hint u-dim";
    hint.textContent = this.places.length > 0
      ? "Drag to pan · scroll to zoom · click a place to walk"
      : "Drag and zoom to inspect the terrain";
    this.legend.appendChild(hint);
  }

  private resize(): void {
    const rect = this.figure.getBoundingClientRect();
    const width = Math.max(1, rect.width || this.figure.clientWidth || 640);
    const height = Math.max(1, rect.height || this.figure.clientHeight || 420);
    this.map.resize(width, height);
    this.svg.setAttribute("viewBox", `0 0 ${round(width)} ${round(height)}`);
  }

  private schedulePaint(): void {
    if (!this.frame.isOpen() || this.paintFrame) return;
    if (typeof requestAnimationFrame !== "function") {
      this.paint();
      return;
    }
    this.paintFrame = requestAnimationFrame(() => {
      this.paintFrame = 0;
      this.paint();
    });
  }

  private paint(): void {
    this.map.render();
    this.updateControls();
    this.updateProjectedNodes();
    this.layoutLabels();
    this.paintReadout();
  }

  private updateControls(): void {
    const zoom = this.map.zoomLevel();
    const state = this.map.viewState();
    this.zoomOutButton.disabled = zoom <= MAP_MIN_ZOOM + 0.001;
    this.zoomInButton.disabled = zoom >= MAP_MAX_ZOOM - 0.001;
    // The label is relative to the home view: opening on the player reads 100%, the whole-map
    // view reads ~17%, and the ceiling reads 200%.
    const percent = `${Math.round((zoom / MAP_HOME_ZOOM) * 100)}%`;
    this.zoomReadout.value = percent;
    this.zoomReadout.textContent = percent;
    this.figure.dataset["mapZoom"] = state.zoom.toFixed(3);
    this.figure.dataset["mapCentreU"] = state.centreU.toFixed(3);
    this.figure.dataset["mapCentreV"] = state.centreV.toFixed(3);
    this.figure.dataset["mapLabels"] = this.labelsVisible ? "shown" : "hidden";
    this.figure.dataset["mapWorldBounds"] = JSON.stringify(state.worldBounds);
  }

  private updateProjectedNodes(): void {
    for (const place of this.places) {
      place.screen = this.map.screen(place.position);
      place.group.setAttribute("transform", `translate(${round(place.screen.x)} ${round(place.screen.y)})`);
      place.group.setAttribute("visibility", place.screen.visible ? "visible" : "hidden");
    }
    for (const region of this.regionLabels) {
      region.screen = this.map.screen(region.position);
      region.label.setAttribute("x", String(round(region.screen.x)));
      region.label.setAttribute("y", String(round(region.screen.y)));
    }

    const viewport = this.map.viewport();
    this.north?.setAttribute("x", String(viewport.width - 12));
    this.north?.setAttribute("y", "22");
    if (this.emptyNote) {
      this.emptyNote.setAttribute("x", String(viewport.width / 2));
      this.emptyNote.setAttribute("y", String(viewport.height - 24));
      this.emptyNote.setAttribute("visibility", this.places.length === 0 ? "visible" : "hidden");
    }

    this.updatePlayerMark();
    this.updateDestinationMark();
  }

  private layoutLabels(): void {
    const viewport = this.map.viewport();
    const occupied: Box[] = [];

    for (const region of this.regionLabels) {
      const visible = this.labelsVisible && region.screen.visible;
      region.label.setAttribute("visibility", visible ? "visible" : "hidden");
      if (!visible) continue;
      const width = textWidth(region.label.textContent ?? "", 13) + 8;
      occupied.push({
        x0: region.screen.x - width / 2,
        y0: region.screen.y - 12,
        x1: region.screen.x + width / 2,
        y1: region.screen.y + 4,
      });
    }
    for (const place of this.places) {
      if (!place.screen.visible) continue;
      occupied.push({
        x0: place.screen.x - PIP_RADIUS - 3,
        y0: place.screen.y - PIP_RADIUS - 3,
        x1: place.screen.x + PIP_RADIUS + 3,
        y1: place.screen.y + PIP_RADIUS + 3,
      });
    }

    const ordered = [...this.places].sort((a, b) => {
      const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
      return rank !== 0 ? rank : a.distance - b.distance;
    });
    const offsets: readonly (readonly [number, number, "start" | "end" | "middle"])[] = [
      [8, 4, "start"], [-8, 4, "end"], [0, -10, "middle"], [0, 16, "middle"],
      [10, -7, "start"], [-10, -7, "end"], [10, 15, "start"], [-10, 15, "end"],
      [16, -14, "start"], [-16, -14, "end"], [16, 20, "start"], [-16, 20, "end"],
    ];

    for (const place of ordered) {
      const label = place.label;
      label.setAttribute("visibility", "hidden");
      if (!this.labelsVisible || !place.screen.visible) continue;
      const width = textWidth(place.name, LABEL_SIZE) + 4;
      for (const [dx, dy, anchor] of offsets) {
        const x = place.screen.x + dx;
        const y = place.screen.y + dy;
        const x0 = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
        const box: Box = { x0, y0: y - LABEL_SIZE * 0.84, x1: x0 + width, y1: y + LABEL_SIZE * 0.26 };
        if (box.x0 < 4 || box.y0 < 4 || box.x1 > viewport.width - 4 || box.y1 > viewport.height - 4) continue;
        if (occupied.some((other) => overlaps(box, other))) continue;
        occupied.push(box);
        label.setAttribute("x", String(round(x)));
        label.setAttribute("y", String(round(y)));
        label.setAttribute("text-anchor", anchor);
        label.setAttribute("visibility", "visible");
        break;
      }
    }
  }

  private trackPlayer(position: Vec3): void {
    const previous = this.lastPos;
    if (previous) {
      const dx = position[0] - previous[0];
      const dz = position[2] - previous[2];
      if (dx * dx + dz * dz > 0.16) this.headingRad = Math.atan2(dx, dz);
    }
    this.lastPos = [...position] as Vec3;
  }

  private updatePlayerMark(): void {
    const mark = this.playerMark;
    const position = this.lastPos;
    if (!mark || !position) return;
    const screen = this.map.screen(position);
    const heading = this.headingRad;
    // Negated: the map frame draws +x leftward (see WorldMapCanvas.project), and a mirror flips
    // angles. Without this the arrow pointed east while the player walked west.
    const rotation = heading === null ? 0 : -(heading * 180) / Math.PI;
    mark.setAttribute("transform", `translate(${round(screen.x)} ${round(screen.y)}) rotate(${round(rotation)})`);
    mark.setAttribute("visibility", screen.visible ? "visible" : "hidden");
    this.playerArrow?.setAttribute("visibility", heading === null ? "hidden" : "visible");
  }

  private syncDestinationState(): void {
    const target = this.destKey ? this.byKey.get(this.destKey) : undefined;
    if (!target || target.distance < 4) this.destKey = null;
  }

  private updateDestinationMark(): void {
    const ring = this.destRing;
    if (!ring) return;
    const target = this.destKey ? this.byKey.get(this.destKey) : undefined;
    if (!target || !target.screen.visible) {
      ring.setAttribute("visibility", "hidden");
      return;
    }
    ring.setAttribute("cx", String(round(target.screen.x)));
    ring.setAttribute("cy", String(round(target.screen.y)));
    ring.setAttribute("visibility", "visible");
  }

  private paintReadout(): void {
    const place = this.focusKey ? this.byKey.get(this.focusKey) : undefined;
    const leader = this.leader;
    if (!place) {
      // Idle shows nothing: the readout chip only exists while a place is under the cursor.
      this.readoutName.textContent = "";
      this.readoutMeta.textContent = "";
      this.readoutRange.textContent = "";
      leader?.setAttribute("visibility", "hidden");
      return;
    }

    const metres = Math.round(place.distance);
    const seconds = Math.round(place.distance / WALK_SPEED_MPS);
    const region = REGIONS.find((entry) => entry.id === place.regionId);
    this.readoutName.textContent = place.name;
    this.readoutMeta.textContent = `${KIND_LABEL[place.kind]} · ${region?.name ?? place.regionId}`;
    this.readoutRange.textContent = metres < 4 ? "you are here" : `${metres} m · ${seconds}s walk`;

    if (!leader || !this.lastPos || !place.screen.visible) {
      leader?.setAttribute("visibility", "hidden");
      return;
    }
    const from = this.map.screen(this.lastPos);
    if (!from.visible) {
      leader.setAttribute("visibility", "hidden");
      return;
    }
    leader.setAttribute("x1", String(round(from.x)));
    leader.setAttribute("y1", String(round(from.y)));
    leader.setAttribute("x2", String(round(place.screen.x)));
    leader.setAttribute("y2", String(round(place.screen.y)));
    leader.setAttribute("visibility", "visible");
  }

  private placeFromEvent(target: EventTarget | null): PlaceView | null {
    if (!(target instanceof Element)) return null;
    const node = target.closest("[data-place]");
    if (!(node instanceof SVGElement)) return null;
    const key = node.dataset["place"];
    return key ? this.byKey.get(key) ?? null : null;
  }

  private setFocus(key: string | null): void {
    if (this.focusKey === key) return;
    if (this.focusKey) this.byKey.get(this.focusKey)?.group.classList.remove("is-focused");
    this.focusKey = key;
    if (key) this.byKey.get(key)?.group.classList.add("is-focused");
    this.paintReadout();
  }

  private walkTo(place: PlaceView): void {
    const result = place.locationId
      ? this.ctx.api.moveTo({ locationId: place.locationId })
      : this.ctx.api.moveTo({ entityId: place.entityId });
    if (!result.ok) {
      report(result);
      this.destKey = null;
      this.schedulePaint();
      return;
    }
    this.destKey = place.key;
    const seconds = Math.max(1, Math.round(result.value.etaMs / 1000));
    notify(`Walking to ${place.name} · ${Math.round(result.value.pathLength)} m · ${seconds}s`, "info");
    this.schedulePaint();
  }

  private syncRoving(): void {
    this.places.forEach((place, index) => {
      place.group.setAttribute("tabindex", index === this.rovingIndex ? "0" : "-1");
    });
  }

  private moveRoving(current: PlaceView, direction: readonly [number, number]): void {
    const [dirX, dirY] = direction;
    let best: PlaceView | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const place of this.places) {
      if (place === current || !place.screen.visible) continue;
      const dx = place.screen.x - current.screen.x;
      const dy = place.screen.y - current.screen.y;
      const along = dx * dirX + dy * dirY;
      if (along <= 1) continue;
      const across = Math.abs(dx * dirY - dy * dirX);
      const score = along + across * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = place;
      }
    }
    if (!best) return;
    this.rovingIndex = this.places.indexOf(best);
    this.syncRoving();
    best.group.focus({ preventScroll: true });
    this.setFocus(best.key);
  }

  private panWithKey(key: string): boolean {
    const moved = key === "ArrowRight" ? this.map.panByPixels(-PAN_KEY_PIXELS, 0)
      : key === "ArrowLeft" ? this.map.panByPixels(PAN_KEY_PIXELS, 0)
      : key === "ArrowUp" ? this.map.panByPixels(0, PAN_KEY_PIXELS)
      : key === "ArrowDown" ? this.map.panByPixels(0, -PAN_KEY_PIXELS)
      : false;
    if (moved) this.schedulePaint();
    return moved;
  }

  private endDrag(): void {
    const pointer = this.dragPointer;
    if (pointer !== null && this.figure.hasPointerCapture(pointer)) this.figure.releasePointerCapture(pointer);
    this.dragPointer = null;
    this.figure.classList.remove("is-panning");
  }

  private readonly onPointerOver = (event: PointerEvent): void => {
    const place = this.placeFromEvent(event.target);
    if (place) this.setFocus(place.key);
  };

  private readonly onPointerLeave = (): void => {
    if (this.dragPointer === null) this.setFocus(null);
  };

  private readonly onFocusIn = (event: FocusEvent): void => {
    const place = this.placeFromEvent(event.target);
    if (!place) return;
    this.rovingIndex = Math.max(0, this.places.indexOf(place));
    this.syncRoving();
    this.setFocus(place.key);
  };

  private readonly onClick = (event: MouseEvent): void => {
    const place = this.placeFromEvent(event.target);
    if (place) this.walkTo(place);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.placeFromEvent(event.target)) return;
    this.dragPointer = event.pointerId;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    this.figure.setPointerCapture(event.pointerId);
    this.figure.classList.add("is-panning");
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.dragPointer !== event.pointerId) return;
    const dx = event.clientX - this.dragX;
    const dy = event.clientY - this.dragY;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    if (this.map.panByPixels(dx, dy)) this.schedulePaint();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.dragPointer === event.pointerId) this.endDrag();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.figure.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 18 : event.deltaY;
    if (this.map.zoomBy(Math.exp(-delta * 0.0015), x, y)) this.schedulePaint();
  };

  private readonly onZoomOut = (): void => {
    if (this.map.zoomBy(1 / 1.35)) this.schedulePaint();
  };

  private readonly onZoomIn = (): void => {
    if (this.map.zoomBy(1.35)) this.schedulePaint();
  };

  private readonly onReset = (): void => {
    this.map.resetView();
    this.schedulePaint();
    this.figure.focus({ preventScroll: true });
  };

  private readonly onToggleLabels = (): void => {
    this.labelsVisible = !this.labelsVisible;
    this.labelsButton.setAttribute("aria-pressed", String(this.labelsVisible));
    this.labelsButton.setAttribute("aria-label", this.labelsVisible ? "Hide map labels" : "Show map labels");
    this.labelsButton.classList.toggle("is-active", this.labelsVisible);
    this.svg.classList.toggle("map__svg--labels-hidden", !this.labelsVisible);
    this.figure.dataset["mapLabels"] = this.labelsVisible ? "shown" : "hidden";
    this.schedulePaint();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key;
    if (key.toLowerCase() === "l") {
      event.preventDefault();
      this.onToggleLabels();
      return;
    }
    if (key === "+" || key === "=") {
      event.preventDefault();
      this.onZoomIn();
      return;
    }
    if (key === "-" || key === "_") {
      event.preventDefault();
      this.onZoomOut();
      return;
    }
    if (key === "Home") {
      event.preventDefault();
      this.onReset();
      return;
    }

    const current = this.placeFromEvent(event.target);
    if (current && (key === "Enter" || key === " ")) {
      event.preventDefault();
      this.walkTo(current);
      return;
    }
    if (current && !event.shiftKey) {
      const direction = key === "ArrowRight" ? [1, 0] as const
        : key === "ArrowLeft" ? [-1, 0] as const
        : key === "ArrowUp" ? [0, -1] as const
        : key === "ArrowDown" ? [0, 1] as const
        : null;
      if (direction) {
        event.preventDefault();
        this.moveRoving(current, direction);
        return;
      }
    }
    if (key.startsWith("Arrow")) {
      event.preventDefault();
      this.panWithKey(key);
    }
  };
}

function hexColour(packed: number): string {
  return `#${packed.toString(16).padStart(6, "0")}`;
}
