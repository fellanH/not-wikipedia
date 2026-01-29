#!/bin/bash
set -uo pipefail

# =============================================================================
# CONFIGURATION
# =============================================================================
PARALLEL_WORKERS=${PARALLEL_WORKERS:-3}  # Number of parallel agents (env override)
MAX_LOOPS_PER_WORKER=${MAX_LOOPS_PER_WORKER:-100}  # Set to 0 for unlimited loops per worker
LOG_DIR="logs"
WIKI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/../wiki-content/wiki"
CONTENT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/../wiki-content"
MCP_DIR="../mcp"
MAX_LOGS=100  # Keep only last 100 log files
HEALTH_CHECK_INTERVAL=10  # Full health check every N total loops
MAX_DISCOVERY_DEPTH=3  # Maximum recursion depth for Content Fractal
AUTO_PUBLISH=${AUTO_PUBLISH:-true}  # Auto-publish to content repo after article creation
VERCEL_DEPLOY=${VERCEL_DEPLOY:-false}  # Trigger Vercel deploy after publish
USE_LIVE_CRAWL=${USE_LIVE_CRAWL:-false}  # Use live 404 crawling instead of database
MAX_CRAWL_PAGES=${MAX_CRAWL_PAGES:-20}  # Max pages to crawl when using live crawl

# Coordination files
COORDINATOR_LOCK="/tmp/ralph-coordinator.lock"
TASK_LOCK="/tmp/ralph-task.lock"
COPY_LOCK="/tmp/ralph-copy.lock"
WORKER_PIDS=()
WORKER_COMPLETED=()  # Track workers that finished max loops (not crashed)
GLOBAL_LOOP_COUNT="/tmp/ralph-loop-count"
WORKER_DONE_DIR="/tmp/ralph-worker-done"

# Colors for output (with worker prefix support)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Worker colors for visual distinction
WORKER_COLORS=('\033[0;36m' '\033[0;33m' '\033[0;35m' '\033[0;32m' '\033[0;34m' '\033[0;31m')

# =============================================================================
# LOGGING WITH WORKER PREFIX
# =============================================================================
log() {
  local worker_id="${WORKER_ID:-0}"
  local color="${WORKER_COLORS[$((worker_id % ${#WORKER_COLORS[@]}))]}"
  local prefix="[W${worker_id}]"
  echo -e "${color}${prefix}${NC} $*" >&2
}

log_success() { log "${GREEN}✓${NC} $*"; }
log_error() { log "${RED}✗${NC} $*"; }
log_warn() { log "${YELLOW}!${NC} $*"; }
log_info() { log "${CYAN}→${NC} $*"; }

# =============================================================================
# LOCK PRIMITIVES (for coordination between workers)
# =============================================================================
acquire_file_lock() {
  local lock_file="$1"
  local timeout="${2:-30}"
  local waited=0

  while ! mkdir "$lock_file" 2>/dev/null; do
    if [[ $waited -ge $timeout ]]; then
      return 1
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  return 0
}

release_file_lock() {
  local lock_file="$1"
  rmdir "$lock_file" 2>/dev/null || true
}

# =============================================================================
# COORDINATOR LOCK (only one coordinator process)
# =============================================================================
acquire_coordinator_lock() {
  if [[ -f "$COORDINATOR_LOCK" ]]; then
    local pid=$(cat "$COORDINATOR_LOCK" 2>/dev/null)
    if ps -p "$pid" > /dev/null 2>&1; then
      echo -e "${RED}Another coordinator is already running (PID: $pid). Exiting.${NC}" >&2
      exit 1
    else
      echo -e "${YELLOW}Stale coordinator lock detected. Removing...${NC}" >&2
      rm -f "$COORDINATOR_LOCK"
    fi
  fi
  echo $$ > "$COORDINATOR_LOCK"
  echo -e "${GREEN}✓${NC} Coordinator lock acquired (PID: $$)" >&2
}

