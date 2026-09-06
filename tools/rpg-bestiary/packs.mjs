/** Preserve upstream licenses while grouping staged derivatives by their restrictive source. */
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('game/public/assets/manifest.json', 'utf8'));
const skeleton = {
  id: 'dungeon-skeletons-demo', name: 'Dungeon Skeletons Demo', author: 'Polygon Blacksmith',
  source: 'https://assetstore.unity.com/packages/3d/characters/creatures/dungeon-skeletons-demo-71087',
  license: 'Standard Unity Asset Store EULA',
  archiveSha256: '9e9e40c66eda22d756dd256bf670fcf5edc28bf0b4bba5026daa204791fdf23c',
  assetStoreId: '71087', sourceArchive: 'Dungeon Skeletons Demo.unitypackage',
};
const easyEnemies = {
  id: 'quaternius-easy-enemies', name: 'Easy Animated Enemy Pack', author: 'Quaternius',
  source: 'https://quaternius.itch.io/animated-easy-enemies', license: 'CC0-1.0',
  sourceArchive: 'Easy_Animated_Enemy_Pack_-_Jan_2019.zip',
  archiveSha256: 'a97f38b981fec2f42b263fe92828a7bf73f9da1228d5aac906fe354cd2b21004',
};
const completeSources = [
 {id:'evil-giant-rat',name:'Evil Giant Rat',author:'CDmir and TinyWorlds',source:'https://opengameart.org/content/evil-giant-rat',license:'CC0-1.0',sourceArchive:'original rat.blend',archiveSha256:'52530520c71787da6c9ced7130cca02ddaf2b0af567bc38221b746d2297b5be2',attribution:'Evil Giant Rat by CDmir and TinyWorlds, CC0. Complete original body and native actions retained; corrective joint conversion and runtime aliases documented.',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/'},
 {id:'troll-mauler',name:'Troll Mauler',author:'piacenti',source:'https://opengameart.org/content/troll-mauler',license:'CC-BY-3.0',sourceArchive:'troll mauler.blend',archiveSha256:'83fc5e524d31020d8b7c9641517f965cecd65840b3119582b4e984649f708c51',attribution:'Troll Mauler by piacenti, CC BY 3.0. Original complete body, rig and Idle retained; experimental additional runtime motions and four-influence conversion documented in sourceProvenance.',licenseUrl:'https://creativecommons.org/licenses/by/3.0/'},
 {id:'mocap-goblin',name:'Goblin animated by Motion capture',author:'Danimal; original body xGhostx7; knife Wind astella',source:'https://opengameart.org/content/goblin-animated-by-motion-capture',license:'CC-BY-3.0',sourceArchive:'Goblin.zip',archiveSha256:'9dd294e6a509ec9a4036d3694e73e13eeaaf80e800604e4e7e7957088d46cc3f',attribution:'Goblin animated by Motion capture by Danimal, based on the CC0 goblin by xGhostx7, with CC BY 3.0 knife by Wind astella. Converted for Corealm with source geometry preserved and runtime clip adaptations.',licenseUrl:'https://creativecommons.org/licenses/by/3.0/'},
 {id:'danimal-roach',name:'Roach — game ready and animated',author:'Atmostatic; rig, animation and textures by Danimal',source:'https://opengameart.org/content/roach-game-ready-and-animated',license:'CC-BY-SA-3.0',sourceArchive:'Roach.zip',archiveSha256:'038d01360b353a4d4ebaf1e67293f8554e67ebdb06f34627cbc9538489487594',attribution:'Credit Danimal https://opengameart.org/users/danimal and Atmostatic https://opengameart.org/users/atmostatic, CC-BY-SA 3.0, OGA https://opengameart.org. Adapted creature asset remains CC-BY-SA 3.0.',licenseUrl:'https://creativecommons.org/licenses/by-sa/3.0/'},
 {id:'beetle-golem-animated',name:'Beetle Golem [Animated]',author:'killyoverdrive; animation by Dm3d',source:'https://opengameart.org/content/beetle-golem-animated',license:'CC-BY-SA-3.0',sourceArchive:'BeetleGolem_v3.blend',archiveSha256:'cb730dd5dcf0f25835bd276dfd6bf38cb1d55a1d4ccefa7e94391ee0ce412c42',attribution:'Beetle Golem by killyoverdrive, animated by Dm3d. CC BY-SA 3.0. The adapted creature asset remains CC BY-SA 3.0.',licenseUrl:'https://creativecommons.org/licenses/by-sa/3.0/'},
 {id:'gavlig-lava-golem-clean',name:'Lava Golem — official clean source',author:'gavlig',source:'https://opengameart.org/content/lava-golem',license:'CC0-1.0',sourceArchive:'golem_clean.blend.zip',archiveSha256:'602e37e8baccc55b6d9778ee2844b27278f8818ddab2fbbaa0b14b0c43a17c81',textureRights:'Original supplied glow retained. Restricted external diffuse/normal/specular pack excluded; replacement rock maps are project-authored.'},
 {id:'forest-monster-current',name:'Forest Monster',author:'Čestmír Dammer (CDmir)',source:'https://opengameart.org/content/forest-monster',license:'CC0-1.0',sourceArchive:'forest-monster_0.7z',archiveSha256:'3378edfe2441d1cee93feeeb6e045b9ff0c700d85b398dfa6c29c83f7e696a5e'},
 {id:'earth-elemental-golem',name:'Earth Elemental / Golem',author:'piacenti',source:'https://opengameart.org/content/earth-elemental-golem',license:'CC-BY-3.0',sourceArchive:'earth elemental 1.1.zip',archiveSha256:'a3f76b3961cdf18073b5d2337450c5e9753722f71d9b6e811e42458023a491c8'},
];
export function derivativePack(provenance) {
  if (!provenance) throw new Error('Source-based bestiary export requires exact provenance');
  const text = JSON.stringify(provenance);
  const complete=completeSources.find(pack=>text.includes(pack.source));
  if(complete)return {...complete,id:`corealm-rpg-${complete.id}`,upstreamPackId:complete.id,derivation:'Complete original source body and rig retained; sourceProvenance records conversion and clip adaptations.'};
  const sourceId = /animated-easy-enemies/.test(text) ? easyEnemies.id : /Polygon Blacksmith|DungeonSkeleton/.test(text) ? skeleton.id
    : /PixeliusVita/.test(text) ? 'pixeliusvita-monster04'
    : /animal-pack-deluxe|janpec/.test(text) ? 'animal-pack-deluxe'
    : /Blink/.test(text) ? 'blink-free-rpg-weapons' : 'universal-base-characters';
  const source = sourceId === easyEnemies.id ? easyEnemies : sourceId === skeleton.id ? skeleton : manifest.packs.find(pack => pack.id === sourceId);
  if (!source) throw new Error(`Missing upstream source ${sourceId}`);
  return { ...source, id: `corealm-rpg-${source.id}`, name: `Corealm RPG derivatives — ${source.name}`,
    upstreamPackId: source.id, derivation: 'Corealm geometry, proportion, equipment and animation edits. Source rights retained; per-asset sourceProvenance lists all combined sources and modifications.',
    license: source.license.startsWith('Standard Unity Asset Store EULA') ? 'Standard Unity Asset Store EULA; additional components retain their per-asset source licenses; Corealm additions project-owned' : source.license };
}
