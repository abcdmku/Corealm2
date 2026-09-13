param([string]$Round = 'r15')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$armorRepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$armorOutput = Join-Path $PSScriptRoot 't50-t70-armor-review.zip'
$armorAcceptance = Get-Content -LiteralPath (Join-Path $armorRepoRoot 'runs/tier50-70/acceptance.json') -Raw | ConvertFrom-Json
if ($armorAcceptance.round -ne $Round) { throw "Acceptance evidence is not for $Round" }
$armorNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
function Add-ArmorFile([string]$Relative) {
    $armorPath = [System.IO.Path]::GetFullPath((Join-Path $armorRepoRoot $Relative))
    if (-not $armorPath.StartsWith($armorRepoRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Outside repository: $Relative" }
    if (-not (Test-Path -LiteralPath $armorPath -PathType Leaf)) { throw "Missing delivery file: $Relative" }
    [void]$armorNames.Add($Relative.Replace('\','/'))
}
foreach ($armorTheme in @('dragonhide','starhide')) {
    $armorCandidate = "art/item-models/candidates/armor-$armorTheme-reference"
    $armorCatalog = Get-Content -LiteralPath (Join-Path $armorRepoRoot "$armorCandidate/catalogue.json") -Raw | ConvertFrom-Json
    Add-ArmorFile "$armorCandidate/catalogue.json"
    foreach ($armorAsset in $armorCatalog.assets) { Add-ArmorFile "$armorCandidate/$($armorAsset.file)" }
    # Preserve catalogued authoring inputs, including the R12 imagegen edit targets.
    foreach ($armorDependency in $armorCatalog.sourceDependencies) { Add-ArmorFile $armorDependency.file }
    foreach ($armorSuffix in @('set.blend','studio.png','studio.json','validation.json')) { Add-ArmorFile "art/tier50-70/$armorTheme-$armorSuffix" }
}
foreach ($armorFolder in @('art/tier50-70/renders','art/tier50-70/references','runs/tier50-70')) {
    Get-ChildItem -LiteralPath (Join-Path $armorRepoRoot $armorFolder) -File -Recurse | ForEach-Object {
        $armorRelative = $_.FullName.Substring($armorRepoRoot.Length + 1).Replace('\','/')
        Add-ArmorFile $armorRelative
    }
}
foreach ($armorFile in @('art/tier50-70/README.md','art/tier50-70/viewer.html','art/tier50-70/viewer.js','art/tier50-70/viewer-server.mjs','art/tier50-70/Open armor viewer.cmd','art/tier50-70/open-viewer.ps1','art/tier50-70/package_blender.py','art/tier50-70/render_studio.py','art/tier50-70/validate_blender.py','art/tier50-70/package_delivery.ps1')) { Add-ArmorFile $armorFile }
$armorProductionFiles = @(
    'game/public/assets/manifest.json',
    'game/src/render/characterRig.ts',
    'game/src/render/equipmentVisuals.ts',
    'game/src/render/itemBodyCoverage.ts',
    'game/src/ui/itemIcons.ts',
    'tools/item-models/world-test.ts',
    'tests/starhide-appearance.test.ts',
    'tests/tier50-70-coverage.test.ts',
    'tests/item-body-coverage.test.ts',
    'tests/tier50-70-skin.test.ts'
)
if (Test-Path -LiteralPath (Join-Path $armorRepoRoot 'tests/item-icons.test.ts') -PathType Leaf) {
    $armorProductionFiles += 'tests/item-icons.test.ts'
}
foreach ($armorFile in $armorProductionFiles) { Add-ArmorFile $armorFile }
$armorRevisionFiles = @('art/tier50-70/verify_materials.mjs','art/tier50-70/finalize_evidence.mjs')
if ($Round -eq 'r13') {
    $armorRevisionFiles += @('art/tier50-70/verify_revision_r13.mjs','art/tier50-70/finalize_revision_r13.mjs')
}
if ($Round -eq 'r14') {
    $armorRevisionFiles += @('art/tier50-70/verify_revision_r14.mjs','art/tier50-70/finalize_revision_r14.mjs','art/tier50-70/verify_contacts_r14.ts')
}
if ($Round -eq 'r15') {
    $armorRevisionFiles += @('art/tier50-70/verify_revision_r15.mjs','art/tier50-70/finalize_revision_r15.mjs','art/tier50-70/verify_contacts_r14.ts')
}
foreach ($armorFile in $armorRevisionFiles) { Add-ArmorFile $armorFile }
Add-ArmorFile 'art/tier50-70/iridescence_blender.py'
$armorImagegenFiles = @()
if ($Round -eq 'r12') {
    $armorImagegenFiles = @(
        'art/tier50-70/references/embroidered-fabric-r12.png',
        'art/tier50-70/textures/imagegen-r12/dragonhide-embroidered-source.png',
        'art/tier50-70/textures/imagegen-r12/dragonhide-embroidered-prompt.txt',
        'art/tier50-70/textures/imagegen-r12/starhide-embroidered-source.png',
        'art/tier50-70/textures/imagegen-r12/starhide-embroidered-prompt.txt',
        'art/tier50-70/textures/imagegen-r12/dragonhide-botanical-source-v1.png',
        'art/tier50-70/textures/imagegen-r12/dragonhide-botanical-prompt-v1.txt',
        'art/tier50-70/textures/imagegen-r12/starhide-botanical-source-v1.png',
        'art/tier50-70/textures/imagegen-r12/starhide-botanical-prompt-v1.txt'
    )
}
if ($Round -in @('r13','r14','r15')) {
    $armorImagegenFiles = @(
        'art/tier50-70/references/embroidered-fabric-r12.png',
        'art/tier50-70/textures/imagegen-r13/dragonhide-embroidered-source.png',
        'art/tier50-70/textures/imagegen-r13/dragonhide-embroidered-prompt.txt',
        'art/tier50-70/textures/imagegen-r13/starhide-embroidered-source.png',
        'art/tier50-70/textures/imagegen-r13/starhide-embroidered-prompt.txt'
    )
}
if ($armorImagegenFiles.Count -gt 0) {
    foreach ($armorImagegenFile in $armorImagegenFiles) { Add-ArmorFile $armorImagegenFile }
    $armorTextureRound = if ($Round -in @('r14','r15')) { 'r13' } else { $Round }
    Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "textures/imagegen-$armorTextureRound") -File | ForEach-Object {
        Add-ArmorFile $_.FullName.Substring($armorRepoRoot.Length + 1).Replace('\','/')
    }
    Add-ArmorFile 'tools/item-models/tier50-70/materials-imagegen.ts'
}
$armorStream = [System.IO.File]::Open($armorOutput, [System.IO.FileMode]::Create)
$armorArchive = [System.IO.Compression.ZipArchive]::new($armorStream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($armorRelative in ($armorNames | Sort-Object)) {
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($armorArchive, (Join-Path $armorRepoRoot $armorRelative), $armorRelative, [System.IO.Compression.CompressionLevel]::Optimal)
    }
} finally { $armorArchive.Dispose(); $armorStream.Dispose() }
$armorRead = [System.IO.Compression.ZipFile]::OpenRead($armorOutput)
try {
    if (@($armorRead.Entries | Where-Object FullName -Like '*\*').Count) { throw 'Archive contains backslash entry names' }
    if (@($armorRead.Entries | Where-Object FullName -Like '*-set.blend').Count -ne 2) { throw 'Archive must contain both Blender sets' }
    if (@($armorRead.Entries | Where-Object FullName -Like 'art/item-models/candidates/*/models/items/*.glb').Count -ne 10) { throw 'Archive must contain ten authored GLBs' }
    if ($armorImagegenFiles.Count -gt 0) {
        foreach ($armorImagegenFile in $armorImagegenFiles) {
            if ($null -eq $armorRead.GetEntry($armorImagegenFile)) { throw "Missing imagegen source or prompt in archive: $armorImagegenFile" }
        }
    }
    foreach ($armorEntry in ($armorRead.Entries | Where-Object {
        $_.FullName.EndsWith('.blend') -or $_.FullName.EndsWith('.glb') -or
        $armorImagegenFiles -contains $_.FullName -or $armorProductionFiles -contains $_.FullName -or
        $armorRevisionFiles -contains $_.FullName -or $_.FullName.StartsWith('runs/tier50-70/')
    })) {
        $armorEntryStream = $armorEntry.Open()
        $armorHasher = [System.Security.Cryptography.SHA256]::Create()
        try { $armorEntryHash = ([System.BitConverter]::ToString($armorHasher.ComputeHash($armorEntryStream))).Replace('-','').ToLower() }
        finally { $armorEntryStream.Dispose(); $armorHasher.Dispose() }
        $armorOriginalHash = (Get-FileHash -LiteralPath (Join-Path $armorRepoRoot $armorEntry.FullName) -Algorithm SHA256).Hash.ToLower()
        if ($armorEntryHash -ne $armorOriginalHash) { throw "Archive hash mismatch: $($armorEntry.FullName)" }
    }
    $armorResult = [ordered]@{ file = 'art/tier50-70/t50-t70-armor-review.zip'; round = $Round; files = $armorRead.Entries.Count; bytes = (Get-Item -LiteralPath $armorOutput).Length; sha256 = (Get-FileHash -LiteralPath $armorOutput -Algorithm SHA256).Hash.ToLower(); blenderSets = 2; authoredGLBs = 10; forwardSlashEntries = $true; imagegenSourceAndPromptIncluded = ($armorImagegenFiles.Count -gt 0); productionSelectionSourceAndTestsIncluded = $true; runtimeEvidenceFiles = @($armorRead.Entries | Where-Object FullName -Like 'runs/tier50-70/*').Count }
} finally { $armorRead.Dispose() }
$armorResult | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'delivery.json') -Encoding utf8
$armorResult | ConvertTo-Json
