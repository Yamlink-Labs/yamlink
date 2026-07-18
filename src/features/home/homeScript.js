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

    // ── Chart hover tooltip — shared across all Stats-tab charts ───────
    // Heatmap cells carry their own data-date/data-count (richer per-day
    // formatting); every other chart element (Link Density bars, Growth
    // sparkline points) carries a plain data-tip string. Same tooltip div,
    // same follow-cursor positioning, for consistent hover behavior everywhere.
    var heatTooltip = document.getElementById('heat-tooltip');

    function showChartTooltip(text, e) {
        heatTooltip.textContent = text;
        heatTooltip.style.display = 'block';
        // Clamp inside the viewport — a tooltip near the right/bottom edge
        // (e.g. the last point of a chart) was getting cut off by the
        // window boundary instead of flipping to the other side of the cursor.
        var margin = 8;
        var width = heatTooltip.offsetWidth;
        var height = heatTooltip.offsetHeight;
        var left = e.clientX + 14;
        if (left + width > window.innerWidth - margin) {
            left = e.clientX - 14 - width;
        }
        left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
        var top = e.clientY - 32;
        if (top < margin) top = e.clientY + 18;
        top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
        heatTooltip.style.left = left + 'px';
        heatTooltip.style.top = top + 'px';
    }

    document.addEventListener('mousemove', function (e) {
        if (!heatTooltip) return;

        var cell = e.target.closest('rect[data-date]');
        if (cell) {
            var date  = cell.dataset.date;
            var count = parseInt(cell.dataset.count, 10) || 0;
            var label = count === 0
                ? date + ' — no activity'
                : date + ' · ' + count + ' change' + (count !== 1 ? 's' : '');
            showChartTooltip(label, e);
            return;
        }

        var tipEl = e.target.closest('[data-tip]');
        if (tipEl) {
            showChartTooltip(tipEl.dataset.tip, e);
            return;
        }

        heatTooltip.style.display = 'none';
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

        // Vault Projections metric toggle (Growth / Stale / Structure)
        var projToggle = e.target.closest('[data-proj-toggle]');
        if (projToggle) {
            e.stopPropagation();
            var projCard = projToggle.closest('.proj-dashboard-card');
            if (!projCard) return;
            var key = projToggle.dataset.projToggle;
            projCard.querySelectorAll('[data-proj-toggle]').forEach(function (b) { b.classList.toggle('active', b === projToggle); });
            projCard.querySelectorAll('[data-proj-panel]').forEach(function (p) { p.style.display = p.dataset.projPanel === key ? 'flex' : 'none'; });
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
