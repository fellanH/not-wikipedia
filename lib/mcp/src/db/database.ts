/**
 * Database Module
 *
 * Provides SQLite database connection and schema management for Ralph.
 * Uses better-sqlite3 for synchronous operations matching existing tool handlers.
 */

import Database from "better-sqlite3";
import { DB_PATH } from "../config.js";

let db: Database.Database | null = null;

/**
 * Get the database instance, initializing if necessary.
 */
export function getDatabase(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initializeSchema();
  }
  return db;
}

/**
 * Initialize database schema if tables don't exist.
 */
function initializeSchema(): void {
  const database = db!;

  database.exec(`
    -- Core tables
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      outlinks INTEGER DEFAULT 0,
      inlinks INTEGER DEFAULT 0,
      created TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS researchers (
      id INTEGER PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      field TEXT,
      institution TEXT,
      nationality TEXT,
      active_years TEXT,
      usage_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'AVAILABLE'
    );

    CREATE TABLE IF NOT EXISTS institutions (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      location TEXT,
      founded TEXT,
      focus TEXT
    );

    -- Relationship tables
    CREATE TABLE IF NOT EXISTS links (
      source_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
      target_filename TEXT NOT NULL,
      PRIMARY KEY (source_id, target_filename)
    );

    CREATE TABLE IF NOT EXISTS article_researchers (
      article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
      researcher_id INTEGER REFERENCES researchers(id) ON DELETE CASCADE,
      PRIMARY KEY (article_id, researcher_id)
    );

    CREATE TABLE IF NOT EXISTS researcher_contributions (
      id INTEGER PRIMARY KEY,
      researcher_id INTEGER REFERENCES researchers(id) ON DELETE CASCADE,
      contribution TEXT NOT NULL
    );

    -- Discovery queue for recursive generation (Content Fractal)
    -- When an article is created, new concepts are auto-queued for generation
    CREATE TABLE IF NOT EXISTS discovery_queue (
      id INTEGER PRIMARY KEY,
      target_filename TEXT UNIQUE NOT NULL,
      suggested_title TEXT,
      depth INTEGER NOT NULL DEFAULT 0,
      source_article TEXT,
      discovered_at TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
    CREATE INDEX IF NOT EXISTS idx_articles_type ON articles(type);
    CREATE INDEX IF NOT EXISTS idx_articles_inlinks ON articles(inlinks);
    CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_filename);
    CREATE INDEX IF NOT EXISTS idx_researchers_status ON researchers(status);
    CREATE INDEX IF NOT EXISTS idx_discovery_queue_status ON discovery_queue(status);
    CREATE INDEX IF NOT EXISTS idx_discovery_queue_depth ON discovery_queue(depth);
    CREATE INDEX IF NOT EXISTS idx_discovery_queue_priority ON discovery_queue(priority DESC);
  `);
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Article types
export interface Article {
  id: number;
  filename: string;
  title: string;
  type: string;
  category: string;
  outlinks: number;
  inlinks: number;
  created: string;
}

export interface Researcher {
  id: number;
  key: string;
  name: string;
  field: string | null;
  institution: string | null;
  nationality: string | null;
  active_years: string | null;
  usage_count: number;
  status: string;
}

export interface Institution {
  id: number;
  name: string;
  location: string | null;
  founded: string | null;
  focus: string | null;
}

export interface Link {
  source_id: number;
  target_filename: string;
}

export interface DiscoveryQueueItem {
  id: number;
  target_filename: string;
  suggested_title: string | null;
  depth: number;
  source_article: string | null;
  discovered_at: string;
  status: string;
  priority: number;
}

// Query helpers

export function getArticleCount(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM articles").get() as { count: number };
  return row.count;
}

export function getAllArticles(): Article[] {
  const db = getDatabase();
  return db.prepare("SELECT * FROM articles ORDER BY filename").all() as Article[];
}

export function getArticleByFilename(filename: string): Article | undefined {
  const db = getDatabase();
  return db.prepare("SELECT * FROM articles WHERE filename = ?").get(filename) as Article | undefined;
}

export function getBrokenLinks(): { target: string; sources: string[] }[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT l.target_filename as target, GROUP_CONCAT(a.filename) as sources
    FROM links l
    JOIN articles a ON l.source_id = a.id
    WHERE l.target_filename NOT IN (SELECT filename FROM articles)
    GROUP BY l.target_filename
  `).all() as { target: string; sources: string }[];

  return rows.map(row => ({
    target: row.target,
    sources: row.sources.split(","),
  }));
}

export function getOrphanArticles(): string[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT filename FROM articles
    WHERE inlinks = 0 AND filename != 'index.html'
  `).all() as { filename: string }[];
  return rows.map(row => row.filename);
}

