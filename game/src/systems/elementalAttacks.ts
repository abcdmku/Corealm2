import type { Vec3 } from "../contracts.js";
import {
  elementalSpell,
  type ElementalSpellId,
} from "../content/elementalSpells.js";

/** Shared by attack resolution and rendering. Times are relative to cast start. */
export interface ElementalPulse {
  at: number;
  point: Vec3;
  radius: number;
  damage: number;
  form:
    | "dart"
    | "blade"
    | "vortex"
    | "beam"
    | "wave"
    | "spike"
    | "meteor"
    | "nova"
    | "wing"
    | "mine";
  status?: "slow" | "freeze" | "root" | "stagger" | "burn";
  force?: number;
  direction?: readonly [number, number];
  height: number;
  from?: Vec3;
  launchAt?: number;
}
export interface ElementalTarget {
  id: string;
  position: Vec3;
  health: number;
  maxHealth: number;
  hits: number;
  status: string | null;
  statusUntil: number;
}
export interface ElementalCast {
  id: number;
  spellId: ElementalSpellId;
  origin: Vec3;
  aim: Vec3;
  started: number;
  pulses: readonly ElementalPulse[];
  resolved: number;
  damage: number;
  hits: number;
}

/** All patterns use an aim-relative basis, so they also work away from the lab's north lane. */
export function planElementalAttack(
  id: ElementalSpellId,
  origin: Vec3,
  aim: Vec3,
): ElementalPulse[] {
  elementalSpell(id);
  const length = Math.hypot(aim[0] - origin[0], aim[2] - origin[2]) || 1;
  const dx = (aim[0] - origin[0]) / length,
    dz = (aim[2] - origin[2]) / length;
  const pulses: ElementalPulse[] = [];
  const add = (
    at: number,
    x: number,
    z: number,
    radius: number,
    damage: number,
    form: ElementalPulse["form"],
    height = 2,
    status?: ElementalPulse["status"],
    force?: number,
  ): void => {
    pulses.push({
      at,
      point: [aim[0] + dz * x + dx * z, aim[1], aim[2] - dx * x + dz * z],
      radius,
      damage,
      form,
      height,
      status,
      force,
      direction:
        id === "deluge"
          ? [dx, dz]
          : id === "razor-crescent"
            ? [dz, -dx]
            : undefined,
    });
  };
  switch (id) {
    case "breeze-puff":
      add(470, 0, 0, .9, 10, "dart", .7);
      break;
    case "water-bead":
      add(520, 0, 0, .9, 12, "dart", .8, "slow");
      break;
    case "pebble-toss":
      add(580, 0, 0, .9, 14, "meteor", 1.2);
      break;
    case "kindle":
      add(440, 0, 0, .9, 11, "dart", .8);
      break;
    case "air-needle":
      add(600, 0, 0, 1.1, 18, "dart");
      break;
    case "razor-crescent":
      for (let i = 0; i < 3; i++)
        add(700 + i * 140, (i - 1) * 3, 0, 2.2, 14, "blade", 2, undefined, 1.2);
      break;
    case "vacuum-coil":
      for (let i = 0; i < 4; i++)
        add(650 + i * 350, 0, 0, 5.5, 9, "vortex", 6, undefined, -1.1);
      add(2200, 0, 0, 6, 28, "nova", 3);
      break;
    case "thunder-lance":
      for (let i = 0; i < 5; i++)
        add(850 + i * 110, 0, -4 + i * 2, 1.7, 26, "beam", 3, "stagger");
      break;
    case "skybreaker":
      add(1500, 0, 0, 4, 45, "vortex", 15);
      for (let i = 0; i < 3; i++)
        add(1800 + i * 300, 0, 0, 6 + i * 2, 18, "nova", 5, "stagger", 1.8);
      break;
    case "waterjet":
      for (let i = 0; i < 2; i++)
        add(600 + i * 120, 0, 0, 1.2, 11, "beam", 1, "slow");
      break;
    case "tidal-fan":
      for (let i = 0; i < 5; i++)
        add(730 + i * 35, (i - 2) * 2.5, 0, 1.6, 16, "dart", 3, "slow");
      break;
    case "geyser-chain":
      for (let i = 0; i < 3; i++) {
        add(800 + i * 400, 0, -4 + i * 4, 2.7, 24, "spike", 7, "stagger");
        add(1100 + i * 400, 0, -4 + i * 4, 2.7, 12, "nova", 3, "slow");
      }
      break;
    case "undertow":
      for (let i = 0; i < 3; i++)
        add(800 + i * 550, 0, 0, 7, 12, "vortex", 1.5, "slow", -1.8);
      add(2450, 0, 0, 3.5, 35, "spike", 5, "stagger");
      break;
    case "deluge":
      for (let row = 0; row < 3; row++)
        for (let i = 0; i < 4; i++)
          add(
            1100 + row * 500,
            -5.25 + i * 3.5,
            -4 + row * 4,
            2.8,
            20,
            "wave",
            6,
            "slow",
            1.1,
          );
      break;
    case "flint-shot":
      add(750, 0, 0, 1.2, 24, "meteor", 3);
      break;
    case "faultline":
      for (let i = 0; i < 5; i++)
        add(650 + i * 150, 0, -4 + i * 2, 1.8, 19, "spike", 3, "stagger");
      break;
    case "basalt-jaw":
      for (let i = 0; i < 6; i++)
        add(
          850,
          Math.cos((i * Math.PI) / 3) * 3,
          Math.sin((i * Math.PI) / 3) * 3,
          1.8,
          10,
          "spike",
          4,
          "root",
        );
      add(1550, 0, 0, 3.5, 40, "spike", 6, "root");
      break;
    case "siege-boulder":
      add(1700, 0, 0, 5, 65, "meteor", 13);
      add(2000, 0, 0, 7, 18, "nova", 3, "stagger", 1.2);
      break;
    case "mountainfall":
      add(1300, 0, 0, 3, 50, "spike", 13);
      for (let i = 0; i < 8; i++)
        add(
          1650 + i * 70,
          Math.cos((i * Math.PI) / 4) * 7,
          Math.sin((i * Math.PI) / 4) * 7,
          3,
          32,
          "spike",
          9,
          "stagger",
        );
      add(2500, 0, 0, 10, 22, "nova", 3, "stagger", 1);
      break;
    case "ember-dart":
      add(550, 0, 0, 1.1, 15, "dart");
      for (let i = 0; i < 2; i++)
        add(950 + i * 400, 0, 0, 1.1, 4, "nova", 1, "burn");
      break;
    case "furnace-whip":
      for (let i = 0; i < 6; i++) {
        const a = -1.2 + i * 0.48;
        add(
          600 + i * 100,
          Math.sin(a) * 5,
          Math.cos(a) * 3 - 2,
          1.9,
          13,
          "blade",
          3,
          "burn",
        );
      }
      break;
    case "cinder-mine":
      add(1800, 0, 0, 4.5, 55, "mine", 6, "burn");
      add(2150, 0, 0, 6, 15, "nova", 3, "burn", 1.5);
      break;
    case "phoenix-pass":
      for (let i = 0; i < 5; i++)
        add(800 + i * 150, 0, -4 + i * 2, 3, 21, "wing", 4, "burn");
      for (let i = 0; i < 5; i++)
        add(1800 + i * 130, 0, 4 - i * 2, 2, 10, "dart", 2, "burn");
      break;
    case "starfall":
      for (let i = 0; i < 9; i++)
        add(
          1100 + i * 140,
          ((i % 3) - 1) * 6,
          (Math.floor(i / 3) - 1) * 6,
          3.4,
          30,
          "meteor",
          16,
          "burn",
        );
      add(2700, 0, 0, 9, 70, "meteor", 21, "burn", 1.5);
      break;
  }
  pulses.sort((a, b) => a.at - b.at);
  if (id === "phoenix-pass") {
    for (let i = 0; i < pulses.length; i++) {
      const pulse = pulses[i]!,
        previous = pulses[i - 1];
      pulse.from = previous ? [...previous.point] : [...origin];
      pulse.launchAt = previous?.at ?? 0;
    }
  }
  return pulses;
}

