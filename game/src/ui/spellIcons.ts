/**
 * One authored icon per spell: sixteen basics and twenty invocations, on a 32 px grid.
 *
 * The action bar is read at a glance while something is biting the player, so every icon has to
 * be a SILHOUETTE first and a picture second: a dart is a long thin wedge, a tornado a funnel, a
 * whirlpool a spiral, a sun a disc with a corona. Colour is the element's own render palette
 * (`ELEMENT_COLOURS`), the same two tones the bolt is drawn in, so the icon and the effect agree.
 *
 * The four basics share their element's motif across the four rungs and add rung pips underneath
 * (one for Lash, four for Surge) with a slightly larger glyph each step: the sixteen auto-cast rows
 * are four sizes of the same four recipes in the renderer too (`content/basicSpellVariants.ts`).
 *
 * Returned as markup rather than elements for the same reason `itemIconSvg` is: slots are rebuilt
 * wholesale on refresh and one `innerHTML` write per slot is measurably cheaper.
 */
import type { SpellElement, SpellId, SpellRung } from "../contracts.js";
import { SPELL_RUNGS } from "../contracts.js";
import { BASIC_ELEMENTAL_SPELL } from "../content/basicSpellVariants.js";
import type { ElementalSpellId } from "../content/elementalSpells.js";
import { ELEMENT_COLOURS } from "../render/spellVfx.js";

export interface SpellIconSubject {
  id: SpellId;
  element: SpellElement;
  rung: SpellRung;
  /** 0 for a basic, 1 to 5 for an invocation. */
  rank: number;
}

interface Palette { core: string; edge: string; deep: string }

function hex(colour: number): string {
  return `#${(colour >>> 0).toString(16).padStart(6, "0")}`;
}

