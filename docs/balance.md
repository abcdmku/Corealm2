# Corealm balance

Balance has one source owner for each value. Authored profiles, family parameters, template
parameters, and deliberate record adjustments live in `game/content/data/`. Typed formula functions
live in `game/src/content/formulas/`. The shared compiler validates those inputs, resolves derived
values, and writes the versioned catalog at `game/content/compiled/catalog.json`.

Devdocs uses the same compiler as the game. The formula inspector links a resolved field to its
formula, profile, inputs, source function, and consumers. Change a parameter in its owning profile,
preview the affected records, and click Save once. Change formula logic in the TypeScript source
through **Open in VS Code**. A source edit must pass the repository's project type check before a
new catalog can become active.

## Balance data

| Source | Owns |
| --- | --- |
| `materials.json` | Material identity, display data, and the item that represents it. |
| `progression.json` | Ordered tiers, required levels, material assignments, resources, family members, production entries, and optional magic or smelting settings. |
| `equipmentFamilies.json` | Shared equipment or tool slot behavior, skill, formula reference, and typed value and bonus parameters. |
| `recipeTemplates.json` | Shared production kind, skill, stations, formula reference, and duration and experience parameters. |
| `creatureProfiles.json` | Combat role curves shared by creatures. |
| `creatureDefinitions.json` | Creature identity, presentation, level, availability, profile reference, explicit combat adjustments, and loot ownership. |
| `lootTables.json` | Named drop lists reused by creatures. A one-off list can live on its creature definition. |
| `encounters.json` and `placements.json` | Reusable creature composition and its world location, population, formation, and anchor adjustments. |

The older balance files under `game/content/data/balance/` are retained only where conversion or
diagnostic records still need them. New content uses the domain sources above. Do not copy resolved
fields into a second authored record, attach formula tags to a row, or maintain a parallel formula
implementation in JSON.

## Typed formula registry

`game/src/content/formulas/index.ts` registers each formula with five contracts:

- input schema, such as a positive tier;
- parameter schema, supplied by a profile or template;
- output schema, checked before the result enters the catalog;
- source file and function symbol, used by Devdocs to open the implementation;
- owning profile collection and example input.

Current formulas include `creature.combat`, `equipment.linear`, and `production.linear`. Adding a
new mechanic means adding a typed function and its registry entry. Adding another tier or family
member uses existing formulas and needs only source data.

Every formula preview validates input, parameters, and result. Runtime checks cover finite numbers,
references, quantities, and probability ranges. TypeScript checks the formula and its consumers under
the project configuration. If either check fails, the last valid compiled catalog stays active and
the source transaction remains unsaved.

## Equipment progression

`equipmentStats(tier, parameters)` in `formulas/progression.ts` resolves a family member as follows:

```text
value       = max(0, round(valueBase + tier * valuePerLevel))
bonus[key]  = round(bonusesBase[key] + tier * bonusesPerLevel[key])
gatherBonus = tier * gatherBonusPerLevel
```

The family owns the curve. A tier member owns its item identity, name, description, and any explicit
exception. A member adjustment can replace a resolved value, bonus, or gathering bonus for that
member. It does not create a second family or a copied calculated item.

Equipment bonuses are split by purpose. Weapons supply melee or magic power and accuracy. Armour
supplies defence, health, and any authored accuracy. Attack speed and magic-weapon charge details
are part of the family or item definition when the mechanic needs them.

## Production progression

`productionStats(tier, parameters)` uses the template's typed values:

```text
durationMs = parameters.durationMs
xp         = round(xpBase + tier * xpPerLevel)
```

The tier production entry supplies ingredient and output item IDs, while the template owns the
repeated production rule. An entry may explicitly adjust duration, experience, or required level.
The compiler checks every ingredient, output, station, and burnt-food reference before publishing the
recipe.

## Creature combat

`calculateCreatureCombat(level, profile)` is the shared combat curve. The profile supplies the role
parameters; the definition supplies identity, presentation, availability, loot, and any intentional
adjustment.

```text
maxHealth    = max(1, round(healthBase + level * healthPerLevel))
attackLevel  = max(1, round(level * attackMultiplier))
defenceLevel = max(1, round(level * defenceMultiplier))
accuracy     = round(level * accuracyPerLevel)
armour       = round(level * armourPerLevel)
magicArmour  = round(level * magicArmourPerLevel)
maxHit       = max(1, round(1 + level * hitPerLevel))
gold         = [round(level * goldPerLevel), round(level * goldPerLevel * 2)]
```

The role also selects the default behavior, attack style, and attack range. A caster uses magic and
has the longer attack range. A grazer is passive; the other roles are aggressive until a definition
overrides that behavior. Use a definition adjustment for a creature with a deliberate exception.

A variant points directly to one base creature with `baseId`. It inherits the base's identity fields,
profile, presentation, and loot, then overrides the fields it declares. Variants cannot inherit from
other variants. The compiler records the source definition and profile for every resolved combat row,
so Devdocs can show which base or override supplied each value.

## Loot

Loot uses one drop shape with item reference, quantity, and chance. Shared tables are useful when
several creatures intentionally drop the same list. A unique list belongs inline on the creature
definition. The editor shows table consumers before a shared change is saved, and the compiler checks
that each item exists and every chance is within its allowed range.

## Preview and Save

The balance inspector accepts example inputs and shows the saved profile result beside a preview
result. It also shows the tier curve and every content record that consumes the profile. A source
parameter change does not rewrite records while it is being edited. Preview first, inspect the impact,
then click Save once to validate and write the source transaction and compiled catalog together.

Formula logic changes follow the same path after the TypeScript file passes project checks. Devdocs
refreshes diagnostics and impact information from the new catalog. Failed checks leave the previous
catalog usable, so a bad draft cannot replace a working build.

There is no recompute or parity stage in balance authoring. The compiler is the calculation path for
Devdocs, command-line checks, the feature lab, and the player build.

## Checks

Use `npm run content:check` to parse all registered data, resolve formulas, compile progression,
compile creatures, compile world placements, and report diagnostics. Use `npm run devdocs` to inspect
fields and consumers in the editor. Run `npm run devdocs:smoke` for the browser workflow. For a world
placement change, run `npm run world:build` after the content Save and inspect the game in Chromium.
