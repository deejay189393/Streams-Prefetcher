/**
 * Streams Prefetcher - Frontend Application
 * Handles all UI interactions, real-time updates, and API communication
 */

// ============================================================================
// Global State
// ============================================================================

let currentConfig = {};
let loadedCatalogs = [];
let eventSource = null;
let catalogsLoaded = false;
let countdownInterval = null;
let nextRunTimestamp = null;
let configSaved = false;
let configModified = false;
let catalogSaveTimeout = null;
let scheduleSaveTimeout = null;
let configSaveTimeout = null;
let currentSchedules = [];
let editingScheduleIndex = null;
let isPageLoading = true; // Prevent notifications during initial load
let completionScreenLocked = false; // Prevent accidental hiding of completion screen
let currentCompletionId = null; // Track current completion to handle dismissal
let jobTerminationRequested = false; // Track if user requested termination

// ============================================================================
// Debug Logging (Mobile-Friendly)
// ============================================================================

let debugLogs = [];
let debugStartTime = Date.now();

function addDebugLog(message) {
    const elapsed = ((Date.now() - debugStartTime) / 1000).toFixed(3);
    const timestamp = new Date().toISOString().split('T')[1].substring(0, 12);
    const logLine = `[${timestamp}] [+${elapsed}s] ${message}`;
    debugLogs.push(logLine);

    // Keep only last 100 logs
    if (debugLogs.length > 100) {
        debugLogs = debugLogs.slice(-100);
    }

    // Update debug panel
    const debugContent = document.getElementById('debug-content');
    if (debugContent) {
        debugContent.textContent = debugLogs.join('\n');
        // Auto-scroll to bottom
        const debugPanel = document.getElementById('debug-panel');
        if (debugPanel) {
            debugPanel.scrollTop = debugPanel.scrollHeight;
        }
    }

    // Also log to console
    console.log(logLine);
}

function logStatusScreens() {
    const screens = ['idle', 'scheduled', 'running', 'completed', 'failed'];
    const states = screens.map(screen => {
        const el = document.getElementById(`status-${screen}`);
        const display = el ? el.style.display : 'MISSING';
        return `${screen}=${display}`;
    }).join(', ');
    addDebugLog(`Screen states: ${states}`);
}

function copyDebugLog(event) {
    const debugContent = document.getElementById('debug-content');
    if (debugContent) {
        const text = debugContent.textContent;
        const btn = event ? event.target : null;

        const showSuccess = () => {
            if (btn) {
                const originalText = btn.textContent;
                btn.textContent = 'COPIED!';
                btn.style.background = '#00ff00';
                btn.style.color = '#000';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = '#ff3366';
                    btn.style.color = '#fff';
                }, 2000);
            }
        };

        // Try modern Clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showSuccess();
            }).catch(err => {
                console.error('Failed to copy:', err);
                // Try fallback
                fallbackCopy(text, showSuccess);
            });
        } else {
            // Fallback for older browsers
            fallbackCopy(text, showSuccess);
        }
    }
}

function fallbackCopy(text, successCallback) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '2em';
    textarea.style.height = '2em';
    textarea.style.padding = '0';
    textarea.style.border = 'none';
    textarea.style.outline = 'none';
    textarea.style.boxShadow = 'none';
    textarea.style.background = 'transparent';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful) {
            successCallback();
        } else {
            alert('Copy failed. Please long-press the debug text and copy manually.');
        }
    } catch (err) {
        console.error('Fallback copy failed:', err);
        alert('Copy not supported. Please long-press the debug text and copy manually.');
    }

    document.body.removeChild(textarea);
}

function toggleDebugPanel() {
    const panel = document.getElementById('debug-panel');
    if (panel) {
        const isVisible = panel.style.display !== 'none';
        panel.style.display = isVisible ? 'none' : 'block';

        // Save state to localStorage
        localStorage.setItem('debug-panel-visible', isVisible ? 'false' : 'true');

        // Log the toggle
        if (!isVisible) {
            addDebugLog('=== DEBUG PANEL ENABLED (Long-press ⚡ to toggle) ===');
        }
    }
}

function initializeDebugPanel() {
    const panel = document.getElementById('debug-panel');
    if (panel) {
        // Check localStorage for saved state (default: hidden)
        const savedState = localStorage.getItem('debug-panel-visible');
        if (savedState === 'true') {
            panel.style.display = 'block';
            addDebugLog('=== DEBUG PANEL ENABLED (Long-press ⚡ to toggle) ===');
        } else {
            panel.style.display = 'none';
        }
    }
}

// Long-press functionality for mobile
let longPressTimer = null;
let longPressTriggered = false;

function setupLongPressToggle() {
    const pageTitle = document.getElementById('page-title');
    if (!pageTitle) return;

    const LONG_PRESS_DURATION = 800; // 800ms = 0.8 seconds

    // Touch events for mobile
    pageTitle.addEventListener('touchstart', (e) => {
        longPressTriggered = false;
        longPressTimer = setTimeout(() => {
            longPressTriggered = true;
            toggleDebugPanel();
            // Vibrate if supported (nice tactile feedback)
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
        }, LONG_PRESS_DURATION);
    });

    pageTitle.addEventListener('touchend', (e) => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        // Prevent click if long-press was triggered
        if (longPressTriggered) {
            e.preventDefault();
        }
    });

    pageTitle.addEventListener('touchcancel', (e) => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });

    // Mouse events for desktop (still useful for testing)
    pageTitle.addEventListener('mousedown', (e) => {
        longPressTriggered = false;
        longPressTimer = setTimeout(() => {
            longPressTriggered = true;
            toggleDebugPanel();
        }, LONG_PRESS_DURATION);
    });

    pageTitle.addEventListener('mouseup', (e) => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });

    pageTitle.addEventListener('mouseleave', (e) => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });
}

// ============================================================================
// Date/Time Formatting Helpers
// ============================================================================

function getOrdinalSuffix(day) {
    if (day > 3 && day < 21) return 'th'; // 11th-20th
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

function formatCustomTime(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp * 1000);
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    return `${hours}:${minutes}:${seconds} ${ampm}`;
}

function formatCustomDate(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp * 1000);
    const day = date.getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    const ordinal = getOrdinalSuffix(day);
    return `${day}${ordinal} ${month} ${year}`;
}

function formatCustomDateTime(timestamp) {
    if (!timestamp) return '-';
    return `${formatCustomTime(timestamp)}, ${formatCustomDate(timestamp)}`;
}

function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '-';

    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);

    return parts.join(' ');
}

// ============================================================================
// Collapsible Section Helpers
// ============================================================================

function toggleSection(sectionId) {
    const content = document.getElementById(`${sectionId}-content`);
    const icon = document.getElementById(`${sectionId}-icon`);

    if (content && icon) {
        content.classList.toggle('collapsed');
        icon.classList.toggle('collapsed');

        // Save state to localStorage
        const isCollapsed = content.classList.contains('collapsed');
        localStorage.setItem(`${sectionId}-collapsed`, isCollapsed);
    }
}

function toggleWarningBox(warningId) {
    const content = document.getElementById(warningId);
    const icon = document.getElementById(`${warningId}-icon`);

    if (content && icon) {
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        icon.classList.toggle('expanded');
    }
}

// ============================================================================
// Scheduling Functions
// ============================================================================

function toggleScheduling() {
    const checkbox = document.getElementById('scheduling-enabled');
    const content = document.getElementById('scheduling-settings');
    const addBtn = document.getElementById('add-schedule-btn');

    if (checkbox.checked) {
        // Enable scheduling
        content.classList.remove('scheduling-disabled');
        addBtn.disabled = false;
    } else {
        // Disable scheduling
        content.classList.add('scheduling-disabled');
        addBtn.disabled = true;
    }

    // Auto-save scheduling state
    autoSaveSchedules();
}

function showAddScheduleModal() {
    editingScheduleIndex = null;
    document.getElementById('modal-title').textContent = 'Add Schedule';
    document.getElementById('schedule-time').value = '';

    // Uncheck all days
    document.querySelectorAll('input[name="day"]').forEach(cb => cb.checked = false);

    document.getElementById('schedule-modal').style.display = 'flex';
}

function closeScheduleModal() {
    document.getElementById('schedule-modal').style.display = 'none';
    editingScheduleIndex = null;
}

function selectAllDays() {
    document.querySelectorAll('input[name="day"]').forEach(cb => cb.checked = true);
}

function deselectAllDays() {
    document.querySelectorAll('input[name="day"]').forEach(cb => cb.checked = false);
}

function saveScheduleFromModal() {
    const time = document.getElementById('schedule-time').value;
    const selectedDays = Array.from(document.querySelectorAll('input[name="day"]:checked'))
        .map(cb => parseInt(cb.value));

    if (!time) {
        showNotification('Please select a time', 'error');
        return;
    }

    if (selectedDays.length === 0) {
        showNotification('Please select at least one day', 'error');
        return;
    }

    const schedule = {
        time: time,
        days: selectedDays.sort((a, b) => a - b)
    };

    if (editingScheduleIndex !== null) {
        // Update existing schedule
        currentSchedules[editingScheduleIndex] = schedule;
    } else {
        // Add new schedule
        currentSchedules.push(schedule);
    }

    closeScheduleModal();
    renderSchedulesList();
    autoSaveSchedules();
}

function editSchedule(index) {
    editingScheduleIndex = index;
    const schedule = currentSchedules[index];

    document.getElementById('modal-title').textContent = 'Edit Schedule';
    document.getElementById('schedule-time').value = schedule.time;

    // Set day checkboxes
    document.querySelectorAll('input[name="day"]').forEach(cb => {
        cb.checked = schedule.days.includes(parseInt(cb.value));
    });

    document.getElementById('schedule-modal').style.display = 'flex';
}

function deleteSchedule(index) {
    if (confirm('Are you sure you want to delete this schedule?')) {
        currentSchedules.splice(index, 1);
        renderSchedulesList();
        autoSaveSchedules();
    }
}

function confirmDeleteAllSchedules() {
    if (currentSchedules.length === 0) return;

    if (confirm(`Are you sure you want to delete all ${currentSchedules.length} schedule(s)? This cannot be undone.`)) {
        currentSchedules = [];
        renderSchedulesList();
        autoSaveSchedules();
        showNotification('All schedules deleted', 'success');
    }
}

