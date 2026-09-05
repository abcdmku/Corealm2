/**
 * Curates the downloaded Quaternius CC0 packs in .asset-cache/ into optimized,
 * self-contained GLB files under game/public/assets/models/<category>/, plus
 * game/public/assets/manifest.json which the game reads at runtime.
 *
 * Design notes:
 * - Reads straight out of the zips. Nothing is unpacked to disk, so a re-run
 *   costs nothing when the outputs are already current.
 * - No zip dependency: a minimal central-directory reader lives in this file,
 *   because the repo has no declared zip package and this tool may not add one.
 * - The legacy publication pipeline retains its original base-color-only policy.
 *   --stage-materials restores authored PBR maps in a separate, selected output
 *   tree without geometry transforms or production publication.
 * - Idempotent: a state file records the inputs and options that produced each
 *   GLB. Unchanged entries are reused and their measured metadata is replayed
 *   into the manifest, so nothing is rebuilt or corrupted on a second run.
 *
 * Usage:
 *   npx tsx tools/build-assets.ts            build (incremental)
 *   npx tsx tools/build-assets.ts --force    rebuild everything
 *   npx tsx tools/build-assets.ts --check    confirm every catalog source exists
 *   npx tsx tools/build-assets.ts --verify   parse every manifest GLB and report
 *   npx tsx tools/build-assets.ts --metrics  re-measure size/base from source, no rebuild
 *   npx tsx tools/build-assets.ts --metrics --write   ...and write them into the manifest
 *   npx tsx tools/build-assets.ts --probe <zip-key> <substring>   inspect sources
 *   npx tsx tools/build-assets.ts --stage-materials --only wall_brick_straight,sword --out test-results/material-restoration/representatives
 *   npx tsx tools/build-assets.ts --stage-materials --shared-textures --only-pack medieval-village-megakit --out test-results/material-restoration/shared-village
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, mkdir, readFile, writeFile, rm, readdir, stat, rename, cp } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { Document, Logger, NodeIO, type Accessor, type JSONDocument, type TypedArray } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, resample, quantize, textureCompress, getBounds } from "@gltf-transform/functions";
import sharp from "sharp";
import { repoRoot, gameRoot } from "./lib/paths.js";
import {
  MATERIAL_RESTORATION_VERSION,
  restoreSourceMaterialTextures,
  type MaterialTexturePolicy,
} from "./lib/asset-material-restoration.js";
import { externalizeGlbMaterialTextures } from "./lib/shared-material-textures.js";

// ---------------------------------------------------------------------------
// Minimal ZIP reader (central directory + per-entry inflate, ZIP64 aware)
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  method: number;
  /** CRC-32 from the central directory: a free content fingerprint. */
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;

class ZipArchive {
  private constructor(
    readonly file: string,
    private readonly handle: FileHandle,
    readonly entries: Map<string, ZipEntry>,
  ) {}

