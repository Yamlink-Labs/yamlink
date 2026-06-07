'use strict';

// Natural language → !view query generator.
//
// No AI. No LLM. Two layers:
//   1. ~15 sentence patterns (hardcoded English structures)
//   2. Vault vocabulary injection — type, field, status, and note ID slots
//      are filled entirely from this vault's type registry, field bundles,
//      workflow values, and ID index.
//
// Works for any vault vocabulary: "kommandants", "starships", "missions" all
// resolve the same way "contacts", "projects", "tasks" do — because the
// vocabulary comes from the vault, not from a hardcoded list.
//
// Standard !view syntax is completely unchanged. This generates that syntax
// as a learning path for new users; power users continue writing blocks directly.

/**
 * @typedef {{ types: string[], fields: string[], workflowFields: Map<string,{values:string[]}>, noteIds: string[] }} NlVocab
 * @typedef {{ query: string, explanation: string, confidence: 'high'|'medium' }} NlResult
 */

// ── Vocabulary matching ────────────────────────────────────────────────────

function _norm(s) { return String(s || '').trim().toLowerCase(); }

/**
 * Find the best match for a raw token in a vocabulary list.
 * Tries: exact → singular (strip -s / -es / -ies) → prefix.
 * Returns null when nothing matches.
 *
 * @param {string} token
 * @param {string[]} vocab
 * @returns {string|null}
 */
function matchVocab(token, vocab) {
    if (!token || !vocab.length) return null;
    const t = _norm(token);
    const exact = vocab.find(v => _norm(v) === t);
    if (exact) return exact;
    // Pluralisation variants
    const singular =
        t.endsWith('ies') ? t.slice(0, -3) + 'y' :
        t.endsWith('es')  ? t.slice(0, -2) :
        t.endsWith('s')   ? t.slice(0, -1) : t;
    const singMatch = vocab.find(v => _norm(v) === singular);
    if (singMatch) return singMatch;
    // Prefix match (user typed beginning of a word)
    if (t.length >= 3) {
        const prefix = vocab.find(v => _norm(v).startsWith(t) || t.startsWith(_norm(v)));
        if (prefix) return prefix;
    }
    return null;
}

/**
 * Find a status value in workflowFields that matches a token.
 * @param {string} token
 * @param {Map<string,{values:string[]}>} workflowFields
 * @returns {string|null}
 */
function matchStatus(token, workflowFields) {
    const t = _norm(token);
    for (const { values } of (workflowFields || new Map()).values()) {
        const hit = values.find(v => _norm(v) === t);
        if (hit) return hit;
    }
    return null;
}

/**
 * Find a note ID matching a token (exact or contains).
 * @param {string} token
 * @param {string[]} noteIds
 * @returns {string|null}
 */
function matchNoteId(token, noteIds) {
    const t = _norm(token);
    return noteIds.find(id => _norm(id) === t || _norm(id).includes(t)) || null;
}

// ── Sentence normalisation ─────────────────────────────────────────────────

const FILLER = /^(?:show|list|find|get|display|give|me|all|my|the|a|an|some|any|please)$/;

