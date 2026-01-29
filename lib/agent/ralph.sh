#!/bin/bash
set -uo pipefail

MAX_LOOPS=100  # Set to 0 for unlimited loops
LOG_DIR="logs"
WIKI_DIR="../../dist/pages"
MCP_DIR="../mcp"
PROMPT_FILE="PROMPT.md"
LOCK_FILE="/tmp/ralph.lock"
MAX_LOGS=100  # Keep only last 100 log files
HEALTH_CHECK_INTERVAL=5  # Full health check every N loops (1 = every loop)
MAX_DISCOVERY_DEPTH=3  # Maximum recursion depth for Content Fractal
timer_pid=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# =============================================================================
# LOCK FILE MANAGEMENT
# =============================================================================
acquire_lock() {
  if [[ -f "$LOCK_FILE" ]]; then
    local pid=$(cat "$LOCK_FILE" 2>/dev/null)
    if ps -p "$pid" > /dev/null 2>&1; then
      echo -e "${RED}Another instance is already running (PID: $pid). Exiting.${NC}" >&2
      exit 1
    else
      echo -e "${YELLOW}Stale lock file detected. Removing...${NC}" >&2
      rm -f "$LOCK_FILE"
    fi
  fi
  echo $$ > "$LOCK_FILE"
  echo -e "${GREEN}✓${NC} Lock acquired" >&2
}

release_lock() {
  rm -f "$LOCK_FILE"
}

