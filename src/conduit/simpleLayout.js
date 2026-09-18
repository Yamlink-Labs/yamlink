'use strict';

// Re-exports the canonical force-directed layout engine
// (src/features/graph/graphPhysicsEngine.js), the same one x-graph's two
// webview panels embed via SimpleLayout.toString(). Conduit is a real Node
// module, so it requires the class directly instead of needing a text copy.
// Conduit only ever calls settleSync(nodeData, edgeData) — a synchronous
// fast-forward-to-settled solve with no requestAnimationFrame and no
// interactivity — which never touches the constructor's onPos/onSettled
// callbacks, so `new SimpleLayout()` with no arguments is safe here.
const { SimpleLayout } = require('../features/graph/graphPhysicsEngine');

module.exports = { SimpleLayout };
