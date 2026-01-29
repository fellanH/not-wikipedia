// Ralph Admin Dashboard - Data Loading and Graph Rendering

// Category color mapping
const categoryColors = {
    linguistics: '#4CAF50',
    consciousness: '#2196F3',
    chronopsychology: '#FF9800',
    technology: '#9C27B0',
    meta: '#607D8B'
};

// Global state
let network = null;
let physicsEnabled = true;
let ecosystemData = null;
let researcherData = null;
let logFiles = [];
let currentLogData = null;
let wordStatsData = null;
let currentCategoryFilter = 'all';

// Initialize dashboard on load
document.addEventListener('DOMContentLoaded', () => {
    refreshDashboard();
});

// Main refresh function
async function refreshDashboard() {
    const btn = document.getElementById('refresh-btn');
    btn.disabled = true;
    btn.textContent = 'Loading...';
    document.body.classList.add('loading');

    try {
        // Load all data
        const [ecosystem, researchers] = await Promise.all([
            fetch('../meta/ecosystem.json').then(r => r.json()),
            fetch('../meta/researchers.json').then(r => r.json())
        ]);

        ecosystemData = ecosystem;
        researcherData = researchers;

        // Update UI
        updateEcosystemMetrics(ecosystem);
        updateResearcherMetrics(researchers);
        updateCategoryDistribution(ecosystem);
        await discoverLogFiles();
        await updateAgentStatus();
        await buildAndRenderGraph(ecosystem);

        // Update timestamp
        document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();

    } catch (error) {
        console.error('Failed to load dashboard data:', error);
        alert('Failed to load data. Make sure you are running a local server.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Refresh Data';
        document.body.classList.remove('loading');
    }
}

// Update ecosystem health metrics
function updateEcosystemMetrics(data) {
    const stats = data.stats;
    document.getElementById('article-count').textContent = stats.total_articles;
    document.getElementById('link-count').textContent = stats.total_internal_links;

    const brokenEl = document.getElementById('broken-links');
    brokenEl.textContent = stats.broken_links;
    brokenEl.className = 'value ' + (stats.broken_links > 0 ? 'error' : 'success');

    const orphanEl = document.getElementById('orphan-count');
    orphanEl.textContent = stats.orphan_articles;
    orphanEl.className = 'value ' + (stats.orphan_articles > 0 ? 'warning' : 'success');

    document.getElementById('avg-links').textContent = stats.avg_links_per_article;
}

// Update researcher metrics
function updateResearcherMetrics(data) {
    const researchers = Object.values(data.researchers);
    const total = researchers.length;
    const overused = researchers.filter(r => r.status && r.status.includes('OVERUSED')).length;
    const moderate = researchers.filter(r => r.status && r.status.includes('MODERATE')).length;
    const available = total - overused - moderate;

    document.getElementById('researcher-total').textContent = total;
    document.getElementById('researcher-overused').textContent = overused;
    document.getElementById('researcher-moderate').textContent = moderate;
    document.getElementById('researcher-available').textContent = available;
}

// Update category distribution bar
function updateCategoryDistribution(data) {
    const categories = data.categories;
    const total = Object.values(categories).reduce((sum, cat) => sum + cat.article_count, 0);

    // Build bar segments
    const barEl = document.getElementById('category-bar');
    barEl.innerHTML = '';

    // Build legend
    const legendEl = document.getElementById('category-legend');
    legendEl.innerHTML = '';

    for (const [name, cat] of Object.entries(categories)) {
        const pct = (cat.article_count / total * 100).toFixed(1);
        const color = categoryColors[name] || '#999';

        // Bar segment
        const segment = document.createElement('div');
        segment.className = 'segment';
        segment.style.flexGrow = cat.article_count;
        segment.style.backgroundColor = color;
        segment.textContent = cat.article_count;
        segment.title = `${name}: ${cat.article_count} articles (${pct}%)`;
        barEl.appendChild(segment);

        // Legend item
        const legendItem = document.createElement('div');
        legendItem.className = 'legend-item';
        legendItem.innerHTML = `
            <span class="legend-dot" style="background-color: ${color}"></span>
            <span>${name} (${cat.article_count})</span>
        `;
        legendEl.appendChild(legendItem);
    }
}

// Update agent status from log files
async function updateAgentStatus() {
    try {
        // Try to fetch the logs directory listing
        // Since we can't list directories directly, we'll try to detect the latest log
        // by trying common patterns
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');

        // Try to find logs from today
        let latestLoop = 0;
        let latestTime = '';

        // Check for logs by trying different loop numbers
        for (let loop = 100; loop >= 1; loop--) {
            try {
                // Try a few time patterns for today
                const testUrls = [
                    `../.logs/run-${dateStr}-`,
                ];

                // This is a simple heuristic - in production you'd want a manifest file
                // For now, we'll just show what we know from ecosystem.json
                break;
            } catch (e) {
                continue;
            }
        }

        // Parse the ecosystem metadata for last validation date
        const lastValidated = ecosystemData._meta?.last_validated || 'Unknown';

        // Calculate status based on ecosystem health
        const stats = ecosystemData.stats;
        let status = 'Idle';
        let statusClass = 'idle';

        if (stats.broken_links > 0 || stats.orphan_articles > 0) {
            status = 'Issues';
            statusClass = 'warning';
        } else {
            status = 'Healthy';
            statusClass = 'healthy';
        }

        document.getElementById('loop-number').textContent = '--';
        document.getElementById('last-run').textContent = lastValidated;

        const statusEl = document.getElementById('agent-status');
        statusEl.textContent = status;
        statusEl.className = 'value status-badge ' + statusClass;

    } catch (error) {
        console.error('Failed to get agent status:', error);
        document.getElementById('loop-number').textContent = '--';
        document.getElementById('last-run').textContent = '--';
        document.getElementById('agent-status').textContent = 'Unknown';
    }
}

// Build and render the article connection graph
async function buildAndRenderGraph(ecosystem) {
    const articles = ecosystem.articles;
    const nodes = [];
    const edges = [];
    const edgeSet = new Set(); // Prevent duplicate edges

    // Create nodes
    for (const [id, article] of Object.entries(articles)) {
        const color = categoryColors[article.category] || '#999';
        const size = 10 + Math.sqrt(article.inlinks || 0) * 5;

        nodes.push({
            id: id,
            label: truncateLabel(article.title, 20),
            title: `${article.title}\nType: ${article.type}\nCategory: ${article.category}\nInlinks: ${article.inlinks}\nOutlinks: ${article.outlinks}`,
            color: {
                background: color,
                border: darkenColor(color, 20),
                highlight: {
                    background: lightenColor(color, 10),
                    border: color
                }
            },
            size: size,
            font: {
                size: Math.max(10, Math.min(14, 8 + article.inlinks)),
                color: '#333'
            },
            // Store metadata for details panel
            meta: article
        });
    }

    // Fetch HTML files to extract actual links
    const articleIds = Object.keys(articles);
    const linkPromises = articleIds.map(async (id) => {
        try {
            const response = await fetch(`../not-wikipedia/${id}.html`);
            if (!response.ok) return [];

            const html = await response.text();
            const links = extractLinks(html, id, articleIds);
            return links;
        } catch (e) {
            return [];
        }
    });

    const allLinks = await Promise.all(linkPromises);

    // Flatten and deduplicate edges
    for (const links of allLinks) {
        for (const link of links) {
            const edgeKey = `${link.from}->${link.to}`;
            if (!edgeSet.has(edgeKey)) {
                edgeSet.add(edgeKey);
                edges.push({
                    from: link.from,
                    to: link.to,
                    arrows: 'to',
                    color: { color: '#ccc', opacity: 0.6 },
                    smooth: { type: 'continuous' }
                });
            }
        }
    }

    // Create vis.js dataset
    const data = {
        nodes: new vis.DataSet(nodes),
        edges: new vis.DataSet(edges)
    };

    // Graph options
    const options = {
        physics: {
            enabled: physicsEnabled,
            solver: 'forceAtlas2Based',
            forceAtlas2Based: {
                gravitationalConstant: -50,
                centralGravity: 0.01,
                springLength: 100,
                springConstant: 0.08
            },
            stabilization: {
                enabled: true,
                iterations: 200,
                updateInterval: 25
            }
        },
        nodes: {
            shape: 'dot',
            borderWidth: 2,
            shadow: true
        },
        edges: {
            width: 0.5,
            smooth: {
                enabled: true,
                type: 'continuous'
            }
        },
        interaction: {
            hover: true,
            tooltipDelay: 100,
            zoomView: true,
            dragView: true
        }
    };

    // Create or update network
    const container = document.getElementById('graph-container');

    if (network) {
        network.destroy();
    }

    network = new vis.Network(container, data, options);

    // Add click handler for node details
    network.on('click', function(params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = data.nodes.get(nodeId);
            showNodeDetails(nodeId, node.meta);
        } else {
            hideNodeDetails();
        }
    });

    // Add double-click to open article
    network.on('doubleClick', function(params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            window.open(`../not-wikipedia/${nodeId}.html`, '_blank');
        }
    });
}

