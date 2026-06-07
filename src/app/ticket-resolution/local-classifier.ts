// Client-side classifier for the standalone demo (no backend).
//
// This is a faithful TypeScript port of the backend RuleBasedIssueClassifier
// so the customer chat can handle ANY free-text issue a user types — not just
// the scripted scenarios. It scores the message against the bundled knowledge
// base by keyword/tag overlap, derives a transparent confidence, assigns a
// Type (1/2/3) and route, and builds a grounded response.
//
// NOTE: confidence here is an explainable heuristic, not a learned probability.

import { KB, KbEntry, Thresholds, routeFor, TYPE_META } from './ticket-data';
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

function tokenize(text: string): Set<string> {
  if (!text) return new Set();
  return new Set(
    text.split(/[\s.,;:!?()'"\-/]+/)
      .filter(w => w.length > 2 && !STOP.has(w)),
  );
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

function scoreKb(haystack: string): ScoredEntry[] {
  const tokens = tokenize(haystack);
  const results: ScoredEntry[] = [];
  for (const entry of KB) {
    const entryTokens = tokenize(((entry.title || '') + ' ' + (entry.content || '')).toLowerCase());
    let titleOverlap = 0;
    tokens.forEach(t => { if (entryTokens.has(t)) titleOverlap++; });
    const tagHits = (entry.tags || []).filter(tag => haystack.includes(tag.toLowerCase())).length;
    if (titleOverlap === 0 && tagHits === 0) continue;
    const denom = Math.max(6, entryTokens.size * 0.35);
    const tokenScore = Math.min(1, titleOverlap / denom);
    const tagScore = Math.min(1, tagHits / 2);
    let score = Math.round((tagScore * 0.6 + tokenScore * 0.4) * 100);
    score = Math.max(1, Math.min(99, score));
    results.push({ entry, score });
  }
  return results.sort((a, b) => b.score - a.score);
}

function mentionsKnownBug(e: KbEntry): boolean {
  const c = (e.content || '').toLowerCase();
  return c.includes('known') || c.includes('bug') || c.includes('fix shipped') ||
    c.includes('workaround') || (e.tags || []).some(t => t.includes('bug'));
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

export function classifyIssue(message: string, thresholds: Thresholds): LocalClassifyResult {
  const t = thresholds || { auto: 90, approve: 75, rewrite: 50 };
  const msg = (message || '').trim();
  const haystack = msg.toLowerCase();

  const area = detectArea(haystack) || 'General';
  const scored = scoreKb(haystack);
  const best = scored[0] || null;
  const bestScore = best ? best.score : 0;

  const looksNovel = NOVEL_SIGNALS.some(s => haystack.includes(s));
  let confidence = bestScore;
  if (looksNovel) confidence = Math.min(confidence, 45);
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
export function buildDynamicScenario(message: string, thresholds: Thresholds): Scenario {
  const r = classifyIssue(message, thresholds);
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
    steps,
  };
}
