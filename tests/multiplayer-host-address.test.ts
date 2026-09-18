import { describe, expect, it } from "vitest";
import { hostDirectoryUrl, hostLabel } from "../game/src/multiplayer/worldSelector.js";
import { endpoint, SessionFailure } from "../game/src/multiplayer/protocol.js";

describe("adding a host from the worlds menu", () => {
  it("turns what a player types into a directory URL", () => {
    expect(hostDirectoryUrl("127.0.0.1:4180")).toBe("http://127.0.0.1:4180/worlds");
    expect(hostDirectoryUrl("  localhost:4180  ")).toBe("http://localhost:4180/worlds");
    expect(hostDirectoryUrl("ws://127.0.0.1:4180/")).toBe("http://127.0.0.1:4180/worlds");
    expect(hostDirectoryUrl("worlds.example.com")).toBe("https://worlds.example.com/worlds");
    expect(hostDirectoryUrl("wss://worlds.example.com/")).toBe("https://worlds.example.com/worlds");
    expect(hostDirectoryUrl("https://worlds.example.com/directory.json")).toBe("https://worlds.example.com/directory.json");
    expect(hostDirectoryUrl("https://worlds.example.com/worlds?token=secret")).toBe("https://worlds.example.com/worlds");
  });

  it("rejects what cannot be a directory", () => {
    for (const input of ["", "   ", "ftp://example.com", "http://", "not a host", "x".repeat(2049)]) {
      expect(hostDirectoryUrl(input)).toBeNull();
    }
  });

  it("produces addresses discovery accepts, and keeps unencrypted remote hosts out", () => {
    expect(endpoint(hostDirectoryUrl("127.0.0.1:4180")!, true)).toBe("http://127.0.0.1:4180/worlds");
    expect(endpoint(hostDirectoryUrl("worlds.example.com")!, true)).toBe("https://worlds.example.com/worlds");
    // A remote host typed as plain http stays http, and discovery is what refuses it.
    expect(() => endpoint(hostDirectoryUrl("http://worlds.example.com")!, true)).toThrow(SessionFailure);
  });

  it("labels a host by its address", () => {
    expect(hostLabel("http://127.0.0.1:4180/worlds")).toBe("127.0.0.1:4180");
    expect(hostLabel("https://worlds.example.com/directory.json")).toBe("worlds.example.com/directory.json");
  });
});
