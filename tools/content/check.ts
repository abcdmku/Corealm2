import { validateEnemyFormulaLinks } from '../../game/src/content/schema/enemyFormulaLinks.js';
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CONTENT_COLLECTIONS, parseContentCollection } from "./collections.js";
import { contentDataRoot, contentPath, formatContentJson } from "./format.js";
import { checkIdentity } from "./identity.js";
import { listMetaCollections, readMeta } from "./meta.js";
import { repoRoot } from "../lib/paths.js";
import { collectionReferenceIssues, type ReferencePools } from "./references.js";
import { derivationDiffs } from "../../game/src/content/balance/derivations.js";
import { creatureCollectionPools, validateCreatureCollections } from '../../game/src/content/schema/creatureLinks.js';

export interface ContentCheckReport { ok: boolean; collections: number; errors: string[]; warnings: string[] }

export async function checkContent(options: { allowIdentityChange?: boolean; crossTables?: boolean } = {}): Promise<ContentCheckReport> {
  const errors: string[] = [], warnings: string[] = [];
  const values = new Map<string, unknown>();
  const tracked = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "game/content/data"], { cwd: repoRoot, encoding: "utf8" }).trim().split(/\r?\n/));
  for (const spec of CONTENT_COLLECTIONS) {
    try {
      const text = await readFile(contentPath(spec.file), "utf8"), raw: unknown = JSON.parse(text);
      const parsed = parseContentCollection(spec, raw);
      values.set(spec.name, parsed);
      if (text.replace(/\r\n/g, "\n") !== formatContentJson(parsed)) errors.push(`${spec.name}: noncanonical JSON; run npm run content:format`);
      const relative = `game/content/${spec.file}`;
      if (tracked.has(relative)) {
        const previous: unknown = JSON.parse(execFileSync("git", ["show", `HEAD:${relative}`], { cwd: repoRoot, encoding: "utf8" }));
        const identityIssues = checkIdentity(previous, raw, spec.name, spec.idKey, spec.ordered, spec.schema);
        (options.allowIdentityChange ? warnings : errors).push(...identityIssues.map(issue => `${issue.path}: ${issue.message}`));
      }
    } catch (error) { errors.push(`${spec.name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const registered = new Set(CONTENT_COLLECTIONS.map(spec => spec.file.slice(5)));
  if (errors.length === 0) errors.push(...validateCreatureCollections(values).map(issue => `${issue.path}: ${issue.message}`));
  if (errors.length === 0) errors.push(...validateEnemyFormulaLinks(values).map(issue => `${issue.path}: ${issue.message}`));
  if (errors.length === 0) {
    try { errors.push(...derivationDiffs(values).map(diff => `${diff.collection}.${diff.recordId}: drifted from ${diff.kind}; recompute or remove derivation to hand-tune`)); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  for (const entry of await readdir(contentDataRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const relative = path.relative(contentDataRoot, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/");
    if (!registered.has(relative)) errors.push(`${relative}: JSON file has no registered schema`);
  }
  for (const name of await listMetaCollections()) {
    try { await readMeta(name); } catch (error) { errors.push(String(error)); }
  }
  if (options.crossTables !== false && errors.length === 0) {
    try {
      const [{ ALL_ITEMS }, { RECIPES }, { REGIONS }, { SKILL_IDS }] = await Promise.all([
        import("../../game/src/content/items.js"), import("../../game/src/content/recipes.js"),
        import("../../game/src/content/regions.js"), import("../../game/src/contracts.js"),
      ]);
      const ids = (name: string, key = "id"): Set<string> => new Set((values.get(name) as Record<string, string>[]).map(row => row[key]!));
      const audio = values.get("audio") as { cues: object; loops: object };
      const pools: ReferencePools = {
        item: new Set(ALL_ITEMS.map(row => row.id)), recipe: new Set(RECIPES.map(row => row.id)),
        resource: ids("resources"), set: ids("equipmentSets"), campfireFuel: ids("campfireFuels", "logItemId"),
        // Gravelmaw is an underground map and has no authored surface RegionDef.
        region: new Set([...REGIONS.map(row => row.id), "gravelmaw"]), skill: new Set(SKILL_IDS),
        npc: ids("npcs"), shop: ids("shops"), quest: ids("quests"), dialogue: ids("dialogue"),
        spell: ids("spells"), rune: ids("spellRunes", "itemId"),
        audio: new Set([...Object.keys(audio.cues), ...Object.keys(audio.loops)]),
      };
      const { validateGameContent } = await import("../validate-game-content.js");
      await validateGameContent(worldPools => Object.assign(pools, worldPools));
      Object.assign(pools, creatureCollectionPools(values));
      // Audio schemas reference actual public files rather than manifest model IDs.
      const publicRoot = path.join(repoRoot, "game/public");
      const audioFiles = await readdir(path.join(publicRoot, "audio"), { recursive: true, withFileTypes: true });
      pools.asset = new Set([...pools.asset ?? [], ...audioFiles.filter(entry => entry.isFile()).map(entry => path.relative(publicRoot, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))]);
      for (const spec of CONTENT_COLLECTIONS) {
        const raw = values.get(spec.name);
        const rows = spec.shape === 'array' ? raw as unknown[] : [raw];
        rows.forEach((row, index) => collectionReferenceIssues(spec.name, spec.schema, row, pools,
          spec.shape === 'array' ? `${spec.name}[${index}]` : spec.name).forEach(issue =>
          (issue.severity === 'error' ? errors : warnings).push(`${issue.path}: ${issue.message}`)));
      }
      const { validateDialogue } = await import("../../game/src/content/dialogue.js");
      errors.push(...validateDialogue());
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  return { ok: errors.length === 0, collections: CONTENT_COLLECTIONS.length, errors, warnings };
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const report = await checkContent({ allowIdentityChange: process.argv.includes("--allow-identity-change") });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
