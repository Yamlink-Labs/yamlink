'use strict';

const GRAPH_BOOT_STYLES = `:root{
  --bg:var(--vscode-editor-background,#131313);
  --surface:var(--vscode-sideBar-background,#181b20);
  --surface2:var(--vscode-editorWidget-background,#1f242b);
  --surface3:var(--vscode-input-background,#13171c);
  --border:var(--vscode-panel-border,#2a3038);
  --text:var(--vscode-editor-foreground,#dbe2ea);
  --dim:var(--vscode-disabledForeground,#69727d);
  --mid:var(--vscode-descriptionForeground,#95a1ac);
  --accent:#5ECFBE;
  --accent2:#C49BF0;
  --accent3:#E7A85A;
  --sans:'Segoe UI',system-ui,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{background:var(--bg);color:var(--text);font:13px/1.5 var(--sans)}
.app{display:flex;height:100vh;overflow:hidden}
.canvas-wrap{
  flex:1;position:relative;overflow:hidden;min-width:0;
  --graph-floating-top:128px;
  background:
    radial-gradient(circle at 16% 16%,color-mix(in srgb,var(--accent2) 10%,transparent),transparent 40%),
    radial-gradient(circle at 84% 80%,color-mix(in srgb,var(--accent) 8%,transparent),transparent 38%),
    radial-gradient(circle at 50% 96%,color-mix(in srgb,var(--accent3) 5%,transparent),transparent 32%),
    var(--bg)
}
#graph-container{position:absolute;inset:0}
.toolbar{
  position:absolute;top:12px;left:12px;z-index:100;
  display:flex;align-items:center;gap:6px;flex-wrap:wrap;
  padding:7px 10px;
  max-width:calc(100% - 24px);
  background:color-mix(in srgb,var(--surface2) 88%,transparent);
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border:1px solid var(--border);border-radius:12px;
  box-shadow:0 4px 20px rgba(0,0,0,.28)
}
.focus-pill{
  display:flex;align-items:center;gap:7px;min-width:0;max-width:320px;
  padding:4px 8px;border-radius:999px;
  background:rgba(255,255,255,.04);
  border:1px solid var(--border)
}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.mode-help{
  position:absolute;top:var(--graph-floating-top);left:12px;z-index:95;
  max-width:min(540px, calc(100% - 24px));
  padding:6px 10px;
  border:1px solid var(--border);
  border-radius:10px;
  background:color-mix(in srgb,var(--surface2) 82%,transparent);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  color:var(--mid);font-size:11px;line-height:1.45
}
.focus-mode{
  flex-shrink:0;
  padding:2px 7px;border-radius:999px;
  background:rgba(196,155,240,.14);
  color:var(--accent2);font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase
}
.focus-name{
  min-width:0;
  color:var(--text);font-size:11px;font-weight:600;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap
}
.t-sep{width:1px;height:18px;background:var(--border);flex-shrink:0}
.t-label{font-size:11px;color:var(--mid);white-space:nowrap;user-select:none}
.zoom-wrap{position:absolute;bottom:44px;right:12px;z-index:100;display:flex;flex-direction:column;gap:4px}
.statusbar{
  position:absolute;bottom:12px;left:12px;z-index:100;
  padding:4px 10px;
  background:color-mix(in srgb,var(--surface2) 88%,transparent);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  border:1px solid var(--border);border-radius:8px;
  color:var(--mid);font-size:11px
}
.tip{
  position:absolute;z-index:200;pointer-events:none;display:none;
  background:color-mix(in srgb,var(--surface2) 97%,transparent);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border:1px solid var(--border);border-radius:10px;
  padding:10px 14px;box-shadow:0 8px 28px rgba(0,0,0,.45);max-width:220px
}
.tip.show{display:block}
.tip-name{font-weight:600;font-size:13px;color:var(--text);margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tip-type{font-size:11px;color:var(--mid);margin-bottom:7px}
.tip-row{display:flex;gap:14px}
.tip-stat{font-size:11px;color:var(--mid)}
.tip-stat b{color:var(--text);font-weight:600}
.ctx{
  position:absolute;z-index:300;display:none;
  background:color-mix(in srgb,var(--surface2) 97%,transparent);
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border:1px solid var(--border);border-radius:10px;
  padding:6px;box-shadow:0 8px 28px rgba(0,0,0,.5);min-width:160px
}
.ctx.show{display:block}
.ctx-item{padding:7px 12px;border-radius:7px;cursor:pointer;font-size:12px;color:var(--text);display:flex;align-items:center;gap:9px;user-select:none;transition:background .1s}
.ctx-item:hover{background:rgba(255,255,255,.07)}
.ctx-ic{width:16px;text-align:center;font-size:13px;opacity:0.5;flex-shrink:0}
.empty{
  position:absolute;inset:0;z-index:50;display:none;flex-direction:column;
  align-items:center;justify-content:center;text-align:center;padding:32px;
  background:rgba(0,0,0,.08)
}
.empty.show{display:flex}
.empty-icon{font-size:40px;opacity:0.18;margin-bottom:16px}
.empty-title{font-size:15px;font-weight:700;color:var(--text);margin-bottom:8px}
.empty-desc{font-size:12px;color:var(--mid);line-height:1.6}
.sidebar{
  width:292px;flex-shrink:0;
  border-left:1px solid var(--border);
  background:var(--surface);
  display:flex;flex-direction:column;overflow:hidden
}
.sb-header{
  padding:14px 14px 12px;
  border-bottom:1px solid var(--border);
  background:linear-gradient(180deg,color-mix(in srgb,var(--accent2) 9%,transparent),transparent)
}
.sb-eyebrow{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent3);font-weight:700;margin-bottom:4px}
.sb-title{font-size:16px;font-weight:700;color:var(--text);line-height:1.1}
.sb-desc{font-size:11px;color:var(--dim);margin-top:5px;line-height:1.4}
.sb-scroll{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px}
.sb-scroll::-webkit-scrollbar{width:3px}
.sb-scroll::-webkit-scrollbar-track{background:transparent}
.sb-scroll::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
.card{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:11px 12px}
.card-hd{font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.09em;margin-bottom:9px}
.sel-hdr{display:flex;align-items:flex-start;gap:9px;margin-bottom:10px}
.sel-dot{width:11px;height:11px;border-radius:50%;flex-shrink:0;margin-top:2px}
.sel-meta{flex:1;min-width:0}
.sel-name{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
.sel-type{font-size:11px;color:var(--mid);margin-top:2px}
.sel-note{font-size:10px;color:var(--accent3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-top:4px}
.sel-stats{display:flex;gap:14px;margin-bottom:10px}
.sel-stat{font-size:11px;color:var(--mid);line-height:1.3}
.sel-stat b{display:block;font-size:20px;font-weight:700;color:var(--text);line-height:1.1}
.act-row{display:flex;gap:5px;flex-wrap:wrap}
.sel-empty{color:var(--dim);font-size:12px}
.chips{display:flex;flex-wrap:wrap;gap:5px}
.chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px 3px 7px;border-radius:999px;border:1px solid var(--border);background:var(--surface3);font-size:11px;cursor:pointer;color:var(--mid);transition:all .14s;user-select:none}
.chip:hover{border-color:rgba(255,255,255,.2);color:var(--text)}
.chip.on{border-color:rgba(196,155,240,.4);color:var(--accent2);background:rgba(196,155,240,.1)}
.chip-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.nlist{display:flex;flex-direction:column;gap:2px}
.nrow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;width:100%;text-align:left;background:transparent;border:none;color:var(--text);font:inherit;transition:background .1s}
.nrow:hover{background:rgba(255,255,255,.05)}
.nrow.on{background:rgba(196,155,240,.1);border-left:2px solid var(--accent2);padding-left:6px}
.nrow-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.nrow-info{flex:1;min-width:0}
.nrow-name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
.nrow-sub{font-size:10px;color:var(--mid);margin-top:1px;display:block}
.nrow-deg{font-size:11px;color:var(--dim);flex-shrink:0}
.rlist{display:flex;flex-direction:column;gap:5px}
.rrow{display:flex;align-items:center;gap:8px}
.rdot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.rname{flex:1;font-size:12px;color:var(--text)}
.rcnt{font-size:11px;color:var(--mid)}
.btn{padding:5px 10px;border-radius:7px;cursor:pointer;border:1px solid var(--border);background:var(--surface3);color:var(--text);font:inherit;font-size:11px;transition:background .12s,border-color .12s}
.btn:hover{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.18)}
.btn:disabled{opacity:.3;cursor:default;pointer-events:none}
.btn.seg{font-size:12px;padding:5px 11px}
.btn.seg.on{background:rgba(196,155,240,.15);border-color:rgba(196,155,240,.45);color:var(--accent2)}
.btn.pri{background:rgba(94,207,190,.12);border-color:rgba(94,207,190,.35);color:var(--accent)}
.btn.pri:hover{background:rgba(94,207,190,.22)}
.btn.sq{width:30px;height:30px;padding:0;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700}
.layer-btn{padding:4px 9px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--mid);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap;transition:background .1s,color .1s,border-color .1s}
.layer-btn:hover{color:var(--text)}
.layer-btn.on{background:rgba(94,207,190,.14);border-color:rgba(94,207,190,.4);color:var(--accent)}
.timelapse-bar{
  position:absolute;top:var(--graph-floating-top);left:12px;z-index:96;
  display:flex;align-items:center;gap:10px;
  padding:6px 12px 6px 8px;max-width:min(560px, calc(100% - 24px));
  background:color-mix(in srgb,var(--surface2) 90%,transparent);
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border:1px solid var(--border);border-radius:12px;
  box-shadow:0 4px 20px rgba(0,0,0,.28)
}
.timelapse-range{flex:1;min-width:120px;accent-color:var(--accent)}
.timelapse-label{font-size:11px;color:var(--mid);white-space:nowrap;min-width:150px}
.btn:focus-visible,.inp:focus-visible,.chip:focus-visible,.nrow:focus-visible,.ctx-item:focus-visible{outline:2px solid var(--accent2);outline-offset:2px}
.inp{padding:5px 10px;border-radius:7px;outline:none;border:1px solid var(--border);background:var(--surface3);color:var(--text);font:inherit;font-size:12px;transition:border-color .12s}
.inp:focus{border-color:rgba(196,155,240,.45)}
.inp::placeholder{color:var(--mid)}
.inp[type=search]{width:140px}
select.inp{cursor:pointer}
body.vscode-light{
  --bg-hover:color-mix(in srgb,var(--accent) 4%,var(--vscode-list-hoverBackground,rgba(31,35,40,.028)));
}
body.vscode-light .btn,body.vscode-light .chip,body.vscode-light .inp{box-shadow:none}
body.vscode-light .btn.refine-btn{color:color-mix(in srgb,var(--accent) 68%,var(--text))}
/* In light themes --mid (descriptionForeground) is a muted gray that becomes
   near-invisible on the light --surface3 (input-background) chip background.
   Override to use the main text color for readable contrast. */
body.vscode-light .chip{color:var(--text);background:color-mix(in srgb,var(--surface3) 55%,var(--border))}
body.vscode-light .chip.active{color:color-mix(in srgb,var(--accent) 80%,var(--text))}
body.vscode-light .live-bar{background:color-mix(in srgb,var(--surface) 58%,white)}
/* Narrow sidebar embed: hide internal info panel and advanced toolbar items */
@media (max-width: 520px) {
  .sidebar{display:none}
  .toolbar-advanced{display:none!important}
  .focus-pill{max-width:160px}
  .toolbar{gap:5px;padding:6px 8px}
}
.help-tip{
  display:inline-flex;align-items:center;justify-content:center;
  width:14px;height:14px;border-radius:50%;
  background:var(--surface3);border:1px solid var(--border);
  color:var(--mid);font-size:9px;font-weight:700;
  cursor:help;user-select:none;flex-shrink:0;margin-left:4px;
  transition:color .12s,border-color .12s;
}
.help-tip:hover{color:var(--accent);border-color:var(--accent)}
`;

module.exports = {
    GRAPH_BOOT_STYLES
};
