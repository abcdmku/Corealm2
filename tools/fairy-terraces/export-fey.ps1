param([string]$EngineRoot = 'C:/Program Files/Epic Games/UE_5.8')
$ErrorActionPreference = 'Stop'
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$projectPath = Join-Path $repoPath '.asset-cache/fairy-terraces/unreal'
$contentPath = Join-Path $projectPath 'Content'
$null = New-Item -ItemType Directory -Force -Path $contentPath
$sourcePath = 'C:/Users/Borg/Documents/Unreal Projects/MyProject/Content/ParagonFey'
$targetPath = Join-Path $contentPath 'ParagonFey'
if (-not (Test-Path -LiteralPath $targetPath)) {
    Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Recurse
}
$projectFile = Join-Path $projectPath 'CorealmFeyExport.uproject'
@{ FileVersion = 3; EngineAssociation = '5.8'; Plugins = @(@{Name='PythonScriptPlugin';Enabled=$true}, @{Name='GLTFExporter';Enabled=$true}) } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $projectFile -Encoding utf8
$scriptPath = Join-Path $PSScriptRoot 'export_fey.py'
$logPath = Join-Path $projectPath 'export.log'
$editorArgs = @('"' + $projectFile + '"', '-unattended', '-nosplash', '-nosound', '-RenderOffscreen', '-AllowCommandletRendering', '-ExecutePythonScript="' + $scriptPath + '"', '-abslog="' + $logPath + '"')
$process = Start-Process -FilePath (Join-Path $EngineRoot 'Engine/Binaries/Win64/UnrealEditor-Cmd.exe') -ArgumentList $editorArgs -WindowStyle Hidden -PassThru
@{pid=$process.Id;project=$projectFile;log=$logPath} | ConvertTo-Json
