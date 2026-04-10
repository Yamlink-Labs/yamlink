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

const WEEKDAYS = new Map([
    ['sun', 0], ['sunday', 0],
    ['mon', 1], ['monday', 1],
    ['tue', 2], ['tues', 2], ['tuesday', 2],
    ['wed', 3], ['wednesday', 3],
    ['thu', 4], ['thur', 4], ['thurs', 4], ['thursday', 4],
    ['fri', 5], ['friday', 5],
    ['sat', 6], ['saturday', 6]
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

function getReferenceDate(referenceDate) {
    if (referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())) return referenceDate;
    const iso = String(referenceDate ?? '').trim();
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
    return new Date();
}

function toIsoFromLocalDate(date) {
    return toIsoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function addLocalDays(date, days) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + Number(days || 0));
    return next;
}

function addLocalMonths(date, months) {
    const year = date.getFullYear();
    const monthIndex = date.getMonth() + Number(months || 0);
    const day = date.getDate();
    const targetYear = year + Math.floor(monthIndex / 12);
    const targetMonth = ((monthIndex % 12) + 12) % 12;
    const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
    return new Date(targetYear, targetMonth, Math.min(day, lastDay));
}

function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function nextWeekendDate(referenceDate, weeksAhead = 0) {
    const base = getReferenceDate(referenceDate);
    const currentWeekday = base.getDay();
    const saturdayOffset = (6 - currentWeekday + 7) % 7;
    const effectiveOffset = saturdayOffset + (Number(weeksAhead || 0) * 7);
    return addLocalDays(base, effectiveOffset);
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

function resolveWeekdayFromReference(token, qualifier, referenceDate) {
    const weekday = WEEKDAYS.get(String(token ?? '').toLowerCase());
    if (weekday === undefined) return null;
    const base = getReferenceDate(referenceDate);
    const currentWeekday = base.getDay();
    let offset = (weekday - currentWeekday + 7) % 7;

    if (qualifier === 'next') {
        offset = offset === 0 ? 7 : offset + 7;
    } else if (qualifier === 'coming') {
        offset = offset === 0 ? 7 : offset;
    } else if (qualifier === 'this') {
        offset = offset === 0 ? 0 : offset;
    } else {
        offset = offset === 0 ? 0 : offset;
    }

    return toIsoFromLocalDate(addLocalDays(base, offset));
}

function extractRelativeDateFromText(text, referenceDate) {
    const raw = String(text ?? '');
    const lowered = raw.toLowerCase();
    const base = getReferenceDate(referenceDate);
    const quantityMatch = lowered.match(/\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/);

    if (/\b(today|tonight)\b/.test(lowered)) return toIsoFromLocalDate(base);
    if (/\btomorrow\b/.test(lowered)) return toIsoFromLocalDate(addLocalDays(base, 1));
    if (/\byesterday\b/.test(lowered)) return toIsoFromLocalDate(addLocalDays(base, -1));
    if (/\bend of (the )?month\b|\beom\b/.test(lowered)) return toIsoFromLocalDate(endOfMonth(base));
    if (/\bnext week\b/.test(lowered)) return toIsoFromLocalDate(addLocalDays(base, 7));
    if (/\bnext month\b/.test(lowered)) return toIsoFromLocalDate(addLocalMonths(base, 1));
    if (/\bthis weekend\b/.test(lowered)) return toIsoFromLocalDate(nextWeekendDate(base, 0));
    if (/\bnext weekend\b/.test(lowered)) return toIsoFromLocalDate(nextWeekendDate(base, 1));

    if (quantityMatch) {
        const amount = Number(quantityMatch[1]);
        const unit = quantityMatch[2];
        if (unit.startsWith('day')) return toIsoFromLocalDate(addLocalDays(base, amount));
        if (unit.startsWith('week')) return toIsoFromLocalDate(addLocalDays(base, amount * 7));
        if (unit.startsWith('month')) return toIsoFromLocalDate(addLocalMonths(base, amount));
    }

    let match = lowered.match(/\b(this|next|coming)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/);
    if (match) return resolveWeekdayFromReference(match[2], match[1], base);

    match = lowered.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/);
    if (match) return resolveWeekdayFromReference(match[1], '', base);

    return '';
}

function extractDateFromText(text, referenceDate) {
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
    return extractRelativeDateFromText(raw, referenceDate);
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