// Extract internal links from HTML content
function extractLinks(html, sourceId, validIds) {
    const links = [];
    const regex = /href="([^"]+\.html)"/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
        const href = match[1];
        // Extract the article ID from the href
        const targetId = href.replace('.html', '').split('/').pop();

        // Only include if it's a valid article and not self-link
        if (validIds.includes(targetId) && targetId !== sourceId) {
            links.push({ from: sourceId, to: targetId });
        }
    }

    return links;
}

// Show node details panel
function showNodeDetails(id, meta) {
    const panel = document.getElementById('node-details');
    panel.classList.remove('hidden');

    document.getElementById('detail-title').textContent = meta.title;
    document.getElementById('detail-type').textContent = meta.type;
    document.getElementById('detail-category').textContent = meta.category;
    document.getElementById('detail-inlinks').textContent = meta.inlinks;
    document.getElementById('detail-outlinks').textContent = meta.outlinks;
    document.getElementById('detail-created').textContent = meta.created;

    const link = document.getElementById('detail-link');
    link.href = `../not-wikipedia/${id}.html`;
}

// Hide node details panel
function hideNodeDetails() {
    document.getElementById('node-details').classList.add('hidden');
}

// Reset graph view
function resetGraph() {
    if (network) {
        network.fit();
    }
}

