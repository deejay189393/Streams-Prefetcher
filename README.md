# Streams Prefetcher

A Python script that warms up **self-hosted** Stremio addon caches by prefetching streams for movies and series, resulting in faster content loading when browsing in Stremio.

> **⚠️ IMPORTANT:** This tool is designed for **self-hosted addons only**. Running this against public addons will unnecessarily increase server load without any benefit, as public addons typically don't cache per-user. Only use this with addons you host yourself.

## Overview

This script fetches catalog data from your self-hosted Stremio addons, extracts content metadata, and makes prefetch requests to stream endpoints. By preloading your addon's cache, subsequent requests from Stremio will load much faster.

## Features

- **Smart Catalog Processing**: Automatically detects and processes movie, series, and mixed catalogs
- **Flexible Limiting**: Global and per-catalog limits for fine-grained control
- **Intelligent Caching**: Built-in SQLite cache to avoid redundant requests
- **Real-time Progress Tracking**: Live dashboard with progress bars and statistics
- **Randomization Options**: Randomize catalog and item processing order
- **Proxy Support**: Route requests through HTTP proxies
- **Robust Error Handling**: Continues processing even when individual requests fail

## Requirements

- Python 3.6+
- `requests` library

```bash
pip install requests
```

## Installation

1. Download the script:
```bash
curl -O https://example.com/streams_prefetcher.py
chmod +x streams_prefetcher.py
```

2. Or clone if part of a repository:
```bash
git clone https://github.com/username/streams-prefetcher
cd streams-prefetcher
```

## Basic Usage

```bash
python streams_prefetcher.py --addon-urls both:https://your-addon.com
```

## Command Line Arguments

### Required Arguments

| Argument | Description |
|----------|-------------|
| `--addon-urls` | Comma-separated list of addon URLs with types. Format: `type:url` |

**Addon Types:**
- `catalog` - Only fetch catalogs from this addon
- `stream` - Only make stream requests to this addon  
- `both` - Use addon for both catalogs and streams

### Limit Arguments

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `--movies-global-limit` | int | 100 | Global limit for total movies to prefetch. -1 for unlimited |
| `--series-global-limit` | int | 25 | Global limit for total series to prefetch. -1 for unlimited |
| `--movies-per-catalog` | int | 50 | Per-catalog limit for movie-only catalogs. -1 for unlimited |
| `--series-per-catalog` | int | 5 | Per-catalog limit for series-only catalogs. -1 for unlimited |
| `--items-per-mixed-catalog` | int | 30 | Per-catalog limit for mixed-type catalogs. -1 for unlimited |
| `--max-execution-time` / `-t` | time | -1s | Execution time limit. Script stops gracefully after this duration. -1 (with any unit) for unlimited |

