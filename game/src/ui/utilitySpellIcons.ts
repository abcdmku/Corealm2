/** Authored 32px utility and town teleport motifs, rasterized at build time. */
import type { TownTeleportId, UtilitySpellId } from "../contracts.js";

export const UTILITY_ICON_IDS = [
  "lesser_ward", "weaken", "binding_thread", "enchant_weapon",
  "warding_circle", "enfeebling_mist", "binding_field", "greater_enchantment",
  "mending_circle", "haste", "stillness", "sanctuary",
] as const satisfies readonly UtilitySpellId[];
export const TOWN_TELEPORT_ICON_IDS = [
  "millfield", "oakwood", "hillcrest", "ashford", "lantern_rest",
  "crownward", "lastlight", "prism_hollow", "starhaven",
] as const satisfies readonly TownTeleportId[];

export const UTILITY_SPELL_ICON_ATLAS_COLUMNS = 3;
export const UTILITY_SPELL_ICON_ATLAS_ROWS = 7;
const atlasUrl = new URL("../generated/utility-spell-icons.png", import.meta.url).href;

export function utilitySpellIconAtlasCell(id: UtilitySpellId): { column: number; row: number } {
  const index = UTILITY_ICON_IDS.indexOf(id);
  if (index < 0) throw new Error(`Unknown utility spell icon: ${id}`);
  return { column: index % 3, row: Math.floor(index / 3) };
}

export function townTeleportIconAtlasCell(id: TownTeleportId): { column: number; row: number } {
  const index = TOWN_TELEPORT_ICON_IDS.indexOf(id);
  if (index < 0) throw new Error(`Unknown town teleport icon: ${id}`);
  return { column: index % 3, row: 4 + Math.floor(index / 3) };
}

function atlasMarkup(cell: { column: number; row: number }, size: number): string {
  return `<span class="spell-icon" aria-hidden="true" style="display:inline-block;width:${size}px;height:${size}px;`
    + `background-image:url('${atlasUrl}');background-size:${UTILITY_SPELL_ICON_ATLAS_COLUMNS * 100}% ${UTILITY_SPELL_ICON_ATLAS_ROWS * 100}%;`
    + `background-position:${cell.column * 50}% ${cell.row * 100 / (UTILITY_SPELL_ICON_ATLAS_ROWS - 1)}%"></span>`;
}

export function utilitySpellIconMarkup(id: UtilitySpellId, size = 32): string {
  return atlasMarkup(utilitySpellIconAtlasCell(id), size);
}

export function townTeleportIconMarkup(id: TownTeleportId, size = 32): string {
  return atlasMarkup(townTeleportIconAtlasCell(id), size);
}

