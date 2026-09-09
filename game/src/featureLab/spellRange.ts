import type * as THREE from "three";
import type { SpellRangeApi, SpellRangeState, Vec3 } from "../contracts.js";
import {
  ELEMENTAL_SPELLS,
  elementalSpell,
  type ElementalSpellId,
} from "../content/elementalSpells.js";
import {
  ElementalAttacks,
  type ElementalTarget,
} from "../systems/elementalAttacks.js";
import { ElementalSpellVfx } from "../render/elementalSpellVfx.js";
import { TrainingTargets } from "../render/trainingTargets.js";
import "../ui/styles/spellRange.css";

declare global {
  interface Window {
    __spellRange?: SpellRangeApi;
  }
}

export function createSpellRange(deps: {
  parent: THREE.Object3D;
  camera: THREE.Camera;
  ground: (x: number, z: number) => number;
  origin: () => Vec3;
  frame: (aim: Vec3) => void;
  castPose: (rank: number, speed: number) => void;
  castingFocus?: () => Vec3 | undefined;
}): { update(now: number): void } {
  const aim: Vec3 = [20, deps.ground(20, 40), 40];
  const positions: Vec3[] = [];
  for (let row = -1; row <= 1; row++)
    for (let col = -1; col <= 1; col++)
      positions.push([20 + col * 6, aim[1], 40 + row * 6]);
  positions.push([17, aim[1], 40], [23, aim[1], 40]);
  const targets: ElementalTarget[] = positions.map((position, i) => ({
    id: `T${i + 1}`,
    position: [...position],
    health: 1000,
    maxHealth: 1000,
    hits: 0,
    status: null,
    statusUntil: 0,
  }));
  const attacks = new ElementalAttacks();
  const effects = new ElementalSpellVfx(deps.parent, deps.ground, deps.camera);
  const views = new TrainingTargets(deps.parent, targets);
  let selected: ElementalSpellId = "air-needle",
    time = 0,
    last = 0,
    speed = 1,
    repeat = false;
  const panel = document.createElement("section");
  panel.id = "spell-range";
  panel.setAttribute("aria-label", "Elemental spell range");
  panel.innerHTML = `<header><span class="spell-range-kicker">COMBAT LAB · 24 ATTACKS</span><h2>Elemental spell range</h2><p>One basic and five advanced spells per element.</p></header>
    <label>Element<select id="spell-range-element"><option value="all">All elements</option><option value="wind">Air</option><option value="water">Water</option><option value="earth">Earth</option><option value="fire">Fire</option></select></label>
    <label>Spell<select id="spell-range-select"></select></label>
    <div id="spell-range-detail"></div>
    <button id="spell-range-cast" class="spell-range-primary">Reset & cast</button>
    <div class="spell-range-actions"><button id="spell-range-prev">Previous</button><button id="spell-range-next">Next</button></div>
    <div class="spell-range-actions"><button id="spell-range-reset">Reset targets</button><button id="spell-range-frame">Reset view</button></div>
    <div class="spell-range-actions"><label><input id="spell-range-repeat" type="checkbox"> Repeat</label><label><input id="spell-range-slow" type="checkbox"> Slow motion</label></div>
    <label><input id="spell-range-hit-areas" type="checkbox"> Show hit areas</label>
    <output id="spell-range-state" aria-live="polite"></output>
    <div id="spell-range-density" class="spell-range-note"></div>
    <p class="spell-range-note">T5 is the aim point. Each dummy starts at 1,000 HP. Damage, hit areas, pulls and knockback are active. This range bypasses spellbook levels and fuel.</p>
    <a id="spell-range-exit">Back to combat workbench</a>`;
  document.body.append(panel);
  const select = panel.querySelector<HTMLSelectElement>("#spell-range-select")!;
  const filter = panel.querySelector<HTMLSelectElement>(
    "#spell-range-element",
  )!;
  const detail = panel.querySelector<HTMLDivElement>("#spell-range-detail")!;
  const output = panel.querySelector<HTMLOutputElement>("output")!;
  const exit = panel.querySelector<HTMLAnchorElement>("#spell-range-exit")!;
  const url = new URL(location.href);
  url.searchParams.delete("spells");
  exit.href = url.href;
  const list = () =>
    ELEMENTAL_SPELLS.filter(
      (spell) => filter.value === "all" || spell.element === filter.value,
    );
  const describe = (): void => {
    const spell = elementalSpell(selected);
    select.value = selected;
    detail.replaceChildren();
    const tag = document.createElement("div");
    tag.className = "spell-range-tier";
    tag.textContent = `${spell.element === "wind" ? "Air" : spell.element} · ${spell.rank===0?"Basic":`${spell.rank}/5 · ${spell.scale}`}`;
    const title = document.createElement("h3");
    title.textContent = spell.name;
    const description = document.createElement("p");
    description.textContent = spell.description;
    const watch = document.createElement("p");
    watch.className = "spell-range-watch";
    watch.textContent = `Watch: ${spell.watch}`;
    detail.append(tag, title, description, watch);
    panel.dataset["element"] = spell.element;
  };
  const populate = (): void => {
    select.replaceChildren();
    for (const spell of list()) {
      const option = document.createElement("option");
      option.value = spell.id;
      option.textContent = `${spell.rank===0?"Basic":spell.rank} · ${spell.name}`;
      select.append(option);
    }
    if (!list().some((spell) => spell.id === selected))
      selected = list()[0]!.id;
    describe();
  };
  const reset = (): void => {
    attacks.reset();
    repeat = false;
    panel.querySelector<HTMLInputElement>("#spell-range-repeat")!.checked =
      false;
    restoreTargets();
    effects.update(null, time);
  };
  const restoreTargets = (): void => {
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!;
      target.position = [...positions[i]!];
      target.health = target.maxHealth;
      target.hits = 0;
      target.status = null;
      target.statusUntil = 0;
    }
  };
  const cast = (): void => {
    attacks.reset();
    restoreTargets();
    attacks.cast(selected, deps.origin(), aim, time);
    deps.castPose(elementalSpell(selected).rank, speed);
  };
  const getState = (): SpellRangeState => {
    const active = attacks.active;
    return {
      selected,
      casting: !!active && time - active.started < attacks.duration,
      elapsed: active ? time - active.started : 0,
      duration: attacks.duration,
      castId: active?.id ?? 0,
      impacts: active?.resolved ?? 0,
      totalImpacts: active?.pulses.length ?? 0,
      hits: active?.hits ?? 0,
      damage: active?.damage ?? 0,
      instances: effects.instances,
      particleCount: effects.particleCount,
      volumeCount: effects.volumeCount,
      solidCount: effects.solidCount,
      vfxUpdateMs: effects.updateMs,
      droppedParticles: effects.droppedParticles,
      filamentCount: effects.filamentCount,
      droppedFilaments: effects.droppedFilaments,
      bodyCount: effects.bodyCount,
      droppedBodies: effects.droppedBodies,
      speed,
      repeat,
      targets: targets.map(
        ({ id, position, health, maxHealth, hits, status }) => ({
          id,
          position: [...position],
          health,
          maxHealth,
          hits,
          status,
        }),
      ),
    };
  };
  const choose = (id: string): void => {
    const spell = elementalSpell(id);
    reset();
    selected = spell.id;
    if (!list().includes(spell)) filter.value = "all";
    populate();
    frame();
  };
  const frame = (): void => deps.frame(aim);
  select.addEventListener("change", () => choose(select.value));
  filter.addEventListener("change", () => {
    reset();
    populate();
    frame();
  });
  panel.querySelector("#spell-range-cast")!.addEventListener("click", cast);
  panel.querySelector("#spell-range-reset")!.addEventListener("click", reset);
  panel.querySelector("#spell-range-frame")!.addEventListener("click", frame);
  for (const [id, step] of [
    ["prev", -1],
    ["next", 1],
  ] as const)
    panel.querySelector(`#spell-range-${id}`)!.addEventListener("click", () => {
      const spells = list(),
        index = spells.findIndex((spell) => spell.id === selected);
      choose(spells[(index + step + spells.length) % spells.length]!.id);
      cast();
    });
  panel
    .querySelector<HTMLInputElement>("#spell-range-repeat")!
    .addEventListener("change", (event) => {
      repeat = (event.target as HTMLInputElement).checked;
      if (repeat && !getState().casting) cast();
    });
  panel
    .querySelector<HTMLInputElement>("#spell-range-slow")!
    .addEventListener("change", (event) => {
      speed = (event.target as HTMLInputElement).checked ? 0.35 : 1;
    });
  panel
    .querySelector<HTMLInputElement>("#spell-range-hit-areas")!
    .addEventListener("change", (event) =>
      effects.setHitAreasVisible((event.target as HTMLInputElement).checked),
    );
  window.__spellRange = { getState, select: choose, cast, reset, frame };
  populate();
  frame();
  let lastOutput = "";
  let lastDensityUpdate = 0;
  return {
    update(now) {
      if (last) time += Math.min(100, Math.max(0, now - last)) * speed;
      last = now;
      attacks.update(time, targets);
      effects.update(attacks.active, time, targets, deps.castingFocus?.());
      views.update(targets, deps.camera, deps.ground);
      const state = getState();
      if (now - lastDensityUpdate > 100) {
        panel.querySelector("#spell-range-density")!.textContent =
          `${state.particleCount.toLocaleString()} 3D particles · ${state.solidCount} rock fragments`;
        lastDensityUpdate = now;
      }
      const status = `${state.casting ? "Casting" : state.castId ? "Complete" : "Ready"} · ${state.impacts}/${state.totalImpacts} impacts\n${state.hits} target hits · ${state.damage} total damage`;
      if (status !== lastOutput) {
        output.textContent = status;
        lastOutput = status;
      }
      if (
        repeat &&
        attacks.active &&
        time - attacks.active.started > attacks.duration + 500
      )
        cast();
    },
  };
}
