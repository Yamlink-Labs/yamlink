'use strict';

/**
 * markdown-it plugin that renders Yamlink/Obsidian-style callout blocks.
 *
 * Syntax:
 *   > [!SOURCE] Optional title
 *   > Body content here
 *
 * Supported families:
 *   Amber  — SOURCE, EVIDENCE, QUOTE, REFERENCE
 *   Blue   — NOTE, INFO, TIP, ABSTRACT
 *   Orange — WARNING, CAUTION
 *   Red    — DANGER, BUG, FAILURE
 *
 * Unknown types default to blue.
 */

const CALLOUT_RE = /^\[!([A-Z]+)\](?:\s+(.+))?$/i;

const CALLOUT_TYPE_FAMILY = {
    SOURCE: 'amber', EVIDENCE: 'amber', QUOTE: 'amber', REFERENCE: 'amber',
    NOTE: 'blue',    INFO: 'blue',      TIP: 'blue',    ABSTRACT: 'blue',
    WARNING: 'orange', CAUTION: 'orange',
    DANGER: 'red',   BUG: 'red',        FAILURE: 'red',
};

// Yamlink Apollo Night palette — authoritative values from docs/architecture/YAMLINK-COLOR-PALETTE.md
// Amber  (#E7A85A) — Structure / Schema
// Teal   (#5ECFBE) — Support / Navigation
// Orange (#E67D61) — Warm accent
// Error  (#FF4A6A) — Severity red
const FAMILY_STYLES = {
    amber:  { accent: '#E7A85A', bg: 'rgba(231,168,90,0.09)'  },
    blue:   { accent: '#5ECFBE', bg: 'rgba(94,207,190,0.09)'  },
    orange: { accent: '#E67D61', bg: 'rgba(230,125,97,0.09)'  },
    red:    { accent: '#FF4A6A', bg: 'rgba(255,74,106,0.09)'  },
};

/**
 * @param {string} type - callout type (e.g. 'SOURCE')
 * @returns {string} family key
 */
function getFamily(type) {
    return CALLOUT_TYPE_FAMILY[type.toUpperCase()] || 'blue';
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Build the HTML for a callout block.
 * @param {string} type
 * @param {string} title
 * @param {string} bodyHtml - already-rendered HTML for the body content
 * @returns {string}
 */
function buildCalloutHtml(type, title, bodyHtml) {
    const family = getFamily(type);
    const { accent, bg } = FAMILY_STYLES[family];
    const hasBody = bodyHtml.trim().length > 0;

    // Label: "SOURCE" or "SOURCE — Custom title" when title differs from type
    const label = (title && title.toUpperCase() !== type.toUpperCase())
        ? `${esc(type.toUpperCase())} — ${esc(title)}`
        : esc(type.toUpperCase());

    return `<div class="yamlink-callout yamlink-callout-${type.toLowerCase()}" style="` +
        `background:${bg};` +
        `border-left:3px solid ${accent};` +
        `border-radius:0 6px 6px 0;` +
        `margin:14px 0;` +
        `padding:${hasBody ? '10px 14px 10px 14px' : '10px 14px'};` +
        `">` +
        `<div class="yamlink-callout-label" style="` +
        `color:${accent};` +
        `font-size:0.72em;` +
        `font-weight:700;` +
        `letter-spacing:0.08em;` +
        `text-transform:uppercase;` +
        `margin-bottom:${hasBody ? '6px' : '0'};` +
        `">${label}</div>` +
        (hasBody
            ? `<div class="yamlink-callout-body" style="font-size:0.95em;line-height:1.55">${bodyHtml}</div>`
            : '') +
        `</div>`;
}

/**
 * markdown-it plugin. Register with md.use(calloutPlugin).
 *
 * Token structure reality: `> [!TYPE] Title\n> Body` produces ONE inline token
 * whose children are: [text:"[!TYPE] Title", softbreak, text:"Body"]. The type
 * line and body are NOT in separate paragraphs. We strip the first child (and
 * any following softbreak), then re-render the remaining children as body HTML.
 *
 * @param {import('markdown-it')} md
 */
function calloutPlugin(md) {
    md.core.ruler.push('yamlink_callouts', (state) => {
        const tokens = state.tokens;
        let i = 0;

        while (i < tokens.length) {
            if (tokens[i].type !== 'blockquote_open') { i++; continue; }

            const openIdx = i;

            // Find the matching blockquote_close
            let depth = 0;
            let closeIdx = -1;
            for (let j = openIdx; j < tokens.length; j++) {
                if (tokens[j].type === 'blockquote_open')  depth++;
                if (tokens[j].type === 'blockquote_close') { if (--depth === 0) { closeIdx = j; break; } }
            }
            if (closeIdx === -1) { i++; continue; }

            // Tokens inside the blockquote (exclusive)
            const inner = tokens.slice(openIdx + 1, closeIdx);

            // The first inline token holds everything: [!TYPE] line + body as children
            const firstInline = inner.find(t => t.type === 'inline');
            if (!firstInline || !firstInline.children || !firstInline.children.length) { i++; continue; }

            // The very first child must be a text node starting with [!TYPE]
            const firstChild = firstInline.children[0];
            if (!firstChild || firstChild.type !== 'text') { i++; continue; }

            const match = firstChild.content.match(CALLOUT_RE);
            if (!match) { i++; continue; }

            const calloutType = match[1].toUpperCase();
            const calloutTitle = match[2] || calloutType;

            // Strip the [!TYPE] line: remove the first child + any leading softbreak
            const bodyChildren = firstInline.children.slice(1);
            if (bodyChildren[0] && bodyChildren[0].type === 'softbreak') {
                bodyChildren.shift();
            }

            // Build body HTML from the remaining inline children (same paragraph)
            // plus any additional paragraphs that follow the first one
            let bodyHtml = '';

            if (bodyChildren.length > 0) {
                const synthInline = new state.Token('inline', '', 0);
                synthInline.content = '';
                synthInline.children = bodyChildren;
                const synthPOpen  = new state.Token('paragraph_open',  'p', 1);
                const synthPClose = new state.Token('paragraph_close', 'p', -1);
                bodyHtml += md.renderer.render([synthPOpen, synthInline, synthPClose], md.options, state.env);
            }

            // Any tokens after the first paragraph_close (multi-paragraph callouts)
            const firstPCloseIdx = inner.findIndex(t => t.type === 'paragraph_close');
            if (firstPCloseIdx !== -1 && firstPCloseIdx + 1 < inner.length) {
                bodyHtml += md.renderer.render(inner.slice(firstPCloseIdx + 1), md.options, state.env);
            }

            // Replace the entire blockquote span with a single html_block
            const htmlToken = new state.Token('html_block', '', 0);
            htmlToken.content = buildCalloutHtml(calloutType, calloutTitle, bodyHtml);
            tokens.splice(openIdx, closeIdx - openIdx + 1, htmlToken);

            i = openIdx + 1;
        }
    });
}

module.exports = { calloutPlugin, buildCalloutHtml, getFamily, FAMILY_STYLES, CALLOUT_TYPE_FAMILY };
