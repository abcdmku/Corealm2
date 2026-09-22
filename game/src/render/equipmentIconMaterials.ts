import * as THREE from "three";
import { color, float, materialColor, mix, smoothstep, texture, vec3 } from "three/tsl";
import { composeSurface, type SurfaceNodeMaterial } from "./nodeMaterials.js";

type Appearance = { assetId: string; itemId?: string; tint?: number; accent?: number };
type Palette = { wood: number; metal: number; leather: number; gem?: number; plate?: number };

// Colours follow the approved art/item-icons/256 references. Staff heads without an
// elemental charge retain their geometry, but their inserts read as dark wood.
const woods: Record<string, Palette> = {
  basic: { wood: 0x987044, metal: 0x776858, leather: 0x795433 },
  palewood: { wood: 0xd8b47b, metal: 0x9a927c, leather: 0x9b784b },
  duskoak: { wood: 0x66503b, metal: 0x777775, leather: 0x44382d },
  cairnpine: { wood: 0x916038, metal: 0x637785, leather: 0x61462e },
  cinderpine: { wood: 0x715039, metal: 0xa8aaa8, leather: 0x4c392b },
  teak: { wood: 0xb97936, metal: 0x64605a, leather: 0x46362a },
  magic: { wood: 0x635344, metal: 0x3c4a65, leather: 0x373039 },
};
const metals: Record<string, number> = {
  worn: 0x92918a, grithe: 0xd39569, corven: 0x979c9f, kaldite: 0x587fae,
  emberite: 0xbac0c6, cindersteel: 0x81766c, nightglass: 0x455b85,
};
const aliases: Record<string, string> = {
  ashseal_guard: "teak_shield", regent_staff: "teak_staff",
  chainbound_sword: "nightglass_sword", hollowstar_staff: "magic_staff",
};
const elements: Record<string, { wood: string; gem: number }> = {
  air: { wood: "palewood", gem: 0xd6fbff }, earth: { wood: "duskoak", gem: 0xb6bd73 },
  water: { wood: "cairnpine", gem: 0x479ee4 }, fire: { wood: "cinderpine", gem: 0xf88624 },
};

/** Material-only treatment for existing Corealm weapons. Call before surface grain. */
export function applyIconWeaponMaterials(material: SurfaceNodeMaterial, appearance: Appearance): void {
  if (appearance.assetId === "miniboss_staff" || appearance.assetId === "miniboss_sword") {
    applyImportedIconMaterial(material, appearance);
    return;
  }
  const match = /^corealm_(sword|dagger|shield|staff|wand)_([1-4])$/.exec(appearance.assetId);
  if (!match || !appearance.itemId) return;
  const shaded = material as THREE.MeshStandardMaterial;
  if (!shaded.isMeshStandardMaterial) return;
  const role = material.userData.equipmentRole as string | undefined;
  if (!role || !["metal", "blade", "wood", "leather", "gem"].includes(role)) return;
  const id = aliases[appearance.itemId] ?? appearance.itemId;
  const family = id.startsWith("basic_wooden_") ? "basic" : id.split("_")[0]!;
  const form = match[1];
  // This shield already passed the icon comparison; preserve its authored treatment.
  if (id === "cinderpine_shield") return;
  let palette: Palette;
  let elemental = false;
  if (form === "sword" || form === "dagger") {
    palette = { wood: 0x6e4d31, leather: family === "grithe" ? 0x6c432c : 0x45413b,
      metal: metals[family] ?? appearance.tint ?? 0x999999 };
    if (appearance.itemId === "chainbound_sword") palette.metal = appearance.tint ?? 0x8a94a6;
  } else {
    const element = elements[family];
    elemental = Boolean(element);
    palette = { ...(woods[element?.wood ?? family] ?? woods.basic!) };
    if (element) palette.gem = element.gem;
    if (family === "earth") Object.assign(palette, { wood: 0xb8ab90, metal: 0x95815a, leather: 0x51402e });
    if (form === "shield") {
      if (family === "palewood") Object.assign(palette, { wood: 0xddc398, metal: 0x90918d });
      if (family === "duskoak") Object.assign(palette, { wood: 0x716454, metal: 0x696b69 });
      if (family === "cairnpine") Object.assign(palette, { plate: 0x396cae, metal: 0x9ca6ae });
      if (family === "magic") Object.assign(palette, { plate: 0x34334f, metal: 0x7e859b });
    }
    if (appearance.itemId === "ashseal_guard") Object.assign(palette, { wood: 0x796149, metal: 0x7e7c75 });
    if (appearance.itemId === "regent_staff") palette.metal = 0xa68b63;
    if (appearance.itemId === "hollowstar_staff") Object.assign(palette, {
      wood: 0x393151, metal: 0x8794b3, leather: 0x302938, gem: 0xa297c8,
    });
  }
  let colour = palette.metal;
  let metallic = role === "metal" || role === "blade";
  if (role === "wood") {
    colour = palette.plate ?? palette.wood;
    if (palette.plate !== undefined) {
      // Refinish the existing board as plate. Its UV grain must not read through steel.
      material.userData.equipmentRole = "metal";
      shaded.map = null;
      metallic = true;
    }
  } else if (role === "leather") colour = palette.leather;
  else if (role === "gem") colour = palette.gem ?? new THREE.Color(palette.wood).multiplyScalar(0.22).getHex();
  shaded.color.setHex(colour);
  // The high grades bake blue into the vertex attribute. Keep that geometry intact,
  // but do not multiply a silver or copper finish by its former cobalt colour.
  shaded.vertexColors = false;
  shaded.metalness = metallic ? 0.48 : 0;
  shaded.roughness = metallic ? 0.38 : role === "leather" ? 0.85 : 0.65;
  if (role === "gem" && elemental) {
    shaded.metalness = 0.02;
    shaded.roughness = 0.22;
    shaded.emissive.setHex(appearance.accent ?? palette.gem!);
    shaded.emissiveIntensity = 0.18;
  } else {
    shaded.emissive.setHex(0);
    shaded.emissiveIntensity = 0;
    if (role === "gem" && "clearcoat" in shaded) (shaded as THREE.MeshPhysicalMaterial).clearcoat = 0;
  }
  const grain = shaded.map
    ? texture(shaded.map).rgb.dot(vec3(0.2126, 0.7152, 0.0722)).div(0.60).clamp(0.55, 1.30)
    : float(1);
  // The reviewed icon palette resolves after imported tier dyes, before surface grain.
  composeSurface(material, { color: () => color(colour).mul(grain) });
  material.userData.iconWeaponPalette = appearance.itemId;
  material.name += `|icon:${appearance.itemId}:${role}`;
  material.needsUpdate = true;
}

