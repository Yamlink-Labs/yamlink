'use strict';

const fs = require('fs');
const { getIndex, getPathIndex } = require('../core/indexService');
const { getBacklinks } = require('../core/graph');
const { extractBodyMentionedIds } = require('../intelligence/frontmatterBodyHints');

const ANCHOR_RE = /\[\[(?:[^\]|#\n]+)#([^\]|#\n]+)(?:\|[^\]\n]*)?\]\]/g;
const HEADING_RE = /^(#{1,6})\s+(.*)/;
const TASK_RE = /^\s*[-*]\s+\[[ xX]\]/;

function buildOutlineModel(text, options = {}) {
    const anchorCounts = options.anchorCounts || new Map();
    const lines = String(text || '').split('\n');
    const bodyStart = getBodyStartLine(lines);
    const headings = [];

    for (let i = bodyStart; i < lines.length; i++) {
        const match = lines[i].match(HEADING_RE);
        if (!match) continue;
        headings.push({
            line: i,
            level: match[1].length,
            text: match[2].trim()
        });
    }

    const nodes = headings.map((heading, index) => {
        const nextLine = index + 1 < headings.length ? headings[index + 1].line : lines.length;
        const sectionLines = lines.slice(heading.line + 1, nextLine);
        const sectionText = sectionLines.join('\n').trim();
        const metrics = buildSectionMetrics(sectionLines, sectionText, anchorCounts.get(slugify(heading.text)) || 0);
        return {
            id: `${heading.line}:${heading.text}`,
            heading,
            startLine: heading.line,
            endLine: nextLine - 1,
            metrics,
            children: [],
            parent: null
        };
    });

    const roots = [];
    const stack = [];
    for (const node of nodes) {
        while (stack.length > 0 && stack[stack.length - 1].heading.level >= node.heading.level) {
            stack.pop();
        }
        if (stack.length > 0) {
            node.parent = stack[stack.length - 1];
            stack[stack.length - 1].children.push(node);
        } else {
            roots.push(node);
        }
        stack.push(node);
    }

    return { roots, nodes };
}

function buildSectionMetrics(sectionLines, sectionText, anchorLinks) {
    let taskCount = 0;
    let wordCount = 0;
    for (const line of sectionLines) {
        if (TASK_RE.test(line)) taskCount++;
        wordCount += line.split(/\s+/).filter(Boolean).length;
    }

    const mentionCount = [...extractBodyMentionedIds(sectionText).values()]
        .reduce((sum, count) => sum + count, 0);

    return {
        anchorLinks,
        taskCount,
        wordCount,
        mentionCount,
        snippet: buildSnippet(sectionLines)
    };
}

function buildSnippet(lines) {
    for (const line of lines) {
        const cleaned = String(line || '').trim()
            .replace(/^[-*]\s+\[[ xX]\]\s*/, '')
            .replace(/^>\s*/, '')
            .replace(/^\[\^[^\]]+\]:\s*/, '');
        if (!cleaned) continue;
        return cleaned.length > 120 ? `${cleaned.slice(0, 117).trimEnd()}...` : cleaned;
    }
    return '';
}

function formatSectionDescription(metrics, isActive) {
    const parts = [];
    if (isActive) parts.push('now');
    if (metrics.anchorLinks > 0) parts.push(`${metrics.anchorLinks}l`);
    if (metrics.taskCount > 0) parts.push(`${metrics.taskCount}t`);
    if (metrics.mentionCount > 0) parts.push(`${metrics.mentionCount}m`);
    if (metrics.wordCount > 0) parts.push(`~${metrics.wordCount}w`);
    return parts.join(' · ');
}

function buildSectionTooltip(node, isActive) {
    const lines = [];
    lines.push(`${'#'.repeat(node.heading.level)} ${node.heading.text}`);
    if (isActive) lines.push('Current section');
    if (node.metrics.anchorLinks > 0) lines.push(`${node.metrics.anchorLinks} anchor link${node.metrics.anchorLinks !== 1 ? 's' : ''} from other notes`);
    if (node.metrics.taskCount > 0) lines.push(`${node.metrics.taskCount} task${node.metrics.taskCount !== 1 ? 's' : ''} in this section`);
    if (node.metrics.mentionCount > 0) lines.push(`${node.metrics.mentionCount} body mention${node.metrics.mentionCount !== 1 ? 's' : ''} in this section`);
    if (node.metrics.wordCount > 0) lines.push(`Approx. ${node.metrics.wordCount} words`);
    if (node.metrics.snippet) {
        lines.push('');
        lines.push(node.metrics.snippet);
    }
    return lines.join('\n');
}

function pickSectionIcon(node, isActive) {
    if (isActive) return 'target';
    if (node.children.length > 0) return node.heading.level === 1 ? 'book' : 'list-tree';
    if (node.metrics.taskCount > 0) return 'checklist';
    if (node.metrics.anchorLinks > 0) return 'link';
    return 'circle-large-outline';
}

function isNodeActive(node, activeLine) {
    return typeof activeLine === 'number'
        && activeLine >= node.startLine
        && activeLine <= node.endLine;
}

function findActiveNode(nodes, activeLine) {
    let activeNode = null;
    for (const node of nodes) {
        if (isNodeActive(node, activeLine)) activeNode = node;
    }
    return activeNode;
}

function getNodePath(node) {
    const path = [];
    let cursor = node;
    while (cursor) {
        path.unshift(cursor);
        cursor = cursor.parent;
    }
    return path;
}

function isNodeInPath(node, activeNode) {
    if (!node || !activeNode) return false;
    let cursor = activeNode;
    while (cursor) {
        if (cursor === node) return true;
        cursor = cursor.parent;
    }
    return false;
}

function getSiblingNode(node, offset) {
    if (!node || !offset) return null;
    const siblings = node.parent ? node.parent.children : [];
    if (!node.parent) return null;
    const index = siblings.indexOf(node);
    if (index === -1) return null;
    return siblings[index + offset] || null;
}

function normalizeSearchQuery(value) {
    return String(value || '').trim().toLowerCase();
}

function nodeMatchesOutlineFilters(node, filters) {
    const query = normalizeSearchQuery(filters && filters.query);
    if (query) {
        const haystack = `${node.heading.text} ${node.metrics.snippet || ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
    }
    if (filters && filters.tasksOnly && node.metrics.taskCount <= 0) return false;
    if (filters && filters.mentionsOnly && node.metrics.mentionCount <= 0) return false;
    if (filters && filters.linkedOnly && node.metrics.anchorLinks <= 0) return false;
    return true;
}

function filterOutlineNode(node, filters) {
    const nextChildren = [];
    for (const child of node.children || []) {
        const next = filterOutlineNode(child, filters);
        if (next) nextChildren.push(next);
    }

    if (!nodeMatchesOutlineFilters(node, filters) && nextChildren.length === 0) return null;
    return {
        ...node,
        children: nextChildren
    };
}

function filterOutlineRoots(roots, filters) {
    const nextRoots = [];
    for (const root of roots || []) {
        const next = filterOutlineNode(root, filters);
        if (next) nextRoots.push(next);
    }
    return nextRoots;
}

function buildOutlineFilterMessage(filters) {
    const parts = [];
    const query = normalizeSearchQuery(filters && filters.query);
    if (query) parts.push(`"${query}"`);
    if (filters && filters.tasksOnly) parts.push('tasks');
    if (filters && filters.mentionsOnly) parts.push('mentions');
    if (filters && filters.linkedOnly) parts.push('linked');
    return parts.length > 0 ? parts.join(' · ') : '';
}

function buildAnchorCountsForNote(noteId) {
    const counts = new Map();
    const idIndex = getIndex();
    for (const edge of getBacklinks(noteId) || []) {
        const filePath = idIndex.get(edge.sourceId);
        if (!filePath) continue;

        let text;
        try {
            text = fs.readFileSync(filePath, 'utf8');
        } catch (_) {
            continue;
        }

        ANCHOR_RE.lastIndex = 0;
        let match;
        while ((match = ANCHOR_RE.exec(text)) !== null) {
            const slug = slugify(match[1]);
            counts.set(slug, (counts.get(slug) || 0) + 1);
        }
    }
    return counts;
}

function getBodyStartLine(lines) {
    let inFrontmatter = false;
    for (let i = 0; i < lines.length; i++) {
        const line = String(lines[i] || '').trim();
        if (i === 0 && line === '---') {
            inFrontmatter = true;
            continue;
        }
        if (inFrontmatter && line === '---') return i + 1;
    }
    return 0;
}

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');
}

function registerNoteOutlineView(context) {
    const vscode = require('vscode');

    class NoteOutlineProvider {
        constructor() {
            this._emitter = new vscode.EventEmitter();
            this.onDidChangeTreeData = this._emitter.event;
            this._document = null;
            this._roots = [];
            this._allNodes = [];
            this._activeLine = -1;
            this._activeNode = null;
            this._filters = {
                query: '',
                tasksOnly: false,
                mentionsOnly: false,
                linkedOnly: false
            };
        }

        refresh() {
            this._roots = [];
            this._allNodes = [];
            this._activeNode = null;
            this._emitter.fire(undefined);
        }

        getTreeItem(node) {
            const isActive = node === this._activeNode;
            const collapsibleState = node.children.length > 0
                ? (isNodeInPath(node, this._activeNode)
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed)
                : vscode.TreeItemCollapsibleState.None;
            const item = new vscode.TreeItem(node.heading.text, collapsibleState);
            item.id = node.id;
            item.description = formatSectionDescription(node.metrics, isActive);
            item.tooltip = buildSectionTooltip(node, isActive);
            item.iconPath = new vscode.ThemeIcon(pickSectionIcon(node, isActive));
            item.contextValue = isActive ? 'yamlinkOutlineActive' : 'yamlinkOutline';
            item.command = {
                command: 'yamlink.revealOutlineLine',
                title: 'Go to heading',
                arguments: [node.heading.line]
            };
            return item;
        }

        getChildren(node) {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'markdown') return [];
            this._ensureModel(editor.document, editor.selection.active.line);
            const filteredRoots = filterOutlineRoots(this._roots, this._filters);
            return node ? node.children : filteredRoots;
        }

        _ensureModel(document, activeLine) {
            const shouldRebuild = document !== this._document || this._roots.length === 0;
            this._document = document;
            this._activeLine = activeLine;

            if (shouldRebuild) {
                const text = document.getText();
                const noteId = getPathIndex().get(document.uri.fsPath) || null;
                const anchorCounts = noteId ? buildAnchorCountsForNote(noteId) : new Map();
                const model = buildOutlineModel(text, { anchorCounts });
                this._roots = model.roots;
                this._allNodes = model.nodes;
            }

            this._activeNode = findActiveNode(this._allNodes, this._activeLine);
        }

        updateActiveLine(document, activeLine) {
            if (!document || document.languageId !== 'markdown') return false;
            this._ensureModel(document, activeLine);
            this._emitter.fire(undefined);
            return true;
        }

        getActiveNode() {
            return this._activeNode;
        }

        jumpSibling(offset) {
            const target = getSiblingNode(this._activeNode, offset);
            if (!target) return null;
            return target;
        }

        setSearchQuery(query) {
            this._filters.query = normalizeSearchQuery(query);
            this._emitter.fire(undefined);
        }

        toggleFilter(key) {
            if (!Object.prototype.hasOwnProperty.call(this._filters, key)) return;
            if (typeof this._filters[key] !== 'boolean') return;
            this._filters[key] = !this._filters[key];
            this._emitter.fire(undefined);
        }

        clearFilters() {
            this._filters = {
                query: '',
                tasksOnly: false,
                mentionsOnly: false,
                linkedOnly: false
            };
            this._emitter.fire(undefined);
        }

        getFilters() {
            return { ...this._filters };
        }
    }

    const provider = new NoteOutlineProvider();
    const treeView = vscode.window.createTreeView('yamlink.noteOutline', {
        treeDataProvider: provider,
        showCollapseAll: true
    });

    let revealTimer = null;
    function scheduleRevealActive() {
        if (revealTimer) clearTimeout(revealTimer);
        revealTimer = setTimeout(() => {
            revealTimer = null;
            const activeNode = provider.getActiveNode();
            if (!activeNode) return;
            treeView.reveal(activeNode, { select: false, focus: false, expand: true }).then(undefined, () => {});
        }, 30);
    }

    function syncOutlineToEditor(editor) {
        if (!editor || editor.document.languageId !== 'markdown') return;
        const changed = provider.updateActiveLine(editor.document, editor.selection.active.line);
        treeView.message = buildOutlineFilterMessage(provider.getFilters());
        if (changed) scheduleRevealActive();
    }

    async function revealNodeInEditor(node) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !node) return;
        const position = new vscode.Position(node.heading.line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        syncOutlineToEditor(editor);
    }

    context.subscriptions.push(
        treeView,
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            provider.refresh();
            syncOutlineToEditor(editor);
        }),
        vscode.window.onDidChangeTextEditorSelection((event) => {
            if (event.textEditor.document === provider._document) {
                syncOutlineToEditor(event.textEditor);
            }
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document === provider._document) {
                provider.refresh();
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document === event.document) syncOutlineToEditor(editor);
            }
        }),
        vscode.commands.registerCommand('yamlink.revealOutlineLine', (line) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || typeof line !== 'number') return;
            const position = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            syncOutlineToEditor(editor);
        }),
        vscode.commands.registerCommand('yamlink.noteOutlineNextSibling', async () => {
            syncOutlineToEditor(vscode.window.activeTextEditor);
            const target = provider.jumpSibling(1);
            if (!target) {
                vscode.window.setStatusBarMessage('Yamlink: No next sibling section.', 2000);
                return;
            }
            await revealNodeInEditor(target);
        }),
        vscode.commands.registerCommand('yamlink.noteOutlinePreviousSibling', async () => {
            syncOutlineToEditor(vscode.window.activeTextEditor);
            const target = provider.jumpSibling(-1);
            if (!target) {
                vscode.window.setStatusBarMessage('Yamlink: No previous sibling section.', 2000);
                return;
            }
            await revealNodeInEditor(target);
        }),
        vscode.commands.registerCommand('yamlink.noteOutlineSearch', async () => {
            const input = await vscode.window.showInputBox({
                title: 'Yamlink Outline Search',
                prompt: 'Filter sections by heading or snippet text',
                value: provider.getFilters().query || '',
                placeHolder: 'timeline, evidence, witness...'
            });
            if (typeof input === 'undefined') return;
            provider.setSearchQuery(input);
            treeView.message = buildOutlineFilterMessage(provider.getFilters());
            scheduleRevealActive();
        }),
        vscode.commands.registerCommand('yamlink.noteOutlineFilterMenu', async () => {
            const filters = provider.getFilters();
            const picks = [
                {
                    label: 'Tasks',
                    description: filters.tasksOnly ? 'On' : 'Off',
                    picked: filters.tasksOnly,
                    key: 'tasksOnly'
                },
                {
                    label: 'Mentions',
                    description: filters.mentionsOnly ? 'On' : 'Off',
                    picked: filters.mentionsOnly,
                    key: 'mentionsOnly'
                },
                {
                    label: 'Linked',
                    description: filters.linkedOnly ? 'On' : 'Off',
                    picked: filters.linkedOnly,
                    key: 'linkedOnly'
                }
            ];

            const selected = await vscode.window.showQuickPick(picks, {
                title: 'Yamlink Outline Filters',
                canPickMany: true,
                matchOnDescription: true
            });
            if (typeof selected === 'undefined') return;

            const next = new Set(selected.map(item => item.key));
            for (const key of ['tasksOnly', 'mentionsOnly', 'linkedOnly']) {
                const shouldBeOn = next.has(key);
                if (provider.getFilters()[key] !== shouldBeOn) provider.toggleFilter(key);
            }
            treeView.message = buildOutlineFilterMessage(provider.getFilters());
            scheduleRevealActive();
        }),
        vscode.commands.registerCommand('yamlink.noteOutlineToggleTasks', () => {
            provider.toggleFilter('tasksOnly');
            treeView.message = buildOutlineFilterMessage(provider.getFilters());
            scheduleRevealActive();
        }),
        vscode.commands.registerCommand('yamlink.noteOutlineToggleMentions', () => {
            provider.toggleFilter('mentionsOnly');
            treeView.message = buildOutlineFilterMessage(provider.getFilters());
            scheduleRevealActive();
        }),
        vscode.commands.registerCommand('yamlink.noteOutlineToggleLinked', () => {
            provider.toggleFilter('linkedOnly');
            treeView.message = buildOutlineFilterMessage(provider.getFilters());
            scheduleRevealActive();
        }),
        vscode.commands.registerCommand('yamlink.noteOutlineClearFilters', () => {
            provider.clearFilters();
            treeView.message = '';
            scheduleRevealActive();
        })
    );

    syncOutlineToEditor(vscode.window.activeTextEditor);
}

module.exports = {
    buildOutlineModel,
    buildOutlineFilterMessage,
    filterOutlineRoots,
    findActiveNode,
    getNodePath,
    getSiblingNode,
    isNodeInPath,
    nodeMatchesOutlineFilters,
    normalizeSearchQuery,
    registerNoteOutlineView,
    slugify
};