// Toggle physics simulation
function togglePhysics() {
    physicsEnabled = !physicsEnabled;
    if (network) {
        network.setOptions({ physics: { enabled: physicsEnabled } });
    }
}

// Helper: Truncate label
function truncateLabel(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

// Helper: Darken a hex color
function darkenColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, (num >> 16) - amt);
    const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
    const B = Math.max(0, (num & 0x0000FF) - amt);
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

// Helper: Lighten a hex color
function lightenColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

// ============================================
// LOG FILE MANAGEMENT
// ============================================

// Discover available log files from manifest
async function discoverLogFiles() {
    logFiles = [];

    try {
        // Try to fetch manifest file first
        const response = await fetch('../.logs/manifest.txt');
        if (response.ok) {
            const text = await response.text();
            const filenames = text.trim().split('\n').filter(f => f.endsWith('.json'));

            for (const filename of filenames) {
                const parsed = parseLogFilename(filename);
                if (parsed) {
                    logFiles.push({
                        filename,
                        ...parsed,
                        path: `../.logs/${filename}`
                    });
                }
            }
        }
    } catch (e) {
        console.log('Manifest not found, trying direct file discovery');
    }

    // Sort by timestamp descending (newest first)
    logFiles.sort((a, b) => {
        const aKey = `${a.date}${a.time}`;
        const bKey = `${b.date}${b.time}`;
        return bKey.localeCompare(aKey);
    });

    // Populate dropdown and recent runs
    populateLogSelector();
    renderRecentRuns();

    // Update agent status with latest log info
    if (logFiles.length > 0) {
        const latest = logFiles[0];
        document.getElementById('loop-number').textContent = `#${latest.loop}`;
        document.getElementById('last-run').textContent = formatLogTime(latest.date, latest.time);
    }
}

