const EDGE_MARGIN_PX = 10;
const ANCHOR_GAP_PX = 12;
let activeTile = null;

function positionTooltip(tile) {
  const tooltip = tile.querySelector(":scope > .tooltip");
  if (!(tooltip instanceof HTMLElement)) return;
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";
  tile.classList.add("is-tooltip-open");
  const target = tile.getBoundingClientRect();
  const card = tooltip.getBoundingClientRect();
  let left = target.right + ANCHOR_GAP_PX;
  if (left + card.width + EDGE_MARGIN_PX > window.innerWidth) {
    left = target.left - card.width - ANCHOR_GAP_PX;
  }
  if (left < EDGE_MARGIN_PX) left = EDGE_MARGIN_PX;
  let top = target.top;
  if (top + card.height + EDGE_MARGIN_PX > window.innerHeight) {
    top = window.innerHeight - card.height - EDGE_MARGIN_PX;
  }
  if (top < EDGE_MARGIN_PX) top = EDGE_MARGIN_PX;
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
  activeTile = tile;
}

function hideTooltip(tile) {
  tile.classList.remove("is-tooltip-open");
  if (activeTile === tile) activeTile = null;
}

function wireItemGallery(root = document) {
  for (const tile of root.querySelectorAll("[data-item-id]")) {
    if (!(tile instanceof HTMLElement) || tile.dataset.tooltipReady === "true") continue;
    tile.dataset.tooltipReady = "true";
    tile.addEventListener("pointerenter", () => positionTooltip(tile));
    tile.addEventListener("pointerleave", () => hideTooltip(tile));
    tile.addEventListener("focus", () => positionTooltip(tile));
    tile.addEventListener("blur", () => hideTooltip(tile));
    tile.addEventListener("keydown", (event) => {
      if (event.key === "Escape") tile.blur();
    });
  }
}

wireItemGallery();
document.addEventListener("astro:page-load", () => wireItemGallery());
function repositionActiveTooltip() {
  if (activeTile) positionTooltip(activeTile);
}

window.addEventListener("resize", repositionActiveTooltip);
window.addEventListener("scroll", repositionActiveTooltip, true);
