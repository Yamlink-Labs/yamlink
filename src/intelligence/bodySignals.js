'use strict';

function stripFrontmatter(text) {
    const source = String(text || '');
    return source.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
}

function extractHeadingsFromText(text) {
    const headings = [];
    const source = stripFrontmatter(text);
    const regex = /^#{1,6}\s+(.+)$/gm;
    let match;
    while ((match = regex.exec(source)) !== null) {
        const heading = String(match[1] || '').trim();
        if (heading) headings.push(heading);
    }
    return headings;
}

function countBlockquoteLines(text) {
    const source = stripFrontmatter(text);
    const matches = source.match(/^\s*>\s?.+$/gm);
    return matches ? matches.length : 0;
}

function extractFootnoteDefinitions(text) {
    const source = stripFrontmatter(text);
    const definitions = new Set();
    const regex = /^\[\^([^\]]+)\]:/gm;
    let match;
    while ((match = regex.exec(source)) !== null) {
        const id = String(match[1] || '').trim();
        if (id) definitions.add(id);
    }
    return [...definitions];
}

function extractFootnoteReferences(text) {
    const source = stripFrontmatter(text);
    const references = new Set();
    const regex = /\[\^([^\]]+)\]/g;
    let match;
    while ((match = regex.exec(source)) !== null) {
        const id = String(match[1] || '').trim();
        if (id) references.add(id);
    }
    return [...references];
}

function extractCallouts(text) {
    const source = stripFrontmatter(text);
    const callouts = [];
    const regex = /^>\s*\[!([A-Z][A-Z0-9]*)\]([^\n]*)/gmi;
    let match;
    while ((match = regex.exec(source)) !== null) {
        callouts.push({
            type: match[1].toUpperCase(),
            title: (match[2] || '').trim()
        });
    }
    return callouts;
}

function extractEmbeds(text) {
    const source = stripFrontmatter(text);
    const embeds = [];
    const regex = /!\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = regex.exec(source)) !== null) {
        const raw = String(match[1] || '').trim().split('|')[0].trim().split('#')[0].trim();
        if (raw) embeds.push(raw);
    }
    return [...new Set(embeds)];
}

function collectBodySignals(text) {
    const headings = extractHeadingsFromText(text);
    const blockquoteCount = countBlockquoteLines(text);
    const footnoteDefinitions = extractFootnoteDefinitions(text);
    const footnoteReferences = extractFootnoteReferences(text);
    const callouts = extractCallouts(text);
    const embeds = extractEmbeds(text);
    return {
        headings,
        headingCount: headings.length,
        blockquoteCount,
        footnoteDefinitions,
        footnoteDefinitionCount: footnoteDefinitions.length,
        footnoteReferences,
        footnoteReferenceCount: footnoteReferences.length,
        callouts,
        calloutCount: callouts.length,
        embeds,
        embedCount: embeds.length
    };
}

function collectUndefinedFootnoteReferences(text) {
    const definitions = new Set(extractFootnoteDefinitions(text));
    return extractFootnoteReferences(text).filter((id) => !definitions.has(id));
}

function buildBodySignalHints(bodySignals = {}) {
    const hints = [];
    for (const heading of bodySignals.headings || []) {
        hints.push(heading);
    }

    if ((bodySignals.blockquoteCount || 0) >= 2) {
        hints.push('source');
        hints.push('evidence');
    } else if ((bodySignals.blockquoteCount || 0) >= 1) {
        hints.push('quote');
    }

    if ((bodySignals.footnoteDefinitionCount || 0) >= 1 || (bodySignals.footnoteReferenceCount || 0) >= 2) {
        hints.push('references');
        hints.push('source');
        hints.push('research');
    }

    for (const callout of bodySignals.callouts || []) {
        const t = callout.type;
        if (t === 'SOURCE' || t === 'EVIDENCE' || t === 'REFERENCE') {
            hints.push('source');
            hints.push('evidence');
        } else if (t === 'QUOTE') {
            hints.push('quote');
            hints.push('source');
        } else if (t === 'NOTE' || t === 'TIP' || t === 'INFO') {
            hints.push('note');
        } else if (t === 'WARNING' || t === 'DANGER') {
            hints.push('warning');
        }
    }

    if ((bodySignals.embedCount || 0) >= 1) {
        hints.push('hub');
        hints.push('references');
    }

    return [...new Set(hints.filter(Boolean))];
}

module.exports = {
    stripFrontmatter,
    extractHeadingsFromText,
    countBlockquoteLines,
    extractFootnoteDefinitions,
    extractFootnoteReferences,
    collectUndefinedFootnoteReferences,
    extractCallouts,
    extractEmbeds,
    collectBodySignals,
    buildBodySignalHints
};
