/**
 * Human pointer input: hover feedback, click-to-move, click-to-interact, camera orbit and zoom.
 *
 * Everything the player does here goes through `GameApi`. That is the whole point of the layering:
 * a human click and a WebMCP call reach the identical function, so agent parity is a property of
 * the architecture rather than a claim. This file never touches the store and never reaches into a
 * system directly.
 *
 * The render and movement dependencies are taken structurally rather than by class import. The
 * concrete `Renderer`, `OrbitCamera` and `Movement` satisfy these shapes, but the input layer does
 * not need to know their internals — and staying structural keeps `input/` from breaking every time
 * the render layer reorganises.
 */
import type * as THREE from "three";
import type { EntityId, GameApi, InteractionId, MoveTarget, Vec3 } from "../contracts.js";
import { CAMERA } from "../app/config.js";
import { Picker, type Pick, type PickSource, type PickerSources } from "./picking.js";
import { KeyboardController, type KeyBindingRegistry } from "./keyboard.js";
import {
  ContextMenu, interactionLabel, notify, primaryInteraction, reportResult,
} from "../ui/contextMenu.js";
import { entityExamineLabel, entityLevelLabel } from "../ui/displayLabels.js";

/** Pointer travel beyond this distance switches hover handling into drag mode. */
const DRAG_THRESHOLD_PX = 4;

/** Radians per pixel of orbit drag. Slow enough that the camera reads as a camera, not a cursor. */
const ORBIT_YAW_PER_PX = 0.006;
const ORBIT_PITCH_PER_PX = 0.004;

/** Fraction of the zoom range per wheel notch. */
const ZOOM_STEP_FRACTION = 0.06;

export interface RendererLike {
  camera: THREE.Camera;
  scene: THREE.Object3D;
}

export interface OrbitCameraLike {
  readonly yaw: number;
  rotate(deltaYaw: number, deltaPitch: number): void;
  zoom(delta: number): void;
  panPixels(deltaX: number, deltaY: number, viewportHeight: number): void;
}

export interface MovementLike {
  setDirectInput(input: { forward: number; strafe: number; cameraYaw: number }): void;
}

export interface InputOptions {
  /** Root wires this to the render layer's entity pick at integration. */
  entityPickSource?: PickSource | null;
  /** Alternative wiring shape; see `PickerSources`. */
  pickSources?: PickerSources;
  /** Share the registry with the panels. Defaults to the module-level `keybindings`. */
  keybindings?: KeyBindingRegistry;
  /** Notified when the hovered entity changes, so the render layer can highlight it. */
  onHoverChange?: (entityId: EntityId | null) => void;
  /** Notified when the selected (last left-clicked) entity changes. */
  onSelectionChange?: (entityId: EntityId | null) => void;
  /** Notified after a walk-only click starts a valid path, so the view can mark its destination. */
  onWalkDestination?: (point: Vec3) => void;
  /** Opens recipe selection for a production station instead of auto-starting one recipe. */
  onProduction?: (entityId: EntityId) => void;
  /** Defaults to #ui-root. */
  uiRoot?: HTMLElement | null;
  hoverThrottleMs?: number;
}

export class InputController {
  readonly picker: Picker;
  readonly contextMenu: ContextMenu;
  readonly keyboard: KeyboardController;

  /** The entity under the cursor, or null. Read by the render layer for the highlight ring. */
  hoveredEntityId: EntityId | null = null;
  /** Last left-clicked entity. Space falls back to this when nothing is hovered. */
  selectedEntityId: EntityId | null = null;

  private pointerDown = false;
  private dragging = false;
  private dragButton = 0;
  private activePointerId: number | null = null;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;

