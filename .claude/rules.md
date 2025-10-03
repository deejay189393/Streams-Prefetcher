# Project Rules for Streams Prefetcher

This file provides guidance to Claude Code when working with code in this repository.

## ⚠️ CRITICAL GIT COMMIT RULES ⚠️

**ABSOLUTELY MANDATORY - MUST BE FOLLOWED ON EVERY SINGLE COMMIT:**

When creating git commit messages, you MUST:

1. ❌ **NEVER** include ANY mentions of Claude, Claude Code, or Anthropic
2. ❌ **NEVER** include co-author lines like "Co-Authored-By: Claude"
3. ❌ **NEVER** include footer text like "Generated with Claude Code"
4. ❌ **NEVER** include ANY AI-related attribution whatsoever

**Examples:**

❌ **WRONG** - DO NOT DO THIS:
```
feat: add new feature

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

✅ **CORRECT** - DO THIS:
```
feat: add new feature

- Description of what was added
- Why it was needed
```

**THIS RULE TAKES ABSOLUTE PRIORITY OVER ALL OTHER COMMIT MESSAGE CONVENTIONS.**

If you violate this rule even once, the user will reject the commit. There are NO exceptions.

## Critical Build Commands

### Docker Container Rebuild Process

**CRITICAL**: When rebuilding the streams-prefetcher container, you MUST follow this exact process:

```bash
cd /opt/docker && docker compose --profile streams-prefetcher up -d --build
```

**NEVER** use `COMPOSE_PROFILES=` environment variable approach from the working directory.
**ALWAYS** cd to `/opt/docker` first, then use the `--profile` flag.

### Common Commands

```bash
# View logs
docker logs streams-prefetcher
docker logs -f streams-prefetcher  # Follow mode

# Access SQLite database
docker exec -it streams-prefetcher sqlite3 /app/data/db/streams_prefetcher_prefetch_cache.db

# Check container status
cd /opt/docker && docker compose --profile streams-prefetcher ps

# Restart container
cd /opt/docker && docker compose --profile streams-prefetcher restart streams-prefetcher

# Stop container
cd /opt/docker && docker compose --profile streams-prefetcher down
```

## High-Level Architecture

### System Overview

This is a **web-based Stremio addon cache prefetcher** that warms up self-hosted addon caches through scheduled or manual jobs. The system consists of:

1. **Flask Backend** (REST API + Server-Sent Events)
2. **Single-Page Frontend** (Vanilla HTML/CSS/JavaScript)
3. **Job Scheduler** (APScheduler for recurring jobs)
4. **Configuration Manager** (JSON-based persistence)
5. **Core Prefetcher** (Catalog fetching + stream requesting logic)

### Key Data Flow

```
User (Browser)
    ↓ HTTP POST /api/config
Flask Web App (web_app.py)
    ↓ update()
ConfigManager (config_manager.py)
    ↓ saves to disk
data/config/config.json

User clicks "Run Prefetch"
    ↓ HTTP POST /api/job/run
JobScheduler (job_scheduler.py)
    ↓ creates thread → _execute_job()
StreamsPrefetcherWrapper (streams_prefetcher_wrapper.py)
    ↓ builds args from config
FilteredStreamsPrefetcher (streams_prefetcher_filtered.py)
    ↓ fetches catalogs, makes stream requests
Addon URLs → SQLite Cache (streams_prefetcher_prefetch_cache.db)

Job running
    ↓ callbacks
JobScheduler → broadcasts events
    ↓ Server-Sent Events
