'use strict';

const fs = require('fs');
const vscode = require('vscode');
const { buildDateShortcutEntries } = require('../core/date');
const { getPathIndex, getFieldsCache, getVaultGeneration } = require('../core/indexService');
const {
    extractHeadingsFromText,
    extractFootnoteDefinitions,
    collectBodySignals,
    collectUndefinedFootnoteReferences
} = require('../intelligence/bodySignals');
const { extractMeaningfulBodyBlocks } = require('../core/bodyBlocks');
const { getCachedPriors } = require('../intelligence/vaultPriors');
const {
    isPositionInFrontmatter,
    extractDocumentArchetype
} = require('./completionHelpers');
const { getKnownTypeCandidates } = require('./completionCore');

// ---------------------------------------------------------------------------
// Range helpers

function makeReplaceRange(document, position, prefixLength) {
    return new vscode.Range(
        new vscode.Position(position.line, Math.max(0, position.character - prefixLength)),
        position
    );
}

// ---------------------------------------------------------------------------
// Completion item builders

function buildMissingRelationItem(frontmatterRelation) {
    const targetType = frontmatterRelation.targetType || 'related';
    const item = new vscode.CompletionItem(`No ${targetType} notes found yet`, vscode.CompletionItemKind.Text);
    const fieldLead = frontmatterRelation.fieldName
        ? `\`${frontmatterRelation.fieldName}\` expects a ${targetType} note`
        : `This field expects a ${targetType} note`;
    item.detail = `${fieldLead}. Create one, then link it here.`;
    item.insertText = '';
    item.sortText = '0000';
    return item;
}

function buildCreateRelationTemplateItem(document, frontmatterRelation) {
    const targetType = frontmatterRelation.targetType || frontmatterRelation.fieldName || 'related';
    const sourceId = getPathIndex().get(document.uri.fsPath) || null;
    const sourceType = sourceId ? String(getFieldsCache().get(sourceId)?.type || '').trim().toLowerCase() : '';
    const item = new vscode.CompletionItem(`New ${targetType}`, vscode.CompletionItemKind.Snippet);
    const lead = sourceType
        ? `Create a new ${targetType} note, back-linked to this ${sourceType}`
        : `Create a new ${targetType} note, back-linked to this note`;
    const hintBits = [
        frontmatterRelation?.rankingHints?.behaviorHint || '',
        frontmatterRelation?.rankingHints?.familyHint || ''
    ].filter(Boolean);
    item.detail = hintBits.length ? `${lead} · ${hintBits[0]}` : lead;
    item.insertText = '';
    item.sortText = '0000';
    item.preselect = true;
    item.command = {
        command: 'yamlink.createRelatedNote',
        title: 'Create related note',
        arguments: [{
            targetType,
            fieldName: frontmatterRelation.fieldName,
            sourceFilePath: document.uri.fsPath,
            sourceId,
            sourceType
        }]
    };
    return item;
}

function shouldOfferFrontmatterRelationCompletion(frontmatterRelation, completionContext = {}) {
    if (!frontmatterRelation) return false;
    if (frontmatterRelation.hasWiki) return true;
    const triggerKind = completionContext?.triggerKind;
    return triggerKind === vscode.CompletionTriggerKind?.Invoke || triggerKind === 0;
}

function buildMissingQueryRelationItem(relationState) {
    const targetType = relationState.targetType || 'related';
    const item = new vscode.CompletionItem(`No ${targetType} notes found yet`, vscode.CompletionItemKind.Text);
    const fieldLead = relationState.fieldName
        ? `\`${relationState.fieldName}\` expects a ${targetType} note`
        : `This field expects a ${targetType} note`;
    item.detail = `${fieldLead}. Create one, then use [[...]] here.`;
    item.insertText = '';
    item.sortText = '0000';
    return item;
}

/** @param {import('vscode').TextDocument} document @param {import('vscode').Position} position @param {string} partial @returns {import('vscode').CompletionItem[]} */
function buildDateShortcutItems(document, position, partial) {
    const replaceRange = makeReplaceRange(document, position, partial.length + 1);
    return buildDateShortcutEntries()
        .filter((entry) => entry.token.startsWith(String(partial || '').toLowerCase()))
        .map((entry, index) => {
            const item = new vscode.CompletionItem(`@${entry.token}`, vscode.CompletionItemKind.Event);
            item.insertText = entry.iso;
            item.range = replaceRange;
            item.detail = `${entry.label} -> ${entry.iso}`;
            item.sortText = `00${index}`;
            return item;
        });
}

function collectDocumentHeadingCandidates(document, targetId, idIndex) {
    let content = '';
    if (!targetId) {
        content = document.getText();
    } else {
        const targetPath = idIndex.get(String(targetId || '').trim());
        if (!targetPath) return [];
        try {
            content = fs.readFileSync(targetPath, 'utf8');
        } catch (_) {
            return [];
        }
    }
    return [...new Set(extractHeadingsFromText(content))];
}

