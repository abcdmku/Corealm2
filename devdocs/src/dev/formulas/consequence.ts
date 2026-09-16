/*
  The model behind a curve's consequences (docs/devdocs-inputs.md 3.10): does a consumer's number
  move when a curve parameter changes, and if not, is that because the consumer overrides it?
  `consequences.tsx` draws this; nothing here touches React or the DOM.
*/

/** Values compare as the reader sees them, so a freshly built `[3, 6]` still equals `[3, 6]`. */
export const sameValue = (a: unknown, b: unknown): boolean => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

export interface Movement {
  /** The curve moved and the consumer moved with it. */
  moved: boolean;
  /** The curve moved and the consumer's own override held it still. */
  pinned: boolean;
}

export function movesWith(before: unknown, after: unknown, overridden: boolean): Movement {
  const changed = !sameValue(before, after);
  return { moved: changed && !overridden, pinned: changed && overridden };
}

/**
 * A row moves when any of its cells moves. It counts as pinned only when nothing on it moved and
 * an override is the reason: a creature that follows the curve for health while overriding its
 * armour is not "unmoved".
 */
export function rowMovement(cells: readonly Movement[]): Movement {
  const moved = cells.some(cell => cell.moved);
  return { moved, pinned: !moved && cells.some(cell => cell.pinned) };
}

export interface Tally { total: number; moved: number; pinned: number }

export function tally(rows: readonly Movement[]): Tally {
  return { total: rows.length, moved: rows.filter(row => row.moved).length, pinned: rows.filter(row => row.pinned).length };
}
