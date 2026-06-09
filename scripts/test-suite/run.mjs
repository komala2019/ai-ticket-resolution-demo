/**
 * AI Ticket Classifier — Test Suite with LLM-as-Judge
 *
 * Runs 20 realistic support scenarios through the local classifier,
 * then calls Claude as an independent judge to score each result.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/test-suite/run.mjs
 *   node scripts/test-suite/run.mjs          (skip LLM judge if no key)
 *   node scripts/test-suite/run.mjs --no-judge
 */

import { classifyIssue, KB, DEFAULT_THRESHOLDS } from './classifier.mjs';
import { SCENARIOS } from './scenarios.mjs';
import process from 'process';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SKIP_JUDGE = process.argv.includes('--no-judge') || !ANTHROPIC_API_KEY;
const THRESHOLDS = DEFAULT_THRESHOLDS;

// ── Deterministic pass/fail checks ──────────────────────────────────────────

function assertResult(scenario, result) {
  const { expected } = scenario;
  const checks = [];

  if (expected.area) {
    const pass = result.productArea === expected.area;
    checks.push({ name: 'area', pass, got: result.productArea, want: expected.area });
  }
  if (expected.type !== undefined) {
    const pass = result.type === expected.type;
    checks.push({ name: 'type', pass, got: `Type ${result.type}`, want: `Type ${expected.type}` });
  }
  if (expected.priority) {
    const pass = result.priority === expected.priority;
    checks.push({ name: 'priority', pass, got: result.priority, want: expected.priority });
  }
  if (expected.kbId) {
    const got = result.bestKb ? result.bestKb.id : 'none';
    const pass = got === expected.kbId;
    checks.push({ name: 'kbHit', pass, got, want: expected.kbId });
  }
  if (expected.minConfidence !== undefined) {
    const pass = result.confidence >= expected.minConfidence;
    checks.push({ name: `conf≥${expected.minConfidence}`, pass, got: result.confidence, want: `≥${expected.minConfidence}` });
  }
  if (expected.maxConfidence !== undefined) {
    const pass = result.confidence <= expected.maxConfidence;
    checks.push({ name: `conf≤${expected.maxConfidence}`, pass, got: result.confidence, want: `≤${expected.maxConfidence}` });
  }

  return checks;
}

// ── Claude LLM judge ─────────────────────────────────────────────────────────

