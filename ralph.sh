#!/bin/bash
set -uo pipefail

MAX_LOOPS=100  # Set to 0 for unlimited loops
LOG_DIR=".logs"
WIKI_DIR="not-wikipedia"
MCP_DIR=".mcp"
PROMPT_FILE="PROMPT.md"
LOCK_FILE="/tmp/ralph.lock"
MAX_LOGS=100  # Keep only last 100 log files
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
# UPDATE PROMPT.md WITH TASK
# =============================================================================
update_prompt() {
  local task_json="$1"

  # Extract fields from task JSON (minimal - agent infers the rest)
  # JSON is already validated in fetch_task, but add error handling here too
  local task_type=$(echo "$task_json" | node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
      console.log(d.taskType || '');
    } catch (e) {
      console.error('Parse error:', e.message);
      process.exit(1);
    }
  " 2>/dev/null)
  
  if [[ $? -ne 0 || -z "$task_type" ]]; then
    echo -e "${RED}Failed to parse task type from JSON${NC}" >&2
    return 1
  fi
  
  local priority=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.priority || '')")
  local topic_name=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.topic?.name || '')")
  local topic_context=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.topic?.context || '')")
  local human_seed_text=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.humanSeed?.text || '')")
  local human_seed_source=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.humanSeed?.source || '')")
  local infobox_color=$(echo "$task_json" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.infoboxColor || '')")
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Display task info
  echo -e "\n${BLUE}══════════════════════════════════════════${NC}" >&2
  echo -e "${BLUE}   TASK: ${task_type} (${priority})${NC}" >&2
  echo -e "${BLUE}══════════════════════════════════════════${NC}" >&2

  if [[ "$task_type" == "create_new" && -n "$human_seed_text" ]]; then
    echo -e "${CYAN}Human Seed:${NC}" >&2
    echo -e "  \"${human_seed_text:0:80}...\"" >&2
    echo -e "  — ${human_seed_source}" >&2
  elif [[ -n "$topic_name" ]]; then
    echo -e "${CYAN}Topic:${NC} $topic_name" >&2
    echo -e "${CYAN}Context:${NC} $topic_context" >&2
  fi

  echo -e "${CYAN}Infobox Color:${NC} $infobox_color" >&2
  echo -e "${BLUE}══════════════════════════════════════════${NC}\n" >&2

  # Write PROMPT.md (minimal - agent determines content from context)
  cat > "$PROMPT_FILE" << EOF
# Contribute to Not-Wikipedia

> Generated: ${timestamp}

## Task

| Field | Value |
|-------|-------|
| Type | ${task_type} |
| Priority | ${priority} |
| Infobox Color | ${infobox_color} |
EOF

  # Add task-specific content
  if [[ "$task_type" == "create_new" ]]; then
    cat >> "$PROMPT_FILE" << EOF

## Human Seed

> "${human_seed_text}"
>
> — ${human_seed_source}

Use this passage as creative inspiration. Derive the topic, article type, thematic direction, and any researchers entirely from your interpretation. The connection can be metaphorical, tangential, or abstracted.
EOF
  elif [[ "$task_type" == "repair_broken_link" ]]; then
    cat >> "$PROMPT_FILE" << EOF

## Target

Create the missing article: **${topic_name}**

${topic_context}

Read the referencing articles to understand what this page should contain. Infer the article type, content, and any researchers from the context in which this link appears.
EOF
  elif [[ "$task_type" == "resolve_placeholder" ]]; then
    cat >> "$PROMPT_FILE" << EOF

## Target

${topic_context}

Read the file to understand the context and replace NEXT_PAGE_PLACEHOLDER with an appropriate link.
EOF
  elif [[ "$task_type" == "fix_orphan" ]]; then
    cat >> "$PROMPT_FILE" << EOF

## Target

Add incoming links to: **${topic_name}**

${topic_context}
EOF
  fi

  cat >> "$PROMPT_FILE" << EOF

## Guidelines

See [CONTRIBUTING.md](CONTRIBUTING.md) for HTML template and style guide.

## Vocabulary Reminder

**Avoid word repetition.** Limit specialized terms (semantic, temporal, consciousness, framework, protocol, phenomenon) to 3-5 uses each. Use synonyms, concrete details, and varied sentence structures. Every article should read distinctly—not as a template with swapped terms.
EOF

  echo -e "${GREEN}✓${NC} Updated ${PROMPT_FILE}" >&2
}

