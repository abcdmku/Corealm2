import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver, FAST_TEST_SETTINGS } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

/**
 * The two loot pickup voices, on a real kill and a real pickup:
 *
 *   npx tsx tools/loot-audio-test.ts [--headed] [--url http://127.0.0.1:4173]
 *
 * Gold is an ordinary drop in the pile now, so the only thing separating a purse from a pack is
 * the item's category. This drives the production path — kill a creature, open its pile, click a
 * stack in the loot window — and reads the engine's own playback history afterwards, because the
 * catalogue can name a cue the engine never actually reaches.
 */
type HistoryEntry = { kind: string; cue?: string; name?: string; atMs: number };

const args = process.argv.slice(2);
const out = path.resolve(repoRoot, argValue(args, "--out") ?? "test-results/loot-audio");
await mkdir(out, { recursive: true });
const finish = installTestDeadline("Loot pickup audio", 120_000);
const external = argValue(args, "--url");
const server = external ? { url: external, close: async () => {} } : await startGameServer();
const driver = new GameDriver(server, {
  headless: !args.includes("--headed"),
  viewport: { width: 1280, height: 800 },
  // Real decoding needs a real output device: a muted context still reports cues, but nothing loads.
  browserArgs: [...(process.platform === "win32" ? ["--use-angle=d3d11"] : []), "--enable-gpu",
    "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  settings: { ...FAST_TEST_SETTINGS, music: 0, ambient: 0, sfx: 0.9 },
});
const report: Record<string, unknown> = { passed: false };

try {
  await driver.launch();
  const page = driver.page!;
  page.setDefaultTimeout(8000);
  await driver.open(26000, "/index.html?mode=combat");
  await page.locator("#panel-feature-lab .panel__close").click();

  // A starter creature and a real weapon: the kill has to land inside the deadline, and a tier 1
  // pile is the one that carries both gold and an ordinary drop.
  report.target = await page.evaluate(`(async () => {
    const lab = window.__featureLab;
    const preset = lab.getCatalog().targets.creature.find(p => /Granary Rat|Red Worm|Coney/.test(p.label));
    if (!preset) throw new Error("No starter creature preset in the lab catalogue");
    await lab.spawnTarget("creature", preset.id, { distance: 2 });
    lab.setLevel("melee", 99);
    await lab.equipPlayer("mainHand", "kaldite_sword");
    return preset.label;
  })()`);

  const pileId = async (): Promise<string | null> =>
    await page.evaluate(`(async () => ((await window.__gameDebug.listEntities()).find(e => e.archetype === "loot")?.id ?? null))()`) as string | null;
  for (let swing = 0; swing < 24 && !(await pileId()); swing++) {
    await page.evaluate("window.__featureLab.perform('attack')").catch(() => undefined);
    await driver.wait(700);
  }
  const pile = await pileId();
  assert(pile, "The kill left a loot pile");
  report.pile = pile;

  // Opening it is a real interaction, and the window it raises is the one a player clicks.
  await page.evaluate(`window.__gameDebug.callTool("corealm_interact", { entityId: ${JSON.stringify(pile)}, interaction: "loot" })`);
  const slots = page.locator(".loot-reveal__slot");
  await slots.first().waitFor({ state: "visible", timeout: 8000 });
  const labels = await slots.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  report.stacks = labels;
  const goldAt = labels.findIndex((label) => /\bGold\b/.test(label));
  const itemAt = labels.findIndex((label) => !/\bGold\b/.test(label));
  assert(goldAt >= 0, `The pile shows gold, saw ${labels.join(" | ")}`);
  assert(itemAt >= 0, `The pile shows an ordinary item too, saw ${labels.join(" | ")}`);

  const take = async (index: number, label: string): Promise<string[]> => {
    await page.evaluate("window.__gameDebug.clearAudioHistory()");
    await page.locator(".loot-reveal__slot").nth(index).click();
    await page.waitForFunction("window.__gameDebug.getAudioHistory().some(e => e.kind === 'cue')", undefined, { timeout: 8000 });
    await driver.wait(400);
    const history = await driver.callDebug("getAudioHistory", []) as HistoryEntry[];
    const cues = history.filter((entry) => entry.kind === "cue").map((entry) => entry.cue ?? "");
    report[`${label}Cues`] = cues;
    return cues;
  };

  // Gold first; taking it re-renders the window, so the ordinary stack is found again afterwards.
  const coinCues = await take(goldAt, "gold");
  assert(coinCues.includes("interaction.loot_coins"), `Gold rings, heard ${coinCues.join(", ") || "nothing"}`);
  assert(!coinCues.includes("interaction.loot_item"), `Gold does not also knock, heard ${coinCues.join(", ")}`);

  const left = await slots.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  const nextAt = left.findIndex((label) => !/\bGold\b/.test(label));
  assert(nextAt >= 0, `An ordinary stack is still in the pile, saw ${left.join(" | ")}`);
  const itemCues = await take(nextAt, "item");
  assert(itemCues.includes("interaction.loot_item"), `An item knocks, heard ${itemCues.join(", ") || "nothing"}`);
  assert(!itemCues.includes("interaction.loot_coins"), `An item does not ring, heard ${itemCues.join(", ")}`);

  // A catalogue entry pointing at a missing or undecodable file surfaces here, not as silence.
  const state = await driver.callDebug("getAudioState", []) as { diagnostics: unknown[] };
  assert.deepEqual(state.diagnostics, [], `No audio diagnostics, saw ${JSON.stringify(state.diagnostics)}`);

  report.passed = true;
  console.log(`gold -> ${coinCues.join(", ")}`);
  console.log(`item -> ${itemCues.join(", ")}`);
} finally {
  await writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await driver.close();
  await server.close();
  finish();
}
if (!report.passed) process.exitCode = 1;
