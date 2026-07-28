'use strict';

const vscode = require('vscode');
const crypto = require('crypto');
const { getIndex, getFieldsCache, getAliasIndex } = require('../core/indexService');
const { getBacklinks } = require('../core/graph');
const { buildGlossaryEntries, groupGlossaryEntries } = require('../intelligence/glossary');
const { buildEmptyStateHtml, buildGlossaryHtml } = require('./glossaryHtml');
const { openNoteTarget } = require('./navigation/openNoteTarget');

let panel = null;
let configListener = null;

const GLOSSARY_CONFIG_KEYS = [
    'yamlink.glossaryTypes',
    'yamlink.glossaryGroupByType',
    'yamlink.glossaryShowZeroBacklinkTerms',
    'yamlink.glossaryExtraFields',
    'yamlink.glossarySortBy'
];

/**
 * @returns {{ types: string[], groupByType: boolean, showZeroBacklinkTerms: boolean, extraFields: string[], sortBy: 'alphabetical'|'mostReferenced' }}
 */
function readGlossaryConfig() {
    const config = vscode.workspace.getConfiguration('yamlink');
    /** @type {'alphabetical'|'mostReferenced'} */
    const sortBy = config.get('glossarySortBy') === 'mostReferenced' ? 'mostReferenced' : 'alphabetical';
    return {
        types: (config.get('glossaryTypes') || []).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean),
        groupByType: config.get('glossaryGroupByType') !== false,
        showZeroBacklinkTerms: config.get('glossaryShowZeroBacklinkTerms') !== false,
        extraFields: config.get('glossaryExtraFields') || [],
        sortBy
    };
}

/** @param {import('vscode').ExtensionContext} context @returns {void} */
function openGlossaryPanel(context) {
    if (panel) {
        panel.reveal(vscode.ViewColumn.One);
        updatePanel();
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'yamlink.glossaryPanel',
        'Vault Glossary',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    panel.webview.onDidReceiveMessage((message) => {
        if (message.command === 'openNode') {
            openNoteTarget(message.id, { preview: false }).catch(() => {});
        }
        if (message.command === 'openSettings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'yamlink.glossaryTypes');
        }
        if (message.command === 'updateSetting' && typeof message.key === 'string') {
            const config = vscode.workspace.getConfiguration('yamlink');
            config.update(message.key, message.value, vscode.ConfigurationTarget.Workspace).then(
                () => {},
                () => {}
            );
        }
        if (message.command === 'copyMarkdown' && typeof message.text === 'string') {
            vscode.env.clipboard.writeText(message.text).then(() => {
                vscode.window.setStatusBarMessage('Yamlink: Glossary copied to clipboard.', 3000);
            }, () => {});
        }
    }, null, context.subscriptions);

    if (!configListener) {
        configListener = vscode.workspace.onDidChangeConfiguration((e) => {
            if (GLOSSARY_CONFIG_KEYS.some((key) => e.affectsConfiguration(key))) {
                updatePanel();
            }
        });
        context.subscriptions.push(configListener);
    }

    panel.onDidDispose(() => { panel = null; }, null, context.subscriptions);

    updatePanel();
}

/** @returns {void} */
function updatePanel() {
    if (!panel) return;
    const config = readGlossaryConfig();
    const nonce = crypto.randomBytes(16).toString('hex');

    if (!config.types.length) {
        panel.webview.html = buildEmptyStateHtml({ nonce });
        return;
    }

    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const entries = buildGlossaryEntries(
        { fieldsCache, idIndex },
        {
            types: config.types,
            showZeroBacklinkTerms: config.showZeroBacklinkTerms,
            extraFields: config.extraFields
        },
        { getBacklinksFn: getBacklinks }
    );
    const groups = groupGlossaryEntries(entries, { groupByType: config.groupByType, sortBy: config.sortBy });

    panel.webview.html = buildGlossaryHtml(groups, config.types, {
        nonce,
        idIndex,
        aliasIndex: getAliasIndex(),
        groupByType: config.groupByType,
        showZeroBacklinkTerms: config.showZeroBacklinkTerms,
        sortBy: config.sortBy
    });
}

module.exports = { openGlossaryPanel, updatePanel };
