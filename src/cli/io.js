'use strict';

const fs = require('fs');

/**
 * @typedef {{
 *   json?: boolean,
 *   outputPath?: string|null,
 *   error?: unknown,
 *   code?: string,
 *   details?: any,
 *   exitCode?: number
 * }} CliErrorOptions
 */

/**
 * @param {() => void} render
 * @returns {string}
 */
function captureOutput(render) {
    /** @type {typeof console.log} */
    const originalLog = console.log;
    /** @type {typeof process.stdout.write} */
    const originalWrite = process.stdout.write;
    let buffer = '';

    console.log = (...args) => {
        buffer += args.map((arg) => String(arg)).join(' ') + '\n';
    };
    const captureWrite = (chunk, encodingOrCallback, callback) => {
        const encoding = typeof encodingOrCallback === 'function' ? 'utf8' : encodingOrCallback;
        const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
        buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(encoding || 'utf8');
        if (typeof done === 'function') done();
        return true;
    };
    /** @type {any} */ (process.stdout).write = captureWrite;

    try {
        render();
    } finally {
        console.log = originalLog;
        process.stdout.write = originalWrite;
    }

    return buffer;
}

/**
 * @param {string} content
 * @param {string|null|undefined} [outputPath]
 * @returns {void}
 */
function emitText(content, outputPath) {
    try {
        if (outputPath) {
            fs.writeFileSync(outputPath, content, 'utf8');
        } else {
            process.stdout.write(content);
        }
    } catch (error) {
        console.error('Failed to write output: ' + error.message);
        process.exit(1);
    }
}

/**
 * @param {unknown} payload
 * @param {string|null|undefined} [outputPath]
 * @returns {void}
 */
function emitJson(payload, outputPath) {
    emitText(JSON.stringify(payload, null, 2) + '\n', outputPath);
}

/**
 * @param {CliErrorOptions} [options]
 * @returns {never}
 */
function emitCliError({ json = false, outputPath = null, error, code = 'USER_ERROR', details, exitCode = 1 } = {}) {
    const payload = {
        ok: false,
        error: String(error || 'Unknown error'),
        code
    };
    if (details !== undefined) payload.details = details;

    if (json) {
        emitJson(payload, outputPath);
    } else {
        process.stderr.write(payload.error + '\n');
    }
    process.exit(exitCode);
}

/**
 * @param {Record<string, any>} payload
 * @param {string|null|undefined} [outputPath]
 * @returns {void}
 */
function emitCliSuccess(payload, outputPath) {
    emitJson({ ok: true, ...payload }, outputPath);
}

module.exports = {
    captureOutput,
    emitText,
    emitJson,
    emitCliError,
    emitCliSuccess
};
