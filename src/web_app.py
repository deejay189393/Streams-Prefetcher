"""
Streams Prefetcher - Web Application
Flask backend providing REST API and SSE for real-time updates
"""

import os
import sys
import json
import time
import queue
import requests
from datetime import datetime
from typing import Dict, Any
from flask import Flask, jsonify, request, send_from_directory, Response
from flask_cors import CORS
from croniter import croniter

# Add src directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config_manager import ConfigManager
from job_scheduler import JobScheduler, JobStatus
from logger import setup_logging, get_logger

# Initialize logging
setup_logging()
logger = get_logger('web_app')

app = Flask(__name__, static_folder='../web', static_url_path='')
CORS(app)

# Suppress Flask's default logging, use our logger instead
import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.WARNING)

# Initialize managers
config_manager = ConfigManager()
job_scheduler = JobScheduler(config_manager)

# Event queues for SSE
event_queues = []


def broadcast_event(event_type: str, data: Dict[str, Any]):
    """Broadcast event to all SSE clients"""
    for q in event_queues:
        try:
            q.put({'event': event_type, 'data': data}, block=False)
        except queue.Full:
            pass


# Register callback with job scheduler
job_scheduler.register_callback(broadcast_event)


# ============================================================================
# VALIDATION FUNCTIONS
# ============================================================================

def validate_addon_urls(addon_urls):
    """Validate addon URLs list"""
    errors = []

    if not addon_urls or len(addon_urls) == 0:
        errors.append('At least one addon URL is required')
        return errors

    # Check for at least one catalog addon
    has_catalog = any(item['type'] in ['catalog', 'both'] for item in addon_urls)
    if not has_catalog:
        errors.append('At least one catalog addon (type "catalog" or "both") is required')

    # Check for at least one stream addon
    has_stream = any(item['type'] in ['stream', 'both'] for item in addon_urls)
    if not has_stream:
        errors.append('At least one stream addon (type "stream" or "both") is required')

    # Validate each URL
    for idx, item in enumerate(addon_urls):
        if not item.get('url'):
            errors.append(f'Addon URL #{idx + 1} cannot be empty')
        elif not item['url'].strip():
            errors.append(f'Addon URL #{idx + 1} cannot be empty')

        addon_type = item.get('type', '')
        if addon_type not in ['catalog', 'stream', 'both']:
            errors.append(f'Invalid addon type for URL #{idx + 1}: {addon_type}')

    return errors

def validate_limits(config):
    """Validate limit configuration values"""
    errors = []

    limit_fields = [
        ('movies_global_limit', 'Movies Global Limit'),
        ('series_global_limit', 'Series Global Limit'),
        ('movies_per_catalog', 'Movies per Catalog'),
        ('series_per_catalog', 'Series per Catalog'),
        ('items_per_mixed_catalog', 'Items per Mixed Catalog')
    ]

    for field, name in limit_fields:
        value = config.get(field)
        if value is None:
            errors.append(f'{name} is required')
        elif not isinstance(value, int):
            errors.append(f'{name} must be an integer')
        elif value < -1:
            errors.append(f'{name} must be -1 or greater (got: {value})')

    return errors

def validate_time_fields(config):
    """Validate time-based configuration values"""
    errors = []

    # Delay must be >= 0
    delay = config.get('delay')
    if delay is None:
        errors.append('Delay is required')
    elif not isinstance(delay, (int, float)):
        errors.append('Delay must be a number')
    elif delay < 0:
        errors.append('Delay must be 0 or greater')

    # Cache validity must be non-negative or -1 for unlimited
    cache_validity = config.get('cache_validity')
    if cache_validity is None:
        errors.append('Cache validity is required')
    elif not isinstance(cache_validity, (int, float)):
        errors.append('Cache validity must be a number')
    elif cache_validity < -1:
        errors.append('Cache validity must be 0 or positive, or -1 for unlimited')

    # Max execution time must be positive or -1
    max_exec = config.get('max_execution_time')
    if max_exec is None:
        errors.append('Max execution time is required')
    elif not isinstance(max_exec, (int, float)):
        errors.append('Max execution time must be a number')
    elif max_exec < -1 or max_exec == 0:
        errors.append('Max execution time must be positive or -1 for unlimited')

    return errors

def validate_configuration(config):
    """Validate entire configuration"""
    all_errors = []

    addon_urls = config.get('addon_urls', [])
    all_errors.extend(validate_addon_urls(addon_urls))
    all_errors.extend(validate_limits(config))
    all_errors.extend(validate_time_fields(config))

    return all_errors


# ============================================================================
# STATIC FILES
# ============================================================================

