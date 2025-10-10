"""
Configuration Manager
Handles persistence of user configuration to disk
"""

import json
import os
from typing import Dict, Any, List, Tuple
from pathlib import Path

class ConfigManager:
    """Manages configuration persistence"""

    DEFAULT_CONFIG = {
        'addon_urls': [],  # List of {'url': 'https://...', 'type': 'catalog'|'stream'|'both'}
        'movies_global_limit': -1,
        'series_global_limit': -1,
        'movies_per_catalog': 50,
        'series_per_catalog': 3,
        'items_per_mixed_catalog': 20,
        'delay': 2,  # In seconds
        'proxy': '',
        'randomize_catalog_processing': False,
        'randomize_item_prefetching': False,
        'cache_validity': 604800,  # 1 week in seconds
        'max_execution_time': 5400,  # 90 minutes in seconds
        'enable_logging': False,
        'catalog_selection': {},  # {catalog_id: {enabled: bool, order: int}}
        'schedule': {
            'enabled': False,
            'cron_expression': '0 2,5,8 * * *',  # Daily at 2 AM, 5 AM, 8 AM
            'timezone': 'UTC'
        },
        'cache_uncached_streams': {
            'enabled': False,
            'cached_stream_regex': '⚡',
            'max_cache_requests_per_item': 1,
            'max_cache_requests_global': 50,
            'max_required_cached_streams': 0
        }
    }

    def __init__(self, config_path: str = 'data/config/config.json'):
        self.config_path = Path(config_path)
        self.config = self.load()

    def load(self) -> Dict[str, Any]:
        """Load configuration from disk or return default"""
        try:
            if self.config_path.exists():
                with open(self.config_path, 'r') as f:
                    loaded_config = json.load(f)
                # Merge with defaults to ensure all keys exist
                config = self.DEFAULT_CONFIG.copy()
                config.update(loaded_config)
                return config
            else:
                return self.DEFAULT_CONFIG.copy()
        except Exception as e:
            print(f"Error loading config: {e}")
            return self.DEFAULT_CONFIG.copy()

    def save(self, config: Dict[str, Any] = None) -> bool:
        """Save configuration to disk"""
        try:
            # Ensure directory exists
            self.config_path.parent.mkdir(parents=True, exist_ok=True)

            # Use provided config or instance config
            config_to_save = config if config is not None else self.config

            # Write to disk with pretty formatting
            with open(self.config_path, 'w') as f:
                json.dump(config_to_save, f, indent=2)

            # Update instance config
            if config is not None:
                self.config = config

            return True
        except Exception as e:
            print(f"Error saving config: {e}")
            return False

    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value"""
        return self.config.get(key, default)

    def set(self, key: str, value: Any) -> bool:
        """Set a configuration value and save"""
        self.config[key] = value
        return self.save()

    def update(self, updates: Dict[str, Any]) -> bool:
        """Update multiple configuration values and save"""
        self.config.update(updates)
        return self.save()

    def get_all(self) -> Dict[str, Any]:
        """Get all configuration"""
        return self.config.copy()

    def reset(self) -> bool:
        """Reset configuration to defaults"""
        self.config = self.DEFAULT_CONFIG.copy()
        return self.save()

    def to_cli_args(self) -> List[str]:
        """Convert configuration to CLI arguments for streams_prefetcher.py"""
        args = []

        # Addon URLs (required)
        if self.config['addon_urls']:
            url_strings = [f"{item['type']}:{item['url']}" for item in self.config['addon_urls']]
            args.extend(['--addon-urls', ','.join(url_strings)])

        # Integer limits
        args.extend(['--movies-global-limit', str(self.config['movies_global_limit'])])
        args.extend(['--series-global-limit', str(self.config['series_global_limit'])])
        args.extend(['--movies-per-catalog', str(self.config['movies_per_catalog'])])
        args.extend(['--series-per-catalog', str(self.config['series_per_catalog'])])
        args.extend(['--items-per-mixed-catalog', str(self.config['items_per_mixed_catalog'])])

        # Time-based parameters (convert seconds to string format)
        if self.config['delay'] > 0:
            args.extend(['--delay', f"{self.config['delay']}s"])

        args.extend(['--cache-validity', f"{self.config['cache_validity']}s"])
        args.extend(['--max-execution-time', f"{self.config['max_execution_time']}s"])

        # Proxy (optional)
        if self.config.get('proxy'):
            args.extend(['--proxy', self.config['proxy']])

        # Flags
        if self.config['randomize_catalog_processing']:
            args.append('--randomize-catalog-processing')

        if self.config['randomize_item_prefetching']:
            args.append('--randomize-item-prefetching')

        if self.config['enable_logging']:
            args.append('--enable-logging')

        return args
