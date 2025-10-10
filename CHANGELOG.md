# Changelog

All notable changes to Streams Prefetcher will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.11.1] - 2025-10-10

### Added
- Prefetch Time progress bar showing elapsed time vs max execution time during jobs
- Real-time countdown with human-readable format (hours, minutes, seconds)
- Percentage progress indicator for time-based execution limits
- Automatic hiding when max execution time is unlimited

Closes #28

## [0.11.0] - 2025-10-10

### Added
- Live countdown timer showing time remaining until next scheduled prefetch
- Countdown updates every second with pulsating animation effect
- Countdown timer displays in scheduled state screen

### Fixed
- Schedule state preservation when dismissing completion/error screens
- UI now correctly shows scheduled screen (not idle) after dismissing results when schedules exist
- UI now updates immediately when schedules are added, edited, deleted, or toggled
- Schedule Edit and Delete buttons now clickable (pointer events work through gradient overlay)

### Changed
- Countdown timer styled with rounded rectangle box and subtle blue background
- Schedule saves now happen immediately (removed 2-second debounce delay)
- Increased post-save delay from 200ms to 600ms for more reliable backend processing

Closes #6

## [0.10.2] - 2025-10-08

### Fixed
- SQLite threading error on ARM64 that prevented prefetch jobs from running
- `sqlite3.ProgrammingError: SQLite objects created in a thread can only be used in that same thread`
- Added `check_same_thread=False` to SQLite connection (safe as only one job runs at a time)

Closes #25

## [0.10.1] - 2025-10-07

### Fixed
- Job status getting permanently stuck in CANCELLED state when termination thread hangs on blocking network operations
- "Failed to start prefetch job: Job is being cancelled" error preventing new jobs from starting
- Added 30-second timeout to auto-reset stuck CANCELLED jobs to IDLE state
- Improved cancellation cleanup to prevent indefinite job blocking

## [0.10.0] - 2025-10-07

### Added
- **Pause/Resume Functionality**: Full support for pausing and resuming prefetch sessions
  - New Pause button in running screen to pause job after current item completes
  - Smooth state transitions: Pause → Pausing... → Paused, Resume → Resuming... → Running
  - Visual pause indicator (yellow pause icon replaces download spinner)
  - "Prefetch Paused" status text while paused
  - Progress bars and current item info remain visible when paused
  - Individual episode pause support - pauses after current episode, not entire series
  - Next item shown in UI before pausing for clear resume context
  - New job states: PAUSING, PAUSED, RESUMING
  - Backend pause_event signaling for efficient thread coordination

### Fixed
- Progress bars showing "0 of 0" due to catalogMode variable scope issue
- Button icon sizes shrinking during state transitions (added explicit flex-shrink prevention)
- Empty progress_data on job start causing missing progress bar updates
- Series prefetching waiting for entire series instead of individual episodes when paused
- Time limit check order now matches between movies and episodes

### Changed
- Progress data initialized with config values immediately on job start
- Terminate button works during all pause/resume states
- Configuration changes disabled during pausing/paused/resuming states
- Added preserveActionText parameter to maintain "Prefetch Paused" text

Closes #15

## [0.9.5] - 2025-10-07

### Added
- RPDB poster display for currently prefetching movie/series/episode
- Dark themed spinner while poster loads
- Movie/episode name and year displayed below poster
- Mobile responsive poster sizing (~1/5th display height with 2:3 aspect ratio)

### Changed
- Backend now sends IMDb ID and item type in progress updates

Closes #20

## [0.9.4] - 2025-10-07

### Added
- Addon logo display next to addon names in rows
- Modern redesigned addon rows matching schedule row styling (gradient backgrounds, glowing borders)
- Plus icon to Add URL buttons with matching Edit button styling

### Fixed
- Drag and drop between addon sections (Both/Catalog/Stream) now preserves name and logo
- Empty space in Addons section after title removal

### Changed
- Addon name font size increased (18px desktop, 17px mobile)
- Edit and Delete buttons moved below addon name in vertical layout
- Removed "🔗 Addon URLs" subsection title
- Removed catalog selection help text
- Add URL buttons redesigned to match Edit button style

Closes #21, #22, #23

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
