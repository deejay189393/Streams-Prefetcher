/**
 * Stremio Streams Prefetcher - Frontend Application
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
                        ✏️ Edit
                    </button>
                    <button class="btn-icon delete" onclick="deleteSchedule(${index})" title="Delete">
                        🗑️ Delete
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
            console.log('Schedules auto-saved');
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

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    // Load saved catalog selection first, before loading config
    await loadSavedCatalogSelection();

    // Now load config (which will auto-load catalogs if needed)
    loadConfiguration();
    loadSchedules();
    loadJobStatus();
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
});

function restoreCollapsedStates() {
    // Check if configuration section should be collapsed
    const configCollapsed = localStorage.getItem('configuration-collapsed');
    if (configCollapsed === 'true') {
        const content = document.getElementById('configuration-content');
        const icon = document.getElementById('configuration-icon');
        if (content && icon) {
            content.classList.add('collapsed');
            icon.classList.add('collapsed');
        }
    }
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
}

// ============================================================================
// Notifications
// ============================================================================

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
    const delayValue = config.delay !== undefined ? config.delay : 2;
    document.getElementById('delay-value').value = delayValue;
    document.getElementById('delay-unit').value = '1';

    const cacheValidityValue = config.cache_validity !== undefined ? config.cache_validity : 259200;
    const cacheDays = cacheValidityValue / 86400;
    document.getElementById('cache-validity-value').value = cacheDays;
    document.getElementById('cache-validity-unit').value = '86400';

    // Max execution time - convert from seconds to minutes if >= 60 seconds
    const maxExecSeconds = config.max_execution_time !== undefined ? config.max_execution_time : 5400;
    if (maxExecSeconds === -1) {
        document.getElementById('max-execution-time-value').value = 90;
        document.getElementById('max-execution-time-unit').value = '60';
        document.getElementById('max-execution-time-unlimited').checked = true;
    } else if (maxExecSeconds >= 60) {
        // Convert to minutes if 60 seconds or more
        document.getElementById('max-execution-time-value').value = maxExecSeconds / 60;
        document.getElementById('max-execution-time-unit').value = '60';
        document.getElementById('max-execution-time-unlimited').checked = false;
    } else {
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

    // Render each URL
    addonUrls.forEach((item, index) => {
        const container = document.getElementById(`addon-list-${item.type}`);
        const itemDiv = createAddonUrlItem(item.url, item.type, index);
        container.appendChild(itemDiv);
    });
}

function createAddonUrlItem(url, type, index) {
    const div = document.createElement('div');
    div.className = 'addon-item';
    div.draggable = true;
    div.dataset.type = type;
    div.dataset.index = index;

    div.innerHTML = `
        <span class="drag-handle">⋮⋮</span>
        <input type="text" value="${url}" placeholder="https://addon.example.com">
        <button class="remove-btn" onclick="removeAddonUrl(this)">×</button>
    `;

    setupAddonDragDrop(div);

    return div;
}

function addAddonUrl(type) {
    const container = document.getElementById(`addon-list-${type}`);
    const index = container.children.length;
    const itemDiv = createAddonUrlItem('', type, index);
    container.appendChild(itemDiv);
    autoSaveConfiguration();
}

function removeAddonUrl(btn) {
    btn.closest('.addon-item').remove();
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

    // Cache validity must be positive or -1
    if (config.cache_validity < -1 || config.cache_validity === 0) {
        errors.push('Cache validity must be positive or -1 for unlimited');
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
            delay: parseFloat(document.getElementById('delay-value').value) * parseFloat(document.getElementById('delay-unit').value),
            cache_validity: parseFloat(document.getElementById('cache-validity-value').value) * parseFloat(document.getElementById('cache-validity-unit').value),
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
            console.log('Configuration auto-saved');
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
            delay: parseFloat(document.getElementById('delay-value').value) * parseFloat(document.getElementById('delay-unit').value),
            cache_validity: parseFloat(document.getElementById('cache-validity-value').value) * parseFloat(document.getElementById('cache-validity-unit').value),
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

async function resetConfiguration() {
    if (!confirm('⚠️ WARNING: This will reset ALL configuration settings to defaults and clear all saved data including:\n\n• All addon URLs\n• All configuration parameters\n• All catalog selections and ordering\n• Schedule settings\n\nThis action cannot be undone. Are you sure you want to continue?')) {
        return;
    }

    const btn = document.getElementById('reset-config-btn');
    btn.disabled = true;
    btn.textContent = 'Resetting...';

    try {
        const response = await fetch('/api/config/reset', {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Configuration reset to defaults successfully', 'success');

            // Reload the page to show default values
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            showNotification(data.error || 'Failed to reset configuration', 'error');
            btn.disabled = false;
            btn.textContent = 'Reset to Defaults';
        }
    } catch (error) {
        console.error('Error resetting configuration:', error);
        showNotification('Error resetting configuration', 'error');
        btn.disabled = false;
        btn.textContent = 'Reset to Defaults';
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
        btn.innerHTML = '<span class="spinner"></span>Loading Catalogs...';
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
            // Silent save - no notification
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

async function loadJobStatus() {
    try {
        const response = await fetch('/api/job/status');
        const data = await response.json();

        if (data.success) {
            updateJobStatusUI(data.status);
        }
    } catch (error) {
        console.error('Error loading job status:', error);
    }
}

function updateJobStatusUI(status) {
    // Hide all status displays
    document.querySelectorAll('.status-display').forEach(box => {
        box.style.display = 'none';
    });

    // Show appropriate status display
    if (status.status === 'idle') {
        document.getElementById('status-idle').style.display = 'block';
    } else if (status.status === 'scheduled') {
        const scheduledDisplay = document.getElementById('status-scheduled');
        if (scheduledDisplay) {
            scheduledDisplay.style.display = 'block';
            updateNextRunInfo(status);
        }

        // Enable Start Now button for scheduled state
        const startNowBtn = document.getElementById('start-now-btn-scheduled');
        if (startNowBtn) {
            startNowBtn.disabled = false;
        }
    } else if (status.status === 'running') {
        document.getElementById('status-running').style.display = 'block';
        updateProgressInfo(status.progress);

        // Disable Start Now buttons when running
        const startNowBtns = document.querySelectorAll('[id^="start-now-btn"]');
        startNowBtns.forEach(btn => btn.disabled = true);
    } else if (status.status === 'completed') {
        const completedDisplay = document.getElementById('status-completed');
        if (completedDisplay) {
            completedDisplay.style.display = 'block';
        }
    }

    // Disable config changes if running
    const isRunning = status.status === 'running';
    document.getElementById('save-config-btn').disabled = isRunning;
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

        const nextRun = new Date(status.next_run_time);
        document.getElementById('next-run-info').innerHTML = `
            Next scheduled run: ${nextRun.toLocaleString()}
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
    const cachedCount = progress.cached_count || 0;

    document.getElementById('stat-movies').textContent = moviesPrefetched;
    document.getElementById('stat-movies-limit').textContent = moviesLimit === -1 ? 'of ∞' : `of ${moviesLimit}`;

    document.getElementById('stat-series').textContent = seriesPrefetched;
    document.getElementById('stat-series-limit').textContent = seriesLimit === -1 ? 'of ∞' : `of ${seriesLimit}`;

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
        actionText = `Prefetching: ${currentTitle}`;
    }
    document.querySelector('.current-action').textContent = actionText;

    // Update current catalog name
    document.getElementById('current-catalog-name').textContent = catalogName;

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
            // Immediately refresh job status to update UI
            setTimeout(() => loadJobStatus(), 500);
        } else {
            showNotification(data.error || 'Failed to start job', 'error');
        }
    } catch (error) {
        console.error('Error starting job:', error);
        showNotification('Error starting job', 'error');
    }
}

async function terminateJob() {
    if (!confirm('Are you sure you want to terminate the running prefetch job?')) {
        return;
    }

    try {
        const response = await fetch('/api/job/cancel', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showNotification('Job terminated', 'info');
        } else {
            showNotification(data.error || 'Failed to terminate job', 'error');
        }
    } catch (error) {
        console.error('Error terminating job:', error);
        showNotification('Error terminating job', 'error');
    }
}

// Keep old function name for backwards compatibility
async function cancelJob() {
    await terminateJob();
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
            updateJobStatusUI(data);
            break;

        case 'progress':
            updateProgressInfo(data);
            break;

        case 'output':
            appendOutput(data.lines);
            break;

        case 'job_complete':
        case 'job_error':
        case 'job_cancelled':
            loadJobStatus();
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
    const existingTooltip = icon.querySelector('.info-tooltip');

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
            icon.appendChild(tooltip);
        }
    }
}

function closeAllTooltips() {
    const tooltips = document.querySelectorAll('.info-tooltip');
    tooltips.forEach(tooltip => tooltip.remove());
}