// Parse log filename to extract metadata
function parseLogFilename(filename) {
    // Format: run-YYYYMMDD-HHMMSS-loopN.json
    const match = filename.match(/run-(\d{8})-(\d{6})-loop(\d+)\.json/);
    if (match) {
        const dateStr = match[1];
        const timeStr = match[2];
        const loop = parseInt(match[3], 10);

        return {
            date: dateStr,
            time: timeStr,
            loop
        };
    }
    return null;
}

// Populate the log file selector dropdown
function populateLogSelector() {
    const selector = document.getElementById('log-selector');
    selector.innerHTML = '<option value="">Select a log file...</option>';

    for (const log of logFiles.slice(0, 50)) { // Show last 50 logs
        const option = document.createElement('option');
        option.value = log.path;
        option.textContent = `Loop ${log.loop} - ${formatLogTime(log.date, log.time)}`;
        selector.appendChild(option);
    }
}

// Render recent runs cards
function renderRecentRuns() {
    const container = document.getElementById('recent-runs');

    if (logFiles.length === 0) {
        container.innerHTML = '<p class="empty-state">No log files found</p>';
        return;
    }

    container.innerHTML = '';

    // Show up to 12 most recent runs
    for (const log of logFiles.slice(0, 12)) {
        const card = document.createElement('div');
        card.className = 'run-card';
        card.dataset.path = log.path;
        card.onclick = () => loadLog(log.path);

        card.innerHTML = `
            <div class="run-loop">Loop ${log.loop}</div>
            <div class="run-time">${formatLogTime(log.date, log.time)}</div>
        `;

        container.appendChild(card);
    }
}

// Format log time for display
function formatLogTime(dateStr, timeStr) {
    // dateStr: YYYYMMDD, timeStr: HHMMSS
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    const hour = timeStr.slice(0, 2);
    const minute = timeStr.slice(2, 4);
    return `${month}/${day} ${hour}:${minute}`;
}

// Load the selected log file
async function loadSelectedLog() {
    const selector = document.getElementById('log-selector');
    const path = selector.value;
    if (path) {
        await loadLog(path);
    }
}

// Load the latest log file
async function loadLatestLog() {
    if (logFiles.length > 0) {
        await loadLog(logFiles[0].path);
        document.getElementById('log-selector').value = logFiles[0].path;
    }
}

// Load and parse a specific log file
async function loadLog(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error('Failed to fetch log');

        const text = await response.text();
        const events = parseNDJSON(text);

        currentLogData = processLogEvents(events);

        // Update UI
        updateLogSummary(currentLogData);
        renderActivityTimeline(currentLogData);

        // Highlight selected run card
        document.querySelectorAll('.run-card').forEach(card => {
            card.classList.toggle('active', card.dataset.path === path);
        });

    } catch (error) {
        console.error('Failed to load log:', error);
        document.getElementById('activity-timeline').innerHTML =
            '<p class="empty-state">Failed to load log file</p>';
    }
}

// Parse NDJSON (newline-delimited JSON)
function parseNDJSON(text) {
    const lines = text.trim().split('\n');
    const events = [];

    for (const line of lines) {
        if (line.trim()) {
            try {
                events.push(JSON.parse(line));
            } catch (e) {
                // Skip malformed lines
            }
        }
    }

    return events;
}

