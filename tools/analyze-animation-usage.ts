/**
 * Statically accounts for every animation clip the runtime can request.
 *
 * The shared humanoid libraries and asset-owned creature clips have different namespaces at
 * runtime. Keep them separate here too. `availableClips`, `references`, `missingClips`, and
 * `unusedClips` describe the shared libraries. `assetClipUsage` describes clips selected through
 * `AssetRegistry.clipOf(assetId, name)`.
 *
 * Usage:
 *   npx tsx tools/analyze-animation-usage.ts
 *   npx tsx tools/analyze-animation-usage.ts --out runs/corealm/animation-usage.json
 *   npx tsx tools/analyze-animation-usage.ts --repo-root <path> --fail-on-missing
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { repoRoot as defaultRepoRoot } from "./lib/paths.js";

export interface AnimationUsageLibrary {
  assetId: string;
  file: string;
  bytes: number;
  clips: string[];
}

export interface AnimationUsageReference {
  clip: string;
  sources: string[];
  kind: "direct" | "mirrored";
  sourceClip?: string;
  contexts: string[];
}

export interface UnresolvedAnimationReference {
  source: string;
  expression: string;
}

export interface AnimationManifestGlbMismatch {
  assetId: string;
  manifestBytes: number;
  glbBytes: number;
  manifestOnlyClips: string[];
  glbOnlyClips: string[];
}

export interface AnimationMirrorRule {
  sourceClip: string;
  clip: string;
  suffix: string;
  source: string;
  generated: boolean;
  referenced: boolean;
}

export interface AssetClipMotionUsage {
  motion: string;
  clips: string[];
  sources: string[];
}

export interface AssetClipUsage {
  assetId: string;
  category: string;
  file: string;
  routedToMotionSelector: boolean;
  availableClips: string[];
  referencedClips: string[];
  unusedClips: string[];
  motions: AssetClipMotionUsage[];
}

export interface AnimationUsageReport {
  schemaVersion: 1;
  libraries: AnimationUsageLibrary[];
  references: AnimationUsageReference[];
  availableClips: string[];
  missingClips: string[];
  unusedClips: string[];
  unresolvedDynamicReferences: UnresolvedAnimationReference[];
  mirrors: AnimationMirrorRule[];
  assetClipUsage: AssetClipUsage[];
  manifestGlbMismatches: AnimationManifestGlbMismatch[];
  scanCoverage: {
    sourceRoot: string;
    sourceFiles: number;
    domains: Record<string, string[]>;
  };
  summary: {
    physicalLibraryClips: number;
    generatedClips: number;
    availableClips: number;
    referencedClips: number;
    missingClips: number;
    unusedClips: number;
    unresolvedDynamicReferences: number;
  };
}

interface ManifestAsset {
  id: string;
  file: string;
  category: string;
  bytes: number;
  animations: string[];
}

interface AssetManifest {
  assets: ManifestAsset[];
}

interface ParsedSource {
  absolute: string;
  relative: string;
  text: string;
  code: string;
}

interface NamedDeclaration {
  source: ParsedSource;
  name: string;
  initializer: string;
  offset: number;
}

interface ReferenceDraft {
  clip: string;
  sources: Set<string>;
  contexts: Set<string>;
}

interface StringEntry {
  value: string;
  source: string;
}

interface ObjectStringEntry {
  key: string;
  values: StringEntry[];
  source: string;
}

interface RegexEntry {
  expression: RegExp;
  source: string;
}

interface AssetClipLookup {
  /** Null means a runtime-selected asset; this is a lookup, not a requirement on every rig. */
  assetId: string | null;
  clip: string;
  source: string;
}

interface TextPart {
  text: string;
  start: number;
}

const COVERAGE_DOMAINS: Record<string, string[]> = {
  playerActions: [
    "game/src/render/characterRig.ts",
    "game/src/app/loop.ts",
    "game/src/systems/combat.ts",
  ],
  enemies: [
    "game/src/render/entityViews.ts",
    "game/src/content/enemies.ts",
    "game/src/systems/enemyAI.ts",
  ],
  quests: [
    "game/src/content/quests.ts",
    "game/src/systems/quests.ts",
  ],
  activities: [
    "game/src/systems/activity.ts",
    "game/src/systems/agility.ts",
    "game/src/systems/campfire.ts",
    "game/src/systems/eating.ts",
    "game/src/systems/gathering.ts",
    "game/src/systems/production.ts",
  ],
  renderAnimationTables: [
    "game/src/render/assets.ts",
    "game/src/render/characterRig.ts",
    "game/src/render/entityViews.ts",
  ],
};

