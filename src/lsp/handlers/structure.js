'use strict';

const { respond } = require('../transport');
const { getDocumentText } = require('../documentState');
const { buildDocumentStructure, containsPosition, makeRange } = require('../documentStructure');

function toSelectionChain(ranges) {
    let parent = null;
    for (let i = ranges.length - 1; i >= 0; i--) {
        parent = {
            range: ranges[i],
            parent
        };
    }
    return parent;
}

function findHeadingPath(headings, position, acc = []) {
    for (const heading of headings) {
        if (!containsPosition(heading.range, position)) continue;
        const branch = [...acc, heading];
        const nested = findHeadingPath(heading.children, position, branch);
        return nested || branch;
    }
    return acc.length ? acc : null;
}

function handleSelectionRange(msg, state) {
    const { textDocument, positions } = msg.params || {};
    if (!textDocument || !Array.isArray(positions) || positions.length === 0) {
        respond(msg.id, []);
        return;
    }

    const structure = buildDocumentStructure(getDocumentText(state, textDocument.uri), textDocument.uri);
    const results = positions.map((position) => {
        const lineText = structure.lines[position.line] || '';
        const baseLineRange = makeRange(position.line, 0, position.line, lineText.length);

        if (structure.frontmatter && containsPosition(structure.frontmatter.range, position)) {
            const field = structure.frontmatter.fields.find((entry) => containsPosition(entry.range, position));
            const ranges = field
                ? [field.range, structure.frontmatter.range, structure.rootRange]
                : [baseLineRange, structure.frontmatter.range, structure.rootRange];
            return toSelectionChain(ranges);
        }

        const headingPath = findHeadingPath(structure.headingRoots, position);
        if (headingPath && headingPath.length) {
            const ranges = [baseLineRange, ...headingPath.slice().reverse().map((heading) => heading.range), structure.rootRange];
            return toSelectionChain(ranges);
        }

        const ranges = [baseLineRange, structure.rootRange];
        return toSelectionChain(ranges);
    });

    respond(msg.id, results);
}

function collectFoldingRangesFromHeadings(headings, out) {
    for (const heading of headings) {
        if (heading.endLine > heading.line) {
            out.push({
                startLine: heading.line,
                endLine: heading.endLine
            });
        }
        collectFoldingRangesFromHeadings(heading.children, out);
    }
}

function handleFoldingRange(msg, state) {
    const { textDocument } = msg.params || {};
    if (!textDocument) {
        respond(msg.id, []);
        return;
    }

    const structure = buildDocumentStructure(getDocumentText(state, textDocument.uri), textDocument.uri);
    const ranges = [];

    if (structure.frontmatter && structure.frontmatter.endLine > structure.frontmatter.startLine) {
        ranges.push({
            startLine: structure.frontmatter.startLine,
            endLine: structure.frontmatter.endLine,
            kind: 'region'
        });
    }

    collectFoldingRangesFromHeadings(structure.headingRoots, ranges);
    respond(msg.id, ranges);
}

module.exports = {
    handleSelectionRange,
    handleFoldingRange
};
