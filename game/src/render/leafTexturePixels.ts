import { SRGBToLinear, LinearToSRGB } from "three/src/math/ColorManagement.js";

let associatedColour: Uint8Array | undefined;

function colourTable(): Uint8Array {
  if (!associatedColour) {
    const linear = Float64Array.from({ length: 256 }, (_, i) => SRGBToLinear(i / 255));
    // Quantise only at final sRGB encoding, preserving dark, partly covered texels.
    associatedColour = Uint8Array.from({ length: 65536 }, (_, i) =>
      Math.round(LinearToSRGB(linear[i >> 8]! * (i & 255) / 255) * 255));
  }
  return associatedColour;
}

/** Associate linear colour with coverage before mip generation. Alpha bytes are unchanged. */
export function associateLeafColour(source: Uint8ClampedArray | Uint8Array): Uint8Array<ArrayBuffer> {
  const table = colourTable();
  const output = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i += 4) {
    const alpha = source[i + 3]!;
    output[i] = table[(source[i]! << 8) | alpha]!;
    output[i + 1] = table[(source[i + 1]! << 8) | alpha]!;
    output[i + 2] = table[(source[i + 2]! << 8) | alpha]!;
    output[i + 3] = alpha;
  }
  return output;
}

export interface PreparedLeafPixels {
  width: number;
  height: number;
  hash: string;
  pixels: Uint8Array<ArrayBuffer>;
}

/** Runs in the foliage worker; exported for deterministic colour and fingerprint tests. */
export function prepareLeafPixels(source: Uint8ClampedArray | Uint8Array, width: number, height: number): PreparedLeafPixels {
  if (width <= 0 || height <= 0 || source.length !== width * height * 4) {
    throw new Error("Leaf texture has invalid pixel dimensions");
  }
  let hashA = 2166136261, hashB = 5381;
  for (let i = 0; i < source.length; i++) {
    hashA = Math.imul(hashA ^ source[i]!, 16777619);
    hashB = Math.imul(hashB, 33) ^ source[i]!;
  }
  return { width, height, hash: `${width},${height},${hashA >>> 0},${hashB >>> 0}`, pixels: associateLeafColour(source) };
}
