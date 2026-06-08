// AI Ticket Auto-Resolution — data layer
// Matches the design's data.jsx exactly.

export interface Thresholds {
  auto: number;
  approve: number;
  rewrite: number;
}

export type RouteKey = 'auto' | 'approve' | 'rewrite' | 'eng';

export interface RouteMeta {
  label: string;
  short: string;
  tone: string;
  hex: string;
  soft: string;
  human: string;
}

export interface TypeMeta {
  label: string;
  name: string;
  tone: string;
  hex: string;
  soft: string;
  border: string;
  desc: string;
}

export function routeFor(score: number, thresholds: Thresholds): RouteKey {
  const t = thresholds || { auto: 90, approve: 75, rewrite: 50 };
  if (score >= t.auto)    return 'auto';
  if (score >= t.approve) return 'approve';
  if (score >= t.rewrite) return 'rewrite';
  return 'eng';
}

export const ROUTE_META: Record<RouteKey, RouteMeta> = {
  auto:    { label: 'Auto-resolve',  short: 'Auto',    tone: 'green',  hex: 'var(--success-600)', soft: 'var(--success-50)',  human: 'No human touch' },
  approve: { label: 'CS approval',   short: 'Approve', tone: 'blue',   hex: 'var(--primary-600)', soft: 'var(--primary-50)',  human: 'CS approves or edits' },
  rewrite: { label: 'CS rewrite',    short: 'Rewrite', tone: 'yellow', hex: 'var(--warning-600)', soft: 'var(--warning-50)',  human: 'CS full review' },
  eng:     { label: 'Eng queue',     short: 'Eng',     tone: 'red',    hex: 'var(--error-600)',   soft: 'var(--error-50)',    human: 'Eng manual resolution' },
};

export const TYPE_META: Record<number, TypeMeta> = {
  3: { label: 'Type 3', name: 'Solvable now', tone: 'green',  hex: 'var(--success-600)', soft: 'var(--success-50)', border: '#A6F4C5', desc: 'Wrong setting or missed step — AI self-serves in chat' },
  2: { label: 'Type 2', name: 'Known issue',  tone: 'yellow', hex: 'var(--warning-600)', soft: 'var(--warning-50)', border: '#FEDF89', desc: 'Known bug — AI delivers workaround + ETA' },
  1: { label: 'Type 1', name: 'Novel issue',  tone: 'purple', hex: 'var(--purple-500, #7A5AF8)',  soft: 'var(--purple-50, #F4EBFF)', border: 'var(--purple-200, #E9D7FE)', desc: 'First-occurrence — AI drafts a proposal for review' },
};

export interface ScenarioStep {
  from: 'user' | 'ai';
  text?: string;
  kind?: 'clarify' | 'thinking' | 'classify' | 'resolution' | 'known' | 'novel' | 'confirm' | 'status';
  chips?: string[];
  headline?: string;
  intro?: string;
  resolutionSteps?: string[];
  workaround?: string[];
  captured?: { k: string; v: string }[];
  positive?: string;
  negative?: string;
  attachment?: { name: string; url: string; kind: 'image' | 'video' };
  agent?: boolean;
}

export interface Scenario {
  id: string;
  label: string;
  type: number;
  confidence: number;
  productArea: string;
  priority: string;
  summary: string;
  jira?: string;
  eta?: string;
  kbId?: string;
  ticketId?: string;
  steps: ScenarioStep[];
}

