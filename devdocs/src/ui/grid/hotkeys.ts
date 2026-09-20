/*
  Single-letter "set on selection" keys (docs/devdocs-inputs.md §3.8, Linear's model). With records
  selected and focus outside an input, the letter opens the palette straight at the field's choices.
  One table; the palette shows the letter in its rows and `tests/devdocs-grid-model.test.ts` checks
  every path resolves in the collection's schema.
*/

export interface Hotkey {
  collection: string;
  /** Lower-case letter. */
  key: string;
  /** Draft path of the field the key sets. */
  path: readonly string[];
}

export const HOTKEYS: readonly Hotkey[] = [
  { collection: "creatureDefinitions", key: "r", path: ["profileId"] },
  { collection: "creatureDefinitions", key: "g", path: ["presentation", "regionId"] },
  { collection: "creatureDefinitions", key: "a", path: ["availability"] },
  { collection: "items", key: "c", path: ["category"] },
  { collection: "items", key: "t", path: ["tier"] },
  { collection: "npcs", key: "g", path: ["regionId"] },
  { collection: "spells", key: "e", path: ["element"] },
];

export const hotkeysFor = (collection: string): Hotkey[] => HOTKEYS.filter(hotkey => hotkey.collection === collection);

export function hotkeyFor(collection: string, path: readonly (string | number)[]): Hotkey | undefined {
  const joined = path.join(".");
  return HOTKEYS.find(hotkey => hotkey.collection === collection && hotkey.path.join(".") === joined);
}
