import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface ItemModelSourceDependency {
  /** Repository-relative path with forward slashes. */
  path: string;
  sha256: string;
}

export interface ItemModelSourceProvenance {
  usesCore: boolean;
  authorSha256: string;
  sourceSha256: string;
  dependencies: ItemModelSourceDependency[];
}

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const portable = (file: string): string => file.split(path.sep).join("/");
const inside = (directory: string, file: string): boolean => {
  const relative = path.relative(directory, file);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

/** Read literal import specifiers without treating comments or other strings as imports. */
function imports(file: string, source: string): string[] {
  const result = new Set<string>();
  const tokens = source.match(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g) ?? [];
  const meaningful = tokens.filter(token => !token.startsWith("//") && !token.startsWith("/*"));
  for (let index = 0; index < meaningful.length; index++) {
    const token = meaningful[index]!;
    if (!/^["'`]/.test(token)) continue;
    const previous = meaningful[index - 1];
    const call = previous === "(" && ["import", "require"].includes(meaningful[index - 2] ?? "");
    if (previous !== "from" && previous !== "import" && !call) continue;
    const specifier = token.slice(1, -1);
    if (specifier.includes("${")) throw new Error(`Computed item-model import cannot be fingerprinted: ${file}`);
    if (specifier.includes("\\")) throw new Error(`Escaped item-model import cannot be fingerprinted: ${file}`);
    result.add(specifier);
  }
  return [...result];
}

async function requiredBytes(file: string): Promise<Buffer> {
  try { return await readFile(file); }
  catch (cause) { throw new Error(`Cannot fingerprint required item-model source dependency: ${file}`, { cause }); }
}

async function resolveModule(file: string): Promise<string> {
  const extension = path.extname(file);
  const candidates = extension === ".js" ? [file.slice(0, -3) + ".ts", file]
    : extension ? [file] : [file + ".ts", file + ".json", path.join(file, "index.ts")];
  for (const candidate of candidates) {
    try { if ((await stat(candidate)).isFile()) return candidate; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  throw new Error(`Cannot resolve required item-model core import: ${file}`);
}

/**
 * Legacy authors retain SHA-256(author bytes). Shared-core authors use a versioned,
 * sorted content manifest, so shared geometry, fit, texture, and native-body edits
 * invalidate candidates without requiring a change to their author wrappers.
 * No cache is retained between calls: review and promotion must read current bytes.
 */
export async function itemModelSourceProvenance(
  authorPath: string,
  repoRoot: string = process.cwd(),
): Promise<ItemModelSourceProvenance> {
  const root = path.resolve(repoRoot);
  const authorFile = path.resolve(root, authorPath);
  const core = path.join(root, "tools/item-models/core");
  const authorBytes = await requiredBytes(authorFile);
  const authorSha256 = sha256(authorBytes);
  const coreImports = imports(authorFile, authorBytes.toString("utf8"))
    .filter(specifier => specifier.startsWith("."))
    .map(specifier => path.resolve(path.dirname(authorFile), specifier))
    .filter(file => inside(core, file));
  if (!coreImports.length) return { usesCore: false, authorSha256, sourceSha256: authorSha256, dependencies: [] };
  if (!inside(root, authorFile)) throw new Error(`Item-model author must be within the repository: ${authorFile}`);

  const files = new Map<string, Buffer>();
  const add = async (file: string): Promise<Buffer> => {
    if (!inside(root, file)) throw new Error(`Item-model dependency must be within the repository: ${file}`);
    const existing = files.get(file);
    if (existing) return existing;
    const bytes = await requiredBytes(file);
    files.set(file, bytes);
    return bytes;
  };
  const pending = [
    ...await Promise.all(coreImports.map(resolveModule)),
    path.join(core, "materials.ts"),
    path.join(core, "contracts.ts"),
    path.join(core, "body-profile.json"),
    path.join(root, "tools/item-models/skin.ts"),
    path.join(root, "tools/item-models/build.ts"),
    path.join(root, "tools/item-models/contracts.ts"),
  ];
  const visited = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const bytes = await add(file);
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    for (const specifier of imports(file, bytes.toString("utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const imported = path.resolve(path.dirname(file), specifier);
      if (inside(core, imported)) pending.push(await resolveModule(imported));
    }
  }

  const profileFile = path.join(core, "body-profile.json");
  const profile: unknown = JSON.parse((await add(profileFile)).toString("utf8"));
  if (!profile || typeof profile !== "object" || !("source" in profile)
    || typeof profile.source !== "string" || !profile.source.trim() || path.isAbsolute(profile.source)) {
    throw new Error(`Body profile requires a repository-relative native source path: ${profileFile}`);
  }
  // Hash the actual body too; the profile's recorded sourceSha256 may itself be stale.
  await add(path.resolve(root, profile.source));

  const textureDirectory = path.join(root, "art/item-models/textures");
  const textures = (await readdir(textureDirectory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && /-albedo\.png$/i.test(entry.name));
  if (!textures.length) throw new Error(`No required armor albedo PNGs in ${textureDirectory}`);
  await Promise.all(textures.map(entry => add(path.join(textureDirectory, entry.name))));

  const dependencies = [...files].map(([file, bytes]) => ({ path: portable(path.relative(root, file)), sha256: sha256(bytes) }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const sourceSha256 = sha256(JSON.stringify({ version: 1, authorSha256, dependencies }));
  return { usesCore: true, authorSha256, sourceSha256, dependencies };
}

export async function itemModelSourceSha256(authorPath: string, repoRoot?: string): Promise<string> {
  return (await itemModelSourceProvenance(authorPath, repoRoot)).sourceSha256;
}