cleanup() {
  printf "\n" >&2
  echo "Shutting down..." >&2
  [[ -n "$timer_pid" ]] && kill "$timer_pid" 2>/dev/null
  wait "$timer_pid" 2>/dev/null
  release_lock
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Acquire lock at startup
acquire_lock

mkdir -p "$LOG_DIR"

# =============================================================================
# FETCH TASK FROM MCP TOOL
# =============================================================================
fetch_task() {
  echo -e "${CYAN}Fetching next task from MCP tool...${NC}" >&2

  local task_json
  task_json=$(node -e "
const { tool } = require('./${MCP_DIR}/dist/tools/wiki-next-task.js');
tool.handler({}).then(r => console.log(r.content[0].text));
" 2>/dev/null)

  if [[ -z "$task_json" ]]; then
    echo -e "${RED}Failed to fetch task from MCP tool${NC}" >&2
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
    echo -e "${RED}Invalid JSON received from MCP tool${NC}" >&2
    echo -e "${YELLOW}Response: ${task_json:0:200}...${NC}" >&2
    return 1
  fi

  echo "$task_json"
}

# =============================================================================
# UPDATE PROMPT.md WITH TASK (Multi-seed format)
# =============================================================================
update_prompt() {
  local task_json="$1"

  # Extract fields from new minimal JSON format
  local output_path=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.outputPath || 'not-wikipedia/*.html')")
  local infobox_color=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.infoboxColor || '')")
  local seed_mode=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.seedMode || 'single')")
  local depth=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.depth ?? 0)")
  local from_queue=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.fromDiscoveryQueue ? 'yes' : 'no')")

  # Extract seeds as formatted text (handles multiple seeds)
  local seeds_text=$(echo "$task_json" | node -e "
    const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const seeds = d.seeds || [];
    seeds.forEach((s, i) => {
      if (i > 0) console.log('');
      console.log('> \"' + s.text + '\"');
      console.log('> — ' + s.source);
    });
  ")

  # Display task info (minimal)
  echo -e "\n${BLUE}══════════════════════════════════════════${NC}" >&2
  echo -e "${BLUE}   SEEDS (${seed_mode})${NC}" >&2
  echo -e "${BLUE}══════════════════════════════════════════${NC}" >&2
  echo "$task_json" | node -e "
    const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    (d.seeds || []).forEach(s => {
      const preview = s.text.length > 60 ? s.text.slice(0, 60) + '...' : s.text;
      console.log('  \"' + preview + '\"');
      console.log('  — ' + s.source + ' [' + s.category + ']');
      console.log('');
    });
  " >&2
  echo -e "${CYAN}Output:${NC} $output_path" >&2
  echo -e "${CYAN}Color:${NC} $infobox_color" >&2
  if [[ "$from_queue" == "yes" ]]; then
    echo -e "${GREEN}Source:${NC} Discovery Queue (depth: $depth)" >&2
  fi
  echo -e "${BLUE}══════════════════════════════════════════${NC}\n" >&2

  # Write PROMPT.md (ultra-minimal - seeds + output path only)
  cat > "$PROMPT_FILE" << 'HEADER'
# Not-Wikipedia
HEADER

  # Add seeds
  if [[ -n "$seeds_text" ]]; then
    echo "" >> "$PROMPT_FILE"
    echo "$seeds_text" >> "$PROMPT_FILE"
  fi

  # Minimal output info
  cat >> "$PROMPT_FILE" << EOF

---
Output: \`${output_path}\`
Template: [CONTRIBUTING.md](CONTRIBUTING.md)
Color: ${infobox_color}
EOF

  echo -e "${GREEN}✓${NC} Updated ${PROMPT_FILE}" >&2
}

# =============================================================================
# ECOSYSTEM HEALTH CHECK (Optimized: Single-pass O(n) algorithm)
# Compatible with bash 3.2+ (no associative arrays)
# Scales linearly: O(n) vs original O(n²) for orphan detection
# =============================================================================
health_check() {
  echo -e "\n${BLUE}══════════════════════════════════════════${NC}" >&2
  echo -e "${BLUE}   ECOSYSTEM HEALTH CHECK${NC}" >&2
  echo -e "${BLUE}══════════════════════════════════════════${NC}" >&2

  local issues=0

  # -------------------------------------------------------------------------
  # Create temp files for set operations (bash 3.2 compatible)
  # -------------------------------------------------------------------------
  local tmp_dir=$(mktemp -d)
  trap "rm -rf '$tmp_dir'" RETURN

  local tmp_files="$tmp_dir/files"
  local tmp_all_links="$tmp_dir/all_links"
  local tmp_incoming="$tmp_dir/incoming"

  # -------------------------------------------------------------------------
  # OPTIMIZATION 1: Build file existence set once
  # -------------------------------------------------------------------------
  find "$WIKI_DIR" -maxdepth 1 -name "*.html" -type f -exec basename {} \; 2>/dev/null | sort > "$tmp_files"

  local article_count=$(wc -l < "$tmp_files" | tr -d ' ')
  echo -e "${GREEN}✓${NC} Articles: $article_count" >&2

  # -------------------------------------------------------------------------
  # OPTIMIZATION 2: Single-pass extraction of all links + placeholders
  # Extract all href links and incoming link targets in one grep pass per file
  # -------------------------------------------------------------------------
  echo -e "\n${YELLOW}Scanning ecosystem (single-pass)...${NC}" >&2

  local placeholders=0
  local placeholder_files=""

  # Extract all links from all files in parallel, with source tracking
  > "$tmp_all_links"
  > "$tmp_incoming"

  while IFS= read -r basename_f; do
    local f="$WIKI_DIR/$basename_f"

    # Check placeholders (fast string match)
    if grep -q "NEXT_PAGE_PLACEHOLDER" "$f" 2>/dev/null; then
      local count=$(grep -c "NEXT_PAGE_PLACEHOLDER" "$f" 2>/dev/null || echo 0)
      placeholders=$((placeholders + count))
      placeholder_files="$placeholder_files $basename_f"
    fi

    # Extract links: output "source|target" for broken link check
    grep -oE 'href="[^"]*\.html"' "$f" 2>/dev/null | sed 's/href="//;s/"$//' | while read -r link; do
      echo "$basename_f|$link" >> "$tmp_all_links"
      echo "$link" >> "$tmp_incoming"
    done
  done < "$tmp_files"

  # -------------------------------------------------------------------------
  # OPTIMIZATION 3: Batch broken link detection using comm
  # Instead of checking each link individually, use set difference
  # -------------------------------------------------------------------------
  local broken_links=0

  if [[ -s "$tmp_all_links" ]]; then
    # Extract unique link targets and find which don't exist
    cut -d'|' -f2 "$tmp_all_links" | sort -u > "$tmp_dir/link_targets"
    local broken_targets=$(comm -23 "$tmp_dir/link_targets" "$tmp_files")

    if [[ -n "$broken_targets" ]]; then
      echo -e "${RED}✗${NC} Broken links found:" >&2
      # For each broken target, find which files reference it
      for target in $broken_targets; do
        grep "|${target}$" "$tmp_all_links" | cut -d'|' -f1 | sort -u | while read -r src; do
          echo -e "  ${RED}BROKEN:${NC} $src -> $target" >&2
          ((broken_links++))
        done
      done
      ((issues++))
    else
      echo -e "${GREEN}✓${NC} No broken links" >&2
    fi
  else
    echo -e "${GREEN}✓${NC} No broken links" >&2
  fi

  # Report placeholders
  if [[ $placeholders -gt 0 ]]; then
    echo -e "${RED}✗${NC} Found $placeholders unresolved placeholders in:$placeholder_files" >&2
    ((issues++))
  else
    echo -e "${GREEN}✓${NC} No unresolved placeholders" >&2
  fi

  # -------------------------------------------------------------------------
  # OPTIMIZATION 4: O(n) orphan detection using set difference
  # Files with no incoming links = all_files - files_with_incoming_links
  # (Previously O(n²) - grepped all files for each file)
  # -------------------------------------------------------------------------
  echo -e "\n${YELLOW}Checking for orphan articles...${NC}" >&2

  local orphans=0

  if [[ -s "$tmp_incoming" ]]; then
    sort -u "$tmp_incoming" > "$tmp_dir/has_incoming"
  else
    > "$tmp_dir/has_incoming"
  fi

  # Find orphans (files with no incoming links, excluding index.html)
  while IFS= read -r basename_f; do
    if [[ "$basename_f" != "index.html" ]]; then
      ((orphans++))
      echo -e "  ${YELLOW}ORPHAN:${NC} $basename_f" >&2
    fi
  done < <(comm -23 "$tmp_files" "$tmp_dir/has_incoming" 2>/dev/null)

  if [[ $orphans -eq 0 ]]; then
    echo -e "${GREEN}✓${NC} No orphan articles" >&2
  else
    echo -e "${YELLOW}!${NC} Found $orphans orphan articles" >&2
  fi

  echo -e "${BLUE}══════════════════════════════════════════${NC}\n" >&2

  return $issues
}

# =============================================================================
# RECURSIVE DISCOVERY (Content Fractal)
# Scans newly created article and queues discovered concepts for generation
# =============================================================================
run_discovery() {
  local article_filename="$1"

  if [[ -z "$article_filename" || "$article_filename" == "*.html" ]]; then
    echo -e "${YELLOW}Skipping discovery (no specific article)${NC}" >&2
    return 0
  fi

  echo -e "\n${BLUE}══════════════════════════════════════════${NC}" >&2
  echo -e "${BLUE}   RECURSIVE DISCOVERY${NC}" >&2
  echo -e "${BLUE}══════════════════════════════════════════${NC}" >&2

  local discover_result
  discover_result=$(node -e "
const { tool } = require('./${MCP_DIR}/dist/tools/wiki-discover.js');
tool.handler({ source_article: '${article_filename}', max_depth: ${MAX_DISCOVERY_DEPTH} })
  .then(r => console.log(r.content[0].text))
  .catch(e => console.error('Discovery error:', e.message));
" 2>&1)

  if [[ -n "$discover_result" ]]; then
    echo "$discover_result" >&2
  else
    echo -e "${YELLOW}No discovery results${NC}" >&2
  fi

  echo -e "${BLUE}══════════════════════════════════════════${NC}\n" >&2
}

# =============================================================================
# GET MOST RECENT ARTICLE (for discovery after generation)
# =============================================================================
get_most_recent_article() {
  local recent_file
  recent_file=$(ls -t "$WIKI_DIR"/*.html 2>/dev/null | head -1)
  if [[ -n "$recent_file" ]]; then
    basename "$recent_file"
  fi
}

# =============================================================================
# QUICK HEALTH CHECK (Only checks most recent file - for use between full checks)
# =============================================================================
quick_health_check() {
  echo -e "\n${BLUE}── Quick Health Check ──${NC}" >&2

  # Get most recently modified HTML file
  local recent_file
  recent_file=$(ls -t "$WIKI_DIR"/*.html 2>/dev/null | head -1)

  if [[ -z "$recent_file" ]]; then
    echo -e "${GREEN}✓${NC} No files to check" >&2
    return 0
  fi

  local basename_f=$(basename "$recent_file")
  local issues=0

  # Check this file for broken links
  local content
  content=$(< "$recent_file")

  while IFS= read -r link; do
    if [[ -n "$link" && ! -f "$WIKI_DIR/$link" ]]; then
      echo -e "  ${RED}BROKEN:${NC} $basename_f -> $link" >&2
      ((issues++))
    fi
  done < <(echo "$content" | grep -oE 'href="[^"]*\.html"' 2>/dev/null | sed 's/href="//;s/"$//')

  # Check for placeholders
  if [[ "$content" == *"NEXT_PAGE_PLACEHOLDER"* ]]; then
    echo -e "  ${YELLOW}PLACEHOLDER:${NC} Found in $basename_f" >&2
    ((issues++))
  fi

  if [[ $issues -eq 0 ]]; then
    echo -e "${GREEN}✓${NC} Recent file ($basename_f) looks good" >&2
  fi

  return $issues
}

# =============================================================================
# UPDATE ECOSYSTEM STATS
# =============================================================================
update_ecosystem_stats() {
  if [[ -f "../meta/ecosystem.json" ]]; then
    sed -i.bak "s/\"last_validated\": \"[^\"]*\"/\"last_validated\": \"$(date +%Y-%m-%d)\"/" ../meta/ecosystem.json
    rm -f ../meta/ecosystem.json.bak
    echo -e "${GREEN}✓${NC} Updated ../meta/ecosystem.json" >&2
  fi
}

# =============================================================================
# LOG ROTATION
# =============================================================================
rotate_logs() {
  local log_count=$(find "$LOG_DIR" -name "*.json" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [[ $log_count -gt $MAX_LOGS ]]; then
    echo -e "${YELLOW}Rotating logs (keeping last $MAX_LOGS files)...${NC}" >&2
    # Portable approach: use ls -t to sort by modification time (newest first)
    # Then remove all but the first MAX_LOGS files
    cd "$LOG_DIR" 2>/dev/null || return
    ls -t *.json 2>/dev/null | tail -n +$((MAX_LOGS + 1)) | xargs rm -f 2>/dev/null || true
    cd - > /dev/null 2>&1
  fi
}

# =============================================================================
# MAIN LOOP
# =============================================================================
loop_count=0

while :; do
  ((loop_count++))
  start_time=$(date +%s)
  
  # Rotate logs before creating new one
  rotate_logs
  
  log_file="$LOG_DIR/run-$(date +%Y%m%d-%H%M%S)-loop${loop_count}.json"

  echo "" >&2
  echo "==========================================" >&2
  echo "Starting loop #$loop_count" >&2
  echo "Log: $log_file" >&2
  echo "==========================================" >&2

  # Run health check (full check every N loops, quick check otherwise)
  if [[ $((loop_count % HEALTH_CHECK_INTERVAL)) -eq 1 || $HEALTH_CHECK_INTERVAL -eq 1 ]]; then
    health_check
  else
    quick_health_check
  fi

  # Fetch task from MCP tool
  task_json=$(fetch_task)
  if [[ $? -ne 0 || -z "$task_json" ]]; then
    echo -e "${RED}Failed to fetch task. Retrying in 5s...${NC}" >&2
    sleep 5
    continue
  fi

  # Update PROMPT.md with task
  update_prompt "$task_json"

  # Timer
  (
    timer=0
    while true; do
      printf "\r⏱  Elapsed: %02d:%02d" $((timer/60)) $((timer%60)) >&2
      sleep 1
      ((timer++))
    done
  ) &
  timer_pid=$!

  # Run Claude with PROMPT.md (restricted to PROMPT.md, CONTRIBUTING.md, and not-wikipedia/)
  claude -p --verbose --output-format stream-json \
    --allowedTools "Edit,Write,Read,Glob,Grep,Bash" \
    --add-dir "$PWD/PROMPT.md" \
    --add-dir "$PWD/CONTRIBUTING.md" \
    --add-dir "$PWD/../../dist/pages" \
    --include-partial-messages --dangerously-skip-permissions \
    < "$PROMPT_FILE" > "$log_file" 2>&1
  claude_exit=$?

  kill "$timer_pid" 2>/dev/null
  wait "$timer_pid" 2>/dev/null
  timer_pid=""
  printf "\n" >&2

  end_time=$(date +%s)
  elapsed=$((end_time - start_time))

  echo "" >&2
  echo "Loop #$loop_count completed in $((elapsed/60))m $((elapsed%60))s (exit: $claude_exit)" >&2

  # Update ecosystem stats
  update_ecosystem_stats

  # ==========================================================================
  # RECURSIVE DISCOVERY: Scan new article and queue discovered concepts
  # This creates the "Content Fractal" - each article spawns new articles
  # ==========================================================================
  recent_article=$(get_most_recent_article)
  if [[ -n "$recent_article" ]]; then
    run_discovery "$recent_article"
  fi

  # Post-loop validation (quick check on recent file only)
  echo "" >&2
  echo "Post-loop validation:" >&2
  quick_health_check

  if [[ $MAX_LOOPS -gt 0 && $loop_count -ge $MAX_LOOPS ]]; then
    echo "Reached max loops ($MAX_LOOPS). Exiting." >&2
    break
  fi

  sleep 2
done
