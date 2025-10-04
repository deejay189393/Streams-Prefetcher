# Streams Prefetcher

A modern web-based tool that warms up **self-hosted Stremio addon caches** by prefetching streams. Makes addon cache prefetching accessible to all users through an intuitive browser interface with real-time monitoring and scheduling capabilities.

> **⚠️ IMPORTANT:** This tool is designed for **self-hosted addons only**. Running this against public addons will unnecessarily increase server load without any benefit, as public addons typically don't cache per-user.

## Features

### 🎯 What's New in v0.8

- **Modern Web Interface**: Clean, responsive design accessible from any device
- **Real-Time Monitoring**: Live progress updates and output streaming during prefetch jobs
- **Flexible Job Scheduling**: Configure multiple recurring schedules with day/time selectors
- **Catalog Management**: Load, select, and reorder catalogs with drag-and-drop
- **Completion Statistics**: Detailed post-job analytics with graphs, timelines, and processing rates
- **Smart Addon URL Management**: Automatic manifest fetching, URL validation, and name caching
- **State Persistence**: All configurations and selections persist across sessions
- **Log Viewer**: Built-in log file viewer with search, view, and delete capabilities
- **Mobile Debug Panel**: Hidden debug panel for troubleshooting on mobile devices
- **Docker-Based**: Easy deployment with Docker Compose
- **Lightweight & Efficient**: Optimized for minimal resource usage

### 🚀 Core Features

- **Intuitive Configuration**: User-friendly forms for all parameters
- **Drag-and-Drop**: Reorder addon URLs and catalogs with ease
- **Visual Progress Tracking**: See exactly what's happening in real-time
- **Job Control**: Start, stop, and schedule prefetch jobs
- **Multi-Addon Support**: Separate catalog and stream addons with flexible configuration
- **Time-Based Limits**: Set execution time limits and delays with human-readable formats (supports unlimited values)
- **Persistent State**: Jobs continue running even if you close the browser
- **Reset Functionality**: Clear configurations and log files with one click (preserves database)
- **Catalog Filtering**: Advanced filtering options for catalog selection
- **Log Management**: View, search, and delete log files directly from the UI

## Screenshots

(Will be added soon)

## Architecture

```
┌─────────────────┐
│   Web Browser   │
│   (Frontend)    │
└────────┬────────┘
         │ HTTP/SSE
┌────────▼────────┐
│  Flask Backend  │
│  (API Server)   │
├─────────────────┤
│ Job Scheduler   │
│  (APScheduler)  │
├─────────────────┤
│ Config Manager  │
│   (JSON/SQLite) │
├─────────────────┤
│    Prefetcher   │
│  (Core Logic)   │
└─────────────────┘
```

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- A domain or subdomain pointed to your server (optional, e.g., `streams-prefetcher.yourdomain.com`)
- Self-hosted Stremio addon(s) to prefetch from

### Installation

1. **Clone the repository** (or pull the latest changes):
   ```bash
   git clone https://github.com/yourusername/Streams-Prefetcher.git
   cd Streams-Prefetcher
   ```

2. **Configure environment variables** (optional):
   ```bash
   cp .env.example .env
   # Edit .env to set your configuration
   ```

3. **Start the application**:
   ```bash
   docker compose up -d
   ```

4. **Access the web interface**:
   - Direct access: `http://your-server-ip:5000`
   - With domain: Configure your reverse proxy (see below)

### Environment Variables

Create a `.env` file (copy from `.env.example`) to customize:

| Variable | Default | Description |
|----------|---------|-------------|
| `STREAMS_PREFETCHER_HOSTNAME` | Required for Traefik | Hostname for reverse proxy routing |
| `DOCKER_DATA_DIR` | Required | Directory for persistent data storage |
| `PORT` | 5000 | Port the application runs on |
| `TZ` | UTC | Timezone for logs and scheduled jobs |
| `LOG_LEVEL` | INFO | Logging verbosity (DEBUG, INFO, WARNING, ERROR, CRITICAL) |

**Example `.env`:**
```bash
STREAMS_PREFETCHER_HOSTNAME=streams-prefetcher.yourdomain.com
DOCKER_DATA_DIR=/opt/docker-data
PORT=5000
TZ=America/New_York
LOG_LEVEL=INFO
```

### Reverse Proxy Configuration (Nginx)

If you're using Nginx as a reverse proxy:

```nginx
server {
    listen 80;
    server_name streams-prefetcher.yourdomain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # For Server-Sent Events (SSE)
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
    }
}
```

### Reverse Proxy Configuration (Traefik)