/** A darker rim tone derived from the edge colour, for the tile background. */
function deepen(colour: number): string {
  const r = Math.round(((colour >> 16) & 0xff) * 0.28);
  const g = Math.round(((colour >> 8) & 0xff) * 0.28);
  const b = Math.round((colour & 0xff) * 0.28);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const PALETTES: Readonly<Record<SpellElement, Palette>> = {
  wind: { core: hex(ELEMENT_COLOURS.wind.core), edge: hex(ELEMENT_COLOURS.wind.edge), deep: deepen(ELEMENT_COLOURS.wind.edge) },
  water: { core: hex(ELEMENT_COLOURS.water.core), edge: hex(ELEMENT_COLOURS.water.edge), deep: deepen(ELEMENT_COLOURS.water.edge) },
  earth: { core: hex(ELEMENT_COLOURS.earth.core), edge: hex(ELEMENT_COLOURS.earth.edge), deep: deepen(ELEMENT_COLOURS.earth.edge) },
  fire: { core: hex(ELEMENT_COLOURS.fire.core), edge: hex(ELEMENT_COLOURS.fire.edge), deep: deepen(ELEMENT_COLOURS.fire.edge) },
};

type Glyph = (p: Palette) => string;

const stroke = (p: Palette, width = 2) =>
  `fill="none" stroke="${p.core}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
const rim = (p: Palette, width = 2.2) =>
  `fill="none" stroke="${p.edge}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;

/**
 * The twenty-four motifs, keyed by the elemental id the renderer uses. Each is drawn inside a
 * 32 x 32 box with about 3 px of breathing room; the tile background is added by `spellIconSvg`.
 */
const GLYPHS: Readonly<Record<ElementalSpellId, Glyph>> = {
  // ------------------------------------------------------------------ wind
  // A puff: two short gusts curling the same way.
  "breeze-puff": (p) =>
    `<path d="M7 14c4-4 9-4 12 0s7 3 7-1" ${rim(p)}/>`
    + `<path d="M8 20c4-3 8-3 11 0s6 2 6-1" ${stroke(p, 1.8)}/>`
    + `<circle cx="24" cy="14" r="1.6" fill="${p.core}"/>`,
  // A needle: one long tapered wedge with a hair-thin wake behind it.
  "air-needle": (p) =>
    `<path d="M5 27 L26 6 L22 13 L11 24 Z" fill="${p.core}"/>`
    + `<path d="M26 6 L18 8" ${stroke(p, 1.4)}/>`
    + `<path d="M4 22c3 0 4-2 7-2M6 27c2-1 3-2 5-3" ${rim(p, 1.3)}/>`,
  // Three banked blades, each a thin crescent, stepping across the tile.
  "razor-crescent": (p) =>
    `<path d="M6 23c2-7 8-11 15-11-5 2-9 6-11 12z" fill="${p.core}"/>`
    + `<path d="M11 27c2-7 8-11 15-11-5 2-9 6-11 12z" fill="${p.edge}"/>`
    + `<path d="M3 19c2-7 8-11 15-11-5 2-9 6-11 12z" fill="${p.edge}" opacity=".65"/>`,
  // A spiral tightening onto an empty eye.
  "vacuum-coil": (p) =>
    `<path d="M27 16a11 11 0 1 0-11 11 8 8 0 1 0-8-8 5 5 0 1 0 5-5 2.4 2.4 0 1 0 2.4 2.4" ${stroke(p, 1.9)}/>`
    + `<circle cx="16" cy="16" r="1.4" fill="${p.edge}"/>`,
  // A corkscrew lance: a straight spine with a coil riding down it.
  "thunder-lance": (p) =>
    `<path d="M5 27 L27 5" ${stroke(p, 2.4)}/>`
    + `<path d="M8 19c3 3 5-3 8 0s5-3 8 0" ${rim(p, 1.6)}/>`
    + `<path d="M27 5l-6 1 5 5z" fill="${p.core}"/>`,
  // A funnel: wide crown, three rings, a point on the ground.
  "skybreaker": (p) =>
    `<ellipse cx="16" cy="7" rx="11" ry="3" ${rim(p, 2)}/>`
    + `<path d="M8 12c3 1.5 13 1.5 16 0M10.5 17c2 1 9 1 11 0M13 22c1 .6 5 .6 6 0" ${stroke(p, 1.8)}/>`
    + `<path d="M16 29l-2.5-5h5z" fill="${p.core}"/>`,

  // ----------------------------------------------------------------- water
  // A bead: one drop with a highlight.
  "water-bead": (p) =>
    `<path d="M16 5c4 6 8 10 8 15a8 8 0 0 1-16 0c0-5 4-9 8-15z" fill="${p.edge}"/>`
    + `<path d="M12.5 20a3.5 3.5 0 0 0 3.5 3.5" ${stroke(p, 1.6)}/>`,
  // Two narrow jets with spray at the far end.
  "waterjet": (p) =>
    `<path d="M4 20 L23 9M4 25 L23 14" ${stroke(p, 2.6)}/>`
    + `<circle cx="26" cy="8" r="1.6" fill="${p.core}"/><circle cx="27.5" cy="13" r="1.3" fill="${p.core}"/>`
    + `<circle cx="24" cy="18" r="1.1" fill="${p.core}"/>`,
  // Five wakes fanning from one point.
  "tidal-fan": (p) =>
    `<path d="M16 28C10 20 6 16 3 14M16 28c-3-9-3-14-2-20M16 28c0-9 0-14 0-22M16 28c3-9 3-14 2-20M16 28c6-8 10-12 13-14" ${stroke(p, 1.9)}/>`
    + `<circle cx="16" cy="28" r="2" fill="${p.edge}"/>`,
  // Three rising columns, stepped, with drops above each.
  "geyser-chain": (p) =>
    `<path d="M7 28V17M16 28V10M25 28V14" ${stroke(p, 3.4)}/>`
    + `<circle cx="7" cy="13" r="1.5" fill="${p.core}"/><circle cx="16" cy="6" r="1.7" fill="${p.core}"/>`
    + `<circle cx="25" cy="10" r="1.5" fill="${p.core}"/><path d="M3 28h26" ${rim(p, 1.4)}/>`,
  // A whirlpool: offset arcs winding into a dark centre.
  "undertow": (p) =>
    `<path d="M28 16a12 12 0 1 1-12-12" ${rim(p, 2.4)}/>`
    + `<path d="M23 16a7 7 0 1 1-7-7" ${stroke(p, 2)}/>`
    + `<path d="M19 16a3 3 0 1 1-3-3" ${stroke(p, 1.6)}/>`
    + `<circle cx="16" cy="16" r="1.2" fill="${p.deep}"/>`,
  // A breaking wave: a tall curling crest over surf.
  "deluge": (p) =>
    `<path d="M4 24c6 0 8-6 8-12 0-4 8-6 14-2-5-1-9 2-9 6 0 6 4 8 9 8" fill="${p.edge}"/>`
    + `<path d="M12 10c2 1 3 3 3 5" ${stroke(p, 1.4)}/>`
    + `<path d="M3 28c3-2 6-2 9 0s6 2 9 0 6-2 9 0" ${stroke(p, 1.8)}/>`,

  // ----------------------------------------------------------------- earth
  // A pebble: one small hexagonal stone.
  "pebble-toss": (p) =>
    `<path d="M16 8l7 4v8l-7 4-7-4v-8z" fill="${p.edge}"/>`
    + `<path d="M12 13l4-2 4 2" ${stroke(p, 1.4)}/>`,
  // A flint head: a sharp knapped triangle with one crack.
  "flint-shot": (p) =>
    `<path d="M16 3l9 20-9 6-9-6z" fill="${p.edge}"/>`
    + `<path d="M16 3v26M12 17l4-3 4 3" ${stroke(p, 1.3)}/>`,
  // A crack running the width of the ground, branching once.
  "faultline": (p) =>
    `<path d="M3 26h26" ${rim(p, 1.6)}/>`
    + `<path d="M4 20l6-3 3 5 5-8 4 4 6-6" ${stroke(p, 2.4)}/>`
    + `<path d="M13 22l2 4M22 18l1 5" ${stroke(p, 1.4)}/>`,
  // Two rows of spikes closing on a centre.
  "basalt-jaw": (p) =>
    `<path d="M4 6l4 8 4-8 4 8 4-8 4 8 4-8" fill="${p.edge}"/>`
    + `<path d="M4 26l4-8 4 8 4-8 4 8 4-8 4 8" fill="${p.edge}"/>`
    + `<circle cx="16" cy="16" r="1.6" fill="${p.core}"/>`,
  // A boulder in flight: a heavy round stone on a high arc.
  "siege-boulder": (p) =>
    `<path d="M3 26c3-10 9-17 17-20" ${rim(p, 1.6)} stroke-dasharray="2 3"/>`
    + `<circle cx="22" cy="20" r="7" fill="${p.edge}"/>`
    + `<path d="M19 17l3 3-2 3M25 16l-1 4" ${stroke(p, 1.3)}/>`,
  // Two peaks and the rubble falling off them.
  "mountainfall": (p) =>
    `<path d="M2 27l8-15 5 8 5-11 10 18z" fill="${p.edge}"/>`
    + `<path d="M10 12l2 4 3-1" ${stroke(p, 1.3)}/>`
    + `<circle cx="7" cy="8" r="1.2" fill="${p.core}"/><circle cx="25" cy="6" r="1.4" fill="${p.core}"/>`
    + `<circle cx="27" cy="12" r="1" fill="${p.core}"/>`,

  // ------------------------------------------------------------------ fire
  // A single flame with a hot tongue inside.
  "kindle": (p) =>
    `<path d="M16 4c1 6 7 8 7 15a7 7 0 0 1-14 0c0-4 2-6 3-9 1 3 3 4 4 3 0-3-1-6 0-9z" fill="${p.edge}"/>`
    + `<path d="M16 15c2 3 3 5 3 7a3 3 0 0 1-6 0c0-2 1-3 3-7z" fill="${p.core}"/>`,
  // A comet: a hot head and a curved ember tail.
  "ember-dart": (p) =>
    `<path d="M4 27c4-1 8-5 12-11" ${rim(p, 2.6)}/>`
    + `<circle cx="20" cy="11" r="5" fill="${p.edge}"/><circle cx="21.5" cy="9.5" r="2" fill="${p.core}"/>`
    + `<circle cx="9" cy="20" r="1.2" fill="${p.core}"/><circle cx="6" cy="16" r="1" fill="${p.core}"/>`,
  // A whip: a handle, a lash curling back, and a flaming tip.
  "furnace-whip": (p) =>
    `<path d="M5 27l5-5" ${stroke(p, 3)}/>`
    + `<path d="M10 22c6-6 4-12 10-14 4-1 7 2 6 5" ${rim(p, 2.2)}/>`
    + `<path d="M26 13c0-3-2-5-4-6 3 0 6 2 6 6-1 2-2 2-2 0z" fill="${p.core}"/>`,
  // A mine: a fused sphere with a burst ring.
  "cinder-mine": (p) =>
    `<circle cx="16" cy="18" r="7" fill="${p.edge}"/>`
    + `<path d="M16 11V7c0-2 2-3 4-2" ${stroke(p, 1.6)}/><circle cx="21" cy="4.5" r="1.4" fill="${p.core}"/>`
    + `<path d="M5 18h3M24 18h3M8 9l2 2M24 9l-2 2M8 27l2-2M24 27l-2-2" ${stroke(p, 1.6)}/>`,
  // Kiln rupture: a split floor with vents burning up through it.
  "phoenix-pass": (p) =>
    `<path d="M3 27h26" ${rim(p, 1.8)}/>`
    + `<path d="M7 27c0-5 2-7 3-10 1 3 3 4 3 7a3 3 0 0 1-6 0zM15 27c0-7 2-9 4-14 1 5 4 7 4 11a4 4 0 0 1-8 0zM24 27c0-4 1-5 2-7 1 2 2 3 2 5a2 2 0 0 1-4 0z" fill="${p.edge}"/>`
    + `<path d="M19 19c1 2 2 3 2 5a2 2 0 0 1-4 0c0-2 1-3 2-5z" fill="${p.core}"/>`,
  // Sunfall: a sun disc, its corona, and the drop toward the ground.
  "starfall": (p) =>
    `<circle cx="16" cy="13" r="6" fill="${p.core}"/>`
    + `<path d="M16 3v3M26 13h-3M6 13h3M23 6l-2 2M9 6l2 2M23 20l-2-2M9 20l2-2" ${rim(p, 2)}/>`
    + `<path d="M16 21v6M13 25l3 3 3-3" ${stroke(p, 1.8)}/>`,
};

const RUNG_INDEX: Readonly<Record<SpellRung, number>> = { lash: 0, bolt: 1, burst: 2, surge: 3 };

/** The motif a spell draws: its own for an invocation, its element's basic for the sixteen. */
export function spellMotifId(subject: Pick<SpellIconSubject, "id" | "element" | "rank">): ElementalSpellId {
  return subject.rank > 0 ? subject.id as ElementalSpellId : BASIC_ELEMENTAL_SPELL[subject.element];
}

/**
 * The tile as inline SVG markup. `size` is the rendered box; the drawing is always 32 units.
 *
 * Basics scale their motif by rung and print rung pips under it; invocations draw their motif at
 * full size and print their rank as a small numeral, so a bar of five fire spells still reads
 * "which one is the finale" without a tooltip.
 */
export function spellIconSvg(subject: SpellIconSubject, size = 32): string {
  const palette = PALETTES[subject.element];
  const motif = GLYPHS[spellMotifId(subject)](palette);
  const rung = RUNG_INDEX[subject.rung] ?? 0;
  const basic = subject.rank === 0;
  const scale = basic ? 0.72 + rung * 0.07 : 1;
  const lift = basic ? -1.5 : 0;
  const gradientId = `sp-${subject.id}`;
  let marks = "";
  if (basic) {
    const count = rung + 1;
    const start = 16 - (count - 1) * 2.4;
    for (let index = 0; index < count; index += 1) {
      marks += `<circle cx="${(start + index * 4.8).toFixed(1)}" cy="29" r="1.25" fill="${palette.core}"/>`;
    }
  } else {
    marks = `<text x="28.5" y="30" font-family="Consolas, ui-monospace, monospace" font-size="8" font-weight="700"`
      + ` text-anchor="end" fill="${palette.core}" opacity=".9">${subject.rank}</text>`;
  }
  return `<svg class="spell-icon" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false">`
    + `<defs><radialGradient id="${gradientId}" cx="50%" cy="42%" r="70%">`
    + `<stop offset="0" stop-color="${palette.edge}" stop-opacity=".55"/>`
    + `<stop offset=".6" stop-color="${palette.deep}" stop-opacity=".95"/>`
    + `<stop offset="1" stop-color="#07090b"/></radialGradient></defs>`
    + `<rect x=".5" y=".5" width="31" height="31" rx="4" fill="url(#${gradientId})" stroke="${palette.edge}" stroke-opacity=".55"/>`
    + `<g transform="translate(16 ${16 + lift}) scale(${scale}) translate(-16 -16)">${motif}</g>`
    + marks
    + `</svg>`;
}

/** Every id that has a motif, for the tests that pin "one icon per spell". */
export const SPELL_MOTIF_IDS: readonly ElementalSpellId[] = Object.keys(GLYPHS) as ElementalSpellId[];

export { SPELL_RUNGS };
