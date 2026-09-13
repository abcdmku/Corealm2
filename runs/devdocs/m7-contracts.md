# M7 asset workflow contracts

Status: implementation proposal for root review. This investigation made no asset, manifest, metadata, or production-code changes. The only written file is this plan.

## Current code and gaps

- `tools/lib/promote-assets.ts` and `tools/lib/glb-inspect.ts` do not exist. The extraction sources are `tools/promote-finish-assets.ts` and `tools/inspect-glb.ts`.
- `tools/promote-finish-assets.ts` is a 213-line CLI with top-level argument parsing, preflight, printed plan, and apply. Its selection is considered acceptance today. It has no metadata status gate. Extracting it alone will not implement approval.
- `tools/content/meta.ts` already defines strict `CandidateSchema`, `MetaRecordSchema`, keyed metadata files, SHA revisions, file locks, and history. The schema lives in tooling, not `game/src/content/schema/meta.ts`. Unknown fields are rejected. Its read/write helpers currently use the repository-global content root; the API's metadata handler separately implements injectable roots.
- `devdocs/server/handlers/meta.ts` intentionally allows only draft/candidate/rejected authoring status. It cannot approve, promote, upload, or replace candidate arrays. Preserve that separation and add review operations through the new review handler.
- `devdocs/server/lib/body.ts` only reads JSON, capped at 1 MiB. GLB upload needs a binary/multipart reader. The largest current manifest entry is 39,805,716 bytes; a proposed 128 MiB per-file cap covers the current inventory without base64 expansion.
- The viewer supports `mode: 'glb'` with a URL, but outfit mode only takes item IDs. A loose candidate preview is therefore available; candidate armor fitted to both production bodies needs an explicit viewer override map before sign-off is possible.
- Current inventory: 804 manifest assets, 66 packs, 207 `acceptance` objects with eight distinct sets of top-level keys. The icon registry has 398 accepted entries. The model registry has 164 visual-approved entries, 160 marked promoted. These are observations of this checkout, not migration success counts.

## Storage and authority

Keep candidate status in exactly one owning metadata record. GLBs submitted for an existing set belong to `equipmentSets.meta.json[setId]`; held items belong to `items.meta.json[itemId]`; creature candidates belong to their registered creature entity; a standalone manifest asset belongs to `assets.meta.json[assetId]`. Icon candidates belong to `icons.meta.json[itemId]`. The root adds asset/icon target lookup alongside registered content lookups, because these two collections are not ordinary authored JSON collections.

Add a strict `art/candidates/catalog.json` version-1 catalog. It owns immutable submission facts and the target locator, not approval state:

```ts
type CandidateTarget = {
  collection: string; recordId: string;
  itemId?: string; // Member item for a set-owned candidate.
  slot?: string; body?: 'male' | 'female' | 'creature';
};
type CandidateSubmission = {
  candidateId: string; kind: 'glb' | 'icon'; target: CandidateTarget;
  file: string; sha256: string; bytes: number;
  inspection: GlbInspection | IconInspection;
  manifestEntry?: AssetEntryProposal;
  packs?: AssetPackProposal[];
  sharedTextures?: SharedTexturePin[];
  sourcePins?: { file: string; sha256: string; role: 'generator' | 'reference' | 'evidence' }[];
};
```

The owning metadata candidate repeats the existing schema's file/hash/inspection summary for UI reads. Every write verifies that these fields equal its catalog entry. Catalog lookup supplies the owning metadata location; HTTP clients never choose a metadata file or served destination by filesystem path. Candidate IDs are opaque server-generated IDs, globally unique. Re-submitting identical bytes to the same target and descriptor returns the existing candidate instead of creating a second approval opportunity. Changed bytes or a changed descriptor create a new candidate ID.

