"""
Streams Prefetcher Wrapper
Provides a programmatic interface to run streams_prefetcher.py with callbacks
"""

import sys
import io
from typing import Callable, Optional, Dict, Any, List, Tuple
from streams_prefetcher_filtered import FilteredStreamsPrefetcher
from config_manager import ConfigManager


class StreamsPrefetcherWrapper:
    """Wrapper for programmatic execution of StreamsPrefetcher"""

    def __init__(
        self,
        config_manager: ConfigManager,
        scheduler = None,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
        output_callback: Optional[Callable[[str], None]] = None
    ):
        self.config_manager = config_manager
        self.scheduler = scheduler
        self.progress_callback = progress_callback
        self.output_callback = output_callback
        self.prefetcher = None

    def _parse_config_to_args(self) -> Dict[str, Any]:
        """Parse configuration into arguments for StreamsPrefetcher"""
        config = self.config_manager.get_all()

        # Get saved catalogs (filtered by enabled state)
        saved_catalogs = config.get('saved_catalogs', [])
        enabled_catalogs = [cat for cat in saved_catalogs if cat.get('enabled', False)]

        # Build addon URLs with catalog filters
        # Group enabled catalogs by addon URL
        addon_catalog_map = {}
        for cat in enabled_catalogs:
            addon_url = cat['addon_url']
            if addon_url not in addon_catalog_map:
                addon_catalog_map[addon_url] = []
            addon_catalog_map[addon_url].append(cat)

        # Parse addon URLs with their catalog filters
        addon_urls = []
        for item in config.get('addon_urls', []):
            # Include catalog addons that have enabled catalogs
            if item['type'] in ['catalog', 'both'] and item['url'] in addon_catalog_map:
                addon_urls.append((item['url'], item['type']))
            # Always include stream-only addons regardless of catalog selection
            elif item['type'] == 'stream':
                addon_urls.append((item['url'], item['type']))

        if not addon_urls:
            raise ValueError("No addon URLs configured or no catalogs enabled")

        # Build catalog filter (catalog IDs to include)
        catalog_filter = []
        for cat in enabled_catalogs:
            # Extract catalog ID from the full ID (format: "addon_url|catalog_id")
            if '|' in cat['id']:
                catalog_id = cat['id'].split('|', 1)[1]
                catalog_filter.append(catalog_id)

        # Get cache_uncached_streams config
        cache_uncached_streams = config.get('cache_uncached_streams', {})

        return {
            'addon_urls': addon_urls,
            'catalog_filter': catalog_filter if catalog_filter else None,
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
            'enable_logging': config.get('enable_logging', False),
            'cache_uncached_streams_enabled': cache_uncached_streams.get('enabled', False),
            'cached_stream_regex': cache_uncached_streams.get('cached_stream_regex', '⚡'),
            'max_cache_requests_per_item': cache_uncached_streams.get('max_cache_requests_per_item', 1),
            'max_cache_requests_global': cache_uncached_streams.get('max_cache_requests_global', 50),
            'max_required_cached_streams': cache_uncached_streams.get('max_required_cached_streams', 0)
        }

    def run(self) -> Dict[str, Any]:
        """Run the prefetcher and return results"""
        try:
            # Parse configuration
            args = self._parse_config_to_args()

            # Create prefetcher instance with filtering support
            self.prefetcher = FilteredStreamsPrefetcher(scheduler=self.scheduler, **args)

            # Optionally wrap progress tracker methods to provide callbacks
            if self.progress_callback:
                self._wrap_progress_tracker()

            # Run the prefetcher
            results = self.prefetcher.process_all()

            # Print summary
            self.prefetcher.print_summary(interrupted=False)

            return {'success': True, 'results': results}

        except KeyboardInterrupt:
            if self.output_callback:
                self.output_callback("\n\nScript interrupted by user. Cleaning up and generating summary...")

            results = None
            if self.prefetcher:
                self.prefetcher.progress_tracker.cleanup_dashboard()
                self.prefetcher.print_summary(interrupted=True)
                results = self.prefetcher.results if hasattr(self.prefetcher, 'results') else None

            return {'success': False, 'interrupted': True, 'results': results}

        except Exception as e:
            if self.output_callback:
                self.output_callback(f"\n\nAn unexpected error occurred: {e}")

            results = None
            if self.prefetcher:
                self.prefetcher.progress_tracker.cleanup_dashboard()
                results = self.prefetcher.results if hasattr(self.prefetcher, 'results') else None

            return {'success': False, 'error': str(e), 'results': results}

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
                mode = kwargs.get('mode', 'idle')

                # Build comprehensive progress data
                progress_data = {
                    'catalog_name': kwargs.get('catalog_name', ''),
                    'catalog_mode': kwargs.get('catalog_mode', ''),
                    'completed_catalogs': kwargs.get('completed_catalogs', 0),
                    'total_catalogs': kwargs.get('total_catalogs', 0),
                    'movies_prefetched': kwargs.get('prefetched_movies_count', 0),
                    'movies_limit': kwargs.get('movies_global_limit', -1),
                    'series_prefetched': kwargs.get('prefetched_series_count', 0),
                    'series_limit': kwargs.get('series_global_limit', -1),
                    'episodes_prefetched': self.prefetcher.prefetched_episodes_count,
                    'cached_count': kwargs.get('prefetched_cached_count', 0),
                    'catalog_movies_count': kwargs.get('catalog_movies_count', 0),
                    'catalog_series_count': kwargs.get('catalog_series_count', 0),
                    'mode': mode,
                    'current_title': kwargs.get('current_title', ''),
                    'current_imdb_id': kwargs.get('current_imdb_id', ''),
                    'current_item_type': kwargs.get('current_item_type', ''),
                    'current_catalog_items': kwargs.get('prefetched_in_this_catalog', 0),
                    'current_catalog_limit': kwargs.get('per_catalog_limit', -1),
                }

                # Add page fetching information
                if mode == 'fetching':
                    progress_data['current_page'] = kwargs.get('fetched_items', 0)
                    progress_data['fetching_page'] = True
                elif mode == 'prefetching':
                    # Calculate items discovered from item_statuses or total_items
                    item_statuses = kwargs.get('item_statuses', [])
                    total_items = kwargs.get('total_items', len(item_statuses))
                    progress_data['items_on_current_page'] = total_items
                    progress_data['processed_items_on_page'] = len(item_statuses)
                    progress_data['fetching_page'] = False

                self.progress_callback(progress_data)

        # Replace the method
        self.prefetcher.progress_tracker.redraw_dashboard = wrapped_redraw
