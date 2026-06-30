'use strict';

const React = require('react');
const { p, SYM, eventTone } = require('../palette');
const Panel = require('../components/Panel');
const { Logo } = require('../components/Logo');
const { getClusters } = require('../useApi');

function relativeTime(timestamp) {
    const value = new Date(timestamp || 0).getTime();
    if (!Number.isFinite(value) || value <= 0) return 'now';
    const diffMs = Math.max(0, Date.now() - value);
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
}

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

function humanLabel(type) {
    switch (String(type || '')) {
    case 'note_created': return 'Created';
    case 'note_touched': return 'Updated';
    case 'note_deleted': return 'Deleted';
    case 'field_added': return 'Added';
    case 'field_changed': return 'Changed';
    case 'field_removed': return 'Removed';
    case 'relation_added': return 'Linked';
    case 'relation_changed': return 'Relinked';
    case 'relation_removed': return 'Unlinked';
    case 'type_set': return 'Typed';
    case 'task_status_changed': return 'Task';
    case 'rebuild': return 'Rebuilt';
    default: return String(type || '');
    }
}

function summarizeSessionDelta(sessionDelta, brokenCount) {
    const delta = sessionDelta || {};
    const changed = Number(delta.changedNotes || 0);
    const created = Number(delta.createdNotes || 0);
    const topType = delta.topType || null;
    const topTypeCount = Number(delta.topTypeCount || 0);
    const broken = Number(brokenCount || 0);
    const parts = [];
    if (created > 0) parts.push(`${created} note${created === 1 ? '' : 's'} created`);
    if (topType && topTypeCount > 0) parts.push(`${topTypeCount} ${topType}${topTypeCount === 1 ? '' : 's'} updated`);
    if (changed > 0 && created === 0 && !topType) parts.push(`${changed} note${changed === 1 ? '' : 's'} changed`);
    if (broken > 0) parts.push(`${broken} broken link${broken === 1 ? '' : 's'} in vault`);
    if (!parts.length) return 'no structural changes recorded';
    return parts.join(', ');
}

