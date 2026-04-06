'use strict';

const MONTHS = new Map([
    ['jan', 1], ['january', 1],
    ['feb', 2], ['february', 2],
    ['mar', 3], ['march', 3],
    ['apr', 4], ['april', 4],
    ['may', 5],
    ['jun', 6], ['june', 6],
    ['jul', 7], ['july', 7],
    ['aug', 8], ['august', 8],
    ['sep', 9], ['sept', 9], ['september', 9],
    ['oct', 10], ['october', 10],
    ['nov', 11], ['november', 11],
    ['dec', 12], ['december', 12]
]);

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
    if (
        dt.getUTCFullYear() !== y ||
        dt.getUTCMonth() !== m - 1 ||
        dt.getUTCDate() !== d
    ) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
}

function normaliseYearFirst(match) {
    return toIsoDate(match[1], match[2], match[3]);
}

function normaliseDayOrMonthFirst(match) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const year = Number(match[3]);
    if (a > 12 && b <= 12) return toIsoDate(year, b, a);
    if (b > 12 && a <= 12) return toIsoDate(year, a, b);
    return toIsoDate(year, b, a);
}

function normaliseTextualMonth(match, dayFirst) {
    const monthToken = String(dayFirst ? match[2] : match[1]).toLowerCase();
    const month = MONTHS.get(monthToken);
    if (!month) return null;
    const day = dayFirst ? match[1] : match[2];
    const year = match[3];
    return toIsoDate(year, month, day);
}

function normaliseDateInput(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (match) return normaliseYearFirst(match);

    match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (match) return normaliseDayOrMonthFirst(match);

    match = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (match) return normaliseTextualMonth(match, false);

    match = raw.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
    if (match) return normaliseTextualMonth(match, true);

    return null;
}

function extractDateFromText(text) {
    const raw = String(text ?? '');
    const patterns = [
        /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b/,
        /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b/,
        /\b([A-Za-z]+\s+\d{1,2},?\s+\d{4})\b/,
        /\b(\d{1,2}\s+[A-Za-z]+,?\s+\d{4})\b/
    ];

    for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (!match) continue;
        const iso = normaliseDateInput(match[1]);
        if (iso) return iso;
    }
    return '';
}

function isDateLike(value) {
    return !!normaliseDateInput(value);
}

function getTodayIsoLocal() {
    const now = new Date();
    return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function addDaysIso(isoDate, days) {
    const match = String(isoDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
    return toIsoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

module.exports = {
    normaliseDateInput,
    extractDateFromText,
    isDateLike,
    getTodayIsoLocal,
    addDaysIso
};
