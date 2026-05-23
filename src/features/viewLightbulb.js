'use strict';

const vscode = require('vscode');
const { parseAllViewQueries } = require('../engine/query');
const { parseFrontmatter, getFieldsCache, getVaultGeneration } = require('../core/indexService');
const { extractBodyMentionedIds } = require('../intelligence/frontmatterBodyHints');
const { inferNoteRole } = require('../intelligence/noteRolesCore');
const {
    buildFrontmatterGuidanceSummary,
    buildBodyMentionHints
} = require('../intelligence/frontmatterIntelligence');
const { getSurfacePolicy, readConfidence } = require('../intelligence/confidence');
const { buildActivationContext } = require('../engine/suggestions');
const { getCachedContext } = require('../intelligence/activationCache');
const { classifyField, CATEGORY } = require('../intelligence/fieldCategory');
const { planFieldActions, LEVEL } = require('../intelligence/fieldPlanner');
const { getSchema } = require('../registries/schemaRegistry');
const { getCachedPriors, inferLikelyTypesForNote, getCommonFieldsForType } = require('../intelligence/vaultPriors');

function parseFieldNameFromLine(line) {
    const match = String(line || '').trim().match(/^([\w-]+)\s*:/);
    return match ? match[1].toLowerCase() : null;
}

function classifyCurrentField(fieldName, nodeType, fieldsCache, noteFields, bodyWikilinkCounts) {
    if (!fieldName) return { category: CATEGORY.UNKNOWN, confidence: 0, source: 'default' };
    const schema = nodeType ? getSchema(nodeType) : null;
    const schemaFieldDef = schema && schema.fields
        ? (schema.fields[fieldName] || schema.fields[fieldName.replace(/-/g, '_')] || null)
        : null;
    const priors = (!fieldsCache || !fieldsCache.size)
        ? { fieldTargetTypes: null, typeFieldBundles: null, fieldAmbiguity: null, noteRoleTypePriors: null }
        : getCachedPriors(fieldsCache, getVaultGeneration());
    const noteRole = inferNoteRole(noteFields || {}, {});
    return classifyField(fieldName, {
        schemaFieldDef,
        fieldsCache,
        noteType: nodeType,
        noteFields,
        bodyWikilinkCounts: bodyWikilinkCounts || null,
        noteRole: noteRole.noteRole ? noteRole : null,
        ...priors
    });
}

function getFrontmatterRange(document) {
    const lines = document.getText().split('\n');
    let openLine = -1;
    let closeLine = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^---\s*$/.test(lines[i])) {
            if (openLine === -1) openLine = i;
            else {
                closeLine = i;
                break;
            }
        }
    }
    return openLine !== -1 && closeLine !== -1 ? { openLine, closeLine } : null;
}

function parseFrontmatterLine(lineText = '') {
    const match = String(lineText || '').match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
    if (!match) return null;
    return {
        fieldName: String(match[1] || '').trim().toLowerCase(),
        rawValue: String(match[2] || ''),
        value: String(match[2] || '').trim()
    };
}

function strictSurfaceItems(items = [], surface, options = {}) {
    const policy = getSurfacePolicy(surface);
    return (Array.isArray(items) ? items : []).filter((item) => readConfidence(item, options) >= policy.minimum);
}

function formatFieldPrompt(field) {
    return `Add ${field} here?`;
}

function formatFieldListPrompt(fields, fallback = 'Fill in the usual fields?') {
    const list = Array.isArray(fields)
        ? fields.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
    if (list.length === 1) return `Add ${list[0]} here?`;
    if (list.length === 2) return `Add ${list[0]} and ${list[1]} here?`;
    if (list.length >= 3) return `Fill in the usual fields?`;
    return fallback;
}

function formatLinkPrompt(targetId, prefix = 'Should this note link to') {
    return `${prefix} ${targetId}?`;
}

function getFieldTargetTypesFromSchema(schema, fieldName) {
    if (!schema?.fields || !fieldName) return [];
    const raw = schema.fields[fieldName] || schema.fields[fieldName.replace(/-/g, '_')] || null;
    if (!raw || String(raw.type || '').trim().toLowerCase() !== 'relation') return [];
    if (raw.target) return [String(raw.target).trim().toLowerCase()].filter(Boolean);
    if (Array.isArray(raw.targetTypes)) {
        return raw.targetTypes.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
    }
    return [];
}

function buildFieldValueRange(document, lineIndex, fieldName) {
    const lineText = document.lineAt(lineIndex).text;
    const match = String(lineText || '').match(/^(\s*[\w-]+\s*:)(\s*)(.*?)\s*$/);
    if (!match) return null;
    const normalized = String(fieldName || '').trim().toLowerCase();
    const parsedField = parseFieldNameFromLine(lineText);
    if (normalized && parsedField !== normalized) return null;
    const valueStart = match[1].length;
    return new vscode.Range(
        new vscode.Position(lineIndex, valueStart),
        new vscode.Position(lineIndex, lineText.length)
    );
}

function getFieldValueReplacement(document, lineIndex, fieldName, replacement) {
    const range = buildFieldValueRange(document, lineIndex, fieldName);
    const normalizedReplacement = String(replacement || '').replace(/\r?\n$/, '');
    if (!range) return null;
    return { range, text: normalizedReplacement ? ` ${normalizedReplacement}` : '' };
}