function Briefing({ ink, host, port, data, connState, dataError, lastSessionTs, disabled, width }) {
    const { Box, Text, useInput } = ink;
    const pulse = data.pulse || {};
    const typesList = Array.isArray(data.typesList) ? data.typesList : [];

    const [liveTick, setLiveTick] = React.useState(false);
    React.useEffect(() => {
        if (connState !== 'live') { setLiveTick(false); return; }
        const timer = setInterval(() => setLiveTick((t) => !t), 600);
        return () => clearInterval(timer);
    }, [connState]);

    const [clusterNudges, setClusterNudges] = React.useState([]);
    const [nudgeIndex, setNudgeIndex] = React.useState(0);
    const [nudgeToast, setNudgeToast] = React.useState('');
    React.useEffect(() => {
        getClusters({ host, port }).then(({ clusters }) => {
            const visible = clusters.filter((c) => c.confidence === 'high');
            setClusterNudges(visible);
            setNudgeIndex(0);
        }).catch(() => {});
    }, [host, port]);
    React.useEffect(() => {
        if (!nudgeToast) return undefined;
        const timer = setTimeout(() => setNudgeToast(''), 2200);
        return () => clearTimeout(timer);
    }, [nudgeToast]);

    const nudgeCluster = clusterNudges.length ? clusterNudges[nudgeIndex % clusterNudges.length] : null;

    useInput((input, key) => {
        if (!nudgeCluster) return;
        if (key.return) {
            setNudgeToast('Open Vault Health to formalize this cluster.');
            return;
        }
        if (input === 'n') {
            setNudgeIndex((index) => (index + 1) % clusterNudges.length);
        }
    }, { isActive: Boolean(nudgeCluster) && !disabled });

    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const activity = (Array.isArray(data.activity) ? data.activity : [])
        .filter((e) => e.type !== 'connected' && e.type !== 'event' && (e.label || e.type));

    const broken = pulse.broken ?? 0;
    const sessionDelta = data.sessionDelta || null;
    const sessionWindow = lastSessionTs ? `since your last session (${relativeTime(lastSessionTs)} ago)` : 'in the last 24h';
    const paneWidth = Number(width) || 96;
    const sessionLine = sessionDelta
        ? truncate(`${sessionWindow}: ${summarizeSessionDelta(sessionDelta, broken)}`, Math.max(26, paneWidth - 8))
        : 'session baseline is still forming';

    // ── Vault Pulse panel content ──────────────────────────────
    const maxTypeCount = typesList.length > 0 ? Math.max(1, typesList[0].count) : 1;
    const typeBarWidth = paneWidth < 72 ? 8 : 12;

    const statsNode = React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Text, null,
            '  ' + p.num(pad(String(pulse.notes ?? 0), 4)) + p.muted('  notes')
        ),
        React.createElement(Text, null,
            '  ' + p.num(pad(String(pulse.edges ?? 0), 4)) + p.muted('  edges')
        ),
        React.createElement(Text, null,
            '  ' + p.num(pad(String(pulse.types ?? 0), 4)) + p.muted('  types')
        ),
        React.createElement(Text, null,
            '  ' + (broken > 0 ? p.err : p.ok)(pad(String(broken), 4)) +
            p.muted('  broken') +
            (broken > 0 ? '  ' + p.err(SYM.warn) : '  ' + p.ok(SYM.ok))
        ),
        typesList.length > 0
            ? React.createElement(Box, { flexDirection: 'column', marginTop: 1 },
                React.createElement(Text, null, '  ' + p.faint('─── type distribution')),
                ...typesList.slice(0, 7).map((entry, i) => {
                    const ratio = entry.count / maxTypeCount;
                    const filled = Math.round(ratio * typeBarWidth);
                    const bar = p.accent('▓'.repeat(filled)) + p.faint('░'.repeat(typeBarWidth - filled));
                    return React.createElement(Text, { key: `type-${i}` },
                        '  ' + p.type(pad(truncate(entry.type, 10), 11)) + bar + ' ' + p.secondary(String(entry.count))
                    );
                })
            )
            : null,
    );

    // ── Activity panel content ─────────────────────────────────
    const activityNode = activity.length
        ? React.createElement(
            Box,
            { flexDirection: 'column' },
            ...activity.slice(0, 10).map((event, i) => {
                const label = event.label || humanLabel(event.type);
                const tone = eventTone(event.type);
                const when = p.muted(pad(relativeTime(event.timestamp), 5));
                const action = tone(pad(truncate(label, 9), 10));
                const note = p.secondary(truncate(event.noteId || '', 34));
                return React.createElement(Text, { key: `act-${i}` },
                    '  ' + when + '  ' + action + '  ' + note
                );
            })
        )
        : React.createElement(Text, null, p.faint('  waiting for vault activity...'));

    // ── Tasks panel content ────────────────────────────────────
    const tasksNode = tasks.length
        ? React.createElement(
            Box,
            { flexDirection: 'column' },
            ...tasks.map((task, i) => {
                const isOverdue = task.overdue;
                const isDueToday = task.dueToday;
                const tone = isOverdue ? p.err : isDueToday ? p.warn : p.primary;
                const dateTone = isOverdue ? p.err : isDueToday ? p.warn : p.date;
                const label = tone(pad(truncate(task.label || '', paneWidth < 72 ? 24 : 42), paneWidth < 72 ? 26 : 44));
                const source = p.type(pad(truncate(task.source || '', paneWidth < 72 ? 12 : 18), paneWidth < 72 ? 14 : 20));
                const date = task.date ? dateTone(truncate(task.date, 10)) : p.faint('—');
                return React.createElement(Text, { key: `task-${i}` },
                    '  ' + p.faint(`${SYM.dot} `) + label + source + date
                );
            })
        )
        : React.createElement(Text, null, p.faint('  no open tasks'));

    const contentHeight = Math.max(20, (process.stdout.rows || 30) - 4);
    const middleRowHeight = Math.floor(contentHeight * 0.55);

    return React.createElement(
        Box,
        { flexDirection: 'column', width: width || '100%', paddingX: 1, height: contentHeight },

        // ── Header: logo + identity + nav ───────────────────────
        React.createElement(
            Box,
            { flexDirection: 'row', alignItems: 'center', marginBottom: 1 },
            React.createElement(Logo, { ink }),
            React.createElement(
                Box,
                { flexDirection: 'column', flexGrow: 1 },
                React.createElement(Text, null, p.em('yamlink') + p.muted(' conduit')),
                React.createElement(Text, null,
                    p.muted('vault: ') + p.secondary(`${host}:${port}`)
                ),
                React.createElement(Text, null,
                    p.faint('[2] Query  [3] Nav  [4] Explorer  [5] Health  [6] Search  [7] Graph  [?] Help')
                )
            ),
            React.createElement(
                Box,
                { flexDirection: 'column', alignItems: 'flex-end' },
                React.createElement(Text, null,
                    connState === 'live'
                        ? (liveTick ? p.ok('◉') : p.secondary('◉')) + p.ok(' live')
                        : connState === 'disconnected'
                            ? p.err(`${SYM.idle} disconnected`)
                            : p.warn(`${SYM.idle} connecting`)
                )
            )
        ),

        // ── Error banner ────────────────────────────────────────
        dataError
            ? React.createElement(Box, { marginBottom: 1 },
                React.createElement(Text, null, p.err(`  ${SYM.warn} ${dataError}`)))
            : null,
        React.createElement(Box, { marginBottom: 1 },
            React.createElement(Text, null, '  ' + p.warn('SESSION ') + p.primary(sessionLine))
        ),

        // ── Two-panel row: stats + activity ─────────────────────
        React.createElement(
            Box,
            { flexDirection: 'row', height: middleRowHeight },
            React.createElement(Panel, {
                ink,
                title: 'Vault Pulse',
                width: paneWidth < 72 ? '40%' : '32%',
                marginRight: 1,
                flexGrow: 1,
                children: statsNode
            }),
            React.createElement(Panel, {
                ink,
                title: 'Activity',
                flexGrow: 1,
                children: activityNode
            })
        ),

        // ── Tasks panel ──────────────────────────────────────────
        React.createElement(Panel, {
            ink,
            title: 'Open Tasks',
            flexGrow: 1,
            marginLeft: 0,
            children: tasksNode
        }),
        nudgeCluster
            ? React.createElement(Panel, {
                ink,
                title: 'Emerging Pattern',
                children: React.createElement(
                    Box,
                    { flexDirection: 'column' },
                    React.createElement(
                        Text,
                        null,
                        '  ' + p.primary(String(nudgeCluster.noteCount)) +
                        p.muted(' notes share: ') +
                        p.type(truncate(nudgeCluster.fields.join(' · '), 50))
                    ),
                    React.createElement(
                        Text,
                        null,
                        '  ' +
                        (nudgeCluster.dominantType
                            ? p.muted('mostly: ') + p.type(pad(nudgeCluster.dominantType, 12))
                            : p.muted('mostly: ') + p.faint(pad('untyped', 12))) +
                        p.muted('confidence: ') + p.warn(String(nudgeCluster.confidence || '').toUpperCase())
                    ),
                    React.createElement(
                        Text,
                        null,
                        '  ' + p.faint('[Enter] create schema    [n] next cluster')
                    ),
                    nudgeToast
                        ? React.createElement(Text, null, '  ' + p.warn(nudgeToast))
                        : null
                )
            })
            : null
    );
}

Briefing.summarizeSessionDelta = summarizeSessionDelta;

module.exports = Briefing;
