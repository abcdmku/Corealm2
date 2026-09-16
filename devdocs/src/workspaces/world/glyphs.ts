import { Anvil, Circle, DoorOpen, Fish, Flag, Footprints, Home, Layers, MapPin, Mountain, Pickaxe, Route, Skull, Store, Tent, TreePine, User, Vault, Waves, Wind, Droplets, Sprout, Eye, Shield, type LucideIcon } from "lucide-react";
import type { Feature, Layer } from "./model.js";

/*
  One glyph per thing on the map and in the list. Colours are hsl so the same hue works on the
  dark map image and in both themes; the disc is the hue, the icon is white.
*/

const LOCATION_ICON: Record<string, LucideIcon> = { junction: Circle, gate: DoorOpen, settlement: Home, bank: Vault, landmark: Flag, seam: Pickaxe, grove: TreePine, water: Waves, camp: Tent, dungeon: Skull };
const LOCATION_HUE: Record<string, number> = { junction: 0, gate: 28, settlement: 42, bank: 42, landmark: 275, seam: 20, grove: 120, water: 205, camp: 35, dungeon: 350 };
const ACTIVITY_HUE: Record<string, number> = { graze: 110, forage: 165, prowl: 25, patrol: 280 };
const ACTIVITY_ICON: Record<string, LucideIcon> = { graze: Sprout, forage: Eye, prowl: Footprints, patrol: Shield };
const RESOURCE_ICON: Record<string, LucideIcon> = { ore: Pickaxe, tree: TreePine, fishing_spot: Fish };
const RESOURCE_HUE: Record<string, number> = { ore: 30, tree: 125, fishing_spot: 200 };
const PIECE_ICON: Record<string, LucideIcon> = { building: Home, station: Anvil, shop: Store, bank: Vault };

export const LAYER_ICON: Record<Layer, LucideIcon> = { regions: Layers, roads: Route, locations: MapPin, settlements: Home, npcs: User, landmarks: Flag, gates: DoorOpen, obstacles: Mountain, spawns: Footprints, resources: Pickaxe };

export function glyphIcon(feature: Feature): LucideIcon {
  switch (feature.layer) {
    case "regions": return Layers;
    case "locations": return LOCATION_ICON[feature.glyph] ?? MapPin;
    case "settlements": return PIECE_ICON[feature.glyph] ?? Home;
    case "npcs": return User;
    case "landmarks": return Flag;
    case "gates": return DoorOpen;
    case "obstacles": return feature.glyph === "enter" ? DoorOpen : feature.glyph === "climb" ? Mountain : Wind;
    case "spawns": return ACTIVITY_ICON[feature.glyph] ?? Footprints;
    case "resources": return RESOURCE_ICON[feature.glyph] ?? Droplets;
    default: return Circle;
  }
}

export function glyphHue(feature: Feature): number {
  switch (feature.layer) {
    case "locations": return LOCATION_HUE[feature.glyph] ?? 0;
    case "settlements": return feature.glyph === "bank" ? 45 : feature.glyph === "shop" ? 190 : feature.glyph === "station" ? 15 : 40;
    case "npcs": return 320;
    case "landmarks": return 275;
    case "gates": return 28;
    case "obstacles": return 0;
    case "spawns": return ACTIVITY_HUE[feature.glyph] ?? 280;
    case "resources": return RESOURCE_HUE[feature.glyph] ?? 30;
    default: return 210;
  }
}

/** Saturation drops for the plain grey things (junctions, obstacles, buildings). */
export function glyphColor(feature: Feature, lightness = 58): string {
  const grey = feature.layer === "regions" || (feature.layer === "locations" && feature.glyph === "junction") || feature.layer === "obstacles" || (feature.layer === "settlements" && feature.glyph === "building");
  return `hsl(${glyphHue(feature)} ${grey ? 8 : 55}% ${lightness}%)`;
}

/** The round glyph beside a name in the list and the inspector; its background is `glyphColor(feature, 40)`. */
export const GLYPH_DISC = "inline-grid size-[18px] shrink-0 place-items-center rounded-full text-white";
