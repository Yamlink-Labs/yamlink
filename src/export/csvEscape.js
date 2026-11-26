'use strict';
// Shared CSV cell escaping — used by both the CLI's `yamlink export --format
// csv` (src/cli/commands/export.js) and the View Panel's CSV export
// (src/features/viewPanel.js), which previously each hand-rolled their own
// copy of this exact logic with no formula-injection guard in either.

/**
 * Escapes one CSV cell value, both for CSV syntax (quoting a value that
 * contains a comma/quote/newline) and for spreadsheet formula injection: a
 * cell whose content starts with `=`, `+`, `-`, `@`, a tab, or a carriage
 * return is interpreted as a live formula by Excel/LibreOffice/Google Sheets
 * when the file is opened there — a vault note's own field value (title,
 * free-text field, imported data) can trivially start with any of these
 * characters with no malicious intent at all, so this isn't a hypothetical
 * attacker-only scenario. OWASP's documented mitigation is prefixing such a
 * value with a single quote, which these spreadsheet applications render as
 * plain leading-apostrophe formatting rather than evaluating as a formula —
 * a real, acknowledged trade-off (the literal apostrophe is occasionally
 * visible depending on the application/version) rather than a perfect fix,
 * but it is the standard one.
 * @param {*} value
 * @returns {string}
 */
function escapeCsvValue(value) {
    const raw = String(value ?? '');
    const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return /[",\n]/.test(guarded) ? '"' + guarded.replace(/"/g, '""') + '"' : guarded;
}

module.exports = { escapeCsvValue };
