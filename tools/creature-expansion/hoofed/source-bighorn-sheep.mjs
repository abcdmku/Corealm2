/** CPU candidate builder. Source sheep remains read-only; no production aliases. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const candidateDirectory = path.join(root, 'art/rebuild/candidates/finish-quadrupeds/source-bighorn-sheep');
export const sourceAttribution = Object.freeze({
  author: 'p0ss', texturePhotographer: 'titus tscharntke', license: 'CC-BY-SA-3.0',
  source: 'https://opengameart.org/content/sheep-rigged-textured-and-animated',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
});
export const missingProductionRoles = Object.freeze(['Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death']);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version=process.argv.includes('--v4')?'v4':process.argv.includes('--v3')?'v3':process.argv.includes('--v2')?'v2':null;
  const blender = process.env.BLENDER_EXE ?? path.join(root, 'test-results/bestiary-programs/blender-4.5.11-windows-x64/blender.exe');
  for (const [program, args] of [
    [blender, ['--background', '--factory-startup', '--disable-autoexec', '--python', path.join(candidateDirectory, version?`adapt-${version}.py`:'adapt.py')]],
    [process.execPath, [path.join(candidateDirectory, 'prepare-review.mjs'),...(version?[version]:[])]],
  ]) {
    const result = spawnSync(program, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  }
}
