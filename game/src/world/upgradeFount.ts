import type { RegionId, SemanticEntity, Vec3 } from '../contracts.js';

export function createUpgradeFount(id: string, position: Vec3, regionId: RegionId): SemanticEntity {
  return { id, name: 'Upgrade Fount', archetype: 'landmark', tier: 1, regionId, position, state: 'available',
    interactions: ['upgrade', 'inspect'], interactionPosition: [position[0], position[1], position[2] - 2.5],
    view: { assetId: 'upgrade_fount', scale: 5, labelHeight: 2.8 }, meta: { upgradeFount: true } };
}
