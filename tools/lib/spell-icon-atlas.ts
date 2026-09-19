import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { ALL_SPELLS } from "../../game/src/content/spells.js";
import { spellIconSvg, spellIconAtlasCell, SPELL_ICON_ATLAS_COLUMNS, SPELL_ICON_ATLAS_ROWS } from "../../game/src/ui/spellIcons.js";

/** Raster derivatives of the existing spell artwork, not new item artwork. Three pixels per
 * logical pixel retain the 30/32px glyphs at high DPI without first-use browser path rendering. */
export async function spellIconAtlas(): Promise<Buffer> {
  const size = 96;
  const icons = ALL_SPELLS.map(spell => {
    const subject = { ...spell, rank: spell.rank ?? 0 };
    const { column, row } = spellIconAtlasCell(subject);
    return spellIconSvg(subject, size).replace("<svg ", `<svg x="${column * size}" y="${row * size}" `);
  });
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size * SPELL_ICON_ATLAS_COLUMNS}" height="${size * SPELL_ICON_ATLAS_ROWS}">${icons.join("")}</svg>`))
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

export async function generateSpellIconAtlas(): Promise<void> {
  const file = new URL("../../game/src/generated/spell-icons.png", import.meta.url);
  const bytes = await spellIconAtlas();
  const previous = await readFile(file).catch(() => null);
  if (!previous?.equals(bytes)) await writeFile(file, bytes);
}
