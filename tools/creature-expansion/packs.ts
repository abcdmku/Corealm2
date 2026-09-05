import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Product IDs read from the Unity archives' Asset Store gzip metadata, then verified on the product pages. */
const UNITY_PACKS = [
  {id:'animal-pack-deluxe',name:'Animal pack deluxe',author:'janpec',source:'https://assetstore.unity.com/packages/3d/characters/animals/animal-pack-deluxe-99702',license:'Standard Unity Asset Store EULA; project owner must confirm entitlement',archiveSha256:'0809f4ff5aebfdf93bc7915ed9295deb79b5c11f26075edb130b4d298bc4acc1',assetStoreId:'99702',sourceArchive:'Animal pack deluxe.unitypackage'},
  {id:'pixeliusvita-monster04',name:'Fantasy Monster 3D Model 04 - Game Ready - PixeliusVita',author:'PixeliusVita',source:'https://assetstore.unity.com/packages/3d/characters/creatures/fantasy-monster-3d-model-04-game-ready-pixeliusvita-334320',license:'Standard Unity Asset Store EULA',archiveSha256:'44a2fb67db7914106a9db86ec3d57303a524d3437b0f8cd82ed762fc971eed36',assetStoreId:'334320',sourceArchive:'Fantasy Monster 3D Model 04 - Game Ready - PixeliusVita.unitypackage'},
  {id:'pixeliusvita-monster09',name:'Fantasy Monster 09 - Game Ready (Rigged + Animations) - PixeliusVita',author:'PixeliusVita',source:'https://assetstore.unity.com/packages/3d/characters/creatures/fantasy-monster-09-game-ready-rigged-animations-pixeliusvita-350496',license:'Standard Unity Asset Store EULA',archiveSha256:'30fc10d0c2e6c7a03e3aaaccf39c03ebf98f078ea16e184b0fffd79ae21c3466',assetStoreId:'350496',sourceArchive:'Fantasy Monster 09 Game Ready Rigged Animations PixeliusVita.unitypackage'},
  {id:'dungeon-mason-dragon-boar',name:'Dragon the Soul Eater and Dragon Boar',author:'Dungeon Mason',source:'https://assetstore.unity.com/packages/3d/characters/creatures/dragon-the-soul-eater-and-dragon-boar-77121',license:'Standard Unity Asset Store EULA',archiveSha256:'0651f4f428799d1dd9d7d37d3c524395c35bffa9f5560fe2a489a3f34907af42',assetStoreId:'77121',sourceArchive:'Dragon the Soul Eater and Dragon Boar.unitypackage',archiveTitle:'Dragon the Terror Bringer and Dragon Boar'},
  {id:'dungeon-mason-four-evil-dragons-pbr',name:'Dragon for Boss Monster: PBR',author:'Dungeon Mason',source:'https://assetstore.unity.com/packages/3d/characters/creatures/dragon-for-boss-monster-pbr-78923',license:'Standard Unity Asset Store EULA',archiveSha256:'01b15c6e6ac1339acc40e653924691583cbf44303397878ae7f79a59112b7383',assetStoreId:'78923',sourceArchive:'Dragon for Boss Monster PBR.unitypackage',archiveTitle:'Four Evil Dragons Pack PBR'},
];

const IMPORT_PACKS:Record<string,string>={reedjaw_crocodile:'animal-pack-deluxe',kiln_salamander:'animal-pack-deluxe',reedbank_goose:'animal-pack-deluxe',quarry_snail:'animal-pack-deluxe',cinder_ravager:'pixeliusvita-monster04',gorge_mantis:'pixeliusvita-monster09',basalt_drake:'dungeon-mason-dragon-boar',quarry_nightmare:'dungeon-mason-four-evil-dragons-pbr'};
export const packForSpecies=(id:string)=>IMPORT_PACKS[id.replace(/^creature_/,'')]??'corealm-creature-expansion';

export async function expansionPacks(repo:string){
  const source='tools/build-creature-expansion.ts';
  const generatorSha256=createHash('sha256').update(await readFile(path.join(repo,source))).digest('hex');
  return [{id:'corealm-creature-expansion',name:'Corealm original creature expansion',author:'Corealm',source,license:'LicenseRef-Corealm-Original',generatorSha256},...UNITY_PACKS];
}