@app.route('/')
def serve_index():
    """Serve the main HTML page"""
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def serve_static(path):
    """Serve static files"""
    return send_from_directory(app.static_folder, path)


# ============================================================================
# CONFIGURATION API
# ============================================================================

@app.route('/api/config', methods=['GET'])
def get_config():
    """Get current configuration"""
    try:
        config = config_manager.get_all()
        return jsonify({'success': True, 'config': config})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/config', methods=['POST'])
def update_config():
    """Update configuration"""
    try:
        # Check if job is running
        if job_scheduler.job_status == JobStatus.RUNNING:
            return jsonify({
                'success': False,
                'error': 'Cannot modify configuration while job is running'
            }), 400

        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No data provided'}), 400

        # Validate configuration
        validation_errors = validate_configuration(data)
        if validation_errors:
            return jsonify({
                'success': False,
                'error': 'Validation failed: ' + '; '.join(validation_errors)
            }), 400

        # Update configuration
        success = config_manager.update(data)

        if success:
            return jsonify({'success': True, 'config': config_manager.get_all()})
        else:
            return jsonify({'success': False, 'error': 'Failed to save configuration'}), 500

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/config/reset', methods=['POST'])
def reset_config():
    """Reset configuration to defaults and clear all data except database"""
    try:
        # Check if job is running
        if job_scheduler.job_status == JobStatus.RUNNING:
            return jsonify({
                'success': False,
                'error': 'Cannot reset configuration while job is running'
            }), 400

        # Reset configuration to defaults
        success = config_manager.reset()

        if not success:
            return jsonify({'success': False, 'error': 'Failed to reset configuration'}), 500

        # Clear addon name and logo cache
        config_manager.set('addon_name_cache', {})
        config_manager.set('addon_logo_cache', {})

        # Clear all log files (they contain addon URLs and could be a privacy issue)
        log_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'logs')
        if os.path.exists(log_dir):
            for log_file in os.listdir(log_dir):
                log_path = os.path.join(log_dir, log_file)
                if os.path.isfile(log_path) and log_file.endswith('.txt'):
                    try:
                        os.remove(log_path)
                        logger.info(f"Deleted log file: {log_file}")
                    except Exception as e:
                        logger.warning(f"Failed to delete log file {log_file}: {e}")

        # Disable any active schedule
        job_scheduler.disable_schedule()

        logger.info("Configuration reset completed - all settings cleared, database preserved")

        return jsonify({'success': True, 'config': config_manager.get_all()})

    except Exception as e:
        logger.error(f"Error during reset: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# CATALOG API
# ============================================================================

@app.route('/api/catalogs/load', methods=['POST'])
def load_catalogs():
    """Load catalogs from configured addon URLs"""
    try:
        addon_urls = config_manager.get('addon_urls', [])

        if not addon_urls:
            return jsonify({
                'success': False,
                'error': 'No addon URLs configured'
            }), 400

        catalogs = []
        errors = []

        for item in addon_urls:
            if item['type'] in ['catalog', 'both']:
                try:
                    # Fetch manifest
                    response = requests.get(
                        f"{item['url']}/manifest.json",
                        timeout=10,
                        headers={
                            'User-Agent': 'Streams Prefetcher/1.0',
                            'Accept': 'application/json'
                        }
                    )
                    response.raise_for_status()
                    manifest = response.json()

                    # Extract addon name
                    addon_name = manifest.get('name', 'Unknown Addon')

                    # Process catalogs
                    for catalog in manifest.get('catalogs', []):
                        # Skip search-only catalogs
                        extras = catalog.get('extra', [])
                        is_search_only = (
                            len(extras) == 1 and
                            extras[0].get('name') == 'search'
                        )
                        if is_search_only:
                            continue

                        # Skip unsupported types
                        cat_type = catalog.get('type', '').lower()
                        if cat_type in ['tv', 'channel']:
                            continue

                        # Rename 'all' to 'mixed'
                        if cat_type == 'all':
                            cat_type = 'mixed'

                        catalogs.append({
                            'id': f"{item['url']}|{catalog.get('id', '')}",
                            'name': catalog.get('name', 'Unknown'),
                            'type': cat_type,
                            'addon_name': addon_name,
                            'addon_url': item['url'],
                            'enabled': True,  # Default enabled
                            'order': len(catalogs)
                        })

                except Exception as e:
                    errors.append({
                        'url': item['url'],
                        'error': str(e)
                    })

        return jsonify({
            'success': True,
            'catalogs': catalogs,
            'errors': errors,
            'total_addons': len([i for i in addon_urls if i['type'] in ['catalog', 'both']]),
            'total_catalogs': len(catalogs)
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/catalogs/selection', methods=['GET'])
def get_catalog_selection():
    """Get saved catalog selection"""
    try:
        saved_catalogs = config_manager.get('saved_catalogs', [])
        return jsonify({'success': True, 'catalogs': saved_catalogs})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/catalogs/selection', methods=['POST'])
def save_catalog_selection():
    """Save catalog selection and order"""
    try:
        data = request.get_json()
        if not data or 'catalogs' not in data:
            return jsonify({'success': False, 'error': 'No catalog data provided'}), 400

        # Save full catalog data (not just selection)
        config_manager.set('saved_catalogs', data['catalogs'])

        return jsonify({'success': True})

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/catalogs/reset', methods=['POST'])
def reset_catalog_selections():
    """Reset catalog selections and clear saved catalogs from config"""
    try:
        # Clear saved catalogs from config
        config_manager.set('saved_catalogs', [])

        logger.info("Catalog selections reset - cleared all saved catalogs")

        return jsonify({'success': True, 'message': 'Catalog selections reset successfully'})

    except Exception as e:
        logger.error(f"Error resetting catalog selections: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/addon/manifest', methods=['POST'])
def fetch_addon_manifest():
    """Fetch addon manifest and extract name"""
    try:
        data = request.get_json()
        if not data or 'url' not in data:
            return jsonify({'success': False, 'error': 'No URL provided'}), 400

        addon_url = data['url'].rstrip('/')

        try:
            # Fetch manifest
            response = requests.get(
                f"{addon_url}/manifest.json",
                timeout=10,
                headers={
                    'User-Agent': 'Streams Prefetcher/1.0',
                    'Accept': 'application/json'
                }
            )
            response.raise_for_status()
            manifest = response.json()

            addon_name = manifest.get('name', 'Unknown Addon')
            addon_logo = manifest.get('logo', '')

            # Cache the addon name and logo in config
            addon_name_cache = config_manager.get('addon_name_cache', {})
            addon_name_cache[addon_url] = addon_name
            config_manager.set('addon_name_cache', addon_name_cache)

            addon_logo_cache = config_manager.get('addon_logo_cache', {})
            addon_logo_cache[addon_url] = addon_logo
            config_manager.set('addon_logo_cache', addon_logo_cache)

            return jsonify({
                'success': True,
                'name': addon_name,
                'logo': addon_logo,
                'url': addon_url
            })

        except requests.exceptions.RequestException as e:
            logger.warning(f"Failed to fetch manifest from {addon_url}: {str(e)}")
            return jsonify({
                'success': False,
                'error': f'Failed to fetch manifest: {str(e)}'
            }), 400

    except Exception as e:
        logger.error(f"Error fetching addon manifest: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# TIMEZONE API
# ============================================================================

@app.route('/api/timezone', methods=['GET'])
def get_timezone():
    """Get server timezone from TZ environment variable"""
    try:
        # Get timezone from environment, default to UTC
        tz = os.environ.get('TZ', 'UTC')

        return jsonify({
            'success': True,
            'timezone': tz
        })

    except Exception as e:
        logger.error(f"Error getting timezone: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# SCHEDULE API
# ============================================================================

@app.route('/api/schedule', methods=['GET'])
def get_schedule():
    """Get schedule information"""
    try:
        schedule_config = config_manager.get('schedule', {})

        return jsonify({
            'success': True,
            'schedule': {
                'enabled': schedule_config.get('enabled', False),
                'schedules': schedule_config.get('schedules', [])
            }
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/schedule', methods=['POST'])
def update_schedule():
    """Update schedule configuration"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No data provided'}), 400

        enabled = data.get('enabled', False)
        schedules = data.get('schedules', [])

        # Validate schedules format
        if enabled and schedules:
            for idx, schedule in enumerate(schedules):
                if 'time' not in schedule:
                    return jsonify({
                        'success': False,
                        'error': f'Schedule #{idx + 1} missing time field'
                    }), 400

                if 'days' not in schedule or not isinstance(schedule['days'], list):
                    return jsonify({
                        'success': False,
                        'error': f'Schedule #{idx + 1} missing or invalid days field'
                    }), 400

                # Validate time format (HH:MM)
                time_str = schedule['time']
                try:
                    time_parts = time_str.split(':')
                    if len(time_parts) != 2:
                        raise ValueError()
                    hour = int(time_parts[0])
                    minute = int(time_parts[1])
                    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
                        raise ValueError()
                except:
                    return jsonify({
                        'success': False,
                        'error': f'Schedule #{idx + 1} has invalid time format. Expected HH:MM'
                    }), 400

                # Validate days (0-6)
                for day in schedule['days']:
                    if not isinstance(day, int) or day < 0 or day > 6:
                        return jsonify({
                            'success': False,
                            'error': f'Schedule #{idx + 1} has invalid day value. Must be 0-6'
                        }), 400

        # Update schedule
        success = job_scheduler.update_schedules(enabled, schedules)

        if success:
            return jsonify({'success': True})
        else:
            return jsonify({'success': False, 'error': 'Failed to update schedule'}), 500

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/schedule', methods=['DELETE'])
def disable_schedule():
    """Disable scheduled jobs"""
    try:
        job_scheduler.disable_schedule()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# JOB API
# ============================================================================

@app.route('/api/job/status', methods=['GET'])
def get_job_status():
    """Get current job status"""
    try:
        status = job_scheduler.get_status()
        return jsonify({'success': True, 'status': status})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/job/run', methods=['POST'])
def run_job():
    """Run a prefetch job manually"""
    try:
        # Validate configuration before running
        config = config_manager.get_all()
        validation_errors = validate_configuration(config)
        if validation_errors:
            return jsonify({
                'success': False,
                'error': 'Configuration validation failed: ' + '; '.join(validation_errors)
            }), 400

        # Check if catalogs are available
        saved_catalogs = config_manager.get('saved_catalogs', [])
        if not saved_catalogs or len(saved_catalogs) == 0:
            return jsonify({
                'success': False,
                'error': 'No catalogs loaded. Please load catalogs first'
            }), 400

        # Check if at least one catalog is selected
        selected_catalogs = [cat for cat in saved_catalogs if cat.get('enabled', False)]
        if len(selected_catalogs) == 0:
            return jsonify({
                'success': False,
                'error': 'At least one catalog must be selected'
            }), 400

        success, message = job_scheduler.run_job(manual=True)

        if success:
            logger.info(f"Prefetch job started manually - {len(selected_catalogs)} catalogs selected")
            logger.debug(f"Selected catalogs: {[cat.get('name', 'Unknown') for cat in selected_catalogs]}")
            return jsonify({'success': True, 'message': message})
        else:
            logger.warning(f"Failed to start prefetch job: {message}")
            return jsonify({'success': False, 'error': message}), 400

    except Exception as e:
        logger.error(f"Error starting prefetch job: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/job/cancel', methods=['POST'])
def cancel_job():
    """Cancel running job"""
    try:
        success = job_scheduler.cancel_job()

        if success:
            return jsonify({'success': True, 'message': 'Job cancelled'})
        else:
            return jsonify({
                'success': False,
                'error': 'No running job to cancel'
            }), 400

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/job/pause', methods=['POST'])
def pause_job():
    """Pause running job"""
    try:
        success, message = job_scheduler.pause_job()

        if success:
            logger.info("Job paused via API")
            return jsonify({'success': True, 'message': message})
        else:
            return jsonify({'success': False, 'error': message}), 400

    except Exception as e:
        logger.error(f"Error pausing job: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/job/resume', methods=['POST'])
def resume_job():
    """Resume paused job"""
    try:
        success, message = job_scheduler.resume_job()

        if success:
            logger.info("Job resumed via API")
            return jsonify({'success': True, 'message': message})
        else:
            return jsonify({'success': False, 'error': message}), 400

    except Exception as e:
        logger.error(f"Error resuming job: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/job/output', methods=['GET'])
def get_job_output():
    """Get job output (paginated)"""
    try:
        from_line = request.args.get('from_line', 0, type=int)
        output = job_scheduler.get_output(from_line)

        return jsonify({'success': True, 'output': output})

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# SERVER-SENT EVENTS (SSE) FOR REAL-TIME UPDATES
# ============================================================================

@app.route('/api/events')
def stream_events():
    """Server-Sent Events endpoint for real-time updates"""
    def event_stream():
        # Create a queue for this client
        q = queue.Queue(maxsize=100)
        event_queues.append(q)

        try:
            # Send initial connection message
            yield f"data: {json.dumps({'event': 'connected', 'data': {}})}\n\n"

            # Send initial status
            status = job_scheduler.get_status()
            yield f"data: {json.dumps({'event': 'status', 'data': status})}\n\n"

            # Stream events
            while True:
                try:
                    event = q.get(timeout=30)  # 30 second timeout
                    yield f"data: {json.dumps(event)}\n\n"
                except queue.Empty:
                    # Send keepalive
                    yield f": keepalive\n\n"

        except GeneratorExit:
            # Client disconnected
            if q in event_queues:
                event_queues.remove(q)

    return Response(event_stream(), mimetype='text/event-stream')


# ============================================================================
# LOG FILES API
# ============================================================================

@app.route('/api/logs', methods=['GET'])
def list_logs():
    """List all log files"""
    try:
        logs_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'logs')

        if not os.path.exists(logs_dir):
            return jsonify({'success': True, 'logs': []})

        # Get all .txt files starting with streams_prefetcher_logs_
        log_files = []
        for filename in os.listdir(logs_dir):
            if filename.startswith('streams_prefetcher_logs_') and filename.endswith('.txt'):
                filepath = os.path.join(logs_dir, filename)
                stat = os.stat(filepath)
                log_files.append({
                    'filename': filename,
                    'size': stat.st_size,
                    'modified': stat.st_mtime
                })

        # Sort by modified time (most recent first)
        log_files.sort(key=lambda x: x['modified'], reverse=True)

        return jsonify({'success': True, 'logs': log_files})

    except Exception as e:
        logger.error(f"Error listing log files: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/logs/<filename>', methods=['GET'])
def get_log_content(filename):
    """Get content of a specific log file"""
    try:
        # Security: only allow files starting with streams_prefetcher_logs_
        if not filename.startswith('streams_prefetcher_logs_') or not filename.endswith('.txt'):
            return jsonify({'success': False, 'error': 'Invalid filename'}), 400

        logs_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'logs')
        filepath = os.path.join(logs_dir, filename)

        if not os.path.exists(filepath):
            return jsonify({'success': False, 'error': 'File not found'}), 404

        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        return jsonify({'success': True, 'content': content})

    except Exception as e:
        logger.error(f"Error reading log file {filename}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/logs/<filename>', methods=['DELETE'])
def delete_log(filename):
    """Delete a specific log file"""
    try:
        # Security: only allow files starting with streams_prefetcher_logs_
        if not filename.startswith('streams_prefetcher_logs_') or not filename.endswith('.txt'):
            return jsonify({'success': False, 'error': 'Invalid filename'}), 400

        logs_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'logs')
        filepath = os.path.join(logs_dir, filename)

        if not os.path.exists(filepath):
            return jsonify({'success': False, 'error': 'File not found'}), 404

        os.remove(filepath)
        logger.info(f"Deleted log file: {filename}")

        return jsonify({'success': True, 'message': f'Deleted {filename}'})

    except Exception as e:
        logger.error(f"Error deleting log file {filename}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/logs', methods=['DELETE'])
def delete_all_logs():
    """Delete all log files"""
    try:
        logs_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'logs')

        if not os.path.exists(logs_dir):
            return jsonify({'success': True, 'deleted': 0})

        deleted_count = 0
        for filename in os.listdir(logs_dir):
            if filename.startswith('streams_prefetcher_logs_') and filename.endswith('.txt'):
                filepath = os.path.join(logs_dir, filename)
                os.remove(filepath)
                deleted_count += 1

        logger.info(f"Deleted {deleted_count} log files")

        return jsonify({'success': True, 'deleted': deleted_count})

    except Exception as e:
        logger.error(f"Error deleting all log files: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# UTILITY API
# ============================================================================

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'success': True,
        'status': 'healthy',
        'timestamp': datetime.now().isoformat()
    })


# ============================================================================
# ERROR HANDLERS
# ============================================================================

@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors"""
    # For API routes, return JSON
    if request.path.startswith('/api/'):
        return jsonify({'success': False, 'error': 'Endpoint not found'}), 404

    # For other routes, serve index.html (SPA fallback)
    return send_from_directory(app.static_folder, 'index.html')


@app.errorhandler(500)
def internal_error(e):
    """Handle 500 errors"""
    return jsonify({'success': False, 'error': 'Internal server error'}), 500


# ============================================================================
# APPLICATION STARTUP
# ============================================================================

if __name__ == '__main__':
    # Ensure data directories exist
    os.makedirs('data/config', exist_ok=True)
    os.makedirs('data/db', exist_ok=True)
    os.makedirs('data/logs', exist_ok=True)

    # Run the application
    port = int(os.environ.get('PORT', 5000))
    logger.info("=" * 60)
    logger.info("STREAMS PREFETCHER - WEB APPLICATION STARTING")
    logger.info("=" * 60)
    logger.info(f"Server port: {port}")
    logger.info(f"Log level: {os.getenv('LOG_LEVEL', 'INFO')}")
    logger.info(f"Data directory: {os.path.abspath('data')}")
    logger.info("Web interface will be available at configured hostname")
    logger.info("=" * 60)

    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