  static async open(file: string): Promise<ZipArchive> {
    const handle = await open(file, "r");
    try {
      const size = (await handle.stat()).size;
      const tailLength = Math.min(size, 66_560);
      const tail = Buffer.alloc(tailLength);
      await handle.read(tail, 0, tailLength, size - tailLength);

      let eocd = -1;
      for (let i = tail.length - 22; i >= 0; i -= 1) {
        if (tail.readUInt32LE(i) === SIG_EOCD) {
          eocd = i;
          break;
        }
      }
      if (eocd < 0) throw new Error(`Not a zip file (no end-of-central-directory): ${file}`);

      let count = tail.readUInt16LE(eocd + 10);
      let centralOffset = tail.readUInt32LE(eocd + 16);
      let centralSize = tail.readUInt32LE(eocd + 12);

      if (count === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
        let locator = -1;
        for (let i = eocd - 20; i >= 0; i -= 1) {
          if (tail.readUInt32LE(i) === SIG_EOCD64_LOCATOR) {
            locator = i;
            break;
          }
        }
        if (locator < 0) throw new Error(`ZIP64 archive without a locator: ${file}`);
        const eocd64Offset = Number(tail.readBigUInt64LE(locator + 8));
        const header = Buffer.alloc(56);
        await handle.read(header, 0, 56, eocd64Offset);
        if (header.readUInt32LE(0) !== SIG_EOCD64) throw new Error(`Bad ZIP64 record: ${file}`);
        count = Number(header.readBigUInt64LE(32));
        centralSize = Number(header.readBigUInt64LE(40));
        centralOffset = Number(header.readBigUInt64LE(48));
      }

      const central = Buffer.alloc(centralSize);
      await handle.read(central, 0, centralSize, centralOffset);

      const entries = new Map<string, ZipEntry>();
      let cursor = 0;
      for (let i = 0; i < count; i += 1) {
        if (central.readUInt32LE(cursor) !== SIG_CENTRAL) break;
        const method = central.readUInt16LE(cursor + 10);
        const crc = central.readUInt32LE(cursor + 16);
        let compressedSize = central.readUInt32LE(cursor + 20);
        let uncompressedSize = central.readUInt32LE(cursor + 24);
        const nameLength = central.readUInt16LE(cursor + 28);
        const extraLength = central.readUInt16LE(cursor + 30);
        const commentLength = central.readUInt16LE(cursor + 32);
        let localHeaderOffset = central.readUInt32LE(cursor + 42);
        const name = central.toString("utf8", cursor + 46, cursor + 46 + nameLength);

        // ZIP64 extended information overrides the 0xFFFFFFFF placeholders.
        const extraStart = cursor + 46 + nameLength;
        let extra = extraStart;
        while (extra + 4 <= extraStart + extraLength) {
          const fieldId = central.readUInt16LE(extra);
          const fieldSize = central.readUInt16LE(extra + 2);
          if (fieldId === 0x0001) {
            let field = extra + 4;
            if (uncompressedSize === 0xffffffff) {
              uncompressedSize = Number(central.readBigUInt64LE(field));
              field += 8;
            }
            if (compressedSize === 0xffffffff) {
              compressedSize = Number(central.readBigUInt64LE(field));
              field += 8;
            }
            if (localHeaderOffset === 0xffffffff) localHeaderOffset = Number(central.readBigUInt64LE(field));
          }
          extra += 4 + fieldSize;
        }

        if (!name.endsWith("/")) {
          entries.set(name, { name, method, crc, compressedSize, uncompressedSize, localHeaderOffset });
        }
        cursor = extraStart + extraLength + commentLength;
      }
      return new ZipArchive(file, handle, entries);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async read(name: string): Promise<Buffer> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Missing zip entry: ${name} (in ${path.basename(this.file)})`);
    const local = Buffer.alloc(30);
    await this.handle.read(local, 0, 30, entry.localHeaderOffset);
    const nameLength = local.readUInt16LE(26);
    const extraLength = local.readUInt16LE(28);
    const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
    const raw = Buffer.alloc(entry.compressedSize);
    await this.handle.read(raw, 0, entry.compressedSize, dataOffset);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return zlib.inflateRawSync(raw);
    throw new Error(`Unsupported zip compression method ${entry.method} for ${name}`);
  }

  close(): Promise<void> {
    return this.handle.close();
  }
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

interface PackDef {
  id: string;
  name: string;
  author: string;
  source: string;
  license: string;
  /** SHA-256 of the complete source archive. This pins the exact CC0 input. */
  archiveSha256: string;
  zip: string;
  /** Directory inside the zip that holds the source files, used for catalog paths. */
  root: string;
  /** OBJ packs pass through the pinned in-repo converter before normal optimization. */
  sourceFormat?: "gltf" | "obj";
}

const PACKS: PackDef[] = [
  {
    id: "stylized-nature-megakit",
    name: "Stylized Nature MegaKit",
    author: "Quaternius",
    source: "https://quaternius.itch.io/stylized-nature-megakit",
    license: "CC0-1.0",
    archiveSha256: "298f6732b872e4cf7b30e6e7abf9641c7f6dc6b326df37ac089533ed7e3d58c9",
    zip: "Stylized_Nature_MegaKit[Standard].zip",
    root: "glTF/",
  },
  {
    id: "medieval-village-megakit",
    name: "Medieval Village MegaKit",
    author: "Quaternius",
    source: "https://quaternius.itch.io/medieval-village-megakit",
    license: "CC0-1.0",
    archiveSha256: "e60dea67c10f30dccccfbff92a7933f5ea5cfe99be0e2a0fa5118cceabeec5c4",
    zip: "Medieval_Village_MegaKit[Standard].zip",
    root: "Medieval Village MegaKit[Standard]/glTF/",
  },
  {
    id: "fantasy-props-megakit",
    name: "Fantasy Props MegaKit",
    author: "Quaternius",
    source: "https://quaternius.itch.io/fantasy-props-megakit",
    license: "CC0-1.0",
    archiveSha256: "8b6f7e806d222e585478f0e1bdc6b271bbc7bc6f84dd6af8ca703a7c64f0cb1e",
    zip: "Fantasy_Props_MegaKit[Standard].zip",
    root: "Exports/glTF/",
  },
  {
    id: "universal-base-characters",
    name: "Universal Base Characters",
    author: "Quaternius",
    source: "https://quaternius.itch.io/universal-base-characters",
    license: "CC0-1.0",
    archiveSha256: "fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40",
    zip: "Universal_Base_Characters[Standard].zip",
    root: "Universal Base Characters[Standard]/",
  },
  {
    id: "modular-character-outfits-fantasy",
    name: "Modular Character Outfits - Fantasy",
    author: "Quaternius",
    source: "https://quaternius.itch.io/modular-character-outfits-fantasy",
    license: "CC0-1.0",
    archiveSha256: "c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70",
    zip: "Modular_Character_Outfits_-_Fantasy[Standard].zip",
    root: "Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/",
  },
  {
    id: "modular-character-outfits-fantasy-source",
    name: "Modular Character Outfits - Fantasy (Source edition)",
    author: "Quaternius",
    source: "https://quaternius.itch.io/modular-character-outfits-fantasy",
    license: "CC0-1.0",
    archiveSha256: "c1bdaa7c79bb43e8f082f8484a841ac8ec8afa0295a9cfa7e9b101cd0cd32cab",
    zip: "Modular_Character_Outfits_-_Fantasy[Source].zip",
    root: "Modular Character Outfits - Fantasy[Source]/Exports/glTF (Godot-Unreal)/",
  },
  {
    id: "ultimate-platformer-pack",
    name: "Ultimate Platformer Pack",
    author: "Quaternius",
    source: "https://quaternius.itch.io/ultimate-platformer-pack",
    license: "CC0-1.0",
    archiveSha256: "2d0cac0f3cb58f6845f779a4c6b4a92be6fa27d118ee0b976ead55c6834a53d4",
    zip: "Ultimate_Platformer_Pack_by_Quaternius.zip",
    root: "Ultimate Platformer Pack - Dec 2021/",
  },
  {
    id: "universal-animation-library",
    name: "Universal Animation Library",
    author: "Quaternius",
    source: "https://quaternius.itch.io/universal-animation-library",
    license: "CC0-1.0",
    archiveSha256: "cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724",
    zip: "Universal_Animation_Library[Standard].zip",
    root: "Universal Animation Library[Standard]/Unreal-Godot/",
  },
  {
    id: "universal-animation-library-2",
    name: "Universal Animation Library 2",
    author: "Quaternius",
    source: "https://quaternius.itch.io/universal-animation-library-2",
    license: "CC0-1.0",
    archiveSha256: "4008ea208a604773a2b2177d965f0f5d3195498b5bf838c3f5785d68e95f2a68",
    zip: "Universal_Animation_Library_2[Standard].zip",
    root: "Universal Animation Library 2[Standard]/Unreal-Godot/",
  },
  {
    id: "ultimate-nature-pack",
    name: "Ultimate Nature Pack",
    author: "Quaternius",
    source: "https://quaternius.com/packs/ultimatenature.html",
    license: "CC0-1.0",
    archiveSha256: "865e4ae735116181923fe6ace410da3cec29e814935dc90fb298e0af3a4ff869",
    zip: "Ultimate_Nature_Pack_by_Quaternius.zip",
    root: "OBJ/",
    sourceFormat: "obj",
  },
  {
    id: "animated-fish-pack",
    name: "Animated Fish Pack",
    author: "Quaternius",
    source: "https://quaternius.com/packs/animatedfish.html",
    license: "CC0-1.0",
    archiveSha256: "1fc56d63ae16497add1c187d8bafb430f4d0a1e6d89e04396d23f4b58519ac1c",
    zip: "Fish_Pack_Animated_by_Quaternius.zip",
    root: "OBJ/",
    sourceFormat: "obj",
  },
];

const PACK_BY_ID = new Map(PACKS.map((pack) => [pack.id, pack]));

type Category =
  | "nature"
  | "rock"
  | "building"
  | "prop"
  | "farm"
  | "dungeon"
  | "character"
  | "outfit"
  | "weapon"
  | "animation"
  | "water";

interface Pick {
  id: string;
  pack: string;
  /** Path relative to the pack root, without extension. */
  file: string;
  category: Category;
  tags: string[];
  /** Animation clip libraries keep their animations and lose their mesh. */
  animationLibrary?: boolean;
  /** Runtime-reachable clips to retain when this pick is an animation library. */
  animationClips?: readonly string[];
  /** Max texture edge; defaults to 512. */
  textureLimit?: number;
}

// ---------------------------------------------------------------------------
// Catalog
//
// Every entry below was chosen against the Phase 1 needs list.
//
// TAG ORDER IS A CONTRACT. The FIRST tag is what the mesh IS, and it is
// published separately as the manifest's `is` field. Every tag after it is an
// association: what the mesh contains, what it stands on, what it is used for,
// how it should be recoloured.
//
// This distinction cost a full round to learn. `anvil_log` is
// ["anvil", "log", "stump", ...] because it is an anvil standing on a cut log.
// Phase 1 read "stump" off that list, and every felled tree in the world plus
// the landmark Rootfall is built around became a blacksmith's anvil. Adding a
// tag that describes a PART of the mesh is fine and useful; putting it first,
// or reading anything but the first as identity, is the bug.
//
// Look things up with `assets.byIs("stump")`, never `assets.byTags("stump")`.
// ---------------------------------------------------------------------------

const nature = (file: string, id: string, tags: string[], category: Category = "nature"): Pick => ({
  id,
  pack: "stylized-nature-megakit",
  file,
  category,
  tags,
});
const village = (file: string, id: string, category: Category, tags: string[]): Pick => ({
  id,
  pack: "medieval-village-megakit",
  file,
  category,
  tags,
});
const props = (file: string, id: string, category: Category, tags: string[]): Pick => ({
  id,
  pack: "fantasy-props-megakit",
  file,
  category,
  tags,
});
const platformer = (file: string, id: string, category: Category, tags: string[]): Pick => ({
  id,
  pack: "ultimate-platformer-pack",
  file,
  category,
  tags,
});
const ultimateNature = (file: string, id: string, tags: string[]): Pick => ({
  id,
  pack: "ultimate-nature-pack",
  file,
  category: "nature",
  tags,
});
const animatedFish = (file: string, id: string, tags: string[]): Pick => ({
  id,
  pack: "animated-fish-pack",
  file,
  category: "nature",
  tags,
});

const CATALOG: Pick[] = [
  // --- nature: trees -------------------------------------------------------
  nature("CommonTree_1", "tree_common_1", ["tree", "broadleaf", "common", "forest", "plains"]),
  nature("CommonTree_2", "tree_common_2", ["tree", "broadleaf", "common", "forest", "plains"]),
  nature("CommonTree_3", "tree_common_3", ["tree", "broadleaf", "common", "forest", "plains"]),
  nature("CommonTree_4", "tree_common_4", ["tree", "broadleaf", "common", "forest", "plains"]),
  nature("CommonTree_5", "tree_common_5", ["tree", "broadleaf", "common", "forest", "plains"]),
  nature("Pine_1", "tree_pine_1", ["tree", "pine", "conifer", "woodland", "highlands"]),
  nature("Pine_2", "tree_pine_2", ["tree", "pine", "conifer", "woodland", "highlands"]),
  nature("Pine_3", "tree_pine_3", ["tree", "pine", "conifer", "woodland", "highlands"]),
  nature("Pine_4", "tree_pine_4", ["tree", "pine", "conifer", "woodland", "highlands"]),
  nature("Pine_5", "tree_pine_5", ["tree", "pine", "conifer", "woodland", "highlands"]),
  nature("DeadTree_1", "tree_dead_1", ["tree", "dead", "bare", "woodland", "dungeon"]),
  nature("DeadTree_2", "tree_dead_2", ["tree", "dead", "bare", "woodland", "dungeon"]),
  nature("DeadTree_3", "tree_dead_3", ["tree", "dead", "bare", "woodland", "dungeon"]),
  nature("DeadTree_4", "tree_dead_4", ["tree", "dead", "bare", "woodland", "dungeon"]),
  nature("DeadTree_5", "tree_dead_5", ["tree", "dead", "bare", "woodland", "dungeon"]),
  nature("TwistedTree_1", "tree_twisted_1", ["tree", "twisted", "gnarled", "woodland", "deep-woodland"]),
  nature("TwistedTree_2", "tree_twisted_2", ["tree", "twisted", "gnarled", "woodland", "deep-woodland"]),
  nature("TwistedTree_3", "tree_twisted_3", ["tree", "twisted", "gnarled", "woodland", "deep-woodland"]),
  nature("TwistedTree_4", "tree_twisted_4", ["tree", "twisted", "gnarled", "woodland", "deep-woodland"]),
  nature("TwistedTree_5", "tree_twisted_5", ["tree", "twisted", "gnarled", "woodland", "deep-woodland"]),

  // --- nature: authored depleted trees and loose campfire fuel ------------
  ultimateNature("TreeStump", "nature_tree_stump", ["stump", "tree", "depleted", "palewood"]),
  ultimateNature("TreeStump_Moss", "nature_tree_stump_moss", ["stump", "tree", "depleted", "moss", "duskoak"]),
  ultimateNature("TreeStump_Snow", "nature_tree_stump_snow", ["stump", "tree", "depleted", "snow", "cairnpine"]),
  ultimateNature("WoodLog", "nature_wood_log", ["log", "wood", "campfire", "palewood"]),
  ultimateNature("WoodLog_Moss", "nature_wood_log_moss", ["log", "wood", "campfire", "moss", "duskoak"]),
  ultimateNature("WoodLog_Snow", "nature_wood_log_snow", ["log", "wood", "campfire", "snow", "cairnpine"]),

  // --- nature: fishing schools --------------------------------------------
  animatedFish("Fish1", "fish_minnow", ["fish", "minnow", "fishing", "school", "water"]),
  animatedFish("Fish2", "fish_trout", ["fish", "trout", "fishing", "school", "water"]),
  animatedFish("Fish3", "fish_cragfin", ["fish", "cragfin", "fishing", "school", "water"]),

  // --- nature: undergrowth -------------------------------------------------
  nature("Bush_Common", "bush_common", ["bush", "shrub", "undergrowth"]),
  nature("Bush_Common_Flowers", "bush_flowering", ["bush", "shrub", "flower", "undergrowth"]),
  nature("Fern_1", "fern_1", ["fern", "undergrowth", "woodland"]),
  nature("Plant_1", "plant_leafy_small", ["plant", "leafy", "undergrowth"]),
  nature("Plant_1_Big", "plant_leafy_large", ["plant", "leafy", "undergrowth"]),
  nature("Plant_7", "plant_broad_small", ["plant", "broadleaf", "undergrowth"]),
  nature("Plant_7_Big", "plant_broad_large", ["plant", "broadleaf", "undergrowth"]),
  nature("Grass_Common_Short", "grass_common_short", ["grass", "ground-cover", "plains"]),
  nature("Grass_Common_Tall", "grass_common_tall", ["grass", "ground-cover", "plains"]),
  nature("Grass_Wispy_Short", "grass_wispy_short", ["grass", "ground-cover", "plains"]),
  nature("Grass_Wispy_Tall", "grass_wispy_tall", ["grass", "ground-cover", "plains"]),
  nature("Clover_1", "clover_1", ["clover", "ground-cover", "plains"]),
  nature("Clover_2", "clover_2", ["clover", "ground-cover", "plains"]),
  nature("Flower_3_Single", "flower_a_single", ["flower", "ground-cover", "plains"]),
  nature("Flower_3_Group", "flower_a_group", ["flower", "ground-cover", "plains"]),
  nature("Flower_4_Single", "flower_b_single", ["flower", "ground-cover", "plains"]),
  nature("Flower_4_Group", "flower_b_group", ["flower", "ground-cover", "plains"]),
  nature("Mushroom_Common", "mushroom_common", ["mushroom", "forage", "woodland", "gatherable"]),
  nature("Mushroom_Laetiporus", "mushroom_bracket", ["mushroom", "forage", "woodland", "gatherable"]),

  // --- rock: loose stone, boulders, ore hosts ------------------------------
  nature("Rock_Medium_1", "rock_medium_1", ["rock", "stone", "ore", "ore-node", "minable", "recolour"], "rock"),
  nature("Rock_Medium_2", "rock_medium_2", ["rock", "stone", "ore", "ore-node", "minable", "recolour"], "rock"),
  nature("Rock_Medium_3", "rock_medium_3", ["rock", "stone", "ore", "ore-node", "minable", "recolour"], "rock"),
  nature("Pebble_Square_1", "rock_small_1", ["rock", "stone", "pebble", "small", "ore-node", "recolour"], "rock"),
  nature("Pebble_Square_4", "rock_small_2", ["rock", "stone", "pebble", "small", "ore-node", "recolour"], "rock"),
  nature("Pebble_Round_2", "pebble_round_1", ["rock", "stone", "pebble", "scatter"], "rock"),
  nature("Pebble_Round_5", "pebble_round_2", ["rock", "stone", "pebble", "scatter"], "rock"),
  nature("RockPath_Round_Wide", "path_rock_round_wide", ["path", "road", "ground", "stone"], "rock"),
  nature("RockPath_Round_Thin", "path_rock_round_thin", ["path", "road", "ground", "stone"], "rock"),
  nature("RockPath_Square_Wide", "path_rock_square_wide", ["path", "road", "ground", "stone"], "rock"),
  nature("RockPath_Square_Thin", "path_rock_square_thin", ["path", "road", "ground", "stone"], "rock"),
  nature("RockPath_Round_Small_1", "path_rock_small_1", ["path", "road", "ground", "stone"], "rock"),
  nature("RockPath_Square_Small_2", "path_rock_small_2", ["path", "road", "ground", "stone"], "rock"),

  // --- rock: cliffs and boulders (platformer pack; chunkier silhouettes) ----
  platformer("Nature/glTF/RockPlatforms_Large", "boulder_large", "rock", [
    "boulder", "cliff", "rock", "highlands", "large", "placeholder-style",
  ]),
  platformer("Nature/glTF/RockPlatforms_Medium", "boulder_medium", "rock", [
    "boulder", "cliff", "rock", "highlands", "placeholder-style",
  ]),
  platformer("Nature/glTF/RockPlatform_Tall", "cliff_tall", "rock", [
    "cliff", "boulder", "rock", "highlands", "tall", "placeholder-style",
  ]),
  platformer("Nature/glTF/RockPlatforms_1", "cliff_step_1", "rock", ["cliff", "rock", "highlands", "placeholder-style"]),
  platformer("Nature/glTF/RockPlatforms_2", "cliff_step_2", "rock", ["cliff", "rock", "highlands", "placeholder-style"]),
  platformer("Nature/glTF/RockPlatforms_3", "cliff_step_3", "rock", ["cliff", "rock", "highlands", "placeholder-style"]),
  platformer("Level and Mechanics/glTF/Bridge_Small", "bridge_small", "building", [
    "bridge", "crossing", "water", "river", "wood", "placeholder-style",
  ]),
  platformer("Level and Mechanics/glTF/Bridge_Modular", "bridge_modular_end", "building", [
    "bridge", "crossing", "water", "river", "wood", "modular", "placeholder-style",
  ]),
  platformer("Level and Mechanics/glTF/Bridge_Modular_Center", "bridge_modular_center", "building", [
    "bridge", "crossing", "water", "river", "wood", "modular", "placeholder-style",
  ]),
  platformer("Powerups and Pickups/glTF/Gem_Blue", "ore_crystal_blue", "rock", [
    "ore", "ore-node", "crystal", "gem", "minable", "recolour", "placeholder-style",
  ]),
  platformer("Powerups and Pickups/glTF/Gem_Green", "ore_crystal_green", "rock", [
    "ore", "ore-node", "crystal", "gem", "minable", "recolour", "placeholder-style",
  ]),
  platformer("Powerups and Pickups/glTF/Gem_Pink", "ore_crystal_pink", "rock", [
    "ore", "ore-node", "crystal", "gem", "minable", "recolour", "placeholder-style",
  ]),

  // --- building: modular village shell -------------------------------------
  village("Wall_Plaster_Straight", "wall_plaster_straight", "building", ["wall", "plaster", "house", "modular", "village"]),
  village("Wall_Plaster_Straight_Base", "wall_plaster_base", "building", ["wall", "plaster", "house", "modular", "village"]),
  village("Wall_Plaster_Door_Round", "wall_plaster_door", "building", ["wall", "door", "plaster", "house", "modular"]),
  village("Wall_Plaster_Window_Wide_Round", "wall_plaster_window", "building", ["wall", "window", "plaster", "house", "modular"]),
  village("Wall_Plaster_WoodGrid", "wall_plaster_timber", "building", ["wall", "timber", "plaster", "house", "modular"]),
  village("Wall_UnevenBrick_Straight", "wall_brick_straight", "building", ["wall", "brick", "stone", "modular", "dungeon", "tower"]),
  village("Wall_UnevenBrick_Door_Round", "wall_brick_door", "building", ["wall", "door", "brick", "stone", "modular", "dungeon"]),
  village("Wall_UnevenBrick_Window_Wide_Round", "wall_brick_window", "building", ["wall", "window", "brick", "stone", "modular"]),
  village("Wall_Arch", "wall_arch", "dungeon", ["arch", "stone", "gate", "gateway", "dungeon", "ruins", "modular"]),
  village("Wall_BottomCover", "wall_bottom_trim", "building", ["wall", "trim", "modular"]),
  village("Corner_Exterior_Brick", "corner_brick", "building", ["corner", "brick", "stone", "modular", "dungeon"]),
  village("Corner_Exterior_Wood", "corner_wood", "building", ["corner", "timber", "modular"]),
  village("Corner_Interior_Small", "corner_interior", "building", ["corner", "interior", "modular"]),
  village("Door_1_Round", "door_round_1", "building", ["door", "entrance", "house"]),
  village("Door_4_Round", "door_round_2", "building", ["door", "entrance", "house", "shop"]),
  village("Door_8_Flat", "door_flat_1", "building", ["door", "entrance", "house"]),
  village("DoorFrame_Round_WoodDark", "door_frame_round", "building", ["door", "frame", "entrance", "modular"]),
  village("Window_Wide_Round1", "window_wide", "building", ["window", "house", "modular"]),
  village("Window_Thin_Round1", "window_thin", "building", ["window", "house", "modular"]),
  village("WindowShutters_Wide_Round_Open", "window_shutters", "building", ["window", "shutters", "house"]),
  village("Roof_RoundTiles_6x8", "roof_tiles_6x8", "building", ["roof", "tiles", "house", "modular"]),
  village("Roof_RoundTiles_6x12", "roof_tiles_6x12", "building", ["roof", "tiles", "house", "modular"]),
  village("Roof_RoundTiles_4x6", "roof_tiles_4x6", "building", ["roof", "tiles", "cottage", "modular"]),
  village("Roof_Front_Brick6", "roof_gable_brick", "building", ["roof", "gable", "brick", "modular"]),
  village("Roof_Wooden_2x1", "roof_wood_plank", "building", ["roof", "wood", "shed", "stall", "modular"]),
  village("Roof_Tower_RoundTiles", "roof_tower", "building", ["roof", "tower", "spire", "tiles"]),
  village("Roof_Dormer_RoundTile", "roof_dormer", "building", ["roof", "dormer", "house"]),
  village("Roof_Log", "roof_log", "building", ["log", "beam", "timber", "roof"]),
  village("Floor_WoodDark", "floor_wood", "building", ["floor", "wood", "plank", "dock", "pier", "modular"]),
  village("Floor_WoodLight", "floor_wood_light", "building", ["floor", "wood", "plank", "dock", "pier", "modular"]),
  village("Floor_Brick", "floor_brick", "building", ["floor", "brick", "road", "path", "modular", "dungeon"]),
  village("Floor_UnevenBrick", "floor_cobble", "building", ["floor", "cobble", "road", "path", "modular", "dungeon"]),
  village("Balcony_Simple_Straight", "balcony_straight", "building", ["balcony", "railing", "modular"]),
  village("Balcony_Simple_Corner", "balcony_corner", "building", ["balcony", "railing", "modular"]),
  village("Stairs_Exterior_Straight", "stairs_exterior", "building", ["stairs", "steps", "modular"]),
  village("Stair_Interior_Solid", "stairs_stone", "building", ["stairs", "steps", "stone", "dungeon", "modular"]),
  village("Overhang_Roof_UnevenBricks", "overhang_brick", "building", ["overhang", "brick", "trim", "modular"]),
  village("Overhang_Plaster_Long", "overhang_plaster", "building", ["overhang", "plaster", "trim", "modular"]),

  // --- village props from the village kit ----------------------------------
  village("Prop_WoodenFence_Single", "fence_wood_single", "prop", ["fence", "wood", "farm", "village"]),
  village("Prop_WoodenFence_Extension1", "fence_wood_extension", "prop", ["fence", "wood", "farm", "village"]),
  village("Prop_MetalFence_Simple", "fence_metal", "prop", ["fence", "metal", "railing", "village"]),
  village("Prop_MetalFence_Ornament", "fence_metal_ornate", "prop", ["fence", "metal", "gate", "railing", "village"]),
  village("Prop_Wagon", "wagon", "prop", ["wagon", "cart", "market", "village"]),
  village("Prop_Crate", "crate_village", "prop", ["crate", "box", "storage", "village"]),
  village("Prop_Chimney", "chimney", "prop", ["chimney", "roof", "house"]),
  village("Prop_Support", "support_beam", "prop", ["beam", "post", "pillar", "support", "dock", "pier", "dungeon"]),
  village("Prop_Brick1", "rubble_brick_1", "dungeon", ["rubble", "brick", "debris", "ruins", "dungeon"]),
  village("Prop_Brick2", "rubble_brick_2", "dungeon", ["rubble", "brick", "debris", "ruins", "dungeon"]),
  village("Prop_Brick3", "rubble_brick_3", "dungeon", ["rubble", "brick", "debris", "ruins", "dungeon"]),
  village("Prop_Brick4", "rubble_brick_4", "dungeon", ["rubble", "brick", "debris", "ruins", "dungeon"]),
  village("Prop_Vine1", "vine_1", "nature", ["vine", "ivy", "overgrowth", "ruins", "dungeon"]),
  village("Prop_Vine5", "vine_2", "nature", ["vine", "ivy", "overgrowth", "ruins", "dungeon"]),
  village("Prop_ExteriorBorder_Straight1", "kerb_straight", "building", ["kerb", "border", "road", "path", "modular"]),
  village("Prop_ExteriorBorder_Corner", "kerb_corner", "building", ["kerb", "border", "road", "path", "modular"]),

  // --- props: town, crafting, shop -----------------------------------------
  props("Anvil", "anvil", "prop", ["anvil", "smithing", "forge", "crafting", "station"]),
  props("Anvil_Log", "anvil_log", "prop", ["anvil", "log", "stump", "smithing", "forge", "crafting"]),
  props("Workbench", "workbench", "prop", ["workbench", "crafting", "station", "carpentry"]),
  props("Workbench_Drawers", "workbench_drawers", "prop", ["workbench", "crafting", "station", "carpentry"]),
  props("Cauldron", "cauldron", "prop", ["cauldron", "cooking", "pot", "campfire", "station", "alchemy"]),
  props("Pot_1", "cooking_pot", "prop", ["pot", "cooking", "campfire", "kitchen"]),
  // Ships Chest_Open/Close/Opened/Closed clips, so it works as a real bank UI prop.
  props("Chest_Wood", "chest_wood", "prop", ["chest", "bank", "storage", "loot", "container", "animated"]),
  props("Stall_Empty", "market_stall", "prop", ["stall", "market", "shop", "vendor", "counter"]),
  props("Stall_Cart_Empty", "market_stall_cart", "prop", ["stall", "cart", "market", "shop", "vendor"]),
  props("Table_Large", "table_large", "prop", ["table", "counter", "shop", "tavern", "furniture"]),
  props("Bench", "bench", "prop", ["bench", "seat", "furniture", "village"]),
  props("Stool", "stool", "prop", ["stool", "seat", "furniture"]),
  props("Chair_1", "chair", "prop", ["chair", "seat", "furniture"]),
  props("Barrel", "barrel", "prop", ["barrel", "storage", "container", "village", "dock", "fishing"]),
  props("Barrel_Apples", "barrel_apples", "prop", ["barrel", "apples", "food", "market", "farm"]),
  props("Barrel_Holder", "barrel_rack", "prop", ["barrel", "rack", "storage", "tavern"]),
  props("Crate_Wooden", "crate_wood", "prop", ["crate", "box", "storage", "container", "dock"]),
  props("Crate_Metal", "crate_metal", "prop", ["crate", "box", "storage", "container", "dungeon"]),
  props("Bag", "sack", "prop", ["sack", "bag", "storage", "market", "farm"]),
  props("Pouch_Large", "sack_large", "prop", ["sack", "pouch", "storage", "market", "farm"]),
  props("Bucket_Wooden_1", "bucket_wood", "prop", ["bucket", "well", "water", "farm"]),
  props("Bucket_Metal", "bucket_metal", "prop", ["bucket", "well", "water", "farm"]),
  props("Banner_1", "banner_1", "prop", ["banner", "flag", "heraldry", "village", "recolour"]),
  props("Banner_2", "banner_2", "prop", ["banner", "flag", "heraldry", "village", "recolour"]),
  props("Lantern_Wall", "lamp_wall", "prop", ["lamp", "lantern", "light", "wall", "village", "dungeon"]),
  props("Torch_Metal", "torch", "prop", ["torch", "brazier", "light", "fire", "dungeon"]),
  props("CandleStick_Stand", "candle_stand", "prop", ["candle", "light", "interior", "dungeon"]),
  props("Chandelier", "chandelier", "prop", ["chandelier", "light", "interior", "tavern"]),
  props("Bookcase_2", "bookcase", "prop", ["bookcase", "shelf", "library", "interior"]),
  props("Shelf_Simple", "shelf", "prop", ["shelf", "storage", "shop", "interior"]),
  props("Shelf_Small_Bottles", "shelf_bottles", "prop", ["shelf", "bottles", "shop", "alchemy", "interior"]),
  props("Cabinet", "cabinet", "prop", ["cabinet", "storage", "furniture", "interior"]),
  props("Bed_Twin1", "bed", "prop", ["bed", "inn", "furniture", "interior"]),
  props("Dummy", "training_dummy", "prop", ["dummy", "training", "combat", "village"]),
  props("WeaponStand", "weapon_rack", "prop", ["weapon", "rack", "stand", "shop", "smithing"]),
  props("Whetstone", "whetstone", "prop", ["whetstone", "smithing", "sharpening", "crafting"]),
  props("Rope_1", "rope_coil", "prop", ["rope", "dock", "fishing", "ship"]),
  props("Chain_Coil", "chain_coil", "prop", ["chain", "dungeon", "dock"]),
  props("Cage_Small", "cage", "prop", ["cage", "prison", "dungeon"]),
  props("Coin", "coin", "prop", ["coin", "gold", "currency", "loot"]),
  props("Coin_Pile", "coin_pile", "prop", ["coin", "gold", "currency", "loot", "treasure"]),
  props("Key_Metal", "key", "prop", ["key", "dungeon", "quest", "loot"]),
  props("Potion_1", "potion_1", "prop", ["potion", "flask", "alchemy", "loot", "recolour"]),
  props("Potion_2", "potion_2", "prop", ["potion", "flask", "alchemy", "loot", "recolour"]),
  props("Scroll_1", "scroll", "prop", ["scroll", "quest", "magic", "loot"]),
  props("Book_Stack_1", "book_stack", "prop", ["book", "library", "magic", "interior"]),
  props("Vase_Rubble_Medium", "rubble_vase", "dungeon", ["rubble", "debris", "pottery", "ruins", "dungeon"]),
  props("Bottle_1", "bottle", "prop", ["bottle", "tavern", "interior"]),
  props("Mug", "mug", "prop", ["mug", "tankard", "tavern", "interior"]),

  // --- farm ----------------------------------------------------------------
  props("FarmCrate_Empty", "farm_crate_empty", "farm", ["crate", "farm", "harvest", "container"]),
  props("FarmCrate_Carrot", "farm_crate_carrot", "farm", ["crate", "farm", "harvest", "carrot", "crop"]),
  props("FarmCrate_Apple", "farm_crate_apple", "farm", ["crate", "farm", "harvest", "apple", "crop"]),
  props("Carrot", "crop_carrot", "farm", ["carrot", "crop", "farm", "plant", "gatherable"]),

  // --- weapons and tools ---------------------------------------------------
  props("Sword_Bronze", "sword", "weapon", ["sword", "melee", "blade", "equip", "recolour"]),
  props("Axe_Bronze", "axe", "weapon", ["axe", "melee", "woodcutting", "tool", "equip", "recolour"]),
  props("Pickaxe_Bronze", "pickaxe", "weapon", ["pickaxe", "mining", "tool", "equip", "recolour"]),
  props("Shield_Wooden", "shield", "weapon", ["shield", "offhand", "defence", "equip"]),

  // --- characters ----------------------------------------------------------
  {
    id: "base_male",
    pack: "universal-base-characters",
    file: "Base Characters/Godot - UE/Superhero_Male_FullBody",
    category: "character",
    tags: ["character", "base", "humanoid", "male", "player", "npc", "rigged"],
  },
  {
    id: "base_female",
    pack: "universal-base-characters",
    file: "Base Characters/Godot - UE/Superhero_Female_FullBody",
    category: "character",
    tags: ["character", "base", "humanoid", "female", "player", "npc", "rigged"],
  },
  {
    id: "hair_short",
    pack: "universal-base-characters",
    file: "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_SimpleParted",
    category: "character",
    tags: ["hair", "head", "customisation", "recolour"],
  },
  {
    id: "hair_long",
    pack: "universal-base-characters",
    file: "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Long",
    category: "character",
    tags: ["hair", "head", "customisation", "recolour"],
  },
  {
    id: "hair_buns",
    pack: "universal-base-characters",
    file: "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Buns",
    category: "character",
    tags: ["hair", "head", "customisation", "recolour"],
  },
  {
    id: "hair_buzzed",
    pack: "universal-base-characters",
    file: "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Buzzed",
    category: "character",
    tags: ["hair", "head", "customisation", "recolour"],
  },
  {
    id: "hair_beard",
    pack: "universal-base-characters",
    file: "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Beard",
    category: "character",
    tags: ["hair", "beard", "face", "customisation", "recolour"],
  },
  {
    id: "eyebrows",
    pack: "universal-base-characters",
    file: "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Eyebrows_Regular",
    category: "character",
    tags: ["eyebrows", "face", "customisation"],
  },

  // --- enemies (animated, untextured; style is more cartoon than the kits) --
  platformer("Enemies/glTF/Enemy", "enemy_blob", "character", [
    "enemy", "monster", "animated", "tier1", "placeholder-style",
  ]),
  platformer("Enemies/glTF/Crab", "enemy_crab", "character", [
    "enemy", "monster", "animated", "crab", "tier1", "placeholder-style",
  ]),
  platformer("Enemies/glTF/Bee", "enemy_bee", "character", [
    "enemy", "monster", "animated", "flying", "insect", "tier5", "placeholder-style",
  ]),
  platformer("Enemies/glTF/Skull", "enemy_skull", "character", [
    "enemy", "monster", "animated", "undead", "skull", "dungeon", "tier10", "boss", "placeholder-style",
  ]),

  // --- outfits: full sets --------------------------------------------------
  {
    id: "outfit_male_peasant",
    pack: "modular-character-outfits-fantasy",
    file: "Outfits/Male_Peasant",
    category: "outfit",
    tags: ["outfit", "full", "peasant", "villager", "male", "npc", "starter"],
  },
  {
    id: "outfit_female_peasant",
    pack: "modular-character-outfits-fantasy",
    file: "Outfits/Female_Peasant",
    category: "outfit",
    tags: ["outfit", "full", "peasant", "villager", "female", "npc", "starter"],
  },
  {
    id: "outfit_male_ranger",
    pack: "modular-character-outfits-fantasy",
    file: "Outfits/Male_Ranger",
    category: "outfit",
    tags: ["outfit", "full", "ranger", "armour", "male", "player", "bandit"],
  },
  {
    id: "outfit_female_ranger",
    pack: "modular-character-outfits-fantasy",
    file: "Outfits/Female_Ranger",
    category: "outfit",
    tags: ["outfit", "full", "ranger", "armour", "female", "player", "bandit"],
  },
];

// Modular outfit parts, generated so the slot naming stays consistent.
const OUTFIT_PARTS: Array<[string, string, string[]]> = [
  ["Male_Peasant_Body", "outfit_male_peasant_chest", ["torso", "peasant", "male"]],
  ["Male_Peasant_Arms", "outfit_male_peasant_gloves", ["arms", "gloves", "peasant", "male"]],
  ["Male_Peasant_Legs", "outfit_male_peasant_legs", ["legs", "peasant", "male"]],
  ["Male_Peasant_Feet", "outfit_male_peasant_boots", ["feet", "boots", "peasant", "male"]],
  ["Male_Ranger_Body", "outfit_male_ranger_chest", ["torso", "ranger", "armour", "male"]],
  ["Male_Ranger_Arms", "outfit_male_ranger_gloves", ["arms", "gloves", "ranger", "armour", "male"]],
  ["Male_Ranger_Legs", "outfit_male_ranger_legs", ["legs", "ranger", "armour", "male"]],
  ["Male_Ranger_Feet_Boots", "outfit_male_ranger_boots", ["feet", "boots", "ranger", "armour", "male"]],
  ["Male_Ranger_Head_Hood", "outfit_male_ranger_hood", ["head", "helmet", "hood", "ranger", "male"]],
  ["Male_Ranger_Acc_Pauldron", "outfit_male_ranger_pauldron", ["shoulder", "pauldron", "ranger", "armour", "male"]],
  ["Female_Peasant_Body", "outfit_female_peasant_chest", ["torso", "peasant", "female"]],
  ["Female_Peasant_Arms", "outfit_female_peasant_gloves", ["arms", "gloves", "peasant", "female"]],
  ["Female_Peasant_Legs", "outfit_female_peasant_legs", ["legs", "peasant", "female"]],
  ["Female_Peasant_Feet", "outfit_female_peasant_boots", ["feet", "boots", "peasant", "female"]],
  ["Female_Ranger_Body", "outfit_female_ranger_chest", ["torso", "ranger", "armour", "female"]],
  ["Female_Ranger_Arms", "outfit_female_ranger_gloves", ["arms", "gloves", "ranger", "armour", "female"]],
  ["Female_Ranger_Legs", "outfit_female_ranger_legs", ["legs", "ranger", "armour", "female"]],
  ["Female_Ranger_Feet", "outfit_female_ranger_boots", ["feet", "boots", "ranger", "armour", "female"]],
  ["Female_Ranger_Head_Hood", "outfit_female_ranger_hood", ["head", "helmet", "hood", "ranger", "female"]],
  ["Female_Ranger_Acc_Pauldrons", "outfit_female_ranger_pauldron", ["shoulder", "pauldron", "ranger", "armour", "female"]],
];

for (const [file, id, tags] of OUTFIT_PARTS) {
  CATALOG.push({
    id,
    pack: "modular-character-outfits-fantasy",
    file: `Modular Parts/${file}`,
    category: "outfit",
    tags: ["outfit", "modular", "equip", ...tags],
  });
}

// The free edition does not contain the Knight. The user's Source-edition archive is still CC0,
// and its pinned hash and separate pack id keep the paid input distinct from the free archive.
const SOURCE_OUTFIT_PARTS: Array<[string, string, string[]]> = [
  ["Male_Knight_Head_Armet", "outfit_male_knight_helmet", ["head", "helmet", "knight", "armour", "male"]],
  ["Male_Knight_Body_Armor", "outfit_male_knight_chest", ["torso", "knight", "armour", "male"]],
  ["Male_Knight_Arms", "outfit_male_knight_gloves", ["arms", "gloves", "knight", "armour", "male"]],
  ["Male_Knight_Legs_Armor", "outfit_male_knight_legs", ["legs", "knight", "armour", "male"]],
  ["Male_Knight_Feet_Armor", "outfit_male_knight_boots", ["feet", "boots", "knight", "armour", "male"]],
  ["Male_Knight_Acc_Pauldron_Round", "outfit_male_knight_pauldron", ["shoulder", "pauldron", "knight", "armour", "male"]],
  ["Male_Knight_Acc_Scarf", "outfit_male_knight_scarf", ["neck", "scarf", "knight", "male"]],
  ["Female_Knight_Head_Armet", "outfit_female_knight_helmet", ["head", "helmet", "knight", "armour", "female"]],
  ["Female_Knight_Body_Armor", "outfit_female_knight_chest", ["torso", "knight", "armour", "female"]],
  ["Female_Knight_Arms", "outfit_female_knight_gloves", ["arms", "gloves", "knight", "armour", "female"]],
  ["Female_Knight_Legs", "outfit_female_knight_legs", ["legs", "knight", "armour", "female"]],
  ["Female_Knight_Feet", "outfit_female_knight_boots", ["feet", "boots", "knight", "armour", "female"]],
  ["Female_Knight_Acc_Pauldrons_Round", "outfit_female_knight_pauldron", ["shoulder", "pauldron", "knight", "armour", "female"]],
  ["Female_Knight_Acc_Scarf", "outfit_female_knight_scarf", ["neck", "scarf", "knight", "female"]],
];

for (const [file, id, tags] of SOURCE_OUTFIT_PARTS) {
  CATALOG.push({
    id,
    pack: "modular-character-outfits-fantasy-source",
    file: `Modular Parts/${file}`,
    category: "outfit",
    tags: ["outfit", "modular", "equip", ...tags],
  });
}

CATALOG.push(
  {
    id: "animation_library_1",
    pack: "universal-animation-library",
    file: "UAL1_Standard",
    category: "animation",
    tags: ["animation", "clips", "humanoid", "locomotion", "combat", "library", "in-place"],
    animationLibrary: true,
    animationClips: [
      "Death01",
      "Fixing_Kneeling",
      "Hit_Chest",
      "Idle_Loop",
      "Idle_Talking_Loop",
      "Interact",
      "Jog_Fwd_Loop",
      "Punch_Jab",
      "Spell_Simple_Idle_Loop",
      "Spell_Simple_Shoot",
      "Sprint_Loop",
      "Sword_Attack",
      "Walk_Loop",
    ],
  },
  {
    id: "animation_library_2",
    pack: "universal-animation-library-2",
    file: "UAL2_Standard",
    category: "animation",
    tags: ["animation", "clips", "humanoid", "gathering", "crafting", "library", "in-place"],
    animationLibrary: true,
    animationClips: [
      "Chest_Open",
      "ClimbUp_1m",
      "Consume",
      "Farm_Harvest",
      "Farm_PlantSeed",
      "Hit_Knockback",
      "Idle_FoldArms_Loop",
      "Idle_No_Loop",
      "Idle_Rail_Loop",
      "NinjaJump_Start",
      "Sword_Regular_A",
      "TreeChopping_Loop",
    ],
  },
);

// ---------------------------------------------------------------------------
// Manifest types (frozen contract, see runs/corealm/asset-report.md)
// ---------------------------------------------------------------------------

interface ManifestAsset {
  id: string;
  file: string;
  pack: string;
  category: Category;
  /** What the mesh IS. Always `tags[0]`; see the catalog note above the pick helpers. */
  is: string;
  tags: string[];
  bytes: number;
  size: { x: number; y: number; z: number };
  /**
   * World-space bounding-box MINIMUM corner, metres, same traversal and same source document as
   * `size` (so `base + size` is the maximum corner exactly).
   *
   * `base.y` is the offset from the GLB's own origin to the bottom of its geometry, and it is not
   * zero: 117 of the 213 assets are off by more than 2 cm and the extremes are `roof_log` at
   * +3.849 and `vine_1` at -2.121. Placing an asset's origin on the ground therefore floats or
   * sinks it by exactly `base.y * scale` — measured across 159 world entities during the Phase 2
   * grounding sweep (runs/corealm/diagnosis/grounding-objects-floating-above-sunk-in.md), where it
   * left the Fallen Duskoak hovering 5.77 m and every farm plot fully underground. Ground-aligned
   * placement is `y = groundHeight - base.y * scale`.
   */
  base: { x: number; y: number; z: number };
  animations: string[];
  materials: string[];
  /** Optional for historical CC0 rows. Required and audited for imported Unity outputs. */
  sha256?: string;
  /**
   * Ground speed the asset's own walk cycle implies, m/s. Written by `tools/build-animals.ts`.
   *
   * `render/entityViews.ts` divides the creature's real `moveSpeedMps` by this to set the clip's
   * playback rate, so legs match ground speed instead of skating.
   */
  impliedWalkMps?: number;
}

interface ManifestArtifact {
  id: string;
  file: string;
  pack: string;
  kind: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  dimensions?: { width: number; height: number };
}

interface Manifest {
  generatedAt: string;
  packs: Array<{
    id: string;
    name: string;
    author: string;
    source: string;
    license: string;
    /**
     * CC0 packs only. Imported Unity packs are audited per file through each asset's `sha256`
     * instead, because there is no redistributable archive of ours to hash.
     */
    archiveSha256?: string;
  }>;
  assets: ManifestAsset[];
  /** Non-GLB files with third-party provenance. The runtime ignores this audit-only list. */
  artifacts?: ManifestArtifact[];
}

interface BuildRecord {
  inputHash: string;
  optionsHash: string;
  sourceBytes: number;
  asset: ManifestAsset;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const CACHE_DIR = path.join(repoRoot, ".asset-cache");
/** Worktrees can reuse the main clone's ignored source archives without sharing build state. */
const SOURCE_CACHE_DIR = process.env.COREALM_ASSET_SOURCE_CACHE
  ? path.resolve(process.env.COREALM_ASSET_SOURCE_CACHE)
  : CACHE_DIR;
const OUT_DIR = path.join(gameRoot, "public", "assets");
const MODELS_DIR = path.join(OUT_DIR, "models");
const MANIFEST_FILE = path.join(OUT_DIR, "manifest.json");
const STATE_FILE = path.join(CACHE_DIR, "build-assets-state.json");
const LEGACY_PACK_IDS = new Set(PACKS.map((pack) => pack.id));
const REQUIRED_UNITY_ASSET_IDS = new Set([
  "rpg_weapon_staff",
  "rpg_weapon_wand",
  "rocks_free_essence_cache",
  "rocks_free_essence_node",
]);

/** Bump when the transform pipeline changes so cached outputs are invalidated. */
const PIPELINE_VERSION = "1.3.0";
/** Versioned separately so an animation-only transform does not invalidate every mesh asset. */
const ANIMATION_PIPELINE_VERSION = "2.0.1";
const TEXTURE_LIMIT = 512;
/** Categories the "no GLB over ~400 KB" budget applies to. */
const ENVIRONMENT_CATEGORIES = new Set<Category>(["nature", "rock", "building", "prop", "farm", "dungeon", "weapon"]);

// Quiet: textureCompress warns for every alpha texture it skips, by design.
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));

function sha1(...parts: Array<Buffer | string>): string {
  const hash = createHash("sha1");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

async function writeTextAtomically(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, contents, "utf8");
  try {
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readManifest(): Promise<Manifest> {
  const manifest = JSON.parse(await readFile(MANIFEST_FILE, "utf8")) as Manifest;
  if (!Array.isArray(manifest.packs) || !Array.isArray(manifest.assets)) {
    throw new Error(`${MANIFEST_FILE} is not a valid asset manifest`);
  }
  if (manifest.artifacts !== undefined && !Array.isArray(manifest.artifacts)) {
    throw new Error(`${MANIFEST_FILE} has a non-array artifacts field`);
  }
  return manifest;
}

function resolvePublishedFile(relative: string): string {
  const absolute = path.resolve(OUT_DIR, relative);
  const prefix = `${path.resolve(OUT_DIR)}${path.sep}`;
  if (!absolute.startsWith(prefix)) throw new Error(`Manifest path escapes assets/: ${relative}`);
  return absolute;
}

async function validatePublishedFile(
  entry: { id: string; file: string; bytes: number; sha256?: string },
): Promise<void> {
  const bytes = await readFile(resolvePublishedFile(entry.file));
  if (bytes.byteLength !== entry.bytes) {
    throw new Error(`${entry.id}: ${entry.file} is ${bytes.byteLength} bytes; manifest records ${entry.bytes}`);
  }
  if (entry.sha256) {
    const actual = sha256(bytes);
    if (actual !== entry.sha256.toUpperCase()) {
      throw new Error(`${entry.id}: SHA-256 ${actual}; manifest records ${entry.sha256}`);
    }
  }
}

async function preservedManifestRows(manifest: Manifest): Promise<{
  packs: Manifest["packs"];
  assets: ManifestAsset[];
  artifacts: ManifestArtifact[];
}> {
  const assets = manifest.assets.filter((asset) => !LEGACY_PACK_IDS.has(asset.pack));
  const artifacts = (manifest.artifacts ?? []).filter((artifact) => !LEGACY_PACK_IDS.has(artifact.pack));
  const referencedPackIds = new Set([...assets.map((asset) => asset.pack), ...artifacts.map((artifact) => artifact.pack)]);
  const packs = manifest.packs.filter((pack) => !LEGACY_PACK_IDS.has(pack.id) && referencedPackIds.has(pack.id));
  const availablePackIds = new Set(packs.map((pack) => pack.id));

  for (const entry of [...assets, ...artifacts]) {
    if (!availablePackIds.has(entry.pack)) throw new Error(`${entry.id}: missing external pack ${entry.pack}`);
    await validatePublishedFile(entry);
  }

  return { packs, assets, artifacts };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const archives = new Map<string, ZipArchive>();
async function archive(packId: string): Promise<ZipArchive> {
  const pack = PACK_BY_ID.get(packId);
  if (!pack) throw new Error(`Unknown pack: ${packId}`);
  let existing = archives.get(packId);
  if (!existing) {
    const file = path.join(SOURCE_CACHE_DIR, pack.zip);
    const actualSha256 = await sha256File(file);
    if (actualSha256 !== pack.archiveSha256) {
      throw new Error(
        `Archive SHA-256 mismatch for ${pack.id}: expected ${pack.archiveSha256}, got ${actualSha256}`,
      );
    }
    existing = await ZipArchive.open(file);
    archives.set(packId, existing);
  }
  return existing;
}

/** basename -> full entry path, for resolving relative .bin / texture URIs. */
const basenameIndex = new Map<string, Map<string, string[]>>();
function indexFor(packId: string, zip: ZipArchive): Map<string, string[]> {
  let index = basenameIndex.get(packId);
  if (index) return index;
  index = new Map();
  for (const name of zip.entries.keys()) {
    const base = name.slice(name.lastIndexOf("/") + 1);
    const list = index.get(base);
    if (list) list.push(name);
    else index.set(base, [name]);
  }
  basenameIndex.set(packId, index);
  return index;
}

function resolveResource(zip: ZipArchive, index: Map<string, string[]>, dir: string, uri: string): string | null {
  const decoded = decodeURIComponent(uri);
  const direct = `${dir}${decoded}`;
  if (zip.entries.has(direct)) return direct;
  const base = decoded.slice(decoded.lastIndexOf("/") + 1);
  const candidates = index.get(base);
  if (!candidates || candidates.length === 0) return null;
  // Prefer the shallowest path, and never a "Normals ..." variant folder.
  const ranked = [...candidates].sort((a, b) => {
    const penalty = (value: string) => (/Normals?[ _-]/i.test(value) ? 1 : 0);
    return penalty(a) - penalty(b) || a.split("/").length - b.split("/").length || a.length - b.length;
  });
  return ranked[0] ?? null;
}

/** 1x1 transparent PNG, used to stand in for maps this pipeline discards. */
const PLACEHOLDER_PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function listUris(json: Record<string, unknown>, key: "buffers" | "images"): string[] {
  const list = json[key];
  if (!Array.isArray(list)) return [];
  const uris: string[] = [];
  for (const item of list) {
    const uri = (item as { uri?: string }).uri;
    if (typeof uri === "string" && uri && !uri.startsWith("data:")) uris.push(uri);
  }
  return [...new Set(uris)];
}

/** Image indices reachable through a material's baseColorTexture. */
function baseColorImageIndices(json: Record<string, unknown>): Set<number> {
  const textures = Array.isArray(json.textures) ? (json.textures as Array<{ source?: number }>) : [];
  const materials = Array.isArray(json.materials) ? (json.materials as Array<Record<string, unknown>>) : [];
  const indices = new Set<number>();
  for (const material of materials) {
    const pbr = material.pbrMetallicRoughness as { baseColorTexture?: { index?: number } } | undefined;
    const textureIndex = pbr?.baseColorTexture?.index;
    if (typeof textureIndex !== "number") continue;
    const source = textures[textureIndex]?.source;
    if (typeof source === "number") indices.add(source);
  }
  return indices;
}

interface LoadedSource {
  document: Document;
  inputHash: string;
  sourceBytes: number;
}

interface Metrics {
  size: { x: number; y: number; z: number };
  base: { x: number; y: number; z: number };
}

const ZERO_METRICS: Metrics = { size: { x: 0, y: 0, z: 0 }, base: { x: 0, y: 0, z: 0 } };

/**
 * World-space bounding box of a document's default scene, in metres, as extent (`size`) and
 * minimum corner (`base`).
 *
 * Both come out of one `getBounds` call on purpose: a base offset that disagrees with the size
 * field by a node transform is worse than no base offset at all, because the caller would compose
 * them and get a mesh that neither sits on the ground nor is the height it claims.
 */
function measure(document: Document): Metrics {
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) return ZERO_METRICS;
  const bounds = getBounds(scene);
  if (![...bounds.min, ...bounds.max].every((value) => Number.isFinite(value))) return ZERO_METRICS;
  return {
    size: {
      x: round(bounds.max[0] - bounds.min[0]),
      y: round(bounds.max[1] - bounds.min[1]),
      z: round(bounds.max[2] - bounds.min[2]),
    },
    base: {
      x: round(bounds.min[0]),
      y: round(bounds.min[1]),
      z: round(bounds.min[2]),
    },
  };
}

/**
 * What a single asset needs out of its zip. OBJ/MTL inputs are converted to a
 * glTF-Transform document first, then enter the same measured optimization path
 * as authored glTF. Resources that resolve to null are glTF maps this pipeline
 * discards; they get a 1x1 stand-in.
 */
interface SourcePlan {
  entry: string;
  format: "glb" | "gltf" | "obj";
  mtlEntry?: string;
  json?: Record<string, unknown>;
  resources: Array<{ uri: string; entry: string | null }>;
}

function mtlDiffuseMaps(source: string): string[] {
  const maps = new Set<string>();
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    const match = /^map_Kd\s+(.+)$/i.exec(line);
    if (!match) continue;
    const tokens = match[1]!.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    const last = tokens.at(-1)?.replace(/^(?:"|')|(?:"|')$/g, "");
    if (last) maps.add(last.replace(/\\/g, "/"));
  }
  return [...maps];
}

async function planSource(pick: Pick, preserveMaterialMaps = false): Promise<{ zip: ZipArchive; plan: SourcePlan }> {
  const pack = PACK_BY_ID.get(pick.pack);
  if (!pack) throw new Error(`Unknown pack ${pick.pack} for ${pick.id}`);
  const zip = await archive(pick.pack);
  const index = indexFor(pick.pack, zip);

  if (pack.sourceFormat === "obj") {
    const objEntry = `${pack.root}${pick.file}.obj`;
    const mtlEntry = `${pack.root}${pick.file}.mtl`;
    if (!zip.entries.has(objEntry)) throw new Error(`Missing source: ${objEntry} in ${pack.zip}`);
    if (!zip.entries.has(mtlEntry)) throw new Error(`Missing material library: ${mtlEntry} in ${pack.zip}`);
    const mtlSource = (await zip.read(mtlEntry)).toString("utf8");
    const dir = objEntry.slice(0, objEntry.lastIndexOf("/") + 1);
    const resources = mtlDiffuseMaps(mtlSource).map((uri) => {
      const entry = resolveResource(zip, index, dir, uri);
      if (!entry) throw new Error(`Cannot resolve diffuse texture "${uri}" for ${pick.id} (${mtlEntry})`);
      return { uri, entry };
    });
    return { zip, plan: { entry: objEntry, format: "obj", mtlEntry, resources } };
  }

  const glbEntry = `${pack.root}${pick.file}.glb`;
  if (zip.entries.has(glbEntry)) {
    return { zip, plan: { entry: glbEntry, format: "glb", resources: [] } };
  }

  const gltfEntry = `${pack.root}${pick.file}.gltf`;
  if (!zip.entries.has(gltfEntry)) throw new Error(`Missing source: ${gltfEntry} in ${pack.zip}`);
  const json = JSON.parse((await zip.read(gltfEntry)).toString("utf8")) as Record<string, unknown>;
  const dir = gltfEntry.slice(0, gltfEntry.lastIndexOf("/") + 1);

  const resources: Array<{ uri: string; entry: string | null }> = [];
  const seen = new Set<string>();

  for (const uri of listUris(json, "buffers")) {
    const resolved = resolveResource(zip, index, dir, uri);
    if (!resolved) throw new Error(`Cannot resolve buffer "${uri}" for ${pick.id} (${gltfEntry})`);
    resources.push({ uri, entry: resolved });
    seen.add(uri);
  }

  // The legacy path loads base color only, including placeholder handling for
  // old packs with absent normal files. Material staging loads every authored
  // image and fails on missing resources rather than silently manufacturing maps.
  const baseColorImages = baseColorImageIndices(json);
  const images = Array.isArray(json.images) ? (json.images as Array<{ uri?: string }>) : [];
  for (let i = 0; i < images.length; i += 1) {
    const uri = images[i]?.uri;
    if (typeof uri !== "string" || !uri || uri.startsWith("data:") || seen.has(uri)) continue;
    seen.add(uri);
    const entry = preserveMaterialMaps || baseColorImages.has(i) ? resolveResource(zip, index, dir, uri) : null;
    if (preserveMaterialMaps && !entry) {
      throw new Error(`Cannot restore authored texture "${uri}" for ${pick.id} (${gltfEntry})`);
    }
    resources.push({ uri, entry });
  }

  return { zip, plan: { entry: gltfEntry, format: "gltf", json, resources } };
}

/**
 * Content fingerprint from central-directory CRCs, so the incremental check
 * never has to inflate a single byte. Derived from exactly the entries
 * materialize() will read, so the two can never disagree.
 */
function fingerprintSource(zip: ZipArchive, plan: SourcePlan): string {
  const parts: string[] = [plan.entry];
  const stamp = (name: string) => {
    const entry = zip.entries.get(name);
    return entry ? `${name}:${entry.crc}:${entry.uncompressedSize}` : `${name}:missing`;
  };
  parts.push(stamp(plan.entry));
  if (plan.mtlEntry) parts.push(stamp(plan.mtlEntry));
  for (const resource of plan.resources) {
    parts.push(resource.entry ? `${resource.uri}=${stamp(resource.entry)}` : `${resource.uri}=placeholder`);
  }
  return sha1(parts.join("|"));
}

const OBJ_CONVERTER_VERSION = "corealm-obj-mtl-1.0.0";

interface ObjMaterialDef {
  name: string;
  diffuse: [number, number, number];
  opacity: number;
  diffuseMap?: string;
}

interface ObjPrimitiveData {
  materialName: string;
  positions: number[];
  normals: number[];
  texcoords: number[];
  hasTexcoords: boolean;
  indices: number[];
  vertices: Map<string, number>;
}

function sourceLine(raw: string): string {
  return raw.replace(/\s+#.*$/, "").trim();
}

function parseMtl(source: string): Map<string, ObjMaterialDef> {
  const result = new Map<string, ObjMaterialDef>();
  let current: ObjMaterialDef | null = null;
  for (const raw of source.split(/\r?\n/)) {
    const line = sourceLine(raw);
    if (!line) continue;
    const separator = line.search(/\s/);
    const command = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? "" : line.slice(separator + 1).trim();
    if (command === "newmtl") {
      current = { name: value, diffuse: [0.8, 0.8, 0.8], opacity: 1 };
      result.set(value, current);
    } else if (current && command === "Kd") {
      const components = value.split(/\s+/).map(Number);
      if (components.length >= 3 && components.slice(0, 3).every(Number.isFinite)) {
        current.diffuse = [components[0]!, components[1]!, components[2]!];
      }
    } else if (current && command === "d") {
      const opacity = Number(value);
      if (Number.isFinite(opacity)) current.opacity = Math.max(0, Math.min(1, opacity));
    } else if (current && command === "Tr") {
      const transparency = Number(value);
      if (Number.isFinite(transparency)) current.opacity = Math.max(0, Math.min(1, 1 - transparency));
    } else if (current && command.toLowerCase() === "map_kd") {
      const tokens = value.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
      const map = tokens.at(-1)?.replace(/^(?:"|')|(?:"|')$/g, "");
      if (map) current.diffuseMap = map.replace(/\\/g, "/");
    }
  }
  return result;
}

function resolveObjIndex(raw: string | undefined, length: number, label: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed === 0) throw new Error(`Invalid OBJ ${label} index: ${raw ?? "missing"}`);
  const resolved = parsed > 0 ? parsed - 1 : length + parsed;
  if (resolved < 0 || resolved >= length) {
    throw new Error(`OBJ ${label} index ${parsed} is outside 1..${length}`);
  }
  return resolved;
}

function textureMimeType(uri: string): string {
  const extension = path.extname(uri).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  throw new Error(`Unsupported OBJ diffuse texture format: ${uri}`);
}

/**
 * Deterministic, deliberately small OBJ/MTL converter for the pinned Quaternius
 * archives. It supports indexed polygon faces, authored normals, UVs, diffuse
 * colour, opacity, and one diffuse texture per material. Untextured opaque
 * material groups are folded into vertex colours, retaining the authored Kd
 * palette in one draw call instead of one draw per colour swatch.
 */
function convertObjMtl(
  name: string,
  objSource: string,
  mtlSource: string,
  resourceBytes: ReadonlyMap<string, Uint8Array>,
): Document {
  const materialDefs = parseMtl(mtlSource);
  const positions: Array<[number, number, number]> = [];
  const normals: Array<[number, number, number]> = [];
  const texcoords: Array<[number, number]> = [];
  const groups = new Map<string, ObjPrimitiveData>();
  let materialName = "__default";

  const groupFor = (key: string): ObjPrimitiveData => {
    let group = groups.get(key);
    if (!group) {
      group = {
        materialName: key,
        positions: [],
        normals: [],
        texcoords: [],
        hasTexcoords: false,
        indices: [],
        vertices: new Map(),
      };
      groups.set(key, group);
    }
    return group;
  };

  for (const raw of objSource.split(/\r?\n/)) {
    const line = sourceLine(raw);
    if (!line) continue;
    const separator = line.search(/\s/);
    const command = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? "" : line.slice(separator + 1).trim();
    const components = value.split(/\s+/);

    if (command === "v") {
      const numbers = components.slice(0, 3).map(Number);
      if (numbers.length < 3 || numbers.some((entry) => !Number.isFinite(entry))) {
        throw new Error(`Malformed OBJ position in ${name}: ${line}`);
      }
      positions.push([numbers[0]!, numbers[1]!, numbers[2]!]);
    } else if (command === "vn") {
      const numbers = components.slice(0, 3).map(Number);
      if (numbers.length < 3 || numbers.some((entry) => !Number.isFinite(entry))) {
        throw new Error(`Malformed OBJ normal in ${name}: ${line}`);
      }
      normals.push([numbers[0]!, numbers[1]!, numbers[2]!]);
    } else if (command === "vt") {
      const numbers = components.slice(0, 2).map(Number);
      if (numbers.length < 2 || numbers.some((entry) => !Number.isFinite(entry))) {
        throw new Error(`Malformed OBJ texture coordinate in ${name}: ${line}`);
      }
      texcoords.push([numbers[0]!, 1 - numbers[1]!]);
    } else if (command === "usemtl") {
      materialName = value || "__default";
    } else if (command === "f") {
      if (components.length < 3) throw new Error(`OBJ face has fewer than three vertices in ${name}`);
      const group = groupFor(materialName);
      const polygon = components.map((reference) => {
        const tuple = reference.split("/");
        const positionIndex = resolveObjIndex(tuple[0], positions.length, "position");
        const normalIndex = resolveObjIndex(tuple[2], normals.length, "normal");
        const texcoordIndex = tuple[1] ? resolveObjIndex(tuple[1], texcoords.length, "texture-coordinate") : -1;
        const key = `${positionIndex}/${texcoordIndex}/${normalIndex}`;
        const cached = group.vertices.get(key);
        if (cached !== undefined) return cached;

        const index = group.positions.length / 3;
        const position = positions[positionIndex]!;
        const normal = normals[normalIndex]!;
        group.positions.push(...position);
        group.normals.push(...normal);
        if (texcoordIndex >= 0) {
          group.hasTexcoords = true;
          group.texcoords.push(...texcoords[texcoordIndex]!);
        } else {
          group.texcoords.push(0, 0);
        }
        group.vertices.set(key, index);
        return index;
      });
      for (let index = 1; index < polygon.length - 1; index += 1) {
        group.indices.push(polygon[0]!, polygon[index]!, polygon[index + 1]!);
      }
    }
  }

  if (positions.length === 0 || groups.size === 0) throw new Error(`OBJ source ${name} contains no mesh faces`);

  const document = new Document();
  const buffer = document.createBuffer(`${name}-buffer`);
  const mesh = document.createMesh(name);
  const groupsList = [...groups.values()].filter((group) => group.indices.length > 0);
  const canUseVertexColours = groupsList.every((group) => {
    const def = materialDefs.get(group.materialName);
    return !def?.diffuseMap && (def?.opacity ?? 1) === 1;
  });

  const accessor = (label: string, type: "SCALAR" | "VEC2" | "VEC3" | "VEC4", array: TypedArray) =>
    document.createAccessor(label).setType(type).setArray(array).setBuffer(buffer);

  if (canUseVertexColours) {
    const mergedPositions: number[] = [];
    const mergedNormals: number[] = [];
    const mergedTexcoords: number[] = [];
    const mergedColours: number[] = [];
    const mergedIndices: number[] = [];
    let hasTexcoords = false;
    for (const group of groupsList) {
      const offset = mergedPositions.length / 3;
      const def = materialDefs.get(group.materialName);
      const colour = def?.diffuse ?? [0.8, 0.8, 0.8];
      mergedPositions.push(...group.positions);
      mergedNormals.push(...group.normals);
      mergedTexcoords.push(...group.texcoords);
      hasTexcoords ||= group.hasTexcoords;
      for (let vertex = 0; vertex < group.positions.length / 3; vertex += 1) {
        mergedColours.push(colour[0], colour[1], colour[2], 1);
      }
      for (const index of group.indices) mergedIndices.push(index + offset);
    }
    const indexArray = mergedPositions.length / 3 <= 65_535
      ? new Uint16Array(mergedIndices)
      : new Uint32Array(mergedIndices);
    const material = document.createMaterial(`${name}-vertex-colours`)
      .setBaseColorFactor([1, 1, 1, 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(0.85);
    const primitive = document.createPrimitive()
      .setAttribute("POSITION", accessor(`${name}-position`, "VEC3", new Float32Array(mergedPositions)))
      .setAttribute("NORMAL", accessor(`${name}-normal`, "VEC3", new Float32Array(mergedNormals)))
      .setAttribute("COLOR_0", accessor(`${name}-colour`, "VEC4", new Float32Array(mergedColours)))
      .setIndices(accessor(`${name}-indices`, "SCALAR", indexArray))
      .setMaterial(material);
    if (hasTexcoords) {
      primitive.setAttribute("TEXCOORD_0", accessor(`${name}-uv`, "VEC2", new Float32Array(mergedTexcoords)));
    }
    mesh.addPrimitive(primitive);
  } else {
    for (const [groupIndex, group] of groupsList.entries()) {
      const def = materialDefs.get(group.materialName) ?? {
        name: group.materialName,
        diffuse: [0.8, 0.8, 0.8] as [number, number, number],
        opacity: 1,
      };
      const material = document.createMaterial(def.name)
        .setBaseColorFactor([...def.diffuse, def.opacity])
        .setMetallicFactor(0)
        .setRoughnessFactor(0.85);
      if (def.opacity < 1) material.setAlphaMode("BLEND");
      if (def.diffuseMap) {
        const image = resourceBytes.get(def.diffuseMap);
        if (!image) throw new Error(`Missing materialized OBJ diffuse texture: ${def.diffuseMap}`);
        material.setBaseColorTexture(
          document.createTexture(def.diffuseMap)
            .setImage(image)
            .setMimeType(textureMimeType(def.diffuseMap)),
        );
      }
      const indexArray = group.positions.length / 3 <= 65_535
        ? new Uint16Array(group.indices)
        : new Uint32Array(group.indices);
      const prefix = `${name}-${groupIndex}`;
      const primitive = document.createPrimitive()
        .setAttribute("POSITION", accessor(`${prefix}-position`, "VEC3", new Float32Array(group.positions)))
        .setAttribute("NORMAL", accessor(`${prefix}-normal`, "VEC3", new Float32Array(group.normals)))
        .setIndices(accessor(`${prefix}-indices`, "SCALAR", indexArray))
        .setMaterial(material);
      if (group.hasTexcoords) {
        primitive.setAttribute("TEXCOORD_0", accessor(`${prefix}-uv`, "VEC2", new Float32Array(group.texcoords)));
      }
      mesh.addPrimitive(primitive);
    }
  }

  const node = document.createNode(name).setMesh(mesh);
  const scene = document.createScene(`${name}-scene`).addChild(node);
  document.getRoot().setDefaultScene(scene);
  document.getRoot().setExtras({ objConverter: OBJ_CONVERTER_VERSION });
  return document;
}

async function materialize(zip: ZipArchive, plan: SourcePlan): Promise<{ document: Document; sourceBytes: number }> {
  if (plan.format === "glb") {
    const bytes = await zip.read(plan.entry);
    return { document: await io.readBinary(new Uint8Array(bytes)), sourceBytes: bytes.length };
  }
  const source = await zip.read(plan.entry);
  let sourceBytes = source.length;
  const resources: Record<string, Uint8Array> = {};
  for (const resource of plan.resources) {
    if (!resource.entry) {
      resources[resource.uri] = PLACEHOLDER_PNG;
      continue;
    }
    const bytes = await zip.read(resource.entry);
    resources[resource.uri] = new Uint8Array(bytes);
    sourceBytes += bytes.length;
  }
  if (plan.format === "obj") {
    const mtl = await zip.read(plan.mtlEntry!);
    sourceBytes += mtl.length;
    return {
      document: convertObjMtl(
        plan.entry.slice(plan.entry.lastIndexOf("/") + 1, -4),
        source.toString("utf8"),
        mtl.toString("utf8"),
        new Map(Object.entries(resources)),
      ),
      sourceBytes,
    };
  }
  const document = await io.readJSON({ json: plan.json!, resources } as unknown as JSONDocument);
  return { document, sourceBytes };
}

async function loadSource(pick: Pick): Promise<LoadedSource> {
  const { zip, plan } = await planSource(pick);
  const { document, sourceBytes } = await materialize(zip, plan);
  return { document, inputHash: fingerprintSource(zip, plan), sourceBytes };
}

/**
 * Drops every map except base colour and flattens the PBR response.
 * Quaternius ships 1-4 MB normal/ORM maps that cost more than they add at this
 * silhouette-first art scale.
 */
function stripExtraMaps(document: Document): void {
  for (const material of document.getRoot().listMaterials()) {
    material.setNormalTexture(null);
    material.setMetallicRoughnessTexture(null);
    material.setOcclusionTexture(null);
    material.setEmissiveTexture(null);
    material.setMetallicFactor(0);
    if (material.getRoughnessFactor() < 0.6) material.setRoughnessFactor(0.85);
  }
}

async function optimizeMesh(document: Document, limit: number): Promise<void> {
  stripExtraMaps(document);
  // Foliage is geometry-bound, not texture-bound: a twisted tree is ~800 KB of
  // leaf cards. KHR_mesh_quantization roughly halves that and three.js
  // GLTFLoader reads it with no decoder setup.
  //
  // Skinned meshes are left alone on purpose. For those, quantize cannot put the
  // de-normalizing scale on the node (the node matrix is ignored when skinning),
  // so it folds the correction into the inverse-bind matrices instead. That
  // renders correctly but leaves the raw vertex data in normalized space, which
  // is a needless risk on the player, NPCs and outfits for ~3 MB.
  const skinned = document.getRoot().listSkins().length > 0;
  await document.transform(
    dedup(),
    prune({ keepAttributes: false, keepLeaves: false, keepSolidTextures: false }),
    weld(),
    resample(),
    ...(skinned
      ? []
      : [quantize({ pattern: /.*/, quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 })]),
    // Pass 1: opaque base colour becomes JPEG, roughly 8x smaller than PNG for
    // these textures. textureCompress skips any texture whose channel mask
    // still needs alpha, which is exactly the cut-out foliage and cloth.
    textureCompress({ encoder: sharp, targetFormat: "jpeg", resize: [limit, limit], quality: 85 }),
    // Pass 2: whatever is still PNG genuinely needs alpha; resize and re-encode
    // it. Pass 1's output is image/jpeg, so the format filter leaves it alone.
    textureCompress({
      encoder: sharp,
      targetFormat: "png",
      resize: [limit, limit],
      quality: 90,
      effort: 100,
      formats: /image\/png/,
    }),
  );
  await palettizePNGs(document);
}

/**
 * Quantizes the surviving PNGs (cut-out foliage and cloth) to an indexed
 * palette. These are flat-shaded atlases, so 256 colours is visually free and
 * typically cuts a 512x512 RGBA leaf atlas by 4-6x. Kept only when smaller.
 */
async function palettizePNGs(document: Document): Promise<void> {
  for (const texture of document.getRoot().listTextures()) {
    if (texture.getMimeType() !== "image/png") continue;
    const source = texture.getImage();
    if (!source) continue;
    try {
      const encoded = await sharp(Buffer.from(source))
        .png({ palette: true, colours: 256, quality: 90, effort: 10 })
        .toBuffer();
      if (encoded.byteLength < source.byteLength) texture.setImage(new Uint8Array(encoded));
    } catch {
      /* keep the unquantized image */
    }
  }
}

/**
 * Animation libraries keep only clips named by runtime pose tables. The mannequin mesh and its
 * materials are dead weight for a clip library, so they are removed too. The retained clips are
 * checked against their original channel counts after every transform.
 */
async function optimizeAnimationLibrary(
  document: Document,
  retainedNames: readonly string[],
): Promise<{ retained: number; removed: number }> {
  const root = document.getRoot();
  const source = root.listAnimations();
  const sourceNames = new Set<string>();
  for (const animation of source) {
    const name = animation.getName();
    if (sourceNames.has(name)) throw new Error(`Animation library contains duplicate clip: ${name}`);
    sourceNames.add(name);
  }

  const requested = new Set(retainedNames);
  if (requested.size !== retainedNames.length) throw new Error("Animation allowlist contains duplicate clips");
  const missing = retainedNames.filter((name) => !sourceNames.has(name));
  if (missing.length > 0) throw new Error(`Animation allowlist clip(s) missing from source: ${missing.join(", ")}`);

  const before = source.filter((animation) => requested.has(animation.getName())).map((animation) => ({
    name: animation.getName(),
    channels: animation.listChannels().length,
  }));
  for (const animation of source) {
    if (requested.has(animation.getName())) continue;
    // Animation.dispose() does not cascade through its channel and sampler properties. Leaving
    // those children alive keeps their accessors in the output even though no animation uses them.
    for (const channel of animation.listChannels()) channel.dispose();
    for (const sampler of animation.listSamplers()) sampler.dispose();
    animation.dispose();
  }

  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const material of root.listMaterials()) material.dispose();
  for (const texture of root.listTextures()) texture.dispose();

  await document.transform(dedup(), resample());
  // keepLeaves is essential: every joint is now an empty leaf node, and the
  // clips target those nodes by name.
  await document.transform(prune({ keepLeaves: true, keepAttributes: true }));

  const after = root.listAnimations().map((animation) => ({
    name: animation.getName(),
    channels: animation.listChannels().length,
  }));
  const intact =
    after.length === retainedNames.length &&
    before.length === retainedNames.length &&
    before.every((entry, index) => after[index]?.name === entry.name && after[index]?.channels === entry.channels);
  if (!intact) {
    throw new Error(
      `Animation clip/channel check failed: expected ${before.length} retained clips, got ${after.length}`,
    );
  }
  return { retained: after.length, removed: source.length - after.length };
}

function readableSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function loadState(): Promise<Record<string, BuildRecord>> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as Record<string, BuildRecord>;
  } catch {
    return {};
  }
}

/**
 * Keeps manifest output reproducible. A caller may pin a build date with SOURCE_DATE_EPOCH; an
 * incremental rebuild otherwise preserves the manifest's existing date instead of recording the
 * wall clock and changing an unrelated line on every run.
 */
async function manifestGeneratedAt(): Promise<string> {
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
  if (sourceDateEpoch !== undefined) {
    const seconds = Number(sourceDateEpoch);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`Invalid SOURCE_DATE_EPOCH: ${sourceDateEpoch}`);
    return new Date(seconds * 1_000).toISOString();
  }
  try {
    const previous = JSON.parse(await readFile(path.join(OUT_DIR, "manifest.json"), "utf8")) as Partial<Manifest>;
    if (typeof previous.generatedAt === "string" && Number.isFinite(Date.parse(previous.generatedAt))) {
      return previous.generatedAt;
    }
  } catch {
    // A first build has no date to preserve. The Unix epoch is stable and explicitly synthetic.
  }
  return new Date(0).toISOString();
}

async function buildOne(
  pick: Pick,
  state: Record<string, BuildRecord>,
  force: boolean,
  outputRoot = OUT_DIR,
): Promise<{ asset: ManifestAsset; sourceBytes: number; reused: boolean; note?: string }> {
  const relative = `models/${pick.category}/${pick.id}.glb`;
  const outFile = path.join(outputRoot, relative);
  const limit = pick.textureLimit ?? TEXTURE_LIMIT;
  const optionsHash = sha1(
    pick.animationLibrary ? ANIMATION_PIPELINE_VERSION : PIPELINE_VERSION,
    String(limit),
    pick.animationLibrary ? "anim" : "mesh",
    ...(pick.animationClips ?? []),
    relative,
    pick.tags.join(","),
    pick.category,
    pick.pack,
    ...(PACK_BY_ID.get(pick.pack)?.sourceFormat === "obj" ? [OBJ_CONVERTER_VERSION] : []),
  );

  const { zip, plan } = await planSource(pick);
  const inputHash = fingerprintSource(zip, plan);

  const cached = state[pick.id];
  // A record written before `base` existed would be replayed into the manifest verbatim and
  // silently delete the field for that asset, so it counts as stale even when its hashes match.
  const cacheable = cached?.asset.base !== undefined;
  if (!force && cached && cacheable && cached.optionsHash === optionsHash && cached.inputHash === inputHash) {
    let onDisk = -1;
    try {
      onDisk = (await stat(outFile)).size;
    } catch {
      onDisk = -1;
    }
    // The recorded byte count is the integrity check: a truncated or
    // half-written GLB never matches, so it is rebuilt instead of trusted.
    if (onDisk === cached.asset.bytes) {
      return { asset: cached.asset, sourceBytes: cached.sourceBytes, reused: true };
    }
  }

  const { document, sourceBytes } = await materialize(zip, plan);
  // Measured on the untouched source: quantization rewrites skinned vertex data
  // into normalized space, so post-transform bounds would lie for characters.
  // `base` has to come from here too: the two animation libraries ship with their meshes
  // stripped, so the OUTPUT GLB has no bounds at all — getBounds returns NaN on it — and only
  // the source still knows where the geometry sat.
  const metrics = measure(document);
  let note: string | undefined;

  if (pick.animationLibrary) {
    if (!pick.animationClips?.length) throw new Error(`Animation library has no runtime clip allowlist: ${pick.id}`);
    const result = await optimizeAnimationLibrary(document, pick.animationClips);
    note = `retained ${result.retained} clips, pruned ${result.removed}`;
  } else {
    await optimizeMesh(document, limit);
  }

  const glb = await io.writeBinary(document);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, glb);

  const asset = describe(pick, relative, glb.byteLength, document, metrics);
  state[pick.id] = { inputHash, optionsHash, sourceBytes, asset };
  return { asset, sourceBytes, reused: false, note };
}

function describe(
  pick: Pick,
  relative: string,
  bytes: number,
  document: Document,
  metrics: Metrics,
): ManifestAsset {
  const root = document.getRoot();
  return {
    id: pick.id,
    file: relative.replace(/\\/g, "/"),
    pack: pick.pack,
    category: pick.category,
    // The first tag is the subject and the rest are associations. Publishing the subject as its
    // own field is what stops a reader — human or agent — taking "stump" off the tag list of an
    // anvil that happens to stand on one, which is exactly what Phase 1 did.
    is: pick.tags[0] ?? pick.category,
    tags: pick.tags,
    bytes,
    size: metrics.size,
    base: metrics.base,
    animations: root.listAnimations().map((animation) => animation.getName()),
    materials: root.listMaterials().map((material) => material.getName()),
  };
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  let items: Dirent[];
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) total += await directorySize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

async function verify(): Promise<number> {
  const manifest = await readManifest();
  let failures = 0;
  for (const asset of manifest.assets) {
    const file = path.join(OUT_DIR, asset.file);
    try {
      const bytes = await readFile(file);
      if (bytes.byteLength !== asset.bytes) throw new Error(`size ${bytes.byteLength} != manifest ${asset.bytes}`);
      if (asset.sha256 && sha256(bytes) !== asset.sha256.toUpperCase()) {
        throw new Error(`SHA-256 does not match manifest ${asset.sha256}`);
      }
      const document = await io.readBinary(new Uint8Array(bytes));
      const meshes = document.getRoot().listMeshes().length;
      const animations = document.getRoot().listAnimations().length;
      if (asset.category === "animation") {
        if (animations === 0) throw new Error("animation library has no clips");
      } else if (meshes === 0) {
        throw new Error("no meshes");
      }
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${asset.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let artifactFailures = 0;
  for (const artifact of manifest.artifacts ?? []) {
    try {
      await validatePublishedFile(artifact);
    } catch (error) {
      artifactFailures += 1;
      console.error(`FAIL ${artifact.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`verify: ${manifest.assets.length - failures}/${manifest.assets.length} GLBs parsed and non-empty`);
  console.log(
    `verify: ${(manifest.artifacts?.length ?? 0) - artifactFailures}/${manifest.artifacts?.length ?? 0} ` +
      "recorded non-GLB artifacts match byte counts and SHA-256",
  );
  failures += artifactFailures;
  return failures;
}

/**
 * Re-measures `size` and `base` for every catalog entry straight from its source document and
 * compares them with the manifest. Nothing is decoded to disk, no GLB is rebuilt and no texture is
 * re-encoded, so this is the cheap way to confirm the manifest's measured metadata still describes
 * the sources — a full `--force` rebuild costs the whole 37.6 MB of output.
 *
 * With `--write` it also writes the measured values back. That path exists so `base` can be added
 * to a manifest whose GLBs are already correct, which is exactly how it was introduced: the
 * geometry did not change, only what we record about it.
 */
async function metrics(write: boolean): Promise<number> {
  const manifestFile = path.join(OUT_DIR, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as Manifest;
  const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  let changed = 0;
  for (const pick of CATALOG) {
    const asset = byId.get(pick.id);
    if (!asset) {
      console.error(`MISSING from manifest: ${pick.id}`);
      changed += 1;
      continue;
    }
    // Source, not output: quantization rewrites skinned vertex data into normalized space, and
    // the animation libraries have no mesh left in the output at all.
    const { document } = await loadSource(pick);
    const measured = measure(document);
    // Compared as serialized text because that is what ends up in the file: it makes -0 and 0
    // equal, which is the only way rounding a negative bound to 3 dp can differ from itself.
    const before = JSON.stringify({ size: asset.size, base: asset.base ?? null });
    const after = JSON.stringify({ size: measured.size, base: measured.base });
    if (before !== after) {
      changed += 1;
      console.log(`${pick.id.padEnd(24)} ${before} -> ${after}`);
      asset.size = measured.size;
      asset.base = measured.base;
    }
  }
  for (const zip of archives.values()) await zip.close();
  if (write && changed > 0) {
    await writeTextAtomically(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`metrics: rewrote ${changed} of ${manifest.assets.length} entries`);
  } else {
    console.log(`metrics: ${manifest.assets.length - changed}/${manifest.assets.length} entries match their source`);
  }
  return changed;
}

async function probe(zipKey: string, needle: string): Promise<void> {
  const pack = PACKS.find((entry) => entry.id === zipKey);
  const file = pack ? path.join(SOURCE_CACHE_DIR, pack.zip) : path.join(SOURCE_CACHE_DIR, zipKey);
  const zip = await ZipArchive.open(file);
  const matches = [...zip.entries.keys()].filter((name) => name.toLowerCase().includes(needle.toLowerCase()));
  for (const name of matches.slice(0, 40)) {
    console.log(name, zip.entries.get(name)!.uncompressedSize);
  }
  console.log(`(${matches.length} matches)`);
  await zip.close();
}

const MATERIAL_STAGE_ROOT = path.join(repoRoot, "test-results", "material-restoration");
const MATERIAL_STAGE_PACKS = new Set([
  "medieval-village-megakit",
  "fantasy-props-megakit",
  "modular-character-outfits-fantasy",
  "modular-character-outfits-fantasy-source",
]);

/** Requires explicit asset IDs or supported packs and a staging destination. Never publishes. */
export function materialStagingOptions(args: readonly string[]): { ids: string[]; outputRoot: string; packIds?: string[]; sharedTextures?: true } {
  const values = new Map<string, string>();
  let sharedTextures = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === "--stage-materials") continue;
    if (flag === "--shared-textures") { sharedTextures = true; continue; }
    if (flag !== "--only" && flag !== "--only-pack" && flag !== "--out") throw new Error(`Unknown material staging option: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith("--") || values.has(flag)) throw new Error(`Expected one value for ${flag}`);
    values.set(flag, value);
  }
  const ids = (values.get("--only") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const packIds = (values.get("--only-pack") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if ((!ids.length && !packIds.length) || ids.some((id) => !/^[a-z0-9_]+$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("Material staging requires --only with distinct exact asset IDs");
  }
  if (packIds.some(id => !MATERIAL_STAGE_PACKS.has(id)) || new Set(packIds).size !== packIds.length) {
    throw new Error("Material staging --only-pack requires distinct supported pack IDs");
  }
  if (!values.has("--out")) throw new Error("Material staging requires --out test-results/material-restoration/<name>");
  const outputRoot = path.resolve(repoRoot, values.get("--out")!);
  const relative = path.relative(MATERIAL_STAGE_ROOT, outputRoot);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Material staging output must stay inside ${MATERIAL_STAGE_ROOT}`);
  }
  return { ids, outputRoot, ...(packIds.length ? { packIds } : {}), ...(sharedTextures ? { sharedTextures: true as const } : {}) };
}

/** Exact source geometry, transforms, morphs, rig and motion; texture bytes are excluded. */
export function restorationGeometrySnapshot(document: Document): unknown {
  const root = document.getRoot();
  const nodes = root.listNodes();
  const meshes = root.listMeshes();
  const skins = root.listSkins();
  const accessor = (value: Accessor | null) => {
    if (!value) return null;
    const array = value.getArray();
    return {
      type: value.getType(), componentType: value.getComponentType(), normalized: value.getNormalized(),
      count: value.getCount(),
      bytes: array ? sha256(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) : null,
    };
  };
  return {
    scenes: root.listScenes().map((scene) => ({ name: scene.getName(), children: scene.listChildren().map(node => nodes.indexOf(node)) })),
    defaultScene: root.listScenes().indexOf(root.getDefaultScene()!),
    nodes: nodes.map((node) => ({
      name: node.getName(), translation: node.getTranslation(), rotation: node.getRotation(), scale: node.getScale(),
      children: node.listChildren().map(child => nodes.indexOf(child)), mesh: meshes.indexOf(node.getMesh()!),
      skin: skins.indexOf(node.getSkin()!), weights: node.getWeights(), extras: node.getExtras(),
    })),
    meshes: meshes.map((mesh) => ({
      name: mesh.getName(), weights: mesh.getWeights(),
      primitives: mesh.listPrimitives().map((primitive) => ({
        mode: primitive.getMode(), indices: accessor(primitive.getIndices()),
        attributes: primitive.listSemantics().sort().map(semantic => [semantic, accessor(primitive.getAttribute(semantic))]),
        targets: primitive.listTargets().map(target => target.listSemantics().sort().map(semantic => [semantic, accessor(target.getAttribute(semantic))])),
      })),
    })),
    skins: skins.map((skin) => ({
      name: skin.getName(), skeleton: nodes.indexOf(skin.getSkeleton()!),
      joints: skin.listJoints().map(joint => nodes.indexOf(joint)), inverseBindMatrices: accessor(skin.getInverseBindMatrices()),
    })),
    animations: root.listAnimations().map(animation => ({
      name: animation.getName(),
      channels: animation.listChannels().map(channel => ({
        node: nodes.indexOf(channel.getTargetNode()!), path: channel.getTargetPath(),
        interpolation: channel.getSampler()?.getInterpolation(),
        input: accessor(channel.getSampler()?.getInput() ?? null), output: accessor(channel.getSampler()?.getOutput() ?? null),
      })),
    })),
  };
}

/** NodeIO elides transforms within epsilon of identity. Preserve the source rig's exact TRS. */
export async function writeRestoredMaterialGlb(document: Document): Promise<Uint8Array> {
  const encoded = Buffer.from(await io.writeBinary(document));
  const jsonLength = encoded.readUInt32LE(12);
  const json = JSON.parse(encoded.subarray(20, 20 + jsonLength).toString("utf8")) as {
    nodes?: Array<{ name?: string; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }>;
  };
  const nodes = document.getRoot().listNodes();
  if ((json.nodes?.length ?? 0) !== nodes.length) throw new Error("GLB writer changed the node catalogue");
  nodes.forEach((node, index) => {
    const definition = json.nodes![index]!;
    if ((definition.name ?? "") !== node.getName()
      || JSON.stringify(definition.children ?? []) !== JSON.stringify(node.listChildren().map(child => nodes.indexOf(child)))) {
      throw new Error("GLB writer reordered nodes; authored transform preservation needs an explicit index mapping");
    }
    delete definition.matrix;
    definition.translation = node.getTranslation();
    definition.rotation = node.getRotation();
    definition.scale = node.getScale();
  });
  const text = Buffer.from(JSON.stringify(json));
  const paddedLength = Math.ceil(text.length / 4) * 4;
  const padded = Buffer.alloc(paddedLength, 0x20);
  text.copy(padded);
  const remainder = encoded.subarray(20 + jsonLength);
  const header = Buffer.from(encoded.subarray(0, 20));
  header.writeUInt32LE(20 + paddedLength + remainder.length, 8);
  header.writeUInt32LE(paddedLength, 12);
  return new Uint8Array(Buffer.concat([header, padded, remainder]));
}

function materialRestorationInventory(document: Document): unknown {
  return document.getRoot().listMaterials().map(material => ({
    name: material.getName(), baseColor: material.getBaseColorFactor(), metallic: material.getMetallicFactor(),
    roughness: material.getRoughnessFactor(), emissive: material.getEmissiveFactor(),
    normalScale: material.getNormalScale(), occlusionStrength: material.getOcclusionStrength(),
    alphaMode: material.getAlphaMode(), alphaCutoff: material.getAlphaCutoff(), doubleSided: material.getDoubleSided(),
    maps: {
      baseColor: material.getBaseColorTexture()?.getName() ?? null,
      normal: material.getNormalTexture()?.getName() ?? null,
      metallicRoughness: material.getMetallicRoughnessTexture()?.getName() ?? null,
      occlusion: material.getOcclusionTexture()?.getName() ?? null,
      emissive: material.getEmissiveTexture()?.getName() ?? null,
    },
  }));
}

async function stageMaterialRestoration(args: readonly string[]): Promise<void> {
  const { ids, outputRoot, packIds = [], sharedTextures = false } = materialStagingOptions(args);
  const selectedIds = [...new Set([...ids, ...CATALOG.filter(pick => packIds.includes(pick.pack)).map(pick => pick.id)])];
  const selected = selectedIds.map(id => {
    const pick = CATALOG.find(candidate => candidate.id === id);
    if (!pick) throw new Error(`Unknown material staging asset: ${id}`);
    if (!MATERIAL_STAGE_PACKS.has(pick.pack) || pick.animationLibrary) {
      throw new Error(`Material staging does not support ${id} from ${pick.pack}`);
    }
    return pick;
  });
  const previous = await readManifest();
  const published = new Map(previous.assets.map(asset => [asset.id, asset]));
  const assets: ManifestAsset[] = [];
  const records: unknown[] = [];
  const uniqueTextures = new Map<string, { bytes: number; estimatedRgba8MipBytes: number }>();
  const sharedFiles = new Map<string, { file: string; bytes: number; sha256: string; mimeType: string }>();
  let standaloneGlbBytes = 0;
  const failures: Array<{ id: string; error: string }> = [];
  await mkdir(outputRoot, { recursive: true });
  try {
    for (const pick of selected) {
      try {
        const pack = PACK_BY_ID.get(pick.pack)!;
        const { zip, plan } = await planSource(pick, true);
        const { document, sourceBytes } = await materialize(zip, plan);
        const sourceGeometry = JSON.stringify(restorationGeometrySnapshot(document));
        const sourceMaterials = materialRestorationInventory(document);
        const metrics = measure(document);
        // Keep the accepted 1K surface policy throughout this restoration library.
        // A prop and an equipped asset can share an atlas; category-wide 512 caps
        // would both lower visible detail and create a second copy of that atlas.
        const policy: MaterialTexturePolicy = {
          colorLimit: Math.max(1024, pick.textureLimit ?? 1024),
          dataLimit: 1024,
        };
        const textures = await restoreSourceMaterialTextures(document, policy);
        if (sourceGeometry !== JSON.stringify(restorationGeometrySnapshot(document))) {
          throw new Error("Material restoration modified source geometry, transforms, rig or animations");
        }
        const standalone = await writeRestoredMaterialGlb(document);
        const restored = await io.readBinary(standalone);
        const restoredGeometry = JSON.stringify(restorationGeometrySnapshot(restored));
        if (sourceGeometry !== restoredGeometry) {
          await writeTextAtomically(path.join(outputRoot, `${pick.id}.source-geometry.json`), sourceGeometry);
          await writeTextAtomically(path.join(outputRoot, `${pick.id}.restored-geometry.json`), restoredGeometry);
          throw new Error("GLB round-trip changed source geometry, UVs, pivots, rig or animations; diagnostic snapshots were staged");
        }
        if (JSON.stringify(sourceMaterials) !== JSON.stringify(materialRestorationInventory(restored))) {
          throw new Error("GLB round-trip changed authored material factors or bindings");
        }
        const relative = `models/${pick.category}/${pick.id}.glb`;
        const file = path.join(outputRoot, relative);
        const shared = sharedTextures ? externalizeGlbMaterialTextures(standalone, relative) : null;
        const glb = shared?.glb ?? standalone;
        for (const texture of shared?.textures ?? []) {
          if (sharedFiles.has(texture.file)) continue;
          const target = path.join(outputRoot, texture.file);
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, texture.bytes);
          sharedFiles.set(texture.file, { file: texture.file, bytes: texture.bytes.byteLength, sha256: texture.sha256, mimeType: texture.mimeType });
        }
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, glb);
        if (shared) {
          const external = await io.read(file);
          if (sourceGeometry !== JSON.stringify(restorationGeometrySnapshot(external))
            || JSON.stringify(sourceMaterials) !== JSON.stringify(materialRestorationInventory(external))) {
            throw new Error("Shared-texture GLB changed source geometry, rig, material factors or map bindings");
          }
          const externalImageHashes = external.getRoot().listTextures().map(texture => sha256(texture.getImage()!));
          const standaloneImageHashes = restored.getRoot().listTextures().map(texture => sha256(texture.getImage()!));
          if (JSON.stringify(externalImageHashes) !== JSON.stringify(standaloneImageHashes)) {
            throw new Error("Shared-texture GLB changed encoded image payloads or image order");
          }
        }
        standaloneGlbBytes += standalone.byteLength;
        const asset = describe(pick, relative, glb.byteLength, restored, metrics);
        assets.push(asset);
        for (const texture of textures) uniqueTextures.set(texture.outputSha256, {
          bytes: texture.outputBytes,
          estimatedRgba8MipBytes: Math.ceil(texture.width * texture.height * 4 * 4 / 3),
        });
        const old = published.get(pick.id);
        const publishedHash = old ? await sha256File(path.join(OUT_DIR, old.file)) : null;
        records.push({
          id: pick.id, asset, policy,
          optionsHash: sha1(MATERIAL_RESTORATION_VERSION, JSON.stringify(policy), pick.id, pick.pack),
          source: {
            archive: zip.file, archiveSha256: pack.archiveSha256, entry: plan.entry,
            entrySha256: sha256(await zip.read(plan.entry)), inputHash: fingerprintSource(zip, plan), sourceBytes,
            resources: plan.resources,
          },
          output: { file: relative, bytes: glb.byteLength, sha256: sha256(glb), standaloneBytes: standalone.byteLength, sharedTextures: shared?.textures.map(texture => texture.file) ?? [] },
          geometry: {
            exactSourceParity: true, sourceSha256: sha256(Buffer.from(sourceGeometry)), stagedSha256: sha256(Buffer.from(restoredGeometry)),
            meshes: restored.getRoot().listMeshes().length, skins: restored.getRoot().listSkins().length,
            nodes: restored.getRoot().listNodes().length, animations: restored.getRoot().listAnimations().length,
            bounds: metrics,
          },
          publishedBaseline: old ? {
            file: old.file, bytes: old.bytes, sha256: publishedHash, size: old.size, base: old.base,
            sourceBoundsMatch: JSON.stringify({ size: old.size, base: old.base }) === JSON.stringify(metrics),
          } : null,
          materials: sourceMaterials, textures,
          textureBudget: {
            encodedBytes: textures.reduce((sum, texture) => sum + texture.outputBytes, 0),
            estimatedRgba8MipBytes: textures.reduce((sum, texture) => sum + Math.ceil(texture.width * texture.height * 4 * 4 / 3), 0),
            note: "RGBA8 plus full mip pyramid estimate per asset before shared-texture deduplication",
          },
        });
        console.log(`staged ${pick.id}: ${readableSize(glb.byteLength)}, ${textures.length} textures, exact source geometry/rig parity`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ id: pick.id, error: message });
        console.error(`FAILED ${pick.id}: ${message}`);
      }
    }
    const manifest: Manifest = {
      generatedAt: previous.generatedAt,
      packs: PACKS.filter(pack => selected.some(pick => pick.pack === pack.id)).map(({ zip: _zip, root: _root, sourceFormat: _format, ...pack }) => pack),
      assets,
    };
    await writeTextAtomically(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeTextAtomically(path.join(outputRoot, "report.json"), `${JSON.stringify({
      version: MATERIAL_RESTORATION_VERSION, status: failures.length ? "failed" : "staged-awaiting-lab",
      selected: selectedIds, productionFilesWritten: false, sharedTextures, sharedFiles: [...sharedFiles.values()], assets: records, failures,
      summary: {
        glbBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
        standaloneGlbBytes,
        sharedTextureBytes: [...sharedFiles.values()].reduce((sum, texture) => sum + texture.bytes, 0),
        totalAssetBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0) + [...sharedFiles.values()].reduce((sum, texture) => sum + texture.bytes, 0),
        uniqueTextureImages: uniqueTextures.size,
        uniqueTextureBytes: [...uniqueTextures.values()].reduce((sum, texture) => sum + texture.bytes, 0),
        uniqueRgba8MipBytes: [...uniqueTextures.values()].reduce((sum, texture) => sum + texture.estimatedRgba8MipBytes, 0),
        note: sharedTextures
          ? "GLBs use exact encoded images via portable ../../textures/imported/<hash> URIs. File deduplication is measured; runtime request/image/GPU reuse still needs canonical URLs and loader/cache proof."
          : "Standalone GLBs repeat source atlases. Unique-image totals are a packaging opportunity, not current runtime memory proof.",
      },
    }, null, 2)}\n`);
    if (failures.length) throw new Error(`${failures.length}/${selected.length} material staging assets failed; see ${path.join(outputRoot, "report.json")}`);
  } finally {
    for (const zip of archives.values()) await zip.close();
    archives.clear();
    basenameIndex.clear();
  }
}


