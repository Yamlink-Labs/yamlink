'use strict';

const vscode = require('vscode');
const { parseAllViewQueries } = require('../engine/query');
const { parseFrontmatter, getFieldsCache, getPathIndex, getVaultGeneration } = require('../core/indexService');
const { getPrimaryWorkspaceRoot } = require('../core/workspace');
const { getTemplateForType } = require('../core/templateRegistry');
const { extractBodyMentionedIds } = require('../intelligence/frontmatterBodyHints');
const { inferNoteRole } = require('../intelligence/noteRolesCore');
const {
    buildFrontmatterGuidanceSummary,
    buildBodyMentionHints
} = require('../intelligence/frontmatterIntelligence');
const { buildActivationContext } = require('../engine/suggestions');
const { getCachedContext } = require('../intelligence/activationCache');
const { planFieldActions, LEVEL } = require('../intelligence/fieldPlanner');
const { getSchema } = require('../registries/schemaRegistry');
const { getTypes } = require('../registries/typeRegistry');
const { getCachedPriors, inferLikelyTypesForNote, getCommonFieldsForType } = require('../intelligence/vaultPriors');
const {
    classifyCurrentField,
    getFrontmatterRange,
    parseFrontmatterLine,
    strictSurfaceItems,
    formatFieldPrompt,
    formatFieldListPrompt,
    formatLinkPrompt,
    getFieldTargetTypesFromSchema,
    buildFieldValueRange,
    getFieldValueReplacement
} = require('./lightbulbUtils');
const {
    resolveFrontmatterRelationCandidates,
    rankScalarValues,
    rankCandidateIds,
    buildRelationCandidateDetail
} = require('./completionHelpers');

function focusFirstEmptyFrontmatterField(editor, document) {
    if (!editor || !document) return false;
    const lines = document.getText().split('\n');
    let inFm = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i === 0 && line.trim() === '---') { inFm = true; continue; }
        if (inFm && line.trim() === '---') break;
        if (!inFm) break;
        const relMatch = line.match(/^(\s*[\w-]+:\s*)\[\[\]\]/);
        if (relMatch) {
            const col = relMatch[1].length + 2;
            const pos = new vscode.Position(i, col);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos));
            return true;
        }
        const emptyMatch = line.match(/^(\s*[\w-]+:)\s*$/);
        if (emptyMatch) {
            const col = emptyMatch[1].length + 1;
            const pos = new vscode.Position(i, col);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos));
            return true;
        }
    }
    return false;
}

