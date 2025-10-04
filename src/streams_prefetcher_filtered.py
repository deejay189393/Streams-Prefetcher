"""
Filtered Streams Prefetcher
Extends the original StreamsPrefetcher with catalog filtering support.

This allows processing only user-selected catalogs instead of all catalogs.
"""

import sys
import os

# Import the original prefetcher
sys.path.insert(0, '/opt/Streams-Prefetcher/src')
from streams_prefetcher import StreamsPrefetcher as OriginalStreamsPrefetcher
from typing import List, Dict, Any, Tuple, Optional


class FilteredStreamsPrefetcher(OriginalStreamsPrefetcher):
    """
    StreamsPrefetcher with catalog filtering capability.

    This class extends the original to add catalog filtering based on
    user selection from the web interface.
    """

    def __init__(self, *args, catalog_filter: Optional[List[str]] = None, **kwargs):
        """
        Initialize with optional catalog filter.

        Args:
            catalog_filter: List of catalog IDs to include (None = all catalogs)
            *args, **kwargs: Same as original StreamsPrefetcher
        """
        super().__init__(*args, **kwargs)
        self.catalog_filter = set(catalog_filter) if catalog_filter else None

    def get_catalogs(self, catalog_addon_url: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], int]:
        """
        Override to filter catalogs based on user selection.

        Returns only catalogs that are in the filter list (if filter is set).
        """
        # Get all catalogs using parent method
        included_catalogs, skipped_catalogs, total_in_manifest = super().get_catalogs(catalog_addon_url)

        # If no filter is set, return all catalogs as before
        if self.catalog_filter is None:
            return included_catalogs, skipped_catalogs, total_in_manifest

        # Filter catalogs based on selection
        filtered_included = []
        filtered_out = []

        for catalog in included_catalogs:
            catalog_id = catalog.get('id', '')

            if catalog_id in self.catalog_filter:
                # This catalog is selected by user
                filtered_included.append(catalog)
            else:
                # This catalog is not selected, skip it
                filtered_out.append({
                    'catalog': catalog,
                    'reason': 'Not selected by user'
                })

        # Add filtered-out catalogs to skipped list
        skipped_catalogs.extend(filtered_out)

        return filtered_included, skipped_catalogs, total_in_manifest