/**
 * Builds the stable schema consumed by the animation budget test and asset build pipeline.
 *
 * `repoRoot` defaults to the repository containing this tool. Passing it makes the analyzer usable
 * against a fixture without changing process state or relying on the current working directory.
 */
export async function analyzeAnimationUsage(repoRoot = defaultRepoRoot): Promise<AnimationUsageReport> {
  const root = path.resolve(repoRoot);
  const sourceRoot = path.join(root, "game", "src");
  const manifestFile = path.join(root, "game", "public", "assets", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as AssetManifest;
  const sources = await parseSources(root, sourceRoot);
  const declarations = indexDeclarations(sources);
  const unresolved: UnresolvedAnimationReference[] = [];

  const poseClips = readStringObject(declarations, "POSE_CLIPS", unresolved);
  const humanoidIdles = readStringArray(declarations, "HUMANOID_IDLES", unresolved);
  const humanoidClips = readStringObject(
    declarations,
    "HUMANOID_CLIPS",
    unresolved,
    new Map([["HUMANOID_IDLES", humanoidIdles]]),
  );
  const mirroredClips = readStringArray(declarations, "MIRRORED_CLIPS", unresolved);
  const mirrorSuffix = readStringConstant(declarations, "MIRROR_SUFFIX", unresolved);
  const ownClipPatterns = readRegexObject(declarations, "OWN_CLIP_PATTERNS", unresolved);

  const references = new Map<string, ReferenceDraft>();
  const addReference = (clip: string, source: string, context: string): void => {
    const draft = references.get(clip) ?? { clip, sources: new Set<string>(), contexts: new Set<string>() };
    draft.sources.add(source);
    draft.contexts.add(context);
    references.set(clip, draft);
  };

  for (const entry of poseClips) {
    for (const value of entry.values) addReference(value.value, value.source, `player.pose.${entry.key}`);
  }
  for (const entry of humanoidClips) {
    for (const value of entry.values) addReference(value.value, value.source, `entity.motion.${entry.key}`);
  }

  const dynamicCallSources = scanClipCalls(sources, addReference, unresolved);
  for (const entry of poseClips) {
    for (const value of entry.values) {
      for (const callSource of dynamicCallSources.sharedPlayer) {
        addReference(value.value, callSource, `player.pose.${entry.key}`);
      }
    }
  }
  for (const entry of humanoidClips) {
    for (const value of entry.values) {
      for (const callSource of dynamicCallSources.sharedEntities) {
        addReference(value.value, callSource, `entity.motion.${entry.key}`);
      }
    }
  }

  const animationAssets = manifest.assets
    .filter((asset) => asset.category === "animation")
    .sort((a, b) => a.id.localeCompare(b.id));
  const libraries: AnimationUsageLibrary[] = [];
  const mismatches: AnimationManifestGlbMismatch[] = [];

  for (const asset of animationAssets) {
    const absolute = path.join(root, "game", "public", "assets", asset.file);
    const parsed = await readGlbAnimations(absolute);
    const manifestClips = sortedUnique(asset.animations);
    const glbClips = sortedUnique(parsed.clips);
    const manifestOnlyClips = manifestClips.filter((clip) => !glbClips.includes(clip));
    const glbOnlyClips = glbClips.filter((clip) => !manifestClips.includes(clip));
    if (asset.bytes !== parsed.bytes || manifestOnlyClips.length > 0 || glbOnlyClips.length > 0) {
      mismatches.push({
        assetId: asset.id,
        manifestBytes: asset.bytes,
        glbBytes: parsed.bytes,
        manifestOnlyClips,
        glbOnlyClips,
      });
    }
    libraries.push({ assetId: asset.id, file: normalizePath(asset.file), bytes: parsed.bytes, clips: parsed.clips });
  }

  const physicalClips = sortedUnique(libraries.flatMap((library) => library.clips));
  const mirrorDeclaration = declarations.get("MIRRORED_CLIPS");
  const mirrorSource = mirrorDeclaration
    ? sourceLocation(mirrorDeclaration.source, mirrorDeclaration.offset, "MIRRORED_CLIPS")
    : "game/src/render/assets.ts:?:? MIRRORED_CLIPS";
  const mirrors: AnimationMirrorRule[] = mirroredClips.map((entry) => {
    const clip = `${entry.value}${mirrorSuffix.value}`;
    return {
      sourceClip: entry.value,
      clip,
      suffix: mirrorSuffix.value,
      source: entry.source || mirrorSource,
      generated: physicalClips.includes(entry.value),
      referenced: references.has(clip),
    };
  }).sort((a, b) => a.clip.localeCompare(b.clip));

  const generatedClips = mirrors.filter((rule) => rule.generated).map((rule) => rule.clip);
  const availableClips = sortedUnique([...physicalClips, ...generatedClips]);
  const referenceRows: AnimationUsageReference[] = [...references.values()].map((reference): AnimationUsageReference => {
    const mirror = mirrors.find((rule) => rule.clip === reference.clip);
    if (mirror) {
      return {
        clip: reference.clip,
        sources: sortedUnique([...reference.sources, mirror.source]),
        kind: "mirrored",
        sourceClip: mirror.sourceClip,
        contexts: [...reference.contexts].sort(),
      };
    }
    return {
      clip: reference.clip,
      sources: [...reference.sources].sort(),
      kind: "direct",
      contexts: [...reference.contexts].sort(),
    };
  }).sort((a, b) => a.clip.localeCompare(b.clip));

  const referencedNames = new Set(referenceRows.map((reference) => reference.clip));
  const missingClips = sortedUnique(referenceRows
    .filter((reference) => !availableClips.includes(reference.clip))
    .map((reference) => reference.clip));
  const unusedClips = availableClips.filter((clip) => !referencedNames.has(clip));
  const assetClipUsage = buildAssetClipUsage(manifest.assets, ownClipPatterns, dynamicCallSources.assetLookups);
  const unresolvedRows = uniqueUnresolved(unresolved);

  return {
    schemaVersion: 1,
    libraries,
    references: referenceRows,
    availableClips,
    missingClips,
    unusedClips,
    unresolvedDynamicReferences: unresolvedRows,
    mirrors,
    assetClipUsage,
    manifestGlbMismatches: mismatches.sort((a, b) => a.assetId.localeCompare(b.assetId)),
    scanCoverage: {
      sourceRoot: normalizePath(path.relative(root, sourceRoot)),
      sourceFiles: sources.length,
      domains: Object.fromEntries(Object.entries(COVERAGE_DOMAINS).map(([domain, files]) => [domain, [...files]])),
    },
    summary: {
      physicalLibraryClips: physicalClips.length,
      generatedClips: generatedClips.length,
      availableClips: availableClips.length,
      referencedClips: referenceRows.length,
      missingClips: missingClips.length,
      unusedClips: unusedClips.length,
      unresolvedDynamicReferences: unresolvedRows.length,
    },
  };
}

async function parseSources(root: string, sourceRoot: string): Promise<ParsedSource[]> {
  const files = await listTypeScriptFiles(sourceRoot);
  const parsed: ParsedSource[] = [];
  for (const absolute of files) {
    const text = await readFile(absolute, "utf8");
    parsed.push({
      absolute,
      relative: normalizePath(path.relative(root, absolute)),
      text,
      code: maskNonCode(text),
    });
  }
  return parsed.sort((a, b) => a.relative.localeCompare(b.relative));
}

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await listTypeScriptFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".ts")) found.push(absolute);
  }
  return found;
}

