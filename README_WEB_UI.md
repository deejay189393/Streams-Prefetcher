# Streams Prefetcher - Web UI Version

A modern web-based interface for the Streams Prefetcher, designed to work with **Stremio addons**. Makes addon cache prefetching accessible to all users through an intuitive browser interface with real-time monitoring and scheduling capabilities.

> **⚠️ IMPORTANT:** This tool is designed for **self-hosted addons only**. Running this against public addons will unnecessarily increase server load without any benefit, as public addons typically don't cache per-user.

## Features

### 🎯 What's New in v2.0 (Web UI)

- **Modern Web Interface**: Clean, responsive design accessible from any device
- **Real-Time Monitoring**: Live progress updates and output streaming during prefetch jobs
- **Job Scheduling**: Configure recurring prefetch jobs using cron-like expressions
- **Catalog Management**: Load, select, and reorder catalogs with drag-and-drop
- **State Persistence**: All configurations and selections persist across sessions
- **Docker-Based**: Easy deployment with Docker Compose
- **Lightweight & Efficient**: Optimized for minimal resource usage

### 🚀 Core Features

- **Intuitive Configuration**: User-friendly forms for all parameters
- **Drag-and-Drop**: Reorder addon URLs and catalogs with ease
- **Visual Progress Tracking**: See exactly what's happening in real-time
- **Job Control**: Start, stop, and schedule prefetch jobs
- **Multi-Addon Support**: Separate catalog and stream addons with flexible configuration
- **Time-Based Limits**: Set execution time limits and delays with human-readable formats
- **Persistent State**: Jobs continue running even if you close the browser

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
- A domain or subdomain pointed to your server (e.g., `streams-prefetcher.yourdomain.com`)
- Self-hosted Stremio addon(s) to prefetch from

### Installation

1. **Clone the repository** (or pull the latest changes):
   ```bash
   git clone https://github.com/yourusername/Stremio-Streams-Prefetcher.git
   cd Stremio-Streams-Prefetcher
   git checkout web-ui
   ```

2. **Start the application**:
   ```bash
   docker-compose up -d
   ```

3. **Access the web interface**:
   - Direct access: `http://your-server-ip:5000`
   - With domain: Configure your reverse proxy (see below)

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

If you're using Traefik, uncomment and configure the labels in `docker-compose.yml`:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.streams-prefetcher.rule=Host(`streams-prefetcher.yourdomain.com`)"
  - "traefik.http.routers.streams-prefetcher.entrypoints=websecure"
  - "traefik.http.routers.streams-prefetcher.tls=true"
  - "traefik.http.routers.streams-prefetcher.tls.certresolver=letsencrypt"
  - "traefik.http.services.streams-prefetcher.loadbalancer.server.port=5000"
```

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

#### Limits
Set global and per-catalog limits:
- **Movies Global Limit**: Total movies to prefetch across all catalogs (-1 for unlimited)
- **Series Global Limit**: Total series to prefetch across all catalogs (-1 for unlimited)
- **Movies per Catalog**: Max movies from each movie catalog (-1 for unlimited)
- **Series per Catalog**: Max series from each series catalog (-1 for unlimited)
- **Items per Mixed Catalog**: Max items from catalogs with both movies and series (-1 for unlimited)

#### Time-Based Parameters
- **Delay Between Requests**: Delay between each stream request (prevent rate limiting)
- **Cache Validity**: How long to consider cached items valid
- **Max Execution Time**: Maximum time for a prefetch run (-1 for unlimited)

Format: Enter a number and select the unit (milliseconds, seconds, minutes, hours, days, weeks)

#### Advanced Options
- **HTTP Proxy**: Route requests through a proxy (optional)
- **Randomize Catalog Processing**: Process catalogs in random order
- **Randomize Item Prefetching**: Process items within catalogs in random order
- **Enable Logging**: Save detailed logs to `data/logs/` directory

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

### 3. Job Scheduling

Configure recurring prefetch jobs using cron expressions:

**Examples**:
- `0 2 * * *` - Daily at 2:00 AM
- `0 */6 * * *` - Every 6 hours
- `0 0 * * 0` - Weekly on Sunday at midnight
- `0 3 * * 1-5` - Weekdays at 3:00 AM

**Format**: `minute hour day month weekday`
- minute: 0-59
- hour: 0-23
- day: 1-31
- month: 1-12
- weekday: 0-7 (0 or 7 is Sunday)

### 4. Running Jobs

#### Manual Execution
Click **Run Prefetch Now** to start a job immediately.

#### Scheduled Execution
Jobs will run automatically based on your configured schedule.

#### Real-Time Monitoring
When a job is running, you'll see:
- Current catalog being processed
- Progress bars for catalogs and items
- Live output from the prefetcher
- Timing information and ETA
- Success/failure statistics

#### Job Control
- **Cancel Job**: Stop a running job gracefully
- Jobs continue running even if you close the browser
- Configurations cannot be modified while a job is running

### 5. Data Persistence

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
| Delay | 2 seconds | Delay between requests |
| Cache Validity | 3 days | Cache validity period |
| Max Execution Time | 90 minutes | Max runtime for jobs |
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
docker-compose logs streams-prefetcher
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

Adjust in `docker-compose.yml`:
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

### From CLI to Web UI

Your existing cache database will work with the web UI version. The configuration will need to be re-entered through the web interface on first launch.

### Updating the Web UI

```bash
git pull origin web-ui
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

Your data in the `data/` directory will be preserved.

## Development

### Project Structure

```
Stremio-Streams-Prefetcher/
├── src/
│   ├── web_app.py               # Flask application
│   ├── job_scheduler.py         # Job scheduling
│   ├── config_manager.py        # Configuration persistence
│   ├── streams_prefetcher.py    # Core prefetcher logic
│   └── streams_prefetcher_wrapper.py  # Wrapper for programmatic use
├── web/
│   ├── index.html               # Frontend HTML
│   ├── css/
│   │   └── style.css            # Styles
│   └── js/
│       └── app.js               # Frontend JavaScript
├── data/                        # Persistent data (created at runtime)
├── Dockerfile                   # Docker build instructions
├── docker-compose.yml           # Docker Compose configuration
└── requirements.txt             # Python dependencies
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

The web UI uses a REST API for all operations. Full API documentation:

### Endpoints

- `GET /api/config` - Get current configuration
- `POST /api/config` - Update configuration
- `POST /api/catalogs/load` - Load catalogs from addons
- `POST /api/catalogs/selection` - Save catalog selection
- `GET /api/schedule` - Get schedule information
- `POST /api/schedule` - Update schedule
- `DELETE /api/schedule` - Disable schedule
- `GET /api/job/status` - Get job status
- `POST /api/job/run` - Run job manually
- `POST /api/job/cancel` - Cancel running job
- `GET /api/events` - Server-Sent Events for real-time updates
- `GET /api/health` - Health check

## Support

For issues, questions, or contributions:
- GitHub Issues: [Create an issue](https://github.com/yourusername/Stremio-Streams-Prefetcher/issues)
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

**Made with ❤️ for the Stremio community**