### Optional Arguments

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `--delay` / `-d` | time | 0s | Delay between requests. Format: 500ms, 30s, 5m, 2h, 1d |
| `--proxy` | string | None | HTTP proxy URL (e.g., http://proxy.example.com:8080) |
| `--randomize-catalog-processing` | flag | False | Randomize the order in which catalogs are processed |
| `--randomize-item-prefetching` | flag | False | Randomize the order of items within a catalog |
| `--cache-validity` | time | 3d | Validity of cached items. Format: 30s, 5m, 2h, 3d, 1w |
| `--enable-logging` | flag | False | Enable logging. Creates timestamped log files in data/logs directory with full execution details |

### Time Format

Time-based parameters (`--delay`, `--cache-validity`, `--max-execution-time`) accept human-readable formats:

- `ms` = milliseconds (e.g., `500ms`)
- `s` = seconds (e.g., `30s`)
- `m` = minutes (e.g., `5m`)
- `h` = hours (e.g., `2h`)
- `d` = days (e.g., `3d`)
- `w` = weeks (e.g., `1w`)
- `M` = months (e.g., `6M`) - Note: capital M for months
- `y` = years (e.g., `1y`)

**For unlimited execution time**, use `-1` with any unit suffix (e.g., `-1s`, `-1m`, `-1h`).

**Examples:**
```bash
--delay 500ms        # 500 milliseconds
--delay 30s          # 30 seconds
--delay 5m           # 5 minutes
--cache-validity 7d  # 7 days
--cache-validity 2w  # 2 weeks
-t 30m               # 30 minute execution limit
-t -1s               # Unlimited execution time
-t -1m               # Unlimited execution time (any unit works)
-t -1                # Unlimited execution time (unit optional)
```

## Usage Examples

### Basic Examples

**Single addon for everything:**
```bash
python streams_prefetcher.py --addon-urls both:https://addon.example.com
```

**Separate catalog and stream addons:**
```bash
python streams_prefetcher.py --addon-urls catalog:https://catalog-addon.com,stream:https://stream-addon.com
```

**Multiple addons:**
```bash
python streams_prefetcher.py --addon-urls both:https://addon1.com,both:https://addon2.com,stream:https://stream-only.com
```

### Limit Configuration Examples

**Conservative prefetching (good for testing):**
```bash
python streams_prefetcher.py \
  --addon-urls both:https://addon.com \
  --movies-global-limit 20 \
  --series-global-limit 5 \
  --movies-per-catalog 10 \
  --series-per-catalog 2 \
  --delay 200ms
```

**Aggressive prefetching (for extensive catalogs):**
```bash
python streams_prefetcher.py \
  --addon-urls both:https://addon.com \
  --movies-global-limit 1000 \
  --series-global-limit 200 \
  --movies-per-catalog 100 \
  --series-per-catalog 20 \
  --items-per-mixed-catalog 75 \
  --cache-validity 7d
```

**Unlimited prefetching (use with caution):**
```bash
python streams_prefetcher.py \
  --addon-urls both:https://addon.com \
  --movies-global-limit -1 \
  --series-global-limit -1 \
  --movies-per-catalog -1 \
  --series-per-catalog -1 \
  --items-per-mixed-catalog -1
```

### Advanced Configuration Examples

**With proxy and randomization:**
```bash
python streams_prefetcher.py \
  --addon-urls both:https://addon.com \
  --proxy http://proxy.example.com:8080 \
  --randomize-catalog-processing \
  --randomize-item-prefetching \
  --delay 500ms
```

**Custom cache validity:**
```bash
python streams_prefetcher.py \
  --addon-urls both:https://addon.com \
  --cache-validity 1w  # 1 week
```

**Time-limited execution:**
```bash
# Run for maximum 30 minutes
python streams_prefetcher.py \
  --addon-urls both:https://addon.com \
  --max-execution-time 30m

# Quick 5-minute run
python streams_prefetcher.py \
  --addon-urls both:https://addon.com \
  -t 5m
```

**With logging enabled:**
```bash
# Save detailed logs to data/logs directory
python streams_prefetcher.py \
  --addon-urls both:https://addon.com \
  --enable-logging

# Combined with other options
python streams_prefetcher.py \
  --addon-urls both:https://addon.com \
  --movies-global-limit 200 \
  --series-global-limit 15 \
  --enable-logging \
  -t 1h
```

## How Limits Work

The script uses a hierarchy of limits to control prefetching:

1. **Global Limits**: Maximum total items across all catalogs
2. **Per-Catalog Limits**: Maximum items per individual catalog
3. **Mixed Catalog Handling**: Uses `--items-per-mixed-catalog` for catalogs containing both movies and series

### Limit Examples

Given these settings:
- `--movies-global-limit 100`
- `--movies-per-catalog 25`

**Scenario 1**: First catalog has 50 movies
- Will prefetch 25 movies (limited by per-catalog limit)
- 75 movies remain in global budget

**Scenario 2**: Later, after prefetching 90 movies total
- Next movie catalog will prefetch max 10 movies (limited by remaining global budget)
- Even if per-catalog limit is 25

## Catalog Types

The script automatically detects catalog types:

- **Movie**: Contains only movies
- **Series**: Contains only TV series
- **Mixed**: Contains both movies and series
- **Search**: Search-only catalogs (automatically skipped)
- **TV/Channel**: Unsupported types (automatically skipped)

## Output and Progress

The script provides real-time feedback with:

- **Catalog Discovery Table**: Shows which catalogs will be processed/skipped
- **Live Progress Dashboard**: Overall progress, current catalog, and prefetching status
- **Statistics Table**: Current limits and prefetched counts
- **Final Summary**: Comprehensive results and statistics

## Cache Management

The script uses SQLite for caching (`streams_prefetcher_prefetch_cache.db`):

- **Purpose**: Avoid redundant prefetch requests
- **Default Validity**: 3 days (259200 seconds)
- **Automatic Cleanup**: Expired entries are ignored
- **Manual Cleanup**: Delete the `.db` file to reset cache

## Performance Tips

**For Large Catalogs:**
- Use per-catalog limits to prevent individual catalogs from consuming the entire budget
- Consider using `--randomize-catalog-processing` for variety

**For Rate-Limited Addons:**
- Increase `--delay` (e.g., 500ms-2s)
- Use conservative limits to avoid overwhelming the addon

**For Multiple Addons:**
- Use separate catalog and stream addons if available for better performance
- Consider proxy rotation for high-volume prefetching

## Troubleshooting

### Common Issues

**Script exits immediately:**
- Check addon URLs are accessible
- Verify addon types are correct (`catalog`, `stream`, or `both`)

**No items being prefetched:**
- Addon may require authentication
- Check if catalogs contain supported content types
- Verify limits aren't too restrictive

**Slow performance:**
- Reduce delay if addon can handle faster requests
- Check network connectivity
- Consider using proxy if regional restrictions apply

### Debug Information

The script provides detailed statistics including:
- Success rates for prefetch requests
- Number of errors encountered
- Cache hit rates
- Processing times per catalog

## Examples for Different Use Cases

### Daily Maintenance Run
```bash
python streams_prefetcher.py \
  --addon-urls both:https://your-addon.com \
  --movies-global-limit 50 \
  --series-global-limit 10 \
  --delay 200ms
```

### Weekly Deep Prefetch
```bash
python streams_prefetcher.py \
  --addon-urls both:https://your-addon.com \
  --movies-global-limit 500 \
  --series-global-limit 100 \
  --randomize-catalog-processing \
  --cache-validity-seconds 604800
```

### Testing New Addon
```bash
python streams_prefetcher.py \
  --addon-urls both:https://new-addon.com \
  --movies-global-limit 10 \
  --series-global-limit 3 \
  --movies-per-catalog 5 \
  --series-per-catalog 2
```

## Security Considerations

- **Proxy Usage**: Only use trusted proxies
- **Rate Limiting**: Respect addon rate limits to avoid being blocked
- **Network Security**: Script makes HTTP requests; ensure network security
- **Self-Hosted Only**: This tool is designed for self-hosted addons. Do not use against public addons.

## License

This project is licensed under the GNU General Public License v3.0 - see the LICENSE file for details.