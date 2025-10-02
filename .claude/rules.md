# Project-Specific Rules

## Docker Container Rebuild Process

**CRITICAL**: When rebuilding the streams-prefetcher container, you MUST follow this exact process:

1. **First**: `cd /opt/docker`
2. **Then**: `docker compose --profile streams-prefetcher up -d --build`

**NEVER** use `COMPOSE_PROFILES=` environment variable approach from the working directory.
**ALWAYS** cd to `/opt/docker` first, then use the `--profile` flag.

### Correct Commands:
```bash
cd /opt/docker && docker compose --profile streams-prefetcher up -d --build
```

### Incorrect (DO NOT USE):
```bash
# Wrong - using COMPOSE_PROFILES from wrong directory
COMPOSE_PROFILES=streams-prefetcher docker compose up -d --build streams-prefetcher
```