function indexDeclarations(sources: readonly ParsedSource[]): Map<string, NamedDeclaration> {
  const declarations = new Map<string, NamedDeclaration>();
  for (const name of ["POSE_CLIPS", "HUMANOID_IDLES", "HUMANOID_CLIPS", "MIRRORED_CLIPS", "MIRROR_SUFFIX", "OWN_CLIP_PATTERNS"]) {
    const pattern = new RegExp(`\\b(?:export\\s+)?const\\s+${name}\\b`);
    for (const source of sources) {
      const match = pattern.exec(source.code);
      if (!match) continue;
      const nameAt = source.code.indexOf(name, match.index);
      const equals = source.code.indexOf("=", nameAt + name.length);
      if (equals < 0) continue;
      let start = equals + 1;
      while (/\s/.test(source.text[start] ?? "")) start += 1;
      const end = expressionEnd(source.text, start);
      declarations.set(name, {
        source,
        name,
        initializer: source.text.slice(start, end),
        offset: start,
      });
      break;
    }
  }
  return declarations;
}

function readStringArray(
  declarations: ReadonlyMap<string, NamedDeclaration>,
  name: string,
  unresolved: UnresolvedAnimationReference[],
): StringEntry[] {
  const found = declarations.get(name);
  if (!found) {
    unresolved.push({ source: declarationFallback(name), expression: `missing declaration ${name}` });
    return [];
  }
  const expression = unwrapTextExpression(found.initializer);
  if (!expression.text.startsWith("[") || !expression.text.endsWith("]")) {
    unresolved.push({
      source: sourceLocation(found.source, found.offset, name),
      expression: expression.text,
    });
    return [];
  }
  return readLiteralArray(found.source, expression, found.offset, name, unresolved);
}

