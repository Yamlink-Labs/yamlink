'use strict';
// Read-only index accessors.
// Feature modules that only need to query the index should import from here
// instead of directly from core/index. This keeps the mutation surface
// (buildIndex, updateSingleFile, removeFileFromIndex) isolated in core/index
// and gives one place to add instrumentation or swap storage later.

const {
    getIndex,
    getPathIndex,
    getFieldsCache,
    getAliasIndex,
    getDuplicateIds,
    getVaultGeneration,
    parseFrontmatter
} = require('./index');

module.exports = {
    getIndex,
    getPathIndex,
    getFieldsCache,
    getAliasIndex,
    getDuplicateIds,
    getVaultGeneration,
    parseFrontmatter
};
