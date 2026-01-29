/**
 * Wiki Crawl 404s Tool
 *
 * Crawls the live not-wikipedia.org site to find pages that return 404.
 * Unlike wiki_broken_links (which uses the local database), this tool
 * checks the actual deployed site via HTTP requests.
 *
 * Returns:
 * - List of URLs that return 404
 * - The source pages that link to them
 * - Suggested filenames for creation
 */

import { ToolModule } from "../types.js";

const BASE_URL = "https://not-wikipedia.org";
const PAGES_PREFIX = `${BASE_URL}/wiki/`;
const INDEX_URL = `${BASE_URL}/`;

interface CrawlResult {
  url: string;
  status: number;
  links: string[];
}

interface BrokenLink {
  target: string;
  filename: string;
  suggestedTitle: string;
  sources: string[];
  statusCode: number;
}

interface Crawl404Result {
  brokenLinks: BrokenLink[];
  totalPagesChecked: number;
  totalLinksFound: number;
  crawledPages: string[];
  timestamp: string;
}

/**
 * Extract internal links from HTML content
 */
function extractInternalLinks(html: string, baseUrl: string): string[] {
  const links: Set<string> = new Set();

  // Match href attributes pointing to internal pages
  const hrefRegex = /href=["']([^"']+\.html)["']/gi;
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    let href = match[1];

    // Skip external links and anchors
    if (href.startsWith("http") && !href.startsWith(BASE_URL)) continue;
    if (href.startsWith("#")) continue;
    if (href.startsWith("/wiki/")) continue; // Skip fake wiki links

    // Normalize the URL
    if (href.startsWith("pages/")) {
      links.add(`${BASE_URL}/${href}`);
    } else if (href.startsWith("./wiki/")) {
      links.add(`${BASE_URL}/${href.slice(2)}`);
    } else if (href.startsWith("../wiki/")) {
      links.add(`${BASE_URL}/${href.slice(3)}`);
    } else if (!href.includes("/") && href.endsWith(".html")) {
      // Relative link from a page in pages/
      if (baseUrl.includes("/wiki/")) {
        links.add(`${PAGES_PREFIX}${href}`);
      } else {
        links.add(`${BASE_URL}/wiki/${href}`);
      }
    } else if (href === "index.html" || href === "./index.html") {
      links.add(INDEX_URL);
    }
  }

  return Array.from(links);
}

/**
 * Fetch a URL and return status + content
 */
async function fetchUrl(url: string): Promise<{ status: number; content: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Not-Wikipedia-Crawler/1.0",
      },
    });

    clearTimeout(timeout);

    const content = response.ok ? await response.text() : "";
    return { status: response.status, content };
  } catch (error) {
    // Timeout or network error
    return { status: 0, content: "" };
  }
}

/**
 * Crawl the site starting from index.html
 */
async function crawlSite(maxPages: number = 50): Promise<Crawl404Result> {
  const visited: Set<string> = new Set();
  const toVisit: string[] = [INDEX_URL];
  const brokenLinksMap: Map<string, BrokenLink> = new Map();
  const crawledPages: string[] = [];
  let totalLinksFound = 0;

  while (toVisit.length > 0 && visited.size < maxPages) {
    const url = toVisit.shift()!;
    if (visited.has(url)) continue;

    visited.add(url);
    const { status, content } = await fetchUrl(url);

    if (status === 200) {
      crawledPages.push(url);
      const links = extractInternalLinks(content, url);
      totalLinksFound += links.length;

      // Check each link
      for (const link of links) {
        if (!visited.has(link) && !toVisit.includes(link)) {
          // Quick HEAD check for 404
          try {
            const headResponse = await fetch(link, { method: "HEAD" });

            if (headResponse.status === 404) {
              // Extract filename from URL
              const filename = link.split("/").pop() || "";
              const suggestedTitle = filename
                .replace(".html", "")
                .split("-")
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ");

              if (!brokenLinksMap.has(link)) {
                brokenLinksMap.set(link, {
                  target: link,
                  filename,
                  suggestedTitle,
                  sources: [url],
                  statusCode: 404,
                });
              } else {
                brokenLinksMap.get(link)!.sources.push(url);
              }
            } else if (headResponse.ok) {
              // Add to visit queue if not already there
              toVisit.push(link);
            }
          } catch {
            // Network error - skip
          }
        }
      }
    } else if (status === 404) {
      // The page itself is a 404 - already tracked from wherever we found it
    }

    // Small delay to avoid hammering the server
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const brokenLinks = Array.from(brokenLinksMap.values());

  // Sort by number of sources (most referenced first)
  brokenLinks.sort((a, b) => b.sources.length - a.sources.length);

  return {
    brokenLinks,
    totalPagesChecked: crawledPages.length,
    totalLinksFound,
    crawledPages,
    timestamp: new Date().toISOString(),
  };
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_crawl_404s",
    description: "Crawl the live not-wikipedia.org site to find pages that return 404 errors. Unlike wiki_broken_links (which checks the local database), this tool makes actual HTTP requests to the deployed site. Returns broken links with their source pages and suggested filenames.",
    inputSchema: {
      type: "object",
      properties: {
        max_pages: {
          type: "number",
          description: "Maximum number of pages to crawl (default: 50)",
        },
        return_first: {
          type: "boolean",
          description: "If true, return only the first (highest priority) broken link for immediate action",
        },
      },
      required: [],
    },
  },

  handler: async (args) => {
    const maxPages = (args.max_pages as number) || 50;
    const returnFirst = args.return_first as boolean;

    const result = await crawlSite(maxPages);

    if (returnFirst && result.brokenLinks.length > 0) {
      const first = result.brokenLinks[0];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            action: "create_missing_page",
            target: first,
            totalBrokenLinks: result.brokenLinks.length,
            timestamp: result.timestamp,
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  },
};
