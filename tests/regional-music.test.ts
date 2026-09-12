import { describe, expect, it, vi } from "vitest";
import type { AudioCatalog } from "../game/src/audio/catalog.js";
import { AudioDirector, musicAreaAt } from "../game/src/audio/director.js";
import type { AudioEngine } from "../game/src/audio/engine.js";
import { CROWNWARD_MUSIC_AREAS } from "../game/src/audio/castleMusic.js";

const areas = [{ id: "castle", music: "castle", centre: [0, 0] as const, radius: 8, exitPadding: 3 }];
const catalog: AudioCatalog = {
  regions: { crownward: { music: ["plains", "alternate"], ambient: "wind", musicAreas: areas },
    gloamgarden: { music: "fairy" }, faeholme: { music: "mire" } },
};

describe("regional music areas", () => {
  it("covers both Crownward castles, their approaches and upper floors, while leaving open country on Plains", () => {
    expect(CROWNWARD_MUSIC_AREAS.map(area => area.id)).toEqual(["crownward_white_castle", "crownward_ivory_citadel"]);
    for (const position of [[550, 0, -60], [554.2, 0, -102], [574.2, 25, 320.6], [560, 0, 268]] as const) {
      expect(musicAreaAt(CROWNWARD_MUSIC_AREAS, position)?.music).toBe("music.castle");
    }
    expect(musicAreaAt(CROWNWARD_MUSIC_AREAS, [480, 0, 100])).toBeNull();
    expect(musicAreaAt(CROWNWARD_MUSIC_AREAS, [550, 0, -150])).toBeNull();
  });
  it("includes every height inside the footprint and buffers only an already active boundary", () => {
    expect(musicAreaAt(areas, [0, 40, 8])?.id).toBe("castle");
    expect(musicAreaAt(areas, [0, 0, 9])).toBeNull();
    expect(musicAreaAt(areas, [0, 0, 11], "castle")?.id).toBe("castle");
    expect(musicAreaAt(areas, [0, 0, 11.01], "castle")).toBeNull();
  });

  it("crossfades on entry and exit, retains ambience and the region visit, and clears on travel/reset", async () => {
    const engine = { startLoop: vi.fn(async (_name: string) => true), stopLoop: vi.fn(), snapshot: () => ({ activeLoops: [] }) };
    const director = new AudioDirector(engine as unknown as AudioEngine, catalog);
    director.setRegion("crownward", [0, 0, 20]);
    await Promise.resolve();
    director.setRegion("crownward", [0, 0, 7]);
    await Promise.resolve();
    expect(engine.stopLoop).toHaveBeenCalledWith("plains", 1200);
    director.setRegion("crownward", [0, 0, 9]);
    director.setRegion("crownward");
    expect(engine.startLoop.mock.calls.map(call => call[0])).toEqual(["plains", "wind", "castle"]);
    director.setRegion("crownward", [0, 0, 12]);
    await Promise.resolve();
    expect(engine.stopLoop).toHaveBeenCalledWith("castle", 1200);
    director.setRegion("crownward", [0, 0, 0]);
    await Promise.resolve();
    director.setRegion("gloamgarden", [0, -120, 0]);
    await Promise.resolve();
    director.setRegion("faeholme", [0, -120, 0]);
    await Promise.resolve();
    director.setRegion("crownward", [0, 0, 20]);
    await Promise.resolve();
    director.reset("crownward", [0, 0, 0]);
    await Promise.resolve();
    director.setRegion("crownward", [0, 0, 20]);
    expect(engine.startLoop.mock.calls.map(call => call[0])).toEqual([
      "plains", "wind", "castle", "plains", "castle", "fairy", "mire", "alternate", "wind", "castle", "plains",
    ]);
  });

  it("rejects a late castle decode after leaving its grounds", async () => {
    let finishCastle!: (started: boolean) => void;
    const engine = {
      startLoop: (name: string) => name === "castle"
        ? new Promise<boolean>(resolve => { finishCastle = resolve; }) : Promise.resolve(true),
      stopLoop: vi.fn(), snapshot: () => ({ activeLoops: [] }),
    };
    const director = new AudioDirector(engine as unknown as AudioEngine, catalog);
    director.setRegion("crownward", [0, 0, 20]);
    await Promise.resolve();
    director.setRegion("crownward", [0, 0, 0]);
    director.setRegion("crownward", [0, 0, 20]);
    await Promise.resolve();
    finishCastle(true);
    await Promise.resolve();
    expect(engine.stopLoop).toHaveBeenCalledWith("castle", 1200);
    expect(engine.stopLoop).not.toHaveBeenCalledWith("plains", 1200);
  });
});
