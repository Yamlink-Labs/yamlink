'use strict';

const PRIMARY_EVENT_WEIGHTS = new Map([
    ['vault_import_completed', 10],
    ['template_applied', 9],
    ['template_fields_filled', 8],
    ['query_builder_applied', 8],
    ['block_reference_created', 8],
    ['relation_added', 8],
    ['relation_changed', 7],
    ['relation_removed', 6],
    ['field_added', 6],
    ['field_changed', 5],
    ['type_set', 5],
    ['note_created', 4],
    ['query_builder_opened', 3],
    ['query_builder_preview_opened', 3],
    ['live_note_opened', 3],
    ['task_state_changed', 3],
    ['task_status_changed', 3],
    ['suggestion_ignored', 1]
]);

const SESSION_FAMILY_WEIGHTS = new Map([
    ['import', 10],
    ['templating', 9],
    ['querying', 8],
    ['referencing', 8],
    ['modeling', 7],
    ['authoring', 6],
    ['tasking', 5],
    ['review', 4]
]);

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function relTime(iso) {
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const s = Math.floor(diff / 1000);
    if (s < 90) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'yesterday';
    if (d < 7) return `${d}d ago`;
    return `${Math.floor(d / 7)}w ago`;
}

function inferEventWeight(type) {
    return PRIMARY_EVENT_WEIGHTS.get(type) || 0;
}

function inferSessionFamily(events) {
    const has = (type) => events.some((event) => event?.type === type);
    if (has('vault_import_completed')) return 'import';
    if (has('template_applied') || has('template_fields_filled')) return 'templating';
    if (has('query_builder_applied') || has('query_builder_opened') || has('query_builder_preview_opened') || has('query_builder_copied')) return 'querying';
    if (has('block_reference_created')) return 'referencing';
    if (has('relation_added') || has('relation_changed') || has('relation_removed') || has('type_set')) return 'modeling';
    if (has('task_state_changed') || has('task_status_changed')) return 'tasking';
    if (has('live_note_opened') || has('live_note_reveal_source') || has('live_note_open_report')) return 'review';
    return 'authoring';
}

function inferSessionOutcome(events) {
    const has = (type) => events.some((event) => event?.type === type);
    if (has('vault_import_completed')) return 'imported';
    if (has('query_builder_applied')) return 'applied';
    if (has('template_applied') || has('template_fields_filled')) return 'expanded';
    if (has('block_reference_created') || has('relation_added') || has('relation_changed') || has('relation_removed')) return 'linked';
    if (has('field_added') || has('field_changed') || has('type_set')) return 'updated';
    if (has('query_builder_opened') || has('query_builder_preview_opened') || has('live_note_opened')) return 'explored';
    if (has('suggestion_ignored')) return 'dismissed';
    return 'observed';
}

function familyLabel(family) {
    switch (family) {
        case 'import': return 'Import';
        case 'templating': return 'Template';
        case 'querying': return 'Query';
        case 'referencing': return 'Reference';
        case 'modeling': return 'Model';
        case 'tasking': return 'Task';
        case 'review': return 'Review';
        default: return 'Authoring';
    }
}

function outcomeLabel(outcome) {
    switch (outcome) {
        case 'imported': return 'Imported';
        case 'applied': return 'Applied';
        case 'expanded': return 'Expanded';
        case 'linked': return 'Linked';
        case 'updated': return 'Updated';
        case 'explored': return 'Explored';
        case 'dismissed': return 'Dismissed';
        default: return 'Observed';
    }
}

