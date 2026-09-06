import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface StructureReviewInput {
  path: string;
  sha256: string;
  kind?: "manifest-entry" | "surface-profile";
  id?: string;
}
export function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function structureInputHash(input: Omit<StructureReviewInput, "sha256">): string {
  const bytes = readFileSync(input.path);
  if (!input.kind) return createHash("sha256").update(bytes).digest("hex");
  const data = JSON.parse(bytes.toString("utf8"));
  const selected = input.kind === "manifest-entry"
    ? data.assets.find((entry: any) => entry.id === input.id)
    : {version:data.version, profile:data.surfaces[input.id!]};
  if (selected === undefined || (input.kind === "surface-profile" && selected.profile === undefined)) {
    throw new Error(`Missing ${input.kind} ${input.id} in ${input.path}`);
  }
  return createHash("sha256").update(stableJson(selected)).digest("hex");
}
