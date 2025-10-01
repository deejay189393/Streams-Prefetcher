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

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    loadConfiguration();
    loadScheduleInfo();
    loadJobStatus();
    connectEventSource();

    // Enable drag and drop for addon URLs
    initializeAddonUrlDragDrop();
});

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

    // Populate limits
    document.getElementById('movies-global-limit').value = config.movies_global_limit;
    document.getElementById('series-global-limit').value = config.series_global_limit;
    document.getElementById('movies-per-catalog').value = config.movies_per_catalog;
    document.getElementById('series-per-catalog').value = config.series_per_catalog;
    document.getElementById('items-per-mixed-catalog').value = config.items_per_mixed_catalog;

    // Populate time-based parameters
    const delayValue = config.delay || 0;
    document.getElementById('delay-value').value = delayValue;
    document.getElementById('delay-unit').value = '1';

    const cacheValidityValue = config.cache_validity || 259200;
    const cacheDays = cacheValidityValue / 86400;
    document.getElementById('cache-validity-value').value = cacheDays;
    document.getElementById('cache-validity-unit').value = '86400';

    const maxExecValue = config.max_execution_time || -1;
    document.getElementById('max-execution-time-value').value = maxExecValue;
    document.getElementById('max-execution-time-unit').value = '1';

    // Populate proxy
    document.getElementById('proxy').value = config.proxy || '';

    // Populate boolean flags
    document.querySelector(`input[name="randomize-catalog"][value="${config.randomize_catalog_processing}"]`).checked = true;
    document.querySelector(`input[name="randomize-item"][value="${config.randomize_item_prefetching}"]`).checked = true;
    document.querySelector(`input[name="enable-logging"][value="${config.enable_logging}"]`).checked = true;
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
}

