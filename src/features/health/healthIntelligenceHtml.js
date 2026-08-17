'use strict';

const { helpTip } = require('./healthHelp');

function buildIntelligenceHealthHtml(intel, e) {
    if (!intel) return '';

    const { systemConfidence, vaultMaturityPct, lifecycle, drift, arc, calibration, mutationBehavior } = intel;

    const confColor = systemConfidence >= 70 ? 'var(--accent)' : systemConfidence >= 40 ? 'var(--accent3)' : 'var(--danger)';
    const confLabel = systemConfidence >= 70 ? 'System has strong vault evidence to work with.'
        : systemConfidence >= 40 ? 'System is learning — more notes and accepted completions will sharpen it.'
        : 'Vault is sparse. Intelligence features will become more accurate as you build it out.';

    // Lifecycle card
    const lifecycleFlag = lifecycle.staleFlag
        ? `<div class="intel-flag intel-flag--warn">⚠ ${Math.round(lifecycle.staleRate * 100)}% of notes are stale — stale threshold may be too loose for this vault's activity pace.</div>`
        : lifecycle.sparseFlag
            ? `<div class="intel-flag intel-flag--dim">Too few notes for lifecycle states to be meaningful yet.</div>`
            : lifecycle.consolidatedRate > 0.5
                ? `<div class="intel-flag intel-flag--ok">Over half of notes look structurally complete for their type.</div>`
                : '';

    // Drift card
    const driftFlag = drift.noisyFlag
        ? `<div class="intel-flag intel-flag--warn">⚠ ${Math.round(drift.problematicRate * 100)}% of measurable notes are drifting — vault may have structural inconsistency or detector thresholds are too strict.</div>`
        : drift.insufficientCount > drift.total
            ? `<div class="intel-flag intel-flag--dim">Most typed notes don't have enough type-peers for drift to measure yet (need ≥3 notes per type).</div>`
            : drift.total > 0 && drift.drifting === 0 && drift.outliers === 0
                ? `<div class="intel-flag intel-flag--ok">All measurable notes are on-track for their type.</div>`
                : '';
    const driftPills = drift.topDriftingNotes.map(n =>
        `<span class="node-pill ${n.driftLabel === 'outlier' ? 'outlier-pill' : 'drift-pill'}" data-id="${e(n.noteId)}" title="score: ${n.driftScore}">${e(n.noteId)}</span>`
    ).join('');

    // Arc card
    const arcFlag = arc.eligible === 0
        ? `<div class="intel-flag intel-flag--dim">No typed notes with bundle data yet — arc predictions require at least one other note of the same type.</div>`
        : arc.coverageRate < 0.3
            ? `<div class="intel-flag intel-flag--ok">Most notes look complete relative to their type's field bundle.</div>`
            : `<div class="intel-flag intel-flag--dim">${Math.round(arc.coverageRate * 100)}% of sampled notes have at least one likely-missing field surfaced.</div>`;
    const topFieldsHtml = arc.topMissingFields.length
        ? `<div style="margin-top:6px;font-size:11px;color:var(--mid)">Most commonly predicted missing: ${arc.topMissingFields.map(f => `<code>${e(f.field)}</code>`).join(', ')}</div>`
        : '';
    const behaviorCard = mutationBehavior ? `
            <div class="intel-card">
                <div class="intel-card-title">Mutation Behavior</div>
                <div class="intel-card-stats">
                    <span class="intel-stat"><strong>${mutationBehavior.totalSessions}</strong> sessions</span>
                    <span class="intel-stat"><strong>${e(mutationBehavior.dominantFamily)}</strong> dominant lane</span>
                    <span class="intel-stat"><strong>${Math.round((mutationBehavior.coherenceScore || 0) * 100)}%</strong> coherence</span>
                    <span class="intel-stat"><strong>${Math.round((mutationBehavior.appliedRate || 0) * 100)}%</strong> applied</span>
                </div>
                <div class="intel-flag intel-flag--dim">${e(mutationBehavior.summary)}</div>
                ${mutationBehavior.evolution ? `<div style="margin-top:6px;font-size:11px;color:var(--mid)">${e(mutationBehavior.evolution.summary)}</div>` : ''}
                ${mutationBehavior.streaks && mutationBehavior.streaks.length ? `<div style="margin-top:6px;font-size:11px;color:var(--mid)">Top streak: <code>${e(mutationBehavior.streaks[0].family)}</code> · ${e(mutationBehavior.streaks[0].mode)} × ${mutationBehavior.streaks[0].count}</div>` : ''}
            </div>
    ` : '';

    return `
    <div class="section" id="section-intelligence">
        <div class="section-header">
            <span class="section-title-row"><span class="section-title">Intelligence Health</span>${helpTip('intelligenceHealth', e)}</span>
            <span class="section-count" style="color:${confColor}">Confidence ${systemConfidence}%</span>
        </div>

        <div class="intel-confidence">
            <div class="intel-score" style="color:${confColor}">${systemConfidence}<span class="intel-score-pct">%</span></div>
            <div class="intel-confidence-body">
                <div class="intel-confidence-label">System Confidence</div>
                <div class="intel-confidence-sub">${e(confLabel)}</div>
                <div class="intel-meta-row">
                    <span class="intel-meta-item">Vault maturity <strong>${vaultMaturityPct}%</strong></span>
                    <span class="intel-meta-item">Accepted completions <strong>${calibration.totalAccepted}</strong></span>
                    <span class="intel-meta-item">Fields calibrated <strong>${calibration.uniqueFields}</strong></span>
                </div>
            </div>
        </div>

        <div class="intel-grid">
            <div class="intel-card">
                <div class="intel-card-title">Lifecycle Detection</div>
                <div class="intel-card-stats">
                    <span class="intel-stat"><strong>${lifecycle.total}</strong> notes measured</span>
                    <span class="intel-stat"><strong>${Math.round(lifecycle.consolidatedRate * 100)}%</strong> consolidated</span>
                    <span class="intel-stat intel-stat--warn"><strong>${Math.round(lifecycle.staleRate * 100)}%</strong> stale</span>
                    <span class="intel-stat"><strong>${Math.round(lifecycle.draftRate * 100)}%</strong> draft</span>
                </div>
                ${lifecycleFlag}
            </div>

            <div class="intel-card">
                <div class="intel-card-title">Structural Drift</div>
                <div class="intel-card-stats">
                    <span class="intel-stat"><strong>${drift.onTrack}</strong> on-track</span>
                    <span class="intel-stat"><strong>${drift.minorDrift}</strong> minor drift</span>
                    <span class="intel-stat intel-stat--warn"><strong>${drift.drifting}</strong> drifting</span>
                    <span class="intel-stat intel-stat--danger"><strong>${drift.outliers}</strong> outliers</span>
                </div>
                ${drift.insufficientCount > 0 ? `<div style="font-size:10px;color:var(--dim);margin-top:4px">${drift.insufficientCount} note${drift.insufficientCount !== 1 ? 's' : ''} skipped — type too sparse to measure</div>` : ''}
                ${driftFlag}
                ${driftPills ? `<div class="node-pills" style="margin-top:6px">${driftPills}</div>` : ''}
            </div>

            <div class="intel-card">
                <div class="intel-card-title">Arc Predictions</div>
                <div class="intel-card-stats">
                    <span class="intel-stat"><strong>${arc.eligible}</strong> notes eligible</span>
                    <span class="intel-stat"><strong>${arc.withPredictions}</strong> with predictions</span>
                    <span class="intel-stat"><strong>${Math.round(arc.coverageRate * 100)}%</strong> coverage</span>
                </div>
                ${arcFlag}
                ${topFieldsHtml}
            </div>

            ${behaviorCard}
        </div>
    </div>`;
}

