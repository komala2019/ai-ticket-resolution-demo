const fs = require('fs');
const path = require('path');

/**
 * Scans TypeScript files for logic smells and Angular anti-patterns.
 */
function run(workspaceRoot, files) {
  const findings = [];
  const tsFiles = files.filter(f => f.endsWith('.ts') && !f.includes('node_modules') && !f.includes('dist'));

  for (const file of tsFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const relativeFile = path.relative(workspaceRoot, file);

    // 1. Subscription leaks: check if there's .subscribe( without unsubscribe or takeUntil
    const hasSubscribe = content.includes('.subscribe(');
    const hasUnsubscribe = content.includes('.unsubscribe()');
    const hasTakeUntil = content.includes('takeUntil(') || content.includes('take(1)');
    if (hasSubscribe && !hasUnsubscribe && !hasTakeUntil) {
      // Find the line with the subscription
      lines.forEach((lineText, idx) => {
        if (lineText.includes('.subscribe(')) {
          findings.push({
            file,
            relativeFile,
            line: idx + 1,
            type: 'warning',
            category: 'Subscription Leak',
            message: 'Observable subscription detected without explicit unsubscribe() or takeUntil/take(1) cleanup.',
            recommendation: 'Use a Subscription array, takeUntil() pattern, or the Angular async pipe in templates to automatically manage subscription lifecycles.',
            snippet: lineText.trim()
          });
        }
      });
    }

    // Process line-by-line checks
    lines.forEach((lineText, idx) => {
      const lineNum = idx + 1;
      const trimmed = lineText.trim();

      // Skip comments or import lines
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('import ')) {
        return;
      }

      // 2. Direct DOM manipulation
      if (trimmed.match(/document\.(getElementById|querySelector|querySelectorAll|write)/) || trimmed.includes('window.document')) {
        findings.push({
          file,
          relativeFile,
          line: lineNum,
          type: 'warning',
          category: 'Direct DOM Manipulation',
          message: 'Direct DOM manipulation detected. Bypassing Angular rendering pipeline can bypass security mechanisms and break Server-Side Rendering (SSR).',
          recommendation: 'Use ElementRef, Renderer2, or @ViewChild/@ViewChildren instead.',
          snippet: trimmed
        });
      }

      // 3. Empty lifecycles
      const emptyLifecycleMatch = trimmed.match(/(ngOnInit|ngOnDestroy|ngOnChanges)\s*\(\s*\)\s*\{\s*\}/);
      if (emptyLifecycleMatch) {
        findings.push({
          file,
          relativeFile,
          line: lineNum,
          type: 'info',
          category: 'Empty Lifecycle Hook',
          message: `Empty lifecycle hook '${emptyLifecycleMatch[1]}()' detected.`,
          recommendation: 'Remove unused lifecycle methods to keep components clean.',
          snippet: trimmed
        });
      }

      // 4. Leftover debugging code
      if (trimmed.includes('console.log(') && !trimmed.includes('// console.log')) {
        findings.push({
          file,
          relativeFile,
          line: lineNum,
          type: 'info',
          category: 'Debug Leftover',
          message: 'Active console.log() statement found.',
          recommendation: 'Remove logs or use a central logger service before deploying to production.',
          snippet: trimmed
        });
      }
      if (trimmed.includes('debugger;')) {
        findings.push({
          file,
          relativeFile,
          line: lineNum,
          type: 'warning',
          category: 'Leftover Debugger',
          message: 'Active debugger; statement found. This will pause execution in production environment dev tools.',
          recommendation: 'Remove debugger; statements.',
          snippet: trimmed
        });
      }

      // 5. Hardcoded API URLs
      // Matches URL strings like http:// or https:// inside code, ignoring imports or standard doc links
      const urlMatch = trimmed.match(/['"`](https?:\/\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=]+)['"`]/);
      if (urlMatch) {
        const url = urlMatch[1];
        // Ignore standard docs or frameworks URLs
        if (!url.includes('angular.io') && !url.includes('schema.org') && !url.includes('npmjs.org') && !url.includes('github.com')) {
          findings.push({
            file,
            relativeFile,
            line: lineNum,
            type: 'warning',
            category: 'Hardcoded URL',
            message: `Hardcoded URL detected: '${url}'.`,
            recommendation: 'Move api endpoints or static URLs to Angular environments configuration files.',
            snippet: trimmed
          });
        }
      }

      // 6. Insecure DOM Bypasses
      if (trimmed.includes('bypassSecurityTrust')) {
        findings.push({
          file,
          relativeFile,
          line: lineNum,
          type: 'warning',
          category: 'Security Risk',
          message: 'DomSanitizer bypassSecurityTrust... call detected. This bypasses Angular\'s built-in XSS security checks.',
          recommendation: 'Ensure input source is heavily sanitized or avoid bypassSecurityTrust if possible.',
          snippet: trimmed
        });
      }
    });
  }

  return {
    name: 'Logical Quality & Anti-Pattern Agent',
    findings,
    success: findings.length === 0
  };
}

module.exports = { run };
