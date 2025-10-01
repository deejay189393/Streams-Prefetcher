"""
Catalog Filter Module
Filters catalogs based on user selection from saved_catalogs config.
"""

from typing import List, Dict, Any, Optional


class CatalogFilter:
    """
    Filters catalogs to only process those selected by the user.

    This is a critical component that ensures only user-selected catalogs
    are processed during prefetch operations.
    """

    def __init__(self, saved_catalogs: List[Dict[str, Any]]):
        """
        Initialize filter with saved catalog configuration.

        Args:
            saved_catalogs: List of catalog dicts from config with 'enabled' flags
        """
        self.saved_catalogs = saved_catalogs

        # Build lookup for enabled catalogs by catalog_id
        self.enabled_catalog_ids = set()
        for cat in saved_catalogs:
            if cat.get('enabled', False):
                # Extract catalog_id from full id (format: "addon_url|catalog_id")
                full_id = cat.get('id', '')
                if '|' in full_id:
                    catalog_id = full_id.split('|', 1)[1]
                    self.enabled_catalog_ids.add(catalog_id)

    def is_catalog_enabled(self, catalog_id: str) -> bool:
        """
        Check if a catalog is enabled based on user selection.

        Args:
            catalog_id: The catalog ID from the manifest

        Returns:
            True if catalog should be processed, False otherwise
        """
        return catalog_id in self.enabled_catalog_ids

    def filter_catalogs(self, catalogs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Filter a list of catalogs to only include enabled ones.

        Args:
            catalogs: List of catalog dicts from addon manifest

        Returns:
            Filtered list containing only enabled catalogs
        """
        filtered = []
        for catalog in catalogs:
            catalog_id = catalog.get('id', '')
            if self.is_catalog_enabled(catalog_id):
                filtered.append(catalog)
        return filtered

    def get_enabled_catalog_count(self) -> int:
        """Get total number of enabled catalogs"""
        return len(self.enabled_catalog_ids)

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> 'CatalogFilter':
        """
        Create CatalogFilter from configuration dict.

        Args:
            config: Full configuration dictionary

        Returns:
            Configured CatalogFilter instance
        """
        saved_catalogs = config.get('saved_catalogs', [])
        return cls(saved_catalogs)
