'use strict';

const path = require('path');

const { parseFrontmatter } = require('../core/indexService');
const { uriToPath } = require('./utils');

function makeRange(startLine, startCharacter, endLine, endCharacter) {
    return {
        start: { line: Math.max(0, startLine), character: Math.max(0, startCharacter) },
        end: { line: Math.max(0, endLine), character: Math.max(0, endCharacter) }
    };
}

function getLineEnd(lines, line) {
    return (lines[Math.max(0, line)] || '').length;
}

function getRootName(parsed, uri) {
    const filePath = uriToPath(uri);
    return String(parsed.name || parsed.title || parsed.id || path.basename(filePath, path.extname(filePath)));
}

function buildDocumentStructure(content, uri) {
    const text = String(content || '');
    const lines = text.split('\n');
    const parsed = parseFrontmatter(text) || {};
    const headings = [];
    const headingRoots = [];
    const frontmatterFields = [];
    let frontmatter = null;

    if (lines[0] && lines[0].trim() === '---') {
        let closingLine = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i] && lines[i].trim() === '---') {
                closingLine = i;
                break;
            }
            const fieldMatch = /^(\w[\w-]*):\s*(.*)$/.exec(lines[i]);
            if (fieldMatch) {
                const key = fieldMatch[1];
                const value = fieldMatch[2];
                const keyStart = Math.max(0, lines[i].indexOf(key));
                frontmatterFields.push({
                    key,
                    value,
                    line: i,
                    lineText: lines[i],
                    keyStart,
                    range: makeRange(i, 0, i, lines[i].length),
                    selectionRange: makeRange(i, keyStart, i, keyStart + key.length)
                });
            }
        }
        if (closingLine >= 0) {
            frontmatter = {
                startLine: 0,
                endLine: closingLine,
                range: makeRange(0, 0, closingLine, getLineEnd(lines, closingLine)),
                selectionRange: makeRange(0, 0, 0, Math.min(3, getLineEnd(lines, 0))),
                fields: frontmatterFields
            };
        }
    }

    const bodyStart = frontmatter ? frontmatter.endLine + 1 : 0;
    const headingStack = [];
    for (let i = bodyStart; i < lines.length; i++) {
        const headingMatch = /^(#{1,6})\s+(.+)$/.exec(lines[i]);
        if (!headingMatch) continue;
        const hashes = headingMatch[1];
        const title = headingMatch[2];
        const level = hashes.length;
        const node = {
            title,
            level,
            line: i,
            endLine: lines.length - 1,
            lineText: lines[i],
            children: [],
            range: makeRange(i, 0, i, lines[i].length),
            selectionRange: makeRange(i, hashes.length + 1, i, hashes.length + 1 + title.length)
        };

        while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
            const completed = headingStack.pop();
            completed.endLine = i - 1;
            completed.range = makeRange(
                completed.line,
                0,
                Math.max(completed.line, completed.endLine),
                getLineEnd(lines, Math.max(completed.line, completed.endLine))
            );
        }

        if (headingStack.length) {
            headingStack[headingStack.length - 1].children.push(node);
        } else {
            headingRoots.push(node);
        }

        headingStack.push(node);
        headings.push(node);
    }

    while (headingStack.length) {
        const completed = headingStack.pop();
        completed.endLine = lines.length - 1;
        completed.range = makeRange(
            completed.line,
            0,
            Math.max(completed.line, completed.endLine),
            getLineEnd(lines, Math.max(completed.line, completed.endLine))
        );
    }

    const lastLine = Math.max(0, lines.length - 1);
    return {
        lines,
        parsed,
        rootName: getRootName(parsed, uri),
        rootDetail: String(parsed.type || '').trim(),
        rootRange: makeRange(0, 0, lastLine, getLineEnd(lines, lastLine)),
        frontmatter,
        headingRoots,
        headings
    };
}

function containsPosition(range, position) {
    if (!range || !position) return false;
    const afterStart = position.line > range.start.line
        || (position.line === range.start.line && position.character >= range.start.character);
    const beforeEnd = position.line < range.end.line
        || (position.line === range.end.line && position.character <= range.end.character);
    return afterStart && beforeEnd;
}

module.exports = {
    buildDocumentStructure,
    containsPosition,
    makeRange
};