function buildLikelyShapeActions(document, lineIndex = null, options = {}) {
    const frontmatter = parseFrontmatter(document.getText());
    if (!frontmatter) return [];
    const fieldsCache = getFieldsCache();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const noteRole = inferNoteRole(frontmatter || {}, {
        typeRoleMap: priors.typeRoleMap || null,
        noteRolePriors: priors.noteRoleNamePriors || null,
        noteRoleFieldHints: priors.noteRoleFieldHints || null
    });
    const shape = inferLikelyTypesForNote(
        frontmatter,
        fieldsCache,
        priors.typeFieldBundles,
        priors.noteRoleTypePriors,
        noteRole,
        { limit: 3, minScore: options.minScore || 0.46 }
    );
    if (!shape.length) return [];

    const explicitType = String(frontmatter.type || '').trim().toLowerCase();
    const currentFields = new Set(
        Object.entries(frontmatter || {})
            .filter(([fieldName, rawValue]) => {
                const normalized = String(fieldName || '').trim().toLowerCase();
                if (!normalized || normalized === 'id' || normalized === 'type') return false;
                if (Array.isArray(rawValue)) return rawValue.some((value) => String(value || '').trim());
                return String(rawValue || '').trim().length > 0;
            })
            .map(([fieldName]) => String(fieldName || '').trim().toLowerCase())
    );

    const topCandidate = shape[0];
    const inferredType = String(topCandidate.noteType || '').trim().toLowerCase();
    const inferredSchema = inferredType ? getSchema(inferredType) : null;
    const commonBundle = inferredType
        ? getCommonFieldsForType(inferredType, priors.typeFieldBundles, fieldsCache, { limit: 6, minRatio: 0.34 })
        : [];
    const likelyMissingFields = commonBundle.filter((entry) => !currentFields.has(String(entry.field || '').trim().toLowerCase()));

    const actions = [];
    const pushIf = (action) => {
        if (!action) return;
        if (actions.some((existing) => existing.title === action.title)) return;
        actions.push(action);
    };

    let typeLineIndex = typeof lineIndex === 'number' ? lineIndex : null;
    if (typeLineIndex == null && !explicitType) {
        const lines = document.getText().split('\n');
        const fmRange = getFrontmatterRange(document);
        if (fmRange) {
            for (let i = fmRange.openLine + 1; i < fmRange.closeLine; i++) {
                const parsed = parseFrontmatterLine(lines[i]);
                if (parsed?.fieldName === 'type' && !parsed.value) {
                    typeLineIndex = i;
                    break;
                }
            }
        }
    }

    if (!explicitType || explicitType !== inferredType) {
        const action = new vscode.CodeAction(
            `Set type to ${inferredType}?`,
            vscode.CodeActionKind.QuickFix
        );
        const edit = new vscode.WorkspaceEdit();
        let canWriteType = false;
        if (typeof typeLineIndex === 'number') {
            const prepared = getFieldValueReplacement(document, typeLineIndex, 'type', inferredType);
            if (prepared) {
                edit.replace(document.uri, prepared.range, prepared.text);
                canWriteType = true;
            }
        } else {
            const fmRange = getFrontmatterRange(document);
            if (fmRange) {
                edit.insert(document.uri, new vscode.Position(fmRange.closeLine, 0), `type: ${inferredType}\n`);
                canWriteType = true;
            }
        }
        if (canWriteType) {
            action.edit = edit;
            action.isPreferred = true;
            action.diagnostics = /** @type {any} */ (topCandidate.reasons);
            pushIf(action);
        }
    }

    if (likelyMissingFields.length) {
        const fmRange = getFrontmatterRange(document);
        if (fmRange) {
            const insertPosition = new vscode.Position(fmRange.closeLine, 0);
            const insertText = likelyMissingFields
                .slice(0, 4)
                .map(({ field }) => {
                    const normalizedField = String(field || '').trim().toLowerCase();
                    const schemaField = inferredSchema?.fields
                        ? inferredSchema.fields[normalizedField] || inferredSchema.fields[normalizedField.replace(/-/g, '_')] || null
                        : null;
                    const relationField = String(schemaField?.type || '').trim().toLowerCase() === 'relation';
                    return `${normalizedField}:${relationField ? ' [[' : ''}\n`;
                })
                .join('');
            if (insertText) {
                const bundleAction = new vscode.CodeAction(
                    `Add the usual ${inferredType} fields?`,
                    vscode.CodeActionKind.QuickFix
                );
                const bundleEdit = new vscode.WorkspaceEdit();
                bundleEdit.insert(document.uri, insertPosition, insertText);
                bundleAction.edit = bundleEdit;
                bundleAction.isPreferred = actions.length === 0;
                bundleAction.diagnostics = /** @type {any} */ ([
                    `${topCandidate.matchedFields.length}/${currentFields.size || 1} current fields commonly appear on ${inferredType} notes`
                ]);
                pushIf(bundleAction);
            }
        }
    }

    return actions;
}

function buildTypeInferenceActions(document, lineIndex) {
    const inferredActions = buildLikelyShapeActions(document, lineIndex, { minScore: 0.46 });
    if (inferredActions.length) return inferredActions;

    const frontmatter = parseFrontmatter(document.getText());
    if (!frontmatter) return [];
    const fieldsCache = getFieldsCache();
    const typeCounts = new Map();
    for (const fields of fieldsCache.values()) {
        const noteType = String(fields?.type || '').trim().toLowerCase();
        if (!noteType) continue;
        typeCounts.set(noteType, (typeCounts.get(noteType) || 0) + 1);
    }
    const rankedTypes = [...getTypes()]
        .map((type) => String(type || '').trim().toLowerCase())
        .filter(Boolean)
        .sort((a, b) => (typeCounts.get(b) || 0) - (typeCounts.get(a) || 0) || a.localeCompare(b))
        .slice(0, 3);

    const actions = [];
    const pushIf = (action) => {
        if (!action) return;
        if (actions.some((existing) => existing.title === action.title)) return;
        actions.push(action);
    };
    for (const typeName of rankedTypes) {
        const action = new vscode.CodeAction(
            `Set type to ${typeName}?`,
            vscode.CodeActionKind.QuickFix
        );
        const edit = new vscode.WorkspaceEdit();
        const prepared = getFieldValueReplacement(document, lineIndex, 'type', typeName);
        if (!prepared) continue;
        edit.replace(document.uri, prepared.range, prepared.text);
        action.edit = edit;
        action.isPreferred = actions.length === 0;
        action.command = {
            command: 'yamlink.focusFirstEmptyFrontmatterField',
            title: 'Focus first empty frontmatter field'
        };
        pushIf(action);
    }

    const chooseAction = new vscode.CodeAction(
        'Choose note type…',
        vscode.CodeActionKind.QuickFix
    );
    chooseAction.command = {
        command: 'yamlink.pickTypeForLine',
        title: 'Choose note type',
        arguments: [lineIndex]
    };
    chooseAction.isPreferred = actions.length === 0;
    pushIf(chooseAction);
    return actions;
}

