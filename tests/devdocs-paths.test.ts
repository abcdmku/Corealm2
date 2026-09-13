import { afterEach, expect, it, vi } from "vitest";
import { metaCollectionName, metaFileName } from "../tools/content/meta.js";
import { gameUrl } from "../devdocs/src/model/gameUrl.js";
afterEach(() => vi.unstubAllGlobals());
it("maps balance metadata to safe flat names and back", () => {
  expect(metaFileName("balance/gear")).toBe("meta/balance--gear.meta.json");
  expect(metaCollectionName("balance--gear.meta.json")).toBe("balance/gear");
  expect(metaCollectionName("items.meta.json")).toBe("items");
  expect(metaCollectionName("../items.meta.json")).toBeUndefined();
  expect(() => metaFileName("balance/../items")).toThrow();
});
it("resolves assets against the deployed game base without escaping to the origin root", () => {
  vi.stubGlobal("document", { baseURI: "https://example.test/corealm/" });
  expect(gameUrl("assets/manifest.json")).toBe("https://example.test/corealm/assets/manifest.json");
  expect(gameUrl("/assets/icons/test.png")).toBe("https://example.test/corealm/assets/icons/test.png");
  expect(() => gameUrl("https://other.test/a.glb")).toThrow();
});
