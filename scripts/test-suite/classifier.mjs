/**
 * Pure-JS port of src/app/ticket-resolution/local-classifier.ts
 * Strips TypeScript type annotations so Node.js can run it directly.
 * Must stay in sync with the TS source.
 */

// ── KB data (from ticket-data.ts) ────────────────────────────────────────────

export const DEFAULT_THRESHOLDS = { auto: 90, approve: 75, rewrite: 50 };

export function routeFor(score, thresholds) {
  const t = thresholds || DEFAULT_THRESHOLDS;
  if (score >= t.auto)    return 'auto';
  if (score >= t.approve) return 'approve';
  if (score >= t.rewrite) return 'rewrite';
  return 'eng';
}

export const KB = [
  {
    id: 'KB-001',
    title: 'Booking widget disappears after hero publish',
    content: 'When a new hero section is published, the booking widget block can revert to Draft visibility. This is a quick self-service fix — no engineering needed.',
    tags: ['booking engine', 'widgets', 'publish'],
    uses: 47, updated: '2d ago', kind: 'self-service',
    steps: [
      'Open Content → Homepage → Layout editor',
      "Find the 'Booking widget' block — it shows a grey 'Draft' tag",
      "Toggle its visibility to 'Published' in the right-hand block settings",
      "Click 'Publish' in the top-right to push the change live",
    ],
  },
  {
    id: 'KB-002',
    title: 'Analytics dashboard blank on Chrome 124+',
    content: 'Chart.js v3 has a known rendering issue on Chrome 124+ due to the offscreen canvas API change. A permanent fix ships in release 3.14 (~6 days). Use the workaround below to unblock yourself now.',
    tags: ['analytics', 'chrome', 'charts'],
    uses: 37, updated: '5d ago', kind: 'known-bug', jira: 'CS-4821', etaDays: 6,
    steps: [
      'Open the blank dashboard in Chrome',
      'Hard-refresh with ⌘⇧R (Mac) or Ctrl+Shift+R (Windows)',
      'Charts will render correctly on the second load',
      'As an alternative, use Firefox or Safari until release 3.14 ships',
    ],
  },
  {
    id: 'KB-003',
    title: 'Email campaign sends twice on rapid segment edit',
    content: 'A known race condition in the segment-save debounce causes a duplicate dispatch when the user edits a segment and triggers send within 800ms. Fixed in 3.14.',
    tags: ['email campaigns', 'segments', 'duplicate send'],
    uses: 12, updated: '1d ago', kind: 'known-bug', jira: 'CS-4790', etaDays: 5,
    steps: [
      'Pause or archive the affected automation to prevent further duplicates',
      'Stagger segment edits 10+ minutes before any scheduled send time',
      'Notify affected recipients with a follow-up apology if needed',
      'The permanent fix ships in release 3.14 — tracked under CS-4790',
    ],
  },
  {
    id: 'KB-004',
    title: 'Invite button greyed out at seat limit',
    content: "By design: the invite button disables when the account reaches its licensed seat count. This is self-service — no bug or engineering fix needed.",
    tags: ['account', 'billing', 'invites', 'seat limit'],
    uses: 52, updated: '12d ago', kind: 'self-service',
    steps: [
      'Go to Settings → Team → Billing',
      "Click 'Add seat' and confirm the billing change (takes effect immediately)",
      'Alternatively, go to Settings → Team → Members and remove an inactive user to free an existing seat',
      'The invite button re-enables as soon as a seat is available',
    ],
  },
];

// ── Classifier constants ──────────────────────────────────────────────────────

const AREA_KEYWORDS = {
  'Booking engine': ['booking', 'widget', 'reserve', 'reservation', 'rate plan', 'checkout', 'currency', 'price', 'pricing', 'cost', 'rate', 'charge', 'pay', 'checkout', 'book', 'guests', 'room'],
  'Analytics':      ['analytics', 'dashboard', 'chart', 'report', 'graph', 'render', 'blank', 'spinner', 'loading', 'stats', 'data', 'metrics', 'views'],
  'Email campaigns':['email', 'campaign', 'segment', 'newsletter', 'send', 'unsubscribe', 'mail', 'dispatch', 'double', 'twice', 'duplicate'],
  'Integrations':   ['integration', 'salesforce', 'sync', 'api', 'webhook', 'crm', 'connector', 'zapier', 'hubspot', 'connect', 'syncing'],
  'Account':        ['account', 'invite', 'seat', 'billing', 'login', 'password', 'user', 'permission', 'invoice', 'plan', 'subscription', 'members', 'access', 'role', 'team', 'teammate', 'sign'],
};

