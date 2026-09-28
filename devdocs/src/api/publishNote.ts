/**
 * The note an author attaches to the next publish, typed in the save bar and sent by the server
 * backend with `POST /admin/content/publish`. It lands on the publish's audit row, which is where
 * Server › History reads it. Repo mode has no publish and never reads it.
 */
export const MAX_PUBLISH_NOTE_CHARS = 512;

let note = "";
const listeners = new Set<() => void>();

export function publishNote(): string { return note; }
export function setPublishNote(next: string): void {
  note = next.slice(0, MAX_PUBLISH_NOTE_CHARS);
  for (const listener of listeners) listener();
}
export function onPublishNote(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