function renderSchedulesList() {
    const container = document.getElementById('schedules-list');
    const deleteAllBtn = document.getElementById('delete-all-btn');

    if (currentSchedules.length === 0) {
        container.innerHTML = `
            <div class="empty-schedules">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                <p>No schedules configured</p>
            </div>
        `;
        deleteAllBtn.style.display = 'none';
        return;
    }

    deleteAllBtn.style.display = 'block';

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    container.innerHTML = currentSchedules.map((schedule, index) => {
        const daysText = schedule.days.length === 7
            ? 'Every day'
            : schedule.days.map(d => dayNames[d]).join(', ');

        return `
            <div class="schedule-item">
                <div class="schedule-info">
                    <div class="schedule-time">${formatTime(schedule.time)}</div>
                    <div class="schedule-days">${daysText}</div>
                </div>
                <div class="schedule-actions">
                    <button class="btn-icon edit" onclick="editSchedule(${index})" title="Edit">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                        Edit
                    </button>
                    <button class="btn-icon delete" onclick="deleteSchedule(${index})" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        Delete
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function formatTime(time24) {
    const [hours, minutes] = time24.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
}

function autoSaveSchedules() {
    // Clear any existing timeout
    if (scheduleSaveTimeout) {
        clearTimeout(scheduleSaveTimeout);
    }

    // Set new timeout for 2 seconds
    scheduleSaveTimeout = setTimeout(() => {
        saveSchedulesSilent();
    }, 2000);
}

async function saveSchedulesSilent() {
    try {
        const enabled = document.getElementById('scheduling-enabled').checked;

        const response = await fetch('/api/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enabled: enabled,
                schedules: currentSchedules
            })
        });

        const data = await response.json();

        if (data.success) {
            // Silent save - no notification
            showSaveNotification();

            // Mark schedule as configured for smart collapse behavior
            localStorage.setItem('schedule-configured', 'true');
        } else {
            console.error('Failed to auto-save schedules:', data.error);
        }
    } catch (error) {
        console.error('Error auto-saving schedules:', error);
    }
}

async function loadSchedules() {
    try {
        const response = await fetch('/api/schedule');
        const data = await response.json();

        if (data.success && data.schedule) {
            const scheduleData = data.schedule;

            // Set enabled state
            const checkbox = document.getElementById('scheduling-enabled');
            checkbox.checked = scheduleData.enabled || false;
            toggleScheduling();

            // Load schedules
            currentSchedules = scheduleData.schedules || [];
            renderSchedulesList();
        }
    } catch (error) {
        console.error('Error loading schedules:', error);
    }
}

// ============================================================================
// Unlimited Checkbox Helpers
// ============================================================================

function toggleUnlimited(fieldId) {
    const input = document.getElementById(fieldId);
    const checkbox = document.getElementById(`${fieldId}-unlimited`);

    if (checkbox.checked) {
        // Unlimited is checked - disable input
        input.disabled = true;
        input.style.opacity = '0.5';
    } else {
        // Unlimited is unchecked - enable input
        input.disabled = false;
        input.style.opacity = '1';
    }
}

function toggleUnlimitedTime(fieldId) {
    const valueInput = document.getElementById(`${fieldId}-value`);
    const unitSelect = document.getElementById(`${fieldId}-unit`);
    const checkbox = document.getElementById(`${fieldId}-unlimited`);

    if (checkbox.checked) {
        // Unlimited is checked - disable inputs
        valueInput.disabled = true;
        unitSelect.disabled = true;
        valueInput.style.opacity = '0.5';
        unitSelect.style.opacity = '0.5';
    } else {
        // Unlimited is unchecked - enable inputs
        valueInput.disabled = false;
        unitSelect.disabled = false;
        valueInput.style.opacity = '1';
        unitSelect.style.opacity = '1';
    }
}

function toggleNoDelay() {
    const valueInput = document.getElementById('delay-value');
    const unitSelect = document.getElementById('delay-unit');
    const checkbox = document.getElementById('delay-no-delay');

    if (checkbox.checked) {
        // No Delay is checked - disable inputs and set to 0
        valueInput.disabled = true;
        unitSelect.disabled = true;
        valueInput.style.opacity = '0.5';
        unitSelect.style.opacity = '0.5';
    } else {
        // No Delay is unchecked - enable inputs
        valueInput.disabled = false;
        unitSelect.disabled = false;
        valueInput.style.opacity = '1';
        unitSelect.style.opacity = '1';
    }
}

// ============================================================================
// Timezone Mismatch Detection
// ============================================================================

async function checkTimezoneMismatch() {
    try {
        // Get browser timezone
        const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        // Fetch server timezone
        const response = await fetch('/api/timezone');
        const data = await response.json();

        if (data.success && data.timezone) {
            const serverTimezone = data.timezone;

            // Compare timezones (case-insensitive)
            if (browserTimezone.toLowerCase() !== serverTimezone.toLowerCase()) {
                // Timezones differ - show banner
                const banner = document.getElementById('timezone-mismatch-banner');
                const browserTzSpan = document.getElementById('browser-tz');
                const serverTzSpan = document.getElementById('server-tz');

                if (banner && browserTzSpan && serverTzSpan) {
                    browserTzSpan.textContent = browserTimezone;
                    serverTzSpan.textContent = serverTimezone;
                    banner.style.display = 'flex';

                    addDebugLog(`Timezone mismatch: Browser=${browserTimezone}, Server=${serverTimezone}`);
                }
            } else {
                // Timezones match - hide banner
                const banner = document.getElementById('timezone-mismatch-banner');
                if (banner) {
                    banner.style.display = 'none';
                }

                addDebugLog(`Timezones match: ${browserTimezone}`);
            }
        }
    } catch (error) {
        console.error('Error checking timezone mismatch:', error);
        addDebugLog(`Error checking timezone: ${error.message}`);
    }
}

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize debug panel (hidden by default, unless localStorage says otherwise)
    initializeDebugPanel();

    // Setup long-press toggle on page title
    setupLongPressToggle();

    addDebugLog('=== PAGE LOAD START ===');
    addDebugLog('DOMContentLoaded event fired');

    // Debug: Check localStorage for dismissed completion
    const storedDismissedId = localStorage.getItem('dismissed-completion-id');
    addDebugLog(`[PAGE LOAD] localStorage 'dismissed-completion-id': ${storedDismissedId}`);
    addDebugLog(`[PAGE LOAD] Global currentCompletionId: ${currentCompletionId}`);

    logStatusScreens();

    // Load saved catalog selection first, before loading config
    addDebugLog('Loading saved catalog selection...');
    await loadSavedCatalogSelection();
    addDebugLog('Catalog selection loaded');

    // Now load config (which will auto-load catalogs if needed)
    addDebugLog('Loading configuration...');
    loadConfiguration();
    addDebugLog('Loading schedules...');
    loadSchedules();
    addDebugLog('Checking timezone mismatch...');
    checkTimezoneMismatch();
    addDebugLog('Loading job status (AWAIT START)...');
    logStatusScreens();
    await loadJobStatus('DOMContentLoaded'); // Await to prevent showing idle screen during status fetch
    addDebugLog('Job status loaded (AWAIT COMPLETE)');
    logStatusScreens();
    addDebugLog('Connecting event source...');
    connectEventSource();

    // Enable drag and drop for addon URLs
    initializeAddonUrlDragDrop();

    // Initialize tooltips
    initializeTooltips();

    // Add listeners to track config changes
    setupConfigChangeListeners();

    // Initialize unlimited checkboxes state
    initializeUnlimitedCheckboxes();

    // Restore collapsed state from localStorage
    restoreCollapsedStates();

    // Initial state
    updateStartNowButtonState();

    // Page has finished loading, enable save notifications
    // Wait longer than auto-save debounce (2s) to prevent initial load notifications
    setTimeout(() => {
        isPageLoading = false;
        addDebugLog('=== PAGE LOAD COMPLETE (isPageLoading=false) ===');
    }, 4000);

    addDebugLog('=== DOMContentLoaded HANDLER COMPLETE ===');
    logStatusScreens();
});

function restoreCollapsedStates() {
    // Restore collapsed state for all collapsible sections
    const sections = ['addons', 'configuration', 'catalog-selection', 'schedule'];

    // Check if any prefetch job has ever been run
    const hasRunJob = localStorage.getItem('has-run-prefetch-job') === 'true';

    sections.forEach(sectionId => {
        const content = document.getElementById(`${sectionId}-content`);
        const icon = document.getElementById(`${sectionId}-icon`);

        if (!content || !icon) return;

        // Check if user has explicitly set a collapsed state
        const userCollapsedState = localStorage.getItem(`${sectionId}-collapsed`);

        // Check if section has been configured before
        const hasBeenConfigured = localStorage.getItem(`${sectionId}-configured`) === 'true';

        // Smart expand/collapse logic:
        // - If user has explicitly collapsed/expanded, respect that
        // - Otherwise, if unconfigured AND no job has run, expand
        // - If configured, collapse
        if (userCollapsedState !== null) {
            // User has explicitly set state, respect it
            if (userCollapsedState === 'true') {
                content.classList.add('collapsed');
                icon.classList.add('collapsed');
            }
        } else if (hasBeenConfigured || hasRunJob) {
            // Section has been configured or a job has run, collapse it
            content.classList.add('collapsed');
            icon.classList.add('collapsed');
        }
        // Otherwise leave expanded (default state)
    });
}

function initializeUnlimitedCheckboxes() {
    // Initialize all limit fields
    toggleUnlimited('movies-global-limit');
    toggleUnlimited('series-global-limit');
    toggleUnlimited('movies-per-catalog');
    toggleUnlimited('series-per-catalog');
    toggleUnlimited('items-per-mixed-catalog');
    toggleUnlimitedTime('max-execution-time');
}

function setupConfigChangeListeners() {
    // Listen to configuration section inputs for auto-save
    const configSection = document.getElementById('configuration');
    if (configSection) {
        configSection.addEventListener('input', () => {
            configModified = true;
            autoSaveConfiguration();
        });

        configSection.addEventListener('change', () => {
            configModified = true;
            autoSaveConfiguration();
        });
    }

    // Listen to addon URLs section inputs for auto-save
    const addonSection = document.getElementById('addon-urls');
    if (addonSection) {
        addonSection.addEventListener('input', () => {
            configModified = true;
            autoSaveConfiguration();
        });

        addonSection.addEventListener('change', () => {
            configModified = true;
            autoSaveConfiguration();
        });
    }
}

// ============================================================================
// Notifications
// ============================================================================

let activeNotifications = [];
let lastSaveTime = 0;
const SAVE_NOTIFICATION_DEBOUNCE = 1000; // Don't show notification more than once per second

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function showSaveNotification() {
    // Don't show notifications during page load
    if (isPageLoading) {
        return;
    }

    // Debounce to prevent multiple notifications on rapid saves
    const now = Date.now();
    if (now - lastSaveTime < SAVE_NOTIFICATION_DEBOUNCE) {
        return;
    }
    lastSaveTime = now;

    const notification = document.createElement('div');
    notification.className = 'save-notification';

    // Top accent line
    const accent = document.createElement('div');
    accent.className = 'save-notification-accent';
    notification.appendChild(accent);

    // Content container
    const content = document.createElement('div');
    content.className = 'save-notification-content';

    // Icon
    const icon = document.createElement('div');
    icon.className = 'save-notification-icon';
    icon.textContent = '✓';
    content.appendChild(icon);

    // Body
    const body = document.createElement('div');
    body.className = 'save-notification-body';

    const title = document.createElement('div');
    title.className = 'save-notification-title';
    title.textContent = 'Saved';
    body.appendChild(title);

    const message = document.createElement('div');
    message.className = 'save-notification-message';
    message.textContent = 'Changes saved successfully';
    body.appendChild(message);

    content.appendChild(body);

    // Actions (always show Dismiss button)
    const actions = document.createElement('div');
    actions.className = 'save-notification-actions';

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'save-notification-btn';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.onclick = () => dismissSaveNotification(notification);
    actions.appendChild(dismissBtn);

    // Only show Dismiss All if there are other notifications
    if (activeNotifications.length > 0) {
        const dismissAllBtn = document.createElement('button');
        dismissAllBtn.className = 'save-notification-btn';
        dismissAllBtn.textContent = 'Dismiss All';
        dismissAllBtn.onclick = dismissAllSaveNotifications;
        actions.appendChild(dismissAllBtn);
    }

    body.appendChild(actions);

    notification.appendChild(content);

    // Progress bar
    const progress = document.createElement('div');
    progress.className = 'save-notification-progress';
    notification.appendChild(progress);

    document.body.appendChild(notification);

    // Track notification
    activeNotifications.push(notification);
    updateSaveNotificationPositions();

    // Auto-dismiss after 1 second
    const timeout = setTimeout(() => {
        dismissSaveNotification(notification);
    }, 1000);

    notification._dismissTimeout = timeout;
}

function dismissSaveNotification(notification) {
    if (notification._dismissTimeout) {
        clearTimeout(notification._dismissTimeout);
    }

    notification.style.animation = 'slideOutSave 0.3s cubic-bezier(0.4, 0, 1, 1)';
    setTimeout(() => {
        notification.remove();
        activeNotifications = activeNotifications.filter(n => n !== notification);
        updateSaveNotificationPositions();
    }, 300);
}

function dismissAllSaveNotifications() {
    activeNotifications.forEach(notification => {
        if (notification._dismissTimeout) {
            clearTimeout(notification._dismissTimeout);
        }
        notification.style.animation = 'slideOutSave 0.3s cubic-bezier(0.4, 0, 1, 1)';
        setTimeout(() => notification.remove(), 300);
    });
    activeNotifications = [];
}

function updateSaveNotificationPositions() {
    let bottomOffset = 24;
    // Position from bottom up
    [...activeNotifications].reverse().forEach(notification => {
        notification.style.bottom = `${bottomOffset}px`;
        bottomOffset += notification.offsetHeight + 12;
    });
}

// Error Notification (red, 5 second auto-dismiss)
function showErrorNotification(title, message) {
    const notification = document.createElement('div');
    notification.className = 'error-notification';

    // Top accent line (red)
    const accent = document.createElement('div');
    accent.className = 'error-notification-accent';
    notification.appendChild(accent);

    // Content container
    const content = document.createElement('div');
    content.className = 'error-notification-content';

    // Icon
    const icon = document.createElement('div');
    icon.className = 'error-notification-icon';
    icon.textContent = '⚠';
    content.appendChild(icon);

    // Body
    const body = document.createElement('div');
    body.className = 'error-notification-body';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'error-notification-title';
    titleDiv.textContent = title;
    body.appendChild(titleDiv);

    const messageDiv = document.createElement('div');
    messageDiv.className = 'error-notification-message';
    messageDiv.textContent = message;
    body.appendChild(messageDiv);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'error-notification-actions';

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'error-notification-btn';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.onclick = () => dismissErrorNotification(notification);
    actions.appendChild(dismissBtn);

    body.appendChild(actions);
    content.appendChild(body);
    notification.appendChild(content);

    // Progress bar
    const progress = document.createElement('div');
    progress.className = 'error-notification-progress';
    notification.appendChild(progress);

    document.body.appendChild(notification);

    // Auto-dismiss after 5 seconds
    const timeout = setTimeout(() => {
        dismissErrorNotification(notification);
    }, 5000);

    notification._dismissTimeout = timeout;
}

function dismissErrorNotification(notification) {
    if (notification._dismissTimeout) {
        clearTimeout(notification._dismissTimeout);
    }

    notification.style.animation = 'slideOutSave 0.3s cubic-bezier(0.4, 0, 1, 1)';
    setTimeout(() => {
        notification.remove();
    }, 300);
}

// ============================================================================
// Configuration Management
// ============================================================================

async function loadConfiguration() {
    try {
        const response = await fetch('/api/config');
        const data = await response.json();

        if (data.success) {
            currentConfig = data.config;
            populateConfigurationForm(data.config);
            configSaved = true;  // Configuration loaded means it's saved
            configModified = false;
            updateStartNowButtonState();

            // Auto-load catalogs if addon URLs are configured
            if (currentConfig.addon_urls && currentConfig.addon_urls.length > 0) {
                // Load catalogs silently in the background
                loadCatalogs(true);
            }
        } else {
            showNotification('Failed to load configuration', 'error');
        }
    } catch (error) {
        console.error('Error loading configuration:', error);
        showNotification('Error loading configuration', 'error');
    }
}

function populateConfigurationForm(config) {
    // Populate addon URLs
    renderAddonUrls(config.addon_urls || []);

    // Populate limits with unlimited checkbox handling
    setLimitValue('movies-global-limit', config.movies_global_limit);
    setLimitValue('series-global-limit', config.series_global_limit);
    setLimitValue('movies-per-catalog', config.movies_per_catalog);
    setLimitValue('series-per-catalog', config.series_per_catalog);
    setLimitValue('items-per-mixed-catalog', config.items_per_mixed_catalog);

    // Populate time-based parameters
    // Delay - use largest divisible unit
    const delayValue = config.delay !== undefined ? config.delay : 2;
    if (delayValue === 0) {
        // No delay - show 2 seconds in UI but checkbox will be checked
        document.getElementById('delay-no-delay').checked = true;
        document.getElementById('delay-value').value = 2;
        document.getElementById('delay-unit').value = '1';
    } else {
        document.getElementById('delay-no-delay').checked = false;
        if (delayValue % 3600 === 0) {
            // Divisible by hours
            document.getElementById('delay-value').value = delayValue / 3600;
            document.getElementById('delay-unit').value = '3600';
        } else if (delayValue % 60 === 0) {
            // Divisible by minutes
            document.getElementById('delay-value').value = delayValue / 60;
            document.getElementById('delay-unit').value = '60';
        } else if (delayValue >= 1) {
            // Whole seconds
            document.getElementById('delay-value').value = delayValue;
            document.getElementById('delay-unit').value = '1';
        } else {
            // Fractional seconds - show in milliseconds
            document.getElementById('delay-value').value = delayValue * 1000;
            document.getElementById('delay-unit').value = '0.001';
        }
    }
    toggleNoDelay();

    // Cache validity - handle unlimited (-1) and convert to appropriate unit
    const cacheValiditySeconds = config.cache_validity !== undefined ? config.cache_validity : 604800; // Default: 1 week
    if (cacheValiditySeconds === -1) {
        // Unlimited - show 1 week in UI but checkbox will be checked
        document.getElementById('cache-validity-value').value = 1;
        document.getElementById('cache-validity-unit').value = '604800';
        document.getElementById('cache-validity-unlimited').checked = true;
    } else if (cacheValiditySeconds % 604800 === 0) {
        // Divisible by weeks
        document.getElementById('cache-validity-value').value = cacheValiditySeconds / 604800;
        document.getElementById('cache-validity-unit').value = '604800';
        document.getElementById('cache-validity-unlimited').checked = false;
    } else if (cacheValiditySeconds % 86400 === 0) {
        // Divisible by days
        document.getElementById('cache-validity-value').value = cacheValiditySeconds / 86400;
        document.getElementById('cache-validity-unit').value = '86400';
        document.getElementById('cache-validity-unlimited').checked = false;
    } else if (cacheValiditySeconds % 3600 === 0) {
        // Divisible by hours
        document.getElementById('cache-validity-value').value = cacheValiditySeconds / 3600;
        document.getElementById('cache-validity-unit').value = '3600';
        document.getElementById('cache-validity-unlimited').checked = false;
    } else if (cacheValiditySeconds % 60 === 0) {
        // Divisible by minutes
        document.getElementById('cache-validity-value').value = cacheValiditySeconds / 60;
        document.getElementById('cache-validity-unit').value = '60';
        document.getElementById('cache-validity-unlimited').checked = false;
    } else {
        // Show in seconds
        document.getElementById('cache-validity-value').value = cacheValiditySeconds;
        document.getElementById('cache-validity-unit').value = '1';
        document.getElementById('cache-validity-unlimited').checked = false;
    }
    toggleUnlimitedTime('cache-validity');

    // Max Execution Time - use largest divisible unit
    const maxExecSeconds = config.max_execution_time !== undefined ? config.max_execution_time : 5400;
    if (maxExecSeconds === -1) {
        // Unlimited - show 90 minutes in UI but checkbox will be checked
        document.getElementById('max-execution-time-value').value = 90;
        document.getElementById('max-execution-time-unit').value = '60';
        document.getElementById('max-execution-time-unlimited').checked = true;
    } else if (maxExecSeconds % 86400 === 0) {
        // Divisible by days
        document.getElementById('max-execution-time-value').value = maxExecSeconds / 86400;
        document.getElementById('max-execution-time-unit').value = '86400';
        document.getElementById('max-execution-time-unlimited').checked = false;
    } else if (maxExecSeconds % 3600 === 0) {
        // Divisible by hours
        document.getElementById('max-execution-time-value').value = maxExecSeconds / 3600;
        document.getElementById('max-execution-time-unit').value = '3600';
        document.getElementById('max-execution-time-unlimited').checked = false;
    } else if (maxExecSeconds % 60 === 0) {
        // Divisible by minutes
        document.getElementById('max-execution-time-value').value = maxExecSeconds / 60;
        document.getElementById('max-execution-time-unit').value = '60';
        document.getElementById('max-execution-time-unlimited').checked = false;
    } else {
        // Show in seconds
        document.getElementById('max-execution-time-value').value = maxExecSeconds;
        document.getElementById('max-execution-time-unit').value = '1';
        document.getElementById('max-execution-time-unlimited').checked = false;
    }
    toggleUnlimitedTime('max-execution-time');

    // Populate proxy
    document.getElementById('proxy').value = config.proxy || '';

    // Populate boolean flags
    document.querySelector(`input[name="randomize-catalog"][value="${config.randomize_catalog_processing}"]`).checked = true;
    document.querySelector(`input[name="randomize-item"][value="${config.randomize_item_prefetching}"]`).checked = true;
    document.querySelector(`input[name="enable-logging"][value="${config.enable_logging}"]`).checked = true;
}

function setLimitValue(fieldId, value) {
    const input = document.getElementById(fieldId);
    const checkbox = document.getElementById(`${fieldId}-unlimited`);

    if (value === -1) {
        // Unlimited
        checkbox.checked = true;
        input.value = fieldId.includes('global') ? 200 : (fieldId.includes('mixed') ? 30 : 50);
    } else {
        // Limited
        checkbox.checked = false;
        input.value = value;
    }
    toggleUnlimited(fieldId);
}

function renderAddonUrls(addonUrls) {
    // Clear existing
    ['both', 'catalog', 'stream'].forEach(type => {
        document.getElementById(`addon-list-${type}`).innerHTML = '';
    });

    // Render each URL with cached name - no fetching on page load
    addonUrls.forEach((item, index) => {
        const container = document.getElementById(`addon-list-${item.type}`);
        const itemDiv = createAddonUrlItem(item.url, item.type, index, item.name);
        container.appendChild(itemDiv);
    });
}

function createAddonUrlItem(url, type, index, name = null, forceEdit = false) {
    const div = document.createElement('div');
    div.className = 'addon-item';
    div.draggable = true;
    div.dataset.type = type;
    div.dataset.index = index;
    div.dataset.url = url;
    div.dataset.name = name || '';

    const isEditing = forceEdit || !url || url === '';
    const displayName = name || url;

    if (isEditing) {
        // Editing mode - show input field
        div.innerHTML = `
            <span class="drag-handle">⋮⋮</span>
            <input type="url" class="addon-url-input" value="${url}" placeholder="https://addon.example.com">
            <button class="remove-btn" onclick="removeAddonUrl(this)">×</button>
        `;

        // Add input listener for auto-fetch manifest
        const input = div.querySelector('.addon-url-input');
        let fetchTimeout = null;
        input.addEventListener('input', (e) => {
            const newUrl = e.target.value.trim();
            div.dataset.url = newUrl;

            // Clear existing timeout
            if (fetchTimeout) {
                clearTimeout(fetchTimeout);
            }

            // Fetch manifest after 2 second delay (but don't save yet)
            if (newUrl && newUrl.startsWith('http')) {
                fetchTimeout = setTimeout(() => {
                    fetchAddonManifest(newUrl, div);
                    fetchTimeout = null;
                }, 2000);
            }
        });
    } else {
        // Display mode - show name/URL as read-only
        div.innerHTML = `
            <span class="drag-handle">⋮⋮</span>
            <span class="addon-display-name" title="${url}">${displayName}</span>
            <button class="edit-btn" onclick="editAddonUrl(this)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
                Edit
            </button>
            <button class="remove-btn" onclick="removeAddonUrl(this)">×</button>
        `;
    }

    setupAddonDragDrop(div);

    return div;
}

function addAddonUrl(type) {
    const container = document.getElementById(`addon-list-${type}`);
    const index = container.children.length;
    const itemDiv = createAddonUrlItem('', type, index);
    container.appendChild(itemDiv);
    // Don't auto-save here - will save after manifest is fetched
}

function removeAddonUrl(btn) {
    btn.closest('.addon-item').remove();
    // Save immediately when removing (this is a complete action)
    updateAddonUrlsConfig();
}

function editAddonUrl(btn) {
    const div = btn.closest('.addon-item');
    const url = div.dataset.url;
    const type = div.dataset.type;
    const index = div.dataset.index;

    // Recreate item in editing mode (forceEdit = true)
    const newDiv = createAddonUrlItem(url, type, index, null, true);
    div.replaceWith(newDiv);
}

function normalizeAddonUrl(url) {
    // Normalize Stremio addon URL by stripping common endpoints
    // Supports URLs ending with:
    // - /manifest.json
    // - /configure
    // - /catalog/... /meta/... /stream/... /subtitles/... /addon_catalog/...

    let normalized = url.trim();

    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');

    // Strip /manifest.json
    if (normalized.endsWith('/manifest.json')) {
        normalized = normalized.slice(0, -14);
    }

    // Strip /configure
    if (normalized.endsWith('/configure')) {
        normalized = normalized.slice(0, -10);
    }

    // Strip resource endpoints: /catalog/*, /meta/*, /stream/*, /subtitles/*, /addon_catalog/*
    normalized = normalized.replace(/\/(catalog|meta|stream|subtitles|addon_catalog)\/.*$/, '');

    return normalized;
}

async function fetchAddonManifest(url, addonDiv) {
    try {
        // Normalize the URL to strip Stremio addon endpoints
        const normalizedUrl = normalizeAddonUrl(url);

        // Check for duplicates before fetching manifest
        const currentType = addonDiv.dataset.type;
        const isDuplicate = checkDuplicateAddonUrl(normalizedUrl, currentType, addonDiv);

        if (isDuplicate) {
            // Remove the duplicate item
            addonDiv.remove();
            return;
        }

        const response = await fetch('/api/addon/manifest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: normalizedUrl })
        });

        const data = await response.json();

        if (data.success && data.name) {
            // Update the addon item with the fetched name
            addonDiv.dataset.name = data.name;
            addonDiv.dataset.url = data.url;

            // Convert to display mode
            const type = addonDiv.dataset.type;
            const index = addonDiv.dataset.index;
            const newDiv = createAddonUrlItem(data.url, type, index, data.name);
            addonDiv.replaceWith(newDiv);

            // Update config with the name
            updateAddonUrlsConfig();
        }
    } catch (error) {
        console.error('Error fetching addon manifest:', error);
    }
}

function checkDuplicateAddonUrl(url, currentType, currentDiv) {
    const normalizedUrl = url.trim().toLowerCase();
    let foundIn = null;

    // Check all three sections
    ['both', 'catalog', 'stream'].forEach(type => {
        const container = document.getElementById(`addon-list-${type}`);
        const items = container.querySelectorAll('.addon-item');

        items.forEach(item => {
            // Skip the current item being added
            if (item === currentDiv) return;

            const itemUrl = (item.dataset.url || '').trim().toLowerCase();
            if (itemUrl === normalizedUrl) {
                foundIn = type;
            }
        });
    });

    if (foundIn) {
        // Show error notification
        const sectionNames = {
            'both': 'Both (Catalog & Stream)',
            'catalog': 'Catalog Only',
            'stream': 'Stream Only'
        };

        let message = `This addon URL is already added in the "${sectionNames[foundIn]}" section.`;

        // If they're trying to add to a different section, suggest using "both"
        if (foundIn !== 'both' && currentType !== 'both' && foundIn !== currentType) {
            message += ` If you want this addon to serve as both catalog and stream, move it to the "Both" section instead.`;
        }

        showErrorNotification('Duplicate Addon URL', message);
        return true;
    }

    return false;
}

function updateAddonUrlsConfig() {
    // Collect all addon URLs with their names
    // Only save URLs that are in display mode (successfully fetched)
    const addonUrls = [];
    ['both', 'catalog', 'stream'].forEach(type => {
        const container = document.getElementById(`addon-list-${type}`);
        const items = container.querySelectorAll('.addon-item');
        items.forEach(item => {
            // Only save if URL has been validated (has display name, not in edit mode)
            const displayName = item.querySelector('.addon-display-name');
            if (displayName) {
                const url = item.dataset.url;
                const name = item.dataset.name || null;
                if (url && url.trim()) {
                    addonUrls.push({
                        url: url.trim(),
                        type: type,
                        name: name
                    });
                }
            }
        });
    });

    // Save to config
    currentConfig.addon_urls = addonUrls;
    autoSaveConfiguration();
}

// ============================================================================
// Drag and Drop for Addon URLs
// ============================================================================

function initializeAddonUrlDragDrop() {
    const sections = document.querySelectorAll('.addon-section');

    sections.forEach(section => {
        section.addEventListener('dragover', (e) => {
            e.preventDefault();
            section.style.background = '#e3f2fd';
        });

        section.addEventListener('dragleave', (e) => {
            section.style.background = '';
        });

        section.addEventListener('drop', (e) => {
            e.preventDefault();
            section.style.background = '';

            const data = e.dataTransfer.getData('text/plain');
            if (!data) return;

            const { url, oldType } = JSON.parse(data);
            const newType = section.dataset.type;

            // Remove the dragging element from old location
            const draggingElement = document.querySelector('.addon-item.dragging');
            if (draggingElement) {
                draggingElement.remove();
            }

            // Update type and add to new location
            const container = section.querySelector('.addon-list');
            const itemDiv = createAddonUrlItem(url, newType, container.children.length);
            container.appendChild(itemDiv);

            // Trigger auto-save
            autoSaveConfiguration();
        });
    });
}

function setupAddonDragDrop(element) {
    element.addEventListener('dragstart', (e) => {
        element.classList.add('dragging');
        const url = element.querySelector('input').value;
        const type = element.dataset.type;
        e.dataTransfer.setData('text/plain', JSON.stringify({ url, oldType: type }));
    });

    element.addEventListener('dragend', (e) => {
        element.classList.remove('dragging');
    });
}

// ============================================================================
// Validation Functions
// ============================================================================

function validateAddonUrls(addonUrls) {
    const errors = [];

    if (addonUrls.length === 0) {
        errors.push('At least one addon URL is required');
        return errors;
    }

    // Check for at least one catalog addon
    const hasCatalogAddon = addonUrls.some(item => item.type === 'catalog' || item.type === 'both');
    if (!hasCatalogAddon) {
        errors.push('At least one catalog addon (type "Catalog" or "Both") is required');
    }

    // Check for at least one stream addon
    const hasStreamAddon = addonUrls.some(item => item.type === 'stream' || item.type === 'both');
    if (!hasStreamAddon) {
        errors.push('At least one stream addon (type "Stream" or "Both") is required');
    }

    // Validate each URL
    addonUrls.forEach((item, index) => {
        if (!item.url || item.url.trim() === '') {
            errors.push(`Addon URL #${index + 1} cannot be empty`);
        } else {
            try {
                new URL(item.url);
            } catch (e) {
                errors.push(`Invalid URL format for addon #${index + 1}: ${item.url}`);
            }
        }
    });

    return errors;
}

