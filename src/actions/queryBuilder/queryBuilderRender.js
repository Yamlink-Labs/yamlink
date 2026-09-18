'use strict';

function getQueryBuilderStyles() {
    return `    :root {
      --yl-bg-deepest: color-mix(in srgb, var(--vscode-sideBar-background, #151617) 92%, #0F1011 8%);
      --yl-bg-base: color-mix(in srgb, var(--vscode-editor-background, #151617) 94%, #151617 6%);
      --yl-bg-elevated: color-mix(in srgb, var(--vscode-editorWidget-background, #1C1D1F) 92%, #1C1D1F 8%);
      --yl-bg-hover: color-mix(in srgb, var(--vscode-list-hoverBackground, rgba(53,56,61,.38)) 68%, #222427 32%);
      --yl-bg-active: color-mix(in srgb, var(--vscode-list-activeSelectionBackground, rgba(53,56,61,.48)) 56%, #2B2D31 44%);
      --yl-border: color-mix(in srgb, var(--vscode-panel-border, #2a2a2a) 78%, #35383D 22%);
      --yl-border-strong: color-mix(in srgb, var(--vscode-panel-border, #2a2a2a) 62%, #35383D 38%);
      --yl-text: var(--vscode-editor-foreground, #d6ddf2);
      --yl-muted: color-mix(in srgb, var(--vscode-descriptionForeground, #8b949e) 88%, #d2dae3 12%);
      --yl-muted-strong: color-mix(in srgb, var(--vscode-descriptionForeground, #8b949e) 72%, #d2dae3 28%);
      --yl-link: #C49BF0;
      --yl-mint: #C5FFBF;
      --yl-teal: #5ECFBE;
      --yl-pink: #FF429F;
      --yl-amber: color-mix(in srgb, var(--vscode-editorLightBulb-foreground, #E7A85A) 72%, #E7A85A 28%);
      --bg: var(--yl-bg-base);
      --surface: var(--yl-bg-base);
      --surface-alt: var(--yl-bg-deepest);
      --surface-strong: var(--yl-bg-active);
      --surface-card: var(--yl-bg-elevated);
      --fg: var(--yl-text);
      --muted: var(--yl-muted-strong);
      --muted-2: var(--yl-muted);
      --border: var(--yl-border);
      --border-strong: var(--yl-border-strong);
      --input-border: var(--yl-border);
      --input-bg: color-mix(in srgb, var(--yl-bg-base) 96%, #0F1011 4%);
      --input-fg: var(--yl-text);
      --accent: var(--yl-mint);
      --accent-2: var(--yl-link);
      --accent-3: var(--yl-amber);
      --accent-soft: color-mix(in srgb, var(--yl-mint) 12%, transparent);
      --accent-2-soft: color-mix(in srgb, var(--yl-link) 12%, transparent);
      --accent-3-soft: color-mix(in srgb, var(--yl-amber) 12%, transparent);
      --shadow-soft: 0 10px 30px rgba(0,0,0,.18);
      --shadow-inset: inset 0 1px 0 rgba(255,255,255,.03);
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: var(--fg);
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--yl-bg-base) 94%, #0F1011 6%) 0%, var(--yl-bg-base) 100%);
    }
    .shell {
      display: grid;
      grid-template-columns: minmax(148px, 0.28fr) minmax(520px, 1.08fr) minmax(272px, 0.5fr);
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, color-mix(in srgb, var(--yl-link) 7%, transparent), transparent 28%),
        radial-gradient(circle at top right, color-mix(in srgb, var(--yl-mint) 6%, transparent), transparent 26%),
        linear-gradient(180deg, color-mix(in srgb, var(--yl-bg-base) 98%, transparent), var(--yl-bg-base));
    }
    .rail,
    .builder,
    .preview {
      min-width: 0;
    }
    .rail {
      border-right: 1px solid var(--border);
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--yl-bg-deepest) 96%, transparent), color-mix(in srgb, var(--yl-bg-base) 98%, transparent));
      padding: 11px 9px 11px 11px;
    }
    .builder {
      padding: 11px 11px 14px;
      border-right: 1px solid var(--border);
    }
    .preview {
      padding: 11px 11px 14px 9px;
    }
    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
    }
    .brand-mark {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .brand-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: linear-gradient(180deg, var(--yl-pink), color-mix(in srgb, var(--yl-pink) 72%, white 28%));
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--yl-pink) 10%, transparent);
      flex-shrink: 0;
    }
    .brand-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .1em;
      text-transform: uppercase;
      color: var(--yl-pink);
    }
    .brand-state {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 9px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--border) 84%, var(--yl-mint) 16%);
      background: color-mix(in srgb, var(--surface-card) 92%, var(--yl-mint) 8%);
      color: var(--accent);
      font-size: 11px;
    }
    .rail-card,
    .section,
    .preview-card {
      border: 1px solid var(--border);
      border-radius: 14px;
      background: color-mix(in srgb, var(--yl-bg-elevated) 96%, var(--yl-link) 4%);
      box-shadow: var(--shadow-inset);
    }
    .rail-card {
      padding: 9px 9px 8px;
      margin-bottom: 6px;
    }
    .rail-title {
      font-size: 10px;
      letter-spacing: .1em;
      text-transform: uppercase;
      color: var(--muted-2);
      margin-bottom: 8px;
    }
    .rail-stack {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .rail-pill {
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 9px;
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
      background: color-mix(in srgb, var(--surface-alt) 62%, transparent);
      color: var(--fg);
      font-size: 11px;
    }
    .rail-pill strong {
      font-size: 11px;
      letter-spacing: .04em;
      text-transform: uppercase;
      color: var(--muted-2);
      font-weight: 600;
    }
    .rail-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .rail-list li {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 10px;
      align-items: start;
      font-size: 11px;
      color: var(--muted);
      line-height: 1.5;
    }
    .rail-list-index {
      width: 18px;
      height: 18px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid color-mix(in srgb, var(--border) 70%, var(--yl-link) 30%);
      background: color-mix(in srgb, var(--surface-card) 84%, var(--yl-link) 16%);
      color: var(--accent-2);
      font-size: 9px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .rail-list strong {
      display: block;
      color: var(--fg);
      font-size: 11px;
      margin-bottom: 1px;
    }
    .progress-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .progress-item {
      display: grid;
      grid-template-columns: 20px 1fr;
      gap: 9px;
      align-items: start;
      padding: 7px 8px;
      border-radius: 12px;
      border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
      background: color-mix(in srgb, var(--surface-alt) 56%, transparent);
    }
    .progress-dot {
      width: 20px;
      height: 20px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid color-mix(in srgb, var(--border) 70%, var(--yl-link) 30%);
      background: color-mix(in srgb, var(--surface-card) 84%, var(--yl-link) 16%);
      color: var(--accent-2);
      font-size: 10px;
      font-weight: 700;
    }
    .progress-copy strong {
      display: block;
      color: var(--fg);
      font-size: 11px;
      margin-bottom: 2px;
    }
    .progress-copy span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .builder-header {
      position: relative;
      overflow: hidden;
      padding: 8px 11px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background:
        linear-gradient(90deg, color-mix(in srgb, var(--yl-mint) 7%, transparent), transparent 46%),
        color-mix(in srgb, var(--yl-bg-elevated) 96%, var(--yl-link) 4%);
      box-shadow: var(--shadow-inset);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .builder-header::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: linear-gradient(180deg, var(--yl-pink), var(--yl-mint));
      opacity: .82;
    }
    .eyebrow {
      font-size: 10px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--accent-3);
      margin-bottom: 3px;
    }
    h1 {
      margin: 0;
      font-size: 14px;
      line-height: 1.1;
      color: var(--accent-2);
      letter-spacing: -.02em;
    }
    .hero-copy {
      color: var(--muted);
      line-height: 1.35;
      max-width: 42ch;
      font-size: 11px;
    }
    .builder-header-copy {
      min-width: 0;
      flex: 1;
    }
    .builder-header-hint {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 10px;
      white-space: nowrap;
    }
    .hero-meta,
    .section-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }
    .chip {
      padding: 4px 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--surface-card) 84%, var(--yl-mint) 16%);
      border: 1px solid color-mix(in srgb, var(--border) 74%, var(--yl-mint) 26%);
      color: var(--accent);
      font-size: 10.5px;
      font-weight: 600;
    }
    .section-badge {
      padding: 3px 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--surface-card) 72%, transparent);
      border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
      color: var(--muted-2);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: .03em;
      text-transform: uppercase;
    }
    .section {
      padding: 9px;
      margin-top: 8px;
    }
    .builder-tabs {
      display: inline-flex;
      align-items: center;
      gap: 0;
      margin: 0 0 8px;
      padding: 0;
    }
    .builder-tab {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--muted);
      border-radius: 0;
      padding: 7px 10px;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      transition: background-color .14s ease, border-color .14s ease, color .14s ease, transform .14s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .builder-tab:hover {
      color: var(--fg);
      transform: translateY(-1px);
    }
    .builder-tab.active {
      color: var(--accent-2);
    }
    .builder-tab::after {
      content: '';
      width: 28px;
      height: 1px;
      background: color-mix(in srgb, var(--border) 80%, transparent);
      margin-left: 2px;
    }
    .builder-tab:last-child::after {
      display: none;
    }
    .builder-step {
      width: 20px;
      height: 20px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid color-mix(in srgb, var(--border) 74%, var(--yl-link) 26%);
      background: color-mix(in srgb, var(--surface-card) 84%, var(--yl-link) 16%);
      color: var(--accent-2);
      font-size: 10px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .builder-tab.active .builder-step {
      background: color-mix(in srgb, var(--yl-bg-active) 72%, var(--yl-mint) 28%);
      border-color: color-mix(in srgb, var(--yl-mint) 56%, var(--border));
      color: var(--accent);
    }
    .builder-tab-preview {
      opacity: .78;
      cursor: default;
      pointer-events: none;
    }
    .builder-panel {
      display: none;
    }
    .builder-panel.active {
      display: block;
    }
    .section-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .section-kicker {
      font-size: 10px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--muted-2);
      margin-bottom: 5px;
    }
    .section-title {
      margin: 0;
      font-size: 14px;
      color: var(--fg);
      letter-spacing: -.01em;
    }
    .section-copy {
      margin-top: 2px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
      max-width: 56ch;
    }
    .section-index {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--border) 72%, var(--yl-link) 28%);
      background: color-mix(in srgb, var(--surface-card) 82%, var(--yl-link) 18%);
      color: var(--accent-2);
      font-size: 10px;
      font-weight: 700;
    }
    .mode-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 9px;
    }
    .mode-btn {
      appearance: none;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--surface-alt) 72%, transparent);
      color: var(--muted);
      border-radius: 14px;
      padding: 6px 10px;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      transition: background-color .14s ease, border-color .14s ease, color .14s ease, transform .14s ease;
    }
    .mode-btn:hover {
      background: color-mix(in srgb, var(--yl-bg-hover) 80%, transparent);
      border-color: color-mix(in srgb, var(--border-strong) 62%, var(--yl-link) 38%);
      color: var(--fg);
      transform: translateY(-1px);
    }
    .mode-btn.active {
      background: color-mix(in srgb, var(--surface-alt) 74%, var(--yl-link) 9%);
      border-color: color-mix(in srgb, var(--yl-link) 48%, var(--border));
      color: color-mix(in srgb, var(--fg) 88%, var(--yl-link) 12%);
      box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--yl-mint) 70%, transparent);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .field.span-2 { grid-column: span 2; }
    .field.compact-select select {
      max-width: 240px;
    }
    label {
      font-size: 12px;
      color: var(--muted-2);
      letter-spacing: .01em;
    }
    input, select, textarea {
      width: 100%;
      border-radius: 12px;
      border: 1px solid var(--input-border);
      background: var(--input-bg);
      color: var(--input-fg);
      padding: 8px 10px;
      font: inherit;
      box-shadow: var(--shadow-inset);
      transition: border-color .14s ease, box-shadow .14s ease, background-color .14s ease;
    }
    input:hover, select:hover, textarea:hover {
      border-color: var(--border-strong);
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--yl-mint) 28%, transparent), var(--shadow-inset);
    }
    textarea {
      min-height: 72px;
      resize: vertical;
      line-height: 1.45;
    }
    .field-help {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.45;
    }
    .checkbox-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 6px;
      margin-top: 4px;
    }
    .checkbox-chip {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 7px 9px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--surface-alt) 68%, transparent);
      font-size: 12px;
      color: var(--fg);
    }
    .checkbox-chip.computed-field {
      border-color: color-mix(in srgb, var(--yl-link) 34%, var(--border));
      background:
        radial-gradient(circle at top right, color-mix(in srgb, var(--yl-link) 12%, transparent), transparent 42%),
        color-mix(in srgb, var(--surface-alt) 72%, transparent);
    }
    .checkbox-chip input {
      width: auto;
      margin: 0;
      transform: translateY(2px);
    }
    .field-chip-copy {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .field-chip-help {
      color: var(--muted);
      font-size: 10px;
      line-height: 1.3;
    }
    .preview-shell {
      display: flex;
      flex-direction: column;
      gap: 10px;
      position: sticky;
      top: 10px;
    }
    .preview-card {
      padding: 9px 9px 10px;
    }
    .preview-card-primary {
      position: relative;
      overflow: hidden;
      border-color: color-mix(in srgb, var(--border) 82%, var(--yl-mint) 18%);
      background: color-mix(in srgb, var(--yl-bg-elevated) 95%, var(--yl-link) 5%);
    }
    .preview-card-primary::before {
      content: '';
      position: absolute;
      inset: 0 0 auto;
      height: 3px;
      background: linear-gradient(90deg, var(--yl-mint), color-mix(in srgb, var(--yl-link) 82%, var(--yl-mint) 18%));
      opacity: .75;
    }
    .preview-head {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .preview-kicker {
      font-size: 10px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--muted-2);
      margin-bottom: 6px;
    }
    .preview-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--fg);
      letter-spacing: -.01em;
    }
    .preview-sub {
      margin-top: 2px;
      color: var(--muted);
      line-height: 1.45;
      font-size: 11px;
    }
    .preview-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 8px;
      margin-bottom: 9px;
      border: 1px solid color-mix(in srgb, var(--border) 82%, var(--yl-mint) 18%);
      border-radius: 10px;
      background: color-mix(in srgb, var(--surface-alt) 70%, var(--yl-mint) 5%);
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .preview-status strong {
      color: var(--accent);
      font-weight: 600;
    }
    .preview-explanation {
      margin: 0 0 10px;
      padding: 8px 10px 8px 11px;
      border-left: 2px solid color-mix(in srgb, var(--yl-mint) 82%, var(--yl-link) 18%);
      border-radius: 10px;
      background: color-mix(in srgb, var(--surface-alt) 68%, transparent);
      color: color-mix(in srgb, var(--fg) 88%, var(--muted) 12%);
      font-size: 12px;
      line-height: 1.45;
    }
    .preset-panel {
      position: relative;
      overflow: hidden;
      padding: 10px;
      border: 1px solid color-mix(in srgb, var(--border) 82%, var(--yl-link) 18%);
      border-radius: 14px;
      background: color-mix(in srgb, var(--yl-bg-elevated) 95%, var(--yl-link) 5%);
      margin-bottom: 12px;
    }
    .preset-panel::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: var(--yl-link);
      opacity: .62;
    }
    .preset-panel-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .preset-title {
      color: var(--fg);
      font-size: 12px;
      font-weight: 700;
    }
    .preset-copy {
      color: var(--muted);
      font-size: 10px;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .preset-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
      gap: 8px;
    }
    .preset-btn {
      appearance: none;
      text-align: left;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: color-mix(in srgb, var(--surface-alt) 76%, transparent);
      color: var(--fg);
      padding: 8px 9px;
      cursor: pointer;
      min-height: 66px;
    }
    .preset-btn:hover {
      border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
      background: color-mix(in srgb, var(--surface-alt) 82%, var(--yl-mint) 6%);
    }
    .preset-btn strong {
      display: block;
      font-size: 12px;
      margin-bottom: 3px;
    }
    .preset-btn span {
      display: block;
      color: var(--muted);
      font-size: 10px;
      line-height: 1.35;
    }
    .stat-line {
      display: flex;
      gap: 8px;
      align-items: baseline;
      margin-bottom: 10px;
      padding: 9px 10px;
      border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
      border-radius: 12px;
      background: color-mix(in srgb, var(--surface-alt) 76%, transparent);
    }
    .stat-big {
      font-size: 24px;
      color: var(--accent);
      font-weight: 600;
      letter-spacing: -.03em;
    }
    .stat-copy {
      color: var(--muted);
    }
    pre {
      margin: 0;
      padding: 10px 11px;
      border-radius: 12px;
      overflow: auto;
      background: color-mix(in srgb, var(--surface-alt) 76%, transparent);
      border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
      color: color-mix(in srgb, var(--fg) 96%, var(--yl-mint) 4%);
      line-height: 1.5;
      font-size: 12px;
    }
    .layout-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin: 0 0 10px;
    }
    .layout-toggle {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .layout-btn {
      appearance: none;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--surface-alt) 72%, transparent);
      color: var(--muted);
      border-radius: 999px;
      padding: 6px 10px;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      transition: background-color .14s ease, border-color .14s ease, color .14s ease, transform .14s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .layout-btn:hover {
      background: color-mix(in srgb, var(--yl-bg-hover) 80%, transparent);
      color: var(--fg);
      transform: translateY(-1px);
    }
    .layout-btn.active {
      background: color-mix(in srgb, var(--yl-bg-active) 72%, var(--yl-link) 28%);
      border-color: color-mix(in srgb, var(--yl-link) 56%, var(--border));
      color: var(--accent-2);
    }
    .layout-btn[disabled] {
      opacity: .42;
      cursor: not-allowed;
      transform: none;
    }
    .layout-btn-icon,
    .status-icon {
      width: 14px;
      height: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: currentColor;
      flex-shrink: 0;
    }
    .layout-btn-icon svg,
    .status-icon svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .layout-config {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .layout-note {
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .compact-stack {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .choice-group {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .choice-btn {
      appearance: none;
      border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
      background: color-mix(in srgb, var(--surface-alt) 62%, transparent);
      color: var(--muted);
      border-radius: 999px;
      padding: 7px 11px;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      transition: background-color .14s ease, border-color .14s ease, color .14s ease, transform .14s ease;
    }
    .choice-btn:hover {
      background: color-mix(in srgb, var(--yl-bg-hover) 76%, transparent);
      color: var(--fg);
      transform: translateY(-1px);
    }
    .choice-btn.active {
      background: color-mix(in srgb, var(--yl-bg-active) 72%, var(--yl-link) 28%);
      border-color: color-mix(in srgb, var(--yl-link) 54%, var(--border));
      color: var(--accent-2);
    }
    .field-inline-help {
      margin-top: 6px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .subsection {
      border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
      border-radius: 12px;
      background: color-mix(in srgb, var(--surface-alt) 48%, transparent);
      overflow: hidden;
    }
    .subsection summary {
      list-style: none;
      cursor: pointer;
      padding: 8px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: var(--fg);
      font-size: 12px;
      font-weight: 600;
    }
    .subsection summary::-webkit-details-marker { display: none; }
    .subsection summary::after {
      content: '+';
      color: var(--muted-2);
      font-size: 14px;
      line-height: 1;
    }
    .subsection[open] summary::after { content: '−'; }
    .subsection-head {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .subsection-title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .subsection-copy {
      color: var(--muted);
      font-size: 11px;
      font-weight: 400;
    }
    .subsection-state {
      color: var(--muted);
      font-size: 11px;
      font-weight: 500;
    }
    .subsection-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 6px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--border) 76%, var(--yl-link) 24%);
      background: color-mix(in srgb, var(--surface-card) 82%, var(--yl-link) 18%);
      color: var(--accent-2);
      font-size: 10px;
      font-weight: 700;
    }
    .subsection-body {
      padding: 0 10px 10px;
    }
    .preview-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .warning-list, .sample-list {
      margin: 0;
      padding: 0;
      color: var(--muted);
      list-style: none;
    }
    .warning-list li,
    .sample-list li {
      padding: 8px 9px;
      border-radius: 12px;
      border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
      background: color-mix(in srgb, var(--surface-alt) 62%, transparent);
      line-height: 1.45;
      font-size: 12px;
    }
    .warning-list li {
      border-color: color-mix(in srgb, var(--border) 74%, var(--yl-amber) 26%);
      background: color-mix(in srgb, var(--surface-card) 86%, var(--yl-amber) 14%);
      color: color-mix(in srgb, var(--fg) 88%, var(--yl-amber) 12%);
    }
    .sample-row {
      display: grid;
      gap: 3px;
    }
    .sample-row-primary {
      color: var(--fg);
      font-weight: 600;
      line-height: 1.3;
    }
    .sample-row-secondary {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .sample-pill {
      padding: 2px 7px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
      background: color-mix(in srgb, var(--surface-card) 74%, transparent);
      color: var(--accent-2);
      font-size: 10px;
      font-weight: 600;
    }
    .preview-empty {
      padding: 10px 11px;
      border-radius: 12px;
      border: 1px dashed color-mix(in srgb, var(--border) 84%, transparent);
      background: color-mix(in srgb, var(--surface-alt) 54%, transparent);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .actions {
      display: flex;
      gap: 6px;
      margin-top: 9px;
      flex-wrap: wrap;
    }
    .btn {
      appearance: none;
      border-radius: 14px;
      padding: 6px 10px;
      border: 1px solid color-mix(in srgb, var(--border) 74%, var(--yl-mint) 26%);
      background: color-mix(in srgb, var(--yl-bg-active) 78%, var(--yl-mint) 22%);
      color: var(--accent);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      transition: transform .14s ease, border-color .14s ease, background-color .14s ease, color .14s ease;
    }
    .btn.primary {
      padding-inline: 14px;
      min-width: 112px;
      justify-content: center;
      display: inline-flex;
      align-items: center;
    }
    .btn:hover {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--yl-mint) 56%, var(--border));
    }
    .btn.secondary {
      background: color-mix(in srgb, var(--surface-alt) 72%, transparent);
      border-color: var(--border);
      color: var(--fg);
      font-weight: 600;
    }
    .hidden { display: none !important; }
    @media (max-width: 1200px) {
      .shell { grid-template-columns: minmax(140px, 0.28fr) minmax(420px, 1fr); }
      .preview {
        grid-column: 1 / -1;
        border-top: 1px solid var(--border);
        padding-left: 18px;
      }
      .builder { border-right: none; }
      .preview-shell { position: static; }
    }
    @media (max-width: 880px) {
      .shell { grid-template-columns: 1fr; }
      .rail,
      .builder {
        border-right: none;
      }
      .rail,
      .builder,
      .preview {
        border-bottom: 1px solid var(--border);
      }
      .builder,
      .preview,
      .rail {
        padding: 14px;
      }
    }
    @media (max-width: 640px) {
      .grid { grid-template-columns: 1fr; }
      .layout-config { grid-template-columns: 1fr; }
      .field.span-2 { grid-column: span 1; }
      .brand-row { flex-direction: column; align-items: flex-start; }
      h1 { font-size: 18px; }
      .builder-header {
        flex-direction: column;
        align-items: flex-start;
      }
      .builder-tabs {
        width: 100%;
        justify-content: flex-start;
        overflow-x: auto;
      }
      .builder-tab {
        flex: 0 0 auto;
        text-align: left;
      }
      .builder-tab::after {
        width: 16px;
      }
    }
`;
}

