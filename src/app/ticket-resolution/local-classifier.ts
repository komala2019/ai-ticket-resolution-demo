// Client-side classifier for the standalone demo (no backend).
//
// This is a faithful TypeScript port of the backend RuleBasedIssueClassifier
// so the customer chat can handle ANY free-text issue a user types — not just
// the scripted scenarios. It scores the message against the bundled knowledge
// base by keyword/tag overlap, derives a transparent confidence, assigns a
// Type (1/2/3) and route, and builds a grounded response.
//
// NOTE: confidence here is an explainable heuristic, not a learned probability.

import { KbEntry, Thresholds, routeFor } from './ticket-data';
import { Scenario, ScenarioStep } from './ticket-data';

const AREA_KEYWORDS: Record<string, string[]> = {
  'Booking engine': ['booking', 'widget', 'reserve', 'reservation', 'rate plan', 'checkout', 'currency'],
  'Analytics': ['analytics', 'dashboard', 'chart', 'report', 'graph', 'render', 'blank', 'spinner'],
  'Email campaigns': ['email', 'campaign', 'segment', 'newsletter', 'send', 'unsubscribe'],
  'Integrations': ['integration', 'salesforce', 'sync', 'api', 'webhook', 'crm', 'connector'],
  'Account': ['account', 'invite', 'seat', 'billing', 'login', 'password', 'user', 'permission'],
};

const NOVEL_SIGNALS = [
  'stopped working after', 'after your update', 'after the upgrade', 'lost',
  'business-critical', 'broke', 'no longer', 'suddenly', 'since the latest',
];

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'my', 'i', 'to', 'of', 'on', 'in', 'it',
  'and', 'or', 'for', 'with', 'this', 'that', 'just', 'have', 'has', 'not', 'no', 'you',
  'your', 'me', 'we', 'our', 'after', 'from', 'at', 'be', 'get', 'got', 'when', 'what',
]);

interface ScoredEntry { entry: KbEntry; score: number; }

/** Normalize a word: lowercase, strip a simple plural/verb suffix so
 *  "campaigns"/"sending"/"charged" loosely match "campaign"/"send"/"charge". */
function norm(w: string): string {
  w = w.toLowerCase();
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
  return w;
}

