const fs = require('fs');
const path = require('path');

/**
 * Scans stylesheets (.css, .scss) for styling bad practices.
 */
function run(workspaceRoot, files) {
  const findings = [];
  const styleFiles = files.filter(f => (f.endsWith('.css') || f.endsWith('.scss')) && !f.includes('node_modules') && !f.includes('dist'));

  for (const file of styleFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const relativeFile = path.relative(workspaceRoot, file);

    // Track selectors to find duplicates
    const selectorCounts = {};
    
    // Simple regex to extract CSS selectors
    // Matches something like: .class-name, #id { ...
    const selectorRegex = /^\s*([^{}\n]+)\s*\{/gm;
    let match;
    while ((match = selectorRegex.exec(content)) !== null) {
      const selector = match[1].trim();
      // Skip @media, @keyframes, @include, @mixin or CSS rule bodies inside the match
      if (!selector.startsWith('@') && !selector.startsWith('&') && selector.length > 0) {
        selectorCounts[selector] = (selectorCounts[selector] || 0) + 1;
      }
    }

    // Report duplicate selectors
    Object.keys(selectorCounts).forEach(selector => {
      if (selectorCounts[selector] > 1) {
        // Find line numbers of these selectors
        lines.forEach((lineText, idx) => {
          if (lineText.includes(selector + ' {') || lineText.trim() === selector + ' {') {
            findings.push({
              file,
              relativeFile,
              line: idx + 1,
              type: 'info',
              category: 'Duplicate Selector',
              message: `CSS Selector '${selector}' is defined ${selectorCounts[selector]} times in this file.`,
              recommendation: 'Merge the styling rules under a single selector definition to clean up and reduce bundle size.',
              snippet: lineText.trim()
            });
          }
        });
      }
    });

    // Scans line-by-line for style details
    lines.forEach((lineText, idx) => {
      const lineNum = idx + 1;
      const trimmed = lineText.trim();

      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        return;
      }

      // 1. !important overuse
      if (trimmed.includes('!important')) {
        findings.push({
          file,
          relativeFile,
          line: lineNum,
          type: 'warning',
          category: 'CSS Specificity (!important)',
          message: '\'!important\' directive used. This bypasses the natural CSS cascade and can make layout overrides highly brittle.',
          recommendation: 'Increase CSS specificity naturally or reorganize the stylesheet structure.',
          snippet: trimmed
        });
      }

      // 2. Empty CSS Blocks (e.g. .classname { })
      const emptyBlockMatch = trimmed.match(/([^\s{]+)\s*\{\s*\}/);
      if (emptyBlockMatch) {
        findings.push({
          file,
          relativeFile,
          line: lineNum,
          type: 'info',
          category: 'Empty Style Block',
          message: `Empty CSS rule block detected for '${emptyBlockMatch[1]}'.`,
          recommendation: 'Remove empty selectors to clean up stylesheets.',
          snippet: trimmed
        });
      }

      // 3. Hardcoded Hex Colors
      // Find matches like #fff, #123456, but ignore matches inside URLs or non-colors
      const hexMatch = trimmed.match(/#([0-9a-fA-F]{3,8})\b/);
      if (hexMatch && !trimmed.includes('url(') && !trimmed.includes('rgba(')) {
        findings.push({
          file,
          relativeFile,
          line: lineNum,
          type: 'info',
          category: 'Hardcoded Color',
          message: `Hardcoded hex color '${hexMatch[0]}' detected.`,
          recommendation: 'Use design system variables or CSS Custom Properties (e.g. var(--color-primary)) for consistent design styling.',
          snippet: trimmed
        });
      }
    });
  }

  return {
    name: 'Stylesheet Lint & Aesthetics Agent',
    findings,
    success: findings.length === 0
  };
}

module.exports = { run };
