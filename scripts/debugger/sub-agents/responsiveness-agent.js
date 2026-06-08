const fs = require('fs');
const path = require('path');

/**
 * Scans stylesheets (.css, .scss) and component templates (.html)
 * for mobile responsiveness issues (absolute widths, missing media queries, etc.).
 */
function run(workspaceRoot, files) {
  const findings = [];
  const targetFiles = files.filter(f => {
    const ext = path.extname(f);
    return ['.css', '.scss', '.html'].includes(ext) && !f.includes('node_modules') && !f.includes('dist');
  });

  for (const file of targetFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const relativeFile = path.relative(workspaceRoot, file);
    const ext = path.extname(file);

    if (ext === '.css' || ext === '.scss') {
      // Check if media queries are present at all in stylesheets
      const hasMediaQueries = content.includes('@media');
      
      // We only flag stylesheet files that are specific to components and likely need responsiveness
      const isGlobalOrUtility = file.includes('styles.scss') || file.includes('variables.scss');
      if (!hasMediaQueries && !isGlobalOrUtility && content.trim().length > 0) {
        findings.push({
          file,
          relativeFile,
          line: 1,
          type: 'info',
          category: 'Missing Media Queries',
          message: 'This stylesheet does not contain any @media queries. It may not have responsive layouts for mobile devices.',
          recommendation: 'Use media queries (e.g., @media (max-width: 768px)) to adjust layouts and sizes on mobile screens.',
          snippet: 'No @media queries found.'
        });
      }

      // Check line-by-line for absolute widths and styling concerns
      lines.forEach((lineText, idx) => {
        const lineNum = idx + 1;
        const trimmed = lineText.trim();

        // Skip comments
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
          return;
        }

        // 1. Large absolute width (e.g. width: 600px; min-width: 1080px;)
        // Match width or min-width followed by a number greater than 320 and 'px'
        const absoluteWidthMatch = trimmed.match(/(?<!-)width\s*:\s*([3-9]\d{2,}|\d{4,})px/);
        if (absoluteWidthMatch) {
          const widthVal = parseInt(absoluteWidthMatch[1], 10);
          findings.push({
            file,
            relativeFile,
            line: lineNum,
            type: 'warning',
            category: 'Fixed Large Width',
            message: `Fixed layout width of ${widthVal}px detected. Hardcoded pixel widths larger than 320px cause horizontal scrolling on mobile viewports.`,
            recommendation: 'Use responsive units like percentage (%), viewport width (vw), max-width, or wrap with media queries.',
            snippet: trimmed
          });
        }

        // 2. Large absolute min-width
        const absoluteMinWidthMatch = trimmed.match(/min-width\s*:\s*([3-9]\d{2,}|\d{4,})px/);
        if (absoluteMinWidthMatch) {
          const widthVal = parseInt(absoluteMinWidthMatch[1], 10);
          findings.push({
            file,
            relativeFile,
            line: lineNum,
            type: 'warning',
            category: 'Fixed Large Min-Width',
            message: `Fixed min-width of ${widthVal}px detected. Large min-widths prevent elements from shrinking below mobile device sizes.`,
            recommendation: 'Use responsive max-width rules or media queries to override min-width on smaller screens.',
            snippet: trimmed
          });
        }
      });

    } else if (ext === '.html') {
      // Check for inline styles with hardcoded large widths
      lines.forEach((lineText, idx) => {
        const lineNum = idx + 1;
        const trimmed = lineText.trim();

        // Check for style="width: 1080px" or similar inline styles
        const inlineWidthMatch = trimmed.match(/style="[^"]*(?<!-)width\s*:\s*([3-9]\d{2,}|\d{4,})px/i) ||
                                 trimmed.match(/\[style\.width\]\s*=\s*['"`]([3-9]\d{2,}|\d{4,})px['"`]/i);
        if (inlineWidthMatch) {
          const widthVal = parseInt(inlineWidthMatch[1], 10);
          findings.push({
            file,
            relativeFile,
            line: lineNum,
            type: 'warning',
            category: 'Inline Fixed Width',
            message: `Inline style sets a fixed width of ${widthVal}px. Inline styles are hard to override and typically break mobile layouts.`,
            recommendation: 'Move styles to component stylesheets using responsive CSS and media queries.',
            snippet: trimmed
          });
        }

        // Check for inline styles with min-width
        const inlineMinWidthMatch = trimmed.match(/style="[^"]*min-width\s*:\s*([3-9]\d{2,}|\d{4,})px/i);
        if (inlineMinWidthMatch) {
          const widthVal = parseInt(inlineMinWidthMatch[1], 10);
          findings.push({
            file,
            relativeFile,
            line: lineNum,
            type: 'warning',
            category: 'Inline Fixed Min-Width',
            message: `Inline style sets a fixed min-width of ${widthVal}px. This will prevent element wrapping on mobile viewports.`,
            recommendation: 'Move min-width styles to external SCSS and define them inside media queries.',
            snippet: trimmed
          });
        }
      });
    }
  }

  return {
    name: 'Mobile Responsiveness Agent',
    findings,
    success: findings.length === 0
  };
}

module.exports = { run };
