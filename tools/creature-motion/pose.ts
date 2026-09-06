import type { Animation, Document, Node } from "@gltf-transform/core";
import { Quaternion } from "three";

export type Pose = { node: Node; t: ReturnType<Node["getTranslation"]>; r: ReturnType<Node["getRotation"]>; s: ReturnType<Node["getScale"]> };

export function duration(clip: Animation): number {
  return Math.max(0, ...clip.listSamplers().map(s => {
    const array = s.getInput()!.getArray()!;
    return Number(array[array.length - 1]);
  }));
}

export function storedPose(doc: Document): Pose[] {
  return doc.getRoot().listNodes().map(node => ({ node, t: node.getTranslation(), r: node.getRotation(), s: node.getScale() }));
}

export function restorePose(pose: Pose[]): void {
  for (const p of pose) p.node.setTranslation(p.t).setRotation(p.r).setScale(p.s);
}

export function sample(sampler: ReturnType<Animation["listSamplers"]>[number], seconds: number): number[] {
  const times = sampler.getInput()!.getArray()!;
  const output = sampler.getOutput()!;
  const values = output.getArray()!;
  const width = output.getElementSize();
  // Dense contact bakes contain thousands of keys. A linear scan for every
  // joint/vertex audit sample made this offline gate quadratic in key count.
  let right = 1, high = times.length;
  while (right < high) {
    const middle = (right + high) >>> 1;
    if (Number(times[middle]) < seconds) right = middle + 1;
    else high = middle;
  }
  right = Math.min(right, times.length - 1);
  const left = Math.max(0, right - 1);
  const a = Array.from(values.slice(left * width, (left + 1) * width), Number);
  const b = Array.from(values.slice(right * width, (right + 1) * width), Number);
  if (sampler.getInterpolation() === "STEP" || left === right) return a;
  if (sampler.getInterpolation() === "CUBICSPLINE") throw new Error("Unexpected cubic source clip; add tangent-aware sampling before rebuilding it.");
  const alpha = Math.max(0, Math.min(1, (seconds - Number(times[left])) / (Number(times[right]) - Number(times[left]))));
  if (width === 4) return new Quaternion().fromArray(a).slerp(new Quaternion().fromArray(b), alpha).toArray();
  return a.map((v, i) => v + (b[i]! - v) * alpha);
}

export function applyClip(clip: Animation, seconds: number): void {
  for (const channel of clip.listChannels()) {
    const node = channel.getTargetNode()!;
    const values = sample(channel.getSampler()!, seconds);
    switch (channel.getTargetPath()) {
      case "translation": node.setTranslation(values as [number, number, number]); break;
      case "rotation": node.setRotation(values as [number, number, number, number]); break;
      case "scale": node.setScale(values as [number, number, number]); break;
    }
  }
}


export function addChannel(doc: Document, clip: Animation, node: Node, target: "translation" | "rotation" | "scale", times: number[], values: number[]): void {
  const buffer = doc.getRoot().listBuffers()[0]!;
  const input = doc.createAccessor().setType("SCALAR").setArray(new Float32Array(times)).setBuffer(buffer);
  const output = doc.createAccessor().setType(target === "rotation" ? "VEC4" : "VEC3").setArray(new Float32Array(values)).setBuffer(buffer);
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation("LINEAR");
  const channel = doc.createAnimationChannel().setTargetNode(node).setTargetPath(target).setSampler(sampler);
  clip.addSampler(sampler).addChannel(channel);
}

export function removeClip(doc: Document, name: string): void {
  const clip = doc.getRoot().listAnimations().find(c => c.getName() === name);
  if (!clip) return;
  const samplers = clip.listSamplers();
  for (const c of clip.listChannels()) c.dispose();
  clip.dispose();
  for (const s of samplers) {
    const input = s.getInput();
    const output = s.getOutput();
    s.dispose();
    for (const accessor of [input, output]) {
      if (accessor && accessor.listParents().every(p => p.propertyType === "Root")) accessor.dispose();
    }
  }
}

export function curve(phases: number[], values: number[], phase: number): number {
  let index = 1;
  while (index < phases.length - 1 && phases[index]! < phase) index++;
  const a = phases[index - 1]!;
  const b = phases[index]!;
  const t = Math.max(0, Math.min(1, (phase - a) / (b - a)));
  const smooth = t * t * (3 - 2 * t);
  return values[index - 1]! + (values[index]! - values[index - 1]!) * smooth;
}