function validateLimits(config) {
    const errors = [];

    const limitFields = [
        { field: 'movies_global_limit', name: 'Movies Global Limit' },
        { field: 'series_global_limit', name: 'Series Global Limit' },
        { field: 'movies_per_catalog', name: 'Movies per Catalog' },
        { field: 'series_per_catalog', name: 'Series per Catalog' },
        { field: 'items_per_mixed_catalog', name: 'Items per Mixed Catalog' }
    ];

    limitFields.forEach(({ field, name }) => {
        const value = config[field];
        if (isNaN(value) || !Number.isInteger(value)) {
            errors.push(`${name} must be a valid integer`);
        } else if (value < -1) {
            errors.push(`${name} must be -1 or greater (got: ${value})`);
        }
    });

    return errors;
}

function validateTimeFields(config) {
    const errors = [];

    // Delay must be >= 0
    if (config.delay < 0) {
        errors.push('Delay must be 0 or greater');
    }

    // Cache validity must be non-negative or -1 for unlimited
    if (config.cache_validity < -1) {
        errors.push('Cache validity must be 0 or positive, or -1 for unlimited');
    }

    // Max execution time must be positive or -1
    if (config.max_execution_time < -1 || config.max_execution_time === 0) {
        errors.push('Max execution time must be positive or -1 for unlimited');
    }

    return errors;
}

