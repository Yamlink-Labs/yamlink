'use strict';

// Plain-language definitions for Vault Health terminology — written for
// someone new to Yamlink, not for someone who already knows the codebase.
// Deliberately separate from GLOSSARY.md, which is the precise technical
// reference; this copy trades precision for approachability on purpose.
const HELP_TEXT = {
    activityTab: 'What changed in your vault today — notes created, fields added, links formed.',
    lifecycleTab: 'Groups every note by how far along it is: draft, growing, established, hub, or stale.',
    consistencyTab: 'Flags notes that look structurally different from others of the same type.',
    schemaTab: 'Formal field definitions for a note type, and how well your notes match them.',
    intelligenceTab: 'How much real vault data Yamlink’s suggestion engine has to work with right now, and how confident it is.',
    projectionsTab: 'Where your vault is likely headed over the next 90 days, based on its own history.',
    templatesTab: 'Notes created from a template that are missing fields the template defines.',
    typesTab: 'Every note category in your vault and how many notes use it.',
    orphansTab: 'Notes with no incoming or outgoing links — nothing connects to them yet.',
    todaysActivity: 'Every note you’ve touched today, with how many changes each one got.',
    sessionMemory: 'A plain-language recap of what you did in each recent editing session, grouped automatically by time and topic.',
    lifecycleStates: 'A rough read on how far along a note is: Draft (barely started), Growing (taking shape), Established (looks complete and typical for its kind), Hub (a lot of other notes link to it), or Stale (hasn’t moved in a while).',
    typeConsistency: 'Compares each note to others of the same type and flags ones that look structurally unusual — for example, missing fields most similar notes have.',
    schemaCoverage: 'For each schema you’ve defined, how many matching notes actually have all the fields it expects.',
    intelligenceHealth: 'A snapshot of how much real vault data Yamlink’s suggestion engine has to work with right now — more notes and accepted suggestions make it sharper over time.',
    emergingPatterns: 'Groups of notes that happen to share the same fields, even though nobody defined a type for them yet — Yamlink noticed the pattern on its own.',
    topRelationships: 'The links in your vault with the strongest evidence behind them — either because more than one field points to the same note, or because you’ve set that relationship more than once over time.',
    templateDrift: 'Notes created from a template that are missing one or more fields the template defines.'
};

/** @param {string} key @param {function} escapeFn @returns {string} */
function helpTip(key, escapeFn) {
    const text = HELP_TEXT[key];
    if (!text) return '';
    return `<span class="help-tip" title="${escapeFn(text)}">?</span>`;
}

module.exports = { HELP_TEXT, helpTip };
