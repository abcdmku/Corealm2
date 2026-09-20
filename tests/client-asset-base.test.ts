import { afterEach, describe, expect, it } from "vitest";
import {
  assetBaseUrl, assetManifestUrl, foreignAssetHost, generatedUrl,
  publicBaseUrl, publicUrl, resetPublicBaseUrl, setPublicBaseUrl,
} from "../game/src/app/config.js";

const global = globalThis as { __COREALM_ASSET_BASE__?: unknown };
afterEach(() => { delete global.__COREALM_ASSET_BASE__; resetPublicBaseUrl(); });

describe("client asset base", () => {
  it("keeps the page's own directory when nothing overrides it", () => {
    expect(publicBaseUrl()).toBe("/");
    expect(assetBaseUrl()).toBe("/assets/");
    expect(assetManifestUrl()).toBe("/assets/manifest.json");
    expect(generatedUrl("world/manifest.json")).toBe("/generated/world/manifest.json");
    expect(publicUrl("audio/sfx/oga/footstep-ground-01.ogg")).toBe("/audio/sfx/oga/footstep-ground-01.ogg");
  });
  it("moves every public file to the base boot resolved", () => {
    setPublicBaseUrl("https://cdn.example.com/corealm/");
    expect(assetManifestUrl()).toBe("https://cdn.example.com/corealm/assets/manifest.json");
    expect(assetBaseUrl()).toBe("https://cdn.example.com/corealm/assets/");
    expect(generatedUrl("corealm-navmesh.nav")).toBe("https://cdn.example.com/corealm/generated/corealm-navmesh.nav");
    expect(publicUrl("/assets/fonts/cinzel-latin.woff2")).toBe("https://cdn.example.com/corealm/assets/fonts/cinzel-latin.woff2");
  });
  it("adds the trailing slash and ignores an empty answer", () => {
    setPublicBaseUrl("http://127.0.0.1:4196");
    expect(publicBaseUrl()).toBe("http://127.0.0.1:4196/");
    setPublicBaseUrl(undefined);
    expect(publicBaseUrl()).toBe("http://127.0.0.1:4196/");
  });
  it("refuses a second answer once a URL has been built", () => {
    expect(assetManifestUrl()).toBe("/assets/manifest.json");
    expect(() => setPublicBaseUrl("https://cdn.example.com/")).toThrow(/already used/);
    expect(() => setPublicBaseUrl("/")).not.toThrow();
  });
  it("rejects a base that is not http", () => {
    expect(() => setPublicBaseUrl("ftp://cdn.example.com/")).toThrow(/http/);
  });
  it("lets a page pin its own host and stop asking worlds", () => {
    global.__COREALM_ASSET_BASE__ = "http://127.0.0.1:4196";
    expect(publicBaseUrl()).toBe("http://127.0.0.1:4196/");
    expect(assetManifestUrl()).toBe("http://127.0.0.1:4196/assets/manifest.json");
    expect(foreignAssetHost(undefined)).toBe(false);
    expect(foreignAssetHost("https://cdn.example.com/")).toBe(false);
  });
  it("names a world whose asset host is not the one already loaded", () => {
    expect(foreignAssetHost(undefined)).toBe(false);
    expect(foreignAssetHost("https://cdn.example.com/")).toBe(true);
    setPublicBaseUrl("https://cdn.example.com/");
    expect(foreignAssetHost("https://cdn.example.com")).toBe(false);
    expect(foreignAssetHost("https://other.example.com/")).toBe(true);
    expect(foreignAssetHost(undefined)).toBe(true);
  });
});