Store immutable bytes at `art/candidates/<category>/<target-key>/<sha256>.glb` or `.png`, using a server-generated safe target key. Source bytes stay outside `game/public`. Keep uploaded byte hashes separate from icon master/game derivative hashes. No candidate status or review data goes into the runtime manifest or player bundle.

`AssetEntryProposal` needs a strict tooling schema for the runtime fields in `game/src/render/assets.ts`: identity, destination, pack, category, `is`, tags, bounds, names, and optional item attachment/ground/gait fields. Do not allow arbitrary manifest spreads. Preserve existing manifest fields during extraction compatibility; new submissions accept only explicitly supported runtime fields. `AssetPackProposal` must enumerate the additional attribution/source-pin fields consumed by license validation, which the minimal runtime `AssetPack` type does not describe.

## Upload and read API

Use the PRD paths. Handler functions accept injectable repository/content/art/public roots plus server-owned actor and clock. The transport checks the existing loopback/origin guard before reading any mutation body.

| Route | Request | Result |
| --- | --- | --- |
| `PUT /__devdocs/assets/upload` | `multipart/form-data`: exactly one UTF-8 `submission` JSON field and one `file` field. JSON is `{ revision, target, kind, manifestEntry?, packs?, sourcePins? }`. `revision` is the current owning metadata file revision; absent file revision hashes `{}\n`. | 201 `{ candidate, target, revision, catalogRevision, diagnostics }`; 200 for an identical existing submission. All hashes, byte lengths, names, bounds, timestamps and authors are server-computed. |
| `GET /__devdocs/assets/candidates` | Optional validated filters `collection`, `recordId`, `status`, `kind`. | Entries joined with their sole metadata authority, including target, revision, inspection, current live counterpart and candidate-file URL. |
| `GET /__devdocs/assets/candidate-file/:candidateId` | Opaque registered ID only. | Exact registered bytes, appropriate content type, `nosniff`, digest ETag. Resolve and rehash the file before serving; never accept arbitrary paths or URLs. |

Proposed limits: 128 MiB for GLB, 32 MiB for PNG, and 64 KiB for submission JSON. Reject multiple files, undeclared fields, malformed JSON, inconsistent MIME/magic, empty uploads, and aborted/truncated bodies. Stream to a private sibling temporary file; remove it on abort, failed inspection, or stale revision. Existing binary read response support can carry `Uint8Array` from the plugin; JSON handler return types should not be cast to disguise binary responses.

Interactive GLB uploads initially require embedded buffers/images. Return a clear 422 listing external dependencies. This is an explicit first-round boundary, not a parser that silently drops textures. The CLI submission adapter must support the existing pinned shared-texture catalogs before legacy promotion commands are removed. It must not rewrite or optimize approved GLB bytes.

Upload validates target IDs, set membership and slot/body consistency against current disk content under the common content lock. For an existing asset, infer the destination from the registered manifest entry; a new asset requires an explicit valid manifest proposal in the review form. No gameplay ID, spawn identity, item tier, or asset binding changes occur during submission.

## Review and promotion API

Here `:id` is the candidate ID. All bodies are strict schemas. Return 403 for non-loopback requests, 404 for unknown IDs, 409 for stale revisions or changed pinned bytes, 413 for upload size, 415 for unsupported media, and 422 for state, schema, target, license or evidence errors. Server history supplies actor and time; clients cannot set status timestamps or authors directly.

```ts
type CandidatePin = { candidateId: string; sha256: string };
type ReviewSelection = {
  revision: string; // Owning metadata file.
  manifestRevision: string;
  selection: CandidatePin[];
};
// POST assets/:id/approve
type Approval = ReviewSelection & (
  | { operation: 'signoff'; body: 'male' | 'female'; note?: string }
  | { operation: 'approve'; note?: string }
);
// POST assets/:id/reject
type Rejection = ReviewSelection & { reason: string };
// POST assets/:id/promote
type Promotion = ReviewSelection & (
  | { operation: 'preview' }
  | { operation: 'apply'; planRevision: string }
);
```

