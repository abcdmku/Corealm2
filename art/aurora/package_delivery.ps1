$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$auroraRepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$auroraOutput = Join-Path $PSScriptRoot 't90-aurora-armor.zip'
$auroraAcceptance = Get-Content -LiteralPath (Join-Path $auroraRepoRoot 'runs/aurora/acceptance.json') -Raw | ConvertFrom-Json
if (-not $auroraAcceptance.passed -or -not $auroraAcceptance.productionPromoted) { throw 'Aurora acceptance is incomplete' }
$auroraNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
function Add-AuroraFile([string]$Relative) {
    $auroraPath = [System.IO.Path]::GetFullPath((Join-Path $auroraRepoRoot $Relative))
    if (-not $auroraPath.StartsWith($auroraRepoRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Outside repository: $Relative" }
    if (-not (Test-Path -LiteralPath $auroraPath -PathType Leaf)) { throw "Missing delivery file: $Relative" }
    [void]$auroraNames.Add($Relative.Replace('\','/'))
}
$auroraCandidate = 'art/item-models/candidates/armor-frostweave-aurora'
$auroraCatalog = Get-Content -LiteralPath (Join-Path $auroraRepoRoot "$auroraCandidate/catalogue.json") -Raw | ConvertFrom-Json
Add-AuroraFile "$auroraCandidate/catalogue.json"
foreach ($auroraAsset in $auroraCatalog.assets) { Add-AuroraFile "$auroraCandidate/$($auroraAsset.file)" }
foreach ($auroraDependency in $auroraCatalog.sourceDependencies) { Add-AuroraFile $auroraDependency.file }
foreach ($auroraFolder in @('art/aurora','runs/aurora')) {
    Get-ChildItem -LiteralPath (Join-Path $auroraRepoRoot $auroraFolder) -File -Recurse | Where-Object {
        $_.Extension -notin @('.zip','.pyc','.blend1') -and $_.Name -ne 'delivery.json'
    } | ForEach-Object { Add-AuroraFile $_.FullName.Substring($auroraRepoRoot.Length + 1).Replace('\','/') }
}
foreach ($auroraFile in @(
    'art/tier50-70/viewer.html','art/tier50-70/viewer.js','art/tier50-70/viewer-server.mjs',
    'art/tier50-70/Open armor viewer.cmd','art/tier50-70/open-viewer.ps1',
    'game/public/assets/manifest.json','game/src/content/bossArmor.ts','game/src/render/characterRig.ts',
    'game/src/render/fabArmor.ts','game/src/render/equipmentVisuals.ts','game/src/render/itemBodyCoverage.ts',
    'game/src/ui/itemIcons.ts','tools/item-models/world-test.ts','tools/item-models/wear-test.ts','tools/item-models/lab-test.ts',
    'tests/aurora-appearance.test.ts','tests/aurora-items.test.ts','tests/boss-armor.test.ts','tests/item-icons.test.ts'
)) { Add-AuroraFile $auroraFile }
foreach ($auroraPiece in @('hood','robe','leggings','boots','wraps')) { Add-AuroraFile "game/public/assets/icons/items/48/aurora_frostweave_$auroraPiece.png" }
$auroraStream = [System.IO.File]::Open($auroraOutput,[System.IO.FileMode]::Create)
$auroraArchive = [System.IO.Compression.ZipArchive]::new($auroraStream,[System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($auroraRelative in ($auroraNames | Sort-Object)) {
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($auroraArchive,(Join-Path $auroraRepoRoot $auroraRelative),$auroraRelative,[System.IO.Compression.CompressionLevel]::Optimal)
    }
} finally { $auroraArchive.Dispose(); $auroraStream.Dispose() }
$auroraRead = [System.IO.Compression.ZipFile]::OpenRead($auroraOutput)
try {
    if (@($auroraRead.Entries | Where-Object FullName -Like '*\*').Count) { throw 'Archive contains backslash paths' }
    if (@($auroraRead.Entries | Where-Object FullName -Like '*-set.blend').Count -ne 1) { throw 'Expected one editable Blender set' }
    if (@($auroraRead.Entries | Where-Object FullName -Like 'art/item-models/candidates/*/models/items/*.glb').Count -ne 5) { throw 'Expected five authored GLBs' }
    foreach ($auroraEntry in $auroraRead.Entries) {
        $auroraEntryStream = $auroraEntry.Open()
        $auroraHasher = [System.Security.Cryptography.SHA256]::Create()
        try { $auroraEntryHash = ([System.BitConverter]::ToString($auroraHasher.ComputeHash($auroraEntryStream))).Replace('-','').ToLower() }
        finally { $auroraEntryStream.Dispose(); $auroraHasher.Dispose() }
        if ($auroraEntryHash -ne (Get-FileHash -LiteralPath (Join-Path $auroraRepoRoot $auroraEntry.FullName) -Algorithm SHA256).Hash.ToLower()) { throw "Archive hash mismatch: $($auroraEntry.FullName)" }
    }
    $auroraResult = [ordered]@{file='art/aurora/t90-aurora-armor.zip';round=$auroraAcceptance.round;files=$auroraRead.Entries.Count;bytes=(Get-Item -LiteralPath $auroraOutput).Length;sha256=(Get-FileHash -LiteralPath $auroraOutput -Algorithm SHA256).Hash.ToLower();blenderSets=1;authoredGLBs=5;imagegenSourceAndPromptIncluded=$true;allArchiveFileHashesVerified=$true}
} finally { $auroraRead.Dispose() }
$auroraResult | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'delivery.json') -Encoding utf8
$auroraResult | ConvertTo-Json
