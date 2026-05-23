'use strict';

const { buildGraphClientCyScript } = require('./graphClientCyScript');
const { buildGraphClientInteractionScript } = require('./graphClientInteractionScript');

function buildGraphClientCoreScript() {
    return `const vsc = acquireVsCodeApi();
const S = { cy:null, payload:null, selectedId:null, searchTerm:'', typeFilters:new Set(), primaryTypeFilter:'', ctxId:null, lastHash:'', lastCenterId:null, lastMode:null };
const g = id => document.getElementById(id);
const E = {
  graph:g('graph'), tip:g('tip'), ctx:g('ctx'), empty:g('empty'), statusbar:g('statusbar'),
  modeHelp:g('modeHelp'),
  emptyTitle:g('emptyTitle'), emptyDesc:g('emptyDesc'),
  tipName:g('tipName'), tipType:g('tipType'), tipOut:g('tipOut'), tipIn:g('tipIn'), tipDeg:g('tipDeg'),
  ctxOpen:g('ctxOpen'), ctxFocus:g('ctxFocus'), ctxExpd:g('ctxExpd'),
  btnLocal:g('btnLocal'), btnVault:g('btnVault'), btnReveal:g('btnReveal'), btnReset:g('btnReset'),
  depthGroup:g('depthGroup'), depthSel:g('depthSel'), typeSel:g('typeSel'), searchInp:g('searchInp'),
  btnZoomIn:g('btnZoomIn'), btnZoomFit:g('btnZoomFit'), btnZoomOut:g('btnZoomOut'),
  selCard:g('selCard'), typeChips:g('typeChips'), topNodes:g('topNodes'), relList:g('relList'), tagList:g('tagList')
};
${buildGraphClientCyScript()}

${buildGraphClientInteractionScript()}`;
}

module.exports = {
    buildGraphClientCoreScript
};
