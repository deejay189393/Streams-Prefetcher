"""
Centralized logging configuration for Streams Prefetcher
Inspired by stremthru's logging approach
"""

import logging
import sys
import os
from datetime import datetime


class ColoredFormatter(logging.Formatter):
    """Colored formatter for console output"""

    COLORS = {
        'DEBUG': '\033[36m',     # Cyan
        'INFO': '\033[32m',      # Green
        'WARNING': '\033[33m',   # Yellow
        'ERROR': '\033[31m',     # Red
        'CRITICAL': '\033[35m',  # Magenta
        'RESET': '\033[0m'
    }

    def format(self, record):
        # Add color to level name
        if record.levelname in self.COLORS:
            record.levelname = f"{self.COLORS[record.levelname]}{record.levelname:8}{self.COLORS['RESET']}"
        return super().format(record)


def setup_logging():
    """Configure logging for the application"""

    # Get log level from environment (default to INFO)
    log_level_name = os.getenv('LOG_LEVEL', 'INFO').upper()
    log_level = getattr(logging, log_level_name, logging.INFO)

    # Create logger
    logger = logging.getLogger('streams_prefetcher')
    logger.setLevel(log_level)
    logger.handlers = []  # Clear any existing handlers

    # Console handler with colored output
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)

    # Format: [TIMESTAMP] [LEVEL] [MODULE] Message
    console_format = ColoredFormatter(
        fmt='[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_handler.setFormatter(console_format)
    logger.addHandler(console_handler)

    return logger


def get_logger(name: str = 'streams_prefetcher'):
    """Get a logger instance"""
    return logging.getLogger(name)


# Initialize default logger
default_logger = setup_logging()
