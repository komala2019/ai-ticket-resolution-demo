const fs = require('fs');
const path = require('path');

// Colored console output helper codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  underline: '\x1b[4m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m'
};

// Sub-agent imports
const syntaxAgent = require('./sub-agents/syntax-agent');
const logicAgent = require('./sub-agents/logic-agent');
const styleAgent = require('./sub-agents/style-agent');
const metricsAgent = require('./sub-agents/metrics-agent');
const responsivenessAgent = require('./sub-agents/responsiveness-agent');

const workspaceRoot = path.resolve(__dirname, '../../');

function getFiles(dir, filesList = []) {
  if (!fs.existsSync(dir)) return filesList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const name = path.join(dir, file);
    if (fs.statSync(name).isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist' && file !== '.angular' && file !== '.git' && file !== '.vs') {
        getFiles(name, filesList);
      }
    } else {
      filesList.push(name);
    }
  }
  return filesList;
}

async function startDebugger() {
  console.log(`\n${colors.bold}${colors.magenta}┌────────────────────────────────────────────────────────┐${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}│             ANTIGRAVITY DEBUGGER AGENT SUITE           │${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}└────────────────────────────────────────────────────────┘${colors.reset}`);
  console.log(`Analyzing workspace: ${colors.cyan}${workspaceRoot}${colors.reset}\n`);

  // 1. Traverse and collect files
  const srcDir = path.join(workspaceRoot, 'src');
  console.log(`Scanning files in ${colors.underline}src/${colors.reset}...`);
  const files = getFiles(srcDir);
  console.log(`Found ${colors.bold}${files.length}${colors.reset} files of interest (components, stylesheets, assets).\n`);

  console.log(`${colors.bold}Executing specialized Debugger Sub-agents...${colors.reset}\n`);

  // 2. Run TypeScript compilation & syntax check
  console.log(`${colors.blue}[Running]${colors.reset} TypeScript Syntax & Compiler Agent...`);
  const syntaxResults = await syntaxAgent.run(workspaceRoot);
  if (syntaxResults.success) {
    console.log(`${colors.green}[Success] ${syntaxResults.name} passed. No syntax or compilation bugs!${colors.reset}\n`);
  } else {
    console.log(`${colors.red}[Failed]  ${syntaxResults.name} detected ${syntaxResults.findings.length} issues.${colors.reset}\n`);
  }

  // 3. Run Logic check
  console.log(`${colors.blue}[Running]${colors.reset} Logical Quality & Anti-Pattern Agent...`);
  const logicResults = logicAgent.run(workspaceRoot, files);
  if (logicResults.success) {
    console.log(`${colors.green}[Success] ${logicResults.name} passed. No logical pattern concerns!${colors.reset}\n`);
  } else {
    console.log(`${colors.yellow}[Alert]    ${logicResults.name} flagged ${logicResults.findings.length} item(s).${colors.reset}\n`);
  }

  // 4. Run Stylesheet check
  console.log(`${colors.blue}[Running]${colors.reset} Stylesheet Lint & Aesthetics Agent...`);
  const styleResults = styleAgent.run(workspaceRoot, files);
  if (styleResults.success) {
    console.log(`${colors.green}[Success] ${styleResults.name} passed. No styling smells!${colors.reset}\n`);
  } else {
    console.log(`${colors.yellow}[Alert]    ${styleResults.name} flagged ${styleResults.findings.length} item(s).${colors.reset}\n`);
  }

  // 5. Run Metrics check
  console.log(`${colors.blue}[Running]${colors.reset} Complexity & Metrics Agent...`);
  const metricsResults = metricsAgent.run(workspaceRoot, files);
  console.log(`${colors.green}[Finished] Complexity & Metrics completed successfully.${colors.reset}\n`);

  // 6. Run Mobile Responsiveness check
  console.log(`${colors.blue}[Running]${colors.reset} Mobile Responsiveness Agent...`);
  const responsivenessResults = responsivenessAgent.run(workspaceRoot, files);
  if (responsivenessResults.success) {
    console.log(`${colors.green}[Success] ${responsivenessResults.name} passed. All components are responsive!${colors.reset}\n`);
  } else {
    console.log(`${colors.yellow}[Alert]    ${responsivenessResults.name} flagged ${responsivenessResults.findings.length} item(s).${colors.reset}\n`);
  }

  // --- Output CLI Summary Dashboard ---
  console.log(`${colors.bold}${colors.magenta}┌────────────────────────────────────────────────────────┐${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}│                    EXECUTIVE SUMMARY                   │${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}└────────────────────────────────────────────────────────┘${colors.reset}`);
  
  console.log(`Total Files Checked: ${colors.cyan}${metricsResults.meta.totalFiles}${colors.reset}`);
  console.log(`Total Lines of Code: ${colors.cyan}${metricsResults.meta.totalLines}${colors.reset}`);
  console.log(`Comments Density:    ${colors.cyan}${metricsResults.meta.commentRatio}%${colors.reset} (${metricsResults.meta.totalComments} lines)`);
  console.log(`TypeScript Health:   ${syntaxResults.success ? colors.green + 'HEALTHY' : colors.red + 'WARNING'}${colors.reset}`);
  console.log();

  const totalWarnings = syntaxResults.findings.length + logicResults.findings.length + styleResults.findings.length + metricsResults.findings.length + responsivenessResults.findings.length;

  if (totalWarnings > 0) {
    console.log(`${colors.bold}${colors.yellow}⚠️  Found ${totalWarnings} potential issue(s) across the codebase:${colors.reset}\n`);
    
    // Print logic findings
    if (logicResults.findings.length > 0) {
      console.log(`${colors.bold}${colors.underline}Logical Bugs & Anti-Patterns:${colors.reset}`);
      logicResults.findings.forEach(f => {
        const typeColor = f.type === 'error' ? colors.red : f.type === 'warning' ? colors.yellow : colors.cyan;
        console.log(`  - [${typeColor}${f.type.toUpperCase()}${colors.reset}] ${colors.bold}${f.category}${colors.reset} in ${colors.blue}${f.relativeFile}:${f.line}${colors.reset}`);
        console.log(`    ${f.message}`);
        console.log(`    ${colors.bold}Snippet:${colors.reset} "${colors.cyan}${f.snippet}${colors.reset}"`);
        console.log(`    ${colors.bold}Rec:${colors.reset} ${f.recommendation}\n`);
      });
    }

    // Print syntax findings
    if (syntaxResults.findings.length > 0) {
      console.log(`${colors.bold}${colors.underline}Syntax & Compile Errors:${colors.reset}`);
      syntaxResults.findings.forEach(f => {
        console.log(`  - [${colors.red}ERROR${colors.reset}] Code ${colors.bold}${f.code}${colors.reset} in ${colors.blue}${f.relativeFile}:${f.line}:${f.column}${colors.reset}`);
        console.log(`    ${f.message}\n`);
      });
    }

    // Print styling findings
    if (styleResults.findings.length > 0) {
      console.log(`${colors.bold}${colors.underline}Styling & Aesthetics Issues:${colors.reset}`);
      styleResults.findings.forEach(f => {
        const typeColor = f.type === 'error' ? colors.red : f.type === 'warning' ? colors.yellow : colors.cyan;
        console.log(`  - [${typeColor}${f.type.toUpperCase()}${colors.reset}] ${colors.bold}${f.category}${colors.reset} in ${colors.blue}${f.relativeFile}:${f.line}${colors.reset}`);
        console.log(`    ${f.message}`);
        console.log(`    ${colors.bold}Snippet:${colors.reset} "${colors.cyan}${f.snippet}${colors.reset}"`);
        console.log(`    ${colors.bold}Rec:${colors.reset} ${f.recommendation}\n`);
      });
    }

    // Print metrics findings
    if (metricsResults.findings.length > 0) {
      console.log(`${colors.bold}${colors.underline}Complexity Warnings:${colors.reset}`);
      metricsResults.findings.forEach(f => {
        console.log(`  - [${colors.yellow}WARNING${colors.reset}] ${colors.bold}${f.category}${colors.reset} in ${colors.blue}${f.relativeFile}${colors.reset}`);
        console.log(`    ${f.message}`);
        console.log(`    ${colors.bold}Rec:${colors.reset} ${f.recommendation}\n`);
      });
    }

    // Print responsiveness findings
    if (responsivenessResults.findings.length > 0) {
      console.log(`${colors.bold}${colors.underline}Mobile Responsiveness Issues:${colors.reset}`);
      responsivenessResults.findings.forEach(f => {
        const typeColor = f.type === 'error' ? colors.red : f.type === 'warning' ? colors.yellow : colors.cyan;
        console.log(`  - [${typeColor}${f.type.toUpperCase()}${colors.reset}] ${colors.bold}${f.category}${colors.reset} in ${colors.blue}${f.relativeFile}:${f.line}${colors.reset}`);
        console.log(`    ${f.message}`);
        if (f.snippet) {
          console.log(`    ${colors.bold}Snippet:${colors.reset} "${colors.cyan}${f.snippet}${colors.reset}"`);
        }
        console.log(`    ${colors.bold}Rec:${colors.reset} ${f.recommendation}\n`);
      });
    }

  } else {
    console.log(`${colors.bold}${colors.green}🎉 Congratulations! No potential bugs or quality issues were detected!${colors.reset}\n`);
  }

  // Print complex files heatmap
  console.log(`${colors.bold}${colors.underline}Top 5 Largest Files (Refactoring Heatmap):${colors.reset}`);
  metricsResults.meta.topLargest.forEach((f, idx) => {
    console.log(`  ${idx + 1}. ${colors.blue}${f.file}${colors.reset} (${colors.bold}${f.lines}${colors.reset} lines)`);
  });
  console.log();

  // 6. Write Markdown Report
  await writeMarkdownReport(syntaxResults, logicResults, styleResults, metricsResults, responsivenessResults);
}

