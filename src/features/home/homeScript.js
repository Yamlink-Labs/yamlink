// src/features/home/homeScript.js
// Browser-side JS for the Yamlink Home panel webview

(function () {
    'use strict';

    var vscode = acquireVsCodeApi();

    // ── Tab switching ────────────────────────────────────────────────
    function switchTab(tabId) {
        document.querySelectorAll('.tab-btn').forEach(function (btn) {
            var isActive = btn.dataset.tab === tabId;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        document.querySelectorAll('.tab-content').forEach(function (panel) {
            panel.classList.toggle('active', panel.id === 'tab-' + tabId);
        });
    }

    // ── Heatmap hover tooltip ─────────────────────────────────────────
    var heatTooltip = document.getElementById('heat-tooltip');

    document.addEventListener('mousemove', function (e) {
        if (!heatTooltip) return;
        var cell = e.target.closest('rect[data-date]');
        if (!cell) {
            heatTooltip.style.display = 'none';
            return;
        }
        var date  = cell.dataset.date;
        var count = parseInt(cell.dataset.count, 10) || 0;
        var label = count === 0
            ? date + ' — no activity'
            : date + ' · ' + count + ' change' + (count !== 1 ? 's' : '');
        heatTooltip.textContent = label;
        heatTooltip.style.display = 'block';
        heatTooltip.style.left = (e.clientX + 14) + 'px';
        heatTooltip.style.top  = (e.clientY - 32) + 'px';
    });

    // ── Click router ─────────────────────────────────────────────────
    document.addEventListener('click', function (e) {
        // Tab button
        var tabBtn = e.target.closest('.tab-btn[data-tab]');
        if (tabBtn) {
            switchTab(tabBtn.dataset.tab);
            return;
        }

        // Projection strip → switch to stats tab
        var projStrip = e.target.closest('[data-action="switchTab"]');
        if (projStrip) {
            switchTab(projStrip.dataset.tab || 'stats');
            return;
        }

        // Task item → open note
        var taskItem = e.target.closest('.task-item[data-id]');
        if (taskItem) {
            vscode.postMessage({ command: 'openNode', id: taskItem.dataset.id });
            return;
        }

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

        // Action button or chip → run VSCode command
        var btn = e.target.closest('[data-command]');
        if (btn) {
            vscode.postMessage({ command: 'runCommand', id: btn.dataset.command });
            return;
        }

        // Nudge card action
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
