'use strict';
// Pure (no vscode) completion helpers split into context and relation modules.

const CLAUSE_KEYWORDS = ['select', 'where', 'sort', 'limit', 'via'];
const SIMPLE_VIEW_TYPES = ['*', 'task', 'tasks', 'calendar', 'today', 'upcoming', 'agenda'];
const context = require('./completionContextHelpers');
const adaptive = require('./completionAdaptiveHelpers');
const relations = require('./completionRelationHelpers');

module.exports = {
    // Constants
    CLAUSE_KEYWORDS,
    SIMPLE_VIEW_TYPES,
    ...context,
    ...adaptive,
    ...relations
};
