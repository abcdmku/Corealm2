<#
Private source staging and export, run from the repository root:
  & tools/fab-armor/export-unreal.ps1 -NoLaunch
  & tools/fab-armor/export-unreal.ps1 -AssetName melee-t50-novaborn
  & tools/fab-armor/export-unreal.ps1 -AssetName mage-t50-rosewood
  & tools/fab-armor/export-unreal.ps1 -InspectOnly
  & tools/fab-armor/export-unreal.ps1 -InspectKwang
The command starts hidden UE and returns its PID. Wait for that process to exit
before starting another export against this project. Inspect export.log and
paragon/export-report.json; finished.txt is only a completion marker, not success.
No switches exports every source candidate, including historical rejected ones.

Confirmed screenshot mapping, with historical filenames preserved:
  Melee T50 = melee-t50-novaborn.glb; T70 = melee-t50.glb (Tough);
  Melee T90 = melee-t90.glb (WhiteTiger) plus melee-t90-helmet.glb.
  Mage T50 = mage-t50-rosewood.glb; T70 = mage-t70.glb (Albino);
  Mage T90 = mage-t90.glb (Frostwalker).
Historical melee-t70.glb is base Greystone and mage-t50.glb is purple Kwang_GDC;
neither is selected. These are source exports, not optimized production assets.
#>
param([string]$EngineRoot = 'C:/Program Files/Epic Games/UE_5.8', [switch]$NoLaunch, [switch]$InspectOnly, [switch]$InspectKwang, [string]$AssetName = '')
$ErrorActionPreference = 'Stop'
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$projectPath = Join-Path $repoPath '.asset-cache/fab-armor/unreal'
$contentPath = Join-Path $projectPath 'Content'
$null = New-Item -ItemType Directory -Force -Path $contentPath
foreach ($pack in @('ParagonGreystone', 'ParagonKwang')) {
    $sourcePath = "C:/ProgramData/Epic/EpicGamesLauncher/VaultCache/$pack/data/Content/$pack"
    $targetPath = Join-Path $contentPath $pack
    if (-not (Test-Path -LiteralPath $targetPath)) {
        Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Recurse
    }
}
$projectFile = Join-Path $projectPath 'CorealmArmorExport.uproject'
@{
    FileVersion = 3
    EngineAssociation = '5.8'
    Plugins = @(@{Name='PythonScriptPlugin';Enabled=$true}, @{Name='GLTFExporter';Enabled=$true})
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $projectFile -Encoding utf8
if ($NoLaunch) { return }
$scriptPath = Join-Path $PSScriptRoot 'export_unreal.py'
$logPath = Join-Path $projectPath 'export.log'
$argsForEditor = @('"' + $projectFile + '"', '-unattended', '-nosplash', '-nosound', '-RenderOffscreen', '-AllowCommandletRendering', '-ExecutePythonScript="' + $scriptPath + '"', '-abslog="' + $logPath + '"')
if ($InspectOnly -or $InspectKwang) { $argsForEditor += '-ArmorInspectOnly' }
if ($InspectKwang) { $argsForEditor += '-ArmorInspectKwang' }
if ($AssetName) {
    if ($AssetName -notmatch '^[a-z0-9-]+$') { throw 'Invalid asset name' }
    $argsForEditor += '-ArmorAsset=' + $AssetName
}
$process = Start-Process -FilePath (Join-Path $EngineRoot 'Engine/Binaries/Win64/UnrealEditor-Cmd.exe') -ArgumentList $argsForEditor -WindowStyle Hidden -PassThru
@{pid=$process.Id;project=$projectFile;log=$logPath} | ConvertTo-Json
