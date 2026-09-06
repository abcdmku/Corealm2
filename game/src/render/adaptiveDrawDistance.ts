import type { DrawDistance } from "../ui/settings.js";

const LEVELS: readonly DrawDistance[] = ["near", "medium", "far"];

/** Adjusts view distance from sustained frame times. Individual loading stalls do not decide quality. */
export class AdaptiveDrawDistance {
  private samples: number[] = [];
  private elapsed = 0;
  private cooldown = 6_000;
  private fastWindows = 0;
  private slowWindows = 0;
  private upgradeDelay = 0;

  constructor(private distance: DrawDistance) {}

  reset(distance: DrawDistance): void {
    this.distance = distance;
    this.samples = [];
    this.elapsed = this.fastWindows = this.slowWindows = this.upgradeDelay = 0;
    this.cooldown = 6_000;
  }

  sample(frameMs: number, eligible = true): DrawDistance | null {
    if (!eligible || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1_000) {
      this.samples = [];
      this.elapsed = this.fastWindows = this.slowWindows = 0;
      return null;
    }
    this.upgradeDelay = Math.max(0, this.upgradeDelay - frameMs);
    if (this.cooldown > 0) {
      this.cooldown -= frameMs;
      return null;
    }
    this.samples.push(frameMs);
    this.elapsed += frameMs;
    if (this.elapsed < 3_000 || this.samples.length < 8) return null;
    this.samples.sort((a, b) => a - b);
    const percentile = (fraction: number) => this.samples[Math.floor((this.samples.length - 1) * fraction)]!;
    const slow = percentile(0.75) > 26;
    const fast = percentile(0.9) < 18.5;
    this.slowWindows = slow ? this.slowWindows + 1 : 0;
    this.fastWindows = fast ? this.fastWindows + 1 : 0;
    this.samples = [];
    this.elapsed = 0;
    const index = LEVELS.indexOf(this.distance);
    let next = index;
    if (this.slowWindows >= 2 && index > 0) {
      next--;
      // Avoid repeatedly trying a distance this device just failed to sustain.
      this.upgradeDelay = 120_000;
    } else if (this.fastWindows >= 5 && this.upgradeDelay === 0 && index < LEVELS.length - 1) next++;
    if (next === index) return null;
    this.distance = LEVELS[next]!;
    this.fastWindows = this.slowWindows = 0;
    this.cooldown = 10_000;
    return this.distance;
  }
}
