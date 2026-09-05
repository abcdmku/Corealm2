import type { EntityId, SemanticEntity, SolidVolume, Vec3 } from "../contracts.js";
import { FEATURE_LAB_BANK_ID } from "../app/bootProfile.js";
import { buildWorld, type WorldPorts } from "../world/regionBuilder.js";

export interface ShopFixture {
  entities: SemanticEntity[];
  solids: SolidVolume[];
  shopId: EntityId;
  bankId: EntityId;
  interactionPosition: Vec3;
}

/** The authored Coldbrace stall, translated into the lab. Economy retains its real shop data. */
export function assembleShopFixture(
  heightAt: (x: number, z: number) => number,
  ports: Pick<WorldPorts, "baseY" | "assetSize" | "assetCenterXZ">,
): ShopFixture {
  const source = buildWorld(2, () => 0, { ...ports, heightAt: () => 0 });
  const shopId = "coldbrace_general";
  const shop = source.entities.find((entity) => entity.id === shopId);
  if (!shop || shop.archetype !== "shop") throw new Error("Missing authored Coldbrace shop");
  const dx = 8 - shop.position[0];
  const dz = -shop.position[2];
  const translate = (position: Vec3): Vec3 => {
    const x = position[0] + dx;
    const z = position[2] + dz;
    return [x, position[1] + heightAt(x, z), z];
  };
  const interactionPosition: Vec3 = [6, heightAt(6, 0), 0];
  return {
    shopId,
    bankId: FEATURE_LAB_BANK_ID,
    interactionPosition,
    entities: [{
      ...shop,
      position: translate(shop.position),
      interactionPosition,
      regionId: "fallowmarch",
      meta: { ...shop.meta, featureLab: true, shopFixture: true },
    }],
    solids: source.solids.filter((solid) => solid.id === shopId).map((solid) => ({
      ...solid, position: translate(solid.position),
    })),
  };
}
