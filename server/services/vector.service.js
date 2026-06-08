import * as lancedb from "@lancedb/lancedb";
import { KB_ARTICLES } from '../data/kb.js';

let db;
let table;

async function getEmbedding(textOrTexts, apiKey) {
  const isArray = Array.isArray(textOrTexts);
  const input = isArray ? textOrTexts : [textOrTexts];
  
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input,
      model: 'text-embedding-3-small',
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI embedding request failed: ${res.statusText}`);
  }

  const data = await res.json();
  const embeddings = data.data.map(item => item.embedding);
  return isArray ? embeddings : embeddings[0];
}

export async function initDatabase() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("No OPENAI_API_KEY found. LanceDB will not be initialized with embeddings.");
    return;
  }

  try {
    db = await lancedb.connect("server/data/lancedb");
    const tableName = "kb_articles";
    const tableNames = await db.tableNames();
    
    if (tableNames.includes(tableName)) {
      table = await db.openTable(tableName);
      console.log("Opened existing LanceDB table: kb_articles");
      return;
    }

    console.log("LanceDB table 'kb_articles' does not exist. Generating embeddings and seeding...");
    const textsToEmbed = KB_ARTICLES.map(article => 
      `${article.title} ${article.content} ${(article.tags || []).join(' ')}`
    );
    const embeddings = await getEmbedding(textsToEmbed, apiKey);
    
    const seedData = KB_ARTICLES.map((article, index) => ({
      id: article.id,
      title: article.title,
      content: article.content,
      tags: JSON.stringify(article.tags || []),
      updated: article.updated || '',
      vector: embeddings[index]
    }));

    table = await db.createTable(tableName, seedData);
    console.log("Successfully seeded LanceDB with KB embeddings!");
  } catch (error) {
    console.error("Failed to initialize/seed LanceDB:", error);
  }
}

async function getTable() {
  if (table) return table;
  if (!db) {
    db = await lancedb.connect("server/data/lancedb");
  }
  table = await db.openTable("kb_articles");
  return table;
}

// --- Offline TF-IDF Fallback Search ---

function tokenize(text = '') {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function buildVector(text = '') {
  const tokens = tokenize(text);
  const vector = new Map();
  tokens.forEach(token => vector.set(token, (vector.get(token) || 0) + 1));
  return vector;
}

function dot(a, b) {
  let total = 0;
  a.forEach((value, key) => {
    if (b.has(key)) total += value * b.get(key);
  });
  return total;
}

function magnitude(map) {
  let total = 0;
  map.forEach(value => (total += value * value));
  return Math.sqrt(total);
}

function cosineSimilarity(a, b) {
  const denom = magnitude(a) * magnitude(b);
  if (!denom) return 0;
  return dot(a, b) / denom;
}

function fallbackSearch(message, limit = 3) {
  const queryVector = buildVector(message);
  return KB_ARTICLES.map(article => {
    const articleText = `${article.title} ${article.content} ${article.tags.join(' ')}`;
    const articleVector = buildVector(articleText);
    return {
      ...article,
      score: cosineSimilarity(queryVector, articleVector),
    };
  })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// --- Main Exported retrieveContext ---

export async function retrieveContext(message, limit = 3) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return fallbackSearch(message, limit);
  }

  try {
    const queryVector = await getEmbedding(message, apiKey);
    const activeTable = await getTable();
    const dbResults = await activeTable.vectorSearch(queryVector).limit(limit).toArray();
    
    return dbResults.map(r => {
      // Calculate cosine similarity approximation from L2 distance (r._distance)
      // OpenAI embeddings are normalized to unit vector, so cos_sim = 1 - 0.5 * L2^2
      const rawScore = 1 - 0.5 * (r._distance * r._distance);
      const score = Math.max(0, Math.min(1, rawScore));
      
      let parsedTags = [];
      try {
        parsedTags = typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags;
      } catch (e) {
        parsedTags = [];
      }

      return {
        id: r.id,
        title: r.title,
        content: r.content,
        tags: parsedTags,
        updated: r.updated,
        score: parseFloat(score.toFixed(3)),
      };
    });
  } catch (error) {
    console.error("LanceDB search failed, falling back to offline search:", error);
    return fallbackSearch(message, limit);
  }
}