function readStringObject(
  declarations: ReadonlyMap<string, NamedDeclaration>,
  name: string,
  unresolved: UnresolvedAnimationReference[],
  aliases = new Map<string, StringEntry[]>(),
): ObjectStringEntry[] {
  const found = declarations.get(name);
  if (!found) {
    unresolved.push({ source: declarationFallback(name), expression: `missing declaration ${name}` });
    return [];
  }
  const expression = unwrapTextExpression(found.initializer);
  if (!expression.text.startsWith("{") || !expression.text.endsWith("}")) {
    unresolved.push({
      source: sourceLocation(found.source, found.offset, name),
      expression: expression.text,
    });
    return [];
  }

  const entries: ObjectStringEntry[] = [];
  for (const property of splitTopLevel(expression.text.slice(1, -1), ",")) {
    const trimmed = trimTriviaPart(property);
    if (!trimmed.text) continue;
    const colon = topLevelIndexOf(trimmed.text, ":");
    if (colon < 0) continue;
    const key = decodePropertyName(trimmed.text.slice(0, colon).trim());
    if (!key) continue;
    const rawValue = trimPart({ text: trimmed.text.slice(colon + 1), start: trimmed.start + colon + 1 });
    const value = unwrapTextExpression(rawValue.text);
    const valueOffset = found.offset + 1 + rawValue.start + value.start;
    let values: StringEntry[];
    if (value.text.startsWith("[") && value.text.endsWith("]")) {
      values = readLiteralArray(found.source, value, valueOffset, `${name}.${key}`, unresolved);
    } else if (/^[A-Za-z_$][\w$]*$/.test(value.text) && aliases.has(value.text)) {
      values = aliases.get(value.text)!.map((entry) => ({ ...entry }));
    } else {
      unresolved.push({
        source: sourceLocation(found.source, valueOffset, `${name}.${key}`),
        expression: value.text,
      });
      values = [];
    }
    entries.push({
      key,
      values,
      source: sourceLocation(found.source, found.offset + 1 + trimmed.start, `${name}.${key}`),
    });
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

function readLiteralArray(
  source: ParsedSource,
  expression: TextPart,
  expressionOffset: number,
  symbol: string,
  unresolved: UnresolvedAnimationReference[],
): StringEntry[] {
  const values: StringEntry[] = [];
  for (const element of splitTopLevel(expression.text.slice(1, -1), ",")) {
    const value = trimTriviaPart(element);
    if (!value.text) continue;
    const decoded = decodeStringLiteral(value.text);
    const offset = expressionOffset + 1 + value.start;
    if (decoded !== null) {
      values.push({ value: decoded, source: sourceLocation(source, offset, symbol) });
    } else {
      unresolved.push({
        source: sourceLocation(source, offset, symbol),
        expression: value.text,
      });
    }
  }
  return values;
}

function readStringConstant(
  declarations: ReadonlyMap<string, NamedDeclaration>,
  name: string,
  unresolved: UnresolvedAnimationReference[],
): StringEntry {
  const found = declarations.get(name);
  const initializer = found ? unwrapTextExpression(found.initializer) : null;
  const decoded = initializer ? decodeStringLiteral(initializer.text) : null;
  if (found && initializer && decoded !== null) {
    return { value: decoded, source: sourceLocation(found.source, found.offset + initializer.start, name) };
  }
  unresolved.push({
    source: found ? sourceLocation(found.source, found.offset, name) : declarationFallback(name),
    expression: initializer?.text ?? `missing declaration ${name}`,
  });
  return { value: "_Mirror", source: declarationFallback(name) };
}

function readRegexObject(
  declarations: ReadonlyMap<string, NamedDeclaration>,
  name: string,
  unresolved: UnresolvedAnimationReference[],
): Map<string, RegexEntry[]> {
  const found = declarations.get(name);
  const initializer = found ? unwrapTextExpression(found.initializer) : null;
  if (!found || !initializer || !initializer.text.startsWith("{") || !initializer.text.endsWith("}")) {
    unresolved.push({
      source: found ? sourceLocation(found.source, found.offset, name) : declarationFallback(name),
      expression: initializer?.text ?? `missing declaration ${name}`,
    });
    return new Map();
  }

  const patterns = new Map<string, RegexEntry[]>();
  for (const property of splitTopLevel(initializer.text.slice(1, -1), ",")) {
    const trimmed = trimTriviaPart(property);
    if (!trimmed.text) continue;
    const colon = topLevelIndexOf(trimmed.text, ":");
    if (colon < 0) continue;
    const key = decodePropertyName(trimmed.text.slice(0, colon).trim());
    const rawValue = trimPart({ text: trimmed.text.slice(colon + 1), start: trimmed.start + colon + 1 });
    const value = unwrapTextExpression(rawValue.text);
    const valueOffset = found.offset + 1 + rawValue.start + value.start;
    if (!key || !value.text.startsWith("[") || !value.text.endsWith("]")) continue;
    const entries: RegexEntry[] = [];
    for (const element of splitTopLevel(value.text.slice(1, -1), ",")) {
      const item = trimTriviaPart(element);
      if (!item.text) continue;
      const offset = valueOffset + 1 + item.start;
      if (!item.text.startsWith("/")) {
        unresolved.push({
          source: sourceLocation(found.source, offset, `${name}.${key}`),
          expression: item.text,
        });
        continue;
      }
      const text = item.text;
      const lastSlash = text.lastIndexOf("/");
      try {
        entries.push({
          expression: new RegExp(text.slice(1, lastSlash), text.slice(lastSlash + 1)),
          source: sourceLocation(found.source, offset, `${name}.${key}`),
        });
      } catch {
        unresolved.push({ source: sourceLocation(found.source, offset, `${name}.${key}`), expression: text });
      }
    }
    patterns.set(key, entries);
  }
  return patterns;
}

function scanClipCalls(
  sources: readonly ParsedSource[],
  addReference: (clip: string, source: string, context: string) => void,
  unresolved: UnresolvedAnimationReference[],
): { sharedPlayer: string[]; sharedEntities: string[]; assetLookups: AssetClipLookup[] } {
  const sharedPlayer = new Set<string>();
  const sharedEntities = new Set<string>();
  const assetLookups: AssetClipLookup[] = [];
  for (const source of sources) {
    const callPattern = /\.(clipOf|clip)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = callPattern.exec(source.code))) {
      const method = match[1]!;
      const open = source.code.indexOf("(", match.index);
      const close = findMatching(source.text, open);
      if (open < 0 || close < 0) continue;
      const args = splitTopLevel(source.text.slice(open + 1, close), ",");
      const clipArgument = args[method === "clipOf" ? 1 : 0];
      if (!clipArgument) continue;
      const argument = unwrapTextExpression(trimTriviaPart(clipArgument).text);
      if (!argument.text) continue;
      const location = sourceLocation(source, match.index, `${method}()`);
      const decoded = decodeStringLiteral(argument.text);
      if (decoded !== null) {
        if (method === "clipOf") {
          // An optional clipOf(assetId, "Attack") probe must never require a humanoid Attack
          // clip. Record it only against matching asset-owned namespaces below.
          const assetArgument = unwrapTextExpression(trimTriviaPart(args[0]!).text);
          assetLookups.push({ assetId: decodeStringLiteral(assetArgument.text), clip: decoded, source: location });
        } else {
          addReference(decoded, location, "shared.direct");
        }
        continue;
      }

      if (source.relative === "game/src/render/characterRig.ts" && method === "clip") {
        sharedPlayer.add(location);
        continue;
      }
      if (source.relative === "game/src/render/entityViews.ts") {
        if (method === "clip") sharedEntities.add(location);
        // clipOf is resolved against OWN_CLIP_PATTERNS and the manifest in buildAssetClipUsage.
        continue;
      }
      unresolved.push({ source: location, expression: argument.text });
    }
  }
  return { sharedPlayer: [...sharedPlayer].sort(), sharedEntities: [...sharedEntities].sort(), assetLookups };
}