function removeAddonUrl(btn) {
    btn.closest('.addon-item').remove();
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
// Save Configuration
// ============================================================================

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

        // Collect configuration
        const config = {
            addon_urls: addonUrls,
            movies_global_limit: parseInt(document.getElementById('movies-global-limit').value),
            series_global_limit: parseInt(document.getElementById('series-global-limit').value),
            movies_per_catalog: parseInt(document.getElementById('movies-per-catalog').value),
            series_per_catalog: parseInt(document.getElementById('series-per-catalog').value),
            items_per_mixed_catalog: parseInt(document.getElementById('items-per-mixed-catalog').value),
            delay: parseFloat(document.getElementById('delay-value').value) * parseFloat(document.getElementById('delay-unit').value),
            cache_validity: parseFloat(document.getElementById('cache-validity-value').value) * parseFloat(document.getElementById('cache-validity-unit').value),
            max_execution_time: parseFloat(document.getElementById('max-execution-time-value').value) * parseFloat(document.getElementById('max-execution-time-unit').value),
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

// ============================================================================
// Catalog Loading and Selection
// ============================================================================

async function loadCatalogs() {
    const btn = document.getElementById('load-catalogs-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Loading Catalogs...';

    try {
        const response = await fetch('/api/catalogs/load', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            loadedCatalogs = data.catalogs;
            renderCatalogList(data.catalogs);
            document.getElementById('catalog-list-container').style.display = 'block';
            catalogsLoaded = true;

            showNotification(`Loaded ${data.total_catalogs} catalogs from ${data.total_addons} addons`, 'success');

            if (data.errors.length > 0) {
                showNotification(`${data.errors.length} errors occurred while loading catalogs`, 'error');
            }
        } else {
            showNotification(data.error || 'Failed to load catalogs', 'error');
        }
    } catch (error) {
        console.error('Error loading catalogs:', error);
        showNotification('Error loading catalogs', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Load Catalogs';
    }
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

        div.innerHTML = `
            <span class="drag-handle">⋮⋮</span>
            <input type="checkbox" ${catalog.enabled ? 'checked' : ''} onchange="toggleCatalog('${catalog.id}', this.checked)">
            <div class="catalog-info">
                <div class="catalog-name">${catalog.name}</div>
                <div class="catalog-meta">Type: ${catalog.type} | ${addonBadge}</div>
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
    }
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
// Save Catalog Selection
// ============================================================================

async function saveCatalogSelection() {
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
            showNotification('Catalog selection saved successfully', 'success');
        } else {
            showNotification(data.error || 'Failed to save catalog selection', 'error');
        }
    } catch (error) {
        console.error('Error saving catalog selection:', error);
        showNotification('Error saving catalog selection', 'error');
    }
}

// ============================================================================
// Schedule Management
// ============================================================================

async function loadScheduleInfo() {
    try {
        const response = await fetch('/api/schedule');
        const data = await response.json();

        if (data.success && data.schedule) {
            const schedule = data.schedule;
            document.getElementById('cron-expression').value = schedule.cron_expression || '';

            if (schedule.enabled && schedule.next_run_time) {
                updateScheduleInfo(schedule);
            }
        }
    } catch (error) {
        console.error('Error loading schedule:', error);
    }
}

function updateScheduleInfo(schedule) {
    const infoBox = document.getElementById('schedule-info');
    const nextRun = new Date(schedule.next_run_time);
    const timeUntil = Math.max(0, schedule.time_until_next_run || 0);

    const hours = Math.floor(timeUntil / 3600);
    const minutes = Math.floor((timeUntil % 3600) / 60);
    const seconds = Math.floor(timeUntil % 60);

    infoBox.innerHTML = `
        <strong>Schedule Active</strong><br>
        Next Run: ${nextRun.toLocaleString()}<br>
        Time Until Next Run: ${hours}h ${minutes}m ${seconds}s
    `;
    infoBox.style.display = 'block';
}

async function saveSchedule() {
    const cronExpression = document.getElementById('cron-expression').value.trim();

    if (!cronExpression) {
        showNotification('Please enter a cron expression', 'error');
        return;
    }

    try {
        const response = await fetch('/api/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cron_expression: cronExpression, timezone: 'UTC' })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Schedule enabled successfully', 'success');
            loadScheduleInfo();
        } else {
            showNotification(data.error || 'Failed to enable schedule', 'error');
        }
    } catch (error) {
        console.error('Error saving schedule:', error);
        showNotification('Error saving schedule', 'error');
    }
}

async function disableSchedule() {
    try {
        const response = await fetch('/api/schedule', { method: 'DELETE' });
        const data = await response.json();

        if (data.success) {
            showNotification('Schedule disabled successfully', 'success');
            document.getElementById('schedule-info').style.display = 'none';
        } else {
            showNotification(data.error || 'Failed to disable schedule', 'error');
        }
    } catch (error) {
        console.error('Error disabling schedule:', error);
        showNotification('Error disabling schedule', 'error');
    }
}

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
    // Hide all status boxes
    document.querySelectorAll('.status-box').forEach(box => {
        box.style.display = 'none';
    });

    // Show appropriate status box
    if (status.status === 'idle') {
        document.getElementById('status-idle').style.display = 'block';
    } else if (status.status === 'scheduled') {
        document.getElementById('status-scheduled').style.display = 'block';
        updateNextRunInfo(status);
    } else if (status.status === 'running') {
        document.getElementById('status-running').style.display = 'block';
        updateProgressInfo(status.progress);
    } else if (status.status === 'completed') {
        document.getElementById('status-completed').style.display = 'block';
    }

    // Disable config changes if running
    const isRunning = status.status === 'running';
    document.getElementById('save-config-btn').disabled = isRunning;
}

function updateNextRunInfo(status) {
    if (status.next_run_time) {
        const nextRun = new Date(status.next_run_time);
        document.getElementById('next-run-info').innerHTML = `
            Next scheduled run: ${nextRun.toLocaleString()}
        `;
    }
}

function updateProgressInfo(progress) {
    const container = document.getElementById('progress-info');

    if (!progress || Object.keys(progress).length === 0) {
        container.innerHTML = '<p>Starting...</p>';
        return;
    }

    const html = `
        <div>
            <strong>Current Catalog:</strong> ${progress.catalog_name || 'N/A'} (${progress.catalog_mode || 'N/A'})<br>
            <strong>Progress:</strong> ${progress.completed_catalogs || 0} / ${progress.total_catalogs || 0} catalogs<br>
            <strong>Movies Prefetched:</strong> ${progress.movies_prefetched || 0} / ${progress.movies_limit === -1 ? '∞' : progress.movies_limit}<br>
            <strong>Series Prefetched:</strong> ${progress.series_prefetched || 0} / ${progress.series_limit === -1 ? '∞' : progress.series_limit}
        </div>
    `;

    container.innerHTML = html;
}

async function runJob() {
    try {
        const response = await fetch('/api/job/run', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showNotification('Job started successfully', 'success');
        } else {
            showNotification(data.error || 'Failed to start job', 'error');
        }
    } catch (error) {
        console.error('Error starting job:', error);
        showNotification('Error starting job', 'error');
    }
}

async function cancelJob() {
    try {
        const response = await fetch('/api/job/cancel', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showNotification('Job cancelled', 'info');
        } else {
            showNotification(data.error || 'Failed to cancel job', 'error');
        }
    } catch (error) {
        console.error('Error cancelling job:', error);
        showNotification('Error cancelling job', 'error');
    }
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
