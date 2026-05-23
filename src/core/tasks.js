const fs = require('fs');
const { extractDateFromText } = require('./date');
const { normalizeText } = require('./frontmatter');
const { getCachedTasks, setCachedTasks } = require('./taskCache');

function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h >>>= 0;
  }
  return h.toString(36);
}

function stripFrontmatter(content) {
  if (!/^\s*---/.test(content)) return content;
  const first = content.indexOf('---');
  const closeIdx = content.indexOf('\n---', first + 3);
  if (closeIdx === -1) return content;
  return content.slice(closeIdx + 4);
}

// Strip explicit date markers from task text for display purposes.
// Leaves natural-language date hints intact (they're part of meaning).
// Patterns: · YYYY-MM-DD   @YYYY-MM-DD   (YYYY-MM-DD)   due: YYYY-MM-DD
const DATE_MARKER_RE = /\s*(?:[·•\xB7]\s*\d{4}-\d{2}-\d{2}|@\d{4}-\d{2}-\d{2}|\(\d{4}-\d{2}-\d{2}\)|\bdue\s*:?\s*\d{4}-\d{2}-\d{2})\b/gi;

function stripDateMarkers(text) {
  return text.replace(DATE_MARKER_RE, '').replace(/\s{2,}/g, ' ').trim();
}

function parseTasksFromContent(content, fileId, filePath, referenceDate = null) {
  const body = stripFrontmatter(normalizeText(content));
  const lines = body.split('\n');
  const tasks = [];
  let taskNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)[-*]\s+\[( |x|X)\]\s+(.+)$/);
    if (!match) continue;

    taskNumber += 1;

    const taskIndent = match[1].length;
    const done = match[2].toLowerCase() === 'x';
    const rawText = match[3].trim();
    const date = extractDateFromText(rawText, referenceDate);
    const displayText = stripDateMarkers(rawText) || rawText;
    const linkMatches = [...rawText.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].trim());
    const blockId = `${fileId}#t${taskNumber}-${hashString(rawText).slice(0, 6)}`;

    // Collect indented body lines that follow this task.
    // Stop at a blank line, a new task/list item at same-or-lower indent,
    // or a heading. Blank lines between body lines are skipped.
    const bodyLines = [];
    let j = i + 1;
    while (j < lines.length) {
      const nextLine = lines[j];
      const trimmed = nextLine.trim();
      if (!trimmed) { j++; continue; }
      const nextIndent = nextLine.match(/^\s*/)[0].length;
      const isNewListItem = /^[-*+]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed);
      const isHeading = /^#+\s/.test(trimmed);
      if (nextIndent <= taskIndent || isHeading) break;
      if (isNewListItem) break;
      bodyLines.push(trimmed);
      j++;
    }

    tasks.push({
      id: blockId,
      fileId,
      filePath,
      line: i + 1,
      text: rawText,        // original full text — used by query engine
      displayText,          // date-stripped text — used by calendar display
      body: bodyLines.join(' '),
      done,
      date,
      links: linkMatches,
      fields: {
        text: rawText,
        done: String(done),
        date,
        file: fileId,
        line: String(i + 1)
      },
      nodeType: 'tasks'
    });
  }

  return tasks;
}

function buildTaskRows(index, vaultGeneration) {
  const rows = [];
  const useCache = vaultGeneration !== undefined;
  for (const [fileId, filePath] of index.entries()) {
    if (useCache) {
      const cached = getCachedTasks(fileId, vaultGeneration);
      if (cached) { rows.push(...cached); continue; }
    }
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      continue;
    }
    const tasks = parseTasksFromContent(content, fileId, filePath);
    if (useCache) setCachedTasks(fileId, tasks, vaultGeneration);
    rows.push(...tasks);
  }
  return rows;
}

module.exports = { parseTasksFromContent, buildTaskRows };
