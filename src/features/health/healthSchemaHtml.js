'use strict';

const { helpTip } = require('./healthHelp');

function buildSchemaSectionHtml(stats, escapeFn) {
    const e = escapeFn;
    const si = stats.schemaIntelligence;
    const hasAnySchema = stats.schemas > 0;

    if (!hasAnySchema) {
        return `
    <div class="section" id="section-schema">
        <div class="section-header">
            <span class="section-title-row"><span class="section-title">Schema Coverage</span>${helpTip('schemaCoverage', e)}</span>
            <span class="section-count">0 schemas</span>
        </div>
        <div class="empty-section">
            <div class="empty-title">No schemas defined yet.</div>
            <div class="empty-copy">Create a note with <code>type: schema</code> and a <code>target:</code> field to define expected structure for a note type. Yamlink will then show conformance analysis for that type here.</div>
        </div>
    </div>`;
    }

    // Coverage rows — one per schema type
    const coverageRows = (si?.coverage || []).map(({ type, total, conformant, nonConformant, requiredCount, notesWithMissing }) => {
        const pct = total > 0 && requiredCount > 0 ? Math.round(conformant / total * 100) : null;
        const pctColor = pct === null ? 'var(--dim)' : pct === 100 ? 'var(--accent)' : pct >= 75 ? 'var(--accent3)' : 'var(--danger)';
        const conformanceNote = requiredCount === 0
            ? `<span style="font-size:12px;color:var(--dim)">No required fields — schema defines shape only</span>`
            : pct === null
                ? `<span style="font-size:12px;color:var(--dim)">No notes of this type yet</span>`
                : `<span class="schema-pct" style="color:${pctColor}">${pct}%</span><span style="font-size:11px;color:var(--mid)">${conformant} of ${total} note${total !== 1 ? 's' : ''} have all required fields</span>`;
        const pills = notesWithMissing.map(n =>
            `<span class="node-pill drift-pill" data-id="${e(n.noteId)}" title="missing: ${e(n.missingFields.join(', '))}">${e(n.noteId)}</span>`
        ).join('');
        return `<div class="schema-coverage-row">
            <div class="schema-coverage-head">
                <span class="schema-type-label">${e(type)}</span>
                <div class="schema-coverage-meta">
                    ${total > 0 ? `<span class="type-count">${total} note${total !== 1 ? 's' : ''}</span>` : ''}
                    ${total > 0 ? `<button class="view-btn" data-query="!view ${e(type)}" data-label="${e(type)}">View all →</button>` : ''}
                </div>
            </div>
            <div class="schema-coverage-stats">${conformanceNote}</div>
            ${pills ? `<div class="node-pills" style="margin-top:8px">${pills}</div>` : ''}
        </div>`;
    }).join('');

    // Advisory: unschematized types with notes (only shown when ≥1 schema exists)
    const advisories = si?.advisories || [];
    const advisoryHtml = advisories.length > 0
        ? `<div class="schema-advisories">
            <div class="schema-advisories-label">Unschematized types</div>
            ${advisories.map(({ type, count }) =>
                `<div class="schema-advisory">
                    <span class="advisory-count">${count}</span>
                    <span class="advisory-text"><strong>${e(type)}</strong> note${count !== 1 ? 's' : ''} — no schema defined</span>
                    <button class="view-btn" data-query="!view ${e(type)}" data-label="${e(type)}">View →</button>
                </div>`
            ).join('')}
        </div>`
        : '';

    // Dangling relations: schema relation fields whose target type has no vault notes
    const dangling = si?.danglingRelations || [];
    const danglingHtml = dangling.length > 0
        ? `<div class="schema-advisories" style="margin-top:10px">
            <div class="schema-advisories-label" style="color:var(--warn)">Cross-schema warnings</div>
            ${dangling.map(({ schemaType, field, targetType }) =>
                `<div class="schema-advisory advisory-warn">
                    <span class="advisory-text">Schema <strong>${e(schemaType)}</strong> field <code>${e(field)}</code> targets <strong>${e(targetType)}</strong> — no notes of this type exist in the vault</span>
                </div>`
            ).join('')}
        </div>`
        : '';

    const coverageCount = si?.coverage?.length ?? 0;
    return `
    <div class="section" id="section-schema">
        <div class="section-header">
            <span class="section-title-row"><span class="section-title">Schema Coverage</span>${helpTip('schemaCoverage', e)}</span>
            <span class="section-count">${coverageCount} schema${coverageCount !== 1 ? 's' : ''} active</span>
        </div>
        ${coverageRows || `<div class="empty-section"><div class="empty-title">Schemas exist but no matching notes found.</div></div>`}
        ${advisoryHtml}
        ${danglingHtml}
    </div>`;
}

module.exports = { buildSchemaSectionHtml };
