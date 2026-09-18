'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const originalResolve = Module._resolveFilename.bind(Module);
require.cache.__import_vaults_vscode_stub__ = {
    id: '__import_vaults_vscode_stub__',
    filename: '__import_vaults_vscode_stub__',
    loaded: true,
    exports: {}
};
Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'vscode') return '__import_vaults_vscode_stub__';
    return originalResolve(request, parent, ...rest);
};

const {
    stripHtmlToMarkdownish,
    normalizeRoamText,
    rewriteRoamReferences,
    renderRoamBlocks,
    importRoamJsonToVault,
    extractEvernoteResources,
    rewriteEvernoteContentLinks,
    importEvernoteEnexToVault,
    copyNotionExport,
    stripNotionSuffix,
    singularizeImportedType,
    inspectRoamExport,
    inspectEvernoteExport,
    inspectNotionExport,
    formatExternalInspectionSummary,
    formatImportTrustSummary,
    buildImportTrustSection,
    parseCsvTable,
    importNotionCsvDatabases,
    rewriteNotionMarkdownLinks,
    rewriteNotionHtmlLinks,
    postProcessNotionMarkdown,
    postProcessNotionHtml,
    buildExternalImportReportMarkdown
} = require('../src/features/importExternalVaults');

describe('importExternalVaults helpers', () => {
    let tempRoot;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlink-import-vaults-'));
    });

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    test('stripHtmlToMarkdownish preserves readable lines from ENEX content', () => {
        const body = stripHtmlToMarkdownish('<en-note><div>Hello<br/>world</div><ul><li>One</li><li>Two</li></ul></en-note>');
        assert.match(body, /Hello/);
        assert.match(body, /world/);
        assert.match(body, /- One/);
        assert.match(body, /- Two/);
    });

    test('renderRoamBlocks keeps nested bullet structure', () => {
        const body = renderRoamBlocks([
            { string: 'Parent', children: [{ string: 'Child' }] }
        ]);
        assert.match(body, /^- Parent/m);
        assert.match(body, /^  - Child/m);
    });

    test('renderRoamBlocks normalizes page references to canonical wikilinks', () => {
        const body = renderRoamBlocks([
            { string: 'Worked with [[Johnny Rico]] on [[Planet P]]' }
        ], 0, new Map([
            ['johnny rico', { id: 'johnny-rico', title: 'Johnny Rico' }],
            ['planet p', { id: 'planet-p', title: 'Planet P' }]
        ]));

        assert.match(body, /\[\[johnny-rico\|Johnny Rico\]\]/);
        assert.match(body, /\[\[planet-p\|Planet P\]\]/);
    });

    test('renderRoamBlocks preserves block uids and resolves Roam block references', () => {
        const blockTargets = new Map([
            ['child123', { noteId: 'johnny-rico', blockId: 'child123' }]
        ]);
        const body = renderRoamBlocks([
            {
                uid: 'parent123',
                string: 'Parent cites ((child123))',
                children: [{ uid: 'child123', string: 'Referenced block' }]
            }
        ], 0, new Map(), blockTargets);

        assert.match(body, /^- Parent cites \[\[johnny-rico\^child123\]\] \^parent123/m);
        assert.match(body, /^  - Referenced block \^child123/m);
        assert.equal(
            rewriteRoamReferences('{{embed: ((child123))}}', new Map(), blockTargets),
            '[[johnny-rico^child123]]'
        );
    });

    test('normalizeRoamText converts TODO and DONE macros into task syntax', () => {
        assert.equal(normalizeRoamText('{{[[TODO]]}} Call Johnny'), '[ ] Call Johnny');
        assert.equal(normalizeRoamText('{{[[DONE]]}} Filed report'), '[x] Filed report');
    });

    test('importRoamJsonToVault converts pages into markdown notes with ids and daily note metadata', () => {
        const sourcePath = path.join(tempRoot, 'roam.json');
        const destinationRoot = path.join(tempRoot, 'roam-import');
        fs.writeFileSync(sourcePath, JSON.stringify([
            { title: 'Johnny Rico', uid: 'abc123', children: [{ string: '{{[[TODO]]}} Served with [[Dizzy Flores]]' }] },
            { title: 'June 18th, 2026', children: [] }
        ]), 'utf8');

        const stats = importRoamJsonToVault(sourcePath, destinationRoot);

        assert.equal(stats.pagesImported, 2);
        assert.equal(stats.dailyNotesImported, 1);
        const johnny = fs.readFileSync(path.join(destinationRoot, 'johnny-rico.md'), 'utf8');
        assert.match(johnny, /id: johnny-rico/);
        assert.match(johnny, /title: Johnny Rico/);
        assert.match(johnny, /roam_uid: abc123/);
        assert.match(johnny, /\[ \] Served with \[\[dizzy-flores\|Dizzy Flores\]\]/);
        const journal = fs.readFileSync(path.join(destinationRoot, 'june-18th-2026.md'), 'utf8');
        assert.match(journal, /type: journal/);
        assert.match(journal, /date: "?2026-06-18"?/);
    });

    test('extractEvernoteResources reads base64 resources and metadata', () => {
        const resources = extractEvernoteResources(`
<resource>
  <data encoding="base64">aGVsbG8=</data>
  <mime>text/plain</mime>
  <resource-attributes><file-name>hello.txt</file-name></resource-attributes>
</resource>`);
        assert.equal(resources.length, 1);
        assert.equal(resources[0].mime, 'text/plain');
        assert.equal(resources[0].fileName, 'hello.txt');
        assert.equal(resources[0].hash, '5d41402abc4b2a76b9719d911017c592');
    });

    test('rewriteEvernoteContentLinks converts ENML todos, media, and encrypted placeholders', () => {
        const rewritten = rewriteEvernoteContentLinks(
            '<en-note><div><en-todo checked="true"/>Done item</div><div><en-media hash="abc" type="image/png"/></div><en-crypt hint="vault">secret</en-crypt></en-note>',
            {
                resourceByHash: new Map([['abc', { path: '_attachments/note/image.png', fileName: 'image.png' }]])
            }
        );

        assert.match(rewritten, /- \[x\] Done item/);
        assert.match(rewritten, /\[image\.png\]\(_attachments\/note\/image\.png\)/);
        assert.match(rewritten, /Encrypted Evernote content\. Hint: vault/);
    });

    test('rewriteEvernoteContentLinks preserves external links and resolves internal Evernote note links', () => {
        const rewritten = rewriteEvernoteContentLinks(
            '<en-note><a href="evernote:///view/1/s1/abcd-1/abcd-1/">Mission Brief</a> and <a href="https://example.com">Source</a></en-note>',
            {
                guidToNote: new Map([['abcd-1', { id: 'mission-brief', title: 'Mission Brief' }]]),
                titleToNote: new Map([['mission brief', { id: 'mission-brief', title: 'Mission Brief' }]])
            }
        );

        assert.match(rewritten, /\[\[mission-brief\]\]/);
        assert.match(rewritten, /\[Source\]\(https:\/\/example.com\)/);
    });

    test('importEvernoteEnexToVault converts ENEX notes into markdown notes', () => {
        const sourcePath = path.join(tempRoot, 'notes.enex');
        const destinationRoot = path.join(tempRoot, 'evernote-import');
        fs.writeFileSync(sourcePath, `<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <guid>brief-guid</guid>
    <title>Mission Brief</title>
    <content><![CDATA[<en-note><div>Briefing line</div><div><en-todo/>Open task</div><div><en-media hash="5d41402abc4b2a76b9719d911017c592" type="text/plain"/></div><div>See <a href="evernote:///view/1/s1/recon-guid/recon-guid/">Recon Note</a></div><div><a href="https://example.com/source-doc">Source Doc</a></div><ul><li>Alpha</li></ul></en-note>]]></content>
    <tag>ops</tag>
    <created>20260102T030405Z</created>
    <note-attributes>
      <author>Carmen</author>
      <source-url>https://example.com/source</source-url>
      <source-application>evernote.desktop</source-application>
    </note-attributes>
    <resource>
      <data encoding="base64">aGVsbG8=</data>
      <mime>text/plain</mime>
      <resource-attributes><file-name>hello.txt</file-name></resource-attributes>
    </resource>
  </note>
  <note>
    <guid>recon-guid</guid>
    <title>Recon Note</title>
    <content><![CDATA[<en-note><div>Linked body</div></en-note>]]></content>
  </note>
</en-export>`, 'utf8');

        const stats = importEvernoteEnexToVault(sourcePath, destinationRoot);

        assert.equal(stats.notesImported, 2);
        assert.equal(stats.attachmentsExtracted, 1);
        const note = fs.readFileSync(path.join(destinationRoot, 'mission-brief.md'), 'utf8');
        assert.match(note, /id: mission-brief/);
        assert.match(note, /imported_from: evernote/);
        assert.match(note, /created: "?2026-01-02"?/);
        assert.match(note, /author: Carmen/);
        assert.match(note, /source_url: https:\/\/example.com\/source/);
        assert.match(note, /attachments:/);
        assert.match(note, /- \[ \] Open task/);
        assert.match(note, /\[hello\.txt\]\(_attachments\/mission-brief\/hello\.txt\)/);
        assert.match(note, /\[\[recon-note\]\]/);
        assert.match(note, /\[Source Doc\]\(https:\/\/example.com\/source-doc\)/);
        assert.match(note, /- Alpha/);
        assert.equal(fs.existsSync(path.join(destinationRoot, '_attachments', 'mission-brief', 'hello.txt')), true);
    });

    test('stripNotionSuffix removes exported UUID tails from names', () => {
        assert.equal(stripNotionSuffix('Account 1234567890abcdef1234567890abcdef'), 'Account');
        assert.equal(stripNotionSuffix('Battle-1234567890abcdef1234567890abcdef'), 'Battle');
    });

    test('singularizeImportedType normalizes plural collection names for row notes', () => {
        assert.equal(singularizeImportedType('Contacts'), 'contact');
        assert.equal(singularizeImportedType('Companies'), 'company');
        assert.equal(singularizeImportedType('Analysis'), 'analysis');
    });

    test('rewriteNotionMarkdownLinks converts local markdown links into wikilinks', () => {
        const rewritten = rewriteNotionMarkdownLinks(
            '[Johnny](../People/Johnny Rico 1234567890abcdef1234567890abcdef.md) and [Notes](../People/Johnny Rico 1234567890abcdef1234567890abcdef.md#Key Findings) and [Site](https://example.com)',
            'Ops/Mission.md',
            new Map([['people/johnny rico 1234567890abcdef1234567890abcdef.md', 'johnny-rico']])
        );
        assert.match(rewritten, /\[\[johnny-rico\|Johnny\]\]/);
        assert.match(rewritten, /\[\[johnny-rico#Key Findings\|Notes\]\]/);
        assert.match(rewritten, /\[Site\]\(https:\/\/example.com\)/);
    });

    test('rewriteNotionMarkdownLinks leaves image embeds untouched while still rewriting note links', () => {
        const rewritten = rewriteNotionMarkdownLinks(
            '![Board](../assets/Board%20Cover.png) and [Johnny](../People/Johnny%20Rico%201234567890abcdef1234567890abcdef.md)',
            'Ops/Mission.md',
            new Map([['people/johnny rico 1234567890abcdef1234567890abcdef.md', 'johnny-rico']])
        );

        assert.match(rewritten, /!\[Board\]\(\.\.\/assets\/Board%20Cover\.png\)/);
        assert.match(rewritten, /\[\[johnny-rico\|Johnny\]\]/);
    });

    test('rewriteNotionHtmlLinks converts exported HTML page links into wikilinks', () => {
        const rewritten = rewriteNotionHtmlLinks(
            '[Child](Child%201234567890abcdef1234567890abcdef.html) and [Note](Note%201234567890abcdef1234567890abcdef.md)',
            'Parent.html',
            new Map([['note 1234567890abcdef1234567890abcdef.md', 'note']]),
            new Map([['child 1234567890abcdef1234567890abcdef.html', 'child']])
        );

        assert.match(rewritten, /\[\[child\|Child\]\]/);
        assert.match(rewritten, /\[\[note\|Note\]\]/);
    });

    test('postProcessNotionMarkdown stamps frontmatter and rewrites local note links', () => {
        const root = path.join(tempRoot, 'notion-processed');
        fs.mkdirSync(path.join(root, 'People'), { recursive: true });
        fs.mkdirSync(path.join(root, 'Ops'), { recursive: true });
        fs.writeFileSync(path.join(root, 'People', 'Johnny Rico 1234567890abcdef1234567890abcdef.md'), '# Johnny Rico');
        fs.writeFileSync(
            path.join(root, 'Ops', 'Mission 1234567890abcdef1234567890abcdef.md'),
            '# Mission\nSee [Johnny](../People/Johnny Rico 1234567890abcdef1234567890abcdef.md).'
        );

        const result = postProcessNotionMarkdown(root);

        assert.equal(result.markdownNotesProcessed, 2);
        const mission = fs.readFileSync(path.join(root, 'Ops', 'Mission 1234567890abcdef1234567890abcdef.md'), 'utf8');
        assert.match(mission, /id: mission/);
        assert.match(mission, /title: Mission/);
        assert.match(mission, /imported_from: notion/);
        assert.match(mission, /parent: ops/);
        assert.match(mission, /\[\[johnny-rico\|Johnny\]\]/);
    });

    test('postProcessNotionHtml converts real HTML export pages into markdown notes', () => {
        const root = path.join(tempRoot, 'notion-html-processed');
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(
            path.join(root, 'Child 1234567890abcdef1234567890abcdef.html'),
            '<html><body><h1>Child</h1><p>Body line</p></body></html>'
        );
        fs.writeFileSync(
            path.join(root, 'Parent 1234567890abcdef1234567890abcdef.html'),
            '<html><body><h1>Parent</h1><p>See <a href="Child%201234567890abcdef1234567890abcdef.html">Child</a></p></body></html>'
        );

        const result = postProcessNotionHtml(root);

        assert.equal(result.htmlPagesProcessed, 2);
        const parent = fs.readFileSync(path.join(root, 'parent.md'), 'utf8');
        assert.match(parent, /id: parent/);
        assert.match(parent, /notion_export_format: html/);
        assert.match(parent, /notion_source_id: 1234567890abcdef1234567890abcdef/);
        assert.match(parent, /\[\[child\|Child\]\]/);
    });

    test('parseCsvTable handles quoted cells and embedded commas', () => {
        const rows = parseCsvTable('Name,Status,Notes\n"Acme, Inc.",Active,"Line one"\n"Johnny Rico",Done,"Owns, reviews"');

        assert.deepEqual(rows, [
            ['Name', 'Status', 'Notes'],
            ['Acme, Inc.', 'Active', 'Line one'],
            ['Johnny Rico', 'Done', 'Owns, reviews']
        ]);
    });

    test('coerces Notion CSV cells without splitting embedded comma values', () => {
        const statsRoot = path.join(tempRoot, 'notion-comma-import');
        fs.mkdirSync(statsRoot, { recursive: true });
        fs.writeFileSync(path.join(statsRoot, 'Companies.csv'), 'Name,Company\nDeal,"Acme, Inc."');

        const stats = importNotionCsvDatabases(statsRoot);

        assert.equal(stats.databaseRowsImported, 1);
        const rowNote = fs.readFileSync(path.join(statsRoot, '_notion_databases', 'companies', 'deal.md'), 'utf8');
        assert.match(rowNote, /company: Acme, Inc\./);
    });

    test('importNotionCsvDatabases creates row notes with typed fields and wikilinks', () => {
        const root = path.join(tempRoot, 'notion-database-import');
        fs.mkdirSync(path.join(root, 'People'), { recursive: true });
        fs.writeFileSync(path.join(root, 'People', 'Johnny Rico 1234567890abcdef1234567890abcdef.md'), '# Johnny Rico');
        fs.writeFileSync(
            path.join(root, 'Contacts.csv'),
            'Name,Status,Owner,Tags\nAcme Corp,Active,Johnny Rico,client;priority'
        );

        const stats = importNotionCsvDatabases(root);

        assert.equal(stats.csvDatabasesProcessed, 1);
        assert.equal(stats.databaseRowsImported, 1);
        const rowNote = fs.readFileSync(path.join(root, '_notion_databases', 'contacts', 'acme-corp.md'), 'utf8');
        assert.match(rowNote, /id: acme-corp/);
        assert.match(rowNote, /type: contact/);
        assert.match(rowNote, /title: Acme Corp/);
        assert.match(rowNote, /imported_from: notion/);
        assert.match(rowNote, /notion_database: Contacts/);
        assert.match(rowNote, /owner: \[\[johnny-rico\|Johnny Rico\]\]/);
        assert.doesNotMatch(rowNote, /name:/);
        assert.match(rowNote, /tags: \[client, priority\]/);
    });

    test('copyNotionExport preserves markdown and assets, then stamps notes for Yamlink', () => {
        const sourceRoot = path.join(tempRoot, 'notion-export');
        const destinationRoot = path.join(tempRoot, 'notion-import');
        fs.mkdirSync(path.join(sourceRoot, '__MACOSX'), { recursive: true });
        fs.mkdirSync(path.join(sourceRoot, 'assets'), { recursive: true });
        fs.mkdirSync(path.join(sourceRoot, 'CRM'), { recursive: true });
        fs.writeFileSync(path.join(sourceRoot, 'CRM', 'Account 1234567890abcdef1234567890abcdef.md'), '# Account');
        fs.writeFileSync(path.join(sourceRoot, 'database.csv'), 'name,status,owner\nAcme,active,Account');
        fs.writeFileSync(path.join(sourceRoot, 'assets', 'cover.png'), 'png');
        fs.writeFileSync(path.join(sourceRoot, '__MACOSX', 'junk.txt'), 'junk');

        const stats = copyNotionExport(sourceRoot, destinationRoot);

        assert.equal(stats.markdownCopied, 1);
        assert.equal(stats.markdownNotesProcessed, 1);
        assert.equal(stats.csvDatabasesProcessed, 1);
        assert.equal(stats.databaseRowsImported, 1);
        assert.equal(fs.existsSync(path.join(destinationRoot, 'CRM', 'Account 1234567890abcdef1234567890abcdef.md')), true);
        assert.equal(fs.existsSync(path.join(destinationRoot, 'database.csv')), true);
        assert.equal(fs.existsSync(path.join(destinationRoot, 'assets', 'cover.png')), true);
        assert.equal(fs.existsSync(path.join(destinationRoot, '__MACOSX')), false);
        const account = fs.readFileSync(path.join(destinationRoot, 'CRM', 'Account 1234567890abcdef1234567890abcdef.md'), 'utf8');
        assert.match(account, /id: account/);
        assert.match(account, /imported_from: notion/);
        const databaseRow = fs.readFileSync(path.join(destinationRoot, '_notion_databases', 'database', 'acme.md'), 'utf8');
        assert.match(databaseRow, /owner: \[\[account\|Account\]\]/);
    });

    test('inspectRoamExport summarizes page and daily-note counts', () => {
        const sourcePath = path.join(tempRoot, 'roam.json');
        fs.writeFileSync(sourcePath, JSON.stringify([
            { title: 'Johnny Rico' },
            { title: 'June 18th, 2026' },
            { title: '' }
        ]), 'utf8');

        const inspection = inspectRoamExport(sourcePath);

        assert.equal(inspection.pages, 3);
        assert.equal(inspection.dailyNotes, 1);
        assert.equal(inspection.untitledPages, 1);
        assert.match(formatExternalInspectionSummary(inspection), /3 pages/);
    });

    test('inspectEvernoteExport summarizes note and attachment counts', () => {
        const sourcePath = path.join(tempRoot, 'notes.enex');
        fs.writeFileSync(sourcePath, `<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Mission Brief</title>
    <resource>
      <data encoding="base64">aGVsbG8=</data>
      <mime>text/plain</mime>
      <resource-attributes><file-name>hello.txt</file-name></resource-attributes>
    </resource>
  </note>
  <note>
    <title>Recon Note</title>
  </note>
</en-export>`, 'utf8');

        const inspection = inspectEvernoteExport(sourcePath);

        assert.equal(inspection.notes, 2);
        assert.equal(inspection.resources, 1);
        assert.match(formatExternalInspectionSummary(inspection), /2 notes/);
    });

    test('inspectNotionExport summarizes markdown, csv, and asset counts', () => {
        const root = path.join(tempRoot, 'notion-export');
        fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(root, 'Account.md'), '# Account');
        fs.writeFileSync(path.join(root, 'Contacts.csv'), 'Name\nAcme');
        fs.writeFileSync(path.join(root, 'assets', 'cover.png'), 'png');

        const inspection = inspectNotionExport(root);

        assert.equal(inspection.markdownFiles, 1);
        assert.equal(inspection.htmlFiles || 0, 0);
        assert.equal(inspection.csvFiles, 1);
        assert.equal(inspection.otherFiles, 1);
        assert.match(formatExternalInspectionSummary(inspection), /1 markdown/);
    });

    test('import summaries explain fit and unrecoverable export gaps', () => {
        assert.match(formatImportTrustSummary('Notion'), /Import fit: Mixed/);
        assert.match(formatImportTrustSummary('Evernote'), /Import fit: Good, with formatting tradeoffs/);
        assert.match(formatImportTrustSummary('Roam Research'), /Import fit: Good for pages and blocks/);

        const notionSection = buildImportTrustSection('Notion');
        assert.match(notionSection, /## What to expect from this import/);
        assert.match(notionSection, /relations, rollups, formulas, views, comments, permissions/);

        const evernoteSection = buildImportTrustSection('Evernote');
        assert.match(evernoteSection, /OCR text/);

        const roamSection = buildImportTrustSection('Roam');
        assert.match(roamSection, /Roam block IDs are kept/);
    });

    test('buildExternalImportReportMarkdown adds platform-specific normalization details', () => {
        const report = buildExternalImportReportMarkdown(tempRoot, {
            copied: 4,
            markdownCopied: 2,
            skipped: [],
            conflicts: [],
            markdownNotesProcessed: 2,
            frontmatterStamped: 2,
            rewrittenLinks: 5,
            csvDatabasesProcessed: 1,
            databaseRowsImported: 3
        }, {
            markdownFiles: 2,
            nonMarkdownFiles: 1,
            notesWithFrontmatter: 2,
            notesWithId: 2,
            notesWithType: 2,
            typeCounts: new Map([['contact', 2]]),
            likelyTypeLikeFields: [],
            wikilinks: 5,
            idMatchedLinks: 4,
            filenameMatchedLinks: 1,
            unresolvedLinks: 0,
            unresolvedLinkTargets: new Map(),
            filenameIdCandidates: []
        }, 'Notion');

        assert.match(report, /# Yamlink Notion Import Report/);
        assert.match(report, /## What to expect from this import/);
        assert.match(report, /Import fit: \*\*Mixed\*\*/);
        assert.match(report, /## Notion normalization/);
        assert.match(report, /Database row notes generated: \*\*3\*\*/);
        assert.match(report, /normalized toward singular collection names/i);
    });
});