function tokenize(text: string): Set<string> {
  if (!text) return new Set();
  return new Set(
    text.split(/[\s.,;:!?()'"\-/]+/)
      .filter(w => w.length > 2 && !STOP.has(w))
      .map(norm)
      .filter(w => w.length > 2),
  );
}

/** Tag phrases split into individual normalized words (so "duplicate send"
 *  contributes "duplicate" and "send" separately). */
function tagWords(tags: string[]): Set<string> {
  const out = new Set<string>();
  (tags || []).forEach(tag =>
    tag.split(/[\s/]+/).forEach(w => { if (w.length > 2) out.add(norm(w)); }));
  return out;
}

function detectArea(haystack: string): string | null {
  let bestArea: string | null = null;
  let bestHits = 0;
  for (const area of Object.keys(AREA_KEYWORDS)) {
    const hits = AREA_KEYWORDS[area].filter(k => haystack.includes(k)).length;
    if (hits > bestHits) { bestHits = hits; bestArea = area; }
  }
  return bestArea;
}

function scoreKb(haystack: string, kb: KbEntry[]): ScoredEntry[] {
  const tokens = tokenize(haystack);
  const results: ScoredEntry[] = [];
  for (const entry of kb) {
    const entryTokens = tokenize((entry.title || '') + ' ' + (entry.content || ''));
    const tags = tagWords(entry.tags || []);

    let overlap = 0;     // meaningful words shared with title/content
    let tagOverlap = 0;  // shared with tag words (stronger signal)
    tokens.forEach(t => {
      if (entryTokens.has(t)) overlap++;
      if (tags.has(t)) tagOverlap++;
    });

    if (overlap === 0 && tagOverlap === 0) continue;

    // Tag matches count double. ~3 solid matches is a confident hit.
    const matches = overlap + tagOverlap;
    let score = Math.round(Math.min(1, matches / 3) * 90);
    if (matches > 0) score += 6;            // floor for any real overlap
    score = Math.max(1, Math.min(97, score));
    results.push({ entry, score });
  }
  return results.sort((a, b) => b.score - a.score);
}

function mentionsKnownBug(e: KbEntry): boolean {
  if (e.id && e.id.startsWith('KB-Cust-')) {
    return false;
  }
  const c = (e.content || '').toLowerCase();
  return c.includes('known') || c.includes('bug') || c.includes('fix shipped') ||
    c.includes('workaround') || (e.tags || []).some(t => t.includes('bug'));
}

export function isBugIntent(message: string, kb: KbEntry[]): boolean {
  const msg = (message || '').toLowerCase();
  if (msg.includes('take a look at the attached file')) return true;
  const scored = scoreKb(msg, kb);
  if (scored.length > 0 && scored[0].score > 30) return true;
  for (const area of Object.keys(AREA_KEYWORDS)) {
    const keywords = AREA_KEYWORDS[area];
    if (keywords.some(k => msg.includes(k))) return true;
  }
  const bugKeywords = [
    ...NOVEL_SIGNALS,
    'bug', 'error', 'fail', 'issue', 'problem', 'broken', 'crash', 
    'wrong', 'missing', 'disappear', 'slow', 'disconnect', 'blank', 
    'empty', 'spinner', 'greyed', 'cannot', 'can\'t', 'unable', 'help'
  ];
  if (bugKeywords.some(bk => msg.includes(bk))) return true;
  return false;
}

export interface LocalClassifyResult {
  type: number;
  confidence: number;
  route: string;
  productArea: string;
  priority: string;
  headline: string;
  intro: string;
  steps: string[];
  evidence: { t: string; m: number }[];
  escalated: boolean;
  bestKb: KbEntry | null;
}

export function classifyIssue(message: string, kb: KbEntry[], thresholds: Thresholds): LocalClassifyResult {
  const t = thresholds || { auto: 90, approve: 75, rewrite: 50 };
  const msg = (message || '').trim();
  const haystack = msg.toLowerCase();

  const area = detectArea(haystack) || 'General';
  const scored = scoreKb(haystack, kb || []);
  const best = scored[0] || null;
  const bestScore = best ? best.score : 0;

  const looksNovel = NOVEL_SIGNALS.some(s => haystack.includes(s));
  let confidence = bestScore;
  // A "novel" phrasing only dents confidence — it no longer hard-caps it,
  // so a strong KB match still resolves (with a human in the loop) instead
  // of always escalating. Weak matches + novel wording still fall to Eng.
  if (looksNovel) confidence = Math.max(0, confidence - 20);
  confidence = Math.max(0, Math.min(100, confidence));

  const route = routeFor(confidence, t);

  let type: number;
  if (looksNovel || !best || confidence < t.rewrite) type = 1;
  else if (confidence >= t.auto && !mentionsKnownBug(best.entry)) type = 3;
  else type = 2;

  const priority = looksNovel || haystack.includes('critical') || haystack.includes('lost')
    ? 'P1' : (type === 2 ? 'P2' : 'P3');

  const evidence = scored.slice(0, 2).map(s => ({ t: s.entry.id + ' · ' + s.entry.title, m: s.score }));

  let headline: string, intro: string, steps: string[], escalated: boolean;
  if (type === 1) {
    escalated = true;
    headline = "This looks like a new issue — escalating it with full context";
    intro = "I don't have a confident fix in the knowledge base, so I won't guess. " +
      "I've packaged everything engineering needs and flagged it " + priority + ".";
    steps = [];
  } else {
    escalated = false;
    headline = best ? best.entry.title : 'Here\'s how to resolve this';
    intro = best ? best.entry.content : 'Try the steps below.';
    steps = best
      ? [best.entry.content, type === 2
        ? 'Apply the workaround above; the permanent fix is tracked and on its way.'
        : 'Save your changes and refresh to confirm the issue is resolved.']
      : ['Reproduce the issue and note the exact error message.',
        'Check the relevant settings for the affected feature.',
        'If it persists, reply here and we\'ll take another look.'];
  }

  return { type, confidence, route, productArea: area, priority, headline, intro, steps, evidence, escalated, bestKb: best ? best.entry : null };
}

/** Build a playable Scenario from a free-text message + classifier result. */
export function buildDynamicScenario(message: string, kb: KbEntry[], thresholds: Thresholds): Scenario {
  const r = classifyIssue(message, kb, thresholds);
  const steps: ScenarioStep[] = [
    { from: 'user', text: message },
    { from: 'ai', kind: 'thinking', text: 'Matching against the knowledge base and past tickets…' },
    { from: 'ai', kind: 'classify' },
  ];

  if (r.escalated) {
    steps.push({
      from: 'ai', kind: 'novel', headline: r.headline, intro: r.intro,
      captured: [
        { k: 'Reported issue', v: message.length > 90 ? message.slice(0, 90) + '…' : message },
        { k: 'Product area', v: r.productArea },
        { k: 'Priority', v: r.priority },
        { k: 'KB match', v: r.bestKb ? (r.bestKb.id + ' (' + r.confidence + '%)') : 'none above threshold' },
      ],
    });
    steps.push({
      from: 'ai', kind: 'status',
      text: "I've opened a ticket and routed it to the right team with a 1-hour SLA. You'll get an update here and by email — no black hole.",
    });
  } else if (r.type === 2) {
    steps.push({ from: 'ai', kind: 'known', headline: r.headline, intro: r.intro, workaround: r.steps });
    steps.push({
      from: 'ai', kind: 'confirm',
      text: 'That workaround should get you unblocked. Want me to notify you when the permanent fix ships?',
      positive: 'Yes, notify me', negative: "Workaround didn't help",
    });
  } else {
    steps.push({ from: 'ai', kind: 'resolution', headline: r.headline, intro: r.intro, resolutionSteps: r.steps });
    steps.push({ from: 'ai', kind: 'confirm', text: 'That should resolve it. Did this fix it?' });
  }

  return {
    id: '__custom',
    label: 'Your issue',
    type: r.type,
    confidence: r.confidence,
    productArea: r.productArea,
    priority: r.priority,
    summary: message,
    jira: r.bestKb ? r.bestKb.id : undefined,
    eta: r.type === 2 ? 'Fix in progress' : undefined,
    kbId: r.bestKb ? r.bestKb.id : undefined,
    steps,
  };
}
export function isVagueQuery(message: string): boolean {
  const msg = (message || '').toLowerCase().trim();
  const words = msg.split(/\s+/).filter(Boolean);
  const wordsCount = words.length;
  if (wordsCount === 0) return true;
  if (wordsCount < 3) return true;

  // Check if it contains any bug/symptom keywords
  const bugKeywords = [
    'bug', 'error', 'fail', 'issue', 'problem', 'broken', 'crash', 
    'wrong', 'missing', 'disappear', 'slow', 'disconnect', 'blank', 
    'empty', 'spinner', 'greyed', 'cannot', 'can\'t', 'unable', 'help',
    'gone', 'stop', 'stopped', 'lost', 'broke', 'suddenly', 'no longer'
  ];

  if (wordsCount < 6) {
    const hasSymptom = bugKeywords.some(keyword => msg.includes(keyword));
    return !hasSymptom;
  }

  return false;
}
