# Ralph Scale-Up Roadmap

> Handling exponential page growth from 104 → 10K → 100K → 1M+ articles

## Current State Assessment

| Metric | Current | Bottleneck |
|--------|---------|------------|
| Articles | 104 | O(n) file reads per scan |
| Internal Links | 897 | O(n×m) link validation |
| Orphan Detection | O(n²) | Grep every file for each file |
| Health Check | 2×/loop | 3 independent full scans each |
| Storage | Flat files | No indexing |
| Database | **Exists but unused** | `.mcp/src/db/database.ts` ready |

**Critical Path:** Orphan detection at 10K articles = 100M grep operations per health check.

---

## Phase 1: Activate Existing Database (Target: 1K articles)

The database schema already exists in `.mcp/src/db/database.ts` but isn't wired up.

### 1.1 Initialize Database on Startup

```typescript
// Add to ralph.sh or create init script
if [[ ! -f "meta/ralph.db" ]]; then
  node .mcp/src/db/init.ts  # Bootstrap from existing HTML files
fi
```

### 1.2 Wire Up MCP Tools to Database

| Tool | Current | Change To |
|------|---------|-----------|
| `wiki-next-task.ts` | `getEcosystemState()` scans files | Query `articles` + `links` tables |
| `wiki-broken-links.ts` | Scans all files | `SELECT * FROM links WHERE target_exists = 0` |
| `wiki-ecosystem.ts` | Scans all files | Query pre-computed stats table |

### 1.3 Replace O(n²) Orphan Detection

**Before (ralph.sh:260-269):**
```bash
for f in "$WIKI_DIR"/*.html; do
  incoming=$(grep -l "href=\"$basename_f\"" "$WIKI_DIR"/*.html | wc -l)
done
```

**After (SQL query):**
```sql
SELECT a.slug FROM articles a
LEFT JOIN links l ON l.target = a.slug
WHERE l.id IS NULL AND a.slug != 'index';
```

### 1.4 Incremental Updates

Instead of full scans, update database when articles change:

```typescript
// After Claude writes an article
async function onArticleWritten(filePath: string) {
  const content = await fs.readFile(filePath, 'utf-8');
  const slug = path.basename(filePath, '.html');

  // Update article record
  await db.run('INSERT OR REPLACE INTO articles (slug, ...) VALUES (?, ...)', [slug, ...]);

  // Rebuild links for this article only
  await db.run('DELETE FROM links WHERE source = ?', [slug]);
  const links = extractLinks(content);
  for (const link of links) {
    await db.run('INSERT INTO links (source, target) VALUES (?, ?)', [slug, link]);
  }
}
```

**Complexity reduction:** O(n²) → O(1) per article change

---

## Phase 2: Caching Layer (Target: 10K articles)

### 2.1 In-Memory Link Graph Cache

```typescript
// .mcp/src/cache/link-graph.ts
interface LinkGraphCache {
  articles: Set<string>;           // O(1) existence check
  outgoingLinks: Map<string, string[]>;  // source → targets
  incomingLinks: Map<string, string[]>;  // target → sources (for orphan detection)
  lastUpdated: Date;
}

let cache: LinkGraphCache | null = null;

export function getOrBuildCache(): LinkGraphCache {
  if (cache && (Date.now() - cache.lastUpdated.getTime()) < 60000) {
    return cache;  // Return cached if < 1 minute old
  }
  return rebuildCache();
}
```

### 2.2 File Watcher for Cache Invalidation

```typescript
// Watch for changes instead of polling
import { watch } from 'chokidar';

const watcher = watch('not-wikipedia/*.html', { persistent: true });

watcher.on('add', path => invalidateCacheFor(path));
watcher.on('change', path => invalidateCacheFor(path));
watcher.on('unlink', path => removeFromCache(path));
```

### 2.3 Reduce Health Check Frequency

**Before:** 2 full scans per loop (pre + post)

**After:**
```bash
# ralph.sh
HEALTH_CHECK_INTERVAL=10  # Only run full health check every 10 loops

if (( loop_count % HEALTH_CHECK_INTERVAL == 0 )); then
  health_check
else
  quick_health_check  # Only check last modified article
fi
```

---

## Phase 3: Sharded Storage (Target: 100K articles)

### 3.1 Directory Hierarchy

**Before:** `not-wikipedia/babel-incident.html` (flat)

