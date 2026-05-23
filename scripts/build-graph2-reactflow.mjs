import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

await build({
  entryPoints: [path.join(root, 'src', 'features', 'graph2', 'graph2ReactFlowEntry.jsx')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  outfile: path.join(root, 'src', 'features', 'vendor', 'graph2-reactflow.js'),
  loader: {
    '.js': 'jsx',
    '.jsx': 'jsx',
    '.css': 'css'
  },
  sourcemap: false,
  minify: false,
  legalComments: 'none'
});
