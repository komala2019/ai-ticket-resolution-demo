/**
 * Golden Eval Runner
 *
 * Processes 8 golden evaluation scenarios against the local classifier.
 * For each scenario, messages are accumulated across turns (same as Angular
 * component's cumulativeMsg logic), and each turn's checks are evaluated
 * against the raw classifyIssue() output.
 *
 * Usage:
 *   node scripts/test-suite/eval-runner.mjs
 *   node scripts/test-suite/eval-runner.mjs --json   # machine-readable output
 */

import { classifyIssue, KB, DEFAULT_THRESHOLDS } from './classifier.mjs';
import { GOLDEN_EVALS, CAPABILITY_WEIGHTS, RATING_BANDS } from './golden-evals.mjs';
import process from 'process';

const THRESHOLDS = DEFAULT_THRESHOLDS;
const JSON_MODE = process.argv.includes('--json');

// ── Terminal helpers ──────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  gray:   '\x1b[90m',
};

const p  = (s) => process.stdout.write(s);
const pl = (s = '') => process.stdout.write(s + '\n');
const hr = (ch = '─', len = 80) => pl(C.gray + ch.repeat(len) + C.reset);
const bold = (s) => C.bold + s + C.reset;

function passLabel(pass) {
  return pass ? (C.green + '✓ PASS' + C.reset) : (C.red + '✗ FAIL' + C.reset);
}

function bar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  return C.cyan + '█'.repeat(filled) + C.gray + '░'.repeat(width - filled) + C.reset;
}

// ── Core evaluation ───────────────────────────────────────────────────────────

function runEval(scenario) {
  const turnResults = [];
  const cumulativeParts = [];
  let allChecks = 0;
  let passedChecks = 0;

  for (const turn of scenario.turns) {
    cumulativeParts.push(turn.input);
    const cumulativeMsg = cumulativeParts.join(' ').trim();

    const result = classifyIssue(cumulativeMsg, KB, THRESHOLDS);

    const checkResults = turn.checks.map(check => {
      let passed;
      try {
        passed = !!check.pass_if(result, THRESHOLDS);
      } catch (e) {
        passed = false;
      }
      allChecks++;
      if (passed) passedChecks++;
      return { ...check, passed, result };
    });

    turnResults.push({
      turn: turn.turn,
      input: turn.input,
      cumulativeMsg,
      note: turn.note,
      classifierOutput: {
        area: result.productArea,
        confidence: result.confidence,
        type: result.type,
        route: result.route,
        priority: result.priority,
        looksNovel: result.looksNovel,
        bestKb: result.bestKb ? result.bestKb.id : null,
        escalated: result.escalated,
      },
      checks: checkResults,
    });
  }

  return {
    id: scenario.id,
    name: scenario.name,
    capabilities: scenario.capabilities,
    turns: turnResults,
    allChecks,
    passedChecks,
    score: allChecks > 0 ? Math.round((passedChecks / allChecks) * 100) : 0,
  };
}

// ── Capability score aggregation ──────────────────────────────────────────────

function aggregateCapabilityScores(evalResults) {
  const capStats = {};
  for (const cap of Object.keys(CAPABILITY_WEIGHTS)) {
    capStats[cap] = { total: 0, passed: 0 };
  }

  for (const er of evalResults) {
    for (const turn of er.turns) {
      for (const check of turn.checks) {
        if (capStats[check.capability]) {
          capStats[check.capability].total++;
          if (check.passed) capStats[check.capability].passed++;
        }
      }
    }
  }

  return capStats;
}

function computeMasterScore(capStats) {
  let score = 0;
  for (const [cap, weight] of Object.entries(CAPABILITY_WEIGHTS)) {
    const s = capStats[cap];
    if (s && s.total > 0) {
      score += (s.passed / s.total) * weight * 100;
    }
  }
  return Math.round(score);
}

function getRating(score) {
  return RATING_BANDS.find(b => score >= b.min)?.label ?? 'POOR';
}