export const NOVEL_SIGNALS = [
  { phrase: 'stopped working after', weight: 14 },
  { phrase: 'after your update',     weight: 13 },
  { phrase: 'after the upgrade',     weight: 13 },
  { phrase: 'since the latest',      weight: 12 },
  { phrase: 'started after',         weight: 12 },
  { phrase: 'no longer',             weight: 10 },
  { phrase: 'broke',                 weight: 10 },
  { phrase: 'suddenly',              weight:  8 },
  { phrase: 'lost',                  weight:  7 },
];

export const KB_SCORE_WEIGHTS = { title: 45, entry: 45, tags: 10 };

export const BUG_SYMPTOM_KEYWORDS = [
  'bug', 'error', 'fail', 'issue', 'problem', 'broken', 'crash',
  'wrong', 'missing', 'disappear', 'slow', 'disconnect', 'blank',
  'empty', 'spinner', 'greyed', 'cannot', "can't", 'unable', 'help',
  'gone', 'stop', 'stopped', 'lost', 'broke', 'suddenly', 'no longer',
];

export const URGENCY_SIGNALS = [
  { phrase: 'business-critical', weight: 40 },
  { phrase: 'outage',            weight: 35 },
  { phrase: 'all properties',    weight: 30 },
  { phrase: 'critical',          weight: 25 },
  { phrase: 'all users',         weight: 25 },
  { phrase: 'offline',           weight: 25 },
  { phrase: 'gateway error',     weight: 25 },
  { phrase: 'payment gateway',   weight: 20 },
  { phrase: 'everyone affected', weight: 22 },
  { phrase: 'all guests',        weight: 22 },
  { phrase: 'revenue',           weight: 20 },
  { phrase: 'lost',              weight: 20 },
  { phrase: 'urgent',            weight: 20 },
  { phrase: 'cannot book',       weight: 20 },
  { phrase: 'asap',              weight: 18 },
  { phrase: 'down',              weight: 15 },
  { phrase: 'stopped working',   weight: 12 },
  { phrase: 'since update',      weight: 10 },
  { phrase: 'customer',          weight:  8 },
];

const URGENCY_NOISE_TOKENS = new Set([
  'busines', 'critical', 'outage', 'revenue', 'urgent', 'asap',
  'everyone', 'affect', 'down', 'all',
]);

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'my', 'i', 'to', 'of', 'on', 'in', 'it',
  'and', 'or', 'for', 'with', 'this', 'that', 'just', 'have', 'has', 'not', 'no', 'you',
  'your', 'me', 'we', 'our', 'after', 'from', 'at', 'be', 'get', 'got', 'when', 'what',
]);

// ── Core helpers ──────────────────────────────────────────────────────────────

const IRREGULAR_VERBS = {
  sent: 'send', ran: 'run', went: 'go', broke: 'break', lost: 'lose', gone: 'go',
};

function norm(w) {
  w = w.toLowerCase();
  if (IRREGULAR_VERBS[w]) return IRREGULAR_VERBS[w];
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
  return w;
}

