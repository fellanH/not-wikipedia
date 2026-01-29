#!/bin/bash
set -uo pipefail

# =============================================================================
# CODEBASE CLEANUP AGENT
# Spawns a Claude agent with context-injected cleanup prompt
# =============================================================================

MAX_LOOPS=1  # Default: single run (set to 0 for unlimited)
LOG_DIR=".logs/cleanup"
PROMPT_FILE=".cleanup-prompt.md"
LOCK_FILE="/tmp/cleanup-agent.lock"
MAX_LOGS=50
MAX_FILE_SIZE=50000  # Max bytes per file to include
MAX_TOTAL_CONTEXT=500000  # Max total context bytes
timer_pid=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Default patterns to include
DEFAULT_INCLUDE="*.ts,*.tsx,*.js,*.jsx,*.py,*.go,*.rs,*.java,*.rb,*.php,*.swift,*.kt"
DEFAULT_EXCLUDE="node_modules,dist,build,.git,__pycache__,*.min.js,*.bundle.js,.next,coverage,.archive"

# =============================================================================
# USAGE
# =============================================================================
usage() {
  cat << EOF
Usage: $(basename "$0") [OPTIONS] [TARGET_DIR]

Spawn a codebase cleanup agent that analyzes code for technical debt,
dead code, complexity issues, and style inconsistencies.

OPTIONS:
  -i, --include PATTERNS    File patterns to include (comma-separated)
                            Default: $DEFAULT_INCLUDE
  -e, --exclude PATTERNS    Patterns to exclude (comma-separated)
                            Default: $DEFAULT_EXCLUDE
  -f, --files FILES         Specific files to analyze (comma-separated)
  -d, --depth DEPTH         Max directory depth to scan (default: 5)
  -l, --loops N             Number of cleanup loops (default: 1, 0=unlimited)
  -o, --output FILE         Custom output file for results
  -n, --dry-run             Show what would be analyzed without running
  -v, --verbose             Verbose output
  -h, --help                Show this help message

EXAMPLES:
  $(basename "$0") src/                     # Analyze src/ directory
  $(basename "$0") -i "*.ts,*.tsx" .        # Only TypeScript files
  $(basename "$0") -f "api.ts,utils.ts"     # Specific files only
  $(basename "$0") -l 3 src/                # Run 3 cleanup iterations

EOF
  exit 0
}

