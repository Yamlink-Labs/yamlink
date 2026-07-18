'use strict';
/* global suite, test */

const assert = require('node:assert/strict');
const path = require('path');
const vscode = require('vscode');

suite('Yamlink extension host', () => {
    test('activates and exposes the public API', async () => {
        const ext = vscode.extensions.getExtension('yamlink.yamlink');
        assert.ok(ext, 'yamlink.yamlink extension should be discoverable');

        const docPath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'rico-ext-host.md');
        const doc = await vscode.workspace.openTextDocument(docPath);
        await vscode.window.showTextDocument(doc);

        await ext.activate();

        assert.equal(ext.isActive, true);
        assert.ok(ext.exports, 'extension should expose a public API');
        assert.equal(typeof ext.exports.query, 'function');
        assert.equal(typeof ext.exports.getIndex, 'function');
    });

    test('registers the main public commands', async () => {
        const commands = await vscode.commands.getCommands(true);
        const expected = [
            'yamlink.startGuidedTour',
            'yamlink.addSampleVault',
            'yamlink.openHub',
            'yamlink.openCalendar',
            'yamlink.runGraph',
            'yamlink.runVaultGraph',
            'yamlink.openGraphSidebar',
            'yamlink.runViews',
            'yamlink.insertViewBlock'
        ];

        for (const command of expected) {
            assert.ok(commands.includes(command), `Expected command ${command} to be registered`);
        }
    });

    test('query API runs against the real extension-host workspace index', async () => {
        const ext = vscode.extensions.getExtension('yamlink.yamlink');
        await ext.activate();

        const result = ext.exports.query('!view contact');
        assert.equal(result.success, true);
        assert.ok(result.rows.length >= 1, 'fixture workspace should expose at least one contact note');
        assert.ok(
            result.rows.some((row) => row.id === 'johnny-rico-ext-host'),
            'fixture workspace should expose the johnny-rico-ext-host contact note'
        );
    });

    test('frontmatter relation completion works through the real VS Code provider path', async () => {
        const doc = await vscode.workspace.openTextDocument({
            language: 'markdown',
            content: [
                '---',
                'id: extension-host-temp-contact',
                'type: contact',
                'account: [[m',
                '---'
            ].join('\n')
        });
        await vscode.window.showTextDocument(doc);
        const line = doc.lineAt(3).text;
        const position = new vscode.Position(3, line.length);

        const completions = await vscode.commands.executeCommand(
            'vscode.executeCompletionItemProvider',
            doc.uri,
            position,
            '['
        );

        assert.ok(completions, 'completion list should be returned');
        assert.ok(
            completions.items.some(item =>
                String(item.label).includes('mobile-infantry-ext-host') ||
                String(item.insertText || '').includes('mobile-infantry-ext-host')
            ),
            'relation-aware completion should offer the account target from the fixture vault'
        );
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('sidebar commands execute without throwing in the real extension host', async () => {
        await vscode.commands.executeCommand('yamlink.openHub');
        await vscode.commands.executeCommand('yamlink.openCalendar');
        await vscode.commands.executeCommand('yamlink.openGraphSidebar');
    });
});