export const SCENARIOS: Record<string, Scenario> = {
  custom: {
    id: 'custom', label: 'Custom Issue', type: 3, confidence: 0,
    productArea: 'General', priority: 'P3',
    summary: 'Custom user-submitted issue',
    steps: [
      { from: 'ai', text: "Hello! Describe your issue in plain language and our AI will classify it and suggest a resolution." }
    ]
  },
  type3: {
    id: 'type3', label: 'Booking widget missing', type: 3, confidence: 94,
    productArea: 'Booking engine', priority: 'P3',
    summary: 'Booking widget not visible on published homepage',
    kbId: 'KB-001',
    ticketId: 'TCK-2041',
    steps: [
      { from: 'user', text: "My booking widget disappeared from my hotel's homepage. Guests can't reserve rooms and I have no idea what changed." },
      { from: 'ai', text: "I can help with that. Let me ask a couple of quick questions so I can pinpoint it — no documentation to dig through." },
      { from: 'ai', kind: 'clarify', text: "Which page is the widget missing from, and did you publish any changes recently?", chips: ['Homepage — published yesterday', 'Homepage — no recent changes', 'A different page'] },
      { from: 'user', text: "Homepage — I published a new hero section yesterday." },
      { from: 'ai', kind: 'thinking', text: 'Matching against 1,240 resolved tickets and known settings…' },
      { from: 'ai', kind: 'classify' },
      { from: 'ai', kind: 'resolution', headline: "Your booking widget is set to 'Draft' on the homepage layout", intro: "When you published the new hero section, the widget block reverted to draft visibility. Here's the 30-second fix:", resolutionSteps: [
        "Open Content → Homepage → Layout editor",
        "Find the 'Booking widget' block (it shows a grey 'Draft' tag)",
        "Toggle visibility to 'Published' in the right-hand block settings",
        "Click 'Publish' in the top-right to push it live" ] },
      { from: 'ai', kind: 'confirm', text: "That should bring the widget straight back. Did this fix it?" },
    ],
  },
  type2: {
    id: 'type2', label: 'Analytics charts blank', type: 2, confidence: 82,
    productArea: 'Analytics', priority: 'P2',
    summary: 'Analytics dashboard charts render blank on load',
    jira: 'CS-4821', eta: 'Fix expected in release 3.14 — ~6 days',
    kbId: 'KB-002',
    ticketId: 'TCK-2044',
    steps: [
      { from: 'user', text: "My analytics dashboard is completely blank. The charts just show a loading spinner forever and never render." },
      { from: 'ai', kind: 'clarify', text: "Got it. Which browser are you on, and does it happen on every report or one specific dashboard?", chips: ['Chrome — every dashboard', 'Safari — every dashboard', 'Just the Overview dashboard'] },
      { from: 'user', text: "Chrome, and it's every dashboard." },
      { from: 'ai', kind: 'thinking', text: 'Matching against the known-issue knowledge base…' },
      { from: 'ai', kind: 'classify' },
      { from: 'ai', kind: 'known', headline: "This is a known issue we're already fixing", intro: "You're hitting a render bug introduced in 3.13 that affects Chrome 124+. Our team has a fix in progress.", workaround: [
        "Open the dashboard, then hard-refresh with ⌘⇧R (Cmd-Shift-R)",
        "Charts will render on the second load while the fix ships" ] },
      { from: 'ai', kind: 'confirm', text: "The workaround should get you unblocked today. Want me to email you the moment the permanent fix ships?", positive: 'Yes, notify me', negative: "Workaround didn't help" },
    ],
  },
  type1: {
    id: 'type1', label: 'Salesforce sync broke', type: 1, confidence: 38,
    productArea: 'Integrations', priority: 'P1',
    summary: 'Salesforce lead sync stopped after 3.13 upgrade',
    ticketId: 'TCK-2048',
    steps: [
      { from: 'user', text: "Our Salesforce integration stopped syncing leads right after your latest update. We've lost a full day of inbound leads and this is business-critical." },
      { from: 'ai', kind: 'clarify', text: "That's serious — let me gather the right context so the team can act fast. When did the last successful sync happen?", chips: ['Yesterday, before the update', 'This morning', "I'm not sure"] },
      { from: 'user', text: "Yesterday afternoon, right before the 3.13 update landed." },
      { from: 'ai', kind: 'thinking', text: 'Searching knowledge base and 1,240 past tickets for a match…' },
      { from: 'ai', kind: 'classify' },
      { from: 'ai', kind: 'novel', headline: "This looks like a new issue — I'm escalating it with full context", intro: "I don't have a confident fix in the knowledge base, so I won't guess. I've packaged everything our engineering team needs and flagged it P1. You won't have to re-explain a thing.", captured: [
        { k: 'Reproduction', v: 'Lead sync halted immediately after 3.13 upgrade' },
        { k: 'Last success', v: 'Yesterday 14:30 PT, pre-upgrade' },
        { k: 'Environment', v: 'Salesforce Enterprise · API v59 · 3.13.2' },
        { k: 'Blast radius', v: '47 customers report the same symptom this week' },
      ] },
      { from: 'ai', kind: 'status', text: "I've opened ticket TCK-2048 and routed it to the Integrations team with a 1-hour SLA. You'll get an update here and by email — no black hole." },
    ],
  },
};

