export const SPECIES = ['cinder_ravager', 'basalt_drake', 'gorge_mantis', 'quarry_nightmare'];

export async function buildSpecies(id) {
  let result;
  if (id === 'cinder_ravager') result = await (await import('./monsters/cinder.mjs')).buildCinder();
  else if (id === 'basalt_drake') result = await (await import('./monsters/basalt.mjs')).buildBasalt();
  else if (id === 'gorge_mantis') result = await (await import('./monsters/mantis.mjs')).buildMantis();
  else if (id === 'quarry_nightmare') result = await (await import('./monsters/nightmare.mjs')).buildNightmare();
  else throw new Error(`Unknown monster species ${id}`);
  result.meta.provenance.license ??= 'Standard Unity Asset Store EULA';
  return result;
}
