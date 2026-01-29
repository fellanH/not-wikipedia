/**
 * Wiki Human Seed
 *
 * Fetches random human-written text from public domain sources
 * to serve as creative inspiration ("topic spark") for new articles.
 *
 * Sources (tried in order):
 * 1. Quotable API - short quotes with attribution
 * 2. Fallback corpus - embedded diverse passages
 */

import { ToolModule } from "../types.js";
import * as crypto from "crypto";

interface HumanSeed {
  text: string;
  source: string;
  type: "quote" | "fallback";
  fetchedAt: string;
}

// Embedded fallback corpus - diverse human-written passages
// Used when external APIs are unavailable
const FALLBACK_CORPUS: Array<{ text: string; source: string }> = [
  // Classical literature
  {
    text: "Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.",
    source: "Herman Melville, Moby-Dick"
  },
  {
    text: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
    source: "Jane Austen, Pride and Prejudice"
  },
  {
    text: "In my younger and more vulnerable years my father gave me some advice that I've been turning over in my mind ever since.",
    source: "F. Scott Fitzgerald, The Great Gatsby"
  },
  {
    text: "All happy families are alike; each unhappy family is unhappy in its own way.",
    source: "Leo Tolstoy, Anna Karenina"
  },
  {
    text: "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.",
    source: "Charles Dickens, A Tale of Two Cities"
  },
  // Poetry
  {
    text: "The fog comes on little cat feet. It sits looking over harbor and city on silent haunches and then moves on.",
    source: "Carl Sandburg, Fog"
  },
  {
    text: "I have measured out my life with coffee spoons.",
    source: "T.S. Eliot, The Love Song of J. Alfred Prufrock"
  },
  {
    text: "Two roads diverged in a yellow wood, and sorry I could not travel both.",
    source: "Robert Frost, The Road Not Taken"
  },
  {
    text: "I wandered lonely as a cloud that floats on high o'er vales and hills.",
    source: "William Wordsworth, I Wandered Lonely as a Cloud"
  },
  {
    text: "The world is too much with us; late and soon, getting and spending, we lay waste our powers.",
    source: "William Wordsworth, The World Is Too Much With Us"
  },
  // Philosophy
  {
    text: "Whereof one cannot speak, thereof one must be silent.",
    source: "Ludwig Wittgenstein, Tractatus Logico-Philosophicus"
  },
  {
    text: "He who has a why to live can bear almost any how.",
    source: "Friedrich Nietzsche, Twilight of the Idols"
  },
  {
    text: "The only thing I know is that I know nothing.",
    source: "Socrates (via Plato)"
  },
  {
    text: "One cannot step twice in the same river.",
    source: "Heraclitus"
  },
  {
    text: "Man is condemned to be free; because once thrown into the world, he is responsible for everything he does.",
    source: "Jean-Paul Sartre, Existentialism is a Humanism"
  },
  // Scientific writing
  {
    text: "There is grandeur in this view of life, with its several powers, having been originally breathed into a few forms or into one.",
    source: "Charles Darwin, On the Origin of Species"
  },
  {
    text: "The cosmos is within us. We are made of star-stuff. We are a way for the universe to know itself.",
    source: "Carl Sagan, Cosmos"
  },
  {
    text: "Nature uses only the longest threads to weave her patterns, so that each small piece of her fabric reveals the organization of the entire tapestry.",
    source: "Richard Feynman, The Character of Physical Law"
  },
  // Essays
  {
    text: "I write entirely to find out what I'm thinking, what I'm looking at, what I see and what it means.",
    source: "Joan Didion, Why I Write"
  },
  {
    text: "The only way to deal with an unfree world is to become so absolutely free that your very existence is an act of rebellion.",
    source: "Albert Camus, The Myth of Sisyphus"
  },
  {
    text: "We do not see things as they are, we see them as we are.",
    source: "Anaïs Nin, Seduction of the Minotaur"
  },
  {
    text: "In the middle of difficulty lies opportunity.",
    source: "Albert Einstein"
  },
  {
    text: "The mind is its own place, and in itself can make a heaven of hell, a hell of heaven.",
    source: "John Milton, Paradise Lost"
  },
  {
    text: "Time is the substance I am made of. Time is a river which sweeps me along, but I am the river.",
    source: "Jorge Luis Borges, A New Refutation of Time"
  },
  {
    text: "Memory is the diary we all carry about with us.",
    source: "Oscar Wilde"
  },
  // Modern literature
  {
    text: "So we beat on, boats against the current, borne back ceaselessly into the past.",
    source: "F. Scott Fitzgerald, The Great Gatsby"
  },
  {
    text: "The past is never dead. It's not even past.",
    source: "William Faulkner, Requiem for a Nun"
  },
  {
    text: "Perhaps one did not want to be loved so much as to be understood.",
    source: "George Orwell, 1984"
  },
  {
    text: "I took a deep breath and listened to the old brag of my heart: I am, I am, I am.",
    source: "Sylvia Plath, The Bell Jar"
  },
  {
    text: "We are what we pretend to be, so we must be careful about what we pretend to be.",
    source: "Kurt Vonnegut, Mother Night"
  }
];

function secureRandomInt(max: number): number {
  if (max <= 0) return 0;
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  return randomValue % max;
}

async function fetchFromQuotableAPI(): Promise<HumanSeed | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch("https://api.quotable.io/random?minLength=50&maxLength=200", {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    return {
      text: data.content,
      source: data.author,
      type: "quote",
      fetchedAt: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function getFallbackSeed(): HumanSeed {
  const index = secureRandomInt(FALLBACK_CORPUS.length);
  const passage = FALLBACK_CORPUS[index];
  return {
    text: passage.text,
    source: passage.source,
    type: "fallback",
    fetchedAt: new Date().toISOString()
  };
}

async function getHumanSeed(): Promise<HumanSeed> {
  // Try Quotable API first
  const quoteSeed = await fetchFromQuotableAPI();
  if (quoteSeed) return quoteSeed;

  // Fall back to embedded corpus
  return getFallbackSeed();
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_human_seed",
    description: "Fetch a random human-written text passage to serve as creative inspiration for new articles. Returns a quote or passage from literature, philosophy, or essays. Use this as a 'topic spark' - the themes and imagery can inspire Not-Wikipedia article topics.",
    inputSchema: {
      type: "object",
      properties: {
        use_fallback: {
          type: "boolean",
          description: "If true, skip external APIs and use only the embedded fallback corpus"
        }
      },
      required: []
    }
  },

  handler: async (args) => {
    const useFallback = args.use_fallback as boolean;

    let seed: HumanSeed;
    if (useFallback) {
      seed = getFallbackSeed();
    } else {
      seed = await getHumanSeed();
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify(seed, null, 2)
      }]
    };
  }
};