For a normal item/creature/icon, `selection` contains one candidate. For armor it contains a complete proposed set revision, all owned by the same set. `:id` must belong to that selection. A set revision may include unchanged live pieces and body-specific fallback mappings, but those receiving assets must also be pinned in its server-computed review digest. Expected pieces come from actual set membership, including bareheaded sets; do not require five GLBs when the set has four members. Preserve per-piece notes.

Add an optional strict review object to the owning metadata record: `{ digest, selection, signoffs: { male?, female? } }`, where each sign-off is `{ digest, at, by }`. Compute the digest from candidate pins, descriptor/provenance pins, set membership, each body's resolved receiving parts, base rigs, animation libraries, and the relevant binding-source revision. Existing `approvals.male/female` can remain display fields, but they are not sufficient authorization. A changed candidate, member mapping, reviewed dependency or descriptor invalidates the digest and both sign-offs.

The first sign-off does not approve a set. Final `approve` requires both current-digest sign-offs. Single-candidate approval records the exact byte/descriptor digest. The ordinary metadata PATCH route cannot fabricate these fields. The UI's explicit Approve button is the approval action already requested by the user; add no separate conversational permission prompt or agent approval shortcut.

State transitions: upload creates candidate; candidate can become approved or rejected; approved can become live through promotion, or rejected before publication. Rejected candidates require a new explicit review before approval. Rejecting a live entry is not an unpublish operation; retain its live record and allow a replacement candidate. UI rejection requires a nonblank reason. Agent CLI can submit, claim requests and reply, but cannot grant approvals or close requests.

Parent `MetaRecord.status` must not demote a still-live asset when a replacement candidate is uploaded. Candidate status controls the queue and promotion gate; a record with served live content remains live while its pending candidate is reviewed. Records without live content reflect the selected active submission. Resolve this once in shared workflow functions, rather than duplicating aggregate status logic in handlers.

Promotion preview runs the same plan builder as the CLI and returns `{ plan, planRevision, revisions, diagnostics }`. Apply reruns preflight and compares the complete plan digest under locks; it does not accept client manifest patches, copy paths, license verdicts, or status changes. Approval is necessary but byte, license, identity and stale-dependency checks still run on every promotion.

## Promotion extraction and retained invariants

First extract `planPromotion(context, selection)` and `applyPromotion(context, plan)` from the existing CLI. Separate `formatLegacyPromotionPlan(plan, apply)` so the old CLI's dry-run JSON stays byte-identical for a fixed fixture: key order, indentation, catalogue/manifest hashes, asset order, absolute source/destination paths, old hashes, runtime gait fields, shared texture actions, packs and evidence text. The new API uses structured approval evidence; it must not carry the legacy statement that selection itself grants acceptance.

Preserve these existing checks from `tools/promote-finish-assets.ts`:

1. Nonempty unique selection; exactly one catalog entry per selected ID; source staging outside served assets.
2. Lexical containment plus `realpath` containment for source and destination, including existing destination and nearest existing parent. `resolveInside` alone is lexical and does not replace the symlink checks. Check final absolute paths before recursive cleanup or rollback deletion.
3. Required runtime fields, destination `models/*.glb`, no destination shared with another asset or selected update, pinned candidate byte count and lowercase SHA verification.
4. GLB header/length/JSON checks and animation/material name agreement. The inspector strengthens structural validation but does not change measured candidate bytes.
5. External URI decoding and containment; reject absolute/control/backslash/query/fragment/scheme paths. Pinned shared images require content-addressed `textures/imported/<sha>.png`, PNG magic, matching MIME, length/hash/path, one declaration, and identical existing bytes. An unlisted dependency is allowed only when the existing staged/served bytes are identical. Do not expand this into unrestricted external buffer writes.
6. Complete declared pack identity, author, source and license. Preserve original-generator SHA pins and the named ground-ore DEXSOFT derivative's upstream asset/pack/source/hash plus generator checks. A local generator never changes an upstream license.
7. Recheck manifest bytes and each destination's previous SHA before writing. Back up original manifest and overwritten files. Copy shared textures without overwriting conflicting content; replace GLBs atomically; upsert selected asset/pack rows in place; preserve unrelated manifest order and fields.