function tokenize(text) {
  if (!text) return new Set();
  return new Set(
    text.split(/[\s.,;:!?()'"\-/]+/)
      .filter(w => w.length > 2 && !STOP.has(w))
      .map(norm)
      .filter(w => w.length > 2),
  );
}

function tagWords(tags) {
  const out = new Set();
  (tags || []).forEach(tag =>
    tag.split(/[\s/]+/).forEach(w => { if (w.length > 2) out.add(norm(w)); }));
  return out;
}

function buildAreaKeywords(kb) {
  const map = {};
  for (const [area, kws] of Object.entries(AREA_KEYWORDS)) {
    map[area] = [...kws];
  }
  for (const entry of (kb || [])) {
    let matched = null;
    let maxHits = 0;
    for (const [area, kws] of Object.entries(map)) {
      const entryText = [...(entry.tags || []), entry.title || ''].join(' ').toLowerCase();
      const hits = kws.filter(kw => entryText.includes(kw)).length;
      if (hits > maxHits) { maxHits = hits; matched = area; }
    }
    if (matched && maxHits > 0) {
      (entry.tags || []).forEach(tag => {
        tag.toLowerCase().split(/[\s/,]+/).forEach(word => {
          const w = word.trim();
          if (w.length > 3 && !map[matched].includes(w)) map[matched].push(w);
        });
      });
    }
  }
  return map;
}

function computeUrgencyScore(haystack, looksNovel, type) {
  const score = URGENCY_SIGNALS.reduce(
    (acc, s) => haystack.includes(s.phrase) ? acc + s.weight : acc, 0,
  );
  return Math.min(100, score + (looksNovel ? 15 : 0) + (type === 1 ? 10 : 0));
}

function urgencyToPriority(urgencyScore) {
  if (urgencyScore >= 35) return 'P1';
  if (urgencyScore >= 15) return 'P2';
  return 'P3';
}

function calculateIdf(kb) {
  const docCount = kb.length;
  const df = {};
  kb.forEach(entry => {
    const entryText = `${entry.title} ${entry.content} ${(entry.tags || []).join(' ')}`;
    const tokens = tokenize(entryText);
    tokens.forEach(t => { df[t] = (df[t] || 0) + 1; });
  });
  const idf = {};
  for (const [term, count] of Object.entries(df)) {
    idf[term] = Math.log((1 + docCount) / (1 + count)) + 1;
  }
  return idf;
}

function getQueryVector(tokens, idf) {
  const vec = {};
  tokens.forEach(t => { vec[t] = idf[t] || 1.0; });
  return vec;
}

function getCosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, val] of Object.entries(vecA)) {
    normA += val * val;
    if (vecB[term]) dotProduct += val * vecB[term];
  }
  for (const val of Object.values(vecB)) {
    normB += val * val;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildCentroids(kb, idf) {
  const centroids = {};
  for (const [area, kws] of Object.entries(AREA_KEYWORDS)) {
    centroids[area] = {};
    kws.forEach(kw => {
      const term = norm(kw);
      if (term.length > 2) centroids[area][term] = 6.0 * (idf[term] || 1.5);
    });
  }
  kb.forEach(entry => {
    let bestArea = null;
    let maxHits = 0;
    for (const [area, kws] of Object.entries(AREA_KEYWORDS)) {
      const entryText = [...(entry.tags || []), entry.title || ''].join(' ').toLowerCase();
      const hits = kws.filter(kw => entryText.includes(kw)).length;
      if (hits > maxHits) { maxHits = hits; bestArea = area; }
    }
    if (bestArea) {
      const entryText = `${entry.title} ${entry.content} ${(entry.tags || []).join(' ')}`;
      const tokens = tokenize(entryText);
      tokens.forEach(t => {
        centroids[bestArea][t] = (centroids[bestArea][t] || 0) + (idf[t] || 1.0);
      });
    }
  });
  return centroids;
}

function detectArea(haystack, kb) {
  const activeKb = kb || [];
  const idf = calculateIdf(activeKb);
  const centroids = buildCentroids(activeKb, idf);
  const queryTokens = tokenize(haystack);
  if (queryTokens.size === 0) return null;
  const queryVec = getQueryVector(queryTokens, idf);
  let bestArea = null;
  let maxSimilarity = 0;
  for (const [area, centroidVec] of Object.entries(centroids)) {
    const similarity = getCosineSimilarity(queryVec, centroidVec);
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      bestArea = area;
    }
  }
  return maxSimilarity > 0.05 ? bestArea : null;
}

function scoreKb(haystack, kb, excludeIds = new Set()) {
  const queryTokens = tokenize(haystack);
  if (queryTokens.size === 0) return [];
  const queryArr = Array.from(queryTokens);
  const results = [];

  for (const entry of (excludeIds.size > 0 ? kb.filter(e => !excludeIds.has(e.id)) : kb)) {
    const entryText = (entry.title || '') + ' ' + (entry.content || '') + ' ' + (entry.tags || []).join(' ');
    const entryTokens = tokenize(entryText);
    const titleTokens = tokenize(entry.title || '');
    const entryTagWords = tagWords(entry.tags || []);

    const titleSize = Math.max(1, titleTokens.size);
    const matchedInTitle = queryArr.filter(t => titleTokens.has(t)).length;
    const titleMatchFraction = matchedInTitle / titleSize;

    const matchedInEntry = queryArr.filter(t => entryTokens.has(t)).length;
    const issueQueryLen = Math.max(1, queryArr.filter(t => !URGENCY_NOISE_TOKENS.has(t)).length);
    const entryMatchFraction = matchedInEntry / issueQueryLen;

    const matchedInTags = queryArr.filter(t => entryTagWords.has(t)).length;
    const tagMatchFraction = matchedInTags / issueQueryLen;

    const rawScore = titleMatchFraction * KB_SCORE_WEIGHTS.title
      + entryMatchFraction * KB_SCORE_WEIGHTS.entry
      + tagMatchFraction   * KB_SCORE_WEIGHTS.tags;
    const score = Math.round(Math.min(100, rawScore));

    if (score > 0) results.push({ entry, score });
  }

  return results.sort((a, b) => b.score - a.score);
}