// Process log events into structured data
function processLogEvents(events) {
    const result = {
        sessionId: null,
        model: null,
        tools: [],
        messages: [],
        toolCalls: [],
        errors: []
    };

    for (const event of events) {
        switch (event.type) {
            case 'system':
                if (event.subtype === 'init') {
                    result.sessionId = event.session_id;
                    result.model = event.model;
                    result.tools = event.tools || [];
                }
                break;

            case 'assistant':
                if (event.message?.content) {
                    for (const block of event.message.content) {
                        if (block.type === 'text' && block.text) {
                            result.messages.push({
                                type: 'assistant',
                                text: block.text,
                                timestamp: event.uuid
                            });
                        } else if (block.type === 'tool_use') {
                            result.toolCalls.push({
                                id: block.id,
                                name: block.name,
                                input: block.input,
                                timestamp: event.uuid
                            });
                        }
                    }
                }
                break;

            case 'user':
                if (event.message?.content) {
                    for (const block of event.message.content) {
                        if (block.type === 'tool_result') {
                            // Find the matching tool call
                            const toolCall = result.toolCalls.find(tc => tc.id === block.tool_use_id);
                            if (toolCall) {
                                toolCall.result = block.content;
                                toolCall.isError = block.is_error;
                            }
                        }
                    }
                }
                break;
        }
    }

    return result;
}

// Update log summary display
function updateLogSummary(data) {
    const summary = document.getElementById('log-summary');
    summary.classList.remove('hidden');

    document.getElementById('log-session').textContent =
        data.sessionId ? data.sessionId.slice(0, 8) + '...' : '--';
    document.getElementById('log-model').textContent =
        data.model ? data.model.replace('claude-', '').replace('-20251101', '') : '--';
    document.getElementById('log-tool-count').textContent = data.toolCalls.length;
    document.getElementById('log-message-count').textContent = data.messages.length;
}

// Render activity timeline
function renderActivityTimeline(data) {
    const container = document.getElementById('activity-timeline');
    container.innerHTML = '';

    // Interleave messages and tool calls chronologically
    const timeline = [];

    // Add messages
    for (const msg of data.messages) {
        timeline.push({
            type: 'message',
            data: msg,
            order: msg.timestamp
        });
    }

    // Add tool calls
    for (const tool of data.toolCalls) {
        timeline.push({
            type: 'tool',
            data: tool,
            order: tool.timestamp
        });
    }

    // Sort by order (uuid serves as rough timestamp)
    timeline.sort((a, b) => (a.order || '').localeCompare(b.order || ''));

    if (timeline.length === 0) {
        container.innerHTML = '<p class="empty-state">No activity recorded in this log</p>';
        return;
    }

    // Render entries
    for (const entry of timeline) {
        const el = createTimelineEntry(entry);
        container.appendChild(el);
    }
}

// Create a timeline entry element
function createTimelineEntry(entry) {
    const div = document.createElement('div');
    div.className = 'timeline-entry';

    if (entry.type === 'message') {
        const msg = entry.data;
        div.innerHTML = `
            <div class="timeline-icon assistant">AI</div>
            <div class="timeline-content">
                <div class="timeline-header">
                    <span class="timeline-type">Assistant Message</span>
                </div>
                <div class="timeline-message ${msg.text.length > 200 ? 'truncated' : ''}">${escapeHtml(msg.text)}</div>
                ${msg.text.length > 200 ? `<button class="toggle-details" onclick="toggleMessageExpand(this)">Show more</button>` : ''}
            </div>
        `;
    } else if (entry.type === 'tool') {
        const tool = entry.data;
        const iconClass = tool.isError ? 'error' : (tool.result ? 'result' : 'tool');
        const statusText = tool.isError ? 'Error' : (tool.result ? 'Completed' : 'Called');

        // Format input preview
        let inputPreview = '';
        if (tool.input) {
            if (tool.input.command) {
                inputPreview = tool.input.command;
            } else if (tool.input.file_path) {
                inputPreview = tool.input.file_path;
            } else if (tool.input.pattern) {
                inputPreview = tool.input.pattern;
            } else if (tool.input.prompt) {
                inputPreview = tool.input.prompt.slice(0, 100);
            } else {
                inputPreview = JSON.stringify(tool.input).slice(0, 100);
            }
        }

        div.innerHTML = `
            <div class="timeline-icon ${iconClass}">${getToolIcon(tool.name)}</div>
            <div class="timeline-content">
                <div class="timeline-header">
                    <span class="timeline-type">${tool.name}</span>
                    <span class="timeline-time">${statusText}</span>
                </div>
                <div class="timeline-message">${escapeHtml(inputPreview)}</div>
                ${tool.result ? `
                    <button class="toggle-details" onclick="toggleDetails(this)">Show result</button>
                    <div class="timeline-details hidden">${escapeHtml(truncateResult(tool.result))}</div>
                ` : ''}
            </div>
        `;
    }

    return div;
}

