/**
 * Golden evaluation dataset — 8 canonical multi-turn conversation scenarios.
 *
 * Each scenario mirrors realistic support interactions and tests a distinct
 * AI capability. Checks are evaluated against the raw classifier output at
 * each turn using cumulative message context (matching Angular component logic).
 *
 * pass_if(result, thresholds) — returns true = PASS, false = FAIL.
 *   result: return value of classifyIssue()
 *   thresholds: { auto, approve, rewrite }
 */

export const CAPABILITY_WEIGHTS = {
  clarifying_questions:    0.20,
  root_cause_discovery:    0.25,
  avoid_premature_answers: 0.15,
  correct_diagnosis:       0.20,
  actionable_resolution:   0.10,
  proper_escalation:       0.05,
  handles_frustrated:      0.05,
};

export const RATING_BANDS = [
  { min: 90, label: 'EXCELLENT' },
  { min: 75, label: 'GOOD' },
  { min: 60, label: 'NEEDS IMPROVEMENT' },
  { min:  0, label: 'POOR' },
];

export const GOLDEN_EVALS = [
  // ─────────────────────────────────────────────────────────────────────────
  // EVAL-1  Booking Engine Not Working
  // Expected path: vague → checkout context → payment gateway regression
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'EVAL-1',
    name: 'Booking Engine Not Working',
    description: 'Multi-turn — vague start escalates to payment gateway root cause',
    capabilities: ['clarifying_questions', 'root_cause_discovery', 'avoid_premature_answers', 'correct_diagnosis', 'proper_escalation'],
    turns: [
      {
        turn: 1,
        input: 'Booking engine is not working.',
        note: 'Vague single-sentence — system must ask, not answer',
        checks: [
          {
            id: 'E1-T1-A',
            label: 'Should ask clarifying questions (confidence below approve)',
            capability: 'clarifying_questions',
            pass_if: (r, t) => r.confidence < t.approve,
          },
          {
            id: 'E1-T1-B',
            label: 'Did not assume root cause (no premature resolution)',
            capability: 'avoid_premature_answers',
            pass_if: (r, t) => r.confidence < t.approve,
          },
          {
            id: 'E1-T1-C',
            label: 'Booking engine area detected',
            capability: 'root_cause_discovery',
            pass_if: (r) => r.productArea === 'Booking engine',
          },
        ],
      },
      {
        turn: 2,
        input: 'Guests reach checkout but payment fails.',
        note: 'Adds checkout context — still insufficient for confident resolution',
        cumulative: true,
        checks: [
          {
            id: 'E1-T2-A',
            label: 'Continues diagnosis (confidence still below auto)',
            capability: 'clarifying_questions',
            pass_if: (r, t) => r.confidence < t.auto,
          },
          {
            id: 'E1-T2-B',
            label: 'Booking engine area maintained',
            capability: 'root_cause_discovery',
            pass_if: (r) => r.productArea === 'Booking engine',
          },
        ],
      },
      {
        turn: 3,
        input: 'All cards fail. Started yesterday after payment gateway changes.',
        note: 'Full context — regression signals, should provide escalation',
        cumulative: true,
        checks: [
          {
            id: 'E1-T3-A',
            label: 'Booking engine area correctly identified',
            capability: 'correct_diagnosis',
            pass_if: (r) => r.productArea === 'Booking engine',
          },
          {
            id: 'E1-T3-B',
            label: 'Escalation triggered (type 1 — no confident KB match)',
            capability: 'proper_escalation',
            pass_if: (r) => r.type === 1,
          },
          {
            id: 'E1-T3-C',
            label: 'Novel/regression signals detected OR urgency elevated priority',
            capability: 'root_cause_discovery',
            pass_if: (r) => r.looksNovel === true || r.priority !== 'P3',
          },
          {
            id: 'E1-T3-D',
            label: 'Resolution provided (escalated or KB match)',
            capability: 'actionable_resolution',
            pass_if: (r) => r.type === 1 || r.confidence >= 50,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EVAL-2  Analytics Tab Not Working
  // Expected path: vague → spinner context → KB-002 candidate → deployment regression
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'EVAL-2',
    name: 'Analytics Tab Not Working',
    description: 'Multi-turn — escalates from blank screen to backend service failure',
    capabilities: ['clarifying_questions', 'root_cause_discovery', 'correct_diagnosis'],
    turns: [
      {
        turn: 1,
        input: 'Analytics tab not working.',
        note: 'Vague — system must ask what "not working" means',
        checks: [
          {
            id: 'E2-T1-A',
            label: 'Asked clarifying questions (confidence below approve)',
            capability: 'clarifying_questions',
            pass_if: (r, t) => r.confidence < t.approve,
          },
          {
            id: 'E2-T1-B',
            label: 'Analytics area detected',
            capability: 'root_cause_discovery',
            pass_if: (r) => r.productArea === 'Analytics',
          },
        ],
      },
      {
        turn: 2,
        input: 'It keeps loading forever.',
        note: 'Adds spinner/loading signal — KB-002 should surface',
        cumulative: true,
        checks: [
          {
            id: 'E2-T2-A',
            label: 'Analytics area maintained',
            capability: 'root_cause_discovery',
            pass_if: (r) => r.productArea === 'Analytics',
          },
          {
            id: 'E2-T2-B',
            label: 'KB-002 (Analytics blank/Chrome) is best candidate',
            capability: 'root_cause_discovery',
            pass_if: (r) => r.bestKb != null && r.bestKb.id === 'KB-002',
          },
        ],
      },
      {
        turn: 3,
        input: "All dashboards affected after yesterday's deployment.",
        note: 'Scope + timing — should identify as regression, escalate',
        cumulative: true,
        checks: [
          {
            id: 'E2-T3-A',
            label: 'Analytics area identified',
            capability: 'correct_diagnosis',
            pass_if: (r) => r.productArea === 'Analytics',
          },
          {
            id: 'E2-T3-B',
            label: 'Novel/regression signals OR escalation triggered',
            capability: 'root_cause_discovery',
            pass_if: (r) => r.looksNovel === true || r.type === 1,
          },
          {
            id: 'E2-T3-C',
            label: 'Resolution or escalation provided (not General/silent)',
            capability: 'actionable_resolution',
            pass_if: (r) => r.productArea !== 'General',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EVAL-3  User Gives Vague Information
  // Single turn: "The website isn't working" — no area, no specifics
  // System must NOT jump to cache-clear or any specific solution
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'EVAL-3',
    name: 'User Gives Vague Information',
    description: 'Single-turn — completely vague input; must ask, not guess',
    capabilities: ['clarifying_questions', 'avoid_premature_answers'],
    turns: [
      {
        turn: 1,
        input: "The website isn't working.",
        note: 'Zero area keywords — should not assume any specific fix',
        checks: [
          {
            id: 'E3-T1-A',
            label: 'Did not jump to solution (confidence below approve)',
            capability: 'avoid_premature_answers',
            pass_if: (r, t) => r.confidence < t.approve,
          },
          {
            id: 'E3-T1-B',
            label: 'Asked for clarification (low confidence means clarify path)',
            capability: 'clarifying_questions',
            pass_if: (r, t) => r.confidence < t.approve,
          },
          {
            id: 'E3-T1-C',
            label: 'No confident KB match (insufficient information)',
            capability: 'avoid_premature_answers',
            pass_if: (r, t) => !r.bestKb || r.confidence < t.rewrite,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EVAL-4  User Reports Multiple Issues
  // Both booking + analytics broken — should detect as platform incident, P1
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'EVAL-4',
    name: 'User Reports Multiple Issues',
    description: 'Multi-turn — dual system failure escalates to P1 platform incident',
    capabilities: ['root_cause_discovery', 'proper_escalation', 'correct_diagnosis'],
    turns: [
      {
        turn: 1,
        input: "Booking engine and analytics both aren't working.",
        note: 'Two areas — system should detect at least one and gather info',
        checks: [
          {
            id: 'E4-T1-A',
            label: 'Area signal detected (not General)',
            capability: 'root_cause_discovery',
            pass_if: (r) => r.productArea !== 'General',
          },
          {
            id: 'E4-T1-B',
            label: 'Continues to gather info (confidence below approve)',
            capability: 'clarifying_questions',
            pass_if: (r, t) => r.confidence < t.approve,
          },
        ],
      },
      {
        turn: 2,
        input: "Both started after yesterday's release.",
        note: 'Common trigger identified — should recognize shared root cause',
        cumulative: true,
        checks: [
          {
            id: 'E4-T2-A',
            label: 'Escalation triggered (type 1 — novel/unmatched)',
            capability: 'proper_escalation',
            pass_if: (r) => r.type === 1,
          },
          {
            id: 'E4-T2-B',
            label: 'Novel signal OR urgency-elevated priority detected',
            capability: 'root_cause_discovery',
            pass_if: (r) => r.looksNovel === true || r.priority !== 'P3',
          },
          {
            id: 'E4-T2-C',
            label: 'Resolution pathway provided (escalated ticket)',
            capability: 'actionable_resolution',
            pass_if: (r) => r.escalated === true,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EVAL-5  User Wants Immediate Solution
  // "Just tell me how to fix the booking engine" — impatient demand
  // System must not invent a random fix without context
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'EVAL-5',
    name: 'User Wants Immediate Solution',
    description: 'Single-turn — impatient demand; system must still gather specifics',
    capabilities: ['avoid_premature_answers', 'clarifying_questions', 'root_cause_discovery'],
    turns: [
      {
        turn: 1,
        input: 'Just tell me how to fix the booking engine.',
        note: 'Demanding tone but zero diagnostic info — still vague',
        checks: [
          {
            id: 'E5-T1-A',
            label: 'Booking engine area detected',
            capability: 'root_cause_discovery',
            pass_if: (r) => r.productArea === 'Booking engine',
          },
          {
            id: 'E5-T1-B',
            label: 'No random solution given (confidence below auto)',
            capability: 'avoid_premature_answers',
            pass_if: (r, t) => r.confidence < t.auto,
          },
          {
            id: 'E5-T1-C',
            label: 'Would ask for specifics (confidence below approve)',
            capability: 'clarifying_questions',
            pass_if: (r, t) => r.confidence < t.approve,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EVAL-6  Angry User
  // "Your booking engine is terrible" — frustrated tone, no error details
  // System must detect area, stay professional, redirect to diagnosis
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'EVAL-6',
    name: 'Angry / Frustrated User',
    description: 'Single-turn — venting tone; system must detect area despite frustration',
    capabilities: ['handles_frustrated', 'clarifying_questions', 'avoid_premature_answers'],
    turns: [
      {
        turn: 1,
        input: 'Your booking engine is terrible.',
        note: 'Frustrated venting — contains area keyword but no bug description',
        checks: [
          {
            id: 'E6-T1-A',
            label: 'Booking engine area detected despite frustrated tone',
            capability: 'handles_frustrated',
            pass_if: (r) => r.productArea === 'Booking engine',
          },
          {
            id: 'E6-T1-B',
            label: 'Redirects to diagnosis (confidence below approve)',
            capability: 'clarifying_questions',
            pass_if: (r, t) => r.confidence < t.approve,
          },
          {
            id: 'E6-T1-C',
            label: 'No auto-resolution shown (route is not auto)',
            capability: 'avoid_premature_answers',
            pass_if: (r) => r.route !== 'auto',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EVAL-7  AI Should Stop Asking Questions
  // User already gave all relevant info in one message — AI must not probe further
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'EVAL-7',
    name: 'User Provides Full Context Upfront',
    description: 'Single-turn — rich context; system must diagnose immediately without more questions',
    capabilities: ['avoid_premature_answers', 'correct_diagnosis', 'proper_escalation', 'root_cause_discovery'],
    turns: [
      {
        turn: 1,
        input: 'Booking engine fails at payment. All cards affected. All properties affected. Started after payment gateway update.',
        note: 'Complete diagnostic info — should show answer, not ask more questions',
        checks: [
          {
            id: 'E7-T1-A',
            label: 'Booking engine area correctly identified',
            capability: 'root_cause_discovery',
            pass_if: (r) => r.productArea === 'Booking engine',
          },
          {
            id: 'E7-T1-B',
            label: 'Provides answer (type=1 OR route=eng — component reconciles to escalation)',
            capability: 'correct_diagnosis',
            pass_if: (r) => r.type === 1 || r.route === 'eng',
          },
          {
            id: 'E7-T1-C',
            label: 'High urgency detected ("all properties" signal → P1/P2)',
            capability: 'proper_escalation',
            pass_if: (r) => r.priority !== 'P3',
          },
          {
            id: 'E7-T1-D',
            label: 'Novel/regression OR eng-route escalation (component reconciles eng→type1)',
            capability: 'avoid_premature_answers',
            pass_if: (r) => r.looksNovel === true || r.type === 1 || r.route === 'eng',
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EVAL-8  AI Learns from Failed Resolution
  // User says "That solution didn't work" — AI must NOT repeat identical answer
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'EVAL-8',
    name: 'Previous Solution Did Not Work',
    description: 'Single-turn — feedback after failure; system must probe, not repeat',
    capabilities: ['avoid_premature_answers', 'root_cause_discovery', 'actionable_resolution'],
    turns: [
      {
        turn: 1,
        input: "That solution didn't work.",
        note: 'Pure feedback — no area, no bug description; must ask what failed',
        checks: [
          {
            id: 'E8-T1-A',
            label: 'Does not auto-resolve (confidence is 0 — no context)',
            capability: 'avoid_premature_answers',
            pass_if: (r, t) => r.confidence < t.approve,
          },
          {
            id: 'E8-T1-B',
            label: 'No confident KB match (general follow-up cannot be routed)',
            capability: 'root_cause_discovery',
            pass_if: (r, t) => r.confidence < t.auto,
          },
          {
            id: 'E8-T1-C',
            label: 'Escalation triggered — asks for specifics via ticket',
            capability: 'actionable_resolution',
            pass_if: (r) => r.type === 1,
          },
        ],
      },
    ],
  },
];
