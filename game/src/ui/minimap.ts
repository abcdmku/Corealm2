/**
 * The circular minimap cluster, top-right: a player-centred cutout of the baked world map with no
 * labels, plus the two controls that live in the square corners the disc leaves open — the X that
 * raises the menu (top-right, the corner of the screen) and the full-map button (bottom-left).
 *
 * The disc answers three questions at a glance and takes one order:
 *   - where am I (player arrow, centre, pointing where the player faces)
 *   - what is around me (yellow dots: NPCs and monsters; red dots: loot on the ground)
 *   - where am I walking (a gold marker on the destination, clamped to the rim when off-map)
 *   - clicking a point walks there, through the same `moveTo({ position })` a world click uses.
 *
 * Rendering is one image blit plus a handful of dots at the HUD cadence (10 Hz), against the small
 * baked minimap rendition. The detailed map stays unloaded until its panel opens. Entity positions
 * come from `observe()` at a slower cadence, because path-distance observation is the expensive half.
 *
 * The cluster root is `.is-passive` (the square's open corners must not eat world clicks); the
 * disc and the corner buttons opt back in individually.
 */
import type { GameApi, ObservedEntity, Vec3 } from "../contracts.js";
import { worldMapForRegion } from "../contracts.js";
import {
  WORLD_MAP_IMAGE_BOUNDS,
  WORLD_MAP_MINIMAP_RENDITION,
} from "../generated/worldMapFingerprint.js";
import type { MapTerrainSource } from "./panels.js";
import { reportResult } from "./contextMenu.js";
import type { Tooltip } from "./tooltips.js";
import { liveTerrainMap } from "./worldMapCanvas.js";

/** Canvas backing resolution, css px. The wrapper's CSS size may differ; clicks use the rect. */
const SIZE = 148;
/** World metres from centre to rim. */
const VIEW_RADIUS_M = 55;
/** How often the entity dots re-observe. Observation prices rows by path distance, so slower
 * is cheaper for the whole game, and dots that move a metre between polls are imperceptible. */
const ENTITY_POLL_MS = 800;
const IMAGE_RETRY_BASE_MS = 1_000;
const IMAGE_RETRY_MAX_MS = 30_000;

const ACTOR_ARCHETYPES = new Set(["enemy", "boss", "npc"]);

/** Orientation, persisted like the tracker's position: a client preference, not save data.
 * The key is versioned: v2 flipped the default to follow-view, because a north-locked disc under
 * a camera facing any other way reads as "the minimap is backwards" — everything moves opposite
 * to the world. North-lock stays one compass click away. */
const MODE_KEY = "corealm.minimap.mode.v2";
type MinimapMode = "north" | "view";
type MinimapImageState = "idle" | "loading" | "retrying" | "ready";

interface Dot {
  x: number;
  z: number;
  kind: "actor" | "loot";
}

export interface MinimapActions {
  /** Toggle the full map window. Wired to the map panel. */
  onOpenMap?(): void;
  /** The corner X: raise the pause menu. */
  onMenu?(): void;
  /** Shared in-game hover card. */
  tooltip?: Pick<Tooltip, "attach">;
}

export class Minimap {
  private readonly root: HTMLElement;
  private readonly disc: HTMLElement;
  private readonly compassNeedle: HTMLElement;
  private readonly compassButton: HTMLButtonElement;
  private readonly context: CanvasRenderingContext2D | null;
  private image: HTMLImageElement | null = null;
  private imageLoading = false;
  private imageFailures = 0;
  private imageRetryAtMs = 0;
  private imageState: MinimapImageState = "idle";
  private lastUpdateMs = 0;
  private disposed = false;
  private dots: Dot[] = [];
  private lastPollMs = -Infinity;
  private mode: MinimapMode = "view";
  private lastNeedleDeg = Number.NaN;
  private terrain: MapTerrainSource;
  private activeMap: ReturnType<typeof worldMapForRegion>;

