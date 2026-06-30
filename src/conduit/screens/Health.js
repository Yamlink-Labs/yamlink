'use strict';

const React = require('react');
const Panel = require('../components/Panel');
const { p, SYM, termWidth } = require('../palette');
const { getPressure } = require('../useApi');

function pad(text, width) {
    const value = String(text ?? '');
    return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function truncate(text, width) {
    const value = String(text ?? '');
    if (value.length <= width) return value;
    if (width <= 1) return value.slice(0, width);
    return value.slice(0, width - 1) + '…';
}

function coverageBar(conformant, total) {
    const w = 16;
    if (!total) return p.muted(pad('n/a', w + 5));
    const ratio = conformant / total;
    const filled = Math.round(ratio * w);
    const bar = '█'.repeat(filled) + '░'.repeat(w - filled);
    const pct = Math.round(ratio * 100);
    const pctStr = pad(pct + '%', 4);
    if (pct >= 80) return p.ok(bar) + ' ' + p.ok(pctStr);
    if (pct >= 50) return p.warn(bar) + ' ' + p.warn(pctStr);
    return p.err(bar) + ' ' + p.err(pctStr);
}

function scoreGauge(score) {
    const w = 24;
    const filled = Math.round((score / 100) * w);
    const bar = '█'.repeat(filled) + '░'.repeat(w - filled);
    if (score >= 80) return p.ok(bar) + ' ' + p.ok(String(score) + '/100');
    if (score >= 50) return p.warn(bar) + ' ' + p.warn(String(score) + '/100');
    return p.err(bar) + ' ' + p.err(String(score) + '/100');
}

function Health({ ink, host, port, getHealth, getTypes, onNavigate, onQuit, disabled, width }) {
    const { Box, Text, useInput } = ink;
    const [state, setState] = React.useState({ loading: true, health: null, types: [], error: '' });
    const [pressure, setPressure] = React.useState(null);

    React.useEffect(() => {
        getPressure({ host, port }).then((data) => { if (data) setPressure(data); }).catch(() => {});
    }, [host, port]);

    useInput((input, key) => {
        if (key.ctrl && input === 'c') { onQuit(); return; }
        if (input === '1') { onNavigate('briefing'); return; }
        if (input === '2') { onNavigate('query'); return; }
        if (input === '3') { onNavigate('navigator'); return; }
        if (input === '4') { onNavigate('explorer'); return; }
        if (key.escape || input === 'q') { onNavigate('briefing'); return; }
    }, { isActive: !disabled });

    React.useEffect(() => {
        Promise.all([
            getHealth({ host, port }),
            getTypes({ host, port }).catch(() => [])
        ]).then(([health, types]) => {
            setState({ loading: false, health, types: Array.isArray(types) ? types : [], error: '' });
        }).catch((err) => {
            setState({ loading: false, health: null, types: [], error: err.message || String(err) });
        });
    }, [getHealth, getTypes, host, port]);

    if (state.loading) {
        return React.createElement(
            Box,
            { flexDirection: 'column', width: width || '100%', paddingX: 1 },
            React.createElement(Panel, {
                ink, title: 'Vault Health', flexGrow: 1,
                children: React.createElement(Text, null, p.muted(`  ${SYM.idle}  loading...`))
            })
        );
    }

    if (state.error) {
        return React.createElement(
            Box,
            { flexDirection: 'column', width: width || '100%', paddingX: 1 },
            React.createElement(Panel, {
                ink, title: 'Vault Health', flexGrow: 1,
                children: React.createElement(Text, null, p.err('  ' + state.error))
            })
        );
    }

    const health = state.health || {};
    const si = health.schemaIntelligence || {};
    const advisories = Array.isArray(si.advisories) ? si.advisories : [];
    const coverage = Array.isArray(si.coverage) ? si.coverage : [];
    const dangling = Array.isArray(si.danglingRelations) ? si.danglingRelations : [];
    const types = state.types;

    const noteCount = Number(health.notes || 0);
    const brokenCount = Number(health.brokenLinks || 0);

    const totalCov = coverage.reduce((s, c) => s + (c.total || 0), 0);
    const totalConform = coverage.reduce((s, c) => s + (c.conformant || 0), 0);
    const coverageRatio = totalCov ? totalConform / totalCov : null;

    let healthScore = 100;
    if (brokenCount > 0) healthScore -= Math.min(40, Math.round(brokenCount / Math.max(1, noteCount) * 200));
    if (coverageRatio !== null) healthScore -= Math.round((1 - coverageRatio) * 30);
    if (dangling.length > 0) healthScore -= Math.min(20, dangling.length * 5);
    healthScore = Math.max(0, healthScore);

    const divider = p.faint('─'.repeat(termWidth()));

    // Overview panel content
    const overviewNode = React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Text, null, '  ' + scoreGauge(healthScore)),
        React.createElement(Text, null, ''),
        React.createElement(Text, null, '  ' + p.num(String(noteCount)) + p.muted(' notes')),
        React.createElement(Text, null, '  ' + (brokenCount > 0 ? p.err : p.ok)(String(brokenCount)) + p.muted(' broken links')),
        React.createElement(Text, null, '  ' + p.num(String(types.length)) + p.muted(' types')),
        coverage.length > 0
            ? React.createElement(Text, null, '  ' + p.num(String(coverage.length)) + p.muted(' schemas'))
            : React.createElement(Text, null, '  ' + p.faint('no schemas defined'))
    );

    // Coverage/distribution panel content
    const rightNode = coverage.length > 0
        ? React.createElement(
            Box,
            { flexDirection: 'column' },
            React.createElement(Text, null,
                '  ' + p.muted(pad('TYPE', 14)) + p.muted(pad('NOTES', 8)) + p.muted(pad('COVERAGE', 22)) + p.muted('STATUS')
            ),
            React.createElement(Text, null, ''),
            ...coverage.map((entry, i) => {
                const nonC = entry.nonConformant || 0;
                const status = nonC > 0 ? p.warn(`${nonC} issues`) : p.ok(`${SYM.ok} clean`);
                return React.createElement(Text, { key: `cov-${i}` },
                    '  ' + p.type(pad(truncate(entry.type, 12), 14)) +
                    p.secondary(pad(String(entry.total), 8)) +
                    coverageBar(entry.conformant, entry.total) + '  ' + status
                );
            })
        )
        : React.createElement(
            Box,
            { flexDirection: 'column' },
            ...types.slice(0, 12).map((entry, i) => React.createElement(
                Text,
                { key: `type-${i}` },
                '  ' + p.type(pad(truncate(entry.type, 14), 16)) + p.num(String(entry.count))
            ))
        );

    const rightTitle = coverage.length > 0 ? 'Schema Coverage' : 'Type Distribution';

    // Diagnostics panel content
    const diagItems = [];
    if (brokenCount > 0) {
        diagItems.push(React.createElement(Text, { key: 'broken' },
            `  ${p.err(SYM.warn)}  ` + p.err(`${brokenCount} broken link${brokenCount !== 1 ? 's' : ''}`) +
            p.muted(' — open VS Code Vault Health for details')
        ));
    } else {
        diagItems.push(React.createElement(Text, { key: 'clean' },
            `  ${p.ok(SYM.ok)}  ` + p.ok('no broken links')
        ));
    }
    for (const adv of advisories.slice(0, 3)) {
        diagItems.push(React.createElement(Text, { key: `adv-${adv.type}` },
            `  ${p.warn(SYM.dot)}  ` + p.warn(truncate(String(adv.type || ''), 18)) +
            p.muted(` — ${adv.count} required field${adv.count !== 1 ? 's' : ''}`)
        ));
    }
    for (const rel of dangling.slice(0, 3)) {
        diagItems.push(React.createElement(Text, { key: `dang-${rel.field}` },
            `  ${p.faint(SYM.dot)}  ` +
            p.type(truncate(rel.schemaType, 12)) + p.muted('.') +
            p.primary(truncate(rel.field, 12)) + p.muted(' → ') +
            p.type(truncate(rel.targetType, 12)) + p.faint(' (absent)')
        ));
    }

    return React.createElement(
        Box,
        { flexDirection: 'column', width: width || '100%', paddingX: 1 },
        React.createElement(
            Box,
            { flexDirection: 'row' },
            React.createElement(Panel, {
                ink, title: 'Overview', width: '38%', marginRight: 1,
                children: overviewNode
            }),
            React.createElement(Panel, {
                ink, title: rightTitle, flexGrow: 1,
                children: rightNode
            })
        ),
        React.createElement(Panel, {
            ink, title: 'Diagnostics',
            children: React.createElement(Box, { flexDirection: 'column' }, ...diagItems)
        }),
        pressure
            ? React.createElement(Panel, {
                ink, title: 'Knowledge Pressure',
                children: React.createElement(
                    Box,
                    { flexDirection: 'column' },
                    pressure.score !== undefined
                        ? React.createElement(Text, null, '  ' + scoreGauge(pressure.score) + p.muted('  pressure'))
                        : null,
                    pressure.score !== undefined ? React.createElement(Text, null, '') : null,
                    Array.isArray(pressure.loadBearingDrafts) && pressure.loadBearingDrafts.length > 0
                        ? React.createElement(Box, { flexDirection: 'column' },
                            React.createElement(Text, null, '  ' + p.warn('▸ ') + p.muted('LOAD-BEARING DRAFTS')),
                            ...pressure.loadBearingDrafts.slice(0, 4).map((note, i) =>
                                React.createElement(Text, { key: `lbd-${i}` },
                                    '  ' + p.faint(SYM.dot + ' ') +
                                    p.warn(pad(truncate(note.id, 22), 24)) +
                                    p.type(truncate(note.type || '', 12)) +
                                    p.muted(` ← ${note.inbound}`)
                                )
                            )
                        )
                        : null,
                    Array.isArray(pressure.staleHubs) && pressure.staleHubs.length > 0
                        ? React.createElement(Box, { flexDirection: 'column', marginTop: 1 },
                            React.createElement(Text, null, '  ' + p.err('▸ ') + p.muted('STALE HUBS')),
                            ...pressure.staleHubs.slice(0, 4).map((note, i) =>
                                React.createElement(Text, { key: `sh-${i}` },
                                    '  ' + p.faint(SYM.dot + ' ') +
                                    p.err(pad(truncate(note.id, 22), 24)) +
                                    p.type(truncate(note.type || '', 12)) +
                                    p.muted(` ← ${note.inbound}`)
                                )
                            )
                        )
                        : null,
                    pressure.orphanCount !== undefined
                        ? React.createElement(Text, { key: 'orphans' },
                            (Array.isArray(pressure.loadBearingDrafts) || Array.isArray(pressure.staleHubs)
                                ? React.createElement(Text, null, '')
                                : null),
                            '  ' + p.faint(SYM.dot + ' ') +
                            p.secondary(String(pressure.orphanCount)) + p.muted(' orphaned notes')
                        )
                        : null
                )
            })
            : null,
        React.createElement(Text, null, divider),
        React.createElement(Text, null, p.faint('[1] Briefing  [4] Explorer  [Esc/q] back  [Ctrl+C] quit'))
    );
}

module.exports = Health;
