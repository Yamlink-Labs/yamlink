'use strict';

const { normalizeFieldName } = require('./fieldRolesCore');

const DEFAULT_NOTE_ROLE_PRIORS = {
    person: ['person', 'contact', 'lead', 'prospect', 'customer', 'character', 'author', 'member', 'employee', 'user', 'stakeholder'],
    container: ['account', 'company', 'client', 'partner', 'organization', 'org', 'team', 'unit', 'group', 'department', 'workspace'],
    event: ['meeting', 'call', 'appointment', 'session', 'scene', 'mission', 'event', 'interview'],
    artifact: ['product', 'component', 'feature', 'repo', 'repository', 'service', 'machine', 'device', 'document', 'spec'],
    concept: ['concept', 'topic', 'idea', 'theme', 'technology', 'capability', 'knowledge'],
    project: ['project', 'initiative', 'epic', 'milestone', 'sprint', 'roadmap', 'release'],
    task: ['task', 'todo', 'issue', 'bug', 'ticket', 'work-item', 'action-item'],
    place: ['location', 'place', 'region', 'site'],
    record: ['note', 'entry', 'source', 'memo', 'log', 'dashboard', 'planner', 'lab', 'hub', 'index', 'overview', 'home']
};

const NOTE_ROLE_FIELD_HINTS = {
    person: ['email', 'phone', 'account', 'owner', 'city', 'contact', 'contacts', 'manager'],
    container: ['contacts', 'industry', 'website', 'domain', 'stage', 'account', 'accounts', 'client', 'partner', 'location'],
    event: ['date', 'participants', 'purpose', 'agenda', 'location', 'account', 'contacts', 'contact'],
    artifact: ['product', 'products', 'component', 'components', 'feature', 'repo', 'repository', 'machine', 'device', 'concept', 'concepts'],
    concept: ['concept', 'concepts', 'theme', 'technology', 'summary', 'related', 'products', 'topics'],
    project: ['milestone', 'sprint', 'repo', 'repository', 'owner', 'status', 'deadline'],
    task: ['status', 'owner', 'assignee', 'priority', 'date', 'due', 'deadline', 'project', 'repo', 'reporter'],
    place: ['region', 'site', 'location', 'address', 'country'],
    record: ['summary', 'notes', 'source', 'references']
};

const NOTE_ROLE_DISPLAY = {
    person: 'person',
    container: 'group',
    event: 'event',
    artifact: 'artifact',
    concept: 'concept',
    project: 'project',
    task: 'work item',
    place: 'place',
    record: 'note'
};

function emptyRoleWeights() {
    return {
        person: 0,
        container: 0,
        event: 0,
        artifact: 0,
        concept: 0,
        project: 0,
        task: 0,
        place: 0,
        record: 0
    };
}

function addRoleSignal(signals, weights, role, weight, reason) {
    if (!role || weight <= 0 || !reason) return;
    const signal = { role, weight, reason };
    signals.push(signal);
    weights[role] = (weights[role] || 0) + weight;
}

function collectRoleMatches(candidates = [], priors = {}) {
    const matches = new Map();
    for (const candidate of candidates) {
        const normalized = normalizeFieldName(candidate || '');
        if (!normalized) continue;
        const variants = [normalized, ...normalized.split('-').filter(Boolean)];
        for (const [role, names] of Object.entries(priors)) {
            if (variants.some((variant) => names.includes(variant))) {
                matches.set(role, (matches.get(role) || 0) + 1);
            }
        }
    }
    return matches;
}

function pickSpecificRoleLabel(nodeFields = {}, broadRole, titleHints = []) {
    const type = normalizeFieldName(nodeFields.type || '');
    const candidates = [
        type,
        ...titleHints.map((hint) => normalizeFieldName(hint || '')),
        ...Object.keys(nodeFields || {}).map((key) => normalizeFieldName(key || ''))
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (!candidate) continue;
        if (candidate === 'note' || candidate === 'entry' || candidate === 'record') continue;
        const parts = candidate.split('-').filter(Boolean);
        const variants = [candidate, ...parts];
        if (broadRole && (DEFAULT_NOTE_ROLE_PRIORS[broadRole] || []).some((name) => variants.includes(name))) {
            return variants.find((name) => (DEFAULT_NOTE_ROLE_PRIORS[broadRole] || []).includes(name)) || candidate;
        }
    }

    if (broadRole === 'container') {
        if (nodeFields.contacts || nodeFields.account || nodeFields.accounts) return 'account';
        if (nodeFields.unit) return 'unit';
    }
    if (broadRole === 'task') {
        if (nodeFields.bug || String(nodeFields.title || '').toLowerCase().includes('bug')) return 'bug';
        if (nodeFields.issue || String(nodeFields.title || '').toLowerCase().includes('issue')) return 'issue';
        return 'work item';
    }
    if (broadRole === 'artifact') {
        if (nodeFields.repo || nodeFields.repository) return 'repo';
        if (nodeFields.component || nodeFields.components) return 'component';
        if (nodeFields.feature || nodeFields.features) return 'feature';
        return 'artifact';
    }

    return NOTE_ROLE_DISPLAY[broadRole] || broadRole || 'note';
}

