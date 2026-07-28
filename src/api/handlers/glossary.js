'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getBacklinks } = require('../../core/graph');
const { buildGlossaryEntries, groupGlossaryEntries } = require('../../intelligence/glossary');
const { json, badRequest, methodNotAllowed } = require('../http');

/**
 * `?types=a,b` is required — same as the CLI's `--type` flag and VS Code's
 * `yamlink.glossaryTypes` setting, Yamlink can't guess which note type(s)
 * count as glossary terms, so it asks rather than guesses.
 */
async function handleGlossary(req, res, url) {
    if (req.method !== 'GET') { methodNotAllowed(res); return; }

    const typeList = String(url.searchParams.get('types') || '').split(',').map((t) => t.trim()).filter(Boolean);
    if (!typeList.length) {
        badRequest(res, 'Missing "types" — pass ?types=a,b to choose which note types count as glossary terms', 'MISSING_PARAM');
        return;
    }

    const showZeroBacklinkTerms = url.searchParams.get('hideUnreferenced') !== 'true';
    const groupByType = url.searchParams.get('groupByType') !== 'false';
    const sortBy = url.searchParams.get('sortBy') === 'mostReferenced' ? 'mostReferenced' : 'alphabetical';
    const extraFields = String(url.searchParams.get('extraFields') || '').split(',').map((f) => f.trim()).filter(Boolean);

    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const entries = buildGlossaryEntries(
        { fieldsCache, idIndex },
        { types: typeList, showZeroBacklinkTerms, extraFields },
        { getBacklinksFn: getBacklinks }
    );
    const groups = groupGlossaryEntries(entries, { groupByType, sortBy });

    json(res, { types: typeList, entryCount: entries.length, groups });
}

module.exports = { handleGlossary };