// Get icon for tool type
function getToolIcon(toolName) {
    const icons = {
        'Bash': '$',
        'Read': 'R',
        'Write': 'W',
        'Edit': 'E',
        'Glob': 'G',
        'Grep': '?',
        'Task': 'T',
        'WebFetch': 'W',
        'WebSearch': 'S',
        'TodoWrite': 'L'
    };
    return icons[toolName] || toolName.slice(0, 1).toUpperCase();
}

// Truncate result for display
function truncateResult(result) {
    if (typeof result !== 'string') {
        result = JSON.stringify(result, null, 2);
    }
    if (result.length > 2000) {
        return result.slice(0, 2000) + '\n... (truncated)';
    }
    return result;
}

// Toggle details visibility
function toggleDetails(btn) {
    const details = btn.nextElementSibling;
    const isHidden = details.classList.toggle('hidden');
    btn.textContent = isHidden ? 'Show result' : 'Hide result';
}

// Toggle message expansion
function toggleMessageExpand(btn) {
    const msg = btn.previousElementSibling;
    const isTruncated = msg.classList.toggle('truncated');
    btn.textContent = isTruncated ? 'Show more' : 'Show less';
}

// Escape HTML for safe display
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// WORD USAGE STATISTICS
// ============================================

// Common English stop words to filter out
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
    'shall', 'can', 'need', 'dare', 'ought', 'used', 'this', 'that', 'these', 'those',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'whom',
    'this', 'that', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the',
    'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by',
    'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out',
    'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
    'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other',
    'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
    'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'also', 'its',
    'his', 'her', 'their', 'our', 'my', 'your', 'any', 'both', 'however', 'although',
    'since', 'yet', 'still', 'even', 'well', 'back', 'much', 'many', 'may', 'within',
    'upon', 'rather', 'whether', 'though', 'among', 'across', 'around', 'along',
    'ref', 'edit', 'wikipedia', 'cite', 'see', 'also', 'references', 'contents',
    'first', 'one', 'two', 'three', 'new', 'including', 'known', 'became', 'later',
    'early', 'particularly', 'often', 'several', 'following', 'according', 'began'
]);

// Domain-specific terms that indicate Not-Wikipedia vocabulary
const DOMAIN_INDICATORS = [
    'semantic', 'temporal', 'consciousness', 'linguistic', 'memory', 'chronological',
    'cognitive', 'perception', 'phenomenon', 'theory', 'research', 'institute',
    'methodology', 'psychological', 'archaeology', 'stratum', 'boundary', 'liminal',
    'resonance', 'substrate', 'neural', 'perception', 'echo', 'ghost', 'vocabulary',
    'debt', 'decay', 'drift', 'extraction', 'forensics', 'hygiene', 'cascade',
    'bifurcation', 'recursion', 'compression', 'encryption', 'quarantine', 'triage',
    'contagion', 'immune', 'telomere', 'palimpsest', 'occlusion', 'anesthesia'
];

