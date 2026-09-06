import type { Vec3 } from "../contracts.js";
import type { TraversalPresentationPort, TraversalSample } from "../systems/traversalMotion.js";
import { traversalContactHeight } from "../systems/traversalContacts.js";

/** Presentation only. The activity owns RNG, health, XP and the authoritative landing. */
export class TraversalPresentation implements TraversalPresentationPort {
  private sample: TraversalSample | null = null;
  private previousSample: TraversalSample | null = null;
  private sampledAt = 0;
  private curtain: HTMLDivElement | null = null;
  private generation = 0;
  private opaquePainted = false;
  private opaquePending = false;
  private handoffCover = false;

  constructor(private readonly settled: () => Promise<void>) {}

  current(): TraversalSample | null {
    const next = this.sample;
    const previous = this.previousSample;
    if (!next || !previous || next.phase === "recovery") return next;
    const alpha = Math.max(0, Math.min(1, (performance.now() - this.sampledAt) / 100));
    const blend = (i: number): number => previous.position[i]! + (next.position[i]! - previous.position[i]!) * alpha;
    const position: [number, number, number] = [blend(0), blend(1), blend(2)];
    const support = next.support;
    if (support && previous.support) {
      const height = (point: Vec3): number => traversalContactHeight(next.kind,
        (point[0] - support.origin[0]) * Math.sin(support.rotationY)
        + (point[2] - support.origin[2]) * Math.cos(support.rotationY), support.depth, support.rise);
      // Interpolate travel along the supported curve, not a chord through the ledge face.
      position[1] += height(position) - (height(previous.position) * (1 - alpha) + height(next.position) * alpha);
    }
    return { ...next, position,
      progress: previous.progress + (next.progress - previous.progress) * alpha };
  }
  reset(): void {
    this.generation++;
    this.sample = null;
    this.previousSample = null;
    this.curtain?.remove();
    this.curtain = null;
    this.opaquePainted = false;
    this.opaquePending = false;
    this.handoffCover = false;
  }
  readyToCommit(): boolean { return !this.sample?.concealed || this.opaquePainted; }

  begin(sample: TraversalSample): void {
    const generation = ++this.generation;
    const cover = this.curtain;
    this.previousSample = null;
    if (cover) {
      // A repeat command can arrive during recovery's fade. Preserve an opaque cover before
      // moving the rendered actor to the new entrance, rather than removing a half-closed fade.
      for (const animation of cover.getAnimations()) animation.cancel();
      cover.style.opacity = "1";
      this.sample = sample;
      this.handoffCover = true;
      this.opaquePainted = false;
      this.opaquePending = false;
      void this.settled().then(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        .then(async () => {
          if (generation !== this.generation) return;
          this.opaquePainted = true;
          if (this.sample?.concealed) return;
          const opening = cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "forwards" });
          await opening.finished;
          if (generation !== this.generation) return;
          cover.remove();
          this.curtain = null;
          this.handoffCover = false;
        }).catch(() => {
          if (generation === this.generation) { cover.remove(); this.curtain = null; this.handoffCover = false; }
        });
      return;
    }
    this.curtain?.remove();
    this.curtain = null;
    this.opaquePainted = false;
    this.opaquePending = false;
    this.handoffCover = false;
    this.update(sample);
  }

  update(sample: TraversalSample): void {
    this.previousSample = this.current();
    this.sampledAt = performance.now();
    this.sample = sample;
    if (this.handoffCover) return;
    if (!sample.concealed) return;
    if (!this.curtain) {
      this.curtain = document.createElement("div");
      this.curtain.className = "traversal-transition";
      this.curtain.setAttribute("aria-label", "Crossing passage");
      this.curtain.style.cssText = "position:fixed;inset:0;z-index:99999;background:#080a0c;pointer-events:none;opacity:0";
      document.body.append(this.curtain);
    }
    this.curtain.style.opacity = String(sample.curtainOpacity);
    if (sample.curtainOpacity === 1 && !this.opaquePainted && !this.opaquePending) {
      this.opaquePending = true;
      const generation = this.generation;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (generation === this.generation) this.opaquePainted = true;
      }));
    }
  }

  end(reason: string, position: Vec3): void {
    const sample = this.current();
    this.previousSample = null;
    const generation = ++this.generation;
    const curtain = this.curtain;
    // Concealed passages reveal the semantic destination only after a real render barrier.
    if (curtain) {
      for (const animation of curtain.getAnimations()) animation.cancel();
      this.handoffCover = false;
      this.sample = null;
      curtain.style.opacity = "1";
      void this.settled().then(async () => {
        if (generation !== this.generation) return;
        const animation = curtain.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
        await animation.finished;
        if (generation !== this.generation) return;
        curtain.remove();
        this.curtain = null;
      }).catch(() => {
        if (generation === this.generation) { curtain.remove(); this.curtain = null; }
      });
      return;
    }
    if (!sample || reason === "completed") { this.sample = null; return; }
    // The semantic player may already be following a replacement command. Cover recovery before
    // releasing the old visual pose; a straight line back would cut through the contact solid.
    if (Math.hypot(...sample.position.map((value, index) => value - position[index]!)) < 0.15) {
      this.sample = null;
      return;
    }
    const recovery = document.createElement("div");
    recovery.className = "traversal-transition";
    recovery.setAttribute("aria-label", "Recovering footing");
    recovery.style.cssText = "position:fixed;inset:0;z-index:99999;background:#080a0c;pointer-events:none;opacity:0";
    document.body.append(recovery);
    this.curtain = recovery;
    this.sample = { ...sample, phase: "recovery" };
    void (async () => {
      const closing = recovery.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: "forwards" });
      await closing.finished;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (generation !== this.generation) return;
      this.sample = null;
      await this.settled();
      if (generation !== this.generation) return;
      const opening = recovery.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "forwards" });
      await opening.finished;
      if (generation !== this.generation) return;
      recovery.remove();
      this.curtain = null;
    })().catch(() => {
      if (generation === this.generation) { this.sample = null; recovery.remove(); this.curtain = null; }
    });
  }
}
