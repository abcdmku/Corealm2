import "./lib/repoContent.js";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp, { type OverlayOptions } from "sharp";
import { GATHERING_PRODUCTION_TIERS } from "../game/src/content/gatheringProductionTiers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runDir = path.resolve(repoRoot, argument("--run") ?? "runs/corealm");
const screenshotDir = path.join(runDir, "screenshots");

const SHEET_WIDTH = 1_200;
const PADDING = 24;
const GAP = 16;
const HEADER_HEIGHT = 64;
const LABEL_HEIGHT = 34;
const TILE_WIDTH = (SHEET_WIDTH - PADDING * 2 - GAP) / 2;
const TILE_HEIGHT = Math.round(TILE_WIDTH * 800 / 1_280);
const ROW_HEIGHT = LABEL_HEIGHT + TILE_HEIGHT;
const SHEET_HEIGHT = HEADER_HEIGHT + PADDING + ROW_HEIGHT * 3 + GAP * 2 + PADDING;

type GatheringSkill = "mining" | "fishing" | "woodcutting";

const SHEETS: readonly { skill: GatheringSkill; title: string }[] = [
  { skill: "mining", title: "Mining: active seams and worked-out rock" },
  { skill: "fishing", title: "Fishing: live schools and recovery ripples" },
  { skill: "woodcutting", title: "Woodcutting: standing trees and dedicated stumps" },
];

for (const sheet of SHEETS) {
  const layers: OverlayOptions[] = [
    {
      input: Buffer.from(svgText(SHEET_WIDTH, HEADER_HEIGHT, sheet.title, 28, "#f3dfad")),
      left: 0,
      top: 0,
    },
  ];

  for (let row = 0; row < GATHERING_PRODUCTION_TIERS.length; row += 1) {
    const tier = GATHERING_PRODUCTION_TIERS[row]!;
    const resource = tier.resourceDefs.find((definition) => {
      if (definition.skill !== sheet.skill) return false;
      return sheet.skill !== "mining" || definition.itemId === tier.items.ore;
    });
    if (!resource) throw new Error(`Tier ${tier.tier} has no primary ${sheet.skill} resource.`);

    for (const [column, state] of ["active", "depleted"].entries()) {
      const source = path.join(screenshotDir, `gathering-${resource.id}-${state}.png`);
      await access(source);
      const left = PADDING + column * (TILE_WIDTH + GAP);
      const top = HEADER_HEIGHT + PADDING + row * (ROW_HEIGHT + GAP);
      const image = await sharp(source)
        .resize(TILE_WIDTH, TILE_HEIGHT, { fit: "cover" })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const label = `Level ${tier.tier}  ·  ${resource.name}  ·  ${capitalise(state)}`;
      layers.push(
        {
          input: Buffer.from(svgText(TILE_WIDTH, LABEL_HEIGHT, label, 18, "#f5f1e4")),
          left,
          top,
        },
        { input: image, left, top: top + LABEL_HEIGHT },
      );
    }
  }

  await mkdir(screenshotDir, { recursive: true });
  const output = path.join(screenshotDir, `gathering-${sheet.skill}-contact-sheet.png`);
  await sharp({
    create: {
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
      channels: 4,
      background: { r: 18, g: 20, b: 17, alpha: 1 },
    },
  }).composite(layers).png({ compressionLevel: 9 }).toFile(output);
  process.stdout.write(`${path.relative(repoRoot, output)}\n`);
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function svgText(width: number, height: number, value: string, size: number, colour: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#292c25"/>
    <text x="18" y="50%" dominant-baseline="middle" fill="${colour}"
      font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="600">${escapeXml(value)}</text>
  </svg>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
