# Rune sites and utility magic

Status: approved scope from the September 26, 2026 implementation request and follow-up choices. The owner requested a new Arc mine in this checkout, Cosmic plus Arc costs for area effects, and 30-second or one-minute utility durations.

## World and presentation

- Replace square elemental altar paving with seeded organic stone edges. Altar ruins and mining stances must occupy relatively flat, dry, reachable ground.
- Preserve and refine the existing mineable essence rock, retaining surface grain and readable magical fissures.
- Add Arc Essence mining at tier 20, Cosmic Essence at tier 30 in Gloamgarden, and Temporal Essence at tier 60 in Faeholme. Essence is spent directly; there is no rune-conversion recipe. Earlier monsters drop small amounts of loose essence.
- Arc replaces Cosmic in damaging area attacks. Cosmic supplies utility magic; Temporal supplies teleportation.
- Town landing platforms follow the supplied circular mosaic reference, with local stone and pattern variants. Players must visit and activate each platform before teleporting there.

## Spells

Cosmic costs below are units of Cosmic Essence. Area spells also spend Arc Essence. Matching effects do not stack; stronger effects replace weaker effects. Bosses resist roots and slows.

| Spell | Magic | Cost | Effect |
| --- | ---: | --- | --- |
| Lesser Ward | 5 | 1 Cosmic | 10% incoming damage reduction, 60 seconds |
| Weaken | 10 | 1 Cosmic | Enemy damage reduced 10%, 30 seconds |
| Binding Thread | 15 | 2 Cosmic | Root one ordinary enemy, 30 seconds |
| Enchant Weapon | 20 | 2 Cosmic | 10% weapon accuracy, 60 seconds |
| Warding Circle | 30 | 3 Cosmic + 1 Arc | Allied damage reduction 10% within 5 m, 30 seconds |
| Enfeebling Mist | 35 | 3 Cosmic + 1 Arc | Enemy damage reduced 10% within 4 m, 30 seconds |
| Binding Field | 40 | 4 Cosmic + 1 Arc | Root ordinary enemies within 4 m, 30 seconds |
| Greater Enchantment | 45 | 4 Cosmic | 15% weapon accuracy, 60 seconds |
| Mending Circle | 50 | 5 Cosmic + 1 Arc | Restore 15% maximum health over 30 seconds within 5 m |
| Haste | 55 | 4 Cosmic | 15% movement speed, 60 seconds |
| Stillness | 60 | 5 Cosmic + 2 Arc | Slow ordinary enemies 30% within 5 m, 30 seconds |
| Sanctuary | 70 | 6 Cosmic + 2 Arc | Allied damage reduction 20% within 5 m, 30 seconds |

Reveal is excluded because the game has no supported hidden-enemy mechanic.

Teleports take 3 seconds, cancel on movement or damage, and spend Temporal Essence only on arrival. Destination must be explicitly unlocked by visiting its platform.

| Destination | Magic | Temporal Essence |
| --- | ---: | ---: |
| Millfield | 5 | 1 |
| Oakwood | 10 | 1 |
| Hillcrest | 15 | 1 |
| Ashford | 20 | 2 |
| Lantern Rest | 30 | 2 |
| Crownward | 40 | 3 |
| Lastlight | 50 | 3 |
| Prism Hollow | 60 | 4 |
| Starhaven | 70 | 4 |

## Essence tomes

Rare 2% miniboss/boss drops provide Apprentice, Adept and Master Tomes. A full recharge of one essence type costs 100, 500 or 1,000 essence and supplies 100, 500 or 1,000 charges respectively: one essence per charge. Carry the tome and essence to any awakened Essence Altar and use its crafting panel to imbue it. Tomes are inventory items, with no section in the magic menu. Each type is imbued independently; a nonempty reservoir must be spent before a full recharge. Matching staff fuel has priority, then carried tome charges, then loose essence. Banking disables the tome fuel until retrieved. Charge records belong to the character, matching existing charged weapons; tomes cannot be dropped or traded.

## Acceptance

Use the existing production feature lab for reusable materials, models, spell interactions and UI. World placement and terrain use the world-authoring exception because isolated ground cannot prove authored relief or approach navigation. Verify semantic before/after states, normal-camera screenshots, focused regressions, content validation and production build. The root owns shared contracts and integration; workers own distinct files.
