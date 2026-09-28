/** Rebuild creature candidates through family profiles. Devdocs acceptance precedes promotion. */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NodeIO, type JSONDocument } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import type { AssetEntry, AssetManifest } from '../../game/src/render/assets.js';
import { applyClip, duration, removeClip, restorePose, storedPose } from '../creature-motion/pose.js';
import { deformedBounds } from '../creature-motion/validate-deformation.js';
import type { CreatureRepairProfile } from './repairProfile.js';
import { validateCreatureDocument } from './validation.js';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const families = ['humanoids-colon', 'humanoids-plain', 'arthropods', 'winged', 'quadrupeds', 'specials', 'studio'] as const;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const git = promisify(execFile);

export async function stageCreatureRepairs(family: string, only?: readonly string[]) {
  if (!(families as readonly string[]).includes(family)) throw new Error(`Unknown family ${family}`);
  const { profile } = await import(`./profiles/${family}.js`) as { profile: CreatureRepairProfile };
  if (profile.id !== family) throw new Error(`Profile identity mismatch: ${profile.id}`);
  const manifest: AssetManifest = JSON.parse(await readFile(path.join(repo, 'game/public/assets/manifest.json'), 'utf8'));
  const entries = new Map(manifest.assets.map(entry => [entry.id, entry]));
  const ids = only?.length ? [...only] : [...profile.assetIds];
  if (ids.some(id => !profile.assetIds.includes(id))) throw new Error('Selection escapes the family ownership');
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const assetPath = (entry: AssetEntry) => path.join(repo, 'game/public/assets', entry.file);
  type SourcePin = { sourceGitBlob?: string; sourceSha256?: string };
  type DonorPin = SourcePin & { id: string };
  let pinnedDonors: DonorPin[] = [];
  const usedDonors = new Map<string, DonorPin>();
  const source = async (entry: AssetEntry, override?: SourcePin) => {
    const pinned = override ?? (entry as AssetEntry & { motionRepair?: SourcePin }).motionRepair;
    if (pinned?.sourceGitBlob) {
      if (!/^[a-f0-9]{40,64}$/.test(pinned.sourceGitBlob)) throw new Error(`Invalid pinned source for ${entry.id}`);
      const { stdout } = await git('git', ['cat-file', 'blob', pinned.sourceGitBlob], { cwd: repo, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 });
      if (sha(stdout) !== pinned.sourceSha256) throw new Error(`Pinned source hash mismatch for ${entry.id}`);
      return { bytes: stdout, blob: pinned.sourceGitBlob };
    }
    const bytes = await readFile(assetPath(entry));
    const { stdout } = await git('git', ['rev-parse', `HEAD:game/public/assets/${entry.file}`], { cwd: repo });
    const blob = stdout.trim();
    const committed = await git('git', ['cat-file', 'blob', blob], { cwd: repo, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 });
    if (sha(committed.stdout) !== sha(bytes)) throw new Error(`Unpinned local asset change: ${entry.id}. Preserve its source before rebuilding.`);
    return { bytes, blob };
  };
  const readDocument = async (entry: AssetEntry, bytes: Buffer) => {
    if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Invalid GLB ${entry.id}`);
    const jsonLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as JSONDocument['json'];
    const resources: JSONDocument['resources'] = {};
    const binaryOffset = 20 + jsonLength;
    if (binaryOffset + 8 <= bytes.length && bytes.readUInt32LE(binaryOffset + 4) === 0x004e4942) {
      resources['@glb.bin'] = new Uint8Array(bytes.subarray(binaryOffset + 8, binaryOffset + 8 + bytes.readUInt32LE(binaryOffset)));
    }
    for (const resource of [...(json.images ?? []), ...(json.buffers ?? [])]) {
      const uri = resource.uri;
      if (!uri || uri.startsWith('data:')) continue;
      const file = path.resolve(path.dirname(assetPath(entry)), decodeURIComponent(uri));
      const allowed = path.join(repo, 'game/public/assets') + path.sep;
      if (!file.startsWith(allowed)) throw new Error(`External asset resource escapes public assets: ${uri}`);
      const resourceBytes = new Uint8Array(await readFile(file));
      resources[uri] = resourceBytes;
      // Shared images are named by their encoded hash; reject mutation under an immutable URL.
      const expected = path.basename(file).match(/^([a-f0-9]{64})\./)?.[1];
      if (expected && sha(resourceBytes) !== expected) throw new Error(`Changed shared image ${uri}`);
    }
    return io.readJSON({ json, resources });
  };
  const readAsset = async (id: string) => {
    const entry = entries.get(id);
    if (!entry) throw new Error(`Unknown donor ${id}`);
    const original = await source(entry, pinnedDonors.find(donor => donor.id === id));
    usedDonors.set(id, { id, sourceGitBlob: original.blob, sourceSha256: sha(original.bytes) });
    return readDocument(entry, original.bytes);
  };
  const output = path.join(repo, 'test-results/creature-audit/candidates', family);
  await mkdir(path.join(output, 'models'), { recursive: true });
  await mkdir(path.join(output, 'sources'), { recursive: true });
  const assets: Record<string, unknown>[] = [], files: Record<string, string> = {}, repairs: unknown[] = [];
  const unchanged: string[] = [];
  const rejected: { id: string; problems: string[] }[] = [];
  for (const id of ids) {
    const entry = entries.get(id);
    if (!entry) throw new Error(`Unknown production asset ${id}`);
    const originalSource = await source(entry);
    const original = originalSource.bytes;
    const sourceHash = sha(original);
    await writeFile(path.join(output, 'sources', `${id}-${sourceHash.slice(0, 12)}.glb`), original);
    const doc = await readDocument(entry, original);
    pinnedDonors = (entry as AssetEntry & { motionRepair?: { donors?: DonorPin[] } }).motionRepair?.donors ?? [];
    usedDonors.clear();
    const result = await profile.repair(doc, { assetId: id, entry, readAsset });
    const directionalClips = doc.getRoot().listAnimations().filter(clip => ['HitLeft', 'HitRight'].includes(clip.getName()));
    if (directionalClips.length) {
      for (const clip of directionalClips) removeClip(doc, clip.getName());
      result.changes.push('Removed retired directional hit clips; all impacts use Hit');
    }
    if (!result.changes.length) {
      unchanged.push(id);
      repairs.push({ id, sourceSha256: sourceHash, ...result, unchanged: true });
      console.log(`${id}: preserved original; devdocs review required`);
      continue;
    }
    const validation = validateCreatureDocument(doc);
    // The source may use mesh compression; candidates retain decoded geometry until final build.
    for (const extension of doc.getRoot().listExtensionsUsed()) {
      if (['EXT_meshopt_compression', 'KHR_draco_mesh_compression'].includes(extension.extensionName)) extension.dispose();
    }
    const bytes = await io.writeBinary(doc);
    const file = `models/${id}-${sha(bytes).slice(0, 16)}.glb`;
    await writeFile(path.join(output, file), bytes);
    const pose = storedPose(doc);
    const idle = doc.getRoot().listAnimations().find(clip => /^idle/i.test(clip.getName()));
    if (idle) applyClip(idle, 0);
    const bounds = deformedBounds(doc);
    restorePose(pose);
    const vector = (values: number[]) => ({ x: values[0]!, y: values[1]!, z: values[2]! });
    const seconds = (name: string) => {
      const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name);
      return clip ? duration(clip) : undefined;
    };
    const updated: Record<string, unknown> = {
      ...entry, ...result.motion, bytes: bytes.length, sha256: sha(bytes),
      compactFile: undefined,
      animations: doc.getRoot().listAnimations().map(clip => clip.getName()),
      materials: doc.getRoot().listMaterials().map(material => material.getName()),
      triangles: doc.getRoot().listMeshes().reduce((total, mesh) => total + mesh.listPrimitives().reduce((count, primitive) => count + (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')!.getCount()) / 3, 0), 0),
      ...('vertices' in entry ? { vertices: doc.getRoot().listMeshes().reduce((total, mesh) => total + mesh.listPrimitives().reduce((count, primitive) => count + primitive.getAttribute('POSITION')!.getCount(), 0), 0) } : {}),
      ...('joints' in entry ? { joints: [...new Set(doc.getRoot().listSkins().flatMap(skin => skin.listJoints().map(joint => joint.getName())))] } : {}),
      size: vector(bounds.max.map((value, axis) => value - bounds.min[axis]!)), base: vector(bounds.min),
      ...('bounds' in entry ? { bounds: { min: bounds.min, max: bounds.max } } : {}),
      walkClipSeconds: seconds('Walk'), runClipSeconds: seconds('Run'), attackSeconds: seconds('Attack'),
      motionRepair: { family, sourceSha256: sourceHash, sourceGitBlob: originalSource.blob, donors: [...usedDonors.values()], ...result, validation },
    };
    // Old acceptance and timing prose describe the source bytes, not this new candidate.
    const metadata = { ...(updated.metadata as Record<string, unknown> | undefined) };
    for (const key of ['attackContact', 'gaitMeasurement', 'floorClearance', 'deathPose', 'locomotion']) delete metadata[key];
    metadata.animationAcceptance = 'pending-devdocs-review';
    if (typeof updated.contactNormalized === 'number' && typeof updated.attackSeconds === 'number') {
      metadata.attackContact = { normalized: updated.contactNormalized, seconds: updated.contactNormalized * updated.attackSeconds };
    }
    metadata.gaitMeasurement = { impliedWalkMps: updated.impliedWalkMps ?? null, impliedRunMps: updated.impliedRunMps ?? null };
    updated.metadata = metadata;
    updated.acceptance = { exported: true, devdocsAccepted: false, worldIntegrated: false };
    assets.push(updated); files[id] = file;
    repairs.push({ id, sourceSha256: sourceHash, ...result, validation });
    if (!validation.passed) rejected.push({ id, problems: validation.problems });
    console.log(`${id}: ${validation.passed ? 'ready for devdocs' : 'REJECTED'}${validation.problems.length ? ` — ${validation.problems.join('; ')}` : ''}`);
  }
  // Partial rebuilds update only selected candidates; their earlier siblings remain reviewable.
  let previous: { assets?: Record<string, unknown>[]; files?: Record<string, string>; repairs?: { id: string }[] } = {};
  try { previous = JSON.parse(await readFile(path.join(output, 'catalog.json'), 'utf8')); } catch { /* First staging pass. */ }
  const selected = new Set(ids);
  const catalog = { assets: [...(previous.assets ?? []).filter(entry => !selected.has(String(entry.id))), ...assets],
    files: { ...previous.files, ...files }, repairs: [...(previous.repairs ?? []).filter(repair => !selected.has(repair.id)), ...repairs],
    visualAccepted: false, promotable: false, rejected };
  catalog.rejected = catalog.assets.flatMap(entry => {
    const validation = (entry.motionRepair as { validation?: { passed: boolean; problems: string[] } } | undefined)?.validation;
    return validation && !validation.passed ? [{ id: String(entry.id), problems: validation.problems }] : [];
  });
  const catalogFile = path.join(output, 'catalog.json');
  await writeFile(`${catalogFile}.tmp`, JSON.stringify(catalog, null, 2) + '\n');
  await rename(`${catalogFile}.tmp`, catalogFile);
  return { output, staged: assets.map(entry => String(entry.id)), unchanged, rejected: catalog.rejected };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const family = process.argv.find(argument => argument.startsWith('--family='))?.slice(9);
  if (!family) throw new Error('Usage: npx tsx tools/tripo-creatures/repair.ts --family=<family> [--only=id,id]');
  const only = process.argv.find(argument => argument.startsWith('--only='))?.slice(7).split(',');
  const result = await stageCreatureRepairs(family, only);
  console.log(JSON.stringify(result));
  if (result.rejected.length) process.exitCode = 1;
}
