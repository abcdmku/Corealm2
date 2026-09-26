import type { EquipmentBonuses, ItemDef, UpgradeRequest } from '../contracts.js';
import { content } from '../content/index.js';
import { ENCHANTMENTS, enchantmentDescription, enchantmentFits, isJewelry, isUpgradeable, itemUpgrade, requiredUpgradeScroll, upgradeChance, upgradedItemId, UPGRADE_BOOSTER } from '../content/itemUpgrades.js';
import { sendGameCommand } from '../api/commands.js';
import { PanelFrame } from './panelFrame.js';
import type { ManagedPanel, UiContext } from './panels.js';
import { createItemIcon } from './itemIcons.js';
import { createUiIcon } from './icons.js';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}

export class UpgradePanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private fountId = '';
  private selected = '';
  private mode: 'rank' | 'magic' = 'rank';
  private boosters = 0;
  private enchantment: typeof ENCHANTMENTS[number] = 'strength';
  private busy = false;
  private message = '';
  private outcome: 'success' | 'failure' | '' = '';
  private signature = '';
  private detachTooltips: (() => void)[] = [];

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({ id: 'upgrade-fount', title: 'Upgrade Fount', registry: ctx.registry,
      placement: { top: '60px', left: 'calc(50% - 196px)', width: '392px', maxHeight: 'calc(100vh - 140px)' }, group: 'center', movable: true });
    this.frame.root.classList.add('upgrade-fount');
  }
  openFor(id: string): void { this.fountId = id; this.message = ''; this.outcome = ''; this.frame.open(); this.refresh(true); }
  dispose(): void { this.clearTooltips(); this.frame.dispose(); }
  private clearTooltips(): void { for (const detach of this.detachTooltips) detach(); this.detachTooltips = []; }

  private itemSlot(def: ItemDef | undefined, badge = '', label?: string, tooltip = true): HTMLButtonElement {
    const slot = element('button', 'fount-slot'); slot.type = 'button';
    slot.setAttribute('aria-label', label ?? def?.name ?? 'Choose an item below');
    if (def) {
      slot.append(createItemIcon(def));
      const enchantment = itemUpgrade(def.id).enchantment;
      if (enchantment) {
        const magic = element('span', 'fount-slot__magic');
        magic.append(createItemIcon(content.item(`enchant_${enchantment}`))); slot.append(magic);
      }
      if (tooltip) this.detachTooltips.push(this.ctx.tooltip.attach(slot, () => ({ kind: 'item', itemId: def.id, quantity: 1 })));
    } else slot.append(createUiIcon('equipment'));
    if (badge) slot.append(element('span', 'fount-slot__badge', badge));
    return slot;
  }

  refresh(force = false): void {
    if (!this.frame.isOpen()) return;
    const pack = this.ctx.api.getInventory();
    const inventory = pack.slots.filter(s => s !== null);
    const signature = JSON.stringify(pack);
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.clearTooltips();
    const body = this.frame.body; body.replaceChildren();
    const count = (id: string) => inventory.filter(s => s.itemId === id).reduce((sum, s) => sum + s.quantity, 0);
    const def = content.item(this.selected);
    const jewelry = !!def && isJewelry(def);
    if (jewelry) { this.mode = 'rank'; this.boosters = 0; }
    const rank = def ? itemUpgrade(def.id).rank : 1;
    const magic = this.mode === 'magic';
    const kinds = def ? ENCHANTMENTS.filter(kind => enchantmentFits(def, kind)) : [];
    if (magic && !kinds.includes(this.enchantment)) this.enchantment = kinds[0] ?? 'strength';

    const tabs = element('div', 'fount-tabs');
    for (const mode of ['rank', 'magic'] as const) {
      const tab = element('button', `btn${this.mode === mode ? ' is-active' : ''}`, mode === 'rank' ? 'Upgrade' : 'Magic');
      tab.prepend(createUiIcon(mode === 'rank' ? 'skills' : 'spells'));
      tab.setAttribute('aria-pressed', String(this.mode === mode));
      tab.disabled = this.busy || mode === 'magic' && jewelry;
      tab.onclick = () => { this.mode = mode; this.message = ''; this.refresh(true); };
      tabs.append(tab);
    }
    body.append(tabs);

    const materialId = def ? magic ? `enchant_${this.enchantment}` : jewelry ? '' : requiredUpgradeScroll(def) : '';
    const next = def && (magic || rank < 10)
      ? content.item(upgradedItemId(def.id, magic ? rank : rank + 1, magic ? this.enchantment : itemUpgrade(def.id).enchantment)) : undefined;
    const recipe = element('div', `fount-recipe${jewelry ? ' fount-recipe--jewelry' : ''}`);
    recipe.setAttribute('aria-label', jewelry ? 'Three identical pieces combine into one' : 'Upgrade preview');
    const offerings = element('div', 'fount-offerings');
    for (let i = 0; i < (jewelry ? 3 : 1); i++) {
      const slot = this.itemSlot(def, def ? `+${rank}` : '');
      slot.classList.add('fount-slot--offering');
      if (def && count(def.id) <= i) slot.classList.add('is-missing');
      slot.onclick = () => body.querySelector<HTMLButtonElement>('.fount-pack button')?.focus();
      offerings.append(slot);
    }
    recipe.append(offerings, element('span', 'fount-arrow', '→'));
    const output = this.itemSlot(next, next ? `+${itemUpgrade(next.id).rank}` : rank === 10 ? 'MAX' : '', undefined, false);
    output.classList.add('fount-slot--result');
    if (next && def) {
      const lines = Object.entries(def.equip!.bonuses).flatMap(([key, value]) => {
        const after = next.equip!.bonuses[key as keyof EquipmentBonuses];
        return value || after ? [`${key.replace(/([A-Z])/g, ' $1')}: ${value} → ${after}`] : [];
      });
      if (magic) lines.push(enchantmentDescription(this.enchantment, rank));
      this.detachTooltips.push(this.ctx.tooltip.attach(output, () => ({ kind: 'text', title: next.name, lines })));
    }
    recipe.append(output); body.append(recipe);

    const chance = def ? magic ? 1 : upgradeChance(def, this.boosters) : 0;
    const chanceRow = element('div', 'fount-chance');
    chanceRow.append(element('strong', '', def ? rank === 10 && !magic ? 'MAX' : `${Number((chance * 100).toFixed(3))}%` : '—'),
      element('span', '', def ? rank === 10 && !magic ? 'Rank reached' : 'Success chance' : 'Choose equipment'));
    body.append(chanceRow);

    if (def && !jewelry) {
      const materials = element('div', 'fount-materials');
      if (magic) {
        for (const kind of kinds) {
          const id = `enchant_${kind}`;
          const slot = this.itemSlot(content.item(id), `${count(id)}`, `Apply ${kind}`);
          slot.classList.toggle('is-selected', kind === this.enchantment);
          slot.setAttribute('aria-pressed', String(kind === this.enchantment));
          slot.disabled = this.busy;
          slot.onclick = () => { this.enchantment = kind; this.message = ''; this.refresh(true); };
          materials.append(slot);
        }
      } else {
        const scroll = this.itemSlot(content.item(materialId), `${count(materialId)}/1`);
        scroll.classList.toggle('is-missing', count(materialId) < 1);
        materials.append(scroll);
        const boostGroup = element('div', 'fount-boosters');
        const heading = element('div', 'fount-boosters__heading');
        heading.append(element('span', '', 'Boosters'), element('span', '', `${this.boosters}/9`));
        const boosterSlots = element('div', 'fount-boosters__slots');
        for (let n = 1; n <= 9; n++) {
          const button = element('button', `fount-booster${n <= this.boosters ? ' is-selected' : ''}`);
          button.append(createItemIcon(content.item(UPGRADE_BOOSTER)));
          button.setAttribute('aria-label', `Use ${n} boosters`);
          button.setAttribute('aria-pressed', String(n <= this.boosters));
          button.title = `${n} blessings: ×${(1.2 ** n).toFixed(3)} chance. Consumed on success or failure.`;
          button.disabled = this.busy || n > count(UPGRADE_BOOSTER);
          button.onclick = () => { this.boosters = this.boosters === n ? n - 1 : n; this.message = ''; this.refresh(true); };
          boosterSlots.append(button);
        }
        boostGroup.append(heading, boosterSlots); materials.append(boostGroup);
      }
      body.append(materials);
    }

    const hasMaterials = !!def && count(def.id) >= (jewelry ? 3 : 1)
      && (!materialId || count(materialId) >= 1) && (magic || jewelry || count(UPGRADE_BOOSTER) >= this.boosters);
    const duplicateMagic = !!def && magic && itemUpgrade(def.id).enchantment === this.enchantment;
    const canAttempt = hasMaterials && !!next && !duplicateMagic;
    const warning = element('div', 'fount-warning', !def ? '' : magic
      ? itemUpgrade(def.id).enchantment ? 'Replaces current magic' : 'Consumes 1 essence'
      : jewelry ? 'Failure destroys all 3 pieces' : 'Failure destroys the item');
    warning.hidden = !def; body.append(warning);
    const attempt = element('button', 'btn btn--primary fount-commit', this.busy ? 'Offering…'
      : !def ? 'Select equipment' : !next ? 'Maximum rank' : duplicateMagic ? 'Already applied' : !hasMaterials ? 'Missing materials'
      : magic ? 'Apply magic' : jewelry ? 'Combine' : 'Upgrade');
    attempt.disabled = this.busy || !canAttempt;
    attempt.onclick = () => void this.perform({ fountId: this.fountId, itemId: this.selected, mode: this.mode,
      boosters: !magic && !jewelry ? this.boosters : 0, ...(magic ? { enchantment: this.enchantment } : {}) });
    body.append(attempt);
    const result = element('div', `fount-result ${this.outcome}`, this.message); result.setAttribute('role', 'status');
    result.hidden = !this.message; body.append(result);

    const packHeading = element('div', 'fount-pack-heading');
    packHeading.append(createUiIcon('pack'), element('span', '', 'Your equipment'));
    body.append(packHeading);
    const gear = element('div', 'fount-pack'); gear.setAttribute('aria-label', 'Equipment to upgrade');
    const ids = [...new Set(inventory.filter(s => { const item = content.item(s.itemId); return item && isUpgradeable(item); }).map(s => s.itemId))];
    for (const id of ids) {
      const item = content.item(id)!;
      const slot = this.itemSlot(item, `+${itemUpgrade(id).rank}`, `Select ${item.name}`);
      slot.setAttribute('aria-pressed', String(id === this.selected)); slot.classList.toggle('is-selected', id === this.selected);
      if (count(id) > 1) slot.append(element('span', 'fount-slot__quantity', `×${count(id)}`));
      slot.disabled = this.busy;
      slot.onclick = () => { this.selected = id; this.message = ''; this.outcome = ''; this.refresh(true); };
      gear.append(slot);
    }
    if (!ids.length) gear.append(element('span', 'fount-empty', 'No carried equipment'));
    body.append(gear);

    const shop = element('div', 'fount-shop');
    const buy = element('button', 'btn fount-buy');
    buy.append(createItemIcon(content.item(UPGRADE_BOOSTER)), element('span', '', '100m gold'));
    buy.setAttribute('aria-label', 'Buy Fount Blessing for 100,000,000 gold');
    buy.title = 'Buy 1 Fount Blessing for 100,000,000 gold. Each multiplies upgrade chance by 1.2.';
    buy.disabled = this.busy; buy.onclick = () => void this.perform({ fountId: this.fountId, mode: 'buy-booster' });
    shop.append(element('span', '', `${count(UPGRADE_BOOSTER)} blessings owned`), buy); body.append(shop);
  }

  private async perform(request: UpgradeRequest): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.refresh(true);
    try {
      const result = await sendGameCommand(this.ctx.api, 'upgrade', request);
      this.outcome = result.ok && result.value.success ? 'success' : 'failure';
      this.message = result.ok ? request.mode === 'buy-booster' ? 'Blessing purchased'
        : result.value.success ? request.mode === 'magic' ? 'Magic applied' : `Upgraded to +${itemUpgrade(result.value.itemId!).rank}`
        : 'Upgrade failed · offering destroyed' : result.error.message;
      if (result.ok && request.mode !== 'buy-booster') { this.selected = result.value.itemId ?? ''; this.boosters = 0; }
    } catch (error) {
      this.outcome = 'failure'; this.message = error instanceof Error ? error.message : 'Could not complete the offering';
    } finally { this.busy = false; this.refresh(true); this.ctx.refresh(); }
  }
}
