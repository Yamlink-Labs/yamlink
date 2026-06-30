'use strict';

const React = require('react');
const fs = require('fs');
const { exec } = require('child_process');
const { p, SYM } = require('./palette');

const SKIP_FIELDS = new Set(['id', 'type', '_filePath', '_outbound', '_inbound']);

function truncate(text, width) {
    const value = String(text ?? '');
    if (value.length <= width) return value;
    if (width <= 1) return value.slice(0, width);
    return value.slice(0, width - 1) + '…';
}

function pad(text, width) {
    const value = String(text ?? '');
    return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function openInEditor(targetPath) {
    if (!targetPath) return;
    try {
        const editor = process.env.EDITOR || 'code';
        const safeTarget = targetPath.replace(/"/g, '\\"');
        exec(`"${editor}" "${safeTarget}"`, { windowsHide: true }, () => {});
    } catch (_) {}
}

function buildRelationMap(outbound) {
    const map = new Map();
    if (!Array.isArray(outbound)) return map;
    for (const edge of outbound) map.set(String(edge.field || ''), String(edge.to || ''));
    return map;
}

function readNoteBody(filePath) {
    return new Promise((resolve) => {
        fs.readFile(filePath, 'utf8', (err, content) => {
            if (err || !content) { resolve([]); return; }
            const lines = content.split('\n');
            let start = 0;
            if (lines[0] && lines[0].trim() === '---') {
                for (let i = 1; i < lines.length; i++) {
                    if (lines[i].trim() === '---') { start = i + 1; break; }
                }
            }
            const body = lines.slice(start).map((l) => l.trimEnd()).filter((l) => l.length > 0).slice(0, 8);
            resolve(body);
        });
    });
}

function readFullNoteBody(filePath) {
    return new Promise((resolve) => {
        fs.readFile(filePath, 'utf8', (err, content) => {
            if (err || !content) { resolve([]); return; }
            const lines = content.split('\n');
            let start = 0;
            if (lines[0] && lines[0].trim() === '---') {
                for (let i = 1; i < lines.length; i++) {
                    if (lines[i].trim() === '---') { start = i + 1; break; }
                }
            }
            resolve(lines.slice(start).map((l) => l.trimEnd()));
        });
    });
}

function applyInline(text) {
    let out = String(text ?? '');
    out = out.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id, label) => p.accent(label || id));
    out = out.replace(/`([^`]+)`/g, (_, code) => p.ok(code));
    out = out.replace(/\*\*([^*]+)\*\*/g, (_, b) => p.bold(b));
    out = out.replace(/\*([^*]+)\*/g, (_, i) => p.secondary(i));
    out = out.replace(/_([^_]+)_/g, (_, i) => p.secondary(i));
    return out;
}

function renderMarkdownBody(rawLines) {
    const lines = [];
    const headingPositions = [];
    let inCodeBlock = false;

    for (const raw of rawLines) {
        if (/^```/.test(raw)) {
            inCodeBlock = !inCodeBlock;
            lines.push(inCodeBlock ? p.faint('  ┌─── code') : p.faint('  └───'));
            continue;
        }
        if (inCodeBlock) {
            lines.push(p.ok('  ' + raw));
            continue;
        }
        const h1 = raw.match(/^# (.+)/);
        if (h1) {
            headingPositions.push(lines.length);
            lines.push('');
            lines.push(p.em('  ') + p.bold(h1[1]));
            lines.push(p.em('  ' + '─'.repeat(Math.min(h1[1].length + 2, 44))));
            continue;
        }
        const h2 = raw.match(/^## (.+)/);
        if (h2) {
            headingPositions.push(lines.length);
            lines.push('');
            lines.push(p.type('  ▸ ') + p.type(h2[1]));
            continue;
        }
        const h3 = raw.match(/^### (.+)/);
        if (h3) {
            headingPositions.push(lines.length);
            lines.push('');
            lines.push(p.secondary('  › ') + p.secondary(h3[1]));
            continue;
        }
        const taskDone = raw.match(/^[-*]\s+\[x\]\s+(.*)/i);
        if (taskDone) { lines.push(p.muted('  ☑ ') + p.muted(applyInline(taskDone[1]))); continue; }
        const taskOpen = raw.match(/^[-*]\s+\[ \]\s+(.*)/);
        if (taskOpen) { lines.push(p.warn('  ☐ ') + p.primary(applyInline(taskOpen[1]))); continue; }
        const bullet = raw.match(/^[-*]\s+(.*)/);
        if (bullet) { lines.push(p.faint('  • ') + p.primary(applyInline(bullet[1]))); continue; }
        const numbered = raw.match(/^\d+\.\s+(.*)/);
        if (numbered) { lines.push(p.faint('  ') + p.primary(applyInline(numbered[1]))); continue; }
        const quote = raw.match(/^>\s?(.*)/);
        if (quote) { lines.push(p.faint('  │ ') + p.secondary(applyInline(quote[1]))); continue; }
        if (/^---+$/.test(raw.trim())) { lines.push(p.faint('  ' + '─'.repeat(40))); continue; }
        if (!raw.trim()) { lines.push(''); continue; }
        lines.push('  ' + applyInline(raw));
    }

    return { lines, headingPositions };
}

function renderNoteDetail(ink, note, nodeDetail, intelligence, bodyLines) {
    const { Box, Text } = ink;

    const lifecycle = intelligence ? (intelligence.lifecycle || null) : null;
    const drift = intelligence ? (intelligence.drift || null) : null;
    const arc = intelligence ? (intelligence.arc || null) : null;

    const lifecycleState = String(lifecycle?.label || lifecycle?.state || '');
    const driftLabel = String(drift?.driftLabel || '').toLowerCase();
    const driftDisplay = String(drift?.driftLabelHuman || drift?.driftLabel || '');
    const lifecycleTone = (lifecycleState.toLowerCase() === 'consolidated' || driftLabel === 'on-track')
        ? p.ok
        : (driftLabel === 'minor-drift' || lifecycleState.toLowerCase() === 'growing') ? p.warn : p.err;

    const inboundCount = Number(lifecycle?.metrics?.inboundCount ?? note.inbound ?? 0);
    const likelyMissing = (Array.isArray(arc?.missingFields) ? arc.missingFields : [])
        .filter((e) => e && (e.confidenceLabel === 'high' || e.confidenceLabel === 'medium'))
        .slice(0, 4)
        .map((e) => e.field);
    const topArc = Array.isArray(arc?.missingFields)
        ? arc.missingFields.find((entry) => entry && (entry.confidenceLabel === 'high' || entry.confidenceLabel === 'medium'))
        : null;

    const relationMap = buildRelationMap(nodeDetail?._outbound);
    const inboundEdges = Array.isArray(nodeDetail?._inbound) ? nodeDetail._inbound : [];

    const displayFields = nodeDetail
        ? Object.entries(nodeDetail)
            .filter(([k]) => !SKIP_FIELDS.has(k) && !k.startsWith('__') && !k.startsWith('_'))
        : [];

    const fieldKeyWidth = displayFields.reduce((max, [k]) => Math.max(max, k.length), 6);
    const nameText = p.bold(note.label || note.id);
    const typeText = p.type(note.type || '');
    const statusText = note.status ? p.secondary(` ${SYM.dot} ${note.status}`) : '';

    const leftItems = [
        React.createElement(Text, { key: 'title' }, nameText + '  ' + typeText + statusText),
        lifecycle
            ? React.createElement(Text, { key: 'lifecycle' },
                p.muted('lifecycle: ') + lifecycleTone(lifecycleState || 'unknown') +
                '  ' + p.muted('drift: ') + lifecycleTone(driftDisplay || 'unknown') +
                '  ' + p.muted(`↑ ${inboundCount}`)
            )
            : React.createElement(Text, { key: 'inbound' }, p.muted(`↑ ${inboundCount} inbound`)),
        topArc
            ? React.createElement(Text, { key: 'next-step' },
                p.warn('next: ') +
                p.primary(String(topArc.field || '')) +
                ' ' +
                p.faint(`(${String(topArc.confidenceLabel || 'medium')})`)
            )
            : null,
        ...displayFields.map(([key, val], i) => {
            const isRelation = relationMap.has(key);
            const display = isRelation
                ? p.secondary(SYM.relation + ' ') + p.type(truncate(String(val ?? ''), 24))
                : p.primary(truncate(String(val ?? ''), 26));
            return React.createElement(Text, { key: `f-${i}` },
                '  ' + p.muted(pad(key, fieldKeyWidth + 1)) + ' ' + display
            );
        }),
    ];

    if (inboundEdges.length > 0) {
        leftItems.push(React.createElement(
            Box,
            { key: 'inbound', flexDirection: 'row', flexWrap: 'wrap' },
            React.createElement(Text, null, p.muted('  ← ')),
            ...inboundEdges.slice(0, 8).map((edge, i) => React.createElement(
                Text,
                { key: `in-${i}` },
                p.type(truncate(edge.from, 18)) + p.muted(i < Math.min(7, inboundEdges.length - 1) ? '  ' : '')
            ))
        ));
    }

    if (likelyMissing.length > 0) {
        leftItems.push(React.createElement(Text, { key: 'missing' },
            p.warn('  missing: ') + p.secondary(likelyMissing.join(', '))
        ));
    }

    const rightItems = [
        React.createElement(Text, { key: 'body-header' }, p.faint('── body')),
    ];
    if (bodyLines && bodyLines.length > 0) {
        bodyLines.forEach((line, i) => {
            rightItems.push(React.createElement(Text, { key: `b-${i}` }, p.muted(truncate(line, 56))));
        });
    } else {
        rightItems.push(React.createElement(Text, { key: 'nobody' }, p.faint('(no body text)')));
    }

    return React.createElement(
        Box,
        { flexDirection: 'row' },
        React.createElement(Box, { flexDirection: 'column', width: '52%', paddingRight: 1 }, ...leftItems),
        React.createElement(Box, { flexDirection: 'column', flexGrow: 1 }, ...rightItems)
    );
}

module.exports = {
    SKIP_FIELDS,
    truncate,
    pad,
    openInEditor,
    readNoteBody,
    readFullNoteBody,
    applyInline,
    renderMarkdownBody,
    renderNoteDetail
};