License routing comes from `game/src/content/assetLicenses.ts`: call `validateCcAssetPack` for supported attribution licenses, keeping exact license URL, nonempty attribution/derivation metadata, matching derivative license and lowercase archive pin. CC0 keeps its source URL/archive pin checks; Unity keeps its explicit source/license. Add the existing `isFabStandardAssetPack` and `isUserSuppliedAssetPack` branches required by the PRD. The latter authorizes exactly one named medieval-bridge attachment and archive digest, not arbitrary uploads without licenses. Unknown provenance can be staged for review but cannot pass promotion. Do not infer legal grants from prose or filenames.

Also preserve the stronger item-model checks when removing `tools/item-models/promote.ts` and `record-review.ts`: no outstanding `revisionRequired`; exact reviewed GLB/source/reference hashes; matching runtime evidence for equipped/held/tool models; and review evidence tied to the same bytes. Current evidence checks include passing asset entries and held/tool/rod/attachment or layer observations. Preserve explicit limitations when importing them. Do not turn a model's boolean `promoted` into fresh approval for changed bytes. Minor jewelry still needs no dedicated model; its consolidated item IDs must stay icon-only.

The old manifest-last commit has no fallible writes after the manifest. M7 adds metadata, so it needs a broader transaction. Proposed lock order is root `.collection-write`, asset workflow lock, candidate catalog, owning metadata files, manifest, then served destinations in deterministic order. Recheck all target/content/dependency pins after locks. Stage all bytes first; retain original bytes/absence for every destination, manifest and metadata file; rollback every attempted write on error. Mark live only in that transaction. Keep recoverable backups and a small transaction journal until completion so a restart can diagnose/recover interrupted publication. A sequence of atomic file renames is not a crash-atomic multi-file commit.

## GLB inspection

Extract the chunk scanner into `tools/lib/glb-inspect.ts`; retain the existing CLI output adapter. Validate version 2, exact declared length, first and unique JSON chunk, aligned/bounded chunks, no unexplained trailing bytes, and valid JSON root. Return SHA, bytes, version, chunk summary, animation/material names and durations, extension/dependency list, and measured base/size. Keep raw names separate from display fallback labels; the old inspection CLI fabricates labels for unnamed entries while promotion compares empty raw names.

Use the installed `@gltf-transform/core` NodeIO and `@gltf-transform/functions` `getBounds` path already used by `tools/build-assets.ts` to measure the selected/default scene with node transforms. Register supported extensions as that builder does. Do not import the builder, whose top-level work is unrelated. Disable implicit network/file fetching: resolve only already-validated staged resources. Report unsupported required compression/extensions as diagnostics; do not guess bounds from unchecked accessor minima. Static bounds are bind/rest bounds, not an animated clearance claim. Animation-only GLBs have no mesh bounds and need an explicit category-specific result instead of fake zero measurements.

## Legacy import without invented approval

Implement `planLegacyApprovalImport` as a deterministic read-only adapter, then `--apply` as the root-run metadata writer after the report is reviewed. The import must be idempotent, preserve existing notes/requests/history, and never overwrite newer app decisions. Store source file/hash/record locator in `sourceRefs` and history. Preserve raw legacy JSON strings plus source hashes in a strict dev-only `legacy-approval-import.json` evidence artifact before deleting source files. Unknown shapes, missing files, mismatched hashes and unmatched/retired identities go into the report with no invented accepted state.

