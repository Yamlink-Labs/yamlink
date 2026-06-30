'use strict';

const vscode   = require('vscode');
const crypto   = require('crypto');
const { getIndex, getFieldsCache } = require('../core/indexService');
const { getTypes }                  = require('../registries/typeRegistry');
const { getBrokenCount }            = require('../diagnostics/diagnostics');
const { getMutationEvents }         = require('../runtime/mutationEventLog');
const { buildHomeHtml, OUTCOME_TYPES } = require('./home/homePanelHtml');
const { collectHealthStats }        = require('./health/healthStats');
const { parseSingleViewLine }       = require('../engine/queryParser');
const { runQuery }                  = require('../engine/queryExecutor');
const { openNoteTarget }            = require('./navigation/openNoteTarget');
const { buildSessionNarratives }    = require('../runtime/mutationNarratives');
const { getEdges, getBacklinks }    = require('../core/graph');

let _panel  = null;
let _extUri = null;

const SYSTEM_TYPES = new Set(['schema', 'template', 'dashboard']);

/** @param {import('vscode').ExtensionContext} context @returns {void} */
function openHomePanel(context) {
    _extUri = context.extensionUri;

    if (_panel) {
        _panel.reveal(vscode.ViewColumn.One);
        _updatePanel();
        return;
    }

    _panel = vscode.window.createWebviewPanel(
        'yamlink.homePanel',
        'Yamlink Home',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'src', 'features'),
                vscode.Uri.joinPath(context.extensionUri, 'media'),
            ]
        }
    );

    _panel.webview.onDidReceiveMessage(msg => {
        if (msg.command === 'openNode') {
            openNoteTarget(msg.id, { viewColumn: vscode.ViewColumn.One, preview: false }).catch(() => {});
        }
        if (msg.command === 'runCommand' && msg.id) {
            vscode.commands.executeCommand(msg.id);
        }
        if (msg.command === 'openProblems') {
            vscode.commands.executeCommand('workbench.actions.view.problems');
        }
        if (msg.command === 'openUntypedView') {
            const { openViewPanel } = require('./viewPanel');
            openViewPanel(context, '# Notes without a type\n\n!view where type is empty\n');
        }
    }, null, context.subscriptions);

    _panel.onDidDispose(() => { _panel = null; }, null, context.subscriptions);

    _updatePanel();
}

