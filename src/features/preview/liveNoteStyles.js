'use strict';

const LIVE_TOOLBAR_STYLES = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  --yl-bg-base:var(--vscode-editor-background, #171717);
  --yl-bg-elevated:var(--vscode-editorWidget-background, var(--vscode-editor-background, #171717));
  --yl-bg-deep:var(--vscode-sideBar-background, var(--vscode-editor-background, #171717));
  --yl-border:var(--vscode-panel-border, #2E343E);
  --yl-text:var(--vscode-editor-foreground, #ECF2FF);
  --yl-text-muted:var(--vscode-descriptionForeground, #A7A39C);
  --yl-link:#C49BF0;
  --yl-teal:#5ECFBE;
  --yl-amber:#E7A85A;
  --yl-pink:#FF429F;
  color:var(--yl-text);
  background:var(--yl-bg-base);
  padding:0
}
#noteHost{display:block}
.toolbar{
  position:sticky;top:0;z-index:10;
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:7px 16px;
  background:color-mix(in srgb, var(--yl-bg-base) 92%, #000 8%);
  border-bottom:1px solid rgba(231,168,90,.10);
  min-height:40px
}
.toolbar-title-wrap{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.toolbar-title{
  color:#ecf2ff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap
}
.toolbar-subtitle{
  color:#a7a39c;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap
}
.toolbar-actions{display:flex;align-items:center;gap:8px}
.toolbar-btn{
  flex-shrink:0;padding:5px 12px;
  background:rgba(24,29,36,.92);
  color:#e7ddcf;
  border:1px solid rgba(231,168,90,.16);
  border-radius:999px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap
}
.toolbar-btn:hover{
  background:rgba(231,168,90,.10);
  color:#fff5e2
}
`;

const LIVE_NOTE_STYLES = `
:host {
  display:block;
  color:var(--vscode-editor-foreground, #ecf2ff);
  --yl-bg-base:var(--vscode-editor-background, #171717);
  --yl-bg-elevated:var(--vscode-editorWidget-background, var(--vscode-editor-background, #171717));
  --yl-bg-deep:var(--vscode-sideBar-background, var(--vscode-editor-background, #171717));
  --yl-border:var(--vscode-panel-border, #2E343E);
  --yl-text:var(--vscode-editor-foreground, #ECF2FF);
  --yl-text-muted:var(--vscode-descriptionForeground, #A7A39C);
  --yl-link:#C49BF0;
  --yl-teal:#5ECFBE;
  --yl-amber:#E7A85A;
  --yl-pink:#FF429F;
  background:var(--yl-bg-base);
}
.yl-live-shell{
  max-width: 1180px;
  margin: 10px auto 24px;
  padding: 0 14px 18px;
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  background:var(--yl-bg-base);
}
.yl-live-meta{
  padding: 12px 14px 10px;
  border:1px solid rgba(231,168,90,.10);
  border-radius:14px;
  background:
    radial-gradient(circle at top right, rgba(94,207,190,.04), transparent 32%),
    color-mix(in srgb, var(--yl-bg-base) 90%, #0b0d10 10%);
}
.yl-live-meta-top{
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:12px;
  margin-bottom:8px;
}
.yl-live-eyebrow{
  color:var(--yl-amber);
  font-size:10px;
  letter-spacing:.12em;
  text-transform:uppercase;
}
.yl-live-title{
  margin:0;
  color:var(--yl-text);
  font-size:18px;
  line-height:1.2;
}
.yl-live-pill-row{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  margin:0 0 8px;
}
.yl-live-pill{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:5px 9px;
  border-radius:999px;
  background:color-mix(in srgb, var(--yl-bg-base) 86%, #23180d 14%);
  border:1px solid rgba(231,168,90,.14);
  color:var(--yl-text);
  font-size:11px;
}
.yl-live-pill strong{
  color:var(--yl-amber);
  font-size:10px;
  letter-spacing:.09em;
}
.yl-live-pill--metric{
  background:color-mix(in srgb, var(--yl-bg-base) 88%, #1f1628 12%);
  border-color:rgba(196,155,240,.14);
}
.yl-live-pill--metric strong{ color:var(--yl-link); }
.yl-live-frontmatter-strip{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  align-items:center;
}
.yl-live-field-pill{
  appearance:none;
  display:inline-flex;
  align-items:center;
  gap:7px;
  text-align:left;
  padding:6px 9px;
  min-width:0;
  border-radius:999px;
  background:color-mix(in srgb, var(--yl-bg-base) 90%, #111 10%);
  border:1px solid color-mix(in srgb, var(--yl-border) 78%, transparent 22%);
  cursor:pointer;
}
.yl-live-field-pill:hover{
  border-color:rgba(231,168,90,.24);
  background:color-mix(in srgb, var(--yl-bg-base) 82%, #111 18%);
}
.yl-live-field-key{
  color:#d7a96b;
  font-size:10px;
  letter-spacing:.12em;
  text-transform:uppercase;
}
.yl-live-field-value{
  color:var(--yl-text);
  font-size:11px;
  line-height:1.2;
  word-break:break-word;
}
.yl-live-note-shell{
  margin-top:10px;
  padding:10px 0 0;
}
.yl-live-note-kicker{
  color:var(--yl-text-muted);
  font-size:10px;
  letter-spacing:.12em;
  text-transform:uppercase;
  margin:0 0 8px;
}
.yl-live-article{
  color:var(--yl-text);
  line-height:1.72;
}
.yl-live-article a{
  color:var(--yl-link);
}
.yl-live-article h1,.yl-live-article h2,.yl-live-article h3,.yl-live-article h4,.yl-live-article h5,.yl-live-article h6{
  color:var(--yl-text);
  font-weight:700;
}
.yl-live-article h1{font-size:1.75em}
.yl-live-article h2{font-size:1.28em;border-bottom:1px solid rgba(42,52,71,.92);padding-bottom:.22em}
.yl-live-article p,.yl-live-article li{color:var(--yl-text)}
.yl-live-heading{
  margin-left:-4px;
}
.yl-live-heading-jump{
  appearance:none;
  padding:0;
  border:none;
  background:none;
  color:inherit;
  font:inherit;
  cursor:pointer;
}
.yl-live-heading-jump:hover{
  color:var(--yl-link);
}
.yl-live-article blockquote{
  margin:1em 0;
  padding:.65em 1em;
  border-left:3px solid rgba(94,207,190,.45);
  background:color-mix(in srgb, var(--yl-bg-base) 90%, #0f221e 10%);
  color:#cfe9e5;
}
.yl-live-article code{
  font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;
  background:color-mix(in srgb, var(--yl-bg-base) 90%, #fff 10%);
  color:#ffd8a8;
  border-radius:4px;
  padding:2px 5px;
}
.yl-live-article pre{
  background:color-mix(in srgb, var(--yl-bg-base) 88%, #000 12%);
  border:1px solid rgba(42,52,71,.92);
  border-radius:10px;
  padding:1em 1.2em;
  overflow-x:auto;
}
.yl-live-article table{
  width:100%;
  border-collapse:collapse;
  margin:0 0 1.2em;
}
.yl-live-article th{
  background:color-mix(in srgb, var(--yl-bg-base) 88%, #111 12%);
  color:var(--yl-text);
  border:1px solid rgba(42,52,71,.92);
  padding:7px 10px;
  text-align:left;
}
.yl-live-article td{
  background:color-mix(in srgb, var(--yl-bg-base) 94%, #000 6%);
  color:var(--yl-text);
  border:1px solid rgba(42,52,71,.92);
  padding:7px 10px;
}
.yl-live-article .wikilink{
  color:var(--yl-link);
  background:rgba(196,155,240,.10);
  border-radius:4px;
  padding:1px 4px;
}
.yl-live-article .view-block{
  position:relative;
  padding-top:14px;
}
.yl-live-article .view-block::before{
  content:'view';
  position:absolute;
  top:0;
  right:0;
  color:var(--yl-amber);
  font-size:10px;
  letter-spacing:.12em;
  text-transform:uppercase;
}
.yl-live-article .view-label{
  color:var(--yl-amber);
}
.yl-live-article .preview-empty{
  color:var(--yl-text-muted);
}
.yl-live-source-hint{
  margin-top:8px;
  color:var(--yl-text-muted);
  font-size:10px;
}
`;

module.exports = {
    LIVE_NOTE_STYLES,
    LIVE_TOOLBAR_STYLES
};
