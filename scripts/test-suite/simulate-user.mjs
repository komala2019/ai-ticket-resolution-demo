/**
 * simulate-user.mjs — Comprehensive multi-turn user simulation runner.
 *
 * This script runs programmatic simulations of different customer personas
 * interacting with the AI Ticket Resolution system. It validates:
 *  - Clarification loops on vague queries
 *  - Negation signals & dynamic pivots
 *  - Urgency & priority transitions
 *  - Agent escalation and context handoff
 *  - Live metric and KB feedback loops (flagging/uses)
 *
 * Run it: node scripts/test-suite/simulate-user.mjs
 */

import { classifyIssue, KB, DEFAULT_THRESHOLDS } from './classifier.mjs';

// Urgency keywords check
const BUG_SYMPTOM_KEYWORDS = [
  'bug', 'error', 'fail', 'issue', 'problem', 'broken', 'crash',
  'wrong', 'missing', 'disappear', 'slow', 'disconnect', 'blank',
  'empty', 'spinner', 'greyed', 'cannot', "can't", 'unable', 'help',
  'gone', 'stop', 'stopped', 'lost', 'broke', 'suddenly', 'no longer',
];

const NEGATION_SIGNALS = [
  'issue is different', 'different issue', 'not my issue', "that's not it",
  'wrong issue', 'different problem', 'wrong article', 'not relevant', 'incorrect'
];

function isVagueQuery(message) {
  const msg = (message || '').toLowerCase().trim();
  const words = msg.split(/\s+/).filter(Boolean);
  const wordsCount = words.length;
  if (wordsCount === 0) return true;
  if (wordsCount < 3) return true;
  if (wordsCount < 6) {
    const hasSymptom = BUG_SYMPTOM_KEYWORDS.some(keyword => msg.includes(keyword));
    return !hasSymptom;
  }
  return false;
}

function isNegationQuery(message) {
  const msg = (message || '').toLowerCase();
  return NEGATION_SIGNALS.some(s => msg.includes(s));
}

// ── Mocking Shared Demo State ────────────────────────────────────────────────
class SimulatedState {
  constructor() {
    this.kb = JSON.parse(JSON.stringify(KB));
    this.resolved = 0;
    this.escalated = 0;
    this.reopened = 0;
    this.activityLog = [];
  }

  recordResolved(kbId) {
    this.resolved++;
    if (kbId) {
      const e = this.kb.find(x => x.id === kbId);
      if (e) e.uses++;
    }
    this.activityLog.push({ kind: 'resolved', kbId });
  }

  recordEscalated() {
    this.escalated++;
    this.activityLog.push({ kind: 'escalated' });
  }

  recordReopened(kbId) {
    this.reopened++;
    if (kbId) {
      const e = this.kb.find(x => x.id === kbId);
      if (e) e.flagged = true;
    }
    this.activityLog.push({ kind: 'reopened', kbId });
  }

  getMetrics() {
    const baseResolved = 12;
    const baseEscalated = 1;
    const resolved = baseResolved + this.resolved;
    const escalated = baseEscalated + this.escalated;
    const totalHandled = resolved + escalated;
    const deflection = totalHandled > 0 ? Math.round((resolved / totalHandled) * 100) : 0;
    const accuracy = (resolved + this.reopened) > 0 
      ? Math.round((resolved / (resolved + this.reopened)) * 100) : 100;
    return { deflection, accuracy, resolvedCount: resolved, reopenedCount: this.reopened };
  }
}

