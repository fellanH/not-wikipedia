#!/usr/bin/env node
/**
 * Dashboard Server for Not-Wikipedia
 * Serves static files and provides API endpoints for agent control and tool testing
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const url = require('url');
const net = require('net');

// Use a unique port for Not-Wikipedia dashboard (default 8765, configurable via env)
const DEFAULT_PORT = 8765;
const PORT_RANGE_START = 8765;
const PORT_RANGE_END = 8775;
const DASHBOARD_DIR = __dirname;
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const AGENT_DIR = path.resolve(__dirname, '../agent');
const MCP_DIR = path.resolve(__dirname, '../mcp');

// Track running agent processes
let agentProcess = null;
let agentLogs = [];
const MAX_LOGS = 500;

// MIME types for static files
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// Helper to send JSON response
function sendJSON(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
}

// Helper to read request body
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                resolve({});
            }
        });
        req.on('error', reject);
    });
}

// Serve static files
async function serveStatic(req, res, filePath) {
    try {
        // Security: prevent directory traversal
        const normalizedPath = path.normalize(filePath);
        const allowedRoots = [
            DASHBOARD_DIR,
            path.resolve(DASHBOARD_DIR, '..'),  // local-agent/lib
            path.join(PROJECT_ROOT, 'wiki-content')  // wiki content
        ];
        const isAllowed = allowedRoots.some(root => normalizedPath.startsWith(root));
        if (!isAllowed) {
            sendJSON(res, { error: 'Forbidden' }, 403);
            return;
        }

        const stat = await fs.promises.stat(filePath).catch(() => null);

        if (!stat || !stat.isFile()) {
            // Try with .html extension
            if (!filePath.endsWith('.html')) {
                const htmlPath = filePath + '.html';
                const htmlStat = await fs.promises.stat(htmlPath).catch(() => null);
                if (htmlStat && htmlStat.isFile()) {
                    filePath = htmlPath;
                } else {
                    sendJSON(res, { error: 'Not found' }, 404);
                    return;
                }
            } else {
                sendJSON(res, { error: 'Not found' }, 404);
                return;
            }
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        const content = await fs.promises.readFile(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    } catch (err) {
        console.error('Static file error:', err);
        sendJSON(res, { error: 'Server error' }, 500);
    }
}

// API: Get agent status
function getAgentStatus() {
    return {
        running: agentProcess !== null && !agentProcess.killed,
        pid: agentProcess?.pid || null,
        logsCount: agentLogs.length,
        recentLogs: agentLogs.slice(-50)
    };
}

// API: Start agent
async function startAgent(options = {}) {
    if (agentProcess && !agentProcess.killed) {
        return { success: false, error: 'Agent already running', pid: agentProcess.pid };
    }

    const env = { ...process.env };
    if (options.workers) env.PARALLEL_WORKERS = String(options.workers);
    if (options.loops) env.LOOPS_PER_WORKER = String(options.loops);
    if (options.autoPublish !== undefined) env.AUTO_PUBLISH = String(options.autoPublish);
    if (options.liveCrawl !== undefined) env.USE_LIVE_CRAWL = String(options.liveCrawl);

    agentLogs = [];

    agentProcess = spawn('./ralph.sh', [], {
        cwd: AGENT_DIR,
        env,
        shell: true
    });

    agentProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        for (const line of lines) {
            agentLogs.push({ type: 'stdout', time: new Date().toISOString(), text: line });
            if (agentLogs.length > MAX_LOGS) agentLogs.shift();
        }
    });

    agentProcess.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        for (const line of lines) {
            agentLogs.push({ type: 'stderr', time: new Date().toISOString(), text: line });
            if (agentLogs.length > MAX_LOGS) agentLogs.shift();
        }
    });

    agentProcess.on('close', (code) => {
        agentLogs.push({ type: 'system', time: new Date().toISOString(), text: `Agent exited with code ${code}` });
        agentProcess = null;
    });

    return { success: true, pid: agentProcess.pid };
}

// API: Stop agent
function stopAgent() {
    if (!agentProcess || agentProcess.killed) {
        return { success: false, error: 'No agent running' };
    }

    agentProcess.kill('SIGTERM');
    agentLogs.push({ type: 'system', time: new Date().toISOString(), text: 'Agent stop requested' });

    return { success: true };
}

// API: Run MCP tool
async function runTool(toolName, args = {}) {
    return new Promise((resolve) => {
        const toolPath = path.join(MCP_DIR, 'dist', 'tools', `${toolName}.js`);

        // Check if tool exists
        if (!fs.existsSync(toolPath)) {
            resolve({ success: false, error: `Tool not found: ${toolName}` });
            return;
        }

        const argsJson = JSON.stringify(args).replace(/'/g, "\\'");
        const cmd = `node -e "require('${toolPath}').tool.handler(${argsJson}).then(r=>console.log(JSON.stringify(r))).catch(e=>console.log(JSON.stringify({error:e.message})))"`;

        exec(cmd, { cwd: AGENT_DIR, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                resolve({ success: false, error: error.message, stderr });
                return;
            }

            try {
                const result = JSON.parse(stdout.trim());
                resolve({ success: true, result });
            } catch (e) {
                resolve({ success: true, result: { raw: stdout } });
            }
        });
    });
}

// API: List available tools
async function listTools() {
    const toolsDir = path.join(MCP_DIR, 'dist', 'tools');

    try {
        const files = await fs.promises.readdir(toolsDir);
        const tools = files
            .filter(f => f.startsWith('wiki-') && f.endsWith('.js'))
            .map(f => f.replace('.js', ''));

        return { success: true, tools };
    } catch (err) {
        return { success: false, error: 'Could not list tools', details: err.message };
    }
}

// API: Get ecosystem health (run wiki-ecosystem tool)
async function getHealth() {
    return runTool('wiki-ecosystem', {});
}

// API: Preview article locally
async function previewArticle(articleId) {
    const articlePath = path.join(PROJECT_ROOT, 'wiki-content', 'wiki', `${articleId}.html`);

    try {
        const content = await fs.promises.readFile(articlePath, 'utf-8');
        return { success: true, html: content };
    } catch (err) {
        return { success: false, error: `Article not found: ${articleId}` };
    }
}

// API: List articles
async function listArticles() {
    const wikiDir = path.join(PROJECT_ROOT, 'wiki-content', 'wiki');

    try {
        const files = await fs.promises.readdir(wikiDir);
        const articles = files
            .filter(f => f.endsWith('.html'))
            .map(f => f.replace('.html', ''));
        return { success: true, articles };
    } catch (err) {
        return { success: false, error: 'Could not list articles' };
    }
}

// Main request handler
async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // API routes
    if (pathname.startsWith('/api/')) {
        const route = pathname.slice(5);

        try {
            switch (route) {
                case 'status':
                    sendJSON(res, getAgentStatus());
                    break;

                case 'start':
                    if (req.method === 'POST') {
                        const body = await readBody(req);
                        const result = await startAgent(body);
                        sendJSON(res, result);
                    } else {
                        sendJSON(res, { error: 'POST required' }, 405);
                    }
                    break;

                case 'stop':
                    if (req.method === 'POST') {
                        sendJSON(res, stopAgent());
                    } else {
                        sendJSON(res, { error: 'POST required' }, 405);
                    }
                    break;

                case 'logs':
                    const since = parseInt(parsedUrl.query.since) || 0;
                    sendJSON(res, { logs: agentLogs.slice(since) });
                    break;

                case 'tools':
                    sendJSON(res, await listTools());
                    break;

                case 'tool':
                    if (req.method === 'POST') {
                        const body = await readBody(req);
                        if (!body.name) {
                            sendJSON(res, { error: 'Tool name required' }, 400);
                        } else {
                            const result = await runTool(body.name, body.args || {});
                            sendJSON(res, result);
                        }
                    } else {
                        sendJSON(res, { error: 'POST required' }, 405);
                    }
                    break;

                case 'health':
                    sendJSON(res, await getHealth());
                    break;

                case 'preview':
                    const articleId = parsedUrl.query.id;
                    if (!articleId) {
                        sendJSON(res, { error: 'Article ID required' }, 400);
                    } else {
                        sendJSON(res, await previewArticle(articleId));
                    }
                    break;

                case 'articles':
                    sendJSON(res, await listArticles());
                    break;

                default:
                    sendJSON(res, { error: 'Unknown API endpoint' }, 404);
            }
        } catch (err) {
            console.error('API error:', err);
            sendJSON(res, { error: 'Server error', details: err.message }, 500);
        }
        return;
    }

    // Static file serving
    let filePath = pathname === '/' ? '/index.html' : pathname;

    // Decode URL-encoded characters
    filePath = decodeURIComponent(filePath);

    // Serve meta files (ecosystem.json, researchers.json, agent-status.json)
    if (filePath.startsWith('/meta/') || filePath.match(/^\/\.\.\/meta\//)) {
        const metaFile = filePath.replace(/^\/(\.\.\/)?meta\//, '');
        const metaPath = path.join(DASHBOARD_DIR, '..', 'meta', metaFile);
        await serveStatic(req, res, metaPath);
        return;
    }

    // Serve log files
    if (filePath.startsWith('/.logs/') || filePath.match(/^\/\.\.\/\.logs\//)) {
        const logFile = filePath.replace(/^\/(\.\.\/)?\.logs\//, '');
        const logPath = path.join(DASHBOARD_DIR, '..', '.logs', logFile);
        await serveStatic(req, res, logPath);
        return;
    }

    // Serve wiki-content files (for article preview and graph links)
    if (filePath.startsWith('/wiki/') || filePath.match(/^\/\.\.\/not-wikipedia\//)) {
        // Map /wiki/ or /../not-wikipedia/ to actual wiki-content/wiki directory
        const articleFile = filePath.replace(/^\/(\.\.\/not-wikipedia|wiki)\//, '');
        const wikiPath = path.join(PROJECT_ROOT, 'wiki-content', 'wiki', articleFile);
        await serveStatic(req, res, wikiPath);
        return;
    }

    // Serve dashboard static files
    filePath = path.join(DASHBOARD_DIR, filePath);
    await serveStatic(req, res, filePath);
}

// Check if a port is available
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const tester = net.createServer()
            .once('error', () => resolve(false))
            .once('listening', () => {
                tester.close(() => resolve(true));
            })
            .listen(port, '127.0.0.1');
    });
}

// Find an available port in range
async function findAvailablePort() {
    // First check if user specified a port via env
    const envPort = process.env.DASHBOARD_PORT;
    if (envPort) {
        const port = parseInt(envPort, 10);
        if (await isPortAvailable(port)) {
            return port;
        }
        console.log(`Warning: Port ${port} is in use, searching for alternative...`);
    }

    // Search in our dedicated range
    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
        if (await isPortAvailable(port)) {
            return port;
        }
    }

    throw new Error(`No available ports in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
}

// Create and start server
async function startServer() {
    const port = await findAvailablePort();
    const server = http.createServer(handleRequest);

    server.listen(port, '127.0.0.1', () => {
        const pad = (s, len) => s + ' '.repeat(Math.max(0, len - s.length));
        console.log(`
╔════════════════════════════════════════════════════════════╗
║         Not-Wikipedia Dashboard Server                     ║
╠════════════════════════════════════════════════════════════╣
║  Dashboard:  ${pad(`http://localhost:${port}`, 43)}║
║  Agent Live: ${pad(`http://localhost:${port}/agent-live.html`, 43)}║
╠════════════════════════════════════════════════════════════╣
║  API Endpoints:                                            ║
║    GET  /api/status   - Agent status                       ║
║    POST /api/start    - Start agent                        ║
║    POST /api/stop     - Stop agent                         ║
║    GET  /api/logs     - Agent logs                         ║
║    GET  /api/tools    - List MCP tools                     ║
║    POST /api/tool     - Run MCP tool                       ║
║    GET  /api/health   - Ecosystem health                   ║
╚════════════════════════════════════════════════════════════╝
Press Ctrl+C to stop
`);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nShutting down...');
        if (agentProcess && !agentProcess.killed) {
            agentProcess.kill('SIGTERM');
        }
        server.close(() => {
            process.exit(0);
        });
    });

    process.on('SIGTERM', () => {
        console.log('\nReceived SIGTERM, shutting down...');
        if (agentProcess && !agentProcess.killed) {
            agentProcess.kill('SIGTERM');
        }
        server.close(() => {
            process.exit(0);
        });
    });
}

// Start the server
startServer().catch(err => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
});
