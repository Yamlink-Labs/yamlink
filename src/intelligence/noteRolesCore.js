'use strict';

const { normalizeFieldName } = require('./fieldRolesCore');

const DEFAULT_NOTE_ROLE_PRIORS = {
    person: ['person', 'contact', 'lead', 'prospect', 'customer', 'character', 'author', 'member', 'employee', 'user'],
    container: ['account', 'company', 'client', 'partner', 'organization', 'org', 'team', 'unit', 'group', 'department'],
    event: ['meeting', 'call', 'appointment', 'session', 'scene', 'mission', 'event'],
    artifact: ['product', 'component', 'feature', 'repo', 'repository', 'service', 'machine', 'device', 'document'],
    concept: ['concept', 'topic', 'idea', 'theme', 'technology', 'capability', 'knowledge'],
    project: ['project', 'initiative', 'epic', 'milestone', 'sprint'],
    place: ['location', 'place', 'region', 'site'],
    record: ['note', 'entry', 'source', 'memo', 'log']
};

function inferNoteRole(nodeFields = {}, options = {}) {
    const priors = options.noteRolePriors || DEFAULT_NOTE_ROLE_PRIORS;
    const type = normalizeFieldName(nodeFields.type || '');
    const reasons = [];

    if (type) {
        for (const [role, names] of Object.entries(priors)) {
            if (names.includes(type)) {
                return {
                    noteRole: role,
                    confidence: 0.92,
                    reasons: [`note type "${type}" strongly matches the ${role} role`]
                };
            }
        }
    }

    const fieldRoleResults = Array.isArray(options.fieldRoleResults) ? options.fieldRoleResults : [];
    const counts = new Map();
    for (const result of fieldRoleResults) {
        if (!result?.semanticRole) continue;
        counts.set(result.semanticRole, (counts.get(result.semanticRole) || 0) + 1);
    }

    if ((counts.get('person') || 0) >= 1) {
        reasons.push('note has person-like structured fields');
    }
    if ((counts.get('container') || 0) >= 1) {
        reasons.push('note has container-like structured fields');
    }
    if ((counts.get('topic') || 0) >= 1) {
        reasons.push('note has concept/topic-like structured fields');
    }
    if ((counts.get('date') || 0) >= 1) {
        reasons.push('note has date-like structured fields');
    }

    if ((counts.get('date') || 0) >= 1 && ((counts.get('person') || 0) >= 1 || (counts.get('container') || 0) >= 1)) {
        return {
            noteRole: 'event',
            confidence: 0.7,
            reasons: [...reasons, 'date plus relational context makes this read like an event note']
        };
    }

    if ((counts.get('container') || 0) >= 1 && (counts.get('person') || 0) >= 1) {
        return {
            noteRole: 'container',
            confidence: 0.66,
            reasons: [...reasons, 'container and people relationships suggest an account/group style note']
        };
    }

    if ((counts.get('topic') || 0) >= 1) {
        return {
            noteRole: 'concept',
            confidence: 0.62,
            reasons: [...reasons, 'topic-like fields dominate the note structure']
        };
    }

    return {
        noteRole: type || 'record',
        confidence: type ? 0.52 : 0.4,
        reasons: type ? [`using note type "${type}" as a low-confidence role hint`] : ['not enough structure yet to infer a stronger note role']
    };
}

module.exports = {
    DEFAULT_NOTE_ROLE_PRIORS,
    inferNoteRole
};
