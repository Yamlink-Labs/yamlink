'use strict';

const React = require('react');
const { p, SYM, termWidth } = require('../palette');

const MAX_RESULTS = 12;

/**
 * Score how well a lowercase query matches a label and detail string.
 * @param {string} label
 * @param {string} detail
 * @param {string} query already lowercased
 * @returns {number}
 */
function scoreMatch(label, detail, query) {
    const l = String(label || '').toLowerCase();
    const d = String(detail || '').toLowerCase();
    if (!query) return 0;
    if (l === query) return 100;
    if (l.startsWith(query)) return 50;
    if (l.includes(query)) return 20;
    if (d.startsWith(query)) return 10;
    if (d.includes(query)) return 5;
    return 0;
}

/**
 * Build a ranked, unified result list from commands, notes, and types.
 * @param {string} query
 * @param {Array} commands
 * @param {Array} nodes
 * @param {Array} types
 * @returns {Array<{id:string, kind:string, label:string, description:string, score:number, action?:Function, noteId?:string}>}
 */
function buildWarpResults(query, commands, nodes, types) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];

    const results = [];

    for (const cmd of (commands || [])) {
        const score = scoreMatch(cmd.label, cmd.description || '', q);
        if (score > 0) {
            results.push({
                id: `cmd:${cmd.id}`,
                kind: 'cmd',
                label: String(cmd.label || ''),
                description: String(cmd.description || ''),
                score,
                action: cmd.action
            });
        }
    }

    for (const t of (types || [])) {
        const score = scoreMatch(t.type, `${t.count || 0} notes`, q);
        if (score > 0) {
            results.push({
                id: `type:${t.type}`,
                kind: 'type',
                label: String(t.type || ''),
                description: `${t.count || 0} notes`,
                score
            });
        }
    }

    for (const n of (nodes || [])) {
        const label = String(n.name || n.title || n.id || '');
        const detail = String(n.id || '') + ' ' + String(n.type || '');
        const score = scoreMatch(label, detail, q);
        if (score > 0) {
            results.push({
                id: `note:${n.id}`,
                kind: 'note',
                label,
                description: String(n.type || ''),
                score,
                noteId: String(n.id || '')
            });
        }
    }

    results.sort((a, b) => b.score - a.score || String(a.label).localeCompare(String(b.label)));
    return results.slice(0, MAX_RESULTS);
}

const KIND_BADGE = { cmd: 'cmd ', type: 'type', note: 'note' };

function kindColor(kind) {
    if (kind === 'cmd') return p.accent;
    if (kind === 'type') return p.type;
    return p.primary;
}

function Warp({ ink, initialQuery, commands, typesList, getNodes, host, port, onNavigate, onClose }) {
    const { Box, Text, useInput } = ink;
    const [query, setQuery] = React.useState(String(initialQuery || ''));
    const [cursor, setCursor] = React.useState(0);
    const [nodes, setNodes] = React.useState([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let cancelled = false;
        getNodes({ host, port })
            .then((result) => { if (!cancelled) setNodes(Array.isArray(result) ? result : []); })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [getNodes, host, port]);

    const results = React.useMemo(
        () => buildWarpResults(query, commands, nodes, typesList),
        [query, commands, nodes, typesList]
    );
    const safeCursor = Math.min(cursor, Math.max(0, results.length - 1));

    useInput((input, key) => {
        if (key.escape) { onClose(); return; }
        if (key.return) {
            const item = results[safeCursor];
            if (!item) return;
            if (item.kind === 'cmd') { item.action(); onClose(); }
            else if (item.kind === 'type') { onNavigate('explorer', { typeFilter: item.label }); onClose(); }
            else if (item.kind === 'note') { onNavigate('explorer', { noteId: item.noteId }); onClose(); }
            return;
        }
        if (key.upArrow || input === 'k') { setCursor((c) => Math.max(0, c - 1)); return; }
        if (key.downArrow || input === 'j') { setCursor((c) => Math.min(Math.max(0, results.length - 1), c + 1)); return; }
        if (key.backspace || key.delete) {
            const next = query.slice(0, -1);
            if (!next) { onClose(); return; }
            setQuery(next);
            setCursor(0);
            return;
        }
        if (input && input.charCodeAt(0) >= 32) {
            setQuery((q) => q + input);
            setCursor(0);
        }
    }, { isActive: true });

    const tw = termWidth();
    const divWidth = Math.min(tw - 4, 60);

    const rows = results.map((item, i) => {
        const sel = i === safeCursor;
        const mark = sel ? p.accent(SYM.cursor + ' ') : '  ';
        const badge = kindColor(item.kind)(KIND_BADGE[item.kind] || '    ');
        const label = sel ? p.bold(item.label) : p.primary(item.label);
        const desc = item.description ? '  ' + p.muted(item.description) : '';
        return React.createElement(Text, { key: item.id }, mark + badge + '  ' + label + desc);
    });

    if (results.length === 0) {
        rows.push(React.createElement(Text, { key: 'empty' },
            p.faint('  ' + (loading ? 'loading…' : 'no matches — keep typing'))
        ));
    }

    return React.createElement(
        Box,
        { flexDirection: 'column', width: '100%' },
        React.createElement(Text, null,
            p.header('JUMP TO') + '  ' + p.faint('›') + '  ' + p.primary(query) + p.accent('█') + p.faint('  notes · commands · types')
        ),
        React.createElement(Text, null, p.faint('─'.repeat(divWidth))),
        ...rows,
        React.createElement(Text, null, ''),
        React.createElement(Text, null,
            p.faint('  [↑↓] [jk] move  [Enter] jump  [Esc] cancel  [Backspace] edit')
        )
    );
}

Warp.scoreMatch = scoreMatch;
Warp.buildWarpResults = buildWarpResults;
Warp.MAX_RESULTS = MAX_RESULTS;

module.exports = Warp;