function getQueryBuilderBodyMarkup() {
    return `<body>
  <div class="shell">
    <aside class="rail">
      <div class="brand-row">
        <div class="brand-mark">
          <span class="brand-dot"></span>
          <span class="brand-title">Yamlink Query Builder</span>
        </div>
        <span class="brand-state">Build</span>
      </div>

      <div class="rail-card">
        <div class="rail-title">Context</div>
        <div class="hero-meta" id="hero-meta"></div>
      </div>

      <div class="rail-card">
        <div class="rail-title">Progress</div>
        <div class="progress-list">
          <div class="progress-item">
            <span class="progress-dot">1</span>
            <div class="progress-copy"><strong>Query</strong><span>Pick the family and primary scope first.</span></div>
          </div>
          <div class="progress-item">
            <span class="progress-dot">2</span>
            <div class="progress-copy"><strong>Refine</strong><span>Keep columns visible, expand filters only when needed.</span></div>
          </div>
          <div class="progress-item">
            <span class="progress-dot">3</span>
            <div class="progress-copy"><strong>Preview</strong><span>Inspect the real syntax, then insert or open it live.</span></div>
          </div>
        </div>
      </div>
    </aside>

    <main class="builder">
      <div class="builder-header">
        <div class="builder-header-copy">
          <div class="eyebrow">Yamlink Query Builder</div>
          <h1>Build a <code>!view</code></h1>
        </div>
        <div class="builder-header-hint">Type → Columns → Filters → Insert</div>
      </div>

      <div class="builder-tabs" role="tablist" aria-label="Query builder steps">
        <button class="builder-tab active" id="builder-tab-1" data-builder-tab="1" role="tab" aria-selected="true" aria-controls="builder-panel-1"><span class="builder-step">1</span><span>View</span></button>
        <button class="builder-tab" id="builder-tab-2" data-builder-tab="2" role="tab" aria-selected="false" aria-controls="builder-panel-2"><span class="builder-step">2</span><span>Shape</span></button>
        <button class="builder-tab builder-tab-preview" type="button" aria-hidden="true"><span class="builder-step">3</span><span>Preview</span></button>
      </div>

      <div class="builder-panel active" id="builder-panel-1" role="tabpanel" aria-labelledby="builder-tab-1">
      <div class="section">
        <div class="section-head">
          <div>
            <div class="section-kicker">Step 1</div>
            <div class="section-title">View Kind</div>
            <div class="section-copy">Choose the query family first.</div>
          </div>
          <div class="section-index">01</div>
        </div>
        <div class="mode-row">
          <button class="mode-btn" data-mode="table">Table</button>
          <button class="mode-btn" data-mode="incoming">Incoming</button>
          <button class="mode-btn" data-mode="tasks">Tasks</button>
        </div>
      </div>
      </div>

      <div class="builder-panel" id="builder-panel-2" role="tabpanel" aria-labelledby="builder-tab-2">
      <div class="section">
        <div class="section-head">
          <div>
            <div class="section-kicker">Step 2</div>
            <div class="section-title">Scope, Fields, and Clauses</div>
            <div class="section-copy">Set the minimum shape first, then refine from the live view if needed.</div>
          </div>
          <div class="section-index">02</div>
        </div>
        <div class="section-meta">
          <span class="section-badge">Type-aware</span>
          <span class="section-badge">Vault-derived</span>
          <span class="section-badge">Insert-ready</span>
        </div>
        <div class="compact-stack">
          <div class="grid">
            <div class="field compact-select" id="field-type-wrap">
              <label for="field-type">Type</label>
              <select id="field-type"></select>
            </div>
            <div class="field hidden" id="field-task-wrap">
              <label for="field-task-preset">Task preset</label>
              <select id="field-task-preset"></select>
            </div>
            <div class="field" id="field-select-mode-wrap">
              <label>Columns</label>
              <div class="choice-group" id="field-select-mode">
                <button class="choice-btn" type="button" data-select-mode="smart">Recommended</button>
                <button class="choice-btn" type="button" data-select-mode="all">All fields</button>
                <button class="choice-btn" type="button" data-select-mode="custom">Custom</button>
              </div>
              <div class="field-inline-help" id="columns-help">Start with the fields Yamlink sees most often for this note type.</div>
            </div>
            <div class="field" id="field-group-wrap">
              <label for="field-group-by">Group by</label>
              <select id="field-group-by"></select>
            </div>
            <div class="field" id="field-via-wrap">
              <label for="field-via">Via relation field</label>
              <select id="field-via"></select>
            </div>
          </div>

          <details class="subsection" id="layout-section">
            <summary>
              <span class="subsection-head"><span class="subsection-title"><span>Result layout</span><span class="subsection-state" id="layout-state">Table</span></span><span class="subsection-copy">Choose how Yamlink should render this view</span></span>
              <span class="subsection-badge" id="layout-badge">table</span>
            </summary>
            <div class="subsection-body">
              <div class="layout-strip">
                <div class="layout-toggle" id="layout-toggle"></div>
              </div>
              <div class="layout-config" id="layout-config">
                <div class="field hidden" id="layout-matrix-wrap">
                  <label for="layout-matrix-col">Matrix columns</label>
                  <select id="layout-matrix-col"></select>
                </div>
                <div class="field hidden" id="layout-bar-wrap">
                  <label for="layout-bar-group">Bar group by</label>
                  <select id="layout-bar-group"></select>
                </div>
                <div class="field hidden" id="layout-scatter-x-wrap">
                  <label for="layout-scatter-x">Scatter X</label>
                  <select id="layout-scatter-x"></select>
                </div>
                <div class="field hidden" id="layout-scatter-y-wrap">
                  <label for="layout-scatter-y">Scatter Y</label>
                  <select id="layout-scatter-y"></select>
                </div>
              </div>
              <div class="layout-note" id="layout-note"></div>
            </div>
          </details>

          <div class="preset-panel" id="preset-panel">
            <div class="preset-panel-head">
              <div class="preset-title">Fast starts</div>
              <div class="preset-copy">Common graph questions</div>
            </div>
            <div class="preset-list" id="preset-list"></div>
          </div>

          <details class="subsection" id="filter-section">
            <summary>
              <span class="subsection-head"><span class="subsection-title"><span>Filters</span><span class="subsection-state" id="filter-state">No filters</span></span><span class="subsection-copy">Optional scope narrowing</span></span>
              <span class="subsection-badge" id="filter-badge">0</span>
            </summary>
            <div class="subsection-body">
              <div class="grid">
                <div class="field">
                  <label for="field-where-field">Filter field</label>
                  <select id="field-where-field"></select>
                </div>
                <div class="field">
                  <label for="field-where-operator">Operator</label>
                  <select id="field-where-operator">
                    <option value="=">=</option>
                    <option value="contains">contains</option>
                  </select>
                </div>
                <div class="field span-2">
                  <label for="field-where-value">Value</label>
                  <input id="field-where-value" type="text" placeholder="active or [[johnny-rico]]" />
                  <div class="field-help">Accepts raw text or a Yamlink relation.</div>
                </div>
              </div>
            </div>
          </details>

          <details class="subsection" id="sort-section">
            <summary>
              <span class="subsection-head"><span class="subsection-title"><span>Sort & limit</span><span class="subsection-state" id="sort-state">No sort</span></span><span class="subsection-copy">Ordering and row cap</span></span>
              <span class="subsection-badge" id="sort-badge">0</span>
            </summary>
            <div class="subsection-body">
              <div class="grid">
                <div class="field">
                  <label for="field-sort-field">Sort field</label>
                  <select id="field-sort-field"></select>
                </div>
                <div class="field">
                  <label for="field-sort-direction">Direction</label>
                  <select id="field-sort-direction">
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                </div>
                <div class="field">
                  <label for="field-limit">Limit</label>
                  <select id="field-limit">
                    <option value="0">No limit</option>
                    <option value="10">10</option>
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </div>
              </div>
            </div>
          </details>

          <details class="subsection hidden" id="custom-fields-section">
            <summary>
              <span class="subsection-head"><span class="subsection-title"><span>Custom fields</span><span class="subsection-state" id="custom-state">No custom fields</span></span><span class="subsection-copy">Pick exactly what to show</span></span>
              <span class="subsection-badge" id="custom-badge">0</span>
            </summary>
            <div class="subsection-body">
              <div class="field span-2 hidden" id="field-custom-select-wrap">
                <label>Selected fields</label>
                <div class="checkbox-grid" id="custom-field-list"></div>
              </div>
            </div>
          </details>

          <details class="subsection" id="advanced-section">
            <summary>
              <span class="subsection-head"><span class="subsection-title"><span>Details</span><span class="subsection-state" id="advanced-state">Optional metadata</span></span><span class="subsection-copy">Labeling and finishing touches</span></span>
              <span class="subsection-badge">+</span>
            </summary>
            <div class="subsection-body">
              <div class="grid">
                <div class="field span-2">
                  <label for="field-label">Label</label>
                  <input id="field-label" type="text" placeholder="Optional label" />
                </div>
              </div>
            </div>
          </details>
        </div>
      </div>
      </div>
    </main>

    <aside class="preview">
      <div class="preview-shell">
        <div class="preview-card preview-card-primary">
          <div class="preview-head">
            <div>
              <div class="preview-kicker">Step 3</div>
              <div class="preview-title">Preview Results</div>
              <div class="preview-sub">Inspect the exact query, sample rows, and the current result shape before you insert it.</div>
            </div>
          </div>
          <div class="stat-line">
            <div class="stat-big" id="preview-title">0 rows</div>
            <div class="stat-copy" id="preview-detail"></div>
          </div>
          <div class="preview-status" id="preview-status"></div>
          <div class="preview-explanation" id="preview-explanation"></div>
          <pre id="query-preview"></pre>
          <div class="actions">
            <button class="btn primary" id="apply-btn">Insert block</button>
            <button class="btn secondary" id="open-preview-btn">Open preview</button>
            <button class="btn secondary" id="copy-btn">Copy query</button>
          </div>
        </div>

        <div class="preview-card">
          <div class="rail-title">Warnings</div>
          <ul class="warning-list" id="warning-list"></ul>
        </div>

        <div class="preview-card">
          <div class="rail-title">Sample Rows</div>
          <ul class="sample-list" id="sample-list"></ul>
        </div>
      </div>
    </aside>
  </div>

`;
}

module.exports = {
    getQueryBuilderStyles,
    getQueryBuilderBodyMarkup
};
