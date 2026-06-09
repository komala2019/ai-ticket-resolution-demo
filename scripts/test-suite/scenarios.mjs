/**
 * 20 realistic customer support test scenarios across 6 categories.
 * Each defines what the classifier SHOULD produce — used by the LLM judge
 * to evaluate whether the actual output is reasonable.
 */

export const SCENARIOS = [

  // ── Category 1: Happy-path KB matches ────────────────────────────────────

  {
    id: 'TC-01',
    category: 'Happy Path',
    name: 'Booking widget missing after publish',
    message: "My booking widget disappeared from my hotel homepage. I published a new hero section yesterday and now guests cannot see the reservation widget at all.",
    expected: { area: 'Booking engine', type: 3, priority: 'P3', kbId: 'KB-001', minConfidence: 60 },
    rationale: 'widget + publish + homepage → KB-001 (self-service). Natural-language noise tokens (~60% calibration). No urgency → P3.',
  },
  {
    id: 'TC-02',
    category: 'Happy Path',
    name: 'Analytics charts blank in Chrome',
    message: "My analytics dashboard is completely blank. All charts show a loading spinner forever in Chrome and never render any data.",
    expected: { area: 'Analytics', type: 2, priority: 'P3', kbId: 'KB-002', minConfidence: 50 },
    rationale: 'analytics + chrome + blank + charts + spinner → KB-002 (known-bug). Noise tokens lower score to ~55%. P3.',
  },
  {
    id: 'TC-03',
    category: 'Happy Path',
    name: 'Email campaign sent twice to segment',
    message: "Our scheduled email campaign just sent twice to the same contact segment. Customers are complaining about duplicate emails. How did this happen?",
    expected: { area: 'Email campaigns', type: 2, priority: 'P3', kbId: 'KB-003', minConfidence: 40 },
    rationale: 'email + campaign + sent twice + segment → KB-003 (known-bug). "customer" adds urgency signal but stays P3. KNOWN GAP: if conf < 50 classifier escalates to Type 1.',
  },
  {
    id: 'TC-04',
    category: 'Happy Path',
    name: 'Invite button greyed out',
    message: "I need to add a new team member but the invite button is completely greyed out. I cannot invite anyone to our workspace.",
    expected: { area: 'Account', type: 3, priority: 'P3', kbId: 'KB-004', minConfidence: 40 },
    rationale: 'invite + greyed → KB-004 (self-service). KNOWN GAP: if conf < rewrite threshold, self-service check is bypassed and type = 1.',
  },
  {
    id: 'TC-05',
    category: 'Happy Path',
    name: 'Booking widget on room page (paraphrase)',
    message: "The booking reservation widget is gone from our room page. Visitors cannot complete a checkout or make reservations anymore.",
    expected: { area: 'Booking engine', kbId: 'KB-001', minConfidence: 20 },
    rationale: 'Paraphrase test: reservation + widget + checkout → should still route to KB-001. Type/conf are lower because no "publish" signal.',
  },

  // ── Category 2: Urgency escalates priority ───────────────────────────────

  {
    id: 'TC-06',
    category: 'Urgency / Priority',
    name: 'Booking widget down — all guests cannot book (P1)',
    message: "Booking widget is missing. This is an outage — all guests cannot book rooms. We are losing revenue every minute. URGENT.",
    expected: { area: 'Booking engine', type: 3, priority: 'P1', kbId: 'KB-001', minConfidence: 50 },
    rationale: 'outage + all guests + cannot book + revenue + urgent → P1 despite self-service fix being available.',
  },
  {
    id: 'TC-07',
    category: 'Urgency / Priority',
    name: 'Analytics outage business-critical',
    message: "Analytics dashboard is completely down. This is business-critical — our entire team depends on these charts for reporting. All dashboards are blank.",
    expected: { area: 'Analytics', type: 2, priority: 'P1', kbId: 'KB-002', minConfidence: 60 },
    rationale: 'business-critical + entire team → P1 urgency on top of known Type 2 bug.',
  },
  {
    id: 'TC-08',
    category: 'Urgency / Priority',
    name: 'Email duplicate — revenue impact critical',
    message: "Campaign sent twice — this is critical, we've upset customers and it could hurt our revenue. We need a fix asap.",
    expected: { area: 'Email campaigns', type: 2, priority: 'P1', kbId: 'KB-003', minConfidence: 50 },
    rationale: 'critical + revenue + asap → P1 even though underlying issue is Type 2.',
  },
  {
    id: 'TC-09',
    category: 'Urgency / Priority',
    name: 'Seat limit — moderately urgent',
    message: "The invite button is greyed out and I urgently need to add a new hire who starts today.",
    expected: { area: 'Account', priority: 'P2', kbId: 'KB-004', minConfidence: 40 },
    rationale: 'urgent → P2 but not P1 (no revenue/outage signal). KB-004 hit expected; type depends on conf vs threshold.',
  },

  // ── Category 3: Novel / regression issues → Type 1 ──────────────────────

  {
    id: 'TC-10',
    category: 'Novel / Regression',
    name: 'Salesforce sync broke after update',
    message: "Our Salesforce integration stopped syncing leads right after your latest update. We have lost a full day of inbound leads and this is business-critical.",
    expected: { area: 'Integrations', type: 1, priority: 'P1', minConfidence: 0 },
    rationale: 'stopped working after + business-critical → novel signals fire, confidence penalised → Type 1 escalation.',
  },
  {
    id: 'TC-11',
    category: 'Novel / Regression',
    name: 'Booking widget broke after upgrade',
    message: "Our booking widget no longer works after the upgrade. It stopped working after the 3.13 release. Something broke in the update.",
    expected: { area: 'Booking engine', type: 1, minConfidence: 0 },
    rationale: 'no longer + stopped working after + broke → multiple novel signals fire → Type 1 even though area is known.',
  },
  {
    id: 'TC-12',
    category: 'Novel / Regression',
    name: 'Analytics suddenly stopped — regression',
    message: "Since the latest platform update our analytics dashboard suddenly stopped loading. Charts were fine before.",
    expected: { area: 'Analytics', type: 1, priority: 'P2', minConfidence: 0 },
    rationale: 'since the latest + suddenly → novel signals, moderate urgency. Escalated despite KB-002 existing.',
  },
  {
    id: 'TC-13',
    category: 'Novel / Regression',
    name: 'Completely novel infrastructure issue',
    message: "Our entire property portal is showing a 502 gateway error. All properties are offline. This started 20 minutes ago with no changes on our side.",
    expected: { area: 'General', type: 1, priority: 'P1', minConfidence: 0 },
    rationale: 'No KB match at all. Urgency signals (all properties, offline) → P1 escalation.',
  },

  // ── Category 4: Vague / ambiguous queries ────────────────────────────────

  {
    id: 'TC-14',
    category: 'Vague / Ambiguous',
    name: 'Extremely vague: "something is wrong"',
    message: "Something is wrong with my account.",
    expected: { area: 'Account', type: 1, priority: 'P3', minConfidence: 0, maxConfidence: 60 },
    rationale: 'account keyword fires area detection but query too vague for KB match. Low confidence → Type 1 or low Type 3.',
  },
  {
    id: 'TC-15',
    category: 'Vague / Ambiguous',
    name: 'No domain keywords at all',
    message: "Hi there, I need some help please.",
    expected: { area: 'General', type: 1, priority: 'P3', minConfidence: 0, maxConfidence: 20 },
    rationale: 'No area keywords, no KB match → Type 1 with near-zero confidence.',
  },
  {
    id: 'TC-16',
    category: 'Vague / Ambiguous',
    name: 'Area detected but no specific issue',
    message: "My booking widget isn't loading but I am not sure if it's related to a recent change.",
    expected: { area: 'Booking engine', type: 3, priority: 'P3', kbId: 'KB-001', minConfidence: 40 },
    rationale: 'booking + widget → area detected and partial KB match. Uncertainty phrase but no explicit negation.',
  },

  // ── Category 5: Multi-area / cross-signal ────────────────────────────────

  {
    id: 'TC-17',
    category: 'Multi-area',
    name: 'Login AND analytics in one message',
    message: "I cannot log into my account dashboard to check my analytics charts. Both login and the analytics are broken.",
    expected: { area: 'Account', priority: 'P3', minConfidence: 20 },
    rationale: 'Both Account and Analytics signals fire. Should pick the stronger match. No priority escalation.',
  },
  {
    id: 'TC-18',
    category: 'Multi-area',
    name: 'Email and booking both mentioned',
    message: "Our email campaigns are not sending and the booking widget is also missing from the homepage.",
    expected: { area: 'Email campaigns', type: 2, priority: 'P3', minConfidence: 30 },
    rationale: 'Two areas. Email + booking both present. Classifier should pick the strongest KB signal.',
  },

  // ── Category 6: Cumulative / multi-turn context ──────────────────────────

  {
    id: 'TC-19',
    category: 'Cumulative Context',
    name: 'Single vague word resolved by follow-up',
    message: "widget disappeared from homepage after publish published new hero section yesterday",
    expected: { area: 'Booking engine', type: 3, priority: 'P3', kbId: 'KB-001', minConfidence: 65 },
    rationale: 'Simulates cumulative context after user clarified. Rich enough for KB-001 match.',
  },
  {
    id: 'TC-20',
    category: 'Cumulative Context',
    name: 'Chrome 124 analytics — technical phrasing',
    message: "charts not rendering in chrome 124 offscreen canvas api analytics dashboard blank spinner",
    expected: { area: 'Analytics', type: 2, priority: 'P3', kbId: 'KB-002', minConfidence: 70 },
    rationale: 'Technical tokens from KB-002 directly. Should score very high on KB-002.',
  },
];