function normalise(input) {
    return String(input || '')
        .toLowerCase()
        .replace(/['".,!?;:]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// ── Pattern definitions ────────────────────────────────────────────────────
// Each pattern: { re: RegExp, build: (match, vocab) → NlResult | null }
// Tried in order — most specific patterns first.

/** @type {Array<{re: RegExp, build: (m: RegExpExecArray, v: NlVocab) => NlResult|null}>} */
const PATTERNS = [

    // "stale X" / "old X" (no date specified → 30 days)
    {
        re: /^(?:stale|old)\s+(\w[\w-]*)s?$/,
        build([, tok], v) {
            const type = matchVocab(tok, v.types);
            if (!type) return null;
            return { query: `!view ${type}\nwhere file.modified < days-ago(30)`, explanation: `${type} notes not modified in 30 days`, confidence: 'high' };
        }
    },

    // "X overdue"
    {
        re: /^(\w[\w-]*)s?\s+overdue$/,
        build([, tok], v) {
            const type = matchVocab(tok, v.types);
            if (!type) return null;
            return { query: `!view ${type}\nwhere due < today()`, explanation: `${type} notes that are overdue`, confidence: 'high' };
        }
    },

    // "X due today" / "X due this week" / "X due soon"
    {
        re: /^(\w[\w-]*)s?\s+due\s+(today|this\s+week|soon|this\s+month)$/,
        build([, tok, when], v) {
            const type = matchVocab(tok, v.types);
            if (!type) return null;
            if (when === 'today')          return { query: `!view ${type}\nwhere due = today()`,              explanation: `${type} notes due today`,          confidence: 'high' };
            if (when.includes('month'))    return { query: `!view ${type}\nwhere due < days-from-now(30)`,   explanation: `${type} notes due this month`,      confidence: 'high' };
            return                                { query: `!view ${type}\nwhere due < days-from-now(7)`,    explanation: `${type} notes due this week`,       confidence: 'high' };
        }
    },

    // "X I haven't updated in N days" / "X not modified in N days"
    {
        re: /^(\w[\w-]*)s?\s+(?:i\s+)?(?:haven'?t|not|without|un(?:modified|updated|touched))\s+(?:been\s+)?(?:updated|modified|touched|edited)\s+in\s+(\d+)\s+days?$/,
        build([, tok, days], v) {
            const type = matchVocab(tok, v.types);
            if (!type) return null;
            return { query: `!view ${type}\nwhere file.modified < days-ago(${days})`, explanation: `${type} notes not modified in ${days} days`, confidence: 'high' };
        }
    },

    // "X linked to Y" / "X about Y" / "X for Y" / "X mentioning Y"
    {
        re: /^(\w[\w-]*)s?\s+(?:linked\s+to|about|for|mentioning|connected\s+to|related\s+to|via)\s+([\w-]+)$/,
        build([, typeTok, idTok], v) {
            const type   = matchVocab(typeTok, v.types);
            const noteId = matchNoteId(idTok, v.noteIds);
            if (!type || !noteId) return null;
            return { query: `!view ${type}\nvia ${noteId}`, explanation: `${type} notes linked to "${noteId}"`, confidence: 'high' };
        }
    },

    // "X without Y" / "X missing Y" / "X with no Y"
    {
        re: /^(\w[\w-]*)s?\s+(?:without|missing|with\s+no|lacking)\s+([\w-]+)$/,
        build([, typeTok, fieldTok], v) {
            const type  = matchVocab(typeTok, v.types);
            const field = matchVocab(fieldTok, v.fields);
            if (!type || !field) return null;
            return { query: `!view ${type}\nwhere ${field} is empty`, explanation: `${type} notes missing "${field}"`, confidence: 'high' };
        }
    },

    // "X with Y" / "X that have Y"
    {
        re: /^(\w[\w-]*)s?\s+(?:with\s+(?:a\s+)?|that\s+have\s+|that\s+has\s+)([\w-]+)$/,
        build([, typeTok, fieldTok], v) {
            const type  = matchVocab(typeTok, v.types);
            const field = matchVocab(fieldTok, v.fields);
            if (!type || !field) return null;
            return { query: `!view ${type}\nwhere ${field} exists`, explanation: `${type} notes with "${field}" set`, confidence: 'high' };
        }
    },

    // "group X by Y" / "X grouped by Y" / "X by Y"
    {
        re: /^(?:group\s+)?(\w[\w-]*)s?\s+(?:grouped\s+)?by\s+([\w-]+)$/,
        build([, typeTok, fieldTok], v) {
            const type  = matchVocab(typeTok, v.types);
            const field = matchVocab(fieldTok, v.fields);
            if (!type || !field) return null;
            return { query: `!view ${type}\ngroup by ${field}`, explanation: `${type} notes grouped by "${field}"`, confidence: 'high' };
        }
    },

    // "recent X" / "latest X" / "X from this week" / "X this week"
    {
        re: /^(?:recent|latest|new)\s+(\w[\w-]*)s?$|^(\w[\w-]*)s?\s+(?:from\s+)?this\s+week$/,
        build([, tok1, tok2], v) {
            const type = matchVocab(tok1 || tok2, v.types);
            if (!type) return null;
            return { query: `!view ${type}\nwhere file.modified > days-ago(7)\nsort file.modified desc`, explanation: `${type} notes from the last 7 days`, confidence: 'high' };
        }
    },

    // "X from today" / "today's X"
    {
        re: /^(?:today'?s?\s+)?(\w[\w-]*)s?\s*(?:from\s+today)?$/,
        build([, tok], v) {
            // Only fires when "today" was literally in the input — guard with a flag
            return null; // handled by caller that strips filler + checks 'today' token
        }
    },

    // "X that are STATUS" / "X that is STATUS" / "X which are STATUS"
    {
        re: /^(\w[\w-]*)s?\s+(?:that|which)\s+(?:are|is)\s+([\w-]+)$/,
        build([, typeTok, sv], v) {
            const type = matchVocab(typeTok, v.types);
            if (!type) return null;
            const status = matchStatus(sv, v.workflowFields);
            if (status) return { query: `!view ${type}\nwhere status = ${status}`, explanation: `${type} notes with status "${status}"`, confidence: 'high' };
            const field = matchVocab(sv, v.fields);
            if (field) return { query: `!view ${type}\nwhere ${field} exists`, explanation: `${type} notes with "${field}" set`, confidence: 'medium' };
            return null;
        }
    },

    // "STATUS X" — a known status value + a type (e.g., "active projects", "done tasks")
    {
        re: /^([\w-]+)\s+(\w[\w-]*)s?$/,
        build([, tok1, tok2], v) {
            const type    = matchVocab(tok2, v.types);
            if (!type) return null;
            const status  = matchStatus(tok1, v.workflowFields);
            if (status)   return { query: `!view ${type}\nwhere status = ${status}`, explanation: `${type} notes with status "${status}"`, confidence: 'high' };
            const field   = matchVocab(tok1, v.fields);
            if (field)    return { query: `!view ${type}\nwhere ${field} exists`, explanation: `${type} notes with "${field}" set`, confidence: 'medium' };
            return null;
        }
    },

    // Bare type: "all contacts" / "show contacts" / just "contacts"
    {
        re: /^(?:(?:show|list|find|get|display)\s+)?(?:me\s+)?(?:all\s+)?(\w[\w-]*)s?$/,
        build([, tok], v) {
            const type = matchVocab(tok, v.types);
            if (!type) return null;
            return { query: `!view ${type}`, explanation: `All ${type} notes`, confidence: 'medium' };
        }
    },
];

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse a plain-English query description into a Yamlink !view clause.
 *
 * @param {string} input   — raw user input
 * @param {NlVocab} vocab  — vault vocabulary (types, fields, workflowFields, noteIds)
 * @returns {NlResult|null}  — null means no pattern matched
 */
function parseNaturalQuery(input, vocab) {
    if (!input || !vocab) return null;

    // Special: "today" keyword before removing fillers — handle "X due today" separately
    const hasToday   = /\btoday\b/i.test(input);
    const hasDue     = /\bdue\b/i.test(input);

    // Normalise: remove punctuation, collapse whitespace
    let norm = normalise(input);

    // Also try: remove filler words so "show me all active projects" → "active projects"
    const stripped = norm.split(' ').filter(t => !FILLER.test(t)).join(' ');

    for (const p of PATTERNS) {
        for (const candidate of [norm, stripped]) {
            const m = p.re.exec(candidate);
            if (!m) continue;
            const result = p.build(m, vocab);
            if (result) return result;
        }
    }

    // Fallback: if input contains "today" + a recognisable type
    if (hasToday && !hasDue) {
        const tokens = stripped.split(' ').filter(t => t !== 'today' && !FILLER.test(t));
        for (const tok of tokens) {
            const type = matchVocab(tok, vocab.types);
            if (type) {
                return { query: `!view ${type}\nwhere file.modified = today()`, explanation: `${type} notes modified today`, confidence: 'medium' };
            }
        }
    }

    return null;
}

/**
 * Quick list of example queries the user can pick from.
 * Used to populate the input box placeholder and a "try these" list.
 *
 * @param {string[]} types  — vault types
 * @returns {string[]}
 */
function exampleQueries(types) {
    const t = types.find(tp => !['schema', 'template'].includes(tp)) || 'contact';
    return [
        `active ${t}s`,
        `recent ${t}s`,
        `${t}s I haven't updated in 30 days`,
        `${t}s without a status`,
        `${t}s grouped by status`,
    ];
}

module.exports = { parseNaturalQuery, matchVocab, exampleQueries };
