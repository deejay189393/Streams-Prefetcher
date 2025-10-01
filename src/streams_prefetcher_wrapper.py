"""
Streams Prefetcher Wrapper
Provides a programmatic interface to run streams_prefetcher.py with callbacks
"""

import sys
import io
from typing import Callable, Optional, Dict, Any, List, Tuple
from streams_prefetcher import StreamsPrefetcher, parse_addon_urls
from config_manager import ConfigManager


class StreamsPrefetcherWrapper:
    """Wrapper for programmatic execution of StreamsPrefetcher"""

    def __init__(
        self,
        config_manager: ConfigManager,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
        output_callback: Optional[Callable[[str], None]] = None
    ):
        self.config_manager = config_manager
        self.progress_callback = progress_callback
        self.output_callback = output_callback
        self.prefetcher = None

    def _parse_config_to_args(self) -> Dict[str, Any]:
        """Parse configuration into arguments for StreamsPrefetcher"""
        config = self.config_manager.get_all()

        # Parse addon URLs
        addon_urls = []
        for item in config.get('addon_urls', []):
            addon_urls.append((item['url'], item['type']))

        if not addon_urls:
            raise ValueError("No addon URLs configured")

        return {
            'addon_urls': addon_urls,
            'movies_global_limit': config.get('movies_global_limit', 200),
            'series_global_limit': config.get('series_global_limit', 15),
            'movies_per_catalog': config.get('movies_per_catalog', 50),
            'series_per_catalog': config.get('series_per_catalog', 5),
            'items_per_mixed_catalog': config.get('items_per_mixed_catalog', 30),
            'delay': config.get('delay', 0),
            'proxy_url': config.get('proxy', None) or None,
            'randomize_catalogs': config.get('randomize_catalog_processing', False),
            'randomize_items': config.get('randomize_item_prefetching', False),
            'cache_validity_seconds': config.get('cache_validity', 259200),
            'max_execution_time': config.get('max_execution_time', -1),
            'enable_logging': config.get('enable_logging', False)
        }

    def run(self) -> bool:
        """Run the prefetcher"""
        try:
            # Parse configuration
            args = self._parse_config_to_args()

            # Create prefetcher instance
            self.prefetcher = StreamsPrefetcher(**args)

            # Optionally wrap progress tracker methods to provide callbacks
            if self.progress_callback:
                self._wrap_progress_tracker()

            # Run the prefetcher
            results = self.prefetcher.process_all()

            # Print summary
            self.prefetcher.print_summary(interrupted=False)

            return True

        except KeyboardInterrupt:
            if self.output_callback:
                self.output_callback("\n\nScript interrupted by user. Cleaning up and generating summary...")

            if self.prefetcher:
                self.prefetcher.progress_tracker.cleanup_dashboard()
                self.prefetcher.print_summary(interrupted=True)

            return False

        except Exception as e:
            if self.output_callback:
                self.output_callback(f"\n\nAn unexpected error occurred: {e}")

            if self.prefetcher:
                self.prefetcher.progress_tracker.cleanup_dashboard()

            return False

        finally:
            if self.prefetcher and self.prefetcher.db_conn:
                self.prefetcher.db_conn.close()

    def _wrap_progress_tracker(self):
        """Wrap progress tracker methods to provide callbacks"""
        original_redraw = self.prefetcher.progress_tracker.redraw_dashboard

        def wrapped_redraw(**kwargs):
            # Call original method
            original_redraw(**kwargs)

            # Extract progress data and call callback
            if self.progress_callback:
                progress_data = {
                    'catalog_name': kwargs.get('catalog_name', ''),
                    'catalog_mode': kwargs.get('catalog_mode', ''),
                    'completed_catalogs': kwargs.get('completed_catalogs', 0),
                    'total_catalogs': kwargs.get('total_catalogs', 0),
                    'movies_prefetched': kwargs.get('prefetched_movies_count', 0),
                    'movies_limit': kwargs.get('movies_global_limit', -1),
                    'series_prefetched': kwargs.get('prefetched_series_count', 0),
                    'series_limit': kwargs.get('series_global_limit', -1),
                    'mode': kwargs.get('mode', 'idle'),
                    'current_title': kwargs.get('current_title', ''),
                }
                self.progress_callback(progress_data)

        # Replace the method
        self.prefetcher.progress_tracker.redraw_dashboard = wrapped_redraw
