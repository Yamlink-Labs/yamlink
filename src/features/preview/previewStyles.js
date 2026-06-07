'use strict';

// Applied to the outer shell (toolbar + body background).
// Uses VS Code CSS variables so the chrome matches the active theme.
const TOOLBAR_STYLES = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--vscode-sideBar-background,#e4e4e4);padding:0}
#noteHost{display:block}
.toolbar{
  position:sticky;top:0;z-index:10;
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:6px 16px;
  background:var(--vscode-editorGroupHeader-tabsBackground,#2d2d30);
  border-bottom:1px solid var(--vscode-panel-border,#444);
  min-height:36px
}
.toolbar-title{
  color:var(--vscode-foreground,#ccc);font-size:12px;font-weight:600;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0
}
.print-btn{
  flex-shrink:0;padding:4px 12px;
  background:var(--vscode-button-background,#0078d4);
  color:var(--vscode-button-foreground,#fff);
  border:none;border-radius:4px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap
}
.print-btn:hover{opacity:.88}
`;

// Applied inside a Shadow DOM — completely isolated from VS Code's injected CSS.
// No !important needed; no parent theme can bleed through the shadow boundary.
//
// Font: Inter via system font stack. VS Code webviews block external requests so
// Google Fonts can't load — Inter is used when the user has it installed (common
// among developers), with clean system UI fallbacks otherwise.
const NOTE_STYLES = `
:host { display: block; }
article {
  max-width: 760px;
  margin: 28px auto 48px;
  padding: 52px 60px;
  background: #ffffff;
  color: #111111;
  line-height: 1.75;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 15px;
  box-shadow: 0 1px 4px rgba(0,0,0,.1), 0 4px 24px rgba(0,0,0,.07);
  border-radius: 2px;
}
h1, h2, h3, h4, h5, h6 {
  color: #111111;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-weight: 600;
}
h1 { font-size: 1.9em; font-weight: 700; margin: 0 0 .4em; line-height: 1.2; }
h2 { font-size: 1.35em; margin: 1.5em 0 .4em; padding-bottom: .25em; border-bottom: 1px solid #e8e8e8; }
h3 { font-size: 1.1em; margin: 1.3em 0 .3em; }
h4, h5, h6 { font-size: 1em; margin: 1.1em 0 .25em; }
p { margin: 0 0 1em; color: #111111; }
ul, ol { margin: 0 0 1em 1.6em; padding: 0; color: #111111; }
li { margin-bottom: .3em; color: #111111; }
li p { margin: 0; }
strong { font-weight: 600; color: #111111; }
em { font-style: italic; color: #111111; }
blockquote {
  margin: 1em 0; padding: .5em 1em .5em 1.1em;
  border-left: 3px solid #d8d8d8; color: #555555; background: #f9f9f9;
}
hr { border: none; border-top: 1px solid #e8e8e8; margin: 1.6em 0; }
a { color: #C49BF0; text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; height: auto; }
code {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: .84em; background: #f2f2f2; padding: 2px 5px; border-radius: 3px; color: #c0392b;
}
pre {
  background: #f6f8fa; border: 1px solid #e4e4e4; border-radius: 5px;
  padding: 1em 1.2em; overflow-x: auto; margin: 0 0 1em; font-size: .84em; line-height: 1.55;
}
pre code { background: none; padding: 0; color: #1a1a1a; font-size: inherit; border-radius: 0; }
table {
  width: 100%; border-collapse: collapse; margin: 0 0 1.2em;
  font-size: .9em; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: #ffffff; color: #111111;
}
thead tr { background: #f4f5f7; }
th {
  background: #f4f5f7; color: #111111; font-weight: 600; text-align: left;
  padding: 8px 12px; border: 1px solid #d0d4d9;
}
td { padding: 7px 12px; border: 1px solid #d0d4d9; color: #111111; background: #ffffff; }
tbody tr:nth-child(even) td { background: #f8f9fa; }
.wikilink { color: #C49BF0; background: rgba(196,155,240,.08); border-radius: 3px; padding: 1px 4px; }
.preview-empty { color: #888; font-style: italic; }
.preview-error { color: #b91c1c; font-style: italic; }
.view-block { margin: 1.4em 0; }
.view-label {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: .72em; font-weight: 700; text-transform: uppercase;
  letter-spacing: .07em; color: #E7A85A; margin-bottom: .45em;
}
.view-empty { font-style: italic; color: #888; font-size: .9em; }
.view-error { font-style: italic; color: #b91c1c; font-size: .9em; }
.view-table {
  width: 100%; border-collapse: collapse; margin: 0;
  font-size: .88em; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
.view-table th {
  background: #f4f5f7; color: #111; font-weight: 600; text-align: left;
  padding: 6px 10px; border: 1px solid #d0d4d9;
}
.view-table td { padding: 5px 10px; border: 1px solid #d0d4d9; color: #111; background: #fff; }
.view-table tbody tr:nth-child(even) td { background: #f8f9fa; }
`;

module.exports = { TOOLBAR_STYLES, NOTE_STYLES };
