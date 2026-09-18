'use strict';

const { getQueryBuilderClientScript } = require('./queryBuilderEvents');
const { getQueryBuilderBodyMarkup, getQueryBuilderStyles } = require('./queryBuilderRender');

function createNonce() {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function getWebviewHtml(webview) {
    const nonce = createNonce();
    const csp = [
        `default-src 'none'`,
        `img-src ${webview.cspSource} https: data:`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`
    ].join('; ');
    const payload = JSON.stringify({ ready: true });
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Yamlink Query Builder</title>
  <style>
${getQueryBuilderStyles()}
  </style>
</head>
${getQueryBuilderBodyMarkup()}
  <script nonce="${nonce}">
${getQueryBuilderClientScript(payload)}
  </script>
</body>
</html>`;
}

module.exports = { getWebviewHtml };
