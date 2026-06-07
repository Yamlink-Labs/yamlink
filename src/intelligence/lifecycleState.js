'use strict';

const fs = require('fs');
const { inferLikelyTypesForNote, getCommonFieldsForType } = require('./vaultPriors');

/**
 * @typedef {{
 *   state: string,
 *   label: string,
 *   isStale: boolean,
 *   reasons: string[],
 *   likelyType: string|null,
 *   metrics: Record<string, any>
 * }} LifecycleResult
 */

const SYSTEM_FIELDS = new Set(['id', 'type', 'created', 'updated', 'modified', 'indexed', '__yamlink_tags']);
const DATE_FIELDS = ['updated', 'modified', 'indexed', 'created', 'date', 'due', 'deadline', 'followup'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function _norm(s) {
    return String(s || '').trim().toLowerCase();
}

function _hasValue(rawValue) {
    if (Array.isArray(rawValue)) return rawValue.some((value) => String(value || '').trim());
    return String(rawValue || '').trim().length > 0;
}

function _extractRelationTargets(rawValue) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const targets = [];
    for (const value of values) {
        const text = String(value || '');
        for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
            const rawTarget = String(match[1] || '').trim().split('|')[0].trim().split('#')[0].trim().split('^')[0].trim();
            if (rawTarget) targets.push(_norm(rawTarget));
        }
    }
    return targets;
}

function _dateValueToMs(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const isoLike = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoLike.test(text)) return null;
    const ms = Date.parse(`${text}T00:00:00.000Z`);
    return Number.isFinite(ms) ? ms : null;
}

function _getFileMtimeMs(idIndex, noteId) {
    const filePath = idIndex?.get(noteId);
    if (!filePath) return null;
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch (_) {
        return null;
    }
}

function _collectLifecycleDates(noteFields) {
    const entries = [];
    for (const fieldName of DATE_FIELDS) {
        const ms = _dateValueToMs(noteFields?.[fieldName]);
        if (ms !== null) entries.push({ field: fieldName, ms });
    }
    return entries;
}

/**
 * @param {string} noteId
 * @param {Record<string, any>} noteFields
 * @param {{ nowMs?: number, mtimeMs?: number, lastMutationMs?: number, fieldsCache?: Map<string, any>, idIndex?: Map<string, string>, typeFieldBundles?: Map<string, any>, noteRoleTypePriors?: Map<string, any>, fieldTargetTypes?: Map<string, any>, noteRole?: Record<string, any>|null, inboundCount?: number, avgInbound?: number, noteType?: string }} [options]
 * @returns {LifecycleResult}
 */
