import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Undo2, X } from "lucide-react";
import { EQUIP_SLOTS, SKILL_IDS, type EquipSlot, type ItemStack, type SkillId, type Vec3, type WorldKey } from "../../../../game/src/contracts.js";
import { SKILLS } from "../../../../game/src/content/skills.js";
import { levelForXp, totalXpAt } from "../../../../game/src/content/xp.js";
import { editPlayer, failedOpIndex, failureMessage, type PlayerDetail, type PlayerEditResult, type PlayerOp } from "../../api/adminData.js";
import { Badge, Button, SearchInput } from "../../components/ui/index.js";
import { ActionError } from "../../ui/Confirm.js";
import { Field, FieldRows, NumberField, Row, Section, Sheet, Static, TextField } from "../../ui/field/index.js";
import { ItemStack as ItemChip } from "../../ui/ItemStack.js";
import { RecordPicker } from "../../ui/RecordPicker.js";
import { EmptyNote } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import { PANEL, PANEL_BODY, PANEL_HEADER } from "../../ui/layout.js";
import { cn } from "../../lib/utils.js";
import { itemName, useCatalogItems, type CatalogItem } from "../../model/adminNames.js";

/**
 * One player's private state, and the edits an admin stages against it.
 *
 * Nothing is sent as it is typed. The sheet holds a copy of what the server returned, every control
 * edits that copy, and `opsFor` turns the difference into the typed operations the API takes. One
 * `PATCH` carries them all with the `expect.revision` this view was read at, so an edit made from a
 * stale screen is refused rather than overwriting what the player just looted.
 *
 * The inventory is the 28 slots as the game lays them out and goes back as one `inventory.set`; the
 * bank is a list of kinds and goes back as the `bank.add` and `bank.remove` that reach it, because
 * sending 400 stacks to move one would be silly.
 */

const INVENTORY_SLOTS = 28;
type Slot = { itemId: string; quantity: number } | null;

interface Draft {
  inventory: Slot[];
  bank: ItemStack[];
  equipment: Partial<Record<EquipSlot, ItemStack | null>>;
  currency: number;
  skills: Partial<Record<SkillId, { xp: number; level: number }>>;
  regionId: string;
  position: Vec3;
}

const EQUIP_LABEL: Readonly<Record<EquipSlot, string>> = {
  head: "Head", body: "Body", legs: "Legs", feet: "Feet", hands: "Hands",
  mainHand: "Main hand", offHand: "Off hand", accessory1: "Amulet", accessory2: "Ring",
  ring2: "Ring 2", earring2: "Earring",
};

