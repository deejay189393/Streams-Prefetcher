"""
Job Scheduler
Manages prefetch job execution and scheduling using APScheduler
"""

import threading
import time
import sys
import io
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Callable
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from croniter import croniter
import pytz

from config_manager import ConfigManager
from streams_prefetcher_wrapper import StreamsPrefetcherWrapper


class JobStatus:
    """Job status constants"""
    IDLE = "idle"
    SCHEDULED = "scheduled"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobScheduler:
    """Manages job scheduling and execution"""

    def __init__(self, config_manager: ConfigManager):
        self.config_manager = config_manager
        self.scheduler = BackgroundScheduler(timezone=pytz.UTC)
        self.scheduler.start()

        # Job state
        self.current_job = None
        self.job_thread = None
        self.job_status = JobStatus.IDLE
        self.job_start_time = None
        self.job_end_time = None
        self.job_error = None

        # Live output buffer
        self.output_lines = []
        self.output_lock = threading.Lock()
        self.max_output_lines = 1000  # Keep last 1000 lines

        # Progress tracking
        self.progress_data = {}
        self.progress_lock = threading.Lock()

        # Callbacks for real-time updates
        self.status_callbacks = []

        # Initialize scheduled job from config
        self._load_scheduled_job()

    def register_callback(self, callback: Callable):
        """Register a callback for status updates"""
        self.status_callbacks.append(callback)

    def _notify_callbacks(self, event_type: str, data: Dict[str, Any]):
        """Notify all registered callbacks"""
        for callback in self.status_callbacks:
            try:
                callback(event_type, data)
            except Exception as e:
                print(f"Error in callback: {e}")

    def _load_scheduled_job(self):
        """Load scheduled job from configuration"""
        schedule_config = self.config_manager.get('schedule', {})
        if schedule_config.get('enabled', False):
            self.update_schedule(
                schedule_config['cron_expression'],
                schedule_config.get('timezone', 'UTC')
            )

    def update_schedule(self, cron_expression: str, timezone_str: str = 'UTC'):
        """Update the scheduled job"""
        try:
            # Validate cron expression
            if not croniter.is_valid(cron_expression):
                raise ValueError(f"Invalid cron expression: {cron_expression}")

            # Remove existing job if any
            if self.scheduler.get_job('prefetch_job'):
                self.scheduler.remove_job('prefetch_job')

            # Add new job
            tz = pytz.timezone(timezone_str)
            trigger = CronTrigger.from_crontab(cron_expression, timezone=tz)
            self.scheduler.add_job(
                self.run_job,
                trigger=trigger,
                id='prefetch_job',
                name='Scheduled Prefetch Job',
                replace_existing=True
            )

            # Update config
            self.config_manager.update({
                'schedule': {
                    'enabled': True,
                    'cron_expression': cron_expression,
                    'timezone': timezone_str
                }
            })

            return True
        except Exception as e:
            print(f"Error updating schedule: {e}")
            return False

    def disable_schedule(self):
        """Disable scheduled job"""
        if self.scheduler.get_job('prefetch_job'):
            self.scheduler.remove_job('prefetch_job')

        self.config_manager.update({
            'schedule': {
                'enabled': False,
                'cron_expression': '',
                'timezone': 'UTC'
            }
        })

    def get_next_run_time(self) -> Optional[datetime]:
        """Get next scheduled run time"""
        job = self.scheduler.get_job('prefetch_job')
        if job:
            return job.next_run_time
        return None

    def run_job(self, manual: bool = False):
        """Run a prefetch job"""
        if self.job_status == JobStatus.RUNNING:
            return False, "Job is already running"

        # Clear previous state
        with self.output_lock:
            self.output_lines = []

        with self.progress_lock:
            self.progress_data = {}

        self.job_status = JobStatus.RUNNING
        self.job_start_time = time.time()
        self.job_end_time = None
        self.job_error = None

        # Notify status change
        self._notify_callbacks('status_change', {
            'status': self.job_status,
            'start_time': self.job_start_time
        })

        # Start job in background thread
        self.job_thread = threading.Thread(target=self._execute_job, args=(manual,))
        self.job_thread.daemon = True
        self.job_thread.start()

        return True, "Job started successfully"

    def _execute_job(self, manual: bool):
        """Execute the prefetch job (runs in background thread)"""
        try:
            # Capture stdout to get live output
            old_stdout = sys.stdout
            output_capture = io.StringIO()
            sys.stdout = output_capture

            # Create wrapper and run
            wrapper = StreamsPrefetcherWrapper(
                self.config_manager,
                progress_callback=self._update_progress,
                output_callback=self._append_output
            )

            success = wrapper.run()

            # Restore stdout
            sys.stdout = old_stdout

            # Get captured output
            captured = output_capture.getvalue()
            if captured:
                self._append_output(captured)

            # Update status
            self.job_status = JobStatus.COMPLETED if success else JobStatus.FAILED
            self.job_end_time = time.time()

            # Notify completion
            self._notify_callbacks('job_complete', {
                'status': self.job_status,
                'start_time': self.job_start_time,
                'end_time': self.job_end_time,
                'duration': self.job_end_time - self.job_start_time,
                'success': success
            })

        except Exception as e:
            # Restore stdout
            sys.stdout = old_stdout

            self.job_status = JobStatus.FAILED
            self.job_end_time = time.time()
            self.job_error = str(e)

            self._notify_callbacks('job_error', {
                'status': self.job_status,
                'error': self.job_error,
                'start_time': self.job_start_time,
                'end_time': self.job_end_time
            })

    def _append_output(self, text: str):
        """Append output text to buffer"""
        with self.output_lock:
            lines = text.split('\n')
            self.output_lines.extend(lines)

            # Keep only last N lines
            if len(self.output_lines) > self.max_output_lines:
                self.output_lines = self.output_lines[-self.max_output_lines:]

        # Notify callbacks
        self._notify_callbacks('output', {'lines': lines})

    def _update_progress(self, progress: Dict[str, Any]):
        """Update progress data"""
        with self.progress_lock:
            self.progress_data.update(progress)

        # Notify callbacks
        self._notify_callbacks('progress', progress)

    def get_output(self, from_line: int = 0) -> Dict[str, Any]:
        """Get output lines from specified line number"""
        with self.output_lock:
            total_lines = len(self.output_lines)
            lines = self.output_lines[from_line:] if from_line < total_lines else []
            return {
                'lines': lines,
                'total_lines': total_lines,
                'from_line': from_line
            }

    def get_progress(self) -> Dict[str, Any]:
        """Get current progress data"""
        with self.progress_lock:
            return self.progress_data.copy()

    def get_status(self) -> Dict[str, Any]:
        """Get current job status"""
        next_run = self.get_next_run_time()

        return {
            'status': self.job_status,
            'start_time': self.job_start_time,
            'end_time': self.job_end_time,
            'error': self.job_error,
            'next_run_time': next_run.isoformat() if next_run else None,
            'progress': self.get_progress(),
            'is_scheduled': self.scheduler.get_job('prefetch_job') is not None
        }

    def cancel_job(self):
        """Cancel running job"""
        if self.job_status == JobStatus.RUNNING:
            # Note: This is a best-effort cancellation
            # The actual job might take time to stop
            self.job_status = JobStatus.CANCELLED
            self.job_end_time = time.time()

            self._notify_callbacks('job_cancelled', {
                'status': self.job_status,
                'end_time': self.job_end_time
            })

            return True
        return False

    def shutdown(self):
        """Shutdown scheduler"""
        self.scheduler.shutdown(wait=False)