Browser receives real-time updates
```

### Real-Time Communication

The system uses **Server-Sent Events (SSE)** for real-time updates:

- Endpoint: `GET /api/events`
- The `JobScheduler` registers callbacks with `register_callback()`
- Events: `status_change`, `progress`, `output`, `job_complete`, `job_error`
- Frontend JavaScript maintains an EventSource connection
- All SSE clients receive broadcast events simultaneously

### Job Execution Flow

1. **Manual Job Start**: User clicks "Run Prefetch Now" → `POST /api/job/run`
2. **Scheduled Job Start**: APScheduler triggers `run_job()` based on cron expression
3. **Validation**: Check if job already running (prevents concurrent execution)
4. **Thread Creation**: Job runs in daemon thread via `_execute_job()`
5. **Stdout Capture**: Output captured to `io.StringIO` and streamed via callbacks
6. **Progress Updates**: Prefetcher sends progress dicts via `progress_callback`
7. **Completion**: Results stored in `job_summary`, status set to `COMPLETED`/`FAILED`/`CANCELLED`
8. **Broadcast**: SSE notifies all connected clients of completion

**Important**: Job status can get stuck if thread dies unexpectedly. The code includes checks in `run_job()` (lines 219-234 of job_scheduler.py) to detect and reset stuck statuses by checking `thread.is_alive()`.

### Configuration Persistence

- **Location**: `data/config/config.json`
- **Manager**: `ConfigManager` class handles all read/write operations
- **Merge Strategy**: Loaded config merged with `DEFAULT_CONFIG` to ensure all keys exist
- **Catalog Selection**: Stored in `saved_catalogs` array with `enabled` boolean and `order` int
- **Auto-save**: Frontend auto-saves catalog selections after 2-second debounce

### Database Structure

- **File**: `data/db/streams_prefetcher_prefetch_cache.db` (SQLite)
- **Purpose**: Cache prefetch requests to avoid redundant addon requests
- **Validity**: Configurable via `cache_validity` (default: 3 days)
- **Cleanup**: Expired entries ignored during lookups (no automatic deletion)
- **Schema**: See `streams_prefetcher.py` for table definitions

## Frontend-Backend Communication

### Critical Frontend Implementation Details

**JavaScript Const Immutability Bug Prevention**:
- NEVER reassign variables declared with `const`
- This causes silent JavaScript errors that crash stats population
- Example from previous bug: Line declared `const currentCompletionId = status.start_time;` but later code tried to reassign it
- JavaScript errors can fail silently without console output
- Always use `let` if reassignment is needed

**Element ID Mapping**:
The completion screen stats rely on exact element ID matches:
- `completion-start-time`, `completion-end-time`, `completion-total-duration`, `completion-processing-time`
- `completion-catalogs`, `completion-movies`, `completion-series`, `completion-episodes`
- `completion-pages`, `completion-cached`, `completion-success-rate`
- `completion-movie-rate`, `completion-series-rate`, `completion-overall-rate`
- Table: `#catalog-details-tbody`

**Stats Population Pattern**:
Stats are populated inline within the `status === 'completed'` block, NOT via separate function calls. This ensures execution order and prevents crashes from missing function context.

### API Response Structures

**Job Status** (`GET /api/job/status`):
```json
{
  "success": true,
  "status": {
    "status": "completed|running|idle|failed|cancelled",
    "start_time": 1234567890.123,
    "end_time": 1234567890.123,
    "error": null,
    "next_run_time": "2025-10-03T02:00:00+00:00",
    "progress": { /* real-time progress data */ },
    "is_scheduled": true,
    "summary": {
      "timing": {
        "start_time": 1234567890.123,
        "end_time": 1234567890.123,
        "total_duration": 123.45,
        "processing_duration": 120.00
      },
      "statistics": {
        "filtered_catalogs": 10,
        "movies_prefetched": 100,
        "series_prefetched": 20,
        "episodes_prefetched": 150,
        "total_pages_fetched": 500,
        "items_from_cache": 50,
        "cache_requests_made": 600,
        "cache_requests_successful": 550
      },
      "processed_catalogs": [
        {
          "name": "Popular Movies",
          "type": "movie",
          "duration": 45.5,
          "success_count": 50,
          "failed_count": 2,
          "cached_count": 10
        }
      ]
    }
  }
}
```