type Palette = { core: string; edge: string; deep: string };
const COSMIC: Palette = { core: "#eac4ff", edge: "#9b65dc", deep: "#221334" };
const ARC: Palette = { core: "#b9fbf3", edge: "#43c4c4", deep: "#0c2b35" };
const TEMPORAL: Palette = { core: "#c9fff1", edge: "#3bd6b9", deep: "#0a3236" };
const line = (colour: string, width = 2) =>
  `fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
type Glyph = (p: Palette) => string;

const UTILITY_GLYPHS: Record<UtilitySpellId, Glyph> = {
  lesser_ward: p => `<path d="M16 4l9 4v8c0 6-4 10-9 12-5-2-9-6-9-12V8z" ${line(p.edge, 2.2)}/>`
    + `<path d="M16 8v15M11 15h10" ${line(p.core, 2)}/>`,
  weaken: p => `<path d="M6 8l20 16M25 8L7 25" ${line(p.edge, 1.5)}/>`
    + `<path d="M10 11l8 8-4 1 4 7 4-2-4-7 4-1-8-8z" fill="${p.core}"/>`,
  binding_thread: p => `<path d="M5 9c6-7 7 5 13 0s10 1 7 5-12-2-15 4 5 8 8 3 7-4 9 0" ${line(p.core, 2)}/>`
    + `<circle cx="9" cy="19" r="2" fill="${p.edge}"/><circle cx="22" cy="16" r="2" fill="${p.edge}"/>`,
  enchant_weapon: p => `<path d="M7 26l15-16 4-4-7 2-13 15z" fill="${p.edge}"/>`
    + `<path d="M7 26l15-16M18 13l4 4M8 22l-3-3" ${line(p.core, 1.7)}/>`
    + `<path d="M24 20v5M21.5 22.5h5" ${line(p.core, 1.6)}/>`,
  warding_circle: p => `<circle cx="16" cy="16" r="11" ${line(p.edge, 2)}/>`
    + `<path d="M16 7l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9v-6z" ${line(p.core, 1.8)}/>`
    + `<circle cx="16" cy="16" r="2" fill="${p.edge}"/>`,
  enfeebling_mist: p => `<path d="M5 13c5-5 7 3 12-2s8-1 10 1M4 19c4-4 7 3 12-2s8-1 12 2M6 25c5-3 8 2 13-2s6-1 7 0" ${line(p.edge, 2)}/>`
    + `<path d="M15 6v6m-2-2 2 2 2-2" ${line(p.core, 1.7)}/>`,
  binding_field: p => `<circle cx="16" cy="16" r="11" ${line(p.edge, 1.7)}/>`
    + `<path d="M7 10c7 6 11 6 18 0M7 22c7-6 11-6 18 0M10 7c6 7 6 11 0 18M22 7c-6 7-6 11 0 18" ${line(p.core, 1.5)}/>`
    + `<circle cx="16" cy="16" r="2.5" fill="${p.edge}"/>`,
  greater_enchantment: p => `<path d="M5 27L20 9l7-4-3 8-15 15z" fill="${p.edge}"/>`
    + `<path d="M7 25L24 8M17 13l5 5" ${line(p.core, 1.7)}/>`
    + `<path d="M8 6v5M5.5 8.5h5M26 21v6M23 24h6" ${line(p.core, 1.7)}/>`,
  mending_circle: p => `<circle cx="16" cy="16" r="11" ${line(p.edge, 1.8)}/>`
    + `<path d="M13 8h6v5h5v6h-5v5h-6v-5H8v-6h5z" fill="${p.core}"/>`,
  haste: p => `<path d="M5 25l9-19 1 10 11-9-8 19-2-10z" fill="${p.edge}"/>`
    + `<path d="M4 11h5M3 16h6M3 21h4" ${line(p.core, 1.5)}/>`,
  stillness: p => `<path d="M9 5h14M9 27h14M11 6c0 6 5 6 5 10s-5 4-5 10M21 6c0 6-5 6-5 10s5 4 5 10" ${line(p.edge, 2)}/>`
    + `<path d="M13 10l3 3 3-3M13 22l3-3 3 3" ${line(p.core, 1.5)}/>`,
  sanctuary: p => `<circle cx="16" cy="16" r="12" ${line(p.edge, 1.5)}/>`
    + `<path d="M16 4l9 6v10l-9 8-9-8V10z" ${line(p.core, 1.8)}/>`
    + `<path d="M16 9l3 5h5l-4 4 1 5-5-3-5 3 1-5-4-4h5z" fill="${p.edge}"/>`,
};

const TOWN_GLYPHS: Record<TownTeleportId, Glyph> = {
  millfield: p => `<path d="M13 24V12h6v12M8 24h16M16 12V5M16 8l-7-3M16 8l7-3M16 8l-6 6M16 8l6 6" ${line(p.core, 1.7)}/>`,
  oakwood: p => `<path d="M16 24v-7m0 5-5 3m5-3 5 3M16 7c-5-2-8 2-7 5-4 3-1 8 3 7 2 3 6 3 8 0 5 1 7-4 3-7 1-4-3-7-7-5z" ${line(p.core, 1.7)}/>`,
  hillcrest: p => `<path d="M7 24l5-7 4 3 5-8 5 12zM12 17l2-5 3 3M10 24h13" ${line(p.core, 1.7)}/>`,
  ashford: p => `<path d="M9 24h14M12 24v-7h8v7M16 7c0 4 4 5 4 9a4 4 0 0 1-8 0c0-3 2-5 4-9z" ${line(p.core, 1.7)}/>`,
  lantern_rest: p => `<path d="M12 11h8l2 11H10zM14 11V8h4v3M10 24h12M14 14h4v5h-4z" ${line(p.core, 1.8)}/>`
    + `<circle cx="16" cy="17" r="1.5" fill="${p.edge}"/>`,
  crownward: p => `<path d="M8 12l3 5 5-7 5 7 3-5-2 12H10zM10 24h12M13 20h6" ${line(p.core, 1.8)}/>`,
  lastlight: p => `<path d="M16 5v19M9 24h14M12 21h8M12 13l4-7 4 7zM10 17h12" ${line(p.core, 1.7)}/>`
    + `<circle cx="16" cy="6" r="2" fill="${p.edge}"/>`,
  prism_hollow: p => `<path d="M16 5l9 9-9 13-9-13zM16 5v22M7 14h18M7 14l9 7 9-7" ${line(p.core, 1.6)}/>`,
  starhaven: p => `<path d="M16 5l2.7 8.3L27 16l-8.3 2.7L16 27l-2.7-8.3L5 16l8.3-2.7z" ${line(p.core, 1.8)}/>`
    + `<circle cx="16" cy="16" r="3" fill="${p.edge}"/>`,
};

function tile(id: string, glyph: string, p: Palette, size: number): string {
  const gradient = `utility-${id}`;
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false">`
    + `<defs><radialGradient id="${gradient}" cx="50%" cy="42%" r="70%">`
    + `<stop offset="0" stop-color="${p.edge}" stop-opacity=".52"/>`
    + `<stop offset=".6" stop-color="${p.deep}" stop-opacity=".96"/>`
    + `<stop offset="1" stop-color="#07090b"/></radialGradient></defs>`
    + `<rect x=".5" y=".5" width="31" height="31" rx="4" fill="url(#${gradient})" stroke="${p.edge}" stroke-opacity=".55"/>`
    + glyph + `</svg>`;
}

export function utilitySpellIconSvg(id: UtilitySpellId, size = 32): string {
  const p = id === "haste" || id === "stillness" || id === "mending_circle" ? ARC : COSMIC;
  return tile(id, UTILITY_GLYPHS[id](p), p, size);
}

export function townTeleportIconSvg(id: TownTeleportId, size = 32): string {
  const p = TEMPORAL;
  const portal = `<circle cx="16" cy="16" r="12" ${line(p.edge, 1.5)} opacity=".9"/>`
    + `<path d="M6 9l2-2M24 7l2 2M6 23l2 2M24 25l2-2" ${line(p.core, 1.3)}/>`;
  return tile(`town-${id}`, portal + TOWN_GLYPHS[id](p), p, size);
}
