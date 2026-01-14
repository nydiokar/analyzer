# Release script for creating new versions with SemVer
# Usage: .\scripts\release.ps1 [major|minor|patch|<version>]

param(
    [Parameter(Mandatory=$false)]
    [string]$VersionType
)

$ErrorActionPreference = "Stop"

# Check if we're on a clean git state
$gitStatus = git status -s
if ($gitStatus) {
    Write-Host "Error: Working directory is not clean. Commit or stash changes first." -ForegroundColor Red
    exit 1
}

# Check if we're on main branch
$currentBranch = git branch --show-current
if ($currentBranch -ne "main") {
    Write-Host "Warning: You are on branch '$currentBranch', not 'main'." -ForegroundColor Yellow
    $continue = Read-Host "Continue anyway? (y/N)"
    if ($continue -ne "y" -and $continue -ne "Y") {
        exit 1
    }
}

# Get current version from package.json
$packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
$currentVersion = $packageJson.version
Write-Host "Current version: $currentVersion" -ForegroundColor Green

# Determine new version
if (-not $VersionType) {
    Write-Host "Usage: .\scripts\release.ps1 [major|minor|patch|<specific-version>]"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  .\scripts\release.ps1 patch      # 0.20.4 -> 0.20.5"
    Write-Host "  .\scripts\release.ps1 minor      # 0.20.4 -> 0.21.0"
    Write-Host "  .\scripts\release.ps1 major      # 0.20.4 -> 1.0.0"
    Write-Host "  .\scripts\release.ps1 1.2.3      # Specific version"
    exit 1
}

# Calculate new version
if ($VersionType -match '^\d+\.\d+\.\d+(-.*)?$') {
    $newVersion = $VersionType
} else {
    $versionParts = $currentVersion -split '\.'
    $major = [int]$versionParts[0]
    $minor = [int]$versionParts[1]
    $patch = [int]$versionParts[2]

    switch ($VersionType) {
        "major" {
            $newVersion = "$($major + 1).0.0"
        }
        "minor" {
            $newVersion = "$major.$($minor + 1).0"
        }
        "patch" {
            $newVersion = "$major.$minor.$($patch + 1)"
        }
        default {
            Write-Host "Error: Invalid version type. Use major, minor, patch, or a specific version." -ForegroundColor Red
            exit 1
        }
    }
}

Write-Host "New version: $newVersion" -ForegroundColor Green

# Confirm with user
$confirm = Read-Host "Create release $newVersion? (y/N)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "Release cancelled."
    exit 0
}

# Update package.json version
Write-Host "Updating package.json..."
npm version $newVersion --no-git-tag-version

# Update CHANGELOG.md
Write-Host "Please update CHANGELOG.md with the changes for version $newVersion"
Write-Host "Opening CHANGELOG.md in default editor..."
Start-Process "CHANGELOG.md" -Wait
$continueAfterEdit = Read-Host "Continue? (y/N)"
if ($continueAfterEdit -ne "y" -and $continueAfterEdit -ne "Y") {
    Write-Host "Release cancelled. Reverting changes..."
    git checkout package.json
    exit 0
}

# Commit changes
Write-Host "Committing changes..."
git add package.json CHANGELOG.md
git commit -m "chore: release v$newVersion"

# Create and push tag
Write-Host "Creating tag v$newVersion..."
git tag -a "v$newVersion" -m "Release v$newVersion"

Write-Host "`nRelease prepared!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Review the commit and tag:"
Write-Host "   git show v$newVersion"
Write-Host ""
Write-Host "2. Push the changes and tag:"
Write-Host "   git push origin $currentBranch"
Write-Host "   git push origin v$newVersion"
Write-Host ""
Write-Host "3. GitHub Actions will automatically create the release"
Write-Host ""
Write-Host "To undo (before pushing):" -ForegroundColor Yellow
Write-Host "   git tag -d v$newVersion"
Write-Host "   git reset --hard HEAD~1"