// ── Printing ──────────────────────────────────────────────────────────────────

function printEvalResult(er) {
  pl();
  const pct = er.score;
  const statusColor = pct === 100 ? C.green : pct >= 75 ? C.yellow : C.red;
  pl(bold(`[${er.id}] ${er.name}`) + C.gray + `  ${er.passedChecks}/${er.allChecks} checks` + C.reset);

  for (const turn of er.turns) {
    const co = turn.classifierOutput;
    pl();
    pl(`  ${C.dim}Turn ${turn.turn}:${C.reset} ${C.white}"${turn.input}"${C.reset}`);
    pl(`  ${C.gray}${turn.note}${C.reset}`);

    const novelStr = co.looksNovel ? C.yellow + 'novel=yes' + C.reset : C.gray + 'novel=no' + C.reset;
    const kbStr = co.bestKb ? co.bestKb : C.gray + 'none' + C.reset;
    pl(
      `  ${C.gray}→${C.reset}` +
      ` area=${C.cyan}${co.area}${C.reset}` +
      ` conf=${C.cyan}${co.confidence}%${C.reset}` +
      ` type=${C.cyan}${co.type}${C.reset}` +
      ` route=${C.cyan}${co.route}${C.reset}` +
      ` pri=${C.cyan}${co.priority}${C.reset}` +
      ` ${novelStr}` +
      ` kb=${kbStr}`
    );

    for (const check of turn.checks) {
      const indent = '    ';
      pl(`${indent}${passLabel(check.passed)}  ${C.gray}[${check.id}]${C.reset} ${check.label}`);
    }
  }

  const resultLine = `  Score: ${statusColor}${pct}%${C.reset}  ${bar(pct)}`;
  pl();
  pl(resultLine);
}

function printScorecard(capStats, masterScore) {
  pl();
  hr('═');
  pl(bold('  MASTER SCORECARD'));
  hr('═');
  pl();

  const capLabels = {
    clarifying_questions:    'Clarifying Questions',
    root_cause_discovery:    'Root Cause Discovery',
    avoid_premature_answers: 'Avoid Premature Answers',
    correct_diagnosis:       'Correct Diagnosis',
    actionable_resolution:   'Actionable Resolution',
    proper_escalation:       'Proper Escalation',
    handles_frustrated:      'Handles Frustrated Users',
  };

  pl(
    C.gray +
    '  Capability'.padEnd(32) +
    'Weight'.padEnd(8) +
    'Pass%'.padEnd(7) +
    'Score'.padEnd(8) +
    'Progress' +
    C.reset
  );
  hr();

  let totalContrib = 0;
  for (const [cap, weight] of Object.entries(CAPABILITY_WEIGHTS)) {
    const s = capStats[cap];
    const passPct = s && s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0;
    const contrib = (passPct / 100) * weight * 100;
    totalContrib += contrib;

    const label = (capLabels[cap] || cap).padEnd(30);
    const weightStr = `${Math.round(weight * 100)}%`.padEnd(8);
    const passStr = `${passPct}%`.padEnd(7);
    const contribStr = contrib.toFixed(1).padEnd(8);
    const passColor = passPct === 100 ? C.green : passPct >= 75 ? C.yellow : C.red;

    pl(
      `  ${C.white}${label}${C.reset}` +
      `${C.gray}${weightStr}${C.reset}` +
      `${passColor}${passStr}${C.reset}` +
      `${C.cyan}${contribStr}${C.reset}` +
      bar(passPct, 16)
    );
  }

  hr();

  const rating = getRating(masterScore);
  const scoreColor = masterScore >= 90 ? C.green : masterScore >= 75 ? C.yellow : C.red;

  pl(
    `  ${bold('TOTAL SCORE:')}`.padEnd(40) +
    `${scoreColor}${bold(masterScore + ' / 100')}${C.reset}` +
    `  ${C.bold}${rating}${C.reset}`
  );
  pl();

  const ratingDesc = {
    EXCELLENT:        '90–100  All core behaviors correct',
    GOOD:             '75–89   Minor gaps in edge cases',
    'NEEDS IMPROVEMENT': '60–74   Significant gaps in coverage',
    POOR:             '< 60    Fundamental issues to address',
  };
  pl(C.gray + `  Rating scale: ${ratingDesc[rating] ?? rating}` + C.reset);
  pl();
  hr('═');
}

