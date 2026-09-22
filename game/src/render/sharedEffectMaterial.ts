import type { Material } from 'three';

type Entry = { material: Material; references: number; key: string };
const recipes = new Map<string, Entry>();
const owners = new WeakMap<Material, Entry>();

/** A recipe owns one node graph; each draw still owns its uniforms and geometry bindings. */
export function acquireEffectMaterial<T extends Material>(key: string, create: () => T): T {
  let entry = recipes.get(key);
  if (!entry) {
    const material = create();
    entry = { material, references: 0, key };
    recipes.set(key, entry);
    owners.set(material, entry);
  }
  entry.references++;
  return entry.material as T;
}

export function releaseEffectMaterial(material: Material): void {
  const entry = owners.get(material);
  if (!entry || entry.references <= 0) throw new Error('Effect material has no live owner');
  if (--entry.references !== 0) return;
  recipes.delete(entry.key);
  owners.delete(material);
  material.dispose();
}