export function getPlaceholderArticles(): string[] {
  // Placeholders are detected by scanning HTML content, not stored in DB
  // This is a stub - actual implementation scans files
  return [];
}

export function getCategoryDistribution(): Record<string, number> {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT category, COUNT(*) as count FROM articles GROUP BY category
  `).all() as { category: string; count: number }[];

  const distribution: Record<string, number> = {};
  for (const row of rows) {
    distribution[row.category] = row.count;
  }
  return distribution;
}

export function getTotalLinks(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM links").get() as { count: number };
  return row.count;
}

export function getResearchersByStatus(status: string): Researcher[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM researchers WHERE status LIKE ?
  `).all(`%${status}%`) as Researcher[];
}

export function getAllResearchers(): Researcher[] {
  const db = getDatabase();
  return db.prepare("SELECT * FROM researchers ORDER BY name").all() as Researcher[];
}

export function getResearcherByKey(key: string): Researcher | undefined {
  const db = getDatabase();
  return db.prepare("SELECT * FROM researchers WHERE key = ?").get(key) as Researcher | undefined;
}

export function getResearcherContributions(researcherId: number): string[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT contribution FROM researcher_contributions WHERE researcher_id = ?
  `).all(researcherId) as { contribution: string }[];
  return rows.map(row => row.contribution);
}

export function getResearcherArticles(researcherId: number): string[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT a.filename FROM articles a
    JOIN article_researchers ar ON a.id = ar.article_id
    WHERE ar.researcher_id = ?
  `).all(researcherId) as { filename: string }[];
  return rows.map(row => row.filename);
}

export function getAllInstitutions(): Institution[] {
  const db = getDatabase();
  return db.prepare("SELECT * FROM institutions ORDER BY name").all() as Institution[];
}

export function getUsedInfoboxColors(): string[] {
  // This requires scanning HTML files - placeholder for now
  return [];
}

// Write helpers

export function insertArticle(article: Omit<Article, "id">): number {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO articles (filename, title, type, category, outlinks, inlinks, created)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    article.filename,
    article.title,
    article.type,
    article.category,
    article.outlinks,
    article.inlinks,
    article.created
  );
  return result.lastInsertRowid as number;
}

export function updateArticleLinkCounts(filename: string, outlinks: number, inlinks: number): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE articles SET outlinks = ?, inlinks = ? WHERE filename = ?
  `).run(outlinks, inlinks, filename);
}

export function insertLink(sourceId: number, targetFilename: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR IGNORE INTO links (source_id, target_filename) VALUES (?, ?)
  `).run(sourceId, targetFilename);
}

export function clearLinks(sourceId: number): void {
  const db = getDatabase();
  db.prepare("DELETE FROM links WHERE source_id = ?").run(sourceId);
}

export function insertResearcher(researcher: Omit<Researcher, "id">): number {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO researchers (key, name, field, institution, nationality, active_years, usage_count, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    researcher.key,
    researcher.name,
    researcher.field,
    researcher.institution,
    researcher.nationality,
    researcher.active_years,
    researcher.usage_count,
    researcher.status
  );
  return result.lastInsertRowid as number;
}

export function updateResearcherUsage(key: string, usageCount: number, status: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE researchers SET usage_count = ?, status = ? WHERE key = ?
  `).run(usageCount, status, key);
}

export function insertResearcherContribution(researcherId: number, contribution: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO researcher_contributions (researcher_id, contribution) VALUES (?, ?)
  `).run(researcherId, contribution);
}

