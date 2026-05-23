'use strict';

const GRAPH2_BOOT_STYLES = `:root{
  --bg:var(--vscode-editor-background,#0f1318);
  --surface:var(--vscode-sideBar-background,#161c23);
  --surface2:var(--vscode-editorWidget-background,#202834);
  --surface3:var(--vscode-input-background,#121821);
  --surface4:color-mix(in srgb,var(--surface2) 78%, #0a0f15);
  --border:var(--vscode-panel-border,#2b323d);
  --border-strong:rgba(255,255,255,.17);
  --text:var(--vscode-editor-foreground,#dbe2ea);
  --mid:var(--vscode-descriptionForeground,#95a1ac);
  --dim:var(--vscode-disabledForeground,#69727d);
  --accent:#7cc7ff;
  --accent2:#4fc4a0;
  --accent3:#e5a96a;
  --tag:#a371f7;
  --sans:'Segoe UI',system-ui,sans-serif;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0;overflow:hidden}
body{
  background:var(--bg);
  color:var(--text);
  font:13px/1.5 var(--sans)
}
.frame{
  display:grid;
  grid-template-rows:44px minmax(0,1fr);
  height:100vh
}
.topbar{
  display:grid;
  grid-template-columns:1fr auto;
  align-items:center;
  gap:12px;
  padding:0 12px;
  border-bottom:1px solid var(--border);
  background:var(--surface)
}
.topbar-left,.topbar-right{
  display:flex;
  align-items:center
}
.topbar-right{
  justify-content:flex-end
}
.topbar-title{
  display:flex;
  align-items:center;
  gap:8px;
  font-size:15px;
  font-weight:700
}
.topbar-glyph{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:18px;
  height:18px;
  color:var(--accent)
}
.topbar-glyph svg{
  width:16px;
  height:16px;
  stroke:currentColor;
  stroke-width:1.35;
  stroke-linecap:round;
  stroke-linejoin:round;
}
.topbar-hint{
  color:var(--mid);
  font-size:11px
}
.app{
  display:grid;
  grid-template-columns:220px minmax(0,1fr) 220px;
  min-height:0;
  height:100%;
}
.panel{
  border-right:1px solid var(--border);
  background:var(--surface);
  min-width:0;
  min-height:0;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}
.panel.right{
  border-right:none;
  border-left:1px solid var(--border);
}
.panel-scroll{
  flex:1 1 auto;
  height:auto;
  min-height:0;
  overflow:auto;
  padding:6px 6px 12px;
  display:flex;
  flex-direction:column;
  gap:4px;
  scrollbar-gutter:stable;
  overscroll-behavior:contain;
}
.eyebrow{
  color:var(--accent3);
  font-size:10px;
  font-weight:700;
  letter-spacing:.12em;
  text-transform:uppercase;
  margin-bottom:4px
}
.title{
  font-size:15px;
  font-weight:700;
  line-height:1.1;
  margin:0 0 4px
}
.sub{
  color:var(--mid);
  font-size:12px;
  margin:0 0 4px
}
.section{
  margin:0
}
.panel-sticky{
  position:sticky;
  top:0;
  z-index:4;
  background:var(--surface);
  padding-bottom:4px
}
.panel-sticky .section + .section{
  margin-top:4px
}
.section h3{
  font-size:11px;
  letter-spacing:.08em;
  text-transform:uppercase;
  color:var(--dim);
  margin:0 0 4px
}
.accordion{
  border:1px solid var(--border);
  border-radius:10px;
  background:color-mix(in srgb,var(--surface2) 90%,transparent);
  overflow:hidden
}
.accordion summary{
  list-style:none;
  cursor:pointer;
  padding:5px 7px;
  color:var(--dim);
  font-size:11px;
  font-weight:700;
  letter-spacing:.08em;
  text-transform:uppercase
}
.accordion summary::-webkit-details-marker{
  display:none
}
.accordion .card{
  border:none;
  border-top:1px solid var(--border);
  border-radius:0;
  background:transparent
}
.card{
  border:1px solid color-mix(in srgb,var(--border) 64%, var(--border-strong));
  border-radius:11px;
  background:
    linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.015)),
    linear-gradient(180deg,color-mix(in srgb,var(--surface2) 94%, transparent),color-mix(in srgb,var(--surface4) 96%, transparent));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.03);
  padding:5px
}
.grid{
  display:grid;
  gap:4px
}
.grid.two{
  grid-template-columns:1fr 1fr
}
.label{
  display:block;
  color:var(--mid);
  font-size:11px;
  margin:0 0 3px
}
.inp,.btn,.pill{
  border:1px solid color-mix(in srgb,var(--border) 60%, var(--border-strong));
  border-radius:9px;
  background:var(--surface3);
  color:var(--text);
  font:inherit
}
.inp{
  width:100%;
  padding:5px 8px;
  outline:none
}
.inp:focus{
  border-color:rgba(124,199,255,.3);
  box-shadow:0 0 0 1px rgba(124,199,255,.12) inset
}
.btn{
  padding:4px 8px;
  cursor:pointer;
  background:
    linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.015)),
    linear-gradient(180deg,color-mix(in srgb,var(--surface3) 92%, transparent),color-mix(in srgb,var(--surface2) 86%, #0d1319));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.04),
    0 1px 0 rgba(0,0,0,.12)
}
.btn:hover{
  border-color:rgba(255,255,255,.24);
  background:
    linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.02)),
    linear-gradient(180deg,color-mix(in srgb,var(--surface2) 90%, transparent),color-mix(in srgb,var(--surface3) 82%, #0d1319))
}
.btn.pri{
  color:var(--accent);
  background:linear-gradient(180deg,rgba(124,199,255,.16),rgba(124,199,255,.09));
  border-color:rgba(124,199,255,.32)
}
.toolbar-btn{
  min-height:30px;
  padding:5px 11px;
  border-radius:8px;
  font-weight:600;
  letter-spacing:.01em;
  background:
    linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02)),
    linear-gradient(180deg,color-mix(in srgb,var(--surface2) 96%, transparent),color-mix(in srgb,var(--surface3) 88%, #0d1319));
  border-color:rgba(255,255,255,.13)
}
.toolbar-btn-strong{
  color:var(--text);
  border-color:rgba(255,255,255,.2);
  background:
    linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.03)),
    linear-gradient(180deg,color-mix(in srgb,var(--surface2) 96%, transparent),color-mix(in srgb,var(--surface3) 86%, #0d1319))
}
.toolbar-btn-accent{
  color:var(--text);
  border-color:rgba(124,199,255,.42);
  background:
    linear-gradient(180deg,rgba(124,199,255,.22),rgba(124,199,255,.09)),
    linear-gradient(180deg,color-mix(in srgb,var(--surface2) 92%, transparent),color-mix(in srgb,var(--surface3) 86%, #0d1319))
}
.toolbar-btn-muted{
  color:color-mix(in srgb,var(--mid) 92%, var(--text));
  border-color:rgba(255,255,255,.1)
}
.btn-row{
  display:flex;
  gap:4px;
  flex-wrap:wrap
}
.scope-segments{
  display:flex;
  flex-wrap:wrap;
  gap:4px
}
.scope-btn{
  text-align:center;
  padding:5px 7px;
  border-radius:11px;
  font-size:12px;
  flex:1 1 calc(50% - 4px);
  min-width:0;
  background:
    linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015)),
    linear-gradient(180deg,color-mix(in srgb,var(--surface3) 94%, transparent),color-mix(in srgb,var(--surface2) 88%, #0e141a))
}
.scope-btn.on{
  color:var(--text);
  border-color:rgba(124,199,255,.4);
  background:
    linear-gradient(180deg,rgba(124,199,255,.2),rgba(124,199,255,.08)),
    linear-gradient(180deg,color-mix(in srgb,var(--surface2) 92%, transparent),color-mix(in srgb,var(--surface3) 86%, #0e141a));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05)
}
.scope-name{
  display:block;
  font-weight:600
}
.scope-desc{
  display:none
}
.compact-grid{
  gap:4px
}
.center{
  display:flex;
  flex-direction:column;
  min-width:0;
  min-height:0;
  overflow:hidden
}
.hero{
  padding:8px 8px 10px;
  border-bottom:1px solid var(--border);
  background:
    linear-gradient(180deg,color-mix(in srgb,var(--accent) 11%,transparent),transparent 58%),
    linear-gradient(180deg,color-mix(in srgb,var(--surface2) 97%, transparent), color-mix(in srgb,var(--surface) 96%, transparent))
}
.hero-controls{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
  margin-top:4px
}
.hero-controls-secondary{
  margin-top:6px;
  margin-bottom:10px
}
.hero-top{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  margin-bottom:6px
}
.hero-title{
  font-size:13px;
  font-weight:700
}
.hero-meta{
  color:color-mix(in srgb,var(--mid) 82%, var(--text));
  font-size:11px
}
.hero .sub{
  color:color-mix(in srgb,var(--mid) 88%, var(--text));
  margin-bottom:6px
}
.canvas{
  flex:1;
  min-height:0;
  padding:6px;
  display:flex;
  flex-direction:column;
  overflow:hidden
}
.canvas-card{
  border:1px solid var(--border);
  border-radius:12px;
  background:color-mix(in srgb,var(--surface2) 86%,transparent);
  padding:6px;
  height:100%;
  flex:1;
  min-height:0;
  display:flex;
  flex-direction:column
}
.graph-shell{
  flex:1;
  min-height:460px;
  height:100%;
  border:1px solid var(--border);
  border-radius:12px;
  overflow:hidden;
  background:
    radial-gradient(circle at 22% 18%,rgba(124,199,255,.05),transparent 30%),
    radial-gradient(circle at 80% 78%,rgba(163,113,247,.05),transparent 28%),
    linear-gradient(180deg,rgba(255,255,255,.02),rgba(255,255,255,.01))
}
#graph2Canvas{
  width:100%;
  height:100%;
  min-height:0
}
.canvas-empty{
  height:100%;
  display:grid;
  place-items:center;
  color:var(--mid);
  text-align:center
}
.canvas-empty strong{
  display:block;
  color:var(--text);
  font-size:15px;
  margin-bottom:6px
}
.stats{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:6px;
  margin-top:2px
}
.stat{
  border:1px solid color-mix(in srgb,var(--border) 58%, var(--border-strong));
  border-radius:10px;
  padding:5px 7px;
  background:
    linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.018)),
    linear-gradient(180deg,color-mix(in srgb,var(--surface2) 95%, transparent),color-mix(in srgb,var(--surface4) 95%, transparent))
}
.stat b{
  display:block;
  font-size:14px;
  line-height:1.1
}
.stat span{
  color:var(--mid);
  font-size:9px
}
.list{
  display:grid;
  gap:4px
}
.list.compact{
  gap:6px
}
.item{
  border:1px solid color-mix(in srgb,var(--border) 62%, var(--border-strong));
  border-radius:10px;
  padding:5px 6px;
  background:
    linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015)),
    linear-gradient(180deg,color-mix(in srgb,var(--surface2) 95%, transparent),color-mix(in srgb,var(--surface4) 95%, transparent))
}
.item-top{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px
}
.item-title{
  font-weight:600
}
.item-sub{
  color:var(--mid);
  font-size:11px;
  margin-top:2px
}
.item-actions{
  display:flex;
  gap:6px;
  margin-top:6px
}
.pills{
  display:flex;
  gap:6px;
  flex-wrap:wrap
}
.pill{
  display:inline-flex;
  align-items:center;
  padding:3px 8px;
  border-radius:999px;
  color:color-mix(in srgb,var(--mid) 88%, var(--text));
  font-size:11px;
  background:
    linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.01)),
    linear-gradient(180deg,color-mix(in srgb,var(--surface3) 96%, transparent),color-mix(in srgb,var(--surface2) 90%, #0f151c))
}
.pill.on{
  color:var(--accent);
  border-color:rgba(124,199,255,.28);
  background:linear-gradient(180deg,rgba(124,199,255,.14),rgba(124,199,255,.05))
}
.pill.btnish{
  cursor:pointer
}
.pill.btnish:hover{
  border-color:rgba(255,255,255,.18);
  color:var(--text)
}
.empty{
  color:var(--dim);
  font-size:12px
}
.tag{
  color:var(--tag)
}
.mini-map{
  width:100%;
  min-height:84px;
  border:1px solid color-mix(in srgb,var(--border) 72%, var(--border-strong));
  border-radius:10px;
  overflow:hidden;
  background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.015));
  display:grid;
  place-items:center
}
.mini-map svg{
  width:100%;
  height:100%;
  display:block
}
.mini-map img{
  width:100%;
  height:100%;
  object-fit:contain;
  padding:8px;
  display:block
}
.mini-map img[hidden]{
  display:none
}
.mini-map-fallback{
  color:var(--mid);
  font-size:11px;
  text-align:center;
  line-height:1.5;
  padding:12px
}
.detail-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:4px
}
.detail-stat{
  border:1px solid color-mix(in srgb,var(--border) 60%, var(--border-strong));
  border-radius:9px;
  padding:4px 6px;
  background:
    linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015)),
    linear-gradient(180deg,color-mix(in srgb,var(--surface2) 95%, transparent),color-mix(in srgb,var(--surface4) 95%, transparent))
}
.detail-stat b{
  display:block;
  font-size:13px;
  line-height:1.1
}
.detail-stat span{
  color:var(--mid);
  font-size:9px
}
.mini-actions{
  display:flex;
  gap:4px;
  flex-wrap:wrap;
  margin-top:4px
}
.mini-actions .btn{
  padding:4px 8px;
  font-size:12px;
  border-radius:8px
}
.cluster-chips{
  display:flex;
  flex-wrap:wrap;
  gap:4px
}
.selection-fold{
  padding:0 !important;
  overflow:hidden
}
.selection-fold summary{
  list-style:none;
  cursor:pointer;
  padding:6px 7px;
  font-weight:600;
  color:var(--text);
  background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,.01))
}
.selection-fold summary::-webkit-details-marker{
  display:none
}
.selection-fold .item-sub{
  padding:0 7px 7px;
  margin-top:0
}
.cluster-chip{
  display:inline-flex;
  align-items:center;
  gap:5px;
  padding:3px 7px;
  border:1px solid color-mix(in srgb,var(--border) 62%, var(--border-strong));
  border-radius:999px;
  background:
    linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015)),
    linear-gradient(180deg,color-mix(in srgb,var(--surface3) 95%, transparent),color-mix(in srgb,var(--surface2) 90%, #10171d));
  color:var(--text);
  font-size:10px
}
.cluster-dot{
  width:8px;
  height:8px;
  border-radius:50%;
  background:var(--accent)
}
.item.muted{
  background:transparent
}
.section.deferred{
  display:none
}

.react-flow__renderer{
  background:transparent
}

.react-flow__handle{
  opacity:0 !important;
  width:0 !important;
  height:0 !important;
  min-width:0 !important;
  min-height:0 !important;
  border:none !important;
  background:transparent !important
}

.react-flow__controls{
  bottom:8px;
  left:8px;
  box-shadow:none
}

.react-flow__controls-button{
  width:28px;
  height:28px;
  background:var(--surface2);
  border-color:var(--border);
  color:var(--text)
}

/* Workspace node cards — theme-aware */
.react-flow__node-yamlinkNode > div{
  background:var(--surface2) !important;
  border-color:var(--border) !important;
  color:var(--text) !important
}

/* Vault dot labels */
.ynode-label{
  position:absolute;
  top:100%;
  left:50%;
  transform:translateX(-50%);
  margin-top:3px;
  font-size:9px;
  line-height:1.2;
  color:var(--mid);
  white-space:nowrap;
  pointer-events:none;
  text-align:center;
  max-width:80px;
  overflow:hidden;
  text-overflow:ellipsis
}
.react-flow__node-vaultDotNode{
  overflow:visible !important
}

@media (max-width: 1220px){
  .app{
    grid-template-columns:210px minmax(0,1fr) 210px;
  }
  .scope-segments{
    grid-template-columns:1fr;
  }
}

@media (max-height: 860px){
  .graph-shell{
    min-height:380px;
  }
}

.scope-hint{
  color:color-mix(in srgb,var(--mid) 82%, var(--text));
  font-size:11px;
  margin:3px 0 0;
  min-height:14px;
  line-height:1.4
}
.filter-badge{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:16px;
  height:16px;
  padding:0 4px;
  border-radius:999px;
  background:rgba(124,199,255,.24);
  border:1px solid rgba(124,199,255,.42);
  color:#dff1ff;
  font-size:10px;
  font-weight:700;
  margin-left:4px;
  vertical-align:middle;
  line-height:1
}
.mini-map svg{
  cursor:crosshair
}
.src-panel{
  display:none
}
.src-panel.visible{
  display:block
}
.label-hint{
  color:var(--dim);
  font-size:10px;
  font-weight:400;
  margin-left:3px
}
.section h3,
.label{
  color:color-mix(in srgb,var(--dim) 80%, var(--mid))
}
.item.muted .item-title{
  color:var(--text)
}
.item.muted .item-sub{
  color:var(--mid)
}
.chip-field{
  border:1px solid color-mix(in srgb,var(--border) 72%, var(--border-strong));
  border-radius:9px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--surface3) 94%, transparent),color-mix(in srgb,var(--surface2) 86%, #0d1319));
  padding:4px;
  display:flex;
  flex-wrap:wrap;
  gap:3px;
  min-height:32px;
  cursor:text
}
.chip{
  display:inline-flex;
  align-items:center;
  gap:3px;
  padding:2px 6px;
  background:rgba(124,199,255,.12);
  border:1px solid rgba(124,199,255,.28);
  border-radius:999px;
  color:var(--text);
  font-size:11px;
  line-height:1.4
}
.chip-remove{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:14px;
  height:14px;
  border:none;
  background:none;
  color:var(--mid);
  font-size:13px;
  line-height:1;
  cursor:pointer;
  padding:0;
  border-radius:50%
}
.chip-remove:hover{
  color:var(--text)
}
.chip-inp{
  border:none;
  background:transparent;
  color:var(--text);
  font:inherit;
  font-size:12px;
  outline:none;
  flex:1;
  min-width:80px;
  padding:2px 4px
}
.selection-card-primary{
  display:flex;
  flex-direction:column;
  gap:8px
}
.selection-actions{
  display:grid;
  gap:4px
}
.selection-actions .btn{
  justify-content:flex-start;
  text-align:left
}

`;

module.exports = {
    GRAPH2_BOOT_STYLES
};
