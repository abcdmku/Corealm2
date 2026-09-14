import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { repoRoot } from '../lib/paths.js';
import { pathToFileURL } from 'node:url';
import { CONTENT_COLLECTIONS, parseContentCollection } from './collections.js';
import { contentRoot, contentRevision, formatContentJson } from './format.js';
import { compileWorld, type WorldCreature, type WorldRegionBounds } from '../../game/src/content/worldCompiler.js';
import type { EncounterDefinition, WorldPlacement } from '../../game/src/content/schema/encounters.js';
import type { WorldRegionGeometry } from '../../game/src/content/schema/worldRegions.js';
import { createWorldCreatureResolver, worldRegionBounds } from '../../game/src/content/worldCreatureResolver.js';
import { ENCOUNTER_ASSET_RADII } from '../../game/src/content/encounterFootprints.js';
import { tierSilhouetteScale } from '../../game/src/core/math.js';
import { calculateCreatureCombat, compileCreatures } from '../../game/src/content/creatureCompiler.js';
import type { CreatureDefinition, CreatureProfile } from '../../game/src/content/schema/creatureDefinitions.js';
import type { LootTableRecord } from '../../game/src/content/schema/loot.js';
import { compileProgression } from '../../game/src/content/compiler/progression.js';
import { SKILL_IDS, SPELL_ELEMENTS } from '../../game/src/contracts.js';
import type { CompiledDomain, ContentDiagnostic, SourceLocation } from '../../game/src/content/compiler/contracts.js';
import { collectionReferenceIssues, type ReferencePools } from './references.js';
import { withFileLock } from './locks.js';
import { atomicReplaceFile } from '../lib/atomic-replace-file.js';
export type ContentBuild = CompiledDomain<Record<string, unknown>> & {ok: boolean; diagnostics: ContentDiagnostic[]};
export function formulaSourceRevision(): string {
  const directory=path.join(repoRoot,'game/src/content');
  return contentRevision(readdirSync(directory,{recursive:true}).map(String).filter(file=>file.endsWith('.ts')).sort().map(file=>`${file}\n${readFileSync(path.join(directory,file),'utf8')}`).join('\n'));
}
export function compileContent(values: ReadonlyMap<string, unknown>, external: ReferencePools = {}): ContentBuild {
  const diagnostics: ContentDiagnostic[] = [], tables: Record<string, unknown> = {}, sourceMap: Record<string, SourceLocation> = {};
  const revision = contentRevision(formatContentJson(Object.fromEntries([...values].sort(([a],[b]) => a.localeCompare(b)))));
  for (const spec of CONTENT_COLLECTIONS) {
    try { tables[spec.name] = parseContentCollection(spec, values.get(spec.name)); }
    catch (error) { diagnostics.push({path: spec.name, message: error instanceof Error ? error.message : String(error), severity: 'error'}); }
  }
  if (!diagnostics.length) try {
    const output = compileProgression({items: tables.items, recipes: tables.recipes, resources: tables.resources, materials: tables.materials, equipmentFamilies: tables.equipmentFamilies, recipeTemplates: tables.recipeTemplates, progression: tables.progression});
    Object.assign(tables, {items: output.items, recipes: output.recipes, resources: output.resources}); Object.assign(sourceMap, output.sourceMap);
  } catch (error) { diagnostics.push({path:'progression', message: error instanceof Error ? error.message : String(error), severity:'error'}); }
  if (!diagnostics.length) try {
    const output = compileCreatures(tables.creatureDefinitions as CreatureDefinition[], tables.creatureProfiles as CreatureProfile[], tables.lootTables as LootTableRecord[]);
    tables.compiledCreatures = output.creatures; tables.enemies = output.enemies; tables.species = output.species;
    for(const creature of output.creatures) sourceMap[`enemies:${creature.id}`] = {collection:'creatureDefinitions',id:creature.id,formula:'creature.combat',profile:creature.profileId,inputs:{tier:creature.level}};
  } catch(error) {diagnostics.push({path:'creatureDefinitions',message:error instanceof Error?error.message:String(error),severity:'error'});}
  const regionGeometry=(tables.worldRegions??[]) as WorldRegionGeometry[];
  const regionBounds=worldRegionBounds(regionGeometry);
  if(!diagnostics.length)try{
    const creatures=tables.compiledCreatures as ReturnType<typeof compileCreatures>['creatures'];
    const resolveCreature=createWorldCreatureResolver(new Map(creatures.map(row=>[row.id,row])),tables.creatureProfiles as CreatureProfile[]);
    const creatureMap=new Map<string,WorldCreature>();
    for(const encounter of tables.encounters as EncounterDefinition[])for(const member of encounter.members){
      const creature=resolveCreature(member.creatureId);
      if(creature)creatureMap.set(creature.id,creature);
      else {const definition=creatures.find(row=>row.id===member.creatureId);if(definition)throw new Error(`encounters.${encounter.id}: creature ${member.creatureId} ${definition.availability!=='world'?'is available only in the lab':'needs a presentation with an asset and scale on its definition or base'}`);}
    }
    const world=compileWorld({encounters:tables.encounters as EncounterDefinition[],placements:tables.placements as WorldPlacement[],regions:regionBounds,creatures:creatureMap,resolveCreature});
    diagnostics.push(...world.diagnostics);tables.world={regions:regionGeometry,encounters:tables.encounters,placements:tables.placements,resources:tables.resourcePlacements,groupsByRegion:Object.fromEntries(world.groupsByRegion),habitats:world.habitats,creatureByGroup:Object.fromEntries(world.creatureByGroup)};
    for(const row of tables.placements as WorldPlacement[])sourceMap[`placements:${row.id}`]={collection:'placements',id:row.id,inputs:{encounterId:row.encounterId,level:row.level}};
  }catch(error){diagnostics.push({path:'placements',message:error instanceof Error?error.message:String(error),severity:'error'});}
  const ids = (name: string, key = 'id') => new Set((Array.isArray(tables[name]) ? tables[name] as Record<string, unknown>[] : []).map(row => String(row[key])));
  const audio = tables.audio as {cues?: object; loops?: object} | undefined;
  const pools: ReferencePools = {...external, material:ids('materials'), equipmentFamily:ids('equipmentFamilies'), recipeTemplate:ids('recipeTemplates'), creatureProfile:ids('creatureProfiles'), encounter:ids('encounters'), region:new Set(regionBounds.map(row=>row.id)), item: ids('items'), recipe: ids('recipes'), resource: ids('resources'), npc: ids('npcs'), shop: ids('shops'), quest: ids('quests'), dialogue: ids('dialogue'), spell: ids('spells'), rune: ids('spellRunes','itemId'), set: ids('equipmentSets'), campfireFuel: ids('campfireFuels','logItemId'), enemy: ids('creatureDefinitions'), species: ids('creatureDefinitions'), lootTable: ids('lootTables'), skill: new Set(SKILL_IDS), element: new Set(SPELL_ELEMENTS), audio: new Set([...Object.keys(audio?.cues ?? {}), ...Object.keys(audio?.loops ?? {})])};
  if (!diagnostics.length) for (const spec of CONTENT_COLLECTIONS) {
    const rows = spec.shape === 'array' ? tables[spec.name] as unknown[] : [tables[spec.name]];
    rows.forEach((row,index) => diagnostics.push(...collectionReferenceIssues(spec.name,spec.schema,row,pools,`${spec.name}[${index}]`)));
  }
  return {version:1, revision:contentRevision(formatContentJson({sourceRevision:revision,formulaRevision:formulaSourceRevision(),tables})), tables, sourceMap, diagnostics, ok: !diagnostics.some(issue => issue.severity === 'error')};
}
export async function readContentSources(root = contentRoot) {
  return new Map(await Promise.all(CONTENT_COLLECTIONS.map(async spec => [spec.name, JSON.parse(await readFile(path.join(root,spec.file),'utf8'))] as const)));
}
export async function compileAndPublish(root = contentRoot, checkedSourceRevision?: string): Promise<ContentBuild> {
  return withFileLock(path.join(root,'.collection-write'), async () => {
  if(checkedSourceRevision&&formulaSourceRevision()!==checkedSourceRevision)throw new Error('Formula source changed after type checking');
  const build = compileContent(await readContentSources(root));
  if(checkedSourceRevision&&formulaSourceRevision()!==checkedSourceRevision)throw new Error('Formula source changed during compilation');
  if (build.ok) { await mkdir(path.join(root,'compiled'),{recursive:true}); await atomicReplaceFile(path.join(root,'compiled/catalog.json'),formatContentJson(build)); }
  return build;
  });
}
if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  const build = await compileAndPublish(process.argv[2],process.argv[3]); console.log(JSON.stringify({ok:build.ok,revision:build.revision,diagnostics:build.diagnostics})); process.exitCode = build.ok ? 0 : 1;
}