function buildTypedEmptyFieldFallbackActions(document, lineIndex, fieldName, nodeType) {
    const normalizedField = String(fieldName || '').trim().toLowerCase();
    const normalizedType = String(nodeType || '').trim().toLowerCase();
    if (!normalizedField || !normalizedType) return [];

    const schema = getSchema(normalizedType);
    const schemaField = schema?.fields?.[normalizedField] || schema?.fields?.[normalizedField.replace(/-/g, '_')] || null;
    const fieldsCache = getFieldsCache();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const commonFields = getCommonFieldsForType(normalizedType, priors.typeFieldBundles, fieldsCache, { limit: 8, minRatio: 0.25 });
    const isExpectedField = Boolean(schemaField) || commonFields.some((entry) => String(entry.field || '').trim().toLowerCase() === normalizedField);
    if (!isExpectedField) return [];

    const isRelation = String(schemaField?.type || '').trim().toLowerCase() === 'relation';
    const lineText = document.lineAt(lineIndex).text;
    const cursorPos = new vscode.Position(lineIndex, lineText.length);
    const actions = [];

    if (isRelation) {
        const idIndex = getPathIndex();
        const relationState = resolveFrontmatterRelationCandidates(document, cursorPos, idIndex);
        if (relationState) {
            const ranked = rankCandidateIds(
                relationState.candidateIds,
                relationState.partial,
                relationState.preferredIds,
                relationState.localLinkedIds,
                relationState.observedIdScores,
                relationState.rankingHints
            ).slice(0, 2);
            for (const id of ranked) {
                const action = new vscode.CodeAction(
                    `Use ${id} for ${normalizedField}?`,
                    vscode.CodeActionKind.QuickFix
                );
                const edit = new vscode.WorkspaceEdit();
                const prepared = getFieldValueReplacement(document, lineIndex, normalizedField, `[[${id}]]`);
                if (!prepared) continue;
                edit.replace(document.uri, prepared.range, prepared.text);
                action.edit = edit;
                action.isPreferred = actions.length === 0;
                action.diagnostics = /** @type {any} */ ([buildRelationCandidateDetail(id, idIndex, relationState, relationState.preferredIds.includes(id))]);
                actions.push(action);
            }
        }
    } else {
        const rankedValues = rankScalarValues(normalizedField, normalizedType).slice(0, 3);
        for (const { value, count } of rankedValues) {
            const action = new vscode.CodeAction(
                `Use ${value} for ${normalizedField}?`,
                vscode.CodeActionKind.QuickFix
            );
            const edit = new vscode.WorkspaceEdit();
            const prepared = getFieldValueReplacement(document, lineIndex, normalizedField, value);
            if (!prepared) continue;
            edit.replace(document.uri, prepared.range, prepared.text);
            action.edit = edit;
            action.isPreferred = actions.length === 0;
            action.diagnostics = /** @type {any} */ ([`${count} ${normalizedType} note${count === 1 ? '' : 's'} already use this value`]);
            actions.push(action);
        }
    }

    if (actions.length) return actions;

    const fallbackAction = new vscode.CodeAction(
        isRelation ? `Suggest a link for ${normalizedField}?` : `Suggest a value for ${normalizedField}?`,
        vscode.CodeActionKind.QuickFix
    );
    fallbackAction.command = {
        command: 'editor.action.triggerSuggest',
        title: 'Trigger Suggest'
    };
    fallbackAction.isPreferred = true;
    return [fallbackAction];
}

/**
 * @param {import('vscode').TextDocument} document
 * @param {string|null} [activeField]
 * @param {object|null} [plan]
 * @returns {import('vscode').CodeAction[]}
 */
