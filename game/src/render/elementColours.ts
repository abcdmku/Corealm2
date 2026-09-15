import type { SpellElement } from "../contracts.js";

/**
 * The two tones each element is drawn in: the bright core of a bolt and its darker edge. Kept
 * apart from the vfx module so icons and UI can use the palette without loading the renderer.
 */
export const ELEMENT_COLOURS: Readonly<Record<SpellElement, { core: number; edge: number }>> = {
  wind: { core: 0xd5f4ff, edge: 0x5d8be5 }, water: { core: 0x80fff0, edge: 0x1676ff },
  earth: { core: 0xe5efae, edge: 0x45d894 }, fire: { core: 0xffe0a0, edge: 0xff5b24 },
};