/** Imported boss meshes share one atlas and have no equipmentRole partitions. */
function applyImportedIconMaterial(material: SurfaceNodeMaterial, appearance: Appearance): void {
  const driftwood = appearance.itemId === "tideworn_staff" || appearance.itemId === "galeskin_staff";
  const titanium = appearance.itemId === "cinderwake_sword";
  const copper = appearance.itemId === "galeskin_sword";
  const moss = appearance.itemId === "mossbound_staff" || appearance.itemId === "mossbound_sword";
  if (!driftwood && !titanium && !copper && !moss) return;
  const staff = appearance.assetId === "miniboss_staff";
  const shaded = material as THREE.MeshStandardMaterial;
  if (!shaded.isMeshStandardMaterial) return;
  const colour = new THREE.Color(driftwood ? 0xc4beb0 : copper ? 0xd39369 : moss && staff ? 0x9b8a6c : 0xbcc1c8);
  shaded.color.setHex(0xffffff);
  shaded.vertexColors = false;
  if (!shaded.metalnessMap) shaded.metalness = staff ? 0.05 : 0.50;
  if (!shaded.roughnessMap) shaded.roughness = staff ? 0.76 : 0.37;
  // The atlas owns the emissive placement. A fire-coloured uniform must never
  // replace its mask or wash orange over the whole blade.
  shaded.emissive.setHex(shaded.emissiveMap ? (titanium ? 0xff781c : moss ? 0x6d922a : 0x849b9e) : 0);
  shaded.emissiveIntensity = shaded.emissiveMap ? (titanium ? 1.2 : moss ? 0.04 : 0) : 0;
  composeSurface(material, {
    color: () => {
      const detail = materialColor.rgb.dot(vec3(0.2126, 0.7152, 0.0722))
        .max(0.0001).div(0.18).pow(0.60).clamp(0.22, 1.30);
      const base = color(colour).mul(detail);
      if (!moss || !shaded.emissiveMap) return base;
      const mark = texture(shaded.emissiveMap).rgb;
      const mask = smoothstep(0.06, 0.50, mark.r.max(mark.g).max(mark.b));
      return mix(base, vec3(0.19, 0.29, 0.025).mul(detail), mask.mul(0.94));
    },
  });
  material.userData.iconWeaponPalette = appearance.itemId;
  material.name += `|icon:${appearance.itemId}`;
  material.needsUpdate = true;
}