| Legacy source | Mapping and restrictions |
| --- | --- |
| Manifest `acceptance` | Adapt the eight observed shapes explicitly. `assetAudit` or `exported` alone is not approval. `labAccepted:true` can establish legacy approval only for the matching entry/bytes; `worldIntegrated:true` plus verified served bytes can establish legacy live state. A served manifest row without acceptance is inventory evidence, not visual acceptance. Keep original false flags and limits in source history. |
| Icon registry v1 | `accepted` maps to approved source artwork after source hash/provenance verification; `pending` maps to candidate. Claim live only after verifying the corresponding published derivatives against the source pipeline. Registry source hashes do not equal derivative image hashes. Keep prompt, generator and source lookup. |
| Model registry v1 | `visual-approved` maps to approval of its exact GLB/source/reference pins; `promoted:true` plus matching current destination establishes live. Respect revision-required state. Preserve review/runtime evidence and source snapshots. Retired item IDs go to the report or existing asset metadata, never new gameplay items. |
| `runs/aurora/acceptance.json` | Verify per-item byte pins and productionPromoted evidence. Its limitation explicitly says native male fit with other bodies using fallback. Preserve that scope; do not synthesize female approval. |
| `runs/tier50-70/acceptance.json` | Preserve `productionPromoted:true`, `exactReferenceAccepted:false`, per-set pins and male-only/fallback limitations. Current status text is descriptive, not a generic approval enum. |
| Equipment retexture acceptance/promotion | Join exact asset hashes and content-addressed texture hashes. `rootAccepted` and `productionEnabled`/served correspondence apply only to the documented revision. Male visual evidence plus separately verified female mappings does not imply both-body visual sign-off. The ornate R2 rejection of its earlier round remains history. |
| Rebuild catalogs/audits and item-model catalog-status | Inventory hints until tied to explicit evidence and matching bytes. `candidate-unaccepted` stays candidate. `existing-model` is not approval. Explicit promoted/approved claims must be reconciled with stronger byte-pinned sources. |

For existing historically live armor, import verified live status and its actual limited approval scope without relabeling it as a newly dual-approved set. The new both-body gate applies to subsequent candidate approval. UI must show the missing historical body sign-off. Importing evidence does not invoke approve/promote endpoints or alter any runtime bytes.

## Icons and retirement order

Make `icons.meta.json[itemId]` the sole approval authority. Registry v2 keeps `source`, `sha256`, `prompt`, `generator`, and `sourceLookup`; remove `status` and `review` only after their migration. `readItemIconArtRegistry` accepts v1 and v2 during transition, but publication reads metadata even for v1 so old accepted strings cannot bypass the new gate.

Before any publishing write in `generateItemIcons`, validate the entire selection's approved/live source SHA against metadata. Staging via `--out` remains allowed for candidates. Preserve unknown-ID/source checks, exact generated source hash, real alpha and visible-art thresholds, trim/contain framing, 256 master and 48 game derivative validation. Generate both outputs first, publish atomically with rollback, and mark the icon candidate live only after both files succeed. A change in source SHA invalidates approval. Remove `--accept` from `tools/fab-armor/icons.ts`; that tool submits candidates and stages derivatives, never grants approval.

Update `tests/item-icon-art.test.ts`, `tests/item-icon-generator.test.ts`, `tests/universal-jewellery-presentation.test.ts`, and the icon registry use in `tools/validate-game-content.ts`. Update `tests/biome-population.test.ts` to metadata evidence without losing its existing gameplay/identity assertions. Keep the jewelry test's 28 distinct prompted sources and absence of dedicated models.

Keep legacy promoters available through extraction/parity work. Remove them only after every used catalog flavor has a tested submit adapter and the new path covers its dependencies. Remove the local asset-review server and `characterRig.ts` reviewStaged bypass only after candidate outfit rendering works through viewer-local overrides; do not remove normal accepted armor/fallback selection. Inventory all package commands, imports and source-text tests before deletion. PRD M8 archival work stays separate.