# =============================================================================
# LOCK FILE MANAGEMENT
# =============================================================================
acquire_lock() {
  if [[ -f "$LOCK_FILE" ]]; then
    local pid=$(cat "$LOCK_FILE" 2>/dev/null)
    if ps -p "$pid" > /dev/null 2>&1; then
      echo -e "${RED}Another cleanup agent is running (PID: $pid). Exiting.${NC}" >&2
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
  echo "Shutting down cleanup agent..." >&2
  [[ -n "$timer_pid" ]] && kill "$timer_pid" 2>/dev/null
  wait "$timer_pid" 2>/dev/null
  release_lock
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# =============================================================================
# GATHER DIRECTORY STRUCTURE
# =============================================================================
gather_directory_structure() {
  local target_dir="$1"
  local max_depth="$2"
  local exclude_pattern="$3"

  echo -e "${CYAN}Gathering directory structure...${NC}" >&2

  # Build find exclude arguments
  local exclude_args=""
  IFS=',' read -ra EXCL <<< "$exclude_pattern"
  for pattern in "${EXCL[@]}"; do
    pattern=$(echo "$pattern" | xargs)  # trim whitespace
    exclude_args="$exclude_args -name '$pattern' -prune -o"
  done

  # Get directory tree
  local tree_output
  if command -v tree &> /dev/null; then
    tree_output=$(tree -L "$max_depth" --noreport -I "$(echo "$exclude_pattern" | tr ',' '|')" "$target_dir" 2>/dev/null)
  else
    # Fallback to find if tree not available
    tree_output=$(find "$target_dir" -maxdepth "$max_depth" -type f 2>/dev/null | head -200)
  fi

  echo "$tree_output"
}

# =============================================================================
# GATHER FILE CONTENTS
# =============================================================================
gather_file_contents() {
  local target_dir="$1"
  local include_pattern="$2"
  local exclude_pattern="$3"
  local max_depth="$4"
  local specific_files="$5"

  echo -e "${CYAN}Gathering file contents...${NC}" >&2

  local total_bytes=0
  local file_count=0
  local output=""

  # Build list of files to process
  local files_to_process=""

  if [[ -n "$specific_files" ]]; then
    # Use specific files provided
    IFS=',' read -ra FILES <<< "$specific_files"
    for f in "${FILES[@]}"; do
      f=$(echo "$f" | xargs)  # trim whitespace
      if [[ -f "$f" ]]; then
        files_to_process="$files_to_process $f"
      elif [[ -f "$target_dir/$f" ]]; then
        files_to_process="$files_to_process $target_dir/$f"
      fi
    done
  else
    # Find files matching include patterns
    IFS=',' read -ra INCL <<< "$include_pattern"
    for pattern in "${INCL[@]}"; do
      pattern=$(echo "$pattern" | xargs)  # trim whitespace
      while IFS= read -r -d '' file; do
        # Check exclusions
        local skip=false
        IFS=',' read -ra EXCL <<< "$exclude_pattern"
        for excl in "${EXCL[@]}"; do
          excl=$(echo "$excl" | xargs)
          if [[ "$file" == *"$excl"* ]]; then
            skip=true
            break
          fi
        done

        if [[ "$skip" == false ]]; then
          files_to_process="$files_to_process $file"
        fi
      done < <(find "$target_dir" -maxdepth "$max_depth" -type f -name "$pattern" -print0 2>/dev/null)
    done
  fi

  # Process each file
  for file in $files_to_process; do
    if [[ ! -f "$file" ]]; then
      continue
    fi

    local file_size=$(wc -c < "$file" 2>/dev/null | tr -d ' ')

    # Skip files that are too large
    if [[ $file_size -gt $MAX_FILE_SIZE ]]; then
      echo -e "  ${YELLOW}Skipping${NC} $file (${file_size} bytes > max ${MAX_FILE_SIZE})" >&2
      continue
    fi

    # Check total context limit
    if [[ $((total_bytes + file_size)) -gt $MAX_TOTAL_CONTEXT ]]; then
      echo -e "  ${YELLOW}Context limit reached${NC} (${total_bytes} bytes)" >&2
      break
    fi

    output="${output}
// File: ${file}
// Size: ${file_size} bytes
// ─────────────────────────────────────────────────────────────────────────────
$(cat "$file")

"
    total_bytes=$((total_bytes + file_size))
    ((file_count++))
    echo -e "  ${GREEN}✓${NC} $file (${file_size} bytes)" >&2
  done

  echo -e "${GREEN}Gathered $file_count files ($total_bytes bytes total)${NC}" >&2
  echo "$output"
}

# =============================================================================
# BUILD CLEANUP PROMPT
# =============================================================================
build_cleanup_prompt() {
  local dir_structure="$1"
  local file_contents="$2"

  cat << 'PROMPT_HEADER'
# Codebase Cleanup Analysis

[CODEBASE CONTEXT]
PROMPT_HEADER

  # Add directory structure
  cat << EOF

## Directory Structure
\`\`\`
$dir_structure
\`\`\`

## File Contents
$file_contents

EOF

  # Add the main task and constraints
  cat << 'PROMPT_BODY'
[MAIN TASK]
Based on the entire codebase provided above, perform a comprehensive technical cleanup. You are a senior software architect specializing in technical debt reduction. Analyze the code for the following:

1. **Dead Code Detection**: Identification and removal of dead or unreachable code.

2. **Complexity Reduction**: Refactoring of overly complex functions to improve readability and maintainability.

3. **Naming Standardization**: Standardization of naming conventions and styling based on the patterns found in the most modern parts of the provided context.

4. **Redundancy Optimization**: Optimization of redundant logic without changing the external behavior of the system.

[NEGATIVE & FORMATTING CONSTRAINTS]

- Perform calculations and logical deductions based strictly on the provided codebase.
- Do not introduce external libraries or dependencies not already present in the context.
- Do not modify the core business logic or functional requirements.
- Provide the output as a structured report followed by the refactored code blocks.
- If a file requires no changes, state "No changes required" for that specific file.
- Place all negative constraints and specific formatting rules as the final priority in your reasoning.

---

Please analyze the codebase and provide your cleanup recommendations.
PROMPT_BODY
}

# =============================================================================
# LOG ROTATION
# =============================================================================
rotate_logs() {
  local log_count=$(find "$LOG_DIR" -name "*.json" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [[ $log_count -gt $MAX_LOGS ]]; then
    echo -e "${YELLOW}Rotating logs (keeping last $MAX_LOGS files)...${NC}" >&2
    cd "$LOG_DIR" 2>/dev/null || return
    ls -t *.json 2>/dev/null | tail -n +$((MAX_LOGS + 1)) | xargs rm -f 2>/dev/null || true
    cd - > /dev/null 2>&1
  fi
}

# =============================================================================
# PARSE ARGUMENTS
# =============================================================================
TARGET_DIR="."
INCLUDE_PATTERNS="$DEFAULT_INCLUDE"
EXCLUDE_PATTERNS="$DEFAULT_EXCLUDE"
SPECIFIC_FILES=""
MAX_DEPTH=5
DRY_RUN=false
VERBOSE=false
OUTPUT_FILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -i|--include)
      INCLUDE_PATTERNS="$2"
      shift 2
      ;;
    -e|--exclude)
      EXCLUDE_PATTERNS="$2"
      shift 2
      ;;
    -f|--files)
      SPECIFIC_FILES="$2"
      shift 2
      ;;
    -d|--depth)
      MAX_DEPTH="$2"
      shift 2
      ;;
    -l|--loops)
      MAX_LOOPS="$2"
      shift 2
      ;;
    -o|--output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    -n|--dry-run)
      DRY_RUN=true
      shift
      ;;
    -v|--verbose)
      VERBOSE=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    -*)
      echo -e "${RED}Unknown option: $1${NC}" >&2
      usage
      ;;
    *)
      TARGET_DIR="$1"
      shift
      ;;
  esac
done

# Validate target directory
if [[ ! -d "$TARGET_DIR" ]]; then
  echo -e "${RED}Error: Target directory '$TARGET_DIR' does not exist${NC}" >&2
  exit 1
fi

# Convert to absolute path
TARGET_DIR=$(cd "$TARGET_DIR" && pwd)

# =============================================================================
# MAIN EXECUTION
# =============================================================================
echo -e "\n${MAGENTA}══════════════════════════════════════════${NC}" >&2
echo -e "${MAGENTA}   CODEBASE CLEANUP AGENT${NC}" >&2
echo -e "${MAGENTA}══════════════════════════════════════════${NC}" >&2
echo -e "${CYAN}Target:${NC} $TARGET_DIR" >&2
echo -e "${CYAN}Include:${NC} $INCLUDE_PATTERNS" >&2
echo -e "${CYAN}Exclude:${NC} $EXCLUDE_PATTERNS" >&2
echo -e "${CYAN}Max Depth:${NC} $MAX_DEPTH" >&2
if [[ -n "$SPECIFIC_FILES" ]]; then
  echo -e "${CYAN}Specific Files:${NC} $SPECIFIC_FILES" >&2
fi
echo -e "${MAGENTA}══════════════════════════════════════════${NC}\n" >&2

# Gather context
dir_structure=$(gather_directory_structure "$TARGET_DIR" "$MAX_DEPTH" "$EXCLUDE_PATTERNS")
file_contents=$(gather_file_contents "$TARGET_DIR" "$INCLUDE_PATTERNS" "$EXCLUDE_PATTERNS" "$MAX_DEPTH" "$SPECIFIC_FILES")

# Build prompt
echo -e "\n${CYAN}Building cleanup prompt...${NC}" >&2
prompt_content=$(build_cleanup_prompt "$dir_structure" "$file_contents")

# Dry run mode - just show what would be analyzed
if [[ "$DRY_RUN" == true ]]; then
  echo -e "\n${YELLOW}═══ DRY RUN MODE ═══${NC}" >&2
  echo -e "${CYAN}Generated prompt preview (first 2000 chars):${NC}" >&2
  echo "─────────────────────────────────────────" >&2
  echo "${prompt_content:0:2000}" >&2
  echo "─────────────────────────────────────────" >&2
  echo -e "${CYAN}Total prompt size:${NC} $(echo "$prompt_content" | wc -c | tr -d ' ') bytes" >&2
  exit 0
fi

# Acquire lock
acquire_lock

# Create log directory
mkdir -p "$LOG_DIR"

# =============================================================================
# MAIN LOOP
# =============================================================================
loop_count=0

while :; do
  ((loop_count++))
  start_time=$(date +%s)

  # Rotate logs
  rotate_logs

  log_file="$LOG_DIR/cleanup-$(date +%Y%m%d-%H%M%S)-loop${loop_count}.json"

  echo -e "\n${BLUE}══════════════════════════════════════════${NC}" >&2
  echo -e "${BLUE}   CLEANUP LOOP #$loop_count${NC}" >&2
  echo -e "${BLUE}══════════════════════════════════════════${NC}" >&2
  echo -e "${CYAN}Log:${NC} $log_file" >&2

  # Write prompt to file
  echo "$prompt_content" > "$PROMPT_FILE"
  echo -e "${GREEN}✓${NC} Wrote prompt to $PROMPT_FILE" >&2

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

  # Run Claude with the cleanup prompt
  claude -p --verbose --output-format stream-json \
    --allowedTools "Edit,Write,Read,Glob,Grep" \
    --add-dir "$TARGET_DIR" \
    --include-partial-messages --dangerously-skip-permissions \
    < "$PROMPT_FILE" > "$log_file" 2>&1
  claude_exit=$?

  kill "$timer_pid" 2>/dev/null
  wait "$timer_pid" 2>/dev/null
  timer_pid=""
  printf "\n" >&2

  end_time=$(date +%s)
  elapsed=$((end_time - start_time))

  echo -e "\n${GREEN}Loop #$loop_count completed in $((elapsed/60))m $((elapsed%60))s (exit: $claude_exit)${NC}" >&2

  # Copy results to output file if specified
  if [[ -n "$OUTPUT_FILE" ]]; then
    cp "$log_file" "$OUTPUT_FILE"
    echo -e "${GREEN}✓${NC} Results saved to $OUTPUT_FILE" >&2
  fi

  # Check loop limit
  if [[ $MAX_LOOPS -gt 0 && $loop_count -ge $MAX_LOOPS ]]; then
    echo -e "${CYAN}Reached max loops ($MAX_LOOPS). Exiting.${NC}" >&2
    break
  fi

  # Re-gather context for next iteration (files may have changed)
  if [[ $MAX_LOOPS -eq 0 || $loop_count -lt $MAX_LOOPS ]]; then
    echo -e "\n${CYAN}Refreshing codebase context for next iteration...${NC}" >&2
    dir_structure=$(gather_directory_structure "$TARGET_DIR" "$MAX_DEPTH" "$EXCLUDE_PATTERNS")
    file_contents=$(gather_file_contents "$TARGET_DIR" "$INCLUDE_PATTERNS" "$EXCLUDE_PATTERNS" "$MAX_DEPTH" "$SPECIFIC_FILES")
    prompt_content=$(build_cleanup_prompt "$dir_structure" "$file_contents")
  fi

  sleep 2
done

# Cleanup temp prompt file
rm -f "$PROMPT_FILE"

echo -e "\n${MAGENTA}══════════════════════════════════════════${NC}" >&2
echo -e "${MAGENTA}   CLEANUP AGENT COMPLETE${NC}" >&2
echo -e "${MAGENTA}══════════════════════════════════════════${NC}\n" >&2
