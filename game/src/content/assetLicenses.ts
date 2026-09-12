type AssetPack = { id: string; source: string; license: string; archiveSha256?: string };

/** Fab purchases retain their Standard License, independently of the project's code license. */
export function isFabStandardAssetPack(pack: Pick<AssetPack, 'source' | 'license'>): boolean {
  return pack.license === 'Fab Standard License'
    && /^https:\/\/(?:www\.)?fab\.com\/listings\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(pack.source);
}

const LICENSE_URLS = {
  "CC-BY-3.0": "https://creativecommons.org/licenses/by/3.0/",
  "CC-BY-SA-3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
  // Khronos glTF-Sample-Assets Fox: CC-BY-4.0 rigging/animation and conversion over a CC0 model.
  "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
} as const;

export function isSupportedCcAttributionLicense(license: string): boolean {
  return Object.hasOwn(LICENSE_URLS, license);
}

type CcPack = AssetPack & { name: string; author: string;
  attribution: string;
  licenseUrl: string;
  derivation: string;
  derivativeLicense: string;
};

/** Validate declared provenance, without inferring or changing the upstream grant. */
export function validateCcAssetPack(pack: AssetPack): asserts pack is CcPack {
  if (!isSupportedCcAttributionLicense(pack.license)) throw new Error(`${pack.id}: unsupported attribution license ${pack.license}`);
  const metadata = pack as unknown as Record<string, unknown>;
  for (const field of ["name", "author", "source", "attribution", "derivation", "derivativeLicense"]) {
    if (typeof metadata[field] !== "string" || !(metadata[field] as string).trim()) {
      throw new Error(`${pack.id}: CC attribution pack requires nonempty ${field}`);
    }
  }
  let source: URL;
  try { source = new URL(pack.source); } catch { throw new Error(`${pack.id}: invalid CC source URL`); }
  if (!["https:", "http:"].includes(source.protocol) || !source.hostname || source.username || source.password) {
    throw new Error(`${pack.id}: CC pack requires an HTTP(S) source URL`);
  }
  if (metadata.licenseUrl !== LICENSE_URLS[pack.license as keyof typeof LICENSE_URLS]) {
    throw new Error(`${pack.id}: CC licenseUrl must exactly match its declared license`);
  }
  // These imports retain their upstream license. Other derivative grants need a separate review.
  if (metadata.derivativeLicense !== pack.license) throw new Error(`${pack.id}: derivativeLicense must retain ${pack.license}`);
  if (!/^[0-9a-f]{64}$/.test(pack.archiveSha256 ?? "")) throw new Error(`${pack.id}: CC pack requires a lowercase archive SHA-256 pin`);
}