function validateConfiguration(config, addonUrls) {
    let allErrors = [];

    allErrors = allErrors.concat(validateAddonUrls(addonUrls));
    allErrors = allErrors.concat(validateLimits(config));
    allErrors = allErrors.concat(validateTimeFields(config));

    return allErrors;
}

function validatePrefetchStart() {
    const errors = [];

    // Must have saved configuration
    if (!configSaved) {
        errors.push('Configuration must be saved before starting prefetch');
    }

    // Must have loaded catalogs
    if (!catalogsLoaded || loadedCatalogs.length === 0) {
        errors.push('No catalogs loaded. Please load catalogs first');
    }

    // Must have at least one catalog selected
    const selectedCatalogs = loadedCatalogs.filter(cat => cat.enabled);
    if (selectedCatalogs.length === 0) {
        errors.push('At least one catalog must be selected');
    }

    return errors;
}

// ============================================================================
// Save Configuration
// ============================================================================

function autoSaveConfiguration() {
    if (configSaveTimeout) {
        clearTimeout(configSaveTimeout);
    }
    configSaveTimeout = setTimeout(() => {
        saveConfigurationSilent();
    }, 2000);
}

async function saveConfigurationSilent() {
    try {
        // Collect addon URLs (only validated ones in display mode)
        const addonUrls = [];
        ['both', 'catalog', 'stream'].forEach(type => {
            const container = document.getElementById(`addon-list-${type}`);
            const items = container.querySelectorAll('.addon-item');
            items.forEach(item => {
                // Check if in display mode (has display name) or edit mode (has input)
                const displayName = item.querySelector('.addon-display-name');
                if (displayName) {
                    // Display mode - get from dataset
                    const url = item.dataset.url;
                    const name = item.dataset.name || null;
                    if (url && url.trim()) {
                        addonUrls.push({ url: url.trim(), type, name });
                    }
                } else {
                    // Edit mode - skip, don't save incomplete URLs
                    // URLs will be saved after manifest fetch succeeds
                }
            });
        });

        // Helper function to get limit value (returns -1 if unlimited checked)
        const getLimitValue = (fieldId) => {
            const checkbox = document.getElementById(`${fieldId}-unlimited`);
            if (checkbox && checkbox.checked) {
                return -1;
            }
            return parseInt(document.getElementById(fieldId).value);
        };

        // Collect configuration
        const config = {
            addon_urls: addonUrls,
            movies_global_limit: getLimitValue('movies-global-limit'),
            series_global_limit: getLimitValue('series-global-limit'),
            movies_per_catalog: getLimitValue('movies-per-catalog'),
            series_per_catalog: getLimitValue('series-per-catalog'),
            items_per_mixed_catalog: getLimitValue('items-per-mixed-catalog'),
            delay: document.getElementById('delay-no-delay').checked ? 0 : parseFloat(document.getElementById('delay-value').value) * parseFloat(document.getElementById('delay-unit').value),
            cache_validity: document.getElementById('cache-validity-unlimited').checked ? -1 : parseFloat(document.getElementById('cache-validity-value').value) * parseFloat(document.getElementById('cache-validity-unit').value),
            max_execution_time: document.getElementById('max-execution-time-unlimited').checked ? -1 : parseFloat(document.getElementById('max-execution-time-value').value) * parseFloat(document.getElementById('max-execution-time-unit').value),
            proxy: document.getElementById('proxy').value.trim(),
            randomize_catalog_processing: document.querySelector('input[name="randomize-catalog"]:checked').value === 'true',
            randomize_item_prefetching: document.querySelector('input[name="randomize-item"]:checked').value === 'true',
            enable_logging: document.querySelector('input[name="enable-logging"]:checked').value === 'true'
        };

        const response = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const data = await response.json();

        if (data.success) {
            currentConfig = data.config;
            configSaved = true;
            configModified = false;
            updateStartNowButtonState();
            showSaveNotification();

            // Mark sections as configured for smart collapse behavior
            localStorage.setItem('addons-configured', 'true');
            localStorage.setItem('configuration-configured', 'true');
        } else {
            console.error('Failed to auto-save configuration:', data.error);
        }
    } catch (error) {
        console.error('Error auto-saving configuration:', error);
    }
}