# =============================================================================
# ECOSYSTEM HEALTH CHECK
# =============================================================================
health_check() {
  echo -e "\n${BLUE}══════════════════════════════════════════${NC}" >&2
  echo -e "${BLUE}   ECOSYSTEM HEALTH CHECK${NC}" >&2
  echo -e "${BLUE}══════════════════════════════════════════${NC}" >&2

  local issues=0

  # Count articles
  local article_count=$(find "$WIKI_DIR" -name "*.html" -type f | wc -l | tr -d ' ')
  echo -e "${GREEN}✓${NC} Articles: $article_count" >&2

  # Check for broken internal links
  echo -e "\n${YELLOW}Checking internal links...${NC}" >&2
  local broken_links=0
  for f in "$WIKI_DIR"/*.html; do
    if [[ -f "$f" ]]; then
      while IFS= read -r link; do
        if [[ -n "$link" && ! -f "$WIKI_DIR/$link" ]]; then
          echo -e "  ${RED}BROKEN:${NC} $(basename "$f") -> $link" >&2
          ((broken_links++))
        fi
      done < <(grep -oE 'href="[^"]*\.html"' "$f" 2>/dev/null | sed 's/href="//;s/"$//')
    fi
  done

  if [[ $broken_links -eq 0 ]]; then
    echo -e "${GREEN}✓${NC} No broken links" >&2
  else
    echo -e "${RED}✗${NC} Found $broken_links broken links" >&2
    ((issues++))
  fi

  # Check for unresolved placeholders
  echo -e "\n${YELLOW}Checking for placeholders...${NC}" >&2
  local placeholders=$(grep -r "NEXT_PAGE_PLACEHOLDER" "$WIKI_DIR" 2>/dev/null | wc -l | tr -d ' ')
  if [[ $placeholders -eq 0 ]]; then
    echo -e "${GREEN}✓${NC} No unresolved placeholders" >&2
  else
    echo -e "${RED}✗${NC} Found $placeholders unresolved placeholders" >&2
    ((issues++))
  fi

  # Check for orphan articles
  echo -e "\n${YELLOW}Checking for orphan articles...${NC}" >&2
  local orphans=0
  for f in "$WIKI_DIR"/*.html; do
    local basename_f=$(basename "$f")
    if [[ "$basename_f" != "index.html" ]]; then
      local incoming=$(grep -l "href=\"$basename_f\"" "$WIKI_DIR"/*.html 2>/dev/null | wc -l | tr -d ' ')
      if [[ $incoming -eq 0 ]]; then
        echo -e "  ${YELLOW}ORPHAN:${NC} $basename_f" >&2
        ((orphans++))
      fi
    fi
  done

  if [[ $orphans -eq 0 ]]; then
    echo -e "${GREEN}✓${NC} No orphan articles" >&2
  else
    echo -e "${YELLOW}!${NC} Found $orphans orphan articles" >&2
  fi

  # Check for word density issues in recent articles
  echo -e "\n${YELLOW}Checking word density...${NC}" >&2
  local density_issues=0
  local overused_terms="semantic temporal consciousness framework protocol phenomenon methodology"

  for f in $(ls -t "$WIKI_DIR"/*.html 2>/dev/null | head -5); do
    local basename_f=$(basename "$f")
    if [[ "$basename_f" != "index.html" && "$basename_f" != "wiki-common.css" ]]; then
      for term in $overused_terms; do
        local count=$(grep -io "\b${term}\b" "$f" 2>/dev/null | wc -l | tr -d ' ')
        if [[ $count -gt 10 ]]; then
          echo -e "  ${YELLOW}DENSITY:${NC} $basename_f has '$term' $count times (limit: 10)" >&2
          ((density_issues++))
        fi
      done
    fi
  done

  if [[ $density_issues -eq 0 ]]; then
    echo -e "${GREEN}✓${NC} Word density within limits" >&2
  else
    echo -e "${YELLOW}!${NC} Found $density_issues word density issues" >&2
  fi

  echo -e "${BLUE}══════════════════════════════════════════${NC}\n" >&2

  return $issues
}

# =============================================================================
# UPDATE ECOSYSTEM STATS
# =============================================================================
update_ecosystem_stats() {
  if [[ -f "meta/ecosystem.json" ]]; then
    sed -i.bak "s/\"last_validated\": \"[^\"]*\"/\"last_validated\": \"$(date +%Y-%m-%d)\"/" meta/ecosystem.json
    rm -f meta/ecosystem.json.bak
    echo -e "${GREEN}✓${NC} Updated meta/ecosystem.json" >&2
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

  # Run health check
  health_check

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
    --add-dir "$PWD/not-wikipedia" \
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

  # Post-loop health check
  echo "" >&2
  echo "Post-loop validation:" >&2
  health_check

  if [[ $MAX_LOOPS -gt 0 && $loop_count -ge $MAX_LOOPS ]]; then
    echo "Reached max loops ($MAX_LOOPS). Exiting." >&2
    break
  fi

  sleep 2
done