The labels in `compose.yaml` already include Traefik configuration. Ensure you set the `STREAMS_PREFETCHER_HOSTNAME` environment variable:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.streams-prefetcher.rule=Host(`${STREAMS_PREFETCHER_HOSTNAME?}`)"
  - "traefik.http.routers.streams-prefetcher.entrypoints=websecure"
  - "traefik.http.routers.streams-prefetcher.tls.certresolver=letsencrypt"
  - "traefik.http.routers.streams-prefetcher.middlewares=authelia@docker"
```

**Note:** The Authelia middleware is included for authentication. Remove this line if you're not using Authelia.

## User Guide

### 1. Configuration

#### Addon URLs
Configure your addon URLs in three categories:
- **Both**: Addons used for both catalog and stream endpoints
- **Catalog Only**: Addons used only to fetch catalog data
- **Stream Only**: Addons used only to prefetch streams

**Features**:
- Add unlimited addon URLs
- Drag and drop URLs between categories
- Reorder URLs within categories
- Automatic manifest fetching and validation

#### Limits
Set global and per-catalog limits:
- **Movies Global Limit**: Total movies to prefetch across all catalogs (-1 for unlimited)
- **Series Global Limit**: Total series to prefetch across all catalogs (-1 for unlimited)
- **Movies per Catalog**: Max movies from each movie catalog (-1 for unlimited)
- **Series per Catalog**: Max series from each series catalog (-1 for unlimited)
- **Items per Mixed Catalog**: Max items from catalogs with both movies and series (-1 for unlimited)

#### Time-Based Parameters
- **Delay Between Requests**: Delay between each stream request (prevent rate limiting). Can be set to 0 for no delay
- **Cache Validity**: How long to consider cached items valid. Set to -1 for unlimited (never expire)
- **Max Execution Time**: Maximum time for a prefetch run. Set to -1 for unlimited

Format: Enter a number and select the unit (milliseconds, seconds, minutes, hours, days, weeks). All time-based parameters support unlimited values (-1)

#### Advanced Options
- **HTTP Proxy**: Route requests through a proxy (optional)
- **Randomize Catalog Processing**: Process catalogs in random order
- **Randomize Item Prefetching**: Process items within catalogs in random order
- **Enable Logging**: Save detailed logs to `data/logs/` directory

#### Reset Configuration
- **Reset to Defaults**: Click the reset button to restore all settings to default values
- **What Gets Cleared**:
  - All configuration settings (addon URLs, limits, time parameters, etc.)
  - All log files
  - Addon name cache
  - Active schedules
- **What's Preserved**:
  - Prefetch cache database (streams_prefetcher_prefetch_cache.db)
  - Data directory structure

**Note**: Reset is irreversible. The prefetch cache database is intentionally preserved as it contains valuable cached stream data.

### 2. Catalog Selection

1. Click **Load Catalogs** to fetch all available catalogs from your configured addons
2. Review the list of catalogs (shows catalog name, type, and source addon)
3. Use checkboxes to enable/disable specific catalogs
4. Drag and drop catalogs to change processing order
5. Click **Save Catalog Selection** to persist your choices

**Features**:
- Multi-addon support with source identification
- Visual type indicators (Movie, Series, Mixed)
- Drag-and-drop reordering
- Enable/disable individual catalogs
- Advanced filtering options

### 3. Job Scheduling

Configure recurring prefetch jobs with a visual schedule editor:

**Creating Schedules**:
1. Enable scheduling with the toggle switch
2. Click "Add Schedule" to create a new schedule
3. Select a time (24-hour format)
4. Select days of the week (Sun-Sat)
5. Save the schedule

**Managing Schedules**:
- Create multiple schedules with different day/time combinations
- Edit existing schedules by clicking the edit button
- Delete individual schedules or clear all schedules at once
- Schedules are displayed in 12-hour format with AM/PM

**Examples**:
- Daily at 2:00 AM: Select all days, time 02:00
- Weekdays at 3:00 AM: Select Mon-Fri, time 03:00
- Twice daily: Create two schedules (e.g., 02:00 and 14:00)
- Weekends only: Select Sat-Sun, time 10:00

### 4. Running Jobs

#### Manual Execution
Click **Run Prefetch Now** to start a job immediately.

#### Scheduled Execution
Jobs will run automatically based on your configured schedule.

#### Real-Time Monitoring
When a job is running, you'll see:
- Current catalog being processed
- Progress bars for catalogs and items
- Catalog-specific statistics (Movies/Series fetched per catalog)
- Live output from the prefetcher
- Timing information and ETA
- Success/failure statistics

#### Completion Statistics
After a job completes, view detailed analytics:
- **Timing Overview**: Start time, end time, total duration, processing time
- **Statistics Summary**: Total catalogs, movies, series, pages processed, cache hits, success rate
- **Processing Rates**: Movies per minute, series per minute, overall processing speed
- **Catalog Timeline**: Visual timeline graph showing when each catalog was processed
- **Catalog Details**: Detailed breakdown of each catalog with processing stats

#### Job Control
- **Cancel Job**: Stop a running job gracefully
- Jobs continue running even if you close the browser
- Configurations cannot be modified while a job is running

### 5. Log Viewer

Access and manage log files directly from the web interface:

**Features**:
- **List Log Files**: View all prefetch log files sorted by date (most recent first)
- **View Logs**: Click on any log file to view its contents in a dedicated viewer
- **Delete Logs**: Remove individual log files or delete all logs at once
- **File Information**: See file size and modification date for each log

**Usage**:
1. Enable logging in the Configuration section
2. Run a prefetch job
3. Open the Log Viewer section
4. Click "Load Log Files" to see available logs
5. Click on a log file name to view its contents
6. Use the delete buttons to remove unwanted logs

**Note**: Log files contain detailed execution information useful for debugging and monitoring.

### 6. Mobile Debug Panel

A hidden debugging tool for troubleshooting on mobile devices:

**Access**:
- Long-press the ⚡ lightning bolt in the page title for ~1 second
- Panel toggles on/off with vibration feedback
- State persists in browser's localStorage

**Features**:
- **Timestamped Logs**: Each entry shows time and elapsed seconds
- **Screen State Tracking**: Monitor which status screen is currently visible
- **API Logging**: Track requests and responses
- **Copy Function**: One-click button to copy all logs to clipboard
- **Auto-scroll**: Automatically scrolls to latest entries

**Use Cases**:
- Debug issues on mobile devices without access to browser console
- Share logs easily with support/developers
- Monitor real-time state changes during job execution

### 7. Data Persistence

All data is stored in the `data/` directory:
```
data/
├── config/
│   └── config.json          # Configuration and catalog selection
├── db/
│   └── streams_prefetcher_prefetch_cache.db  # Prefetch cache
└── logs/                     # Log files (if logging enabled)
    └── streams_prefetcher_logs_*.txt