async function saveConfiguration() {
    const btn = document.getElementById('save-config-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        // Collect addon URLs
        const addonUrls = [];
        ['both', 'catalog', 'stream'].forEach(type => {
            const container = document.getElementById(`addon-list-${type}`);
            const items = container.querySelectorAll('.addon-item');
            items.forEach(item => {
                const url = item.querySelector('input').value.trim();
                if (url) {
                    addonUrls.push({ url, type });
                }
            });
        });

        // Helper function to get limit value (returns -1 if unlimited checked)
        const getLimitValue = (fieldId) => {
            const checkbox = document.getElementById(`${fieldId}-unlimited`);
            if (checkbox && checkbox.checked) {
                return -1;
            }
            return parseInt(document.getElementById(fieldId).value);
        };

        // Collect configuration
        const config = {
            addon_urls: addonUrls,
            movies_global_limit: getLimitValue('movies-global-limit'),
            series_global_limit: getLimitValue('series-global-limit'),
            movies_per_catalog: getLimitValue('movies-per-catalog'),
            series_per_catalog: getLimitValue('series-per-catalog'),
            items_per_mixed_catalog: getLimitValue('items-per-mixed-catalog'),
            delay: document.getElementById('delay-no-delay').checked ? 0 : parseFloat(document.getElementById('delay-value').value) * parseFloat(document.getElementById('delay-unit').value),
            cache_validity: document.getElementById('cache-validity-unlimited').checked ? -1 : parseFloat(document.getElementById('cache-validity-value').value) * parseFloat(document.getElementById('cache-validity-unit').value),
            max_execution_time: document.getElementById('max-execution-time-unlimited').checked ? -1 : parseFloat(document.getElementById('max-execution-time-value').value) * parseFloat(document.getElementById('max-execution-time-unit').value),
            proxy: document.getElementById('proxy').value.trim(),
            randomize_catalog_processing: document.querySelector('input[name="randomize-catalog"]:checked').value === 'true',
            randomize_item_prefetching: document.querySelector('input[name="randomize-item"]:checked').value === 'true',
            enable_logging: document.querySelector('input[name="enable-logging"]:checked').value === 'true'
        };

        // Validate configuration
        const validationErrors = validateConfiguration(config, addonUrls);
        if (validationErrors.length > 0) {
            showNotification(`Validation failed:\n${validationErrors.join('\n')}`, 'error');
            btn.disabled = false;
            btn.textContent = 'Save Configuration';
            return;
        }

        const response = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const data = await response.json();

        if (data.success) {
            currentConfig = data.config;
            configSaved = true;
            configModified = false;
            updateStartNowButtonState();
            showNotification('Configuration saved successfully', 'success');

            // Mark sections as configured for smart collapse behavior
            localStorage.setItem('addons-configured', 'true');
            localStorage.setItem('configuration-configured', 'true');
        } else {
            showNotification(data.error || 'Failed to save configuration', 'error');
        }
    } catch (error) {
        console.error('Error saving configuration:', error);
        showNotification('Error saving configuration', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Configuration';
    }
}

// ============================================================================
// Reset to Defaults with Hold-Down Countdown
// ============================================================================

let resetCountdownInterval = null;
let resetStartTime = null;
const RESET_HOLD_DURATION = 8000; // 8 seconds in milliseconds

function startResetCountdown() {
    const btn = document.getElementById('reset-all-btn');

    // Prevent multiple countdowns
    if (resetCountdownInterval) {
        return;
    }

    resetStartTime = Date.now();
    btn.classList.add('resetting', 'pulsating');

    // Update button text and animation every 100ms
    resetCountdownInterval = setInterval(() => {
        const elapsed = Date.now() - resetStartTime;
        const remaining = RESET_HOLD_DURATION - elapsed;
        const secondsRemaining = Math.ceil(remaining / 1000);

        if (remaining <= 0) {
            // Countdown complete - perform reset
            clearInterval(resetCountdownInterval);
            resetCountdownInterval = null;
            performReset();
        } else {
            // Update button text
            btn.textContent = `Keep pressing for ${secondsRemaining} second${secondsRemaining !== 1 ? 's' : ''}...`;

            // Update animation based on progress
            const progress = elapsed / RESET_HOLD_DURATION;
            updateResetAnimation(btn, progress);
        }
    }, 100);
}

function cancelResetCountdown() {
    if (resetCountdownInterval) {
        clearInterval(resetCountdownInterval);
        resetCountdownInterval = null;
        resetStartTime = null;

        const btn = document.getElementById('reset-all-btn');
        btn.textContent = 'Reset to Defaults';
        btn.classList.remove('resetting', 'pulsating');
        btn.style.removeProperty('--pulse-duration');
    }
}

function updateResetAnimation(btn, progress) {
    // Smoothly transition animation speed from 2s (slow) to 0.25s (very fast)
    // Using an exponential curve for more dramatic acceleration
    const minDuration = 0.25; // seconds (very fast)
    const maxDuration = 2.0;  // seconds (slow)

    // Exponential easing: starts slow, accelerates dramatically near the end
    const easedProgress = Math.pow(progress, 2);
    const duration = maxDuration - (easedProgress * (maxDuration - minDuration));

    // Set CSS variable for smooth animation speed transition
    btn.style.setProperty('--pulse-duration', `${duration}s`);
}

async function performReset() {
    const btn = document.getElementById('reset-all-btn');
    btn.textContent = 'Resetting...';
    btn.classList.remove('pulsating');
    btn.style.removeProperty('--pulse-duration');
    btn.disabled = true;

    try {
        // Delete all log files first
        try {
            await fetch('/api/logs', { method: 'DELETE' });
        } catch (logError) {
            console.error('Error deleting log files during reset:', logError);
            // Continue with reset even if log deletion fails
        }

        // Reset configuration
        const response = await fetch('/api/config/reset', {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('All settings reset to defaults successfully', 'success');

            // Clear all localStorage
            localStorage.clear();

            // Reload the page to show default values
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            showNotification(data.error || 'Failed to reset configuration', 'error');
            btn.disabled = false;
            btn.textContent = 'Reset to Defaults';
            btn.classList.remove('resetting');
        }
    } catch (error) {
        console.error('Error resetting configuration:', error);
        showNotification('Error resetting configuration', 'error');
        btn.disabled = false;
        btn.textContent = 'Reset to Defaults';
        btn.classList.remove('resetting');
    }
}

// ============================================================================
// Terminate Job with Hold-Down Countdown
// ============================================================================

let terminateCountdownInterval = null;
let terminateStartTime = null;
const TERMINATE_HOLD_DURATION = 5000; // 5 seconds in milliseconds

function startTerminateCountdown() {
    const btn = document.getElementById('terminate-btn');

    // Prevent multiple countdowns
    if (terminateCountdownInterval) {
        return;
    }

    terminateStartTime = Date.now();
    btn.classList.add('terminating', 'pulsating');

    // Update button text and animation every 100ms
    terminateCountdownInterval = setInterval(() => {
        const elapsed = Date.now() - terminateStartTime;
        const remaining = TERMINATE_HOLD_DURATION - elapsed;
        const secondsRemaining = Math.ceil(remaining / 1000);

        if (remaining <= 0) {
            // Countdown complete - perform termination
            clearInterval(terminateCountdownInterval);
            terminateCountdownInterval = null;
            performTerminate();
        } else {
            // Update button text
            btn.textContent = `Keep pressing for ${secondsRemaining} second${secondsRemaining !== 1 ? 's' : ''}...`;

            // Update animation based on progress
            const progress = elapsed / TERMINATE_HOLD_DURATION;
            updateTerminateAnimation(btn, progress);
        }
    }, 100);
}

function resetTerminateButton(force = false) {
    // Only reset if countdown is active (user released early) OR if forced (new job starting)
    if (!force && !terminateCountdownInterval) {
        return;
    }

    if (terminateCountdownInterval) {
        clearInterval(terminateCountdownInterval);
        terminateCountdownInterval = null;
        terminateStartTime = null;
    }

    const btn = document.getElementById('terminate-btn');
    if (btn) {
        btn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            Terminate
        `;
        btn.classList.remove('terminating', 'pulsating');
        btn.style.removeProperty('--pulse-duration');
        btn.disabled = false;
    }
}

function updateTerminateAnimation(btn, progress) {
    // Smoothly transition animation speed from 2s (slow) to 0.25s (very fast)
    // Using an exponential curve for more dramatic acceleration
    const minDuration = 0.25; // seconds (very fast)
    const maxDuration = 2.0;  // seconds (slow)

    // Exponential easing: starts slow, accelerates dramatically near the end
    const easedProgress = Math.pow(progress, 2);
    const duration = maxDuration - (easedProgress * (maxDuration - minDuration));

    // Set CSS variable for smooth animation speed transition
    btn.style.setProperty('--pulse-duration', `${duration}s`);
}

async function performTerminate() {
    const btn = document.getElementById('terminate-btn');
    btn.textContent = 'Terminating...';
    btn.classList.remove('pulsating');
    btn.style.removeProperty('--pulse-duration');
    btn.disabled = true;

    try {
        // Set flag to indicate termination was requested
        // We'll still show completion screen with results when job finishes
        jobTerminationRequested = true;

        // Make the API call and wait for completion results
        const response = await fetch('/api/job/cancel', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showNotification('Job terminating... waiting for results', 'info');
            // Don't switch to idle - wait for job_complete event with results
        } else {
            showNotification(data.error || 'Failed to terminate job', 'error');
            // Reset button on error
            btn.classList.remove('terminating');
            btn.disabled = false;
            btn.textContent = 'Terminate';
            jobTerminationRequested = false;
        }
    } catch (error) {
        console.error('Error terminating job:', error);
        showNotification('Error terminating job', 'error');
        btn.disabled = false;
        btn.textContent = 'Terminate';
        btn.classList.remove('terminating');
        jobTerminationRequested = false;
    }
}

// ============================================================================
// Catalog Loading and Selection
// ============================================================================

async function loadSavedCatalogSelection() {
    try {
        const response = await fetch('/api/catalogs/selection');
        const data = await response.json();

        if (data.success && data.catalogs && data.catalogs.length > 0) {
            loadedCatalogs = data.catalogs;
            renderCatalogList(data.catalogs);
            document.getElementById('catalog-list-container').style.display = 'block';
            document.getElementById('select-all-btn').style.display = 'block';
            document.getElementById('deselect-all-btn').style.display = 'block';
            catalogsLoaded = true;
            updateLoadCatalogsButtonText();
            updateStartNowButtonState();
        }
    } catch (error) {
        console.error('Error loading saved catalog selection:', error);
    }
}

async function loadCatalogs(silent = false) {
    // Check if configuration is saved and has addon URLs
    if (!configSaved) {
        if (!silent) showNotification('Please save configuration before loading catalogs', 'error');
        return;
    }

    const addonUrls = currentConfig.addon_urls || [];
    if (addonUrls.length === 0) {
        if (!silent) showNotification('Please add at least one addon URL to the configuration and save it', 'error');
        return;
    }

    const btn = document.getElementById('load-catalogs-btn');
    if (!silent) {
        btn.disabled = true;
        btn.textContent = 'Loading Catalogs...';
    }

    try {
        const response = await fetch('/api/catalogs/load', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            // Merge with existing saved selections
            const savedSelections = {};
            loadedCatalogs.forEach(cat => {
                savedSelections[cat.id] = {
                    enabled: cat.enabled,
                    order: cat.order
                };
            });

            // Apply saved selections to newly loaded catalogs
            const mergedCatalogs = [];
            const newCatalogs = [];

            data.catalogs.forEach(catalog => {
                if (savedSelections[catalog.id]) {
                    catalog.enabled = savedSelections[catalog.id].enabled;
                    catalog.order = savedSelections[catalog.id].order;
                    mergedCatalogs.push(catalog);
                } else {
                    // New catalog - add to end
                    newCatalogs.push(catalog);
                }
            });

            // Sort merged catalogs by order
            mergedCatalogs.sort((a, b) => a.order - b.order);

            // Append new catalogs at the end
            newCatalogs.forEach((catalog, index) => {
                catalog.enabled = true;
                catalog.order = mergedCatalogs.length + index;
                mergedCatalogs.push(catalog);
            });

            loadedCatalogs = mergedCatalogs;
            renderCatalogList(loadedCatalogs);
            document.getElementById('catalog-list-container').style.display = 'block';
            document.getElementById('select-all-btn').style.display = 'block';
            document.getElementById('deselect-all-btn').style.display = 'block';
            catalogsLoaded = true;
            updateLoadCatalogsButtonText();
            updateStartNowButtonState();

            // Auto-save catalog selection after loading/reloading
            autoSaveCatalogSelection();

            if (!silent) {
                showNotification(`Loaded ${data.total_catalogs} catalogs from ${data.total_addons} addons`, 'success');

                if (data.errors.length > 0) {
                    const errorWord = data.errors.length === 1 ? 'error' : 'errors';
                    showNotification(`${data.errors.length} ${errorWord} occurred while loading catalogs`, 'error');
                }
            }
        } else {
            if (!silent) showNotification(data.error || 'Failed to load catalogs', 'error');
        }
    } catch (error) {
        console.error('Error loading catalogs:', error);
        if (!silent) showNotification('Error loading catalogs', 'error');
    } finally {
        if (!silent) {
            btn.disabled = false;
            updateLoadCatalogsButtonText();
        }
    }
}

function updateLoadCatalogsButtonText() {
    const btn = document.getElementById('load-catalogs-btn');
    btn.textContent = catalogsLoaded ? 'Reload Catalogs' : 'Load Catalogs';
}

function renderCatalogList(catalogs) {
    const container = document.getElementById('catalog-list');
    container.innerHTML = '';

    catalogs.forEach((catalog, index) => {
        const div = document.createElement('div');
        div.className = 'catalog-item';
        div.draggable = true;
        div.dataset.catalogId = catalog.id;
        div.dataset.order = catalog.order || index;

        // Show addon badge only if multiple addons
        const totalAddons = new Set(catalogs.map(c => c.addon_url)).size;
        const addonBadge = totalAddons > 1 ?
            `<span class="addon-badge" title="From ${catalog.addon_name}">ℹ️ ${catalog.addon_name}</span>` : '';

        // Capitalize first letter of type
        const typeCapitalized = catalog.type.charAt(0).toUpperCase() + catalog.type.slice(1);

        div.innerHTML = `
            <span class="drag-handle">⋮⋮</span>
            <input type="checkbox" ${catalog.enabled ? 'checked' : ''} onchange="toggleCatalog('${catalog.id}', this.checked)">
            <div class="catalog-info">
                <div class="catalog-name">${catalog.name}</div>
                <div class="catalog-meta">Type: <strong>${typeCapitalized}</strong>${addonBadge ? ' | ' + addonBadge : ''}</div>
            </div>
        `;

        setupCatalogDragDrop(div);
        container.appendChild(div);
    });
}

function toggleCatalog(catalogId, enabled) {
    const catalog = loadedCatalogs.find(c => c.id === catalogId);
    if (catalog) {
        catalog.enabled = enabled;
        updateStartNowButtonState();
        autoSaveCatalogSelection();
    }
}

function selectAllCatalogs() {
    loadedCatalogs.forEach(catalog => {
        catalog.enabled = true;
    });
    renderCatalogList(loadedCatalogs);
    updateStartNowButtonState();
    autoSaveCatalogSelection();
}

function deselectAllCatalogs() {
    loadedCatalogs.forEach(catalog => {
        catalog.enabled = false;
    });
    renderCatalogList(loadedCatalogs);
    updateStartNowButtonState();
    autoSaveCatalogSelection();
}

// ============================================================================
// Drag and Drop for Catalogs
// ============================================================================

function setupCatalogDragDrop(element) {
    element.addEventListener('dragstart', (e) => {
        element.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', element.innerHTML);
    });

    element.addEventListener('dragend', (e) => {
        element.classList.remove('dragging');
        // Trigger auto-save after drag-drop reordering
        autoSaveCatalogSelection();
    });

    element.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(element.parentElement, e.clientY);
        const dragging = document.querySelector('.dragging');

        if (afterElement == null) {
            element.parentElement.appendChild(dragging);
        } else {
            element.parentElement.insertBefore(dragging, afterElement);
        }
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.catalog-item:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ============================================================================
// Reset Catalog Selection with Hold-Down Countdown
// ============================================================================

let resetCatalogsCountdownInterval = null;
let resetCatalogsStartTime = null;
const RESET_CATALOGS_HOLD_DURATION = 3000; // 3 seconds in milliseconds

function startResetCatalogsCountdown() {
    const btn = document.getElementById('reset-catalogs-btn');

    // Prevent multiple countdowns
    if (resetCatalogsCountdownInterval) {
        return;
    }

    resetCatalogsStartTime = Date.now();
    btn.classList.add('terminating', 'pulsating');

    // Update button text and animation every 100ms
    resetCatalogsCountdownInterval = setInterval(() => {
        const elapsed = Date.now() - resetCatalogsStartTime;
        const remaining = RESET_CATALOGS_HOLD_DURATION - elapsed;
        const secondsRemaining = Math.ceil(remaining / 1000);

        if (remaining <= 0) {
            // Countdown complete - perform reset
            clearInterval(resetCatalogsCountdownInterval);
            resetCatalogsCountdownInterval = null;
            performResetCatalogs();
        } else {
            // Update button text
            btn.textContent = `Resetting in ${secondsRemaining}...`;

            // Update animation based on progress
            const progress = elapsed / RESET_CATALOGS_HOLD_DURATION;
            updateResetCatalogsAnimation(btn, progress);
        }
    }, 100);
}

function cancelResetCatalogsCountdown() {
    if (resetCatalogsCountdownInterval) {
        clearInterval(resetCatalogsCountdownInterval);
        resetCatalogsCountdownInterval = null;
        resetCatalogsStartTime = null;

        const btn = document.getElementById('reset-catalogs-btn');
        btn.textContent = 'Reset Catalogs';
        btn.classList.remove('terminating', 'pulsating');
        btn.style.removeProperty('--pulse-duration');
    }
}

function updateResetCatalogsAnimation(btn, progress) {
    // Smoothly transition animation speed from 2s (slow) to 0.25s (very fast)
    // Using an exponential curve for more dramatic acceleration
    const minDuration = 0.25; // seconds (very fast)
    const maxDuration = 2.0;  // seconds (slow)

    // Exponential easing: starts slow, accelerates dramatically near the end
    const easedProgress = Math.pow(progress, 2);
    const duration = maxDuration - (easedProgress * (maxDuration - minDuration));

    // Set CSS variable for smooth animation speed transition
    btn.style.setProperty('--pulse-duration', `${duration}s`);
}

async function performResetCatalogs() {
    const btn = document.getElementById('reset-catalogs-btn');
    btn.textContent = 'Resetting...';
    btn.classList.remove('pulsating');
    btn.disabled = true;

    await resetCatalogSelections();

    // Reset button state
    btn.textContent = 'Reset Catalogs';
    btn.disabled = false;
    btn.classList.remove('terminating');
    btn.style.removeProperty('--pulse-duration');
}

async function resetCatalogSelections() {
    try {
        showNotification('Resetting catalog selections...', 'info');

        // Call API to reset catalog selections
        const response = await fetch('/api/catalogs/reset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            // Clear ALL frontend state FIRST
            loadedCatalogs = [];
            catalogsLoaded = false;

            // Clear the catalog list UI
            document.getElementById('catalog-list').innerHTML = '';
            document.getElementById('catalog-list-container').style.display = 'none';
            document.getElementById('select-all-btn').style.display = 'none';
            document.getElementById('deselect-all-btn').style.display = 'none';

            // Update button text back to "Load Catalogs"
            updateLoadCatalogsButtonText();

            showNotification('Catalog selections reset successfully!', 'success');

            // Now reload catalogs fresh from the API with default order and all enabled
            await loadCatalogs();
        } else {
            showNotification(data.error || 'Failed to reset catalog selections', 'error');
        }
    } catch (error) {
        console.error('Error resetting catalog selections:', error);
        showNotification('Error resetting catalog selections', 'error');
    }
}

// ============================================================================
// Save Catalog Selection with Auto-save and Debouncing
// ============================================================================

// Debounced auto-save function
function autoSaveCatalogSelection() {
    // Clear any existing timeout
    if (catalogSaveTimeout) {
        clearTimeout(catalogSaveTimeout);
    }

    // Set new timeout for 2 seconds
    catalogSaveTimeout = setTimeout(() => {
        saveCatalogSelectionSilent();
    }, 2000);
}

async function saveCatalogSelectionSilent() {
    try {
        // Update order based on DOM
        const items = document.querySelectorAll('.catalog-item');
        items.forEach((item, index) => {
            const catalogId = item.dataset.catalogId;
            const catalog = loadedCatalogs.find(c => c.id === catalogId);
            if (catalog) {
                catalog.order = index;
            }
        });

        const response = await fetch('/api/catalogs/selection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ catalogs: loadedCatalogs })
        });

        const data = await response.json();

        if (data.success) {
            updateStartNowButtonState();
            showSaveNotification();

            // Mark catalog-selection as configured for smart collapse behavior
            localStorage.setItem('catalog-selection-configured', 'true');
        } else {
            console.error('Failed to auto-save catalog selection:', data.error);
        }
    } catch (error) {
        console.error('Error auto-saving catalog selection:', error);
    }
}

// Legacy function kept for backward compatibility (if needed elsewhere)
async function saveCatalogSelection() {
    await saveCatalogSelectionSilent();
    showNotification('Catalog selection saved successfully', 'success');
}

// ============================================================================
// Schedule Management
// ============================================================================

// ============================================================================
// Job Status and Control
// ============================================================================

async function loadJobStatus(caller = 'unknown') {
    try {
        addDebugLog(`📡 [FETCH STATUS] Fetching from: ${caller}`);
        const response = await fetch('/api/job/status');
        const data = await response.json();

        if (data.success) {
            addDebugLog(`📡 [FETCH STATUS] Got status: ${data.status.status} (from: ${caller})`);
            updateJobStatusUI(data.status, `loadJobStatus(${caller})`);
        } else {
            addDebugLog(`📡 [FETCH STATUS] API returned success=false (from: ${caller})`);
        }
    } catch (error) {
        addDebugLog(`📡 [FETCH STATUS] ERROR from ${caller}: ${error.message}`);
        console.error('Error loading job status:', error);
    }
}

function updateJobStatusUI(status, caller = 'unknown') {
    addDebugLog(`🔄 [UI UPDATE] ═══════════════════════════════════════════`);
    addDebugLog(`🔄 [UI UPDATE] Called from: ${caller}`);
    addDebugLog(`🔄 [UI UPDATE] Status: ${status.status}`);
    addDebugLog(`🔄 [UI UPDATE] Timestamp: ${Date.now()}`);
    logStatusScreens();

    // Check if this completion was already dismissed
    const dismissedCompletionId = localStorage.getItem('dismissed-completion-id');
    currentCompletionId = status.start_time; // Use start time as unique ID (set global)
    addDebugLog(`[DISMISS CHECK] dismissedCompletionId from localStorage: ${dismissedCompletionId}`);
    addDebugLog(`[DISMISS CHECK] currentCompletionId set to: ${currentCompletionId}`);
    addDebugLog(`[DISMISS CHECK] Global currentCompletionId is now: ${window.currentCompletionId || currentCompletionId}`);

    // If completion screen is locked, don't allow status changes to hide it
    // unless we're explicitly showing completion again or user dismissed it
    if (completionScreenLocked && status.status !== 'completed') {
        addDebugLog(`    Completion screen locked, status != completed, RETURNING EARLY`);
        return;
    }

    // Treat 'cancelled' status as 'completed' for UI purposes (show results)
    const isCompleted = status.status === 'completed' || status.status === 'cancelled';
    addDebugLog(`    isCompleted=${isCompleted}`);

    // If this completion was dismissed, show idle instead
    addDebugLog(`[DISMISS CHECK] isCompleted: ${isCompleted}`);
    addDebugLog(`[DISMISS CHECK] Comparing: "${dismissedCompletionId}" === "${String(currentCompletionId)}"`);
    addDebugLog(`[DISMISS CHECK] Match result: ${dismissedCompletionId === String(currentCompletionId)}`);
    if (isCompleted && dismissedCompletionId === String(currentCompletionId)) {
        addDebugLog(`[DISMISS CHECK] ✅ MATCH! Completion was dismissed, changing status to idle`);
        status = { status: 'idle' };
    } else if (isCompleted) {
        addDebugLog(`[DISMISS CHECK] No match - showing completion screen`);
    }

    // Clear termination flag when completion screen is shown
    if (isCompleted && jobTerminationRequested) {
        addDebugLog(`    Clearing termination flag`);
        jobTerminationRequested = false;
        // Continue to show completion screen with partial results
    }

    // Save termination status before normalizing (for completion screen title)
    const wasTerminated = status.status === 'cancelled';

    // Normalize cancelled to completed for display
    if (status.status === 'cancelled') {
        addDebugLog(`    ═══════════════════════════════════════════════════════════`);
        addDebugLog(`    🔴 [CANCELLED] Job was CANCELLED/TERMINATED`);
        addDebugLog(`    🔴 [CANCELLED] Full status object: ${JSON.stringify(status, null, 2)}`);
        addDebugLog(`    🔴 [CANCELLED] status.summary exists? ${!!status.summary}`);
        if (status.summary) {
            addDebugLog(`    🔴 [CANCELLED] status.summary.timing: ${JSON.stringify(status.summary.timing, null, 2)}`);
            addDebugLog(`    🔴 [CANCELLED] status.summary.statistics: ${JSON.stringify(status.summary.statistics, null, 2)}`);
            addDebugLog(`    🔴 [CANCELLED] status.summary.processed_catalogs: ${JSON.stringify(status.summary.processed_catalogs, null, 2)}`);
        } else {
            addDebugLog(`    🔴 [CANCELLED] ❌ NO SUMMARY DATA AVAILABLE!`);
        }
        addDebugLog(`    🔴 [CANCELLED] Normalizing status from 'cancelled' to 'completed'`);
        addDebugLog(`    ═══════════════════════════════════════════════════════════`);
        status.status = 'completed';
    }

    // Determine which screen to show
    const targetScreenId = `status-${status.status}`;
    const targetScreen = document.getElementById(targetScreenId);

    // Check if target screen is already visible
    const isTargetAlreadyVisible = targetScreen && targetScreen.style.display === 'block';

    if (isTargetAlreadyVisible) {
        addDebugLog(`🔄 [UI UPDATE] Target screen '${targetScreenId}' already visible - skipping hide/show`);
        addDebugLog(`🔄 [UI UPDATE] Updating content for already-visible screen...`);
    } else {
        // Hide all status displays
        addDebugLog(`🔄 [UI UPDATE] Hiding all status displays...`);
        const screensBeforeHide = [];
        document.querySelectorAll('.status-display').forEach(box => {
            if (box.style.display === 'block') {
                screensBeforeHide.push(box.id);
            }
            box.style.display = 'none';
        });
        if (screensBeforeHide.length > 0) {
            addDebugLog(`🔄 [UI UPDATE] Hidden screens: ${screensBeforeHide.join(', ')}`);
        }
        logStatusScreens();
    }

    // Show appropriate status display
    addDebugLog(`🔄 [UI UPDATE] Final status to display: ${status.status}`);
    if (status.status === 'idle') {
        if (!isTargetAlreadyVisible) {
            addDebugLog(`🔄 [UI UPDATE] ✅ Showing IDLE screen`);
            document.getElementById('status-idle').style.display = 'block';
            logStatusScreens();
        }
        completionScreenLocked = false; // Unlock when returning to idle

        // Re-enable Start Now button when returning to idle
        const startBtn = document.getElementById('start-now-btn');
        if (startBtn) {
            startBtn.disabled = false;
        }
    } else if (status.status === 'scheduled') {
        const scheduledDisplay = document.getElementById('status-scheduled');
        if (scheduledDisplay) {
            if (!isTargetAlreadyVisible) {
                addDebugLog(`🔄 [UI UPDATE] ✅ Showing SCHEDULED screen`);
                scheduledDisplay.style.display = 'block';
                logStatusScreens();
            }
            updateNextRunInfo(status);
        }

        // Enable Start Now button for scheduled state
        const startNowBtn = document.getElementById('start-now-btn-scheduled');
        if (startNowBtn) {
            startNowBtn.disabled = false;
        }
    } else if (status.status === 'running') {
        if (!isTargetAlreadyVisible) {
            addDebugLog(`🔄 [UI UPDATE] ✅ Showing RUNNING screen`);
            document.getElementById('status-running').style.display = 'block';
            logStatusScreens();

            // If no progress yet, but we have loaded catalogs, show first enabled catalog immediately
            if ((!status.progress || !status.progress.catalog_name) && loadedCatalogs.length > 0) {
                const firstEnabledCatalog = loadedCatalogs.find(cat => cat.enabled);
                if (firstEnabledCatalog) {
                    const typeCapitalized = firstEnabledCatalog.type ? firstEnabledCatalog.type.charAt(0).toUpperCase() + firstEnabledCatalog.type.slice(1) : '';
                    const displayText = typeCapitalized ? `${firstEnabledCatalog.name} (${typeCapitalized})` : firstEnabledCatalog.name;
                    document.getElementById('current-catalog-name').textContent = displayText;
                    document.querySelector('.current-action').textContent = `Processing ${firstEnabledCatalog.name}`;
                }
            }

            // Reset terminate button to original state (force reset for new job)
            resetTerminateButton(true);
        }

        // Always update progress even if screen already visible
        updateProgressInfo(status.progress);

        // Disable Start Now buttons when running
        const startNowBtns = document.querySelectorAll('[id^="start-now-btn"]');
        startNowBtns.forEach(btn => btn.disabled = true);
    } else if (status.status === 'completed') {
        const completedDisplay = document.getElementById('status-completed');

        if (completedDisplay) {
            if (!isTargetAlreadyVisible) {
                addDebugLog(`🔄 [UI UPDATE] ✅ Showing COMPLETED screen`);
                completedDisplay.style.display = 'block';
                logStatusScreens();
            }
            completionScreenLocked = true;

            if (status.summary) {
                try {
                    addDebugLog(`📊 [COMPLETION STATS] ═══════════════════════════════════════`);
                    addDebugLog(`📊 [COMPLETION STATS] Starting to populate completion screen...`);

                    // Set title and subtitle based on termination status
                    const titleElement = document.getElementById('completion-title');
                    const subtitleElement = document.getElementById('completion-subtitle');

                    if (wasTerminated) {
                        titleElement.textContent = 'Prefetch Terminated';
                        subtitleElement.textContent = 'Job was terminated by user';
                    } else {
                        titleElement.textContent = 'Prefetch Complete!';
                        subtitleElement.textContent = 'All operations completed successfully';
                    }

                    // WORKAROUND: Backend doesn't populate timing on cancellation, construct it ourselves
                    let timing = status.summary.timing || {};
                    if (!timing.start_time && status.start_time) {
                        addDebugLog(`📊 [COMPLETION STATS] ⚠️ timing missing, constructing from top-level fields`);
                        timing = {
                            start_time: status.start_time,
                            end_time: status.end_time,
                            total_duration: status.end_time - status.start_time,
                            processing_duration: status.end_time - status.start_time
                        };
                        addDebugLog(`📊 [COMPLETION STATS] Constructed timing: ${JSON.stringify(timing)}`);
                    }

                    // WORKAROUND: Use progress data as fallback if summary stats are missing/zero
                    let stats = status.summary.statistics || {};
                    if (status.progress && (stats.movies_prefetched === 0 && status.progress.movies_prefetched > 0)) {
                        addDebugLog(`📊 [COMPLETION STATS] ⚠️ Summary stats are zero but progress has data - using progress as fallback`);
                        stats = {
                            ...stats,
                            movies_prefetched: status.progress.movies_prefetched || 0,
                            series_prefetched: status.progress.series_prefetched || 0,
                            episodes_prefetched: status.progress.episodes_prefetched || 0,
                            items_from_cache: status.progress.cached_count || 0
                        };
                        addDebugLog(`📊 [COMPLETION STATS] Merged stats with progress: ${JSON.stringify(stats)}`);
                    }

                    addDebugLog(`📊 [COMPLETION STATS] timing object: ${JSON.stringify(timing)}`);
                    addDebugLog(`📊 [COMPLETION STATS] stats object: ${JSON.stringify(stats)}`);

                    // Timing
                    const formatTime = (ts) => formatCustomDateTime(ts);

                    const setEl = (id, val) => {
                        const el = document.getElementById(id);
                        addDebugLog(`📊 [COMPLETION STATS] Setting ${id} = "${val}" (element exists: ${!!el})`);
                        if (el) el.textContent = val;
                    };

                    addDebugLog(`📊 [COMPLETION STATS] ─── Populating TIMING fields ───`);
                    setEl('completion-start-time', formatTime(timing.start_time));
                    setEl('completion-end-time', formatTime(timing.end_time));
                    setEl('completion-total-duration', formatDuration(timing.total_duration));
                    setEl('completion-processing-time', formatDuration(timing.processing_duration));

                    // Statistics
                    addDebugLog(`📊 [COMPLETION STATS] ─── Populating STATISTICS fields ───`);
                    setEl('completion-catalogs', stats.filtered_catalogs || 0);
                    setEl('completion-movies', stats.movies_prefetched || 0);
                    setEl('completion-series', stats.series_prefetched || 0);
                    setEl('completion-episodes', stats.episodes_prefetched || 0);
                    setEl('completion-pages', stats.total_pages_fetched || 0);
                    setEl('completion-cached', stats.items_from_cache || 0);

                    const successRate = stats.cache_requests_made > 0
                        ? `${Math.round((stats.cache_requests_successful / stats.cache_requests_made) * 100)}%`
                        : '-';
                    addDebugLog(`📊 [COMPLETION STATS] Success rate calculation: ${stats.cache_requests_successful}/${stats.cache_requests_made} = ${successRate}`);
                    setEl('completion-success-rate', successRate);

                    // Rates
                    addDebugLog(`📊 [COMPLETION STATS] ─── Populating PROCESSING RATES ───`);
                    const procMins = (timing.processing_duration || 1) / 60;
                    addDebugLog(`📊 [COMPLETION STATS] Processing minutes: ${procMins.toFixed(2)}`);

                    const movieRate = (stats.movies_prefetched / procMins).toFixed(1);
                    const seriesRate = (stats.episodes_prefetched / procMins).toFixed(1);
                    const overallRate = ((stats.movies_prefetched + stats.series_prefetched) / procMins).toFixed(1);

                    setEl('completion-movie-rate', movieRate);
                    setEl('completion-series-rate', seriesRate);
                    setEl('completion-overall-rate', overallRate);

                    // Catalog Details Table
                    addDebugLog(`📊 [COMPLETION STATS] ─── Populating CATALOG DETAILS TABLE ───`);
                    let catalogs = status.summary.processed_catalogs || [];

                    // WORKAROUND: If no processed catalogs but we have progress with catalog name, create a row
                    if (catalogs.length === 0 && status.progress && status.progress.catalog_name) {
                        addDebugLog(`📊 [COMPLETION STATS] ⚠️ No processed_catalogs but progress has catalog_name - creating synthetic row`);
                        const syntheticCatalog = {
                            name: status.progress.catalog_name,
                            type: status.progress.catalog_mode || 'movie',
                            duration: timing.processing_duration || 0,
                            success_count: status.progress.movies_prefetched || 0,
                            failed_count: 0,
                            cached_count: status.progress.cached_count || 0
                        };
                        catalogs = [syntheticCatalog];
                        addDebugLog(`📊 [COMPLETION STATS] Created synthetic catalog: ${JSON.stringify(syntheticCatalog)}`);
                    }

                    addDebugLog(`📊 [COMPLETION STATS] Number of processed catalogs: ${catalogs.length}`);
                    addDebugLog(`📊 [COMPLETION STATS] Catalogs array: ${JSON.stringify(catalogs, null, 2)}`);

                    const tbody = document.getElementById('catalog-details-tbody');
                    if (tbody && catalogs.length > 0) {
                        addDebugLog(`📊 [COMPLETION STATS] Table body found, clearing and populating...`);
                        tbody.innerHTML = '';
                        catalogs.forEach((cat, idx) => {
                            const row = tbody.insertRow();
                            const total = (cat.success_count || 0) + (cat.failed_count || 0) + (cat.cached_count || 0);
                            const typeCapitalized = cat.type ? cat.type.charAt(0).toUpperCase() + cat.type.slice(1) : '-';
                            addDebugLog(`📊 [COMPLETION STATS] Row ${idx}: ${cat.name} (${cat.type}) - ${total} items`);
                            row.innerHTML = `
                                <td>${cat.name || '-'}</td>
                                <td><span class="catalog-type-badge">${typeCapitalized}</span></td>
                                <td>${formatDuration(cat.duration)}</td>
                                <td>${cat.success_count || 0}</td>
                                <td>${cat.failed_count || 0}</td>
                                <td>${cat.cached_count || 0}</td>
                                <td>${total}</td>
                            `;
                        });
                        addDebugLog(`📊 [COMPLETION STATS] ✅ Table populated with ${catalogs.length} rows`);
                    } else {
                        addDebugLog(`📊 [COMPLETION STATS] ❌ Table body not found or no catalogs (tbody exists: ${!!tbody}, catalogs.length: ${catalogs.length})`);
                    }

                    addDebugLog(`📊 [COMPLETION STATS] ✅ COMPLETED populating all stats`);
                    addDebugLog(`📊 [COMPLETION STATS] ═══════════════════════════════════════`);
                } catch (error) {
                    addDebugLog(`📊 [COMPLETION STATS] ❌❌❌ ERROR: ${error.message}`);
                    addDebugLog(`📊 [COMPLETION STATS] Stack trace: ${error.stack}`);
                    console.error('Error populating completion stats:', error);
                }
            } else {
                addDebugLog(`📊 [COMPLETION STATS] ❌❌❌ NO SUMMARY DATA - Cannot populate stats!`);
            }
        }
    } else if (status.status === 'failed') {
        const failedDisplay = document.getElementById('status-failed');
        if (failedDisplay) {
            if (!isTargetAlreadyVisible) {
                addDebugLog(`🔄 [UI UPDATE] ✅ Showing FAILED screen`);
                failedDisplay.style.display = 'block';
                logStatusScreens();
            }

            // Populate error details
            const errorMessage = document.getElementById('error-message');
            const errorTimestamp = document.getElementById('error-timestamp');

            if (errorMessage && status.error) {
                errorMessage.textContent = status.error;
            }

            if (errorTimestamp && status.end_time) {
                errorTimestamp.textContent = `Failed at ${formatCustomDateTime(status.end_time)}`;
            }
        }
    }

    // Disable config changes if running
    const isRunning = status.status === 'running';
    const saveConfigBtn = document.getElementById('save-config-btn');
    if (saveConfigBtn) {
        saveConfigBtn.disabled = isRunning;
    }

    addDebugLog(`    updateJobStatusUI: EXIT`);
    logStatusScreens();
}

function updateNextRunInfo(status) {
    if (status.next_run_time) {
        nextRunTimestamp = new Date(status.next_run_time).getTime();

        // Clear existing countdown
        if (countdownInterval) {
            clearInterval(countdownInterval);
        }

        // Start countdown
        updateCountdown();
        countdownInterval = setInterval(updateCountdown, 1000);

        const nextRunTimestamp = new Date(status.next_run_time).getTime() / 1000;
        document.getElementById('next-run-info').innerHTML = `
            Next scheduled run: ${formatCustomDateTime(nextRunTimestamp)}
        `;
    }
}

function updateProgressInfo(progress) {
    if (!progress || Object.keys(progress).length === 0) {
        // Reset to starting state
        document.getElementById('stat-movies').textContent = '0';
        document.getElementById('stat-movies-limit').textContent = 'of ∞';
        document.getElementById('stat-series').textContent = '0';
        document.getElementById('stat-series-limit').textContent = 'of ∞';
        document.getElementById('stat-episodes').textContent = '0';
        document.getElementById('stat-cached').textContent = '0';

        document.getElementById('overall-progress-fill').style.width = '0%';
        document.getElementById('overall-progress-percent').textContent = '0%';
        document.getElementById('overall-progress-label').textContent = '0 of 0 catalogs';

        document.getElementById('catalog-progress-fill').style.width = '0%';
        document.getElementById('catalog-progress-percent').textContent = '0%';
        document.getElementById('catalog-progress-label').textContent = '0 of 0 items';

        document.getElementById('current-catalog-name').textContent = '-';
        document.querySelector('.current-action').textContent = 'Starting...';

        // Hide page fetch status
        document.getElementById('page-fetch-status').style.display = 'none';
        return;
    }

    // Update stat cards
    const moviesPrefetched = progress.movies_prefetched || 0;
    const moviesLimit = progress.movies_limit || -1;
    const seriesPrefetched = progress.series_prefetched || 0;
    const seriesLimit = progress.series_limit || -1;
    const episodesPrefetched = progress.episodes_prefetched || 0;
    const cachedCount = progress.cached_count || 0;

    document.getElementById('stat-movies').textContent = moviesPrefetched;
    document.getElementById('stat-movies-limit').textContent = moviesLimit === -1 ? 'of ∞' : `of ${moviesLimit}`;

    document.getElementById('stat-series').textContent = seriesPrefetched;
    document.getElementById('stat-series-limit').textContent = seriesLimit === -1 ? 'of ∞' : `of ${seriesLimit}`;

    document.getElementById('stat-episodes').textContent = episodesPrefetched;

    document.getElementById('stat-cached').textContent = cachedCount;

    // Update current action text
    const catalogName = progress.catalog_name || 'Unknown';
    const catalogMode = progress.catalog_mode || '';
    const currentTitle = progress.current_title || '';

    let actionText = `Processing ${catalogName}`;
    if (catalogMode) {
        actionText += ` (${catalogMode})`;
    }
    if (currentTitle) {
        // Parse format: "Prefetching streams for Movie: The Whale (2022)"
        // or "Prefetching streams for Series: Breaking Bad S01E01"
        const match = currentTitle.match(/Prefetching streams for (Movie|Series): (.+)/);
        if (match) {
            const itemType = match[1];
            const titleText = match[2];
            // Format: Title in bold, type on new line in small text
            document.querySelector('.current-action').innerHTML = `<strong>${titleText}</strong><br><small style="font-size: 0.85em; color: var(--text-muted);">${itemType}</small>`;
        } else {
            actionText = `Prefetching: ${currentTitle}`;
            document.querySelector('.current-action').textContent = actionText;
        }
    } else {
        document.querySelector('.current-action').textContent = actionText;
    }

    // Update current catalog name with type
    const catalogType = catalogMode ? catalogMode.charAt(0).toUpperCase() + catalogMode.slice(1) : '';
    const catalogDisplayText = catalogType ? `${catalogName} (${catalogType})` : catalogName;
    document.getElementById('current-catalog-name').textContent = catalogDisplayText;

    // Handle page fetching status
    const pageFetchStatus = document.getElementById('page-fetch-status');
    if (progress.fetching_page) {
        // Show page fetching UI
        pageFetchStatus.style.display = 'flex';
        const pageNum = progress.current_page || 1;
        document.getElementById('current-page-number').textContent = pageNum;

        // Update subtitle based on catalog mode
        const subtitle = catalogMode ? `Discovering ${catalogMode}${catalogMode === 'mixed' ? ' items' : 's'} from catalog...` : 'Discovering items from catalog...';
        document.querySelector('.page-fetch-subtitle').textContent = subtitle;

        // Items discovered will be updated when we get the data
        document.getElementById('page-fetch-items').textContent = 'Loading...';
    } else if (progress.items_on_current_page !== undefined) {
        // Page has been fetched, show discovered items count
        const itemsCount = progress.items_on_current_page || 0;
        const itemWord = itemsCount === 1 ? 'item' : 'items';
        document.getElementById('page-fetch-items').textContent = `${itemsCount} ${itemWord} discovered`;

        // Hide after a brief moment once processing starts
        if (progress.processed_items_on_page > 0) {
            setTimeout(() => {
                pageFetchStatus.style.display = 'none';
            }, 1500);
        }
    } else {
        // Not fetching, hide the status
        pageFetchStatus.style.display = 'none';
    }

    // Calculate and update overall progress
    const completedCatalogs = progress.completed_catalogs || 0;
    const totalCatalogs = progress.total_catalogs || 1;
    const overallPercent = Math.round((completedCatalogs / totalCatalogs) * 100);

    document.getElementById('overall-progress-fill').style.width = `${overallPercent}%`;
    document.getElementById('overall-progress-percent').textContent = `${overallPercent}%`;
    document.getElementById('overall-progress-label').textContent = `${completedCatalogs} of ${totalCatalogs} catalogs`;

    // Calculate and update current catalog progress
    const currentItems = progress.current_catalog_items || 0;
    const currentLimit = progress.current_catalog_limit || -1;

    let catalogPercent = 0;
    let catalogLabel = '';

    if (currentLimit === -1) {
        // Unlimited - just show count
        catalogLabel = `${currentItems} of ∞ items`;
        catalogPercent = 0; // Don't fill bar for unlimited
    } else if (currentLimit > 0) {
        catalogPercent = Math.round((currentItems / currentLimit) * 100);
        catalogLabel = `${currentItems} of ${currentLimit} items`;
    } else {
        catalogLabel = '0 of 0 items';
    }

    document.getElementById('catalog-progress-fill').style.width = `${catalogPercent}%`;
    document.getElementById('catalog-progress-percent').textContent = `${catalogPercent}%`;
    document.getElementById('catalog-progress-label').textContent = catalogLabel;
}

function updateStartNowButtonState() {
    const buttons = document.querySelectorAll('[id^="start-now-btn"]');
    const errors = validatePrefetchStart();

    buttons.forEach(btn => {
        if (errors.length > 0) {
            btn.disabled = true;
            btn.title = errors.join('; ');
        } else {
            btn.disabled = false;
            btn.title = '';
        }
    });
}

async function runJob() {
    // Validate before starting
    const validationErrors = validatePrefetchStart();
    if (validationErrors.length > 0) {
        showNotification(`Cannot start prefetch:\n${validationErrors.join('\n')}`, 'error');
        return;
    }

    try {
        const response = await fetch('/api/job/run', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showNotification('Job started successfully', 'success');

            // Mark that a prefetch job has been run for smart collapse behavior
            localStorage.setItem('has-run-prefetch-job', 'true');

            // Clear any dismissed completion from previous job
            const oldDismissedId = localStorage.getItem('dismissed-completion-id');
            addDebugLog(`[NEW JOB] Starting new job - clearing old dismissed completion ID: ${oldDismissedId}`);
            localStorage.removeItem('dismissed-completion-id');
            addDebugLog(`[NEW JOB] localStorage 'dismissed-completion-id' cleared`);

            // Clear termination flag when starting new job
            jobTerminationRequested = false;

            // Unlock completion screen if it was locked
            completionScreenLocked = false;

            // Immediately show the first selected catalog name for instant feedback
            const selectedCatalogs = loadedCatalogs.filter(cat => cat.enabled);
            if (selectedCatalogs.length > 0) {
                const firstCatalog = selectedCatalogs[0];
                const typeCapitalized = firstCatalog.type ? firstCatalog.type.charAt(0).toUpperCase() + firstCatalog.type.slice(1) : '';
                const displayText = typeCapitalized ? `${firstCatalog.name} (${typeCapitalized})` : (firstCatalog.name || 'Starting...');
                document.getElementById('current-catalog-name').textContent = displayText;
                document.querySelector('.current-action').textContent = `Starting ${firstCatalog.name}...`;
            }

            // Immediately refresh job status to update UI multiple times
            addDebugLog(`⏰ [POLLING] Starting status polls after job start...`);
            loadJobStatus('runJob-immediate');
            setTimeout(() => {
                addDebugLog(`⏰ [POLLING] 200ms poll`);
                loadJobStatus('runJob-200ms');
            }, 200);
            setTimeout(() => {
                addDebugLog(`⏰ [POLLING] 500ms poll`);
                loadJobStatus('runJob-500ms');
            }, 500);
            setTimeout(() => {
                addDebugLog(`⏰ [POLLING] 1000ms poll`);
                loadJobStatus('runJob-1000ms');
            }, 1000);
        } else{
            showNotification(data.error || 'Failed to start job', 'error');
        }
    } catch (error) {
        console.error('Error starting job:', error);
        showNotification('Error starting job', 'error');
    }
}

// terminateJob() has been replaced with hold-down countdown pattern
// See startTerminateCountdown() and performTerminate() functions above

function dismissCompletion() {
    addDebugLog(`[DISMISS] dismissCompletion() called`);
    addDebugLog(`[DISMISS] currentCompletionId value: ${currentCompletionId}`);

    // Store the dismissed completion ID so it stays dismissed after refresh
    if (currentCompletionId) {
        const idToSave = String(currentCompletionId);
        localStorage.setItem('dismissed-completion-id', idToSave);
        addDebugLog(`[DISMISS] ✅ Saved to localStorage: "${idToSave}"`);
        addDebugLog(`[DISMISS] Verification - reading back from localStorage: "${localStorage.getItem('dismissed-completion-id')}"`);
    } else {
        addDebugLog(`[DISMISS] ❌ WARNING: currentCompletionId is null/undefined! Nothing saved.`);
    }

    // Unlock the completion screen before dismissing
    completionScreenLocked = false;
    addDebugLog(`[DISMISS] Unlocked completion screen, calling updateJobStatusUI with idle`);
    // Hide completion screen and show idle/ready state
    updateJobStatusUI({ status: 'idle' }, 'dismissCompletion');
}

function dismissError() {
    addDebugLog(`[ERROR DISMISS] dismissError() called`);
    // Hide error screen and show idle/ready state
    updateJobStatusUI({ status: 'idle' }, 'dismissError');
}

// ============================================================================
// Real-time Updates via Server-Sent Events (SSE)
// ============================================================================

function connectEventSource() {
    if (eventSource) {
        eventSource.close();
    }

    eventSource = new EventSource('/api/events');

    eventSource.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            handleSSEEvent(data.event, data.data);
        } catch (error) {
            console.error('Error parsing SSE data:', error);
        }
    };

    eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        eventSource.close();

        // Reconnect after 5 seconds
        setTimeout(connectEventSource, 5000);
    };
}

function handleSSEEvent(event, data) {
    switch (event) {
        case 'connected':
            console.log('Connected to event stream');
            break;

        case 'status':
        case 'status_change':
            addDebugLog(`📨 [SSE] Status event: ${event}, status=${data.status}`);
            updateJobStatusUI(data, `SSE-${event}`);
            break;

        case 'progress':
            addDebugLog(`📨 [SSE] Progress event`);
            updateProgressInfo(data);
            break;

        case 'output':
            appendOutput(data.lines);
            break;

        case 'job_complete':
        case 'job_error':
        case 'job_cancelled':
            addDebugLog(`📨 [SSE] ═══════════════════════════════════════════════════════`);
            addDebugLog(`📨 [SSE] Job completion event received: ${event}`);
            addDebugLog(`📨 [SSE] Event data: ${JSON.stringify(data, null, 2)}`);
            addDebugLog(`📨 [SSE] Now fetching full job status via API...`);
            addDebugLog(`📨 [SSE] ═══════════════════════════════════════════════════════`);
            loadJobStatus(`SSE-${event}`);
            break;

        default:
            console.log('Unknown SSE event:', event, data);
    }
}

function appendOutput(lines) {
    const outputContainer = document.getElementById('live-output');
    if (!outputContainer) return;

    lines.forEach(line => {
        if (line.trim()) {
            outputContainer.textContent += line + '\n';
        }
    });

    // Auto-scroll to bottom
    outputContainer.scrollTop = outputContainer.scrollHeight;
}

// ============================================================================
// Tooltip System
// ============================================================================

function initializeTooltips() {
    const infoIcons = document.querySelectorAll('.info-icon');

    infoIcons.forEach(icon => {
        icon.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleTooltip(icon);
        });
    });

    // Close tooltips when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.classList.contains('info-icon') && !e.target.closest('.info-tooltip')) {
            closeAllTooltips();
        }
    });
}

function toggleTooltip(icon) {
    const existingTooltip = document.querySelector('.info-tooltip');

    if (existingTooltip) {
        // Close existing tooltip
        existingTooltip.remove();
    } else {
        // Close all other tooltips first
        closeAllTooltips();

        // Create and show tooltip
        const tooltipText = icon.getAttribute('data-tooltip');
        if (tooltipText) {
            const tooltip = document.createElement('div');
            tooltip.className = 'info-tooltip active';
            tooltip.innerHTML = `
                <button class="tooltip-close" onclick="event.stopPropagation(); this.parentElement.remove();">×</button>
                ${tooltipText}
            `;
            document.body.appendChild(tooltip);

            // Position the tooltip
            const iconRect = icon.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const gap = 12;

            // Calculate if there's enough space below
            const spaceBelow = viewportHeight - iconRect.bottom;
            const spaceAbove = iconRect.top;

            let top, left;

            if (spaceBelow >= tooltipRect.height + gap) {
                // Position below
                tooltip.classList.add('below');
                top = iconRect.bottom + gap;
            } else if (spaceAbove >= tooltipRect.height + gap) {
                // Position above
                tooltip.classList.add('above');
                top = iconRect.top - tooltipRect.height - gap;
            } else {
                // Not enough space either way, position below and let it scroll
                tooltip.classList.add('below');
                top = iconRect.bottom + gap;
            }

            // Center horizontally relative to icon
            left = iconRect.left + (iconRect.width / 2) - (tooltipRect.width / 2);

            // Ensure tooltip doesn't go off-screen horizontally
            if (left < 10) left = 10;
            if (left + tooltipRect.width > window.innerWidth - 10) {
                left = window.innerWidth - tooltipRect.width - 10;
            }

            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
        }
    }
}

function closeAllTooltips() {
    const tooltips = document.querySelectorAll('.info-tooltip');
    tooltips.forEach(tooltip => tooltip.remove());
}

// ============================================================================
// Completion Stats Population
// ============================================================================


function populateCompletionStats(summary, startTime, endTime) {
    // SHOW DEBUG INFO VISIBLY ON PAGE - APPEND not replace
    let debugContent = document.getElementById('debug-content');

    // Function to safely add debug message
    const addDebug = (msg) => {
        const dc = document.getElementById('debug-content');
        if (dc) {
            dc.textContent += msg;
        }
    };

    addDebug(`\n\n--- populateCompletionStats ENTRY ---`);

    if (!summary) {
        addDebug(`\nERROR: summary is ${summary}`);
        return;
    }

    addDebug(`\nSummary exists: YES
Summary type: ${typeof summary}
Has timing: ${summary.timing ? 'YES' : 'NO'}
Has statistics: ${summary.statistics ? 'YES' : 'NO'}
stats.series_prefetched: ${summary.statistics?.series_prefetched}
stats.episodes_prefetched: ${summary.statistics?.episodes_prefetched}
timing.total_duration: ${summary.timing?.total_duration}
Summary keys: ${Object.keys(summary).join(', ')}`);

    const timing = summary.timing || {};
    const stats = summary.statistics || {};
    const catalogs = summary.processed_catalogs || [];

    addDebug(`\n\nAfter extraction:
timing keys: ${Object.keys(timing).join(', ')}
stats keys: ${Object.keys(stats).join(', ')}
stats.series_prefetched: ${stats.series_prefetched}
stats.episodes_prefetched: ${stats.episodes_prefetched}`);

    // Format helper functions
    const formatTime = (timestamp) => formatCustomDateTime(timestamp);

    // Populate Timing Overview
    document.getElementById('completion-start-time').textContent = formatTime(timing.start_time);
    document.getElementById('completion-end-time').textContent = formatTime(timing.end_time);
    document.getElementById('completion-total-duration').textContent = formatDuration(timing.total_duration);
    document.getElementById('completion-processing-time').textContent = formatDuration(timing.processing_duration);

    // Populate Statistics
    const catalogsProcessed = stats.filtered_catalogs || catalogs.length || 0;
    const moviesCount = stats.movies_prefetched || 0;
    const seriesCount = stats.series_prefetched || 0;
    const episodesCount = stats.episodes_prefetched || 0;
    const pagesCount = stats.total_pages_fetched || 0;
    const cachedCount = stats.items_from_cache || 0;
    const successfulCount = stats.cache_requests_successful || 0;
    const totalRequests = stats.cache_requests_made || 0;
    const successRate = totalRequests > 0 ? ((successfulCount / totalRequests) * 100).toFixed(1) : 0;

    document.getElementById('completion-catalogs').textContent = catalogsProcessed;
    document.getElementById('completion-movies').textContent = moviesCount;
    document.getElementById('completion-series').textContent = seriesCount;
    document.getElementById('completion-episodes').textContent = episodesCount;
    document.getElementById('completion-pages').textContent = pagesCount;
    document.getElementById('completion-cached').textContent = cachedCount;
    document.getElementById('completion-success-rate').textContent = `${successRate}%`;

    // Populate Processing Rates
    const processingDuration = timing.processing_duration || 0;
    if (processingDuration > 0) {
        const durationMinutes = processingDuration / 60;
        const movieRate = (moviesCount / durationMinutes).toFixed(1);
        const episodesRate = (episodesCount / durationMinutes).toFixed(1);
        const totalItems = moviesCount + episodesCount;
        const overallRate = (totalItems / durationMinutes).toFixed(1);

        document.getElementById('completion-movie-rate').textContent = movieRate;
        document.getElementById('completion-series-rate').textContent = episodesRate;
        document.getElementById('completion-overall-rate').textContent = overallRate;
    } else {
        document.getElementById('completion-movie-rate').textContent = '-';
        document.getElementById('completion-series-rate').textContent = '-';
        document.getElementById('completion-overall-rate').textContent = '-';
    }

    // Populate Catalog Details Table
    populateCatalogTable(catalogs);
}

function populateCatalogTable(catalogs) {
    const tbody = document.getElementById('catalog-details-tbody');
    if (!tbody) return;

    // Clear existing rows
    tbody.innerHTML = '';

    if (catalogs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 20px; color: var(--text-muted);">
                    No catalog data available
                </td>
            </tr>
        `;
        return;
    }

    // Sort catalogs by duration (longest first)
    const sortedCatalogs = [...catalogs].sort((a, b) => (b.duration || 0) - (a.duration || 0));

    // Create table rows
    sortedCatalogs.forEach(catalog => {
        const name = catalog.name || 'Unknown';
        const type = (catalog.type || 'mixed').charAt(0).toUpperCase() + (catalog.type || 'mixed').slice(1);
        const duration = catalog.duration ? `${catalog.duration.toFixed(1)}s` : '-';
        const success = catalog.success_count || 0;
        const failed = catalog.failed_count || 0;
        const cached = catalog.cached_count || 0;
        const total = success + failed + cached;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="catalog-name" title="${name}">${name}</td>
            <td>${type}</td>
            <td>${duration}</td>
            <td class="success-count">${success}</td>
            <td class="failed-count">${failed}</td>
            <td class="cached-count">${cached}</td>
            <td>${total}</td>
        `;
        tbody.appendChild(row);
    });
}

// ============================================================================
// LOG VIEWER FUNCTIONS
// ============================================================================

let currentLogFilename = null;

function toggleLogSection() {
    const content = document.getElementById('log-viewer-content');
    const icon = document.getElementById('log-viewer-icon');

    if (content && icon) {
        const isCollapsed = content.classList.contains('collapsed');

        content.classList.toggle('collapsed');
        icon.classList.toggle('collapsed');

        if (isCollapsed) {
            // Expanding - load logs
            loadLogFiles();
        } else {
            // Collapsing - cleanup memory
            cleanupLogViewer();
        }

        // Save state to localStorage
        localStorage.setItem('log-viewer-collapsed', !isCollapsed);
    }
}

function cleanupLogViewer() {
    // Clear all content and reset state
    currentLogFilename = null;

    // Clear list view
    const container = document.getElementById('log-list-container');
    if (container) container.innerHTML = '';

    // Clear content view
    const content = document.getElementById('log-content-text');
    if (content) content.textContent = '';

    const filenameDisplay = document.getElementById('log-filename-display');
    if (filenameDisplay) filenameDisplay.textContent = '';

    // Reset views
    document.getElementById('log-list-view').style.display = 'block';
    document.getElementById('log-content-view').style.display = 'none';

    // Hide loading/empty states and window
    document.getElementById('log-loading').style.display = 'none';
    document.getElementById('log-list-empty').style.display = 'none';
    document.getElementById('log-content-loading').style.display = 'none';
    const logWindow = document.getElementById('log-viewer-window');
    if (logWindow) logWindow.style.display = 'none';
}

function parseLogFilename(filename) {
    // Parse: streams_prefetcher_logs_2025-10-03_16-03-47.txt
    const match = filename.match(/streams_prefetcher_logs_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.txt/);
    if (!match) return null;

    const [, year, month, day, hour, minute, second] = match;

    // Create timestamp in seconds
    const timestamp = new Date(year, month - 1, day, hour, minute, second).getTime() / 1000;

    return {
        time: formatCustomTime(timestamp),
        date: formatCustomDate(timestamp),
        timestamp
    };
}

async function loadLogFiles() {
    const loading = document.getElementById('log-loading');
    const empty = document.getElementById('log-list-empty');
    const container = document.getElementById('log-list-container');

    // Show loading
    loading.style.display = 'block';
    empty.style.display = 'none';
    container.innerHTML = '';

    try {
        const response = await fetch('/api/logs');
        const data = await response.json();

        loading.style.display = 'none';

        if (!data.success) {
            throw new Error(data.error || 'Failed to load log files');
        }

        if (data.logs.length === 0) {
            empty.style.display = 'block';
            return;
        }

        // Render log files (max 8 visible, scrollable)
        data.logs.forEach(log => {
            const parsed = parseLogFilename(log.filename);
            if (!parsed) return;

            const item = document.createElement('div');
            item.className = 'log-item';
            item.onclick = () => viewLogFile(log.filename);

            item.innerHTML = `
                <div class="log-item-info">
                    <div class="log-item-chips">
                        <span class="log-chip log-chip-time">${parsed.time}</span>
                        <span class="log-chip log-chip-date">${parsed.date}</span>
                    </div>
                </div>
            `;

            container.appendChild(item);
        });

    } catch (error) {
        loading.style.display = 'none';
        console.error('Error loading log files:', error);
        container.innerHTML = `<div style="color: #ef4444; padding: 20px; text-align: center;">Error: ${error.message}</div>`;
    }
}

async function viewLogFile(filename) {
    currentLogFilename = filename;

    // Hide list view, show content view
    document.getElementById('log-list-view').style.display = 'none';
    document.getElementById('log-content-view').style.display = 'block';

    const loading = document.getElementById('log-content-loading');
    const content = document.getElementById('log-content-text');
    const filenameDisplay = document.getElementById('log-filename-display');
    const logWindow = document.getElementById('log-viewer-window');

    // Show loading, hide window
    loading.style.display = 'block';
    logWindow.style.display = 'none';
    content.textContent = '';
    filenameDisplay.textContent = filename;

    try {
        const response = await fetch(`/api/logs/${filename}`);
        const data = await response.json();

        loading.style.display = 'none';

        if (!data.success) {
            throw new Error(data.error || 'Failed to load log content');
        }

        content.textContent = data.content;
        logWindow.style.display = 'block';

    } catch (error) {
        loading.style.display = 'none';
        console.error('Error loading log content:', error);
        content.textContent = `Error: ${error.message}`;
        logWindow.style.display = 'block';
    }
}

function backToLogList() {
    currentLogFilename = null;
    document.getElementById('log-content-view').style.display = 'none';
    document.getElementById('log-list-view').style.display = 'block';

    // Reload the list
    loadLogFiles();
}

async function deleteCurrentLog() {
    if (!currentLogFilename) return;

    if (!confirm(`Delete ${currentLogFilename}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/logs/${currentLogFilename}`, {
            method: 'DELETE'
        });
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to delete log file');
        }

        // Go back to list
        backToLogList();

    } catch (error) {
        console.error('Error deleting log file:', error);
        alert(`Error: ${error.message}`);
    }
}

async function deleteAllLogs() {
    if (!confirm('Delete all log files? This cannot be undone.')) {
        return;
    }

    const loading = document.getElementById('log-loading');
    const container = document.getElementById('log-list-container');

    loading.style.display = 'block';
    container.innerHTML = '';

    try {
        const response = await fetch('/api/logs', {
            method: 'DELETE'
        });
        const data = await response.json();

        loading.style.display = 'none';

        if (!data.success) {
            throw new Error(data.error || 'Failed to delete log files');
        }

        // Reload the list
        loadLogFiles();

    } catch (error) {
        loading.style.display = 'none';
        console.error('Error deleting all log files:', error);
        alert(`Error: ${error.message}`);
    }
}