export const SCENARIO_ORDER = ['custom', 'type3', 'type2', 'type1'];

export interface QueueTicket {
  id: string;
  confidence: number;
  type: number;
  priority: string;
  area: string;
  customer: string;
  company: string;
  age: string;
  subject: string;
  draft: string;
  evidence: { t: string; m: number }[];
  reopen: number;
  novel?: boolean;
  status?: 'approved' | 'escalated';
}

export const QUEUE: QueueTicket[] = [
  { id: 'TCK-2041', confidence: 96, type: 3, priority: 'P3', area: 'Booking engine', customer: 'Maya Okonkwo', company: 'Westmoreland Hotel', age: '2m', subject: 'Booking widget not visible after publish',
    draft: "Your booking widget reverted to 'Draft' visibility when you published the new hero section. Open Content → Homepage → Layout, set the Booking widget block to 'Published', then click Publish.",
    evidence: [{ t: 'KB-118 · Widget visibility resets on layout publish', m: 98 }, { t: '37 past tickets resolved with this fix', m: 94 }], reopen: 2 },
  { id: 'TCK-2044', confidence: 88, type: 2, priority: 'P2', area: 'Analytics', customer: 'David Reyes', company: 'Coastline Resorts', age: '8m', subject: 'Dashboard charts render blank in Chrome',
    draft: "This is a known render bug in 3.13 affecting Chrome 124+. Workaround: hard-refresh with ⌘⇧R. A permanent fix ships in release 3.14 (~6 days). Linked to CS-4821.",
    evidence: [{ t: 'KB-204 · Chart render fails on Chrome 124', m: 91 }, { t: 'Linked Jira CS-4821 — in progress', m: 88 }], reopen: 4 },
  { id: 'TCK-2046', confidence: 79, type: 2, priority: 'P3', area: 'Email campaigns', customer: 'Priya Anand', company: 'The Laurel Group', age: '14m', subject: 'Scheduled campaign sent twice to segment',
    draft: "A duplicate-send guard didn't trigger for segments edited within 5 minutes of send. We've paused the affected automation. Workaround: stagger edits 10+ minutes before send. Tracking in CS-4790.",
    evidence: [{ t: 'KB-176 · Duplicate send on rapid segment edit', m: 82 }, { t: '12 similar tickets this month', m: 77 }], reopen: 6 },
  { id: 'TCK-2047', confidence: 64, type: 2, priority: 'P2', area: 'Booking engine', customer: 'Tomás Vidal', company: 'Aria Suites', age: '21m', subject: 'Rate plan shows wrong currency at checkout',
    draft: "Checkout appears to inherit the property default currency instead of the rate-plan override. Suggested: re-save the rate plan currency field to force a refresh. Needs review — partial KB match.",
    evidence: [{ t: 'KB-152 · Currency inheritance on rate plans', m: 66 }, { t: '3 loosely-related tickets', m: 58 }], reopen: 9 },
  { id: 'TCK-2048', confidence: 38, type: 1, priority: 'P1', area: 'Integrations', customer: 'Jordan Blake', company: 'Northwind Hospitality', age: '26m', subject: 'Salesforce lead sync stopped after 3.13',
    draft: "No confident match in the knowledge base. Drafted escalation proposal with reproduction steps, environment, and blast-radius signal (47 customers). Recommend routing to Integrations.",
    evidence: [{ t: 'No KB match above threshold', m: 21 }, { t: '47 customers, same symptom this week', m: 0 }], reopen: 0, novel: true },
  { id: 'TCK-2050', confidence: 92, type: 3, priority: 'P3', area: 'Account', customer: 'Lena Fischer', company: 'Hôtel Mirabeau', age: '31m', subject: 'Cannot invite teammate — button greyed out',
    draft: "Your plan's seat limit (5) is reached, which greys out the invite button. Open Settings → Team → Billing to add a seat, or remove an inactive member to free one up.",
    evidence: [{ t: 'KB-090 · Invite disabled at seat limit', m: 95 }, { t: '52 past tickets resolved with this fix', m: 93 }], reopen: 1 },
];

export interface KbEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  uses: number;
  updated: string;
  flagged?: boolean;
}

