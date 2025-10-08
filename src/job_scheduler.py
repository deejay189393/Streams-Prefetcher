"""
Job Scheduler
Manages prefetch job execution and scheduling using APScheduler
"""

import threading
import time
import sys
import io
import ctypes
import os
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Callable
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from croniter import croniter
import pytz

from config_manager import ConfigManager
from streams_prefetcher_wrapper import StreamsPrefetcherWrapper
from logger import get_logger

logger = get_logger('job_scheduler')


class JobStatus:
    """Job status constants"""
    IDLE = "idle"
    SCHEDULED = "scheduled"
    RUNNING = "running"
    PAUSING = "pausing"
    PAUSED = "paused"
    RESUMING = "resuming"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobScheduler:
    """Manages job scheduling and execution"""

    def __init__(self, config_manager: ConfigManager):
        self.config_manager = config_manager

        # Get timezone from environment variable, default to UTC
        tz_name = os.environ.get('TZ', 'UTC')
        try:
            self.timezone = pytz.timezone(tz_name)
            logger.info(f"Using timezone from TZ environment variable: {tz_name}")
        except pytz.UnknownTimeZoneError:
            logger.warning(f"Unknown timezone '{tz_name}', falling back to UTC")
            self.timezone = pytz.UTC

        self.scheduler = BackgroundScheduler(timezone=self.timezone)
        self.scheduler.start()

        # Job state - Always start fresh on initialization
        self.current_job = None
        self.job_thread = None
        self.wrapper = None  # Store reference to current wrapper
        self.job_status = JobStatus.IDLE  # Reset to IDLE on startup
        self.job_start_time = None
        self.job_end_time = None
        self.job_error = None
        self.job_summary = None  # Store completion summary
        self.pause_requested = False  # Flag to request pause after current item
        self.is_paused = False  # Actual pause state flag
        self.pause_event = threading.Event()  # Efficient pause/resume signaling
        self.pause_event.set()  # Start unpaused (set = not paused)

        # Log startup state
        logger.info("JobScheduler initialized - job status reset to IDLE")

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
            schedules = schedule_config.get('schedules', [])
            if schedules:
                self.update_schedules(True, schedules)
            elif 'cron_expression' in schedule_config:
                # Legacy support for old cron-based config
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

    def update_schedules(self, enabled: bool, schedules: list):
        """Update multiple scheduled jobs from UI format"""
        try:
            # Remove all existing scheduled jobs
            for job in self.scheduler.get_jobs():
                if job.id.startswith('prefetch_job'):
                    self.scheduler.remove_job(job.id)

            if enabled and schedules:
                # Add new jobs for each schedule
                for idx, schedule in enumerate(schedules):
                    time_str = schedule['time']
                    days = schedule['days']

                    # Parse time
                    hour, minute = map(int, time_str.split(':'))

                    # Convert day numbers to cron day_of_week format
                    # UI uses: 0=Sun, 1=Mon, ..., 6=Sat
                    # Cron uses: 0=Mon, 1=Tue, ..., 6=Sun
                    # So we need to convert
                    cron_days = []
                    for day in days:
                        if day == 0:  # Sunday
                            cron_days.append(6)
                        else:  # Mon-Sat
                            cron_days.append(day - 1)

                    cron_days.sort()
                    days_str = ','.join(map(str, cron_days))

                    # Create cron trigger
                    trigger = CronTrigger(
                        day_of_week=days_str,
                        hour=hour,
                        minute=minute,
                        timezone=self.timezone
                    )

                    # Add job
                    self.scheduler.add_job(
                        self.run_job,
                        trigger=trigger,
                        id=f'prefetch_job_{idx}',
                        name=f'Scheduled Prefetch Job #{idx + 1}',
                        replace_existing=True
                    )

            # Update config
            self.config_manager.update({
                'schedule': {
                    'enabled': enabled,
                    'schedules': schedules
                }
            })

            return True
        except Exception as e:
            print(f"Error updating schedules: {e}")
            return False

    def disable_schedule(self):
        """Disable scheduled job"""
        # Remove all scheduled jobs
        for job in self.scheduler.get_jobs():
            if job.id.startswith('prefetch_job'):
                self.scheduler.remove_job(job.id)

        self.config_manager.update({
            'schedule': {
                'enabled': False,
                'schedules': []
            }
        })

    def get_next_run_time(self) -> Optional[datetime]:
        """Get next scheduled run time (earliest among all scheduled jobs)"""
        next_times = []
        for job in self.scheduler.get_jobs():
            if job.id.startswith('prefetch_job') and job.next_run_time:
                next_times.append(job.next_run_time)

        return min(next_times) if next_times else None

    def run_job(self, manual: bool = False):
        """Run a prefetch job"""
        # Check if job is actually running (not just status stuck)
        if self.job_status == JobStatus.RUNNING:
            # If thread is dead but status is stuck, reset it
            if not self.job_thread or not self.job_thread.is_alive():
                logger.warning("Job status was RUNNING but thread is dead - resetting status")
                self.job_status = JobStatus.IDLE
            else:
                return False, "Job is already running"

        # Also reset if status is CANCELLED but thread is dead
        if self.job_status == JobStatus.CANCELLED:
            if not self.job_thread or not self.job_thread.is_alive():
                logger.warning("Job status was CANCELLED but thread is dead - resetting status")
                self.job_status = JobStatus.IDLE
            else:
                return False, "Job is being cancelled"

        # Clear previous state
        with self.output_lock:
            self.output_lines = []

        with self.progress_lock:
            # Initialize progress with known config values so frontend has data immediately
            config = self.config_manager.get_all()
            self.progress_data = {
                'movies_prefetched': 0,
                'movies_limit': config.get('movies_global_limit', -1),
                'series_prefetched': 0,
                'series_limit': config.get('series_global_limit', -1),
                'episodes_prefetched': 0,
                'cached_count': 0,
                'mode': 'starting',
                'catalog_name': '',
                'catalog_mode': '',
                'completed_catalogs': 0,
                'total_catalogs': 0,
                'current_catalog_items': 0,
                'current_catalog_limit': -1
            }

        self.job_status = JobStatus.RUNNING
        self.job_start_time = time.time()
        self.job_end_time = None
        self.job_error = None
        self.job_summary = None
        self.pause_requested = False  # Reset pause request
        self.is_paused = False  # Reset pause state
        self.pause_event.set()  # Ensure not paused (set = not paused)

        logger.info("=" * 60)
        logger.info("PREFETCH JOB STARTING")
        logger.info("=" * 60)
        logger.info(f"Job type: {'Manual' if manual else 'Scheduled'}")
        logger.info(f"Start time: {datetime.fromtimestamp(self.job_start_time).strftime('%Y-%m-%d %H:%M:%S')}")

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
        old_stdout = sys.stdout
        output_capture = None

        try:
            logger.info("Creating prefetch wrapper")

            # Create wrapper BEFORE capturing stdout to see any errors
            self.wrapper = StreamsPrefetcherWrapper(
                self.config_manager,
                scheduler=self,
                progress_callback=self._update_progress,
                output_callback=self._append_output
            )

            logger.info("Starting stdout capture")

            # Now capture stdout for the actual run
            output_capture = io.StringIO()
            sys.stdout = output_capture

            result = self.wrapper.run()

            # Restore stdout
            sys.stdout = old_stdout

            # Get captured output
            captured = output_capture.getvalue()
            if captured:
                self._append_output(captured)

            # Extract success and summary
            success = result.get('success', False) if isinstance(result, dict) else result
            interrupted = result.get('interrupted', False) if isinstance(result, dict) else False
            self.job_summary = result.get('results') if isinstance(result, dict) else None

            # Update status - if interrupted, mark as CANCELLED but keep summary
            if interrupted or self.job_status == JobStatus.CANCELLED:
                self.job_status = JobStatus.CANCELLED
            else:
                self.job_status = JobStatus.COMPLETED if success else JobStatus.FAILED

            self.job_end_time = time.time()
            duration = self.job_end_time - self.job_start_time

            logger.info("=" * 60)
            status_str = 'CANCELLED' if interrupted else ('COMPLETED' if success else 'FAILED')
            logger.info(f"PREFETCH JOB {status_str}")
            logger.info("=" * 60)
            logger.info(f"Duration: {int(duration // 60)}m {int(duration % 60)}s")

            if self.job_summary:
                stats = self.job_summary.get('statistics', {})
                logger.info(f"Movies prefetched: {stats.get('movies_prefetched', 0)}")
                logger.info(f"Series prefetched: {stats.get('series_prefetched', 0)}")
                logger.info(f"Items from cache: {stats.get('items_from_cache', 0)}")
                logger.info(f"Success rate: {(stats.get('cache_requests_successful', 0) / max(stats.get('cache_requests_made', 1), 1) * 100):.1f}%")

            logger.info("=" * 60)

            # Notify completion
            self._notify_callbacks('job_complete', {
                'status': self.job_status,
                'start_time': self.job_start_time,
                'end_time': self.job_end_time,
                'duration': duration,
                'success': success,
                'summary': self.job_summary
            })

        except Exception as e:
            # CRITICAL: Restore stdout FIRST before any logging
            sys.stdout = old_stdout

            self.job_status = JobStatus.FAILED
            self.job_end_time = time.time()
            self.job_error = str(e)

            logger.error("=" * 60)
            logger.error("PREFETCH JOB FAILED")
            logger.error("=" * 60)
            logger.error(f"Error: {self.job_error}")
            logger.exception(e)
            logger.error("=" * 60)

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

        # Check if any scheduled jobs exist
        scheduled_jobs = [job for job in self.scheduler.get_jobs() if job.id.startswith('prefetch_job')]

        status_data = {
            'status': self.job_status,
            'start_time': self.job_start_time,
            'end_time': self.job_end_time,
            'error': self.job_error,
            'next_run_time': next_run.isoformat() if next_run else None,
            'progress': self.get_progress(),
            'is_scheduled': len(scheduled_jobs) > 0
        }

        # Include summary data for completed or cancelled jobs (cancelled jobs have partial results)
        if (self.job_status == JobStatus.COMPLETED or self.job_status == JobStatus.CANCELLED) and self.job_summary:
            status_data['summary'] = self.job_summary

        return status_data

    def cancel_job(self):
        """Cancel running, pausing, or paused job by injecting KeyboardInterrupt into the thread"""
        if (self.job_status in [JobStatus.RUNNING, JobStatus.PAUSING, JobStatus.PAUSED, JobStatus.RESUMING]) and self.job_thread and self.job_thread.is_alive():
            # Inject KeyboardInterrupt into the running thread
            # This allows the wrapper to catch it and return partial results
            try:
                thread_id = self.job_thread.ident
                exc = ctypes.py_object(KeyboardInterrupt)
                res = ctypes.pythonapi.PyThreadState_SetAsyncExc(
                    ctypes.c_long(thread_id), exc
                )

                if res == 0:
                    # Invalid thread ID
                    logger.warning("Failed to cancel job: invalid thread ID")
                    return False
                elif res > 1:
                    # More than one thread affected, undo
                    ctypes.pythonapi.PyThreadState_SetAsyncExc(
                        ctypes.c_long(thread_id), None
                    )
                    logger.warning("Failed to cancel job: multiple threads affected")
                    return False

                # Mark as cancelled (will be confirmed when thread finishes)
                self.job_status = JobStatus.CANCELLED

                # Don't set end_time yet - wait for thread to finish
                # The thread will capture results and call job_complete

                logger.info("Cancellation signal sent to job thread")
                return True

            except Exception as e:
                logger.error(f"Error cancelling job: {e}")
                return False
        return False

    def pause_job(self):
        """Request pause for running job - will pause after current item finishes"""
        if self.job_status == JobStatus.RUNNING:
            # Signal pause requested - will pause after current item
            self.pause_requested = True
            self.job_status = JobStatus.PAUSING

            logger.info("Pause requested - will pause after current item finishes")

            # Notify callbacks with PAUSING status and current progress
            self._notify_callbacks('status_change', {
                'status': self.job_status,
                'start_time': self.job_start_time,
                'progress': self.get_progress()
            })

            return True, "Pause requested"
        return False, "No running job to pause"

    def complete_pause(self):
        """Complete the pause transition (called by prefetcher after current item finishes)"""
        if self.job_status == JobStatus.PAUSING:
            self.is_paused = True
            self.pause_requested = False
            self.pause_event.clear()  # Actually pause (clear = paused)
            self.job_status = JobStatus.PAUSED

            logger.info("Job paused - current item completed")

            # Notify callbacks with PAUSED status and current progress
            self._notify_callbacks('status_change', {
                'status': self.job_status,
                'start_time': self.job_start_time,
                'progress': self.get_progress()
            })

            return True

    def resume_job(self):
        """Resume paused job"""
        if self.job_status == JobStatus.PAUSED:
            # Transition through RESUMING state
            self.job_status = JobStatus.RESUMING

            logger.info("Resuming job...")

            # Notify callbacks with RESUMING status and current progress
            self._notify_callbacks('status_change', {
                'status': self.job_status,
                'start_time': self.job_start_time,
                'progress': self.get_progress()
            })

            # Actually resume
            self.is_paused = False
            self.pause_event.set()  # Signal to resume (set = not paused)
            self.job_status = JobStatus.RUNNING

            logger.info("Job resumed")

            # Notify callbacks with RUNNING status and current progress
            self._notify_callbacks('status_change', {
                'status': self.job_status,
                'start_time': self.job_start_time,
                'progress': self.get_progress()
            })

            return True, "Job resumed"
        return False, "No paused job to resume"

    def shutdown(self):
        """Shutdown scheduler"""
        self.scheduler.shutdown(wait=False)
