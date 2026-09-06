import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';

export const RAT_SOURCE=Object.freeze({
 author:'CDmir; TinyWorlds',license:'CC0-1.0',
 url:'https://opengameart.org/content/evil-giant-rat',
 originalSha256:'52530520c71787da6c9ced7130cca02ddaf2b0af567bc38221b746d2297b5be2',
 directory:fileURLToPath(new URL('../../../art/rebuild/candidates/finish-quadrupeds/source-porcupine/',import.meta.url)),
 originalSpecies:'rat',
});
const directory=new URL('../../../art/rebuild/candidates/finish-quadrupeds/source-porcupine/',import.meta.url);
/** Independent complete original rat conversion, before porcupine changes.
 * Callers own wrapper scale/grounding, lab proof and semantic animation mapping.
 * This API neither renames nor manufactures native clips.
 */
export async function loadNativeRatSource(){
 const bytes=await readFile(new URL('cdmir-rat-native.glb',directory));
 const report=JSON.parse(await readFile(new URL('native-export-report.json',directory),'utf8'));
 const sha256=createHash('sha256').update(bytes).digest('hex');
 if(report.releaseReady!==true)throw Error('Native rat conversion has not passed its final-byte motion audit');
 if(report.sha256!==sha256||report.sourceSha256!==RAT_SOURCE.originalSha256)throw Error('Native rat source/report hash mismatch');
 const document=await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).readBinary(bytes);
 return {document,bytes,sha256,report,provenance:RAT_SOURCE,normalizedPreviewScale:.240830591906,labAccepted:false};
}
export async function loadAdaptedPorcupineSource(){
 const bytes=await readFile(new URL('cdmir-porcupine-adapted.glb',directory));
 const report=JSON.parse(await readFile(new URL('porcupine-adaptation.json',directory),'utf8'));
 const sha256=createHash('sha256').update(bytes).digest('hex');
 if(report.sha256!==sha256)throw Error('Porcupine adaptation/report hash mismatch');
 const document=await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).readBinary(bytes);
 return {document,bytes,sha256,report,provenance:RAT_SOURCE,labAccepted:false};
}