export const KB: KbEntry[] = [
  {
    id: 'KB-001',
    title: 'Booking widget disappears after hero publish',
    content: 'When a new hero section is published, the booking widget block can revert to Draft visibility. To resolve this, open Content → Homepage → Layout, select the Booking widget block, toggle its settings to Published, and click Publish.',
    tags: ['booking engine', 'widgets', 'publish'],
    uses: 47,
    updated: '2d ago',
  },
  {
    id: 'KB-002',
    title: 'Analytics dashboard blank on Chrome 124+',
    content: 'Chart.js v3 has a known rendering issue on Chrome 124+ due to the offscreen canvas API change. Fix shipped in 3.14. Advise customers to use Firefox or Safari as a temporary workaround.',
    tags: ['analytics', 'chrome', 'charts'],
    uses: 37,
    updated: '5d ago',
  },
  {
    id: 'KB-003',
    title: 'Email campaign sends twice on rapid segment edit',
    content: 'A known race condition in the segment-save debounce causes a duplicate dispatch when the user edits a segment and triggers send within 800ms. Fixed in 3.14. Workaround: stagger edits 10+ minutes before send.',
    tags: ['email campaigns', 'segments', 'duplicate send'],
    uses: 12,
    updated: '1d ago',
  },
  {
    id: 'KB-004',
    title: 'Invite button greyed out at seat limit',
    content: 'By design: the invite button disables when the account reaches its licensed seat count. Direct customers to the billing page to add seats, or remove an inactive user to free a slot.',
    tags: ['account', 'billing', 'invites', 'by design'],
    uses: 52,
    updated: '12d ago',
  },
];

export interface Metric {
  k: string;
  now: string;
  delta: string;
  sub: string;
  good: boolean;
  baseline: string;
  target: string;
  pct?: number;
}

export const METRICS: Metric[] = [
  { k: 'Deflection rate', now: '63%', delta: '+58 pts', sub: 'closed without Eng', good: true, baseline: '~5% baseline', target: '≥ 85%', pct: 63 },
  { k: 'Avg. time to resolution', now: '1.8 hrs', delta: '−14 days', sub: 'Type 2 / 3 issues', good: true, baseline: '14 days baseline', target: '≤ 2 hrs' },
  { k: 'AI resolution accuracy', now: '87%', delta: '+7 pts', sub: 'no re-open in 7 days', good: true, baseline: '87% current', target: '≥ 80%', pct: 87 },
  { k: 'Cost per ticket', now: '$9.40', delta: '−$18', sub: 'blended', good: true, baseline: '$22–35 baseline', target: '≤ $10' },
  { k: 'CS tickets / rep / week', now: '34', delta: '−42', sub: 'down from 60–80', good: true, baseline: '60–80 baseline', target: '< 35' },
  { k: 'Auto-closed (no human)', now: '41%', delta: '+41 pts', sub: 'fully autonomous', good: true, baseline: '41% current', target: '≥ 45%', pct: 41 },
];

export const TREND = [9, 14, 19, 23, 28, 31, 36, 42, 47, 51, 55, 58, 61, 63];

export const MIX = [
  { type: 3, label: 'Type 3 · auto-resolved',    count: 1840, tone: 'var(--success-500)' },
  { type: 2, label: 'Type 2 · workaround sent',  count: 1120, tone: 'var(--warning-500)' },
  { type: 1, label: 'Type 1 · escalated to Eng', count: 290,  tone: 'var(--purple-500)' },
];

export const FLYWHEEL = [
  { n: 1, title: 'More tickets resolved',   text: 'Every closed ticket — AI or human — becomes a labeled data point.', key: false },
  { n: 2, title: 'Richer knowledge base',   text: 'New resolutions populate the KB in real time; workarounds get attached.', key: false },
  { n: 3, title: 'Better AI matching',      text: 'A denser KB means more accurate classification and faster matches.', key: false },
  { n: 4, title: 'Higher confidence',       text: 'Better matching means more tickets cross the auto-resolve threshold.', key: false },
  { n: 5, title: 'More auto-resolutions',   text: 'Deflection rises, CS bandwidth frees up, SLA compresses to hours.', key: false },
  { n: 6, title: 'CS focuses on quality',   text: 'Freed time is reinvested into KB curation — the fuel that spins the wheel.', key: true },
];