function mentionsKnownBug(e) {
  if (e.kind === 'known-bug') return true;
  if (e.kind === 'self-service') return false;
  if (e.id && e.id.startsWith('KB-Cust-')) return false;
  const c = (e.content || '').toLowerCase();
  return c.includes('known') || c.includes('bug') || c.includes('fix shipped') ||
    c.includes('workaround') || (e.tags || []).some(t => t.includes('bug'));
}

export function isBugIntent(message, kb, thresholds) {
  const msg = (message || '').toLowerCase();
  if (msg.includes('take a look at the attached file')) return true;
  const scored = scoreKb(msg, kb);
  const bugScoreThreshold = thresholds ? Math.round(thresholds.rewrite * 0.6) : 24;
  if (scored.length > 0 && scored[0].score > bugScoreThreshold) return true;
  const areaKws = buildAreaKeywords(kb);
  for (const kws of Object.values(areaKws)) {
    if (kws.some(k => msg.includes(k))) return true;
  }
  if (NOVEL_SIGNALS.some(s => msg.includes(s.phrase))) return true;
  if (BUG_SYMPTOM_KEYWORDS.some(bk => msg.includes(bk))) return true;
  return false;
}

export function classifyIssue(message, kb, thresholds, excludeIds = new Set()) {
  const t = thresholds || DEFAULT_THRESHOLDS;
  const msg = (message || '').trim();
  const haystack = msg.toLowerCase();

  const area = detectArea(haystack, kb) || 'General';
  const scored = scoreKb(haystack, kb || [], excludeIds);
  const best = scored[0] || null;
  const bestScore = best ? best.score : 0;

  const firedNovelSignals = NOVEL_SIGNALS.filter(s =>
    s.phrase.includes(' ')
      ? haystack.includes(s.phrase)
      : new RegExp('(?<![a-z])' + s.phrase + '(?![a-z])').test(haystack)
  );
  const looksNovel = firedNovelSignals.length > 0;
  const novelPenalty = Math.min(35, firedNovelSignals.reduce((acc, s) => acc + s.weight, 0));

  const areaTag = area !== 'General' ? area.toLowerCase().split(/\s+/)[0] : null;
  const areaMatchBonus = (areaTag && best)
    ? ((best.entry.tags || []).some(t2 => t2.toLowerCase().includes(areaTag)) ? 10 : 0)
    : 0;

  let confidence = Math.max(0, Math.min(100, bestScore - novelPenalty + areaMatchBonus));

  const route = routeFor(confidence, t);

  const isSelfService = best ? best.entry.kind === 'self-service' : false;
  const hasBug = best ? mentionsKnownBug(best.entry) : false;
  const effectiveRewrite = isSelfService ? Math.round(t.rewrite * 0.6) : t.rewrite;

  let type;
  if (looksNovel || !best || confidence < effectiveRewrite) type = 1;
  else if ((confidence >= t.auto || isSelfService) && !hasBug) type = 3;
  else type = 2;

  const urgencyScore = computeUrgencyScore(haystack, looksNovel, type);
  const priority = urgencyToPriority(urgencyScore);

  const evidenceK = confidence >= t.auto ? 1 : confidence >= t.approve ? 2 : 3;
  const evidence = scored.slice(0, evidenceK).map(s => ({ t: s.entry.id + ' · ' + s.entry.title, m: s.score }));

  let headline, intro, steps, escalated;
  if (type === 1) {
    escalated = true;
    headline = looksNovel
      ? 'This looks like a new issue — escalating it with full context'
      : "Couldn't find a confident match — opening a support ticket";
    intro = looksNovel
      ? "I don't have a confident fix in the knowledge base, so I won't guess. I've packaged everything engineering needs and flagged it " + priority + "."
      : "I wasn't able to identify a specific fix for this. I've opened a ticket so the team can look into it — adding a screenshot or steps to reproduce will help.";
    steps = [];
  } else {
    escalated = false;
    headline = best ? best.entry.title : 'Here\'s how to resolve this';
    intro = best ? best.entry.content : 'Try the steps below.';
    steps = best
      ? (best.entry.steps && best.entry.steps.length > 0
          ? best.entry.steps
          : [best.entry.content,
             type === 2
               ? 'Apply the workaround above; the permanent fix is tracked and on its way.'
               : 'Save your changes and refresh to confirm the issue is resolved.'])
      : ['Reproduce the issue and note the exact error message.',
         'Check the relevant settings for the affected feature.',
         'If it persists, reply here and we\'ll take another look.'];
  }

  return { type, confidence, route, productArea: area, priority, headline, intro, steps, evidence, escalated, bestKb: best ? best.entry : null, looksNovel };
}