async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--stage-materials")) {
    await stageMaterialRestoration(args);
    return;
  }
  if (["--only", "--only-pack", "--out", "--shared-textures"].some(flag => args.includes(flag))) {
    throw new Error("Staging selection/output options require --stage-materials; no production build was started");
  }
  if (args[0] === "--probe") {
    await probe(args[1]!, args[2] ?? "");
    return;
  }
  if (args[0] === "--check") {
    let missing = 0;
    for (const pick of CATALOG) {
      try {
        await planSource(pick);
      } catch (error) {
        missing += 1;
        console.error(`MISSING ${pick.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const zip of archives.values()) await zip.close();
    console.log(`check: ${CATALOG.length - missing}/${CATALOG.length} source entries present`);
    process.exitCode = missing === 0 ? 0 : 1;
    return;
  }
  if (args[0] === "--verify") {
    process.exitCode = (await verify()) === 0 ? 0 : 1;
    return;
  }
  if (args[0] === "--preservation-check") {
    const manifest = await readManifest();
    const preserved = await preservedManifestRows(manifest);
    const preservedIds = new Set(preserved.assets.map((asset) => asset.id));
    const missing = [...REQUIRED_UNITY_ASSET_IDS].filter((id) => !preservedIds.has(id));
    if (missing.length > 0) throw new Error(`Missing required Unity manifest rows: ${missing.join(", ")}`);
    const combinedIds = new Set(CATALOG.map((pick) => pick.id));
    for (const asset of preserved.assets) {
      if (combinedIds.has(asset.id)) throw new Error(`Legacy/imported asset id collision: ${asset.id}`);
      combinedIds.add(asset.id);
    }
    console.log(
      `preservation-check: a legacy build would retain ${preserved.assets.length} imported GLBs, ` +
        `${preserved.artifacts.length} external artifact(s), and ${preserved.packs.length} external pack record(s)`,
    );
    console.log(`preservation-check: ${[...preservedIds].sort().join(", ")}`);
    return;
  }
  if (args[0] === "--metrics") {
    const changed = await metrics(args.includes("--write"));
    process.exitCode = changed === 0 || args.includes("--write") ? 0 : 1;
    return;
  }

  const force = args.includes("--force");
  const ids = new Set<string>();
  for (const pick of CATALOG) {
    if (ids.has(pick.id)) throw new Error(`Duplicate asset id: ${pick.id}`);
    if (!/^[a-z0-9_]+$/.test(pick.id)) throw new Error(`Bad asset id (lowercase snake_case only): ${pick.id}`);
    ids.add(pick.id);
  }

  const previousManifest = await readManifest();
  const preserved = await preservedManifestRows(previousManifest);
  const previousManifestText = await readFile(MANIFEST_FILE, "utf8");
  let previousStateText: string | null = null;
  try {
    previousStateText = await readFile(STATE_FILE, "utf8");
  } catch {
    previousStateText = null;
  }
  const transactionId = randomUUID();
  const stageRoot = path.join(path.dirname(OUT_DIR), `.corealm-assets-stage-${transactionId}`);
  const stagedModelsDir = path.join(stageRoot, "models");
  await mkdir(stageRoot, { recursive: true });
  try {
    await cp(MODELS_DIR, stagedModelsDir, { recursive: true, force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
    await mkdir(stagedModelsDir, { recursive: true });
  }
  const state = await loadState();
  const assets: ManifestAsset[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  let totalSource = 0;
  let totalOut = 0;
  let reusedCount = 0;
  const oversize: ManifestAsset[] = [];

  console.log(`building ${CATALOG.length} assets from ${PACKS.length} packs${force ? " (forced)" : ""}\n`);

  for (const pick of CATALOG) {
    try {
      const result = await buildOne(pick, state, force, stageRoot);
      assets.push(result.asset);
      totalSource += result.sourceBytes;
      totalOut += result.asset.bytes;
      if (result.reused) reusedCount += 1;
      if (ENVIRONMENT_CATEGORIES.has(pick.category) && result.asset.bytes > 400_000) {
        oversize.push(result.asset);
      }
      const ratio = result.sourceBytes ? `${((1 - result.asset.bytes / result.sourceBytes) * 100).toFixed(0)}%` : "-";
      const tag = result.reused ? "cached " : "built  ";
      console.log(
        `${tag}${pick.id.padEnd(34)} ${readableSize(result.sourceBytes).padStart(10)} -> ${readableSize(
          result.asset.bytes,
        ).padStart(10)}  (-${ratio})${result.note ? `  [${result.note}]` : ""}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: pick.id, error: message });
      console.error(`FAILED ${pick.id}: ${message}`);
    }
  }

  if (failures.length > 0) {
    for (const zip of archives.values()) await zip.close();
    await rm(stageRoot, { recursive: true, force: true });
    console.log("\nlegacy build failed; manifest, build state, external GLBs, and stale outputs were left untouched");
    for (const failure of failures) console.log(`  ${failure.id}: ${failure.error}`);
    process.exitCode = 1;
    return;
  }

  // Drop only files that the previous manifest attributed to this legacy builder. Imported Unity
  // GLBs and unregistered files are outside this tool's ownership and are never sweep candidates.
  const currentLegacyIds = new Set(assets.map((asset) => asset.id));
  const removed: string[] = [];
  for (const previous of previousManifest.assets) {
    if (!LEGACY_PACK_IDS.has(previous.pack) || currentLegacyIds.has(previous.id)) continue;
    const full = path.resolve(stageRoot, previous.file);
    const modelsPrefix = `${path.resolve(stagedModelsDir)}${path.sep}`;
    if (!full.startsWith(modelsPrefix) || path.extname(full).toLowerCase() !== ".glb") {
      throw new Error(`Refusing to sweep unexpected legacy path: ${previous.file}`);
    }
    await rm(full, { force: true });
    removed.push(previous.file);
  }
  for (const id of Object.keys(state)) {
    if (!ids.has(id)) delete state[id];
  }

  // `preserved` already carries every row this builder does not own — the imported Unity weapon and
  // rock GLBs, and the Animal pack deluxe GLBs that `tools/build-animals.ts` converts out of a
  // .unitypackage of binary FBX that this tool cannot read. They are replayed, not rebuilt, and
  // `preservedManifestRows` re-checks each file's size and SHA-256 before trusting the row.
  const usedPacks = new Set(assets.map((asset) => asset.pack));
  const manifest: Manifest = {
    generatedAt: await manifestGeneratedAt(),
    packs: [
      ...PACKS.filter((pack) => usedPacks.has(pack.id)).map(({ id, name, author, source, license, archiveSha256 }) => ({
        id,
        name,
        author,
        source,
        license,
        archiveSha256,
      })),
      ...preserved.packs,
    ],
    assets: [...assets, ...preserved.assets].sort(
      (a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id),
    ),
    artifacts: preserved.artifacts.sort((a, b) => a.id.localeCompare(b.id)),
  };
  await mkdir(OUT_DIR, { recursive: true });
  const backupModelsDir = path.join(OUT_DIR, `.models-backup-${transactionId}`);
  let modelsPublished = false;
  let manifestPublished = false;
  try {
    await rename(MODELS_DIR, backupModelsDir);
    await rename(stagedModelsDir, MODELS_DIR);
    modelsPublished = true;
    await writeTextAtomically(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
    manifestPublished = true;
    await writeTextAtomically(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    if (modelsPublished) {
      await rm(MODELS_DIR, { recursive: true, force: true });
      await rename(backupModelsDir, MODELS_DIR);
    }
    if (manifestPublished) await writeFile(MANIFEST_FILE, previousManifestText, "utf8");
    if (previousStateText === null) await rm(STATE_FILE, { force: true });
    else await writeFile(STATE_FILE, previousStateText, "utf8");
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }
  await rm(backupModelsDir, { recursive: true, force: true });
  await rm(stageRoot, { recursive: true, force: true });

  for (const zip of archives.values()) await zip.close();

  const byCategory = new Map<string, { count: number; bytes: number }>();
  for (const asset of assets) {
    const entry = byCategory.get(asset.category) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += asset.bytes;
    byCategory.set(asset.category, entry);
  }

  console.log("\n== summary");
  console.log(`assets        ${assets.length} built/valid, ${reusedCount} reused from cache, ${failures.length} failed`);
  console.log(`source bytes  ${readableSize(totalSource)}`);
  console.log(`output bytes  ${readableSize(totalOut)} (${((1 - totalOut / totalSource) * 100).toFixed(1)}% smaller)`);
  console.log(`models dir    ${readableSize(await directorySize(MODELS_DIR))}`);
  if (removed.length) console.log(`removed stale ${removed.length}: ${removed.slice(0, 8).join(", ")}`);
  console.log("\ncategory        count      bytes");
  for (const [category, entry] of [...byCategory].sort()) {
    console.log(`${category.padEnd(14)} ${String(entry.count).padStart(5)} ${readableSize(entry.bytes).padStart(10)}`);
  }
  if (oversize.length) {
    console.log(`\n${oversize.length} environment GLB(s) over the 400 KB target:`);
    for (const asset of oversize) console.log(`  ${asset.id} ${readableSize(asset.bytes)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
