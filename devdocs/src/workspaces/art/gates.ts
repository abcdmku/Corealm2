import { can } from "../../api/backend.js";

/*
  Why an Art action cannot run here, or undefined when it can. Every control that needs a capability
  asks one of these, renders disabled with the reason beside it, and never offers a click that fails.
*/

/** Saving skin maps (upload, recolor, replace): new files stored where players load them, then a content save. */
export function filesBlock(): string | undefined {
  if (!can("write")) return "This editor is read only.";
  if (!can("files")) return "This server has no file store yet, so skin maps cannot be saved here.";
  return undefined;
}

/** Starting or retrying an image generation job. */
export function imagegenBlock(): string | undefined {
  if (!can("imagegen")) return "Image generation does not run on this server yet.";
  if (!can("write")) return "This editor is read only.";
  return undefined;
}

/** Art verdicts and review notes, which are authoring metadata. */
export function metaBlock(): string | undefined {
  return can("meta") ? undefined : "Verdicts need an authoring metadata store; this server has none yet.";
}
