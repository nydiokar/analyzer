$ErrorActionPreference = "Stop"

$gitDir = (git rev-parse --git-dir).Trim()
if (-not $gitDir) {
  throw "Unable to resolve git directory."
}

$hooksDir = Join-Path $gitDir "hooks"
$preCommitPath = Join-Path $hooksDir "pre-commit"

if (-not (Test-Path $hooksDir)) {
  New-Item -ItemType Directory -Path $hooksDir | Out-Null
}

$hookContent = @'
#!/bin/sh

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/git-hooks/pre-commit-intel.ps1"
status=$?

if [ $status -ne 0 ]; then
  exit $status
fi

exit 0
'@

if (Test-Path $preCommitPath) {
  $currentContent = (Get-Content $preCommitPath -Raw).TrimEnd("`r", "`n")
  $expectedContent = $hookContent.TrimEnd("`r", "`n")
  if ($currentContent -eq $expectedContent) {
    Write-Host "Intel pre-commit hook already installed at $preCommitPath" -ForegroundColor Green
    exit 0
  }
}

Set-Content -Path $preCommitPath -Value $hookContent -NoNewline

Write-Host "Installed Intel pre-commit hook to $preCommitPath" -ForegroundColor Green