async function writeMarkdownReport(syntax, logic, style, metrics, responsiveness) {
  const reportPath = path.join(workspaceRoot, 'debugger_report.md');
  const timestamp = new Date().toLocaleString();
  
  let md = `# Codebase Debugger & Quality Report

Generated on: **${timestamp}**

## Summary of Findings

| Sub-Agent Name | Status | Findings Count |
| :--- | :---: | :---: |
| **${syntax.name}** | ${syntax.success ? '✅ PASSED' : '❌ FAILED'} | ${syntax.findings.length} |
| **${logic.name}** | ${logic.success ? '✅ PASSED' : '⚠️ WARNING'} | ${logic.findings.length} |
| **${style.name}** | ${style.success ? '✅ PASSED' : '⚠️ WARNING'} | ${style.findings.length} |
| **${metrics.name}** | ${metrics.success ? '✅ PASSED' : '⚠️ WARNING'} | ${metrics.findings.length} |
| **${responsiveness.name}** | ${responsiveness.success ? '✅ PASSED' : '⚠️ WARNING'} | ${responsiveness.findings.length} |

---

## Codebase Footprint & Metrics

- **Total Files Checked**: ${metrics.meta.totalFiles}
- **Total Lines of Code**: ${metrics.meta.totalLines}
- **Comments Density**: ${metrics.meta.commentRatio}% (${metrics.meta.totalComments} comment lines)

### Top 5 Largest Files (Refactoring Target Heatmap)

| Rank | File Path | Line Count |
| :---: | :--- | :---: |
${metrics.meta.topLargest.map((f, idx) => `| ${idx + 1} | [${path.basename(f.file)}](file:///${path.join(workspaceRoot, f.file).replace(/\\/g, '/')}) | ${f.lines} |`).join('\n')}

---

## Detailed Findings

`;

  const allFindings = [
    ...syntax.findings.map(f => ({ ...f, agent: syntax.name })),
    ...logic.findings.map(f => ({ ...f, agent: logic.name })),
    ...style.findings.map(f => ({ ...f, agent: style.name })),
    ...metrics.findings.map(f => ({ ...f, agent: metrics.name })),
    ...responsiveness.findings.map(f => ({ ...f, agent: responsiveness.name }))
  ];

  if (allFindings.length === 0) {
    md += `### 🎉 Excellent! No issues detected.
Your code adheres to TypeScript constraints, has clean logic flow, utilizes proper style architectures, and displays healthy metrics.
`;
  } else {
    // Group findings by file
    const fileGroupMap = {};
    allFindings.forEach(f => {
      if (!fileGroupMap[f.file]) fileGroupMap[f.file] = [];
      fileGroupMap[f.file].push(f);
    });

    Object.keys(fileGroupMap).forEach(filePath => {
      const relPath = path.relative(workspaceRoot, filePath);
      md += `### 📄 [${path.basename(filePath)}](file:///${filePath.replace(/\\/g, '/')})\n`;
      md += `Path: \`${relPath}\`\n\n`;
      
      fileGroupMap[filePath].forEach(f => {
        const severityBadge = f.type === 'error' ? '🔴 ERROR' : f.type === 'warning' ? '🟡 WARNING' : '🔵 INFO';
        md += `#### [${severityBadge}] ${f.category || 'Syntax Error'} (Line ${f.line})\n`;
        md += `- **Agent**: ${f.agent}\n`;
        md += `- **Message**: ${f.message}\n`;
        if (f.recommendation) {
          md += `- **Recommendation**: ${f.recommendation}\n`;
        }
        if (f.snippet) {
          md += `- **Code Snippet**:\n  \`\`\`${path.extname(filePath).substring(1)}\n  ${f.snippet}\n  \`\`\`\n`;
        }
        md += `\n`;
      });
      md += `---\n\n`;
    });
  }

  fs.writeFileSync(reportPath, md, 'utf8');
  console.log(`${colors.bold}${colors.green}Report written successfully to: ${colors.underline}${reportPath}${colors.reset}\n`);
}

// Execute the debugger orchestrator
startDebugger().catch(err => {
  console.error(`${colors.red}Debugger orchestrator crashed with error: ${err.message}${colors.reset}`);
});