  constructor(
    private readonly api: GameApi,
    private readonly baseTerrain: MapTerrainSource,
    private readonly getDestination?: () => Vec3 | null,
    private readonly getHeadingRad?: () => number,
    actions: MinimapActions = {},
  ) {
    const regionId = api.getPlayer().regionId;
    this.activeMap = worldMapForRegion(regionId);
    this.terrain = baseTerrain.forRegion?.(regionId) ?? baseTerrain;
    try {
      if (localStorage.getItem(MODE_KEY) === "north") this.mode = "north";
    } catch {
      // Private mode: the toggle still works, it just forgets between sessions.
    }
    const root = document.createElement("div");
    root.className = "minimap is-passive";

    const disc = document.createElement("div");
    disc.className = "minimap__disc";
    disc.setAttribute("role", "button");
    disc.setAttribute("aria-label", "Minimap. Click a point to walk there.");
    disc.tabIndex = 0;
    actions.tooltip?.attach(disc, () => ({
      kind: "text",
      title: "Minimap",
      lines: ["Click a point to walk there."],
    }));

    const canvas = document.createElement("canvas");
    const ratio = Math.min(Math.max(1, window.devicePixelRatio || 1), 2);
    canvas.width = SIZE * ratio;
    canvas.height = SIZE * ratio;
    disc.appendChild(canvas);

    this.context = canvas.getContext("2d", { alpha: false });
    this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);

    // A pointer press on the minimap is an order to the minimap, never also a world click.
    disc.addEventListener("pointerdown", (event) => event.stopPropagation());
    disc.addEventListener("click", (event) => this.walkTo(event.clientX, event.clientY));

    const mapButton = document.createElement("button");
    mapButton.type = "button";
    mapButton.className = "minimap__btn minimap__btn--map";
    // A folded map, drawn inline: no icon font, no asset fetch, tints with currentColor.
    mapButton.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" '
      + 'stroke="currentColor" stroke-width="2" stroke-linejoin="round">'
      + '<path d="M3 5.5L9 3.5L15 5.5L21 3.5V18.5L15 20.5L9 18.5L3 20.5Z"/>'
      + '<path d="M9 3.5V18.5M15 5.5V20.5"/></svg>';
    mapButton.setAttribute("aria-label", "Open full map");
    actions.tooltip?.attach(mapButton, () => ({
      kind: "text",
      title: "Full map",
      lines: ["Open the map. Press M."],
    }));
    mapButton.addEventListener("pointerdown", (event) => event.stopPropagation());
    mapButton.addEventListener("click", () => actions.onOpenMap?.());

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "minimap__btn minimap__btn--menu";
    menuButton.textContent = "×";
    menuButton.setAttribute("aria-label", "Open menu");
    actions.tooltip?.attach(menuButton, () => ({
      kind: "text",
      title: "Menu",
      lines: ["Open the game menu. Press Escape."],
    }));
    menuButton.addEventListener("pointerdown", (event) => event.stopPropagation());
    menuButton.addEventListener("click", () => actions.onMenu?.());

    // The compass, top-left: the N shows where north is, and clicking toggles between the map
    // staying north-up and the map turning with the view (in which case the N turns instead).
    const compassButton = document.createElement("button");
    compassButton.type = "button";
    compassButton.className = "minimap__btn minimap__btn--compass";
    const needle = document.createElement("span");
    needle.className = "minimap__needle";
    needle.textContent = "N";
    compassButton.appendChild(needle);
    actions.tooltip?.attach(compassButton, () => ({
      kind: "text",
      title: "Map orientation",
      lines: [this.mode === "view"
        ? "Map turns with the view. Click to lock north up."
        : "North is up. Click to turn the map with the view."],
    }));
    compassButton.addEventListener("pointerdown", (event) => event.stopPropagation());
    compassButton.addEventListener("click", () => this.setMode(this.mode === "north" ? "view" : "north"));

    root.append(disc, mapButton, menuButton, compassButton);