function collectDocumentBlockCandidates(document, targetId, idIndex) {
    let content = '';
    if (!targetId) {
        content = document.getText();
    } else {
        const targetPath = idIndex.get(String(targetId || '').trim());
        if (!targetPath) return [];
        try {
            content = fs.readFileSync(targetPath, 'utf8');
        } catch (_) {
            return [];
        }
    }
    return extractMeaningfulBodyBlocks(content).filter((block) => block.type !== 'heading');
}

/** @param {import('vscode').TextDocument} document @param {import('vscode').Position} position @param {Map<string,string>} idIndex @param {string|null} targetId @param {string} partial @returns {import('vscode').CompletionItem[]} */
function buildHeadingAnchorItems(document, position, idIndex, targetId, partial) {
    const textAfterCursor = document.lineAt(position.line).text.substring(position.character);
    const replaceRange = new vscode.Range(
        new vscode.Position(position.line, Math.max(0, position.character - String(partial || '').length)),
        new vscode.Position(position.line, position.character + (textAfterCursor.startsWith(']]') ? 2 : 0))
    );
    const sourceLabel = targetId || 'current note';
    return collectDocumentHeadingCandidates(document, targetId, idIndex)
        .filter((heading) => heading.toLowerCase().startsWith(String(partial || '').toLowerCase()))
        .map((heading, index) => {
            const item = new vscode.CompletionItem(heading, vscode.CompletionItemKind.Reference);
            item.insertText = `${heading}]]`;
            item.range = replaceRange;
            item.filterText = targetId ? `[[${targetId}#${heading}` : `[[#${heading}`;
            item.detail = `Heading in ${sourceLabel}`;
            item.sortText = `01${String(index).padStart(3, '0')}`;
            return item;
        });
}

/** @param {import('vscode').TextDocument} document @param {import('vscode').Position} position @param {Map<string,string>} idIndex @param {string|null} targetId @param {string} partial @returns {import('vscode').CompletionItem[]} */
function buildBlockReferenceItems(document, position, idIndex, targetId, partial) {
    const textAfterCursor = document.lineAt(position.line).text.substring(position.character);
    const replaceRange = new vscode.Range(
        new vscode.Position(position.line, Math.max(0, position.character - String(partial || '').length)),
        new vscode.Position(position.line, position.character + (textAfterCursor.startsWith(']]') ? 2 : 0))
    );
    const sourceLabel = targetId || 'current note';
    return collectDocumentBlockCandidates(document, targetId, idIndex)
        .filter((block) => block.blockId.toLowerCase().startsWith(String(partial || '').toLowerCase()))
        .map((block, index) => {
            const item = new vscode.CompletionItem(block.blockId, vscode.CompletionItemKind.Reference);
            item.insertText = `${block.blockId}]]`;
            item.range = replaceRange;
            item.filterText = targetId ? `[[${targetId}^${block.blockId}` : `[[^${block.blockId}`;
            const snippet = String(block.label || block.text || '').trim().replace(/\s+/g, ' ');
            item.detail = `${block.type} block in ${sourceLabel}${snippet ? ` · ${snippet}` : ''}`;
            item.sortText = `015${String(index).padStart(3, '0')}`;
            return item;
        });
}

/** @param {import('vscode').TextDocument} document @param {import('vscode').Position} position @param {string} partial @returns {import('vscode').CompletionItem[]} */
function buildFootnoteReferenceItems(document, position, partial) {
    const textAfterCursor = document.lineAt(position.line).text.substring(position.character);
    const replaceRange = new vscode.Range(
        new vscode.Position(position.line, Math.max(0, position.character - String(partial || '').length)),
        new vscode.Position(position.line, position.character + (textAfterCursor.startsWith(']') ? 1 : 0))
    );
    return [...new Set(extractFootnoteDefinitions(document.getText()))]
        .filter((id) => id.toLowerCase().startsWith(String(partial || '').toLowerCase()))
        .map((id, index) => {
            const item = new vscode.CompletionItem(`[^${id}]`, vscode.CompletionItemKind.Reference);
            item.insertText = `${id}]`;
            item.range = replaceRange;
            item.detail = 'Reference existing footnote';
            item.sortText = `02${String(index).padStart(3, '0')}`;
            return item;
        });
}

