import { readFile } from "node:fs/promises";
import { CONTENT_COLLECTIONS, parseContentCollection } from "./collections.js";
import { contentPath, writeContentJson } from "./format.js";

// Validate the entire batch before making the first write.
const parsed = await Promise.all(CONTENT_COLLECTIONS.map(async spec => ({ spec,
  value: parseContentCollection(spec, JSON.parse(await readFile(contentPath(spec.file), "utf8"))),
})));
let changed = 0;
for (const { spec, value } of parsed) if (await writeContentJson(spec.file, value)) changed++;
console.log(`Formatted ${parsed.length} collections; ${changed} changed.`);
