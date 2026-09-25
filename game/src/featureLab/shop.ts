import type { EntityId, SemanticEntity, SolidVolume, Vec3 } from "../contracts.js";
import { FEATURE_LAB_BANK_ID } from "../app/bootProfile.js";
import { REGIONS } from "../content/regions.js";
import { assetSolidFromMeasurements, type WorldPorts } from "../world/regionBuilder.js";

export interface ShopFixture {
  entities: SemanticEntity[];
  solids: SolidVolume[];
  shopId: EntityId;
  bankId: EntityId;
  interactionPosition: Vec3;
}

const DEFAULT_SHOP_ID = "coldbrace_general";
/** `regionBuilder.drawnScale`: a shop is not a tiered archetype and authors no view scale. */
const SHOP_SCALE = 1;
/** Where the stall stands in the yard, a step from the lab bank and inside the first camera frame. */
const SHOP_X = 8;
const SHOP_Z = 0;

/**
 * An authored stall, translated into the lab. Economy retains its real shop data.
 *
 * This reads the one authored `ShopDef` and emits the same entity `regionBuilder.ts` emits for it,
 * rather than calling `buildWorld` to assemble every region and then throwing the rest away. That
 * shortcut used to work; it stopped when the world gained derived placement that needs real terrain
 * (`deriveUniversalMinibossSockets` rejects the flat `heightAt` a lab passes, so the shop lab could
 * not boot at all). Nothing about a market stall needs the world built.
 */
export function assembleShopFixture(
  heightAt: (x: number, z: number) => number,
  ports: Pick<WorldPorts, "baseY" | "assetSize" | "assetCenterXZ">,
  shopId = DEFAULT_SHOP_ID,
): ShopFixture {
  const region = REGIONS.find((candidate) => candidate.settlements
    .some((town) => town.shops.some((shop) => shop.id === shopId)));
  const settlement = region?.settlements.find((town) => town.shops.some((shop) => shop.id === shopId));
  const shop = settlement?.shops.find((candidate) => candidate.id === shopId);
  if (!region || !settlement || !shop) throw new Error(`Missing authored shop: ${shopId}`);

  // `regionBuilder.placeOnGround`: the asset's own bbox floor sits on the ground at drawn scale.
  const baseY = ports.baseY ?? ((): number => 0);
  const position: Vec3 = [SHOP_X, heightAt(SHOP_X, SHOP_Z) - baseY(shop.assetId) * SHOP_SCALE, SHOP_Z];
  const approach = (ports.assetSize?.(shop.assetId)?.z ?? 2.8) / 2 + 0.6;
  const interactionPosition: Vec3 = [SHOP_X, heightAt(SHOP_X, SHOP_Z + approach), SHOP_Z + approach];
  const solid = assetSolidFromMeasurements(shop.id, position, shop.assetId, SHOP_SCALE, 0, true, {
    assetSize: ports.assetSize ?? ((): null => null),
    assetCenterXZ: ports.assetCenterXZ ?? ((): null => null),
  });
  return {
    shopId: shop.id,
    bankId: FEATURE_LAB_BANK_ID,
    interactionPosition,
    entities: [{
      id: shop.id,
      archetype: "shop",
      name: shop.name,
      tier: settlement.tier,
      regionId: "fallowmarch",
      position,
      state: "open",
      interactions: ["inspect", "trade"],
      interactionPosition,
      view: { assetId: shop.assetId, rotationY: 0, labelHeight: 3 },
      meta: { shopKind: shop.shopKind, settlementId: settlement.id, featureLab: true, shopFixture: true },
    }],
    solids: solid ? [solid] : [],
  };
}
