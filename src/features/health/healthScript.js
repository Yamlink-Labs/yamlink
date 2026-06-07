'use strict';

const vscode = acquireVsCodeApi();

/* ── Tab switching ──────────────────────────────────────────────────── */
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === tabId)
    );
    document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('tab-panel--hidden', p.dataset.tab !== tabId)
    );
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

/* ── Stat strip actions ─────────────────────────────────────────────── */
document.querySelectorAll('.stat-cell[data-action]').forEach(cell => {
    cell.addEventListener('click', () => {
        const action = cell.dataset.action;
        if (action === 'openAllNodes') {
            vscode.postMessage({ command: 'openAllNodes' });
        } else if (action === 'openProblems') {
            vscode.postMessage({ command: 'openProblems' });
        } else if (action === 'switchOrphans') {
            switchTab('orphans');
        } else if (action === 'switchTypes') {
            switchTab('types');
        } else if (action === 'switchSchema') {
            switchTab('schema');
        }
    });
});

/* ── Content interactions ───────────────────────────────────────────── */
document.addEventListener('click', e => {
    const activityRow = e.target.closest('.activity-row');
    if (activityRow) {
        e.stopPropagation();
        vscode.postMessage({ command: 'openNode', id: activityRow.dataset.id });
        return;
    }

    const pill = e.target.closest('.node-pill');
    if (pill) {
        e.stopPropagation();
        vscode.postMessage({ command: 'openNode', id: pill.dataset.id });
        return;
    }

    const btn = e.target.closest('.view-btn');
    if (btn) {
        e.stopPropagation();
        vscode.postMessage({ command: 'openView', query: btn.dataset.query, label: btn.dataset.label });
        return;
    }

    const header = e.target.closest('.type-header');
    if (header) {
        const block = header.closest('.type-block');
        block.classList.toggle('open');
    }
});
