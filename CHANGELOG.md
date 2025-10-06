# Changelog

All notable changes to Streams Prefetcher will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.3] - 2025-10-06

### Added
- **Smart Timezone Mismatch Detection**: Elegant banner shown in Scheduling section when browser timezone differs from server timezone
  - Only displays when timezones don't match (no clutter when they match)
  - Beautiful purple/blue gradient design with smooth animations
  - Clearly shows both browser and server timezones
  - Helps users understand schedules run in server time, not browser time
  - New `/api/timezone` endpoint to fetch server's TZ environment variable
  - Automatic detection using browser's `Intl.DateTimeFormat` API

### Changed
- Enhanced Scheduling section UX with conditional timezone awareness

Closes #16

## [0.9.2] - 2025-10-06

### Added
- **Smart Addon URL Normalization**: Automatically strips common Stremio addon endpoints
  - Removes `/manifest.json` from URLs
  - Removes `/configure` from URLs
  - Removes resource endpoints like `/catalog/*`, `/meta/*`, `/stream/*`, `/subtitles/*`, `/addon_catalog/*`
  - Users can now paste URLs copied from Stremio app or Stremio Web directly
  - All variations automatically normalize to the base addon URL

### Changed
- Updated README with supported URL formats and examples
- Documented all accepted URL patterns (base URL, with manifest.json, with configure, with resource endpoints)

Closes #8

## [0.9.1] - 2025-10-06

### Added
- **Collapsible Timezone Warning**: Added informative timezone configuration notice in Scheduling section
  - Explains TZ environment variable usage
  - Defaults to UTC if not set
  - Provides configuration guidance and examples
  - Collapsed by default to reduce clutter
  - Smooth expand/collapse animation with arrow on left
- **Collapsible Watchtower Warning**: Added compatibility warning for Watchtower users
  - Alerts about container restarts interrupting prefetch sessions
  - Provides three actionable solutions
  - Professional orange warning design
  - Positioned at bottom of Scheduling section
- **Duplicate Addon URL Prevention**: System now prevents adding the same addon URL more than once
  - Case-insensitive URL comparison across all sections (Both, Catalog, Stream)
  - Removes duplicate item immediately
  - Shows red error notification with section location
  - Suggests using "Both" section if dual functionality is desired
- **Error Notification System**: New red-themed notification for errors
  - Auto-dismisses after 5 seconds (with progress bar animation)
  - Manual dismiss button
  - Professional design matching save notification style
  - Clear warning icon and informative messages

### Fixed
- Users can no longer accidentally add duplicate addon URLs

Closes #5, #9, #11

## [0.9.0] - 2025-10-06

### Fixed
- **Critical Timezone Bug**: Scheduler now correctly uses the `TZ` environment variable for scheduling jobs
  - Previously hardcoded to UTC, causing all scheduled jobs to run at incorrect times
  - Now reads `TZ` from environment and falls back to UTC if not set
  - Logs the timezone being used at startup for verification
  - `.env.example` properly configured to read from existing `TZ` environment variable (Closes #3, #7)

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
