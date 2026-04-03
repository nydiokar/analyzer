$ErrorActionPreference = "Stop"

$stagedFiles = git diff --cached --name-only --diff-filter=ACMR
if (-not $stagedFiles) {
  exit 0
}

$intelPatterns = @(
  '^src/api/controllers/intel\.controller\.ts$',
  '^src/api/shared/dto/intel-public\.dto\.ts$',
  '^src/api/shared/dto/wallet-hud\.dto\.ts$',
  '^src/api/modules/intel-openapi\.module\.ts$',
  '^scripts/export-intel-openapi\.ts$',
  '^scripts/generate-intel-sdk-contract\.ts$',
  '^scripts/intel-surface-audit\.ts$',
  '^package\.json$'
)

$intelRelevant = $false
foreach ($file in $stagedFiles) {
  foreach ($pattern in $intelPatterns) {
    if ($file -match $pattern) {
      $intelRelevant = $true
      break
    }
  }
  if ($intelRelevant) {
    break
  }
}

if (-not $intelRelevant) {
  exit 0
}

Write-Host "[intel-hook] Intel contract files staged. Regenerating artifact outputs..." -ForegroundColor Cyan

pnpm run intel:openapi
if ($LASTEXITCODE -ne 0) {
  Write-Host "[intel-hook] intel:openapi failed." -ForegroundColor Red
  exit $LASTEXITCODE
}

pnpm run intel:sdk
if ($LASTEXITCODE -ne 0) {
  Write-Host "[intel-hook] intel:sdk failed." -ForegroundColor Red
  exit $LASTEXITCODE
}

pnpm run intel:audit:strict
if ($LASTEXITCODE -ne 0) {
  Write-Host "[intel-hook] intel:audit:strict failed." -ForegroundColor Red
  exit $LASTEXITCODE
}

git add artifacts/intel-openapi.json packages/sdk/src/generated-intel-contract.ts

$sdkFacadeTouched = $stagedFiles | Where-Object {
  $_ -in @(
    'packages/sdk/src/client.ts',
    'packages/sdk/src/types.ts',
    'packages/sdk/src/index.ts'
  )
}

Write-Host "[intel-hook] Intel generated artifacts refreshed and staged." -ForegroundColor Green

if (-not $sdkFacadeTouched) {
  Write-Host "[intel-hook] Review handwritten SDK facade if the public SDK behavior changed:" -ForegroundColor Yellow
  Write-Host "  - packages/sdk/src/client.ts" -ForegroundColor Yellow
  Write-Host "  - packages/sdk/src/types.ts" -ForegroundColor Yellow
  Write-Host "  - packages/sdk/src/index.ts" -ForegroundColor Yellow
}

Write-Host "[intel-hook] Review docs downstream if public API examples or explanations changed:" -ForegroundColor Yellow
Write-Host "  - C:\Users\solastic\prj\sova-intel\docs" -ForegroundColor Yellow
Write-Host "  - C:\Users\solastic\prj\sova-intel\sdk-generated (evaluation baseline)" -ForegroundColor Yellow

exit 0