export function linkArticleResearcher(articleId: number, researcherId: number): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR IGNORE INTO article_researchers (article_id, researcher_id) VALUES (?, ?)
  `).run(articleId, researcherId);
}

export function insertInstitution(institution: Omit<Institution, "id">): number {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO institutions (name, location, founded, focus)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(
    institution.name,
    institution.location,
    institution.founded,
    institution.focus
  );
  return result.lastInsertRowid as number;
}

/**
 * Recalculate inlink counts for all articles based on the links table.
 */
export function recalculateInlinkCounts(): void {
  const db = getDatabase();

  // Reset all inlinks to 0
  db.prepare("UPDATE articles SET inlinks = 0").run();

  // Update inlinks based on links table (only for existing targets)
  db.prepare(`
    UPDATE articles SET inlinks = (
      SELECT COUNT(*) FROM links
      WHERE links.target_filename = articles.filename
    )
  `).run();
}

// =============================================================================
// DISCOVERY QUEUE FUNCTIONS (Recursive Discovery / Content Fractal)
// =============================================================================

/**
 * Queue a discovered concept for future generation.
 * Returns true if queued (new), false if already exists.
 */
export function queueDiscoveredConcept(
  targetFilename: string,
  suggestedTitle: string | null,
  depth: number,
  sourceArticle: string | null,
  priority: number = 0
): boolean {
  const db = getDatabase();
  try {
    db.prepare(`
      INSERT INTO discovery_queue (target_filename, suggested_title, depth, source_article, discovered_at, status, priority)
      VALUES (?, ?, ?, ?, datetime('now'), 'pending', ?)
    `).run(targetFilename, suggestedTitle, depth, sourceArticle, priority);
    return true;
  } catch {
    // Already exists (UNIQUE constraint)
    return false;
  }
}

/**
 * Get next item from discovery queue (highest priority, lowest depth first).
 */
export function getNextFromDiscoveryQueue(maxDepth: number = 3): DiscoveryQueueItem | undefined {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM discovery_queue
    WHERE status = 'pending' AND depth <= ?
    ORDER BY priority DESC, depth ASC, discovered_at ASC
    LIMIT 1
  `).get(maxDepth) as DiscoveryQueueItem | undefined;
}

/**
 * Get all pending items from discovery queue.
 */
export function getPendingDiscoveryItems(maxDepth: number = 3): DiscoveryQueueItem[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM discovery_queue
    WHERE status = 'pending' AND depth <= ?
    ORDER BY priority DESC, depth ASC, discovered_at ASC
  `).all(maxDepth) as DiscoveryQueueItem[];
}

/**
 * Mark a discovery queue item as completed.
 */
export function completeDiscoveryItem(targetFilename: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE discovery_queue SET status = 'completed' WHERE target_filename = ?
  `).run(targetFilename);
}

/**
 * Mark a discovery queue item as in progress.
 */
export function markDiscoveryInProgress(targetFilename: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE discovery_queue SET status = 'in_progress' WHERE target_filename = ?
  `).run(targetFilename);
}

/**
 * Get the depth of a source article (returns 0 if not in queue or is root).
 */
export function getArticleDepth(filename: string): number {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT depth FROM discovery_queue WHERE target_filename = ?
  `).get(filename) as { depth: number } | undefined;
  return row?.depth ?? 0;
}

/**
 * Get discovery queue statistics.
 */
export function getDiscoveryQueueStats(): {
  pending: number;
  inProgress: number;
  completed: number;
  byDepth: Record<number, number>;
} {
  const db = getDatabase();

  const statusCounts = db.prepare(`
    SELECT status, COUNT(*) as count FROM discovery_queue GROUP BY status
  `).all() as { status: string; count: number }[];

  const depthCounts = db.prepare(`
    SELECT depth, COUNT(*) as count FROM discovery_queue WHERE status = 'pending' GROUP BY depth
  `).all() as { depth: number; count: number }[];

  const stats = {
    pending: 0,
    inProgress: 0,
    completed: 0,
    byDepth: {} as Record<number, number>,
  };

  for (const row of statusCounts) {
    if (row.status === 'pending') stats.pending = row.count;
    else if (row.status === 'in_progress') stats.inProgress = row.count;
    else if (row.status === 'completed') stats.completed = row.count;
  }

  for (const row of depthCounts) {
    stats.byDepth[row.depth] = row.count;
  }

  return stats;
}

/**
 * Clear completed items older than N days.
 */
export function pruneCompletedDiscoveryItems(daysOld: number = 7): number {
  const db = getDatabase();
  const result = db.prepare(`
    DELETE FROM discovery_queue
    WHERE status = 'completed'
    AND datetime(discovered_at) < datetime('now', '-' || ? || ' days')
  `).run(daysOld);
  return result.changes;
}
