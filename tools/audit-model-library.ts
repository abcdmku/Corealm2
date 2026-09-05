/** Catalogue census, import defects and explicit limits of the visual evidence.
 * Run: npx tsx tools/audit-model-library.ts
 * Reads every committed GLB. Does not launch a browser or change production assets.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GLTF } from "@gltf-transform/core";
import sharp from "sharp";
import type { AssetEntry, AssetManifest } from "../game/src/render/assets.js";
import { repoRoot } from "./lib/paths.js";

export const assetRoot = path.join(repoRoot, "game/public/assets");
export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export interface ModelMetrics {
  bytes: number;
  sha256: string;
  meshes: number;
  primitives: number;
  triangles: number;
  renderPrimitives: number;
  renderTriangles: number;
  materials: number;
  materialDefinitionsIgnoringNames: number;
  skins: number;
  clips: string[];
  mapSlots: Record<"baseColor" | "normal" | "occlusion" | "metallicRoughness" | "emissive", number>;
  images: Array<{ bytes: number; sha256: string; width: number; height: number; mimeType: string;
    uri?: string; file?: string }>;
  extensions: string[];
}

function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function externalImage(file: string, uri: string, imageRoot: string): Promise<{ data: Buffer; file: string }> {
  let decoded: string;
  try { decoded = decodeURIComponent(uri); } catch { throw new Error(`Malformed image URI in ${file}: ${uri}`); }
  if (!decoded || /[\\\x00-\x1f\x7f:#?]/.test(decoded) || path.posix.isAbsolute(decoded)
    || path.win32.isAbsolute(decoded)) throw new Error(`Image URI must be a relative file path in ${file}: ${uri}`);

  const root = path.resolve(imageRoot);
  const allowedRoots = [assetRoot, path.join(repoRoot, "runs"), path.join(repoRoot, "test-results")];
  const allowedRoot = allowedRoots.find((allowed) => within(allowed, root));
  if (!allowedRoot) {
    throw new Error(`Image root must be a served or staged workspace asset directory: ${root}`);
  }
  const imageFile = path.resolve(path.dirname(file), decoded);
  if (!within(root, path.resolve(file)) || !within(root, imageFile)) {
    throw new Error(`Image reference escapes its asset root in ${file}: ${uri}`);
  }
  const [workspaceReal, allowedReal, rootReal, modelReal] = await Promise.all([
    realpath(repoRoot), realpath(allowedRoot), realpath(root), realpath(file),
  ]);
  if (!within(workspaceReal, allowedReal) || !within(allowedReal, rootReal)
    || !within(rootReal, modelReal) || !(await stat(rootReal)).isDirectory()) {
    throw new Error(`Image root or model resolves outside its workspace asset directory: ${file}`);
  }
  let imageReal: string;
  try { imageReal = await realpath(imageFile); } catch (cause) {
    throw new Error(`Missing external image in ${file}: ${uri}`, { cause });
  }
  if (!within(rootReal, imageReal)) throw new Error(`Image resolves outside its asset root in ${file}: ${uri}`);
  return { data: await readFile(imageReal), file: path.relative(repoRoot, imageReal).split(path.sep).join("/") };
}

export async function inspectModel(file: string, imageRoot = assetRoot): Promise<ModelMetrics> {
  const bytes = await readFile(file);
  if (bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error(`Invalid GLB header: ${file}`);
  }
  let json: GLTF.IGLTF | undefined;
  let binary: Buffer = Buffer.alloc(0);
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (chunk.length !== length) throw new Error(`Truncated GLB chunk: ${file}`);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8")) as GLTF.IGLTF;
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  if (!json) throw new Error(`Missing GLB JSON: ${file}`);
  const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives);
  const renderedPrimitives = (json.nodes ?? []).flatMap((node) => node.mesh === undefined ? [] : json.meshes?.[node.mesh]?.primitives ?? []);
  const triangleCount = (primitive: GLTF.IMeshPrimitive): number => {
    const count = json.accessors?.[primitive.indices ?? primitive.attributes.POSITION!]?.count ?? 0;
    const mode = primitive.mode ?? 4;
    return mode === 4 ? count / 3 : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
  };
  const materials = json.materials ?? [];
  const images: ModelMetrics["images"] = [];
  for (const image of json.images ?? []) {
    let data: Buffer;
    let externalFile: string | undefined;
    if (image.uri !== undefined) {
      if (image.bufferView !== undefined) throw new Error(`Image has both URI and buffer view: ${file}`);
      const external = await externalImage(file, image.uri, imageRoot);
      data = external.data;
      externalFile = external.file;
    } else {
      if (image.bufferView === undefined) throw new Error(`Image has no URI or buffer view: ${file}`);
      const view = json.bufferViews?.[image.bufferView];
      if (!view) throw new Error(`Missing image buffer view: ${file}`);
      const offset = view.byteOffset ?? 0;
      if (view.buffer !== 0 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(view.byteLength)
        || view.byteLength <= 0 || offset + view.byteLength > binary.length) throw new Error(`Invalid image buffer view: ${file}`);
      data = binary.subarray(offset, offset + view.byteLength);
    }
    const metadata = await sharp(data).metadata();
    images.push({ bytes: data.length, sha256: sha256(data), width: metadata.width,
      height: metadata.height, mimeType: image.mimeType ?? `image/${metadata.format}`,
      ...(externalFile ? { uri: image.uri, file: externalFile } : {}) });
  }
  return {
    bytes: bytes.length, sha256: sha256(bytes), meshes: json.meshes?.length ?? 0,
    primitives: primitives.length,
    triangles: primitives.reduce((sum, primitive) => sum + triangleCount(primitive), 0),
    renderPrimitives: renderedPrimitives.length,
    renderTriangles: renderedPrimitives.reduce((sum, primitive) => sum + triangleCount(primitive), 0),
    materials: materials.length,
    materialDefinitionsIgnoringNames: new Set(materials.map(({ name: _name, ...definition }) => JSON.stringify(definition))).size,
    skins: json.skins?.length ?? 0,
    clips: (json.animations ?? []).map((clip, index) => clip.name ?? `unnamed_${index}`),
    mapSlots: {
      baseColor: materials.filter((material) => material.pbrMetallicRoughness?.baseColorTexture).length,
      normal: materials.filter((material) => material.normalTexture).length,
      occlusion: materials.filter((material) => material.occlusionTexture).length,
      metallicRoughness: materials.filter((material) => material.pbrMetallicRoughness?.metallicRoughnessTexture).length,
      emissive: materials.filter((material) => material.emissiveTexture).length,
    },
    images, extensions: json.extensionsUsed ?? [],
  };
}

type Disposition = "retain" | "repair" | "replace";
interface Assessment {
  family: string;
  disposition: Disposition;
  evidence: "binary-and-source" | "binary-and-family-inference";
  defects: string[];
  nextAction: string;
  sourceFiles: string[];
}

interface AuditedModel extends Assessment {
  id: string;
  file: string;
  category: AssetEntry["category"];
  pack: string;
  metrics: ModelMetrics;
  inspection: { binary: string; visual: string };
}

function assess(asset: AssetEntry, metrics: ModelMetrics): Assessment {
  const base: Assessment = { family: asset.category, disposition: "retain", evidence: "binary-and-family-inference",
    defects: [], nextAction: "Retain pending a production material-yard and in-world inspection; this census is not visual acceptance.",
    sourceFiles: ["tools/build-assets.ts"] };
  if (asset.tags.includes("placeholder-style")) return { ...base, family: "legacy-platformer", disposition: "replace",
    defects: ["The asset catalogue explicitly marks this unrelated platformer silhouette as placeholder-style."],
    nextAction: "Replace active uses with matching authored geology, bridges or creatures. Remove unused placeholders from the shipping catalogue after reference audit." };
  if (asset.id.startsWith("animal_")) return { ...base, family: "animals", disposition: "repair",
    evidence: asset.id === "animal_bear" ? "binary-and-source" : "binary-and-family-inference",
    defects: ["Shared FBX importer forces flipY=false before glTF export. Bear source-to-output UV and image comparison confirms a vertical texture orientation defect; this family uses the same path.",
      ...(metrics.clips.some((clip) => /^attack/i.test(clip)) && !metrics.clips.some((clip) => /^hit/i.test(clip)) ? ["Combat rig has no Hit clip."] : []),
      "Importer replaces the source materials with uniform roughness 0.86, dropping normal and surface-response maps."],
    nextAction: "Correct source texture orientation, validate the result on every species, restore material response, then repair articulated attack and hit cycles. Do not replace usable rigs to conceal an import bug.",
    sourceFiles: ["tools/animals/convert.js", "tools/animals/catalog.mjs", "tools/animals/stage-textures.py"] };
  if (asset.id.startsWith("boss_rhino_")) return { ...base, family: "elemental-bosses", disposition: "repair",
    defects: ["Three named bosses reuse one rhino silhouette.", "Source Get_Hit is omitted; source Run is exported as Walk.",
      "Shared FBX texture orientation path needs correction and visual verification.", "Source normal/AO/metallic maps are dropped; emissive and color recoloring carry nearly all variation."],
    nextAction: "Repair import and restore true motion coverage first. Replace the air-roc silhouette with an authored flying creature when its locomotion and encounter are ready.",
    sourceFiles: ["tools/bosses/catalog.mjs", "tools/bosses/stage-textures.py", "tools/animals/convert.js"] };
  if (asset.id.startsWith("miniboss_") && asset.category === "character") return { ...base, family: "minibosses", disposition: "repair",
    defects: ["Four region variants share one rig and primary attack; source Attack02/03 and secondary idle are omitted.",
      "Shared FBX texture orientation path needs correction and visual verification; normal/AO maps are discarded."],
    nextAction: "Repair texture orientation and materials, retain the complete baseline rig, and restore source alternate attacks where encounter timing supports them.",
    sourceFiles: ["tools/minibosses/catalog.mjs", "tools/animals/convert.js"] };
  if (asset.id.startsWith("altar_ruins_")) return { ...base, family: "imported-shrine", disposition: "repair", evidence: "binary-and-source",
    defects: ["Site and altar embed the same three 2K images separately, including a 9.76 MB normal PNG.",
      ...(metrics.materials > 1 ? ["63 material definitions differ only by name, splitting identical surfaces.",
        "Structural child mesh names drive navigation. Unrestricted mesh joining would change collisions."] : [])],
    nextAction: "Deduplicate materials, merge decorative rubble only, compress normals with measured angular error, and preserve the named structural triangles exactly. Stage for lab review before promotion.",
    sourceFiles: ["tools/import-unity-magic-assets.ts", "game/src/render/structureNavigation.ts"] };
  if (asset.id.startsWith("tree_")) return { ...base, family: "trees", disposition: "repair",
    defects: ["Imported bark/foliage keep base color only; no material-specific normal or roughness response.",
      "No authored LOD chain; twisted and dead variants spend many triangles on repeated distant silhouettes.",
      "Resource trees and world canopy have separate lifecycle/interaction paths; imported stump meshes do not share the standing trunk geometry."],
    nextAction: "Build species families with varied branching, root flare, foliage clusters, shared bark/leaf textures and matching fallen/stump states. Accept those assets before replacing world canopy and harvest trees together." };
  if (asset.category === "nature" && !asset.id.startsWith("fish_")) return { ...base, family: "understory-and-deadwood", disposition: "repair",
    defects: ["Foliage and litter families use unrelated atlas swatches or untextured solid colors; prior grading does not repair their geometry or surfaces.",
      ...(asset.id.startsWith("grass_") ? ["World rendering substitutes these four distinct meshes with one procedural crossed-card grass texture."] : []),
      ...(asset.id === "mushroom_bracket" ? ["3,216 triangles for a small litter prop, more than tree_common_5."] : [])],
    nextAction: "Author coherent fern, leaf, grass, shrub and deadwood families with shared material scale. Keep useful source geometry where its silhouette survives lab inspection.",
    sourceFiles: ["tools/build-assets.ts", "game/src/world/scatter.ts", "game/src/render/proceduralTextures.ts"] };
  if (asset.category === "rock") return { ...base, family: "rocks-and-mining", disposition: "repair",
    defects: ["Ordinary rocks are reused as tier ore nodes; procedural surface bars and fixed depletion scars provide the mineral identity.",
      ...(metrics.mapSlots.normal === 0 ? ["Source normal and surface-response maps are absent."] : [])],
    nextAction: "Retain suitable dressing rocks. Replace ore uses with stratified host faces, embedded veins and extraction states, and place them through authored site geology.",
    sourceFiles: ["game/src/content/gatheringProductionTiers.ts", "game/src/render/entityViews.ts", "tools/build-assets.ts"] };
  if (asset.category === "weapon") return { ...base, family: "weapons", disposition: "repair",
    defects: [metrics.mapSlots.normal === 0 ? "Base-color-only material cannot distinguish blade, grip and fittings." : "Imported source textures cost far more than comparable world models; material and map orientation require a controlled comparison."],
    nextAction: "Retain sound silhouettes; use explicit blade/wood/binding material roles, consistent texel density, and one model source for item icon and equipped appearance.",
    sourceFiles: ["tools/build-assets.ts", "tools/animals/convert.js", "game/src/render/proceduralGear.ts", "game/src/render/itemIconRenderer.ts"] };
  if (asset.category === "building" || asset.category === "dungeon") return { ...base, family: "architecture", disposition: "repair",
    defects: ["Base-color-only import flattens timber, plaster, stone and roof response.", "Asset-level census cannot establish that a modular piece is fitted correctly to terrain or surrounding buildings."],
    nextAction: "Retain the modular geometry unless its lab view fails. Restore controlled material detail and author site-specific massing, foundations, access and work areas." };
  if (asset.category === "outfit" || asset.category === "character") return { ...base, family: "humanoids-and-outfits", disposition: "repair",
    defects: ["Base-color-only import discards cloth/leather/metal surface response.",
      ...(metrics.triangles > 20_000 ? ["Over 20,000 triangles on a single outfit; no authored LOD chain."] : [])],
    nextAction: "Keep compatible body/outfit rigs, verify seams and skinning in equipped poses, consolidate hidden geometry, and add surface roles and LODs." };
  if (asset.category === "prop" || asset.category === "farm") return { ...base, family: "props-and-farming", disposition: "repair",
    defects: ["The shared import removes source normal/AO/roughness response, so timber, cloth, ceramics and metal depend on color alone.",
      ...(["training_dummy", "barrel_rack"].includes(asset.id) ? ["World farm dressing uses this object as an unrelated scarecrow or trough substitute."] : [])],
    nextAction: "Keep useful geometry for its actual purpose. Restore material roles and joinery detail, replace unrelated-object stand-ins, and inspect props in coherent work areas rather than as isolated scatter." };
  return base;
}

export async function auditLibrary(): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(assetRoot, "manifest.json"), "utf8")) as AssetManifest;
  const models: AuditedModel[] = [];
  for (const asset of manifest.assets) {
    const metrics = await inspectModel(path.join(assetRoot, asset.file));
    models.push({ id: asset.id, file: asset.file, category: asset.category, pack: asset.pack,
      metrics, ...assess(asset, metrics), inspection: {
        binary: "Every mesh primitive, material definition, image header/hash and animation name inspected.",
        visual: "No new per-model browser review. Historical family assessments are not current visual acceptance.",
      } });
  }
  const textures = new Map<string, { bytes: number; assets: string[] }>();
  for (const model of models) for (const image of model.metrics.images) {
    const entry = textures.get(image.sha256) ?? { bytes: image.bytes, assets: [] };
    entry.assets.push(model.id); textures.set(image.sha256, entry);
  }
  const familyRows = [...new Set(models.map((model) => model.family))].sort().map((family) => {
    const members = models.filter((model) => model.family === family);
    return { family, count: members.length, bytes: members.reduce((sum, model) => sum + model.metrics.bytes, 0),
      retain: members.filter((model) => model.disposition === "retain").length,
      repair: members.filter((model) => model.disposition === "repair").length,
      replace: members.filter((model) => model.disposition === "replace").length };
  });
  const images = models.flatMap((model) => model.metrics.images);
  const externalImages = images.filter((image) => image.file !== undefined);
  const externalFiles = new Map(externalImages.map((image) => [image.file!, image.bytes]));
  const summary = { models: models.length, packs: manifest.packs.length,
    bytes: models.reduce((sum, model) => sum + model.metrics.bytes, 0),
    embeddedImageBytes: images.filter((image) => image.file === undefined).reduce((size, image) => size + image.bytes, 0),
    externalImageReferences: externalImages.length,
    externalImageFiles: externalFiles.size,
    externalImageBytes: [...externalFiles.values()].reduce((size, bytes) => size + bytes, 0),
    uniqueImageBytes: [...textures.values()].reduce((sum, image) => sum + image.bytes, 0), families: familyRows };
  const report = { schemaVersion: 2, command: "npx tsx tools/audit-model-library.ts", manifestSha256: sha256(await readFile(path.join(assetRoot, "manifest.json"))),
    scope: "Current GLB and referenced-image census. Per-model source/family assessments preserve the historical rebuild baseline and need reassessment; they are not current defect confirmations or visual acceptances.",
    summary, sharedImageReferences: [...textures.entries()].filter(([, image]) => image.assets.length > 1)
      .map(([hash, image]) => ({ sha256: hash, ...image })).sort((a, b) => b.bytes * (b.assets.length - 1) - a.bytes * (a.assets.length - 1)), models };
  const output = path.join(repoRoot, "runs/corealm-rebuild");
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "model-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
  const markdown = ["# Model library audit", "", `The current catalogue contains ${summary.models} GLBs from ${summary.packs} packs, totaling ${(summary.bytes / 1e6).toFixed(2)} MB of GLB containers. Another ${(summary.externalImageBytes / 1e6).toFixed(2)} MB resides in ${summary.externalImageFiles} external image files, referenced ${summary.externalImageReferences} times. Every GLB was parsed; every material, image header/hash and animation name was inspected. This technical census does not grade visual quality.`, "",
    "Run `npx tsx tools/audit-model-library.ts` to regenerate this report and its per-model JSON record. The manifest, GLB and per-image hashes identify the inputs, including external file contents. No production assets are changed.", "",
    "The retain/repair/replace assessments below preserve the original rebuild baseline. They have not been reassessed against the current models, source importers or gameplay and must not be read as current defect confirmations.", "",
    "| Family | Models | MB | Retain | Repair | Replace |", "|---|---:|---:|---:|---:|---:|",
    ...familyRows.map((row) => `| ${row.family} | ${row.count} | ${(row.bytes / 1e6).toFixed(2)} | ${row.retain} | ${row.repair} | ${row.replace} |`), "",
    "## Historical rebuild findings requiring reassessment", "",
    "1. The bear's white forelegs are an import defect. `tools/animals/convert.js` forces `flipY=false` on source FBX textures. The committed bear's 2,701 position/UV pairs match the source FBX. Its embedded texture matches the original TGA without vertical correction. Current front-leg UV samples are 36.32% white; vertically correcting the image reduces that to zero and restores brown fur. Correct and review every consumer of this shared importer before discarding usable source art.",
    "2. The nature import deliberately removes normal, occlusion, metallic/roughness and emissive maps in `tools/build-assets.ts:1573`. All 50 nature assets have no normal or AO map. Shader color grading cannot recover the removed surface information or improve branching geometry. The tree families need coherent source geometry, textures, LODs and matching harvest states.",
    "3. All 19 terrestrial animal variants and the three rhino bosses lack Hit. Rhino source Run is renamed Walk, while Get_Hit is omitted. Ten animal attacks use synthesized root lunges. Rebuild motion from source and articulated family profiles, then check contact and recovery in the production lab.",
    "4. Ore is ordinary rock with raised rectangular vein strips. `entityViews.ts:3816` projects only strip endpoints, guesses height on misses, and sends every branch to the same side because indices 1, 3 and 5 are all odd. Depletion adds fixed forward-facing scars to an intact rock. Replace ore uses with matching geological host, vein and extraction-state geometry.",
    "5. Shrine site has 63 material definitions that differ only by name. Named architectural meshes drive collision in `structureNavigation.ts`, so unrestricted geometry merging would break gameplay. Deduplicate materials and merge decorative rubble while retaining structural names and exact triangles.",
    `6. Current image accounting: embedded images occupy ${(summary.embeddedImageBytes / 1e6).toFixed(2)} MB; shared external files occupy ${(summary.externalImageBytes / 1e6).toFixed(2)} MB; unique image content across both occupies ${(summary.uniqueImageBytes / 1e6).toFixed(2)} MB. Repeated references to one external file are shared storage, not duplicate payloads.`,
    "7. Some objects depict the wrong thing. `itemIconAppearances.ts` maps coney foot to claw, boar bristle to hide and rat tail to horn; farm dressing uses a training dummy for a scarecrow and a barrel rack for a trough. Replace these explicit stand-ins with actual objects. Share item geometry between equipped gear and icons.",
    "8. The 16 assets tagged placeholder-style remain in the catalogue. Audit their active uses, replace the geology/bridge/creature silhouettes that still ship, and retire unused entries. This is more useful than recoloring every file indiscriminately.", "",
    "## Source and acceptance boundaries", "",
    "Source-cache availability is not rechecked by this census. Historical source paths in the JSON identify the original review targets; they are not proof that those sources remain available or unchanged.", "",
    "`model-audit.json` records retain/repair/replace and the reason for each model. A family inference is marked explicitly. Retain means no specific replacement is justified by this audit, not that the model is production accepted. Material roles, texture orientation, UV seams, joint deformation and world placement must be reviewed in the lab and authored locations. Optimized outputs remain under ignored `runs/local-model-rebuild/` until the root accepts and promotes them.", ""];
  await writeFile(path.join(output, "model-audit.md"), markdown.join("\n"));
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  auditLibrary().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