  /** Latest cursor position, in client coordinates. Hover is resolved from the frame loop. */
  private cursorX = 0;
  private cursorY = 0;
  private cursorOverCanvas = false;
  private hoverLabel: HTMLElement | null = null;
  private labelAtX = Number.NaN;
  private labelAtY = Number.NaN;
  private readonly hoverThrottleMs: number;
  private readonly options: InputOptions;
  private movementEnabled = true;
  private freeCameraEnabled = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    renderer: RendererLike,
    private readonly camera: OrbitCameraLike,
    private readonly api: GameApi,
    private readonly movement: MovementLike,
    options: InputOptions = {},
  ) {
    this.options = options;
    this.hoverThrottleMs = options.hoverThrottleMs ?? 70;

    this.picker = new Picker(
      { camera: renderer.camera, scene: renderer.scene, element: canvas },
      {
        ...(options.pickSources ?? {}),
        ...(options.entityPickSource !== undefined ? { pickEntity: options.entityPickSource } : {}),
      },
    );

    const menuDeps = {
      api,
      ...(options.uiRoot !== undefined ? { root: options.uiRoot } : {}),
      ...(options.onProduction ? { onProduction: options.onProduction } : {}),
    };
    this.contextMenu = new ContextMenu(menuDeps);

    const keyboardOptions = {
      api,
      getActionTargetId: (): EntityId | null => this.actionTargetId(),
      activateTarget: (): void => this.activateTarget(),
      ...(options.keybindings ? { registry: options.keybindings } : {}),
    };
    this.keyboard = new KeyboardController(keyboardOptions);

    this.attach();
  }

  // ------------------------------------------------------------ root wiring

  /**
   * Integration hook. The root calls this once the render layer can answer "what is under this
   * ray", which is the only thing the input layer cannot work out for itself.
   */
  setEntityPickSource(source: PickSource | null): void {
    this.picker.setEntitySource(source);
  }

  configurePicking(sources: PickerSources): void {
    this.picker.configure(sources);
  }

  /**
   * Enables or suspends player movement without replacing the input controller.
   *
   * Camera gestures, hover picking and the shared keybinding registry stay attached. Clearing the
   * keyboard on both transitions prevents a movement key pressed in inspection mode from taking
   * effect when walking is enabled again.
   */
  setMovementEnabled(enabled: boolean): void {
    if (this.movementEnabled === enabled) return;
    this.movementEnabled = enabled;
    this.contextMenu.close();
    this.keyboard.clear();
    this.movement.setDirectInput({ forward: 0, strafe: 0, cameraYaw: this.camera.yaw });
    if (!enabled) this.api.stop();
  }

  setFreeCameraEnabled(enabled: boolean): void {
    this.freeCameraEnabled = enabled;
    this.contextMenu.close();
    this.keyboard.clear();
  }

  // ------------------------------------------------------------------ events

  private attach(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    // Move/up live on the window so a drag that leaves the viewport keeps orbiting and still ends
    // cleanly when the button is released over a panel or off-screen.
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContextMenuEvent);
    window.addEventListener("blur", this.onWindowBlur);
  }

  private onContextMenuEvent = (event: MouseEvent): void => {
    // The browser menu would cover the game menu, and right-drag orbit needs the button.
    event.preventDefault();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.target !== this.canvas) return;

    this.pointerDown = true;
    this.dragging = false;
    this.dragButton = event.button;
    this.activePointerId = event.pointerId;
    this.downX = this.lastX = this.cursorX = event.clientX;
    this.downY = this.lastY = this.cursorY = event.clientY;

    // Capture keeps orbit alive at the edge of the screen instead of dropping the drag there.
    if (event.button === 1 || event.button === 2) {
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety. Losing it only costs edge-of-screen comfort.
      }
    }
    // Middle click otherwise scrolls the page.
    if (event.button === 1) event.preventDefault();

    // Left-button world actions happen at press time. Pointer travel can still switch the gesture
    // into a camera drag, but it must not delay or cancel the action that began on this press.
    if (event.button === 0) this.handleLeftClick(event.clientX, event.clientY);
  };

  private onPointerMove = (event: PointerEvent): void => {
    this.cursorX = event.clientX;
    this.cursorY = event.clientY;
    this.cursorOverCanvas = event.target === this.canvas;

    if (!this.pointerDown) return;
    if (!this.dragging && Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > DRAG_THRESHOLD_PX) {
      this.dragging = true;
      this.setHovered(null);
    }
    if (!this.dragging) return;

    // Right-drag or middle-drag orbits. Left-drag is reserved for a future selection box, and in
    // particular must never nudge the camera — that is what "does not fight the camera" means.
    if (this.dragButton === 2 || this.dragButton === 1) {
      const deltaX = event.clientX - this.lastX;
      const deltaY = event.clientY - this.lastY;
      if (this.freeCameraEnabled && this.dragButton === 1) {
        this.camera.panPixels(deltaX, deltaY, this.canvas.clientHeight);
      } else {
        this.camera.rotate(-deltaX * ORBIT_YAW_PER_PX, -deltaY * ORBIT_PITCH_PER_PX);
      }
      // The world moved under a stationary cursor; the cached hover pick is stale.
      this.picker.invalidate();
    }
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointerDown) return;
    this.releaseCapture(event.pointerId);
    this.pointerDown = false;
    const wasDragging = this.dragging;
    this.dragging = false;
    this.activePointerId = null;

    // Right click opens its menu on release. A right drag only orbits the camera.
    if (event.button !== 2 || wasDragging) return;
    if (!this.picker.containsPoint(event.clientX, event.clientY)) return;
    this.handleRightClick(event.clientX, event.clientY);
  };

  private onPointerCancel = (event: PointerEvent): void => {
    this.releaseCapture(event.pointerId);
    this.pointerDown = false;
    this.dragging = false;
    this.activePointerId = null;
  };

  private onPointerLeave = (): void => {
    this.cursorOverCanvas = false;
    if (!this.dragging) this.setHovered(null);
  };

  private onWindowBlur = (): void => {
    this.pointerDown = false;
    this.dragging = false;
    this.cursorOverCanvas = false;
    this.setHovered(null);
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.camera.zoom(Math.sign(event.deltaY) * (CAMERA.maxDistance - CAMERA.minDistance) * ZOOM_STEP_FRACTION);
    this.picker.invalidate();
  };

  private releaseCapture(pointerId: number): void {
    if (this.activePointerId !== pointerId) return;
    try {
      if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    } catch {
      // Already released, or never captured.
    }
  }

  // ----------------------------------------------------------------- actions

  /**
   * Left click. Actionable entities run their primary interaction; ground and scenery walk there.
   * `GameApi.interact` already walks into range first, so one click is always one intent.
   */
  private handleLeftClick(clientX: number, clientY: number): void {
    const pick = this.picker.pickAt(clientX, clientY);
    if (!pick) return;

    if (!this.movementEnabled) {
      this.setSelected(pick.entityId ?? null);
      if (pick.entityId) this.inspectEntity(pick.entityId);
      return;
    }

    if (pick.entityId) {
      const interaction = this.primaryInteractionFor(pick.entityId);
      if (!interaction) {
        // Scenery can sit on top of otherwise walkable ground. Treat it exactly like a ground
        // click instead of making a non-actionable prop look actionable.
        this.setSelected(null);
        this.moveTo({ entityId: pick.entityId }, pick.point);
        return;
      }
      this.setSelected(pick.entityId);
      this.runInteraction(pick.entityId, interaction);
      return;
    }

    this.setSelected(null);
    this.moveTo({ position: pick.point }, pick.point);
  }

  private handleRightClick(clientX: number, clientY: number): void {
    const pick = this.picker.pickAt(clientX, clientY);
    if (!pick) return;
    const options = { movementEnabled: this.movementEnabled };
    if (pick.entityId) this.contextMenu.openForEntity(pick.entityId, clientX, clientY, options);
    else this.contextMenu.openForGround(pick.point, clientX, clientY, options);
  }

  private moveTo(target: MoveTarget, feedbackPoint: Vec3): void {
    if (!this.movementEnabled) return;
    const moved = this.api.moveTo(target);
    if (!reportResult(moved)) return;
    this.options.onWalkDestination?.(feedbackPoint);
  }

  /** Resolves Space's hovered or selected target through the same interaction path as a click. */
  private interactPrimary(entityId: EntityId): void {
    if (!this.movementEnabled) {
      this.inspectEntity(entityId);
      return;
    }
    const interaction = this.primaryInteractionFor(entityId);
    if (!interaction) {
      // No interactions known yet (the entity hook may not be registered). Walking there is still
      // the honest interpretation of the action.
      reportResult(this.api.moveTo({ entityId }));
      return;
    }
    // Examine is a read, so it takes the read path — same as the context menu's Examine entry.
    this.runInteraction(entityId, interaction);
  }

  /** Shared by the left click and by Space, so both routes cannot drift apart. */
  private runInteraction(entityId: EntityId, interaction: InteractionId): void {
    if (!this.movementEnabled && interaction !== "inspect") return;
    if (interaction === "inspect") {
      this.inspectEntity(entityId);
      return;
    }
    if (interaction === "produce" && this.options.onProduction) {
      this.options.onProduction(entityId);
      return;
    }
    reportResult(this.api.interact(entityId, interaction));
  }

  private inspectEntity(entityId: EntityId): void {
    const inspected = this.api.inspect(entityId);
    if (!reportResult(inspected)) return;
    notify(entityExamineLabel(inspected.value), "info");
  }

  private primaryInteractionFor(entityId: EntityId): InteractionId | null {
    const inspected = this.api.inspect(entityId);
    if (!inspected.ok) return null;
    return primaryInteraction(inspected.value.interactions);
  }

  /** Space acts on the hovered entity, or on the last selected one. PRD section 5. */
  private actionTargetId(): EntityId | null {
    return this.hoveredEntityId ?? this.selectedEntityId;
  }

  private activateTarget(): void {
    const target = this.actionTargetId();
    if (!target) return;
    this.interactPrimary(target);
  }

  // ------------------------------------------------------------------- hover

  /**
   * Folds held keys into movement and refreshes hover. Called once per rendered frame.
   *
   * Hover picking lives here rather than in the pointermove handler on purpose: mousemove fires far
   * faster than the frame rate, and a raycast per event is wasted work. The throttle inside
   * `Picker` bounds it further, so a fast sweep across a canopy costs a handful of rays.
   */
  update(): void {
    const { forward, strafe } = this.movementEnabled
      ? this.keyboard.axes()
      : { forward: 0, strafe: 0 };
    this.movement.setDirectInput({ forward, strafe, cameraYaw: this.camera.yaw });
    this.updateHover();
  }

  private updateHover(): void {
    if (!this.cursorOverCanvas || this.dragging || this.contextMenu.isOpen()) {
      this.setHovered(null);
      return;
    }
    const pick = this.picker.pickThrottled(this.cursorX, this.cursorY, performance.now(), this.hoverThrottleMs);
    this.setHovered(pick?.entityId ?? null);
    this.positionHoverLabel();
  }

  /**
   * Selects an entity as if the player had clicked it. For the debug surface and browser checks.
   *
   * Goes through the same private setter a click does, so the highlight repaint and the selection
   * callback fire identically - which is the point. A test that sets a field directly proves the
   * field, not the behaviour.
   */
  select(entityId: EntityId | null): void {
    this.setSelected(entityId);
  }

  /**
   * Drops an entity out of the hover and selection, because it has stopped being a thing to click.
   *
   * Called when an enemy dies. Without it the selection ring stays lit on a corpse and the cursor
   * label keeps offering "Attack" over a body that is already dissolving - and the ring outlives
   * the body it was drawn around, which leaves a circle on bare grass.
   */
  forget(entityId: EntityId): void {
    if (this.hoveredEntityId === entityId) this.setHovered(null);
    if (this.selectedEntityId === entityId) this.setSelected(null);
  }

  private setHovered(entityId: EntityId | null): void {
    if (entityId === this.hoveredEntityId) return;
    this.hoveredEntityId = entityId;
    this.canvas.classList.toggle("is-hovering-entity", entityId !== null);
    this.renderHoverLabel(entityId);
    this.options.onHoverChange?.(entityId);
  }

  private setSelected(entityId: EntityId | null): void {
    if (entityId === this.selectedEntityId) return;
    this.selectedEntityId = entityId;
    this.options.onSelectionChange?.(entityId);
  }

  /**
   * The cursor label. Names the thing and the verb a click would run, which is the cheapest way to
   * make a 3D scene legible — the player never has to click to find out what something is.
   */
  private renderHoverLabel(entityId: EntityId | null): void {
    if (!entityId) {
      this.hoverLabel?.remove();
      this.hoverLabel = null;
      return;
    }

    const inspected = this.api.inspect(entityId);
    if (!inspected.ok) {
      this.hoverLabel?.remove();
      this.hoverLabel = null;
      return;
    }

    const entity = inspected.value;
    const interaction = primaryInteraction(entity.interactions);
    const label = this.hoverLabel ?? this.createHoverLabel();
    if (!label) return;

    label.textContent = entity.state === "depleted"
      ? `${entity.name} · Depleted`
      : interaction ? `${interactionLabel(entity, interaction)} ${entity.name}` : entity.name;

    const levelText = entityLevelLabel(entity);
    if (levelText) {
      const level = document.createElement("span");
      level.className = "hover-label__tier";
      level.textContent = levelText;
      label.appendChild(level);
    }

    // New text means a new width, so force the next position pass even if the cursor is still.
    this.labelAtX = Number.NaN;
    this.labelAtY = Number.NaN;
    this.positionHoverLabel();
  }

  private createHoverLabel(): HTMLElement | null {
    const root = this.options.uiRoot ?? document.getElementById("ui-root");
    if (!root) return null;
    const label = document.createElement("div");
    label.className = "hover-label";
    root.appendChild(label);
    this.hoverLabel = label;
    return label;
  }

  private positionHoverLabel(): void {
    const label = this.hoverLabel;
    if (!label) return;
    // Reading offsetWidth forces layout, so only do it when the cursor actually moved.
    if (this.labelAtX === this.cursorX && this.labelAtY === this.cursorY) return;
    this.labelAtX = this.cursorX;
    this.labelAtY = this.cursorY;
    // Offset below-right of the cursor, flipped near the edges so it never leaves the window.
    const width = label.offsetWidth;
    const height = label.offsetHeight;
    const x = this.cursorX + 18 + width > window.innerWidth ? this.cursorX - width - 12 : this.cursorX + 18;
    const y = this.cursorY + 20 + height > window.innerHeight ? this.cursorY - height - 12 : this.cursorY + 20;
    label.style.left = `${Math.round(Math.max(4, x))}px`;
    label.style.top = `${Math.round(Math.max(4, y))}px`;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Resets transient input state. The debug `reset()` path calls this. */
  clear(): void {
    this.keyboard.clear();
    this.pointerDown = false;
    this.dragging = false;
    this.contextMenu.close();
    this.setHovered(null);
    this.setSelected(null);
    this.picker.invalidate();
    this.movement.setDirectInput({ forward: 0, strafe: 0, cameraYaw: this.camera.yaw });
  }

  isHeld(key: string): boolean {
    return this.keyboard.isHeld(key);
  }

  /** Full pick under the cursor, entity or ground. Useful for a destination marker overlay. */
  pickUnderCursor(): Pick | null {
    return this.picker.pickAt(this.cursorX, this.cursorY);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenuEvent);
    window.removeEventListener("blur", this.onWindowBlur);
    this.keyboard.dispose();
    this.contextMenu.dispose();
    this.hoverLabel?.remove();
    this.hoverLabel = null;
  }
}
