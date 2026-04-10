const fs = require('fs');
const { extractDateFromText } = require('./date');

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
  const second = content.indexOf('---', first + 3);
  if (second === -1) return content;
  return content.slice(second + 3);
}

function parseTasksFromContent(content, fileId, filePath, referenceDate = null) {
  const body = stripFrontmatter(content.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  const lines = body.split('\n');
  const tasks = [];
  let taskNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/);
    if (!match) continue;

    taskNumber += 1;

    const done = match[1].toLowerCase() === 'x';
    const text = match[2].trim();
    const linkMatches = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].trim());
    const date = extractDateFromText(text, referenceDate);
    const blockId = `${fileId}#t${taskNumber}-${hashString(text).slice(0, 6)}`;

    tasks.push({
      id: blockId,
      fileId,
      filePath,
      line: i + 1,
      text,
      done,
      date,
      links: linkMatches,
      fields: {
        text,
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

function buildTaskRows(index) {
  const rows = [];
  for (const [fileId, filePath] of index.entries()) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      continue;
    }
    rows.push(...parseTasksFromContent(content, fileId, filePath));
  }
  return rows;
}

module.exports = { parseTasksFromContent, buildTaskRows };
