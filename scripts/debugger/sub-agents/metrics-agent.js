const fs = require('fs');
const path = require('path');

/**
 * Scans codebase files to analyze line count, comment densities, and complexity warnings.
 */
function run(workspaceRoot, files) {
  const findings = [];
  const targetFiles = files.filter(f => {
    const ext = path.extname(f);
    return ['.ts', '.html', '.css', '.scss'].includes(ext) && !f.includes('node_modules') && !f.includes('dist');
  });

  let totalLines = 0;
  let totalComments = 0;
  const fileStats = [];

  for (const file of targetFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const relativeFile = path.relative(workspaceRoot, file);

    const lineCount = lines.length;
    totalLines += lineCount;

    // Estimate comments count
    let commentLines = 0;
    lines.forEach(l => {
      const trimmed = l.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('<!--')) {
        commentLines++;
      }
    });
    totalComments += commentLines;

    fileStats.push({
      file,
      relativeFile,
      lineCount,
      commentLines,
      ext: path.extname(file)
    });

    // Flag complex files (large files > 300 lines)
    if (lineCount > 300) {
      findings.push({
        file,
        relativeFile,
        line: 1,
        type: 'warning',
        category: 'Large File Complexity',
        message: `File has ${lineCount} lines, exceeding the recommended limit of 300 lines.`,
        recommendation: 'Consider breaking this down into smaller, single-responsibility components or services.',
        snippet: `Lines: ${lineCount}`
      });
    }
  }

  // Calculate top 5 largest files
  const topLargest = [...fileStats]
    .sort((a, b) => b.lineCount - a.lineCount)
    .slice(0, 5);

  const commentRatio = totalLines > 0 ? ((totalComments / totalLines) * 100).toFixed(1) : '0';

  return {
    name: 'Complexity & Metrics Agent',
    findings,
    success: findings.length === 0,
    meta: {
      totalFiles: targetFiles.length,
      totalLines,
      totalComments,
      commentRatio,
      topLargest: topLargest.map(t => ({ file: t.relativeFile, lines: t.lineCount }))
    }
  };
}

module.exports = { run };
