const { exec } = require('child_process');
const path = require('path');

/**
 * Runs tsc --noEmit to check for TypeScript compilation / syntax errors.
 * Parses the console output and returns findings.
 */
function run(workspaceRoot) {
  return new Promise((resolve) => {
    const findings = [];
    const command = 'npx tsc --noEmit';
    
    exec(command, { cwd: workspaceRoot }, (error, stdout, stderr) => {
      const output = stdout + '\n' + stderr;
      const lines = output.split('\n');
      
      // Common tsc formats:
      // 1. src/app/comp.ts(12,34): error TS2307: ...
      // 2. src/app/comp.ts:12:34 - error TS2307: ...
      const regex1 = /^([^(]+)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/;
      const regex2 = /^([^:]+):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)$/;
      
      for (const line of lines) {
        let match = line.match(regex1) || line.match(regex2);
        if (match) {
          const relativePath = match[1].trim();
          const lineNum = parseInt(match[2], 10);
          const colNum = parseInt(match[3], 10);
          const errorCode = match[4];
          const message = match[5];
          
          findings.push({
            file: path.resolve(workspaceRoot, relativePath),
            relativeFile: relativePath,
            line: lineNum,
            column: colNum,
            type: 'error',
            code: errorCode,
            message: message,
            snippet: ''
          });
        }
      }
      
      resolve({
        name: 'TypeScript Syntax & Compile Agent',
        findings,
        success: findings.length === 0
      });
    });
  });
}

module.exports = { run };
