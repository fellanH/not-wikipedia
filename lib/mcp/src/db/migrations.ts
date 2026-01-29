/**
 * Migration Script
 *
 * One-time migration from JSON files to SQLite database.
 * Reads ecosystem.json, researchers.json, and HTML files to populate the database.
 */

import * as fs from "fs";
import * as path from "path";
import {
  getDatabase,
  insertArticle,
  insertLink,
  insertResearcher,
  insertResearcherContribution,
  insertInstitution,
  linkArticleResearcher,
  recalculateInlinkCounts,
  getArticleByFilename,
} from "./database.js";

const META_DIR = path.join(process.cwd(), "meta");
const WIKI_DIR = path.join(process.cwd(), "not-wikipedia");
const ECOSYSTEM_FILE = path.join(META_DIR, "ecosystem.json");
const RESEARCHERS_FILE = path.join(META_DIR, "researchers.json");

interface EcosystemJson {
  _meta: Record<string, unknown>;
  stats: Record<string, number>;
  articles: Record<string, {
    title: string;
    type: string;
    category: string;
    outlinks: number;
    inlinks: number;
    created: string;
  }>;
  categories?: Record<string, { article_count: number }>;
}

interface ResearcherJson {
  name: string;
  field: string;
  institution: string;
  nationality: string;
  active_years: string;
  key_contributions: string[];
  articles_mentioned: string[];
  usage_count: number;
  status: string;
}

interface ResearchersFileJson {
  _meta: Record<string, unknown>;
  researchers: Record<string, ResearcherJson>;
  institutions?: Record<string, {
    name: string;
    location: string;
    founded: string;
    focus: string;
    key_researchers?: string[];
  }>;
  suggested_new_researchers?: unknown[];
}

/**
 * Run the migration from JSON to SQLite.
 */
export function runMigration(): { articles: number; researchers: number; links: number; institutions: number } {
  const db = getDatabase();
  const stats = { articles: 0, researchers: 0, links: 0, institutions: 0 };

  // Use a transaction for atomicity
  const transaction = db.transaction(() => {
    // Clear existing data (fresh migration)
    db.exec(`
      DELETE FROM article_researchers;
      DELETE FROM researcher_contributions;
      DELETE FROM links;
      DELETE FROM articles;
      DELETE FROM researchers;
      DELETE FROM institutions;
    `);

    // 1. Migrate articles from ecosystem.json
    if (fs.existsSync(ECOSYSTEM_FILE)) {
      const ecosystemData: EcosystemJson = JSON.parse(fs.readFileSync(ECOSYSTEM_FILE, "utf-8"));

      for (const [filename, article] of Object.entries(ecosystemData.articles)) {
        const fullFilename = filename.endsWith(".html") ? filename : `${filename}.html`;
        insertArticle({
          filename: fullFilename,
          title: article.title,
          type: article.type,
          category: article.category,
          outlinks: article.outlinks || 0,
          inlinks: article.inlinks || 0,
          created: article.created || new Date().toISOString().split("T")[0],
        });
        stats.articles++;
      }
    }

    // 2. Migrate researchers from researchers.json
    const researcherIdMap: Map<string, number> = new Map();

    if (fs.existsSync(RESEARCHERS_FILE)) {
      const researchersData: ResearchersFileJson = JSON.parse(fs.readFileSync(RESEARCHERS_FILE, "utf-8"));

      // Migrate institutions first
      if (researchersData.institutions) {
        for (const [key, inst] of Object.entries(researchersData.institutions)) {
          insertInstitution({
            name: inst.name,
            location: inst.location || null,
            founded: inst.founded || null,
            focus: inst.focus || null,
          });
          stats.institutions++;
        }
      }

      // Helper function to migrate a single researcher
      const migrateResearcher = (key: string, researcher: ResearcherJson) => {
        // Skip if already migrated
        if (researcherIdMap.has(key)) return;

        const researcherId = insertResearcher({
          key,
          name: researcher.name,
          field: researcher.field || null,
          institution: researcher.institution || null,
          nationality: researcher.nationality || null,
          active_years: researcher.active_years || null,
          usage_count: researcher.usage_count || 0,
          status: researcher.status || "AVAILABLE",
        });
        researcherIdMap.set(key, researcherId);
        stats.researchers++;

        // Migrate contributions
        if (researcher.key_contributions) {
          for (const contribution of researcher.key_contributions) {
            insertResearcherContribution(researcherId, contribution);
          }
        }

        // Link articles_mentioned to article_researchers
        if (researcher.articles_mentioned) {
          for (const articleFilename of researcher.articles_mentioned) {
            const fullFilename = articleFilename.endsWith(".html") ? articleFilename : `${articleFilename}.html`;
            const article = getArticleByFilename(fullFilename);
            if (article) {
              linkArticleResearcher(article.id, researcherId);
            }
          }
        }
      };

      // Migrate researchers from main researchers object
      for (const [key, researcher] of Object.entries(researchersData.researchers)) {
        migrateResearcher(key, researcher);
      }

      // Migrate researchers from new_researchers_added if present
      const rawData = researchersData as unknown as Record<string, unknown>;
      const newResearchersAdded = rawData.new_researchers_added;
      if (newResearchersAdded && typeof newResearchersAdded === "object") {
        for (const [key, researcher] of Object.entries(newResearchersAdded as Record<string, ResearcherJson>)) {
          migrateResearcher(key, researcher);
        }
      }

      // Migrate researchers at root level (check for researcher-like objects)
      const reservedKeys = ["_meta", "researchers", "institutions", "suggested_new_researchers", "new_researchers_added"];
      for (const [key, value] of Object.entries(rawData)) {
        if (reservedKeys.includes(key)) continue;
        if (value && typeof value === "object" && "name" in value && "field" in value) {
          migrateResearcher(key, value as ResearcherJson);
        }
      }
    }

    // 3. Scan HTML files to populate links table
    if (fs.existsSync(WIKI_DIR)) {
      const htmlFiles = fs.readdirSync(WIKI_DIR).filter(f => f.endsWith(".html"));

      for (const file of htmlFiles) {
        const article = getArticleByFilename(file);
        if (!article) continue;

        const filePath = path.join(WIKI_DIR, file);
        const content = fs.readFileSync(filePath, "utf-8");

        // Extract all internal links
        const linkMatches = content.matchAll(/href="([^"]*\.html)"/g);
        for (const match of linkMatches) {
          const targetFilename = match[1];
          insertLink(article.id, targetFilename);
          stats.links++;
        }
      }
    }

    // 4. Recalculate inlink counts based on links table
    recalculateInlinkCounts();
  });

  transaction();

  return stats;
}

/**
 * Check if migration is needed (database is empty or doesn't exist).
 */
export function needsMigration(): boolean {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT COUNT(*) as count FROM articles").get() as { count: number };
    return row.count === 0;
  } catch {
    return true;
  }
}
