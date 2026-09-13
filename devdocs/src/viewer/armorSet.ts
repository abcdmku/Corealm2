import type { EquipSlot, ItemStack } from '../../../game/src/contracts.js';
import { CharacterRig } from '../../../game/src/render/characterRig.js';
import { gearAppearanceParts } from '../../../game/src/render/equipmentVisuals.js';
import { awaitFabArmorTextures } from '../../../game/src/render/fabArmor.js';
import { viewerRegistry } from './registry.js';
import { defaultItemPose, humanoidClipGroups, poseClip } from './clips.js';
import type { ViewerAttachment, ViewerModel, ViewerSource } from './types.js';

export async function loadOutfit(source: Extract<ViewerSource, { mode: 'outfit' }>): Promise<ViewerModel> {
  const assets = await viewerRegistry();
  await assets.loadAnimationLibraries();
  const body = source.body ?? 'male';
  const rig = new CharacterRig(assets);
  try {
    // CharacterRig uses the same production skin binding as loadDressedCharacter, and also owns
    // authored item overrides, tailored body coverage, measured sockets, trims and held tools.
    if (!await rig.build({ bodyAssetId: `base_${body}`, completeOutfit: false, hairAssetId: null, mergeParts: false, preloadGear: false })) {
      throw new Error(`Could not build the ${body} production rig`);
    }
    const itemIds = [...source.itemIds, source.mainHandId, source.offHandId].filter((id): id is string => Boolean(id));
    await rig.prepareItems(itemIds);
    const slots: Partial<Record<EquipSlot, ItemStack>> = {};
    for (const itemId of source.itemIds) {
      const slot = gearAppearanceParts(itemId, body)[0]?.slot;
      if (!slot) throw new Error(`No worn appearance is registered for ${itemId}`);
      slots[slot] = { itemId, quantity: 1 };
    }
    if (source.mainHandId) slots.mainHand = { itemId: source.mainHandId, quantity: 1 };
    if (source.offHandId) slots.offHand = { itemId: source.offHandId, quantity: 1 };
    await rig.applyEquipment(slots);
    const pose = source.pose ?? defaultItemPose(source.mainHandId);
    if (source.mainHandId && ['mine', 'chop', 'fish'].includes(pose)) {
      rig.poseFor({ moving: false, speed: 0, dead: false, inCombat: false, activityKind: 'gathering',
        activitySkill: pose === 'mine' ? 'mining' : pose === 'chop' ? 'woodcutting' : 'fishing', activityToolItemId: source.mainHandId });
      // prepareItems already awaited the original graphs; the activity attachment resumes from
      // that cached Promise before this continuation.
      await Promise.resolve();
    }
    await awaitFabArmorTextures();
    const state = rig.motionSnapshot(true);
    if (state.layerLoadPending || Object.keys(state.attachmentErrors ?? {}).length || Object.keys(state.attachmentLoading ?? {}).length) {
      throw new Error(`Equipment did not finish loading: ${JSON.stringify(state.attachmentErrors ?? state.attachmentLoading)}`);
    }
    if (state.layerMissingBones?.length) throw new Error(`Equipment has missing bones: ${state.layerMissingBones.join(', ')}`);
    if (source.mainHandId && !state.attachments?.mainHand) throw new Error(`Main-hand model did not attach: ${source.mainHandId}`);
    if (source.offHandId && !state.attachments?.offHand) throw new Error(`Off-hand model did not attach: ${source.offHandId}`);
    const attachments: ViewerAttachment[] = Object.entries(state.attachments ?? {}).map(([slot, asset]) => {
      const object = rig.root.getObjectByName(asset);
      return { slot, asset, bone: object?.parent?.name ?? '', position: object?.position.toArray() ?? [], rotation: object ? [object.rotation.x, object.rotation.y, object.rotation.z] : [], scale: object?.scale.toArray() ?? [] };
    });
    const clips = assets.clipNames().flatMap(name => { const clip = assets.clip(name); return clip ? [clip] : []; });
    const names = clips.map(clip => clip.name);
    return { root: rig.root, animationRoot: rig.root.getObjectByName('body') ?? rig.root, clips,
      clipGroups: humanoidClipGroups(names), initialClip: poseClip(names, pose), body,
      parts: state.layerAssets ?? [], attachments, missingBones: state.layerMissingBones ?? [], dispose: () => rig.dispose() };
  } catch (error) { rig.dispose(); throw error; }
}
