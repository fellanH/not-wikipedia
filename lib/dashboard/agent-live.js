/**
 * Agent Live Dashboard - Real-time visualization of the ralph.sh agent loop
 */

// =============================================================================
// Configuration
// =============================================================================
const CONFIG = {
  statusFile: "../meta/agent-status.json",
  ecosystemFile: "../meta/ecosystem.json",
  pollInterval: 1000, // Poll every 1 second
  activeThreshold: 30000, // Consider inactive if no update for 30s
};

// =============================================================================
// State
// =============================================================================
let state = {
  active: false,
  globalLoop: 0,
  workers: [],
  recentArticles: [],
  taskQueue: {},
  lastUpdate: null,
  animationFrame: null,
};

// Phase configuration for the loop diagram
const PHASES = [
  { id: "fetching_task", label: "Fetch Task", color: "#00bcd4", angle: -90 },
  { id: "setup", label: "Setup", color: "#ff9800", angle: -18 },
  { id: "running_claude", label: "Run Claude", color: "#9c27b0", angle: 54 },
  { id: "discovery", label: "Discovery", color: "#4caf50", angle: 126 },
  { id: "publishing", label: "Publish", color: "#2196f3", angle: 198 },
];

const INACTIVE_COLOR = "#a2a9b1";

// =============================================================================
// Polling Manager
// =============================================================================
class PollingManager {
  constructor() {
    this.intervals = new Map();
    this.cache = new Map();
  }

  register(key, url, intervalMs, onChange) {
    // Clear existing interval if any
    this.stop(key);

    const poll = async () => {
      try {
        const response = await fetch(url + "?t=" + Date.now());
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();
        const cached = this.cache.get(key);
        const cacheStr = JSON.stringify(cached);
        const dataStr = JSON.stringify(data);
        if (dataStr !== cacheStr) {
          this.cache.set(key, data);
          onChange(data, cached);
        }
      } catch (e) {
        // Silently handle - agent might be updating file
        onChange(null, this.cache.get(key), e);
      }
    };

    poll(); // Initial fetch
    this.intervals.set(key, setInterval(poll, intervalMs));
  }

  stop(key) {
    if (this.intervals.has(key)) {
      clearInterval(this.intervals.get(key));
      this.intervals.delete(key);
    }
  }

  stopAll() {
    for (const key of this.intervals.keys()) {
      this.stop(key);
    }
  }
}

const poller = new PollingManager();