**After:** `not-wikipedia/b/ba/babel-incident.html` (2-level hash)

```typescript
function getArticlePath(slug: string): string {
  const prefix1 = slug[0].toLowerCase();
  const prefix2 = slug.slice(0, 2).toLowerCase();
  return path.join(WIKI_DIR, prefix1, prefix2, `${slug}.html`);
}
```

**Benefits:**
- Filesystem directory limits (~10K files/dir on some systems)
- Parallel I/O across different directories
- Better filesystem cache utilization

### 3.2 Migration Script

```typescript
// scripts/migrate-to-sharded.ts
async function migrateToSharded() {
  const files = await glob('not-wikipedia/*.html');

  for (const file of files) {
    const slug = path.basename(file, '.html');
    const newPath = getArticlePath(slug);

    await fs.mkdir(path.dirname(newPath), { recursive: true });
    await fs.rename(file, newPath);

    // Update all links in database
    await db.run('UPDATE links SET source = ? WHERE source = ?', [newPath, file]);
  }
}
```

### 3.3 Parallel Task Processing

```bash
# ralph.sh - run multiple Claude instances
MAX_PARALLEL_TASKS=3

for i in $(seq 1 $MAX_PARALLEL_TASKS); do
  (
    task=$(fetch_task)
    update_prompt "$task"
    run_claude
  ) &
done
wait
```

**Note:** Requires task locking to prevent conflicts:

```sql
-- Claim task atomically
UPDATE tasks SET claimed_by = ?, claimed_at = NOW()
WHERE id = ? AND claimed_by IS NULL;
```

---

## Phase 4: Distributed Architecture (Target: 1M+ articles)

### 4.1 Microservices Split

```
┌─────────────────────────────────────────────────────────────┐
│                      ralph-orchestrator                      │
│  (Task scheduling, health monitoring, loop coordination)    │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ ralph-writer  │ │ ralph-writer  │ │ ralph-writer  │
│   (Claude)    │ │   (Claude)    │ │   (Claude)    │
└───────┬───────┘ └───────┬───────┘ └───────┬───────┘
        │                 │                 │
        └────────────┬────┴────────────────┘
                     ▼
          ┌─────────────────────┐
          │   ralph-indexer     │
          │  (Link graph, DB)   │
          └─────────┬───────────┘
                    ▼
          ┌─────────────────────┐
          │   PostgreSQL +      │
          │   Redis Cache       │
          └─────────────────────┘
```

### 4.2 Message Queue for Tasks

```typescript
// Use Redis or RabbitMQ for task distribution
import { Queue } from 'bullmq';

const taskQueue = new Queue('ralph-tasks');

// Orchestrator adds tasks
await taskQueue.add('create_new', { seed: humanSeed, color: '#7b9e89' });
await taskQueue.add('repair_broken_link', { target: 'missing-page.html', sources: [...] });

// Workers consume tasks
const worker = new Worker('ralph-tasks', async (job) => {
  const prompt = buildPrompt(job.data);
  await runClaude(prompt);
  await updateIndex(job.data);
});
```

### 4.3 Database Scaling

**SQLite → PostgreSQL migration:**

```sql
-- Partitioned links table by source hash
CREATE TABLE links (
  id SERIAL,
  source VARCHAR(255),
  target VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
) PARTITION BY HASH (source);

CREATE TABLE links_0 PARTITION OF links FOR VALUES WITH (MODULUS 8, REMAINDER 0);
CREATE TABLE links_1 PARTITION OF links FOR VALUES WITH (MODULUS 8, REMAINDER 1);
-- ... partitions 2-7

-- Indexes for common queries
CREATE INDEX idx_links_target ON links (target);
CREATE INDEX idx_links_source ON links (source);
```

### 4.4 CDN for Article Serving

```
User Request → CloudFlare/Fastly → Origin (ralph-server)
                    │
                    ▼
            ┌───────────────┐
            │  Edge Cache   │
            │  (HTML files) │
            └───────────────┘
```

**Cache invalidation on article update:**
```typescript
async function onArticleUpdated(slug: string) {
  await fetch(`https://api.cloudflare.com/purge`, {
    method: 'POST',
    body: JSON.stringify({ files: [`https://not-wikipedia.com/${slug}.html`] })
  });
}
```

---

## Phase 5: Search & Discovery (All Scales)

### 5.1 Full-Text Search Index

```typescript
// Integrate with Elasticsearch or Meilisearch
import { MeiliSearch } from 'meilisearch';

