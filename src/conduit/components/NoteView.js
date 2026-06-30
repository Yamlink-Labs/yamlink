'use strict';

const React = require('react');
const Panel = require('./Panel');
const { p, termWidth } = require('../palette');
const { openInEditor, readFullNoteBody, renderMarkdownBody } = require('../noteDetail');

function NoteView({ ink, noteId, host, port, getNode, getNoteIntelligence, onClose }) {
    const { Box, Text, useInput } = ink;
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [note, setNote] = React.useState(null);
    const [intelligence, setIntelligence] = React.useState(null);
    const [rendered, setRendered] = React.useState([]);
    const [headingPositions, setHeadingPositions] = React.useState([]);
    const [scroll, setScroll] = React.useState(0);

    const visibleHeight = Math.max(8, (process.stdout.rows || 24) - 8);

    React.useEffect(() => {
        if (!noteId) return;
        setLoading(true);
        setScroll(0);
        setRendered([]);
        setHeadingPositions([]);
        Promise.all([
            getNode({ host, port, id: noteId }),
            getNoteIntelligence({ host, port, id: noteId }).catch(() => null)
        ]).then(async ([detail, intel]) => {
            const rawLines = detail?._filePath ? await readFullNoteBody(detail._filePath) : [];
            const { lines, headingPositions: hdgs } = renderMarkdownBody(rawLines);
            setRendered(lines);
            setHeadingPositions(hdgs);
            setIntelligence(intel);
            setNote({
                id: String(detail?.id || noteId),
                label: String(detail?.name || detail?.title || detail?.id || noteId),
                type: String(detail?.type || ''),
                status: String(detail?.status || ''),
                filePath: String(detail?._filePath || '')
            });
            setLoading(false);
        }).catch((err) => {
            setError(err.message || String(err));
            setLoading(false);
        });
    }, [noteId, host, port, getNode, getNoteIntelligence]);

    useInput((input, key) => {
        if (key.escape) { onClose(); return; }
        if (input === 'o' && note?.filePath) { openInEditor(note.filePath); return; }
        const maxScroll = Math.max(0, rendered.length - visibleHeight);
        if (input === 'j' || key.downArrow) { setScroll((s) => Math.min(s + 1, maxScroll)); return; }
        if (input === 'k' || key.upArrow) { setScroll((s) => Math.max(0, s - 1)); return; }
        if (key.pageDown) { setScroll((s) => Math.min(s + Math.floor(visibleHeight / 2), maxScroll)); return; }
        if (key.pageUp) { setScroll((s) => Math.max(0, s - Math.floor(visibleHeight / 2))); return; }
        if (input === ']') {
            const next = headingPositions.find((i) => i > scroll);
            if (next !== undefined) setScroll(Math.min(next, maxScroll));
            return;
        }
        if (input === '[') {
            const prev = [...headingPositions].reverse().find((i) => i < scroll);
            if (prev !== undefined) setScroll(Math.max(0, prev));
            return;
        }
    });

    const w = Math.min(termWidth(), 100);
    const marginLeft = Math.max(0, Math.floor((termWidth() - w) / 2));

    if (loading) {
        return React.createElement(
            Box, { flexDirection: 'column', marginLeft, marginTop: 1 },
            React.createElement(Panel, { ink, title: 'note view', width: w,
                children: React.createElement(Text, null, p.muted('  loading…'))
            })
        );
    }

    if (error) {
        return React.createElement(
            Box, { flexDirection: 'column', marginLeft, marginTop: 1 },
            React.createElement(Panel, { ink, title: 'note view', width: w,
                children: React.createElement(Text, null, p.err('  ' + error))
            })
        );
    }

    const lifecycle = intelligence?.lifecycle;
    const lifecycleLabel = String(lifecycle?.label || lifecycle?.state || '');
    const arc = intelligence?.arc;
    const missing = (Array.isArray(arc?.missingFields) ? arc.missingFields : [])
        .filter((e) => e?.confidenceLabel === 'high' || e?.confidenceLabel === 'medium')
        .slice(0, 3)
        .map((e) => e.field);

    const maxScroll = Math.max(0, rendered.length - visibleHeight);
    const scrollPct = rendered.length > visibleHeight
        ? Math.round((scroll / Math.max(1, maxScroll)) * 100)
        : 100;
    const scrollTag = rendered.length > visibleHeight ? p.faint(` ${scrollPct}%`) : '';

    const visibleLines = rendered.slice(scroll, scroll + visibleHeight);

    const content = React.createElement(
        Box, { flexDirection: 'column' },
        React.createElement(Text, { key: 'hdr' },
            p.bold(note.label) + '  ' + p.type(note.type) +
            (lifecycleLabel ? '  ' + p.ok(lifecycleLabel) : '')
        ),
        React.createElement(Text, { key: 'div' }, p.faint('  ' + '─'.repeat(Math.max(0, w - 6)))),
        ...visibleLines.map((line, i) =>
            React.createElement(Text, { key: `l${i}` }, line || '')
        ),
        missing.length > 0
            ? React.createElement(Box, { key: 'arc', marginTop: 1 },
                React.createElement(Text, null, p.warn('  ⚑ missing: ') + p.secondary(missing.join(', ')))
            )
            : null,
        React.createElement(Box, { key: 'footer', marginTop: 1 },
            React.createElement(Text, null,
                p.faint('  [j/k] scroll  []/[] sections  [o] open editor  [Esc] close') + scrollTag
            )
        )
    );

    return React.createElement(
        Box, { flexDirection: 'column', marginLeft, marginTop: 1 },
        React.createElement(Panel, { ink, title: 'note view', width: w, children: content })
    );
}

module.exports = NoteView;
