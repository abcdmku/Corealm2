$ErrorActionPreference = 'Stop'
$armorViewerUrl = 'http://127.0.0.1:4186/'
try { $armorViewerReady = (Invoke-WebRequest -Uri $armorViewerUrl -UseBasicParsing -TimeoutSec 2).Content.Contains('T50 / T70 armor viewer') } catch { $armorViewerReady = $false }
if (-not $armorViewerReady) {
    $armorViewerScript = Join-Path $PSScriptRoot 'viewer-server.mjs'
    Start-Process -FilePath 'node' -ArgumentList @('"' + $armorViewerScript + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    for ($armorAttempt = 0; $armorAttempt -lt 30; $armorAttempt++) {
        try { $armorViewerReady = (Invoke-WebRequest -Uri $armorViewerUrl -UseBasicParsing -TimeoutSec 2).Content.Contains('T50 / T70 armor viewer') } catch { $armorViewerReady = $false }
        if ($armorViewerReady) { break }
        Start-Sleep -Milliseconds 200
    }
}
if (-not $armorViewerReady) { throw 'Could not start the armor viewer on port 4186.' }
Start-Process $armorViewerUrl