const client = new MeiliSearch({ host: 'http://localhost:7700' });
const index = client.index('articles');

// On article creation
await index.addDocuments([{
  id: slug,
  title: extractTitle(content),
  body: extractPlainText(content),
  categories: extractCategories(content),
  researchers: extractResearchers(content)
}]);
```

### 5.2 Category Index

```sql
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE,
  article_count INT DEFAULT 0
);

CREATE TABLE article_categories (
  article_id INT REFERENCES articles(id),
  category_id INT REFERENCES categories(id),
  PRIMARY KEY (article_id, category_id)
);

-- Get category balance for task selection
SELECT c.name, c.article_count
FROM categories c
ORDER BY c.article_count ASC
LIMIT 5;  -- Underpopulated categories for new content
```

---

## Implementation Priority Matrix

| Phase | Effort | Impact | Articles Supported |
|-------|--------|--------|-------------------|
| **1.1** Activate database | Low | High | 1K |
| **1.3** SQL orphan detection | Low | Critical | 1K |
| **1.4** Incremental updates | Medium | High | 1K |
| **2.1** In-memory cache | Medium | High | 10K |
| **2.3** Reduce health checks | Low | Medium | 10K |
| **3.1** Sharded storage | Medium | Medium | 100K |
| **3.3** Parallel tasks | High | High | 100K |
| **4.1** Microservices | High | Critical | 1M+ |
| **4.2** Message queue | Medium | High | 1M+ |

---

## Quick Wins (Implement Now)

### 1. Fix O(n²) Orphan Detection

Replace `ralph.sh:260-269` with:

```bash
# Build incoming link map once, then check
declare -A incoming_links
for f in "$WIKI_DIR"/*.html; do
  while IFS= read -r link; do
    ((incoming_links["$link"]++))
  done < <(grep -oE 'href="[^"]*\.html"' "$f" | sed 's/href="//;s/"$//')
done

# Now check orphans in O(n)
for f in "$WIKI_DIR"/*.html; do
  basename_f=$(basename "$f")
  if [[ -z "${incoming_links[$basename_f]}" && "$basename_f" != "index.html" ]]; then
    echo "ORPHAN: $basename_f"
  fi
done
```

**Improvement:** O(n²) → O(n)

### 2. Cache File List

```bash
# At start of health_check()
mapfile -t html_files < <(find "$WIKI_DIR" -maxdepth 1 -name "*.html" -type f)

# Use array instead of repeated globbing
for f in "${html_files[@]}"; do
  # ...
done
```

### 3. Single-Pass Health Check

Combine broken link, placeholder, and orphan detection into one pass:

```bash
health_check_single_pass() {
  declare -A incoming_links
  local broken=0 placeholders=0

  for f in "$WIKI_DIR"/*.html; do
    content=$(< "$f")

    # Check placeholders
    if [[ "$content" == *"NEXT_PAGE_PLACEHOLDER"* ]]; then
      ((placeholders++))
    fi

    # Extract and validate links, build incoming map
    while IFS= read -r link; do
      ((incoming_links["$link"]++))
      if [[ ! -f "$WIKI_DIR/$link" ]]; then
        ((broken++))
      fi
    done < <(echo "$content" | grep -oE 'href="[^"]*\.html"' | sed 's/href="//;s/"$//')
  done

  # Orphan detection from map
  # ...
}
```

---

## Monitoring & Alerts

Add metrics collection for scaling decisions:

```bash
# ralph.sh - add timing
log_metrics() {
  local loop_duration=$1
  local article_count=$2
  local task_type=$3

  echo "{\"timestamp\":\"$(date -Iseconds)\",\"duration_s\":$loop_duration,\"articles\":$article_count,\"task\":\"$task_type\"}" >> .logs/metrics.jsonl
}

# Alert if loop takes > 5 minutes
if (( loop_duration > 300 )); then
  echo "ALERT: Loop took ${loop_duration}s" >&2
fi
```

**Scale triggers:**
- Loop duration > 2 minutes → Implement Phase 1
- Loop duration > 5 minutes → Implement Phase 2
- Article count > 5K → Implement Phase 3
- Writer queue depth > 10 → Implement Phase 4