function buildEmergingPatternsHtml(stats, escapeFn) {
    const e = escapeFn;
    const clusters = Array.isArray(stats.emergingClusters) ? stats.emergingClusters : [];
    if (!clusters.length) return '';

    return `
    <div class="section" id="section-emerging-patterns">
        <div class="section-header">
            <span class="section-title-row"><span class="section-title">Emerging Patterns</span>${helpTip('emergingPatterns', e)}</span>
            <span class="section-count">${clusters.length} cluster${clusters.length === 1 ? '' : 's'}</span>
        </div>
        <div class="intel-grid">
            ${clusters.map((cluster) => `
                <div class="intel-card">
                    <div class="intel-card-title">${cluster.noteCount} note${cluster.noteCount === 1 ? '' : 's'} share this shape</div>
                    <div class="intel-card-stats">
                        ${cluster.dominantType ? `<span class="intel-stat"><strong>mostly:</strong> ${e(cluster.dominantType)}</span>` : ''}
                        <span class="intel-stat"><strong>confidence:</strong> ${e(String(cluster.confidence || '').toUpperCase())}</span>
                    </div>
                    <div class="node-pills" style="margin-top:8px">
                        ${cluster.fields.map((field) => `<span class="node-pill">${e(field)}</span>`).join('')}
                    </div>
                    <div style="margin-top:10px;font-size:11px;color:var(--mid)">
                        ${cluster.noteIds.slice(0, 4).map((noteId) => `<code>${e(noteId)}</code>`).join(' · ')}
                        ${cluster.noteIds.length > 4 ? ` · +${cluster.noteIds.length - 4} more` : ''}
                    </div>
                    <div style="margin-top:10px">
                        <button
                            class="view-btn"
                            data-action="createSchemaFromCluster"
                            data-fields='${e(JSON.stringify(cluster.fields))}'
                            data-type="${e(cluster.dominantType || '')}"
                            data-note-ids='${e(JSON.stringify(cluster.noteIds))}'
                        >Create schema from cluster →</button>
                    </div>
                </div>
            `).join('')}
        </div>
    </div>`;
}

