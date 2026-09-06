import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Public metadata probe only. This does not fetch viewer geometry, bypass
// authentication, download an archive, or convert an unreviewed animal.
export const LYNX_SOURCE=Object.freeze({
  uid:'227d603fe1334577b4812a764683c92a',
  author:'nicholas.w.charles',
  url:'https://sketchfab.com/3d-models/lynx-model-227d603fe1334577b4812a764683c92a',
  metadataUrl:'https://api.sketchfab.com/v3/models/227d603fe1334577b4812a764683c92a',
  expectedLicense:'http://creativecommons.org/licenses/by/4.0/',
});

export async function verifyLynxSource(){
  const response=await fetch(LYNX_SOURCE.metadataUrl,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Public metadata HTTP ${response.status}`);
  const raw=await response.text(),metadata=JSON.parse(raw);
  if(metadata.uid!==LYNX_SOURCE.uid||metadata.user?.username!==LYNX_SOURCE.author)throw new Error('Source identity changed');
  const licenseMatches=metadata.license?.url?.replace(/^http:/,'https:')===LYNX_SOURCE.expectedLicense.replace(/^http:/,'https:');
  const download=await fetch(`${LYNX_SOURCE.metadataUrl}/download`,{signal:AbortSignal.timeout(20000)});
  // Do not persist signed download URLs or consume a successful archive link.
  const error=download.status===401?await download.json():null;
  const report={checkedAt:new Date().toISOString(),source:LYNX_SOURCE,
    metadataSha256:createHash('sha256').update(raw).digest('hex'),
    license:metadata.license,licenseMatches,isDownloadable:metadata.isDownloadable,
    faceCount:metadata.faceCount,vertexCount:metadata.vertexCount,
    textureCount:metadata.textureCount,materialCount:metadata.materialCount,
    animationCount:metadata.animationCount,sourceArchiveDownloaded:false,sourceArchiveSha256:null,
    downloadEndpointStatus:download.status,downloadError:error?.detail??null,
    wholeAnimalVisuallyVerified:false,
    visualReview:'Web page returned 403 and the web tool could not display the official thumbnail. A browser inspection is still required.',
    nextStep:download.status===401?'Use an authorized logged-in Sketchfab download workflow after whole-body visual review. Do not extract viewer payloads.':'Review whole body and official download response before acquisition.',
    attribution:`Lynx Model by ${LYNX_SOURCE.author}, ${LYNX_SOURCE.url}, licensed CC BY 4.0. No source mesh obtained or modified.`,
  };
  const directory=fileURLToPath(new URL('../../../art/rebuild/candidates/finish-quadrupeds/source-lynx/',import.meta.url));
  await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'metadata.json'),raw+'\n');
  await writeFile(path.join(directory,'verification.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log(JSON.stringify(await verifyLynxSource(),null,2));
}
