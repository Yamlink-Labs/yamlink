const fs = require('fs');
const { extractDateFromText } = require('./date');
const { normalizeText } = require('./frontmatter');
const { getCachedTasks, setCachedTasks } = require('./taskCache');
const { buildTaskBlockId } = require('./bodyBlocks');

/**
 * @typedef {{
 *   id: string,
 *   blockId: string,
 *   fileId: string,
 *   filePath: string,
 *   line: number,
 *   text: string,
 *   displayText: string,
 *   body: string,
 *   done: boolean,
 *   date: string|null,
 *   priority: 'urgent'|'medium'|'low'|null,
 *   links: string[],
 *   fields: { text: string, done: string, date: string|null, priority: string, file: string, line: string },
 *   nodeType: string
 * }} TaskRow
 */

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

// Priority markers — a small closed vocabulary, explicit opt-in only. Never
// inferred from task wording (e.g. a task that merely *sounds* urgent stays
// unprioritized) — the same "honest signal, not a guess" discipline the rest
// of the intelligence layer follows. Reuses the `#word` token shape the
// existing vault-wide tag extractor (tagSignals.js) already recognizes, but
// is parsed independently and scoped to this one task line, not the whole
// note — a single #urgent task shouldn't make tagSignals.js think the entire
// note is urgent.
const PRIORITY_MARKER_RE = /(^|[\s(])#(urgent|high|medium-priority|medium|med|low)\b/i;
const PRIORITY_ALIASES = {
  urgent: 'urgent',
  high: 'urgent',
  'medium-priority': 'medium',
  medium: 'medium',
  med: 'medium',
  low: 'low'
};

/** @param {string} text @returns {'urgent'|'medium'|'low'|null} */
function extractPriority(text) {
  const match = String(text || '').match(PRIORITY_MARKER_RE);
  if (!match) return null;
  return PRIORITY_ALIASES[match[2].toLowerCase()] || null;
}

function stripPriorityMarker(text) {
  return text.replace(PRIORITY_MARKER_RE, '$1').replace(/\s{2,}/g, ' ').trim();
}

/** @param {string} content @param {string} fileId @param {string} filePath @param {string|null} [referenceDate] @returns {TaskRow[]} */
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
    const priority = extractPriority(rawText);
    const displayText = stripDateMarkers(stripPriorityMarker(rawText)) || rawText;
    const linkMatches = [...rawText.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].trim());
    const localBlockId = buildTaskBlockId(taskNumber, rawText);
    const blockId = `${fileId}#${localBlockId}`;

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
      blockId: localBlockId,
      fileId,
      filePath,
      line: i + 1,
      text: rawText,        // original full text — used by query engine
      displayText,          // date-stripped text — used by calendar display
      body: bodyLines.join(' '),
      done,
      date,
      priority,
      links: linkMatches,
      fields: {
        text: rawText,
        done: String(done),
        date,
        priority: priority || '',
        file: fileId,
        line: String(i + 1)
      },
      nodeType: 'tasks'
    });
  }

  return tasks;
}

/** @param {Map<string,string>} index @param {number} [vaultGeneration] @returns {TaskRow[]} */
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

module.exports = { parseTasksFromContent, buildTaskRows, extractPriority };
