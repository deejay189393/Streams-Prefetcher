"""
Job Checkpoint Manager
Handles persistence of job state across container restarts
"""

import json
import os
from typing import Dict, Any, Optional
from pathlib import Path
from logger import get_logger

logger = get_logger('job_checkpoint_manager')


class JobCheckpointManager:
    """Manages job checkpoint persistence for seamless container restarts"""

    CHECKPOINT_VERSION = 1

    def __init__(self, checkpoint_path: str = 'data/job_checkpoint/checkpoint.json'):
        self.checkpoint_path = Path(checkpoint_path)

    def save_checkpoint(self, checkpoint_data: Dict[str, Any]) -> bool:
        """
        Save job checkpoint to disk

        Args:
            checkpoint_data: Complete job state dictionary

        Returns:
            True if saved successfully, False otherwise
        """
        try:
            # Ensure directory exists
            self.checkpoint_path.parent.mkdir(parents=True, exist_ok=True)

            # Add version to checkpoint
            checkpoint_data['version'] = self.CHECKPOINT_VERSION

            # Write to disk with pretty formatting
            with open(self.checkpoint_path, 'w') as f:
                json.dump(checkpoint_data, f, indent=2)

            logger.debug(f"Checkpoint saved: status={checkpoint_data.get('job_status')}, "
                        f"catalog_index={checkpoint_data.get('execution_position', {}).get('catalog_index')}, "
                        f"page={checkpoint_data.get('execution_position', {}).get('page')}")

            return True
        except Exception as e:
            logger.error(f"Error saving checkpoint: {e}")
            return False

    def load_checkpoint(self) -> Optional[Dict[str, Any]]:
        """
        Load job checkpoint from disk

        Returns:
            Checkpoint dictionary if exists and valid, None otherwise
        """
        try:
            if not self.checkpoint_path.exists():
                logger.debug("No checkpoint file found")
                return None

            with open(self.checkpoint_path, 'r') as f:
                checkpoint = json.load(f)

            # Validate version
            if checkpoint.get('version') != self.CHECKPOINT_VERSION:
                logger.warning(f"Checkpoint version mismatch: expected {self.CHECKPOINT_VERSION}, "
                             f"got {checkpoint.get('version')}. Ignoring checkpoint.")
                return None

            logger.info(f"Checkpoint loaded: status={checkpoint.get('job_status')}, "
                       f"catalog_index={checkpoint.get('execution_position', {}).get('catalog_index')}, "
                       f"page={checkpoint.get('execution_position', {}).get('page')}")

            return checkpoint

        except json.JSONDecodeError as e:
            logger.error(f"Checkpoint file corrupted: {e}. Starting fresh.")
            return None
        except Exception as e:
            logger.error(f"Error loading checkpoint: {e}")
            return None

    def clear_checkpoint(self) -> bool:
        """
        Clear checkpoint file (called when job completes/fails)

        Returns:
            True if cleared successfully, False otherwise
        """
        try:
            if self.checkpoint_path.exists():
                self.checkpoint_path.unlink()
                logger.info("Checkpoint cleared")
            return True
        except Exception as e:
            logger.error(f"Error clearing checkpoint: {e}")
            return False

    def checkpoint_exists(self) -> bool:
        """Check if checkpoint file exists"""
        return self.checkpoint_path.exists()
