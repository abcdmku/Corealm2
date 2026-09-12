# Fab armor requirements

Scope follows the owner's explicit selection in the current request. This replaces the earlier run's restriction against new armor geometry and mage texture changes for these selected imports.

- Import source armor, retain the existing player identity, and support the existing equipment slots and animations.
- Craftable magic sets retain existing saved item IDs, recipes and tier requirements at 1, 5, 10, 20, 50 and 70. Use the lowpoly mage outfit with distinct generated fabric/leather finishes by tier.
- Rare boss armor is separate from crafted gear: melee and magic sets at 50, 70 and 90, using the exact image selections recorded in brief.md. Follow existing rare-loot conventions where available.
- Avoid publishing standalone licensed source packs. Keep conversion inputs in private local staging. Record source mapping and conversion steps.
- Root owns shared contracts, production integration and acceptance. Initial agents inspect files read-only; implementation ownership is assigned after baseline boot and interface review.
- Prove production mesh loading, equipment slots, mixed sets, male/female fit, movement and material appearance in the persistent Chromium feature lab before final-world registration.
- Validate boss drop/equip state changes, crafting compatibility and saves. Inspect normal-camera screenshots. A build alone is not acceptance.

Source availability, skin identities and export compatibility are inspected before committing to converted assets. No placeholder geometry counts as the requested import.