/** @returns {void} */
function _updatePanel() {
    if (!_panel || !_extUri) return;

    const idIndex     = getIndex();
    const fieldsCache = getFieldsCache();
    const allEvents   = getMutationEvents({ limit: 5000 });

    // Pulse
    const noteCount   = idIndex.size;
    const typeCount   = [...getTypes()].filter(t => !SYSTEM_TYPES.has(t)).length;
    const brokenCount = getBrokenCount();

    // Types list for quick-action buttons
    const types = [...getTypes()].filter(t => !SYSTEM_TYPES.has(t)).slice(0, 4);

    // Activity feed: last 6 non-dismissed sessions
    const activitySessions = buildSessionNarratives(allEvents, fieldsCache, { limit: 10 })
        .filter(s => s.outcomeLabel !== 'DISMISSED')
        .slice(0, 6);
    const activityEvents = allEvents
        .filter(e => !OUTCOME_TYPES.has(e.type))
        .slice(-6)
        .reverse();

    // Continue working: 5 most recently mutated distinct noteIds
    const recentNoteIds = [];
    const seen = new Set();
    for (let i = allEvents.length - 1; i >= 0; i--) {
        const e = allEvents[i];
        if (OUTCOME_TYPES.has(e.type)) continue;
        if (!seen.has(e.noteId) && idIndex.has(e.noteId)) {
            seen.add(e.noteId);
            recentNoteIds.push(e.noteId);
        }
        if (recentNoteIds.length >= 5) break;
    }

    // Nudges (at most 2)
    const nudges = [];
    if (brokenCount > 0) nudges.push({ type: 'broken', count: brokenCount });
    const untypedCount = [...fieldsCache.values()].filter(f => !String(f.type || '').trim()).length;
    if (untypedCount > 0 && nudges.length < 2) nudges.push({ type: 'untyped', count: untypedCount });

    // Tasks
    const _q = (line) => {
        const q = parseSingleViewLine(line);
        return (q && runQuery(q, null).success) ? runQuery(q, null).rows : [];
    };
    const tasks = {
        overdue:  _q('!view overdue'),
        today:    _q('!view today'),
        upcoming: _q('!view upcoming limit 5'),
        undated:  _q('!view undated-tasks limit 4'),
    };

    const healthStats     = collectHealthStats();
    const projections     = healthStats.intelligenceHealth?.projections || null;
    const lifecycleCounts = healthStats.lifecycle?.counts || {};

    // Stats data for Stats tab
    const heatmapData      = _buildHeatmapData(allEvents);
    const typeDistribution = _buildTypeDistribution(fieldsCache);
    const linkDistribution = _buildLinkDistribution(idIndex);
    const weeklyGrowth     = _buildWeeklyGrowth(allEvents);

    const todayDate = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const vaultName = (() => {
        const folders = vscode.workspace.workspaceFolders;
        return (folders && folders.length) ? folders[0].name : 'Vault';
    })();

    const nonce     = crypto.randomBytes(16).toString('hex');
    const csp       = _panel.webview.cspSource;
    const scriptUri = _panel.webview.asWebviewUri(
        vscode.Uri.joinPath(_extUri, 'src', 'features', 'home', 'homeScript.js')
    ).toString();
    const logoUri   = _panel.webview.asWebviewUri(
        vscode.Uri.joinPath(_extUri, 'media', 'icon.png')
    ).toString();

    _panel.webview.html = buildHomeHtml(
        { noteCount, typeCount, brokenCount, activityEvents, activitySessions, recentNoteIds,
          types, nudges, tasks, projections, lifecycleCounts,
          heatmapData, typeDistribution, linkDistribution, weeklyGrowth,
          fieldsCache, idIndex, vaultName, todayDate },
        { nonce, csp, scriptUri, logoUri }
    );
}

function _buildHeatmapData(events) {
    const data = {};
    const cutoff = Date.now() - 366 * 86400000;
    for (const e of events) {
        if (!e.timestamp) continue;
        const t = new Date(e.timestamp).getTime();
        if (t < cutoff) continue;
        const key = new Date(t).toISOString().slice(0, 10);
        data[key] = (data[key] || 0) + 1;
    }
    return data;
}

function _buildTypeDistribution(fieldsCache) {
    const dist = {};
    for (const [, fields] of fieldsCache) {
        const t = String(fields.type || '').trim() || '(untyped)';
        if (!SYSTEM_TYPES.has(t)) dist[t] = (dist[t] || 0) + 1;
    }
    return dist;
}

function _buildLinkDistribution(idIndex) {
    const dist = { '0': 0, '1-2': 0, '3-5': 0, '6-10': 0, '10+': 0 };
    for (const id of idIndex.keys()) {
        const deg = (getEdges(id)?.length || 0) + (getBacklinks(id)?.length || 0);
        if (deg === 0)      dist['0']++;
        else if (deg <= 2)  dist['1-2']++;
        else if (deg <= 5)  dist['3-5']++;
        else if (deg <= 10) dist['6-10']++;
        else                dist['10+']++;
    }
    return dist;
}

function _buildWeeklyGrowth(events) {
    const weeks = [];
    const now = Date.now();
    for (let i = 11; i >= 0; i--) {
        const weekStart = now - (i + 1) * 7 * 86400000;
        const weekEnd   = now - i * 7 * 86400000;
        let count = 0;
        for (const e of events) {
            if (e.type !== 'note_created') continue;
            const t = new Date(e.timestamp).getTime();
            if (t >= weekStart && t < weekEnd) count++;
        }
        const d = new Date(weekStart);
        weeks.push({ label: d.toLocaleDateString([], { month: 'short', day: 'numeric' }), count });
    }
    return weeks;
}

/** Refresh the panel if it is open (called by the refresh router). @returns {void} */
function refreshHomePanel() {
    if (_panel) _updatePanel();
}

module.exports = { openHomePanel, refreshHomePanel };
