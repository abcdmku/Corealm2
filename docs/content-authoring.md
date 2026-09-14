# Content authoring

Corealm content has one authored source and one compiler. Source records live under
`game/content/data/`. Devdocs edits those records, validates the proposed transaction, and writes the
resolved catalog to `game/content/compiled/catalog.json`. The player build reads resolved content. It
does not contain the authoring service.

Use `npm run devdocs` to open the local editor. Run `npm run content:check` when reviewing a change
from the command line. The checker parses every registered collection, compiles progression and
creatures, and reports broken references or invalid values.

## The save cycle

1. Open the task area in Devdocs and start from a template or an existing record.
2. Create, duplicate, rename, or edit the authored record. Keep IDs stable when changing display
   names. Use the editor's rename action when an ID must change so references can be updated.
3. Preview the result. The preview runs the same compiler used by the game, shows diagnostics, and
   lists records affected by the change. Generated item, recipe, combat, and placement values are
   read-only results of this preview.
4. Click **Save** once. The transaction checks collection revisions, writes the changed source records,
   and writes a matching compiled catalog. A failed validation leaves both the source and the last
   valid catalog in place. A stale revision keeps the draft so it can be reviewed against the newer
   records.

There is one Save action for an ordinary edit. The workflow has no recompute, apply, or parity step.
World bakes may run after a save when terrain or navigation must be regenerated; the bake records the
source revision it used.

## Progression

### Create a tier

Open **Tuning › Tiers** and create a tier record with a stable ID, display name, tier number, and
required skill level. Add the material IDs for the roles used at that tier, the resources the tier
can acquire, and its presentation fields. Add optional magic or smelting settings only when that
tier uses them.

Select equipment families for the tier. Each member supplies its own stable item ID, name, and
description, then points to a family. Add an explicit member adjustment only for a deliberate
exception. The compiler expands the family formula into the item value, equipment bonuses, or tool
bonus.

Select recipe templates for the production entries. Each entry supplies an ID, name, ingredient
IDs and quantities, and an output item. A cooking entry can name its burnt output. The compiler
combines the template, tier, and entry adjustment into one recipe record.

Preview the tier and inspect the affected item, recipe, resource, and equipment records before
pressing Save. A new tier should not require hand edits to separate gathering and crafting ladders.

### Add an equipment family member

Create or choose a family from a column header of the **Items › Ladder** matrix, or under **Tuning › Equipment families**. A family declares its slot,
skill, category, formula, and parameters. `equipment.linear` accepts a typed value curve, bonus
curve, and gathering curve. Tools use the same family shape with a gathering skill; equipment can
also declare attack speed or magic-weapon details.

Add the member to the relevant progression tier with its stable item ID and presentation text. Keep
an exceptional value in the member's `adjustments` object. Do not copy calculated bonuses into a
second item record. The family page shows its consumers, so a parameter edit can be previewed across
every tier member before Save.

### Add a recipe

Create a `recipeTemplate` for a repeated production rule. Choose its kind, skill, accepted stations,
and the `production.linear` formula parameters for duration and experience. Add a production entry
to the tier with the ingredient references, output reference, and optional burnt output.

Use an entry adjustment for a recipe that intentionally differs from its template. The compiler
checks every ingredient, output, station, and required level and then publishes the resolved recipe.
Preview the recipe and its consumers, then use the same Save action as every other content change.

## Creatures and variants

Create a base creature in **Creatures** with its identity, family, level, availability, presentation,
profile, and loot. A creature profile owns the shared combat curve. A loot table can be shared by
several creatures, while a unique drop list can stay on the creature.

To make a variant, duplicate the base as a direct child and set `baseId`. Override only the fields
that differ, such as name, family, level, profile, presentation asset or scale, combat adjustment,
and loot. Variants may inherit from a base creature only. A variant cannot inherit from another
variant. The editor shows inherited and overridden fields and lists the consumers that change when
the base changes.

Set `availability` to `lab` while developing a fixture and to `world` when the creature should be
spawned. Preview the creature in the production-backed lab, inspect its combat and drops, then Save.
Turn a variant into an independent definition when its identity or behavior no longer belongs to
the base.

## World encounters and placements

On the **World** map choose **Add spawn**, click the map and pick the creature. That creates the
placement and its encounter together; the inspector shows the creatures, weights and activity inline.
The encounter points to creature IDs; it does not copy combat blocks.

Create a placement for that encounter. Set its region, centre, population count, radius, optional
rank or level, and formation. Grid and ring formations use spacing and rotation. An authored
formation carries explicit anchor adjustments when individual residents need a precise location.
Add dressing, roam radius, boundary, and habitat settings only when the scene needs them.

Dragging the placement centre moves the formation as one unit. The compiler expands the encounter,
checks creature and region references, validates anchor bounds and body clearance, and produces the
runtime groups and habitats. Fix diagnostics in the placement source, preview again, and Save. Run
`npm run world:build` afterward when the changed placement needs a new world bake. See
[World authoring](./world-authoring.md) for terrain, coast, water, scatter, and navigation work.

Resource placements use the same region references as progression resources. Keep resource identity
in the resource definition and use the placement only for location and cluster layout.

## Typed formulas

Canonical formula functions live in `game/src/content/formulas/`. The registry in
`game/src/content/formulas/index.ts` binds each formula ID to its input schema, parameter schema,
output schema, source symbol, and owning profile collection. Current examples include
`creature.combat`, `equipment.linear`, and `production.linear`.

Open a field's formula inspector from Devdocs to see the real source file and function, the profile
that supplies its parameters, the inputs, the resolved output, example tier values, and consumers.
Use the inspector to tune profile data and preview the impact. Use **Open in VS Code** when the
formula logic itself needs a change.

Formula code is ordinary typed TypeScript. A source edit runs project type checking before the
compiler accepts a new catalog. Diagnostics identify the source location and affected records. If
the edit fails, the last valid catalog remains active and no invalid result is saved. Keep formula
parameters in their typed profile schema. Do not store anonymous code strings or a second formula
implementation in JSON.

## Review and validation

Use the smallest check that answers the question:

```bash
npm run content:check
npm run devdocs:smoke
npm run world:build       # when world placement or baked geometry changed
npm run dev               # inspect the real player build
```

Review the compiler diagnostics, the affected-record list, and the generated catalog revision. For
visual or interaction changes, use Chromium and inspect the actual scene at a camera and zoom the
player can reach. Keep the source transaction and the compiled catalog on the same revision.