async function judgeWithClaude(scenario, result) {
  const kbSnippets = KB.map(k =>
    `[${k.id}] "${k.title}" (kind: ${k.kind}, tags: ${k.tags.join(', ')})`
  ).join('\n');

  const prompt = `You are an independent QA judge evaluating a customer-support AI classifier.

## Knowledge Base (4 articles)
${kbSnippets}

## Classifier Configuration
Thresholds: auto=${THRESHOLDS.auto}, approve=${THRESHOLDS.approve}, rewrite=${THRESHOLDS.rewrite}

## Test Scenario
ID: ${scenario.id} — ${scenario.name}
Category: ${scenario.category}
User message: "${scenario.message}"

## Classifier Output
- Product area:  ${result.productArea}
- Type:          ${result.type} (1=Novel/escalate, 2=Known-bug/workaround, 3=Self-service)
- Confidence:    ${result.confidence}%
- Route:         ${result.route}
- Priority:      ${result.priority}
- Best KB hit:   ${result.bestKb ? result.bestKb.id + ' · ' + result.bestKb.title : 'none'}
- Looks novel:   ${result.looksNovel}
- Evidence:      ${result.evidence.map(e => e.t + ' (' + e.m + '%)').join('; ') || 'none'}

## Evaluation criteria
1. **Area accuracy** — Is the detected product area correct given the message?
2. **Type correctness** — Given the KB articles and the message, is Type 1/2/3 the right call?
3. **Priority reasonableness** — Does P1/P2/P3 match the urgency signals in the message?
4. **Confidence calibration** — Is the confidence score well-calibrated (not inflated or deflated)?
5. **Overall quality** — Would a CS manager trust this result to route the ticket correctly?

## Required JSON response
{
  "areaAccuracy":    0-10,
  "typeCorrectness": 0-10,
  "priorityScore":   0-10,
  "confidenceCalib": 0-10,
  "overallScore":    0-10,
  "verdict":         "PASS" | "PARTIAL" | "FAIL",
  "reasoning":       "One concise sentence explaining the most important strength or flaw."
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    return {
      areaAccuracy: null, typeCorrectness: null, priorityScore: null,
      confidenceCalib: null, overallScore: null,
      verdict: 'ERROR',
      reasoning: `Judge error: ${err.message}`,
    };
  }
}

// ── Main runner ──────────────────────────────────────────────────────────────

const PASS_ICON  = '✓';
const FAIL_ICON  = '✗';
const SKIP_ICON  = '–';

function pad(s, n, right = false) {
  const str = String(s ?? '–');
  return right ? str.padStart(n) : str.padEnd(n);
}

function scoreBar(n, max = 10) {
  if (n == null) return '  n/a ';
  const filled = Math.round((n / max) * 5);
  return '[' + '█'.repeat(filled) + '░'.repeat(5 - filled) + '] ' + String(n).padStart(2);
}

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('  AI Ticket Classifier — Test Suite' + (SKIP_JUDGE ? '  (no LLM judge — set ANTHROPIC_API_KEY)' : '  + Claude Judge'));
  console.log('═'.repeat(80));
  console.log(`  Scenarios: ${SCENARIOS.length}  |  Thresholds: auto=${THRESHOLDS.auto} approve=${THRESHOLDS.approve} rewrite=${THRESHOLDS.rewrite}  |  KB articles: ${KB.length}`);
  console.log('─'.repeat(80) + '\n');

  const results = [];
  let deterministicPass = 0, deterministicTotal = 0;
  let judgeTotal = 0, judgeSum = 0;
  const byCategory = {};

  for (const scenario of SCENARIOS) {
    process.stdout.write(`  Running ${scenario.id}  ${scenario.name}... `);

    // 1. Run classifier
    const result = classifyIssue(scenario.message, KB, THRESHOLDS);

    // 2. Deterministic assertions
    const checks = assertResult(scenario, result);
    const allPass = checks.every(c => c.pass);
    const passCount = checks.filter(c => c.pass).length;
    deterministicTotal += checks.length;
    deterministicPass  += passCount;

    // 3. LLM judge
    let judgeResult = null;
    if (!SKIP_JUDGE) {
      judgeResult = await judgeWithClaude(scenario, result);
      if (judgeResult.overallScore != null) {
        judgeSum  += judgeResult.overallScore;
        judgeTotal++;
      }
      // Brief pause to respect rate limits
      await new Promise(r => setTimeout(r, 600));
    }

    const row = { scenario, result, checks, allPass, passCount, judgeResult };
    results.push(row);

    // Track by category
    if (!byCategory[scenario.category]) byCategory[scenario.category] = { pass: 0, total: 0, judge: 0, judgeN: 0 };
    byCategory[scenario.category].total += checks.length;
    byCategory[scenario.category].pass  += passCount;
    if (judgeResult?.overallScore != null) {
      byCategory[scenario.category].judge  += judgeResult.overallScore;
      byCategory[scenario.category].judgeN++;
    }

    const icon = allPass ? PASS_ICON : FAIL_ICON;
    const judgeScore = judgeResult?.overallScore != null ? `judge=${judgeResult.overallScore}/10` : '';
    console.log(`${icon}  checks=${passCount}/${checks.length}  conf=${result.confidence}%  ${result.productArea}  Type${result.type}  ${result.priority}  ${judgeScore}`);
  }

  // ── Detailed results ──────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(80));
  console.log('  DETAILED RESULTS');
  console.log('─'.repeat(80));

  for (const { scenario, result, checks, allPass, judgeResult } of results) {
    const icon = allPass ? PASS_ICON : FAIL_ICON;
    console.log(`\n  ${icon} [${scenario.id}] ${scenario.name}  (${scenario.category})`);
    console.log(`    Message:    "${scenario.message.slice(0, 90)}${scenario.message.length > 90 ? '…' : ''}"`);
    console.log(`    Classifier: area=${result.productArea}  type=${result.type}  conf=${result.confidence}%  route=${result.route}  priority=${result.priority}  novel=${result.looksNovel}`);
    console.log(`    KB hit:     ${result.bestKb ? result.bestKb.id + ' · ' + result.bestKb.title : 'none'}`);

    // Assertions
    const failedChecks = checks.filter(c => !c.pass);
    if (failedChecks.length > 0) {
      console.log(`    Failures:   ${failedChecks.map(c => `${c.name}: got "${c.got}" want "${c.want}"`).join('  |  ')}`);
    } else {
      console.log(`    Assertions: all ${checks.length} passed`);
    }

    // Judge
    if (judgeResult) {
      const v = judgeResult.verdict;
      const vIcon = v === 'PASS' ? PASS_ICON : v === 'PARTIAL' ? '~' : FAIL_ICON;
      console.log(`    Judge:      ${vIcon} ${v}  overall=${judgeResult.overallScore}/10  area=${judgeResult.areaAccuracy}  type=${judgeResult.typeCorrectness}  pri=${judgeResult.priorityScore}  cal=${judgeResult.confidenceCalib}`);
      console.log(`    Reasoning:  ${judgeResult.reasoning}`);
    }
  }

  // ── Scorecard ─────────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(80));
  console.log('  SCORECARD');
  console.log('═'.repeat(80));

  // Category breakdown
  console.log('\n  By category:\n');
  console.log(`  ${'Category'.padEnd(26)} ${'Assertions'.padEnd(16)} ${'Judge avg'.padEnd(12)}`);
  console.log('  ' + '─'.repeat(54));
  for (const [cat, s] of Object.entries(byCategory)) {
    const pct = Math.round((s.pass / s.total) * 100);
    const judgeAvg = s.judgeN > 0 ? (s.judge / s.judgeN).toFixed(1) : 'n/a';
    const bar = scoreBar(pct, 100);
    console.log(`  ${pad(cat, 26)} ${bar}  ${pct}%  (${s.pass}/${s.total})    ${judgeAvg}`);
  }

  // Overall
  const detPct = Math.round((deterministicPass / deterministicTotal) * 100);
  const judgeAvgStr = judgeTotal > 0 ? (judgeSum / judgeTotal).toFixed(1) + '/10' : 'n/a (set ANTHROPIC_API_KEY)';
  const passedScenarios = results.filter(r => r.allPass).length;

  console.log('\n  Overall:\n');
  console.log(`  Scenarios passed (all assertions):   ${passedScenarios} / ${SCENARIOS.length}`);
  console.log(`  Individual assertions:               ${deterministicPass} / ${deterministicTotal}  (${detPct}%)`);
  console.log(`  LLM judge average score:             ${judgeAvgStr}`);

  // Grade
  let grade;
  if (detPct >= 90) grade = 'A — Excellent';
  else if (detPct >= 75) grade = 'B — Good';
  else if (detPct >= 60) grade = 'C — Needs work';
  else grade = 'D — Significant gaps';
  console.log(`  Grade:                               ${grade}`);

  // Failed scenarios
  const failed = results.filter(r => !r.allPass);
  if (failed.length > 0) {
    console.log(`\n  Failed scenarios (${failed.length}):`);
    for (const { scenario, checks } of failed) {
      const bad = checks.filter(c => !c.pass).map(c => `${c.name}:${c.got}→${c.want}`).join(' ');
      console.log(`    ${FAIL_ICON} [${scenario.id}] ${scenario.name}  — ${bad}`);
    }
  }

  console.log('\n' + '═'.repeat(80) + '\n');

  // Non-zero exit if too many failures
  const failPct = 100 - detPct;
  if (failPct > 40) process.exit(1);
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
