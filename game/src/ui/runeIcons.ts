/** Carved rune stones shared by item slots and spell costs. */
const RUNES: Readonly<Record<string, { colour: string; glyph: string }>> = {
  air_essence: { colour: "#c3f3ff", glyph: '<path d="M6 10h9c4 0 3-5 0-4M6 14h11M8 18h5c4 0 3-4 1-4"/>' },
  water_essence: { colour: "#75c5ff", glyph: '<path d="M12 5c-2 4-5 7-5 10a5 5 0 0 0 10 0c0-3-3-6-5-10zM10 15l2 2"/>' },
  earth_essence: { colour: "#a8df94", glyph: '<path d="m6 16 6-10 6 10zM8 19h8M12 10v3"/>' },
  fire_essence: { colour: "#ffad6b", glyph: '<path d="M12 5c0 5 6 6 5 11a5 5 0 0 1-10-1c0-2 1-4 3-5 0 3 2 3 2 1zM12 14v4"/>' },
  mind_rune: { colour: "#8edee9", glyph: '<path d="M8 16V9l4-3 4 3v7M8 12h8M12 6v12"/>' },
  chaos_rune: { colour: "#e9b968", glyph: '<path d="m8 7 8 10M16 7 8 17M7 12h10"/>' },
  death_rune: { colour: "#ddd9f4", glyph: '<path d="m12 6 5 6-5 6-5-6zM12 10v4"/>' },
  blood_rune: { colour: "#ff8999", glyph: '<path d="M12 6c-2 3-5 6-5 9a5 5 0 0 0 10 0c0-3-3-6-5-9zM10 15l2 2"/>' },
  wrath_rune: { colour: "#ffae72", glyph: '<path d="m7 8 2 7h6l2-7-5 4zM9 18h6M12 5v3"/>' },
  cosmic_rune: { colour: "#c6a4ff", glyph: '<circle cx="12" cy="12" r="5"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/>' },
};

export function runeIconSvg(itemId: string, size = 24): string | undefined {
  const rune = RUNES[itemId];
  if (!rune) return undefined;
  return `<svg class="icon rune-icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">`
    + '<path d="m7 2 10 1 4 6-1 10-6 3-9-2-2-9z" fill="#20262e" stroke="#8d929a" stroke-width="1"/>'
    + '<path d="m7 2 1 3 8 1 3 4 2-1-4-6z" fill="#53606d"/>'
    + `<g fill="none" stroke="${rune.colour}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${rune.glyph}</g></svg>`;
}
