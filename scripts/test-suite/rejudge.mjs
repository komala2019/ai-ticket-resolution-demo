/**
 * rejudge.mjs — Full LLM judge pass over all 20 scenarios.
 *
 * Use this whenever you want fresh judge scores after a classifier change,
 * or when the main run.mjs hit the Gemini rate/quota limit.
 *
 * Uses gemini-2.5-flash with 13s gaps (≤5 req/min, free-tier safe).
 * Set GEMINI_API_KEY before running:
 *
 *   $env:GEMINI_API_KEY="..."; node scripts/test-suite/rejudge.mjs
 */

import { classifyIssue, KB, DEFAULT_THRESHOLDS } from './classifier.mjs';
import { SCENARIOS } from './scenarios.mjs';
import process from 'process';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL          = 'gemini-2.5-flash';
const THRESHOLDS     = DEFAULT_THRESHOLDS;
const DELAY_MS       = 13000;  // 13s between calls → ≤5 req/min on free tier

if (!GEMINI_API_KEY) {
  console.error('\n  GEMINI_API_KEY not set.\n  Usage:  $env:GEMINI_API_KEY="..."; node scripts/test-suite/rejudge.mjs\n');
  process.exit(1);
}

// ── Judge prompt ──────────────────────────────────────────────────────────────

function buildJudgePrompt(scenario, result) {
  const kbSnippets = KB.map(k =>
    `[${k.id}] "${k.title}" (kind: ${k.kind}, tags: ${k.tags.join(', ')})`
  ).join('\n');

  return `You are an independent QA judge evaluating a customer-support AI classifier.

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

## Required JSON response (no other text)
{
  "areaAccuracy":    0-10,
  "typeCorrectness": 0-10,
  "priorityScore":   0-10,
  "confidenceCalib": 0-10,
  "overallScore":    0-10,
  "verdict":         "PASS" | "PARTIAL" | "FAIL",
  "reasoning":       "One concise sentence explaining the most important strength or flaw."
}`;
}

// ── Gemini call ───────────────────────────────────────────────────────────────

async function judgeWithGemini(scenario, result) {
  const prompt = buildJudgePrompt(scenario, result);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.0 },
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    return {
      verdict: 'ERROR', overallScore: null, areaAccuracy: null,
      typeCorrectness: null, priorityScore: null, confidenceCalib: null,
      reasoning: `Judge error: ${err.message}`,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function verdictIcon(v) {
  return v === 'PASS' ? '✓' : v === 'PARTIAL' ? '~' : v === 'FAIL' ? '✗' : '?';
}

function scoreBar(n) {
  if (n == null) return '  n/a  ';
  const filled = Math.round((n / 10) * 5);
  return '[' + '█'.repeat(filled) + '░'.repeat(5 - filled) + '] ' + String(n).padStart(2);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const total = SCENARIOS.length;
  const eta   = Math.round((total * DELAY_MS) / 1000);

  console.log('\n' + '═'.repeat(80));
  console.log(`  Full Re-judge — ${total} scenarios  |  Model: ${MODEL}  |  ETA: ~${eta}s`);
  console.log('═'.repeat(80) + '\n');

  const results = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    process.stdout.write(`  [${i + 1}/${total}] ${scenario.id}  ${scenario.name}... `);

    const classifierResult = classifyIssue(scenario.message, KB, THRESHOLDS);
    const judgeResult      = await judgeWithGemini(scenario, classifierResult);

    results.push({ scenario, classifierResult, judgeResult });

    const icon = verdictIcon(judgeResult.verdict);
    console.log(
      `${icon}  ${judgeResult.verdict}  ${judgeResult.overallScore ?? 'n/a'}/10` +
      `  conf=${classifierResult.confidence}%  ${classifierResult.productArea}  Type${classifierResult.type}  ${classifierResult.priority}`
    );
    if (judgeResult.reasoning) console.log(`         → ${judgeResult.reasoning}`);

    if (i < SCENARIOS.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // ── Detailed breakdown ─────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(80));
  console.log('  DETAILED RESULTS');
  console.log('─'.repeat(80));

  for (const { scenario, classifierResult: cr, judgeResult: jr } of results) {
    const icon = verdictIcon(jr.verdict);
    console.log(`\n  ${icon} [${scenario.id}] ${scenario.name}  (${scenario.category})`);
    console.log(`    Message:    "${scenario.message.slice(0, 90)}${scenario.message.length > 90 ? '…' : ''}"`);
    console.log(`    Classifier: area=${cr.productArea}  type=${cr.type}  conf=${cr.confidence}%  route=${cr.route}  priority=${cr.priority}  novel=${cr.looksNovel}`);
    console.log(`    KB hit:     ${cr.bestKb ? cr.bestKb.id + ' · ' + cr.bestKb.title : 'none'}`);
    if (jr.overallScore != null) {
      console.log(`    Scores:     ${scoreBar(jr.areaAccuracy)} area  ${scoreBar(jr.typeCorrectness)} type  ${scoreBar(jr.priorityScore)} priority  ${scoreBar(jr.confidenceCalib)} calib  ${scoreBar(jr.overallScore)} overall`);
    }
    console.log(`    Verdict:    ${jr.verdict}  — ${jr.reasoning}`);
  }

  // ── Scorecard ──────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(80));
  console.log('  SCORECARD');
  console.log('═'.repeat(80));

  const byCategory = {};
  for (const { scenario, judgeResult: jr } of results) {
    if (!byCategory[scenario.category]) byCategory[scenario.category] = [];
    byCategory[scenario.category].push(jr);
  }

  console.log(`\n  ${'Category'.padEnd(26)} ${'Verdict dist'.padEnd(20)} Judge avg`);
  console.log('  ' + '─'.repeat(60));

  let grandTotal = 0, grandN = 0;
  for (const [cat, jrs] of Object.entries(byCategory)) {
    const scored = jrs.filter(j => j.overallScore != null);
    const avg    = scored.length > 0 ? (scored.reduce((s, j) => s + j.overallScore, 0) / scored.length).toFixed(1) : 'n/a';
    const dist   = `✓${jrs.filter(j => j.verdict === 'PASS').length} ~${jrs.filter(j => j.verdict === 'PARTIAL').length} ✗${jrs.filter(j => j.verdict === 'FAIL').length} ?${jrs.filter(j => j.verdict === 'ERROR').length}`;
    console.log(`  ${cat.padEnd(26)} ${dist.padEnd(20)} ${avg}/10`);
    scored.forEach(j => { grandTotal += j.overallScore; grandN++; });
  }

  const grandAvg = grandN > 0 ? (grandTotal / grandN).toFixed(1) : 'n/a';
  const passCount = results.filter(r => r.judgeResult.verdict === 'PASS').length;
  const errorCount = results.filter(r => r.judgeResult.verdict === 'ERROR').length;

  console.log('\n  ' + '─'.repeat(60));
  console.log(`  Judge PASS:    ${passCount}/${total}`);
  console.log(`  Judge average: ${grandAvg}/10  (${grandN} scored, ${errorCount} errors)`);
  console.log(`  Model:         ${MODEL}`);
  console.log('\n' + '═'.repeat(80) + '\n');
}

main().catch(err => {
  console.error('\nFatal:', err);
  process.exit(1);
});
