'use strict';

function getQueryBuilderClientScript(payload) {
    return `    const vscode = acquireVsCodeApi();
    const els = {
      heroMeta: document.getElementById('hero-meta'),
      builderTabs: Array.from(document.querySelectorAll('[data-builder-tab]')),
      builderPanels: Array.from(document.querySelectorAll('.builder-panel')),
      modeButtons: Array.from(document.querySelectorAll('[data-mode]')),
      type: document.getElementById('field-type'),
      taskPreset: document.getElementById('field-task-preset'),
      label: document.getElementById('field-label'),
      selectMode: document.getElementById('field-select-mode'),
      selectModeButtons: Array.from(document.querySelectorAll('[data-select-mode]')),
      columnsHelp: document.getElementById('columns-help'),
      groupBy: document.getElementById('field-group-by'),
      via: document.getElementById('field-via'),
      whereField: document.getElementById('field-where-field'),
      whereOperator: document.getElementById('field-where-operator'),
      whereValue: document.getElementById('field-where-value'),
      sortField: document.getElementById('field-sort-field'),
      sortDirection: document.getElementById('field-sort-direction'),
      limit: document.getElementById('field-limit'),
      filterSection: document.getElementById('filter-section'),
      sortSection: document.getElementById('sort-section'),
      customSection: document.getElementById('custom-fields-section'),
      layoutSection: document.getElementById('layout-section'),
      advancedSection: document.getElementById('advanced-section'),
      filterBadge: document.getElementById('filter-badge'),
      sortBadge: document.getElementById('sort-badge'),
      customBadge: document.getElementById('custom-badge'),
      layoutBadge: document.getElementById('layout-badge'),
      layoutState: document.getElementById('layout-state'),
      filterState: document.getElementById('filter-state'),
      sortState: document.getElementById('sort-state'),
      customState: document.getElementById('custom-state'),
      advancedState: document.getElementById('advanced-state'),
      customWrap: document.getElementById('field-custom-select-wrap'),
      customFieldList: document.getElementById('custom-field-list'),
      typeWrap: document.getElementById('field-type-wrap'),
      taskWrap: document.getElementById('field-task-wrap'),
      selectModeWrap: document.getElementById('field-select-mode-wrap'),
      groupWrap: document.getElementById('field-group-wrap'),
      viaWrap: document.getElementById('field-via-wrap'),
      previewTitle: document.getElementById('preview-title'),
      previewDetail: document.getElementById('preview-detail'),
      previewStatus: document.getElementById('preview-status'),
      previewExplanation: document.getElementById('preview-explanation'),
      queryPreview: document.getElementById('query-preview'),
      warningList: document.getElementById('warning-list'),
      sampleList: document.getElementById('sample-list'),
      applyBtn: document.getElementById('apply-btn'),
      copyBtn: document.getElementById('copy-btn'),
      openPreviewBtn: document.getElementById('open-preview-btn'),
      layoutToggle: document.getElementById('layout-toggle'),
      layoutNote: document.getElementById('layout-note'),
      layoutMatrixWrap: document.getElementById('layout-matrix-wrap'),
      layoutMatrixCol: document.getElementById('layout-matrix-col'),
      layoutBarWrap: document.getElementById('layout-bar-wrap'),
      layoutBarGroup: document.getElementById('layout-bar-group'),
      layoutScatterXWrap: document.getElementById('layout-scatter-x-wrap'),
      layoutScatterX: document.getElementById('layout-scatter-x'),
      layoutScatterYWrap: document.getElementById('layout-scatter-y-wrap'),
      layoutScatterY: document.getElementById('layout-scatter-y'),
      presetList: document.getElementById('preset-list')
    };
    let model = null;
    let suppress = false;

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function optionsHtml(values, current, allowBlankLabel = null) {
      const parts = [];
      if (allowBlankLabel !== null) parts.push('<option value="">' + escapeHtml(allowBlankLabel) + '</option>');
      for (const value of values) {
        const selected = String(value) === String(current) ? ' selected' : '';
        parts.push('<option value="' + escapeHtml(value) + '"' + selected + '>' + escapeHtml(value) + '</option>');
      }
      return parts.join('');
    }

    function fieldOptionsHtml(values, current, allowBlankLabel = null, descriptions = {}) {
      const parts = [];
      if (allowBlankLabel !== null) parts.push('<option value="">' + escapeHtml(allowBlankLabel) + '</option>');
      for (const value of values) {
        const description = descriptions[value] || '';
        const selected = String(value) === String(current) ? ' selected' : '';
        const title = description ? ' title="' + escapeHtml(description) + '"' : '';
        const label = description ? value + ' — ' + description : value;
        parts.push('<option value="' + escapeHtml(value) + '"' + selected + title + '>' + escapeHtml(label) + '</option>');
      }
      return parts.join('');
    }

    function iconGlyph(name) {
      const icons = {
        table: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.8"/><path d="M2.5 7.5h11"/><path d="M6 3v10"/><path d="M10 3v10"/></svg>',
        matrix: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.8"/><path d="M2.5 6.5h11"/><path d="M2.5 10h11"/><path d="M6 3v10"/><path d="M10 3v10"/></svg>',
        bar: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13V8"/><path d="M8 13V5"/><path d="M13 13V3"/><path d="M2.5 13.5h11"/></svg>',
        scatter: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5h11"/><path d="M2.5 13.5v-11"/><circle cx="5" cy="9.5" r="1"/><circle cx="8.25" cy="6.25" r="1"/><circle cx="11.5" cy="4.5" r="1"/></svg>',
        ready: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>',
        note: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.25"/><path d="M8 5.5v3.25"/><circle cx="8" cy="11.3" r=".55" fill="currentColor" stroke="none"/></svg>'
      };
      return icons[name] || icons.table;
    }

    function iconHtml(name, className = 'layout-btn-icon') {
      return '<span class="' + className + '">' + iconGlyph(name) + '</span>';
    }

    function readState() {
      const selectedFields = Array.from(els.customFieldList.querySelectorAll('input[type="checkbox"]:checked'))
        .map((input) => input.value);
      const activeMode = els.modeButtons.find((btn) => btn.classList.contains('active'))?.dataset.mode || 'table';
      const selectMode = els.selectModeButtons.find((btn) => btn.classList.contains('active'))?.dataset.selectMode || 'smart';
      return {
        mode: activeMode,
        type: els.type.value,
        taskPreset: els.taskPreset.value,
        label: els.label.value,
        selectMode,
        selectFields: selectedFields,
        groupBy: els.groupBy.value,
        viaField: els.via.value,
        whereField: els.whereField.value,
        whereOperator: els.whereOperator.value,
        whereValue: els.whereValue.value,
        sortField: els.sortField.value,
        sortDirection: els.sortDirection.value,
        limit: Number(els.limit.value || 0),
        renderLayout: els.layoutToggle.querySelector('.layout-btn.active')?.dataset.layout || 'table',
        matrixColType: els.layoutMatrixCol.value,
        scatterX: els.layoutScatterX.value,
        scatterY: els.layoutScatterY.value,
        barGroupBy: els.layoutBarGroup.value
      };
    }

    function postState() {
      if (suppress) return;
      vscode.postMessage({ type: 'stateChanged', state: readState() });
    }

    function renderChips(meta) {
      const chips = [];
      if (meta.modeLabel) chips.push('<span class="chip">' + escapeHtml(meta.modeLabel) + '</span>');
      if (meta.noteId) chips.push('<span class="chip">Context: ' + escapeHtml(meta.noteId) + '</span>');
      if (meta.noteType) chips.push('<span class="chip">Type: ' + escapeHtml(meta.noteType) + '</span>');
      els.heroMeta.innerHTML = chips.join('');
      els.applyBtn.textContent = meta.applyLabel || 'Apply';
    }

    function setBuilderTab(tabId) {
      const target = String(tabId || '1');
      els.builderTabs.forEach((btn) => {
        const active = btn.dataset.builderTab === target;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      els.builderPanels.forEach((panel) => {
        panel.classList.toggle('active', panel.id === 'builder-panel-' + target);
      });
    }

    function renderModel(nextModel) {
      model = nextModel;
      const { state, options, preview, meta } = nextModel;
      suppress = true;

      renderChips(meta);

      els.modeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === state.mode));
      els.type.innerHTML = optionsHtml(options.knownTypes.length ? options.knownTypes : ['*'], state.type);
      els.taskPreset.innerHTML = optionsHtml(['tasks','open-tasks','done-tasks','overdue','undated-tasks','calendar','today','upcoming'], state.taskPreset);
      els.label.value = state.label || '';
      els.selectModeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.selectMode === (state.selectMode || 'smart')));
      const fieldDescriptions = options.fieldDescriptions || {};
      els.groupBy.innerHTML = fieldOptionsHtml(options.groupableFields || [], state.groupBy, 'No grouping', fieldDescriptions);
      els.via.innerHTML = optionsHtml(options.relationFieldCandidates || [], state.viaField || '*', 'Any relation field');
      els.whereField.innerHTML = fieldOptionsHtml(options.fieldCandidates || [], state.whereField, 'No filter', fieldDescriptions);
      els.whereOperator.value = state.whereOperator || '=';
      els.whereValue.value = state.whereValue || '';
      els.sortField.innerHTML = fieldOptionsHtml(options.fieldCandidates || [], state.sortField, 'No sort', fieldDescriptions);
      els.sortDirection.value = state.sortDirection || 'asc';
      els.limit.value = String(state.limit || 0);

      const hasFilter = !!(state.whereField && state.whereValue);
      const hasSort = !!(state.sortField || Number(state.limit || 0) > 0);
      const customCount = Array.isArray(state.selectFields) ? state.selectFields.length : 0;
      const activeLayout = state.renderLayout || 'table';
      els.customWrap.classList.toggle('hidden', state.selectMode !== 'custom' || state.mode !== 'table');
      els.customSection.classList.toggle('hidden', state.selectMode !== 'custom' || state.mode !== 'table');
      els.typeWrap.classList.toggle('hidden', state.mode === 'tasks');
      els.taskWrap.classList.toggle('hidden', state.mode !== 'tasks');
      els.selectModeWrap.classList.toggle('hidden', state.mode !== 'table');
      els.groupWrap.classList.toggle('hidden', state.mode !== 'table');
      els.viaWrap.classList.toggle('hidden', state.mode !== 'incoming');
      els.layoutSection.classList.toggle('hidden', state.mode !== 'table');
      els.filterSection.open = hasFilter;
      els.sortSection.open = hasSort;
      if (state.selectMode === 'custom' && state.mode === 'table') {
        els.customSection.open = customCount > 0;
      }
      els.layoutSection.open = state.mode === 'table' && activeLayout !== 'table';
      els.filterBadge.textContent = hasFilter ? '1' : '0';
      els.sortBadge.textContent = String((state.sortField ? 1 : 0) + (Number(state.limit || 0) > 0 ? 1 : 0));
      els.customBadge.textContent = String(customCount);
      els.layoutBadge.textContent = activeLayout;
      els.columnsHelp.textContent = state.selectMode === 'custom'
        ? 'Choose the exact fields Yamlink should surface in the result.'
        : state.selectMode === 'all'
          ? 'Show every observed field for this result set.'
          : 'Start with the fields Yamlink sees most often for this note type.';
      els.filterState.textContent = hasFilter ? (state.whereField + ' ' + (state.whereOperator || '=') + ' ' + state.whereValue) : 'No filters';
      els.sortState.textContent = hasSort
        ? [state.sortField ? ('Sort ' + state.sortField + ' ' + (state.sortDirection || 'asc')) : null, Number(state.limit || 0) > 0 ? ('Limit ' + state.limit) : null].filter(Boolean).join(' · ')
        : 'No sort';
      els.customState.textContent = customCount > 0 ? (customCount + ' fields selected') : 'No custom fields';
      els.advancedState.textContent = state.label ? 'Label set' : 'Optional metadata';

      els.customFieldList.innerHTML = (options.fieldCandidates || []).map((field) => {
        const checked = (state.selectFields || []).includes(field) ? ' checked' : '';
        const description = fieldDescriptions[field] || '';
        const className = description ? 'checkbox-chip computed-field' : 'checkbox-chip';
        const title = description ? ' title="' + escapeHtml(description) + '"' : '';
        const help = description ? '<span class="field-chip-help">' + escapeHtml(description) + '</span>' : '';
        return '<label class="' + className + '"' + title + '><input type="checkbox" value="' + escapeHtml(field) + '"' + checked + ' /> <span class="field-chip-copy"><span>' + escapeHtml(field) + '</span>' + help + '</span></label>';
      }).join('');
      els.presetList.innerHTML = (options.presets || []).map((preset) => {
        return '<button class="preset-btn" type="button" data-preset="' + escapeHtml(preset.key) + '" title="' + escapeHtml(preset.description || '') + '"><strong>' + escapeHtml(preset.label) + '</strong><span>' + escapeHtml(preset.description || '') + '</span></button>';
      }).join('');

      els.previewTitle.textContent = preview.summary?.title || 'Preview';
      els.previewDetail.textContent = preview.summary?.detail || '';
      els.previewExplanation.textContent = preview.summary?.explanation || '';
      els.queryPreview.textContent = preview.queryText || '';
      const layoutSummary = preview.summary?.layouts || { available: [] };
      els.layoutToggle.innerHTML = (layoutSummary.available || []).map((layout) => {
        const active = activeLayout === layout.key ? ' active' : '';
        const disabled = layout.enabled ? '' : ' disabled';
        const title = layout.detail ? ' title="' + escapeHtml(layout.detail) + '"' : '';
        return '<button class="layout-btn' + active + '" data-layout="' + escapeHtml(layout.key) + '"' + disabled + title + '>' + iconHtml(layout.key) + '<span>' + escapeHtml(layout.label) + '</span></button>';
      }).join('');
      const activeLayoutMeta = (layoutSummary.available || []).find((layout) => layout.key === activeLayout) || null;
      els.layoutState.textContent = activeLayoutMeta?.label || 'Table';
      els.layoutNote.textContent = activeLayoutMeta?.detail || 'Choose how to render this query when you open it in Yamlink View.';
      els.layoutMatrixCol.innerHTML = optionsHtml(layoutSummary.matrixColumnTypes || [], state.matrixColType, 'Pick a type…');
      els.layoutBarGroup.innerHTML = optionsHtml(layoutSummary.barFields || [], state.barGroupBy, 'Pick a field…');
      els.layoutScatterX.innerHTML = optionsHtml(layoutSummary.scatterFields || [], state.scatterX, 'Pick a field…');
      els.layoutScatterY.innerHTML = optionsHtml(layoutSummary.scatterFields || [], state.scatterY, 'Pick a field…');
      els.layoutMatrixWrap.classList.toggle('hidden', activeLayout !== 'matrix');
      els.layoutBarWrap.classList.toggle('hidden', activeLayout !== 'bar');
      els.layoutScatterXWrap.classList.toggle('hidden', activeLayout !== 'scatter');
      els.layoutScatterYWrap.classList.toggle('hidden', activeLayout !== 'scatter');
      const warnings = Array.isArray(preview.summary?.warnings) ? preview.summary.warnings : [];
      els.warningList.innerHTML = warnings.length
        ? warnings.map((warning) => '<li>' + escapeHtml(warning) + '</li>').join('')
        : '<li class="preview-empty">No query warnings right now. This query shape looks structurally clean.</li>';
      els.previewStatus.innerHTML = warnings.length
        ? iconHtml('note', 'status-icon') + '<strong>Review recommended</strong><span>' + escapeHtml(warnings[0]) + '</span>'
        : iconHtml('ready', 'status-icon') + '<strong>Ready to insert</strong><span>Query shape looks valid for this result.</span>';
      const sampleRows = Array.isArray(preview.summary?.sampleRows) ? preview.summary.sampleRows : [];
      const preferredFields = state.selectMode === 'custom'
        ? (state.selectFields || [])
        : state.selectMode === 'all'
          ? (options.fieldCandidates || [])
          : Array.isArray(preview.summary?.visibleFields) ? preview.summary.visibleFields : [];
      els.sampleList.innerHTML = sampleRows.length
        ? sampleRows.map((row) => {
            const fieldKeys = preferredFields.length ? preferredFields : Object.keys(row.fields || {});
            const values = fieldKeys
              .filter((key) => key in (row.fields || {}))
              .slice(0, 4)
              .map((key) => ({ key, value: row.fields[key] }));
            const primary = values[0]?.value || row.id;
            const extras = values.slice(1);
            const typePill = row.type ? '<span class="sample-pill">' + escapeHtml(row.type) + '</span>' : '';
            const secondary = extras.map((entry) => '<span>' + escapeHtml(entry.value) + '</span>').join('');
            return '<li><div class="sample-row"><div class="sample-row-primary">' + escapeHtml(primary) + '</div><div class="sample-row-secondary">' + typePill + secondary + '</div></div></li>';
          }).join('')
        : '<li class="preview-empty">No sample rows yet. Change the scope or filters to pull live notes into the preview.</li>';

      suppress = false;
    }

    els.modeButtons.forEach((btn) => btn.addEventListener('click', () => {
      els.modeButtons.forEach((other) => other.classList.toggle('active', other === btn));
      setBuilderTab('2');
      postState();
    }));
    els.builderTabs.forEach((btn) => btn.addEventListener('click', () => {
      setBuilderTab(btn.dataset.builderTab);
    }));
    els.selectModeButtons.forEach((btn) => btn.addEventListener('click', () => {
      els.selectModeButtons.forEach((other) => other.classList.toggle('active', other === btn));
      postState();
    }));
    els.layoutToggle.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-layout]');
      if (!btn || btn.disabled) return;
      els.layoutToggle.querySelectorAll('[data-layout]').forEach((entry) => entry.classList.toggle('active', entry === btn));
      postState();
    });
    [els.type, els.taskPreset, els.label, els.groupBy, els.via, els.whereField, els.whereOperator, els.whereValue, els.sortField, els.sortDirection, els.limit]
      .forEach((el) => {
        el.addEventListener('change', postState);
        el.addEventListener('input', postState);
      });
    [els.layoutMatrixCol, els.layoutBarGroup, els.layoutScatterX, els.layoutScatterY].forEach((el) => {
      el.addEventListener('change', postState);
      el.addEventListener('input', postState);
    });
    els.customFieldList.addEventListener('change', postState);
    els.presetList.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-preset]');
      if (!btn || !model?.options?.presets) return;
      const preset = model.options.presets.find((entry) => entry.key === btn.dataset.preset);
      if (!preset?.patch) return;
      const patch = preset.patch;
      if ('whereField' in patch) els.whereField.value = patch.whereField || '';
      if ('whereOperator' in patch) els.whereOperator.value = patch.whereOperator || '=';
      if ('whereValue' in patch) els.whereValue.value = patch.whereValue || '';
      if ('sortField' in patch) els.sortField.value = patch.sortField || '';
      if ('sortDirection' in patch) els.sortDirection.value = patch.sortDirection || 'asc';
      if (patch.whereField || patch.whereValue) els.filterSection.open = true;
      if (patch.sortField) els.sortSection.open = true;
      postState();
    });
    els.applyBtn.addEventListener('click', () => vscode.postMessage({ type: 'apply' }));
    els.openPreviewBtn.addEventListener('click', () => vscode.postMessage({ type: 'openPreview' }));
    els.copyBtn.addEventListener('click', async () => {
      const query = model?.preview?.queryText || '';
      try {
        await navigator.clipboard.writeText(query);
        vscode.postMessage({ type: 'copied' });
      } catch {
        vscode.postMessage({ type: 'copyFallback', query });
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (msg.type === 'render') renderModel(msg.model);
    });

    vscode.postMessage(${payload});`;
}

module.exports = { getQueryBuilderClientScript };