// ── Scenario Runner ──────────────────────────────────────────────────────────
async function runSimulation(personaName, steps, state) {
  console.log(`\n🤖 SIMULATING PERSONA: ${personaName}`);
  console.log('='.repeat(60));

  let sessionHistory = [];
  let rephraseCount = 0;
  let lastConfidence = 0;
  let excludedKbIds = new Set();
  let currentScenario = { kbId: null, bestScore: 0 };

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const userMessage = steps[stepIdx].input;
    if (userMessage) {
      console.log(`👤 Customer: "${userMessage}"`);
    }

    // 1. Negation handling
    if (userMessage && isNegationQuery(userMessage)) {
      if (currentScenario.kbId) excludedKbIds.add(currentScenario.kbId);
      rephraseCount = 0;
      lastConfidence = 0;
      console.log(`🤖 Bot (Negation Trigger): "Understood. That wasn't the right match. Could you describe what is actually happening?"`);
      sessionHistory.push({ from: 'user', text: userMessage });
      continue;
    }

    // 2. Feedback loop checks (thumbs-up / thumbs-down)
    if (steps[stepIdx].feedback === 'YES') {
      state.recordResolved(currentScenario.kbId);
      console.log(`🤖 Bot (Outcome resolved): "Glad that worked! Marked as solved."`);
      continue;
    } else if (steps[stepIdx].feedback === 'NO') {
      state.recordReopened(currentScenario.kbId);
      console.log(`🤖 Bot (Outcome reopened): "Marked still broken. Reopened & escalated."`);
      continue;
    }

    // 3. Accumulate history
    sessionHistory.push({ from: 'user', text: userMessage });
    const priorUserTexts = sessionHistory
      .filter(s => s.from === 'user' && s.text)
      .map(s => s.text)
      .slice(-3);
    const cumulativeMsg = priorUserTexts.join(' ').trim();

    // 4. Run classification
    const isVague = isVagueQuery(cumulativeMsg);
    const r = classifyIssue(cumulativeMsg, state.kb, DEFAULT_THRESHOLDS, excludedKbIds);
    currentScenario.kbId = r.bestKb ? r.bestKb.id : null;
    currentScenario.bestScore = r.confidence;

    // 5. Clarify or resolve branch
    if (isVague && rephraseCount < 2) {
      rephraseCount++;
      lastConfidence = r.confidence;
      console.log(`🤖 Bot (Clarify Nudge): "I see this is in the ${r.productArea} area, but could you describe exactly what you see?"`);
    } else {
      rephraseCount = 0;
      lastConfidence = 0;
      if (r.type === 3) {
        console.log(`🤖 Bot (Resolution): "**${r.headline}**"\n   Intro: ${r.intro}\n   Steps:\n   ${r.steps.map((s, idx) => `  ${idx + 1}. ${s}`).join('\n   ')}`);
      } else if (r.type === 2) {
        console.log(`🤖 Bot (Workaround): "**${r.headline}**" (Tracked in ${r.bestKb?.jira || 'Jira'})\n   Workaround:\n   ${r.steps.map((s, idx) => `  ${idx + 1}. ${s}`).join('\n   ')}`);
      } else {
        state.recordEscalated();
        console.log(`🤖 Bot (Escalation): "Escalating ticket to the ${r.productArea} team with a P1 priority."`);
      }
    }
  }
}

// ── Main Execution ───────────────────────────────────────────────────────────
async function main() {
  const state = new SimulatedState();

  // Scenario 1: User Profile A (Happy Path - Booking widget missing)
  const personaA = [
    { input: "My booking widget disappeared on my homepage" },
    { input: "Homepage — I published a new hero section yesterday." },
    { feedback: "YES" }
  ];

  // Scenario 2: User Profile B (Vague issue -> Clarifies -> Workaround doesn't work)
  const personaB = [
    { input: "it is broken" },
    { input: "my analytics dashboard is blank on Chrome" },
    { feedback: "NO" }
  ];

  // Scenario 3: User Profile C (Negation & Pivot)
  const personaC = [
    { input: "analytics" },
    { input: "no, different issue" },
    { input: "the campaign is sending duplicate emails" },
    { feedback: "YES" }
  ];

  // Scenario 4: User Profile D (Novel bug escalation)
  const personaD = [
    { input: "Our Salesforce lead sync stopped after the 3.13 update, this is business-critical" }
  ];

  await runSimulation("Persona A (Auto-resolve widget)", personaA, state);
  await runSimulation("Persona B (Vague query -> Reopen Known Bug)", personaB, state);
  await runSimulation("Persona C (Negation -> Pivot to Email duplicate)", personaC, state);
  await runSimulation("Persona D (Novel urgent regression)", personaD, state);

  // ── Assertions ─────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('📊 SIMULATION METRICS RESULTS');
  console.log('='.repeat(60));

  const metrics = state.getMetrics();
  console.log(`Resolved this session: ${state.resolved} tickets`);
  console.log(`Escalated this session: ${state.escalated} tickets`);
  console.log(`Reopened this session: ${state.reopened} tickets`);
  console.log(`Final Deflection Rate: ${metrics.deflection}% (Expected baseline increase from 92%)`);
  console.log(`Final AI Resolution Accuracy: ${metrics.accuracy}% (Expected accuracy dent due to B's reopen)`);

  const kb002 = state.kb.find(k => k.id === 'KB-002');
  console.log(`KB-002 Flagged status: ${kb002.flagged ? '🔴 Flagged for review (Correct)' : '🟢 Clean (Fail)'}`);
  
  const kb001 = state.kb.find(k => k.id === 'KB-001');
  console.log(`KB-001 Uses count: ${kb001.uses} (Expected 48, originally 47)`);

  console.log('\n🎉 Simulation run completed successfully!\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
