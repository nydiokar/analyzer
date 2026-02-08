#!/bin/bash

# Release script for creating new versions with SemVer
# Usage: ./scripts/release.sh [major|minor|patch|<version>]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're on a clean git state
if [[ -n $(git status -s) ]]; then
  echo -e "${RED}Error: Working directory is not clean. Commit or stash changes first.${NC}"
  exit 1
fi

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo -e "${YELLOW}Warning: You are on branch '$CURRENT_BRANCH', not 'main'.${NC}"
  read -p "Continue anyway? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}Current version: $CURRENT_VERSION${NC}"

# Determine new version
if [ -z "$1" ]; then
  echo "Usage: $0 [major|minor|patch|<specific-version>]"
  echo ""
  echo "Examples:"
  echo "  $0 patch      # 0.20.4 -> 0.20.5"
  echo "  $0 minor      # 0.20.4 -> 0.21.0"
  echo "  $0 major      # 0.20.4 -> 1.0.0"
  echo "  $0 1.2.3      # Specific version"
  exit 1
fi

VERSION_TYPE=$1

# Calculate new version
if [[ "$VERSION_TYPE" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-.*)?$ ]]; then
  NEW_VERSION=$VERSION_TYPE
else
  IFS='.' read -r -a version_parts <<< "$CURRENT_VERSION"
  MAJOR="${version_parts[0]}"
  MINOR="${version_parts[1]}"
  PATCH="${version_parts[2]}"

  case $VERSION_TYPE in
    major)
      NEW_VERSION="$((MAJOR + 1)).0.0"
      ;;
    minor)
      NEW_VERSION="$MAJOR.$((MINOR + 1)).0"
      ;;
    patch)
      NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
      ;;
    *)
      echo -e "${RED}Error: Invalid version type. Use major, minor, patch, or a specific version.${NC}"
      exit 1
      ;;
  esac
fi

echo -e "${GREEN}New version: $NEW_VERSION${NC}"

# Confirm with user
read -p "Create release $NEW_VERSION? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Release cancelled."
  exit 0
fi

# Update package.json version
echo "Updating package.json..."
npm version $NEW_VERSION --no-git-tag-version

# Update CHANGELOG.md
echo "Please update CHANGELOG.md with the changes for version $NEW_VERSION"
echo "Press Enter when done editing the changelog..."
${EDITOR:-nano} CHANGELOG.md
read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Release cancelled. Reverting changes..."
  git checkout package.json
  exit 0
fi

# Commit changes
echo "Committing changes..."
git add package.json CHANGELOG.md
git commit -m "chore: release v$NEW_VERSION"

# Create and push tag
echo "Creating tag v$NEW_VERSION..."
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

echo -e "${GREEN}Release prepared!${NC}"
echo ""
echo "Next steps:"
echo "1. Review the commit and tag:"
echo "   git show v$NEW_VERSION"
echo ""
echo "2. Push the changes and tag:"
echo "   git push origin $CURRENT_BRANCH"
echo "   git push origin v$NEW_VERSION"
echo ""
echo "3. GitHub Actions will automatically create the release"
echo ""
echo -e "${YELLOW}To undo (before pushing):${NC}"
echo "   git tag -d v$NEW_VERSION"
echo "   git reset --hard HEAD~1"
