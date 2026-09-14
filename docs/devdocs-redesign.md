# Devdocs redesign

September 14, 2026. This replaces the visual-first pass of September 13. That pass restyled a
schema-driven form. It did not change what the tool is, and the result was still unusable. This
document is the audit of why, and the design the app is being rebuilt to.

## Audit

### One renderer for everything

Every record page is `dev/EntityEditor.tsx` walking the schema and emitting a control per leaf.
Objects become collapsible sections, arrays become numbered cards, keyed maps get a "New key" row,
unions get a "Type" select, optional fields fold into "Add" chips. The sheet is an auto-fill grid
of 300px columns, so at 2500px a tier row becomes six columns of `Change / Type id` chips, while a
nested bonus block gets no room at all. The armour set page, the tier page, the quest page and the
audio catalog all look the same because they are the same component. Spacing is not a tuning
problem. There is no layout to tune.

Measured in the CSS: 12 font sizes (9 to 16px, mostly half-pixel), 8 radii, 12 gap values, 8
control heights. There is no scale.

### Files, not things

Navigation is `ui/library.tsx` listing 32 JSON files in 8 groups. Several entries are compiler
mechanisms, not things a designer thinks about:

| Entry | What it actually is |
| --- | --- |
| Tiers | `progression.json`: one row per tier holding the material slots, the equipment members and the production entries. This is the source of 151 items and all 236 recipes. |
| Materials | 153 rows of `{ id, name, itemId }`. A name for a slot in a tier row. |
| Equipment families | 17 linear curves (`value = base + tier × perLevel`, same per bonus). Named like `Mainhand Melee 2400`. The compiler expands a tier member through its family into an item. |
| Recipe templates | 6 production curves (duration, xp) plus stations and skill. |
| Kit ladder | A read-only view of the generated weapons, tools and armour by tier. Armour sets are not on it because it filters items by kind. |
| Combat profiles | 6 role curves. A creature's combat block is `curve(level) + adjustments`. |
| Enemy stats, Species | Compiled outputs of creatures. Read only. Listed as if they were content. |
| Encounters | 205 groups of `{ creatureId, weight }` with an activity. 176 are patrols with one member. |
| Placements | 239 points that say which encounter spawns where, with count, radius and formation. |
| Resource nodes | 50 points that say which resource clusters where. |
| Recipe / Set / Campfire / Formation balance | Legacy parameter objects retained for diagnostics. |

The compiler (`tools/content/compile.ts`) already records, for every generated record, the source
tier, the formula, the profile and the inputs. Devdocs uses that only to print a "Generated ·
read only" badge and an "Edit source" link. That is backwards: the item page is where a designer
looks at the item, so the calculation belongs on the item page.

### The world is five lists

`worldRegions.json` holds the real world: 209 locations, 190 roads, 7 settlements with their
buildings, stations, shops, banks and NPC positions, 48 landmarks, gates, obstacles. None of it is
on the map page. The map page draws region rectangles, resource circles and placement pins on the
800px minimap and edits placements. Everything else is a JSON form.

### Noise

Badges carry tier, style, acquisition, slot, category, status, open-request counts, "Generated",
"Calculated". Counts sit next to every sidebar entry and every section title. Three separate
read-only value renderers exist with three CSS vocabularies.

## Design

### Principles

1. **Pages are game concepts, not files.** An item is an item whether it is authored in
   `items.json` or expanded from a tier. Mechanism collections (families, templates, profiles,
   materials, balance objects) are never top-level. They are reached from the values they drive.
2. **Derived values are shown where they land, with the derivation inline.** A computed number
   renders as the number, then the terms that produced it, then an override control. Editing a
   curve parameter opens the curve beside the record and recomputes every consumer live in the
   browser using the same formula functions the compiler runs. Save writes to whichever source
   owns the value. The words "generated" and "compiled" do not appear in the UI.
3. **The map is the world.** Every placed thing is on it, in layers. Lists are the side panel.
4. **One scale.** Type 11 / 12 / 13 / 15 / 18. Controls 24px, rows 28px. Space 4 / 8 / 12 / 16 /
   24. Radius 4 (controls) and 6 (panels). Inputs are sized to their content: numbers 72px,
   ids 200px, short text 280px, prose full width. Label left, value right, never more than two
   label/value columns side by side. No auto-fill grids of inputs. No card inside a card.
5. **Badges are for state only.** Unsaved, error, open request, draft/rejected. Tier, style,
   slot, category and acquisition are text or columns.

### Navigation

Nine entries, no counts:

| Entry | Views | Backed by |
| --- | --- | --- |
| Home | work queue, open requests, local changes, validation | meta, git, validate |
| Items | Ladder · Catalog · Sets · Recipes · Resources · Fuels | progression + families + templates + materials, items + compiled items, equipmentSets, compiled recipes, resources, campfireFuels |
| Creatures | Bestiary · Loot tables · Roles (drawer) | creatureDefinitions, lootTables, creatureProfiles |
| World | Map | worldRegions, placements, encounters, resourcePlacements, npcs |
| Story | NPCs · Quests · Dialogue · Shops | npcs, quests, dialogue, shops |
| Spells | Spells · Runes · Elemental | spells, spellRunes, elementalSpells |
| Assets | Models · Audio | assets manifest, audio catalog |
| Tuning | Formulas · Families · Templates · Roles · Tiers · Materials · Legacy balance | the mechanism collections, as plain tables for the rare direct edit |

Routes are `#/<workspace>[/<view>][/<id>]`. Legacy `#/<collection>/<id>` links redirect.

### Record page

One column, 760px max, with a 300px context rail on the right for the model, the map thumb, and
"used by". Header: icon, name, id, one line of facts as text ("Tier 1 · Head · Melee 1"), actions
on the right only when the record is dirty. Sections are separated by a rule and an 11px label.
Rows are `label | value` at 28px. A derived row reads:

```
Defence      1     = round(0 + 1 × 0.9)   Head melee 0   [override]
```

The family name is a link that opens the curve drawer. The override control edits the tier
member's `adjustments`. An overridden row shows the override in the accent colour with the
computed value struck beside it and a clear button.

### Items workspace

**Ladder** is a matrix: rows are tiers, columns are slots grouped by family (melee, magic, tools,
materials). A cell is the item icon and name, hovering shows its numbers, clicking opens the item
in a right drawer without leaving the matrix. Under each tier row, the tier's armour sets show
their five pieces and threshold bonuses. Column headers open the family curve; changing a
parameter re-renders the column live before saving.

**Catalog** is the flat list of every item with the existing search, facets and grid/list.

**Sets** show five slots as icons, the threshold bonuses as a small table, and the set balance
target for the tier beside the actual threshold so drift is visible.

**Recipes** show input icons → output icon, station, duration and xp with their template terms.

### Creatures workspace

Bestiary grid grouped by region and level, using the rendered model thumbnails. A creature page
shows the model, the combat block with each stat derived from the role curve at the creature's
level and any adjustment as an override, the loot as a drop grid, variants (inherit from the base,
overridden fields marked), and spawns as a map thumbnail that opens the world with the placement
selected.

### World workspace

Full-bleed map using the tiled detail renditions from `world-map.json` so zoom reaches 0.25 m/px.
Left rail: layer toggles and a filtered list of what is in view. Right rail: inspector for the
selection. Layers: regions, roads, locations, settlements (buildings, stations, shops, bank), NPCs,
landmarks, gates, obstacles, spawns, resource nodes. Click selects, drag moves, keyboard nudges.

A spawn is a placement. Its inspector shows the creatures that spawn there inline with their
weights, the count, radius and formation, and the anchors. The encounter record behind it is
created and named automatically when the spawn is added and stays hidden unless it is shared, in
which case the inspector says "shared with N other spawns" and offers to detach. Resource nodes
show the resource, count and radius. NPCs show role, dialogue root and quests. Locations show
kind, name and blurb.

### Tuning workspace

Plain tables for the mechanism collections and the legacy balance objects, kept for the rare
direct edit and for agents. Formulas index with source links stays here.

## Implementation

Built September 14, 2026:

- Foundation, root-owned: `styles/theme.css` and `styles/workspace.css` (scale), `ui/Sheet.tsx`
  (key/value rows, derived rows, sized inputs, save bar), `model/derive.ts` (client-side derivation
  with terms), `model/draft.ts` (record draft with revision check; transactions), `ui/workspaces.ts`
  + `router.tsx` + `App.tsx` (workspaces and tabs; old collection links redirect).
- Workspaces under `src/workspaces/<name>/`: items (ladder matrix, item page with inline family
  curve and overrides, sets with balance targets, recipes with template terms), creatures (bestiary,
  creature page with role curve and overrides, role drawer, loot tables), world (tiled map, layers,
  list rail, inspector, add spawn/node/location/landmark, transaction save), story (NPC with dialogue
  outline, quest stage flow, dialogue nodes, shops), spells (element × rung matrix), assets (model
  gallery and viewer, audio tables with playback).
- The generic `CollectionPage` and `EntityDetail` remain as the fallback for resources, fuels,
  runes, elemental spells and the tuning tables, restyled to one column.
- `tools/devdocs-shot.ts` screenshots routes against the running dev server;
  `tools/devdocs-smoke.ts` covers the new navigation, item save and conflict, and the map spawn flow.

Left for later: set thresholds and campfire fuels are still stored resolved rather than derived
from their balance objects (the set page shows the target beside the stored value); the tuning
tables use the generic sheet; the player guide reuses the same pages read-only.
