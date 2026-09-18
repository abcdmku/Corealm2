import {describe,expect,it,vi} from "vitest";
import * as THREE from "three";
import {remoteEquipmentParts,RemoteEquipmentSources} from "../game/src/render/remoteEquipment.js";
import {gearAppearanceParts} from "../game/src/render/equipmentVisuals.js";

describe("remote equipped appearance",()=>{
  it("retains mixed armour slots and tier treatments from production mappings",()=>{
    const equipment={head:"grithe_helm",body:"corven_plate",legs:"grithe_greaves",feet:"corven_boots",mainHand:"grithe_sword"};
    const {gear,defaults}=remoteEquipmentParts(equipment,"base_male");
    for(const id of Object.values(equipment))for(const part of gearAppearanceParts(id))expect(gear).toContainEqual(part);
    expect(defaults).toEqual(["outfit_male_peasant_gloves"]);
    expect(new Set(gear.map(part=>part.tint)).size).toBeGreaterThan(1);
  });
  it("uses clothing only for unequipped slots and resolves the correct body variant",()=>{
    const result=remoteEquipmentParts({head:"marchhide_hood"},"base_female");
    expect(result.gear).toEqual(gearAppearanceParts("marchhide_hood","female"));
    expect(result.defaults).toHaveLength(4);
    expect(result.defaults.every(id=>id.includes("female_peasant"))).toBe(true);
    expect(remoteEquipmentParts({},"base_male").gear).toHaveLength(0);
  });
  it("shares compatible treatments without recolouring or disposing source assets",()=>{
    const source=new THREE.Group(),material=new THREE.MeshStandardMaterial({color:0xffffff});material.name="MI_Knight";
    source.add(new THREE.Mesh(new THREE.BoxGeometry(),material));
    const dispose=vi.spyOn(material,"dispose"),cache=new RemoteEquipmentSources(),appearance=gearAppearanceParts("corven_plate")[0]!;
    const first=cache.get(source,appearance),second=cache.get(source,appearance);
    expect(first).toBe(second);
    const drawn=(first.children[0] as THREE.Mesh).material as THREE.Material;
    expect(drawn).not.toBe(material);expect(drawn.name).toMatch(/^equipped:/);
    expect(material.name).toBe("MI_Knight");
    const ownedDispose=vi.spyOn(drawn,"dispose");cache.dispose();
    expect(ownedDispose).toHaveBeenCalledOnce();expect(dispose).not.toHaveBeenCalled();
  });
});