function printGapAnalysis(evalResults, capStats) {
  const gaps = [];

  for (const [cap, s] of Object.entries(capStats)) {
    if (s.total > 0 && s.passed < s.total) {
      gaps.push({ cap, failed: s.total - s.passed, total: s.total });
    }
  }

  if (gaps.length === 0) {
    pl(C.green + '  No gaps — all capability checks passed.' + C.reset);
    return;
  }

  pl(bold('  Gap Analysis'));
  hr();

  const capLabels = {
    clarifying_questions:    'Clarifying Questions',
    root_cause_discovery:    'Root Cause Discovery',
    avoid_premature_answers: 'Avoid Premature Answers',
    correct_diagnosis:       'Correct Diagnosis',
    actionable_resolution:   'Actionable Resolution',
    proper_escalation:       'Proper Escalation',
    handles_frustrated:      'Handles Frustrated Users',
  };

  for (const g of gaps.sort((a, b) => b.failed - a.failed)) {
    pl(`  ${C.red}✗${C.reset} ${capLabels[g.cap] || g.cap}:  ${g.failed}/${g.total} checks failed`);
  }

  pl();
  pl(C.gray + '  Failed checks in detail:' + C.reset);
  for (const er of evalResults) {
    for (const turn of er.turns) {
      for (const check of turn.checks) {
        if (!check.passed) {
          const co = turn.classifierOutput;
          pl(
            `  ${C.red}✗${C.reset} ${C.gray}[${check.id}]${C.reset} ${check.label}` + '\n' +
            `    ${C.gray}Classifier: area=${co.area} conf=${co.confidence}% type=${co.type} pri=${co.priority} novel=${co.looksNovel}${C.reset}`
          );
        }
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  if (!JSON_MODE) {
    pl();
    hr('═');
    pl(bold('  Golden Eval Suite') + C.gray + '  |  8 Scenarios  |  AI Behavior Validation' + C.reset);
    hr('═');
  }

  const evalResults = GOLDEN_EVALS.map(runEval);

  if (JSON_MODE) {
    const capStats = aggregateCapabilityScores(evalResults);
    const masterScore = computeMasterScore(capStats);
    const output = {
      masterScore,
      rating: getRating(masterScore),
      scenarios: evalResults.map(er => ({
        id: er.id,
        name: er.name,
        score: er.score,
        passed: er.passedChecks,
        total: er.allChecks,
        turns: er.turns.map(t => ({
          turn: t.turn,
          classifier: t.classifierOutput,
          checks: t.checks.map(c => ({ id: c.id, label: c.label, passed: c.passed })),
        })),
      })),
      capabilityScores: Object.fromEntries(
        Object.entries(capStats).map(([k, v]) => [k, v.total > 0 ? Math.round((v.passed / v.total) * 100) : 0])
      ),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  for (const er of evalResults) {
    printEvalResult(er);
    hr();
  }

  const capStats = aggregateCapabilityScores(evalResults);
  const masterScore = computeMasterScore(capStats);

  printScorecard(capStats, masterScore);

  printGapAnalysis(evalResults, capStats);
  pl();

  const totalChecks = evalResults.reduce((s, e) => s + e.allChecks, 0);
  const totalPassed = evalResults.reduce((s, e) => s + e.passedChecks, 0);
  pl(
    `  ${C.gray}Total checks: ${totalPassed}/${totalChecks} passed  |  ` +
    `Scenarios: ${evalResults.filter(e => e.score === 100).length}/8 perfect${C.reset}`
  );
  pl();
}

main();
