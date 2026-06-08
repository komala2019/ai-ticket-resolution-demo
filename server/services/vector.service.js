import { KB_ARTICLES } from '../data/kb.js';

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

export function retrieveContext(message, limit = 3) {
  const queryVector = buildVector(message);
  const scored = KB_ARTICLES.map(article => {
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

  return scored;
}