function draftOf(player: PlayerDetail): Draft {
  const slots: Slot[] = Array.from({ length: INVENTORY_SLOTS }, () => null);
  for (const slot of player.inventory ?? []) if (slot && slot.slotIndex >= 0 && slot.slotIndex < INVENTORY_SLOTS) slots[slot.slotIndex] = { itemId: slot.itemId, quantity: slot.quantity };
  return {
    inventory: slots,
    bank: (player.bank ?? []).map(stack => ({ itemId: stack.itemId, quantity: stack.quantity })),
    equipment: Object.fromEntries(EQUIP_SLOTS.map(slot => [slot, player.equipment?.[slot] ?? null])) as Draft["equipment"],
    currency: player.currency ?? 0,
    skills: Object.fromEntries(SKILL_IDS.map(skill => [skill, player.skills?.[skill] ?? { xp: 0, level: 1 }])) as Draft["skills"],
    regionId: player.regionId ?? "",
    position: player.position ?? [0, 0, 0],
  };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The difference between what the server holds and what the sheet shows, as the API's operations. */
export function opsFor(player: PlayerDetail, draft: Draft): PlayerOp[] {
  const base = draftOf(player), ops: PlayerOp[] = [];
  if (!same(base.inventory, draft.inventory)) ops.push({ op: "inventory.set", slots: draft.inventory.map(slot => slot && { itemId: slot.itemId, quantity: slot.quantity }) });
  const was = new Map(base.bank.map(stack => [stack.itemId, stack.quantity]));
  const now = new Map(draft.bank.map(stack => [stack.itemId, stack.quantity]));
  for (const itemId of [...new Set([...was.keys(), ...now.keys()])]) {
    const delta = (now.get(itemId) ?? 0) - (was.get(itemId) ?? 0);
    if (delta > 0) ops.push({ op: "bank.add", itemId, quantity: delta });
    else if (delta < 0) ops.push({ op: "bank.remove", itemId, quantity: -delta });
  }
  for (const slot of EQUIP_SLOTS) {
    if (same(base.equipment[slot] ?? null, draft.equipment[slot] ?? null)) continue;
    ops.push({ op: "equipment.set", slot, itemId: draft.equipment[slot]?.itemId ?? null });
  }
  if (base.currency !== draft.currency) ops.push({ op: "currency.set", amount: draft.currency });
  for (const skill of SKILL_IDS) {
    const xp = draft.skills[skill]?.xp ?? 0;
    if ((base.skills[skill]?.xp ?? 0) !== xp) ops.push({ op: "skill.setXp", skill, xp });
  }
  const world = player.online ?? player.lastWorld;
  if (world && (base.regionId !== draft.regionId || !same(base.position, draft.position))) {
    ops.push({ op: "position.set", world, regionId: draft.regionId, position: draft.position });
  }
  return ops;
}

/** One staged operation in the words an operator would use for it. */
export function describeOp(op: PlayerOp, items: ReadonlyMap<string, CatalogItem>, before: Draft): string {
  switch (op.op) {
    case "inventory.set": {
      const filled = op.slots.filter(Boolean).length, had = before.inventory.filter(Boolean).length;
      return `Set the 28 inventory slots (${had} used → ${filled} used)`;
    }
    case "bank.add": return `Add ${op.quantity} × ${itemName(items, op.itemId)} to the bank`;
    case "bank.remove": return `Take ${op.quantity} × ${itemName(items, op.itemId)} out of the bank`;
    case "equipment.set": return op.itemId === null ? `Clear ${EQUIP_LABEL[op.slot].toLowerCase()}` : `Equip ${itemName(items, op.itemId)} on ${EQUIP_LABEL[op.slot].toLowerCase()}`;
    case "currency.set": return `Set gold to ${op.amount.toLocaleString()}`;
    case "skill.setXp": return `Set ${SKILLS[op.skill].name} to ${op.xp.toLocaleString()} XP (level ${levelForXp(op.xp)})`;
    case "position.set": return `Move to ${op.regionId} at ${op.position.map(value => Math.round(value)).join(", ")} in ${op.world.worldId}`;
  }
}

export function PlayerSheet({ player, onApplied }: { player: PlayerDetail; onApplied: (result: PlayerEditResult) => void }) {
  const items = useCatalogItems();
  const [draft, setDraft] = useState<Draft>(() => draftOf(player));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [failedOp, setFailedOp] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<PlayerEditResult>();

  const server = useMemo(() => draftOf(player), [player]);
  const ops = useMemo(() => opsFor(player, draft), [player, draft]);
  // The player's own record moving under an open edit is the 409 this guards against, so the sheet
  // only takes a fresh read when there is nothing staged to lose.
  useEffect(() => { if (!ops.length) setDraft(draftOf(player)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [player.revision]);

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));

  async function apply(): Promise<void> {
    if (!ops.length || sending) return;
    setSending(true); setError(""); setFailedOp(null);
    try {
      const result = await editPlayer(player.accountId, ops, player.revision);
      setOutcome(result);
      setDraft(draftOf(result.player));
      onApplied(result);
    } catch (reason) {
      setError(failureMessage(reason));
      setFailedOp(failedOpIndex(reason));
    } finally { setSending(false); }
  }

  return <div className="flex flex-col gap-3">
    {ops.length > 0 && <div className={cn(PANEL, "border-primary/50")} aria-label="Staged player edits">
      <div className={PANEL_HEADER}>
        <h2>{ops.length} staged {ops.length === 1 ? "change" : "changes"}</h2>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => { setDraft(draftOf(player)); setError(""); }}><Undo2 />Discard</Button>
          <Button variant="default" size="sm" disabled={sending} onClick={() => void apply()}>
            {sending && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Apply to {player.name}
          </Button>
        </div>
      </div>
      <div className={cn(PANEL_BODY, "flex flex-col gap-1")}>
        <ol className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs">
          {ops.map((op, index) => <li key={index} className={cn("flex items-center gap-1.5 text-muted-foreground", failedOp === index && "text-destructive")}>
            <span aria-hidden className="text-faint tabular-nums">{index + 1}.</span>{describeOp(op, items.byId, server)}
          </li>)}
        </ol>
        <p className="text-[11px] text-faint">Sent as one patch against the record read {player.revision ? `at ${player.revision}` : "just now"}. A player who changed in the meantime gets it refused, not overwritten.</p>
        <ActionError message={error} />
      </div>
    </div>}

    {outcome && !ops.length && <div className={cn(PANEL, "border-ok/50")} aria-label="Player edit result">
      <div className={PANEL_HEADER}>
        <h2>{outcome.changed ? "Applied" : "Nothing changed"}</h2>
        <Badge variant={outcome.applied === "live" ? "ok" : "info"} className="ml-auto">
          {outcome.applied === "live" ? `Live in ${outcome.world?.worldId ?? "their world"}` : "Stored for their next join"}
        </Badge>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={() => setOutcome(undefined)}><X /></Button>
      </div>
      <div className={cn(PANEL_BODY, "flex flex-col gap-1 text-xs text-muted-foreground")}>
        <p>{outcome.applied === "live"
          ? "The change went to the character the world is simulating, so their own client has it already."
          : "The player is offline, so their stored character was written and they will load it on their next join."}</p>
        {outcome.warnings.map((warning, index) => <p key={index} className="text-warn">{warning}</p>)}
      </div>
    </div>}

    <Sheet>
      <EquipmentSection draft={draft} items={items} onChange={value => patch("equipment", value)} dirty={!same(server.equipment, draft.equipment)} />
      <InventorySection draft={draft} items={items} onChange={value => patch("inventory", value)} dirty={!same(server.inventory, draft.inventory)} />
      <BankSection draft={draft} items={items} onChange={value => patch("bank", value)} dirty={!same(server.bank, draft.bank)} />
      <Section title="Gold and skills">
        <Field label="Gold" dirty={server.currency !== draft.currency} unit="gold">
          <NumberField value={draft.currency} onChange={value => patch("currency", Math.max(0, Math.round(value ?? 0)))} integer min={0} width="short" ariaLabel="Gold" />
        </Field>
        <FieldRows columns={3}>
          {SKILL_IDS.map(skill => <Field key={skill} label={SKILLS[skill].name} dirty={(server.skills[skill]?.xp ?? 0) !== (draft.skills[skill]?.xp ?? 0)}
            unit={`L${levelForXp(draft.skills[skill]?.xp ?? 0)}`} hint={`Experience. The level follows the XP table, up to ${totalXpAt(99).toLocaleString()}.`}>
            <NumberField value={draft.skills[skill]?.xp ?? 0} integer min={0} max={totalXpAt(99)} ariaLabel={`${SKILLS[skill].name} experience`}
              onChange={value => {
                const xp = Math.max(0, Math.min(totalXpAt(99), Math.round(value ?? 0)));
                patch("skills", { ...draft.skills, [skill]: { xp, level: levelForXp(xp) } });
              }} />
          </Field>)}
        </FieldRows>
      </Section>
      <PositionSection player={player} draft={draft} server={server} onRegion={value => patch("regionId", value)} onPosition={value => patch("position", value)} />
    </Sheet>
  </div>;
}

// ------------------------------------------------------------------ equipment

function EquipmentSection({ draft, items, onChange, dirty }: { draft: Draft; items: ReturnType<typeof useCatalogItems>; onChange: (value: Draft["equipment"]) => void; dirty: boolean }) {
  return <Section title="Equipment" aside={dirty ? <Badge variant="accent">edited</Badge> : undefined}>
    <div className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-1.5 pt-1 pb-2">
      {EQUIP_SLOTS.map(slot => {
        const worn = draft.equipment[slot] ?? null;
        return <div key={slot} className={cn(PANEL, "flex items-center gap-1.5 p-1")}>
          <RecordPicker collection="compiled-items" value={worn?.itemId} allowNone="Nothing" placeholder="Search equipment…"
            onClear={() => onChange({ ...draft.equipment, [slot]: null })}
            onPick={id => onChange({ ...draft.equipment, [slot]: { itemId: id, quantity: 1 } })}
            trigger={<button type="button" aria-label={`${EQUIP_LABEL[slot]}: ${worn ? itemName(items.byId, worn.itemId) : "empty"}`} title={worn?.itemId}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm px-0.5 py-0.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40">
              {worn ? <Thumb spec={{ kind: "item", id: worn.itemId }} size="m" alt="" /> : <span className="grid size-8 shrink-0 place-items-center rounded-sm border border-dashed border-border text-faint" aria-hidden>—</span>}
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[11px] text-faint">{EQUIP_LABEL[slot]}</span>
                <span className="truncate text-xs">{worn ? itemName(items.byId, worn.itemId) : <span className="text-faint">Empty</span>}</span>
              </span>
            </button>} />
          {worn && <Button variant="ghost" size="icon-xs" aria-label={`Clear ${EQUIP_LABEL[slot].toLowerCase()}`} onClick={() => onChange({ ...draft.equipment, [slot]: null })}><X /></Button>}
        </div>;
      })}
    </div>
  </Section>;
}

// ------------------------------------------------------------------ inventory

function InventorySection({ draft, items, onChange, dirty }: { draft: Draft; items: ReturnType<typeof useCatalogItems>; onChange: (value: Slot[]) => void; dirty: boolean }) {
  const [selected, setSelected] = useState(0);
  const slot = draft.inventory[selected] ?? null;
  const used = draft.inventory.filter(Boolean).length;
  const set = (index: number, value: Slot) => onChange(draft.inventory.map((current, position) => position === index ? value : current));

  function keys(event: React.KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7 : 0;
    if (!step) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(INVENTORY_SLOTS - 1, index + step));
    setSelected(next);
    (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }

  return <Section title="Inventory" aside={<span className="flex items-center gap-1.5">{dirty && <Badge variant="accent">edited</Badge>}<span>{used} of {INVENTORY_SLOTS} slots</span></span>}>
    <div className="flex flex-col gap-2 pt-1 pb-2">
      <div role="grid" aria-label="Inventory slots" className="grid w-fit grid-cols-7 gap-1 @max-[34rem]:grid-cols-4">
        {draft.inventory.map((cell, index) => <button key={index} type="button" role="gridcell" tabIndex={index === selected ? 0 : -1}
          aria-selected={index === selected} aria-label={cell ? `Slot ${index + 1}: ${itemName(items.byId, cell.itemId)} ×${cell.quantity}` : `Slot ${index + 1}: empty`}
          title={cell ? `${itemName(items.byId, cell.itemId)} ×${cell.quantity}` : "Empty slot"}
          onKeyDown={event => keys(event, index)} onClick={() => setSelected(index)}
          className={cn("relative grid size-10 cursor-pointer place-items-center rounded-sm border bg-art outline-none",
            index === selected ? "border-primary ring-2 ring-ring/35" : cell ? "border-border-subtle hover:border-border" : "border-dashed border-border hover:border-border-subtle")}>
          {cell && <Thumb spec={{ kind: "item", id: cell.itemId }} size="fill" alt="" className="pointer-events-none" />}
          {cell && cell.quantity > 1 && <span className="pointer-events-none absolute right-0 bottom-0 rounded-tl-sm bg-card/90 px-0.5 font-mono text-[10px] tabular-nums text-foreground">{cell.quantity}</span>}
        </button>)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label={`Slot ${selected + 1}`}>
        <span className="w-16 text-xs text-muted-foreground">Slot {selected + 1}</span>
        <RecordPicker collection="compiled-items" value={slot?.itemId} allowNone="Empty this slot" placeholder="Search items…"
          onClear={() => set(selected, null)}
          onPick={id => set(selected, { itemId: id, quantity: items.byId.get(id)?.stackable ? slot?.quantity ?? 1 : 1 })}
          trigger={<Button variant="secondary" size="sm" className="min-w-40 justify-start">
            {slot ? <><Thumb spec={{ kind: "item", id: slot.itemId }} size="s" alt="" />{itemName(items.byId, slot.itemId)}</> : "Choose an item…"}
          </Button>} />
        {slot && <Field label="Quantity" labelHidden bare unit="held">
          <NumberField value={slot.quantity} integer min={1} max={2_147_483_647} ariaLabel="Quantity in this slot"
            disabled={!items.byId.get(slot.itemId)?.stackable}
            onChange={value => set(selected, { itemId: slot.itemId, quantity: Math.max(1, Math.round(value ?? 1)) })} />
        </Field>}
        {slot && <Button variant="ghost" size="sm" onClick={() => set(selected, null)}><X />Clear</Button>}
      </div>
      <p className="text-[11px] text-faint">An item that does not stack holds one per slot; one that stacks may fill only one slot. The server checks both.</p>
    </div>
  </Section>;
}

// ----------------------------------------------------------------------- bank

function BankSection({ draft, items, onChange, dirty }: { draft: Draft; items: ReturnType<typeof useCatalogItems>; onChange: (value: ItemStack[]) => void; dirty: boolean }) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const rows = draft.bank.map((stack, index) => ({ stack, index, name: itemName(items.byId, stack.itemId) }))
    .filter(row => !needle || `${row.name} ${row.stack.itemId}`.toLowerCase().includes(needle));
  const held = new Set(draft.bank.map(stack => stack.itemId));

  return <Section title="Bank" aside={<span className="flex items-center gap-1.5">{dirty && <Badge variant="accent">edited</Badge>}<span>{draft.bank.length} of 400 kinds</span></span>}>
    <div className="flex flex-col gap-2 pt-1 pb-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {draft.bank.length > 8 && <SearchInput value={search} onChange={setSearch} label="Search the bank" placeholder="Search the bank…" className="w-48" />}
        <RecordPicker collection="compiled-items" exclude={held} placeholder="Search items…"
          onPick={id => onChange([...draft.bank, { itemId: id, quantity: 1 }])}
          trigger={<Button variant="secondary" size="sm">Add an item</Button>} />
      </div>
      {!draft.bank.length && <EmptyNote>This player's bank is empty.</EmptyNote>}
      {Boolean(draft.bank.length) && !rows.length && <EmptyNote>No stack matches that.</EmptyNote>}
      <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
        {rows.map(row => <div key={row.stack.itemId} className="flex items-center gap-1.5">
          <ItemChip id={row.stack.itemId} name={row.name} className="min-w-44" />
          <Field label={`${row.name} quantity`} labelHidden bare>
            <NumberField value={row.stack.quantity} integer min={1} max={2_147_483_647} ariaLabel={`${row.name} quantity`}
              onChange={value => onChange(draft.bank.map((stack, index) => index === row.index ? { ...stack, quantity: Math.max(1, Math.round(value ?? 1)) } : stack))} />
          </Field>
          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${row.name} from the bank`} onClick={() => onChange(draft.bank.filter((_, index) => index !== row.index))}><X /></Button>
        </div>)}
      </div>
    </div>
  </Section>;
}

// ------------------------------------------------------------------- position

function PositionSection({ player, draft, server, onRegion, onPosition }: {
  player: PlayerDetail; draft: Draft; server: Draft; onRegion: (value: string) => void; onPosition: (value: Vec3) => void;
}) {
  const world: WorldKey | null = player.online ?? player.lastWorld;
  const axes: readonly [number, number, number] = draft.position;
  return <Section title="Position">
    <Row label="World"><Static mono>{world ? `${world.providerId}/${world.worldId}` : "This player has never been in a world here"}</Static></Row>
    <Field label="Region" dirty={server.regionId !== draft.regionId} hint="The region id the player stands in. It must exist in the active catalog.">
      <TextField value={draft.regionId} onChange={value => onRegion(value ?? "")} ariaLabel="Region" width="short" disabled={!world} />
    </Field>
    <FieldRows columns={3}>
      {(["x", "y", "z"] as const).map((axis, index) => <Field key={axis} label={axis.toUpperCase()} unit="m" dirty={server.position[index] !== axes[index]}>
        <NumberField value={axes[index]} ariaLabel={`Position ${axis}`} disabled={!world}
          onChange={value => onPosition(axes.map((current, position) => position === index ? value ?? current : current) as unknown as Vec3)} />
      </Field>)}
    </FieldRows>
    <p className="col-start-2 text-[11px] leading-relaxed text-faint">
      A move snaps to walkable ground within 8 m or is refused, and it stops whatever the player was doing, as a portal does.
    </p>
  </Section>;
}
