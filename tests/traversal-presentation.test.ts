import { afterEach, describe, expect, it, vi } from "vitest";
import { TraversalPresentation } from "../game/src/render/traversalPresentation.js";
import type { TraversalSample } from "../game/src/systems/traversalMotion.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const sample = (z: number, progress: number): TraversalSample => ({ position: [0, 0, z], progress,
  facingRad: 0, kind: "balance", phase: "travel", concealed: false, curtainOpacity: 0 });

describe("traversal presentation lifecycle", () => {
  it("interpolates the 100 ms activity samples into continuous rendered travel", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const presentation = new TraversalPresentation(async () => {});
    presentation.begin(sample(0, 0));
    now = 100;
    presentation.update(sample(1, 0.3));
    now = 150;
    expect(presentation.current()?.position).toEqual([0, 0, 0.5]);
    expect(presentation.current()?.progress).toBeCloseTo(0.15);
    now = 200;
    expect(presentation.current()?.position).toEqual([0, 0, 1]);
    presentation.end("completed", [0, 0, 1]);
    expect(presentation.current()).toBeNull();
  });

  it("keeps recovery opaque when a repeated command replaces the held pose", () => {
    const curtain = { className: "", style: { cssText: "", opacity: "0" }, setAttribute: vi.fn(),
      remove: vi.fn(), getAnimations: () => [], animate: () => ({ finished: new Promise<void>(() => {}), cancel: vi.fn() }) };
    vi.stubGlobal("document", { createElement: () => curtain, body: { append: vi.fn() } });
    const presentation = new TraversalPresentation(() => new Promise<void>(() => {}));
    presentation.begin(sample(2, 0.5));
    presentation.end("cancelled", [0, 0, 0]);
    presentation.begin(sample(0, 0));
    expect(curtain.remove).not.toHaveBeenCalled();
    expect(curtain.style.opacity).toBe("1");
    expect(presentation.current()?.position).toEqual([0, 0, 0]);
    presentation.update(sample(0.1, 0.1));
    expect(curtain.style.opacity).toBe("1");
    presentation.reset();
    expect(curtain.remove).toHaveBeenCalledOnce();
  });

  it("waits for destination readiness and two painted frames before revealing a rapid restart", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    let ready!: () => void;
    let rejectClosing!: (reason?: unknown) => void;
    let finishOpening!: () => void;
    const closing = { finished: new Promise<void>((_, reject) => { rejectClosing = reject; }), cancel: () => rejectClosing(new Error("replaced")) };
    const opening = { finished: new Promise<void>((resolve) => { finishOpening = resolve; }), cancel: vi.fn() };
    const curtain = { className: "", style: { cssText: "", opacity: "0" }, setAttribute: vi.fn(), remove: vi.fn(),
      getAnimations: () => [closing], animate: vi.fn().mockReturnValueOnce(closing).mockReturnValueOnce(opening) };
    vi.stubGlobal("document", { createElement: () => curtain, body: { append: vi.fn() } });
    const presentation = new TraversalPresentation(() => new Promise<void>((resolve) => { ready = resolve; }));
    presentation.begin(sample(2, 0.5));
    presentation.end("cancelled", [0, 0, 0]);
    presentation.begin(sample(0, 0));
    await Promise.resolve();
    expect(presentation.current()?.position).toEqual([0, 0, 0]);
    expect(curtain.remove).not.toHaveBeenCalled();
    expect(curtain.animate).toHaveBeenCalledTimes(1);
    ready();
    await Promise.resolve();
    frames.shift()!(0);
    expect(curtain.animate).toHaveBeenCalledTimes(1);
    frames.shift()!(16);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(curtain.animate).toHaveBeenCalledTimes(2);
    expect(curtain.style.opacity).toBe("1");
    finishOpening();
    await Promise.resolve(); await Promise.resolve();
    expect(curtain.remove).toHaveBeenCalledOnce();
    expect(presentation.current()?.position).toEqual([0, 0, 0]);
  });
});
