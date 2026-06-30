'use strict';

const React = require('react');
const { p, SYM, termWidth } = require('../palette');
const Panel = require('../components/Panel');

function truncate(text, width) {
    const value = String(text ?? '');
    if (value.length <= width) return value;
    if (width <= 1) return value.slice(0, width);
    return value.slice(0, width - 1) + '…';
}

function highlight(text, query) {
    if (!query || !text) return p.primary(text);
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) return p.secondary(text);
    return (
        p.secondary(text.slice(0, idx)) +
        p.em(text.slice(idx, idx + q.length)) +
        p.secondary(text.slice(idx + q.length))
    );
}

function Search({ ink, host, port, runSearch, onNavigate, onQuit, onPeek, onStateChange, initialQuery = '', disabled, width }) {
    const { Box, Text, useInput } = ink;

    const [query, setQuery] = React.useState(initialQuery);
    const [results, setResults] = React.useState(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);
    const [cursor, setCursor] = React.useState(0);
    const [debounceTimer, setDebounceTimer] = React.useState(null);
    const onStateChangeRef = React.useRef(onStateChange);
    React.useEffect(() => { onStateChangeRef.current = onStateChange; });

    React.useEffect(() => {
        if (initialQuery !== query) setQuery(initialQuery);
    }, [initialQuery]);

    React.useEffect(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (!query.trim()) {
            setResults(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        const timer = setTimeout(async () => {
            try {
                const res = await runSearch({ host, port, query: query.trim() });
                setResults(Array.isArray(res) ? res : (Array.isArray(res?.results) ? res.results : []));
                setCursor(0);
            } catch (err) {
                setError(String(err?.message || err));
            } finally {
                setLoading(false);
            }
        }, 180);
        setDebounceTimer(timer);
        return () => clearTimeout(timer);
    }, [query]);

    React.useEffect(() => {
        const selected = Array.isArray(results) ? results[cursor] : null;
        onStateChangeRef.current?.({ noteId: selected?.id || '', query });
    }, [cursor, query, results]);

    useInput((input, key) => {
        if (key.escape) { onNavigate('briefing'); return; }
        if (key.ctrl && input === 'c') { onQuit(); return; }
        if (input === 'k' || key.upArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
        if (input === 'j' || key.downArrow) {
            const max = results ? results.length - 1 : 0;
            setCursor((c) => Math.min(max, c + 1));
            return;
        }
        if (key.return) {
            if (results && results[cursor]) {
                onNavigate('explorer', results[cursor].id);
            }
            return;
        }
        if (input === 'p' && results && results[cursor] && onPeek) {
            onPeek(results[cursor].id);
            return;
        }
        if (key.backspace || key.delete) {
            setQuery((q) => q.slice(0, -1));
            return;
        }
        if (!key.ctrl && !key.meta && input) {
            setQuery((q) => q + input);
        }
    }, { isActive: !disabled });

    const divider = p.faint('─'.repeat(Math.max(20, Math.min(Number(width) || termWidth(), termWidth()))));

    const resultsSlice = results ? results.slice(0, 12) : [];

    const resultsNode = error
        ? React.createElement(Text, null, p.err(`  ${SYM.err}  ${error}`))
        : loading
            ? React.createElement(Text, null, p.muted(`  ${SYM.idle}  searching...`))
            : results === null
                ? React.createElement(
                    Box,
                    { flexDirection: 'column' },
                    React.createElement(Text, null, p.faint('  Type to search across all notes')),
                    React.createElement(Text, null, ''),
                    React.createElement(Text, null, p.muted('  Searches: title, id, body text, fields')),
                    React.createElement(Text, null, p.muted('  ↑↓ to move  ↵ to open  Esc to go back'))
                )
                : results.length === 0
                    ? React.createElement(Text, null, p.faint(`  no results for "${query}"`))
                    : React.createElement(
                        Box,
                        { flexDirection: 'column' },
                        React.createElement(Text, null,
                            '  ' + p.ok(`${results.length}`) + p.muted(' matches')
                        ),
                        React.createElement(Text, null, ''),
                        ...resultsSlice.map((r, i) => {
                            const isCursor = i === cursor;
                            const pfx = isCursor ? p.accent(`  ${SYM.selected} `) : '    ';
                            const id = isCursor
                                ? p.accent(truncate(r.id || '', 24))
                                : highlight(truncate(r.id || '', 24), query);
                            const type = p.type(truncate(r.type || '', 14));
                            const snippet = r.snippet
                                ? '  ' + p.faint(truncate(r.snippet, 36))
                                : '';
                            return React.createElement(
                                Box,
                                { key: `res-${i}`, flexDirection: 'column' },
                                React.createElement(Text, null,
                                    pfx + id + '  ' + type + snippet
                                )
                            );
                        })
                    );

    const queryDisplay = query
        ? p.primary(query) + p.accent('▌')
        : p.faint('search...') + p.accent('▌');

    return React.createElement(
        Box,
        { flexDirection: 'column', width: width || '100%', paddingX: 1 },

        // ── Search bar ─────────────────────────────────────────
        React.createElement(
            Box,
            { flexDirection: 'row', marginBottom: 1 },
            React.createElement(Text, null, p.muted('  / ') + queryDisplay)
        ),

        React.createElement(Text, null, divider),

        // ── Results panel ──────────────────────────────────────
        React.createElement(Panel, {
            ink,
            title: 'Results',
            flexGrow: 1,
            children: resultsNode
        }),

        React.createElement(Text, null, divider),
        React.createElement(Text, null,
            p.faint('[Esc] back  [↑↓/j/k] navigate  [↵] open  [p] peek  [Ctrl+C] quit')
        )
    );
}

module.exports = Search;