function buildAssetClipUsage(
  assets: readonly ManifestAsset[],
  patterns: ReadonlyMap<string, RegexEntry[]>,
  lookups: readonly AssetClipLookup[],
): AssetClipUsage[] {
  return assets
    .filter((asset) => asset.category !== "animation" && asset.animations.length > 0)
    .map((asset) => {
      // Characters with native clips use EntityViews' selector, including animals and bosses.
      // Outfit part clips and prop transform clips do not use the character motion selector.
      const routed = asset.category === "character";
      const motions: AssetClipMotionUsage[] = [];
      if (routed) {
        for (const [motion, motionPatterns] of [...patterns].sort(([a], [b]) => a.localeCompare(b))) {
          const picked: string[] = [];
          for (const pattern of motionPatterns) {
            for (const clip of asset.animations) {
              pattern.expression.lastIndex = 0;
              if (pattern.expression.test(clip) && !picked.includes(clip)) picked.push(clip);
            }
          }
          // This mirrors EntityViews.clipCandidates exactly. Idle keeps a catch-all tail so a new
          // creature pack cannot freeze in bind pose merely because its idle has an unfamiliar name.
          if (motion === "idle") {
            for (const clip of asset.animations) if (!picked.includes(clip)) picked.push(clip);
          }
          motions.push({
            motion,
            clips: picked,
            sources: sortedUnique(motionPatterns.map((pattern) => pattern.source)),
          });
        }
      }
      const direct = lookups.filter((lookup) => (lookup.assetId === null || lookup.assetId === asset.id)
        && asset.animations.includes(lookup.clip));
      if (direct.length > 0) motions.push({
        motion: "lookup",
        clips: sortedUnique(direct.map((lookup) => lookup.clip)),
        sources: sortedUnique(direct.map((lookup) => lookup.source)),
      });
      const referencedClips = sortedUnique(motions.flatMap((motion) => motion.clips));
      const availableClips = sortedUnique(asset.animations);
      return {
        assetId: asset.id,
        category: asset.category,
        file: normalizePath(asset.file),
        routedToMotionSelector: routed,
        availableClips,
        referencedClips,
        unusedClips: availableClips.filter((clip) => !referencedClips.includes(clip)),
        motions,
      };
    })
    .sort((a, b) => a.assetId.localeCompare(b.assetId));
}

