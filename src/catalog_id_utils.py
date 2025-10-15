"""
Catalog ID Utilities
Centralized management for catalog ID format and parsing.

This module provides a single source of truth for creating and parsing catalog IDs,
preventing bugs from format changes and ensuring consistency across the codebase.

FORMAT SPECIFICATION:
    "addon_url|catalog_id|catalog_type"

    Where:
        - addon_url: Full URL to the addon (e.g., "http://aiostreams:3000/stremio/...")
        - catalog_id: Unique identifier for the catalog (e.g., "f29e3b0.aiolists-111168-L")
        - catalog_type: Type of catalog (e.g., "movie", "series", "mixed")
        - Separator: Single pipe character (|)

EXAMPLES:
    Input:
        addon_url = "http://aiostreams:3000/stremio/abc123"
        catalog_id = "movies-top"
        catalog_type = "movie"

    Output:
        "http://aiostreams:3000/stremio/abc123|movies-top|movie"

USAGE:
    from catalog_id_utils import create_catalog_id, get_catalog_id_part

    # Creating a catalog ID
    full_id = create_catalog_id(addon_url, catalog_id, catalog_type)

    # Extracting parts
    catalog_id = get_catalog_id_part(full_id)
    addon_url = get_addon_url_part(full_id)
    catalog_type = get_catalog_type_part(full_id)

    # Parsing all parts at once
    parts = parse_catalog_id(full_id)
    print(parts['catalog_id'])
"""

from typing import Dict, Optional


SEPARATOR = '|'
EXPECTED_PARTS = 3


def create_catalog_id(addon_url: str, catalog_id: str, catalog_type: str) -> str:
    """
    Create a full catalog ID from its component parts.

    Args:
        addon_url: Full URL to the addon
        catalog_id: Unique identifier for the catalog
        catalog_type: Type of catalog (movie, series, mixed)

    Returns:
        Full catalog ID in format "addon_url|catalog_id|catalog_type"

    Example:
        >>> create_catalog_id("http://example.com", "movies-top", "movie")
        "http://example.com|movies-top|movie"
    """
    return f"{addon_url}{SEPARATOR}{catalog_id}{SEPARATOR}{catalog_type}"


def parse_catalog_id(full_id: str) -> Dict[str, Optional[str]]:
    """
    Parse a full catalog ID into its component parts.

    Args:
        full_id: Full catalog ID in format "addon_url|catalog_id|catalog_type"

    Returns:
        Dictionary with keys: 'addon_url', 'catalog_id', 'catalog_type'
        Returns None values if parsing fails

    Example:
        >>> parse_catalog_id("http://example.com|movies-top|movie")
        {'addon_url': 'http://example.com', 'catalog_id': 'movies-top', 'catalog_type': 'movie'}
    """
    parts = full_id.split(SEPARATOR)

    if len(parts) != EXPECTED_PARTS:
        return {
            'addon_url': None,
            'catalog_id': None,
            'catalog_type': None
        }

    return {
        'addon_url': parts[0],
        'catalog_id': parts[1],
        'catalog_type': parts[2]
    }


def get_catalog_id_part(full_id: str) -> str:
    """
    Extract just the catalog_id from a full catalog ID.

    Args:
        full_id: Full catalog ID in format "addon_url|catalog_id|catalog_type"

    Returns:
        The catalog_id portion (middle part)
        Returns empty string if parsing fails

    Example:
        >>> get_catalog_id_part("http://example.com|movies-top|movie")
        "movies-top"
    """
    parts = full_id.split(SEPARATOR)
    if len(parts) != EXPECTED_PARTS:
        return ''
    return parts[1]


def get_addon_url_part(full_id: str) -> str:
    """
    Extract just the addon_url from a full catalog ID.

    Args:
        full_id: Full catalog ID in format "addon_url|catalog_id|catalog_type"

    Returns:
        The addon_url portion (first part)
        Returns empty string if parsing fails

    Example:
        >>> get_addon_url_part("http://example.com|movies-top|movie")
        "http://example.com"
    """
    parts = full_id.split(SEPARATOR)
    if len(parts) != EXPECTED_PARTS:
        return ''
    return parts[0]


def get_catalog_type_part(full_id: str) -> str:
    """
    Extract just the catalog_type from a full catalog ID.

    Args:
        full_id: Full catalog ID in format "addon_url|catalog_id|catalog_type"

    Returns:
        The catalog_type portion (last part)
        Returns empty string if parsing fails

    Example:
        >>> get_catalog_type_part("http://example.com|movies-top|movie")
        "movie"
    """
    parts = full_id.split(SEPARATOR)
    if len(parts) != EXPECTED_PARTS:
        return ''
    return parts[2]