function buildAdaptiveFrontmatterActions(document, activeField = null, plan = null) {
    const fmRange = getFrontmatterRange(document);
    if (!fmRange) return [];

    const frontmatter = parseFrontmatter(document.getText());
    if (!frontmatter) return [];

    const nodeId     = String(frontmatter.id || '').trim();
    const nodeType   = String(frontmatter.type || '').trim().toLowerCase();
    const schema = nodeType ? getSchema(nodeType) : null;
    const fieldsCache = getFieldsCache();

    // Use activation cache only when the document is saved and the node is indexed —
    // dirty documents may have unsaved frontmatter changes not yet in fieldsCache.
    const nodeFields = fieldsCache.get(nodeId) || frontmatter;
    const { frontmatterOpportunities: opportunities } =
        (!document.isDirty && fieldsCache.has(nodeId))
            ? getCachedContext(nodeId, () => buildActivationContext(nodeId, nodeFields, nodeType, fieldsCache))
            : buildActivationContext(nodeId, nodeFields, nodeType, fieldsCache);
    const guidance = buildFrontmatterGuidanceSummary(opportunities);
    if (!opportunities.likelyFields.length && !opportunities.likelyConnections.length) return [];

    const normalizedActiveField = activeField ? String(activeField).trim().toLowerCase() : '';
    const isFieldScoped = Boolean(normalizedActiveField);
    const isTypeScoped = normalizedActiveField === 'type';
    const canShowNoteSetup = !isFieldScoped || isTypeScoped;
    // When a plan is supplied, use it to gate field-specific actions.
    // DOCUMENT level: document-level bundles and views only, no field quickfix.
    // QUICKFIX level (or no plan): field-specific actions allowed.
    const allowFieldQuickfix = !plan || (plan.allowedActions && plan.allowedActions.has('fieldQuickfix'));

    const actions = [];
    const seenTitles = new Set();
    const pushAction = (action) => {
        if (!action || !action.title) return;
        if (seenTitles.has(action.title)) return;
        seenTitles.add(action.title);
        actions.push(action);
    };
    const normalizedField = (value) => String(value || '').trim().toLowerCase();
    const activeFieldTargetTypes = isFieldScoped ? getFieldTargetTypesFromSchema(schema, normalizedActiveField) : [];
    const candidateIdsForTargetTypes = (targetTypes) => {
        const normalized = new Set((targetTypes || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
        if (!normalized.size) return [];
        const ids = [];
        for (const [id, fields] of fieldsCache.entries()) {
            const noteType = String(fields?.type || '').trim().toLowerCase();
            if (!noteType || !normalized.has(noteType)) continue;
            ids.push(String(id || '').trim().toLowerCase());
        }
        return ids;
    };
    const selectFieldScopedRelationTarget = (hint) => {
        const rawTargets = Array.isArray(hint?.sampleTargets)
            ? hint.sampleTargets.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
            : [];
        if (!activeFieldTargetTypes.length) {
            return rawTargets[0] || null;
        }
        const matchingSample = rawTargets.find((id) => activeFieldTargetTypes.includes(String(fieldsCache.get(id)?.type || '').trim().toLowerCase()));
        if (matchingSample) return matchingSample;
        const matchingIds = candidateIdsForTargetTypes(activeFieldTargetTypes);
        return matchingIds[0] || rawTargets[0] || null;
    };
    const rawLikelyFields = Array.isArray(opportunities.likelyFields) ? opportunities.likelyFields : [];
    const rawLikelyGaps = Array.isArray(opportunities.likelyGaps) ? opportunities.likelyGaps : [];
    const rawLikelyContexts = Array.isArray(opportunities.likelyContexts) ? opportunities.likelyContexts : [];
    const strongLikelyFields = strictSurfaceItems(rawLikelyFields, 'frontmatter-actions', { scoreScale: 700 });
    const strongLikelyGaps = strictSurfaceItems(rawLikelyGaps, 'frontmatter-actions', { scoreScale: 700 });
    const exactFieldLikelyFields = isFieldScoped
        ? rawLikelyFields.filter((hint) => normalizedField(hint.field) === normalizedActiveField)
        : [];
    const exactFieldLikelyGaps = isFieldScoped
        ? rawLikelyGaps.filter((hint) => normalizedField(hint.field) === normalizedActiveField)
        : [];
    const mergedLikelyFields = isFieldScoped
        ? [...exactFieldLikelyFields, ...exactFieldLikelyGaps, ...strongLikelyFields, ...strongLikelyGaps].filter((hint, index, list) =>
            list.findIndex((entry) => normalizedField(entry.field) === normalizedField(hint.field)) === index
        )
        : [...strongLikelyFields, ...strongLikelyGaps].filter((hint, index, list) =>
            list.findIndex((entry) => normalizedField(entry.field) === normalizedField(hint.field)) === index
        );
    const actionContexts = isFieldScoped
        ? []
        : strictSurfaceItems(rawLikelyContexts, 'frontmatter-actions', { scoreScale: 700 })
            .filter((hint) => !isFieldScoped || String(hint.field || '').trim().toLowerCase() === normalizedActiveField);
    const actionCompanions = isFieldScoped
        ? []
        : strictSurfaceItems(opportunities.likelyCompanions || [], 'frontmatter-actions', { scoreScale: 700 });
    const actionConnections = isFieldScoped
        ? []
        : strictSurfaceItems(opportunities.likelyConnections || [], 'frontmatter-actions', { scoreScale: 700 });
    const actionRelationViews = isFieldScoped
        ? []
        : strictSurfaceItems(opportunities.relationViews || [], 'frontmatter-actions', { scoreScale: 900 });
    const actionThreadViews = isFieldScoped
        ? []
        : strictSurfaceItems(opportunities.contextThreadViews || [], 'frontmatter-actions', { scoreScale: 900 });
    const actionSetups = isFieldScoped
        ? []
        : strictSurfaceItems(opportunities.surroundingSetups || [], 'frontmatter-actions', { scoreScale: 1100 });
    const bodyMentions = buildBodyMentionHints(document.getText(), frontmatter, fieldsCache, { threshold: 3 });
    const hasStrongSignal =
        mergedLikelyFields.length
        || actionContexts.length
        || actionCompanions.length
        || actionConnections.length
        || actionRelationViews.length
        || actionThreadViews.length
        || actionSetups.length
        || (!isFieldScoped && bodyMentions.length);
    if (!hasStrongSignal) return [];
    const insertPosition = new vscode.Position(fmRange.closeLine, 0);
    const fieldValueRange = isFieldScoped && typeof plan?.lineIndex === 'number'
        ? buildFieldValueRange(document, plan.lineIndex, normalizedActiveField)
        : null;
    const writeFieldValue = (edit, replacement) => {
        if (fieldValueRange) {
            const prepared = getFieldValueReplacement(document, plan.lineIndex, normalizedActiveField, replacement);
            if (prepared) {
                edit.replace(document.uri, prepared.range, prepared.text);
                return true;
            }
        }
        return false;
    };
    const mergeInsertTexts = (...chunks) => {
        const existingFields = new Set(Object.keys(frontmatter || {}).map((key) => String(key).trim().toLowerCase()));
        const mergedLines = [];
        const seenFields = new Set();
        for (const chunk of chunks) {
            for (const rawLine of String(chunk || '').split('\n')) {
                const line = rawLine.replace(/\r$/, '');
                if (!line.trim()) continue;
                const fieldMatch = line.match(/^\s*([\w-]+):/);
                if (!fieldMatch) {
                    mergedLines.push(line);
                    continue;
                }
                const fieldName = fieldMatch[1].toLowerCase();
                if (existingFields.has(fieldName) || seenFields.has(fieldName)) continue;
                seenFields.add(fieldName);
                mergedLines.push(line);
            }
        }
        return mergedLines.length ? `${mergedLines.join('\n')}\n` : '';
    };
    const stripInsertValues = (chunk) => {
        const normalized = String(chunk || '');
        if (!normalized.trim()) return '';
        return normalized
            .split('\n')
            .map((rawLine) => rawLine.replace(/\r$/, ''))
            .filter((line) => line.trim())
            .map((line) => {
                const fieldMatch = line.match(/^\s*([\w-]+):/);
                return fieldMatch ? `${fieldMatch[1]}:` : line;
            })
            .join('\n') + '\n';
    };
    const buildMissingTemplateInsertText = () => {
        const noteType = String(nodeType || '').trim().toLowerCase();
        if (!noteType) return null;
        const root = getPrimaryWorkspaceRoot(vscode.workspace?.workspaceFolders);
        if (!root) return null;
        const template = getTemplateForType(root, noteType);
        const templateFields = Array.isArray(template?.fields) ? template.fields : [];
        if (!templateFields.length) return null;
        const existingKeys = new Set(Object.keys(frontmatter || {}).map((key) => String(key || '').trim().toLowerCase()));
        const missingFields = templateFields.filter((field) => !existingKeys.has(String(field || '').trim().toLowerCase()));
        if (!missingFields.length) return null;
        return {
            noteType,
            missingFields,
            insertText: missingFields.map((field) => `${field}:`).join('\n') + '\n'
        };
    };
    const schemaOnlyInsertText = stripInsertValues(opportunities.recommendedBundle?.insertText || opportunities.setupInsertText || '');
    const templateSchema = isTypeScoped ? buildMissingTemplateInsertText() : null;
    if (canShowNoteSetup && !isTypeScoped && guidance.bestNextStep?.insertText) {
        const starterAction = new vscode.CodeAction(
            formatFieldPrompt(guidance.bestNextStep.label),
            vscode.CodeActionKind.QuickFix
        );
        const starterEdit = new vscode.WorkspaceEdit();
        starterEdit.insert(document.uri, insertPosition, guidance.bestNextStep.insertText);
        starterAction.edit = starterEdit;
        starterAction.isPreferred = true;
        pushAction(starterAction);
    }

    const completionInsertText = opportunities.recommendedBundle?.insertText || opportunities.setupInsertText || '';
    if (isTypeScoped && (templateSchema?.insertText || schemaOnlyInsertText)) {
        const schemaAction = new vscode.CodeAction(
            `Use the ${(templateSchema?.noteType || nodeType || 'note')} schema from Smart Templates`,
            vscode.CodeActionKind.QuickFix
        );
        const schemaEdit = new vscode.WorkspaceEdit();
        schemaEdit.insert(document.uri, insertPosition, templateSchema?.insertText || schemaOnlyInsertText);
        schemaAction.edit = schemaEdit;
        schemaAction.isPreferred = true;
        schemaAction.command = {
            command: 'yamlink.focusFirstEmptyFrontmatterField',
            title: 'Focus first empty frontmatter field'
        };
        pushAction(schemaAction);
    } else if (canShowNoteSetup && guidance.bestNextStep?.insertText && completionInsertText) {
        const combinedInsert = mergeInsertTexts(guidance.bestNextStep.insertText, completionInsertText);
        if (combinedInsert) {
        const completeAction = new vscode.CodeAction(
            'Fill in the usual fields?',
            vscode.CodeActionKind.QuickFix
        );
        const completeEdit = new vscode.WorkspaceEdit();
        completeEdit.insert(document.uri, insertPosition, combinedInsert);
        completeAction.edit = completeEdit;
        completeAction.isPreferred = true;
        pushAction(completeAction);
        }
    }

    if (canShowNoteSetup && !isTypeScoped && strongLikelyFields.length > 0 && opportunities.setupInsertText) {
        const setupAction = new vscode.CodeAction(
            formatFieldListPrompt(strongLikelyFields.map((hint) => hint.field)),
            vscode.CodeActionKind.QuickFix
        );
        const setupEdit = new vscode.WorkspaceEdit();
        setupEdit.insert(document.uri, insertPosition, opportunities.setupInsertText);
        setupAction.edit = setupEdit;
        setupAction.isPreferred = true;
        pushAction(setupAction);
    }

    if (canShowNoteSetup && !isTypeScoped && opportunities.recommendedBundle?.fields?.length && opportunities.recommendedBundle.insertText) {
        const bundleAction = new vscode.CodeAction(
            formatFieldListPrompt(opportunities.recommendedBundle.fields.map((hint) => hint.field)),
            vscode.CodeActionKind.QuickFix
        );
        const bundleEdit = new vscode.WorkspaceEdit();
        bundleEdit.insert(document.uri, insertPosition, opportunities.recommendedBundle.insertText);
        bundleAction.edit = bundleEdit;
        bundleAction.isPreferred = true;
        pushAction(bundleAction);
    }
    if (!isTypeScoped && canShowNoteSetup && opportunities.contextBundle?.summary && opportunities.contextBundle.insertText) {
        const flowAction = new vscode.CodeAction(
            'Use the usual fields for notes like this?',
            vscode.CodeActionKind.QuickFix
        );
        const flowEdit = new vscode.WorkspaceEdit();
        flowEdit.insert(document.uri, insertPosition, opportunities.contextBundle.insertText);
        flowAction.edit = flowEdit;
        flowAction.isPreferred = false;
        pushAction(flowAction);
    }

    if (isTypeScoped) {
        return actions.slice(0, 3);
    }

    for (const contextHint of (allowFieldQuickfix ? actionContexts : []).slice(0, 1)) {
        const contextAction = new vscode.CodeAction(
            `Should ${contextHint.field} link to ${contextHint.targetId}?`,
            vscode.CodeActionKind.QuickFix
        );
        const contextEdit = new vscode.WorkspaceEdit();
        contextEdit.insert(document.uri, insertPosition, contextHint.insertText);
        contextAction.edit = contextEdit;
        contextAction.isPreferred = false;
        pushAction(contextAction);
    }
    for (const companionHint of actionCompanions.slice(0, 1)) {
        const companionAction = new vscode.CodeAction(
            formatLinkPrompt(companionHint.candidateId),
            vscode.CodeActionKind.QuickFix
        );
        const companionEdit = new vscode.WorkspaceEdit();
        companionEdit.insert(document.uri, insertPosition, companionHint.insertText);
        companionAction.edit = companionEdit;
        companionAction.isPreferred = false;
        pushAction(companionAction);
    }

    if (!isFieldScoped && opportunities.relationSetupFields.length > 1 && opportunities.relationSetupInsertText) {
        const relationSetupAction = new vscode.CodeAction(
            `Add the linked fields here?`,
            vscode.CodeActionKind.QuickFix
        );
        const relationSetupEdit = new vscode.WorkspaceEdit();
        relationSetupEdit.insert(document.uri, insertPosition, opportunities.relationSetupInsertText);
        relationSetupAction.edit = relationSetupEdit;
        relationSetupAction.isPreferred = false;
        pushAction(relationSetupAction);
    }

    for (const connection of actionConnections.slice(0, 1)) {
        const connectionAction = new vscode.CodeAction(
            formatLinkPrompt(connection.candidateId),
            vscode.CodeActionKind.QuickFix
        );
        const connectionEdit = new vscode.WorkspaceEdit();
        connectionEdit.insert(document.uri, insertPosition, connection.insertText);
        connectionAction.edit = connectionEdit;
        connectionAction.isPreferred = false;
        pushAction(connectionAction);
    }

    const blockInsertPosition = new vscode.Position(fmRange.closeLine + 1, 0);
    for (const view of actionRelationViews.slice(0, 1)) {
        const viewAction = new vscode.CodeAction(
            'Insert a related view?',
            vscode.CodeActionKind.RefactorRewrite
        );
        const viewEdit = new vscode.WorkspaceEdit();
        viewEdit.insert(document.uri, blockInsertPosition, `\n${view.queryText}\n`);
        viewAction.edit = viewEdit;
        viewAction.isPreferred = false;
        viewAction.command = {
            command: 'yamlink.runViews',
            title: 'Run Yamlink view'
        };
        pushAction(viewAction);
    }
    for (const view of actionThreadViews.slice(0, 1)) {
        const threadAction = new vscode.CodeAction(
            'Insert the usual related list?',
            vscode.CodeActionKind.RefactorRewrite
        );
        const threadEdit = new vscode.WorkspaceEdit();
        threadEdit.insert(document.uri, blockInsertPosition, `\n${view.queryText}\n`);
        threadAction.edit = threadEdit;
        threadAction.isPreferred = false;
        threadAction.command = {
            command: 'yamlink.runViews',
            title: 'Run Yamlink view'
        };
        pushAction(threadAction);
    }
    for (const setup of actionSetups.slice(0, 1)) {
        const surroundingAction = new vscode.CodeAction(
            'Insert the usual related views?',
            vscode.CodeActionKind.RefactorRewrite
        );
        const surroundingEdit = new vscode.WorkspaceEdit();
        surroundingEdit.insert(document.uri, blockInsertPosition, setup.blockText);
        surroundingAction.edit = surroundingEdit;
        surroundingAction.isPreferred = false;
        surroundingAction.command = {
            command: 'yamlink.runViews',
            title: 'Run Yamlink view'
        };
        pushAction(surroundingAction);
    }

    for (const mention of (isFieldScoped ? [] : bodyMentions).slice(0, 1)) {
        const bodyAction = new vscode.CodeAction(
            formatLinkPrompt(mention.id),
            vscode.CodeActionKind.QuickFix
        );
        const bodyEdit = new vscode.WorkspaceEdit();
        bodyEdit.insert(document.uri, insertPosition, mention.insertText);
        bodyAction.edit = bodyEdit;
        bodyAction.isPreferred = false;
        pushAction(bodyAction);
    }

    const fieldScopedLikelyFields = mergedLikelyFields.filter((hint) =>
        !isFieldScoped || String(hint.field || '').trim().toLowerCase() === normalizedActiveField
    );
    for (const hint of (allowFieldQuickfix ? fieldScopedLikelyFields : []).slice(0, 2)) {
        const selectedRelationTarget = hint.relational ? selectFieldScopedRelationTarget(hint) : null;
        if (hint.relational && selectedRelationTarget) {
            const linkAction = new vscode.CodeAction(
                `Should ${hint.field} link to ${selectedRelationTarget}?`,
                vscode.CodeActionKind.QuickFix
            );
            const linkEdit = new vscode.WorkspaceEdit();
            const relationReplacement = `[[${selectedRelationTarget}]]`;
            if (!isFieldScoped || !writeFieldValue(linkEdit, relationReplacement)) {
                linkEdit.insert(document.uri, insertPosition, hint.relationInsertText || `${hint.field}: [[${selectedRelationTarget}]]\n`);
            }
            linkAction.edit = linkEdit;
            linkAction.isPreferred = true;
            pushAction(linkAction);
        }

        const genericAction = new vscode.CodeAction(formatFieldPrompt(hint.field), vscode.CodeActionKind.QuickFix);
        const genericEdit = new vscode.WorkspaceEdit();
        const genericReplacement = hint.relational ? '[[' : '';
        if (!isFieldScoped || !writeFieldValue(genericEdit, genericReplacement)) {
            genericEdit.insert(document.uri, insertPosition, hint.insertText);
        }
        genericAction.edit = genericEdit;
        genericAction.isPreferred = false;
        if (!(hint.relational && selectedRelationTarget && isFieldScoped)) {
            pushAction(genericAction);
        }
    }

    return actions.slice(0, 8);
}

/**
 * @param {import('vscode').ExtensionContext} context
 * @returns {void}
 */
function registerViewLightbulb(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.pickTypeForLine', async (lineIndex) => {
            const editor = vscode.window.activeTextEditor;
            const document = editor?.document;
            if (!editor || !document || document.languageId !== 'markdown') return;

            const fieldsCache = getFieldsCache();
            const typeCounts = new Map();
            for (const fields of fieldsCache.values()) {
                const noteType = String(fields?.type || '').trim().toLowerCase();
                if (!noteType) continue;
                typeCounts.set(noteType, (typeCounts.get(noteType) || 0) + 1);
            }
            const knownTypes = [...getTypes()]
                .map((type) => String(type || '').trim().toLowerCase())
                .filter(Boolean)
                .sort((a, b) => (typeCounts.get(b) || 0) - (typeCounts.get(a) || 0) || a.localeCompare(b));
            if (!knownTypes.length) return;

            const picked = await vscode.window.showQuickPick(
                knownTypes.map((type) => ({
                    label: type,
                    description: `${typeCounts.get(type) || 0} note${(typeCounts.get(type) || 0) === 1 ? '' : 's'}`
                })),
                {
                    title: 'Note Type',
                    placeHolder: 'Choose a type for this note'
                }
            );
            if (!picked) return;

            const edit = new vscode.WorkspaceEdit();
            const prepared = getFieldValueReplacement(document, lineIndex, 'type', picked.label);
            if (!prepared) return;
            edit.replace(document.uri, prepared.range, prepared.text);
            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) return;
            const focused = focusFirstEmptyFrontmatterField(editor, document);
            if (focused) {
                await vscode.commands.executeCommand('editor.action.triggerSuggest');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yamlink.focusFirstEmptyFrontmatterField', async () => {
            const editor = vscode.window.activeTextEditor;
            const document = editor?.document;
            if (!editor || !document || document.languageId !== 'markdown') return;
            const focused = focusFirstEmptyFrontmatterField(editor, document);
            if (focused) {
                await vscode.commands.executeCommand('editor.action.triggerSuggest');
            }
        })
    );

    const provider = {
        provideCodeActions(document, range) {
            if (!document || document.languageId !== 'markdown') return undefined;
            if (range?.start && range?.end) {
                const hasSelection = range.start.line !== range.end.line || range.start.character !== range.end.character;
                if (hasSelection) return undefined;
            }
            const line = document.lineAt(range.start.line).text;
            if (!line.trim().startsWith('!view ')) {
                const fmRange = getFrontmatterRange(document);
                if (!fmRange || range.start.line <= fmRange.openLine || range.start.line >= fmRange.closeLine) return undefined;
                const parsedLine = parseFrontmatterLine(line);
                if (parsedLine) {
                    if (parsedLine.fieldName === 'type' && !parsedLine.value) {
                        const typeActions = buildTypeInferenceActions(document, range.start.line);
                        return typeActions.length ? typeActions : undefined;
                    }
                    if (parsedLine.fieldName === 'type' && parsedLine.value) {
                        const typeActions = buildAdaptiveFrontmatterActions(document, 'type');
                        return typeActions.length ? typeActions : undefined;
                    }
                    // [[]] is an empty wikilink placeholder — treat it as empty,
                    // not as a real value, so relation fields get lightbulb suggestions.
                    const isEmptyPlaceholder = /^\[\[\s*\]\]$/.test(String(parsedLine.value || '').trim());
                    if (parsedLine.value && !isEmptyPlaceholder) return undefined;
                    const fmDoc = parseFrontmatter(document.getText());
                    const nodeType = fmDoc ? String(fmDoc.type || '').trim().toLowerCase() : '';
                    const fieldsCache = getFieldsCache();
                    const bodyWikilinkCounts = extractBodyMentionedIds(document.getText());
                    const classification = classifyCurrentField(parsedLine.fieldName, nodeType, fieldsCache, fmDoc, bodyWikilinkCounts);
                    const plan = { ...planFieldActions(classification, 'lightbulb'), lineIndex: range.start.line };
                    if (plan.level < LEVEL.DOCUMENT) {
                        const fallbackActions = buildTypedEmptyFieldFallbackActions(document, range.start.line, parsedLine.fieldName, nodeType);
                        return fallbackActions.length ? fallbackActions : undefined;
                    }
                    const actions = buildAdaptiveFrontmatterActions(document, parsedLine.fieldName, plan);
                    if (actions.length) return actions;
                    const fallbackActions = buildTypedEmptyFieldFallbackActions(document, range.start.line, parsedLine.fieldName, nodeType);
                    return fallbackActions.length ? fallbackActions : undefined;
                }
                if (line.trim()) return undefined;
                const shapeActions = buildLikelyShapeActions(document);
                const actions = buildAdaptiveFrontmatterActions(document);
                const merged = [];
                const seenTitles = new Set();
                for (const action of [...shapeActions, ...(actions || [])]) {
                    if (!action?.title || seenTitles.has(action.title)) continue;
                    seenTitles.add(action.title);
                    merged.push(action);
                }
                return merged.length ? merged.slice(0, 8) : undefined;
            }
            const queries = parseAllViewQueries(document.getText());
            if (!queries || queries.length === 0) return undefined;

            const run = new vscode.CodeAction('Run this view', vscode.CodeActionKind.QuickFix);
            run.command = { command: 'yamlink.runViews', title: 'Run this view' };
            run.isPreferred = true;

            const insert = new vscode.CodeAction('Insert another view?', vscode.CodeActionKind.RefactorRewrite);
            insert.command = { command: 'yamlink.insertViewBlock', title: 'Insert another view?' };

            const refine = new vscode.CodeAction('Adjust this view?', vscode.CodeActionKind.RefactorRewrite);
            refine.command = { command: 'yamlink.refineViewBlock', title: 'Adjust this view?', arguments: [document, range] };

            return [run, refine, insert];
        }
    };

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('markdown', provider, {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite]
        })
    );
}

module.exports = { registerViewLightbulb, buildAdaptiveFrontmatterActions };
