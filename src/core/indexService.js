'use strict';
// Read-only index accessors. Import from here instead of core/index
// to keep mutation surface (buildIndex, updateSingleFile, removeFileFromIndex) isolated.
// Feature modules that only need to query the index should import from here
// instead of directly from core/index. This keeps the mutation surface
// (buildIndex, updateSingleFile, removeFileFromIndex) isolated in core/index
// and gives one place to add instrumentation or swap storage later.

const {
    getIndex,
    getPathIndex,
    getFieldsCache,
    getAliasIndex,
    getBodyBlockIndex,
    getDuplicateIds,
    getVaultGeneration,
    parseFrontmatter
} = require('./index');

module.exports = {
    getIndex,
    getPathIndex,
    getFieldsCache,
    getAliasIndex,
    getBodyBlockIndex,
    getDuplicateIds,
    getVaultGeneration,
    parseFrontmatter
};
