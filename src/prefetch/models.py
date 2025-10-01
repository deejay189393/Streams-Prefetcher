"""
Domain Models
Core business entities with validation and immutability where appropriate.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum
from datetime import datetime


class CatalogType(Enum):
    """Supported catalog types"""
    MOVIE = "movie"
    SERIES = "series"
    MIXED = "mixed"  # Previously "all"

    @classmethod
    def from_string(cls, type_str: str) -> 'CatalogType':
        """Convert string to CatalogType, handling legacy 'all' type"""
        type_map = {
            'movie': cls.MOVIE,
            'series': cls.SERIES,
            'mixed': cls.MIXED,
            'all': cls.MIXED  # Legacy support
        }
        return type_map.get(type_str.lower(), cls.MIXED)


@dataclass(frozen=True)
class Catalog:
    """
    Immutable catalog definition.

    Attributes:
        id: Unique identifier (format: "addon_url|catalog_id")
        name: Human-readable catalog name
        type: Catalog type (movie/series/mixed)
        addon_url: URL of the addon this catalog belongs to
        addon_name: Human-readable addon name
        catalog_id: Internal catalog ID from the manifest
    """
    id: str
    name: str
    type: CatalogType
    addon_url: str
    addon_name: str
    catalog_id: str

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Catalog':
        """Create Catalog from dictionary (e.g., from config)"""
        return cls(
            id=data['id'],
            name=data['name'],
            type=CatalogType.from_string(data['type']),
            addon_url=data['addon_url'],
            addon_name=data['addon_name'],
            catalog_id=data['id'].split('|', 1)[1] if '|' in data['id'] else data['id']
        )


@dataclass
class StreamItem:
    """
    Represents a streamable item (movie or series episode).

    Attributes:
        imdb_id: IMDb identifier
        title: Display title
        content_type: 'movie' or 'series'
        catalog_name: Source catalog name
        season: Season number (for series only)
        episode: Episode number (for series only)
    """
    imdb_id: str
    title: str
    content_type: str
    catalog_name: str
    season: Optional[int] = None
    episode: Optional[int] = None

    @property
    def stream_id(self) -> str:
        """Generate stream ID for API calls"""
        if self.content_type == 'series' and self.season and self.episode:
            return f"{self.imdb_id}:{self.season}:{self.episode}"
        return self.imdb_id


@dataclass
class PrefetchResult:
    """Result of a single prefetch attempt"""
    item: StreamItem
    success: bool
    from_cache: bool
    error: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class CatalogProcessingResult:
    """Result of processing a single catalog"""
    catalog: Catalog
    items_found: int
    items_prefetched: int
    items_from_cache: int
    errors: int
    success: bool
    error_message: Optional[str] = None


@dataclass
class PrefetchJobConfig:
    """
    Configuration for a prefetch job.

    Validates limits and ensures consistency.
    """
    addon_urls: List[tuple]  # List of (url, type) tuples
    selected_catalogs: List[Catalog]
    movies_global_limit: int = -1  # -1 means unlimited
    series_global_limit: int = -1
    movies_per_catalog: int = 50
    series_per_catalog: int = 3
    items_per_mixed_catalog: int = 20
    delay_seconds: float = 2.0
    proxy_url: Optional[str] = None
    randomize_catalogs: bool = False
    randomize_items: bool = False
    cache_validity_seconds: int = 259200  # 3 days
    max_execution_time_seconds: int = 5400  # 90 minutes

    def __post_init__(self):
        """Validate configuration"""
        if not self.addon_urls:
            raise ValueError("At least one addon URL is required")
        if not self.selected_catalogs:
            raise ValueError("At least one catalog must be selected")
        if self.delay_seconds < 0:
            raise ValueError("Delay cannot be negative")
        if self.cache_validity_seconds < 0:
            raise ValueError("Cache validity cannot be negative")


@dataclass
class PrefetchProgress:
    """
    Real-time progress information for UI updates.

    Thread-safe when used with proper locking.
    """
    # Overall progress
    total_catalogs: int = 0
    completed_catalogs: int = 0
    current_catalog: Optional[str] = None
    current_catalog_index: int = 0

    # Item counts
    movies_prefetched: int = 0
    series_prefetched: int = 0
    items_from_cache: int = 0

    # Current catalog progress
    current_catalog_items_total: int = 0
    current_catalog_items_processed: int = 0
    current_catalog_mode: str = "unknown"

    # Limits
    movies_global_limit: int = -1
    series_global_limit: int = -1
    per_catalog_limit: int = -1

    # Rates and timing
    start_time: Optional[float] = None
    elapsed_seconds: float = 0.0
    estimated_remaining_seconds: Optional[float] = None

    # Errors
    total_errors: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'total_catalogs': self.total_catalogs,
            'completed_catalogs': self.completed_catalogs,
            'current_catalog': self.current_catalog,
            'current_catalog_index': self.current_catalog_index,
            'movies_prefetched': self.movies_prefetched,
            'series_prefetched': self.series_prefetched,
            'items_from_cache': self.items_from_cache,
            'current_catalog_items_total': self.current_catalog_items_total,
            'current_catalog_items_processed': self.current_catalog_items_processed,
            'current_catalog_mode': self.current_catalog_mode,
            'movies_global_limit': self.movies_global_limit,
            'series_global_limit': self.series_global_limit,
            'per_catalog_limit': self.per_catalog_limit,
            'elapsed_seconds': self.elapsed_seconds,
            'estimated_remaining_seconds': self.estimated_remaining_seconds,
            'total_errors': self.total_errors
        }