function withHumanizedRole(result, nodeFields = {}, titleHints = []) {
    if (!result || !result.noteRole) return result;
    const roleLabel = pickSpecificRoleLabel(nodeFields, result.noteRole, titleHints);
    const secondaryRoles = Array.isArray(result.secondaryRoles)
        ? result.secondaryRoles.filter((role) => role && role !== result.noteRole)
        : [];
    const secondaryRoleLabels = secondaryRoles.map((role) => pickSpecificRoleLabel(nodeFields, role, titleHints));
    return {
        ...result,
        roleLabel,
        secondaryRoles,
        secondaryRoleLabels,
        displayLabel: `${roleLabel} note`,
        roleSummary: result.noteRole === 'record'
            ? 'general note'
            : `${roleLabel} note`,
        supportingSignals: result.supportingSignals || [],
        conflictingSignals: result.conflictingSignals || []
    };
}

function inferNoteRole(nodeFields = {}, options = {}) {
    const priors = options.noteRolePriors || DEFAULT_NOTE_ROLE_PRIORS;
    const type = normalizeFieldName(nodeFields.type || '');
    const signals = [];
    const weights = emptyRoleWeights();
    const genericTypeHints = new Set(DEFAULT_NOTE_ROLE_PRIORS.record || []);
    const titleHints = Array.isArray(options.titleHints) ? options.titleHints : [];
    const fieldRoleResults = Array.isArray(options.fieldRoleResults) ? options.fieldRoleResults : [];

    function finalize(result) {
        return withHumanizedRole(result, nodeFields, titleHints);
    }

    if (type) {
        for (const [role, names] of Object.entries(priors)) {
            if (names.includes(type)) {
                if (role === 'record' && genericTypeHints.has(type)) {
                    break;
                }
                return finalize({
                    noteRole: role,
                    confidence: 0.92,
                    reasons: [`note type "${type}" strongly matches the ${role} role`],
                    supportingSignals: [`note type "${type}" strongly matches the ${role} role`],
                    conflictingSignals: []
                });
            }
        }
    }

    const fieldNames = Object.keys(nodeFields)
        .filter((key) => key !== 'id' && key !== 'type')
        .map((key) => normalizeFieldName(key));
    // Metadata timestamp fields (created, updated, modified, etc.) tell us when a note was
    // last touched — not that the note IS an event. Excluding them from the date-role count
    // prevents notes with only a `created:` field from being misclassified as events.
    const METADATA_DATE_FIELDS = new Set([
        'created', 'updated', 'modified', 'indexed',
        'last-modified', 'last-updated', 'last-edited'
    ]);
    const counts = new Map();
    for (const result of fieldRoleResults) {
        if (!result?.semanticRole) continue;
        if (result.semanticRole === 'date' && METADATA_DATE_FIELDS.has(result.fieldName)) continue;
        counts.set(result.semanticRole, (counts.get(result.semanticRole) || 0) + 1);
    }

    const titleMatches = collectRoleMatches(titleHints, priors);
    const fieldMatches = collectRoleMatches(fieldNames, NOTE_ROLE_FIELD_HINTS);
    const projectFieldMatches = fieldNames.filter((field) => [
        'project',
        'projects',
        'repo',
        'repository',
        'milestone',
        'sprint',
        'roadmap',
        'release'
    ].includes(field));

    for (const [role, count] of titleMatches.entries()) {
        addRoleSignal(
            signals,
            weights,
            role,
            1 + (count * 0.4),
            count >= 2
                ? `title or file context strongly hints at the ${role} role`
                : `title or file context hints at the ${role} role`
        );
    }
    for (const [role, count] of fieldMatches.entries()) {
        addRoleSignal(
            signals,
            weights,
            role,
            0.9 + (count * 0.35),
            count >= 2
                ? `multiple structured fields resemble the ${role} role`
                : `structured fields resemble the ${role} role`
        );
    }
    if (projectFieldMatches.length) {
        addRoleSignal(
            signals,
            weights,
            'project',
            0.95 + (projectFieldMatches.length * 0.3),
            projectFieldMatches.length >= 2
                ? 'multiple project-oriented fields suggest a project context'
                : 'a project-oriented field suggests project context'
        );
    }

    if ((counts.get('date') || 0) >= 1 && ((counts.get('person') || 0) >= 1 || (counts.get('container') || 0) >= 1)) {
        addRoleSignal(signals, weights, 'event', 1.8, 'date plus relational context makes this read like an event note');
    }

    if ((counts.get('status') || 0) >= 1 && ((counts.get('date') || 0) >= 1 || (counts.get('container') || 0) >= 1)) {
        addRoleSignal(signals, weights, 'task', 1.9, 'status plus scheduling or container context makes this read like a task/work-item note');
    }

    if ((counts.get('container') || 0) >= 1 && (counts.get('person') || 0) >= 1) {
        addRoleSignal(signals, weights, 'container', 1.45, 'container and people relationships suggest an account/group style note');
    }

    if ((counts.get('container') || 0) >= 1 && (counts.get('topic') || 0) >= 1) {
        addRoleSignal(signals, weights, 'project', 1.4, 'container plus artifact/topic context makes this read like a project or delivery note');
    }

    if ((counts.get('topic') || 0) >= 1) {
        addRoleSignal(signals, weights, 'concept', 1.2, 'topic-like fields dominate the note structure');
    }

    if ((counts.get('person') || 0) >= 1) {
        addRoleSignal(signals, weights, 'person', 0.9 + ((counts.get('person') || 0) * 0.2), 'note has person-like structured fields');
    }
    if ((counts.get('container') || 0) >= 1) {
        addRoleSignal(signals, weights, 'container', 0.8 + ((counts.get('container') || 0) * 0.2), 'note has container-like structured fields');
    }
    if ((counts.get('topic') || 0) >= 1) {
        addRoleSignal(signals, weights, 'concept', 0.85 + ((counts.get('topic') || 0) * 0.2), 'note has concept/topic-like structured fields');
    }
    if ((counts.get('date') || 0) >= 1) {
        addRoleSignal(signals, weights, 'event', 0.75 + ((counts.get('date') || 0) * 0.2), 'note has date-like structured fields');
    }

    const ranked = Object.entries(weights)
        .filter(([, weight]) => weight > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    if (!ranked.length) {
        return finalize({
            noteRole: type || 'record',
            confidence: type ? 0.44 : 0.26,
            reasons: type ? [`using note type "${type}" as a low-confidence role hint`] : ['not enough structure yet to infer a stronger note role'],
            supportingSignals: type ? [`using note type "${type}" as a low-confidence role hint`] : ['not enough structure yet to infer a stronger note role'],
            conflictingSignals: []
        });
    }

    const [topRole, topWeight] = ranked[0];
    const secondWeight = ranked[1]?.[1] ?? 0;
    const totalWeight = ranked.reduce((sum, [, weight]) => sum + weight, 0);
    const confidence = Math.max(0.28, Math.min(0.94, 0.34 + ((topWeight - secondWeight) / Math.max(1, totalWeight))));
    const secondaryRoles = ranked
        .slice(1)
        .filter(([, weight]) => weight >= 0.95 && weight >= (topWeight * 0.34))
        .slice(0, 2)
        .map(([role]) => role);
    const supportingSignals = signals
        .filter((signal) => signal.role === topRole)
        .sort((a, b) => b.weight - a.weight)
        .map((signal) => signal.reason);
    const conflictingSignals = signals
        .filter((signal) => signal.role !== topRole && !secondaryRoles.includes(signal.role))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3)
        .map((signal) => `${signal.role}: ${signal.reason}`);
    const secondarySignals = signals
        .filter((signal) => secondaryRoles.includes(signal.role))
        .sort((a, b) => b.weight - a.weight)
        .map((signal) => `${signal.role}: ${signal.reason}`);

    return finalize({
        noteRole: topRole,
        secondaryRoles,
        confidence,
        reasons: supportingSignals.slice(0, 4),
        supportingSignals,
        secondarySignals,
        conflictingSignals
    });
}

function summarizeNoteRoleReasons(result, max = 2) {
    if (!result || !Array.isArray(result.reasons)) return '';
    return result.reasons
        .filter(Boolean)
        .slice(0, max)
        .join('; ');
}

function summarizeNoteRole(result) {
    if (!result || !result.noteRole) return 'note';
    return result.roleSummary || `${result.roleLabel || result.noteRole} note`;
}

module.exports = {
    DEFAULT_NOTE_ROLE_PRIORS,
    NOTE_ROLE_FIELD_HINTS,
    NOTE_ROLE_DISPLAY,
    inferNoteRole,
    summarizeNoteRoleReasons,
    summarizeNoteRole
};