// Analyze word usage across all articles
async function analyzeWordUsage() {
    const btn = document.getElementById('analyze-words-btn');
    btn.disabled = true;
    btn.textContent = 'Analyzing...';

    try {
        const articles = ecosystemData.articles;
        const articleIds = Object.keys(articles);

        // Fetch and analyze all articles
        const analysisPromises = articleIds.map(async (id) => {
            try {
                const response = await fetch(`../not-wikipedia/${id}.html`);
                if (!response.ok) return null;

                const html = await response.text();
                const text = extractTextFromHtml(html);
                const words = tokenizeText(text);

                return {
                    id,
                    title: articles[id].title,
                    category: articles[id].category,
                    wordCount: words.length,
                    words
                };
            } catch (e) {
                return null;
            }
        });

        const results = (await Promise.all(analysisPromises)).filter(r => r !== null);

        // Aggregate statistics
        wordStatsData = aggregateWordStats(results);

        // Render results
        renderWordStats(wordStatsData);

    } catch (error) {
        console.error('Failed to analyze word usage:', error);
        alert('Failed to analyze word usage');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Analyze Content';
    }
}

// Extract text content from HTML
function extractTextFromHtml(html) {
    // Create a temporary element to parse HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Remove script and style elements
    temp.querySelectorAll('script, style, .toc, .ambox, .infobox, .reflist').forEach(el => el.remove());

    // Get text content
    return temp.textContent || temp.innerText || '';
}

