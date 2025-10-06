# GitHub Actions Workflows

This directory contains automated workflows for building and releasing Streams Prefetcher.

## Workflows

### 1. Nightly Release (`nightly-release.yml`)

**Trigger**:
- Automatically runs every day at 2:00 AM UTC
- Can be manually triggered via GitHub Actions UI

**What it does**:
1. Builds Docker image from `main` branch
2. Pushes to GitHub Container Registry with tags:
   - `:nightly` (always points to latest nightly)
   - `:YYYY.MM.DD.HHMM-nightly` (specific date/time)
3. Creates a GitHub pre-release

**Docker usage**:
```yaml
# In docker-compose.yml - for testing latest nightly builds
image: ghcr.io/deejay189393/streams-prefetcher:nightly
```

### 2. Stable Release (`release.yml`)

**Trigger**:
- Automatically runs when a version tag is pushed (e.g., `v0.9.0`)

**What it does**:
1. Builds Docker image from the tagged commit
2. Pushes to GitHub Container Registry with tags:
   - `:latest` (always points to latest stable)
   - `:vX.Y.Z` (specific version)
3. Creates a GitHub release with changelog

**Docker usage**:
```yaml
# In docker-compose.yml - for production use
image: ghcr.io/deejay189393/streams-prefetcher:latest
```

## Creating a New Release

### Stable Release

1. Update version in code:
   - `src/__init__.py`
   - `web/index.html`
2. Update `CHANGELOG.md`
3. Commit changes
4. Create and push tag:
   ```bash
   git tag -a v0.9.0 -m "Release v0.9.0"
   git push origin v0.9.0
   ```
5. GitHub Actions will automatically build and publish

### Manual Nightly Release

1. Go to Actions tab on GitHub
2. Select "Nightly Release" workflow
3. Click "Run workflow"
4. Select branch (usually `main`)
5. Click "Run workflow"

## Permissions

Both workflows require:
- `contents: write` - To create releases
- `packages: write` - To push Docker images to GHCR

These are automatically provided by GitHub when using `GITHUB_TOKEN`.
