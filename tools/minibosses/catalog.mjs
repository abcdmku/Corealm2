/**
 * Which miniboss becomes which asset, and which named take answers which motion.
 *
 * ONE RIG, FOUR SKINS, same reading rule as the elemental bosses: the player learns a single
 * silhouette that says "miniboss" and the recolour says which flavour of trouble it is. Unlike the
 * bosses the CREATURES need no texture staging - the pack ships each variant as its own finished
 * PNG, so the four ids below simply point at four different files. The WEAPONS do (see
 * stage-textures.py): their maps are hue-neutralized so the runtime accent owns the colour.
 *
 * CLIP NAMING IS LOAD-BEARING, exactly as in `tools/animals/catalog.mjs`: `render/entityViews.ts`
 * picks clips by regex (idle /^idle/i, walk /^walk/i, attack /attack/i, death /^death/i), so the
 * canonical names on each entry are a contract. The pack spells death "Monster02_Die", which
 * matches nothing until it is renamed here.
 *
 * TAKES, NOT FILES. Every other pack this pipeline has eaten ships one take per FBX; this one
 * ships ONE FBX carrying eleven named AnimStacks. Each clip entry therefore uses the object form
 * `{ take, name }` and the converter resolves the AnimStack by name - a missing take fails that
 * clip's build outright rather than falling back to `animations[0]`, whose order in this file is
 * not even the authored order (measured: Idle, Attack02, Stunned, Die, ... - alphabetical nowhere).
 *
 * Five takes are left on the floor by design: `Attack02`/`Attack03` (the renderer knows one
 * attack), `Idle_v02` (one idle), `Shoot` (no projectile system on melee minibosses) and `Stunned`
 * (no stun state). `GetHit` ships as `Hit` for the day the renderer learns a flinch; it costs a
 * few keyframes and saves a rebuild.
 */

/**
 * Recorded in the manifest so the pack's provenance travels with the assets.
 *
 * Same shape and licence string as the other imported Unity packs - what
 * `content/validateGatheringProduction.ts` matches on. No archive hash:
 * there is no redistributable archive of ours to hash, so each asset row carries its own `sha256`
 * and `tools/build-assets.ts: preservedManifestRows` re-checks it against the file on disk.
 */
export const MINIBOSS_PACK = {
  id: "pixelius-fantasy-monster-02",
  name: "Fantasy Monster 3D Model 02 - Game Ready",
  author: "PixeliusVita",
  // TODO: pin the exact package URL once the purchasing account can be checked. This search URL
  // resolves to the product and is a real HTTPS source, but it is not the permanent product id.
  source: "https://assetstore.unity.com/?q=Fantasy%20Monster%203D%20Model%2002%20PixeliusVita",
  license: "Standard Unity Asset Store EULA; project owner must confirm entitlement",
};

export const SWORD_PACK = {
  id: "blink-free-low-poly-swords",
  name: "FREE - Low Poly Swords - RPG Weapons",
  author: "Blink",
  // TODO: pin the exact package URL once the purchasing account can be checked (same caveat as
  // above; Blink's other pack in this manifest, blink-free-rpg-weapons, IS pinned).
  source: "https://assetstore.unity.com/?q=FREE%20Low%20Poly%20Swords%20RPG%20Weapons",
  license: "Standard Unity Asset Store EULA; project owner must confirm entitlement",
};

export const STAFF_PACK = {
  id: "blink-free-stylized-weapons",
  name: "FREE - Stylized Weapons",
  author: "Blink",
  // TODO: pin the exact package URL once the purchasing account can be checked.
  source: "https://assetstore.unity.com/?q=FREE%20Stylized%20Weapons%20Blink",
  license: "Standard Unity Asset Store EULA; project owner must confirm entitlement",
};

/**
 * The rig measures 199.7 source units tall, so like the animal pack it is authored in centimetres
 * and the converter's plain CM_TO_M lands it at 2.00 m - between `animal_bear` (2.46 m long) and a
 * grown deer, which is exactly the "bigger than wildlife, smaller than an orb boss" slot a
 * miniboss occupies. No RHINO-style correction needed; measured, not assumed.
 */
const MONSTER_EXTRA_SCALE = 1;

/**
 * The six canonical clips, one per motion the game knows plus `Hit`. Shared verbatim by all four
 * variants because they are one rig; only the texture differs.
 */
const MONSTER_CLIPS = [
  { take: "Monster02_Idle", name: "Idle" },
  { take: "Monster02_Walk", name: "Walk" },
  { take: "Monster02_Run", name: "Run" },
  { take: "Monster02_Attack01", name: "Attack" },
  { take: "Monster02_GetHit", name: "Hit" },
  { take: "Monster02_Die", name: "Death" },
];

/**
 * Texture per variant. The plain `Monster02_ColorNN.png` files are the pack's primary palettes;
 * the lettered a-g siblings are further recolours and stay on the shelf.
 */