function describeEventType(type, count) {
    const suffix = count > 1 ? `${count} ` : '';
    switch (type) {
        case 'vault_import_completed': return count > 1 ? `${count} imports completed` : 'import completed';
        case 'template_applied': return count > 1 ? `${count} smart templates applied` : 'smart template applied';
        case 'template_fields_filled': return count > 1 ? `${count} template field passes` : 'template fields filled';
        case 'block_reference_created': return count > 1 ? `${count} block references created` : 'block reference created';
        case 'query_builder_applied': return count > 1 ? `${count} queries inserted` : 'query inserted';
        case 'query_builder_opened': return count > 1 ? `${count} query builders opened` : 'query builder opened';
        case 'query_builder_preview_opened': return count > 1 ? `${count} query previews opened` : 'query preview opened';
        case 'query_builder_copied': return count > 1 ? `${count} queries copied` : 'query copied';
        case 'live_note_opened': return count > 1 ? `${count} live notes opened` : 'live note opened';
        case 'live_note_reveal_source': return count > 1 ? `${count} source jumps made` : 'jumped back to source';
        case 'live_note_open_report': return count > 1 ? `${count} note reports opened` : 'note report opened';
        case 'relation_added': return count > 1 ? `${count} relations linked` : 'relation linked';
        case 'relation_removed': return count > 1 ? `${count} relations removed` : 'relation removed';
        case 'relation_changed': return count > 1 ? `${count} relations updated` : 'relation updated';
        case 'field_added': return count > 1 ? `${count} fields added` : 'field added';
        case 'field_changed': return count > 1 ? `${count} fields updated` : 'field updated';
        case 'field_removed': return count > 1 ? `${count} fields removed` : 'field removed';
        case 'type_set': return count > 1 ? `${count} note types set` : 'type set';
        case 'note_created': return count > 1 ? `${count} notes created` : 'note created';
        case 'task_state_changed':
        case 'task_status_changed': return count > 1 ? `${count} task states changed` : 'task state changed';
        case 'suggestion_ignored': return count > 1 ? `${count} suggestions ignored` : 'suggestion ignored';
        case 'completion_accepted': return count > 1 ? `${count} completions accepted` : 'completion accepted';
        case 'lightbulb_applied': return count > 1 ? `${count} quick fixes applied` : 'quick fix applied';
        default: return `${suffix}${String(type || 'changes').replace(/_/g, ' ')}`.trim();
    }
}