async function readGlbAnimations(file: string): Promise<{ bytes: number; clips: string[] }> {
  const bytes = await readFile(file);
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF") {
    throw new Error(`Not a GLB file: ${file}`);
  }
  const declaredLength = bytes.readUInt32LE(8);
  if (declaredLength !== bytes.length) {
    throw new Error(`GLB length mismatch for ${file}: header ${declaredLength}, file ${bytes.length}`);
  }

  let offset = 12;
  let json: { animations?: Array<{ name?: unknown }> } | undefined;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) throw new Error(`GLB chunk extends past ${file}`);
    if (type === "JSON") {
      json = JSON.parse(bytes.toString("utf8", start, end).trim()) as { animations?: Array<{ name?: unknown }> };
    }
    offset = end;
  }
  if (!json) throw new Error(`GLB has no JSON chunk: ${file}`);
  const clips = (json.animations ?? []).map((animation, index) => {
    if (typeof animation.name !== "string" || animation.name.length === 0) {
      throw new Error(`Animation ${index} in ${file} has no stable name`);
    }
    return animation.name;
  });
  return { bytes: bytes.length, clips };
}

function expressionEnd(text: string, start: number): number {
  const first = text[start];
  if (first === "[" || first === "{" || first === "(") {
    const close = findMatching(text, start);
    return close >= 0 ? close + 1 : text.length;
  }
  if (first === "\"" || first === "'" || first === "`") return skipQuoted(text, start);
  let end = start;
  while (end < text.length && text[end] !== ";" && text[end] !== "\n" && text[end] !== "\r") end += 1;
  return end;
}