// Tokenize text into words
function tokenizeText(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s'-]/g, ' ')  // Remove punctuation except apostrophes and hyphens
        .split(/\s+/)
        .filter(word => word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}

// Aggregate word statistics from all articles
function aggregateWordStats(results) {
    const wordFreq = new Map();
    const wordByCategory = new Map();
    const articleStats = [];
    let totalWords = 0;

    for (const article of results) {
        totalWords += article.wordCount;
        articleStats.push({
            id: article.id,
            title: article.title,
            category: article.category,
            wordCount: article.wordCount
        });

        // Count word frequencies
        for (const word of article.words) {
            wordFreq.set(word, (wordFreq.get(word) || 0) + 1);

            // Track by category
            if (!wordByCategory.has(article.category)) {
                wordByCategory.set(article.category, new Map());
            }
            const catMap = wordByCategory.get(article.category);
            catMap.set(word, (catMap.get(word) || 0) + 1);
        }
    }

    // Sort article stats by word count
    articleStats.sort((a, b) => b.wordCount - a.wordCount);

    // Get top words
    const sortedWords = [...wordFreq.entries()].sort((a, b) => b[1] - a[1]);
    const topWords = sortedWords.slice(0, 50);

    // Get domain-specific terms
    const domainTerms = sortedWords
        .filter(([word]) => DOMAIN_INDICATORS.some(term => word.includes(term) || term.includes(word)))
        .slice(0, 30);

    // Calculate unique words
    const uniqueWords = wordFreq.size;

    return {
        totalWords,
        uniqueWords,
        avgWordsPerArticle: Math.round(totalWords / results.length),
        vocabularyRichness: (uniqueWords / totalWords * 100).toFixed(2) + '%',
        topWords,
        domainTerms,
        articleStats,
        wordByCategory,
        wordFreq
    };
}

// Render word statistics to the UI
function renderWordStats(stats) {
    // Update summary cards
    document.getElementById('total-words').textContent = stats.totalWords.toLocaleString();
    document.getElementById('unique-words').textContent = stats.uniqueWords.toLocaleString();
    document.getElementById('avg-words-article').textContent = stats.avgWordsPerArticle.toLocaleString();
    document.getElementById('vocabulary-richness').textContent = stats.vocabularyRichness;

    // Render top words
    renderWordList('top-words', stats.topWords, stats.topWords[0]?.[1] || 1);

    // Render domain terms
    renderWordList('domain-terms', stats.domainTerms, stats.domainTerms[0]?.[1] || 1);

    // Render word cloud
    renderWordCloud(stats.topWords.slice(0, 40));

    // Render articles by word count
    renderArticlesBars(stats.articleStats);
}

// Render a word frequency list
function renderWordList(containerId, words, maxCount) {
    const container = document.getElementById(containerId);

    if (words.length === 0) {
        container.innerHTML = '<p class="empty-state">No words found</p>';
        return;
    }

    container.innerHTML = words.map(([word, count]) => `
        <div class="word-item">
            <span class="word-text">${escapeHtml(word)}</span>
            <div class="word-bar">
                <div class="word-bar-fill" style="width: ${(count / maxCount * 100).toFixed(1)}%"></div>
            </div>
            <span class="word-count">${count}</span>
        </div>
    `).join('');
}

// Render word cloud
function renderWordCloud(words) {
    const container = document.getElementById('word-cloud');

    if (words.length === 0) {
        container.innerHTML = '<p class="empty-state">No words to display</p>';
        return;
    }

    const maxCount = words[0]?.[1] || 1;
    const minCount = words[words.length - 1]?.[1] || 1;
    const range = maxCount - minCount || 1;

    // Shuffle words for better visual distribution
    const shuffled = [...words].sort(() => Math.random() - 0.5);

    container.innerHTML = shuffled.map(([word, count]) => {
        // Calculate size class (1-5)
        const normalized = (count - minCount) / range;
        const sizeClass = Math.ceil(normalized * 4) + 1;

        // Determine color based on word content
        let catClass = 'cat-default';
        if (word.includes('linguist') || word.includes('semantic') || word.includes('lexic')) {
            catClass = 'cat-linguistics';
        } else if (word.includes('conscious') || word.includes('memory') || word.includes('psych')) {
            catClass = 'cat-consciousness';
        } else if (word.includes('tempor') || word.includes('chrono') || word.includes('time')) {
            catClass = 'cat-chronopsychology';
        } else if (word.includes('digit') || word.includes('algorithm') || word.includes('comput')) {
            catClass = 'cat-technology';
        }

        return `<span class="cloud-word size-${sizeClass} ${catClass}" title="${count} occurrences">${escapeHtml(word)}</span>`;
    }).join('');
}

// Render articles by word count bars
function renderArticlesBars(articles) {
    const container = document.getElementById('articles-by-words');

    if (articles.length === 0) {
        container.innerHTML = '<p class="empty-state">No articles analyzed</p>';
        return;
    }

    // Filter by current category if set
    let filtered = articles;
    if (currentCategoryFilter !== 'all') {
        filtered = articles.filter(a => a.category === currentCategoryFilter);
    }

    // Show top 20
    const display = filtered.slice(0, 20);
    const maxWords = display[0]?.wordCount || 1;

    container.innerHTML = display.map(article => {
        const color = categoryColors[article.category] || '#607D8B';
        const pct = (article.wordCount / maxWords * 100).toFixed(1);

        return `
            <div class="article-bar-item">
                <span class="article-bar-title" title="${escapeHtml(article.title)}">${escapeHtml(article.title)}</span>
                <div class="article-bar-container">
                    <div class="article-bar-fill" style="width: ${pct}%; background: ${color}">
                        <span>${article.wordCount}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Filter words by category
function filterWordsByCategory() {
    const select = document.getElementById('word-category-filter');
    currentCategoryFilter = select.value;

    if (!wordStatsData) return;

    if (currentCategoryFilter === 'all') {
        // Show global stats
        renderWordList('top-words', wordStatsData.topWords, wordStatsData.topWords[0]?.[1] || 1);
        renderWordList('domain-terms', wordStatsData.domainTerms, wordStatsData.domainTerms[0]?.[1] || 1);
    } else {
        // Show category-specific stats
        const catWords = wordStatsData.wordByCategory.get(currentCategoryFilter);
        if (catWords) {
            const sorted = [...catWords.entries()].sort((a, b) => b[1] - a[1]);
            const topCatWords = sorted.slice(0, 50);
            const domainCatTerms = sorted
                .filter(([word]) => DOMAIN_INDICATORS.some(term => word.includes(term) || term.includes(word)))
                .slice(0, 30);

            renderWordList('top-words', topCatWords, topCatWords[0]?.[1] || 1);
            renderWordList('domain-terms', domainCatTerms, domainCatTerms[0]?.[1] || 1);
        }
    }

    // Update articles bars with filter
    renderArticlesBars(wordStatsData.articleStats);
}
