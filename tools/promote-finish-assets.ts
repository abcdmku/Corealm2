/** Root-only, explicit candidate promotion. Dry run unless --apply is passed.
 * --catalog <json> --ids <id,id> [--source-root <dir>] [--pack-metadata <json>] [--apply]
 * --pack-metadata contains one pack or an array. Metadata is never inferred from license prose.
 */
import { createHash } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./lib/paths.js";
import { atomicReplaceFile } from "./lib/atomic-replace-file.js";
import { isSupportedCcAttributionLicense, validateCcAssetPack } from "../game/src/content/assetLicenses.js";
import type { AssetEntry, AssetManifest, AssetPack } from "../game/src/render/assets.js";

type Candidate = Partial<AssetEntry> & { id: string; sha256?: string; candidateFile?: string };
type SharedTexture = { file: string; bytes: number; sha256: string; mimeType: string };
type FileUpdate = { id: string; source: string; destination: string; bytes: Buffer; oldSha256: string | null };
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error(`${name} requires a value`);
  return args[i + 1];
}
function inside(root: string, file: string): string {
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Path escapes root: ${file}`);
  return absolute;
}
async function safeDestination(root: string, file: string): Promise<string> {
  const destination = inside(root, file);
  let parent = path.dirname(destination);
  while (true) {
    try { inside(root, path.join(await realpath(parent), ".promotion-check")); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; parent = path.dirname(parent); }
  }
  try { inside(root, await realpath(destination)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return destination;
}
async function existingBytes(file: string): Promise<Buffer | null> {
  try { return await readFile(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
const catalogArg = option("--catalog");
const selected = option("--ids")?.split(",").map((id) => id.trim()).filter(Boolean);
if (!catalogArg || !selected?.length) throw new Error("Use --catalog <json> --ids <accepted-id,accepted-id>; dry run is default.");
if (new Set(selected).size !== selected.length) throw new Error("Duplicate selected IDs");
const catalogPath = inside(repoRoot, catalogArg);
const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { assets: Candidate[]; pack?: AssetPack; packs?: AssetPack[]; generatorSha256?: string;
  sharedTextures?: SharedTexture[];
  reference?: { assetId: string; file: string; pack: string; sha256: string; license: string; [key: string]: unknown } };
if (!Array.isArray(catalog.assets)) throw new Error("Catalogue must contain an assets array.");
const sourceRoot = await realpath(path.resolve(repoRoot, option("--source-root") ?? path.dirname(catalogPath)));
const publicRoot = await realpath(path.join(repoRoot, "game/public/assets"));
if (sourceRoot === publicRoot || sourceRoot.startsWith(publicRoot + path.sep)) throw new Error("Source must be staged outside the served asset root.");
const manifestPath = path.join(publicRoot, "manifest.json");
const before = await readFile(manifestPath);
const manifest = JSON.parse(before.toString()) as AssetManifest;
const packArgument = option("--pack-metadata");
const metadata = packArgument ? JSON.parse(await readFile(inside(repoRoot, packArgument), "utf8")) as AssetPack | AssetPack[] : [];
const overrides = Array.isArray(metadata) ? metadata : [metadata];
const updates: Array<FileUpdate & { entry: AssetEntry }> = [];
const textureUpdates = new Map<string, FileUpdate>();
const usedPacks = new Map<string, AssetPack>();
for (const id of selected) {
  const candidates = catalog.assets.filter((entry) => entry.id === id);
  if (candidates.length !== 1) throw new Error(`${id}: expected one catalogue entry, found ${candidates.length}`);
  const candidate = candidates[0]!;
  const existing = manifest.assets.find((entry) => entry.id === id);
  const { candidateFile: _candidateFile, ...candidateFields } = candidate;
  const entry = { ...existing, ...candidateFields } as AssetEntry;
  for (const field of ["file", "pack", "category", "is", "tags", "bytes", "size", "base", "animations", "materials"] as const) {
    if (entry[field] === undefined) throw new Error(`${id}: missing ${field}; diagnostic catalogues must be normalized before promotion.`);
  }
  if (!candidate.sha256 || !/^[0-9a-f]{64}$/i.test(candidate.sha256) || !Number.isSafeInteger(candidate.bytes)) throw new Error(`${id}: candidate must pin SHA-256 and bytes.`);
  if (!entry.file.startsWith("models/") || !entry.file.endsWith(".glb")) throw new Error(`${id}: destination must be models/*.glb`);
  const destination = await safeDestination(publicRoot, entry.file);
  if (manifest.assets.some((asset) => asset.id !== id && asset.file === entry.file) || updates.some((update) => update.destination === destination)) throw new Error(`${id}: destination is shared by another asset`);
  const source = await realpath(inside(sourceRoot, candidate.candidateFile ?? candidate.file ?? entry.file));
  inside(sourceRoot, source);
  const bytes = await readFile(source);
  if (bytes.length !== candidate.bytes || hash(bytes) !== candidate.sha256.toLowerCase()) throw new Error(`${id}: candidate bytes/SHA mismatch`);
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${id}: invalid GLB`);
  const glb = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12))) as { animations?: Array<{ name?: string }>; materials?: Array<{ name?: string }>; images?: Array<{ uri?: string }>; buffers?: Array<{ uri?: string }> };
  const names = (values: Array<{ name?: string }>) => values.map((value) => value.name ?? "").sort();
  if (JSON.stringify(names(glb.animations ?? [])) !== JSON.stringify([...entry.animations].sort())) throw new Error(`${id}: animation names do not match candidate GLB`);
  if (JSON.stringify(names(glb.materials ?? [])) !== JSON.stringify([...entry.materials].sort())) throw new Error(`${id}: material names do not match candidate GLB`);
  for (const resource of [...(glb.images ?? []).map((image) => ({ ...image, isImage: true })), ...(glb.buffers ?? []).map((buffer) => ({ ...buffer, isImage: false }))]) {
    if (!resource.uri || resource.uri.startsWith("data:")) continue;
    const uri = decodeURIComponent(resource.uri);
    if (!uri || /[\\\x00-\x1f\x7f:#?]/.test(uri) || path.isAbsolute(uri)) throw new Error(`${id}: invalid relative external URI ${uri}`);
    const textureSource = await realpath(inside(sourceRoot, path.resolve(path.dirname(source), uri)));
    inside(sourceRoot, textureSource);
    const textureDestination = await safeDestination(publicRoot, path.resolve(path.dirname(destination), uri));
    const declared = (catalog.sharedTextures ?? []).filter((texture) => inside(publicRoot, texture.file) === textureDestination);
    if (declared.length > 1) throw new Error(`${id}: duplicate shared texture declaration for ${uri}`);
    const staged = await readFile(textureSource);
    const served = await existingBytes(textureDestination);
    const actualHash = hash(staged);
    if (declared.length === 1) {
      const texture = declared[0]!;
      if (!resource.isImage || !/^textures\/imported\/[0-9a-f]{64}\.png$/.test(texture.file)
        || texture.mimeType !== "image/png" || !Number.isSafeInteger(texture.bytes)
        || texture.bytes !== staged.length || texture.sha256 !== actualHash
        || path.basename(texture.file) !== `${actualHash}.png`
        || staged.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
        throw new Error(`${id}: shared texture path, PNG format, bytes or SHA mismatch for ${uri}`);
      }
      if (await realpath(inside(sourceRoot, texture.file)) !== textureSource) throw new Error(`${id}: shared texture URI resolves to a different source than its catalogue file`);
      if (served && hash(served) !== actualHash) throw new Error(`${id}: served shared texture differs at content-addressed path ${texture.file}`);
      const duplicate = textureUpdates.get(textureDestination);
      if (duplicate && hash(duplicate.bytes) !== actualHash) throw new Error(`${id}: conflicting shared texture destination`);
      if (!duplicate) textureUpdates.set(textureDestination, { id: texture.file, source: textureSource,
        destination: textureDestination, bytes: staged, oldSha256: served ? hash(served) : null });
    } else if (!served || actualHash !== hash(served)) {
      throw new Error(`${id}: external dependency ${uri} needs a matching pinned sharedTextures entry or identical served content.`);
    }
  }
  const oldPack = manifest.packs.find((pack) => pack.id === entry.pack);
  const proposed = catalog.pack?.id === entry.pack ? catalog.pack : catalog.packs?.find((pack) => pack.id === entry.pack);
  const explicit = overrides.find((pack) => pack.id === entry.pack);
  const pack = { ...(oldPack ?? proposed), ...explicit } as AssetPack;
  if (!explicit && catalog.generatorSha256 && proposed?.id === entry.pack) pack.generatorSha256 = catalog.generatorSha256;
  if (!pack.id || !pack.name || !pack.author || !pack.source || !pack.license) throw new Error(`${id}: incomplete pack metadata; supply authoritative --pack-metadata.`);
  if (pack.license === "LicenseRef-Corealm-Original") {
    if (!pack.generatorSha256 || hash(await readFile(inside(repoRoot, pack.source))) !== pack.generatorSha256) throw new Error(`${id}: original pack requires matching explicit generator SHA.`);
  } else if (pack.id === "corealm-original-ground-ores" && pack.source === "tools/build-ground-ores.ts"
    && pack.license.startsWith("Derivative geometry and material maps") && pack.license.includes("Standard Unity Asset Store EULA")) {
    // This named derivative keeps its actual upstream license. A local generator is not proof of original ownership.
    const reference = catalog.reference;
    const referenceAsset = manifest.assets.find((asset) => asset.id === reference?.assetId);
    const referencePack = manifest.packs.find((upstream) => upstream.id === reference?.pack);
    if (!reference || reference.pack !== "dexsoft-rocks-free" || reference.assetId !== "rocks_free_essence_node"
      || referenceAsset?.pack !== reference.pack || !referencePack?.license.startsWith("Standard Unity Asset Store EULA")
      || !/^https?:\/\//.test(referencePack.source) || !reference.license.includes("Standard Unity Asset Store EULA")
      || !/^[0-9a-f]{64}$/.test(reference.sha256)) throw new Error(`${id}: ground-ore derivative requires the pinned, licensed DEXSOFT reference.`);
    const referencePath = inside(publicRoot, referenceAsset.file);
    if (path.resolve(repoRoot, reference.file) !== referencePath || hash(await readFile(referencePath)) !== reference.sha256) {
      throw new Error(`${id}: derivative reference file or SHA does not match the served upstream asset.`);
    }
    if (!pack.generatorSha256 || hash(await readFile(inside(repoRoot, pack.source))) !== pack.generatorSha256) {
      throw new Error(`${id}: derivative requires its matching generator SHA.`);
    }
    Object.assign(pack, { sourceReference: { ...reference, upstreamSource: referencePack.source, upstreamLicense: referencePack.license } });
  } else if (isSupportedCcAttributionLicense(pack.license)) {
    validateCcAssetPack(pack);
  } else if (pack.license === "CC0-1.0") {
    if (!/^https?:\/\//.test(pack.source) || !/^[0-9a-f]{64}$/.test(pack.archiveSha256 ?? "")) throw new Error(`${id}: CC0 pack requires HTTP source and archive pin.`);
  } else if (!pack.license.startsWith("Standard Unity Asset Store EULA") || !/^https?:\/\//.test(pack.source)) throw new Error(`${id}: unsupported license/source; no automatic license conversion is allowed.`);
  usedPacks.set(pack.id, pack);
  let oldSha256: string | null = null;
  try { oldSha256 = hash(await readFile(destination)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  updates.push({ id, source, destination, bytes, entry, oldSha256 });
}
console.log(JSON.stringify({ apply: args.includes("--apply"), catalogueSha256: hash(await readFile(catalogPath)), manifestBeforeSha256: hash(before),
  assets: updates.map(({ id, source, destination, bytes, oldSha256, entry }) => ({ id, source, destination, bytes: bytes.length, sha256: hash(bytes), oldSha256,
    runtime: { groundY: entry.groundY, locomotionPolicy: entry.locomotionPolicy, impliedWalkMps: entry.impliedWalkMps,
      impliedRunMps: entry.impliedRunMps, walkClipSeconds: entry.walkClipSeconds, runClipSeconds: entry.runClipSeconds } })),
  sharedTextures: [...textureUpdates.values()].map(({ id, source, destination, bytes, oldSha256 }) => ({ file: id, source, destination,
    bytes: bytes.length, sha256: hash(bytes), action: oldSha256 === null ? "copy" : "retain-identical" })),
  packs: [...usedPacks.values()], evidence: "Explicit selection is the root's acceptance decision. This helper does not perform visual or gameplay acceptance." }, null, 2));
if (args.includes("--apply")) {
  if (hash(await readFile(manifestPath)) !== hash(before)) throw new Error("Manifest changed during preflight; rerun after ownership freeze.");
  const originals = new Map<string, Buffer | null>();
  const allFiles = [...textureUpdates.values(), ...updates];
  for (const update of allFiles) {
    const current = await readFile(update.destination).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if ((current ? hash(current) : null) !== update.oldSha256) throw new Error(`${update.id}: destination changed during preflight`);
    originals.set(update.destination, current);
  }
  const backupRoot = path.join(repoRoot, "test-results/promotion-backups", `${Date.now()}`);
  await mkdir(backupRoot, { recursive: true });
  await writeFile(path.join(backupRoot, "manifest.json"), before);
  for (const [destination, original] of originals) if (original) {
    const backup = inside(backupRoot, path.relative(publicRoot, destination));
    await mkdir(path.dirname(backup), { recursive: true });
    await writeFile(backup, original);
  }
  const changed = new Set<string>();
  try {
  for (const texture of textureUpdates.values()) if (texture.oldSha256 === null) {
    await mkdir(path.dirname(texture.destination), { recursive: true });
    const handle = await open(texture.destination, "wx");
    changed.add(texture.destination);
    try { await handle.writeFile(texture.bytes); } finally { await handle.close(); }
  }
  for (const update of updates) {
    await mkdir(path.dirname(update.destination), { recursive: true });
    await atomicReplaceFile(update.destination, update.bytes);
    changed.add(update.destination);
    const index = manifest.assets.findIndex((entry) => entry.id === update.id);
    if (index < 0) manifest.assets.push(update.entry); else manifest.assets[index] = update.entry;
  }
  for (const pack of usedPacks.values()) {
    const index = manifest.packs.findIndex((entry) => entry.id === pack.id);
    if (index < 0) manifest.packs.push(pack); else manifest.packs[index] = pack;
  }
  manifest.generatedAt = new Date().toISOString();
  // Commit last. A failed rename leaves the old manifest intact; no fallible writes follow.
  await atomicReplaceFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const [destination, original] of originals) {
      if (!changed.has(destination)) continue;
      try {
        if (original) await atomicReplaceFile(destination, original);
        else await unlink(destination).catch((failure: NodeJS.ErrnoException) => { if (failure.code !== "ENOENT") throw failure; });
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], `Promotion failed and asset rollback was incomplete. Backups: ${backupRoot}`);
    throw error;
  }
  console.log("Promotion written. Run release inventory, content validation, and root browser acceptance before release.");
}