## Ownership and implementation order

These are proposed future work packets, not concurrent assignments made by this investigation. The root freezes shared schemas/types and integrates each round. No two packets edit the same file.

| Packet | Exclusive files | Dependencies and proof |
| --- | --- | --- |
| Root contracts | `devdocs/shared/assets.ts` new; `tools/content/meta.ts`; `tools/content/asset-catalog.ts` new; `devdocs/server/plugin.ts`; `devdocs/server/lib/body.ts`; `package.json` | Freeze descriptor, target, review digest, binary transport and injectable storage context. Preserve existing metadata/request behavior and isolation. |
| GLB inspection | `tools/lib/glb-inspect.ts` new; `tools/inspect-glb.ts`; `tests/glb-inspect.test.ts` new | Pure inspection with real valid/invalid byte fixtures, transformed bounds, unnamed materials, external URI refusal and animation-only input. |
| Promotion extraction | `tools/lib/promote-assets.ts` new; `tools/promote-finish-assets.ts`; `tests/promote-assets-lib.test.ts` new | Existing dry-run output parity before changing CLI behavior. SHA/path/dependency/license/stale/rollback tests. Root owns any `assetLicenses.ts` policy changes. |
| Workflow and API | `tools/content/asset-workflow.ts` new; `tools/content/submit.ts` new; `tools/content/promote.ts` new; `devdocs/server/handlers/upload.ts` and `review.ts` new; `tests/content-promote.test.ts`, `tests/devdocs-upload.test.ts`, `tests/devdocs-asset-review.test.ts` new | Frozen root contracts plus inspection/promotion library. Temp roots only; SHA-bound approvals, dual-body gate, stale revisions, catalog/meta transaction failure, no premature live state. |
| UI | `devdocs/src/pages/Assets.tsx` new; `devdocs/src/assets/CandidateReview.tsx` new; `devdocs/src/viewer/AssetViewer.tsx`, `ViewerCore.ts`, `armorSet.ts`, `types.ts`; `devdocs/src/api/assets.ts` new | Frozen API and viewer override contract. Root integrates navigation. Prove uploaded bytes load, clips advance, both bodies use selected candidates, comparison shows current live counterpart and rejection reason persists. |
| Legacy migration | `tools/content/import-legacy-approvals.ts` new; `tools/content/legacy-approvals.ts` new; `tests/content-legacy-approvals.test.ts` new | Snapshot and adapter tests for each observed shape, pinned conflicts, partial body evidence, retired IDs, rerun idempotence. Root alone runs apply and owns resulting metadata/evidence artifact. |
| Icon migration | `tools/lib/item-icon-art.ts`; `tools/generate-item-icons.ts`; `tools/fab-armor/icons.ts`; `tests/item-icon-art.test.ts`; `tests/item-icon-generator.test.ts`; `tests/universal-jewellery-presentation.test.ts` | Legacy icon status import must precede registry-v2 conversion. Root owns resulting registry JSON and `validate-game-content.ts` integration. |
| Root removal/acceptance | Legacy deletion list from PRD M7; `tests/biome-population.test.ts`; affected appearance tests; `game/src/render/characterRig.ts`; docs and integration files | Delete only after replacement coverage and exact-byte dry-run compatibility are proven. Root runs combined typecheck/build/content/browser gates and commits. |

Recommended sequence: contracts and extraction, then singleton GLB submission/review/promotion in temp roots, then set viewer and digest-bound dual-body review, then pinned external dependency adapters and icons, then legacy import, then tool removal. This completes M7 in reviewable rounds without coupling a first upload implementation to all historical catalog formats at once.

Acceptance must include real Chromium viewer state and screenshots for candidate/live comparison and both-body armor review. Promotion integrity remains testable with tiny GLB/PNG fixtures and injected write failures; source review or a build alone does not prove appearance. Run no real asset promotion as part of a unit test.