release_coordinator_lock() {
  rm -f "$COORDINATOR_LOCK"
}

# =============================================================================
# CLEANUP (coordinator handles all worker cleanup)
# =============================================================================
cleanup() {
  echo "" >&2
  echo -e "${YELLOW}Shutting down coordinator and all workers...${NC}" >&2

  # Kill all worker processes
  for pid in "${WORKER_PIDS[@]}"; do
    if ps -p "$pid" > /dev/null 2>&1; then
      echo -e "  Stopping worker PID $pid..." >&2
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
    fi
  done

  # Clean up lock files
  rm -f "$TASK_LOCK.dir" 2>/dev/null
  rmdir "$TASK_LOCK.dir" 2>/dev/null || true
  rmdir "$COPY_LOCK.dir" 2>/dev/null || true
  rm -f "$GLOBAL_LOOP_COUNT"

  # Clean up any orphaned isolation directories and done markers
  rm -rf /tmp/ralph-worker-* 2>/dev/null
  rm -rf "$WORKER_DONE_DIR" 2>/dev/null

  release_coordinator_lock
  echo -e "${GREEN}✓${NC} Shutdown complete" >&2
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# =============================================================================
# GLOBAL LOOP COUNTER (atomic increment across workers)
# =============================================================================
increment_global_loop() {
  acquire_file_lock "${GLOBAL_LOOP_COUNT}.lock" 10 || return 1
  local count=$(cat "$GLOBAL_LOOP_COUNT" 2>/dev/null || echo 0)
  count=$((count + 1))
  echo "$count" > "$GLOBAL_LOOP_COUNT"
  release_file_lock "${GLOBAL_LOOP_COUNT}.lock"
  echo "$count"
}

get_global_loop() {
  cat "$GLOBAL_LOOP_COUNT" 2>/dev/null || echo 0
}

# =============================================================================
# ISOLATED ENVIRONMENT MANAGEMENT (per-worker)
# =============================================================================
setup_isolation() {
  local worker_id="$1"
  local loop_num="$2"

  # Create isolated workspace with worker ID
  local iso_dir=$(mktemp -d "/tmp/ralph-worker${worker_id}-loop${loop_num}-XXXXXX")
  log_info "Setting up isolated environment: ${iso_dir}"

  # Create directory structure
  mkdir -p "$iso_dir/dist/wiki"

  # Copy necessary files into isolation
  cp "CONTRIBUTING.md" "$iso_dir/" 2>/dev/null || true

  # Symlink existing wiki pages (read-only reference)
  local abs_wiki_dir
  abs_wiki_dir=$(cd "$WIKI_DIR" 2>/dev/null && pwd)
  if [[ -d "$abs_wiki_dir" ]]; then
    for f in "$abs_wiki_dir"/*.html; do
      [[ -f "$f" ]] && ln -s "$f" "$iso_dir/dist/wiki/" 2>/dev/null || true
    done
  fi

  log_success "Isolated environment ready"
  echo "$iso_dir"
}

teardown_isolation() {
  local iso_dir="$1"
  local exit_code="$2"

  if [[ -z "$iso_dir" || ! -d "$iso_dir" ]]; then
    return 0
  fi

  log_info "Collecting results from isolated environment..."

  # Acquire copy lock to prevent race conditions when writing to shared wiki dir
  if ! acquire_file_lock "${COPY_LOCK}.dir" 30; then
    log_error "Failed to acquire copy lock, skipping result collection"
    rm -rf "$iso_dir"
    return 1
  fi

  # Copy new/modified HTML files back to main wiki directory
  local copied=0
  for f in "$iso_dir/dist/wiki"/*.html; do
    if [[ -f "$f" && ! -L "$f" ]]; then
      local basename_f=$(basename "$f")
      cp "$f" "$WIKI_DIR/$basename_f"
      log_success "Copied: $basename_f"
      ((copied++))
    fi
  done

  release_file_lock "${COPY_LOCK}.dir"

  if [[ $copied -eq 0 ]]; then
    log_warn "No new files to copy"
  else
    log_success "Copied $copied file(s) to wiki directory"
  fi

  # Clean up isolation directory
  rm -rf "$iso_dir"
  log_success "Isolated environment cleaned up"
}

# =============================================================================
# FETCH TASK FROM MCP TOOL (with locking for atomic task assignment)
# =============================================================================
fetch_task() {
  log_info "Fetching next task from MCP tool..."

  # Acquire task lock to ensure only one worker fetches at a time
  if ! acquire_file_lock "${TASK_LOCK}.dir" 30; then
    log_error "Failed to acquire task lock"
    return 1
  fi

  # Build options based on environment
  local crawl_opts=""
  if [[ "$USE_LIVE_CRAWL" == "true" ]]; then
    crawl_opts="use_live_crawl: true, max_crawl_pages: ${MAX_CRAWL_PAGES}"
    log_info "Using live 404 crawl mode (max pages: ${MAX_CRAWL_PAGES})"
  fi

  local task_json
  task_json=$(node -e "
const { tool } = require('./${MCP_DIR}/dist/tools/wiki-next-task.js');
tool.handler({ ${crawl_opts} }).then(r => console.log(r.content[0].text));
" 2>/dev/null)

  release_file_lock "${TASK_LOCK}.dir"

  if [[ -z "$task_json" ]]; then
    log_error "Failed to fetch task from MCP tool"
    return 1
  fi

  # Validate JSON
  if ! echo "$task_json" | node -e "
    try {
      JSON.parse(require('fs').readFileSync(0, 'utf8'));
      process.exit(0);
    } catch (e) {
      process.exit(1);
    }
  " 2>/dev/null; then
    log_error "Invalid JSON received from MCP tool"
    return 1
  fi

  echo "$task_json"
}

# =============================================================================
# UPDATE PROMPT.md WITH TASK
# =============================================================================
update_prompt() {
  local task_json="$1"
  local prompt_file="$2"

  # Extract fields from JSON
  local output_path=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.outputPath || 'dist/wiki/*.html')")
  local infobox_color=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.infoboxColor || '')")
  local seed_mode=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.seedMode || 'single')")

  # Extract seeds as formatted text
  local seeds_text=$(echo "$task_json" | node -e "
    const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const seeds = d.seeds || [];
    seeds.forEach((s, i) => {
      if (i > 0) console.log('');
      console.log('> \"' + s.text + '\"');
      console.log('> — ' + s.source);
    });
  ")

  # Display task info
  log ""
  log "${BLUE}══════════════════════════════════════════${NC}"
  log "${BLUE}   SEEDS (${seed_mode})${NC}"
  log "${BLUE}══════════════════════════════════════════${NC}"
  echo "$task_json" | node -e "
    const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    (d.seeds || []).forEach(s => {
      const preview = s.text.length > 50 ? s.text.slice(0, 50) + '...' : s.text;
      console.log('  \"' + preview + '\"');
    });
  " >&2
  log "${BLUE}══════════════════════════════════════════${NC}"

  # Write PROMPT.md
  cat > "$prompt_file" << 'HEADER'
# Not-Wikipedia
HEADER

  if [[ -n "$seeds_text" ]]; then
    echo "" >> "$prompt_file"
    echo "$seeds_text" >> "$prompt_file"
  fi

  cat >> "$prompt_file" << EOF

---
Output: \`${output_path}\`
Template: [CONTRIBUTING.md](CONTRIBUTING.md)
Color: ${infobox_color}
EOF

  log_success "Updated ${prompt_file}"
}

# =============================================================================
# ECOSYSTEM HEALTH CHECK (run by coordinator only)
# =============================================================================
health_check() {
  echo -e "\n${BLUE}══════════════════════════════════════════${NC}" >&2
  echo -e "${BLUE}   ECOSYSTEM HEALTH CHECK${NC}" >&2
  echo -e "${BLUE}══════════════════════════════════════════${NC}" >&2

  local tmp_dir=$(mktemp -d)
  trap "rm -rf '$tmp_dir'" RETURN

  find "$WIKI_DIR" -maxdepth 1 -name "*.html" -type f -exec basename {} \; 2>/dev/null | sort > "$tmp_dir/files"
  local article_count=$(wc -l < "$tmp_dir/files" | tr -d ' ')
  echo -e "${GREEN}✓${NC} Articles: $article_count" >&2
  echo -e "${GREEN}✓${NC} Active workers: ${#WORKER_PIDS[@]}" >&2
  echo -e "${GREEN}✓${NC} Global loop count: $(get_global_loop)" >&2

  echo -e "${BLUE}══════════════════════════════════════════${NC}\n" >&2
}

# =============================================================================
# RECURSIVE DISCOVERY (with locking)
# =============================================================================
run_discovery() {
  local article_filename="$1"

  if [[ -z "$article_filename" || "$article_filename" == "*.html" ]]; then
    return 0
  fi

  log_info "Running discovery for: $article_filename"

  # Acquire lock to prevent duplicate discoveries
  if ! acquire_file_lock "${TASK_LOCK}.dir" 10; then
    log_warn "Skipping discovery (lock busy)"
    return 0
  fi

  node -e "
const { tool } = require('./${MCP_DIR}/dist/tools/wiki-discover.js');
tool.handler({ source_article: '${article_filename}', max_depth: ${MAX_DISCOVERY_DEPTH} })
  .then(r => console.log(r.content[0].text))
  .catch(e => console.error('Discovery error:', e.message));
" 2>&1 | while read -r line; do log "$line"; done

  release_file_lock "${TASK_LOCK}.dir"
}

# =============================================================================
# PUBLISH TO CONTENT REPO (for auto-deployment)
# =============================================================================
publish_article() {
  local article_filename="$1"

  if [[ "$AUTO_PUBLISH" != "true" ]]; then
    return 0
  fi

  if [[ -z "$article_filename" || "$article_filename" == "*.html" ]]; then
    return 0
  fi

  log_info "Publishing to content repo: $article_filename"

  # Acquire lock to prevent concurrent publishes
  if ! acquire_file_lock "${COPY_LOCK}.dir" 10; then
    log_warn "Skipping publish (lock busy)"
    return 0
  fi

  local publish_result
  publish_result=$(node -e "
const { tool } = require('./${MCP_DIR}/dist/tools/wiki-git-publish.js');
tool.handler({ filename: '${article_filename}' })
  .then(r => console.log(r.content[0].text))
  .catch(e => console.error('Publish error:', e.message));
" 2>&1)

  release_file_lock "${COPY_LOCK}.dir"

  # Log the result
  echo "$publish_result" | while read -r line; do log "$line"; done

  # Trigger Vercel deploy if enabled
  if [[ "$VERCEL_DEPLOY" == "true" ]]; then
    log_info "Triggering Vercel deployment..."
    (cd "$(dirname "$0")/../../wiki-content" 2>/dev/null && vercel --prod --yes 2>&1 | head -5) | while read -r line; do log "$line"; done
  fi

  log_success "Published: $article_filename"
}

# =============================================================================
# LOG ROTATION
# =============================================================================
rotate_logs() {
  local log_count=$(find "$LOG_DIR" -name "*.json" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [[ $log_count -gt $MAX_LOGS ]]; then
    cd "$LOG_DIR" 2>/dev/null || return
    ls -t *.json 2>/dev/null | tail -n +$((MAX_LOGS + 1)) | xargs rm -f 2>/dev/null || true
    cd - > /dev/null 2>&1
  fi
}

# =============================================================================
# WORKER PROCESS
# Each worker runs in a loop, fetching and processing tasks independently
# =============================================================================
run_worker() {
  local worker_id="$1"
  export WORKER_ID="$worker_id"

  local worker_loop=0
  local isolation_dir=""

  # Worker cleanup trap
  worker_cleanup() {
    [[ -n "$isolation_dir" && -d "$isolation_dir" ]] && rm -rf "$isolation_dir"
    log "Worker $worker_id shutting down"
    exit 0
  }
  trap worker_cleanup SIGINT SIGTERM EXIT

  log_success "Worker $worker_id started"

  # Stagger worker start to avoid thundering herd
  sleep "$((worker_id * 2))"

  while :; do
    ((worker_loop++))
    local global_loop=$(increment_global_loop)
    local start_time=$(date +%s)

    log ""
    log "=========================================="
    log "Worker $worker_id | Loop $worker_loop (Global: $global_loop)"
    log "=========================================="

    # Fetch task
    local task_json
    task_json=$(fetch_task)
    if [[ $? -ne 0 || -z "$task_json" ]]; then
      log_error "Failed to fetch task. Retrying in 10s..."
      sleep 10
      continue
    fi

    # Setup isolation
    isolation_dir=$(setup_isolation "$worker_id" "$worker_loop")
    if [[ -z "$isolation_dir" ]]; then
      log_error "Failed to setup isolation"
      sleep 5
      continue
    fi

    # Create prompt in isolation
    local prompt_file="$isolation_dir/PROMPT.md"
    update_prompt "$task_json" "$prompt_file"

    # Generate log file path
    local log_file="$LOG_DIR/run-$(date +%Y%m%d-%H%M%S)-w${worker_id}-loop${worker_loop}.json"

    # Snapshot files in wiki directory BEFORE running agent
    # (MCP tools write directly here, bypassing isolation)
    local snapshot_file=$(mktemp)
    find "$WIKI_DIR" -maxdepth 1 -name "*.html" -type f | sort > "$snapshot_file"

    # Run Claude in isolated environment
    log_info "Running Claude agent..."
    claude -p --verbose --output-format stream-json \
      --allowedTools "Edit,Write,Read,Glob,Grep,Bash" \
      --add-dir "$isolation_dir" \
      --include-partial-messages --dangerously-skip-permissions \
      < "$prompt_file" > "$log_file" 2>&1
    local claude_exit=$?

    local end_time=$(date +%s)
    local elapsed=$((end_time - start_time))

    log "Completed in $((elapsed/60))m $((elapsed%60))s (exit: $claude_exit)"

    # Detect new files by comparing before/after snapshots
    # This works whether agent uses MCP tools or Write tool
    local new_article=""
    local after_file=$(mktemp)
    find "$WIKI_DIR" -maxdepth 1 -name "*.html" -type f | sort > "$after_file"

    # Find files in after that aren't in before (new files)
    local new_files
    new_files=$(comm -13 "$snapshot_file" "$after_file")
    rm -f "$snapshot_file" "$after_file"

    if [[ -n "$new_files" ]]; then
      # Get the first new file (usually just one per loop)
      new_article=$(basename "$(echo "$new_files" | head -1)")
      log_success "New article detected: $new_article"
    fi

    # Also check isolation dir for files created via Write tool
    for f in "$isolation_dir/dist/wiki"/*.html; do
      if [[ -f "$f" && ! -L "$f" ]]; then
        local iso_article=$(basename "$f")
        if [[ -z "$new_article" ]]; then
          new_article="$iso_article"
        fi
        # Copy from isolation to wiki dir
        cp "$f" "$WIKI_DIR/$iso_article"
        log_success "Copied from isolation: $iso_article"
      fi
    done

    # Clean up isolation directory
    rm -rf "$isolation_dir"
    isolation_dir=""
    log_success "Isolated environment cleaned up"

    # Run discovery and publish for new article
    if [[ -n "$new_article" ]]; then
      run_discovery "$new_article"
      # Publish to content repo for auto-deployment
      publish_article "$new_article"
    else
      log_warn "No new article detected"
    fi

    # Check loop limit
    if [[ $MAX_LOOPS_PER_WORKER -gt 0 && $worker_loop -ge $MAX_LOOPS_PER_WORKER ]]; then
      log "Reached max loops ($MAX_LOOPS_PER_WORKER). Worker exiting."
      # Mark this worker as completed (not crashed)
      mkdir -p "$WORKER_DONE_DIR"
      touch "$WORKER_DONE_DIR/worker-$worker_id"
      break
    fi

    # Small delay between loops
    sleep 2
  done
}

# =============================================================================
# MAIN COORDINATOR
# =============================================================================

# Acquire coordinator lock (prevents multiple coordinators)
acquire_coordinator_lock

# Initialize
mkdir -p "$LOG_DIR"
echo "0" > "$GLOBAL_LOOP_COUNT"
rotate_logs

echo "" >&2
echo -e "${MAGENTA}══════════════════════════════════════════════════════════${NC}" >&2
echo -e "${MAGENTA}   RALPH - Parallel Agent Coordinator${NC}" >&2
echo -e "${MAGENTA}   Workers: $PARALLEL_WORKERS | Max loops/worker: $MAX_LOOPS_PER_WORKER${NC}" >&2
echo -e "${MAGENTA}   Auto-publish: $AUTO_PUBLISH | Vercel deploy: $VERCEL_DEPLOY${NC}" >&2
echo -e "${MAGENTA}   Live crawl: $USE_LIVE_CRAWL (max pages: $MAX_CRAWL_PAGES)${NC}" >&2
echo -e "${MAGENTA}══════════════════════════════════════════════════════════${NC}" >&2
echo "" >&2

# Initial health check
health_check

# Spawn worker processes
echo -e "${CYAN}Spawning $PARALLEL_WORKERS parallel workers...${NC}" >&2
for ((i=1; i<=PARALLEL_WORKERS; i++)); do
  run_worker "$i" &
  local_pid=$!
  WORKER_PIDS+=($local_pid)
  echo -e "  ${GREEN}✓${NC} Started worker $i (PID: $local_pid)" >&2
done

echo "" >&2
echo -e "${GREEN}All workers started. Coordinator monitoring...${NC}" >&2
echo -e "${YELLOW}Press Ctrl+C to stop all workers${NC}" >&2
echo "" >&2

# Monitor loop - periodically check health and restart dead workers
health_check_counter=0
mkdir -p "$WORKER_DONE_DIR"

while :; do
  sleep 10
  ((health_check_counter++))

  # Count completed and active workers
  completed_count=0
  active_count=0

  # Check for dead workers and restart them (unless they completed normally)
  for i in "${!WORKER_PIDS[@]}"; do
    pid="${WORKER_PIDS[$i]}"
    worker_id=$((i + 1))

    if [[ -f "$WORKER_DONE_DIR/worker-$worker_id" ]]; then
      # Worker completed its max loops normally
      ((completed_count++))
      continue
    fi

    if ps -p "$pid" > /dev/null 2>&1; then
      # Worker still running
      ((active_count++))
    else
      # Worker died (crashed) - restart it
      echo -e "${YELLOW}Worker $worker_id (PID: $pid) crashed. Restarting...${NC}" >&2
      run_worker "$worker_id" &
      WORKER_PIDS[$i]=$!
      echo -e "${GREEN}✓${NC} Restarted worker $worker_id (new PID: ${WORKER_PIDS[$i]})" >&2
      ((active_count++))
    fi
  done

  # Exit if all workers have completed their max loops
  if [[ $MAX_LOOPS_PER_WORKER -gt 0 && $completed_count -eq $PARALLEL_WORKERS ]]; then
    echo -e "${GREEN}All workers completed their max loops. Shutting down.${NC}" >&2
    rm -rf "$WORKER_DONE_DIR"
    break
  fi

  # Periodic health check
  if [[ $((health_check_counter % HEALTH_CHECK_INTERVAL)) -eq 0 ]]; then
    health_check
    rotate_logs
  fi
done