function pickPrimaryNoteId(events) {
    const counts = new Map();
    for (const event of events || []) {
        const noteId = String(event?.noteId || '').trim();
        if (!noteId) continue;
        counts.set(noteId, (counts.get(noteId) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
}

function pickPrimaryType(typeCounts) {
    return [...typeCounts.entries()]
        .sort((a, b) => {
            const weightDelta = inferEventWeight(b[0]) - inferEventWeight(a[0]);
            if (weightDelta) return weightDelta;
            return b[1] - a[1] || a[0].localeCompare(b[0]);
        })[0]?.[0] || '';
}

function collectFocusFields(events) {
    const counts = new Map();
    for (const event of events || []) {
        const field = String(event?.field || '').trim();
        if (!field) continue;
        counts.set(field, (counts.get(field) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([field]) => field);
}

function extractRelatedIds(rawValue) {
    if (!rawValue) return [];
    const matches = [...String(rawValue).matchAll(/\[\[([^\]]+)\]\]/g)];
    return matches
        .map((match) => match[1].split('|')[0].split('#')[0].split('^')[0].trim())
        .filter(Boolean);
}

function collectImpactedTargets(events) {
    const counts = new Map();
    for (const event of events || []) {
        const values = [event?.newValue, event?.oldValue];
        for (const value of values) {
            for (const id of extractRelatedIds(value)) {
                counts.set(id, (counts.get(id) || 0) + 1);
            }
        }
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([id]) => id);
}

function inferSessionReason(events) {
    const reasons = new Map();
    for (const event of events || []) {
        const reason = String(event?.meta?.sessionReason || '').trim();
        if (!reason) continue;
        reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
    return [...reasons.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
}

function inferFamilyStrength(family, events, noteCount) {
    const familyWeight = SESSION_FAMILY_WEIGHTS.get(family) || 0;
    const eventScore = Math.min((events?.length || 0) / 6, 1) * 0.45;
    const breadthScore = Math.min((noteCount || 1) / 3, 1) * 0.15;
    const familyScore = (familyWeight / 10) * 0.4;
    const total = familyScore + eventScore + breadthScore;
    if (total >= 0.82) return 'high';
    if (total >= 0.5) return 'medium';
    return 'low';
}

function classifyEventPhase(event) {
    switch (event?.type) {
        case 'note_created':
        case 'vault_import_completed':
            return 'seed';
        case 'type_set':
        case 'template_applied':
        case 'template_fields_filled':
        case 'field_added':
            return 'shape';
        case 'field_changed':
        case 'field_removed':
            return 'refine';
        case 'relation_added':
        case 'relation_changed':
        case 'relation_removed':
        case 'block_reference_created':
            return 'connect';
        case 'query_builder_opened':
        case 'query_builder_preview_opened':
        case 'live_note_opened':
        case 'live_note_reveal_source':
        case 'live_note_open_report':
            return 'inspect';
        case 'query_builder_applied':
        case 'completion_accepted':
        case 'lightbulb_applied':
        case 'task_state_changed':
        case 'task_status_changed':
            return 'apply';
        case 'suggestion_ignored':
            return 'dismiss';
        default:
            return 'mutate';
    }
}

function buildCausalChain(events) {
    const chain = [];
    for (const event of events || []) {
        const phase = classifyEventPhase(event);
        if (!chain.length || chain[chain.length - 1] !== phase) {
            chain.push(phase);
        }
    }
    return chain;
}

function formatCausalChain(chain) {
    return (chain || []).join(' -> ');
}

function inferSessionMode(events) {
    let inspectCount = 0;
    let applyCount = 0;
    for (const event of events || []) {
        const phase = classifyEventPhase(event);
        if (phase === 'inspect') inspectCount += 1;
        if (phase === 'apply' || phase === 'connect' || phase === 'shape' || phase === 'refine') applyCount += 1;
    }
    if (inspectCount > 0 && applyCount === 0) return 'exploratory';
    if (applyCount > 0 && inspectCount === 0) return 'applied';
    if (applyCount > 0 && inspectCount > 0) return 'mixed';
    return 'ambient';
}

function buildFamilyStreaks(sessions) {
    const ordered = [...(sessions || [])].sort((a, b) => a.endedAt.localeCompare(b.endedAt));
    const streaks = [];
    let current = null;
    for (const session of ordered) {
        const key = `${session.family || 'authoring'}::${session.mode || 'ambient'}`;
        if (!current || current.key !== key) {
            if (current) streaks.push(current);
            current = {
                key,
                family: session.family || 'authoring',
                familyLabel: session.familyLabel || familyLabel(session.family || 'authoring'),
                mode: session.mode || 'ambient',
                count: 1,
                startedAt: session.startedAt,
                endedAt: session.endedAt
            };
        } else {
            current.count += 1;
            current.endedAt = session.endedAt;
        }
    }
    if (current) streaks.push(current);
    return streaks.sort((a, b) => b.count - a.count || b.endedAt.localeCompare(a.endedAt)).slice(0, 5);
}

function summarizeBehaviorWindow(sessions) {
    const familyCounts = new Map();
    const modeCounts = new Map();
    for (const session of sessions || []) {
        familyCounts.set(session.family, (familyCounts.get(session.family) || 0) + 1);
        modeCounts.set(session.mode, (modeCounts.get(session.mode) || 0) + 1);
    }
    const total = sessions?.length || 0;
    const dominantFamily = [...familyCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'authoring';
    const appliedRate = total > 0 ? (modeCounts.get('applied') || 0) / total : 0;
    const exploratoryRate = total > 0 ? (modeCounts.get('exploratory') || 0) / total : 0;
    const mixedRate = total > 0 ? (modeCounts.get('mixed') || 0) / total : 0;
    return { total, dominantFamily, appliedRate, exploratoryRate, mixedRate };
}

function buildBehaviorEvolution(sessions) {
    const ordered = [...(sessions || [])].sort((a, b) => a.endedAt.localeCompare(b.endedAt));
    if (ordered.length < 2) {
        return {
            phaseShift: 'insufficient',
            summary: 'Not enough sessions yet to detect behavioral evolution.',
            early: summarizeBehaviorWindow(ordered),
            recent: summarizeBehaviorWindow(ordered)
        };
    }
    const split = Math.max(1, Math.floor(ordered.length / 2));
    const early = summarizeBehaviorWindow(ordered.slice(0, split));
    const recent = summarizeBehaviorWindow(ordered.slice(split));
    const appliedDelta = recent.appliedRate - early.appliedRate;
    const exploratoryDelta = recent.exploratoryRate - early.exploratoryRate;
    let phaseShift = 'steady';
    let summary = 'Recent session behavior is broadly steady.';
    if (appliedDelta >= 0.25 && recent.appliedRate >= early.appliedRate) {
        phaseShift = 'execution';
        summary = 'Session behavior is shifting toward execution; more recent work is being applied, not just explored.';
    } else if (exploratoryDelta >= 0.25 && recent.exploratoryRate > early.exploratoryRate) {
        phaseShift = 'exploration';
        summary = 'Recent sessions are skewing more exploratory than earlier ones, which suggests the vault is being surveyed before the next structural pass.';
    } else if (early.dominantFamily !== recent.dominantFamily) {
        phaseShift = 'lane-shift';
        summary = `Behavior changed lanes from ${early.dominantFamily} to ${recent.dominantFamily}.`;
    }
    return {
        phaseShift,
        summary,
        appliedDelta: Number(appliedDelta.toFixed(2)),
        exploratoryDelta: Number(exploratoryDelta.toFixed(2)),
        early,
        recent
    };
}

function buildSessionNarrative(events, fieldsCache) {
    const sorted = [...(events || [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (!sorted.length) return null;

    const typeCounts = new Map();
    const noteIds = new Set();
    for (const event of sorted) {
        if (event?.type) typeCounts.set(event.type, (typeCounts.get(event.type) || 0) + 1);
        if (event?.noteId) noteIds.add(String(event.noteId));
    }

    const primaryType = pickPrimaryType(typeCounts);
    const primaryCount = typeCounts.get(primaryType) || 0;
    const secondaryTypes = [...typeCounts.entries()]
        .filter(([type]) => type !== primaryType)
        .sort((a, b) => inferEventWeight(b[0]) - inferEventWeight(a[0]) || b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 2);

    const primaryNoteId = pickPrimaryNoteId(sorted);
    const primaryFields = fieldsCache?.get(primaryNoteId) || {};
    const primaryLabel = String(primaryFields.name || primaryFields.title || primaryNoteId || '').trim();
    const primaryTypeName = String(primaryFields.type || '').trim();
    const family = inferSessionFamily(sorted);
    const outcome = inferSessionOutcome(sorted);
    const focusFields = collectFocusFields(sorted);
    const impactedTargets = collectImpactedTargets(sorted);
    const sessionReason = inferSessionReason(sorted);
    const causalChain = buildCausalChain(sorted);
    const mode = inferSessionMode(sorted);
    const secondaryClause = secondaryTypes.length
        ? ` with ${secondaryTypes.map(([type, count]) => describeEventType(type, count)).join(' and ')}`
        : '';
    const noteClause = noteIds.size > 1 ? ` across ${noteIds.size} notes` : '';
    const summary = primaryLabel
        ? `${describeEventType(primaryType, primaryCount)} on ${primaryLabel}${secondaryClause}${noteClause}`
        : `${describeEventType(primaryType, primaryCount)}${secondaryClause}${noteClause}`;
    const familyStrength = inferFamilyStrength(family, sorted, noteIds.size);

    return {
        sessionId: String(sorted[0].sessionId || ''),
        summary,
        primaryType,
        primaryCount,
        primaryNoteId,
        primaryLabel,
        primaryTypeName,
        startedAt: sorted[0].timestamp,
        endedAt: sorted[sorted.length - 1].timestamp,
        count: sorted.length,
        noteCount: noteIds.size,
        family,
        familyLabel: familyLabel(family),
        familyStrength,
        outcome,
        outcomeLabel: outcomeLabel(outcome),
        focusFields,
        impactedTargets,
        sessionReason,
        mode,
        causalChain,
        causalSummary: formatCausalChain(causalChain),
        topTypes: [...typeCounts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 3)
            .map(([type]) => type),
        relativeTime: relTime(sorted[sorted.length - 1].timestamp)
    };
}

function buildSessionNarratives(events, fieldsCache, options = {}) {
    const { limit = 6, requireSessionId = true } = options;
    const buckets = new Map();

    for (const event of events || []) {
        const sessionId = String(event?.sessionId || '').trim();
        if (requireSessionId && !sessionId) continue;
        const key = sessionId || `${event.noteId || 'unknown'}::${event.timestamp || ''}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(event);
    }

    return [...buckets.values()]
        .map((sessionEvents) => buildSessionNarrative(sessionEvents, fieldsCache))
        .filter(Boolean)
        .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
        .slice(0, limit);
}

module.exports = {
    buildSessionNarrative,
    buildSessionNarratives,
    describeEventType,
    buildCausalChain,
    formatCausalChain,
    buildFamilyStreaks,
    buildBehaviorEvolution,
    familyLabel,
    outcomeLabel,
    esc,
    relTime
};
