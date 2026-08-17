'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatterDocument, setField, serializeFrontmatterDocument } = require('../core/frontmatter');
const { canonicalizeId } = require('../core/id');
const { walkVaultFiles } = require('./obsidianFilesystem');

function collectMissingIdCandidates(rootPath) {
    const candidates = [];
    const existingIds = new Set();

    walkVaultFiles(rootPath, (fullPath, relativePath) => {
        if (!fullPath.toLowerCase().endsWith('.md')) return;
        const text = fs.readFileSync(fullPath, 'utf8');
        const parsed = parseFrontmatterDocument(text);
        const existingId = String(parsed.data?.id || '').trim();
        if (existingId) existingIds.add(existingId.toLowerCase());
        const filenameId = canonicalizeId(path.basename(relativePath, '.md'));
        candidates.push({
            fullPath,
            relativePath: relativePath.replace(/\\/g, '/'),
            parsed,
            text,
            existingId,
            filenameId
        });
    });

    return {
        existingIds,
        candidates: candidates.filter(candidate => !candidate.existingId && candidate.filenameId)
    };
}

function applyMissingFilenameIds(rootPath) {
    const { existingIds, candidates } = collectMissingIdCandidates(rootPath);
    const applied = [];
    const skipped = [];
    const reserved = new Set(existingIds);

    for (const candidate of candidates) {
        const nextId = String(candidate.filenameId || '').trim().toLowerCase();
        if (!nextId) {
            skipped.push({ relativePath: candidate.relativePath, reason: 'empty-filename-id' });
            continue;
        }
        if (reserved.has(nextId)) {
            skipped.push({ relativePath: candidate.relativePath, suggestedId: nextId, reason: 'id-collision' });
            continue;
        }

        const nextDoc = setField({
            hasFrontmatter: candidate.parsed.hasFrontmatter,
            data: candidate.parsed.data || {},
            body: candidate.parsed.body || '',
            originalOrder: candidate.parsed.originalOrder || []
        }, 'id', nextId);
        const nextContent = serializeFrontmatterDocument(nextDoc);
        fs.writeFileSync(candidate.fullPath, nextContent, 'utf8');
        reserved.add(nextId);
        applied.push({ relativePath: candidate.relativePath, id: nextId });
    }

    return {
        applied,
        skipped
    };
}

module.exports = {
    collectMissingIdCandidates,
    applyMissingFilenameIds
};
