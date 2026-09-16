import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/** The build guard validates this artifact against authored geometry before emitting its identity. */
export function releaseNavigationPlugin(): Plugin {
  const id = 'virtual:corealm-release-navigation', resolved = `\0${id}`;
  let root = '';
  return {name:'corealm-release-navigation',configResolved(config){root=config.root;},
    generateBundle() {
      this.emitFile({type:'asset',fileName:'generated/corealm-navmesh.nav',
        source:gzipSync(readFileSync(path.join(root,'public/generated/corealm-navmesh.bin')),{level:9})});
    },
    resolveId(source){if(source===id)return resolved;},
    load(source){
      if(source!==resolved)return;
      const manifest=JSON.parse(readFileSync(path.join(root,'public/generated/corealm-navmesh.json'),'utf8'));
      return `export default ${JSON.stringify({fingerprint:manifest.fingerprint,worldSeed:manifest.worldSeed,
        strategy:manifest.settings.strategy,sourceMeshes:manifest.sourceMeshes,sourceTriangles:manifest.sourceTriangles})};`;
    }};
}
