# Devdocs inputs: audit and design

September 15, 2026. The workspace rethink (`docs/devdocs-redesign.md`) fixed navigation and layout.
It did not touch how a value is edited. This document is a full pass over every input in the app,
what the best tools in the field do, and the single field model the app should move to.

The creature page in the screenshot that prompted this is a fair sample. On one screen the same
idea ("this value is not the one the game computes") is drawn five ways:

| Where | How the page says it |
| --- | --- |
| Attack speed 1800 | amber input, `×` button, caption "inherited" |
| Behaviour passive | amber select, `×`, caption "inherited" |
| Move speed 1.6 | plain input with unit, `×` that means "remove" |
| Loot source | text "Own drops", badge "inherited", an "Override" button |
| Presentation | a lone `×` in the section header |

And the amber field that says "inherited" is a contradiction. Amber is the override colour. The
caption says the value came from somewhere else. Both are true (the base creature Heath Jack
overrides the Grazer curve, and this variant inherits Heath Jack's override) but the field has no
way to say a two-step fact, so it says two one-step facts that cancel out.

## Part 1. What exists

The inventory below was produced by reading every file under `devdocs/src`, `devdocs/server` and
the schema package. Line numbers are as of commit dcbaf4f.

### Primitives

`ui/Sheet.tsx` holds the kit every purpose-built page uses: `NumberInput`, `TextInput`, `Select`,
`Toggle`, `Static`, `Derived`, `SaveBar`, and the layout pieces `Row`, `Field`, `Fields`, `Section`.
Every input commits on every keystroke. None handles Enter, Escape, Tab, arrow steps or blur.
`NumberInput` mirrors the prop into local text state and calls `onChange` with `undefined` when the
box is emptied, so backspacing through a value deletes the key. `Select` silently adds an off-list
option when the saved value is not a legal choice.

`Derived` (`Sheet.tsx:113`) is the one component that knows about provenance. It shows the value,
strikes the computed value beside it when overridden, offers a `×`, and shows the expression and
the source link at opacity 0 until the row is hovered. Inside a `Fields` grid the expression and
source are `display: none` (`workspace.css:127`). The two densest derived surfaces in the app, the
creature combat block and the item bonus block, therefore never show a formula or a curve link.
The `title` tooltip is the only place the derivation survives.

`ui/RecordPicker.tsx` is good. Search over title, id, subtitle and badges, arrow keys, Enter,
Escape, thumbnails, a footer legend. It is also the only field-level keyboard handling in the app.
It has no "none" option, so clearing a reference is always a separate control at the call site,
and every call site invents its own.

`dev/EntityEditor.tsx` is the generic schema form. It is the only code that reads the schema's
`label`, `unit`, `help`, `step`, `ref`, `multiline`, `readOnly` and `identity` metadata. It folds
`help` into a tooltip and hides `.editor-help` in CSS. Switching a union variant replaces the
value with a fresh default with no confirmation. Arrays have no reorder. Any array whose rows
contain an identity field cannot be added to or removed from at all.

`model/draft.ts` is the record draft. It is component-local state. Navigating away, closing a
drawer, or switching record discards it silently. The world map is the only page with a
`beforeunload` guard. There is no undo anywhere in the app.

### Per-workspace

**Items.** `ItemPage.tsx` is two editors behind one route. Expanded items edit a `progression`
tier row's `adjustments`. Authored items edit `items` rows with optional blocks added by a row of
buttons at the bottom and removed by a text button in each section. Skill requirements are a map
editor with a `Select` whose empty label is "Add requirement…". The family drawer and template
drawer recompute their consumers live and push the draft up to the ladder. Sets edit thresholds in
a table of number inputs with a "Use target" button that overwrites all of them from the balance
object. Recipes are three `Derived` rows followed by a Template row that repeats the same curve
parameters as text.

**Creatures.** `CreaturePage.tsx` has the richest inheritance UI and therefore the most idioms.
`InheritRow` shows a muted value plus an "Override" button when a field is inherited from the base,
and the live control plus `×` when owned. The combat block uses `Derived` for numbers and a clone
called `ChoiceDerived` for behaviour and attack style. Movement speeds are a third pattern
("+ Add" chip, then input plus `×`). Loot has a segmented "Shared table / Own drops" switch, an
"Override" button, a `×` in the section aside, and a picker. Presentation has an "Add presentation"
chip that seeds a whole object and another `×` in the aside. "New variant" writes a transaction
directly and skips the create dialog's preview step. The loot editor is handed `issues={[]}` so its
validation display is dead.

**Story.** `story/shared.tsx` wraps the Sheet controls in editable/read-only pairs and adds
`JsonField`, the only control in the app that commits on blur. Quest completion predicates,
dialogue conditions and effects, and dialogue variants are edited only as raw JSON behind a button
labelled "Edit as fields" that shows JSON, not fields. Flags are a comma-separated text field.
Unlocks are a newline-separated textarea. NPC settlement and location are plain mono text inputs
even though the schema marks them `ref("settlement")` and `ref("location")`. Quest order on an NPC
cannot be changed although the schema help says the list is ordered.

**World.** The map is the one place with direct manipulation: drag to move, drag anchors, arrow
keys nudge 1 m or 10 m with Shift, wheel zoom. The inspector has nine bespoke sheets. The spawn
name is an inline header input. Formation kind is a segmented control whose switch to "authored"
materialises per-anchor offsets and whose switch away deletes them. The NPC sheet edits the stand in
`worldRegions` while `npcs.json` fields show read-only, so one NPC is edited on two pages with
different fields. Save is a change count with Preview / Save / Discard.

**Tuning.** Families, templates, roles, tiers and materials have no view of their own and fall to
the generic form. Each of families, templates and roles therefore has two editors: the generic
form here and the bespoke drawer elsewhere. The formula workspace is a scratchpad that never
writes.

**Assets.** The model page builds a draft it never uses. The audio table renders `playbackRate` as
one input or a min/max pair depending on the saved shape and offers no way to switch.

**Home.** Requests cannot be claimed, replied to or closed from the requests page.

### Counted

- 12 visual styles of editable cell (bordered input, mono number, arrowed select, textarea,
  checkbox row, borderless header input, chip trigger, slot tile, drop tile, matrix cell, segmented
  group, filter chip used as an action). The bordered input, number, select and textarea each have
  two independent CSS rule sets (`workspace.css` and `editor.css`).
- 8 ways to clear a value: `.derived-clear ×`, `.story-remove ×`, `.icon-button ×`, trash icon,
  "Remove" text button, "Set to none", `Select allowEmpty`, and nothing.
- 4 ways to override an inherited value on the creature page alone.
- 5 save models: per-record save bar, react-hook-form toolbar, transaction bar, preview/apply
  panel, optimistic PATCH with no bar. Ctrl+S is bound four different ways.
- 3 deep-set helpers (`draft.ts#setPath`, `ItemPage.tsx#setIn`, `RecipesView.tsx#setDeep`).
- 9 ref-picking patterns, from `RecordPicker` to a `<select>` of ids to a plain text box.
- 186 `label`, 41 `unit`, 34 `help`, 21 `step` and 18 `ref` annotations in the schema. Every
  bespoke page ignores all of them and re-declares labels, units, enum lists and ref kinds by hand
  in `items/data.ts`, `creatures/shared.ts`, `story/shared.tsx`, `world/model.ts`,
  `spells/SpellsView.tsx`, `assets/AudioView.tsx` and `model/derive.ts`.
- 30 `RefKind` members in the schema, 23 mapped to a collection in `refs.ts`. Skill, station,
  element, entity, location, settlement and enemyFamily fall back to a raw text input.
- 0 reorder controls. 0 undo. 0 multi-record edit outside the meta bulk panel.

### Diagnosis

Three root causes, not fifty bugs.

1. **Provenance is a boolean.** `Derivation.overridden` is true or false. Real values have a
   chain: variant → base → adjustment → role curve at level → default. The UI can only draw one
   link of that chain per field, so pages draw different links with different widgets and the
   reader has to reconstruct the rest.
2. **Every page owns its inputs.** Sheet gives pages raw controls and each page composes clear,
   override, add, remove, pick and link itself. Fifteen bespoke pages made fifteen sets of choices.
3. **A field is a React input, not a thing with state.** There is no notion of a focused field
   distinct from an editing field, so there is nothing for Enter, Escape, Backspace, arrow steps,
   scrubbing, expressions or multi-select to attach to. Commit-per-keystroke also makes undo
   impossible to add later without redesigning the draft.

## Part 2. What the field has settled on

Forty sources, primary where possible, are in the research report summarised here. The full
citation list is at the end.

### Provenance states

Every mature inspector converges on three visual tiers and puts the reset control in the field row,
shown only when there is something to reset.

| Tool | Derived / inherited | Overridden locally | Reset |
| --- | --- | --- | --- |
| Webflow style panel | orange dot, click to see where from | blue dot | click blue dot, falls back to orange |
| Unity Inspector | plain | bold label + blue margin bar | right-click Revert / Apply; Overrides menu lists all |
| Unreal Details | plain | yellow reset arrow appears | click arrow |
| Godot | plain | revert arrow appears | click arrow |
| Houdini | blue animated, green keyed, purple expression, orange CHOP | bold text, yellow = changed but uncommitted | Ctrl+MMB on label, RMB Revert |
| Blender | green animated, yellow keyframe, purple driver, teal library override | teal | Backspace, or Reset in menu |
| Figma | variable chip in the field | plain number after detach | hover chip, Detach |
| Chrome DevTools | "Inherited from" sections, losers struck through | winner unstruck | uncheck declaration |

Two lessons. Each colour must mean exactly one thing (Blender's yellow is a keyframe, Houdini's
yellow is an uncommitted edit, and people who use both complain). And Unity deliberately excludes
position and rotation from the override list so the list stays meaningful. Not every difference is
an override worth flagging.

### Keyboard model

Grist and Airtable share a model power users already know. Arrow keys move a selection between
cells without editing. Typing, Enter or F2 starts editing. Escape cancels and restores. Enter
commits. Tab and Shift+Tab commit and move sideways. Space on a reference opens the linked record.
Ctrl+Z and Ctrl+Y undo and redo one commit at a time.

For numbers, Chrome DevTools, Blender and Figma agree on stepping while editing: Up/Down ±1,
Shift ±10, Alt ±0.1, and a bigger jump with Ctrl+Shift+PageUp. Blender and Figma both scrub with a
modifier-drag on the label and vary the rate with vertical distance. Blender and Houdini accept
maths in any numeric field. Blender keeps the expression as a driver if you prefix it with `#`;
Figma evaluates once and keeps the number. React Spectrum's number field commits on blur, Enter,
arrow step or stepper, and puts the unit in a separate control rather than parsing it from text.

Nielsen Norman Group found steppers only work when values cluster near one common value. Level,
value in marks, weights and radii do not, so steppers should go and scrub plus typed steps should
replace them.

### References and back-references

Airtable's linked-record cell opens a picker with search and an "Add new record" row, and the
expanded record shows linked records with an unlink control. Grist's link icon opens the referenced
record as a card in a lightbox so you fix the related record without leaving the current one.
Notion's relations are two-way when you ask for it and rollups aggregate over the relation. Obsidian
and Tana put a references section at the bottom of every node. Linear sets a property on the
current selection from a single key or from Ctrl+K without opening a form.

### Multi-record

Unity shows a dash for a mixed value and lets you right-click the label to adopt one object's value.
Figma shows the literal word "Mixed" and accepts `Mixed+100` to add 100 to every selected object.
Blender applies an edit to every selected object when Alt is held. Retool's table accumulates cell
edits into a changeset that is saved once.

### Save, undo, conflicts

Figma saves continuously and adds a checkpoint every 30 minutes and on crash; Ctrl+Alt+S names a
version. Blender keeps a jumpable undo history, default 32 steps, truncated on a new edit. VS Code
blocks a save when the file changed on disk and offers Compare (a diff), Overwrite, or Revert, and
keeps the undo stack when it reloads a changed file. Obsidian's "last modified wins" for non-Markdown
files is the behaviour its own troubleshooting pages blame for lost notes.

None of the sources covers a local JSON store edited by one human and several agents. The nearest
match is VS Code's model with Figma's checkpoints: save on commit, keep a revision hash per file,
refuse and show a diff on mismatch, and keep a history.

### Derived stats in game tooling

Bret Victor: "I have always proposed adjustable numbers in a context where the adjuster already
understands the meaning of the number", and showing the data matters more than live adjustment.
Tufte's small multiples fit the case where a role curve edit changes 40 creatures: one tiny
before/after per creature beats one big chart. Machinations and the Larian CHI 2025 paper both
describe the industry pattern as "edit the parameter, see the simulated consequence", not "edit the
cell". The formula workspace already does this and never writes; the record pages write and never
show the consequence. Those should be one thing.

### Anti-patterns with sources

- No global Reset button on a form (NN/g: most forms improve when it is removed). Reset belongs on
  the field and only when an override exists.
- Do not hide information the user needs constantly in a tooltip (NN/g tooltip guidelines).
  Provenance is read on every glance. The formula can be a tooltip; the source cannot.
- Progressive disclosure is for rarely used features (Nielsen). "Where did this number come from"
  is not rarely used.
- Do not nest an inline-edit control inside another form (Atlassian inline edit).

## Part 3. The design

One field model, used by every page. Pages stop composing controls and start declaring fields.

### 3.1 A value has a chain, not a flag

Replace `Derivation.overridden: boolean` with a resolved chain. `model/derive.ts` already knows
every link; it just flattens them.

```ts
type Origin =
  | { kind: "own" }                                        // authored on this record
  | { kind: "inherited"; from: RecordRef }                 // copied from base / template
  | { kind: "curve"; source: RecordRef; expression: string; params: ParamRef[] }
  | { kind: "default"; value: unknown }                    // schema default, key absent
  | { kind: "balance"; source: RecordRef; path: string };  // balance target (sets, fuels)

interface Resolved<T> {
  value: T;                 // what the game sees
  chain: Origin[];          // chain[0] is why `value` is what it is; the rest are what it beat
  overrides?: { path: Path; record: RecordRef };  // where the winning override lives, if any
}
```

The Attack speed case resolves to `chain = [inherited(Heath Jack), curve(Grazer, "2400 ms from
role")]` with `value = 1800`. The field can now say "1800 · from Heath Jack, was 2400 from Grazer",
which is the truth, in one line, with both names as links.

The state a field draws is `chain[0].kind` plus two flags: `dirty` (draft differs from disk) and
`mixed` (multi-select disagrees). Invalid and stale are field-level overlays from validation and
from the revision check.

### 3.2 One field anatomy

```
 label                      [ 1800 ] ms  ●  ⟲      from Heath Jack · was 2400 from Grazer
 ─────                      ────────────  ─  ─      ────────────────────────────────────────
 11px muted                 control       dot revert  provenance line, 11px, always visible
```

- **Dot.** One glyph, one meaning each, with an in-app legend. Own: none. Curve: hollow ring.
  Inherited: filled grey. Overridden (own value beats a curve or a base): filled brass. Mixed:
  dash. Invalid: red outline. Stale: amber outline. This is Webflow's two-colour dot extended by
  exactly the states the data has.
- **Revert.** Appears only when the field beats something. One click returns to the next link
  in the chain. Backspace on a focused (not editing) field does the same. Tooltip names what it
  will return to: "Use Grazer curve (2400)". This replaces `×`, "Override", "Use base", "Remove",
  "Set to none" and the section-aside `×`.
- **Provenance line.** Visible, not hover-only. One sentence built from the chain. Every record
  name in it is a link that opens a peek. In a `Fields` grid where there is no room, the line
  collapses to the dot and the sentence moves to the field's focus state and the tooltip.
- **Expression.** The `= max(1, round(0 + 1 × 0.9))` text is the one thing that may live in the
  tooltip and the focus state. It is the "how", not the "where".
- **Unit.** Always a suffix from the schema's `unit`. Never in the label, never a bare span.
- **Label.** From the schema's `label`. Hand-written label maps in workspaces are deleted.

Going the other way (making an inherited value your own) is not a separate button. You edit the
field. The dot turns brass, the revert appears. That is how Webflow, Unity, Unreal and Godot all
work and it removes the "Override" button, the "+ Add" chip and the segmented loot switch from the
creature page.

### 3.3 Field states and keyboard

A field is either idle, focused, or editing. Today it is always editing.

| Key | Focused | Editing |
| --- | --- | --- |
| Arrows / Tab | move focus between fields | Left/Right move caret; Up/Down step numbers ±1, Shift ±10, Alt ±0.1; Tab commits and moves |
| Enter, F2, typing | start editing (typing replaces) | Enter commits, stays focused |
| Escape | clear selection | cancel, restore the pre-edit value |
| Backspace / Delete | revert to next link in chain | edit text |
| Space | on a ref: open peek. On a toggle: flip | insert space |
| Ctrl+Z / Ctrl+Shift+Z | undo / redo one commit | same |
| Alt+drag on label | scrub, rate by vertical distance | |
| `=` prefix in a number | | evaluate maths on commit (`=2400*0.75`); the number is stored |

Commit points: Enter, Tab, blur, arrow step, scrub release, picker selection. Each commit is one
undo step and one draft mutation. Nothing commits per keystroke any more. The `NumberInput`
local-text-state trick goes away because the field owns its edit buffer properly.

Mixed values (multi-select) show "Mixed" and accept `+10` and `*1.1` relative edits.

### 3.4 One reference field

`RefField` becomes the only way a reference is edited. It replaces `ItemPick`, `BasePicker`, the
`RefField` in `editors.tsx`, `<select>`s of ids, and plain text boxes for `ref()` fields.

- Idle: thumbnail + name chip. Missing target: dashed chip, red dot.
- Click the chip or Space: **peek**, a right-side sheet showing the target record's own page,
  editable, with its own save. Grist's lightbox. You fix the loot table without leaving the
  creature. Peeks stack one deep; the second peek replaces the first.
- Click the pencil or Enter: the existing `RecordPicker`, plus a "None" row when the field is
  optional and a "Create new…" row that runs the create dialog and links the result. Ctrl+Enter in
  the picker creates.
- Backspace: unlink (optional refs) or revert (inherited refs).
- Ref kinds with no collection (skill, station, element, entity, location, settlement,
  enemyFamily) get option sources from the data they already exist in: skills and elements from
  the schema enums, stations from recipe templates, locations and settlements from `worldRegions`.
  `refs.ts` gains an `optionsFor(kind)` so nothing falls through to a text box.

### 3.5 Back-references are a standard section

Every record page ends with **Referenced by**, generated from `buildReferenceIndex`, grouped by
relationship with the schema label as the group name ("Dropped by", "Sold at", "Ingredient of",
"Reward of", "Worn in set", "Spawns at"). Each row is a `RefRow` with a peek. This is
`EntitySummary#IncomingBlock` promoted from the rail to the sheet, with the role label taken from
the field's schema label instead of `roleLabel`'s path heuristic. Items today have no reverse view
beyond the generic block; this gives every collection one for free.

Renames already rewrite references server-side. The section should say so in the rename dialog:
"Renaming updates 14 references" with the list.

### 3.6 Lists

One `ListField` for arrays and one `MapField` for keyed maps.

- Add: a picker or a typed row at the bottom, Enter adds another.
- Remove: revert glyph on the row (same glyph, same key).
- Reorder: drag handle, and Alt+Up/Down. Ordered lists (NPC quests, quest stages, dialogue options)
  finally get it.
- Weighted lists (encounter members, loot drops): a normalised bar beside the weights so 3/1/1
  reads as 60/20/20, and a lock per row so editing one weight redistributes the others. This is
  the one area the research found no primary source for, so it is a prototype to test, not a
  settled pattern.
- Union members (quest predicates, dialogue conditions, effects): a `kind` select that maps the
  fields that share a name and asks before dropping the rest. The 17 predicate kinds and 16
  condition/effect kinds already have sentence renderers; each gets a field row instead of the
  JSON textarea. JSON stays as a last-resort tab, not a button called "Edit as fields".

### 3.7 Grid view per collection

Every collection gets an "as table" toggle next to the grid/list toggle. Rows are records, columns
are the schema's scalar and ref fields, cells are the same field component in a compact skin.
Arrow keys move, typing edits, Enter moves down, dots show provenance per cell, revert works per
cell. Selecting rows and editing a cell edits all of them (Mixed shows the dash). Edits accumulate
into one changeset and save as one transaction, Retool-style, so a loot rebalance across 30
creatures is one save and one undo.

The ladder is already this for items. The bestiary, loot tables, spells, shops and roles want it.

### 3.8 Set on selection

With records selected in any list, Ctrl+K lists "Set role…", "Set loot table…", "Set region…",
"Set availability…" for the selection's collection, built from the schema's enum and ref fields.
Single letters for the hot ones per collection (R role, L loot, G region). Linear's model.

### 3.9 Drafts, undo, save

Drafts move out of components into one store keyed by `collection/id`. Consequences:

- Navigating away keeps the draft. The sidebar shows a count of dirty records; Home lists them.
- One `SaveBar` in the app shell, not per page. It shows "3 records changed · Save all (Ctrl+S)".
  Saving is one transaction across collections, so the current avoidable 409 when two "different
  items" share a tier row goes away.
- Undo/redo is global, one step per commit, with a jumpable history panel (Blender's). Undo is a
  patch on the draft store, so it works the same on a sheet, a grid, a drawer and the map.
- Conflict: the server already returns 409 with revisions. The bar shows a diff between disk and
  draft per record (Compare), with Overwrite and Reload. Agent edits arriving while a record is
  clean reload silently and toast "Updated by agent · view diff". This replaces the `CONFLICT_MESSAGE`
  string and the disappearing Save button.
- Checkpoints: every save is already a commit-able change; Home's Changes view is the history.
  Add "name this checkpoint" as a git commit from the app.

### 3.10 Curves and consequences on one screen

The formula workspace's preview (before/after per consumer) becomes the body of the role, family
and template drawers, which already recompute live. When you scrub `healthPerLevel` in the Grazer
drawer you see a small multiple per Grazer creature: level, old health, new health, and a mark for
any creature whose own override hides the change. Save writes the curve. The scratchpad that never
writes is deleted.

### 3.11 Schema is the source

`serialFieldSpec` already turns a schema node into label, unit, help, step, ref, choices,
min/max. Purpose-built pages call `field(schema, path)` to get a fully described field and only add
what the schema cannot know: the derivation chain and which control to use when the default is
wrong. The hand-written label, unit, enum and ref tables in seven workspace files are deleted.
`help` renders in the focus state under the control, not in a hidden tooltip.

What the schema is missing gets added there once: `order: true` on ordered arrays, `weight: true`
on weighted lists, `ref()` kinds for the seven unmapped kinds, a `group` for which `Fields` grid a
scalar belongs to.

### 3.12 What this does to the creature page

Same sections, same rail. Every value in Identity and Combat is one field with a dot and a
provenance line. Attack speed reads `1800 ms ● ⟲ from Heath Jack · was 2400 from Grazer`. Movement
speeds are ordinary fields whose chain is `[default]` until you type. Loot is one ref field to a
table (peek to edit it there) or an inline drop list, and the choice between them is the field's
"None / Table / Own" state, not a segmented control. Presentation's asset is a ref field; the
section-header `×` is gone. Variants and Referenced by close the sheet. The role curve in the rail
marks the level row and shows which of this creature's numbers beat the curve.

## Part 4. Build order

Each step ends green (tsc, the devdocs vitest files, `devdocs-smoke`, a 1440 and 2560 screenshot
pass) and is committed on its own.

1. **Resolve chains.** `model/derive.ts` returns `Resolved<T>` with an `Origin[]`; `Derived` keeps
   working on `chain[0]` so nothing visible changes. Add tests for the variant-over-base-over-curve
   case.
2. **Field core.** `ui/field/` with `Field` (states, keyboard, commit points, dot, revert,
   provenance line), `NumberField` (steps, scrub, `=` maths, unit from schema), `TextField`,
   `ChoiceField`, `ToggleField`. Delete the two duplicate CSS rule sets; one `field.css`. Legend
   component in the app shell.
3. **Draft store + undo + one save bar.** Move `useRecordDraft` state into a store; global
   Ctrl+Z/Ctrl+S; dirty count in the sidebar; conflict diff. Delete the four Ctrl+S bindings and
   the three deep-set helpers.
4. **RefField + peek + Referenced by.** One reference component; `optionsFor(kind)` for the
   unmapped kinds; standard back-reference section from the index; delete `ItemPick`,
   `BasePicker`, `EntityDetail#ValueView`'s private reference map, `ui/ItemIcon.tsx`.
5. **Lists.** `ListField`, `MapField`, reorder, weighted bar, union editors for predicates,
   conditions and effects. Delete `JsonField` as a primary control.
6. **Migrate pages** in this order, deleting the hand-written metadata tables as each goes:
   creatures, items, recipes and sets, story, world inspector, spells, audio.
7. **Grid view and set-on-selection.** Table toggle on every collection browser; Ctrl+K property
   setters; changeset save.
8. **Curves with consequences.** Merge the formula preview into the drawers; delete the read-only
   formula workspace.

Ownership follows the existing split: root owns `ui/field/`, the draft store, `derive.ts`,
`refs.ts` and CSS; workspace agents migrate their own folders against the new API.

## Sources

Blender library overrides and field colours: docs.blender.org (library_overrides, fields, undo_redo).
Unity: prefab-instance-inspector-reference, PrefabInstanceOverrides, UsingTheInspector.
Unreal: level-editor-details-panel, details-panel-customization. Godot: inspector_dock.
Houdini: sidefx.com/docs/houdini/network/parms. Figma: apply-variables-to-designs,
adjust-alignment-rotation-position-and-dimensions, version history. Webflow University: style panel
overview. Chrome DevTools: css/reference, css/issues. VS Code: v1_15 release notes, codebasics.
Obsidian Sync troubleshooting. Airtable: linking records, keyboard shortcuts. Grist: col-refs,
record-cards, enter-data. Notion: relations and rollups. Tana knowledge graph concepts. Linear:
select issues, keyboard shortcuts changelog. Retool: table columns. React Spectrum NumberField.
Atlassian Design: inline edit. NN/g: input steppers, reset and cancel buttons, web form design,
tooltip guidelines, progressive disclosure. Bret Victor, Learnable Programming. Tufte, The Visual
Display of Quantitative Information. GDC 2017 "Game Design Tools: For When Spreadsheets and
Flowcharts Aren't Enough". Machinations, balancing F2P economies. CHI 2025, Larian / Baldur's Gate 3
progression balancing (abstract). Insomniac web tools postmortem.
