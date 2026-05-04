(function () {
    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function pad2(value) {
        return String(value).padStart(2, '0');
    }

    function toIsoDate(year, month, day) {
        const y = Number(year);
        const m = Number(month);
        const d = Number(day);
        if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
        if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
        const dt = new Date(Date.UTC(y, m - 1, d));
        if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
        return `${y}-${pad2(m)}-${pad2(d)}`;
    }

    function normaliseDateInput(value) {
        const raw = String(value ?? '').trim();
        if (!raw) return null;

        let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
        if (match) return toIsoDate(match[1], match[2], match[3]);

        match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
        if (match) {
            const a = Number(match[1]);
            const b = Number(match[2]);
            if (a > 12 && b <= 12) return toIsoDate(match[3], b, a);
            if (b > 12 && a <= 12) return toIsoDate(match[3], a, b);
            return toIsoDate(match[3], b, a);
        }

        match = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
        if (match) {
            const month = new Date(`${match[1]} 1, 2000`).getMonth() + 1;
            return Number.isInteger(month) && month > 0 ? toIsoDate(match[3], month, match[2]) : null;
        }

        match = raw.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
        if (match) {
            const month = new Date(`${match[2]} 1, 2000`).getMonth() + 1;
            return Number.isInteger(month) && month > 0 ? toIsoDate(match[3], month, match[1]) : null;
        }

        return null;
    }

    function normaliseForDisplay(mode, value) {
        const next = String(value ?? '').trim();
        if (!next) return '';
        if (mode === 'date') {
            return normaliseDateInput(next) || next;
        }
        return next;
    }

    function normaliseOutgoingValue(mode, value) {
        const next = normaliseForDisplay(mode, value);
        if (!next) return '';
        return mode === 'relation' ? `[[${next}]]` : next;
    }

    function renderCellValue(mode, value) {
        const next = normaliseForDisplay(mode, value);
        if (!next) return '-';
        if (mode === 'relation') {
            return `<span class="cell-rel" data-id="${escapeHtml(next)}">${escapeHtml(next)}</span>`;
        }
        if (mode === 'boolean') {
            const isTrue = next.toLowerCase() === 'true';
            return `<span class="cell-bool ${isTrue ? 'true' : 'false'}">${isTrue ? 'True' : 'False'}</span>`;
        }
        return escapeHtml(next);
    }

    function validateValue(cell, value) {
        const mode = cell.dataset.editMode || 'text';
        const next = String(value ?? '').trim();
        if (!next) return { ok: true, value: '' };

        if (mode === 'number' && !/^-?\d+(?:\.\d+)?$/.test(next)) {
            return { ok: false, message: `Expected a number for "${cell.dataset.field}".` };
        }
        if (mode === 'date') {
            const iso = normaliseDateInput(next);
            if (!iso) {
                return { ok: false, message: `Expected a real date for "${cell.dataset.field}".` };
            }
            return { ok: true, value: iso };
        }
        if (mode === 'relation') {
            const exists = Array.from(document.querySelectorAll('#yids option')).some(option => option.value === next);
            if (!exists) {
                return { ok: false, message: `Unknown node "${next}" for relation field "${cell.dataset.field}".` };
            }
        }
        if (mode === 'dropdown') {
            let options = [];
            try { options = JSON.parse(cell.dataset.options || '[]'); } catch (_) {}
            if (options.length > 0 && !options.includes(next)) {
                return { ok: false, message: `Value "${next}" is outside the allowed options for "${cell.dataset.field}".` };
            }
        }

        return { ok: true, value: next };
    }

    window.YamlinkViewPanelValueRuntime = {
        escapeHtml,
        normaliseDateInput,
        normaliseForDisplay,
        normaliseOutgoingValue,
        renderCellValue,
        validateValue
    };
}());