/** Masks comments and literals while preserving offsets and line breaks for structural searches. */
function maskNonCode(text: string): string {
  const output = [...text];
  const blank = (start: number, end: number): void => {
    for (let index = start; index < end; index += 1) {
      if (output[index] !== "\n" && output[index] !== "\r") output[index] = " ";
    }
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "/" && next === "/") {
      let end = index + 2;
      while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end += 1;
      blank(index, end);
      index = end;
      continue;
    }
    if (char === "/" && next === "*") {
      let end = index + 2;
      while (end + 1 < text.length && !(text[end] === "*" && text[end + 1] === "/")) end += 1;
      end = Math.min(text.length, end + 2);
      blank(index, end);
      index = end;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      const end = skipQuoted(text, index);
      blank(index, end);
      index = end;
      continue;
    }
    index += 1;
  }
  return output.join("");
}

function findMatching(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const first = text[open];
  if (!first || !pairs[first]) return -1;
  const stack: string[] = [pairs[first]];
  let index = open + 1;
  while (index < text.length) {
    const char = text[index]!;
    const next = text[index + 1];
    if (char === "\"" || char === "'" || char === "`") {
      index = skipQuoted(text, index);
      continue;
    }
    if (char === "/" && next === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index + 1 < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index = Math.min(text.length, index + 2);
      continue;
    }
    if (char === "/" && isRegexStart(text, index)) {
      index = skipRegex(text, index);
      continue;
    }
    const close = pairs[char];
    if (close) {
      stack.push(close);
      index += 1;
      continue;
    }
    if (char === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return index;
    }
    index += 1;
  }
  return -1;
}

function skipQuoted(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === quote) return index + 1;
    index += 1;
  }
  return text.length;
}

function isRegexStart(text: string, slash: number): boolean {
  let previous = slash - 1;
  while (previous >= 0 && /\s/.test(text[previous]!)) previous -= 1;
  return previous < 0 || /[=(:,!&|?\[{;]/.test(text[previous]!);
}

function skipRegex(text: string, start: number): number {
  let index = start + 1;
  let characterClass = false;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === "[") characterClass = true;
    else if (text[index] === "]") characterClass = false;
    else if (text[index] === "/" && !characterClass) {
      index += 1;
      while (/[a-z]/i.test(text[index] ?? "")) index += 1;
      return index;
    }
    index += 1;
  }
  return text.length;
}

function splitTopLevel(text: string, delimiter: string): TextPart[] {
  const parts: TextPart[] = [];
  const stack: string[] = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    const next = text[index + 1];
    if (char === "\"" || char === "'" || char === "`") {
      index = skipQuoted(text, index);
      continue;
    }
    if (char === "/" && next === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index + 1 < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index = Math.min(text.length, index + 2);
      continue;
    }
    if (char === "/" && isRegexStart(text, index)) {
      index = skipRegex(text, index);
      continue;
    }
    const close = pairs[char];
    if (close) stack.push(close);
    else if (char === stack[stack.length - 1]) stack.pop();
    else if (char === delimiter && stack.length === 0) {
      parts.push({ text: text.slice(start, index), start });
      start = index + 1;
    }
    index += 1;
  }
  parts.push({ text: text.slice(start), start });
  return parts;
}

function topLevelIndexOf(text: string, needle: string): number {
  const parts = splitTopLevel(text, needle);
  return parts.length > 1 ? parts[0]!.text.length : -1;
}

function trimPart(part: TextPart): TextPart {
  const leading = part.text.length - part.text.trimStart().length;
  return { text: part.text.trim(), start: part.start + leading };
}