// =============================================================================
// Canvas Rendering - Agent Loop Diagram
// =============================================================================
class LoopCanvas {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");
    this.centerX = this.canvas.width / 2;
    this.centerY = this.canvas.height / 2;
    this.radius = 130;
    this.nodeRadius = 40;
    this.particles = [];
    this.time = 0;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawConnections(activePhaseIdx, isActive) {
    const ctx = this.ctx;

    for (let i = 0; i < PHASES.length; i++) {
      const phase = PHASES[i];
      const nextPhase = PHASES[(i + 1) % PHASES.length];

      const angle1 = (phase.angle * Math.PI) / 180;
      const angle2 = (nextPhase.angle * Math.PI) / 180;

      const x1 = this.centerX + Math.cos(angle1) * this.radius;
      const y1 = this.centerY + Math.sin(angle1) * this.radius;
      const x2 = this.centerX + Math.cos(angle2) * this.radius;
      const y2 = this.centerY + Math.sin(angle2) * this.radius;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);

      if (isActive && i === activePhaseIdx) {
        ctx.strokeStyle = phase.color;
        ctx.lineWidth = 3;
      } else {
        ctx.strokeStyle = isActive ? "#ddd" : "#e0e0e0";
        ctx.lineWidth = 2;
      }
      ctx.stroke();
    }
  }

  drawNode(phase, isActive, isCurrent) {
    const ctx = this.ctx;
    const angle = (phase.angle * Math.PI) / 180;
    const x = this.centerX + Math.cos(angle) * this.radius;
    const y = this.centerY + Math.sin(angle) * this.radius;

    // Glow effect for active phase
    if (isCurrent && isActive) {
      ctx.save();
      ctx.shadowColor = phase.color;
      ctx.shadowBlur = 20 + Math.sin(this.time * 0.1) * 5;
      ctx.beginPath();
      ctx.arc(x, y, this.nodeRadius + 5, 0, Math.PI * 2);
      ctx.fillStyle = phase.color + "40";
      ctx.fill();
      ctx.restore();
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(x, y, this.nodeRadius, 0, Math.PI * 2);

    if (isActive) {
      ctx.fillStyle = isCurrent ? phase.color : "#fff";
      ctx.strokeStyle = phase.color;
    } else {
      ctx.fillStyle = "#f5f5f5";
      ctx.strokeStyle = INACTIVE_COLOR;
    }
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();

    // Label
    ctx.fillStyle =
      isActive && isCurrent ? "#fff" : isActive ? phase.color : INACTIVE_COLOR;
    ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Split label into lines if needed
    const words = phase.label.split(" ");
    if (words.length > 1) {
      ctx.fillText(words[0], x, y - 6);
      ctx.fillText(words[1], x, y + 8);
    } else {
      ctx.fillText(phase.label, x, y);
    }

    return { x, y };
  }

  drawCenter(isActive, activeWorkers) {
    const ctx = this.ctx;

    // Center circle
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, 50, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? "#f0f7ff" : "#f5f5f5";
    ctx.strokeStyle = isActive ? "#36c" : INACTIVE_COLOR;
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    // Status text
    ctx.fillStyle = isActive ? "#36c" : INACTIVE_COLOR;
    ctx.font = "bold 14px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(isActive ? "ACTIVE" : "IDLE", this.centerX, this.centerY - 8);

    ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(
      activeWorkers + " worker" + (activeWorkers !== 1 ? "s" : ""),
      this.centerX,
      this.centerY + 10,
    );
  }

  drawWorkerIndicators(workers, isActive) {
    const ctx = this.ctx;
    const activeWorkers = workers.filter((w) => w.phase && w.phase !== "idle");

    activeWorkers.forEach((worker, idx) => {
      const phaseIdx = PHASES.findIndex((p) => p.id === worker.phase);
      if (phaseIdx === -1) return;

      const phase = PHASES[phaseIdx];
      const angle = (phase.angle * Math.PI) / 180;
      const x = this.centerX + Math.cos(angle) * (this.radius + 55);
      const y = this.centerY + Math.sin(angle) * (this.radius + 55);

      // Worker badge
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = getWorkerColor(worker.id);
      ctx.fill();

      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("W" + worker.id, x, y);
    });
  }

  drawParticles(activePhaseIdx, isActive) {
    if (!isActive) return;

    const ctx = this.ctx;
    const phase = PHASES[activePhaseIdx];
    const nextPhase = PHASES[(activePhaseIdx + 1) % PHASES.length];

    const angle1 = (phase.angle * Math.PI) / 180;
    const angle2 = (nextPhase.angle * Math.PI) / 180;

    const x1 = this.centerX + Math.cos(angle1) * this.radius;
    const y1 = this.centerY + Math.sin(angle1) * this.radius;
    const x2 = this.centerX + Math.cos(angle2) * this.radius;
    const y2 = this.centerY + Math.sin(angle2) * this.radius;

    // Animated particle along the connection
    const progress = (this.time % 100) / 100;
    const px = x1 + (x2 - x1) * progress;
    const py = y1 + (y2 - y1) * progress;

    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = phase.color;
    ctx.fill();
  }

  render(workers, isActive) {
    this.clear();
    this.time++;

    // Find the dominant active phase (most workers in that phase)
    const phaseCounts = {};
    workers.forEach((w) => {
      if (w.phase && w.phase !== "idle") {
        phaseCounts[w.phase] = (phaseCounts[w.phase] || 0) + 1;
      }
    });

    let activePhaseIdx = -1;
    let maxCount = 0;
    PHASES.forEach((p, idx) => {
      if ((phaseCounts[p.id] || 0) > maxCount) {
        maxCount = phaseCounts[p.id];
        activePhaseIdx = idx;
      }
    });

    const activeWorkerCount = workers.filter(
      (w) => w.phase && w.phase !== "idle",
    ).length;

    // Draw layers
    this.drawConnections(activePhaseIdx, isActive);

    PHASES.forEach((phase, idx) => {
      const isCurrent = idx === activePhaseIdx;
      this.drawNode(phase, isActive, isCurrent);
    });

    this.drawCenter(isActive, activeWorkerCount);

    if (isActive && activePhaseIdx >= 0) {
      this.drawParticles(activePhaseIdx, isActive);
    }

    this.drawWorkerIndicators(workers, isActive);
  }
}

// Worker color helper
function getWorkerColor(id) {
  const colors = [
    "#00bcd4",
    "#ff9800",
    "#9c27b0",
    "#4caf50",
    "#2196f3",
    "#f44336",
  ];
  return colors[(id - 1) % colors.length];
}

// =============================================================================
// UI Updates
// =============================================================================
function updateUI(data) {
  if (!data) return;

  // Update state
  state = { ...state, ...data };

  // Check if agent is active (recent update)
  const lastUpdateTime = new Date(data.timestamp).getTime();
  const now = Date.now();
  state.active = data.active && now - lastUpdateTime < CONFIG.activeThreshold;
  state.lastUpdate = lastUpdateTime;

  // Update badge
  const badge = document.getElementById("agent-badge");
  badge.className = "status-badge " + (state.active ? "active" : "inactive");
  badge.textContent = state.active ? "Active" : "Inactive";

  // Update status cards
  document.getElementById("global-loop").textContent = data.globalLoop || 0;

  const activeWorkers = (data.workers || []).filter(
    (w) => w.phase && w.phase !== "idle",
  ).length;
  document.getElementById("active-workers").textContent =
    activeWorkers + "/" + (data.workers || []).length;

  document.getElementById("recent-count").textContent = (
    data.recentArticles || []
  ).length;

  const timeSince = formatTimeSince(lastUpdateTime);
  document.getElementById("last-update-time").textContent = timeSince;

  // Update workers grid
  updateWorkersGrid(data.workers || []);

  // Update task queue (from ecosystem data or status)
  updateTaskQueue(data.taskQueue || {});

  // Update recent articles
  updateRecentArticles(data.recentArticles || []);

  // Update connection status
  const connStatus = document.getElementById("connection-status");
  connStatus.textContent = "Connected";
  connStatus.className = "connected";
}