## Component Relationships

### ConfigManager ↔ JobScheduler
- JobScheduler receives ConfigManager instance on init
- JobScheduler loads scheduled jobs from config via `_load_scheduled_job()`
- JobScheduler updates config when schedule changes via `update_schedule()`

### JobScheduler ↔ StreamsPrefetcherWrapper
- JobScheduler creates wrapper instance in `_execute_job()`
- Passes `progress_callback` and `output_callback` to wrapper
- Wrapper calls callbacks which trigger SSE broadcasts

### StreamsPrefetcherWrapper ↔ FilteredStreamsPrefetcher
- Wrapper converts `ConfigManager` data into args for `FilteredStreamsPrefetcher`
- Wrapper passes through callbacks to prefetcher
- Prefetcher returns results dict with `success`, `interrupted`, and `results` keys

### Web App ↔ All Components
- `web_app.py` orchestrates all other components
- Maintains singleton instances: `config_manager`, `job_scheduler`
- Broadcasts SSE events via `broadcast_event()` triggered by scheduler callbacks
- Provides REST API wrapping all component methods

## Key Files

### Backend Core
- **`web_app.py`**: Flask app, REST API endpoints, SSE event streaming
- **`job_scheduler.py`**: APScheduler integration, job execution in threads, status management
- **`config_manager.py`**: JSON persistence, default config merging
- **`streams_prefetcher_wrapper.py`**: Converts config to prefetcher args, manages callbacks
- **`streams_prefetcher_filtered.py`**: Catalog filtering logic on top of core prefetcher
- **`streams_prefetcher.py`**: Core prefetcher logic (catalog fetching, stream requesting, caching)

### Frontend
- **`web/index.html`**: Complete UI structure (no templating)
- **`web/js/app.js`**: All JavaScript logic (config, catalogs, jobs, SSE, UI updates)
- **`web/css/style.css`**: Dark theme styling

### Data
- **`data/config/config.json`**: All user configuration and catalog selections
- **`data/db/streams_prefetcher_prefetch_cache.db`**: SQLite cache database
- **`data/logs/`**: Optional log files (when logging enabled)

## Development Notes

### Debugging Real-Time Updates

If stats don't populate or updates fail:
1. Check browser console for JavaScript errors
2. Add visible debug output (user may be on mobile without console access)
3. Verify SSE connection in Network tab
4. Check that backend is sending complete data structures
5. Verify element IDs match between JavaScript and HTML

### Thread Safety

- `job_scheduler.py` uses locks for shared state:
  - `output_lock` for `output_lines`
  - `progress_lock` for `progress_data`
- Job status checks must verify thread liveness, not just status variable
- Callbacks execute in job thread, event broadcasting in Flask thread

### Adding New Configuration Fields

1. Add to `ConfigManager.DEFAULT_CONFIG`
2. Add UI elements to `web/index.html`
3. Add JavaScript to `loadConfig()` and `saveConfig()` in `web/js/app.js`
4. Update `StreamsPrefetcherWrapper._parse_config_to_args()` if needed
5. Pass to `FilteredStreamsPrefetcher` if needed

### Testing Scheduled Jobs

Use short cron expressions for testing:
- `*/5 * * * *` - Every 5 minutes
- `*/1 * * * *` - Every minute (very aggressive)

The scheduler uses APScheduler with BackgroundScheduler and UTC timezone.

## Important Constraints

1. **Self-hosted addons only** - Do not use against public addons
2. **Single job execution** - Only one job can run at a time (enforced in `run_job()`)
3. **No authentication** - Security must be handled at reverse proxy level
4. **SQLite limitations** - Database is not designed for concurrent writes
5. **Memory usage** - Output buffer limited to 1000 lines (`max_output_lines`)
6. **Thread cancellation** - Uses `PyThreadState_SetAsyncExc` to inject `KeyboardInterrupt`