/** Deterministic combat primitive. Callers supply real targets and own their persistence. */
export class ElementalAttacks {
  active: ElementalCast | null = null;
  private serial = 0;
  cast(
    spellId: ElementalSpellId,
    origin: Vec3,
    aim: Vec3,
    now: number,
  ): ElementalCast {
    if (this.active && now < this.active.started + this.duration)
      throw new Error("Wait for the current spell or reset the range.");
    const pulses = planElementalAttack(spellId, origin, aim);
    this.active = {
      id: ++this.serial,
      spellId,
      origin: [...origin],
      aim: [...aim],
      started: now,
      pulses,
      resolved: 0,
      damage: 0,
      hits: 0,
    };
    return this.active;
  }
  get duration(): number {
    return (this.active?.pulses.at(-1)?.at ?? 0) + 1100;
  }
  reset(): void {
    this.active = null;
  }
  update(now: number, targets: readonly ElementalTarget[]): void {
    for (const target of targets)
      if (now >= target.statusUntil) target.status = null;
    const cast = this.active;
    if (!cast) return;
    while (
      cast.resolved < cast.pulses.length &&
      now - cast.started >= cast.pulses[cast.resolved]!.at
    ) {
      const pulse = cast.pulses[cast.resolved++]!;
      for (const target of targets) {
        if (target.health <= 0) continue;
        const dx = target.position[0] - pulse.point[0],
          dz = target.position[2] - pulse.point[2];
        const distance = Math.hypot(dx, dz);
        if (distance > pulse.radius) continue;
        const damage = Math.min(target.health, pulse.damage);
        target.health -= damage;
        target.hits++;
        cast.hits++;
        cast.damage += damage;
        if (pulse.status) {
          target.status = pulse.status;
          target.statusUntil =
            cast.started +
            pulse.at +
            (pulse.status === "root"
              ? 1800
              : pulse.status === "freeze"
                ? 1400
                : 1000);
        }
        if (
          pulse.force &&
          (distance > 0.001 || pulse.force > 0) &&
          target.status !== "freeze" &&
          target.status !== "root"
        ) {
          const force =
            pulse.force < 0 ? -Math.min(-pulse.force, distance) : pulse.force;
          const fallbackX = cast.aim[0] - cast.origin[0],
            fallbackZ = cast.aim[2] - cast.origin[2];
          const fallbackLength = Math.hypot(fallbackX, fallbackZ) || 1;
          const direction =
            pulse.direction ??
            (distance > 0.001
              ? [dx / distance, dz / distance]
              : [fallbackX / fallbackLength, fallbackZ / fallbackLength]);
          target.position = [
            target.position[0] + direction[0]! * force,
            target.position[1],
            target.position[2] + direction[1]! * force,
          ];
        }
      }
    }
    for (const target of targets)
      if (now >= target.statusUntil) target.status = null;
  }
}
