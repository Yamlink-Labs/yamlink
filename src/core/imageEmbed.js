'use strict';

// Shared image-embed resolution — `![[target]]` embeds that point at a real
// image file on disk rather than a note. Used by hover, diagnostics, and
// decorations so all three surfaces agree on what counts as "resolved":
// before this existed, each surface only checked note-id resolution, so a
// perfectly valid image embed always showed as a broken link everywhere.

const fs = require('fs');
const path = require('path');

const IMAGE_EMBED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp']);

/**
 * Resolves a `![[target]]` embed to an image file on disk, relative to the
 * embedding note's own directory (the common case for vault attachments).
 * Returns null for anything that isn't an image-extensioned target, or that
 * doesn't resolve to a real file — never guesses.
 * @param {string} rawLinkText
 * @param {string} noteDir
 * @returns {string|null}
 */
function resolveImageEmbed(rawLinkText, noteDir) {
    const target = String(rawLinkText || '').split('|')[0].trim();
    if (!target) return null;
    const ext = path.extname(target).toLowerCase();
    if (!IMAGE_EMBED_EXTENSIONS.has(ext)) return null;
    const candidate = path.join(noteDir, target);
    try {
        return fs.statSync(candidate).isFile() ? candidate : null;
    } catch {
        return null;
    }
}

module.exports = { resolveImageEmbed, IMAGE_EMBED_EXTENSIONS };
