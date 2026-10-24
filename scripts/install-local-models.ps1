param(
  [string]$Source = (Join-Path $PSScriptRoot '..\..\MY-HealthChain\backend\ml')
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath $Source).Path
$targetRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\backend\ml')).Path
$files = @(
  @{ Relative = 'chexnet\models\trained\chexnet_update_hosp-001_1790766306.pth.tar'; Sha256 = '701D177BAC01D6306D2C137097AB62B130183C221AA30383A626B4CCD670E4BE' },
  @{ Relative = 'CT-CLIP\models\trained\ctclip_update_hosp-002_1790766307.pt'; Sha256 = 'B51C504971499A3812DAB7F5107239670466AB6DFC1E97AE26B092E039137D50' },
  @{ Relative = 'CMR-AI\checkpoints\trained\cmrai_update_hosp-003_1790766371.pth'; Sha256 = '6CC6CAD9895174F729EB7228510F6C88BDFC3247948515F2691A42AC6D2D232E' }
)

foreach ($item in $files) {
  $from = Join-Path $sourceRoot $item.Relative
  $to = Join-Path $targetRoot $item.Relative
  if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { throw "Missing source checkpoint: $from" }
  $sourceHash = (Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash
  if ($sourceHash -ne $item.Sha256) { throw "Source checkpoint hash differs from the reviewed file: $from" }
  New-Item -ItemType Directory -Path (Split-Path -Path $to) -Force | Out-Null
  Copy-Item -LiteralPath $from -Destination $to -Force
  if ((Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash -ne $sourceHash) { throw "Copy verification failed: $to" }
  Write-Output "Installed $($item.Relative)"
}