/** @param {import('vscode').TextDocument} document @param {import('vscode').Position} position @returns {import('vscode').CompletionItem[]} */
function buildLongformBodyStructureItems(document, position) {
    if (isPositionInFrontmatter(document, position.line)) return [];
    const line = document.lineAt(position.line).text;
    const textBeforeCursor = line.substring(0, position.character);
    const trimmedBefore = textBeforeCursor.trim();
    const bodySignals = collectBodySignals(document.getText());
    const sourceHeavy = (bodySignals.blockquoteCount || 0) >= 1
        || (bodySignals.footnoteDefinitionCount || 0) >= 1
        || (bodySignals.footnoteReferenceCount || 0) >= 1;
    if (!sourceHeavy) return [];

    const items = [];
    const lineReplaceRange = new vscode.Range(
        new vscode.Position(position.line, 0),
        new vscode.Position(position.line, line.length)
    );
    const allowQuoteSnippets = trimmedBefore === '' || /^\s*>\s*/.test(textBeforeCursor);
    const allowHeadingSnippets = trimmedBefore === '' || /^\s*#{1,3}\s*[^#]*$/.test(textBeforeCursor);

    if (allowQuoteSnippets) {
        const quoteSource = new vscode.CompletionItem('Quote from linked source', vscode.CompletionItemKind.Snippet);
        quoteSource.insertText = new vscode.SnippetString('> From [[source-note]]\n> ${1:Quoted passage here.}');
        quoteSource.range = lineReplaceRange;
        quoteSource.detail = 'Source-aware quote block';
        quoteSource.sortText = '0300';
        items.push(quoteSource);

        const quoteSection = new vscode.CompletionItem('Quote from linked section', vscode.CompletionItemKind.Snippet);
        quoteSection.insertText = new vscode.SnippetString('> From [[source-note#Heading]]\n> ${1:Quoted passage here.}');
        quoteSection.range = lineReplaceRange;
        quoteSection.detail = 'Source-aware quote block with heading anchor';
        quoteSection.sortText = '0301';
        items.push(quoteSection);
    }

    if (allowHeadingSnippets) {
        const evidenceHeading = new vscode.CompletionItem('## Evidence', vscode.CompletionItemKind.Snippet);
        evidenceHeading.insertText = '## Evidence';
        evidenceHeading.range = lineReplaceRange;
        evidenceHeading.detail = 'Longform heading suggestion';
        evidenceHeading.sortText = '0310';
        items.push(evidenceHeading);

        const referencesHeading = new vscode.CompletionItem('## References', vscode.CompletionItemKind.Snippet);
        referencesHeading.insertText = '## References';
        referencesHeading.range = lineReplaceRange;
        referencesHeading.detail = 'Longform heading suggestion';
        referencesHeading.sortText = '0311';
        items.push(referencesHeading);
    }

    const undefinedRefs = collectUndefinedFootnoteReferences(document.getText());
    if (trimmedBefore === '' || /^\[\^[^\]]*\]:?\s*$/.test(trimmedBefore)) {
        undefinedRefs.slice(0, 6).forEach((id, index) => {
            const item = new vscode.CompletionItem(`[^${id}]:`, vscode.CompletionItemKind.Snippet);
            item.insertText = new vscode.SnippetString(`[^${id}]: \${1:Source detail}`);
            item.range = lineReplaceRange;
            item.detail = 'Define missing footnote';
            item.sortText = `032${String(index).padStart(2, '0')}`;
            items.push(item);
        });
    }

    return items;
}

function inferBootstrapNoteTypes(document, adaptiveContext) {
    const likely = new Set();
    for (const archetype of extractDocumentArchetype(document, null)) {
        if (archetype) likely.add(archetype);
    }
    const priors = getCachedPriors(getFieldsCache(), getVaultGeneration());
    const noteRole = adaptiveContext?.intelligence?.noteRole;
    const proxyType = noteRole?.noteRole
        ? priors.noteRoleTypePriors.get(noteRole.noteRole)?.dominantType || ''
        : '';
    if (proxyType) likely.add(proxyType);
    return [...likely].filter(Boolean);
}

function buildPreTypeBootstrapItems(document, partialKey, adaptiveContext) {
    const likelyTypes = inferBootstrapNoteTypes(document, adaptiveContext);
    const topType = likelyTypes[0] || '';
    const knownTypes = getKnownTypeCandidates();
    const items = [];

    if ('type'.startsWith(String(partialKey || '').toLowerCase())) {
        const item = new vscode.CompletionItem('type', vscode.CompletionItemKind.Field);
        item.detail = topType
            ? `Set note identity first · likely ${topType}`
            : knownTypes.length
                ? 'Set note identity first · schema or vault types available'
                : 'Set note identity first';
        item.insertText = topType
            ? new vscode.SnippetString(`type: ${topType}`)
            : knownTypes.length
                ? new vscode.SnippetString(`type: \${1|${knownTypes.join(',')}|}`)
                : new vscode.SnippetString('type: ${1}');
        item.sortText = '000-type';
        items.push(item);
    }

    return items;
}

module.exports = {
    makeReplaceRange,
    buildMissingRelationItem,
    buildCreateRelationTemplateItem,
    shouldOfferFrontmatterRelationCompletion,
    buildMissingQueryRelationItem,
    buildDateShortcutItems,
    collectDocumentHeadingCandidates,
    collectDocumentBlockCandidates,
    buildHeadingAnchorItems,
    buildBlockReferenceItems,
    buildFootnoteReferenceItems,
    buildLongformBodyStructureItems,
    inferBootstrapNoteTypes,
    buildPreTypeBootstrapItems
};