    this.root = root;
    this.disc = disc;
    this.compassNeedle = needle;
    this.compassButton = compassButton;
    this.setImageState("idle");
    this.applyMode();
  }

  private setMode(mode: MinimapMode): void {
    this.mode = mode;
    this.applyMode();
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Same tolerance as the constructor.
    }
  }

  private applyMode(): void {
    const view = this.mode === "view";
    const label = view
      ? "Map turns with the view. Click to lock north up."
      : "North is up. Click to turn the map with the view.";
    this.compassButton.setAttribute("aria-label", label);
    this.compassButton.setAttribute("aria-pressed", view ? "true" : "false");
    this.compassButton.classList.toggle("is-view", view);
    // North-locked shows the letter; following the view it switches to a needle that keeps
    // pointing at true north while the disc turns underneath it.
    this.compassNeedle.innerHTML = view
      ? '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" fill="currentColor">'
        + '<path d="M6 0.8 L9.4 10.4 L6 8.2 L2.6 10.4 Z"/></svg>'
      : "N";
    this.lastNeedleDeg = Number.NaN;
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  update(nowMs: number): void {
    this.lastUpdateMs = nowMs;
    this.syncMap();
    if (nowMs - this.lastPollMs >= ENTITY_POLL_MS) {
      this.lastPollMs = nowMs;
      this.pollEntities();
    }
    this.draw(nowMs);
  }

  dispose(): void {
    this.disposed = true;
    this.root.remove();
    this.image = null;
    this.imageLoading = false;
  }

  // ------------------------------------------------------------------ input

  private walkTo(clientX: number, clientY: number): void {
    this.syncMap();
    const rect = this.disc.getBoundingClientRect();
    if (rect.width < 2) return;
    const half = rect.width / 2;
    const scale = VIEW_RADIUS_M / half; // metres per css px at the rendered size
    let sx = clientX - rect.left - half;
    let sy = clientY - rect.top - half;
    // In view mode the disc is drawn rotated; a click has to be rotated back into the north-up
    // frame before it can become world metres. The inverse of drawing with rotate(r) is r's
    // negation, whatever r is — this stays correct if rotationRad's definition ever changes.
    const rotation = this.rotationRad();
    if (rotation !== 0) {
      const cos = Math.cos(-rotation);
      const sin = Math.sin(-rotation);
      const wx = sx * cos - sy * sin;
      const wy = sx * sin + sy * cos;
      sx = wx;
      sy = wy;
    }
    const player = this.api.getPlayer().position;
    const bounds = this.terrain.bounds;
    // Mirrored frame: screen-right is world -x; screen-down is world -z.
    const x = Math.min(Math.max(player[0] - sx * scale, bounds.minX), bounds.maxX);
    const z = Math.min(Math.max(player[2] - sy * scale, bounds.minZ), bounds.maxZ);
    const height = this.terrain.sample(x, z).height;
    reportResult(this.api.moveTo({ position: [x, height, z] as Vec3 }));
  }

  /**
   * How far the whole disc is rotated: 0 north-up; following the view, the view direction.
   * Two conventions meet here: the camera's yaw is its ORBIT azimuth (it looks along yaw + π),
   * and the disc draws in the mirrored map frame (+x leftward, like everything the player sees),
   * where a world angle θ displays as -θ — so putting the view at the top takes +θv, not -θv.
   */
  private rotationRad(): number {
    if (this.mode !== "view") return 0;
    return (this.getHeadingRad?.() ?? 0) + Math.PI;
  }

  // ---------------------------------------------------------------- drawing

  private pollEntities(): void {
    const observed = this.api.observe({
      radius: Math.min(140, VIEW_RADIUS_M + 5),
      archetypes: ["enemy", "boss", "npc", "loot"],
      limit: 40,
    });
    this.dots = observed.filter(entity => worldMapForRegion(entity.regionId) === this.activeMap).map((entity: ObservedEntity): Dot => ({
      x: entity.position[0],
      z: entity.position[2],
      kind: ACTOR_ARCHETYPES.has(entity.archetype) ? "actor" : "loot",
    }));
  }

  private draw(nowMs: number): void {
    const context = this.context;
    if (!context) return;
    if (this.terrain.renderMode !== "live") this.prepareImage(nowMs);

    const player = this.api.getPlayer();
    const px = player.position[0];
    const pz = player.position[2];
    const half = SIZE / 2;
    // One scale for everything drawn: the rim is exactly VIEW_RADIUS_M from the player, so the
    // terrain, the dots and the destination marker cannot drift against each other.
    const scale = half / VIEW_RADIUS_M;

    context.fillStyle = "#121310";
    context.fillRect(0, 0, SIZE, SIZE);

    context.save();
    context.beginPath();
    context.arc(half, half, half, 0, Math.PI * 2);
    context.clip();

    /*
     * Orientation: everything below draws in the north-up world frame; rotating the context about
     * the centre turns the whole picture at once. A square blit rotated about its centre still
     * covers its inscribed circle, which is exactly the clip, so no corner ever shows through.
     * The player arrow rotates with the frame too, which is the point: inside a turned map,
     * facing minus heading is what "up" means.
     */
    const rotation = this.rotationRad();
    if (rotation !== 0) {
      context.translate(half, half);
      context.rotate(rotation);
      context.translate(-half, -half);
    }

    this.blitTerrain(context, px, pz, scale);
    this.drawDots(context, px, pz, scale, half);
    this.drawDestination(context, px, pz, scale, half);
    this.drawPlayer(context, half, player.facingRad);

    context.restore();
    this.drawImageState(context, half);
    this.updateNeedle(rotation);
  }

  private drawImageState(context: CanvasRenderingContext2D, half: number): void {
    if (this.terrain.renderMode === "live") return;
    if (this.imageState === "ready") return;
    context.save();
    context.font = "10px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(255, 248, 232, 0.72)";
    context.fillText(this.imageState === "retrying" ? "Map retrying" : "Loading map", half, SIZE - 17);
    context.restore();
  }

  /** The N on the compass button turns to keep pointing at true north on screen. */
  private updateNeedle(rotationRad: number): void {
    const degrees = Math.round((rotationRad * 180) / Math.PI);
    if (degrees === this.lastNeedleDeg) return;
    this.lastNeedleDeg = degrees;
    this.compassNeedle.style.transform = degrees === 0 ? "" : `rotate(${degrees}deg)`;
  }

  /**
   * Blit the player-centred window of the baked map. The source rectangle is clamped to the
   * image by hand — the 2D spec says out-of-bounds sources are clipped proportionally, but not
   * every browser has agreed historically, and the failure mode is a smeared edge.
   */
  private blitTerrain(context: CanvasRenderingContext2D, px: number, pz: number, scale: number): void {
    const live = this.terrain.renderMode === "live";
    const image = live ? liveTerrainMap(this.terrain) : this.image;
    if (!image) return;
    // The rendition covers the padded IMAGE bounds from the generator, not the playable terrain
    // bounds — mapping it to the wrong rect is a constant offset and scale error everywhere.
    const bounds = live ? this.terrain.bounds : WORLD_MAP_IMAGE_BOUNDS;
    // Projection matches WorldMapCanvas: u = x, v = -z, image spans the projected image bounds.
    const sourceWidth = live ? image.width : WORLD_MAP_MINIMAP_RENDITION.width;
    const sourceHeight = live ? image.height : WORLD_MAP_MINIMAP_RENDITION.height;
    const imgScaleX = sourceWidth / Math.max(1e-6, bounds.maxX - bounds.minX);
    const imgScaleY = sourceHeight / Math.max(1e-6, (-bounds.minZ) - (-bounds.maxZ));
    const centreSx = (px - bounds.minX) * imgScaleX;
    const centreSy = ((-pz) - (-bounds.maxZ)) * imgScaleY;
    const viewM = (SIZE / 2) / scale; // metres from centre to canvas edge = VIEW_RADIUS_M

    let sx = centreSx - viewM * imgScaleX;
    let sy = centreSy - viewM * imgScaleY;
    let sw = viewM * imgScaleX * 2;
    let sh = viewM * imgScaleY * 2;
    let dx = 0;
    let dy = 0;
    let dw = SIZE;
    let dh = SIZE;

    if (sx < 0) { dx -= (sx / sw) * dw; dw += (sx / sw) * dw; sw += sx; sx = 0; }
    if (sy < 0) { dy -= (sy / sh) * dh; dh += (sy / sh) * dh; sh += sy; sy = 0; }
    if (sx + sw > sourceWidth) { const over = sx + sw - sourceWidth; dw -= (over / sw) * dw; sw -= over; }
    if (sy + sh > sourceHeight) { const over = sy + sh - sourceHeight; dh -= (over / sh) * dh; sh -= over; }
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "medium";
    // The baked image is stored +x-rightward; the disc, like the big map, displays +x leftward.
    context.save();
    context.translate(SIZE, 0);
    context.scale(-1, 1);
    context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
    context.restore();
  }

  /** Yellow solid dots for people and monsters, red for loot on the ground. No labels. */
  private drawDots(context: CanvasRenderingContext2D, px: number, pz: number, scale: number, half: number): void {
    for (const dot of this.dots) {
      const dx = (px - dot.x) * scale;
      const dy = (pz - dot.z) * scale;
      if (dx * dx + dy * dy > (half - 3) * (half - 3)) continue;
      context.beginPath();
      context.arc(half + dx, half + dy, 2.6, 0, Math.PI * 2);
      context.fillStyle = dot.kind === "actor" ? "#ffe14a" : "#ff4d38";
      context.fill();
      context.lineWidth = 1;
      context.strokeStyle = "rgba(0, 0, 0, 0.8)";
      context.stroke();
    }
  }

  /** The walk target: a gold diamond, pulled onto the rim when the destination is off-map. */
  private drawDestination(context: CanvasRenderingContext2D, px: number, pz: number, scale: number, half: number): void {
    const destination = this.getDestination?.() ?? null;
    if (!destination) return;
    const bounds = this.terrain.bounds;
    if (destination[0] < bounds.minX || destination[0] > bounds.maxX
      || destination[2] < bounds.minZ || destination[2] > bounds.maxZ) return;
    let dx = (px - destination[0]) * scale;
    let dy = (pz - destination[2]) * scale;
    const limit = half - 8;
    const length = Math.hypot(dx, dy);
    if (length > limit) {
      dx = (dx / length) * limit;
      dy = (dy / length) * limit;
    }
    const x = half + dx;
    const y = half + dy;
    context.beginPath();
    context.moveTo(x, y - 5);
    context.lineTo(x + 5, y);
    context.lineTo(x, y + 5);
    context.lineTo(x - 5, y);
    context.closePath();
    context.fillStyle = "#ffd75e";
    context.fill();
    context.lineWidth = 1.2;
    context.strokeStyle = "rgba(0, 0, 0, 0.85)";
    context.stroke();
  }

  private drawPlayer(context: CanvasRenderingContext2D, half: number, facingRad: number): void {
    context.save();
    context.translate(half, half);
    // Negated: the disc's frame draws +x leftward, and a mirror flips angles.
    context.rotate(-facingRad);
    context.beginPath();
    context.moveTo(0, -5.5);
    context.lineTo(4, 4.5);
    context.lineTo(0, 2.4);
    context.lineTo(-4, 4.5);
    context.closePath();
    context.fillStyle = "#fff8e8";
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = "rgba(0, 0, 0, 0.85)";
    context.stroke();
    context.restore();
  }

  private prepareImage(nowMs: number): void {
    if (this.image || this.imageLoading || this.disposed || nowMs < this.imageRetryAtMs) return;
    this.imageLoading = true;
    this.setImageState(this.imageFailures === 0 ? "loading" : "retrying");
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (this.disposed) return;
      this.image = image;
      this.imageLoading = false;
      this.imageFailures = 0;
      this.setImageState("ready");
    };
    image.onerror = () => {
      if (this.disposed) return;
      this.imageLoading = false;
      this.imageFailures += 1;
      const retryDelay = Math.min(
        IMAGE_RETRY_BASE_MS * (2 ** Math.min(this.imageFailures - 1, 5)),
        IMAGE_RETRY_MAX_MS,
      );
      this.imageRetryAtMs = this.lastUpdateMs + retryDelay;
      this.setImageState("retrying");
    };
    const imageUrl = new URL(WORLD_MAP_MINIMAP_RENDITION.path, document.baseURI);
    imageUrl.searchParams.set("v", WORLD_MAP_MINIMAP_RENDITION.sha256);
    image.src = imageUrl.href;
  }

  private syncMap(): void {
    const regionId = this.api.getPlayer().regionId;
    const mapId = worldMapForRegion(regionId);
    if (mapId !== this.activeMap) {
      this.activeMap = mapId;
      this.terrain = this.baseTerrain.forRegion?.(regionId) ?? this.baseTerrain;
      this.dots = [];
      this.lastPollMs = -Infinity;
      this.setImageState(this.terrain.renderMode === "live" || this.image ? "ready" : "idle");
    }
    this.disc.dataset.mapId = mapId;
    this.disc.dataset.mapTerrain = this.terrain.renderMode === "live" ? "live" : "baked";
    if (this.terrain.renderMode === "live" && this.imageState !== "ready") this.setImageState("ready");
  }

  private setImageState(state: MinimapImageState): void {
    if (this.terrain.renderMode === "live") state = "ready";
    this.imageState = state;
    this.disc.dataset.mapState = state;
    this.disc.setAttribute("aria-busy", state === "ready" ? "false" : "true");
    const status = state === "loading" || state === "idle"
      ? "Map terrain loading."
      : state === "retrying"
        ? "Map terrain unavailable. Retrying."
        : "Minimap.";
    this.disc.setAttribute("aria-label", `${status} Click a point to walk there.`);
  }
}
