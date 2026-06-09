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

/**
 * Deterministic overlap-based KB scorer.
 *
 * Replaces the Naïve Bayes approach, which — with only ~4-10 KB entries —
 * distributes probability nearly uniformly via softmax so scores always
 * cluster around 5–15, never reaching the 75/90 auto-resolve thresholds.
 *
 * This scorer computes three transparent signals and combines them:
 *   1. titleMatchFraction  — fraction of the entry's *title* tokens covered by the query
 *                            (captures how on-point the query is for this article)
 *   2. entryMatchFraction  — fraction of *query* tokens found anywhere in the entry
 *                            (captures how much of the user's question is answered)
 *   3. tagMatchFraction    — fraction of query tokens matching entry tags
 *                            (product-area signal)
 *
 * A query whose tokens perfectly cover a title + content scores 90+.
 * An unrelated query scores near 0. No magic constants needed.
 */
function scoreKb(haystack: string, kb: KbEntry[]): ScoredEntry[] {
  const queryTokens = tokenize(haystack);
  if (queryTokens.size === 0) return [];
  const queryArr = Array.from(queryTokens);

  const results: ScoredEntry[] = [];

  for (const entry of kb) {
    // Full entry token set (title + content + tags)
    const entryText = (entry.title || '') + ' ' + (entry.content || '') + ' ' + (entry.tags || []).join(' ');
    const entryTokens = tokenize(entryText);
    const titleTokens = tokenize(entry.title || '');
    const entryTagWords = tagWords(entry.tags || []);

    // 1. How many of the entry's title tokens does the query cover?
    const titleSize = Math.max(1, titleTokens.size);
    const matchedInTitle = queryArr.filter(t => titleTokens.has(t)).length;
    const titleMatchFraction = matchedInTitle / titleSize;

    // 2. How many query tokens appear anywhere in the entry (recall)?
    const matchedInEntry = queryArr.filter(t => entryTokens.has(t)).length;
    const entryMatchFraction = matchedInEntry / Math.max(1, queryArr.length);

    // 3. How many query tokens match entry tag words (area signal)?
    const matchedInTags = queryArr.filter(t => entryTagWords.has(t)).length;
    const tagMatchFraction = matchedInTags / Math.max(1, queryArr.length);

    // Weighted combination: title precision is the strongest discriminator.
    const rawScore = titleMatchFraction * 45 + entryMatchFraction * 45 + tagMatchFraction * 10;
    const score = Math.round(Math.min(100, rawScore));

    if (score > 0) results.push({ entry, score });
  }

  return results.sort((a, b) => b.score - a.score);
}

function mentionsKnownBug(e: KbEntry): boolean {
  // Structured kind field takes precedence over content heuristics.
  if (e.kind === 'known-bug') return true;
  if (e.kind === 'self-service') return false;
  // User-created KB articles are assumed self-service unless tagged otherwise.
  if (e.id && e.id.startsWith('KB-Cust-')) return false;
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
  // Novel phrasing dents confidence (but doesn't hard-cap it) so a strong
  // KB match can still resolve while very weak matches still fall to Eng.
  if (looksNovel) confidence = Math.max(0, confidence - 20);
  confidence = Math.max(0, Math.min(100, confidence));

  const route = routeFor(confidence, t);

  // Self-service entries (user can fix it themselves) always get Type 3 once
  // they clear the rewrite threshold — even if confidence is below auto — because
  // the resolution path is a configuration change, not an engineering fix.
  const isSelfService = best ? best.entry.kind === 'self-service' : false;
  const hasBug = best ? mentionsKnownBug(best.entry) : false;

  let type: number;
  if (looksNovel || !best || confidence < t.rewrite) type = 1;
  else if ((confidence >= t.auto || isSelfService) && !hasBug) type = 3;
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
    // Prefer structured steps from the KB entry; fall back to prose-derived steps.
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

export interface ParsedResolution {
  headline: string;
  intro: string;
  steps: string[];
}

export function parseResolutionText(text: string, fallbackHeadline: string): ParsedResolution {
  const lines = (text || '').split('\n').map(l => l.trim()).filter(Boolean);
  let headline = fallbackHeadline;
  const steps: string[] = [];
  const introParts: string[] = [];

  // Try to find a bold section for the headline (e.g. **Article Title** or **This is a known issue**)
  const boldMatch = text.match(/\*\*(.*?)\*\*/);
  if (boldMatch && boldMatch[1] && boldMatch[1].trim().length > 3) {
    headline = boldMatch[1].trim();
  }

  // Parse lines
  for (const line of lines) {
    // Match numbered list: "1. Open settings" or bullet list: "- Open settings" or "* Open settings"
    const stepMatch = line.match(/^[-*•\d]+\.?\s+(.+)$/);
    if (stepMatch && stepMatch[1]) {
      const stepText = stepMatch[1].replace(/\*\*/g, '').trim();
      if (stepText) {
        steps.push(stepText);
      }
    } else {
      const lowerLine = line.toLowerCase();
      // If line is just stating the matching confirmation or fallback headline, skip it
      if (line.includes('**' + headline + '**') && line.includes('matched')) {
        continue;
      }
      
      // If line is: "Based on your description, I found a matching resolution in our knowledge base: ...", skip it
      if (lowerLine.startsWith('based on your description') && lowerLine.includes('matched')) {
        continue;
      }

      // If it looks like steps inside a single line (like in the local fallback content)
      if (lowerLine.includes('to resolve this,') || lowerLine.includes('workaround:')) {
        const parts = line.split(/(?:to resolve this,|workaround:)/i);
        if (parts[0].trim()) {
          introParts.push(parts[0].trim().replace(/\*\*/g, ''));
        }
        if (parts[1]) {
          // If the rest has action clauses separated by comma or "and"
          const clauses = parts[1].split(/,\s+(?:and\s+)?|;\s+/i);
          clauses.forEach(c => {
            const cl = c.trim().replace(/\.$/, '').replace(/\*\*/g, '');
            if (cl.length > 3) {
              // Capitalize first letter
              steps.push(cl.charAt(0).toUpperCase() + cl.slice(1));
            }
          });
        }
      } else {
        // Remove markdown formatting
        introParts.push(line.replace(/\*\*/g, ''));
      }
    }
  }

  // Fallback if no steps were extracted:
  if (steps.length === 0) {
    if (introParts.length > 0) {
      const lastLine = introParts[introParts.length - 1];
      const verbs = ['open', 'select', 'toggle', 'click', 'go', 'navigate', 'check', 'verify', 'run', 'configure', 'apply', 'stagger', 'direct', 'use', 'hard-refresh', 'refresh', 'advise'];
      const firstWord = lastLine.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
      if (verbs.includes(firstWord)) {
        steps.push(introParts.pop()!);
      }
    }
  }

  // If we still have 0 steps, let's provide a default confirmation step
  if (steps.length === 0) {
    steps.push('Follow the instructions above to resolve the issue.');
  }

  const intro = introParts.join('\n\n').trim();

  return { headline, intro, steps };
}