```

This directory is mounted as a Docker volume, ensuring data persists across container restarts.

## Configuration Reference

### Default Values

| Parameter | Default | Description |
|-----------|---------|-------------|
| Movies Global Limit | -1 (Unlimited) | Total movies to prefetch |
| Series Global Limit | -1 (Unlimited) | Total series to prefetch |
| Movies per Catalog | 50 | Max movies per catalog |
| Series per Catalog | 3 | Max series per catalog |
| Items per Mixed Catalog | 20 | Max items per mixed catalog |
| Delay | 2 seconds | Delay between requests (0 = no delay) |
| Cache Validity | 7 days | Cache validity period (-1 = unlimited) |
| Max Execution Time | 90 minutes | Max runtime for jobs (-1 = unlimited) |
| Randomize Catalogs | Disabled | Randomize catalog order |
| Randomize Items | Disabled | Randomize item order |
| Logging | Disabled | Enable detailed logging |

### Parameter Guidelines

#### For Testing
```
Movies Global Limit: 20
Series Global Limit: 5
Movies per Catalog: 10
Series per Catalog: 2
Delay: 200ms
```

#### For Daily Maintenance
```
Movies Global Limit: 200
Series Global Limit: 15
Movies per Catalog: 50
Series per Catalog: 5
Delay: 100ms
Max Execution Time: 30 minutes
```

#### For Aggressive Prefetching
```
Movies Global Limit: 1000
Series Global Limit: 200
Movies per Catalog: 100
Series per Catalog: 20
Delay: 50ms
Cache Validity: 7 days
```

## Troubleshooting

### Container Won't Start

Check logs:
```bash
docker compose logs streams-prefetcher
```

Ensure port 5000 is available:
```bash
sudo netstat -tlnp | grep 5000
```

### Can't Access Web Interface

1. Check container is running: `docker ps`
2. Verify firewall allows port 5000
3. Check reverse proxy configuration
4. Review nginx/traefik logs

### Job Fails to Start

1. Verify addon URLs are accessible
2. Check addon URLs have correct format
3. Ensure at least one addon URL is configured
4. Review logs in `data/logs/` (if logging is enabled)

### Real-Time Updates Not Working

1. Check browser console for errors
2. Verify SSE connection in Network tab
3. Ensure reverse proxy allows SSE (no buffering)
4. Try refreshing the page

### Configuration Not Saving

1. Check `data/config/` directory permissions
2. Ensure disk space is available
3. Review container logs for errors
4. Verify JSON format in `config.json`

## Performance Optimization

### Resource Limits

Adjust in `compose.yaml`:
```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 1G
    reservations:
      cpus: '0.5'
      memory: 256M
