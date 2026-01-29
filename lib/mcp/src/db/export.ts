/**
 * JSON Export Module
 *
 * Exports database contents to JSON files for dashboard compatibility.
 * These functions should be called after any database write operation.
 */

import * as fs from "fs";
import * as path from "path";
import {
  getDatabase,
  getAllArticles,
  getAllResearchers,
  getAllInstitutions,
  getBrokenLinks,
  getOrphanArticles,
  getTotalLinks,
  getCategoryDistribution,
  getResearcherContributions,
  getResearcherArticles,
} from "./database.js";

const META_DIR = path.join(process.cwd(), "meta");
const ECOSYSTEM_FILE = path.join(META_DIR, "ecosystem.json");
const RESEARCHERS_FILE = path.join(META_DIR, "researchers.json");

/**
 * Export ecosystem data to ecosystem.json
 */
export function exportEcosystemJson(): void {
  const articles = getAllArticles();
  const brokenLinks = getBrokenLinks();
  const orphans = getOrphanArticles();
  const totalLinks = getTotalLinks();
  const categoryDist = getCategoryDistribution();

  // Build articles object (keyed by filename without .html)
  const articlesObj: Record<string, {
    title: string;
    type: string;
    category: string;
    outlinks: number;
    inlinks: number;
    created: string;
  }> = {};

  for (const article of articles) {
    const key = article.filename.replace(".html", "");
    articlesObj[key] = {
      title: article.title,
      type: article.type,
      category: article.category,
      outlinks: article.outlinks,
      inlinks: article.inlinks,
      created: article.created,
    };
  }

  // Build categories object with descriptions
  const categoryDescriptions: Record<string, string> = {
    linguistics: "Language, meaning, and semantic phenomena",
    consciousness: "Memory, awareness, and mental archaeology",
    chronopsychology: "Time perception and temporal experience",
    technology: "Computational linguistics and AI-related semantic phenomena",
    meta: "Index and navigation pages",
  };

  const categoriesObj: Record<string, {
    description: string;
    article_count: number;
    core_concepts: string[];
  }> = {};

  for (const [category, count] of Object.entries(categoryDist)) {
    // Get core concepts (first 6 articles in this category)
    const coreArticles = articles
      .filter(a => a.category === category)
      .slice(0, 6)
      .map(a => a.filename.replace(".html", ""));

    categoriesObj[category] = {
      description: categoryDescriptions[category] || category,
      article_count: count,
      core_concepts: coreArticles,
    };
  }

  // Calculate stats
  const avgLinksPerArticle = articles.length > 0
    ? Math.round((totalLinks / articles.length) * 10) / 10
    : 0;

  const ecosystem = {
    _meta: {
      description: "Not-Wikipedia ecosystem health and structure tracking",
      last_validated: new Date().toISOString().split("T")[0],
      auto_updated_by: "ralph SQLite database export",
    },
    stats: {
      total_articles: articles.length,
      total_internal_links: totalLinks,
      broken_links: brokenLinks.length,
      orphan_articles: orphans.length,
      avg_links_per_article: avgLinksPerArticle,
    },
    articles: articlesObj,
    categories: categoriesObj,
    article_types: {
      phenomenon: "Observable effects or occurrences (e.g., Temporal Debt, Ghost Vocabulary)",
      theory: "Explanatory frameworks (e.g., Lexical Half-life, Mnemonic Commons)",
      methodology: "Research techniques (e.g., Consciousness Archaeology, Echo Cartography)",
      practice: "Applied interventions (e.g., Semantic Hygiene, Collective Memory Maintenance)",
      field: "Academic disciplines (e.g., Chronolinguistics)",
      institution: "Organizations and research bodies",
      hub: "Index and navigation pages",
    },
    expansion_priorities: {
      needed_types: [],
      underrepresented_categories: [] as string[],
      suggested_topics: [],
    },
  };

  // Find underrepresented categories (less than 20% of avg)
  const avgCount = articles.length / Object.keys(categoriesObj).length;
  for (const [category, data] of Object.entries(categoriesObj)) {
    if (data.article_count < avgCount * 0.8) {
      ecosystem.expansion_priorities.underrepresented_categories.push(category);
    }
  }

  fs.writeFileSync(ECOSYSTEM_FILE, JSON.stringify(ecosystem, null, 2));
}

/**
 * Export researcher data to researchers.json
 */
export function exportResearchersJson(): void {
  const researchers = getAllResearchers();
  const institutions = getAllInstitutions();

  // Build researchers object
  const researchersObj: Record<string, {
    name: string;
    field: string;
    institution: string;
    nationality: string;
    active_years: string;
    key_contributions: string[];
    articles_mentioned: string[];
    usage_count: number;
    status: string;
  }> = {};

  for (const researcher of researchers) {
    const contributions = getResearcherContributions(researcher.id);
    const articlesMentioned = getResearcherArticles(researcher.id);

    researchersObj[researcher.key] = {
      name: researcher.name,
      field: researcher.field || "",
      institution: researcher.institution || "",
      nationality: researcher.nationality || "",
      active_years: researcher.active_years || "",
      key_contributions: contributions,
      articles_mentioned: articlesMentioned.map(f => f.replace(".html", "")),
      usage_count: researcher.usage_count,
      status: researcher.status,
    };
  }

  // Build institutions object
  const institutionsObj: Record<string, {
    name: string;
    location: string;
    founded: string;
    focus: string;
    key_researchers: string[];
  }> = {};

  for (const inst of institutions) {
    // Find researchers at this institution
    const keyResearchers = researchers
      .filter(r => r.institution === inst.name)
      .map(r => r.key);

    // Create a key from the name (lowercase, underscores)
    const instKey = inst.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

    institutionsObj[instKey] = {
      name: inst.name,
      location: inst.location || "",
      founded: inst.founded || "",
      focus: inst.focus || "",
      key_researchers: keyResearchers,
    };
  }

  const researchersFile = {
    _meta: {
      description: "Registry of fictional researchers in the Not-Wikipedia universe",
      last_updated: new Date().toISOString().split("T")[0],
      usage_guidelines: "When creating new articles, check this registry. Reuse existing researchers sparingly (max 3-4 articles each). Create new researchers for fresh perspectives. Update this file when adding new researchers.",
    },
    researchers: researchersObj,
    institutions: institutionsObj,
    suggested_new_researchers: [],
  };

  fs.writeFileSync(RESEARCHERS_FILE, JSON.stringify(researchersFile, null, 2));
}

/**
 * Export all data to JSON files.
 * Call this after any database write operation.
 */
export function exportAllJson(): void {
  exportEcosystemJson();
  exportResearchersJson();
}
