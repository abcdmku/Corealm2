import {copyFile,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCcAssetPack} from '../../../game/src/content/assetLicenses.ts';

/**
 * Slice 05 promotion helper: move ONE lab-accepted creature-expansion candidate from a review
 * catalogue into the production manifest and asset tree. This is the only sanctioned way this slice
 * edits game/public/assets/manifest.json.
 *
 * It refuses to promote anything it cannot verify:
 *  - the staged GLB's bytes and SHA-256 must match the catalogue entry exactly;
 *  - the catalogue entry's `file` must be the production path for its own id;
 *  - the declared pack must be present in the catalogue, and a Creative Commons pack must pass the
 *    production licence validator (deed URL, derivative licence, attribution) before anything moves;
 *  - `--evidence` must name a lifecycle report whose `passed` is true and whose asset SHA-256 is the
 *    one being promoted, so the manifest can never claim lab acceptance the evidence does not show.
 *
 * Usage:
 *   npx tsx tools/creature-expansion/mammals/promote-candidate.mjs \
 *     --catalogue <catalogue.json> --id creature_<species> --evidence <lifecycle report.json>
 */
const args=process.argv.slice(2),arg=n=>{const i=args.indexOf(n);return i<0?undefined:args[i+1];};
const cataloguePath=arg('--catalogue'),assetId=arg('--id'),evidencePath=arg('--evidence');
if(!cataloguePath||!assetId||!evidencePath)throw Error('Usage: promote-candidate.mjs --catalogue <file> --id creature_<species> --evidence <report.json>');
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

const catalogue=JSON.parse(await readFile(cataloguePath,'utf8'));
const asset=catalogue.assets.find(a=>a.id===assetId);
if(!asset)throw Error(`${cataloguePath} has no asset ${assetId}`);
if(asset.file!==`models/creature/${assetId}.glb`)throw Error(`${assetId} declares production file ${asset.file}`);

const stagedName=catalogue.files?.[assetId]??asset.file;
const stagedPath=path.resolve(path.dirname(cataloguePath),stagedName);
const bytes=await readFile(stagedPath);
if(bytes.length!==asset.bytes)throw Error(`${stagedName} is ${bytes.length} bytes, catalogue says ${asset.bytes}`);
const actual=sha256(bytes);
if(actual!==asset.sha256)throw Error(`${stagedName} hashes ${actual}, catalogue says ${asset.sha256}`);

const pack=(catalogue.packs??[]).find(p=>p.id===asset.pack);
if(!pack)throw Error(`Catalogue does not declare pack ${asset.pack}`);
if(/^CC-BY/i.test(pack.license))validateCcAssetPack(pack);

const evidence=JSON.parse(await readFile(evidencePath,'utf8'));
if(evidence.passed!==true)throw Error(`${evidencePath} did not pass`);
if(evidence.assetMetadata?.sha256!==asset.sha256)throw Error(`${evidencePath} proves ${evidence.assetMetadata?.sha256}, not ${asset.sha256}`);

const manifestPath=path.join(repo,'game/public/assets/manifest.json');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const priorAsset=manifest.assets.find(a=>a.id===assetId);
const priorSha=priorAsset?.sha256??null;
const entry={...asset,acceptance:{
  assetAudit:true,labAccepted:true,worldIntegrated:false,
  labEvidence:path.relative(repo,path.resolve(evidencePath)).split(path.sep).join('/'),
  labCatalogue:path.relative(repo,path.resolve(cataloguePath)).split(path.sep).join('/'),
}};
delete entry.clipDurations;delete entry.gameplayRoleProvenance;
if(priorAsset)manifest.assets[manifest.assets.indexOf(priorAsset)]=entry;else manifest.assets.push(entry);
const priorPack=manifest.packs.find(p=>p.id===pack.id);
if(priorPack)manifest.packs[manifest.packs.indexOf(priorPack)]={...priorPack,...pack};else manifest.packs.push(pack);

await copyFile(stagedPath,path.join(repo,'game/public/assets',asset.file));
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({promoted:assetId,from:path.relative(repo,stagedPath).split(path.sep).join('/'),
  priorSha256:priorSha,sha256:asset.sha256,bytes:asset.bytes,pack:pack.id,license:pack.license,
  evidence:entry.acceptance.labEvidence},null,2));
