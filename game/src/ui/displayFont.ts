import { publicUrl } from "../app/config.js";

/**
 * Cinzel (SIL OFL 1.1), self-hosted variable font. The ceremonial face: titles, the mark, gold
 * numbers. Body text stays on the system sans stack, because small type in a HUD must stay crisp.
 *
 * Registered here rather than with `@font-face` in `styles.css` because CSS cannot read the asset
 * base: a stylesheet can only name a fixed path, and the font belongs on the same host as the rest
 * of the public files. `font-family: "Cinzel"` in the stylesheet resolves against this the same way
 * it resolved against the rule.
 */
const UNICODE_RANGE = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, "
  + "U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

let registered = false;

export function registerDisplayFont(): void {
  if (registered || typeof document === "undefined" || typeof FontFace === "undefined") return;
  registered = true;
  const face = new FontFace("Cinzel", `url(${publicUrl("assets/fonts/cinzel-latin.woff2")}) format("woff2")`, {
    style: "normal", weight: "400 900", display: "swap", unicodeRange: UNICODE_RANGE,
  });
  document.fonts.add(face);
  // A missing display face leaves the serif fallback in place; it must never stop boot.
  void face.load().catch(() => document.fonts.delete(face));
}
