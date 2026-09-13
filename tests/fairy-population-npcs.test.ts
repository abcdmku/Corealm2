import { describe, expect, it } from 'vitest';
import {
  FAIRY_NPC_CANDIDATES,
  FAIRY_NPC_DIALOGUE,
  FAIRY_NPC_SCALE,
  FAIRY_NPC_STANDS,
  fairyNpcCandidate,
  fairyNpcPresentation,
} from '../game/src/content/fairyNpcs.js';
import { DIALOGUE_NODES, dialogueNode, validateDialogue } from '../game/src/content/dialogue.js';

describe('fairy NPC candidates', () => {
  it('keeps twelve unique named candidates, six per fairy region, on four source skins', () => {
    expect(FAIRY_NPC_CANDIDATES).toHaveLength(12);
    expect(new Set(FAIRY_NPC_CANDIDATES.map(npc => npc.id)).size).toBe(12);
    expect(new Set(FAIRY_NPC_CANDIDATES.map(npc => npc.name)).size).toBe(12);
    expect(new Set(FAIRY_NPC_CANDIDATES.map(npc => npc.assetId))).toEqual(new Set([
      'npc_fey_opaline', 'npc_fey_autumn', 'npc_fey_nightshade', 'npc_fey_frostbloom',
    ]));
    expect(FAIRY_NPC_CANDIDATES.filter(npc => npc.regionId === 'gloamgarden')).toHaveLength(6);
    expect(FAIRY_NPC_CANDIDATES.filter(npc => npc.regionId === 'faeholme')).toHaveLength(6);
    for (const npc of FAIRY_NPC_CANDIDATES) {
      expect(fairyNpcCandidate(npc.id)).toBe(npc);
      expect(npc.id.startsWith('npc_fey_')).toBe(true);
      expect(npc.assetId.startsWith('npc_fey_')).toBe(true);
      expect(npc.bindHeightMetres).toBeGreaterThan(0);
      expect(npc.locationId).toBe(npc.regionId === 'gloamgarden' ? 'lantern_rest_square' : 'prism_hollow_square');
      expect(fairyNpcPresentation(npc.assetId)).toEqual({ scale: FAIRY_NPC_SCALE, labelHeight: 1.4 });
    }
  });

  it('authors twelve matching village stands, six in each fairy region', () => {
    expect(FAIRY_NPC_STANDS).toHaveLength(12);
    expect(new Set(FAIRY_NPC_STANDS.map(npc => npc.id)).size).toBe(12);
    const candidatesById = new Map(FAIRY_NPC_CANDIDATES.map(npc => [npc.id, npc]));
    for (const stand of FAIRY_NPC_STANDS) {
      const candidate = candidatesById.get(stand.id);
      expect(candidate, stand.id).toBeDefined();
      expect(stand.name, stand.id).toBe(candidate!.name);
      expect(stand.assetId, stand.id).toBe(candidate!.assetId);
      expect(stand.dialogueRootId, stand.id).toBe(candidate!.dialogueRootId);
    }
    for (const regionId of ['gloamgarden', 'faeholme'] as const) {
      expect(FAIRY_NPC_STANDS.filter(stand => candidatesById.get(stand.id)?.regionId === regionId)).toHaveLength(6);
    }
  });
});

describe('fairy NPC dialogue graph', () => {
  it('registers every candidate root and both browser-visible branches', () => {
    expect(validateDialogue()).toEqual([]);
    expect(FAIRY_NPC_DIALOGUE.every(node => DIALOGUE_NODES.includes(node))).toBe(true);
    const optionIds = new Set<string>();
    for (const npc of FAIRY_NPC_CANDIDATES) {
      const root = dialogueNode(npc.dialogueRootId);
      expect(root, npc.id).toBeDefined();
      expect(root?.speaker, npc.id).toBe(npc.name);
      expect(root?.options).toHaveLength(2);
      const branch = root!.options.find(option => option.next !== null);
      const farewell = root!.options.find(option => option.next === null);
      expect(branch, npc.id).toBeDefined();
      expect(farewell, npc.id).toBeDefined();
      expect(branch!.next, npc.id).toBeTruthy();
      const detail = dialogueNode(branch!.next!);
      expect(detail, npc.id).toBeDefined();
      expect(detail?.speaker, npc.id).toBe(npc.name);
      expect(detail?.options).toHaveLength(1);
      expect(detail?.options[0]?.next, npc.id).toBeNull();
      for (const node of [root!, detail!]) for (const option of node.options) {
        expect(optionIds.has(option.id), option.id).toBe(false);
        optionIds.add(option.id);
      }
    }
  });
});
