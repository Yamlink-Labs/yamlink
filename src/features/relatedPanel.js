// src/features/relatedPanel.js
//
// Related Nodes sidebar panel.
// Shows the full neighbourhood of the active Yamlink node:
//   - Outgoing edges (this node → others), grouped by field
//   - Incoming edges (others → this node), grouped by field
//
// Tree shape:
//   ▼ → commander           (outgoing field group, 2 nodes)
//       mission-klendathu
//       mission-tango-urilla
//   ▼ ← commanding-officer  (incoming field group, 3 nodes)
//       johnny-rico
//       dizzy-flores
//       carmen-ibanez
//
// Clicking any leaf node opens its file.
// Registered as yamlink.relatedNodes in package.json contributes.views.
// ─────────────────────────────────────────────────────────────────

const vscode = require('vscode');
const { getEdges, getBacklinks } = require('../core/graph');
const { getIndex, getPathIndex, getFieldsCache } = require('../core/index');

// ─────────────────────────────────────────────────────────────────
// Tree item types
// ─────────────────────────────────────────────────────────────────

class FieldGroupItem extends vscode.TreeItem {
    constructor(label, direction, count) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        // direction: 'out' | 'in'
        this.direction    = direction;
        this.description  = `${count}`;
        this.iconPath     = new vscode.ThemeIcon(
            direction === 'out' ? 'arrow-right' : 'arrow-left'
        );
        this.contextValue = 'yamlink.fieldGroup';
        // Tooltip explains the relationship direction
        this.tooltip = direction === 'out'
            ? `Outgoing — this node links to others via "${label}"`
            : `Incoming — other nodes link to this one via "${label}"`;
    }
}

class RelatedNodeItem extends vscode.TreeItem {
    constructor(nodeId, filePath, nodeType, direction, field) {
        super(nodeId, vscode.TreeItemCollapsibleState.None);
        this.description  = nodeType || '';
        this.iconPath     = new vscode.ThemeIcon('file');
        this.contextValue = 'yamlink.relatedNode';
        this.tooltip      = direction === 'out'
            ? `${field}: [[${nodeId}]]`
            : `${nodeId} → ${field}: [[current]]`;

        if (filePath) {
            this.command = {
                command:   'vscode.open',
                title:     'Open node',
                arguments: [vscode.Uri.file(filePath)]
            };
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// RelatedNodesProvider
// ─────────────────────────────────────────────────────────────────

class RelatedNodesProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData  = this._onDidChangeTreeData.event;

        // Cache of { outGroups, inGroups } for active node
        // Rebuilt on refresh() — avoids recomputing on every getChildren call
        this._groups = null;
    }

    refresh() {
        this._groups = null; // invalidate cache
        this._onDidChangeTreeData.fire();
    }

    // ── TreeDataProvider contract ──────────────────────────────────

    getTreeItem(element) {
        return element;
    }

    getChildren(element) {
        if (!element) {
            // Root level — return field group items
            return this._getRootItems();
        }

        if (element instanceof FieldGroupItem) {
            // Field group level — return node items
            return this._getGroupChildren(element);
        }

        return [];
    }

    // ── Internal ──────────────────────────────────────────────────

    _ensureGroups() {
        if (this._groups !== null) return this._groups;

        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') {
            this._groups = null;
            return null;
        }

        const filePath = editor.document.uri.fsPath;
        const id       = getPathIndex().get(filePath) ?? null;
        if (!id) {
            this._groups = null;
            return null;
        }

        const idIndex   = getIndex();
        const fCache    = getFieldsCache();

        // ── Outgoing: this node → others ──────────────────────────
        const outEdges = getEdges(id);
        const outMap   = new Map(); // field → [{ nodeId, filePath, type }]

        for (const { targetId, field } of outEdges) {
            if (!outMap.has(field)) outMap.set(field, []);
            const fp    = idIndex.get(targetId) ?? null;
            const type  = fCache.get(targetId)?.type ?? '';
            outMap.get(field).push({ nodeId: targetId, filePath: fp, type });
        }

        // ── Incoming: others → this node ──────────────────────────
        const inEdges = getBacklinks(id);
        const inMap   = new Map(); // field → [{ nodeId, filePath, type }]

        for (const { sourceId, field } of inEdges) {
            if (field === 'body') continue; // prose mentions clutter the panel
            if (!inMap.has(field)) inMap.set(field, []);
            const fp   = idIndex.get(sourceId) ?? null;
            const type = fCache.get(sourceId)?.type ?? '';
            inMap.get(field).push({ nodeId: sourceId, filePath: fp, type });
        }

        this._groups = { id, outMap, inMap };
        return this._groups;
    }

    _getRootItems() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') {
            return [this._placeholder('Open a Markdown file to see related nodes')];
        }

        const filePath = editor.document.uri.fsPath;
        const id       = getPathIndex().get(filePath) ?? null;
        if (!id) {
            return [this._placeholder('Not a Yamlink node — add an id: field')];
        }

        const groups = this._ensureGroups();
        if (!groups) return [this._placeholder('No related nodes')];

        const { outMap, inMap } = groups;

        if (outMap.size === 0 && inMap.size === 0) {
            return [this._placeholder(`"${id}" has no connections yet`)];
        }

        const items = [];

        // Outgoing groups — sorted alphabetically by field name
        for (const [field, nodes] of [...outMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            items.push(new FieldGroupItem(field, 'out', nodes.length));
        }

        // Incoming groups — sorted alphabetically by field name
        for (const [field, nodes] of [...inMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            items.push(new FieldGroupItem(field, 'in', nodes.length));
        }

        return items;
    }

    _getGroupChildren(groupItem) {
        const groups = this._ensureGroups();
        if (!groups) return [];

        const { outMap, inMap } = groups;
        const map   = groupItem.direction === 'out' ? outMap : inMap;
        const nodes = map.get(groupItem.label) ?? [];

        return nodes
            .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
            .map(({ nodeId, filePath, type }) =>
                new RelatedNodeItem(nodeId, filePath, type, groupItem.direction, groupItem.label)
            );
    }

    _placeholder(message) {
        const item        = new vscode.TreeItem(message);
        item.iconPath     = new vscode.ThemeIcon('info');
        item.contextValue = 'yamlink.placeholder';
        return item;
    }
}

// ─────────────────────────────────────────────────────────────────
// registerRelatedPanel
// ─────────────────────────────────────────────────────────────────

function registerRelatedPanel(context) {
    const provider = new RelatedNodesProvider();

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('yamlink.relatedNodes', provider)
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => provider.refresh())
    );

    return provider;
}

module.exports = { registerRelatedPanel };