export const MINIBOSSES = [
  {
    id: "miniboss_galeskin",
    is: "galeskin",
    tags: ["miniboss", "galeskin", "air", "wind", "storm", "elemental", "monster", "territorial"],
    texture: "Monster02_Color06.png",
    extraScale: MONSTER_EXTRA_SCALE,
    clips: MONSTER_CLIPS,
  },
  {
    id: "miniboss_mossbound",
    is: "mossbound",
    tags: ["miniboss", "mossbound", "earth", "moss", "forest", "elemental", "monster", "territorial"],
    texture: "Monster02_Color02.png",
    extraScale: MONSTER_EXTRA_SCALE,
    clips: MONSTER_CLIPS,
  },
  {
    id: "miniboss_tideworn",
    is: "tideworn",
    tags: ["miniboss", "tideworn", "water", "tide", "coast", "elemental", "monster", "territorial"],
    texture: "Monster02_Color05.png",
    extraScale: MONSTER_EXTRA_SCALE,
    clips: MONSTER_CLIPS,
  },
  {
    id: "miniboss_cinderwake",
    is: "cinderwake",
    tags: ["miniboss", "cinderwake", "fire", "cinder", "ember", "elemental", "monster", "territorial"],
    texture: "Monster02_Color04.png",
    extraScale: MONSTER_EXTRA_SCALE,
    clips: MONSTER_CLIPS,
  },
];

/**
 * The two shared rare-weapon drops, built on the static path (no rig, no clips).
 *
 * SCALE IS MEASURED, per source, like RHINO_EXTRA_SCALE. The sword file is 2.35 m long at plain
 * CM_TO_M - a display piece, not a sidearm - and 0.5325 brings it to 1.25 m, the top of the
 * longsword band the task calls sane. The staff file is only 0.94 m and 1.8585 lifts it to 1.75 m,
 * matching `rpg_weapon_staff` at 2.21 m less its oversized headpiece.
 *
 * PIVOTS ARE KEPT, X/Z RECENTRED. Both meshes are authored blade/head up +Y with the origin at
 * the grip (the sword's crossguard sits exactly at y=0; the staff's origin is just under its
 * crystal), which is the same convention the imported `rpg_weapon_*` GLBs kept out of Unity. The
 * sword mesh is ALSO parked 2.2-2.6 units away on +X - its slot in the artist's lineup scene -
 * which `recenterXZ` discards while leaving the grip height alone.
 *
 * TEXTURES ARE HUE-NEUTRALIZED, not authored. One geometry serves every regional rare drop and
 * `render/equipmentVisuals.ts: tintedMaterial` recolours it by replacing `material.color` and
 * `material.emissive` with the region's accent - a multiply that cannot overrule a saturated
 * texel (cyan x Blink's orange crystal is still orange; measured in the lab as four fire-coloured
 * staves). `stage-textures.py` greys the albedo's hot regions and the whole emissive map, so the
 * accent owns the hue. The shipped emissive factor is white at 1.2 to match the intensity
 * `tintedMaterial` forces whenever an emissive map is present; the level the authored
 * _EmissionColor strengths (2.83 / 6.06) used to carry now lives in the normalized map itself.
 */
export const WEAPONS = [
  {
    id: "miniboss_sword",
    pack: SWORD_PACK.id,
    is: "sword",
    tags: ["sword", "melee", "one-handed", "equip", "rare-drop", "iron-variant", "hue-neutral"],
    mesh: "sword-pack/raw/Assets/Blink/Art/Weapons/LowPoly/FreeSwords/Sword15/Sword15_FBX.fbx",
    baseColor: "weapon-tex/miniboss_sword_basecolor.png",
    normal: "sword-pack/raw/Assets/Blink/Art/Weapons/LowPoly/FreeSwords/Sword15/Textures/Sword15_Normal_Iron.png",
    emissive: "weapon-tex/miniboss_sword_emissive.png",
    // White at the runtime's own 1.2: the hue and the level both belong to the accent + map now.
    emissiveColor: [1, 1, 1],
    emissiveIntensity: 1.2,
    // The albedo paints the metal's shading; scalar metalness stays low so the painted highlights
    // read instead of the environment. Matches how the Blink rpg_weapon_* materials behave in-game.
    roughness: 0.6,
    metalness: 0.2,
    extraScale: 0.5325,
    recenterXZ: true,
  },
  {
    id: "miniboss_staff",
    pack: STAFF_PACK.id,
    is: "staff",
    tags: ["staff", "magic", "two-handed", "equip", "rare-drop", "emissive", "hue-neutral"],
    mesh: "staff-pack/raw/Assets/Blink/Art/Weapons/Stylized/Staves/Meshes_Staves/STAFF_EVO_02_V2.fbx",
    baseColor: "weapon-tex/miniboss_staff_basecolor.png",
    normal: "staff-pack/raw/Assets/Blink/Art/Weapons/Stylized/Staves/Textures_Staves/Staff2_2_6_S06_Normal.png",
    emissive: "weapon-tex/miniboss_staff_emissive.png",
    // White at the runtime's own 1.2, same reasoning as the sword.
    emissiveColor: [1, 1, 1],
    emissiveIntensity: 1.2,
    roughness: 0.75,
    metalness: 0,
    extraScale: 1.8585,
    recenterXZ: false,
  },
];
