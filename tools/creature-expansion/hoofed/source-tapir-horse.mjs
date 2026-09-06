/** CPU-only complete source-mesh adaptation. All outputs stay in the isolated
 * candidate directory. Native horse sources are read only. No action aliases. */
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const candidateDirectory=path.join(root,'art/rebuild/candidates/finish-quadrupeds/source-tapir-horse');
export const sourceAttribution={author:'Lyndon Daniels',rigAuthor:'ChadM',license:'CC0-1.0',source:'https://opengameart.org/content/realtime-ranchers-3d-model-pack',rigSource:'https://opengameart.org/content/rigged-horse'};
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const blender=process.env.BLENDER_EXE??path.join(root,'test-results/bestiary-programs/blender-4.5.11-windows-x64/blender.exe');
 const result=spawnSync(blender,['--background','--python-exit-code','1','--python',path.join(candidateDirectory,'build.py')],{cwd:root,stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;
 process.exitCode=result.status??1;
}
