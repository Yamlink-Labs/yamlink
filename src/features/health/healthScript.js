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

/* ── Chart hover tooltip (Vault Projections growth chart / trend bars) ── */
const heatTooltip = document.getElementById('heat-tooltip');

function showChartTooltip(text, e) {
    if (!heatTooltip) return;
    heatTooltip.textContent = text;
    heatTooltip.style.display = 'block';
    // Clamp inside the viewport — a tooltip near the right/bottom edge (e.g.
    // the last point of a chart) was getting cut off by the window boundary
    // instead of flipping to the other side of the cursor.
    const margin = 8;
    const width = heatTooltip.offsetWidth;
    const height = heatTooltip.offsetHeight;
    let left = e.clientX + 14;
    if (left + width > window.innerWidth - margin) {
        left = e.clientX - 14 - width;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    let top = e.clientY - 32;
    if (top < margin) top = e.clientY + 18;
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    heatTooltip.style.left = left + 'px';
    heatTooltip.style.top = top + 'px';
}

document.addEventListener('mousemove', e => {
    if (!heatTooltip) return;
    const tipEl = e.target.closest('[data-tip]');
    if (tipEl) {
        showChartTooltip(tipEl.dataset.tip, e);
        return;
    }
    heatTooltip.style.display = 'none';
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
    // Buttons with an explicit data-action (e.g. "Create schema from cluster")
    // are handled by their own dedicated listener elsewhere in this page —
    // don't also treat them as a generic "open view" button.
    if (btn && !btn.dataset.action) {
        e.stopPropagation();
        vscode.postMessage({ command: 'openView', query: btn.dataset.query, label: btn.dataset.label });
        return;
    }

    const header = e.target.closest('.type-header');
    if (header) {
        const block = header.closest('.type-block');
        block.classList.toggle('open');
    }

    const projToggle = e.target.closest('[data-proj-toggle]');
    if (projToggle) {
        e.stopPropagation();
        const card = projToggle.closest('.proj-dashboard-card');
        if (!card) return;
        const key = projToggle.dataset.projToggle;
        card.querySelectorAll('[data-proj-toggle]').forEach(btn => btn.classList.toggle('active', btn === projToggle));
        card.querySelectorAll('[data-proj-panel]').forEach(panel => {
            panel.style.display = panel.dataset.projPanel === key ? 'flex' : 'none';
        });
    }
});
