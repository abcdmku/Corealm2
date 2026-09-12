const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.35;
/** Breathing room left around the marker cluster when the map frames itself. */
const FOCUS_PADDING = 1.14;
/**
 * Smallest slice of the world a focused map will show, as a percentage of the map.
 *
 * A creature with one spawn has a zero-sized marker box. Framing that literally would zoom to a
 * patch of grass with no landmark in it, so a focused map never shows less than this much world.
 */
const MIN_FOCUS_EXTENT = 34;

/**
 * Most of the rendered world is unsettled wilderness. `data-map-focus` carries the bounding box
 * of this map's own markers as `minX,minY,maxX,maxY` percentages, so the map can open on the part
 * that has something on it instead of on empty moor.
 */
function readFocus(root) {
  const raw = root.dataset.mapFocus;
  if (!raw) return undefined;
  const values = raw.split(",").map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return undefined;
  const [minX, minY, maxX, maxY] = values;
  const width = Math.max(maxX - minX, MIN_FOCUS_EXTENT);
  const height = Math.max(maxY - minY, MIN_FOCUS_EXTENT);
  return { centreX: (minX + maxX) / 2, centreY: (minY + maxY) / 2, width, height };
}

function initialiseLocationMap(root) {
  if (!(root instanceof HTMLElement) || root.dataset.mapReady === "true") return;

  const viewport = root.querySelector("[data-map-viewport]");
  const stage = root.querySelector("[data-map-stage]");
  const expandButton = root.querySelector('[data-map-action="expand"]');
  const zoomInButton = root.querySelector('[data-map-action="in"]');
  const zoomOutButton = root.querySelector('[data-map-action="out"]');
  if (!(viewport instanceof HTMLElement) || !(stage instanceof HTMLElement)) return;

  root.dataset.mapReady = "true";
  const focus = readFocus(root);
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let drag;
  let expanded = false;
  let placeholder;

  const clampOffsets = () => {
    const { width, height } = viewport.getBoundingClientRect();
    const maxX = Math.max(0, width * (zoom - 1) / 2);
    const maxY = Math.max(0, height * (zoom - 1) / 2);
    offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
    offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
  };

  const render = () => {
    clampOffsets();
    stage.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${zoom})`;
    root.style.setProperty("--marker-inverse", String(1 / zoom));
    root.dataset.mapZoom = zoom.toFixed(2);
    if (zoomInButton instanceof HTMLButtonElement) zoomInButton.disabled = zoom >= MAX_ZOOM;
    if (zoomOutButton instanceof HTMLButtonElement) zoomOutButton.disabled = zoom <= MIN_ZOOM;
  };

  const setZoom = (nextZoom, clientX, clientY) => {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    if (Math.abs(next - zoom) < 0.001) return;
    const rect = viewport.getBoundingClientRect();
    const focusX = Number.isFinite(clientX) ? clientX - rect.left - rect.width / 2 : 0;
    const focusY = Number.isFinite(clientY) ? clientY - rect.top - rect.height / 2 : 0;
    const ratio = next / zoom;
    offsetX = focusX - (focusX - offsetX) * ratio;
    offsetY = focusY - (focusY - offsetY) * ratio;
    zoom = next;
    render();
  };

  /** Frames the marker box, which is what "reset" should mean on a mostly-empty world map. */
  const reset = () => {
    if (!focus) {
      zoom = 1;
      offsetX = 0;
      offsetY = 0;
      render();
      return;
    }
    const fit = Math.min(100 / (focus.width * FOCUS_PADDING), 100 / (focus.height * FOCUS_PADDING));
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit));
    const { width, height } = viewport.getBoundingClientRect();
    // The stage scales about its own centre, so pan by how far the focus centre sits off it.
    offsetX = (50 - focus.centreX) / 100 * width * zoom;
    offsetY = (50 - focus.centreY) / 100 * height * zoom;
    render();
  };

  const setExpanded = (next) => {
    if (expanded === next) return;
    const previousRect = viewport.getBoundingClientRect();
    expanded = next;
    if (expanded) {
      placeholder = document.createComment("corealm-location-map");
      root.before(placeholder);
      document.body.append(root);
    } else if (placeholder?.parentNode) {
      placeholder.replaceWith(root);
      placeholder = undefined;
    }
    root.classList.toggle("is-expanded", expanded);
    root.toggleAttribute("aria-modal", expanded);
    if (expanded) {
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-label", "Corealm world map");
    } else {
      root.removeAttribute("role");
      root.removeAttribute("aria-label");
    }
    document.documentElement.classList.toggle("corealm-map-open", expanded);
    if (expandButton instanceof HTMLButtonElement) {
      expandButton.setAttribute("aria-pressed", String(expanded));
      expandButton.setAttribute("aria-label", expanded ? "Close expanded map" : "Expand map");
      expandButton.title = expanded ? "Close expanded map" : "Expand map";
    }
    requestAnimationFrame(() => {
      const nextRect = viewport.getBoundingClientRect();
      if (previousRect.width > 0 && previousRect.height > 0) {
        offsetX *= nextRect.width / previousRect.width;
        offsetY *= nextRect.height / previousRect.height;
      }
      render();
      viewport.focus({ preventScroll: true });
    });
  };

  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), event.clientX, event.clientY);
  }, { passive: false });

  viewport.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : undefined;
    if (event.button !== 0 || target?.closest("button, a")) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX,
      offsetY,
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-panning");
  });

  viewport.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    offsetX = drag.offsetX + event.clientX - drag.startX;
    offsetY = drag.offsetY + event.clientY - drag.startY;
    render();
  });

  const endDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = undefined;
    viewport.classList.remove("is-panning");
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : undefined;
    const action = target?.closest("[data-map-action]")?.dataset.mapAction;
    if (action === "in") setZoom(zoom * ZOOM_STEP);
    if (action === "out") setZoom(zoom / ZOOM_STEP);
    if (action === "reset") reset();
    if (action === "expand") setExpanded(!expanded);
    if (expanded && target?.closest("[data-map-marker]")) setExpanded(false);
  });

  root.addEventListener("keydown", (event) => {
    const panStep = 32;
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setExpanded(false);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom(zoom * ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      setZoom(zoom / ZOOM_STEP);
    } else if (event.key === "0" || event.key === "Home") {
      event.preventDefault();
      reset();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      offsetX += panStep;
      render();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      offsetX -= panStep;
      render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      offsetY += panStep;
      render();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      offsetY -= panStep;
      render();
    }
  });

  window.addEventListener("resize", render);
  // The viewport is sized in vh/rem, so wait for layout before framing the markers against it.
  requestAnimationFrame(reset);
  render();
}

function initialiseMaps() {
  document.querySelectorAll("[data-location-map]").forEach(initialiseLocationMap);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialiseMaps, { once: true });
else initialiseMaps();
document.addEventListener("astro:page-load", initialiseMaps);
