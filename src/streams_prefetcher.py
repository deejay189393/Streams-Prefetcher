#!/usr/bin/env python3
"""
Streams Prefetcher

This script fetches catalogs from a Stremio addon, extracts IMDB IDs,
and performs stream prefetching for movies and series to preload the addon's cache.
"""

import requests
import json
import time
import argparse
import sys
import shutil
import math
import random
import sqlite3
import os
import re
from datetime import datetime, timezone
from urllib.parse import urljoin, quote
from typing import List, Dict, Any, Optional, Tuple

def get_terminal_size() -> int:
    """Safely get terminal width with a fallback."""
    try:
        return shutil.get_terminal_size().columns
    except (OSError, ValueError):
        return 80 # Fallback in case terminal size can't be determined

class ProgressTracker:
    """Progress tracker with working Termux UI based on reference"""
    
    def __init__(self):
        self.COLORS = {
            'GREEN': '\033[92m',
            'YELLOW': '\033[93m', 
            'RED': '\033[91m',
            'BLUE': '\033[94m',
            'BOLD': '\033[1m',
            'RESET': '\033[0m'
        }
        
        self.overall_catalogs = []
        self.current_catalog_index = 0
        self.dynamic_lines = 22  # Adjusted for all dashboard content including timing
        self.initial_lines_printed = 0  # Track lines printed before dashboard
        
    def init_overall_progress(self, catalog_names: List[str]):
        """Initialize overall progress tracking"""
        self.overall_catalogs = [{'name': name, 'status': 'pending'} for name in catalog_names]
        self.current_catalog_index = 0
        
        # Track where we are before starting dashboard
        self.initial_lines_printed = 2  # Account for the "Starting processing" lines
        
        # Create the dashboard area by printing empty lines
        print() # Extra space before dashboard
        for _ in range(self.dynamic_lines):
            print()
        
    def get_overall_bar(self, statuses: List[str], total: int) -> str:
        """Generate colored overall progress bar"""
        term_width = get_terminal_size()
        bar_width = min(50, term_width - 30)
        if not statuses or total == 0: return " " * bar_width
        bar = ""
        for i in range(bar_width):
            idx = int((i / bar_width) * len(statuses)) if statuses else -1
            if idx != -1 and idx < len(statuses):
                if statuses[idx] == 'success': bar += f"{self.COLORS['GREEN']}█{self.COLORS['RESET']}"
                elif statuses[idx] == 'partial': bar += f"{self.COLORS['YELLOW']}█{self.COLORS['RESET']}"
                elif statuses[idx] == 'failed': bar += f"{self.COLORS['RED']}█{self.COLORS['RESET']}"
                else: bar += " "
            else: bar += " "
        return bar
    
    def get_prefetch_bar(self, statuses: List[str], total_limit: int) -> str:
        """Generate prefetching progress bar with colors - only shows actual prefetch attempts"""
        term_width = get_terminal_size()
        bar_width = min(40, term_width - 30)
        if total_limit <= 0: return " " * bar_width
        
        # Only count items that were actually attempted for prefetching (not cached)
        prefetch_statuses = [s for s in statuses if s in ['successful', 'failed']]
        
        bar = ""
        for i in range(bar_width):
            idx = int((i / bar_width) * total_limit) if total_limit > 0 else -1
            if idx < len(prefetch_statuses):
                if prefetch_statuses[idx] == 'successful': 
                    bar += f"{self.COLORS['GREEN']}█{self.COLORS['RESET']}"
                elif prefetch_statuses[idx] == 'failed': 
                    bar += f"{self.COLORS['RED']}█{self.COLORS['RESET']}"
                else: 
                    bar += " "
            else: 
                bar += " "
        return bar

    def get_limits_table(self, **kwargs) -> List[str]:
        """Generates a formatted table of current prefetching limits."""
        g_movies_curr = kwargs.get('prefetched_movies_count', 0)
        g_movies_limit = kwargs.get('movies_global_limit', -1)
        g_series_curr = kwargs.get('prefetched_series_count', 0)
        g_series_limit = kwargs.get('series_global_limit', -1)
        c_items_curr = kwargs.get('prefetched_in_this_catalog', 0)
        c_items_limit = kwargs.get('per_catalog_limit', -1)
        cat_mode = kwargs.get('catalog_mode', 'Item')

        def format_limit(current, limit):
            limit_str = '∞' if limit == -1 else str(limit)
            return f"{current:>4} of {limit_str:<4}"

        limit_name = f"Catalog ({cat_mode.capitalize()})"
        rows = [
            ("Global Movies", format_limit(g_movies_curr, g_movies_limit)),
            ("Global Series", format_limit(g_series_curr, g_series_limit)),
            (limit_name, format_limit(c_items_curr, c_items_limit)),
        ]

        headers = ["Limit", "Prefetched"]
        col1_width = max(len(headers[0]), max(len(row[0]) for row in rows))
        col2_width = max(len(headers[1]), max(len(row[1]) for row in rows))
        table_width = col1_width + col2_width + 7

        lines = []
        border_top = " " + "‾" * (table_width - 2)
        border_bottom = " " + "—" * (table_width - 2)
        lines.append(border_top)
        lines.append(f"| {headers[0]:<{col1_width}} | {headers[1]:^{col2_width}} |")
        lines.append("|" + "—" * (col1_width + 2) + "|" + "—" * (col2_width + 2) + "|")
        for name, value in rows:
            lines.append(f"| {name:<{col1_width}} | {value:^{col2_width}} |")
        lines.append(border_bottom)
        return lines

    def get_catalog_initial_effective_limit(self, **kwargs) -> int:
        """Calculate the initial effective limit for the current catalog - how many items can be prefetched when starting"""
        cat_mode = kwargs.get('catalog_mode', 'mixed')
        per_catalog_limit = kwargs.get('per_catalog_limit', -1)
        
        if cat_mode == 'movie':
            global_limit = kwargs.get('movies_global_limit', -1)
            global_current = kwargs.get('prefetched_movies_count_at_start', 0)
        elif cat_mode == 'series':
            global_limit = kwargs.get('series_global_limit', -1)
            global_current = kwargs.get('prefetched_series_count_at_start', 0)
        else:  # mixed
            # For mixed catalogs, use the more restrictive of the two global limits
            movies_remaining = kwargs.get('movies_global_limit', -1) - kwargs.get('prefetched_movies_count_at_start', 0) if kwargs.get('movies_global_limit', -1) != -1 else -1
            series_remaining = kwargs.get('series_global_limit', -1) - kwargs.get('prefetched_series_count_at_start', 0) if kwargs.get('series_global_limit', -1) != -1 else -1
            
            if movies_remaining == -1 and series_remaining == -1:
                global_remaining = -1
            elif movies_remaining == -1:
                global_remaining = series_remaining
            elif series_remaining == -1:
                global_remaining = movies_remaining
            else:
                global_remaining = max(movies_remaining, series_remaining)
            
            if per_catalog_limit == -1:
                return global_remaining
            elif global_remaining == -1:
                return per_catalog_limit
            else:
                return min(per_catalog_limit, global_remaining)
        
        # For movie/series catalogs
        if global_limit == -1:
            global_remaining = -1
        else:
            global_remaining = max(0, global_limit - global_current)
        
        if per_catalog_limit == -1:
            return global_remaining
        elif global_remaining == -1:
            return per_catalog_limit
        else:
            return min(per_catalog_limit, global_remaining)

    def get_catalog_effective_limit(self, **kwargs) -> int:
        """Calculate the effective limit for the current catalog - how many items can still be prefetched"""
        cat_mode = kwargs.get('catalog_mode', 'mixed')
        per_catalog_limit = kwargs.get('per_catalog_limit', -1)
        prefetched_in_this_catalog = kwargs.get('prefetched_in_this_catalog', 0)
        
        if cat_mode == 'movie':
            global_limit = kwargs.get('movies_global_limit', -1)
            global_current = kwargs.get('prefetched_movies_count', 0)
        elif cat_mode == 'series':
            global_limit = kwargs.get('series_global_limit', -1)
            global_current = kwargs.get('prefetched_series_count', 0)
        else:  # mixed
            # For mixed catalogs, use the more restrictive of the two global limits
            movies_remaining = kwargs.get('movies_global_limit', -1) - kwargs.get('prefetched_movies_count', 0) if kwargs.get('movies_global_limit', -1) != -1 else -1
            series_remaining = kwargs.get('series_global_limit', -1) - kwargs.get('prefetched_series_count', 0) if kwargs.get('series_global_limit', -1) != -1 else -1
            
            if movies_remaining == -1 and series_remaining == -1:
                global_remaining = -1
            elif movies_remaining == -1:
                global_remaining = series_remaining
            elif series_remaining == -1:
                global_remaining = movies_remaining
            else:
                global_remaining = max(movies_remaining, series_remaining)
            
            catalog_remaining = per_catalog_limit - prefetched_in_this_catalog if per_catalog_limit != -1 else -1
            
            if catalog_remaining == -1:
                return global_remaining
            elif global_remaining == -1:
                return catalog_remaining
            else:
                return min(catalog_remaining, global_remaining)
        
        # For movie/series catalogs
        if global_limit == -1:
            global_remaining = -1
        else:
            global_remaining = max(0, global_limit - global_current)
        
        catalog_remaining = per_catalog_limit - prefetched_in_this_catalog if per_catalog_limit != -1 else -1
        
        if catalog_remaining == -1:
            return global_remaining
        elif global_remaining == -1:
            return catalog_remaining
        else:
            return min(catalog_remaining, global_remaining)

    def redraw_dashboard(self, **kwargs):
        """Redraw the entire dashboard area"""
        sys.stdout.write(f"\033[{self.dynamic_lines}A")
        
        lines = ["", ""]
        
        catalog_statuses = kwargs.get('catalog_statuses', [])
        total_catalogs = kwargs.get('total_catalogs', 0)
        completed = kwargs.get('completed_catalogs', 0)
        overall_bar = self.get_overall_bar(catalog_statuses, total_catalogs)
        progress_pct = f"{(completed / total_catalogs * 100):.1f}%" if total_catalogs > 0 else "0.0%"
        
        lines.append(f"{self.COLORS['BOLD']}Overall Progress ({completed}/{total_catalogs}):{self.COLORS['RESET']}")
        lines.append(f"[{overall_bar}] {progress_pct}")
        lines.append("-" * min(60, get_terminal_size()))
        lines.extend(["", ""])
        
        catalog_name = kwargs.get('catalog_name', 'Unknown')
        catalog_mode = kwargs.get('catalog_mode', 'Mixed')
        catalog_num = completed + 1
        lines.append(f"{self.COLORS['BOLD']}Currently Processing Catalog {catalog_num} of {total_catalogs}: {catalog_name} ({catalog_mode.capitalize()}){self.COLORS['RESET']}")
        lines.append("")
        
        mode = kwargs.get('mode', 'idle')
        if mode == 'fetching':
            page_num = kwargs.get('fetched_items', 0)
            lines.append(f"Fetching Page {page_num}")
            lines.extend(["", "", ""])
            lines.extend(self.get_limits_table(**kwargs))
            lines.extend(self.get_timing_stats(**kwargs))
            # Pad to ensure consistent line count
            while len(lines) < self.dynamic_lines:
                lines.append("")
        elif mode == 'prefetching':
            title = kwargs.get('current_title', 'Processing...')
            statuses = kwargs.get('item_statuses', [])
            
            # Calculate initial effective limit for progress display (fixed total)
            initial_effective_limit = self.get_catalog_initial_effective_limit(**kwargs)
            
            # Only count items that were actually attempted for prefetching (not cached)
            prefetch_statuses = [s for s in statuses if s in ['successful', 'failed']]
            
            if initial_effective_limit == -1:
                progress_display = f"({len(prefetch_statuses)}/∞)"
                progress_pct = "0.0%"
            else:
                progress_display = f"({len(prefetch_statuses)}/{initial_effective_limit})"
                progress_pct = f"{(len(prefetch_statuses) / initial_effective_limit * 100):.1f}%" if initial_effective_limit > 0 else "0.0%"
            
            # Use initial effective limit for both bar rendering AND percentage calculation
            prefetch_bar = self.get_prefetch_bar(statuses, initial_effective_limit)
            max_title_len = get_terminal_size()
            display_title = title[:max_title_len-3] + "..." if len(title) > max_title_len else title
            lines.append(f"{display_title}")
            lines.append(f"[{prefetch_bar}] {progress_pct} {progress_display}")
            lines.extend(["", ""])
            lines.extend(self.get_limits_table(**kwargs))
            lines.extend(self.get_timing_stats(**kwargs))
            # Pad to ensure consistent line count
            while len(lines) < self.dynamic_lines:
                lines.append("")
        else:
            lines.append("")
            lines.append("")
            # Pad to ensure consistent line count
            while len(lines) < self.dynamic_lines:
                lines.append("")
        
        for line in lines:
            sys.stdout.write(f"\r\033[K{line}\n")
        sys.stdout.flush()

    def get_timing_stats(self, **kwargs) -> List[str]:
        """Generate live timing statistics for the dashboard"""
        start_time = kwargs.get('start_time')
        movies_prefetched = kwargs.get('prefetched_movies_count', 0)
        series_prefetched = kwargs.get('prefetched_series_count', 0)
        movies_limit = kwargs.get('movies_global_limit', -1)
        series_limit = kwargs.get('series_global_limit', -1)
        max_execution_time = kwargs.get('max_execution_time', -1)
        
        lines = []
        
        if start_time is None:
            lines.append("")
            lines.append("")
            return lines
        
        current_time = time.time()
        elapsed = current_time - start_time
        
        # Format elapsed time
        hours = int(elapsed // 3600)
        minutes = int((elapsed % 3600) // 60)
        seconds = int(elapsed % 60)
        
        if hours > 0:
            elapsed_str = f"{hours}h {minutes}m {seconds}s"
        elif minutes > 0:
            elapsed_str = f"{minutes}m {seconds}s"
        else:
            elapsed_str = f"{seconds}s"
        
        # Format start time in 12-hour format
        dt = datetime.fromtimestamp(start_time, tz=timezone.utc).astimezone()
        start_str = dt.strftime("%I:%M:%S %p")
        
        # Calculate ETA
        eta_str = "Calculating..."

        # Check if we have a time limit
        time_based_eta = None
        if max_execution_time != -1:
            time_based_eta = max_execution_time - elapsed

        # Check if we have item limits
        item_based_eta = None
        if movies_limit != -1 and series_limit != -1 and elapsed > 10:
            total_items = movies_prefetched + series_prefetched
            total_target = movies_limit + series_limit

            if total_items > 0 and total_target > 0:
                rate = total_items / elapsed
                remaining_items = total_target - total_items

                if remaining_items > 0 and rate > 0:
                    item_based_eta = remaining_items / rate
        elif (movies_limit != -1 or series_limit != -1) and elapsed > 10:
            # At least one limit is set
            total_items = movies_prefetched + series_prefetched
            total_target = 0

            if movies_limit != -1:
                total_target += movies_limit
            if series_limit != -1:
                total_target += series_limit

            if total_items > 0 and total_target > 0:
                rate = total_items / elapsed
                remaining_items = total_target - total_items

                if remaining_items > 0 and rate > 0:
                    item_based_eta = remaining_items / rate

        # Determine which ETA to use
        if time_based_eta is not None and item_based_eta is not None:
            # Use whichever comes first
            eta_seconds = min(time_based_eta, item_based_eta)
        elif time_based_eta is not None:
            # Only time limit
            eta_seconds = time_based_eta
        elif item_based_eta is not None:
            # Only item limit
            eta_seconds = item_based_eta
        else:
            # No limits or can't calculate yet
            if max_execution_time == -1 and (movies_limit == -1 or series_limit == -1):
                eta_str = "N/A (unlimited)"
            eta_seconds = None

        # Format ETA
        if eta_seconds is not None:
            if eta_seconds <= 0:
                eta_str = "Complete"
            else:
                eta_hours = int(eta_seconds // 3600)
                eta_minutes = int((eta_seconds % 3600) // 60)
                eta_secs = int(eta_seconds % 60)

                if eta_hours > 0:
                    eta_str = f"{eta_hours}h {eta_minutes}m"
                elif eta_minutes > 0:
                    eta_str = f"{eta_minutes}m {eta_secs}s"
                else:
                    eta_str = f"{eta_secs}s"
        
        lines.append("")
        lines.append(f"Started: {start_str} | Elapsed: {elapsed_str} | Est. Remaining: {eta_str}")
        
        return lines

    def finish_catalog_processing(self, success_count: int, failed_count: int, cached_count: int, **kwargs):
        """Finish catalog processing and update status based on clear rules."""
        total_processed = success_count + failed_count + cached_count
        status = 'failed' if total_processed == 0 or (failed_count == total_processed and total_processed > 0) else 'success' if failed_count == 0 else 'partial'
        if self.current_catalog_index < len(self.overall_catalogs):
            self.overall_catalogs[self.current_catalog_index]['status'] = status
        completed_catalogs = sum(1 for c in self.overall_catalogs if c['status'] != 'pending')
        catalog_statuses = [c['status'] for c in self.overall_catalogs]
        self.redraw_dashboard(catalog_statuses=catalog_statuses, completed_catalogs=completed_catalogs, total_catalogs=len(self.overall_catalogs), catalog_name=kwargs.get('catalog_name', "Completed"), mode='idle')
        self.current_catalog_index += 1

    def cleanup_dashboard(self):
        """Clears the entire dynamic dashboard area from the terminal and the initial processing lines."""
        # Clear dashboard area
        sys.stdout.write(f"\033[{self.dynamic_lines}A")
        for _ in range(self.dynamic_lines):
            sys.stdout.write("\r\033[K\n")
        sys.stdout.write(f"\033[{self.dynamic_lines}A")
        
        # Clear the initial "Starting processing" lines
        sys.stdout.write(f"\033[{self.initial_lines_printed}A")
        for _ in range(self.initial_lines_printed):
            sys.stdout.write("\r\033[K\n")
        sys.stdout.write(f"\033[{self.initial_lines_printed}A")
        
        sys.stdout.flush()

def parse_addon_urls(arg: str) -> List[Tuple[str, str]]:
    """
    Parses a comma-separated string of 'type:url' pairs.
    A type must be specified for each URL.
    """
    valid_urls = []
    
    for item in arg.split(','):
        item = item.strip()
        if not item: continue
        
        first_colon_index = item.find(':')
        if first_colon_index != -1:
            addon_type = item[:first_colon_index].strip().lower()
            url = item[first_colon_index+1:].strip()
            
            if addon_type not in ['catalog', 'stream', 'both']:
                raise argparse.ArgumentTypeError(f"Invalid addon type '{addon_type}'. Must be 'catalog', 'stream', or 'both'.")
            if not url:
                raise argparse.ArgumentTypeError(f"URL cannot be empty for type '{addon_type}'.")
            
            valid_urls.append((url, addon_type))
        else:
            raise argparse.ArgumentTypeError(f"Missing type. Each item must be in the format 'type:url'. Offending item: '{item}'")

    if not valid_urls:
        raise argparse.ArgumentTypeError("No valid addon URLs provided.")
    return valid_urls

def parse_time_string(time_str: str) -> float:
    """Parse human-readable time string to seconds. Returns -1 for unlimited."""
    if not time_str or time_str.strip() == '':
        raise argparse.ArgumentTypeError("Time string cannot be empty")

    time_str = time_str.strip()

    # Handle unlimited case
    if time_str.lower() == '-1' or time_str.lower() == '-1s':
        return -1

    # Extract number and unit
    import re
    match = re.match(r'^(-?\d+(?:\.\d+)?)\s*(ms|MS|[smhdwyM]?)$', time_str, re.IGNORECASE)
    if not match:
        raise argparse.ArgumentTypeError(f"Invalid time format: '{time_str}'. Use format like: 500ms, 30s, 5m (minutes), 2h, 1d, 1w, 1M (months), 1y or -1 (with any unit) for unlimited")

    value = float(match.group(1))

    # Normalize unit to lowercase, except preserve 'M' for months
    unit_raw = match.group(2) or 's'
    if unit_raw == 'M':
        unit = 'M'  # Keep uppercase M for months
    else:
        unit = unit_raw.lower()  # Everything else lowercase

    # Handle unlimited
    if value == -1:
        return -1

    if value < 0:
        raise argparse.ArgumentTypeError(f"Time value must be positive or -1 for unlimited, got: {value}")

    # Convert to seconds
    multipliers = {
        'ms': 0.001,
        's': 1,
        'm': 60,
        'h': 3600,
        'd': 86400,
        'w': 604800,
        'M': 2592000,  # 30 days
        'y': 31536000  # 365 days
    }

    return value * multipliers.get(unit, 1)

def format_time_string(seconds: float) -> str:
    """Format seconds back to human-readable string"""
    if seconds == -1:
        return "Unlimited"

    if seconds == 0:
        return "0 seconds"

    if seconds < 1:
        milliseconds = int(seconds * 1000)
        return f"{milliseconds} millisecond{'s' if milliseconds != 1 else ''}"

    # For time periods less than a week, show compound units (days, hours, minutes, seconds)
    if seconds < 604800:  # Less than a week
        days = int(seconds // 86400)
        hours = int((seconds % 86400) // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)

        parts = []
        if days > 0:
            parts.append(f"{days} day{'s' if days != 1 else ''}")
        if hours > 0:
            parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
        if minutes > 0:
            parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")
        if secs > 0 or not parts:  # Always show seconds if nothing else
            parts.append(f"{secs} second{'s' if secs != 1 else ''}")

        return " ".join(parts)

    # For longer periods, show primary unit with remainder in next smaller unit
    elif seconds < 2592000:  # Less than a month
        weeks = int(seconds // 604800)
        days = int((seconds % 604800) // 86400)
        parts = [f"{weeks} week{'s' if weeks != 1 else ''}"]
        if days > 0:
            parts.append(f"{days} day{'s' if days != 1 else ''}")
        return " ".join(parts)
    elif seconds < 31536000:  # Less than a year
        months = int(seconds // 2592000)
        weeks = int((seconds % 2592000) // 604800)
        parts = [f"{months} month{'s' if months != 1 else ''}"]
        if weeks > 0:
            parts.append(f"{weeks} week{'s' if weeks != 1 else ''}")
        return " ".join(parts)
    else:
        years = int(seconds // 31536000)
        months = int((seconds % 31536000) // 2592000)
        parts = [f"{years} year{'s' if years != 1 else ''}"]
        if months > 0:
            parts.append(f"{months} month{'s' if months != 1 else ''}")
        return " ".join(parts)

class StreamsPrefetcher:
    def __init__(self, addon_urls: List[Tuple[str, str]], movies_global_limit: int, series_global_limit: int, movies_per_catalog: int, series_per_catalog: int, items_per_mixed_catalog: int, delay: float, network_request_timeout: int = 30, proxy_url: Optional[str] = None, randomize_catalogs: bool = False, randomize_items: bool = False, cache_validity_seconds: int = 259200, max_execution_time: int = -1, enable_logging: bool = False, cache_uncached_streams_enabled: bool = False, cached_stream_regex: str = '⚡', max_cache_requests_per_item: int = 1, max_cache_requests_global: int = 50, cached_streams_count_threshold: int = 0, scheduler=None):
        self.addon_urls = addon_urls
        self.scheduler = scheduler
        self.movies_global_limit = movies_global_limit
        self.series_global_limit = series_global_limit
        self.movies_per_catalog = movies_per_catalog
        self.series_per_catalog = series_per_catalog
        self.items_per_mixed_catalog = items_per_mixed_catalog
        self.delay = delay
        self.network_request_timeout = network_request_timeout if network_request_timeout != -1 else None
        self.proxy_url = proxy_url
        self.randomize_catalogs = randomize_catalogs
        self.randomize_items = randomize_items
        self.cache_validity_seconds = cache_validity_seconds
        self.max_execution_time = max_execution_time
        self.enable_logging = enable_logging
        self.logging_dir = "data/logs" if enable_logging else None

        # Cache uncached streams feature
        self.cache_uncached_streams_enabled = cache_uncached_streams_enabled
        self.cached_stream_regex = cached_stream_regex
        self.max_cache_requests_per_item = max_cache_requests_per_item
        self.max_cache_requests_global = max_cache_requests_global
        self.cached_streams_count_threshold = cached_streams_count_threshold
        self.cache_requests_sent_count = 0  # Track global count
        self.cache_requests_successful_count = 0  # Track successful cache requests

        self.prefetched_movies_count = 0
        self.prefetched_series_count = 0
        self.prefetched_episodes_count = 0
        self.prefetched_cached_count = 0

        # Dashboard auto-refresh throttling
        self._last_dashboard_redraw = 0.0
        self._min_redraw_interval = 0.1  # 100ms = max 10 redraws/second
        self._is_processing_items = False
        self._current_dashboard_args = None

        # Initialize timing
        self.start_time = None
        self.end_time = None
        self.catalog_discovery_start = None
        self.catalog_discovery_end = None
        self.processing_start = None
        self.processing_end = None

        # Initialize logging
        self.log_file = None
        self.log_buffer = []
        if self.enable_logging:
            self._setup_logging()
        
        self.results = self.initialize_results()

        self.catalog_urls = [url for url, type in addon_urls if type in ['catalog', 'both']]
        self.stream_urls = [url for url, type in addon_urls if type in ['stream', 'both']]

        self.progress_tracker = ProgressTracker()

        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Streams Prefetcher/1.0',
            'Accept': 'application/json'
        })
        if self.proxy_url:
            self.session.proxies.update({'http': self.proxy_url, 'https': self.proxy_url})
            
        self.db_conn = None
        self.db_name = "data/db/streams_prefetcher_prefetch_cache.db"
        self.setup_cache()

    def format_timestamp(self, timestamp: Optional[float]) -> str:
        """Format timestamp to local timezone string in 12-hour format"""
        if timestamp is None:
            return "Not recorded"
        dt = datetime.fromtimestamp(timestamp, tz=timezone.utc).astimezone()
        return dt.strftime("%Y-%m-%d %I:%M:%S %p %Z")
    
    def format_duration(self, start_time: Optional[float], end_time: Optional[float]) -> str:
        """Format duration between two timestamps in human-readable format"""
        if start_time is None or end_time is None:
            return "Unknown"
        duration_seconds = end_time - start_time
        days = int(duration_seconds // 86400)
        hours = int((duration_seconds % 86400) // 3600)
        minutes = int((duration_seconds % 3600) // 60)
        seconds = int(duration_seconds % 60)

        parts = []
        if days > 0:
            parts.append(f"{days} day{'s' if days != 1 else ''}")
        if hours > 0:
            parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
        if minutes > 0:
            parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")
        if seconds > 0 or not parts:  # Always show seconds if nothing else, or if non-zero
            parts.append(f"{seconds} second{'s' if seconds != 1 else ''}")

        return " ".join(parts)
    
    def calculate_rate(self, count: int, duration_seconds: float) -> str:
        """Calculate processing rate per minute"""
        if duration_seconds <= 0 or count == 0:
            return "N/A"
        rate = (count / duration_seconds) * 60
        return f"{rate:.1f}/min"

    def _setup_logging(self):
        """Setup logging to file"""
        try:
            os.makedirs(self.logging_dir, exist_ok=True)
            timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            log_filename = f"streams_prefetcher_logs_{timestamp}.txt"
            log_path = os.path.join(self.logging_dir, log_filename)
            self.log_file = open(log_path, 'w', encoding='utf-8')
            self._log(f"Logging initialized: {log_path}\n")
        except Exception as e:
            print(f"Warning: Could not setup logging: {e}")
            self.log_file = None
    
    def _log(self, message: str):
        """Write message to log file and buffer"""
        if self.log_file:
            try:
                self.log_file.write(message + '\n')
                self.log_file.flush()  # Ensure immediate write
            except Exception:
                pass  # Silently fail to not disrupt main functionality
    
    def _check_time_limit(self) -> bool:
        """Check if max execution time has been reached"""
        return self.max_execution_time != -1 and (time.time() - self.start_time) >= self.max_execution_time

    def _should_auto_redraw(self) -> bool:
        """Check if enough time has passed for throttled auto-redraw"""
        if not self._is_processing_items:
            self._log(f"[AUTO_REDRAW_DEBUG] Skipped: not processing items")
            return False
        if self._current_dashboard_args is None:
            self._log(f"[AUTO_REDRAW_DEBUG] Skipped: no dashboard args")
            return False
        current_time = time.time()
        time_since_last = current_time - self._last_dashboard_redraw
        if time_since_last >= self._min_redraw_interval:
            self._last_dashboard_redraw = current_time
            self._log(f"[AUTO_REDRAW_DEBUG] Allowed: {time_since_last:.3f}s since last redraw (cached_count={self.prefetched_cached_count})")
            return True
        self._log(f"[AUTO_REDRAW_DEBUG] Throttled: only {time_since_last:.3f}s since last redraw (need {self._min_redraw_interval:.1f}s)")
        return False

    def _auto_redraw_dashboard(self):
        """Conditionally redraw dashboard with throttling"""
        self._log(f"[AUTO_REDRAW_DEBUG] Called with cached_count={self.prefetched_cached_count}")
        if self._should_auto_redraw():
            self._current_dashboard_args['prefetched_cached_count'] = self.prefetched_cached_count
            self._log(f"[AUTO_REDRAW_DEBUG] Executing redraw with cached_count={self.prefetched_cached_count}")
            self.progress_tracker.redraw_dashboard(**self._current_dashboard_args)
        else:
            self._log(f"[AUTO_REDRAW_DEBUG] Skipped redraw")

    def __del__(self):
        if self.db_conn:
            self.db_conn.close()
        if self.log_file:
            try:
                self.log_file.close()
            except:
                pass

    def setup_cache(self):
        """Sets up the SQLite database for caching, adding new columns if needed."""
        try:
            os.makedirs(os.path.dirname(self.db_name), exist_ok=True)
            self.db_conn = sqlite3.connect(self.db_name, check_same_thread=False)
            cursor = self.db_conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS cache (
                    imdb_id TEXT PRIMARY KEY,
                    timestamp REAL,
                    title_name TEXT
                )
            ''')
            cursor.execute("PRAGMA table_info(cache)")
            columns = [column[1] for column in cursor.fetchall()]
            if 'title_name' not in columns:
                cursor.execute("ALTER TABLE cache ADD COLUMN title_name TEXT")
            self.db_conn.commit()
        except sqlite3.Error as e:
            print(f"SQLite error during cache setup: {e}")
            self.db_conn = None

    def is_cache_valid(self, imdb_id: str) -> bool:
        """Checks if an IMDb ID is in the cache and if its timestamp is still valid."""
        if not self.db_conn: return False
        cursor = self.db_conn.cursor()
        cursor.execute("SELECT timestamp FROM cache WHERE imdb_id = ?", (imdb_id,))
        row = cursor.fetchone()
        return row and (time.time() - row[0]) < self.cache_validity_seconds

    def update_cache(self, imdb_id: str, title_name: str):
        """Updates or inserts an item with its title and the current timestamp in the cache."""
        if not self.db_conn: return
        current_time = time.time()
        cursor = self.db_conn.cursor()
        cursor.execute("INSERT OR REPLACE INTO cache (imdb_id, timestamp, title_name) VALUES (?, ?, ?)", (imdb_id, current_time, title_name))
        self.db_conn.commit()

    def initialize_results(self) -> Dict[str, Any]:
        return {
            'addon_urls': self.addon_urls,
            'limits': {
                'movies_global': self.movies_global_limit, 'series_global': self.series_global_limit,
                'movies_per_catalog': self.movies_per_catalog, 'series_per_catalog': self.series_per_catalog,
                'items_per_mixed_catalog': self.items_per_mixed_catalog
            },
            'cache_validity_seconds': self.cache_validity_seconds,
            'proxy_url': self.proxy_url, 'delay': self.delay,
            'processed_catalogs': [],
            'statistics': {
                'total_catalogs_in_manifest': 0, 'filtered_catalogs': 0, 'total_pages_fetched': 0,
                'movies_prefetched': 0, 'series_prefetched': 0, 'episodes_found': 0, 'episodes_prefetched': 0,
                'cache_requests_made': 0, 'cache_requests_successful': 0, 'cached_count': 0, 'errors': 0,
                'service_cache_requests_sent': 0, 'service_cache_requests_successful': 0
            }
        }

    def make_request(self, url: str) -> Optional[Dict[Any, Any]]:
        try:
            response = self.session.get(url, timeout=self.network_request_timeout)
            response.raise_for_status()
            data = response.json()
            time.sleep(self.delay)
            return data
        except (requests.exceptions.RequestException, json.JSONDecodeError):
            return None
        finally:
            # Explicitly close response to free memory
            if 'response' in locals():
                response.close()

    def get_catalogs(self, catalog_addon_url: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], int]:
        manifest = self.make_request(f"{catalog_addon_url}/manifest.json")
        if not manifest or 'catalogs' not in manifest:
            return [], [], 0

        all_catalogs = manifest.get('catalogs', [])
        included_catalogs, skipped_catalogs = [], []
        
        for catalog in all_catalogs:
            extras = catalog.get('extra', [])
            catalog_type = catalog.get('type', '').lower()
            is_only_search_catalog = (len(extras) == 1 and extras[0].get('name') == 'search')

            if is_only_search_catalog:
                skipped_catalogs.append({'catalog': catalog, 'reason': "Search-only"})
            elif catalog_type in ['tv', 'channel']:
                skipped_catalogs.append({'catalog': catalog, 'reason': f"Unsupported type '{catalog_type}'"})
            else:
                included_catalogs.append(catalog)
                
        return included_catalogs, skipped_catalogs, len(all_catalogs)

    def get_catalog_type_display(self, catalog_info: Dict[str, Any]) -> str:
        """Get proper display name for catalog type"""
        cat_type = catalog_info.get('type', '').lower()
        if cat_type == 'movie':
            return 'Movie'
        elif cat_type == 'series':
            return 'Series'
        elif cat_type == 'tv':
            return 'TV'
        elif cat_type == 'channel':
            return 'Channel'
        else:
            # For mixed or unknown types, check if it has search-only extras
            extras = catalog_info.get('extra', [])
            is_only_search_catalog = (len(extras) == 1 and extras[0].get('name') == 'search')
            if is_only_search_catalog:
                return 'Search'
            else:
                return 'Mixed'

    def print_catalog_table(self, included: List[Tuple[Dict[str, Any], str]], skipped: List[Tuple[Dict[str, Any], str, str]]):
        all_rows = []
        for cat, _ in included:
            all_rows.append(('✅ Included', cat.get('name', 'N/A'), self.get_catalog_type_display(cat)))
        for cat, _, reason in skipped:
            all_rows.append(('❌ Skipped', cat.get('name', 'N/A'), self.get_catalog_type_display(cat)))

        if not all_rows: return

        headers = ["Status", "Catalog Name", "Type"]
        col_widths = [len(h) for h in headers]
        for row in all_rows:
            col_widths[0] = max(col_widths[0], len(row[0]))
            col_widths[1] = max(col_widths[1], len(row[1]))
            col_widths[2] = max(col_widths[2], len(row[2]))

        table_width = sum(col_widths) + 8  # 3 separators of " | " + 2 border chars

        print("  " + "‾" * table_width)
        print(f"  | {headers[0]:<{col_widths[0]}} | {headers[1]:<{col_widths[1]}} | {headers[2]:<{col_widths[2]}} |")
        print("  |" + "=" * (col_widths[0] + 2) + "|" + "=" * (col_widths[1] + 2) + "|" + "=" * (col_widths[2] + 2) + "|")
        for row in all_rows:
            print(f"  | {row[0]:<{col_widths[0]}} | {row[1]:<{col_widths[1]}} | {row[2]:<{col_widths[2]}} |")
        print("  " + "_" * table_width)

    def extract_imdb_id(self, item: Dict[str, Any]) -> Optional[str]:
        for key in ['imdb_id', 'id']:
            item_id = item.get(key)
            if item_id and isinstance(item_id, str) and item_id.startswith('tt'):
                return item_id
        return None

    def get_title_from_item(self, item: Dict[str, Any]) -> str:
        title = item.get('name', item.get('title', 'Unknown Title')).strip()
        year = item.get('year')
        released = item.get('released')
        
        # Try to get year from different fields
        year_to_use = None
        if year:
            year_to_use = str(year)
        elif released:
            # Extract year from released date (format like "2016-01-01")
            try:
                year_to_use = str(released)[:4] if len(str(released)) >= 4 else None
            except:
                pass
        
        return f"{title} ({year_to_use})" if year_to_use else title

    def get_formatted_episode_title(self, series_item: Dict[str, Any], season: int, episode: int) -> str:
        title = series_item.get('name', series_item.get('title', 'Unknown Series')).strip()
        year = series_item.get('year')
        released = series_item.get('released')
        
        # Try to get year from different fields
        year_to_use = None
        if year:
            year_to_use = str(year)
        elif released:
            # Extract year from released date
            try:
                year_to_use = str(released)[:4] if len(str(released)) >= 4 else None
            except:
                pass
        
        year_str = f" ({year_to_use})" if year_to_use else ""
        episode_str = f"S{str(season).zfill(2)}E{str(episode).zfill(2)}"
        return f"{title}{year_str} {episode_str}"

    def get_series_episodes(self, series_imdb_id: str, catalog_addon_url: str) -> List[Dict[str, Any]]:
        meta_url = f"{catalog_addon_url}/meta/series/{series_imdb_id}.json"
        meta_data = self.make_request(meta_url)
        if not meta_data or 'meta' not in meta_data: return []
        videos = meta_data['meta'].get('videos', [])
        return [{'id': f"{series_imdb_id}:{v['season']}:{v['episode']}", 'season': v['season'], 'episode': v['episode']}
                for v in videos if 'season' in v and 'episode' in v]

    def prefetch_streams(self, content_id: str, content_type: str, title: str = "") -> bool:
        return any(self._prefetch_single_stream(content_id, content_type, url, title) for url in self.stream_urls)

    def _prefetch_single_stream(self, content_id: str, content_type: str, stream_addon_url: str, title: str = "") -> bool:
        stream_url = f"{stream_addon_url}/stream/{content_type}/{content_id}.json"
        self.results['statistics']['cache_requests_made'] += 1
        response = None
        try:
            response = self.session.get(stream_url, timeout=self.network_request_timeout)
            response.raise_for_status()
            time.sleep(self.delay)
            self.results['statistics']['cache_requests_successful'] += 1

            # Cache uncached streams feature
            if self.cache_uncached_streams_enabled:
                try:
                    stream_data = response.json()
                    streams = stream_data.get('streams', [])

                    if streams:
                        # Count cached streams using regex
                        cached_pattern = re.compile(self.cached_stream_regex)
                        cached_count = 0
                        uncached_streams = []

                        for stream in streams:
                            name = stream.get('name', '')
                            description = stream.get('description', '')
                            combined_text = f"{name} {description}"

                            if cached_pattern.search(combined_text):
                                cached_count += 1
                            else:
                                url = stream.get('url', '')
                                if url:
                                    uncached_streams.append(url)

                        # Check if we need to trigger more caching
                        if cached_count <= self.cached_streams_count_threshold:
                            # Calculate dynamic attempt limit: max(goal * 3, 5)
                            max_attempts_allowed = min(
                                len(uncached_streams),  # Can't try more than available
                                max(self.max_cache_requests_per_item * 3, 5),  # Dynamic: at least 5, or 3x success goal
                                self.max_cache_requests_global - self.cache_requests_sent_count  # Global limit
                            )

                            successful_requests = 0
                            attempts = 0

                            # Log if attempting cache requests
                            if max_attempts_allowed > 0 and title and content_type == 'movie':
                                sys.stdout.write(f"\n🔄 Caching: {title}\n")
                                sys.stdout.flush()

                            # Try URLs until we get enough successes or run out of attempts
                            while (successful_requests < self.max_cache_requests_per_item and
                                   attempts < max_attempts_allowed and
                                   self.cache_requests_sent_count < self.max_cache_requests_global):

                                try:
                                    head_response = self.session.head(
                                        uncached_streams[attempts],
                                        timeout=self.network_request_timeout
                                    )

                                    # Check if request was successful (2xx status code)
                                    if 200 <= head_response.status_code < 300:
                                        successful_requests += 1
                                        self.cache_requests_successful_count += 1

                                    head_response.close()
                                    self.cache_requests_sent_count += 1
                                    attempts += 1
                                    time.sleep(self.delay)

                                except requests.exceptions.RequestException:
                                    # Failed attempt - count it and try next URL
                                    self.cache_requests_sent_count += 1
                                    attempts += 1

                except (json.JSONDecodeError, KeyError):
                    pass  # Silently fail JSON parsing errors

            return True
        except requests.exceptions.RequestException:
            self.results['statistics']['errors'] += 1
            return False
        finally:
            # Explicitly close response to free memory
            if response is not None:
                response.close()

    def get_catalog_mode(self, catalog_info: Dict[str, Any]) -> str:
        cat_type = catalog_info.get('type')
        if cat_type == 'movie': return 'movie'
        if cat_type == 'series': return 'series'
        return 'mixed'

    def process_all(self) -> Dict[str, Any]:
        self.start_time = time.time()
        
        header = "=" * 60 + "\nStarting Streams Prefetcher\n" + "=" * 60
        print(header)
        self._log(header)
        
        start_msg = f"Started at: {self.format_timestamp(self.start_time)}"
        print(start_msg)
        self._log(start_msg)
        
        # Log configuration
        if self.log_file:
            self._log("\n" + "=" * 60)
            self._log("SCRIPT CONFIGURATION")
            self._log("=" * 60)
            self._log(f"Addon URLs: {', '.join([f'{t}:{u}' for u, t in self.addon_urls])}")
            self._log(f"Movies Global Limit: {self.movies_global_limit if self.movies_global_limit != -1 else 'Unlimited'}")
            self._log(f"Series Global Limit: {self.series_global_limit if self.series_global_limit != -1 else 'Unlimited'}")
            self._log(f"Movies per Catalog: {self.movies_per_catalog if self.movies_per_catalog != -1 else 'Unlimited'}")
            self._log(f"Series per Catalog: {self.series_per_catalog if self.series_per_catalog != -1 else 'Unlimited'}")
            self._log(f"Items per Mixed Catalog: {self.items_per_mixed_catalog if self.items_per_mixed_catalog != -1 else 'Unlimited'}")
            self._log(f"Max Execution Time: {format_time_string(self.max_execution_time)}")
            self._log(f"Cache Validity: {format_time_string(self.cache_validity_seconds)}")
            self._log(f"Delay: {format_time_string(self.delay)}")
            self._log(f"Proxy: {self.proxy_url or 'None'}")
            self._log(f"Randomize Catalogs: {'Yes' if self.randomize_catalogs else 'No'}")
            self._log(f"Randomize Items: {'Yes' if self.randomize_items else 'No'}")
            self._log(f"Logging: Enabled (data/logs)")
        
        fetch_msg = "\nFetching valid catalogs from catalog addons..."
        print(fetch_msg)
        self._log("\n" + fetch_msg)
        
        self.catalog_discovery_start = time.time()
        
        all_included_catalogs, all_skipped_catalogs, total_manifest_catalogs = [], [], 0
        for url in self.catalog_urls:
            included, skipped, total = self.get_catalogs(url)
            all_included_catalogs.extend([(c, url) for c in included])
            all_skipped_catalogs.extend([(s['catalog'], url, s['reason']) for s in skipped])
            total_manifest_catalogs += total

        self.catalog_discovery_end = time.time()
        discovery_duration = self.catalog_discovery_end - self.catalog_discovery_start

        found_msg = f"\nFound {total_manifest_catalogs} catalogs in {self.format_duration(self.catalog_discovery_start, self.catalog_discovery_end)}."
        print(found_msg)
        self._log(found_msg)
        
        # Log catalog table to file
        if self.log_file:
            self._log("\n" + "=" * 60)
            self._log("DETECTED CATALOGS")
            self._log("=" * 60)
            for cat, _ in all_included_catalogs:
                self._log(f"✅ Included | {cat.get('name', 'N/A')} | {self.get_catalog_type_display(cat)}")
            for cat, _, reason in all_skipped_catalogs:
                self._log(f"❌ Skipped  | {cat.get('name', 'N/A')} | {self.get_catalog_type_display(cat)} | Reason: {reason}")
        
        self.print_catalog_table(all_included_catalogs, all_skipped_catalogs)
        
        if self.randomize_catalogs: random.shuffle(all_included_catalogs)

        total_to_process = len(all_included_catalogs)
        self.results['statistics']['total_catalogs_in_manifest'] = total_manifest_catalogs
        self.results['statistics']['filtered_catalogs'] = total_to_process
        
        processing_msg = f"\nStarting processing of {total_to_process} catalogs"
        print(processing_msg)
        self._log(processing_msg)
        
        self.processing_start = time.time()
        self.progress_tracker.init_overall_progress([c[0].get('name', 'N/A') for c in all_included_catalogs])
        
        for i, (cat_info, cat_addon_url) in enumerate(all_included_catalogs):
            catalog_start_time = time.time()
            cat_id, cat_name = cat_info.get('id', 'N/A'), cat_info.get('name', 'N/A')
            cat_mode = self.get_catalog_mode(cat_info)
            if cat_mode == 'movie': per_catalog_limit = self.movies_per_catalog
            elif cat_mode == 'series': per_catalog_limit = self.series_per_catalog
            else: per_catalog_limit = self.items_per_mixed_catalog
            
            # Store initial counts at the start of processing this catalog
            initial_movies_count = self.prefetched_movies_count
            initial_series_count = self.prefetched_series_count
            initial_cache_requests = self.cache_requests_sent_count  # Track cache requests at start

            page = 0
            success_count, failed_count, cached_count, prefetched_in_this_catalog = 0, 0, 0, 0
            
            while True:
                # Check execution time limit before fetching new page (optimization to avoid unnecessary API call)
                if self._check_time_limit():
                    break
                
                if per_catalog_limit != -1 and prefetched_in_this_catalog >= per_catalog_limit: break
                movies_limit_reached = self.movies_global_limit != -1 and self.prefetched_movies_count >= self.movies_global_limit
                series_limit_reached = self.series_global_limit != -1 and self.prefetched_series_count >= self.series_global_limit
                if (cat_mode == 'movie' and movies_limit_reached) or (cat_mode == 'series' and series_limit_reached) or (cat_mode == 'mixed' and movies_limit_reached and series_limit_reached): break

                page += 1
                self.progress_tracker.redraw_dashboard(
                    catalog_statuses=[c['status'] for c in self.progress_tracker.overall_catalogs],
                    completed_catalogs=i,
                    total_catalogs=total_to_process,
                    catalog_name=cat_name,
                    catalog_mode=cat_mode,
                    mode='fetching',
                    fetched_items=page,
                    prefetched_movies_count=self.prefetched_movies_count,
                    movies_global_limit=self.movies_global_limit,
                    prefetched_series_count=self.prefetched_series_count,
                    series_global_limit=self.series_global_limit,
                    prefetched_cached_count=self.prefetched_cached_count,
                    prefetched_in_this_catalog=prefetched_in_this_catalog,
                    per_catalog_limit=per_catalog_limit,
                    start_time=self.processing_start,
                    max_execution_time=self.max_execution_time
                )
                
                cat_url = f"{cat_addon_url}/catalog/{cat_info.get('type', 'movie')}/{cat_id}/skip={(page-1) * 100}.json"
                cat_data = self.make_request(cat_url)
                self.results['statistics']['total_pages_fetched'] += 1
                metas = cat_data.get('metas', []) if cat_data else []
                if not metas: break

                if self.randomize_items: random.shuffle(metas)

                # Count how many items on this page are already cached vs need prefetching (for verbose logging)
                if self.enable_logging:
                    page_cached_count = 0
                    page_needs_prefetch = 0
                    for item in metas:
                        item_type = item.get('type')
                        imdb_id = self.extract_imdb_id(item)
                        if imdb_id and self.is_cache_valid(imdb_id):
                            page_cached_count += 1
                        else:
                            page_needs_prefetch += 1

                    print(f"\n📄 Fetched page {page} for catalog '{cat_name}': {len(metas)} items found")
                    print(f"   ⚡ Already prefetched (will skip): {page_cached_count}")
                    print(f"   🔄 Need to prefetch: {page_needs_prefetch}")
                    print(f"   📊 Catalog progress: {prefetched_in_this_catalog}/{per_catalog_limit if per_catalog_limit != -1 else '∞'} items prefetched so far")
                    sys.stdout.flush()

                self._is_processing_items = True  # Enable auto-refresh
                item_statuses_on_page = []
                for item in metas:
                    # Check if paused BEFORE starting new item (wait if paused)
                    if self.scheduler:
                        self.scheduler.pause_event.wait()  # Blocks if paused, returns immediately if not

                    if per_catalog_limit != -1 and prefetched_in_this_catalog >= per_catalog_limit: break
                    item_type = item.get('type')
                    if item_type == 'movie' and self.movies_global_limit != -1 and self.prefetched_movies_count >= self.movies_global_limit: continue
                    if item_type == 'series' and self.series_global_limit != -1 and self.prefetched_series_count >= self.series_global_limit: continue

                    dashboard_args = {
                        'catalog_statuses': [c['status'] for c in self.progress_tracker.overall_catalogs],
                        'completed_catalogs': i,
                        'total_catalogs': total_to_process,
                        'catalog_name': cat_name,
                        'catalog_mode': cat_mode,
                        'mode': 'prefetching',
                        'item_statuses': item_statuses_on_page,
                        'total_items': len(metas),
                        'prefetched_movies_count': self.prefetched_movies_count,
                        'movies_global_limit': self.movies_global_limit,
                        'prefetched_series_count': self.prefetched_series_count,
                        'series_global_limit': self.series_global_limit,
                        'prefetched_cached_count': self.prefetched_cached_count,
                        'prefetched_in_this_catalog': prefetched_in_this_catalog,
                        'per_catalog_limit': per_catalog_limit,
                        'prefetched_movies_count_at_start': initial_movies_count,
                        'prefetched_series_count_at_start': initial_series_count,
                        'catalog_movies_count': self.prefetched_movies_count - initial_movies_count,
                        'catalog_series_count': self.prefetched_series_count - initial_series_count,
                        'start_time': self.processing_start,
                        'max_execution_time': self.max_execution_time
                    }

                    if item_type == 'movie':
                        imdb_id, title = self.extract_imdb_id(item), self.get_title_from_item(item)
                        self.progress_tracker.redraw_dashboard(
                            current_title=f"Prefetching streams for Movie: {title}",
                            current_imdb_id=imdb_id,
                            current_item_type='movie',
                            **dashboard_args
                        )
                        if not imdb_id: failed_count += 1; item_statuses_on_page.append('failed'); continue
                        if self.is_cache_valid(imdb_id):
                            cached_count += 1
                            self.prefetched_cached_count += 1
                            item_statuses_on_page.append('cached')
                            self._current_dashboard_args = dashboard_args
                            self._auto_redraw_dashboard()
                            continue

                        # Check if pause was requested BEFORE prefetching (after showing UI)
                        if self.scheduler and self.scheduler.pause_requested:
                            # UI already shows this item (poster, name, etc.)
                            # Now pause before prefetching it
                            self.scheduler.complete_pause()
                            # This will block here until resumed
                            self.scheduler.pause_event.wait()

                        # Check time limit before starting HTTP request
                        if self._check_time_limit():
                            break

                        if self.prefetch_streams(imdb_id, 'movie', title):
                            self.update_cache(imdb_id, title)
                            success_count += 1; prefetched_in_this_catalog += 1; self.prefetched_movies_count += 1
                            item_statuses_on_page.append('successful')
                        else: failed_count += 1; item_statuses_on_page.append('failed')

                    elif item_type == 'series':
                        series_imdb_id, title = self.extract_imdb_id(item), self.get_title_from_item(item)
                        self.progress_tracker.redraw_dashboard(
                            current_title=f"Prefetching streams for Series: {title}",
                            current_imdb_id=series_imdb_id,
                            current_item_type='series',
                            **dashboard_args
                        )
                        if not series_imdb_id: failed_count += 1; item_statuses_on_page.append('failed'); continue

                        # Check if pause was requested BEFORE prefetching (after showing UI)
                        if self.scheduler and self.scheduler.pause_requested:
                            # UI already shows this series (poster, name, etc.)
                            # Now pause before prefetching it
                            self.scheduler.complete_pause()
                            # This will block here until resumed
                            self.scheduler.pause_event.wait()

                        episodes = self.get_series_episodes(series_imdb_id, cat_addon_url)
                        if not episodes: failed_count += 1; item_statuses_on_page.append('failed'); continue
                        self.results['statistics']['episodes_found'] += len(episodes)
                        cached_episodes = sum(1 for ep in episodes if self.is_cache_valid(ep['id']))
                        if (cached_episodes / len(episodes)) >= 0.75:
                            cached_count += 1
                            self.prefetched_cached_count += 1
                            item_statuses_on_page.append('cached')
                            self._current_dashboard_args = dashboard_args
                            self._auto_redraw_dashboard()
                            continue
                        series_had_success = False
                        for ep in episodes:
                            # Check if paused BEFORE starting new episode (wait if paused)
                            if self.scheduler:
                                self.scheduler.pause_event.wait()  # Blocks if paused, returns immediately if not

                            if self.is_cache_valid(ep['id']): continue

                            ep_title = self.get_formatted_episode_title(item, ep['season'], ep['episode'])
                            dashboard_args['item_statuses'] = item_statuses_on_page # Ensure dashboard has latest statuses
                            self.progress_tracker.redraw_dashboard(
                                current_title=f"Prefetching streams for Series: {ep_title}",
                                current_imdb_id=ep['id'],
                                current_item_type='episode',
                                **dashboard_args
                            )

                            # Check if pause was requested BEFORE prefetching (after showing UI)
                            if self.scheduler and self.scheduler.pause_requested:
                                # UI already shows this episode (poster, name, etc.)
                                # Now pause before prefetching it
                                self.scheduler.complete_pause()
                                # This will block here until resumed
                                self.scheduler.pause_event.wait()

                            # Check time limit before starting HTTP request
                            if self._check_time_limit():
                                break

                            if self.prefetch_streams(ep['id'], 'series', ep_title):
                               self.update_cache(ep['id'], ep_title); series_had_success = True; self.prefetched_episodes_count += 1

                        if series_had_success:
                            success_count += 1; prefetched_in_this_catalog += 1; self.prefetched_series_count += 1
                            item_statuses_on_page.append('successful')
                        else: failed_count += 1; item_statuses_on_page.append('failed')

                self._is_processing_items = False  # Disable auto-refresh

            catalog_end_time = time.time()
            catalog_duration = catalog_end_time - catalog_start_time

            # Calculate cache requests made during this catalog
            catalog_cache_requests = self.cache_requests_sent_count - initial_cache_requests

            # Store catalog timing information
            catalog_result = {
                'name': cat_name,
                'type': cat_mode,
                'success_count': success_count,
                'failed_count': failed_count,
                'cached_count': cached_count,
                'cache_requests_sent': catalog_cache_requests,
                'duration': catalog_duration,
                'start_time': catalog_start_time,
                'end_time': catalog_end_time
            }
            self.results['processed_catalogs'].append(catalog_result)
            
            self.results['statistics']['cached_count'] += cached_count
            self.progress_tracker.finish_catalog_processing(success_count, failed_count, cached_count, catalog_name=cat_name)
            
            # Check execution time limit after each catalog
            if self._check_time_limit():
                print(f"\n\n⏱️  Maximum execution time ({format_time_string(self.max_execution_time)}) reached. Stopping gracefully...")
                break

        self.processing_end = time.time()
        self.end_time = time.time()
        
        self.progress_tracker.cleanup_dashboard()
        self.results['statistics']['movies_prefetched'] = self.prefetched_movies_count
        self.results['statistics']['series_prefetched'] = self.prefetched_series_count
        self.results['statistics']['episodes_prefetched'] = self.prefetched_episodes_count
        self.results['statistics']['service_cache_requests_sent'] = self.cache_requests_sent_count
        self.results['statistics']['service_cache_requests_successful'] = self.cache_requests_successful_count
        
        # Store timing information in results
        self.results['timing'] = {
            'start_time': self.start_time,
            'end_time': self.end_time,
            'catalog_discovery_start': self.catalog_discovery_start,
            'catalog_discovery_end': self.catalog_discovery_end,
            'processing_start': self.processing_start,
            'processing_end': self.processing_end,
            'total_duration': self.end_time - self.start_time,
            'discovery_duration': discovery_duration,
            'processing_duration': self.processing_end - self.processing_start
        }
        
        # Log per-catalog timing stats
        if self.log_file and self.results.get('processed_catalogs'):
            self._log("\n" + "=" * 60)
            self._log("PER-CATALOG TIMING STATISTICS")
            self._log("=" * 60)
            self._log(f"{'Catalog':<30} | {'Type':<8} | {'Duration':<10} | {'Success':<7} | {'Failed':<7} | {'Cached':<7} | {'Cache Reqs':<11}")
            self._log("-" * 103)
            for cat in self.results['processed_catalogs']:
                name = cat.get('name', 'Unknown')[:30]
                cat_type = cat.get('type', 'mixed')[:8]
                duration = self.format_duration(cat.get('start_time'), cat.get('end_time'))
                success = cat.get('success_count', 0)
                failed = cat.get('failed_count', 0)
                cached = cat.get('cached_count', 0)
                cache_reqs = cat.get('cache_requests_sent', 0)
                self._log(f"{name:<30} | {cat_type:<8} | {duration:<10} | {success:<7} | {failed:<7} | {cached:<7} | {cache_reqs:<11}")
        
        return self.results
    
    def print_summary(self, interrupted: bool = False):
        stats = self.results['statistics']
        timing = self.results.get('timing', {})
        
        summary_header = "\n" + "=" * 60 + "\nSTREAMS PREFETCHER SUMMARY\n" + "=" * 60
        print(summary_header)
        self._log("\n" + summary_header)
        
        if interrupted: 
            interrupt_msg = "🚨 Script was interrupted by user. Summary may be incomplete. 🚨\n"
            print(interrupt_msg)
            self._log(interrupt_msg)
            # Set end_time if not already set due to interruption
            if self.end_time is None:
                self.end_time = time.time()
        
        # Use instance variables if timing dict is empty (happens on interruption)
        start_time = timing.get('start_time') or self.start_time
        end_time = timing.get('end_time') or self.end_time
        discovery_start = timing.get('catalog_discovery_start') or self.catalog_discovery_start
        discovery_end = timing.get('catalog_discovery_end') or self.catalog_discovery_end
        processing_start = timing.get('processing_start') or self.processing_start
        processing_end = timing.get('processing_end') or self.processing_end
        
        # Timing Information
        timing_section = "Timing Information:"
        print(timing_section)
        self._log(timing_section)
        
        lines = [
            f"  Started at:                  {self.format_timestamp(start_time)}",
            f"  Finished at:                 {self.format_timestamp(end_time)}",
            f"  Total duration:              {self.format_duration(start_time, end_time)}",
            f"  Catalog discovery:           {self.format_duration(discovery_start, discovery_end)}",
            f"  Processing time:             {self.format_duration(processing_start, processing_end)}"
        ]
        
        for line in lines:
            print(line)
            self._log(line)
        
        # Calculate processing rates
        processing_duration = (processing_end - processing_start) if processing_end and processing_start else 0
        if processing_duration > 0:
            movie_rate = self.calculate_rate(stats['movies_prefetched'], processing_duration)
            series_rate = self.calculate_rate(stats['series_prefetched'], processing_duration)
            total_items = stats['movies_prefetched'] + stats['series_prefetched']
            total_rate = self.calculate_rate(total_items, processing_duration)
            
            rate_lines = [
                f"  Movie prefetch rate:         {movie_rate}",
                f"  Series prefetch rate:        {series_rate}",
                f"  Overall prefetch rate:       {total_rate}"
            ]
            for line in rate_lines:
                print(line)
                self._log(line)

        stats_section = "\nStatistics:"
        print(stats_section)
        self._log(stats_section)
        
        stat_lines = [
            f"  Catalogs processed:          {self.progress_tracker.current_catalog_index} / {stats['filtered_catalogs']}",
            f"  Movies prefetched:           {stats['movies_prefetched']} (Limit: {self.movies_global_limit if self.movies_global_limit != -1 else '∞'})",
            f"  Series prefetched:           {stats['series_prefetched']} (Limit: {self.series_global_limit if self.series_global_limit != -1 else '∞'})",
            f"  Total pages fetched:         {stats['total_pages_fetched']}",
            f"  Episodes discovered:         {stats['episodes_found']}",
            f"  Items skipped from cache:    {stats['cached_count']}",
            f"  Prefetch attempts:           {stats['cache_requests_made']}",
            f"  Successful prefetches:       {stats['cache_requests_successful']}",
            f"  Service cache requests sent: {stats['service_cache_requests_sent']}",
            f"  Errors encountered:          {stats['errors']}"
        ]
        
        for line in stat_lines:
            print(line)
            self._log(line)
        
        if stats['cache_requests_made'] > 0:
            success_rate = (stats['cache_requests_successful'] / stats['cache_requests_made']) * 100
            success_line = f"  Prefetch success rate:       {success_rate:.1f}%"
            print(success_line)
            self._log(success_line)
        
        # Per-catalog timing breakdown (top 10 longest)
        processed_catalogs = self.results.get('processed_catalogs', [])
        if processed_catalogs:
            catalog_header = f"\nCatalog Processing Summary (Top 10 by duration):"
            print(catalog_header)
            self._log(catalog_header)
            
            sorted_catalogs = sorted(processed_catalogs, key=lambda x: x.get('duration', 0), reverse=True)[:10]
            
            # Calculate column widths
            max_name_len = max(len(cat.get('name', 'Unknown')) for cat in sorted_catalogs)
            name_width = min(max_name_len, 25)  # Cap at 25 characters
            
            table_header = f"  {'Catalog':<{name_width}} | {'Type':<6} | {'Duration':<8} | {'Success':<7} | {'Failed':<6} | {'Cached':<6} | {'Cache Reqs':<11}"
            table_divider = f"  {'-' * name_width}-+-{'-' * 6}-+-{'-' * 8}-+-{'-' * 7}-+-{'-' * 6}-+-{'-' * 6}-+-{'-' * 11}"

            print(table_header)
            print(table_divider)
            self._log(table_header)
            self._log(table_divider)

            for cat in sorted_catalogs:
                name = cat.get('name', 'Unknown')
                display_name = name[:name_width-3] + "..." if len(name) > name_width else name
                cat_type = cat.get('type', 'mixed').capitalize()[:6]
                duration = self.format_duration(cat.get('start_time'), cat.get('end_time'))
                success = cat.get('success_count', 0)
                failed = cat.get('failed_count', 0)
                cached = cat.get('cached_count', 0)
                cache_reqs = cat.get('cache_requests_sent', 0)

                row = f"  {display_name:<{name_width}} | {cat_type:<6} | {duration:<8} | {success:<7} | {failed:<6} | {cached:<6} | {cache_reqs:<11}"
                print(row)
                self._log(row)
        
        final_msg = "\nYour Stremio addon cache has been warmed up!\nContent should now load faster when you browse in Stremio. ✨"
        print(final_msg)
        self._log(final_msg)

def main():
    parser = argparse.ArgumentParser(description='Prefetch streams from a Stremio addon for faster loading.', formatter_class=argparse.RawDescriptionHelpFormatter, epilog='''
This script warms up the addon cache by making requests to stream endpoints.
When you later browse in Stremio, content will load much faster!

Examples:
  # Prefetch up to 100 movies and 20 series globally, with per-catalog limits
  python prefetcher.py --addon-urls both:https://my-addon.com --movies-global-limit 100 --series-global-limit 20 --movies-per-catalog 50 --series-per-catalog 10 --items-per-mixed-catalog 30

  # Prefetch unlimited items from all catalogs (use with caution)
  python prefetcher.py --addon-urls cat:url1,str:url2 --movies-global-limit -1 --series-global-limit -1 --movies-per-catalog -1 --series-per-catalog -1 --items-per-mixed-catalog -1
''')
    parser.add_argument('--addon-urls', type=parse_addon_urls, required=True, help='A comma-separated list of addon URLs with their type. Format: "type:url", e.g., "catalog:url1,stream:url2,both:url3".')
    parser.add_argument('--movies-global-limit', type=int, default=200, help='Global limit for total movies to prefetch. -1 for unlimited. (Default: 200)')
    parser.add_argument('--series-global-limit', type=int, default=15, help='Global limit for total series to prefetch. -1 for unlimited. (Default: 15)')
    parser.add_argument('--movies-per-catalog', type=int, default=50, help='Per-catalog limit for movie-only catalogs. -1 for unlimited. (Default: 50)')
    parser.add_argument('--series-per-catalog', type=int, default=5, help='Per-catalog limit for series-only catalogs. -1 for unlimited. (Default: 5)')
    parser.add_argument('--items-per-mixed-catalog', type=int, default=30, help='Per-catalog limit for mixed-type catalogs. -1 for unlimited. (Default: 30)')
    parser.add_argument('-d', '--delay', type=parse_time_string, default='0s', help='Delay between requests. Format: 500ms, 30s, 5m (minutes), 2h, 1d, 1w, 1M (months), 1y. (default: 0s)')
    parser.add_argument('--proxy', type=str, help='HTTP proxy URL (e.g., http://proxy.example.com:8080)')
    parser.add_argument('--randomize-catalog-processing', action='store_true', help='Randomize the order in which catalogs are processed.')
    parser.add_argument('--randomize-item-prefetching', action='store_true', help='Randomize the order of items within a catalog.')
    parser.add_argument('--cache-validity', type=parse_time_string, default='3d', help='Validity of cached items. Format: 30s, 5m (minutes), 2h, 3d, 1w, 1M (months), 1y. (default: 3d)')
    parser.add_argument('-t', '--max-execution-time', type=parse_time_string, default='-1s', help='Maximum execution time. Format: 30s, 5m (minutes), 2h, 1d, 1w, 1M (months), 1y or -1 (with any unit) for unlimited. (default: -1s)')
    parser.add_argument('--enable-logging', action='store_true', help='Enable logging. Creates timestamped log files in data/logs directory with full execution details.')
    
    args = parser.parse_args()
    
    terminal_width = get_terminal_size()
    params = {
        'Addon URLs': ', '.join([f"{t}:{u}" for u, t in args.addon_urls]),
        'Movies Global Limit': str(args.movies_global_limit) if args.movies_global_limit != -1 else 'Unlimited',
        'Series Global Limit': str(args.series_global_limit) if args.series_global_limit != -1 else 'Unlimited',
        'Movies per Catalog': str(args.movies_per_catalog) if args.movies_per_catalog != -1 else 'Unlimited',
        'Series per Catalog': str(args.series_per_catalog) if args.series_per_catalog != -1 else 'Unlimited',
        'Items per Mixed Catalog': str(args.items_per_mixed_catalog) if args.items_per_mixed_catalog != -1 else 'Unlimited',
        'Max Execution Time': format_time_string(args.max_execution_time),
        'Cache Validity': format_time_string(args.cache_validity),
        'Delay': format_time_string(args.delay),
        'Proxy': args.proxy or 'None',
        'Randomize Catalogs': 'Yes' if args.randomize_catalog_processing else 'No',
        'Randomize Items': 'Yes' if args.randomize_item_prefetching else 'No'
    }

    print("=" * terminal_width)
    print("Script Configuration:")
    print("=" * terminal_width)
    for param, value in params.items():
        print(f"  {param:<28}: {value}")
    print("-" * terminal_width)

    prefetcher = StreamsPrefetcher(args.addon_urls, movies_global_limit=args.movies_global_limit, series_global_limit=args.series_global_limit, movies_per_catalog=args.movies_per_catalog, series_per_catalog=args.series_per_catalog, items_per_mixed_catalog=args.items_per_mixed_catalog, delay=args.delay, proxy_url=args.proxy, randomize_catalogs=args.randomize_catalog_processing, randomize_items=args.randomize_item_prefetching, cache_validity_seconds=args.cache_validity, max_execution_time=args.max_execution_time, enable_logging=args.enable_logging)
    
    try:
        results = prefetcher.process_all()
        prefetcher.print_summary(interrupted=False)
        print("\nPrefetching completed successfully!")
        return 0
    except KeyboardInterrupt:
        print("\n\nScript interrupted by user. Cleaning up and generating summary...")
        prefetcher.progress_tracker.cleanup_dashboard()
        prefetcher.print_summary(interrupted=True)
        return 1
    except Exception as e:
        print(f"\n\nAn unexpected error occurred: {e}")
        prefetcher.progress_tracker.cleanup_dashboard()
        return 1
    finally:
        if prefetcher.db_conn: prefetcher.db_conn.close()

if __name__ == "__main__":
    sys.exit(main())
