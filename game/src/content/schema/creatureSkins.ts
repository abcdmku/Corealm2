import { arr, enumOf, id, num, obj, opt, rec, ref, str, type Infer } from "./core.js";

/**
 * A texture set for one creature model: albedo maps that replace the model's own, keyed by the
 * model's material name. A definition wears one as its look (`presentation.skinId`), and a
 * variation range can mix several across individuals (`presentation.variation.skins`).
 *
 * `imagegen` skins are image-generated texture maps (the finished-reskin standard); `recolor`
 * skins are hue/saturation/value shifts of another map that keep its detail; `source` skins are
 * alternative maps shipped with the model's pack; `upload` skins are maps an author painted or made
 * elsewhere and uploaded by hand.
 */
export const CreatureSkinSchema = obj({
  id: id(),
  assetId: ref("asset", { label: "Model", role: "Skin for" }),
  name: str({ nonEmpty: true }, { label: "Name", display: true }),
  kind: enumOf(["imagegen", "recolor", "source", "upload"] as const, { label: "Kind" }),
  /** Material name -> PNG under `game/public/assets/`, e.g. `skins/<assetId>/<skinId>/<material>.png`. */
  maps: rec(str({ pattern: /^skins\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/[A-Za-z0-9_.-]+\.png$/ }), { label: "Albedo maps" }),
  recolor: opt(obj({
    fromSkinId: opt(ref("creatureSkin")),
    hue: num({ min: -180, max: 180 }, { unit: "deg", label: "Hue" }),
    saturation: num({ min: 0 }, { label: "Saturation" }),
    value: num({ min: 0 }, { label: "Value" }),
    /** Only hues within `width` degrees of `hue` moved, so eyes and horns keep their colour. */
    near: opt(obj({ hue: num({ min: 0, max: 360 }, { unit: "deg", label: "Near hue" }), width: num({ exclusiveMin: 0, max: 180 }, { unit: "deg", label: "Width" }) })),
  }), { label: "Recolor" }),
  prompt: opt(str({}, { multiline: true, label: "Prompt" })),
  generator: opt(str({}, { label: "Generator" })),
  /** Materials whose map was later replaced by a hand upload, so a generated skin's provenance stays honest. */
  uploaded: opt(arr(str()), { label: "Uploaded maps" }),
  /** SHA-256 of each written map, keyed like `maps`. */
  sha256: opt(rec(str({ pattern: /^[a-f0-9]{64}$/ })), { label: "SHA-256" }),
  createdAt: str({ nonEmpty: true }, { label: "Created", readOnly: true }),
});
export type CreatureSkin = Infer<typeof CreatureSkinSchema>;