function buildTopRelationshipsHtml(stats, escapeFn) {
    const e = escapeFn;
    const edges = Array.isArray(stats.topRelationships) ? stats.topRelationships : [];
    if (!edges.length) return '';

    const rows = edges.map((edge) => {
        const signals = [];
        if (edge.structuralWeight > 1) signals.push(`${edge.structuralWeight} shared fields`);
        if (edge.repetition > 0) signals.push(`reaffirmed ${edge.repetition}×`);
        return `<div class="session-row" data-id="${e(edge.sourceId)}">
            <div class="session-main">
                <div class="session-summary"><code>${e(edge.sourceId)}</code> → <code>${e(edge.targetId)}</code></div>
                <div class="session-meta">
                    <span class="session-chip">${e(edge.field)}</span>
                    ${signals.map((s) => `<span class="session-chip">${e(s)}</span>`).join('')}
                </div>
            </div>
        </div>`;
    }).join('');

    return `
    <div class="section" id="section-top-relationships">
        <div class="section-header">
            <span class="section-title-row"><span class="section-title">Most-Reinforced Connections</span>${helpTip('topRelationships', e)}</span>
            <span class="section-count">${edges.length} edge${edges.length === 1 ? '' : 's'}</span>
        </div>
        <div class="empty-copy" style="margin-bottom:10px;color:var(--mid);font-size:12px">Connections the vault's own structure and edit history corroborate most — either through multiple fields pointing at the same note, or the same relation being set more than once over time.</div>
        <div class="session-list">${rows}</div>
    </div>`;
}

module.exports = {
    buildIntelligenceHealthHtml,
    buildEmergingPatternsHtml,
    buildTopRelationshipsHtml
};