function inferLifecycleState(noteId, noteFields, options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const fieldsCache = options.fieldsCache || new Map();
    const idIndex = options.idIndex || new Map();
    const typeFieldBundles = options.typeFieldBundles || new Map();
    const noteRoleTypePriors = options.noteRoleTypePriors || new Map();
    const noteRole = options.noteRole || null;
    const inboundCount = Number.isFinite(options.inboundCount) ? options.inboundCount : 0;
    const avgInbound = Number.isFinite(options.avgInbound) ? options.avgInbound : 0;
    const explicitType = _norm(options.noteType || noteFields?.type);

    const nonEmptyFields = Object.entries(noteFields || {})
        .filter(([fieldName, rawValue]) => {
            const fn = _norm(fieldName);
            return fn && !SYSTEM_FIELDS.has(fn) && _hasValue(rawValue);
        })
        .map(([fieldName]) => _norm(fieldName));

    const relationFields = nonEmptyFields.filter((fieldName) => _extractRelationTargets(noteFields[fieldName]).length > 0);

    const inferredTypes = !explicitType
        ? inferLikelyTypesForNote(noteFields, fieldsCache, typeFieldBundles, noteRoleTypePriors, noteRole, { limit: 1, minScore: 0.45 })
        : [];
    const likelyType = explicitType || inferredTypes[0]?.noteType || '';

    const commonFields = likelyType
        ? getCommonFieldsForType(likelyType, typeFieldBundles, fieldsCache, { limit: 12, minRatio: 0.35 })
        : [];
    const commonFieldNames = commonFields.map((entry) => entry.field);
    const matchedFields = nonEmptyFields.filter((fieldName) => commonFieldNames.includes(fieldName));
    const bundleMatchRatio = commonFieldNames.length > 0
        ? matchedFields.length / commonFieldNames.length
        : 0;
    const currentFieldCoverage = nonEmptyFields.length > 0
        ? matchedFields.length / nonEmptyFields.length
        : 0;

    const fileMtimeMs = Number.isFinite(options.mtimeMs) ? options.mtimeMs : _getFileMtimeMs(idIndex, noteId);
    const lastMutationMs = Number.isFinite(options.lastMutationMs) ? options.lastMutationMs : null;
    const lifecycleDates = _collectLifecycleDates(noteFields);
    const mostRecentStructuredMs = lifecycleDates
        .filter((entry) => ['updated', 'modified', 'indexed', 'created'].includes(entry.field))
        .reduce((best, entry) => Math.max(best, entry.ms), 0) || null;
    const lastTouchedMs = Math.max(fileMtimeMs || 0, mostRecentStructuredMs || 0, lastMutationMs || 0) || null;
    const lastTouchedDays = lastTouchedMs ? Math.floor((nowMs - lastTouchedMs) / MS_PER_DAY) : null;

    const pastScheduleDates = lifecycleDates
        .filter((entry) => ['date', 'due', 'deadline', 'followup'].includes(entry.field) && entry.ms < nowMs)
        .sort((a, b) => a.ms - b.ms);
    const mostPastSchedule = pastScheduleDates[0] || null;
    const pastScheduleDays = mostPastSchedule ? Math.floor((nowMs - mostPastSchedule.ms) / MS_PER_DAY) : null;

    const hubThreshold = Math.max(3, Math.ceil(avgInbound + 1));
    const staleByMtime = lastTouchedDays !== null && lastTouchedDays >= 45;
    const staleBySchedule = pastScheduleDays !== null && pastScheduleDays >= 30 && (lastTouchedDays === null || lastTouchedDays >= 14);
    const isStale = staleByMtime || staleBySchedule;

    let state = 'growing';
    const reasons = [];

    if (inboundCount >= hubThreshold) {
        state = 'hub';
        reasons.push(`${inboundCount} inbound link${inboundCount === 1 ? '' : 's'} exceeds hub threshold ${hubThreshold}`);
        if (isStale) {
            if (staleByMtime) reasons.push(`last touched ${lastTouchedDays} day${lastTouchedDays === 1 ? '' : 's'} ago`);
            if (staleBySchedule && mostPastSchedule) reasons.push(`${mostPastSchedule.field} is ${pastScheduleDays} day${pastScheduleDays === 1 ? '' : 's'} in the past`);
        }
    } else if (isStale) {
        state = 'stale';
        if (staleByMtime) reasons.push(`last touched ${lastTouchedDays} day${lastTouchedDays === 1 ? '' : 's'} ago`);
        if (staleBySchedule && mostPastSchedule) reasons.push(`${mostPastSchedule.field} is ${pastScheduleDays} day${pastScheduleDays === 1 ? '' : 's'} in the past`);
    } else if (commonFieldNames.length > 0 && bundleMatchRatio >= 0.74 && currentFieldCoverage >= 0.55) {
        state = 'consolidated';
        reasons.push(`matches ${matchedFields.length}/${commonFieldNames.length} common ${likelyType} fields`);
    } else if ((nonEmptyFields.length <= 1 && relationFields.length === 0) || (nonEmptyFields.length <= 2 && relationFields.length === 0 && bundleMatchRatio < 0.35)) {
        state = 'draft';
        reasons.push(`only ${nonEmptyFields.length} non-empty field${nonEmptyFields.length === 1 ? '' : 's'} and no relation structure yet`);
    } else {
        state = 'growing';
        if (commonFieldNames.length > 0) reasons.push(`partial bundle match ${matchedFields.length}/${commonFieldNames.length} for ${likelyType}`);
        else reasons.push('structure is emerging but bundle evidence is still partial');
    }

    if (!reasons.length && likelyType) reasons.push(`closest learned note family is ${likelyType}`);

    return {
        state,
        label: state.charAt(0).toUpperCase() + state.slice(1),
        isStale,
        reasons,
        likelyType: likelyType || null,
        metrics: {
            nonEmptyFieldCount: nonEmptyFields.length,
            relationFieldCount: relationFields.length,
            inboundCount,
            avgInbound,
            hubThreshold,
            bundleFieldCount: commonFieldNames.length,
            matchedBundleFieldCount: matchedFields.length,
            bundleMatchRatio,
            currentFieldCoverage,
            lastTouchedDays,
            pastScheduleDays
        }
    };
}

/**
 * @param {LifecycleResult|null} lifecycle
 * @returns {string}
 */
function summarizeLifecycleState(lifecycle) {
    if (!lifecycle) return '';
    const summary = lifecycle.reasons && lifecycle.reasons.length
        ? lifecycle.reasons[0]
        : '';
    return summary ? `${lifecycle.label} — ${summary}` : lifecycle.label;
}

module.exports = {
    inferLifecycleState,
    summarizeLifecycleState
};