function trimTriviaPart(part: TextPart): TextPart {
  let text = part.text;
  let skipped = 0;
  while (true) {
    const whitespace = text.length - text.trimStart().length;
    text = text.slice(whitespace);
    skipped += whitespace;
    if (text.startsWith("//")) {
      const newline = text.search(/[\r\n]/);
      if (newline < 0) return { text: "", start: part.start + part.text.length };
      skipped += newline + 1;
      text = text.slice(newline + 1);
      continue;
    }
    if (text.startsWith("/*")) {
      const close = text.indexOf("*/", 2);
      if (close < 0) return { text: "", start: part.start + part.text.length };
      skipped += close + 2;
      text = text.slice(close + 2);
      continue;
    }
    break;
  }
  return { text: text.trimEnd(), start: part.start + skipped };
}

function unwrapTextExpression(value: string): TextPart {
  let part = trimPart({ text: value, start: 0 });
  while (part.text.startsWith("(") && findMatching(part.text, 0) === part.text.length - 1) {
    part = trimPart({ text: part.text.slice(1, -1), start: part.start + 1 });
  }
  return part;
}

function decodePropertyName(value: string): string | null {
  if (/^[A-Za-z_$][\w$]*$/.test(value) || /^\d+$/.test(value)) return value;
  return decodeStringLiteral(value);
}

function decodeStringLiteral(value: string): string | null {
  if (value.length < 2) return null;
  const quote = value[0];
  if ((quote !== "\"" && quote !== "'" && quote !== "`") || value.at(-1) !== quote) return null;
  if (quote === "`" && value.includes("${")) return null;
  const body = value.slice(1, -1);
  let output = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (char !== "\\") {
      output += char;
      continue;
    }
    const escaped = body[++index];
    if (escaped === undefined) return null;
    if (escaped === "n") output += "\n";
    else if (escaped === "r") output += "\r";
    else if (escaped === "t") output += "\t";
    else if (escaped === "b") output += "\b";
    else if (escaped === "f") output += "\f";
    else if (escaped === "v") output += "\v";
    else if (escaped === "u" && /^[0-9a-f]{4}$/i.test(body.slice(index + 1, index + 5))) {
      output += String.fromCharCode(Number.parseInt(body.slice(index + 1, index + 5), 16));
      index += 4;
    } else output += escaped;
  }
  return output;
}

function sourceLocation(source: ParsedSource, offset: number, symbol: string): string {
  const before = source.text.slice(0, Math.max(0, offset));
  const line = before.split(/\r?\n/).length;
  const lastLine = Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"));
  const column = before.length - lastLine;
  return `${source.relative}:${line}:${column} ${symbol}`;
}

function declarationFallback(name: string): string {
  return `game/src:?:? ${name}`;
}

function uniqueUnresolved(entries: readonly UnresolvedAnimationReference[]): UnresolvedAnimationReference[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.source}\0${entry.expression}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.source.localeCompare(b.source) || a.expression.localeCompare(b.expression));
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function argumentValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log([
      "Usage: npx tsx tools/analyze-animation-usage.ts [options]",
      "",
      "Options:",
      "  --repo-root <path>       analyze another checkout",
      "  --out <path>             write JSON instead of printing it",
      "  --fail-on-missing         exit 1 for missing clips or GLB/manifest mismatches",
      "  --fail-on-unresolved      exit 1 for unresolved dynamic clip references",
    ].join("\n"));
    return;
  }
  const root = path.resolve(argumentValue(args, "--repo-root") ?? defaultRepoRoot);
  const report = await analyzeAnimationUsage(root);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const out = argumentValue(args, "--out");
  if (out) {
    const output = path.resolve(root, out);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, json, "utf8");
  } else {
    process.stdout.write(json);
  }

  const missingFailure = args.includes("--fail-on-missing")
    && (report.missingClips.length > 0 || report.manifestGlbMismatches.length > 0);
  const unresolvedFailure = args.includes("--fail-on-unresolved")
    && report.unresolvedDynamicReferences.length > 0;
  if (missingFailure || unresolvedFailure) process.exitCode = 1;
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedFile === fileURLToPath(import.meta.url)) {
  void runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
