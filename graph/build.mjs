/**
 * graph/build.mjs — esbuild bundler for the graph engine.
 *
 * Produces two outputs:
 *   dist/graph-engine.js        — IIFE bundle, globalName: 'YamlinkGraph'
 *   dist/graph-layout-worker.js — Web Worker bundle (ESM → self-contained IIFE)
 *
 * Run:
 *   node graph/build.mjs
 *   node graph/build.mjs --watch
 */

import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root      = path.join(__dirname, '..');
const outDir    = path.join(root, 'dist');

const watch = process.argv.includes('--watch');

const sharedOpts = {
  bundle:    true,
  minify:    !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel:  'info',
};

async function build() {
  // ── Main engine bundle ───────────────────────────────────────────────────────
  const engineCtx = await esbuild.context({
    ...sharedOpts,
    entryPoints: [path.join(__dirname, 'index.js')],
    outfile:     path.join(outDir, 'graph-engine.js'),
    format:      'iife',
    globalName:  'YamlinkGraph',
    platform:    'browser',
    external:    [],  // bundle d3-force inline (no Pixi.js dependency)
  });

  // ── Layout worker bundle ─────────────────────────────────────────────────────
  // The worker source uses ESM imports but must run as a self-contained script.
  const workerCtx = await esbuild.context({
    ...sharedOpts,
    entryPoints: [path.join(__dirname, 'core', 'layout-worker-src.js')],
    outfile:     path.join(outDir, 'graph-layout-worker.js'),
    format:      'iife',   // Workers can load IIFE via importScripts or new Worker(url, {type:'classic'})
    platform:    'browser',
    define: {
      'globalThis.__WORKER__': 'true',
    },
  });

  if (watch) {
    await engineCtx.watch();
    await workerCtx.watch();
    console.log('[graph] Watching for changes…');
  } else {
    await engineCtx.rebuild();
    await workerCtx.rebuild();
    await engineCtx.dispose();
    await workerCtx.dispose();
    console.log('[graph] Build complete → dist/');
  }
}

build().catch(err => { console.error(err); process.exit(1); });
