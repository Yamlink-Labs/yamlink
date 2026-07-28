'use strict';

const { getIndex, getFieldsCache } = require('../../core/indexService');
const { getBacklinks } = require('../../core/graph');
const { buildGlossaryEntries, groupGlossaryEntries } = require('../../intelligence/glossary');
const { emitCliError, emitCliSuccess, captureOutput, emitText } = require('../io');
const fmt = require('../format');

function run({ types, groupByType, showZeroBacklinkTerms, extraFields, sortBy, json }) {
    const typeList = String(types || '').split(',').map((t) => t.trim()).filter(Boolean);
    if (!typeList.length) {
        emitCliError({
            json,
            error: 'No note types configured. Pass --type <a,b,c> to choose which types count as glossary terms.',
            code: 'USAGE',
            exitCode: 1
        });
        return;
    }

    const idIndex = getIndex();
    const fieldsCache = getFieldsCache();
    const entries = buildGlossaryEntries(
        { fieldsCache, idIndex },
        {
            types: typeList,
            showZeroBacklinkTerms: showZeroBacklinkTerms !== false,
            extraFields: extraFields || []
        },
        { getBacklinksFn: getBacklinks }
    );

    const groups = groupGlossaryEntries(entries, {
        groupByType: groupByType !== false,
        sortBy: sortBy === 'mostReferenced' ? 'mostReferenced' : 'alphabetical'
    });

    if (json) {
        emitCliSuccess({ types: typeList, entryCount: entries.length, groups });
        return;
    }

    if (!entries.length) {
        emitText(fmt.warn(`No notes found for type(s): ${typeList.join(', ')}`) + '\n');
        return;
    }

    emitText(captureOutput(() => {
        for (const group of groups) {
            if (group.type) fmt.header(group.type);
            for (const letterGroup of group.letters) {
                if (letterGroup.letter) fmt.subheader(letterGroup.letter);
                for (const entry of letterGroup.entries) {
                    console.log('  ' + fmt.ok(entry.term));
                    if (entry.definition) console.log('    ' + entry.definition);
                    if (entry.backlinkIds.length) {
                        console.log('    ' + fmt.c.dim('Referenced in: ' + entry.backlinkIds.join(', ')));
                    } else {
                        console.log('    ' + fmt.c.dim('(not yet referenced)'));
                    }
                }
                fmt.blank();
            }
        }
    }));
}

module.exports = { run };
