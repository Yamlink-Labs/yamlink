// src/features/home/homeScript.js
// Browser-side JS for the Yamlink Home panel webview

(function () {
    'use strict';

    var vscode = acquireVsCodeApi();

    document.addEventListener('click', function (e) {
        // Activity feed item → open note
        var feedItem = e.target.closest('.feed-item[data-id]');
        if (feedItem) {
            vscode.postMessage({ command: 'openNode', id: feedItem.dataset.id });
            return;
        }

        // Recent item → open note
        var recentItem = e.target.closest('.recent-item[data-id]');
        if (recentItem) {
            vscode.postMessage({ command: 'openNode', id: recentItem.dataset.id });
            return;
        }

        // Action button or chip → run command
        var btn = e.target.closest('[data-command]');
        if (btn) {
            vscode.postMessage({ command: 'runCommand', id: btn.dataset.command });
            return;
        }

        // Nudge card → run action
        var nudge = e.target.closest('.nudge-card[data-action]');
        if (nudge) {
            vscode.postMessage({ command: nudge.dataset.action });
            return;
        }

        // Dismiss welcome bar
        var dismiss = e.target.closest('[data-action="dismissWelcome"]');
        if (dismiss) {
            var bar = document.querySelector('.welcome-bar');
            if (bar) bar.classList.add('dismissed');
            return;
        }
    });
}());
