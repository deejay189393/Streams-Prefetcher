# Changelog

All notable changes to Streams Prefetcher will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.1] - 2025-10-06

### Added
- **Reset Catalog Selections Button**: New reset button in the Catalog Selection section
  - Long-press for 3 seconds to reset all catalog selections
  - Shows visual progress (0-100%) during long-press
  - Provides haptic feedback (vibration) on supported devices
  - Automatically reloads catalogs after reset
  - Clears all saved catalog selections from configuration
  - Small button positioned next to "Load Catalogs" button
- **API Endpoint**: `POST /api/catalogs/reset` to reset catalog selections programmatically

### Changed
- Catalog selections now auto-save after 2 seconds (no manual save button needed)
- Updated README documentation with reset catalogs feature details

## [0.8.0] - 2025-10-05

### Added
- Initial release of Streams Prefetcher (formerly Stremio Streams Prefetcher)
- Modern web-based interface with real-time monitoring
- Flexible job scheduling with multiple day/time selectors
- Catalog management with drag-and-drop
- Completion statistics with graphs, timelines, and processing rates
- Smart addon URL management with automatic manifest fetching
- Log viewer with search, view, and delete capabilities
- Mobile debug panel for troubleshooting
- Comprehensive documentation and screenshots

### Changed
- Rebranded from "Stremio Streams Prefetcher" to "Streams Prefetcher"
- Updated all references to remove "Web UI" terminology
- Fixed architecture diagram for better GitHub rendering
- Corrected cache validity default documentation (7 days)

### Fixed
- Improved ASCII diagram rendering across all platforms
- Updated git remote URL to match new repository name