function updateWorkersGrid(workers) {
  const grid = document.getElementById("workers-grid");

  if (workers.length === 0) {
    grid.innerHTML = '<p class="empty-state">No workers registered</p>';
    return;
  }

  grid.innerHTML = workers
    .map((worker) => {
      const isActive = worker.phase && worker.phase !== "idle";
      const phaseName = formatPhaseName(worker.phase);
      const taskInfo = worker.task
        ? worker.task.filename || worker.task.type
        : "";

      return `
            <div class="worker-item ${isActive ? "active" : ""}" data-worker="${worker.id}">
                <div class="worker-header">
                    <span class="worker-name">
                        <span class="worker-indicator"></span>
                        Worker ${worker.id}
                    </span>
                    <span class="worker-phase">${phaseName}</span>
                </div>
                ${taskInfo ? `<div class="worker-task">${taskInfo}</div>` : ""}
            </div>
        `;
    })
    .join("");
}

function updateTaskQueue(queue) {
  const maxQueue = 50; // For percentage calculation

  const broken = queue.brokenLinks || 0;
  const orphan = queue.orphans || 0;
  const discovery = queue.discoveryQueue || 0;

  document.getElementById("queue-broken").style.width =
    Math.min((broken / maxQueue) * 100, 100) + "%";
  document.getElementById("count-broken").textContent = broken;

  document.getElementById("queue-orphan").style.width =
    Math.min((orphan / maxQueue) * 100, 100) + "%";
  document.getElementById("count-orphan").textContent = orphan;

  document.getElementById("queue-discovery").style.width =
    Math.min((discovery / maxQueue) * 100, 100) + "%";
  document.getElementById("count-discovery").textContent = discovery;
}

function updateRecentArticles(articles) {
  const container = document.getElementById("recent-articles");

  if (articles.length === 0) {
    container.innerHTML = '<p class="empty-state">No articles created yet</p>';
    return;
  }

  container.innerHTML = articles
    .slice(0, 10)
    .map((article, idx) => {
      const time = formatTimeSince(new Date(article.createdAt).getTime());
      return `
            <div class="article-item ${idx === 0 ? "new" : ""}">
                <span class="article-name">${article.filename}</span>
                <span class="article-time">${time}</span>
            </div>
        `;
    })
    .join("");
}

function formatPhaseName(phase) {
  if (!phase) return "Idle";
  const names = {
    fetching_task: "Fetching",
    setup: "Setup",
    running_claude: "Running",
    discovery: "Discovery",
    publishing: "Publishing",
    idle: "Idle",
    starting: "Starting",
  };
  return names[phase] || phase;
}

function formatTimeSince(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return seconds + "s ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  return hours + "h ago";
}

function handleError(error) {
  const connStatus = document.getElementById("connection-status");
  connStatus.textContent = "Disconnected";
  connStatus.className = "error";
}

// =============================================================================
// Animation Loop
// =============================================================================
let loopCanvas;

function animate() {
  if (loopCanvas) {
    loopCanvas.render(state.workers || [], state.active);
  }
  state.animationFrame = requestAnimationFrame(animate);
}

// =============================================================================
// Fetch ecosystem data for task queue
// =============================================================================
function fetchEcosystemData() {
  fetch(CONFIG.ecosystemFile + "?t=" + Date.now())
    .then((r) => r.json())
    .then((data) => {
      if (data) {
        // Update task queue from ecosystem data
        const taskQueue = {
          brokenLinks: (data.brokenLinks || []).length,
          orphans: (data.orphanArticles || []).length,
          discoveryQueue: 0, // Would need separate query
        };
        updateTaskQueue(taskQueue);
      }
    })
    .catch(() => {}); // Silently fail
}

// =============================================================================
// Initialization
// =============================================================================
document.addEventListener("DOMContentLoaded", () => {
  // Initialize canvas
  loopCanvas = new LoopCanvas("loop-canvas");

  // Start animation loop
  animate();

  // Start polling for status
  poller.register(
    "status",
    CONFIG.statusFile,
    CONFIG.pollInterval,
    (data, prev, error) => {
      if (error) {
        handleError(error);
        return;
      }
      updateUI(data);
    },
  );

  // Also poll ecosystem data for task queue (less frequently)
  setInterval(fetchEcosystemData, 5000);
  fetchEcosystemData();

  // Initial render with empty state
  loopCanvas.render([], false);
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  poller.stopAll();
  if (state.animationFrame) {
    cancelAnimationFrame(state.animationFrame);
  }
});