```

### Worker Configuration

For high-concurrency, edit Dockerfile CMD:
```dockerfile
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "--threads", "8", ...]
```

### Delay Configuration

For rate-limited addons:
- Increase delay between requests
- Use randomization to spread load
- Consider running during off-peak hours

## Security Considerations

### Access Control

Since this version doesn't include built-in authentication, protect access using:

1. **Reverse Proxy Authentication** (Nginx):
   ```nginx
   auth_basic "Restricted Access";
   auth_basic_user_file /etc/nginx/.htpasswd;
   ```

2. **Authelia** (recommended for advanced use):
   - Integrates with Traefik/Nginx
   - Provides 2FA, SSO, and access policies
   - Already configured in compose.yaml Traefik labels

3. **VPN/Tailscale**:
   - Access only via private network
   - No public exposure

4. **Firewall Rules**:
   - Restrict access to specific IPs
   - Use fail2ban for brute force protection

### HTTPS

Always use HTTPS in production:
- Configure Let's Encrypt with Traefik
- Use Certbot with Nginx
- Terminate SSL at reverse proxy level

## Upgrading

### Updating Streams Prefetcher

```bash
git pull origin main
docker compose down
docker compose build --no-cache
docker compose up -d
```

Your data in the `data/` directory will be preserved. Configuration and catalog selections will remain intact.

## Development

### Project Structure

```
Streams-Prefetcher/
├── src/
│   ├── __init__.py                     # Package version (v0.8)
│   ├── web_app.py                      # Flask application & API server
│   ├── job_scheduler.py                # Job scheduling with APScheduler
│   ├── config_manager.py               # Configuration persistence
│   ├── catalog_filter.py               # Catalog filtering logic
│   ├── logger.py                       # Logging infrastructure
│   ├── streams_prefetcher.py           # Core prefetcher logic
│   ├── streams_prefetcher_filtered.py  # Filtered prefetcher variant
│   └── streams_prefetcher_wrapper.py   # Wrapper for programmatic use
├── web/
│   ├── index.html                      # Frontend HTML
│   ├── css/
│   │   └── style.css                   # Styles
│   └── js/
│       └── app.js                      # Frontend JavaScript (includes debug panel)
├── data/                               # Persistent data (created at runtime)
│   ├── config/
│   │   └── config.json                 # All configurations
│   ├── db/
│   │   └── streams_prefetcher_prefetch_cache.db
│   └── logs/
│       └── streams_prefetcher_logs_*.txt
├── Dockerfile                          # Docker build instructions
├── compose.yaml                        # Docker Compose configuration
├── requirements.txt                    # Python dependencies
└── .env.example                        # Environment variables template
```

### Running Locally (Development)

```bash
# Install dependencies
pip install -r requirements.txt

# Run the application
cd src
python web_app.py

# Access at http://localhost:5000
```

### Building Custom Image

```bash
docker build -t stremio-prefetcher:custom .
```

## API Documentation

Streams Prefetcher uses a REST API for all operations. Full API documentation:

### Endpoints

#### Configuration
- `GET /api/config` - Get current configuration
- `POST /api/config` - Update configuration
- `POST /api/config/reset` - Reset configuration to defaults

#### Catalogs
- `POST /api/catalogs/load` - Load catalogs from addons
- `GET /api/catalogs/selection` - Get saved catalog selection
- `POST /api/catalogs/selection` - Save catalog selection

#### Addon Management
- `POST /api/addon/manifest` - Fetch addon manifest from URL

#### Scheduling
- `GET /api/schedule` - Get schedule information
- `POST /api/schedule` - Update schedule
- `DELETE /api/schedule` - Disable schedule

#### Job Control
- `GET /api/job/status` - Get job status
- `POST /api/job/run` - Run job manually
- `POST /api/job/cancel` - Cancel running job
- `GET /api/job/output` - Get job output logs

#### Log Management
- `GET /api/logs` - List all log files
- `GET /api/logs/<filename>` - Get content of a specific log file
- `DELETE /api/logs/<filename>` - Delete a specific log file
- `DELETE /api/logs` - Delete all log files

#### Real-Time Updates
- `GET /api/events` - Server-Sent Events for real-time updates

#### Health
- `GET /api/health` - Health check endpoint

## Support

For issues, questions, or contributions:
- GitHub Issues: [Create an issue](https://github.com/yourusername/Streams-Prefetcher/issues)
- Documentation: See README.md for CLI version details

## License

GNU General Public License v3.0 - See LICENSE file for details

## Credits

Built with:
- Flask (Python web framework)
- APScheduler (Job scheduling)
- Vanilla JavaScript (No heavy frameworks)
- Docker (Containerization)

---

**Made with ❤️ for the Stremio Addons community**
