import { cloneNodeMaterial, ensureNodeMaterial } from "./nodeMaterials.js";
import * as THREE from "three";
import {clone as cloneRigged} from "three/examples/jsm/utils/SkeletonUtils.js";
import type {EquipSlot,ItemId} from "../contracts.js";
import { FISHING_ROD_LOOKS, fishingRodAssetId } from "./proceduralGear.js";
import {applyGearAppearance,gearAppearanceParts,gatheringToolAppearance,VISIBLE_EQUIP_SLOTS,type GearAppearance} from "./equipmentVisuals.js";

export type PublicEquipment = Partial<Record<EquipSlot,ItemId>>;
const CLOTHING = {body:"chest",legs:"legs",feet:"boots",hands:"gloves"} as const;

/** Use the player's production item mappings, including mixed tiers and empty slots. */
export function remoteEquipmentParts(equipment: PublicEquipment, bodyAssetId: string) {
  const sex=bodyAssetId==="base_female"?"female":"male";
  const gear:GearAppearance[]=[];
  for(const slot of VISIBLE_EQUIP_SLOTS){
    const item=equipment[slot];
    if(item) {
      const tool = slot === "mainHand" ? gatheringToolAppearance(item)
        ?? (FISHING_ROD_LOOKS[item] ? {slot:"mainHand" as const,attach:"bone" as const,assetId:fishingRodAssetId(item)} : null) : null;
      gear.push(...(tool ? [{...tool,itemId:item}] : gearAppearanceParts(item,sex).filter(part=>part.slot===slot)));
    }
  }
  const defaults=Object.entries(CLOTHING).flatMap(([slot,part])=>
    gear.some(piece=>piece.slot===slot)?[]:[`outfit_${sex}_peasant_${part}`]);
  return {gear,defaults};
}

/** Materials belong to compatible equipment appearances, never to a player or crowd tier. */
export class RemoteEquipmentSources {
  private readonly sources=new Map<string,THREE.Object3D>();
  private readonly materials=new Set<THREE.Material>();
  private readonly skeletons=new Set<THREE.Skeleton>();
  get(source:THREE.Object3D,appearance:GearAppearance):THREE.Object3D {
    const key=JSON.stringify(appearance),existing=this.sources.get(key);
    if(existing)return existing;
    const object=cloneRigged(source);
    const shared=new Set<THREE.Material>();
    source.traverse(node=>{const mesh=node as THREE.Mesh;if(mesh.isMesh)
      for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])shared.add(material);});
    applyGearAppearance(object,appearance);
    object.traverse(node=>{
      const mesh=node as THREE.SkinnedMesh;
      if(!mesh.isMesh)return;
      // Mark after applying the production treatment. NPC dyes must not overwrite armour tiers.
      const protect=(material:THREE.Material)=>{
        if(shared.has(material)){
          material=cloneNodeMaterial(material);
        }
        material=ensureNodeMaterial(material);
        material.name=`equipped:${appearance.assetId}:${appearance.tint??"native"}:${material.name}`;
        this.materials.add(material);return material;
      };
      mesh.material=Array.isArray(mesh.material)?mesh.material.map(protect):protect(mesh.material);
      if(mesh.isSkinnedMesh)this.skeletons.add(mesh.skeleton);
    });
    this.sources.set(key,object);return object;
  }
  dispose():void {
    for(const material of this.materials)material.dispose();
    for(const skeleton of this.skeletons)skeleton.dispose();
    this.materials.clear();this.skeletons.clear();this.sources.clear();
  }
}
