const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const testCmd = pkg.scripts.test;
const tested = [...testCmd.matchAll(/test\/(\w+)\.test\.js/g)].map(m => m[1].toLowerCase());

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else if (entry.name.endsWith('.js') && !full.includes('vendor')) results.push(full);
  }
  return results;
}

const src = walk('src').map(f => f.replace(/\\/g, '/'));
const untested = src.filter(f => {
  const base = path.basename(f, '.js').toLowerCase();
  return !tested.some(t => t === base);
});

console.log('UNTESTED SOURCE FILES (' + untested.length + '):');
untested.forEach(f => console.log('  ' + f));
console.log('\nTested modules count:', tested.length);
console.log('Total src files:', src.length);