function buildLikelyShapeActions(document, lineIndex = null, options = {}) {
    const frontmatter = parseFrontmatter(document.getText());
    if (!frontmatter) return [];
    const fieldsCache = getFieldsCache();
    const priors = getCachedPriors(fieldsCache, getVaultGeneration());
    const noteRole = inferNoteRole(frontmatter || {}, {});
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
            action.command = {
                command: 'yamlink.openHub',
                title: 'Open Yamlink Note Report'
            };
            action.diagnostics = topCandidate.reasons;
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
                bundleAction.command = {
                    command: 'yamlink.openHub',
                    title: 'Open Yamlink Note Report'
                };
                bundleAction.diagnostics = [
                    `${topCandidate.matchedFields.length}/${currentFields.size || 1} current fields commonly appear on ${inferredType} notes`
                ];
                pushIf(bundleAction);
            }
        }
    }

    return actions;
}

function buildTypeInferenceActions(document, lineIndex) {
    return buildLikelyShapeActions(document, lineIndex, { minScore: 0.46 });
}

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
    if (!isFieldScoped && guidance.bestNextStep?.insertText) {
        const starterAction = new vscode.CodeAction(
            formatFieldPrompt(guidance.bestNextStep.label),
            vscode.CodeActionKind.QuickFix
        );
        const starterEdit = new vscode.WorkspaceEdit();
        starterEdit.insert(document.uri, insertPosition, guidance.bestNextStep.insertText);
        starterAction.edit = starterEdit;
        starterAction.isPreferred = true;
        starterAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        pushAction(starterAction);
    }

    const completionInsertText = opportunities.recommendedBundle?.insertText || opportunities.setupInsertText || '';
    if (!isFieldScoped && guidance.bestNextStep?.insertText && completionInsertText) {
        const combinedInsert = `${guidance.bestNextStep.insertText}${completionInsertText}`;
        const completeAction = new vscode.CodeAction(
            'Fill in the usual fields?',
            vscode.CodeActionKind.QuickFix
        );
        const completeEdit = new vscode.WorkspaceEdit();
        completeEdit.insert(document.uri, insertPosition, combinedInsert);
        completeAction.edit = completeEdit;
        completeAction.isPreferred = true;
        completeAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        pushAction(completeAction);
    }

    if (!isFieldScoped && strongLikelyFields.length > 0 && opportunities.setupInsertText) {
        const setupAction = new vscode.CodeAction(
            formatFieldListPrompt(strongLikelyFields.map((hint) => hint.field)),
            vscode.CodeActionKind.QuickFix
        );
        const setupEdit = new vscode.WorkspaceEdit();
        setupEdit.insert(document.uri, insertPosition, opportunities.setupInsertText);
        setupAction.edit = setupEdit;
        setupAction.isPreferred = true;
        setupAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        pushAction(setupAction);
    }

    if (!isFieldScoped && opportunities.recommendedBundle?.fields?.length && opportunities.recommendedBundle.insertText) {
        const bundleAction = new vscode.CodeAction(
            formatFieldListPrompt(opportunities.recommendedBundle.fields.map((hint) => hint.field)),
            vscode.CodeActionKind.QuickFix
        );
        const bundleEdit = new vscode.WorkspaceEdit();
        bundleEdit.insert(document.uri, insertPosition, opportunities.recommendedBundle.insertText);
        bundleAction.edit = bundleEdit;
        bundleAction.isPreferred = true;
        bundleAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        pushAction(bundleAction);
    }
    if (!isFieldScoped && opportunities.contextBundle?.summary && opportunities.contextBundle.insertText) {
        const flowAction = new vscode.CodeAction(
            'Use the usual fields for notes like this?',
            vscode.CodeActionKind.QuickFix
        );
        const flowEdit = new vscode.WorkspaceEdit();
        flowEdit.insert(document.uri, insertPosition, opportunities.contextBundle.insertText);
        flowAction.edit = flowEdit;
        flowAction.isPreferred = false;
        flowAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        pushAction(flowAction);
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
        contextAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
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
        companionAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
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
        relationSetupAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
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
        connectionAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
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
        bodyAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
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
            linkAction.command = {
                command: 'yamlink.openHub',
                title: 'Open Yamlink Note Report'
            };
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
        genericAction.command = {
            command: 'yamlink.openHub',
            title: 'Open Yamlink Note Report'
        };
        if (!(hint.relational && selectedRelationTarget && isFieldScoped)) {
            pushAction(genericAction);
        }
    }

    return actions.slice(0, 8);
}

function registerViewLightbulb(context) {
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
                    if (parsedLine.value) return undefined;
                    const fmDoc = parseFrontmatter(document.getText());
                    const nodeType = fmDoc ? String(fmDoc.type || '').trim().toLowerCase() : '';
                    const fieldsCache = getFieldsCache();
                    const bodyWikilinkCounts = extractBodyMentionedIds(document.getText());
                    const classification = classifyCurrentField(parsedLine.fieldName, nodeType, fieldsCache, fmDoc, bodyWikilinkCounts);
                    const plan = { ...planFieldActions(classification, 'lightbulb'), lineIndex: range.start.line };
                    if (plan.level < LEVEL.DOCUMENT) return undefined;
                    const actions = buildAdaptiveFrontmatterActions(document, parsedLine.fieldName, plan);
                    return actions.length ? actions : undefined;
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
