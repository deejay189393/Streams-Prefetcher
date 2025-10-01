"""
Stremio Streams Prefetcher - Web Application
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


app = Flask(__name__, static_folder='../web', static_url_path='')
CORS(app)

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

        # Validate addon URLs if provided
        if 'addon_urls' in data:
            for item in data['addon_urls']:
                if 'url' not in item or 'type' not in item:
                    return jsonify({
                        'success': False,
                        'error': 'Each addon URL must have url and type'
                    }), 400
                if item['type'] not in ['catalog', 'stream', 'both']:
                    return jsonify({
                        'success': False,
                        'error': f"Invalid addon type: {item['type']}"
                    }), 400

        # Update configuration
        success = config_manager.update(data)

        if success:
            return jsonify({'success': True, 'config': config_manager.get_all()})
        else:
            return jsonify({'success': False, 'error': 'Failed to save configuration'}), 500

    except Exception as e:
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
                            'User-Agent': 'Stremio Streams Prefetcher Web/1.0',
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


# ============================================================================
# SCHEDULE API
# ============================================================================

@app.route('/api/schedule', methods=['GET'])
def get_schedule():
    """Get schedule information"""
    try:
        schedule_config = config_manager.get('schedule', {})
        next_run = job_scheduler.get_next_run_time()

        return jsonify({
            'success': True,
            'schedule': {
                'enabled': schedule_config.get('enabled', False),
                'cron_expression': schedule_config.get('cron_expression', ''),
                'timezone': schedule_config.get('timezone', 'UTC'),
                'next_run_time': next_run.isoformat() if next_run else None,
                'time_until_next_run': (
                    (next_run - datetime.now(next_run.tzinfo)).total_seconds()
                    if next_run else None
                )
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

        cron_expression = data.get('cron_expression')
        timezone = data.get('timezone', 'UTC')

        if not cron_expression:
            return jsonify({'success': False, 'error': 'No cron expression provided'}), 400

        # Validate cron expression
        if not croniter.is_valid(cron_expression):
            return jsonify({
                'success': False,
                'error': 'Invalid cron expression'
            }), 400

        # Update schedule
        success = job_scheduler.update_schedule(cron_expression, timezone)

        if success:
            next_run = job_scheduler.get_next_run_time()
            return jsonify({
                'success': True,
                'next_run_time': next_run.isoformat() if next_run else None
            })
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
        success, message = job_scheduler.run_job(manual=True)

        if success:
            return jsonify({'success': True, 'message': message})
        else:
            return jsonify({'success': False, 'error': message}), 400

    except Exception as e:
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
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
